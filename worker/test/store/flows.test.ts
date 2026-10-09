// 로그인 흐름(worker.md 구현 중 변경 18·19·88·89): 스로틀·상한, 상태 전이, finish·redeem 표.
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { loopbackState } from "../../src/core/loopback";
import { isSecret, isToken, newSecret, sha256B64url } from "../../src/core/token";
import { FLOW_CAP, liveFlowCount, MEMORY_KEYS_MAX, throttle, type StartWindow } from "../../src/store/flows";
import { sweep } from "../../src/store/sweep";
import { A1, ADMINS, B2, C3, PORT, T0, appLogin, begin, freshStub, meter, query, sha, webLogin } from "./helpers";

const start = (stub: ReturnType<typeof freshStub>, ip: string | null, limit: number, now: number) =>
  stub.startApp({ port: PORT, verifier: newSecret(), client: "c", ip, limit }, now);

describe("throttle(순수)", () => {
  it("고정 창: 한도, 남은 초, 새 창, 키 분리, 시각 역행, 메모리 상한", () => {
    const m = new Map<string, StartWindow>();
    for (let i = 0; i < 6; i++) expect(throttle(m, "k", 6, T0)).toEqual({ ok: true });
    expect(throttle(m, "k", 6, T0)).toEqual({ ok: false, retryAfterSec: 600 });
    expect(throttle(m, "k", 6, T0 + 599_999)).toEqual({ ok: false, retryAfterSec: 1 });
    expect(throttle(m, "other", 6, T0 + 599_999)).toEqual({ ok: true });
    expect(throttle(m, "k", 6, T0 + 600_000)).toEqual({ ok: true });
    // 창 시작보다 이른 now(동시 요청이 늦게 도착)는 새 창이 아니라 지금 창으로 센다. 남은 초는 창 길이를 넘지 않는다
    for (let i = 0; i < 5; i++) throttle(m, "k", 6, T0 + 600_000);
    expect(throttle(m, "k", 6, T0 + 600_000)).toEqual({ ok: false, retryAfterSec: 600 });
    expect(throttle(m, "k", 6, T0 - 1)).toEqual({ ok: false, retryAfterSec: 600 });
    expect(throttle(m, "k", 6, T0 + 599_999)).toEqual({ ok: false, retryAfterSec: 600 });
    const back = new Map<string, StartWindow>();
    for (let i = 0; i < 6; i++) expect(throttle(back, "k", 6, T0 - i)).toEqual({ ok: true });
    expect(throttle(back, "k", 6, T0 - 6)).toMatchObject({ ok: false });
    expect(back.get("k")).toEqual({ start: T0, count: 6 });
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

  it("now가 뒤섞여 도착해도(동시 요청) 한 IP는 한도를 넘지 못한다", async () => {
    const stub = freshStub();
    // T0는 UTC 일 경계라 그보다 이른 now는 다른 일 번호(다른 키)가 된다. 같은 날 안에서 1ms씩 거꾸로 보낸다
    const base = T0 + 3_600_000;
    for (let i = 0; i < 6; i++) expect((await start(stub, "203.0.113.7", 6, base - i)).ok).toBe(true);
    for (let i = 6; i < 12; i++) expect(await start(stub, "203.0.113.7", 6, base - i)).toEqual({ ok: false, code: "rate_limited", retryAfterSec: 600 });
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 6 }]);
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
    expect(await stub.finish(b.flowId, { type: "cancelled" }, ADMINS, T0 + 60_000)).toMatchObject({ type: "loopback", result: "cancelled" });
    const rows = await query<{ expires_at: number }>(stub, "SELECT expires_at FROM flow WHERE id = ?", b.flowId);
    expect(rows).toEqual([{ expires_at: T0 + 10 * 60_000 }]);
  });

  it("startApp 입력 검사: verifier 모양, 옛 위치 인자, 포트 범위, client 정리", async () => {
    const stub = freshStub();
    const ok = { port: PORT, client: "c", ip: "203.0.113.1", limit: 6 };
    expect(await stub.startApp({ ...ok, verifier: "A".repeat(42) }, T0)).toEqual({ ok: false, code: "bad_request" });
    // 배포 중 옛 isolate의 위치 인자 호출은 객체 검사에서 bad_request
    expect(await (stub.startApp as any)(newSecret(), "c", "203.0.113.1", 6, T0)).toEqual({ ok: false, code: "bad_request" });
    for (const port of [1023, 65536, 80.5, "8080"]) {
      // DO 안에서 직접 불러 던진 예외를 잡는다(원격 RPC의 거절은 처리 안 된 거절로 새기도 한다)
      const err = await runInDurableObject(stub, async (i) => {
        try {
          await i.startApp({ ...ok, verifier: newSecret(), port } as never, T0);
          return null;
        } catch (e) {
          return (e as Error).name;
        }
      });
      expect(err).toBe("RangeError");
    }
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
    expect((await stub.startApp({ ...ok, verifier: newSecret() }, T0)).ok).toBe(true);
    expect(await query(stub, "SELECT port, user_code, grant_hash, grant_exp FROM flow")).toEqual([{ port: PORT, user_code: null, grant_hash: null, grant_exp: null }]);
    const other = freshStub();
    const r = await other.startApp({ ...ok, verifier: newSecret(), client: "x".repeat(60) + "\u0007\u0001" + "y".repeat(10) }, T0);
    expect(r.ok).toBe(true);
    const [row] = await query<{ client: string }>(other, "SELECT client FROM flow");
    expect(Array.from(row!.client)).toHaveLength(64);
    expect(row!.client).not.toMatch(/\p{Cc}/u);
  });
});

