// 로그인 흐름(worker.md 구현 중 변경 18·19): 스로틀·상한·폴링 간격, 상태 전이, finish·claim 표.
import { describe, expect, it } from "vitest";
import { isSecret, isToken, newSecret, sha256B64url } from "../../src/core/token";
import { FLOW_CAP, MEMORY_KEYS_MAX, pollGate, throttle, type StartWindow } from "../../src/store/flows";
import { A1, ADMINS, B2, C3, T0, appLogin, begin, freshStub, meter, query, sha, webLogin } from "./helpers";

const start = (stub: ReturnType<typeof freshStub>, ip: string | null, limit: number, now: number) => stub.startApp(newSecret(), "c", ip, limit, now);

describe("throttle·pollGate(순수)", () => {
  it("고정 창: 한도, 남은 초, 새 창, 키 분리, 시각 역행, 메모리 상한", () => {
    const m = new Map<string, StartWindow>();
    for (let i = 0; i < 6; i++) expect(throttle(m, "k", 6, T0)).toEqual({ ok: true });
    expect(throttle(m, "k", 6, T0)).toEqual({ ok: false, retryAfterSec: 600 });
    expect(throttle(m, "k", 6, T0 + 599_999)).toEqual({ ok: false, retryAfterSec: 1 });
    expect(throttle(m, "other", 6, T0 + 599_999)).toEqual({ ok: true });
    expect(throttle(m, "k", 6, T0 + 600_000)).toEqual({ ok: true });
    // 시각이 거꾸로 가면 새 창
    for (let i = 0; i < 5; i++) throttle(m, "k", 6, T0 + 600_000);
    expect(throttle(m, "k", 6, T0 + 600_000)).toEqual({ ok: false, retryAfterSec: 600 });
    expect(throttle(m, "k", 6, T0 - 1)).toEqual({ ok: true });
    // 메모리 상한
    const big = new Map<string, StartWindow>();
    for (let i = 0; i < MEMORY_KEYS_MAX; i++) throttle(big, `k${i}`, 6, T0);
    expect(big.size).toBe(MEMORY_KEYS_MAX);
    expect(throttle(big, "new", 6, T0)).toEqual({ ok: true });
    expect(big.size).toBeLessThanOrEqual(MEMORY_KEYS_MAX);
    expect(big.has("new")).toBe(true);
    // 창이 끝난 항목은 새 키를 넣을 때 먼저 지워진다
    expect(throttle(big, "later", 6, T0 + 600_000)).toEqual({ ok: true });
    expect(big.size).toBe(1);
  });

  it("pollGate: 1500ms 간격, 거절은 기록을 갱신하지 않는다", () => {
    const m = new Map<string, number>();
    expect(pollGate(m, "a", T0)).toBe(true);
    expect(pollGate(m, "a", T0 + 1499)).toBe(false);
    expect(pollGate(m, "a", T0 + 1500)).toBe(true);
    expect(pollGate(m, "a", T0 + 2999)).toBe(false);
    expect(pollGate(m, "a", T0 + 3000)).toBe(true);
    expect(pollGate(m, "b", T0 + 3000)).toBe(true);
    // 거절 때 기록이 갱신되면 1.4초 간격 클라이언트가 영원히 막힌다
    const n = new Map<string, number>();
    expect(pollGate(n, "x", T0)).toBe(true);
    expect(pollGate(n, "x", T0 + 1400)).toBe(false);
    expect(pollGate(n, "x", T0 + 2800)).toBe(true);
    const big = new Map<string, number>();
    for (let i = 0; i < MEMORY_KEYS_MAX; i++) pollGate(big, `p${i}`, T0);
    expect(pollGate(big, "fresh", T0 + 10)).toBe(true);
    expect(big.size).toBeLessThanOrEqual(MEMORY_KEYS_MAX);
  });
});

