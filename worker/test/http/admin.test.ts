// 관리 화면·웹 POST 가드(docs/design/worker.md §4.4·§8.1, 구현 중 변경 38 (나), W6 수락 기준): CSRF 9조합 × 3경로, 415, 검사 순서,
// 관리자 판정, [허용] 즉시 로그인, [빼기]·[끊기] 지연 0.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { newId, newSecret, sha256Hex } from "../../src/core/token";
import { LATEST_VIEW_CACHE } from "../../src/http/landing";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, C3, D4 } from "../store/helpers";
import { allowedChannel, appFlow, Browser, csrfIn, formBody, ORIGIN, resetStore, store, useClock, viaEnv, viaExports, webLoginHttp } from "./harness";
import { DMG, seedDist, V2 } from "./release-fixture";

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
  await allowedChannel(B2, A1);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const COOKIE_CLEAR = "cdl_s=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax";

interface Sess {
  readonly b: Browser;
  readonly cookie: string;
  readonly csrf: string;
}

/** 웹 로그인 + 폼 토큰(첫 화면에서 읽는다) */
async function session(account: "a1" | "b2", browser = new Browser()): Promise<Sess> {
  const { browser: b, callback } = await webLoginHttp(fake, account, browser);
  expect(callback.status).toBe(303);
  const csrf = csrfIn(await (await b.get("/")).text());
  expect(csrf).not.toBeNull();
  return { b, cookie: b.jar.get("cdl_s") ?? "", csrf: csrf ?? "" };
}

const post = (s: Sess, path: string, fields: Record<string, string> = {}, headers?: Record<string, string | null>) =>
  s.b.post(path, headers, formBody({ csrf: s.csrf, ...fields }));

const adminSnapshot = () => store().adminView(Date.now());
const hasAllowed = async (id: string) => (await adminSnapshot()).allowlist.some((r) => r.channelId === id);

function rejectedReasons(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    .filter((e) => e.event === "web.post.rejected")
    .map((e) => String(e.reason));
}

const appGet = (path: string, access: string) => viaExports(ORIGIN + path, { method: "GET", headers: { Authorization: `Bearer ${access}` } });
const idOfAccess = async (access: string) => {
  const c = await store().check(await sha256Hex(access), ADMINS, Date.now());
  if (!c.ok) throw new Error(`check ${c.code}`);
  return c.sessionId;
};

describe("관리자 판정", () => {
  it("쿠키 없음: GET /admin은 303 /", async () => {
    const res = await new Browser().get("/admin");
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/"]);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it("형식 밖 쿠키: 303 / + 쿠키 지움", async () => {
    const res = await new Browser().get("/admin", { Cookie: "cdl_s=garbage" });
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/"]);
    expect(res.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
  });

  it("b2(관리자 아님): 403 HTML", async () => {
    const s = await session("b2");
    const res = await s.b.get("/admin");
    expect(res.status).toBe(403);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toContain("관리자만 볼 수 있어요.");
  });

  it("a1(관리자): 200, 섹션 제목 다섯 개, 허용목록의 관리자 행에는 [빼기]가 없다", async () => {
    // 관리자 채널의 허용목록 행(W6 전·store 직접)을 만들어 둔다: 화면은 "관리자" 표시만 보이고 [빼기] 폼은 B2 하나다
    await allowedChannel(A1, A1);
    const s = await session("a1");
    const res = await s.b.get("/admin");
    expect(res.status).toBe(200);
    const t = await res.text();
    for (const h of ["관리자", "허용 채널", "거부된 시도", "활성 세션", "감사 기록"]) expect(t).toContain(`<h2>${h}</h2>`);
    expect(t).toContain(`<span class="mono">${A1}</span>`);
    expect(t).toContain('<span class="muted">관리자</span>');
    const disallowForms = [...t.matchAll(/action="\/admin\/disallow"[^]*?name="channelId" value="([0-9a-f]{32})"/g)].map((m) => m[1]);
    expect(disallowForms).toEqual([B2]);
  });

  it("부트스트랩: GET /admin 403, POST는 Origin이 틀려도 403 bootstrap", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const b = new Browser(viaEnv({ ADMIN_CHANNEL_IDS: "" }));
    const get = await b.get("/admin");
    expect(get.status).toBe(403);
    expect(await get.text()).toContain("아직 관리자가 정해지지 않았어요.");
    const res = await b.post("/admin/allow", { Origin: "http://evil.example.test" }, formBody({ channelId: C3 }));
    expect(res.status).toBe(403);
    expect(rejectedReasons(spy)).toEqual(["bootstrap"]);
  });

  it("b2가 맞는 csrf로 허용을 보내도 403이고 아무것도 바뀌지 않는다", async () => {
    const s = await session("b2");
    const res = await post(s, "/admin/allow", { channelId: C3 });
    expect(res.status).toBe(403);
    expect(await hasAllowed(C3)).toBe(false);
  });
});

