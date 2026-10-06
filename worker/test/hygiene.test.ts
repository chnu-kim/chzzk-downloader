// 비밀값 위생(docs/design/worker.md §14, W4 수락 기준, 구현 중 변경 28): 전 흐름과 실패 경로를 한 번에 돌리고, 로그 줄과 모든 응답에 카나리가 없는지 본다.
// 카나리 = 비밀값(클라이언트 secret), 치지직이 준 code·토큰, state·handle·loginId·pollSecret·pollVerifier, 우리 토큰, 채널 ID·이름.
// 응답에 있어도 되는 자리는 표(allowed)로 좁힌다. 그 밖에 하나라도 나오면 실패한다.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "./fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "./network";
import { A1, B2 } from "./store/helpers";
import { advance, allowedChannel, AppClient, appFlow, Browser, store, useClock, viaEnv, type Send } from "./http/harness";

let fake: FakeChzzk;
let net: FakeNet;

beforeEach(async () => {
  useClock();
  fake = createFakeChzzk({ clientSecret: SECRET });
  net = installFakeChzzk(fake);
  await allowedChannel(B2, A1);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const SECRET = "hyg-" + crypto.randomUUID();
const SECRET2 = "hyg-" + crypto.randomUUID();
// 콜백 code_format 실패에 싣는 code 카나리: 보이는 ASCII지만 1024자를 넘어 형식 밖이다(인코딩 없이 URL에 그대로 실린다)
const BAD_CODE = "hygcode" + crypto.randomUUID() + "Z".repeat(1100);

// 로그 허용 필드(src/core/log.ts ALLOWED + event)
const LOG_KEYS = new Set(["event", "level", "route", "method", "status", "stage", "timedOut", "durationMs", "flowKind", "reason", "sessionIdPrefix", "chzzkCode", "key", "errorName"]);

type Kind = "secret" | "code" | "chzzkToken" | "pollSecret" | "pollVerifier" | "loginId" | "handle" | "state" | "flow" | "web" | "access" | "refresh" | "id" | "name";
type Label = { kind: Kind; account?: keyof typeof FAKE_ACCOUNTS };
type Entry = { method: string; path: string; status: number; location: string; text: string };

function allowed(e: Entry, l: Label): boolean {
  const p = e.path;
  const post = e.method === "POST";
  switch (l.kind) {
    case "loginId":
    case "handle":
      return post && p === "/auth/start" && e.status === 201;
    case "state":
    case "flow":
      return post && e.status === 303 && (p.startsWith("/auth/login/") || p === "/auth/web/start");
    case "web":
      return e.method === "GET" && p === "/auth/callback" && e.status === 303;
    case "access":
    case "refresh":
      return post && (p === "/auth/poll" || p === "/auth/refresh") && e.status === 200;
    case "id":
      if (l.account === "b2") return e.status === 200 && (p === "/auth/poll" || p === "/auth/refresh" || p === "/api/me");
      return l.account === "c3" && e.method === "GET" && p === "/auth/done";
    case "name":
      if (l.account === "b2") return e.status === 200 && (p === "/auth/poll" || p === "/auth/refresh" || p === "/api/me");
      return l.account === "c3" && (p === "/auth/poll" || p === "/auth/done");
    default:
      return false;
  }
}

it("전 흐름을 돌려도 로그와 응답에 카나리가 새지 않는다", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const entries: Entry[] = [];
  const requestTexts: string[] = [];
  const requestBodies: string[] = [];
  // Worker가 받은 요청과 돌려준 응답을 모두 기록한다(patch는 설정을 바꾼 기록기, 예: start 한도)
  const recorder = (patch: Record<string, unknown> = {}): Send => {
    const base = viaEnv({ CHZZK_CLIENT_SECRET: SECRET, ...patch });
    return async (u, i) => {
    const res = await base(u, i);
    const url = new URL(u);
    const headers = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n") + "\n" + res.headers.getSetCookie().join("\n");
    entries.push({
      method: String(i.method ?? "GET"),
      path: url.pathname,
      status: res.status,
      location: res.headers.get("Location") ?? "",
      text: `${res.status}\n${headers}\n${await res.clone().text()}`,
    });
    const body = typeof i.body === "string" ? i.body : "";
    requestTexts.push(`${u}\n${JSON.stringify(i.headers ?? {})}\n${body}`);
    requestBodies.push(body);
    return res;
    };
  };
  const send = recorder();
  const mk = () => ({ browser: new Browser(send), app: new AppClient(send) });
  const run = (over?: (f: FakeChzzk) => void) => {
    fake.state.account = "b2";
    fake.state.authorize = "approve";
    fake.state.tokenFail = null;
    fake.state.userFail = null;
    fake.state.userIdField = "channelId";
    over?.(fake);
    return appFlow({ fake, ...mk() });
  };

  // 1. 승인 → me → refresh → 복구 → 재사용 → logout
  const ok = await run();
  const app = new AppClient(send);
  expect((await app.me(ok.pollBody.accessToken)).status).toBe(200);
  advance(1000);
  const child: any = await (await app.refresh(ok.pollBody.refreshToken)).json();
  advance(30_000);
  expect((await app.refresh(ok.pollBody.refreshToken)).status).toBe(200);
  advance(61_000);
  expect((await app.refresh(ok.pollBody.refreshToken)).status).toBe(401);
  expect((await app.logout({ access: child.accessToken })).status).toBe(204);
  // 2. 거부(이스케이프할 이름), 3. 취소
  await run((f) => (f.state.account = "c3"));
  await run((f) => (f.state.authorize = "cancel"));
  // 4~6. 치지직 실패와 user_format
  for (const fail of [401, "html", "timeout"] as const) await run((f) => (f.state.tokenFail = fail));
  await run((f) => (f.state.userFail = 500));
  await run((f) => (f.state.userIdField = "id"));
  // 7. 다른 브라우저의 콜백
  fake.state.account = "b2";
  fake.state.authorize = "approve";
  fake.state.tokenFail = null;
  fake.state.userFail = null;
  fake.state.userIdField = "channelId";
  {
    const { browser: a, app: client } = mk();
    const { body } = await client.start();
    const cont = await a.post(new URL(body.loginUrl).pathname);
    const callbackUrl = await a.authorize(cont, fake);
    await new Browser(send).get(callbackUrl);
  }
  // 8. 같은 콜백 다시 열기
  const again = await run();
  await again.browser.get(again.callbackUrl);
  // 9~10. 웹 승인(a1)과 웹 거부(c3, done)
  for (const account of ["a1", "c3"] as const) {
    fake.state.account = account;
    const web = new Browser(send);
    const cb = await web.get(await web.authorize(await web.post("/auth/web/start"), fake));
    expect(cb.status).toBe(303);
    if (account === "c3") await web.get("/auth/done?r=denied");
  }
  // 12~. 실패 경로(§14 "모든 흐름·실패 경로"): 위의 흐름 행이 상한 32를 채우지 않게 먼저 10분을 넘긴다
  advance(11 * 60_000);
  {
    const { browser: b, app: client } = mk();
    // 콜백 code_format(카나리 code) → failed
    const s1 = await client.start();
    const cont1 = await b.post(new URL(s1.body.loginUrl).pathname);
    const st1 = new URL(cont1.headers.get("Location") ?? "").searchParams.get("state") ?? "";
    expect((await b.get(`/auth/callback?code=${BAD_CODE}&state=${st1}`)).headers.get("Location")).toBe("/auth/done?r=failed");
    expect(await (await client.poll(s1.body.loginId, s1.pollSecret)).json()).toEqual({ status: "failed", code: "token" });
    // [계속] 403(Origin 없음)·404(모르는 handle)·409(두 번째), 웹 start 403
    const s2 = await client.start();
    const path2 = new URL(s2.body.loginUrl).pathname;
    expect((await b.post(path2, { Origin: null })).status).toBe(403);
    expect((await b.post("/auth/login/" + "Q".repeat(22))).status).toBe(404);
    expect((await b.get("/auth/login/" + "Q".repeat(22))).status).toBe(404);
    expect((await b.post(path2)).status).toBe(303);
    expect((await b.post(path2)).status).toBe(409);
    expect((await b.get(path2)).status).toBe(409);
    expect((await b.post("/auth/web/start", { Origin: "http://evil.example.test" })).status).toBe(403);
    // start 400, start 429(한도 1)·웹 start 429
    const raw = (path: string, body: string) => send(`http://localhost:8787${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect((await raw("/auth/start", "{")).status).toBe(400);
    const limited = recorder({ START_RATE_10M: "1" });
    const ip = "203.0.113.99";
    expect((await new AppClient(limited).start(ip)).res.status).toBe(201);
    expect((await new AppClient(limited).start(ip)).res.status).toBe(429);
    expect((await new Browser(limited).post("/auth/web/start", { "CF-Connecting-IP": ip })).status).toBe(429);
    // poll 400·404·429
    expect((await raw("/auth/poll", "[]")).status).toBe(400);
    expect((await client.poll(s2.body.loginId, "B".repeat(43))).status).toBe(404);
    expect((await client.pollNow(s2.body.loginId, s2.pollSecret)).status).toBe(200);
    expect((await client.pollNow(s2.body.loginId, s2.pollSecret)).status).toBe(429);
    // 콜백 내부 예외(errorName만 로그에)
    const { AuthStore } = await import("../src/store/AuthStore");
    vi.spyOn(AuthStore.prototype, "finish").mockImplementationOnce(() => {
      throw new RangeError("boom " + SECRET);
    });
    const s3 = await client.start();
    const cb3 = await b.authorize(await b.post(new URL(s3.body.loginUrl).pathname), fake);
    expect((await b.get(cb3)).headers.get("Location")).toBe("/auth/done?r=failed");
    // 세션: me 401, refresh 400·401(invalid_token)·429(채널 회전 한도), 허용 제외 뒤 me·refresh 403, logout 401
    const login = await run();
    const a = new AppClient(send);
    expect((await a.me()).status).toBe(401);
    expect((await a.me("cda_" + "A".repeat(43))).status).toBe(401);
    expect((await raw("/auth/refresh", "{")).status).toBe(400);
    expect((await a.refresh("cdr_nope")).status).toBe(401);
    let rt: string = login.pollBody.refreshToken;
    let at: string = login.pollBody.accessToken;
    let last = 0;
    for (let i = 0; i < 12 && last !== 429; i++) {
      advance(1000);
      const r = await a.refresh(rt);
      last = r.status;
      if (r.status === 200) ({ refreshToken: rt, accessToken: at } = (await r.json()) as { refreshToken: string; accessToken: string });
    }
    expect(last).toBe(429);
    expect(await store().disallow(FAKE_ACCOUNTS.b2.channelId, A1, [A1], Date.now())).toEqual({ ok: true });
    expect((await a.me(at)).status).toBe(403);
    advance(11 * 60_000);
    expect((await a.refresh(rt)).status).toBe(403);
    expect((await a.logout({})).status).toBe(401);
  }
  // 11. 모르는 문자열 바인딩 → config_error: 이름만 로그에, 값은 없다
  const cfg = await viaEnv({ OTHER_SERVICE_SECRET: SECRET2 })("http://localhost:8787/health", { method: "GET" });
  expect(cfg.status).toBe(503);
  const cfgText = await cfg.text();

  // ---- 카나리 수집 ----
  const labels = new Map<string, Label>();
  const put = (v: string | undefined | null, l: Label) => {
    if (v) labels.set(v, l);
  };
  put(SECRET, { kind: "secret" });
  put(SECRET2, { kind: "secret" });
  for (const c of fake.state.issuedCodes) put(c, { kind: "code" });
  put(BAD_CODE, { kind: "code" });
  for (const t of fake.state.issuedTokens) put(t, { kind: "chzzkToken" });
  const all = [...requestTexts, ...entries.map((e) => e.text)].join("\n");
  const kinds: [RegExp, Kind][] = [
    [/cda_[A-Za-z0-9_-]{43}/g, "access"],
    [/cdr_[A-Za-z0-9_-]{43}/g, "refresh"],
    [/cdw_[A-Za-z0-9_-]{43}/g, "web"],
    [/cdf_[A-Za-z0-9_-]{43}/g, "flow"],
  ];
  for (const [re, kind] of kinds) for (const m of all.matchAll(re)) put(m[0], { kind });
  for (const e of entries) for (const m of e.location.matchAll(/state=([A-Za-z0-9_-]{43})/g)) put(m[1], { kind: "state" });
  for (const r of requestTexts) {
    for (const m of r.matchAll(/\/auth\/login\/([A-Za-z0-9_-]{22})/g)) put(m[1], { kind: "handle" });
  }
  for (const body of requestBodies) {
    if (!body.startsWith("{")) continue;
    let b: Record<string, unknown>;
    try {
      b = JSON.parse(body) as Record<string, unknown>;
    } catch {
      continue;
    }
    put(b.pollSecret as string, { kind: "pollSecret" });
    put(b.pollVerifier as string, { kind: "pollVerifier" });
    put(b.loginId as string, { kind: "loginId" });
  }
  for (const e of entries) {
    const m = /"loginId":"([A-Za-z0-9_-]{22})"/.exec(e.text);
    put(m?.[1], { kind: "loginId" });
  }
  for (const [account, a] of Object.entries(FAKE_ACCOUNTS)) {
    put(a.channelId, { kind: "id", account: account as keyof typeof FAKE_ACCOUNTS });
    put(a.channelName, { kind: "name", account: account as keyof typeof FAKE_ACCOUNTS });
  }
  // 수집이 비어 있으면 아래 단언이 아무것도 보지 않는다
  const seen = new Set([...labels.values()].map((l) => l.kind));
  for (const k of ["secret", "code", "chzzkToken", "pollSecret", "pollVerifier", "loginId", "handle", "state", "flow", "web", "access", "refresh", "id", "name"] as const) {
    expect([k, seen.has(k)]).toEqual([k, true]);
  }

  // (가) 로그: 모든 줄이 JSON이고 허용 필드만, 카나리 없음
  const lines = logSpy.mock.calls.map((c) => String(c[0]));
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    for (const k of Object.keys(parsed)) expect([line, LOG_KEYS.has(k)]).toEqual([line, true]);
    for (const [v, l] of labels) expect([l.kind, line.includes(v)]).toEqual([l.kind, false]);
  }
  const events = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  expect(events).toContainEqual({ event: "config.error", level: "error", key: "OTHER_SERVICE_SECRET" });
  // 실패 경로가 실제로 로그 줄을 남겼다(위 단언이 그 줄들도 본다)
  for (const want of [
    { event: "auth.login.failed", flowKind: "app", reason: "code_format" },
    // 콜백·확인 페이지는 quiet 경로라 결과 이벤트는 DO가 남긴다. 확인 페이지의 Origin 거절(auth.continue.rejected)은 버렸다(구현 중 변경 43)
    { event: "auth.login.failed", level: "error", flowKind: "app", reason: "internal", errorName: "RangeError" },
    { event: "auth.start.rejected", flowKind: "web", reason: "bad_origin" },
    { event: "auth.start.rejected", flowKind: "app", reason: "rate_limited" },
    { event: "auth.refresh.rejected", reason: "rate_limited" },
    { event: "auth.refresh.rejected", reason: "not_allowed" },
  ]) {
    expect(events).toContainEqual(expect.objectContaining(want));
  }

  // (나)(다) 응답: 표의 자리가 아니면 카나리가 없다(비밀값·code·치지직 토큰·pollSecret·pollVerifier는 어디에도 없다)
  for (const e of entries) {
    for (const [v, l] of labels) {
      if (!e.text.includes(v)) continue;
      expect([e.method, e.path, e.status, l.kind, allowed(e, l)]).toEqual([e.method, e.path, e.status, l.kind, true]);
    }
  }
  expect(cfgText).not.toContain(SECRET2);
  expect(JSON.parse(cfgText)).toEqual({ ok: false, code: "config_error" });

  // (라) 확인 페이지 본문에 handle이 없다
  const pages = entries.filter((e) => e.method === "GET" && e.path.startsWith("/auth/login/") && e.status === 200);
  expect(pages.length).toBeGreaterThan(0);
  for (const e of pages) for (const [v, l] of labels) if (l.kind === "handle") expect(e.text.includes(v)).toBe(false);
});

// CI 토큰(CI_VERIFY_TOKEN)은 어느 응답·로그에도 나오지 않는다(docs/design/worker.md §14, 구현 중 변경 31 (나)). 이 파일은 R2 seed가 없어 릴리스 읽기는 404가 정상이다.
it("CI 토큰은 로그·응답에 나오지 않는다", async () => {
  const CI_CANARY = "hyg-ci-" + crypto.randomUUID();
  const send = viaEnv({ CI_VERIFY_TOKEN: CI_CANARY });
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const texts: string[] = [];
  const statuses: number[] = [];
  const hit = async (path: string, headers: Record<string, string>) => {
    const res = await send(`http://localhost:8787${path}`, { method: "GET", headers });
    statuses.push(res.status);
    const lines = [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n") + "\n" + res.headers.getSetCookie().join("\n");
    texts.push(`${res.status}\n${lines}\n${await res.text()}`);
  };
  await hit("/releases/latest.json", bearer(CI_CANARY));
  await hit("/releases/latest.json", bearer(CI_CANARY + "x"));
  await hit("/releases/latest.json", {});
  await hit("/releases/0.2.0/x.dmg", bearer(CI_CANARY));
  await hit("/update/0.1.0", bearer(CI_CANARY));
  await hit("/update/0.1.0", bearer(CI_CANARY + "x"));
  await hit("/api/me", bearer(CI_CANARY));
  // 맞는 토큰이면 인증을 지나 R2 없음(404·204), 틀리면 401. /api/me는 CI 토큰을 모른다(401)
  expect(statuses).toEqual([404, 401, 401, 404, 204, 401, 401]);
  for (const t of texts) expect(t).not.toContain(CI_CANARY);
  const lines = logSpy.mock.calls.map((c) => String(c[0]));
  for (const line of lines) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    for (const k of Object.keys(parsed)) expect([line, LOG_KEYS.has(k)]).toEqual([line, true]);
    expect(line).not.toContain(CI_CANARY);
  }
  expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toContainEqual(expect.objectContaining({ event: "release.auth.rejected" }));
});
