// 루프백 순수 함수(worker.md 구현 중 변경 88 (나)·89). 벡터는 셸(L2)과 공유한다.
import { describe, expect, it } from "vitest";
import { LOOPBACK_PATH, LOOPBACK_STATE_DOMAIN, isLoopbackPort, loopbackState, loopbackUrl } from "../../src/core/loopback";
import { newToken, sha256B64url } from "../../src/core/token";
import vectorsText from "../vectors/loopback-vectors.json?raw";

type Vectors = {
  domain: string;
  state: { loginSecret?: string; loginVerifier: string; state: string }[];
  url: { port: number; grant: string; state: string; url: string }[];
  portValid: number[];
  portInvalid: unknown[];
};
const V = JSON.parse(vectorsText) as Vectors;
const fill = (b: number) => () => new Uint8Array(32).fill(b);

describe("공유 벡터", () => {
  it("비지 않았고 도메인이 코드와 같다", () => {
    expect(V.state.length).toBeGreaterThanOrEqual(3);
    expect(V.url.length).toBeGreaterThanOrEqual(2);
    expect(V.domain).toBe(LOOPBACK_STATE_DOMAIN);
  });

  it("loopbackState KAT, loginSecret이 있으면 loginVerifier도 맞다", async () => {
    for (const v of V.state) {
      expect(await loopbackState(v.loginVerifier)).toBe(v.state);
      if (v.loginSecret !== undefined) expect(await sha256B64url(v.loginSecret)).toBe(v.loginVerifier);
    }
  });

  it("벡터의 grant는 newToken(0xa5 32바이트)와 같다", () => {
    for (const u of V.url) expect(newToken("grant", fill(0xa5))).toBe(u.grant);
  });

  it("loopbackUrl 정확 문자열", () => {
    for (const u of V.url) expect(loopbackUrl(u.port, u.grant, u.state)).toBe(u.url);
  });

  it("isLoopbackPort 표", () => {
    for (const p of V.portValid) expect(isLoopbackPort(p)).toBe(true);
    for (const p of V.portInvalid) expect(isLoopbackPort(p)).toBe(false);
    for (const p of [Number.NaN, Number.POSITIVE_INFINITY, 1024n]) expect(isLoopbackPort(p)).toBe(false);
  });
});

describe("형식 밖 입력", () => {
  it("loopbackState는 43자 b64url이 아니면 던진다", async () => {
    for (const bad of ["A".repeat(42), "A".repeat(44), "A".repeat(42) + "+", ""]) await expect(loopbackState(bad)).rejects.toThrow(TypeError);
  });

  it("loopbackUrl은 범위·형식 밖이면 던진다", () => {
    const g = V.url[0]!.grant;
    const st = V.url[0]!.state;
    for (const p of [1023, 65536, 80.5]) expect(() => loopbackUrl(p, g, st)).toThrow(RangeError);
    expect(() => loopbackUrl(49152, "cda_" + "A".repeat(43), st)).toThrow(TypeError);
    expect(() => loopbackUrl(49152, "cdg_" + "A".repeat(42), st)).toThrow(TypeError);
    expect(() => loopbackUrl(49152, g, "A".repeat(42))).toThrow(TypeError);
  });

  it("고정 호스트·경로, 쿼리 키는 grant·state 순서", () => {
    const u = loopbackUrl(49152, V.url[0]!.grant, V.url[0]!.state);
    expect(u.startsWith("http://127.0.0.1:")).toBe(true);
    expect(new URL(u).pathname).toBe(LOOPBACK_PATH);
    expect([...new URL(u).searchParams.keys()]).toEqual(["grant", "state"]);
  });
});