describe("CSRF: Origin × csrf 9조합 × 3경로", () => {
  const ORIGINS = ["없음", "다른 출처", "맞음"] as const;
  const TOKENS = ["없음", "다른 값", "맞음"] as const;
  const ROUTES_UNDER_TEST = [
    { name: "관리 허용", user: "a1" as const, path: () => "/admin/allow", fields: { channelId: C3 } as Record<string, string>, pass: { status: 303, location: "/admin" } },
    // b2의 실제 앱 세션을 끊는다: 거절된 경우 그 앱 access가 그대로 살아 있는지 본다
    { name: "내 기기 끊기", user: "b2" as const, path: () => "", fields: {} as Record<string, string>, pass: { status: 303, location: "/" } },
    { name: "로그아웃", user: "b2" as const, path: () => "/auth/web/logout", fields: {} as Record<string, string>, pass: { status: 303, location: "/" } },
  ];

  for (const r of ROUTES_UNDER_TEST) {
    for (const o of ORIGINS) {
      for (const t of TOKENS) {
        it(`${r.name}: Origin ${o}, csrf ${t}`, async () => {
          const s = await session(r.user);
          const access = r.name === "내 기기 끊기" ? ((await appFlow({ fake })).redeemBody.accessToken as string) : null;
          const path = access === null ? r.path() : `/me/sessions/${await idOfAccess(access)}/revoke`;
          const headers: Record<string, string | null> = o === "없음" ? { Origin: null } : o === "다른 출처" ? { Origin: "http://evil.example.test" } : {};
          const csrf = t === "맞음" ? s.csrf : t === "다른 값" ? newSecret() : null;
          const body = formBody({ ...r.fields, ...(csrf === null ? {} : { csrf }) });
          const res = await s.b.post(path, headers, body);
          if (o === "맞음" && t === "맞음") {
            expect([res.status, res.headers.get("Location")]).toEqual([r.pass.status, r.pass.location]);
            if (access !== null) expect((await appGet("/api/me", access)).status).toBe(401);
          } else {
            expect(res.status).toBe(403);
            // 거절된 요청은 아무것도 바꾸지 않는다
            if (r.user === "a1") expect(await hasAllowed(C3)).toBe(false);
            if (access !== null) expect((await appGet("/api/me", access)).status).toBe(200);
            const home = await (await s.b.get("/")).text();
            if (r.name === "로그아웃") expect(home).toContain('action="/auth/web/logout"');
          }
        });
      }
    }
  }
});

