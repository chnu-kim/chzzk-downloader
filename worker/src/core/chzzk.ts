// 치지직 Open API 호출 규칙(docs/design/worker.md §7.3, 구현 중 변경 14 (나)). 요청 모양과 응답 해석은 순수 함수이고,
// 네트워크(deps.fetch)와 시간 제한 신호(deps.timeout)는 주입한다. core는 전역 네트워크 함수를 부르지 않는다.
//
// 결과에는 응답 본문·토큰·메시지가 없다: 실패는 {failCode, stage, status, code?(^[\w.-]{1,50}$), timedOut}뿐이다.
// 치지직 토큰은 users/me 뒤 버린다(expiresIn을 읽지 않고, revoke도 부르지 않는다).

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ChzzkDeps {
  readonly fetch: FetchLike;
  /** 호출마다 새 신호. 기본 AbortSignal.timeout */
  readonly timeout?: (ms: number) => AbortSignal;
}

/** Config와 같은 모양(core는 바깥 config 모듈을 가져오지 않는다) */
export interface ChzzkApp {
  readonly authorizeUrl: string;
  readonly apiBase: string;
  readonly clientId: string;
  readonly clientSecret: string;
  /** PUBLIC_ORIGIN + /auth/callback(치지직 등록 값과 바이트가 같다) */
  readonly redirectUri: string;
}

export const CHZZK_TIMEOUT_MS = 10_000;

export type FailCode = "token" | "user" | "timeout" | "user_format";

export interface ChzzkFailure {
  readonly ok: false;
  readonly failCode: FailCode;
  readonly stage: "token" | "user";
  readonly status: number;
  readonly code?: string;
  readonly timedOut: boolean;
}

export interface ChzzkIdentity {
  readonly ok: true;
  readonly channelId: string;
  readonly channelName: string;
}

const CODE = /^[\w.-]{1,50}$/;
const CHANNEL_ID = /^[0-9a-f]{32}$/;
// 헤더에 실을 수 있는 모양만(공백·제어 문자 없음). 아니면 토큰 단계 실패
const ACCESS_TOKEN = /^[!-~]{1,8192}$/;
// 보이지 않거나 표시 순서를 바꾸는 문자를 지운다(관리 화면에서 다른 이름과 구분되지 않게 하는 값, 구현 중 변경 16 (가)):
// 제어 문자(Cc), soft hyphen, ALM, ZWSP·ZWNJ, LRM·RLM, LRE~RLO, WJ~보이지 않는 연산자, LRI~PDI, BOM.
// ZWJ(U+200D)는 남긴다: 이모지 결합 순서에 쓰인다. 소스에 리터럴로 쓰지 않는다(\u 이스케이프, worker-config 검사)
const UNSAFE_CHARS = /[\p{Cc}\u00AD\u061C\u200B\u200C\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/gu;
const NAME_MAX = 128;

const apiRoot = (app: ChzzkApp): string => app.apiBase.replace(/\/+$/, "");

/** 303 Location: {authorizeUrl}?(기존 쿼리)&clientId&redirectUri&state */
export function authorizeRedirect(app: ChzzkApp, state: string): string {
  const u = new URL(app.authorizeUrl);
  u.searchParams.set("clientId", app.clientId);
  u.searchParams.set("redirectUri", app.redirectUri);
  u.searchParams.set("state", state);
  return u.toString();
}

export function tokenRequest(app: ChzzkApp, code: string, state: string): { url: string; init: RequestInit } {
  return {
    url: `${apiRoot(app)}/auth/v1/token`,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grantType: "authorization_code", clientId: app.clientId, clientSecret: app.clientSecret, code, state }),
    },
  };
}

export function userRequest(app: ChzzkApp, accessToken: string): { url: string; init: RequestInit } {
  return {
    url: `${apiRoot(app)}/open/v1/users/me`,
    init: {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    },
  };
}

type Json = Record<string, unknown>;

