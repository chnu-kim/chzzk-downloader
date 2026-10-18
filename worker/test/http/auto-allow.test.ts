// 허용목록 자동 허가의 HTTP 층(docs/design/features/allowlist-open.md §4.4·§6.2): POST /admin/auto-allow, 관리 화면의 절·표·꼬리표,
// 차단 확인 페이지, /auth/redeem의 reason, 완료 페이지의 이유별 문구, 랜딩·처리방침·도움말 문구.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY } from "../../src/http/copy";
import { LATEST_VIEW_CACHE } from "../../src/http/landing";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, C3, D4 } from "../store/helpers";
import { allowedChannel, appFlow, Browser, csrfIn, formBody, h1Of, resetStore, store, useClock, webLoginHttp } from "./harness";
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
  // resetStore는 자동 허가를 끈다(상한 0). 이 파일은 필요한 테스트가 직접 연다
  await resetStore();
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const E5 = FAKE_ACCOUNTS.e5.channelId;
const FLASH = "cdl_flash=autoAllowSaved; Max-Age=60; Path=/; HttpOnly; SameSite=Lax";
const openAuto = (cap = 20) => store().setAutoAllowCap(cap, A1, Date.now());

interface Sess {
  readonly b: Browser;
  readonly csrf: string;
}
async function session(account: "a1" | "b2" | "d4"): Promise<Sess> {
  const { browser: b, callback } = await webLoginHttp(fake, account);
  expect(callback.status).toBe(303);
  const csrf = csrfIn(await (await b.get("/")).text());
  expect(csrf).not.toBeNull();
  return { b, csrf: csrf ?? "" };
}
const post = (s: Sess, path: string, fields: Record<string, string> = {}, headers?: Record<string, string | null>) => s.b.post(path, headers, formBody({ csrf: s.csrf, ...fields }));

describe("POST /admin/auto-allow", () => {
  it("저장: 303 /admin + flash, 화면에 새 상한과 바꾼 관리자·시각이 보인다, 감사 행은 늘지 않는다", async () => {
    await allowedChannel(A1, A1);
    const admin = await session("a1");
    const auditBefore = (await store().adminView(Date.now())).audit.length;
    const res = await post(admin, "/admin/auto-allow", { cap: "7" });
    expect([res.status, res.headers.get("Location"), res.headers.getSetCookie()]).toEqual([303, "/admin", [FLASH]]);
    const t = await (await admin.b.get("/admin")).text();
    expect(t).toContain(COPY.autoAllowSaved);
    expect(t).toContain(`<p>${COPY.autoToday(0, 7)}</p>`);
    expect(t).toContain('id="auto-allow-cap"');
    expect(t).toContain('value="7"');
    expect(t).toContain('min="0" max="100"');
    expect(t).toContain(COPY.autoCapBy(A1, "").split(" · ")[0]!);
    expect((await store().adminView(Date.now())).audit.length).toBe(auditBefore);
  });

  it.each(["", "101", "-1", "1.5", "abc", " 5", "05", "1000", "٥"])("형식·범위 밖 %j: 400 + 오류 요약 + 입력값 채움, 저장 안 됨", async (cap) => {
    await openAuto(9);
    await allowedChannel(A1, A1);
    const admin = await session("a1");
    const res = await post(admin, "/admin/auto-allow", { cap });
    expect(res.status).toBe(400);
    const t = await res.text();
    expect(t).toContain(COPY.badCap(100));
    expect(t).toContain('href="#auto-allow-cap"');
    expect(t).toContain('aria-invalid="true"');
    expect((await store().adminView(Date.now())).autoAllow.cap).toBe(9);
  });

  it("같은 이름이 둘이면 400 bad_body, 비관리자는 403, 틀린 csrf는 403이고 아무것도 바뀌지 않는다", async () => {
    await openAuto(9);
    await allowedChannel(A1, A1);
    await allowedChannel(B2, A1);
    const admin = await session("a1");
    const dup = await admin.b.post("/admin/auto-allow", undefined, `csrf=${admin.csrf}&cap=1&cap=2`);
    expect(dup.status).toBe(400);
    const member = await session("b2");
    expect((await post(member, "/admin/auto-allow", { cap: "1" })).status).toBe(403);
    expect((await post(admin, "/admin/auto-allow", { cap: "1" }, {})).status).toBe(303);
    await openAuto(9);
    const bad = await admin.b.post("/admin/auto-allow", undefined, formBody({ csrf: "A".repeat(43), cap: "1" }));
    expect(bad.status).toBe(403);
    const noOrigin = await post(admin, "/admin/auto-allow", { cap: "1" }, { Origin: null });
    expect(noOrigin.status).toBe(403);
    const text = await post(admin, "/admin/auto-allow", { cap: "1" }, { "Content-Type": "text/plain" });
    expect(text.status).toBe(415);
    expect((await store().adminView(Date.now())).autoAllow.cap).toBe(9);
  });

  it("세션이 없으면 303 /, 부트스트랩이면 403", async () => {
    const none = await new Browser().post("/admin/auto-allow", undefined, formBody({ csrf: "A".repeat(43), cap: "1" }));
    expect([none.status, none.headers.get("Location")]).toEqual([303, "/"]);
  });
});

