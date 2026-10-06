// 치지직 code 묶임 실측(worker/scripts/code-binding-check.mjs, docs/design/worker.md 구현 중 변경 29·42)의 순수 판정 함수.
// node:* import가 없어 scripts/code-binding-check.mjs(Node)와 vitest 단위 테스트(test/unit/code-binding.test.ts, workerd)가
// 함께 쓴다. 입출력·시계·난수가 없다. 결과에는 토큰·code·state·응답 본문이 없다(HTTP 상태와 짧은 오류 code만).
//
// 순서: ① 로그인으로 받은 code를 **새로 만든 다른 state**로 교환 → ② (①이 수락이 아니면) **원래 state**로 교환 →
// 대조 (①·② 모두 거부면) **두 번째 로그인**의 code를 그 로그인의 원래 state로 **먼저** 교환 →
// ③ (앞 교환 중 하나가 수락이면) 수락된 교환과 **같은 code·state**로 한 번 더. ①이 첫 교환이어야 한다(code가 일회용이면
// 다른 교환이 먼저 code를 써 버린다). 대조는 "실패한 ①이 code를 소모했다"와 "자격·만료 문제"를 가른다.
//
// 결과 종류:
//   accepted    2xx + 쓸 수 있는 accessToken
//   rejected    치지직의 결론 있는 거부: HTTP 4xx(408·429 제외), 또는 HTTP 2xx + 래퍼 code 4xx(408·429 제외)
//   transient   판정 불가: 5xx·408·429(HTTP 또는 래퍼), 그 밖의 모양(2xx인데 토큰도 4xx code도 없음, 3xx 등)
//   unreachable 판정 불가: 연결 실패·시간 초과·상태를 받은 뒤 본문 읽기 실패(치지직에 닿았는지·code를 썼는지 모른다)

// src/core/chzzk.ts parseTokenResponse와 같은 기준: 2xx이고 (래퍼가 있으면 content의) accessToken이 헤더에 실을 수 있는 모양
const ACCESS_TOKEN = /^[!-~]{1,8192}$/;
// 출력해도 되는 오류 code 모양(src/core/chzzk.ts CODE와 같다). 이 code는 치지직 오류 코드이지 OAuth code가 아니다
const ERROR_CODE = /^[\w.-]{1,50}$/;

// 다시 하면 결과가 달라질 수 있는 상태(서버 오류·요청 시간 초과·요청 수 제한)
const isTransientStatus = (n) => n >= 500 || n === 408 || n === 429;
const isRejectStatus = (n) => n >= 400 && n <= 499 && !isTransientStatus(n);

/**
 * 토큰 교환 응답 → 수락·거부·판정 불가. 본문은 판정에만 쓰고 결과에 싣지 않는다.
 * @returns {{kind: "accepted"} | {kind: "rejected" | "transient", status: number, code?: string}}
 */
export function judgeExchange(status, body) {
  let json = null;
  try {
    const v = JSON.parse(body);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) json = v;
  } catch {
    // JSON이 아니면 상태만 본다(본문은 쓰지 않는다)
  }
  const content = json === null ? null : (json.content ?? json);
  const token = content !== null && typeof content === "object" && !Array.isArray(content) ? content.accessToken : undefined;
  const ok2xx = status >= 200 && status <= 299;
  if (ok2xx && typeof token === "string" && ACCESS_TOKEN.test(token)) return { kind: "accepted" };
  const raw = json?.code;
  const code = (typeof raw === "string" || typeof raw === "number") && ERROR_CODE.test(String(raw)) ? String(raw) : undefined;
  const out = (kind) => (code === undefined ? { kind, status } : { kind, status, code });
  if (isRejectStatus(status)) return out("rejected");
  // HTTP 200이어도 래퍼가 {code:401, content:null}이면 거부다. 래퍼 5xx·408·429는 판정 불가
  if (ok2xx && code !== undefined && /^\d{3}$/.test(code) && isRejectStatus(Number(code))) return out("rejected");
  return out("transient");
}

/**
 * 연결 실패·시간 초과(status 없음), 또는 상태를 받은 뒤 본문 읽기 실패(status 있음).
 * 요청이 치지직에 닿았는지(본문이 끊긴 2xx면 토큰이 발급돼 code가 쓰였는지) 모르므로 거부로 세지 않는다(판정 불가).
 */
export function unreachable(timedOut, status) {
  const r = { kind: "unreachable", timedOut: timedOut === true };
  return typeof status === "number" ? { ...r, status } : r;
}

/** ②(원래 state)는 ①이 수락이 아닐 때만 돈다. ①이 수락이면 그 code는 이미 쓰였고 ③이 재사용을 본다 */
export function needSecond(first) {
  return first.kind !== "accepted";
}

/**
 * 대조(두 번째 로그인의 새 code를 그 로그인의 원래 state로 먼저 교환)는 ①·②가 모두 결론 있는 거부일 때만 돈다.
 * ①의 거부가 state 때문이고 실패한 ①이 code를 소모해 ②가 실패한 것인지, 자격·만료 문제인지 가른다.
 */
export function needControl(first, second) {
  return first.kind === "rejected" && second?.kind === "rejected";
}