describe("CSRF 추가 사례(관리 경로)", () => {
  const fields = { channelId: C3 };

  it.each([
    ["Origin: null", { Origin: "null" }],
    ["Sec-Fetch-Site: cross-site", { "Sec-Fetch-Site": "cross-site" }],
    ["Sec-Fetch-Site: same-site", { "Sec-Fetch-Site": "same-site" }],
    ["Sec-Fetch-Site: none", { "Sec-Fetch-Site": "none" }],
  ])("%s는 403", async (_name, headers) => {
    const s = await session("a1");
    const res = await post(s, "/admin/allow", fields, headers);
    expect(res.status).toBe(403);
    expect(await hasAllowed(C3)).toBe(false);
  });

  it("Sec-Fetch-Site가 없어도 맞는 Origin·csrf면 통과", async () => {
    const s = await session("a1");
    const res = await post(s, "/admin/allow", fields, { "Sec-Fetch-Site": null });
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/admin"]);
    expect(await hasAllowed(C3)).toBe(true);
  });

  it("csrf 필드가 둘이면(둘 다 맞아도) 403", async () => {
    const s = await session("a1");
    const res = await s.b.post("/admin/allow", undefined, `csrf=${s.csrf}&csrf=${s.csrf}&channelId=${C3}`);
    expect(res.status).toBe(403);
    expect(await hasAllowed(C3)).toBe(false);
  });

  it("다른 세션의 csrf를 내 쿠키와 함께 보내면 403", async () => {
    const admin = await session("a1");
    const other = await session("b2");
    const res = await admin.b.post("/admin/allow", undefined, formBody({ csrf: other.csrf, channelId: C3 }));
    expect(res.status).toBe(403);
    expect(await hasAllowed(C3)).toBe(false);
  });

  it("csrf가 43자 형식이 아니면 403", async () => {
    const s = await session("a1");
    for (const csrf of ["", "x", s.csrf + "A", s.csrf.slice(1)]) {
      const res = await s.b.post("/admin/allow", undefined, formBody({ csrf, channelId: C3 }));
      expect(res.status).toBe(403);
    }
  });
});

describe("415·본문", () => {
  const send = (s: Sess, headers: Record<string, string | null>, body: string | Uint8Array) => s.b.post("/admin/allow", headers, body);

  it.each([
    ["application/json", "application/json"],
    ["text/plain", "text/plain"],
    ["multipart/form-data", "multipart/form-data; boundary=x"],
  ])("Content-Type %s는 415", async (_name, type) => {
    const s = await session("a1");
    const body = type === "application/json" ? JSON.stringify({ csrf: s.csrf, channelId: C3 }) : formBody({ csrf: s.csrf, channelId: C3 });
    const res = await send(s, { "Content-Type": type }, body);
    expect(res.status).toBe(415);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await hasAllowed(C3)).toBe(false);
  });

  it("Content-Type 헤더가 없으면 415", async () => {
    const s = await session("a1");
    const res = await send(s, { "Content-Type": null }, new TextEncoder().encode(formBody({ csrf: s.csrf, channelId: C3 })));
    expect(res.status).toBe(415);
  });

  it.each(["application/x-www-form-urlencoded;charset=UTF-8", "Application/X-WWW-Form-Urlencoded"])("%s는 통과(대소문자·매개변수)", async (type) => {
    const s = await session("a1");
    const res = await send(s, { "Content-Type": type }, formBody({ csrf: s.csrf, channelId: C3 }));
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/admin"]);
  });

  it("본문 4097바이트는 400, 4096바이트는 읽는다(csrf가 없어 403)", async () => {
    const s = await session("a1");
    expect((await send(s, {}, "a".repeat(4097))).status).toBe(400);
    expect((await send(s, {}, "a".repeat(4096))).status).toBe(403);
  });

  it("잘못된 UTF-8 본문은 400", async () => {
    const s = await session("a1");
    expect((await send(s, {}, new Uint8Array([0xff]))).status).toBe(400);
  });
});