describe("start 스로틀·상한", () => {
  it("스로틀 429는 읽기·쓰기 0이고 IP 키가 분리된다(IPv6는 /64)", async () => {
    const stub = freshStub();
    for (let i = 0; i < 6; i++) expect((await start(stub, "203.0.113.1", 6, T0)).ok).toBe(true);
    const before = await meter(stub);
    expect(await start(stub, "203.0.113.1", 6, T0)).toEqual({ ok: false, code: "rate_limited", retryAfterSec: 600 });
    expect(await meter(stub)).toEqual(before);
    expect((await start(stub, "203.0.113.2", 6, T0)).ok).toBe(true);
    for (let i = 0; i < 6; i++) expect((await start(stub, "2001:db8:1:2::1", 6, T0)).ok).toBe(true);
    expect(await start(stub, "2001:db8:1:2:ffff::9", 6, T0)).toMatchObject({ ok: false, code: "rate_limited" });
    expect((await start(stub, "2001:db8:1:3::1", 6, T0)).ok).toBe(true);
    for (let i = 0; i < 6; i++) expect((await start(stub, null, 6, T0)).ok).toBe(true);
    expect(await start(stub, null, 6, T0)).toMatchObject({ ok: false, code: "rate_limited" });
    // 앱·웹 start가 한 맵을 같이 쓴다
    expect(await stub.startWeb("203.0.113.1", 6, T0)).toMatchObject({ ok: false, code: "rate_limited" });
    // 한도가 정수가 아니면 기본값 6
    const other = freshStub();
    for (let i = 0; i < 6; i++) expect((await start(other, "203.0.113.5", 0, T0)).ok).toBe(true);
    expect((await start(other, "203.0.113.5", Number.NaN, T0)).ok).toBe(false);
  });

  it("비만료 흐름 32개 상한: busy이고 쓰기 0, 만료되면 다시 열린다", async () => {
    const stub = freshStub();
    for (let i = 0; i < FLOW_CAP - 1; i++) expect((await start(stub, "203.0.113.1", 1000, T0)).ok).toBe(true);
    expect((await stub.startWeb("203.0.113.1", 1000, T0)).ok).toBe(true);
    const before = await meter(stub);
    expect(await start(stub, "203.0.113.1", 1000, T0)).toEqual({ ok: false, code: "busy" });
    expect((await meter(stub)).written).toBe(before.written);
    expect(await stub.startWeb("203.0.113.1", 1000, T0)).toEqual({ ok: false, code: "busy" });
    expect((await start(stub, "203.0.113.1", 1000, T0 + 600_000)).ok).toBe(true);
  });

  it("종결해도 흐름 만료를 앞당기지 않는다(슬롯 순환이 늘지 않는다)", async () => {
    const stub = freshStub();
    const b = await begin(stub);
    expect(await stub.finish(b.flowId, { type: "cancelled" }, ADMINS, T0 + 60_000)).toEqual({ type: "cancelled" });
    const rows = await query<{ expires_at: number }>(stub, "SELECT expires_at FROM flow WHERE id = ?", b.loginId);
    expect(rows).toEqual([{ expires_at: T0 + 10 * 60_000 }]);
  });

  it("폴링 429(too_soon)는 읽기·쓰기 0이다", async () => {
    const stub = freshStub();
    const b = await begin(stub);
    expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0)).toEqual({ status: "pending" });
    const before = await meter(stub);
    expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0 + 1499)).toEqual({ status: "too_soon" });
    expect(await meter(stub)).toEqual(before);
    expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0 + 1500)).toEqual({ status: "pending" });
  });

  it("startApp 입력 검사: verifier 모양, client 정리", async () => {
    const stub = freshStub();
    expect(await stub.startApp("A".repeat(42), "c", "203.0.113.1", 6, T0)).toEqual({ ok: false, code: "bad_request" });
    const r = await stub.startApp(newSecret(), "x".repeat(60) + "\u0007\u0001" + "y".repeat(10), "203.0.113.1", 6, T0);
    expect(r.ok).toBe(true);
    const [row] = await query<{ client: string }>(stub, "SELECT client FROM flow");
    expect(Array.from(row!.client)).toHaveLength(64);
    expect(row!.client).not.toMatch(/\p{Cc}/u);
  });
});

