// wrangler dev E2E의 순수 함수(docs/design/worker.md §12.3, 구현 중 변경 40·41). node:* import가 없어 scripts/e2e-dev.mjs(Node)와
// vitest 단위 테스트(test/unit/e2e-lib.test.ts, workerd)가 함께 쓴다. 입출력·시계·난수가 없다.

export const E2E_PORT = 8787; // 등록된 개발용 콜백 포트(바꾸지 않는다)
export const E2E_BIND_IP = "127.0.0.1";
export const E2E_ORIGIN = "http://localhost:8787"; // 127.0.0.1로 들어오면 config_error(§10.1)
export const E2E_START_RATE = 3; // --var START_RATE_10M
export const E2E_BUCKET = "chzzk-downloader-dist"; // wrangler.jsonc r2 bucket_name(e2e-dev가 대조)
export const E2E_VERSIONS = ["0.1.0", "0.2.0"]; // latest = 0.2.0
export const MIN_CANARY = 6;
export const BUILD_ID_RE = /^[0-9A-Za-z._-]{1,40}$/;
// src/core/log.ts의 허용 필드 + event(단위 테스트가 formatLog와 맞춰 본다)
export const LOG_KEYS = ["event", "level", "route", "method", "status", "stage", "timedOut", "durationMs", "flowKind", "reason", "sessionIdPrefix", "chzzkCode", "key", "errorName"];
export const REFERRER_POLICIES = ["no-referrer", "no-referrer-when-downgrade", "same-origin", "origin", "strict-origin", "origin-when-cross-origin", "strict-origin-when-cross-origin", "unsafe-url"];
export const REQUEST_LINE = /^\[wrangler:(?:info|warn|error)\] (?:GET|HEAD|POST|PUT|DELETE|PATCH|OPTIONS) \/\S* \d{3}\b/;
// 시나리오가 반드시 일으키는 Worker 이벤트의 최소 수(이상). 로그 검사가 빈 출력을 보고 통과하지 못하게 한다
export const REQUIRED_EVENTS = {
  "auth.login.ok": 3,
  "auth.login.denied": 1,
  "auth.login.cancelled": 1,
  "auth.refresh.recovered": 1,
  "auth.refresh.reuse_detected": 1,
  "admin.allow": 1,
  "admin.denied_allow": 1,
  "admin.revoke_session": 1,
  "web.post.rejected": 3,
  "auth.start.rejected": 2,
  "release.forbidden_key": 1,
};
// 정확히 이 수여야 하는 이벤트(config.error는 Origin 가드 확인 한 번, 잡히지 않은 예외는 0)
export const EXACT_EVENTS = { "config.error": 1, "http.internal": 0 };

const SAFE_ARG = /^[^-]/;
const FAKE_ORIGIN_RE = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
const R2_KEY_RE = /^releases\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?$/;

/** wrangler dev 인자(실제 비밀값 파일을 열지 않는 pnpm dev와 같은 모양 + 임시 R2 폴더·--var). 원격 R2도 로그 등급도 정하지 않는다 */
export function wranglerDevArgs({ persistTo, buildId, fakeOrigin, startRate = E2E_START_RATE }) {
  if (typeof buildId !== "string" || !BUILD_ID_RE.test(buildId)) throw new Error("buildId 형식이 틀렸다");
  if (typeof persistTo !== "string" || persistTo === "" || !SAFE_ARG.test(persistTo)) throw new Error("persistTo가 비었거나 -로 시작한다");
  if (typeof fakeOrigin !== "string" || !FAKE_ORIGIN_RE.test(fakeOrigin)) throw new Error("fakeOrigin은 http://127.0.0.1:<포트>여야 한다");
  if (!Number.isInteger(startRate) || startRate < 1 || startRate > 1_000_000) throw new Error("startRate는 1~1000000의 정수");
  return [
    "dev",
    "--config",
    "wrangler.jsonc",
    "--port",
    String(E2E_PORT),
    "--ip",
    E2E_BIND_IP,
    "--env-file",
    ".dev.vars.example",
    "--persist-to",
    persistTo,
    "--show-interactive-dev-session=false",
    "--var",
    `BUILD_ID:${buildId}`,
    "--var",
    `START_RATE_10M:${startRate}`,
    "--var",
    `CHZZK_AUTHORIZE_URL:${fakeOrigin}/account-interlock`,
    "--var",
    `CHZZK_API_BASE:${fakeOrigin}`,
  ];
}

