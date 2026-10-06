// 치지직 code 묶임 실측(worker/scripts/code-binding-check.mjs, docs/design/worker.md 구현 중 변경 29·42)의 순수 판정 함수.
// node:* import가 없어 scripts/code-binding-check.mjs(Node)와 vitest 단위 테스트(test/unit/code-binding.test.ts, workerd)가
// 함께 쓴다. 입출력·시계·난수가 없다. 결과에는 토큰·code·state·응답 본문이 없다(HTTP 상태와 짧은 오류 code만).
//
// 순서: ① 로그인으로 받은 code를 **새로 만든 다른 state**로 교환 → ② (①이 수락이 아니면) **원래 state**로 교환 →
// ③ (앞 교환 중 하나가 수락이면) **같은 code**로 원래 state 한 번 더. ①이 첫 교환이어야 한다(code가 일회용이면 다른 교환이
// 먼저 code를 써 버린다).

// src/core/chzzk.ts parseTokenResponse와 같은 기준: 2xx이고 (래퍼가 있으면 content의) accessToken이 헤더에 실을 수 있는 모양
const ACCESS_TOKEN = /^[!-~]{1,8192}$/;
// 출력해도 되는 오류 code 모양(src/core/chzzk.ts CODE와 같다). 이 code는 치지직 오류 코드이지 OAuth code가 아니다
const ERROR_CODE = /^[\w.-]{1,50}$/;

/**
 * 토큰 교환 응답 → 수락·거부. 본문은 판정에만 쓰고 결과에 싣지 않는다.
 * @returns {{kind: "accepted"} | {kind: "rejected", status: number, code?: string}}
 */
export function judgeExchange(status, body) {
  let json = null;
  try {
    const v = JSON.parse(body);
    if (v !== null && typeof v === "object" && !Array.isArray(v)) json = v;
  } catch {
    // JSON이 아니면 거부(본문은 쓰지 않는다)
  }
  const content = json === null ? null : (json.content ?? json);
  const token = content !== null && typeof content === "object" && !Array.isArray(content) ? content.accessToken : undefined;
  // HTTP 200이어도 래퍼가 {code:401, content:null}이면 거부다
  if (status >= 200 && status <= 299 && typeof token === "string" && ACCESS_TOKEN.test(token)) return { kind: "accepted" };
  const raw = json?.code;
  const code = (typeof raw === "string" || typeof raw === "number") && ERROR_CODE.test(String(raw)) ? String(raw) : undefined;
  return code === undefined ? { kind: "rejected", status } : { kind: "rejected", status, code };
}

/** 연결 실패·시간 초과: 요청이 치지직에 닿았는지 모르므로 거부로 세지 않는다(판정 불가) */
export function unreachable(timedOut) {
  return { kind: "unreachable", timedOut: timedOut === true };
}

/** ②(원래 state)는 ①이 수락이 아닐 때만 돈다. ①이 수락이면 그 code는 이미 쓰였고 ③이 재사용을 본다 */
export function needSecond(first) {
  return first.kind !== "accepted";
}

/** ③(같은 code 재교환)은 앞 교환 중 하나가 수락됐을 때만 뜻이 있다(아니면 code가 처음부터 쓸 수 없었을 수 있다) */
export function needThird(first, second) {
  return first.kind === "accepted" || second?.kind === "accepted";
}

function detail(r) {
  if (r.kind === "unreachable") return r.timedOut ? "시간 초과" : "연결 실패";
  return r.code === undefined ? `HTTP ${r.status}` : `HTTP ${r.status}, code ${r.code}`;
}

// 거부/수락 낱말(①·③)
function acceptWord(r) {
  if (r.kind === "accepted") return "수락";
  if (r.kind === "rejected") return `거부(${detail(r)})`;
  return `판정 불가(${detail(r)})`;
}

// 성공/실패 낱말(②)
function successWord(r) {
  if (r.kind === "accepted") return "성공";
  if (r.kind === "rejected") return `실패(${detail(r)})`;
  return `판정 불가(${detail(r)})`;
}

/** state 묶임 결론 */
export function stateVerdict(first, second) {
  if (first.kind === "accepted") return "묶이지 않는다: 다른 state로 교환됐다(구현 중 변경 29의 대응을 사용자와 정한다)";
  if (first.kind === "unreachable") return "판정 불가: ①이 치지직에 닿았는지 모른다. 다시 로그인해 처음부터 돌린다";
  if (second?.kind === "accepted") return "묶인다: 다른 state는 거부되고 원래 state로는 교환됐다";
  if (second?.kind === "rejected")
    return "판정 불가: ②도 실패해 ①의 거부가 state 때문인지, 실패한 ①이 code를 못 쓰게 만든 것인지(또는 code 만료·자격 오류인지) 가를 수 없다";
  return "판정 불가: ②가 치지직에 닿지 않았다. 다시 로그인해 처음부터 돌린다";
}

/** code 재사용 결론 */
export function reuseVerdict(third) {
  if (third === null) return "판정 불가: 앞 교환이 하나도 성공하지 않아 재사용을 볼 수 없다";
  if (third.kind === "rejected") return "막힌다: 같은 code의 두 번째 교환이 거부됐다";
  if (third.kind === "accepted") return "막히지 않는다: 같은 code가 두 번 교환됐다(구현 중 변경 29의 대응을 사용자와 정한다)";
  return "판정 불가: ③이 치지직에 닿았는지 모른다";
}

/** 터미널 출력 줄(ROADMAP에는 ①·②·③의 거부/수락·성공/실패와 결론만 옮긴다) */
export function reportLines({ first, second, third }) {
  return [
    `① 다른 state로 교환: ${acceptWord(first)}`,
    `② 원래 state로 교환: ${second === null ? "건너뜀(①이 수락돼 code가 이미 쓰였다)" : successWord(second)}`,
    `③ 같은 code 재교환: ${third === null ? "건너뜀(앞 교환이 하나도 성공하지 않았다)" : acceptWord(third)}`,
    `결론 — state 묶임: ${stateVerdict(first, second)}`,
    `결론 — code 재사용: ${reuseVerdict(third)}`,
  ];
}
