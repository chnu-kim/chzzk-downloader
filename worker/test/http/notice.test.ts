// GET /notice(http/notice.ts, 계약 §2.8): 늘 200 JSON·no-store, R2 get 요청당 최대 1회(isolate 캐시 60초), fail-open(없음·해석 실패·R2 예외 → null), 로그는 reason·errorName뿐.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTICE_KEY } from "../../src/core/keys";
import { NOTICE_CACHE, NOTICE_CACHE_MS } from "../../src/http/notice";
import { advance, HOUR, ORIGIN, useClock, viaEnv } from "./harness";

const enc = (v: unknown) => new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v));
const GOOD = { id: "maint-1", level: "info", kinds: ["vod"], text: "점검 중이라 잠시 느릴 수 있어요", expiresAt: "2099-01-01T00:00:00Z" };

interface FakeObject {
  readonly bytes: Uint8Array;
  readonly uploaded: number;
}

/** R2 바인딩 대역: NOTICE_KEY 하나만 안다. get·head 호출 수와 키를 센다. 던지기·없음·크기 조절을 고른다 */
function fakeDist(o: { object?: FakeObject; throws?: Error; size?: number }) {
  const gets: string[] = [];
  const bucket = {
    async get(key: string) {
      gets.push(key);
      if (o.throws) throw o.throws;
      if (o.object === undefined || key !== NOTICE_KEY) return null;
      const { bytes, uploaded } = o.object;
      return {
        size: o.size ?? bytes.byteLength,
        uploaded: new Date(uploaded),
        body: new Response(bytes).body,
        arrayBuffer: async () => bytes.slice().buffer,
      };
    },
    async head() {
      throw new Error("head 금지");
    },
  };
  return { dist: bucket as unknown as R2Bucket, gets };
}

let t0 = 0;
beforeEach(() => {
  t0 = useClock();
  NOTICE_CACHE.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const call = async (dist: R2Bucket) => viaEnv({ DIST: dist })(`${ORIGIN}/notice`, { method: "GET" });
const logs = (spy: { mock: { calls: readonly (readonly unknown[])[] } }) => spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

describe("GET /notice", () => {
  it("공지 없음: 200 {schema:1, notice:null}, application/json, no-store, R2 get 1회", async () => {
    const f = fakeDist({});
    const res = await call(f.dist);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("application/json");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ schema: 1, notice: null });
    expect(f.gets).toEqual([NOTICE_KEY]);
  });

  it("공지 있음: 필드 다섯 개(실효 만료)가 그대로 나간다", async () => {
    const f = fakeDist({ object: { bytes: enc(GOOD), uploaded: t0 } });
    const body = (await (await call(f.dist)).json()) as { schema: number; notice: Record<string, unknown> };
    expect(body.schema).toBe(1);
    // 올린 시각 + 72시간이 2099년보다 이르다
    expect(body.notice).toEqual({ id: "maint-1", level: "info", kinds: ["vod"], text: GOOD.text, expiresAt: new Date(t0 + 72 * HOUR).toISOString() });
  });

  it("만료: 올린 시각 + 72시간이 지나면 null", async () => {
    const f = fakeDist({ object: { bytes: enc(GOOD), uploaded: t0 - 72 * HOUR } });
    expect(await (await call(f.dist)).json()).toEqual({ schema: 1, notice: null });
  });

  it("expiresAt이 지났으면 null", async () => {
    const f = fakeDist({ object: { bytes: enc({ ...GOOD, expiresAt: "2000-01-01T00:00:00Z" }), uploaded: t0 } });
    expect(await (await call(f.dist)).json()).toEqual({ schema: 1, notice: null });
  });

  it("요청당 R2 get은 1회이고 60초 안 재요청은 R2를 읽지 않는다(캐시), 60초가 지나면 다시 읽는다", async () => {
    const f = fakeDist({ object: { bytes: enc(GOOD), uploaded: t0 } });
    await call(f.dist);
    await call(f.dist);
    advance(NOTICE_CACHE_MS - 1);
    await call(f.dist);
    expect(f.gets).toHaveLength(1);
    advance(1);
    await call(f.dist);
    expect(f.gets).toHaveLength(2);
  });

  it("없음(null)도 캐시한다", async () => {
    const f = fakeDist({});
    await call(f.dist);
    await call(f.dist);
    expect(f.gets).toHaveLength(1);
  });

  it("캐시한 공지도 실효 만료가 지나면 내려간다(R2를 다시 읽지 않고)", async () => {
    // 올린 지 71시간 59분 59초: 캐시 60초 안에 72시간을 넘긴다
    const f = fakeDist({ object: { bytes: enc(GOOD), uploaded: t0 - 72 * HOUR + 30_000 } });
    expect(((await (await call(f.dist)).json()) as { notice: unknown }).notice).not.toBeNull();
    advance(31_000);
    expect(await (await call(f.dist)).json()).toEqual({ schema: 1, notice: null });
    expect(f.gets).toHaveLength(1);
  });
});

describe("fail-open", () => {
  it("해석 실패(형식 밖)는 null이고 notice.invalid를 reason만 남긴다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeDist({ object: { bytes: enc({ ...GOOD, text: "<b>x</b>" }), uploaded: t0 } });
    expect(await (await call(f.dist)).json()).toEqual({ schema: 1, notice: null });
    expect(logs(spy)).toContainEqual({ event: "notice.invalid", level: "warn", reason: "text" });
  });

  it("깨진 JSON도 null + notice.invalid(json)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeDist({ object: { bytes: enc("{"), uploaded: t0 } });
    expect(await (await call(f.dist)).json()).toEqual({ schema: 1, notice: null });
    expect(logs(spy)).toContainEqual({ event: "notice.invalid", level: "warn", reason: "json" });
  });

  it("크기 초과는 본문을 읽지 않고 null + notice.invalid(too_large)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const f = fakeDist({ object: { bytes: enc(GOOD), uploaded: t0 }, size: 1_000_000 });
    expect(await (await call(f.dist)).json()).toEqual({ schema: 1, notice: null });
    expect(logs(spy)).toContainEqual({ event: "notice.invalid", level: "warn", reason: "too_large" });
  });

  it("R2가 던져도 200 null이고 notice.unavailable은 errorName만 남긴다. 던진 결과는 캐시하지 않는다", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const bad = fakeDist({ throws: new TypeError("secret detail: https://x.example/?token=abc") });
    const res = await call(bad.dist);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ schema: 1, notice: null });
    const out = logs(spy);
    expect(out).toContainEqual({ event: "notice.unavailable", level: "warn", errorName: "TypeError" });
    expect(JSON.stringify(out)).not.toContain("secret detail");
    // 같은 isolate의 다음 요청(정상 R2)은 공지를 본다
    const ok = fakeDist({ object: { bytes: enc(GOOD), uploaded: t0 } });
    expect(((await (await call(ok.dist)).json()) as { notice: unknown }).notice).not.toBeNull();
  });
});
