// core/chzzk(docs/design/worker.md §7.3, 구현 중 변경 14 (나)): 요청 모양·응답 해석·실패 표·카나리. 가짜 fetch(소켓 없음).
import { describe, expect, it } from "vitest";
import {
  authorizeRedirect,
  CHZZK_TIMEOUT_MS,
  type ChzzkApp,
  type ChzzkDeps,
  type FetchLike,
  identify,
  parseTokenResponse,
  parseUserResponse,
  sanitizeName,
  tokenRequest,
  userRequest,
} from "../../src/core/chzzk";

// 카나리: 결과(JSON.stringify)에 나오면 안 되는 값
const CODE = "code-canary-7f3";
const STATE = "state-canary-9k2";
const CLIENT_SECRET = "client-secret-canary-x1";
const ACCESS = "access-canary-q8";
const MESSAGE = "message-canary-z5";
const CANARIES = [CODE, STATE, CLIENT_SECRET, ACCESS, MESSAGE];

const CH = "0".repeat(30) + "b2";
const CALLBACK = "http://localhost:8787/auth/callback";
const APP: ChzzkApp = {
  authorizeUrl: "http://127.0.0.1:8788/account-interlock",
  apiBase: "http://127.0.0.1:8788",
  clientId: "dev-client-id",
  clientSecret: CLIENT_SECRET,
  redirectUri: CALLBACK,
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const text = (status: number, body: string) => new Response(body, { status, headers: { "Content-Type": "text/html" } });
const tokenOk = () =>
  json(200, { code: 200, message: null, content: { accessToken: ACCESS, refreshToken: "r", tokenType: "Bearer", expiresIn: "86400" } });
const userOk = () => json(200, { code: 200, message: null, content: { channelId: CH, channelName: "이름" } });

type Step = Response | Error | (() => Response);
interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

// 순서대로 응답하는 가짜 fetch. 단계가 모자라면 테스트 실패
function fake(...steps: Step[]): { deps: ChzzkDeps; calls: Call[]; timeouts: number[] } {
  const calls: Call[] = [];
  const timeouts: number[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const s = steps.shift();
    if (s === undefined) throw new Error("예상하지 못한 호출");
    if (s instanceof Error) throw s;
    return typeof s === "function" ? s() : s;
  };
  return {
    deps: {
      fetch: f,
      timeout: (ms) => {
        timeouts.push(ms);
        return new AbortController().signal;
      },
    },
    calls,
    timeouts,
  };
}

const timeoutError = () => new DOMException("x", "TimeoutError");
const noCanary = (v: unknown) => {
  const s = JSON.stringify(v);
  for (const c of CANARIES) expect(s).not.toContain(c);
};

describe("요청 모양", () => {
  it("authorize: clientId·redirectUri·state 순서, redirectUri는 바이트가 같다", () => {
    const u = new URL(authorizeRedirect(APP, STATE));
    expect(u.origin + u.pathname).toBe("http://127.0.0.1:8788/account-interlock");
    expect([...u.searchParams.keys()]).toEqual(["clientId", "redirectUri", "state"]);
    expect(u.searchParams.get("redirectUri")).toBe(CALLBACK);
    expect(u.searchParams.get("state")).toBe(STATE);
    expect(u.searchParams.get("clientId")).toBe("dev-client-id");
  });

  it("authorize: 기존 쿼리를 보존한다", () => {
    const u = new URL(authorizeRedirect({ ...APP, authorizeUrl: "https://auth.example.test/interlock?lang=ko" }, STATE));
    expect([...u.searchParams.keys()]).toEqual(["lang", "clientId", "redirectUri", "state"]);
    expect(u.searchParams.get("lang")).toBe("ko");
  });

  it("token: POST JSON, 키 순서 고정, apiBase 끝 슬래시 정리", async () => {
    const r = tokenRequest({ ...APP, apiBase: "http://127.0.0.1:8788//" }, CODE, STATE);
    expect(r.url).toBe("http://127.0.0.1:8788/auth/v1/token");
    expect(r.init.method).toBe("POST");
    expect(new Headers(r.init.headers).get("Content-Type")).toBe("application/json");
    expect(r.init.body).toBe(`{"grantType":"authorization_code","clientId":"dev-client-id","clientSecret":"${CLIENT_SECRET}","code":"${CODE}","state":"${STATE}"}`);
  });

  it("users/me: GET, Bearer·Content-Type", () => {
    const r = userRequest({ ...APP, apiBase: "http://127.0.0.1:8788/" }, ACCESS);
    expect(r.url).toBe("http://127.0.0.1:8788/open/v1/users/me");
    expect(r.init.method).toBe("GET");
    const h = new Headers(r.init.headers);
    expect(h.get("Authorization")).toBe(`Bearer ${ACCESS}`);
    expect(h.get("Content-Type")).toBe("application/json");
    expect(r.init.body).toBeUndefined();
  });

  it("identify: 두 호출 모두 신호가 있고 시간 제한 10초를 호출마다 새로 만든다", async () => {
    const f = fake(tokenOk(), userOk());
    await identify(f.deps, APP, CODE, STATE);
    expect(f.calls.map((c) => c.url)).toEqual(["http://127.0.0.1:8788/auth/v1/token", "http://127.0.0.1:8788/open/v1/users/me"]);
    expect(f.calls.every((c) => c.init.signal instanceof AbortSignal)).toBe(true);
    expect(f.timeouts).toEqual([CHZZK_TIMEOUT_MS, CHZZK_TIMEOUT_MS]);
    expect(CHZZK_TIMEOUT_MS).toBe(10_000);
    expect(new Headers(f.calls[1]?.init.headers).get("Authorization")).toBe(`Bearer ${ACCESS}`);
  });

  it("identify: timeout을 주입하지 않으면 AbortSignal.timeout", async () => {
    const calls: RequestInit[] = [];
    const deps: ChzzkDeps = {
      fetch: async (_u, init) => {
        calls.push(init);
        return calls.length === 1 ? tokenOk() : userOk();
      },
    };
    expect(await identify(deps, APP, CODE, STATE)).toEqual({ ok: true, channelId: CH, channelName: "이름" });
    expect(calls.every((c) => c.signal instanceof AbortSignal && !c.signal.aborted)).toBe(true);
  });
});

describe("성공", () => {
  it.each([
    ["래퍼 있음, expiresIn 문자열", json(200, { code: 200, content: { accessToken: ACCESS, expiresIn: "86400" } }), userOk()],
    ["래퍼 있음, expiresIn 숫자", json(200, { code: 200, content: { accessToken: ACCESS, expiresIn: 86400 } }), userOk()],
    ["래퍼 없음", json(200, { accessToken: ACCESS, expiresIn: 86400 }), json(200, { channelId: CH, channelName: "이름" })],
  ])("%s", async (_name, tok, user) => {
    const r = await identify(fake(tok.clone(), user.clone()).deps, APP, CODE, STATE);
    expect(r).toEqual({ ok: true, channelId: CH, channelName: "이름" });
    noCanary(r);
  });

  it("channelName이 없거나 문자열이 아니면 빈 값", () => {
    expect(parseUserResponse(200, JSON.stringify({ content: { channelId: CH } }))).toEqual({ ok: true, channelId: CH, channelName: "" });
    expect(parseUserResponse(200, JSON.stringify({ content: { channelId: CH, channelName: 5 } }))).toEqual({ ok: true, channelId: CH, channelName: "" });
  });
});

describe("토큰 실패(users/me를 부르지 않는다)", () => {
  it.each([
    ["401 INVALID_CLIENT", json(401, { code: "INVALID_CLIENT", message: MESSAGE }), { failCode: "token", status: 401, code: "INVALID_CLIENT", timedOut: false }],
    ["429", json(429, { code: 429, message: MESSAGE }), { failCode: "token", status: 429, code: "429", timedOut: false }],
    ["500 숫자 code", json(500, { code: 500, message: MESSAGE, content: null }), { failCode: "token", status: 500, code: "500", timedOut: false }],
    ["HTML 200(프록시)", text(200, `<html>${MESSAGE}</html>`), { failCode: "token", status: 200, timedOut: false }],
    ["HTML 502", text(502, `<html>${MESSAGE}</html>`), { failCode: "token", status: 502, timedOut: false }],
    ["빈 accessToken", json(200, { code: 200, content: { accessToken: "" } }), { failCode: "token", status: 200, code: "200", timedOut: false }],
    ["content null(200 래퍼에 401)", json(200, { code: 401, message: MESSAGE, content: null }), { failCode: "token", status: 200, code: "401", timedOut: false }],
    ["accessToken이 숫자", json(200, { content: { accessToken: 12345 } }), { failCode: "token", status: 200, timedOut: false }],
    ["accessToken에 공백(헤더 주입 모양)", json(200, { content: { accessToken: `${ACCESS}\r\nX: y` } }), { failCode: "token", status: 200, timedOut: false }],
    ["JSON 배열", json(200, [ACCESS]), { failCode: "token", status: 200, timedOut: false }],
    ["시간 초과", timeoutError(), { failCode: "timeout", status: 0, timedOut: true }],
    ["연결 오류", new Error(`Network connection lost. ${MESSAGE}`), { failCode: "token", status: 0, timedOut: false }],
    ["본문 읽기 시간 초과", () => ({ status: 200, text: async () => Promise.reject(timeoutError()) }) as unknown as Response, { failCode: "timeout", status: 0, timedOut: true }],
  ] as const)("%s", async (_name, step, want) => {
    const f = fake(step as Step);
    const r = await identify(f.deps, APP, CODE, STATE);
    expect(r).toEqual({ ok: false, stage: "token", ...want });
    expect(f.calls).toHaveLength(1);
    noCanary(r);
  });
});

describe("사용자 실패", () => {
  it.each([
    ["401", json(401, { code: "UNAUTHORIZED", message: MESSAGE }), { failCode: "user", status: 401, code: "UNAUTHORIZED", timedOut: false }],
    ["HTML 200", text(200, `<html>${MESSAGE}</html>`), { failCode: "user", status: 200, timedOut: false }],
    ["시간 초과", timeoutError(), { failCode: "timeout", status: 0, timedOut: true }],
    ["연결 오류", new TypeError(MESSAGE), { failCode: "user", status: 0, timedOut: false }],
    ["id 필드만", json(200, { content: { id: CH, channelName: "x" } }), { failCode: "user_format", status: 200, timedOut: false }],
    ["대문자 hex", json(200, { content: { channelId: "0".repeat(30) + "A1" } }), { failCode: "user_format", status: 200, timedOut: false }],
    ["31자", json(200, { content: { channelId: "0".repeat(29) + "a1" } }), { failCode: "user_format", status: 200, timedOut: false }],
    ["33자", json(200, { content: { channelId: "0".repeat(31) + "a1" } }), { failCode: "user_format", status: 200, timedOut: false }],
    ["숫자 channelId", json(200, { content: { channelId: 1 } }), { failCode: "user_format", status: 200, timedOut: false }],
    ["content null", json(200, { code: 401, content: null }), { failCode: "user_format", status: 200, code: "401", timedOut: false }],
  ] as const)("%s", async (_name, step, want) => {
    const f = fake(tokenOk(), step as Step);
    const r = await identify(f.deps, APP, CODE, STATE);
    expect(r).toEqual({ ok: false, stage: "user", ...want });
    expect(f.calls).toHaveLength(2);
    noCanary(r);
  });
});

describe("오류 code 규칙", () => {
  it.each([
    ["51자", "x".repeat(51), undefined],
    ["50자", "x".repeat(50), "x".repeat(50)],
    ["공백", "BAD CODE", undefined],
    ["객체", { a: 1 }, undefined],
    ["배열", ["A"], undefined],
    ["null", null, undefined],
    ["true", true, undefined],
    ["점·하이픈", "auth.invalid-client", "auth.invalid-client"],
    ["빈 문자열", "", undefined],
    ["음수(하이픈 허용)", -1, "-1"],
    ["소수", 1.5, "1.5"],
  ])("%s", (_name, code, want) => {
    const r = parseTokenResponse(400, JSON.stringify({ code }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(want);
    if (!r.ok && want === undefined) expect("code" in r).toBe(false);
  });
});

describe("sanitizeName", () => {
  it.each([
    [`<script>alert(1)</script>"'&`, `<script>alert(1)</script>"'&`],
    ["a\u0000b\u001fc\u007fd\u0085e", "abcde"],
    ["a\nb\tc", "abc"],
    ["\u202Eevil\u202C\u2066x\u2069\u200E\u200F", "evilx"],
    ["a\u202Ab\u202Bc\u202Dd\u2067e\u2068f\u061Cg", "abcdefg"],
    ["관리자\u200B", "관리자"],
    ["관\u00ADe\u200Cf\u2060g\u2063h\uFEFF", "관efgh"],
    ["👨\u200D👩\u200D👧", "👨\u200D👩\u200D👧"],
    ["이름 그대로", "이름 그대로"],
  ])("%j → %j", (v, want) => {
    expect(sanitizeName(v)).toBe(want);
  });
  it("코드 포인트 128자로 자르고 서로게이트를 쪼개지 않는다", () => {
    const emoji = "😀".repeat(200);
    const out = sanitizeName(emoji);
    expect(Array.from(out)).toHaveLength(128);
    expect(out).toBe("😀".repeat(128));
    expect(sanitizeName("a".repeat(127) + "😀😀")).toBe("a".repeat(127) + "😀");
  });
  it("제어 문자를 지운 뒤 자른다", () => {
    expect(sanitizeName("\u0000".repeat(10) + "a".repeat(130))).toBe("a".repeat(128));
  });
  it.each([undefined, null, 1, {}, ["x"]])("문자열이 아니면 빈 값: %j", (v) => {
    expect(sanitizeName(v)).toBe("");
  });
});
