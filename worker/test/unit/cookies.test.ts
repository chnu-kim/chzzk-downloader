// core/cookies(docs/design/worker.md §6.2): 프로토콜로 가르는 이름·Secure, 정확한 Set-Cookie, 읽기의 닫힌 판정.
import { describe, expect, it } from "vitest";
import { clearCookie, cookieSpec, FLOW_MAX_AGE, readCookie, SESSION_MAX_AGE, setCookie } from "../../src/core/cookies";

const V = "cdw_" + "A".repeat(43);

describe("cookieSpec", () => {
  it.each([
    ["https://dist.example.test", { session: "__Host-cdl_s", flow: "__Host-cdl_f", secure: true }],
    ["https://localhost:8787", { session: "__Host-cdl_s", flow: "__Host-cdl_f", secure: true }],
    ["http://localhost:8787", { session: "cdl_s", flow: "cdl_f", secure: false }],
    ["http://127.0.0.1:8787", { session: "cdl_s", flow: "cdl_f", secure: false }],
  ])("%s", (origin, want) => {
    expect(cookieSpec(origin)).toEqual(want);
  });

  it.each(["ftp://x.example.test", "file:///tmp/x", "data:text/plain,x"])("다른 프로토콜은 던진다: %s", (o) => {
    expect(() => cookieSpec(o)).toThrow(TypeError);
  });
  it("URL이 아니면 던진다", () => {
    expect(() => cookieSpec("not a url")).toThrow();
  });
});

describe("setCookie·clearCookie", () => {
  const https = cookieSpec("https://dist.example.test");
  const dev = cookieSpec("http://localhost:8787");

  it("정확한 헤더 문자열", () => {
    expect(SESSION_MAX_AGE).toBe(43_200);
    expect(FLOW_MAX_AGE).toBe(600);
    expect(setCookie(https, "session", V)).toBe(`__Host-cdl_s=${V}; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax; Secure`);
    expect(setCookie(https, "flow", "cdf_x")).toBe("__Host-cdl_f=cdf_x; Max-Age=600; Path=/; HttpOnly; SameSite=Lax; Secure");
    expect(setCookie(dev, "session", V)).toBe(`cdl_s=${V}; Max-Age=43200; Path=/; HttpOnly; SameSite=Lax`);
    expect(setCookie(dev, "flow", "cdf_x")).toBe("cdl_f=cdf_x; Max-Age=600; Path=/; HttpOnly; SameSite=Lax");
  });

  it("지우기는 빈 값·Max-Age=0에 같은 속성(__Host-는 Secure가 있어야 지워진다)", () => {
    expect(clearCookie(https, "flow")).toBe("__Host-cdl_f=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure");
    expect(clearCookie(dev, "session")).toBe("cdl_s=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");
  });

  it.each(["", "a;b", "a\r\nSet-Cookie: x=1", "a b", '"q"', "a,b", "a=b", "x".repeat(129), "가"])("값 형식이 틀리면 던진다: %j", (v) => {
    expect(() => setCookie(https, "session", v)).toThrow(TypeError);
  });
});

describe("readCookie", () => {
  it.each([
    ["cdl_s=abc", "cdl_s", "abc"],
    ["  cdl_s=abc  ", "cdl_s", "abc"],
    ["a=1; cdl_s=abc; b=2", "cdl_s", "abc"],
    ["a=1;cdl_s=abc", "cdl_s", "abc"],
    [`__Host-cdl_s=${V}`, "__Host-cdl_s", V],
    ["cdl_s=abc", "__Host-cdl_s", null],
    ["__Host-cdl_s=abc", "cdl_s", null],
    ["xcdl_s=abc", "cdl_s", null],
    ["cdl_s=abc; cdl_s=def", "cdl_s", null],
    ["cdl_s=abc; cdl_s=abc", "cdl_s", null],
    ['cdl_s="abc"', "cdl_s", null],
    ["cdl_s=", "cdl_s", null],
    ["cdl_s=a b", "cdl_s", null],
    ["cdl_s", "cdl_s", null],
    ["", "cdl_s", null],
    [null, "cdl_s", null],
  ] as const)("%j에서 %s → %j", (h, name, want) => {
    expect(readCookie(h, name)).toBe(want);
  });
});
