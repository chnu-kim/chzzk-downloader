// W6 경로의 비밀값 위생(docs/design/worker.md §14, 구현 중 변경 35): 모든 W6 화면·동작(성공과 실패)을 한 번에 돌리고
// 로그 줄과 응답에 카나리가 없는지 본다. 카나리 = 폼 토큰(csrf)·세션 쿠키 토큰·세션 id 전체·채널 ID·가짜 계정 이름.
// 응답에 있어도 되는 자리: csrf는 GET /·GET /admin의 200 본문(폼 숨은 입력)뿐, 쿠키 토큰은 어디에도 없다.
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/core/token";
import { LATEST_VIEW_CACHE } from "../../src/http/landing";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, C3, D4, appLogin } from "../store/helpers";
import { Browser, csrfIn, formBody, resetStore, store, useClock, viaEnv, webLoginHttp } from "./harness";
import { seedDist } from "./release-fixture";

let fake: FakeChzzk;
let net: FakeNet;

beforeAll(async () => {
  await seedDist();
});

beforeEach(async () => {
  useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
  SUMS_CACHE.clear();
  LATEST_VIEW_CACHE.clear();
  await resetStore();
  await store().allow(B2, "", A1, Date.now());
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// 로그 허용 필드(src/core/log.ts ALLOWED + event). test/hygiene.test.ts와 같은 집합이다
const LOG_KEYS = new Set(["event", "level", "route", "method", "status", "stage", "timedOut", "durationMs", "flowKind", "reason", "sessionIdPrefix", "chzzkCode", "key", "errorName"]);
const E5 = "0".repeat(30) + "e5";

interface Seen {
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly location: string;
  readonly text: string;
  readonly headers: string;
}

it("W6 화면·동작을 모두 돌려도 로그와 응답에 카나리가 새지 않는다", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const seen: Seen[] = [];
  const note = async (method: string, path: string, res: Response): Promise<Response> => {
    seen.push({
      method,
      path,
      status: res.status,
      location: res.headers.get("Location") ?? "",
      text: await res.clone().text(),
      headers: [...res.headers].map(([k, v]) => `${k}: ${v}`).join("\n") + "\n" + res.headers.getSetCookie().join("\n"),
    });
    return res;
  };
  const get = (b: Browser, path: string) => b.get(path).then((r) => note("GET", path, r));
  const post = (b: Browser, path: string, body: string, headers?: Record<string, string | null>) => b.post(path, headers, body).then((r) => note("POST", path, r));

  // 준비: 관리자·b2 웹 세션, b2 앱 세션 둘, c3·d4 거부 기록
  const admin = (await webLoginHttp(fake, "a1")).browser;
  const member = (await webLoginHttp(fake, "b2")).browser;
  const leaving = (await webLoginHttp(fake, "b2")).browser;
  // 쿠키 토큰은 로그아웃이 항아리에서 지우기 전에 읽어 둔다
  const cookies = [admin, member, leaving].map((b) => b.jar.get("cdl_s") ?? "");
  expect(cookies.every((c) => c.startsWith("cdw_"))).toBe(true);
  const adminCsrf = csrfIn(await (await get(admin, "/")).text()) ?? "";
  const memberCsrf = csrfIn(await (await get(member, "/")).text()) ?? "";
  const leavingCsrf = csrfIn(await (await get(leaving, "/")).text()) ?? "";
  const appA = await appLogin(store(), { channelId: B2, name: FAKE_ACCOUNTS.b2.channelName, now: Date.now() });
  const appB = await appLogin(store(), { channelId: B2, name: FAKE_ACCOUNTS.b2.channelName, now: Date.now() });
  await webLoginHttp(fake, "c3");
  await webLoginHttp(fake, "d4");
  const idOf = async (access: string) => {
    const c = await store().check(await sha256Hex(access), ADMINS, Date.now());
    if (!c.ok) throw new Error("check");
    return c.sessionId;
  };
  const idA = await idOf(appA.bundle.accessToken);
  const idB = await idOf(appB.bundle.accessToken);

  // 화면
  await get(new Browser(), "/");
  await get(member, "/");
  await get(admin, "/admin");
  await get(new Browser(), "/admin");
  await get(member, "/admin");
  // 성공 동작 6종
  await post(admin, "/admin/allow", formBody({ csrf: adminCsrf, channelId: E5, note: "메모" }));
  await post(admin, "/admin/disallow", formBody({ csrf: adminCsrf, channelId: E5 }));
  await post(admin, `/admin/sessions/${idA}/revoke`, formBody({ csrf: adminCsrf }));
  await post(admin, `/admin/denied/${D4}/allow`, formBody({ csrf: adminCsrf }));
  await post(admin, `/admin/denied/${C3}/dismiss`, formBody({ csrf: adminCsrf }));
  await post(member, `/me/sessions/${idB}/revoke`, formBody({ csrf: memberCsrf }));
  // 실패: Origin·csrf·형식·본문·없음·관리자 채널·부트스트랩
  await post(admin, "/admin/allow", formBody({ csrf: adminCsrf, channelId: E5 }), { Origin: "http://evil.example.test" });
  await post(admin, "/admin/allow", formBody({ channelId: E5 }));
  await post(admin, "/admin/allow", formBody({ csrf: adminCsrf, channelId: E5 }), { "Content-Type": "text/plain" });
  await post(admin, "/admin/allow", "a".repeat(4097));
  await post(admin, "/admin/allow", formBody({ csrf: adminCsrf, channelId: "zz" }));
  await post(admin, `/admin/sessions/${idA}/revoke`, formBody({ csrf: adminCsrf }));
  await post(admin, "/admin/disallow", formBody({ csrf: adminCsrf, channelId: A1 }));
  await post(member, "/admin/allow", formBody({ csrf: memberCsrf, channelId: E5 }));
  await post(new Browser(viaEnv({ ADMIN_CHANNEL_IDS: "" })), "/admin/allow", formBody({ channelId: E5 }));
  // 로그아웃
  await post(leaving, "/auth/web/logout", formBody({ csrf: leavingCsrf }));

  const lines = logSpy.mock.calls.map((c) => String(c[0]));
  const sessionIds = await runInDurableObject(store(), (i) => i.db.all<{ id: string }>("SELECT id FROM session").map((r) => r.id));
  const canaries = [
    adminCsrf,
    memberCsrf,
    leavingCsrf,
    ...cookies,
    ...sessionIds,
    A1,
    B2,
    C3,
    D4,
    ...Object.values(FAKE_ACCOUNTS).map((a) => a.channelName),
  ];
  expect(sessionIds.length).toBeGreaterThanOrEqual(5);

  // 로그: 허용 필드만, 카나리 없음
  expect(lines.length).toBeGreaterThan(10);
  for (const line of lines) {
    for (const c of canaries) expect([line, line.includes(c)]).toEqual([line, false]);
    for (const k of Object.keys(JSON.parse(line) as Record<string, unknown>)) expect([line, LOG_KEYS.has(k)]).toEqual([line, true]);
  }

  // 응답: csrf는 GET /·GET /admin의 200 본문에만, 쿠키 토큰은 어디에도 없다
  const csrfs = [adminCsrf, memberCsrf, leavingCsrf];
  for (const r of seen) {
    const where = `${r.method} ${r.path} ${r.status}`;
    const page = r.method === "GET" && (r.path === "/" || r.path === "/admin") && r.status === 200;
    for (const c of csrfs) {
      expect([where, r.headers.includes(c)]).toEqual([where, false]);
      if (!page) expect([where, r.text.includes(c)]).toEqual([where, false]);
    }
    for (const c of cookies) {
      expect([where, r.text.includes(c), r.headers.includes(c)]).toEqual([where, false, false]);
    }
    // 리디렉션 위치는 쿼리 없는 두 곳뿐이고, 요청 주소에도 쿼리가 없다
    if (r.location !== "") expect(["/", "/admin"]).toContain(r.location);
    expect(r.path.includes("?")).toBe(false);
  }
  // 둘러본 범위: 화면 5 + 성공 6 + 실패 9 + 로그아웃 1 + 준비 중 GET / 3
  expect(seen.filter((r) => r.status === 303).length).toBeGreaterThanOrEqual(8);
  for (const status of [200, 303, 400, 403, 404, 409, 415]) expect([status, seen.some((r) => r.status === status)]).toEqual([status, true]);
});