/** 로컬 R2에 한 객체를 넣는 wrangler 인자(--local만. 실제 R2도 묶음 put도 쓰지 않는다) */
export function wranglerR2PutArgs({ key, file, persistTo }) {
  if (typeof key !== "string" || !R2_KEY_RE.test(key) || key.split("/").some((seg) => seg === "." || seg === "..")) throw new Error("R2 키 형식이 틀렸다");
  for (const [name, v] of [["file", file], ["persistTo", persistTo]]) {
    if (typeof v !== "string" || v === "" || !SAFE_ARG.test(v)) throw new Error(`${name}이 비었거나 -로 시작한다`);
  }
  return ["r2", "object", "put", `${E2E_BUCKET}/${key}`, "--file", file, "--local", "--persist-to", persistTo, "--config", "wrangler.jsonc"];
}

/** KEY=VALUE 줄(빈 줄·# 주석 무시). vitest.config.ts와 같은 규칙 */
export function parseDevVars(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) throw new Error(`env 파일 줄 형식이 틀렸다: ${t.slice(0, 20)}`);
    out[t.slice(0, i)] = t.slice(i + 1);
  }
  return out;
}

/** Set-Cookie 한 줄 → { name, value, attrs(소문자·trim) } */
export function cookieAttrs(setCookie) {
  const [pair = "", ...rest] = setCookie.split(";");
  const i = pair.indexOf("=");
  return { name: i < 0 ? pair.trim() : pair.slice(0, i).trim(), value: i < 0 ? "" : pair.slice(i + 1).trim(), attrs: rest.map((a) => a.trim().toLowerCase()).filter((a) => a !== "") };
}

/** 쿠키 항아리. 값이 비었거나 Max-Age=0이면 지운다 */
export class CookieJar {
  #map = new Map();

  apply(setCookies) {
    for (const line of setCookies) {
      const { name, value, attrs } = cookieAttrs(line);
      if (name === "") continue;
      if (value === "" || attrs.includes("max-age=0")) this.#map.delete(name);
      else this.#map.set(name, value);
    }
  }