function jsonObject(body: string): Json | null {
  try {
    const v: unknown = JSON.parse(body);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
}

// json.content ?? json (객체가 아니면 null)
function unwrap(json: Json): Json | null {
  const c = json.content ?? json;
  return c !== null && typeof c === "object" && !Array.isArray(c) ? (c as Json) : null;
}

// 오류 code: 문자열·숫자만 String() 뒤 짧은 모양이면 싣는다(null·true·객체는 뺀다)
function shortCode(json: Json | null): string | undefined {
  const c = json?.code;
  if (typeof c !== "string" && typeof c !== "number") return undefined;
  const s = String(c);
  return CODE.test(s) ? s : undefined;
}

function failure(stage: "token" | "user", failCode: FailCode, status: number, json: Json | null): ChzzkFailure {
  const code = shortCode(json);
  return code === undefined ? { ok: false, failCode, stage, status, timedOut: false } : { ok: false, failCode, stage, status, code, timedOut: false };
}

const is2xx = (status: number): boolean => status >= 200 && status <= 299;

export function parseTokenResponse(status: number, body: string): { ok: true; accessToken: string } | ChzzkFailure {
  const json = jsonObject(body);
  if (json === null) return failure("token", "token", status, null);
  const token = unwrap(json)?.accessToken;
  // HTTP 200이어도 래퍼가 {code:401, content:null}이면 실패다
  if (!is2xx(status) || typeof token !== "string" || !ACCESS_TOKEN.test(token)) return failure("token", "token", status, json);
  return { ok: true, accessToken: token };
}

export function parseUserResponse(status: number, body: string): ChzzkIdentity | ChzzkFailure {
  const json = jsonObject(body);
  if (json === null) return failure("user", "user", status, null);
  if (!is2xx(status)) return failure("user", "user", status, json);
  const content = unwrap(json);
  const channelId = content?.channelId;
  // channelId만 본다(id 등 다른 필드로 폴백하지 않는다)
  if (typeof channelId !== "string" || !CHANNEL_ID.test(channelId)) return failure("user", "user_format", status, json);
  return { ok: true, channelId, channelName: sanitizeName(content?.channelName) };
}

/** 공격자 제어 표시 이름: 제어·bidi 문자를 지우고 코드 포인트 128자로 자른다(이스케이프는 HTML 템플릿이 한다) */
export function sanitizeName(v: unknown): string {
  if (typeof v !== "string") return "";
  return Array.from(v.replace(UNSAFE_CHARS, "")).slice(0, NAME_MAX).join("");
}

// workerd: 시간 제한은 요청·본문 읽기 모두 DOMException name "TimeoutError"(실측, 구현 중 변경 14 (가))
const isTimeout = (e: unknown): boolean => (e as { name?: unknown } | null)?.name === "TimeoutError";

type Fetched = { readonly ok: true; readonly status: number; readonly body: string } | ChzzkFailure;

async function call(deps: ChzzkDeps, stage: "token" | "user", req: { url: string; init: RequestInit }): Promise<Fetched> {
  const timeout = deps.timeout ?? ((ms: number) => AbortSignal.timeout(ms));
  try {
    // 신호 하나가 요청과 본문 읽기를 함께 덮는다
    const res = await deps.fetch(req.url, { ...req.init, signal: timeout(CHZZK_TIMEOUT_MS) });
    const body = await res.text();
    return { ok: true, status: res.status, body };
  } catch (e) {
    const timedOut = isTimeout(e);
    return { ok: false, failCode: timedOut ? "timeout" : stage, stage, status: 0, timedOut };
  }
}

/** 토큰 교환 → users/me. 토큰 실패면 users/me를 부르지 않는다 */
export async function identify(deps: ChzzkDeps, app: ChzzkApp, code: string, state: string): Promise<ChzzkIdentity | ChzzkFailure> {
  const t = await call(deps, "token", tokenRequest(app, code, state));
  if (!t.ok) return t;
  const token = parseTokenResponse(t.status, t.body);
  if (!token.ok) return token;
  const u = await call(deps, "user", userRequest(app, token.accessToken));
  if (!u.ok) return u;
  return parseUserResponse(u.status, u.body);
}
