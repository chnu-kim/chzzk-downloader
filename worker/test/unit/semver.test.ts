// core/semver(docs/design/worker.md §9.3, 구현 중 변경 14 (다)). 벡터는 xtask/src/semver.rs와 같은 파일을 읽는다:
// xtask/testdata/semver-vectors.json(한쪽만 고치지 않는다).
import { describe, expect, it } from "vitest";
import vectorsText from "../../../xtask/testdata/semver-vectors.json?raw";
import { compareVersions, parseVersion, type Version } from "../../src/core/semver";

interface Vectors {
  readonly cmp: readonly (readonly [string, string, -1 | 0 | 1])[];
  readonly valid: readonly string[];
  readonly invalid: readonly string[];
}
const V = JSON.parse(vectorsText) as Vectors;

const parse = (s: string): Version => {
  const v = parseVersion(s);
  if (v === null) throw new Error(`해석 실패: ${s}`);
  return v;
};

describe("공유 벡터", () => {
  it("비지 않았다", () => {
    expect(V.cmp.length).toBeGreaterThanOrEqual(10);
    expect(V.invalid.length).toBeGreaterThanOrEqual(10);
    expect(V.valid.length).toBeGreaterThanOrEqual(1);
  });

  it.each(V.cmp.map((r) => [...r]))("cmp(%s, %s) = %d, 역방향은 부호 반대", (a, b, want) => {
    expect(compareVersions(parse(a as string), parse(b as string))).toBe(want);
    expect(compareVersions(parse(b as string), parse(a as string))).toBe(-(want as number) || 0);
  });

  it.each(V.valid.map((s) => [s]))("valid %j", (s) => {
    expect(parseVersion(s)).not.toBeNull();
  });

  it.each(V.invalid.map((s) => [s]))("invalid %j", (s) => {
    expect(parseVersion(s)).toBeNull();
  });
});

describe("worker 쪽 추가 사례", () => {
  it("모양: BigInt u64·prerelease 조각", () => {
    expect(parseVersion("18446744073709551615.0.1-rc.01")).toEqual({ nums: [18446744073709551615n, 0n, 1n], pre: ["rc", "01"] });
    expect(parseVersion("1.2.3")).toEqual({ nums: [1n, 2n, 3n], pre: [] });
  });
  it.each(["1.0.0x", "0x1.0.0", "1.0.0-", "1.0.0-.", "1.0.0-a.", "1. 0.0", "1.0.0\n", "١.0.0", "1e3.0.0", "+1.0.0"])("BigInt가 받아도 거부: %j", (s) => {
    expect(parseVersion(s)).toBeNull();
  });
  it("u64를 넘는 prerelease 숫자는 영숫자로(숫자보다 크다)", () => {
    expect(compareVersions(parse("1.0.0-18446744073709551616"), parse("1.0.0-18446744073709551615"))).toBe(1);
    expect(compareVersions(parse("1.0.0-18446744073709551615"), parse("1.0.0-18446744073709551614"))).toBe(1);
  });
  it("아주 긴 숫자 성분(10만 자리)은 BigInt를 만들기 전에 거부한다", () => {
    const long = "9".repeat(100_000);
    expect(parseVersion(`${long}.0.0`)).toBeNull();
    expect(parseVersion(`0.0.${long}`)).toBeNull();
    expect(parseVersion(`1${"0".repeat(100_000)}.0.0`)).toBeNull();
    // prerelease의 긴 숫자 조각은 u64가 아니라 영숫자로(숫자보다 크다), 앞자리 0만 긴 것은 값으로 읽는다
    expect(compareVersions(parse(`1.0.0-${long}`), parse("1.0.0-1"))).toBe(1);
    expect(compareVersions(parse(`1.0.0-${"0".repeat(100_000)}1`), parse("1.0.0-1"))).toBe(0);
  });
  it("영숫자는 바이트 순서(대문자 < 소문자)", () => {
    expect(compareVersions(parse("1.0.0-B"), parse("1.0.0-a"))).toBe(-1);
    expect(compareVersions(parse("1.0.0-a-"), parse("1.0.0-a0"))).toBe(-1);
  });
});