describe("검사 순서", () => {
  it("나쁜 Origin + text/plain: 403 bad_origin(Content-Type보다 먼저)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const s = await session("a1");
    const res = await s.b.post("/admin/allow", { Origin: "http://evil.example.test", "Content-Type": "text/plain" }, "x");
    expect(res.status).toBe(403);
    expect(rejectedReasons(spy)).toEqual(["bad_origin"]);
  });

  it("맞는 Origin + text/plain + 쿠키 없음: 415(세션보다 먼저)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await new Browser().post("/admin/allow", { "Content-Type": "text/plain" }, "x");
    expect(res.status).toBe(415);
    expect(rejectedReasons(spy)).toEqual(["unsupported_type"]);
  });

  it("맞는 Origin + form + 쿠키 없음 + csrf 없음: 303 / (no_session)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await new Browser().post("/admin/allow", undefined, formBody({ channelId: C3 }));
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/"]);
    expect(rejectedReasons(spy)).toEqual(["no_session"]);
  });

  it("b2 + 관리 경로 + csrf 없음: 403 not_admin(csrf보다 먼저)", async () => {
    const s = await session("b2");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await s.b.post("/admin/allow", undefined, formBody({ channelId: C3 }));
    expect(res.status).toBe(403);
    expect(rejectedReasons(spy)).toEqual(["not_admin"]);
  });

  it("관리자 + csrf 없음: 403 bad_csrf", async () => {
    const s = await session("a1");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await s.b.post("/admin/allow", undefined, formBody({ channelId: C3 }));
    expect(res.status).toBe(403);
    expect(rejectedReasons(spy)).toEqual(["bad_csrf"]);
  });

  it("세션이 없을 때는 경로 매개변수와 상관없이 303 /(검사는 가드 뒤)", async () => {
    const b = new Browser();
    const a = await b.post("/admin/sessions/abc/revoke");
    const c = await b.post("/me/sessions/abc/revoke");
    expect([a.status, c.status]).toEqual([303, 303]);
  });
});

describe("동작", () => {
  it("allow: 채널 ID 모양을 본다", async () => {
    const s = await session("a1");
    for (const channelId of ["ABC", "A".repeat(32), "0".repeat(31), "g".repeat(32), ""]) expect((await post(s, "/admin/allow", { channelId })).status).toBe(400);
    expect((await s.b.post("/admin/allow", undefined, formBody({ csrf: s.csrf }))).status).toBe(400);
    const dup = await s.b.post("/admin/allow", undefined, `csrf=${s.csrf}&channelId=${C3}&channelId=${D4}`);
    expect(dup.status).toBe(400);
    expect(await dup.text()).toContain("요청을 읽지 못했어요."); // 중복은 bad_body, 없음·형식 틀림은 bad_channel_id
    expect(await (await s.b.post("/admin/allow", undefined, formBody({ csrf: s.csrf }))).text()).not.toContain("요청을 읽지 못했어요.");
  });

  it("allow: 메모 100자는 store가 64자로 자른다, 감사 기록이 남는다", async () => {
    const s = await session("a1");
    expect((await post(s, "/admin/allow", { channelId: C3, note: "가".repeat(100) })).status).toBe(303);
    const v = await adminSnapshot();
    expect(v.allowlist.find((r) => r.channelId === C3)?.note).toBe("가".repeat(64));
    expect(v.audit[0]).toMatchObject({ action: "allow", actor: A1, target: C3 });
  });

  it("allow: note가 둘이면 400", async () => {
    const s = await session("a1");
    const res = await s.b.post("/admin/allow", undefined, `csrf=${s.csrf}&channelId=${C3}&note=a&note=b`);
    expect(res.status).toBe(400);
    expect(await hasAllowed(C3)).toBe(false);
  });

  it("disallow: 관리자 채널은 409이고 그 뒤에도 /admin이 열린다", async () => {
    const s = await session("a1");
    const res = await post(s, "/admin/disallow", { channelId: A1 });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("관리자 채널은 뺄 수 없어요.");
    expect((await s.b.get("/admin")).status).toBe(200);
  });

  it("disallow: 잘못된 ID는 400", async () => {
    const s = await session("a1");
    expect((await post(s, "/admin/disallow", { channelId: "zz" })).status).toBe(400);
  });

  it("세션 끊기: 모르는 id·모양 밖은 404", async () => {
    const s = await session("a1");
    expect((await post(s, `/admin/sessions/${newId()}/revoke`)).status).toBe(404);
    expect((await post(s, "/admin/sessions/abc/revoke")).status).toBe(404);
  });

  it("거부 기록: [지우기] 303, 다시 하면 404", async () => {
    const admin = await session("a1");
    fake.state.account = "c3";
    const web = await webLoginHttp(fake, "c3");
    expect(web.callback.headers.get("Location")).toBe("/auth/done?r=denied");
    expect((await adminSnapshot()).denied.map((d) => d.channelId)).toEqual([C3]);
    const res = await post(admin, `/admin/denied/${C3}/dismiss`);
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/admin"]);
    expect((await adminSnapshot()).denied).toEqual([]);
    expect((await post(admin, `/admin/denied/${C3}/dismiss`)).status).toBe(404);
  });

  it("거부 기록이 없는 채널의 [허용]은 404, ID 모양 밖도 404", async () => {
    const admin = await session("a1");
    expect((await post(admin, `/admin/denied/${D4}/allow`)).status).toBe(404);
    expect((await post(admin, "/admin/denied/zz/allow")).status).toBe(404);
    expect((await post(admin, "/admin/denied/zz/dismiss")).status).toBe(404);
  });
});

