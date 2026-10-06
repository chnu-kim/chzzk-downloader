// core/conditional(docs/design/worker.md §9.2, 구현 중 변경 31 (라)): If-None-Match 약한 비교. 던지지 않는다.
import { describe, expect, it } from "vitest";
import { ifNoneMatchHit, IF_NONE_MATCH_MAX } from "../../src/core/conditional";

const ETAG = '"abc"';

describe("ifNoneMatchHit", () => {
  it.each([
    [null, false],
    ['"abc"', true],
    ['W/"abc"', true],
    ['"x", "abc"', true],
    ['"x"', false],
    ["*", true],
    [" * ", true],
    ["abc", false],
    ['""', false],
    ['"ab c"', false],
    ["x".repeat(IF_NONE_MATCH_MAX + 1), false],
    ['garbage, "abc"', true],
    ['"abc', false],
    ['W/W/"abc"', false],
    ["", false],
  ])("%j → %s", (header, want) => {
    expect(ifNoneMatchHit(header, ETAG)).toBe(want);
  });

  it("etag가 약한 값이어도 비교한다", () => {
    expect(ifNoneMatchHit('"abc"', 'W/"abc"')).toBe(true);
  });

  it("상한 정확히 1024자는 처리한다", () => {
    const pad = " ".repeat(IF_NONE_MATCH_MAX - ETAG.length);
    expect(ifNoneMatchHit(ETAG + pad, ETAG)).toBe(true);
  });
});