describe("관리 화면", () => {
  it("절 일곱과 오늘 센 수, 자동 허가 행의 표시, 차단 표와 꼬리표", async () => {
    await openAuto(20);
    await allowedChannel(A1, A1);
    const admin = await session("a1");
    // d4가 웹으로 로그인하면 자동 허가된다
    const d4 = await webLoginHttp(fake, "d4");
    expect(d4.callback.headers.get("Location")).toBe("/");
    let t = await (await admin.b.get("/admin")).text();
    for (const h of ["관리자", "자동 허가", "허가한 채널", "거부된 시도", "차단한 채널", "활성 로그인", "감사 기록"]) expect(t).toContain(`<h2>${h}</h2>`);
    expect(t).toContain(`<p>${COPY.autoToday(1, 20)}</p>`);
    expect(t).toContain(`${COPY.colAddedBy} ${COPY.autoTitle}`);
    expect(t).toContain(`href="/admin/${D4}/disallow"`);
    expect(t).toContain(COPY.blockedEmpty);
    // 차단: 확인 페이지 → POST → 차단한 채널 표로 간다
    const confirm = await admin.b.get(`/admin/${D4}/disallow`);
    expect(confirm.status).toBe(200);
    expect((await post(admin, "/admin/disallow", { channelId: D4 })).status).toBe(303);
    t = await (await admin.b.get("/admin")).text();
    expect(t).toContain('id="tbl-blocked"');
    expect(t).toContain(`action="/admin/allow"`);
    expect(t).not.toContain(`href="/admin/${D4}/disallow"`);
    // 차단된 채널이 다시 로그인하면 거부 기록에 "차단함" 꼬리표가 붙는다
    const again = await webLoginHttp(fake, "d4");
    expect(again.callback.headers.get("Location")).toBe("/auth/done?r=denied");
    t = await (await admin.b.get("/admin")).text();
    expect(t).toContain(`<span class="meta">${COPY.blockedTag}</span>`);
    // [허가]로 풀면 차단 행이 사라진다
    expect((await post(admin, "/admin/allow", { channelId: D4 })).status).toBe(303);
    expect((await store().adminView(Date.now())).blocked).toEqual([]);
  });

  it("허가·차단 표가 최근 200행을 넘으면 '전체 n개 중 최근 200개'를 적는다", async () => {
    await allowedChannel(A1, A1);
    const admin = await session("a1");
    const { runInDurableObject } = await import("cloudflare:test");
    await runInDurableObject(store(), (i) => {
      for (let n = 1; n <= 201; n++) {
        i.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, ?, NULL, NULL, 'auto', ?)", "a".repeat(24) + n.toString(16).padStart(8, "0"), `채널${n}`, n);
      }
    });
    const t = await (await admin.b.get("/admin")).text();
    expect(t).toContain(COPY.listTotal(202, 200));
    expect(t).toContain(`${COPY.colAddedBy} ${COPY.autoTitle}`);
  });
});

describe("차단 확인 페이지", () => {
  it("허가·차단 어디에도 없는 채널도 200(미리 막는다), 이미 차단되고 허가가 없으면 303 alreadyDone, 이름은 거부 기록에서 온다", async () => {
    await allowedChannel(A1, A1);
    const admin = await session("a1");
    const first = await webLoginHttp(fake, "d4");
    expect(first.callback.headers.get("Location")).toBe("/auth/done?r=denied");
    const page = await admin.b.get(`/admin/${D4}/disallow`);
    expect(page.status).toBe(200);
    const t = await page.text();
    expect(h1Of(t)).toBe(COPY.confirmDisallow.title);
    expect(t).toContain(COPY.confirmDisallow.body("합성기타D4", 0));
    const cleared = await store().disallowTarget(D4, Date.now());
    expect(cleared).toMatchObject({ allowed: false, blocked: false });
    expect((await post(admin, "/admin/disallow", { channelId: D4 })).status).toBe(303);
    const again = await admin.b.get(`/admin/${D4}/disallow`);
    expect([again.status, again.headers.get("Location")]).toEqual([303, "/admin"]);
    expect(h1Of(await (await admin.b.get("/admin")).text())).toBe(COPY.adminLink);
  });

  it("관리 화면 200행 밖의 오래된 허가 행도 확인 페이지가 찾는다(adminView에 기대지 않는다)", async () => {
    await allowedChannel(A1, A1);
    const admin = await session("a1");
    const { runInDurableObject } = await import("cloudflare:test");
    const old = "0".repeat(30) + "99";
    await runInDurableObject(store(), (i) => {
      i.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, '아주 오래된 채널', NULL, NULL, 'auto', 1)", old);
      for (let n = 1; n <= 205; n++) {
        i.db.run("INSERT INTO allowlist (channel_id, channel_name, owner_channel_id, note, added_by, added_at) VALUES (?, ?, NULL, NULL, 'auto', ?)", "b".repeat(24) + n.toString(16).padStart(8, "0"), `채널${n}`, 1000 + n);
      }
    });
    const t = await (await admin.b.get(`/admin/${old}/disallow`)).text();
    expect(t).toContain("아주 오래된 채널");
  });
});

