// core/usercode(docs/design/worker.md §7.1, 구현 중 변경 14 (바)): 32자 알파벳·& 31·"XXXX-XXXX".
import { describe, expect, it } from "vitest";
import { isUserCode, newUserCode, USER_CODE_ALPHABET, userCodeFromBytes } from "../../src/core/usercode";

it("알파벳: 32자, 중복 없음, 0·1·I·O 없음", () => {
  expect(USER_CODE_ALPHABET).toHaveLength(32);
  expect(new Set(USER_CODE_ALPHABET).size).toBe(32);
  for (const c of "01IO") expect(USER_CODE_ALPHABET).not.toContain(c);
  expect(USER_CODE_ALPHABET).toMatch(/^[2-9A-Z]+$/);
});

describe("userCodeFromBytes", () => {
  const b = (x: number) => new Uint8Array(8).fill(x);
  it.each([
    [b(0x00), "2222-2222"],
    [b(0xff), "ZZZZ-ZZZZ"],
    [b(0x1f), "ZZZZ-ZZZZ"],
    [b(0x20), "2222-2222"],
    [new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]), "2345-6789"],
    [new Uint8Array([8, 9, 10, 11, 12, 13, 14, 15]), "ABCD-EFGH"],
  ])("%j → %s", (bytes, want) => {
    expect(userCodeFromBytes(bytes)).toBe(want);
  });
  it.each([7, 9, 0])("%d바이트는 던진다", (n) => {
    expect(() => userCodeFromBytes(new Uint8Array(n))).toThrow(TypeError);
  });
  it("주입한 난수원", () => {
    expect(newUserCode((n) => new Uint8Array(n).fill(0x3f))).toBe("ZZZZ-ZZZZ");
  });
});

describe("isUserCode", () => {
  it.each([
    ["K7QX-4MRA", true],
    ["2222-2222", true],
    ["k7qx-4mra", false],
    ["K7QX-4MRO", false],
    ["K7QX-4MR1", false],
    ["K7QX-4MRI", false],
    ["K7QX4MRA", false],
    ["K7QX-4MRA2", false],
    ["K7Q-X4MRA", false],
    [" K7QX-4MRA", false],
    ["", false],
    [undefined, false],
    [12345678, false],
  ] as const)("%j → %s", (s, want) => {
    expect(isUserCode(s)).toBe(want);
  });
  it("무작위 1000개가 모두 형식을 통과한다", () => {
    for (let i = 0; i < 1000; i++) expect(isUserCode(newUserCode())).toBe(true);
  });
});
