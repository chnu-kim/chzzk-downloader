// core/token(docs/design/worker.md §6.1, 구현 중 변경 13): 접두·길이·해시 계약·상수 시간 비교·Bearer.
import { describe, expect, it } from "vitest";
import {
  b64url,
  bearer,
  isHexHash,
  isId,
  isSecret,
  isToken,
  newId,
  newSecret,
  newToken,
  randomBytes,
  safeEqual,
  sha256B64url,
  sha256Hex,
  TOKEN_PREFIX,
  type TokenKind,
} from "../../src/core/token";

const fill = (b: number) => (n: number) => new Uint8Array(n).fill(b);
const KINDS = Object.keys(TOKEN_PREFIX) as TokenKind[];

describe("생성", () => {
  it("고정 난수에서 기대 문자열(접두 + 43자, id 22자, 비밀 43자)", () => {
    expect(newToken("access", fill(0))).toBe(`cda_${"A".repeat(43)}`);
    expect(newToken("refresh", fill(0xff))).toBe(`cdr_${"_".repeat(42)}8`);
    expect(newToken("web", fill(0))).toBe(`cdw_${"A".repeat(43)}`);
    expect(newToken("flow", fill(0))).toBe(`cdf_${"A".repeat(43)}`);
    expect(newId(fill(0))).toBe("A".repeat(22));
    expect(newSecret(fill(0xfb))).toBe(`${"-_v7".repeat(10)}-_s`);
  });

  it("b64url: 패딩 없음, + / 대신 - _", () => {
    expect(b64url(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
    expect(b64url(new Uint8Array([]))).toBe("");
  });

  it("기본 난수원: 형식 통과, 매번 다르다", () => {
    const a = KINDS.map((k) => newToken(k));
    a.forEach((t, i) => expect(isToken(KINDS[i] as TokenKind, t)).toBe(true));
    expect(newToken("access")).not.toBe(newToken("access"));
    expect(isId(newId())).toBe(true);
    expect(isSecret(newSecret())).toBe(true);
    expect(randomBytes(16)).toHaveLength(16);
  });

  it("난수원이 길이를 어기면 던진다", () => {
    expect(() => newToken("access", () => new Uint8Array(31))).toThrow(TypeError);
    expect(() => newId(() => new Uint8Array(17))).toThrow(TypeError);
  });
});

describe("형식 판정", () => {
  const body = "A".repeat(43);
  it.each([
    ["access", `cda_${body}`, true],
    ["refresh", `cdr_${body}`, true],
    ["web", `cdw_${"_-".repeat(21)}x`, true],
    ["access", `cdr_${body}`, false],
    ["refresh", `cda_${body}`, false],
    ["web", `cdf_${body}`, false],
    ["access", `cda_${"A".repeat(42)}`, false],
    ["access", `cda_${"A".repeat(44)}`, false],
    ["access", `cda_${"A".repeat(42)}+`, false],
    ["access", `cda_${"A".repeat(42)}/`, false],
    ["access", `cda_${"A".repeat(42)}=`, false],
    ["access", `cda_${"A".repeat(42)} `, false],
    ["access", ` cda_${body}`, false],
    ["access", `CDA_${body}`, false],
    ["access", body, false],
    ["access", "", false],
  ] as const)("isToken(%s, %j) = %s", (kind, s, want) => {
    expect(isToken(kind, s)).toBe(want);
  });

  it.each([undefined, null, 42, {}, ["cda_"]])("문자열이 아니면 false: %j", (v) => {
    expect(isToken("access", v)).toBe(false);
    expect(isId(v)).toBe(false);
    expect(isSecret(v)).toBe(false);
  });

  it("id 22자·비밀 43자 정확히", () => {
    expect(isId("A".repeat(22))).toBe(true);
    expect(isId("A".repeat(21))).toBe(false);
    expect(isId("A".repeat(23))).toBe(false);
    expect(isId(`${"A".repeat(21)}=`)).toBe(false);
    expect(isSecret("A".repeat(43))).toBe(true);
    expect(isSecret("A".repeat(42))).toBe(false);
    expect(isSecret("A".repeat(44))).toBe(false);
  });
});

describe("isHexHash", () => {
  it("SHA-256 소문자 hex 64자만 true", async () => {
    const h = await sha256Hex("x");
    expect(isHexHash(h)).toBe(true);
    expect(isHexHash(h.toUpperCase())).toBe(false);
    expect(isHexHash(h.slice(1))).toBe(false);
    expect(isHexHash(h + "0")).toBe(false);
    expect(isHexHash(`${h.slice(0, 63)}g`)).toBe(false);
    for (const v of [null, undefined, 1, {}, [h]]) expect(isHexHash(v)).toBe(false);
  });
});

describe("해시", () => {
  // FIPS 180-2 표준 벡터("abc")
  const abcHex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

  it("known-answer: hex 64자 소문자, b64url 43자", async () => {
    expect(await sha256Hex("abc")).toBe(abcHex);
    expect(await sha256B64url("abc")).toBe(b64url(Uint8Array.fromHex(abcHex)));
    expect(await sha256B64url("abc")).toHaveLength(43);
    expect(await sha256Hex("")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("UTF-8 바이트를 해시한다(한글)", async () => {
    const want = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array([0xea, 0xb0, 0x80]))).toHex();
    expect(await sha256Hex("가")).toBe(want);
  });

  it("저장 해시는 접두를 포함한 토큰 문자열 전체", async () => {
    const t = newToken("access", fill(7));
    expect(await sha256Hex(t)).not.toBe(await sha256Hex(t.slice(4)));
  });

  it("계약: pollVerifier는 b64url 문자열을 해시한다(디코드한 바이트가 아니다)", async () => {
    const poll = newSecret(fill(0x5a));
    const decoded = Uint8Array.fromBase64(poll, { alphabet: "base64url" });
    expect(decoded).toHaveLength(32);
    const overBytes = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", decoded)));
    const verifier = await sha256B64url(poll);
    expect(verifier).not.toBe(overBytes);
    expect(isSecret(verifier)).toBe(true);
    // 앱(A1)과 함께 고정하는 known-answer: 0x5a 32바이트의 pollSecret → verifier
    expect(poll).toBe(`${"Wlpa".repeat(10)}Wlo`);
    const expectedHex = "bec0b6d6b5035e990163105113d0fef306b672a7e23cb774b03bd0365363b53d";
    expect(Uint8Array.fromBase64(verifier, { alphabet: "base64url" }).toHex()).toBe(expectedHex);
  });
});

describe("safeEqual", () => {
  it.each([
    ["a", "a", true],
    ["", "", true],
    ["a", "b", false],
    ["a", "ab", false],
    ["", "x".repeat(1000), false],
    ["dev-token", "dev-token ", false],
  ])("%j vs %j = %s(길이가 달라도 던지지 않는다)", async (a, b, want) => {
    expect(await safeEqual(a, b)).toBe(want);
  });
});

describe("bearer", () => {
  it.each([
    ["Bearer x", "x"],
    ["bearer x", "x"],
    ["BEARER   cda_y", "cda_y"],
    ["Bearer", null],
    ["Bearer ", null],
    ["Bearer  ", null],
    ["Basic x", null],
    ["Bearer a b", null],
    ["Bearer x ", null],
    [" Bearer x", null],
    ["Bearer\tx", null],
    ["", null],
    [null, null],
  ] as const)("%j → %j", (h, want) => {
    expect(bearer(h)).toBe(want);
  });
});