describe("행 수 상한(무료 한도 계산의 전제, 구현 중 변경 19 (마)·24)", () => {
  // 정확값이 아니라 상한이다: 인덱스·열을 바꿔 행 수가 늘면 여기서 걸리고, 19 (마)·24의 계산을 함께 고친다
  const delta = async (stub: ReturnType<typeof freshStub>, f: () => Promise<unknown>) => {
    const b = await meter(stub);
    await f();
    return (await meter(stub)).written - b.written;
  };

  it("공격자 흐름 한 순환(start·[계속]·가짜 콜백·청소) ≤ 12행", async () => {
    const stub = freshStub();
    const verifier = newSecret();
    let handle = "";
    let state = "";
    const w1 = await delta(stub, async () => {
      const s = await stub.startApp({ port: PORT, verifier, client: "c", ip: "203.0.113.1", limit: 6 }, T0);
      if (!s.ok) throw new Error("start");
      handle = s.handle;
    });
    const w2 = await delta(stub, async () => {
      const c = await stub.continueApp(await sha(handle), T0);
      if (!c.ok) throw new Error("continue");
      state = c.state;
    });
    const w3 = await delta(stub, async () => expect(await stub.consume(await sha(state), await sha("wrong"), T0)).toEqual({ ok: false, code: "binder" }));
    const w4 = await delta(stub, () => runInDurableObject(stub, (i) => sweep(i.db, T0 + 10 * 60_000)));
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
    expect(w1 + w2 + w3 + w4).toBeLessThanOrEqual(12);
  });

  it("앱 로그인 한 번(start·[계속]·consume·finish(ok)·redeem·청소) ≤ 31행", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const verifier = await sha256B64url(newSecret());
    let handle = "";
    let state = "";
    let binder = "";
    let flowId = "";
    let grant = "";
    const w1 = await delta(stub, async () => {
      const s = await stub.startApp({ port: PORT, verifier, client: "app/0.2.0 macos", ip: "203.0.113.2", limit: 6 }, T0);
      if (!s.ok) throw new Error("start");
      handle = s.handle;
    });
    const w2 = await delta(stub, async () => {
      const c = await stub.continueApp(await sha(handle), T0);
      if (!c.ok) throw new Error("continue");
      state = c.state;
      binder = c.binder;
    });
    const w3 = await delta(stub, async () => {
      const k = await stub.consume(await sha(state), await sha(binder), T0);
      if (!k.ok) throw new Error("consume");
      flowId = k.flowId;
    });
    const w4 = await delta(stub, async () => {
      const f = await stub.finish(flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
      if (f.type !== "loopback") throw new Error("finish");
      grant = f.grant;
    });
    const w5 = await delta(stub, async () => expect((await stub.redeem(await sha(grant), verifier, ADMINS, T0)).status).toBe("ok"));
    const w6 = await delta(stub, () => runInDurableObject(stub, (i) => sweep(i.db, T0 + 10 * 60_000)));
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
    // 실측 31행 = 6+2+2+9+11+1(start·[계속]·consume·finish·redeem·청소, 구현 중 변경 89 (자): 새 열 3개와 flow_grant 인덱스로 start·finish가 늘었다)
    expect(w1 + w2 + w3 + w4 + w5 + w6).toBeLessThanOrEqual(31);
  });

  it("회전 ≤ 8행, 응답 유실 복구 ≤ 10행", async () => {
    const stub = freshStub();
    const l = await appLogin(stub, { channelId: A1 });
    let child = "";
    const rot = await delta(stub, async () => {
      const r = await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 1000);
      if (!r.ok) throw new Error(r.code);
      child = r.bundle.refreshToken;
    });
    const rec = await delta(stub, async () => {
      const r = await stub.rotate(await sha(l.bundle.refreshToken), ADMINS, T0 + 2000);
      if (!r.ok || !r.recovered) throw new Error("recover");
    });
    expect(child).not.toBe("");
    expect(rot).toBeLessThanOrEqual(8);
    expect(rec).toBeLessThanOrEqual(10);
  });
});