/**
 * ③(같은 code 재교환)의 대상: 수락된 교환의 code·state. "original"은 첫 로그인 code + 원래 state(① 또는 ②가 수락),
 * "control"은 대조의 code + 그 state, null은 건너뜀(수락된 교환이 없으면 code가 처음부터 쓸 수 없었을 수 있다).
 * control이 "login_failed"(두 번째 로그인을 받지 못함)면 대조 결과가 없는 것과 같다.
 */
export function thirdTarget(first, second, control) {
  if (first.kind === "accepted" || second?.kind === "accepted") return "original";
  if (control !== null && control !== undefined && control !== "login_failed" && control.kind === "accepted") return "control";
  return null;
}

function detail(r) {
  if (r.kind === "unreachable") {
    if (typeof r.status === "number") return `HTTP ${r.status} 뒤 본문 읽기 ${r.timedOut ? "시간 초과" : "실패"}`;
    return r.timedOut ? "시간 초과" : "연결 실패";
  }
  return r.code === undefined ? `HTTP ${r.status}` : `HTTP ${r.status}, code ${r.code}`;
}

// 거부/수락 낱말(①·③)
function acceptWord(r) {
  if (r.kind === "accepted") return "수락";
  if (r.kind === "rejected") return `거부(${detail(r)})`;
  return `판정 불가(${detail(r)})`;
}

// 성공/실패 낱말(②·대조)
function successWord(r) {
  if (r.kind === "accepted") return "성공";
  if (r.kind === "rejected") return `실패(${detail(r)})`;
  return `판정 불가(${detail(r)})`;
}

// 결론 없는 결과(transient·unreachable)의 이유
// subject는 조사까지 붙인 주어("①이"·"②가"·"③이"·"대조가")
function unknownWhy(subject, r) {
  if (r.kind === "unreachable") return `${subject} 치지직에 닿았는지 모른다(${detail(r)})`;
  return `${subject} 일시 오류·예상 밖 응답이다(${detail(r)})`;
}

/**
 * state 묶임 결론. control은 대조 결과이고, 대조가 필요했는데 두 번째 로그인을 받지 못했으면 "login_failed"다.
 */
export function stateVerdict(first, second, control = null) {
  if (first.kind === "accepted") return "묶이지 않는다: 다른 state로 교환됐다(구현 중 변경 29의 대응을 사용자와 정한다)";
  if (first.kind !== "rejected") return `판정 불가: ${unknownWhy("①이", first)}. 다시 로그인해 처음부터 돌린다`;
  if (second === null) return "판정 불가: ②를 돌리지 않았다";
  if (second.kind === "accepted") return "묶인다: 다른 state는 거부되고 원래 state로는 교환됐다";
  if (second.kind !== "rejected") return `판정 불가: ${unknownWhy("②가", second)}. 다시 로그인해 처음부터 돌린다`;
  // ①·② 모두 거부: 대조로 가른다
  if (control === null) return "판정 불가: ①·② 모두 거부됐는데 대조를 돌리지 않았다";
  if (control === "login_failed") return "판정 불가: ①·② 모두 거부됐고 대조용 두 번째 로그인을 받지 못했다. 다시 로그인해 처음부터 돌린다";
  if (control.kind === "accepted")
    return "묶인다(다른 state 거부) + 실패한 교환이 code를 소모할 수 있다: 대조(새 code를 원래 state로 먼저)는 교환됐다";
  if (control.kind === "rejected")
    return "판정 불가: 대조도 거부돼 자격·만료 문제로 보인다. 다시 돌리지 말고 ①·②·대조의 HTTP 상태와 오류 code 이름을 에이전트에 알린다";
  return `판정 불가: ①·② 모두 거부됐고 ${unknownWhy("대조가", control)}. 다시 로그인해 처음부터 돌린다`;
}

/** code 재사용 결론 */
export function reuseVerdict(third) {
  if (third === null) return "판정 불가: 앞 교환이 하나도 성공하지 않아 재사용을 볼 수 없다";
  if (third.kind === "rejected") return "막힌다: 같은 code의 두 번째 교환이 거부됐다";
  if (third.kind === "accepted") return "막히지 않는다: 같은 code가 두 번 교환됐다(구현 중 변경 29의 대응을 사용자와 정한다)";
  return `판정 불가: ${unknownWhy("③이", third)}`;
}

function controlLine(control) {
  if (control === null) return "건너뜀(①·② 모두 거부일 때만 돈다)";
  if (control === "login_failed") return "판정 불가(두 번째 로그인을 받지 못했다)";
  return successWord(control);
}

/** 터미널 출력 줄(ROADMAP에는 ①·②·대조·③의 거부/수락·성공/실패와 결론만 옮긴다) */
export function reportLines({ first, second, control = null, third }) {
  const label = thirdTarget(first, second, control) === "control" ? "③ 같은 code 재교환(대조의 code)" : "③ 같은 code 재교환";
  return [
    `① 다른 state로 교환: ${acceptWord(first)}`,
    `② 원래 state로 교환: ${second === null ? "건너뜀(①이 수락돼 code가 이미 쓰였다)" : successWord(second)}`,
    `대조(두 번째 로그인의 code를 원래 state로 먼저 교환): ${controlLine(control)}`,
    `${label}: ${third === null ? "건너뜀(앞 교환이 하나도 성공하지 않았다)" : acceptWord(third)}`,
    `결론 — state 묶임: ${stateVerdict(first, second, control)}`,
    `결론 — code 재사용: ${reuseVerdict(third)}`,
  ];
}
