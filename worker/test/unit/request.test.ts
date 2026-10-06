// http/request(docs/design/worker.md 구현 중 변경 27 (바)·28): 본문은 크기·형식을 먼저 거르고, 상한을 넘으면 끝까지 읽지 않는다.
import { describe, expect, it } from "vitest";
import { JSON_MAX, readCapped, readJsonObject } from "../../src/http/request";

const URL_ = "http://localhost:8787/auth/start";
const JSON_TYPE = { "Content-Type": "application/json" };

/** 끝없는 스트림(청크마다 size 바이트). pull·cancel 횟수를 센다 */
function endless(size: number) {
  const seen = { pulls: 0, cancelled: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      seen.pulls++;
      c.enqueue(new Uint8Array(size).fill(0x20));
    },
    cancel() {
      seen.cancelled++;
    },
  });
  return { stream, seen };
}

/** Request 모양(헤더 + 본문 스트림). 런타임이 Content-Length를 다시 쓰지 않게 직접 만든다 */
const fakeReq = (headers: Record<string, string>, body: ReadableStream<Uint8Array> | null) => ({ headers: new Headers(headers), body }) as unknown as Request;

describe("readCapped", () => {
  it("Content-Length가 상한을 넘으면 한 바이트도 읽지 않고 끊는다", async () => {
    const { stream, seen } = endless(1024);
    expect(await readCapped(fakeReq({ ...JSON_TYPE, "Content-Length": String(8 * 1024 * 1024) }, stream))).toBeNull();
    expect(seen.cancelled).toBe(1);
    // ReadableStream은 만들 때 한 번 미리 당길 수 있다. 그 뒤로는 당기지 않는다
    expect(seen.pulls).toBeLessThanOrEqual(1);
  });

  it.each(["abc", "-1", "1e9", "1".repeat(16)])("Content-Length %s(숫자가 아님·너무 김)도 읽지 않는다", async (len) => {
    const { stream, seen } = endless(1);
    expect(await readCapped(fakeReq({ "Content-Length": len }, stream))).toBeNull();
    expect(seen.cancelled).toBe(1);
  });

  it("길이를 모르는 스트림은 상한을 넘는 순간 끊는다", async () => {
    const { stream, seen } = endless(1000);
    expect(await readCapped(fakeReq(JSON_TYPE, stream))).toBeNull();
    expect(seen.cancelled).toBe(1);
    expect(seen.pulls).toBeLessThanOrEqual(Math.ceil(JSON_MAX / 1000) + 2);
  });

  it("상한 정각은 통과, 1바이트 넘으면 null", async () => {
    expect(await readCapped(new Request(URL_, { method: "POST", body: "x".repeat(JSON_MAX) }))).toBe("x".repeat(JSON_MAX));
    expect(await readCapped(new Request(URL_, { method: "POST", body: "x".repeat(JSON_MAX + 1) }))).toBeNull();
  });

  it("본문 없음은 빈 문자열, 올바르지 않은 UTF-8은 null", async () => {
    expect(await readCapped(new Request(URL_, { method: "POST" }))).toBe("");
    expect(await readCapped(new Request(URL_, { method: "POST", body: new Uint8Array([0x7b, 0xff, 0x7d]) }))).toBeNull();
  });
});

describe("readJsonObject", () => {
  const post = (body: BodyInit | undefined, headers: Record<string, string> = JSON_TYPE) => new Request(URL_, { method: "POST", headers, body });

  it("JSON 객체만", async () => {
    expect(await readJsonObject(post('{"a":1}'))).toEqual({ a: 1 });
    expect(await readJsonObject(post('{"a":1}', { "Content-Type": "Application/JSON; charset=utf-8" }))).toEqual({ a: 1 });
    for (const bad of ["[1]", "null", "1", '"s"', "{"]) expect(await readJsonObject(post(bad))).toBeNull();
  });

  it("빈 본문: allowEmpty면 Content-Type과 무관하게 {}", async () => {
    expect(await readJsonObject(post(""), true)).toEqual({});
    expect(await readJsonObject(post(undefined, {}), true)).toEqual({});
    expect(await readJsonObject(post("", { "Content-Type": "text/plain" }), true)).toEqual({});
    expect(await readJsonObject(post(""))).toBeNull();
  });

  it("JSON이 아닌 본문은 읽지 않고 null", async () => {
    const { stream, seen } = endless(10);
    expect(await readJsonObject(fakeReq({ "Content-Type": "text/plain" }, stream), true)).toBeNull();
    expect(seen.cancelled).toBe(1);
    expect(await readJsonObject(post('{"a":1}', { "Content-Type": "text/plain" }))).toBeNull();
  });

  it("상한을 넘는 JSON은 null(본문 전체를 읽지 않는다)", async () => {
    const { stream, seen } = endless(1000);
    expect(await readJsonObject(fakeReq(JSON_TYPE, stream))).toBeNull();
    expect(seen.cancelled).toBe(1);
    expect(await readJsonObject(post(JSON.stringify({ a: "x".repeat(JSON_MAX) })))).toBeNull();
  });
});