describe("흐름 전이", () => {
  it("continueApp: 정상, 두 번째는 already_used, 모르는 해시·만료는 not_found", async () => {
    const stub = freshStub();
    const s = await stub.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
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
    const s2 = await stub.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.2", limit: 6 }, T0);
    if (!s2.ok) throw new Error("start");
    expect(await stub.continueApp(await sha(s2.handle), T0 + 10 * 60_000)).toEqual({ ok: false, code: "not_found" });
  });

  it("consume: 일회용, binder가 틀리거나 없으면 흐름이 failed/binder", async () => {
    const stub = freshStub();
    const s = await stub.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
    if (!s.ok) throw new Error("start");
    const c = await stub.continueApp(await sha(s.handle), T0);
    if (!c.ok) throw new Error("continue");
    const sh = await sha(c.state);
    expect(await stub.consume(sh, await sha(c.binder), T0)).toEqual({ ok: true, flowId: s.flowId, kind: "app" });
    expect(await stub.consume(sh, await sha(c.binder), T0)).toEqual({ ok: false, code: "not_found" });

    for (const bad of ["wrong", null] as const) {
      const b = freshStub();
      const s2 = await b.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
      if (!s2.ok) throw new Error("start");
      const c2 = await b.continueApp(await sha(s2.handle), T0);
      if (!c2.ok) throw new Error("continue");
      expect(await b.consume(await sha(c2.state), bad === null ? null : await sha(bad), T0)).toEqual({ ok: false, code: "binder" });
      const verifierProbe = await b.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.9", limit: 6 }, T0);
      expect(verifierProbe.ok).toBe(true);
      const row = await query<{ status: string; fail_code: string; state_hash: string | null }>(b, "SELECT status, fail_code, state_hash FROM flow WHERE id = ?", s2.flowId);
      expect(row).toEqual([{ status: "failed", fail_code: "binder", state_hash: null }]);
    }

    // 만료된 state
    const e = freshStub();
    const s3 = await e.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
    if (!s3.ok) throw new Error("start");
    const c3 = await e.continueApp(await sha(s3.handle), T0);
    if (!c3.ok) throw new Error("continue");
    expect(await e.consume(await sha(c3.state), await sha(c3.binder), T0 + 10 * 60_000)).toEqual({ ok: false, code: "not_found" });
  });

  it("binder 실패 흐름에는 grant가 없다", async () => {
    const stub = freshStub();
    const s = await stub.startApp({ port: PORT, verifier: await sha256B64url(newSecret()), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
    if (!s.ok) throw new Error("start");
    const c = await stub.continueApp(await sha(s.handle), T0);
    if (!c.ok) throw new Error("continue");
    await stub.consume(await sha(c.state), await sha("wrong"), T0);
    expect(await query(stub, "SELECT status, fail_code, grant_hash, grant_exp FROM flow")).toEqual([{ status: "failed", fail_code: "binder", grant_hash: null, grant_exp: null }]);
  });

  it("port NULL 흐름(배포 전 옛 흐름)", async () => {
    // (ㄱ) start 뒤에 port가 NULL이면 확인 페이지 조회·[계속]이 없는 흐름으로 본다
    const a = freshStub();
    const s = await a.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
    if (!s.ok) throw new Error("start");
    const h = await sha(s.handle);
    await runInDurableObject(a, (i) => i.db.run("UPDATE flow SET port = NULL"));
    expect(await a.loginPage(h, T0)).toBeNull();
    expect(await a.continueApp(h, T0)).toEqual({ ok: false, code: "not_found" });
    // (ㄴ) consume 뒤에 port가 NULL이면 finish는 outcome과 상관없이 failed
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    await runInDurableObject(stub, (i) => i.db.run("UPDATE flow SET port = NULL"));
    expect(await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0)).toEqual({ type: "failed" });
    expect(await query(stub, "SELECT status, fail_code, grant_hash FROM flow")).toEqual([{ status: "failed", fail_code: "user", grant_hash: null }]);
    expect(await query(stub, "SELECT count(*) AS n FROM session")).toEqual([{ n: 0 }]);
  });
});

describe("finish·redeem 표", () => {
  it("허용된 채널: unclaimed 세션 → redeem으로 번들, 흐름은 verifier만 지우고 남는다, 다시 redeem은 not_found", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    const f = await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    if (f.type !== "loopback") throw new Error(f.type);
    expect(f).toMatchObject({ result: "ok", port: PORT });
    expect(isToken("grant", f.grant)).toBe(true);
    expect(f.state).toBe(await loopbackState(b.verifier));
    expect(await query(stub, "SELECT grant_hash, grant_exp FROM flow")).toEqual([{ grant_hash: await sha(f.grant), grant_exp: T0 + 120_000 }]);
    expect(await query(stub, "SELECT status, access_hash FROM session")).toEqual([{ status: "unclaimed", access_hash: null }]);
    const gh = await sha(f.grant);
    const c = await stub.redeem(gh, b.verifier, ADMINS, T0);
    if (c.status !== "ok") throw new Error(c.status);
    expect(c.bundle).toMatchObject({ channelId: B2, channelName: "채널", isAdmin: false, accessExpiresAt: T0 + 86_400_000, refreshExpiresAt: T0 + 30 * 86_400_000 });
    expect(isToken("access", c.bundle.accessToken)).toBe(true);
    expect(isToken("refresh", c.bundle.refreshToken)).toBe(true);
    expect(await query(stub, "SELECT status, poll_verifier, session_id, grant_hash, expires_at FROM flow")).toEqual([
      { status: "ok", poll_verifier: null, session_id: null, grant_hash: null, expires_at: T0 + 120_000 },
    ]);
    expect(await stub.doneView(await sha(b.binder), T0 + 1000)).toEqual({ kind: "app", status: "ok", channelName: null, channelId: null });
    expect(await query(stub, "SELECT status FROM session")).toEqual([{ status: "active" }]);
    expect(await stub.redeem(gh, b.verifier, ADMINS, T0 + 1500)).toEqual({ status: "not_found" });
    expect(await stub.doneView(await sha(b.binder), T0 + 119_999)).not.toBeNull();
    expect(await stub.doneView(await sha(b.binder), T0 + 120_000)).toBeNull();
    expect(await runInDurableObject(stub, (i) => liveFlowCount(i.db, T0 + 120_000))).toBe(0);
  });

  it("redeem은 만료를 늦추지 않는다(늦게 수령해도 start+10분 이하)", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    const f = await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0 + 480_000);
    if (f.type !== "loopback") throw new Error(f.type);
    expect((await stub.redeem(await sha(f.grant), b.verifier, ADMINS, T0 + 590_000)).status).toBe("ok");
    expect(await query(stub, "SELECT expires_at FROM flow")).toEqual([{ expires_at: T0 + 600_000 }]);
  });

  it("허용되지 않은 채널: denied + 거부 기록", async () => {
    const stub = freshStub();
    const b = await begin(stub);
    const f = await stub.finish(b.flowId, { type: "user", channelId: C3, channelName: "남의 채널" }, ADMINS, T0);
    if (f.type !== "loopback") throw new Error(f.type);
    expect(f.result).toBe("denied");
    expect(await stub.redeem(await sha(f.grant), b.verifier, ADMINS, T0)).toEqual({ status: "denied", channelName: "남의 채널" });
    expect(await query(stub, "SELECT channel_id, channel_name, attempts FROM denied")).toEqual([{ channel_id: C3, channel_name: "남의 채널", attempts: 1 }]);
    expect(await query(stub, "SELECT count(*) AS n FROM session")).toEqual([{ n: 0 }]);
    expect(await query(stub, "SELECT grant_hash FROM flow")).toEqual([{ grant_hash: null }]);
  });

  it("취소·실패 코드·형식 오류", async () => {
    const cases: [Parameters<ReturnType<typeof freshStub>["finish"]>[1], string, unknown][] = [
      [{ type: "cancelled" }, "cancelled", { status: "cancelled" }],
      [{ type: "failed", code: "token" }, "failed", { status: "failed", code: "token" }],
      [{ type: "failed", code: "timeout" }, "failed", { status: "failed", code: "timeout" }],
      [{ type: "failed", code: "zzz" as "user" }, "failed", { status: "failed", code: "user" }],
      [{ type: "user", channelId: "not-a-channel", channelName: "x" }, "failed", { status: "failed", code: "user_format" }],
    ];
    for (const [outcome, result, want] of cases) {
      const stub = freshStub();
      const b = await begin(stub);
      const f = await stub.finish(b.flowId, outcome, ADMINS, T0);
      if (f.type !== "loopback") throw new Error(f.type);
      expect(f.result).toBe(result);
      expect(await stub.redeem(await sha(f.grant), b.verifier, ADMINS, T0)).toEqual(want);
    }
  });

  it("두 번째 finish는 gone, 틀린 verifier는 not_found이고 쓰지 않는다", async () => {
    const stub = freshStub();
    const b = await begin(stub);
    const f = await stub.finish(b.flowId, { type: "cancelled" }, ADMINS, T0);
    if (f.type !== "loopback") throw new Error(f.type);
    expect(await stub.finish(b.flowId, { type: "cancelled" }, ADMINS, T0)).toEqual({ type: "gone" });
    expect(await stub.finish("x", { type: "cancelled" }, ADMINS, T0)).toEqual({ type: "gone" });
    const gh = await sha(f.grant);
    const before = await meter(stub);
    expect(await stub.redeem(gh, await sha256B64url(newSecret()), ADMINS, T0)).toEqual({ status: "not_found" });
    expect((await meter(stub)).written).toBe(before.written);
    expect(await stub.redeem(gh, b.verifier, ADMINS, T0)).toEqual({ status: "cancelled" });
    expect(await stub.redeem("x", b.verifier, ADMINS, T0)).toEqual({ status: "not_found" });
    expect(await stub.redeem(gh, "x", ADMINS, T0)).toEqual({ status: "not_found" });
  });

  it("grant 만료 경계: 119_999 안은 되고 120_000부터는 not_found", async () => {
    const a = freshStub();
    await a.allow(B2, "", A1, T0);
    const x = await begin(a);
    const fx = await a.finish(x.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    if (fx.type !== "loopback") throw new Error(fx.type);
    expect((await a.redeem(await sha(fx.grant), x.verifier, ADMINS, T0 + 119_999)).status).toBe("ok");
    const y = await begin(a);
    const fy = await a.finish(y.flowId, { type: "cancelled" }, ADMINS, T0);
    if (fy.type !== "loopback") throw new Error(fy.type);
    expect(await a.redeem(await sha(fy.grant), y.verifier, ADMINS, T0 + 120_000)).toEqual({ status: "not_found" });
  });

  it("관리자 채널은 isAdmin, 부트스트랩(admins 빔)은 허용목록에 있어도 거부", async () => {
    const stub = freshStub();
    const a = await appLogin(stub, { channelId: A1 });
    expect(a.bundle.isAdmin).toBe(true);

    const boot = freshStub();
    await boot.allow(B2, "", A1, T0);
    const b = await begin(boot);
    expect(await boot.finish(b.flowId, { type: "user", channelId: B2, channelName: "x" }, [], T0)).toMatchObject({ type: "loopback", result: "denied" });
  });

  it("redeem 전에 허용에서 빠지면 redeem은 denied이고 흐름 행이 사라진다", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    const f = await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    if (f.type !== "loopback") throw new Error(f.type);
    expect(await stub.disallow(B2, A1, ADMINS, T0 + 10)).toEqual({ ok: true });
    expect(await stub.redeem(await sha(f.grant), b.verifier, ADMINS, T0 + 20)).toEqual({ status: "denied", channelName: "채널" });
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
    expect(await query(stub, "SELECT status, revoked_why FROM session")).toEqual([{ status: "revoked", revoked_why: "disallowed" }]);
  });

  it("redeem 때 세션이 없으면 failed/session이고 흐름 행이 사라진다", async () => {
    const stub = freshStub();
    await stub.allow(B2, "", A1, T0);
    const b = await begin(stub);
    const f = await stub.finish(b.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    if (f.type !== "loopback") throw new Error(f.type);
    await runInDurableObject(stub, (i) => i.db.run("DELETE FROM session"));
    expect(await stub.redeem(await sha(f.grant), b.verifier, ADMINS, T0 + 20)).toEqual({ status: "failed", code: "session" });
    expect(await query(stub, "SELECT count(*) AS n FROM flow")).toEqual([{ n: 0 }]);
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
    const v = await stub.doneView(await sha(s.binder), T0 + 1);
    expect(v).toEqual({ kind: "web", status: "denied", channelName: "남", channelId: C3 });
    expect(v).not.toHaveProperty("userCode");
  });

  it("loginPage·doneView", async () => {
    const stub = freshStub();
    const s = await stub.startApp({ port: PORT, verifier: newSecret(), client: "c", ip: "203.0.113.1", limit: 6 }, T0);
    if (!s.ok) throw new Error("start");
    const h = await sha(s.handle);
    expect(await stub.loginPage(h, T0)).toEqual({ status: "started", expiresAt: T0 + 600_000 });
    expect(await stub.loginPage("x", T0)).toBeNull();
    expect(await stub.loginPage(h, T0 + 600_000)).toBeNull();
    const c = await stub.continueApp(h, T0);
    if (!c.ok) throw new Error("continue");
    expect(await stub.doneView(await sha(c.binder), T0)).toBeNull();
    const k = await stub.consume(await sha(c.state), await sha(c.binder), T0);
    if (!k.ok) throw new Error("consume");
    await stub.allow(B2, "", A1, T0);
    await stub.finish(k.flowId, { type: "user", channelId: B2, channelName: "채널" }, ADMINS, T0);
    const v = await stub.doneView(await sha(c.binder), T0);
    expect(v).toEqual({ kind: "app", status: "ok", channelName: null, channelId: null });
    expect(v).not.toHaveProperty("userCode");
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
