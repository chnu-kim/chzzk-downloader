// flash 쿠키(http/flash.ts, 계약 §2.4): 쓰기·읽기·지우기·모르는 값·중복·값이 종류 코드뿐.
import { describe, expect, it } from "vitest";
import { cookieSpec } from "../../src/core/cookies";
import { type FlashKind, flashCookie, readFlash } from "../../src/http/flash";

const https = cookieSpec("https://dist.example.test");
const dev = cookieSpec("http://localhost:8787");
const KINDS: readonly FlashKind[] = ["loggedIn", "alreadyDone", "sessionGone"];
const req = (cookie?: string) => new Request("https://dist.example.test/", { headers: cookie === undefined ? {} : { Cookie: cookie } });

describe("flashCookie", () => {
  it("https: __Host-cdl_flash + Secure, Max-Age=60", () => {
    expect(flashCookie(https, "loggedIn")).toBe("__Host-cdl_flash=loggedIn; Max-Age=60; Path=/; HttpOnly; SameSite=Lax; Secure");
  });

  it("http(루프백 dev): cdl_flash, Secure 없음", () => {
    expect(flashCookie(dev, "alreadyDone")).toBe("cdl_flash=alreadyDone; Max-Age=60; Path=/; HttpOnly; SameSite=Lax");
  });

  it("값은 종류 코드뿐이다(토큰 모양이 없다)", () => {
    for (const k of KINDS) {
      const line = flashCookie(https, k);
      expect(line).toContain(`__Host-cdl_flash=${k};`);
      expect(line).not.toMatch(/cd[a-z]_[A-Za-z0-9_-]{43}/);
      expect(k).toMatch(/^[A-Za-z]{1,16}$/);
    }
  });
});

describe("readFlash", () => {
  it.each(KINDS)("쓴 값을 그대로 읽고 같은 응답에서 지운다: %s", (k) => {
    const name = https.flash;
    const r = readFlash(req(`${name}=${k}`), https);
    expect(r.kind).toBe(k);
    expect(r.clear).toBe("__Host-cdl_flash=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure");
  });

  it("쿠키가 없으면 둘 다 null", () => {
    expect(readFlash(req(), https)).toEqual({ kind: null, clear: null });
    expect(readFlash(req("__Host-cdl_s=abc; other=1"), https)).toEqual({ kind: null, clear: null });
  });

  it("모르는 값은 무시하지만 지운다(남겨 두면 매 요청에 실린다)", () => {
    for (const v of ["unknown", "LoggedIn", "loggedin", "x".repeat(200), "a b"]) {
      const r = readFlash(req(`${https.flash}=${v}`), https);
      expect([v, r.kind]).toEqual([v, null]);
      expect([v, r.clear !== null]).toEqual([v, true]);
    }
  });

  it("중복 쿠키는 모호하므로 값을 무시하고 지운다", () => {
    const r = readFlash(req(`${https.flash}=loggedIn; ${https.flash}=loggedIn`), https);
    expect(r.kind).toBeNull();
    expect(r.clear).not.toBeNull();
  });

  it("다른 프로토콜의 이름은 읽지 않는다(https 명세는 cdl_flash를, http 명세는 __Host- 이름을 모른다)", () => {
    expect(readFlash(req("cdl_flash=loggedIn"), https)).toEqual({ kind: null, clear: null });
    expect(readFlash(req("__Host-cdl_flash=loggedIn"), dev)).toEqual({ kind: null, clear: null });
    expect(readFlash(req("cdl_flash=sessionGone"), dev).kind).toBe("sessionGone");
  });

  it("쓰기 → 읽기 왕복(Set-Cookie의 이름=값만 Cookie로 돌려준다)", () => {
    for (const spec of [https, dev]) {
      for (const k of KINDS) {
        const pair = flashCookie(spec, k).split(";")[0] ?? "";
        expect(readFlash(req(pair), spec).kind).toBe(k);
      }
    }
  });
});
