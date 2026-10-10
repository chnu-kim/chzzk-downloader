// W6 경로의 비밀값 위생(docs/design/worker.md §14, 구현 중 변경 38): 모든 W6 화면·동작(성공과 실패)을 한 번에 돌리고
// 로그 줄과 응답에 카나리가 없는지 본다. 카나리 = 폼 토큰(csrf)·세션 쿠키 토큰·세션 id 전체·채널 ID·가짜 계정 이름.
// 응답에 있어도 되는 자리: csrf는 GET /·GET /admin의 200 본문(폼 숨은 입력)뿐, 쿠키 토큰은 어디에도 없다.
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/core/token";
import { COPY } from "../../src/http/copy";
import { assetPath } from "../../src/http/assets";
import { LATEST_VIEW_CACHE } from "../../src/http/landing";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, C3, D4, appLogin } from "../store/helpers";
import { appFlow, Browser, csrfIn, formBody, resetStore, store, useClock, viaEnv, webLoginHttp } from "./harness";
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
  // 이미 끊긴 세션은 멱등 303, 형식 밖 id는 404
  await post(admin, `/admin/sessions/${idA}/revoke`, formBody({ csrf: adminCsrf }));
  await post(admin, "/admin/sessions/abc/revoke", formBody({ csrf: adminCsrf }));
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
    // csrf가 본문에 실리는 화면: GET /·GET /admin·허가 빼기 확인 페이지(200)와, 폼을 다시 그리는 POST /admin/allow의 400 오류 화면
    const page =
      (r.method === "GET" && (r.path === "/" || r.path === "/admin" || /^\/admin\/[0-9a-f]{32}\/disallow$/.test(r.path)) && r.status === 200) ||
      (r.method === "POST" && r.path === "/admin/allow" && r.status === 400);
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
  // 둘러본 범위: 화면 5 + 성공 6 + 실패 10 + 로그아웃 1 + 준비 중 GET / 3
  expect(seen.filter((r) => r.status === 303).length).toBeGreaterThanOrEqual(8);
  for (const status of [200, 303, 400, 403, 404, 409, 415]) expect([status, seen.some((r) => r.status === status)]).toEqual([status, true]);
});

describe("flash 알림(web.md §6.3): 303 뒤 GET 한 번만", () => {
  const FLASH_CLEAR = "cdl_flash=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax";
  const FLASH_SET = (kind: string) => `cdl_flash=${kind}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax`;
  const banner = (t: string) => t.includes("notice-banner");

  it("이미 처리됨: 303 + 쿠키(종류 코드뿐) → 첫 GET /에 배너와 쿠키 지우기, 두 번째 GET /엔 없다", async () => {
    const member = (await webLoginHttp(fake, "b2")).browser;
    // 로그인 직후 알림을 비우고 시작한다
    await member.get("/");
    const csrf = csrfIn(await (await member.get("/")).text()) ?? "";
    const gone = "Q".repeat(22);
    const res = await member.post(`/me/sessions/${gone}/revoke`, undefined, formBody({ csrf }));
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/"]);
    expect(res.headers.getSetCookie()).toEqual([FLASH_SET("alreadyDone")]);
    // 쿠키 값에 토큰·id가 없다: 종류 코드뿐
    expect(member.jar.get("cdl_flash")).toBe("alreadyDone");
    const first = await member.get("/");
    const t = await first.text();
    expect(banner(t)).toBe(true);
    expect(t).toContain(`<p>${COPY.alreadyDone}</p>`);
    expect(first.headers.getSetCookie()).toEqual([FLASH_CLEAR]);
    expect(member.jar.has("cdl_flash")).toBe(false);
    const second = await member.get("/");
    expect(banner(await second.text())).toBe(false);
    expect(second.headers.getSetCookie()).toEqual([]);
  });

  it("로그인 직후 첫 GET /에만 '로그인했어요' 배너", async () => {
    const { browser, callback } = await webLoginHttp(fake, "b2");
    expect(callback.headers.getSetCookie().filter((c) => c.startsWith("cdl_flash="))).toEqual([FLASH_SET("loggedIn")]);
    const t = await (await browser.get("/")).text();
    expect(banner(t)).toBe(true);
    expect(t).toContain(`<p>${COPY.doneOk.title}</p>`);
    expect(banner(await (await browser.get("/")).text())).toBe(false);
  });

  it("세션 없는 웹 POST: 303 / + 만료 알림(경고), 형식 밖 세션 쿠키는 함께 지운다. GET /admin의 세션 없음은 알림 없이 303 /", async () => {
    const b = new Browser();
    b.jar.set("cdl_s", "garbage");
    const res = await b.post("/auth/web/logout", undefined, formBody({ csrf: "C".repeat(43) }));
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/"]);
    expect(res.headers.getSetCookie()).toEqual(["cdl_s=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax", FLASH_SET("sessionGone")]);
    const t = await (await b.get("/")).text();
    expect(t).toContain(`<p>${COPY.sessionGone}</p>`);
    expect(t).toContain("tone-warning");
    expect(banner(await (await b.get("/")).text())).toBe(false);
    // GET은 알림 없이 홈으로(쿠키도 없다)
    const get = await new Browser().get("/admin");
    expect([get.status, get.headers.get("Location"), get.headers.getSetCookie()]).toEqual([303, "/", []]);
  });

  it("GET /admin도 알림을 한 번 그리고 지운다. 모르는 값은 그리지 않고 지운다", async () => {
    const admin = (await webLoginHttp(fake, "a1")).browser;
    admin.jar.set("cdl_flash", "alreadyDone");
    const first = await admin.get("/admin");
    expect(banner(await first.text())).toBe(true);
    expect(first.headers.getSetCookie()).toEqual([FLASH_CLEAR]);
    expect(banner(await (await admin.get("/admin")).text())).toBe(false);
    admin.jar.set("cdl_flash", "bogus");
    const bogus = await admin.get("/");
    expect(banner(await bogus.text())).toBe(false);
    expect(bogus.headers.getSetCookie()).toEqual([FLASH_CLEAR]);
  });
});