describe("앱 흐름과 완료 페이지의 거부 이유", () => {
  it("상한 0: redeem은 reason 없이 denied(키 자체가 없다), 완료 페이지는 지금 문구", async () => {
    fake.state.account = "d4";
    const f = await appFlow({ fake });
    expect(f.redeemBody).toEqual({ status: "denied", channelName: FAKE_ACCOUNTS.d4.channelName });
    const web = await webLoginHttp(fake, "d4");
    const done = await (await web.browser.get("/auth/done?r=denied")).text();
    expect(h1Of(done)).toBe(COPY.doneDenied.title);
    expect(done).toContain(COPY.doneDenied.next);
  });

  it("상한에 걸리면 daily_limit, 차단되면 blocked(앱 redeem·웹 완료 페이지)", async () => {
    await openAuto(1);
    fake.state.account = "d4";
    expect((await appFlow({ fake })).redeemBody.status).toBe("ok");
    // 둘째 새 채널은 오늘 자리가 없다
    fake.state.account = "e5";
    const f = await appFlow({ fake });
    expect(f.redeemBody).toEqual({ status: "denied", channelName: FAKE_ACCOUNTS.e5.channelName, reason: "daily_limit" });
    const web = await webLoginHttp(fake, "e5");
    expect(web.callback.headers.get("Location")).toBe("/auth/done?r=denied");
    const done = await (await web.browser.get("/auth/done?r=denied")).text();
    expect(h1Of(done)).toBe(COPY.doneDenied.dailyLimit.title);
    expect(done).toContain(COPY.doneDenied.dailyLimit.body);
    expect(done).not.toContain(COPY.doneDenied.next);
    // 차단된 채널
    await store().disallow(E5, A1, ADMINS, Date.now());
    const g = await appFlow({ fake });
    expect(g.redeemBody).toEqual({ status: "denied", channelName: FAKE_ACCOUNTS.e5.channelName, reason: "blocked" });
    const web2 = await webLoginHttp(fake, "e5");
    const done2 = await (await web2.browser.get("/auth/done?r=denied")).text();
    expect(h1Of(done2)).toBe(COPY.doneDenied.blocked.title);
    expect(done2).toContain(COPY.doneDenied.blocked.body);
  });

  it("로그: 거부 이유와 자동 허가는 reason 값만 싣고 채널 값은 싣지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await openAuto(1);
    fake.state.account = "d4";
    await appFlow({ fake });
    fake.state.account = "e5";
    await appFlow({ fake });
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(events).toContainEqual({ event: "auth.login.ok", level: "info", flowKind: "app", reason: "auto_allowed" });
    expect(events).toContainEqual({ event: "auth.login.denied", level: "info", flowKind: "app", reason: "daily_limit" });
    const all = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).not.toContain(FAKE_ACCOUNTS.d4.channelId);
    expect(all).not.toContain(FAKE_ACCOUNTS.e5.channelId);
    expect(all).not.toContain(FAKE_ACCOUNTS.d4.channelName);
  });
});

describe("문구", () => {
  it("랜딩 anonLead·로그인 절, 처리방침, 도움말 login-denied", async () => {
    const land = await (await new Browser().get("/")).text();
    expect(land).toContain(COPY.anonLead);
    expect(land).not.toContain("허가받은 채널만 쓸 수 있어요");
    expect(land).toContain("로그인할 수 없으면 이유와 다음에 할 일을 앱이 알려 줘요.");
    const help = await (await new Browser().get("/help")).text();
    expect(help).toContain('id="login-denied"');
    expect(help).toContain("로그인이 거부될 때");
  });
});