describe("[허용] → 즉시 로그인 성공", () => {
  it("d4: 거부 → 관리 화면의 거부 행 → [허용] → 웹·앱 로그인 성공", async () => {
    const admin = await session("a1");
    const first = await webLoginHttp(fake, "d4");
    expect(first.callback.headers.get("Location")).toBe("/auth/done?r=denied");
    expect(first.callback.headers.getSetCookie().some((c) => c.startsWith("cdl_s="))).toBe(false);

    const page = await (await admin.b.get("/admin")).text();
    expect(page).toContain(`action="/admin/denied/${D4}/allow"`);
    expect(page).toContain("합성기타D4");

    const res = await post(admin, `/admin/denied/${D4}/allow`);
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/admin"]);

    const again = await webLoginHttp(fake, "d4");
    expect(again.callback.status).toBe(303);
    expect(again.callback.headers.get("Location")).toBe("/");
    expect(again.callback.headers.getSetCookie().some((c) => c.startsWith("cdl_s=cdw_"))).toBe(true);
    expect(await (await again.browser.get("/")).text()).toContain("합성기타D4 채널로 로그인했어요.");

    fake.state.account = "d4";
    const app = await appFlow({ fake });
    expect(app.redeemBody.status).toBe("ok");
  });
});

describe("관리 POST의 경계(구현 중 변경 38 (카))", () => {
  const auditOf = async () => (await adminSnapshot()).audit.map((a) => [a.action, a.target]);

  it("관리자 채널을 [추가]·거부 기록 [허용]하면 409이고 아무것도 쓰지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const admin = await session("a1");
    const before = await auditOf();
    for (const [path, fields] of [
      ["/admin/allow", { channelId: A1 }],
      [`/admin/denied/${A1}/allow`, {}],
    ] as const) {
      const res = await post(admin, path, fields);
      expect([path, res.status]).toEqual([path, 409]);
      expect(await res.text()).toContain("관리자 채널은 허용목록에 넣지 않아요.");
    }
    expect(await hasAllowed(A1)).toBe(false);
    expect(await auditOf()).toEqual(before);
    const reasons = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>).filter((e) => e.event === "admin.rejected").map((e) => e.reason);
    // /admin/denied/:channelId/allow는 URL에 채널 id가 실리는 quiet 경로라 거절도 로그를 남기지 않는다(구현 중 변경 43)
    expect(reasons).toEqual(["is_admin"]);
  });

  it("허용목록에 없는 채널 [빼기]: 404, 감사 행이 생기지 않는다", async () => {
    const admin = await session("a1");
    const before = await auditOf();
    const res = await post(admin, "/admin/disallow", { channelId: C3 });
    expect(res.status).toBe(404);
    expect(await auditOf()).toEqual(before);
  });

  it("이미 허용된 채널을 메모 없이 다시 [추가]해도 메모가 남는다(메모를 주면 바뀐다)", async () => {
    const admin = await session("a1");
    const noteOf = async () => (await adminSnapshot()).allowlist.find((r) => r.channelId === C3)?.note;
    expect((await post(admin, "/admin/allow", { channelId: C3, note: "친구" })).status).toBe(303);
    expect(await noteOf()).toBe("친구");
    expect((await post(admin, "/admin/allow", { channelId: C3 })).status).toBe(303);
    expect(await noteOf()).toBe("친구");
    expect((await post(admin, "/admin/allow", { channelId: C3, note: "" })).status).toBe(303);
    expect(await noteOf()).toBe("친구");
    expect((await post(admin, "/admin/allow", { channelId: C3, note: "동료" })).status).toBe(303);
    expect(await noteOf()).toBe("동료");
  });
});