describe("골격: 색인·OG·/auth/*의 헤더", () => {
  it("랜딩만 색인되고 OG가 있다. 관리·결과·확인·오류는 noindex이고 og: 0개", async () => {
    const landing = await new Browser().get("/");
    expect(landing.headers.get("X-Robots-Tag")).toBeNull();
    const lt = await landing.text();
    expect(lt).toContain('<meta property="og:type" content="website">');
    expect(lt).toContain(`href="${assetPath("site.css")}"`);
    expect(lt).toContain('data-scale="reading"');
    const admin = (await webLoginHttp(fake, "a1")).browser;
    for (const [b, path] of [
      [admin, "/admin"],
      [new Browser(), "/auth/done?r=failed"],
      [new Browser(), "/auth/login/app-outdated-update-v2"],
      [new Browser(), "/auth/login/zz"],
    ] as const) {
      const res = await b.get(path);
      expect([path, res.headers.get("X-Robots-Tag")]).toEqual([path, "noindex"]);
      const t = await res.text();
      expect([path, t.includes("og:")]).toEqual([path, false]);
      // 읽기 척도는 랜딩(과 읽기 페이지)뿐이다
      expect([path, t.includes("data-scale")]).toEqual([path, false]);
    }
  });

  it("/auth/* 화면(결과 넷·옛 앱·만료·확인)에는 헤더에 로그인 링크가 없다", async () => {
    const app = await appFlow({ fake, redeem: false });
    const pages = [
      ...["ok", "denied", "cancelled", "failed"].map((r) => `/auth/done?r=${r}`),
      "/auth/login/app-outdated-update-v2",
      "/auth/login/zz",
    ];
    for (const path of pages) {
      const t = await (await new Browser().get(path)).text();
      expect([path, t.includes("/#start")]).toEqual([path, false]);
      expect([path, t.includes('href="/help"')]).toEqual([path, true]);
    }
    expect(app.loginHtml.includes("/#start")).toBe(false);
    // 비로그인 랜딩의 헤더에는 있다
    expect((await (await new Browser().get("/")).text()).includes('href="/#start"')).toBe(true);
  });
});

describe("웹 POST 거절 페이지(web.md §6.2)", () => {
  const mainLinks = (t: string) => (/<main [^>]*>([\s\S]*)<\/main>/.exec(t)?.[1] ?? "").match(/<a /g)?.length ?? 0;

  it("관리 POST의 Origin 불일치: 오류 접두 제목, 원래 화면(/admin) 새로 열기 링크 하나, noindex", async () => {
    const admin = (await webLoginHttp(fake, "a1")).browser;
    const csrf = csrfIn(await (await admin.get("/admin")).text()) ?? "";
    const res = await admin.post("/admin/allow", { Origin: "http://evil.example.test" }, formBody({ csrf, channelId: E5 }));
    expect(res.status).toBe(403);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const t = await res.text();
    expect(t).toContain(`<title>${COPY.errorTitlePrefix}${COPY.badRequest.title} · ${COPY.siteName}</title>`);
    expect(t).toContain(`<a href="/admin">${COPY.reloadAdmin}</a>`);
    expect(mainLinks(t)).toBe(1);
  });

  it("세션이 있는 사람의 csrf 거절: 헤더에 채널 이름, 로그인 링크 없음", async () => {
    const member = (await webLoginHttp(fake, "b2")).browser;
    const res = await member.post("/auth/web/logout", undefined, formBody({ csrf: "X".repeat(43) }));
    expect(res.status).toBe(403);
    const t = await res.text();
    expect(t).toContain(`<span class="site-user">${FAKE_ACCOUNTS.b2.channelName}</span>`);
    expect(t).not.toContain("/#start");
    expect(mainLinks(t)).toBe(1);
  });
});