describe("흐름 전이", () => {
  it("continueApp: 정상, 두 번째는 already_used, 모르는 해시·만료는 not_found", async () => {
    const stub = freshStub();
    const s = await stub.startApp(newSecret(), "c", "203.0.113.1", 6, T0);
    if (!s.ok) throw new Error("start");
    const h = await sha(s.handle);
    const c = await stub.continueApp(h, T0 + 1000);
    if (!c.ok) throw new Error("continue");
    expect(c.state).toHaveLength(43);
    expect(isSecret(c.state)).toBe(true);
    expect(isToken("flow", c.binder)).toBe(true);
    expect(await query(stub, "SELECT status FROM flow")).toEqual([{ status: "redirected" }]);
    expect(await stub.continueApp(h, T0 + 2000)).toEqual({ ok: false, code: "already_used" });
    expect(await stub.continueApp(await sha("x"), T0)).toEqual({ ok: false, code: "not_found" });
    expect(await stub.continueApp("x", T0)).toEqual({ ok: false, code: "not_found" });
    const s2 = await stub.startApp(newSecret(), "c", "203.0.113.2", 6, T0);
    if (!s2.ok) throw new Error("start");
    expect(await stub.continueApp(await sha(s2.handle), T0 + 10 * 60_000)).toEqual({ ok: false, code: "not_found" });
  });

  it("consume: 일회용, binder가 틀리거나 없으면 흐름이 failed/binder", async () => {
    const stub = freshStub();
    const s = await stub.startApp(newSecret(), "c", "203.0.113.1", 6, T0);
    if (!s.ok) throw new Error("start");
    const c = await stub.continueApp(await sha(s.handle), T0);
    if (!c.ok) throw new Error("continue");
    const sh = await sha(c.state);
    expect(await stub.consume(sh, await sha(c.binder), T0)).toEqual({ ok: true, flowId: s.loginId, kind: "app" });
    expect(await stub.consume(sh, await sha(c.binder), T0)).toEqual({ ok: false, code: "not_found" });

    for (const bad of ["wrong", null] as const) {
      const b = freshStub();
      const s2 = await b.startApp(newSecret(), "c", "203.0.113.1", 6, T0);
      if (!s2.ok) throw new Error("start");
      const c2 = await b.continueApp(await sha(s2.handle), T0);
      if (!c2.ok) throw new Error("continue");
      expect(await b.consume(await sha(c2.state), bad === null ? null : await sha(bad), T0)).toEqual({ ok: false, code: "binder" });
      const verifierProbe = await b.startApp(newSecret(), "c", "203.0.113.9", 6, T0);
      expect(verifierProbe.ok).toBe(true);
      const row = await query<{ status: string; fail_code: string; state_hash: string | null }>(b, "SELECT status, fail_code, state_hash FROM flow WHERE id = ?", s2.loginId);
      expect(row).toEqual([{ status: "failed", fail_code: "binder", state_hash: null }]);
    }

    // 만료된 state
    const e = freshStub();
    const s3 = await e.startApp(newSecret(), "c", "203.0.113.1", 6, T0);
    if (!s3.ok) throw new Error("start");
    const c3 = await e.continueApp(await sha(s3.handle), T0);
    if (!c3.ok) throw new Error("continue");
    expect(await e.consume(await sha(c3.state), await sha(c3.binder), T0 + 10 * 60_000)).toEqual({ ok: false, code: "not_found" });
  });

  it("binder 실패는 claim에 failed/binder로 보인다", async () => {
    const stub = freshStub();
    const verifier = newSecret();
    const s = await stub.startApp(await sha256B64url(verifier), "c", "203.0.113.1", 6, T0);
    if (!s.ok) throw new Error("start");
    const c = await stub.continueApp(await sha(s.handle), T0);
    if (!c.ok) throw new Error("continue");
    await stub.consume(await sha(c.state), await sha("wrong"), T0);
    const v = await sha256B64url(verifier);
    expect(await stub.claim(s.loginId, v, ADMINS, T0)).toEqual({ status: "failed", code: "binder" });
  });
});

