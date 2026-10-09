// 공격자가 정하는 문자열(채널 이름·메모·기기 정보)이 관리·내 기기 화면에서 이스케이프되는지(docs/design/worker.md §8.1, W6 수락 기준).
// 이름·메모에는 HTML과 bidi·제로폭 문자를 넣는다. 저장 때 store가 제어·bidi 문자를 지우고, 화면은 이스케이프한다(두 겹).
// 따로 둔 파일이라 이 파일의 DO 저장소에는 이 테스트의 데이터만 있다.
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { newSecret, sha256B64url, sha256Hex } from "../../src/core/token";
import { LATEST_VIEW_CACHE } from "../../src/http/landing";
import { SUMS_CACHE } from "../../src/http/releases";
import { createFakeChzzk, type FakeChzzk } from "../fake-chzzk.mjs";
import { installFakeChzzk, type FakeNet } from "../network";
import { A1, ADMINS, B2, C3, D4, PORT } from "../store/helpers";
import { resetStore, store, useClock, webLoginHttp } from "./harness";
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
});

afterEach(() => {
  expect(net.unhandled).toEqual([]);
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const BIDI = ["\u202E", "\u200B", "\u2066"];

it("관리 화면과 내 기기 화면은 HTML·bidi 문자를 이스케이프하거나 지운다", async () => {
  const now = Date.now();
  const s = store();

  // 거부 기록 둘: c3는 웹 흐름(가짜 계정 이름에 스크립트 태그), d4는 store 직접(이름에 bidi·제로폭·태그)
  fake.state.account = "c3";
  const denied = await webLoginHttp(fake, "c3");
  expect(denied.callback.headers.get("Location")).toBe("/auth/done?r=denied");
  const b = await s.startApp({ port: PORT, verifier: await sha256B64url(newSecret()), client: "app/0.2.0 macos", ip: "203.0.113.10", limit: 1000 }, now);
  if (!b.ok) throw new Error("startApp");
  const c = await s.continueApp(await sha256Hex(b.handle), now);
  if (!c.ok) throw new Error("continueApp");
  const k = await s.consume(await sha256Hex(c.state), await sha256Hex(c.binder), now);
  if (!k.ok) throw new Error("consume");
  expect(await s.finish(k.flowId, { type: "user", channelId: D4, channelName: "\u202E관리자\u200B<b>" }, ADMINS, now)).toMatchObject({ type: "loopback", result: "denied" });

  // 메모에 태그와 bidi 문자
  expect((await s.allow(B2, "<img src=x onerror=alert(1)>\u2066", A1, now)).ok).toBe(true);

  // 기기 정보가 HTML인 앱 세션
  const verifier = await sha256B64url(newSecret());
  const app = await s.startApp({ port: PORT, verifier, client: "<script>c</script>", ip: "203.0.113.11", limit: 1000 }, now);
  if (!app.ok) throw new Error("startApp");
  const ac = await s.continueApp(await sha256Hex(app.handle), now);
  if (!ac.ok) throw new Error("continueApp");
  const ak = await s.consume(await sha256Hex(ac.state), await sha256Hex(ac.binder), now);
  if (!ak.ok) throw new Error("consume");
  const af = await s.finish(ak.flowId, { type: "user", channelId: B2, channelName: "허용 채널" }, ADMINS, now);
  expect(af).toMatchObject({ type: "loopback", result: "ok", port: PORT });
  if (af.type !== "loopback") throw new Error("finish");
  const claimed = await s.redeem(await sha256Hex(af.grant), verifier, ADMINS, now);
  expect(claimed.status).toBe("ok");

  const admin = (await webLoginHttp(fake, "a1")).browser;
  const member = (await webLoginHttp(fake, "b2")).browser;
  const adminPage = await (await admin.get("/admin")).text();
  const memberPage = await (await member.get("/")).text();

  for (const page of [adminPage, memberPage]) {
    for (const bad of ["<script", "<img", "<b>"]) expect(page).not.toContain(bad);
    for (const ch of BIDI) expect(page).not.toContain(ch);
  }
  expect(adminPage).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&quot;&#39;&amp;합성거부C3");
  expect(adminPage).toContain("관리자&lt;b&gt;");
  expect(adminPage).toContain("&lt;img src=x onerror=alert(1)&gt;");
  expect(adminPage).toContain("&lt;script&gt;c&lt;/script&gt;");
  expect(memberPage).toContain("&lt;script&gt;c&lt;/script&gt;");
  // 거부 기록의 채널 ID는 그대로 보인다(관리자가 [허용]을 누를 근거)
  expect(adminPage).toContain(C3);
  expect(adminPage).toContain(D4);
});

it("메모의 따옴표는 이스케이프된다(속성을 닫고 이벤트를 심는 입력)", async () => {
  const s = store();
  const now = Date.now();
  await s.allow(B2, '" onfocus="alert(1)', A1, now);
  const admin = (await webLoginHttp(fake, "a1")).browser;
  const page = await (await admin.get("/admin")).text();
  expect(page).not.toContain('" onfocus="');
  expect(page).toContain("&quot; onfocus=&quot;alert(1)");
});