  header() {
    if (this.#map.size === 0) return null;
    return [...this.#map].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  get(name) {
    return this.#map.get(name);
  }

  has(name) {
    return this.#map.has(name);
  }

  values() {
    return [...this.#map.values()];
  }
}

/** Referrer-Policy 헤더 → 마지막으로 알려진 토큰(없으면 "") */
export function parseReferrerPolicy(value) {
  if (typeof value !== "string") return "";
  const tokens = value.split(",").map((t) => t.trim().toLowerCase());
  for (let i = tokens.length - 1; i >= 0; i--) {
    if (REFERRER_POLICIES.includes(tokens[i])) return tokens[i];
  }
  return "";
}

/**
 * 폼 POST를 하는 브라우저의 Origin·Sec-Fetch-Site(Fetch 표준 "append a request Origin header", GET·HEAD가 아닌 요청).
 * undici는 Origin을 스스로 싣지 않으므로 문서의 Referrer-Policy로 같은 규칙을 계산해 보낸다(worker.md 구현 중 변경 40 (아)).
 */
export function browserPostHeaders({ documentUrl, referrerPolicy, targetUrl }) {
  const doc = new URL(documentUrl);
  const target = new URL(targetUrl);
  const policy = referrerPolicy === "" || referrerPolicy === undefined ? "strict-origin-when-cross-origin" : referrerPolicy;
  const sameOrigin = doc.origin === target.origin;
  let origin = doc.origin;
  if (policy === "no-referrer") origin = "null";
  else if (["no-referrer-when-downgrade", "strict-origin", "strict-origin-when-cross-origin"].includes(policy) && doc.protocol === "https:" && target.protocol !== "https:") origin = "null";
  else if (policy === "same-origin" && !sameOrigin) origin = "null";
  return { Origin: origin, "Sec-Fetch-Site": sameOrigin ? "same-origin" : "cross-site" };
}

/** 페이지의 csrf 숨은 입력: 서로 다른 값이 정확히 하나일 때 그 값 */
export function extractCsrf(html) {
  const found = new Set([...html.matchAll(/name="csrf" value="([A-Za-z0-9_-]{43})"/g)].map((m) => m[1]));
  return found.size === 1 ? [...found][0] : null;
}

export function extractUserCode(html) {
  return /<p class="code">([2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})<\/p>/.exec(html)?.[1] ?? null;
}

/** 표의 행 중 채널 id가 든 행의 action="<접두><id>/revoke"에서 id */
export function extractRowIds(html, { channelId, actionPrefix }) {
  const out = [];
  const re = new RegExp(`action="${actionPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([A-Za-z0-9_-]+)/revoke"`, "g");
  for (const row of html.split("<tr>")) {
    if (!row.includes(`>${channelId}<`)) continue;
    for (const m of row.matchAll(re)) out.push(m[1]);
  }
  return out;
}

/** 랜딩의 다운로드 표: [{ href, file, sha256 }] */
export function extractDownloadLinks(html) {
  const out = [];
  for (const row of html.split("<tr>")) {
    const a = /<a href="(\/releases\/[^"/]+\/([^"]+))">/.exec(row);
    const sum = /<code>([0-9a-f]{64})<\/code>/.exec(row);
    if (a && sum) out.push({ href: a[1], file: a[2], sha256: sum[1] });
  }
  return out;
}

export const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");

/** 로그 줄의 종류: 빈 줄 · Worker JSON · wrangler 요청 줄 · 그 밖 */
export function classifyLine(raw) {
  const s = stripAnsi(raw).trimEnd();
  if (s === "") return "blank";
  if (s.startsWith('{"event":')) return "event";
  if (REQUEST_LINE.test(s)) return "request";
  return "other";
}

/** 카나리 목록(비밀 종류 secret, 경로에 실려 요청 줄에는 찍히는 path). 같은 값은 한 번만 둔다 */
export function makeCanaries() {
  const list = [];
  const seen = new Set();
  return {
    add(kind, label, value) {
      if (typeof value !== "string" || value.length < MIN_CANARY) throw new Error(`카나리 ${label}가 너무 짧다(${MIN_CANARY}자 이상)`);
      if (seen.has(value)) return;
      seen.add(value);
      list.push({ kind, label, value });
    },
    list: () => [...list],
  };
}

const EVENT_NAME = /^[a-z][a-z_.]{0,63}$/;

/**
 * 로그 줄 검사. 위반 메시지에는 카나리 값을 싣지 않는다(줄 번호·종류·이름뿐).
 *   event   : JSON 한 줄, 허용 키만, 모든 카나리 0건
 *   request : 쿼리(?) 없음, secret 카나리 0건(경로의 handle·세션 id·채널 id는 wrangler가 찍는다)
 *   other   : 모든 카나리 0건
 */
export function scanLogs(lines, canaries) {
  const events = {};
  const violations = [];
  const counts = { event: 0, request: 0, other: 0 };
  lines.forEach((raw, i) => {
    const kind = classifyLine(raw);
    if (kind === "blank") return;
    counts[kind]++;
    const s = stripAnsi(raw).trimEnd();
    const at = `${i + 1}번째 줄(${kind})`;
    if (kind === "event") {
      let obj = null;
      try {
        obj = JSON.parse(s);
      } catch {
        // 아래에서 위반으로 센다
      }
      if (obj === null || typeof obj !== "object" || Array.isArray(obj)) violations.push(`${at}: JSON 객체가 아니다`);
      else {
        if (typeof obj.event !== "string" || !EVENT_NAME.test(obj.event)) violations.push(`${at}: event 이름 형식이 틀렸다`);
        else events[obj.event] = (events[obj.event] ?? 0) + 1;
        for (const k of Object.keys(obj)) if (!LOG_KEYS.includes(k)) violations.push(`${at}: 허용 밖의 키 ${k}`);
      }
    }
    if (kind === "request" && s.includes("?")) violations.push(`${at}: 요청 줄에 쿼리`);
    for (const c of canaries.list()) {
      if (kind === "request" && c.kind !== "secret") continue;
      if (s.includes(c.value)) violations.push(`${at}: ${c.label}`);
    }
  });
  return { events, violations, counts };
}

/** 필요 이벤트 수(REQUIRED_EVENTS 이상, EXACT_EVENTS 정확히) 위반 목록 */
export function checkEvents(events) {
  const out = [];
  for (const [name, want] of Object.entries(REQUIRED_EVENTS)) {
    const got = events[name] ?? 0;
    if (got < want) out.push(`이벤트 ${name} ${got}개(필요 ≥${want})`);
  }
  for (const [name, want] of Object.entries(EXACT_EVENTS)) {
    const got = events[name] ?? 0;
    if (got !== want) out.push(`이벤트 ${name} ${got}개(필요 =${want})`);
  }
  return out;
}
