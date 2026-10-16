// 편집자 초대·완료 페이지와 앱 편집자 API(docs/design/features/delegation.md §5·§8.3, worker.md 구현 중 변경 106).
// 합성 채널: a1 관리자 · b2 허가 주인 · c3 편집자(이름이 이스케이프 입력) · d4 허가 없음.
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COPY } from "../../src/http/copy";
import { delegationsLeave, editorsInvite, editorsRemove } from "../../src/http/editors";
import type { Ctx } from "../../src/routes";
import { sha256Hex } from "../../src/core/token";
import { DONE_WINDOW_MS, INVITE_TTL_MS } from "../../src/store/delegation";
import { createFakeChzzk, FAKE_ACCOUNTS, type FakeAccountKey, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, C3, D4 } from "../store/helpers";
import { advance, allowedChannel, AppClient, appFlow, Browser, countingSend, csrfIn, formBody, h1Of, ORIGIN, resetStore, store, useClock, viaEnv, viaExports, webLoginHttp, type Send } from "./harness";

let fake: FakeChzzk;
let net: FakeNet;

beforeEach(async () => {
  useClock();
  fake = createFakeChzzk();
  net = installFakeChzzk(fake);
  await resetStore();
  await allowedChannel(B2, A1);
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NAME = { b2: FAKE_ACCOUNTS.b2.channelName, c3: FAKE_ACCOUNTS.c3.channelName, d4: FAKE_ACCOUNTS.d4.channelName };
const ESC_C3 = "&lt;script&gt;alert(1)&lt;/script&gt;";
const TOKEN_RE = /^cdi_[A-Za-z0-9_-]{43}$/;
const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const KAKAO_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 KAKAOTALK 10.0";
const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15";

const api = (path: string, access: string | null, body: unknown = {}, headers: Record<string, string> = {}, send: Send = viaExports) =>
  send(ORIGIN + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(access === null ? {} : { Authorization: `Bearer ${access}` }), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** 주인(b2)의 앱 로그인 → access */
async function ownerAccess(account: FakeAccountKey = "b2"): Promise<string> {
  fake.state.account = account;
  fake.state.authorize = "approve";
  const f = await appFlow({ fake });
  expect(f.redeemBody.status).toBe("ok");
  return f.redeemBody.accessToken as string;
}

/** 주인이 초대를 만든다 */
async function makeInvite(access: string): Promise<{ token: string; hash: string; url: string }> {
  const res = await api("/api/editors/invite", access);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { inviteUrl: string };
  const token = new URL(body.inviteUrl).pathname.split("/").pop() ?? "";
  expect(token).toMatch(TOKEN_RE);
  return { token, hash: await sha256Hex(token), url: body.inviteUrl };
}

/** 쿠키를 옮겨 다른 Send로 같은 브라우저를 쓴다 */
function asSend(b: Browser, send: Send): Browser {
  const out = new Browser(send);
  for (const [k, v] of b.jar) out.jar.set(k, v);
  return out;
}

const tables = () =>
  runInDurableObject(store(), (i) => JSON.stringify([i.db.all("SELECT * FROM invite ORDER BY token_hash"), i.db.all("SELECT * FROM delegation ORDER BY owner_channel_id, editor_channel_id"), i.db.all("SELECT * FROM flow ORDER BY id")]));
const chan = (i: number) => (0x100 + i).toString(16).padStart(32, "0");

/** 주인 b2에게 활성 편집자 n명을 SQL로 채운다(허가 행 + 위임 행) */
async function fillEditors(n: number): Promise<void> {
  for (let k = 0; k < n; k++) await store().allow(chan(k), "", A1, Date.now(), ADMINS);
  await runInDurableObject(store(), (i) => {
    const ownerAt = i.db.first<{ added_at: number }>("SELECT added_at FROM allowlist WHERE channel_id = ?", B2)?.added_at ?? 0;
    for (let k = 0; k < n; k++) {
      const at = i.db.first<{ added_at: number }>("SELECT added_at FROM allowlist WHERE channel_id = ?", chan(k))?.added_at ?? 0;
      i.db.run(
        "INSERT INTO delegation (owner_channel_id, owner_login_channel_id, editor_channel_id, owner_name, editor_name, owner_allowed_at, editor_allowed_at, created_at, revoked_at, revoked_by) VALUES (?, ?, ?, '주인', 'e', ?, ?, ?, NULL, NULL)",
        B2,
        B2,
        chan(k),
        ownerAt,
        at,
        Date.now(),
      );
    }
  });
}

/** 초대 주소에서 시작하는 웹 로그인을 콜백 응답까지 */
async function inviteLogin(browser: Browser, token: string, account: FakeAccountKey): Promise<Response> {
  fake.state.account = account;
  fake.state.authorize = "approve";
  const start = await browser.post(`/invite/${token}/start`);
  const callbackUrl = await browser.authorize(start, fake);
  return browser.get(callbackUrl);
}

describe("IV1~IV3 GET /invite/:token 화면", () => {
  it("IV1 비로그인: 고지 네 줄·폼 하나·채움 버튼 하나·noindex, DO 1회", async () => {
    const t = await makeInvite(await ownerAccess());
    const { send, calls } = countingSend();
    const res = await new Browser(send).get(`/invite/${t.token}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["invitePage"]);
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex");
    const text = await res.text();
    expect(h1Of(text)).toBe(COPY.invite.title(NAME.b2));
    for (const line of [COPY.landing.consent.collect, COPY.invite.consent.use(NAME.b2), COPY.landing.consent.exclude, COPY.invite.consent.revoke]) expect(text).toContain(line);
    expect(text).toContain('href="/privacy"');
    expect(text.match(/<form /g)).toHaveLength(1);
    expect(text).toContain(`action="/invite/${t.token}/start"`);
    expect(text.match(/btn btn-primary/g)).toHaveLength(1);
    expect(text).not.toContain("og:");
    expect(text).not.toContain("<script");
    expect(text).not.toContain("/#start");
    expect(/<title>([^<]*)<\/title>/.exec(text)?.[1]).not.toContain("오류: ");
  });

  it("IV2 허가 편집자 세션: 확인 페이지(두 이름, csrf, 이스케이프), DO 1회", async () => {
    await allowedChannel(C3, A1);
    const t = await makeInvite(await ownerAccess());
    const { browser: c } = await webLoginHttp(fake, "c3");
    const { send, calls } = countingSend();
    const res = await asSend(c, send).get(`/invite/${t.token}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["invitePage"]);
    const text = await res.text();
    expect(h1Of(text)).toBe(COPY.invite.confirm.title(NAME.b2));
    expect(text).toContain(`<dt>${COPY.invite.confirm.owner}</dt><dd>${NAME.b2}</dd><dt>${COPY.myChannel}</dt><dd>${ESC_C3}`);
    expect(text).not.toContain("<script>alert(1)");
    expect(text).toContain(`action="/invite/${t.token}/accept"`);
    expect(csrfIn(text)).not.toBeNull();
    expect(text.match(/btn btn-primary/g)).toHaveLength(1);
  });

  it("IV3 주인 자신의 웹 세션: 자기 초대 안내(200)", async () => {
    const t = await makeInvite(await ownerAccess());
    const { browser: b } = await webLoginHttp(fake, "b2");
    const { send, calls } = countingSend();
    const res = await asSend(b, send).get(`/invite/${t.token}`);
    expect(res.status).toBe(200);
    expect(calls).toEqual(["invitePage"]);
    expect(h1Of(await res.text())).toBe(COPY.invite.own.title);
  });
});

describe("IV4~IV7 GET의 나머지 갈래", () => {
  it("IV4 이미 활성 편집자: 303 / + alreadyEditor(이미 편집자라는 상태), 초대는 소비되지 않는다", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const first = await makeInvite(access);
    const { browser: c } = await webLoginHttp(fake, "c3");
    const page = await c.get(`/invite/${first.token}`);
    const acc = await c.post(`/invite/${first.token}/accept`, undefined, formBody({ csrf: csrfIn(await page.text()) ?? "" }));
    expect(acc.status).toBe(303);
    const second = await makeInvite(access);
    const before = await tables();
    const res = await c.get(`/invite/${second.token}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("Location")).toBe("/");
    expect(res.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=alreadyEditor;"))).toBe(true);
    expect(await tables()).toBe(before);
    expect(await (await c.get("/")).text()).toContain(COPY.alreadyEditor);
  });

  it("IV5 주인 쪽 상한: 409와 오류 접두 제목, 본문은 숫자가 없다", async () => {
    const t = await makeInvite(await ownerAccess());
    await fillEditors(10);
    const res = await new Browser().get(`/invite/${t.token}`);
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(text).toContain(`<title>오류: ${COPY.invite.full.title}`);
    expect(text).toContain(COPY.invite.full.body);
  });

  it("IV6 gone 넷: 형식 밖·모르는 토큰·만료·사용됨은 같은 404이고, 가짜 세션 쿠키도 DO 1회", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const expired = await makeInvite(access);
    const gone = async (path: string, rpc: string[], cookie?: string) => {
      const { send, calls } = countingSend();
      const b = new Browser(send);
      if (cookie !== undefined) b.jar.set("cdl_s", cookie);
      const res = await b.get(path);
      expect(res.status).toBe(404);
      expect(h1Of(await res.text())).toBe(COPY.invite.gone.title);
      expect(calls).toEqual(rpc);
    };
    await gone("/invite/zz", []);
    await gone("/invite/zz", [], "cdw_" + "A".repeat(43));
    await gone(`/invite/cdi_${"B".repeat(43)}`, ["invitePage"]);
    await gone(`/invite/cdi_${"B".repeat(43)}`, ["invitePage"], "cdw_" + "A".repeat(43));
    // 사용됨
    const used = await makeInvite(access);
    expect(await store().acceptInvite(used.hash, C3, "편집자", ADMINS, Date.now())).toMatchObject({ ok: true });
    await gone(`/invite/${used.token}`, ["invitePage"]);
    // 만료
    const fresh = await makeInvite(access);
    advance(INVITE_TTL_MS + 1);
    await gone(`/invite/${fresh.token}`, ["invitePage"]);
    expect(expired.token).not.toBe(fresh.token);
  });

  it("IV7 GET은 초대·위임·흐름 행을 바꾸지 않는다", async () => {
    await allowedChannel(C3, A1);
    const t = await makeInvite(await ownerAccess());
    const { browser: c } = await webLoginHttp(fake, "c3");
    const before = await tables();
    await new Browser().get(`/invite/${t.token}`);
    await c.get(`/invite/${t.token}`);
    await new Browser().get("/invite/zz");
    await new Browser().get(`/invite/cdi_${"B".repeat(43)}`);
    expect(await tables()).toBe(before);
    advance(INVITE_TTL_MS + 1);
    await new Browser().get(`/invite/${t.token}`);
    expect(await tables()).toBe(before);
  });
});

describe("IV8 POST /invite/:token/start", () => {
  it("Origin 없음·틀림 403(DO 0), 형식 밖 404(DO 0), 성공 303 + F 쿠키 + 흐름에 초대 해시", async () => {
    const t = await makeInvite(await ownerAccess());
    const { send, calls } = countingSend();
    const b = new Browser(send);
    expect((await b.post(`/invite/${t.token}/start`, { Origin: null })).status).toBe(403);
    expect((await b.post(`/invite/${t.token}/start`, { Origin: "http://evil.example.test" })).status).toBe(403);
    expect((await b.post("/invite/zz/start")).status).toBe(404);
    expect(calls).toEqual([]);
    const ok = await b.post(`/invite/${t.token}/start`);
    expect(ok.status).toBe(303);
    expect(calls).toEqual(["startWebInvite"]);
    expect(ok.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(ok.headers.get("Location")).toMatch(/^http:\/\/127\.0\.0\.1:8788\/.*state=/);
    expect(b.jar.has("cdl_f")).toBe(true);
    const rows = await runInDurableObject(store(), (i) => i.db.all<{ invite_hash: string | null }>("SELECT invite_hash FROM flow WHERE invite_hash IS NOT NULL"));
    expect(rows.map((r) => r.invite_hash)).toEqual([t.hash]);
  });

  it("소비된 초대·모르는 토큰은 404, 한도를 넘기면 429 + Retry-After", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const used = await makeInvite(access);
    expect(await store().acceptInvite(used.hash, C3, "편집자", ADMINS, Date.now())).toMatchObject({ ok: true });
    const b = new Browser();
    expect((await b.post(`/invite/${used.token}/start`)).status).toBe(404);
    expect((await b.post(`/invite/cdi_${"B".repeat(43)}/start`)).status).toBe(404);
    const t = await makeInvite(access);
    const limited = new Browser(viaEnv({ START_RATE_10M: "2" }));
    const ip = { "CF-Connecting-IP": "198.51.100.77" };
    expect((await limited.post(`/invite/${t.token}/start`, ip)).status).toBe(303);
    expect((await limited.post(`/invite/${t.token}/start`, ip)).status).toBe(303);
    const third = await limited.post(`/invite/${t.token}/start`, ip);
    expect(third.status).toBe(429);
    expect(third.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect(h1Of(await third.text())).toBe(COPY.rateLimited.title);
  });
});

describe("IV9~IV11 콜백", () => {
  it("IV9 허가 편집자: 303 /me/delegations/done, 세션 쿠키만 심고 F를 지운다, 이어 완료 페이지", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const t = await makeInvite(access);
    const b = new Browser();
    const cb = await inviteLogin(b, t.token, "c3");
    expect(cb.status).toBe(303);
    expect(cb.headers.get("Location")).toBe(`/me/delegations/done/${B2}`);
    const cookies = cb.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(/^cdl_s=cdw_/);
    expect(cookies[1]).toBe("cdl_f=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
    const page = await b.get(`/me/delegations/done/${B2}`);
    expect(page.status).toBe(200);
    const text = await page.text();
    expect(h1Of(text)).toBe(COPY.inviteDone.title(NAME.b2));
    expect(text).toContain(`name="owner" value="${B2}"`);
    expect(csrfIn(text)).not.toBeNull();
    expect(text).not.toContain("btn-primary");
    expect(text).not.toContain("<script>alert(1)");
    const me = (await (await new AppClient().me(access)).json()) as { editors: { channelId: string; status: string }[] };
    expect(me.editors).toEqual([expect.objectContaining({ channelId: C3, status: "active" })]);
  });

  it("IV10 콜백 갈래: 자기 초대·이미 편집자·상한·그 사이에 사라진 초대", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const seen = async (cb: Response, b: Browser, flash: string, text: string) => {
      expect(cb.status).toBe(303);
      expect(cb.headers.get("Location")).toBe("/");
      expect(cb.headers.getSetCookie().some((l) => l.startsWith(`cdl_flash=${flash};`))).toBe(true);
      expect(cb.headers.getSetCookie().some((l) => l.startsWith("cdl_s=cdw_"))).toBe(true);
      expect(await (await b.get("/")).text()).toContain(text);
      expect(b.jar.has("cdl_flash")).toBe(false);
    };
    // 자기 초대
    const own = await makeInvite(access);
    const ob = new Browser();
    await seen(await inviteLogin(ob, own.token, "b2"), ob, "inviteOwn", COPY.inviteOwn);
    // 이미 편집자
    const first = await makeInvite(access);
    const cb1 = new Browser();
    expect((await inviteLogin(cb1, first.token, "c3")).headers.get("Location")).toBe(`/me/delegations/done/${B2}`);
    const second = await makeInvite(access);
    const cb2 = new Browser();
    await seen(await inviteLogin(cb2, second.token, "c3"), cb2, "alreadyEditor", COPY.alreadyEditor);
    // 그 사이에 초대가 사라짐(주인이 새로 만들면 옛 초대가 대체된다): 로그인은 되고 안내만 다르다
    const old = await makeInvite(access);
    await runInDurableObject(store(), (i) => i.db.run("DELETE FROM delegation"));
    const gb = new Browser();
    fake.state.account = "c3";
    const start = await gb.post(`/invite/${old.token}/start`);
    const callbackUrl = await gb.authorize(start, fake);
    await makeInvite(access);
    await seen(await gb.get(callbackUrl), gb, "inviteGone", COPY.inviteGone);
  });

  it("IV10c 기존 편집자가 남에게 보낸 새 초대로 로그인해도 초대는 남고, 원래 받을 사람이 수락한다", async () => {
    await allowedChannel(C3, A1);
    await allowedChannel(D4, A1);
    const access = await ownerAccess();
    const first = await makeInvite(access);
    expect((await inviteLogin(new Browser(), first.token, "c3")).headers.get("Location")).toMatch(/^\/me\/delegations\/done/);
    const forN = await makeInvite(access);
    const e = await inviteLogin(new Browser(), forN.token, "c3");
    expect(e.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=alreadyEditor;"))).toBe(true);
    const n = new Browser();
    expect((await n.get(`/invite/${forN.token}`)).status).toBe(200);
    expect((await inviteLogin(n, forN.token, "d4")).headers.get("Location")).toMatch(/^\/me\/delegations\/done/);
  });

  it("IV10b 상한: 콜백도 inviteFull", async () => {
    await allowedChannel(C3, A1);
    const t = await makeInvite(await ownerAccess());
    await fillEditors(10);
    const b = new Browser();
    const cb = await inviteLogin(b, t.token, "c3");
    expect(cb.headers.get("Location")).toBe("/");
    expect(cb.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=inviteFull;"))).toBe(true);
    expect(await (await b.get("/")).text()).toContain(COPY.inviteFull);
  });

  it("IV11 허가 없는 채널: 거부 페이지에 초대 줄, 관리 화면에 꼬리표, [허가] 뒤 위임이 완성된다", async () => {
    const access = await ownerAccess();
    const t = await makeInvite(access);
    const b = new Browser();
    const cb = await inviteLogin(b, t.token, "d4");
    expect(cb.headers.get("Location")).toBe("/auth/done?r=denied");
    const done = await (await b.get("/auth/done?r=denied")).text();
    const line = COPY.doneDenied.invite(NAME.b2);
    expect(done).toContain(line);
    // 초대받은 사람이 먼저 읽는 것은 초대의 상태다: 채널 정보 → 초대 줄 → 본문 → 다음 행동
    expect(done.indexOf(line)).toBeGreaterThan(done.indexOf("채널 ID:"));
    expect(done.indexOf(line)).toBeLessThan(done.indexOf("관리자에게 채널 이름을 알려 주세요."));
    expect(done.indexOf("관리자에게 채널 이름을 알려 주세요.")).toBeLessThan(done.indexOf(COPY.doneDenied.next));
    const { browser: admin } = await webLoginHttp(fake, "a1");
    const adminPage = await (await admin.get("/admin")).text();
    expect(adminPage).toContain(COPY.invitedBy(NAME.b2));
    const csrf = csrfIn(adminPage) ?? "";
    const allow = await admin.post(`/admin/denied/${D4}/allow`, undefined, formBody({ csrf }));
    expect(allow.status).toBe(303);
    const f = await appFlow({ fake: Object.assign(fake, { state: Object.assign(fake.state, { account: "d4" }) }) });
    expect(f.redeemBody.status).toBe("ok");
    expect(f.redeemBody.delegatedChannels).toEqual([{ channelId: B2, channelName: NAME.b2 }]);
  });

  it("IV11b 음성: 청구 뒤 주인의 허가를 빼면 줄도 꼬리표도 없다", async () => {
    const t = await makeInvite(await ownerAccess());
    const b = new Browser();
    await inviteLogin(b, t.token, "d4");
    await store().disallow(B2, A1, ADMINS, Date.now());
    expect(await (await b.get("/auth/done?r=denied")).text()).not.toContain("초대는 기록해 뒀어요");
    const { browser: admin } = await webLoginHttp(fake, "a1");
    expect(await (await admin.get("/admin")).text()).not.toContain("초대 받음");
  });

  it("IV11c 잘못된 계정: 거부 페이지의 [초대 취소](F 증거·같은 출처)로 청구를 지우면 [허가] 뒤에도 위임이 생기지 않는다", async () => {
    const t = await makeInvite(await ownerAccess());
    const b = new Browser();
    await inviteLogin(b, t.token, "d4");
    const res = await b.get("/auth/done?r=denied");
    const done = await res.text();
    // 취소에 쓸 F를 지우지 않는다. 버튼은 채움이 아니고(튀지 않게) 안내 한 줄과 함께 있다(숨지 않게)
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(b.jar.has("cdl_f")).toBe(true);
    expect(done).toContain('action="/auth/claim/cancel"');
    expect(done).toContain(COPY.doneDenied.cancelHint);
    expect(done).toContain(COPY.cancelInvite);
    expect(done).not.toContain("btn-primary");
    expect(done.match(/<form /g)).toHaveLength(1);
    // 다른 출처의 POST는 403이고 청구는 그대로다
    expect((await b.post("/auth/claim/cancel", { Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect(JSON.parse(await tables())[0]).toHaveLength(1);
    const ok = await b.post("/auth/claim/cancel");
    expect([ok.status, ok.headers.get("Location")]).toEqual([303, "/"]);
    expect(ok.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=inviteCancelled;"))).toBe(true);
    expect(b.jar.has("cdl_f")).toBe(false);
    expect(await (await b.get("/")).text()).toContain(COPY.inviteCancelled);
    expect(JSON.parse(await tables())[0]).toEqual([]);
    // F 없이 다시: 이미 처리됨
    const again = await b.post("/auth/claim/cancel");
    expect(again.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=alreadyDone;"))).toBe(true);
    // 관리자가 허가해도 위임이 생기지 않는다
    await store().allowDenied(D4, A1, Date.now(), ADMINS);
    expect(JSON.parse(await tables())[1]).toEqual([]);
  });

  it("IV11d 초대 없는 거부 페이지는 지금처럼 F를 지우고 취소 버튼이 없다", async () => {
    const b = new Browser();
    fake.state.account = "d4";
    fake.state.authorize = "approve";
    const cb = await b.get(await b.authorize(await b.post("/auth/web/start"), fake));
    expect(cb.headers.get("Location")).toBe("/auth/done?r=denied");
    const res = await b.get("/auth/done?r=denied");
    expect(await res.text()).not.toContain("/auth/claim/cancel");
    expect(b.jar.has("cdl_f")).toBe(false);
  });

  it("IV11e 나중에 안 사람: 초대 흐름 밖(처음 화면)에서 같은 계정으로 다시 로그인해도 거부 페이지에 그 청구와 [초대 취소]가 나온다", async () => {
    const t = await makeInvite(await ownerAccess());
    await inviteLogin(new Browser(), t.token, "d4");
    const b = new Browser();
    fake.state.account = "d4";
    fake.state.authorize = "approve";
    const cb = await b.get(await b.authorize(await b.post("/auth/web/start"), fake));
    expect(cb.headers.get("Location")).toBe("/auth/done?r=denied");
    const done = await (await b.get("/auth/done?r=denied")).text();
    expect(done).toContain(COPY.doneDenied.invite(NAME.b2));
    expect(done).toContain('action="/auth/claim/cancel"');
    const ok = await b.post("/auth/claim/cancel");
    expect(ok.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=inviteCancelled;"))).toBe(true);
    expect(JSON.parse(await tables())[0]).toEqual([]);
  });
});

describe("IV12 POST /invite/:token/accept", () => {
  async function editorSession() {
    await allowedChannel(C3, A1);
    const { browser } = await webLoginHttp(fake, "c3");
    return browser;
  }
  const csrfOf = async (b: Browser, token: string) => csrfIn(await (await b.get(`/invite/${token}`)).text()) ?? "";

  it("세션 없음 303 / + sessionGone · 틀린 csrf 403 · 형식 밖 토큰 404(세션 검사 뒤)", async () => {
    const t = await makeInvite(await ownerAccess());
    const none = await new Browser().post(`/invite/${t.token}/accept`, undefined, formBody({ csrf: "x" }));
    expect(none.status).toBe(303);
    expect(none.headers.get("Location")).toBe("/");
    expect(none.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=sessionGone;"))).toBe(true);
    const c = await editorSession();
    const csrf = await csrfOf(c, t.token);
    expect((await c.post(`/invite/${t.token}/accept`, undefined, formBody({ csrf: "B".repeat(43) }))).status).toBe(403);
    const bad = await c.post("/invite/zz/accept", undefined, formBody({ csrf }));
    expect(bad.status).toBe(404);
    expect(h1Of(await bad.text())).toBe(COPY.invite.gone.title);
    // 세션이 없으면 토큰 형식과 상관없이 303
    expect((await new Browser().post("/invite/zz/accept", undefined, formBody({ csrf }))).status).toBe(303);
  });

  it("성공 303 /me/delegations/done, RPC는 webCheck·acceptInvite · 소비된 토큰 404", async () => {
    const t = await makeInvite(await ownerAccess());
    const c = await editorSession();
    const csrf = await csrfOf(c, t.token);
    const { send, calls } = countingSend();
    const ok = await asSend(c, send).post(`/invite/${t.token}/accept`, undefined, formBody({ csrf }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get("Location")).toBe(`/me/delegations/done/${B2}`);
    expect(calls).toEqual(["webCheck", "acceptInvite"]);
    expect((await c.post(`/invite/${t.token}/accept`, undefined, formBody({ csrf }))).status).toBe(404);
  });

  it("자기 초대·이미 편집자·상한은 303 / + 그 flash", async () => {
    const access = await ownerAccess();
    const own = await makeInvite(access);
    const { browser: b } = await webLoginHttp(fake, "b2");
    const csrfB = csrfIn(await (await b.get("/")).text()) ?? "";
    const r1 = await b.post(`/invite/${own.token}/accept`, undefined, formBody({ csrf: csrfB }));
    expect([r1.status, r1.headers.get("Location")]).toEqual([303, "/"]);
    expect(r1.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=inviteOwn;"))).toBe(true);

    const c = await editorSession();
    const first = await makeInvite(access);
    const csrfC = await csrfOf(c, first.token);
    expect((await c.post(`/invite/${first.token}/accept`, undefined, formBody({ csrf: csrfC }))).headers.get("Location")).toBe(`/me/delegations/done/${B2}`);
    const second = await makeInvite(access);
    const r2 = await c.post(`/invite/${second.token}/accept`, undefined, formBody({ csrf: csrfC }));
    expect(r2.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=alreadyEditor;"))).toBe(true);

    await runInDurableObject(store(), (i) => i.db.run("DELETE FROM delegation"));
    const third = await makeInvite(access);
    await fillEditors(10);
    const r3 = await c.post(`/invite/${third.token}/accept`, undefined, formBody({ csrf: csrfC }));
    expect([r3.status, r3.headers.get("Location")]).toEqual([303, "/"]);
    expect(r3.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=inviteFull;"))).toBe(true);
  });
});

describe("IV13 GET /me/delegations/done/:owner", () => {
  const DONE_B2 = `/me/delegations/done/${B2}`;
  async function accepted() {
    await allowedChannel(C3, A1);
    const t = await makeInvite(await ownerAccess());
    const b = new Browser();
    expect((await inviteLogin(b, t.token, "c3")).headers.get("Location")).toBe(DONE_B2);
    return b;
  }

  it("세션 없음·그 주인과의 최근 위임 없음·형식 밖 주인·창이 지난 뒤는 303 /", async () => {
    const none = await new Browser().get(DONE_B2);
    expect([none.status, none.headers.get("Location")]).toEqual([303, "/"]);
    await allowedChannel(C3, A1);
    const { browser: c } = await webLoginHttp(fake, "c3");
    expect((await c.get(DONE_B2)).headers.get("Location")).toBe("/");
    const b = await accepted();
    expect((await b.get(DONE_B2)).status).toBe(200);
    expect((await b.get(`/me/delegations/done/${A1}`)).headers.get("Location")).toBe("/");
    expect((await b.get("/me/delegations/done/zz")).headers.get("Location")).toBe("/");
    expect((await b.get("/me/delegations/done")).status).toBe(404);
    advance(DONE_WINDOW_MS + 1);
    expect((await b.get(DONE_B2)).headers.get("Location")).toBe("/");
  });

  it("컴퓨터 설치 안내는 휴대폰·카카오톡 UA에서만 있고, 주인 ID가 실린 이 경로는 quiet다", async () => {
    const b = await accepted();
    const text = (ua: string) => b.get(DONE_B2, { "User-Agent": ua }).then((r) => r.text());
    expect(await text(MAC_UA)).not.toContain(COPY.inviteDone.desktop);
    expect(await text(MOBILE_UA)).toContain(COPY.inviteDone.desktop);
    expect(await text(KAKAO_UA)).toContain(COPY.inviteDone.desktop);
    const { isQuietPath } = await import("../../src/routes");
    expect(isQuietPath(DONE_B2)).toBe(true);
    expect(isQuietPath("/me/delegations/leave")).toBe(false);
  });

  it("IV13c 두 탭: 수락 O1의 303을 늦게 따라가도 O1의 결과가 나오고, 그만두기는 O1만 회수한다", async () => {
    await allowedChannel(C3, A1);
    const t1 = await makeInvite(await ownerAccess("b2"));
    const t2 = await makeInvite(await ownerAccess("a1"));
    const { browser: c } = await webLoginHttp(fake, "c3");
    const csrf = csrfIn(await (await c.get(`/invite/${t1.token}`)).text()) ?? "";
    const r1 = await c.post(`/invite/${t1.token}/accept`, undefined, formBody({ csrf }));
    const r2 = await c.post(`/invite/${t2.token}/accept`, undefined, formBody({ csrf }));
    expect([r1.headers.get("Location"), r2.headers.get("Location")]).toEqual([DONE_B2, `/me/delegations/done/${A1}`]);
    const page = await (await c.get(r1.headers.get("Location") ?? "")).text();
    expect(h1Of(page)).toBe(COPY.inviteDone.title(NAME.b2));
    expect(page).toContain(`name="owner" value="${B2}"`);
    expect(page).not.toContain(A1);
    const left = await c.post("/me/delegations/leave", undefined, formBody({ csrf: csrfIn(page) ?? "", owner: B2 }));
    expect(left.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=delegationLeft;"))).toBe(true);
    const rows = await runInDurableObject(store(), (i) => i.db.all<{ owner_channel_id: string; revoked_at: number | null }>("SELECT owner_channel_id, revoked_at FROM delegation ORDER BY owner_channel_id"));
    expect(rows.map((r) => [r.owner_channel_id, r.revoked_at === null])).toEqual([
      [A1, true],
      [B2, false],
    ]);
  });
});

describe("IV14 POST /me/delegations/leave", () => {
  it("형식 밖·중복 owner는 400, 성공은 303 / + delegationLeft, 두 번째는 alreadyDone", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const t = await makeInvite(access);
    const b = new Browser();
    await inviteLogin(b, t.token, "c3");
    const csrf = csrfIn(await (await b.get(`/me/delegations/done/${B2}`)).text()) ?? "";
    expect((await b.post("/me/delegations/leave", undefined, formBody({ csrf, owner: "zz" }))).status).toBe(400);
    expect((await b.post("/me/delegations/leave", undefined, formBody({ csrf }))).status).toBe(400);
    expect((await b.post("/me/delegations/leave", undefined, `csrf=${csrf}&owner=${B2}&owner=${D4}`)).status).toBe(400);
    const me0 = (await (await new AppClient().me(access)).json()) as { editors: unknown[] };
    expect(me0.editors).toHaveLength(1);
    const ok = await b.post("/me/delegations/leave", undefined, formBody({ csrf, owner: B2 }));
    expect([ok.status, ok.headers.get("Location")]).toEqual([303, "/"]);
    expect(ok.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=delegationLeft;"))).toBe(true);
    expect(await (await b.get("/")).text()).toContain(COPY.delegationLeft);
    const me1 = (await (await new AppClient().me(access)).json()) as { editors: unknown[] };
    expect(me1.editors).toEqual([]);
    const again = await b.post("/me/delegations/leave", undefined, formBody({ csrf, owner: B2 }));
    expect(again.headers.getSetCookie().some((l) => l.startsWith("cdl_flash=alreadyDone;"))).toBe(true);
  });
});

describe("IV15 앱 편집자 API", () => {
  it("invite: 200 JSON(키·주소·만료), 다시 만들면 이전 토큰은 404, 오류 갈래", async () => {
    const access = await ownerAccess();
    const res = await api("/api/editors/invite", access);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, string>;
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "inviteUrl"]);
    expect(body.inviteUrl).toMatch(/^http:\/\/localhost:8787\/invite\/cdi_[A-Za-z0-9_-]{43}$/);
    expect(body.expiresAt).toBe(new Date(Date.now() + INVITE_TTL_MS).toISOString());
    const oldPath = new URL(body.inviteUrl ?? "").pathname;
    expect((await new Browser().get(oldPath)).status).toBe(200);
    await api("/api/editors/invite", access);
    expect((await new Browser().get(oldPath)).status).toBe(404);
    // 빈 본문도 받는다
    expect((await api("/api/editors/invite", access, "")).status).toBe(200);
    expect((await api("/api/editors/invite", null)).status).toBe(401);
    expect((await api("/api/editors/invite", access, "x", { "Content-Type": "text/plain" })).status).toBe(400);
    expect((await api("/api/editors/invite", access, "[]")).status).toBe(400);
    // 쿠키만 실으면 401(쿠키는 보지 않는다)
    const { browser: web } = await webLoginHttp(fake, "b2");
    const cookieOnly = await web.send(ORIGIN + "/api/editors/invite", { method: "POST", headers: { "Content-Type": "application/json", Cookie: `cdl_s=${web.jar.get("cdl_s")}` }, body: "{}" });
    expect(cookieOnly.status).toBe(401);
    // CI 토큰 모양·쓰레기 Bearer도 401
    expect((await api("/api/editors/invite", "x")).status).toBe(401);
  });

  it("invite 상한 409 limit · 허가가 빠지면 403", async () => {
    const access = await ownerAccess();
    await fillEditors(10);
    const full = await api("/api/editors/invite", access);
    expect(full.status).toBe(409);
    expect(await full.json()).toEqual({ code: "limit" });
    await store().disallow(B2, A1, ADMINS, Date.now());
    expect((await api("/api/editors/invite", access)).status).toBe(403);
  });

  it("remove: 204 → 404, 형식 밖 400, 기다리는 편집자도 뺀다", async () => {
    await allowedChannel(C3, A1);
    const access = await ownerAccess();
    const t = await makeInvite(access);
    expect((await inviteLogin(new Browser(), t.token, "c3")).headers.get("Location")).toBe(`/me/delegations/done/${B2}`);
    expect((await api("/api/editors/remove", access, { channelId: "zz" })).status).toBe(400);
    expect((await api("/api/editors/remove", access, {})).status).toBe(400);
    expect((await api("/api/editors/remove", access, { channelId: 5 })).status).toBe(400);
    const ok = await api("/api/editors/remove", access, { channelId: C3 });
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    const miss = await api("/api/editors/remove", access, { channelId: C3 });
    expect(miss.status).toBe(404);
    expect(await miss.json()).toEqual({ code: "not_found" });
    // 청구만 된 편집자
    const t2 = await makeInvite(access);
    await inviteLogin(new Browser(), t2.token, "d4");
    const claimed = () => runInDurableObject(store(), (i) => i.db.all("SELECT 1 FROM invite WHERE claimed_channel_id IS NOT NULL"));
    expect(await claimed()).toHaveLength(1);
    expect((await api("/api/editors/remove", access, { channelId: D4 })).status).toBe(204);
    expect(await claimed()).toHaveLength(0);
  });

  it("delegations/leave: 204 → 404", async () => {
    await allowedChannel(C3, A1);
    const owner = await ownerAccess();
    const t = await makeInvite(owner);
    await inviteLogin(new Browser(), t.token, "c3");
    const editor = await ownerAccess("c3");
    expect((await api("/api/delegations/leave", editor, { channelId: "zz" })).status).toBe(400);
    expect((await api("/api/delegations/leave", editor, { channelId: B2 })).status).toBe(204);
    const again = await api("/api/delegations/leave", editor, { channelId: B2 });
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ code: "not_found" });
    expect((await api("/api/delegations/leave", null, { channelId: B2 })).status).toBe(401);
  });

  it("DO 호출 수: 형식 밖 Bearer 0 · 가짜 Bearer check 1 · 성공 check + 동작", async () => {
    const access = await ownerAccess();
    const { send, calls } = countingSend();
    expect((await api("/api/editors/invite", "x", {}, {}, send)).status).toBe(401);
    expect((await api("/api/editors/remove", access.replace("cda_", "cdr_"), { channelId: C3 }, {}, send)).status).toBe(401);
    expect(calls).toEqual([]);
    expect((await api("/api/editors/invite", "cda_" + "A".repeat(43), {}, {}, send)).status).toBe(401);
    expect(calls).toEqual(["check"]);
    calls.length = 0;
    expect((await api("/api/editors/invite", access, {}, {}, send)).status).toBe(200);
    expect(calls).toEqual(["check", "createInvite"]);
    calls.length = 0;
    // 본문 오류는 check 전에 거른다
    expect((await api("/api/editors/remove", access, { channelId: "zz" }, {}, send)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("IV16 배포 호환(106 (차) ⑤)", () => {
  const PROD_ORIGIN = "https://worker.example.invalid";
  // 운영 모드 설정: 출처는 https, 치지직 주소는 운영 값, dev 전용 키는 비운다(빈 문자열은 없는 것과 같다)
  const PROD_PATCH = {
    PUBLIC_ORIGIN: PROD_ORIGIN,
    CHZZK_REDIRECT_URI: "",
    CHZZK_AUTHORIZE_URL: "https://chzzk.naver.com/account-interlock",
    CHZZK_API_BASE: "https://openapi.chzzk.naver.com",
    START_RATE_10M: "",
  };

  it("IV16a 운영 모드에서도 앱 편집자 API 셋이 열려 있다(107)", async () => {
    const access = await ownerAccess();
    const { send, calls } = countingSend(PROD_PATCH);
    const post = (path: string, body: object) =>
      send(PROD_ORIGIN + path, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` }, body: JSON.stringify(body) });
    const invite = await post("/api/editors/invite", {});
    expect(invite.status).toBe(200);
    expect(((await invite.json()) as { inviteUrl: string }).inviteUrl.startsWith(PROD_ORIGIN + "/invite/")).toBe(true);
    expect(calls).toEqual(["check", "createInvite"]);
    // 대상이 없으면 닫힌 것이 아니라 열린 채로 not_found(또는 멱등 204)다
    for (const [path, body] of [
      ["/api/editors/remove", { channelId: C3 }],
      ["/api/delegations/leave", { channelId: B2 }],
    ] as const) {
      const res = await post(path, body);
      if (res.status === 404) expect(((await res.json()) as { code: string }).code).not.toBe("not_enabled");
      else expect(res.status).toBe(204);
    }
  });

  it("IV16b 꺼 두면(되돌리기 스위치) Bearer·본문보다 먼저 404 not_enabled, DO 0회", async () => {
    const ctx = { config: { editorApi: false } } as unknown as Ctx;
    for (const handler of [editorsInvite, editorsRemove, delegationsLeave]) {
      const res = await handler(new Request("https://worker.example.invalid/x", { method: "POST" }), ctx);
      expect([res.status, await res.json()]).toEqual([404, { code: "not_enabled" }]);
    }
  });

  it("GET /invite/:token이 invitePage RPC 없는 옛 DO를 만나면 500 JSON이 아니라 안내 페이지(503)", async () => {
    const t = await makeInvite(await ownerAccess());
    const oldDo = {
      idFromName: () => ({}),
      get: () => ({
        // workerd 1.20261001의 실제 문구(worker-rpc의 JSG_EXCEPTION(TypeError))
        invitePage: () => Promise.reject(new TypeError('The RPC receiver does not implement the method "invitePage".')),
      }),
    };
    const res = await viaEnv({ AUTH: oldDo })(`${ORIGIN}/invite/${t.token}`, { method: "GET" });
    expect(res.status).toBe(503);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    const text = await res.text();
    expect(h1Of(text)).toBe(COPY.invite.unavailable.title);
    expect(text).toContain(COPY.retryLater.body);
    expect(text).not.toContain(t.token);
  });

  it("GET /invite/:token: 옛 DO가 아닌 다른 DO 예외는 배포 창 안내로 덮지 않는다(500 internal, 응답 코드로 구분된다)", async () => {
    const t = await makeInvite(await ownerAccess());
    for (const err of [new Error("SQLITE_ERROR: boom"), new TypeError("Cannot read properties of undefined (reading 'x')"), new TypeError('The RPC receiver does not implement the method "other".')]) {
      const broken = { idFromName: () => ({}), get: () => ({ invitePage: () => Promise.reject(err) }) };
      const res = await viaEnv({ AUTH: broken })(`${ORIGIN}/invite/${t.token}`, { method: "GET" });
      expect([err.message, res.status, await res.json()]).toEqual([err.message, 500, { code: "internal" }]);
    }
  });
});