describe("finish·claim 표", () => {
  it("허용된 채널: unclaimed 세션 → claim으로 번들, 흐름 삭제, 다시 claim은 not_found", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    expect(await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0)).toEqual({ type: "ok" });
    expect(await query(stub, "SELECT status, access_hash FROM session")).toEqual([{ status: "unclaimed", access_hash: null }]);
    const c = await stub.claim(b.loginId, b.verifier, ADMINS, T0);
    if (c.status !== "ok") throw new Error(c.status);
    expect(c.bundle).toMatchObject({ channelId: B2, channelName: "채널", isAdmin: false, accessExpiresAt: T0 + 86_400_000, refreshExpiresAt: T0 + 30 * 86_400_000 });
    expect(isToken("access", c.bundle.accessToken)).toBe(true);
    expect(isToken("refresh", c.bundle.refreshToken)).toBe(true);
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
    expect(await query(stub, "SELECT status FROM session")).toEqual([{ status: "active" }]);
    expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0 + 1500)).toEqual({ status: "not_found" });
  });

  it("허용되지 않은 채널: denied + 거부 기록", async () => {
    const stub = freshStub();
    const b = await begin(stub);
    expect(await stub.finish(b.flowId, { type: "user", channelId: C3, channelName: "남의 채널" }, ADMINS, T0)).toEqual({ type: "denied" });
    expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0)).toEqual({ status: "denied", channelName: "남의 채널" });
    expect(await query(stub, "SELECT channel_id, channel_name, attempts FROM denied")).toEqual([{ channel_id: C3, channel_name: "남의 채널", attempts: 1 }]);
    expect(await query(stub, "SELECT count(*) AS n FROM session")).toEqual([{ n: 0 }]);
  });

  it("취소·실패 코드·형식 오류", async () => {
    const cases: [Parameters<ReturnType<typeof freshStub>["finish"]>[1], unknown][] = [
      [{ type: "cancelled" }, { status: "cancelled" }],
      [{ type: "failed", code: "token" }, { status: "failed", code: "token" }],
      [{ type: "failed", code: "timeout" }, { status: "failed", code: "timeout" }],
      [{ type: "failed", code: "zzz" as "user" }, { status: "failed", code: "user" }],
      [{ type: "user", channelId: "not-a-channel", channelName: "x" }, { status: "failed", code: "user_format" }],
    ];
    for (const [outcome, want] of cases) {
      const stub = freshStub();
      const b = await begin(stub);
      await stub.finish(b.flowId, outcome, ADMINS, T0);
      expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0)).toEqual(want);
    }
  });

  it("두 번째 finish는 gone, 모르는 흐름·verifier가 틀리면 not_found", async () => {
    const stub = freshStub();
    const b = await begin(stub);
    expect(await stub.finish(b.flowId, { type: "cancelled" }, ADMINS, T0)).toEqual({ type: "cancelled" });
    expect(await stub.finish(b.flowId, { type: "cancelled" }, ADMINS, T0)).toEqual({ type: "gone" });
    expect(await stub.finish("x", { type: "cancelled" }, ADMINS, T0)).toEqual({ type: "gone" });
    expect(await stub.claim(b.loginId, newSecret(), ADMINS, T0)).toEqual({ status: "not_found" });
    expect(await stub.claim("x", b.verifier, ADMINS, T0)).toEqual({ status: "not_found" });
  });

  it("관리자 채널은 isAdmin, 부트스트랩(admins 빔)은 허용목록에 있어도 거부", async () => {
    const stub = freshStub();
    const a = await appLogin(stub, { channelId: A1 });
    expect(a.bundle.isAdmin).toBe(true);

    const boot = freshStub();
    await boot.allow(B2, "", A1, T0);
    const b = await begin(boot);
    expect(await boot.finish(b.flowId, { type: "user", channelId: B2, channelName: "x" }, [], T0)).toEqual({ type: "denied" });
  });

  it("claim 전에 허용에서 빠지면 claim은 denied", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    expect(await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0)).toEqual({ type: "ok" });
    expect(await stub.disallow(B2, A1, ADMINS, T0 + 10)).toEqual({ ok: true });
    expect(await stub.claim(b.loginId, b.verifier, ADMINS, T0 + 20)).toEqual({ status: "denied", channelName: "채널" });
    expect(await query(stub, "SELECT status, revoked_why FROM session")).toEqual([{ status: "revoked", revoked_why: "disallowed" }]);
  });

  it("웹 흐름: 허용되면 쿠키·csrf, 흐름 행 삭제, webCheck 통과 / 거부는 doneView", async () => {
    const stub = freshStub();
    const w = await webLogin(stub, { channelId: A1 });
    expect(isSecret(w.csrf)).toBe(true);
    expect(w.cookieToken.startsWith("cdw_")).toBe(true);
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
    const ok = await stub.webCheck(await sha(w.cookieToken), ADMINS, T0 + 1000);
    expect(ok).toMatchObject({ ok: true, csrf: w.csrf, channelId: A1, isAdmin: true });

    const s = await stub.startWeb("203.0.113.30", 1000, T0);
    if (!s.ok) throw new Error("startWeb");
    const k = await stub.consume(await sha(s.state), await sha(s.binder), T0);
    if (!k.ok) throw new Error("consume");
    expect(await stub.finish(k.flowId, { type: "user", channelId: C3, channelName: "남" }, ADMINS, T0)).toEqual({ type: "denied" });
    expect(await stub.doneView(await sha(s.binder), T0 + 1)).toEqual({ kind: "web", status: "denied", userCode: null, channelName: "남", channelId: C3 });
  });

  it("loginPage·doneView", async () => {
    const stub = freshStub();
    const s = await stub.startApp(newSecret(), "c", "203.0.113.1", 6, T0);
    if (!s.ok) throw new Error("start");
    const h = await sha(s.handle);
    expect(await stub.loginPage(h, T0)).toEqual({ userCode: s.userCode, status: "started", expiresAt: T0 + 600_000 });
    expect(await stub.loginPage("x", T0)).toBeNull();
    expect(await stub.loginPage(h, T0 + 600_000)).toBeNull();
    const c = await stub.continueApp(h, T0);
    if (!c.ok) throw new Error("continue");
    expect(await stub.doneView(await sha(c.binder), T0)).toBeNull();
    const k = await stub.consume(await sha(c.state), await sha(c.binder), T0);
    if (!k.ok) throw new Error("consume");
    await stub.allow(B2, "", A1, T0);
    await stub.finish(k.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    expect(await stub.doneView(await sha(c.binder), T0)).toEqual({ kind: "app", status: "ok", userCode: s.userCode, channelName: null, channelId: null });
    expect(await stub.doneView(await sha(c.binder), T0 + 600_000)).toBeNull();
    expect(await stub.doneView("x", T0)).toBeNull();
  });

  it("허용된 채널이 로그인하면 허용목록의 이름이 갱신된다", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    await appLogin(stub, { name: "새 이름" });
    expect(await query(stub, "SELECT channel_name FROM allowlist WHERE channel_id = ?", B2)).toEqual([{ channel_name: "새 이름" }]);
  });
});
