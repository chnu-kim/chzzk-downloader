// core/range(docs/design/worker.md §9.2, 구현 중 변경 14 (마)): 단일 범위만 인정, 나머지는 무시(200 전체) 또는 416.
import { describe, expect, it } from "vitest";
import { contentRange, normalizeR2Range, parseRange, type RangeSpec, rangeHeader, resolveRange, unsatisfiedRange } from "../../src/core/range";

const at = (h: string | null, size: number) => {
  const spec = parseRange(h);
  return spec === null ? "ignore" : resolveRange(spec, size);
};

describe("성공(206)", () => {
  it.each([
    ["bytes=0-0", 10, { offset: 0, length: 1 }],
    ["bytes=0-", 10, { offset: 0, length: 10 }],
    ["bytes=5-9", 10, { offset: 5, length: 5 }],
    ["bytes=5-999", 10, { offset: 5, length: 5 }],
    ["bytes=9-9", 10, { offset: 9, length: 1 }],
    ["bytes=-3", 10, { offset: 7, length: 3 }],
    ["bytes=-999", 10, { offset: 0, length: 10 }],
    ["BYTES=0-1", 10, { offset: 0, length: 2 }],
    ["Bytes=0-1", 10, { offset: 0, length: 2 }],
    ["bytes=000-001", 10, { offset: 0, length: 2 }],
  ])("%s / size %d", (h, size, want) => {
    expect(at(h, size)).toEqual(want);
  });
});

describe("416", () => {
  it.each([
    ["bytes=10-", 10],
    ["bytes=10-20", 10],
    ["bytes=-0", 10],
    ["bytes=0-0", 0],
    ["bytes=0-", 0],
    ["bytes=-1", 0],
    ["bytes=-0", 0],
  ])("%s / size %d", (h, size) => {
    expect(at(h, size)).toBe("unsatisfiable");
  });
  it("크기가 정수가 아니거나 음수면 만족 불가", () => {
    expect(resolveRange({ start: 0, end: null }, -1)).toBe("unsatisfiable");
    expect(resolveRange({ start: 0, end: null }, Number.NaN)).toBe("unsatisfiable");
  });
});

describe("무시(200 전체)", () => {
  it.each(["bytes=1-0", "bytes=0-1,2-3", "bytes= 0-1", "bytes=0 -1", "bytes=0-1 ", "items=0-1", "bytes=-", "bytes=", "bytes=a-b", "bytes=0x1-2", "bytes=+1-2", `bytes=${"1".repeat(16)}-`, `bytes=0-${"9".repeat(16)}`, `bytes=-${"9".repeat(16)}`, "bytes 0-1", ""])(
    "%j",
    (h) => {
      expect(parseRange(h)).toBeNull();
    },
  );
  it("헤더 없음", () => {
    expect(parseRange(null)).toBeNull();
  });
  it("15자리까지는 인정(안전 정수)", () => {
    const n = "9".repeat(15);
    expect(parseRange(`bytes=${n}-`)).toEqual({ start: Number(n), end: null } satisfies RangeSpec);
  });
});

it("모양: a- → {start, end:null}, -n → {suffix}", () => {
  expect(parseRange("bytes=3-")).toEqual({ start: 3, end: null });
  expect(parseRange("bytes=3-4")).toEqual({ start: 3, end: 4 });
  expect(parseRange("bytes=-4")).toEqual({ suffix: 4 });
});

it("Content-Range 문자열", () => {
  expect(contentRange({ offset: 0, length: 1 }, 10)).toBe("bytes 0-0/10");
  expect(contentRange({ offset: 5, length: 5 }, 10)).toBe("bytes 5-9/10");
  expect(unsatisfiedRange(10)).toBe("bytes */10");
  expect(unsatisfiedRange(0)).toBe("bytes */0");
});

describe("rangeHeader: R2에 넘기는 정규화된 헤더", () => {
  it.each([
    [{ start: 0, end: 9 }, "bytes=0-9"],
    [{ start: 5, end: null }, "bytes=5-"],
    [{ suffix: 10 }, "bytes=-10"],
  ] satisfies [RangeSpec, string][])("%j → %s", (spec, want) => {
    expect(rangeHeader(spec)).toBe(want);
  });

  it("왕복: parseRange(rangeHeader(s))는 s와 같다", () => {
    for (const s of [{ start: 0, end: 9 }, { start: 5, end: null }, { suffix: 10 }] satisfies RangeSpec[]) {
      expect(parseRange(rangeHeader(s))).toEqual(s);
    }
  });

  it("요청의 대문자 단위·앞 0은 정규화된다", () => {
    expect(rangeHeader(parseRange("BYTES=000-001") as RangeSpec)).toBe("bytes=0-1");
  });
});

describe("normalizeR2Range: R2 obj.range(모양이 셋) → {offset,length}", () => {
  it.each([
    [undefined, { offset: 0, length: 1024 }],
    [{ offset: 5, length: 10 }, { offset: 5, length: 10 }],
    [{ offset: 5 }, { offset: 5, length: 1019 }],
    [{ length: 10 }, { offset: 0, length: 10 }],
    [{ suffix: 10 }, { offset: 1014, length: 10 }],
    [{ suffix: 99999 }, { offset: 0, length: 1024 }],
    // 요청 길이를 그대로 되돌리는 R2(운영 미실측, 구현 중 변경 33 (가))
    [{ offset: 0, length: 100000 }, { offset: 0, length: 1024 }],
    [{ offset: 1000, length: 9999 }, { offset: 1000, length: 24 }],
    [{ offset: 2000, length: 10 }, { offset: 2000, length: 0 }],
  ])("%j", (r, want) => {
    expect(normalizeR2Range(r, 1024)).toEqual(want);
  });
});
