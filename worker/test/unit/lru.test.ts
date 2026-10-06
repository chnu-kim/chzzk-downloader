// core/lru(docs/design/worker.md §9.1 SHA256SUMS 해석 캐시)
import { describe, expect, it } from "vitest";
import { Lru } from "../../src/core/lru";

describe("Lru", () => {
  it("가장 오래 쓰지 않은 것부터 지운다(get도 최근으로 올린다)", () => {
    const c = new Lru<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    expect(c.get("a")).toBe(1);
    c.set("c", 3);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(1);
    expect(c.get("c")).toBe(3);
  });

  it("null 값은 적중이다(undefined만 미스)", () => {
    const c = new Lru<string, null>(2);
    c.set("a", null);
    expect(c.get("a")).toBeNull();
    expect(c.get("b")).toBeUndefined();
  });

  it.each([0, 1.5, Number.NaN, -1, Number.POSITIVE_INFINITY])("크기 %s는 RangeError", (n) => {
    expect(() => new Lru(n)).toThrow(RangeError);
  });

  it("clear 뒤 크기는 0", () => {
    const c = new Lru<string, number>(3);
    c.set("a", 1);
    c.set("b", 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.get("a")).toBeUndefined();
  });

  it("같은 키를 다시 set하면 크기가 늘지 않고 값이 바뀐다", () => {
    const c = new Lru<string, number>(3);
    c.set("a", 1);
    c.set("a", 2);
    expect(c.size).toBe(1);
    expect(c.get("a")).toBe(2);
  });

  it("같은 키를 다시 set하면 최근으로 올라간다", () => {
    const c = new Lru<string, number>(2);
    c.set("a", 1);
    c.set("b", 2);
    c.set("a", 3);
    c.set("c", 4);
    expect(c.get("b")).toBeUndefined();
    expect(c.get("a")).toBe(3);
  });
});
