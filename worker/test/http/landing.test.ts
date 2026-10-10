// 랜딩 `/`·내 기기·웹 로그아웃·스타일시트(docs/design/worker.md §8.2·§9.5, 구현 중 변경 38, W6 수락 기준).
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../../src/core/token";
import { COPY } from "../../src/http/copy";
import { LATEST_VIEW_CACHE } from "../../src/http/landing";
import { SUMS_CACHE } from "../../src/http/releases";
import { SITE_CSS, SITE_CSS_PATH } from "../../src/http/site-css";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, D4 } from "../store/helpers";
import { allowedChannel, appFlow, Browser, csrfIn, formBody, ORIGIN, resetStore, store, useClock, viaEnv, viaExports } from "./harness";
import { countingDist, DMG, seedDist, V2 } from "./release-fixture";

let fake: FakeChzzk;
let net: FakeNet;
let seed: Map<string, Uint8Array>;
const enc = (s: string) => new TextEncoder().encode(s);
const COOKIE_CLEAR = "cdl_s=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax";
const CSP = "default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' http://127.0.0.1:8788; frame-ancestors 'none'; base-uri 'none'";

beforeAll(async () => {
  seed = await seedDist();
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

/** 웹 로그인(승인)해서 콜백이 세션 쿠키를 심었음을 단언한다 */
async function webLogin(account: "a1" | "b2" | "c3" | "d4", browser = new Browser()): Promise<Browser> {
  fake.state.account = account;
  fake.state.authorize = "approve";
  const start = await browser.post("/auth/web/start");
  expect(start.status).toBe(303);
  const cb = await browser.get(await browser.authorize(start, fake));
  expect(cb.status).toBe(303);
  return browser;
}

const sessionIdOf = async (cookie: string) => {
  const c = await store().webCheck(await sha256Hex(cookie), ADMINS, Date.now());
  if (!c.ok) throw new Error(`webCheck ${c.code}`);
  return c.sessionId;
};

describe("비로그인", () => {
  it("GET /: 200, 로그인 폼, 스타일시트 링크, 설치 파일 없음, 헤더", async () => {
    const res = await new Browser().get("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("Content-Security-Policy")).toBe(CSP);
    expect(res.headers.get("Referrer-Policy")).toBe("same-origin");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.getSetCookie()).toEqual([]);
    const t = await res.text();
    expect(t).toContain('action="/auth/web/start"');
    expect(t).toContain(`href="${SITE_CSS_PATH}"`);
    for (const bad of ["<script", "style=", "/releases/"]) expect(t).not.toContain(bad);
  });

  it("형식 밖 쿠키: 비로그인 화면 + 쿠키 지우기", async () => {
    const res = await new Browser().get("/", { Cookie: "cdl_s=garbage" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('action="/auth/web/start"');
    expect(res.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
  });

  it("로그아웃된 세션의 쿠키도 비로그인 화면 + 쿠키 지우기", async () => {
    const b = await webLogin("b2");
    const cookie = b.jar.get("cdl_s") ?? "";
    const page = await (await b.get("/")).text();
    const out = await b.post("/auth/web/logout", undefined, formBody({ csrf: csrfIn(page) ?? "" }));
    expect(out.status).toBe(303);
    const res = await new Browser().get("/", { Cookie: `cdl_s=${cookie}` });
    expect(await res.text()).toContain('action="/auth/web/start"');
    expect(res.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
  });
});

describe("허용된 사용자", () => {
  it("b2: 이름·최신 버전·다섯 행·SHA-256·해제 안내·로그아웃, 관리 링크는 없다", async () => {
    const b = await webLogin("b2");
    const res = await b.get("/");
    expect(res.status).toBe(200);
    const t = await res.text();
    expect(t).toContain(`‘${FAKE_ACCOUNTS.b2.channelName}’ 채널로 로그인했어요.`);
    expect(t).toContain("최신 버전 0.2.0 · 2030-01-01");
    const sums = new TextDecoder().decode(seed.get(`releases/${V2}/SHA256SUMS`));
    const hexOf = (name: string) => new RegExp(`^([0-9a-f]{64})  ${name}$`, "m").exec(sums)?.[1] ?? "";
    for (const name of ["darwin-aarch64.dmg", "windows-x86_64-setup.exe", "windows-x86_64.msi", "linux-x86_64.AppImage", "linux-x86_64.deb"]) {
      const file = `chzzk-downloader_${V2}_${name}`;
      expect(t).toContain(`href="/releases/${V2}/${file}"`);
      expect(hexOf(file)).toMatch(/^[0-9a-f]{64}$/);
      expect(t).toContain(`<code>${hexOf(file)}</code>`);
    }
    expect(t).not.toContain(".app.tar.gz");
    expect(t).not.toContain(".sig");
    expect(t).toContain("<details>");
    // macOS 설치 안내: 손상 경고 → 응용 프로그램으로 옮김 → xattr → 다시 열기(worker.md 구현 중 변경 45)
    const mac = t.slice(t.indexOf("<h3>macOS</h3>"), t.indexOf("<h3>Windows</h3>"));
    expect(mac.length).toBeGreaterThan(0);
    expect(mac).toContain(`<p>${COPY.macDamaged}</p>`);
    expect(mac).toContain("손상돼 열 수 없다");
    expect(mac).toContain("‘응용 프로그램’ 폴더");
    // 큰따옴표는 이스케이프돼 나간다(core/html.ts escapeHtml)
    expect(mac).toContain("<pre><code>xattr -dr com.apple.quarantine &quot;/Applications/치지직 다운로더.app&quot;</code></pre>");
    const iMove = mac.indexOf(COPY.macMove);
    const iCmd = mac.indexOf("xattr -dr");
    const iReopen = mac.indexOf(COPY.macReopen);
    expect(iMove).toBeGreaterThan(-1);
    expect(iMove < iCmd && iCmd < iReopen).toBe(true);
    // 단계는 ol 항목이고 문자열에 번호가 박혀 있지 않다
    expect(mac).toContain(`<ol><li>${COPY.macMove}</li><li>${COPY.macTerminal}<pre>`);
    expect(mac).toContain(`</pre></li><li>${COPY.macReopen}</li></ol>`);
    expect(COPY.macMove).not.toMatch(/^\d+\./);
    // 랜딩 제목은 앱 이름 꼬리 없이 한 번만, 본문 h1은 앱 이름
    expect(t).toContain("<title>치지직 다운로더 — 비공식 다시보기·클립 다운로더</title>");
    expect(t).toContain("<h1>치지직 다운로더</h1>");
    // 시각 열 제목에는 시간대가 없고 caption에 한 번 적는다
    expect(t).toContain("<caption>시각은 한국 시간이에요.</caption>");
    expect(t).not.toContain("KST");
    // 실기기에서 통하지 않는 옛 안내는 없다
    for (const old of ["그래도 열기", "우클릭", "개인정보 보호 및 보안", "확인되지 않은 개발자"]) expect(t).not.toContain(old);
    expect(t).toContain('action="/auth/web/logout"');
    expect(t).not.toContain('href="/admin"');
    for (const bad of ["<script", "style="]) expect(t).not.toContain(bad);
    // 같은 브라우저로 설치 파일 링크가 열린다
    const dl = await b.get(`/releases/${V2}/${DMG}`);
    expect(dl.status).toBe(200);
    await dl.arrayBuffer();
  });

  it("a1(관리자): 관리 링크", async () => {
    const b = await webLogin("a1");
    expect(await (await b.get("/")).text()).toContain('href="/admin"');
  });

  it("허용되지 않은 계정(d4)은 세션이 없어 비로그인 화면", async () => {
    const b = await webLogin("d4");
    expect(b.jar.has("cdl_s")).toBe(false);
    expect(await (await b.get("/")).text()).toContain('action="/auth/web/start"');
  });
});

describe("릴리스 상태", () => {
  const viaDist = (opts: Parameters<typeof countingDist>[0]) => new Browser(viaEnv({ DIST: countingDist(opts).dist }));

  it("latest.json 없음: 아직 올라온 버전이 없어요", async () => {
    const b = await webLogin("b2", viaDist({ hide: ["releases/latest.json"] }));
    const res = await b.get("/");
    expect(res.status).toBe(200);
    const t = await res.text();
    expect(t).toContain("아직 올라온 버전이 없어요.");
    expect(t).toContain("내 기기");
  });

  it("latest.json 해석 실패: 불러오지 못했어요, 그래도 200이고 내 기기가 보인다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const b = await webLogin("b2", viaDist({ override: { "releases/latest.json": enc("{") } }));
    const res = await b.get("/");
    expect(res.status).toBe(200);
    const t = await res.text();
    expect(t).toContain("설치 파일 목록을 불러오지 못했어요.");
    expect(t).toContain("내 기기");
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(events).toContainEqual({ event: "landing.release_unavailable", level: "warn", reason: "latest_invalid" });
  });

  it("SHA256SUMS 없음: 불러오지 못했어요", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const b = await webLogin("b2", viaDist({ hide: [`releases/${V2}/SHA256SUMS`] }));
    const t = await (await b.get("/")).text();
    expect(t).toContain("설치 파일 목록을 불러오지 못했어요.");
    const events = spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ event: "landing.release_unavailable", reason: "sums" }));
  });
});

describe("R2가 던진다(구현 중 변경 38 (가))", () => {
  const cases = [
    ["latest.json", "releases/latest.json"],
    ["SHA256SUMS", `releases/${V2}/SHA256SUMS`],
  ] as const;
  for (const [name, key] of cases) {
    it(`${name} get이 던져도 200: 불러오지 못했어요, 내 기기·로그아웃 폼이 보이고 다음 요청은 표를 보인다`, async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const c = countingDist({ throwOnGet: [key] });
      const b = await webLogin("b2", new Browser(viaEnv({ DIST: c.dist })));
      const res = await b.get("/");
      expect(res.status).toBe(200);
      const t = await res.text();
      expect(t).toContain("설치 파일 목록을 불러오지 못했어요.");
      expect(t).toContain("내 기기");
      expect(t).toContain('action="/auth/web/logout"');
      expect(t).toContain('name="csrf"');
      const events = spy.mock.calls.map((x) => JSON.parse(String(x[0])) as Record<string, unknown>);
      expect(events).toContainEqual({ event: "landing.release_unavailable", level: "warn", reason: "r2", errorName: "Error" });
      expect(events.some((e) => e.event === "http.internal")).toBe(false);
      // 던진 결과는 캐시하지 않는다: 같은 isolate의 다음 요청(정상 R2)은 표를 보인다
      const ok = await (await new Browser().get("/", { Cookie: `cdl_s=${b.jar.get("cdl_s") ?? ""}` })).text();
      expect(ok).toContain(DMG);
    });
  }
});

describe("내 기기", () => {
  it("자기(로그인 채널) 세션만 보이고 끊긴다", async () => {
    // B2 웹 + B2 앱, A1 앱
    const web = await webLogin("b2");
    const webCookie = web.jar.get("cdl_s") ?? "";
    const b2App = await appFlow({ fake });
    fake.state.account = "a1";
    const a1App = await appFlow({ fake });
    const b2Access = b2App.redeemBody.accessToken as string;
    const a1Access = a1App.redeemBody.accessToken as string;
    const checkId = async (access: string) => {
      const c = await store().check(await sha256Hex(access), ADMINS, Date.now());
      if (!c.ok) throw new Error(`check ${c.code}`);
      return c.sessionId;
    };
    const b2Web = await sessionIdOf(webCookie);
    const b2AppId = await checkId(b2Access);
    const a1AppId = await checkId(a1Access);

    const page = await (await web.get("/")).text();
    expect(page.match(/action="\/me\/sessions\//g)).toHaveLength(2);
    expect(page).toContain(`/me/sessions/${b2Web}/revoke`);
    expect(page).toContain(`/me/sessions/${b2AppId}/revoke`);
    expect(page).not.toContain(a1AppId);
    expect(page).toContain("이 브라우저");
    const csrf = csrfIn(page) ?? "";
    expect(csrf).toHaveLength(43);

    // 남의 세션 id: 404이고 그 세션은 그대로 산다
    const other = await web.post(`/me/sessions/${a1AppId}/revoke`, undefined, formBody({ csrf }));
    expect(other.status).toBe(404);
    expect((await viaExports(`${ORIGIN}/api/me`, { method: "GET", headers: { Authorization: `Bearer ${a1Access}` } })).status).toBe(200);

    // 내 앱 세션 끊기: 303 /, 쿠키는 그대로, 앱은 바로 401
    const mine = await web.post(`/me/sessions/${b2AppId}/revoke`, undefined, formBody({ csrf }));
    expect(mine.status).toBe(303);
    expect(mine.headers.get("Location")).toBe("/");
    expect(mine.headers.getSetCookie()).toEqual([]);
    const me = await viaExports(`${ORIGIN}/api/me`, { method: "GET", headers: { Authorization: `Bearer ${b2Access}` } });
    expect([me.status, await me.json()]).toEqual([401, { code: "session_revoked" }]);

    // 이미 끊긴 세션은 404
    expect((await web.post(`/me/sessions/${b2AppId}/revoke`, undefined, formBody({ csrf }))).status).toBe(404);

    // 지금 브라우저의 세션 끊기: 쿠키도 지운다
    const self = await web.post(`/me/sessions/${b2Web}/revoke`, undefined, formBody({ csrf }));
    expect(self.status).toBe(303);
    expect(self.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
    expect(await (await web.get("/")).text()).toContain('action="/auth/web/start"');
  });

  it("허용목록의 owner가 다른 채널이어도 로그인 채널의 세션을 본다", async () => {
    await runInDurableObject(store(), (i) => i.db.run("UPDATE allowlist SET owner_channel_id = ? WHERE channel_id = ?", D4, B2));
    const web = await webLogin("b2");
    const app = await appFlow({ fake });
    const page = await (await web.get("/")).text();
    expect(page.match(/action="\/me\/sessions\//g)).toHaveLength(2);
    const c = await store().check(await sha256Hex(app.redeemBody.accessToken as string), ADMINS, Date.now());
    if (!c.ok) throw new Error("check");
    expect(c.ownerChannelId).toBe(D4);
    const res = await web.post(`/me/sessions/${c.sessionId}/revoke`, undefined, formBody({ csrf: csrfIn(page) ?? "" }));
    expect(res.status).toBe(303);
  });
});

describe("웹 로그아웃", () => {
  it("303 /, 쿠키 지움, 옛 쿠키는 session_revoked", async () => {
    const b = await webLogin("b2");
    const cookie = b.jar.get("cdl_s") ?? "";
    const csrf = csrfIn(await (await b.get("/")).text()) ?? "";
    const out = await b.post("/auth/web/logout", undefined, formBody({ csrf }));
    expect(out.status).toBe(303);
    expect(out.headers.get("Location")).toBe("/");
    expect(out.headers.getSetCookie()).toEqual([COOKIE_CLEAR]);
    const dl = await viaExports(`${ORIGIN}/releases/${V2}/${DMG}`, { method: "GET", headers: { Cookie: `cdl_s=${cookie}` } });
    expect([dl.status, await dl.json()]).toEqual([401, { code: "session_revoked" }]);
  });
});

describe("스타일시트", () => {
  it("해시 이름: 200, text/css, 불변 캐시, 본문 = SITE_CSS", async () => {
    const res = await new Browser().get(SITE_CSS_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await res.text()).toBe(SITE_CSS);
  });

  it.each(["/assets/site.css", "/assets/site.0000000000000000.css", "/assets/other.css"])("%s는 404 JSON", async (path) => {
    const res = await new Browser().get(path);
    expect([res.status, await res.json()]).toEqual([404, { code: "not_found" }]);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