describe("[빼기] 지연 0", () => {
  it("b2 앱·웹 세션이 바로 403으로 끝난다", async () => {
    const admin = await session("a1");
    const web = await session("b2");
    fake.state.account = "b2";
    const app = await appFlow({ fake });
    const access = app.redeemBody.accessToken as string;
    const refresh = app.redeemBody.refreshToken as string;
    expect((await appGet("/api/me", access)).status).toBe(200);

    const res = await post(admin, "/admin/disallow", { channelId: B2 });
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/admin"]);

    const me = await appGet("/api/me", access);
    expect([me.status, await me.json()]).toEqual([403, { code: "not_allowed" }]);
    expect((await appGet(`/releases/${V2}/${DMG}`, access)).status).toBe(403);
    const rt = await viaExports(`${ORIGIN}/auth/refresh`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: refresh }) });
    expect(rt.status).toBe(403);
    await rt.text();
    const dl = await web.b.get(`/releases/${V2}/${DMG}`);
    expect(dl.status).toBe(403);
    await dl.arrayBuffer();
    const home = await web.b.get("/");
    expect(await home.text()).toContain('action="/auth/web/start"');
    expect(home.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
    const adm = await web.b.get("/admin");
    expect(adm.status).toBe(303);
  });
});

describe("[끊기] 지연 0", () => {
  it("앱 세션: 바로 401 session_revoked(/api/me·/releases)", async () => {
    const admin = await session("a1");
    fake.state.account = "b2";
    const app = await appFlow({ fake });
    const access = app.redeemBody.accessToken as string;
    const id = await idOfAccess(access);
    const page = await (await admin.b.get("/admin")).text();
    expect(page).toContain(`action="/admin/sessions/${id}/revoke"`);
    const res = await post(admin, `/admin/sessions/${id}/revoke`);
    expect([res.status, res.headers.get("Location")]).toEqual([303, "/admin"]);
    const me = await appGet("/api/me", access);
    expect([me.status, await me.json()]).toEqual([401, { code: "session_revoked" }]);
    const dl = await appGet(`/releases/${V2}/${DMG}`, access);
    expect([dl.status, await dl.json()]).toEqual([401, { code: "session_revoked" }]);
    expect((await adminSnapshot()).audit[0]).toMatchObject({ action: "revoke_session", actor: A1 });
  });

  it("웹 세션: 끊긴 뒤 GET /는 비로그인", async () => {
    const admin = await session("a1");
    const web = await session("b2");
    const c = await store().webCheck(await sha256Hex(web.cookie), ADMINS, Date.now());
    if (!c.ok) throw new Error("webCheck");
    const res = await post(admin, `/admin/sessions/${c.sessionId}/revoke`);
    expect(res.status).toBe(303);
    const home = await web.b.get("/");
    expect(await home.text()).toContain('action="/auth/web/start"');
    expect(home.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
  });
});
