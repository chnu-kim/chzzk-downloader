// core/entry(계약 §2.4, web.md §9.1): 합성 UA 13사례 + 경계. UA는 형식만 맞춘 합성 문자열이다.
import { describe, expect, it } from "vitest";
import { type EntryContext, entryContext } from "../../src/core/entry";

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1.0.0.0 Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1.0.0.0 Safari/537.36 Edg/1.0.0.0";
const LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:1.0) Gecko/20100101 Firefox/1.0";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET = "Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1.0.0.0 Safari/537.36";
const CHROMEOS = "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1.0.0.0 Safari/537.36";
const KAKAO_ANDROID = `${ANDROID_PHONE} KAKAOTALK 10.0.0`;
const KAKAO_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.0.0";
const KAKAO_SCRAP = "facebookexternalhit/1.1;kakaotalk-scrap/1.0; +https://example.test/bot";
const DISCORD = "Mozilla/5.0 (compatible; Discordbot/2.0; +https://example.test/bot)";
const FACEBOOK = "facebookexternalhit/1.1 (+https://example.test/bot)";

const h = (ua: string | null, chMobile?: string) => ({
  get: (name: string): string | null => {
    const n = name.toLowerCase();
    if (n === "user-agent") return ua;
    if (n === "sec-ch-ua-mobile") return chMobile ?? null;
    return null;
  },
});

const D = (os: NonNullable<EntryContext["os"]>, inApp: EntryContext["inApp"] = null): EntryContext => ({ kind: "desktop", os, inApp });
const P = (inApp: EntryContext["inApp"] = null): EntryContext => ({ kind: "phone", os: null, inApp });
const BOT: EntryContext = { kind: "bot", os: null, inApp: null };
const UNKNOWN: EntryContext = { kind: "unknown", os: null, inApp: null };

describe("entryContext: 13사례", () => {
  const cases: readonly (readonly [string, string | null, string | undefined, EntryContext])[] = [
    ["1 mac 데스크톱", MAC, undefined, D("mac")],
    ["2 windows 데스크톱", WIN, undefined, D("windows")],
    ["3 linux 데스크톱", LINUX, undefined, D("linux")],
    ["4 iPhone Safari", IPHONE, undefined, P()],
    ["5 Android 폰(UA Mobi)", ANDROID_PHONE, undefined, P()],
    ["6 Android 태블릿(Mobi 없음)은 desktop·other", ANDROID_TABLET, undefined, D("other")],
    ["7 데스크톱 모양 UA + Sec-CH-UA-Mobile ?1은 폰", MAC, "?1", P()],
    ["8 카카오톡 인앱(Android)", KAKAO_ANDROID, undefined, P("kakao")],
    ["9 카카오톡 인앱(iOS)", KAKAO_IOS, undefined, P("kakao")],
    ["10 kakaotalk-scrap 봇은 인앱이 아니다", KAKAO_SCRAP, undefined, BOT],
    ["11 Discordbot", DISCORD, undefined, BOT],
    ["12 facebookexternalhit", FACEBOOK, undefined, BOT],
    ["13 UA 없음은 unknown", null, undefined, UNKNOWN],
  ];
  it.each(cases)("%s", (_name, ua, ch, want) => {
    expect(entryContext(h(ua, ch))).toEqual(want);
  });
});

describe("entryContext: 경계", () => {
  it("Sec-CH-UA-Mobile ?0이어도 UA에 Mobi가 있으면 폰(둘 중 하나면 된다)", () => {
    expect(entryContext(h(ANDROID_PHONE, "?0")).kind).toBe("phone");
    expect(entryContext(h(MAC, "?0"))).toEqual(D("mac"));
  });

  it("봇이 Mobi·카카오톡 토큰을 함께 달아도 봇이 먼저다", () => {
    expect(entryContext(h(`${KAKAO_SCRAP} Mobile KAKAOTALK`, "?1"))).toEqual(BOT);
    expect(entryContext(h(`Discordbot ${IPHONE}`))).toEqual(BOT);
  });

  it("봇 토큰은 대소문자를 가리지 않는다", () => {
    expect(entryContext(h("DISCORDBOT/2.0")).kind).toBe("bot");
    expect(entryContext(h("KakaoTalk-Scrap/1.0")).kind).toBe("bot");
  });

  it("OS 토큰이 없으면 unknown, 인앱 표지는 따로 읽는다", () => {
    expect(entryContext(h("curl/8.0"))).toEqual(UNKNOWN);
    expect(entryContext(h(""))).toEqual(UNKNOWN);
    expect(entryContext(h("Custom KAKAOTALK 10.0"))).toEqual({ kind: "unknown", os: null, inApp: "kakao" });
  });

  it("데스크톱 인앱도 표지를 단다", () => {
    expect(entryContext(h(`${WIN} KAKAOTALK 3.0`))).toEqual(D("windows", "kakao"));
  });

  it("ChromeOS·iPad 데스크톱 모양은 other, Android는 Linux 토큰이 있어도 linux가 아니다", () => {
    expect(entryContext(h(CHROMEOS))).toEqual(D("other"));
    expect(entryContext(h(ANDROID_TABLET)).os).toBe("other");
  });

  it("UA 길이 상한 512: 넘으면 unknown(봇 토큰·인앱 토큰이 있어도 예외 없음)", () => {
    const pad = "a".repeat(512 - MAC.length);
    expect(entryContext(h(MAC + pad))).toEqual(D("mac"));
    expect(entryContext(h(`${MAC}${pad}b`))).toEqual(UNKNOWN);
    expect(entryContext(h(`Discordbot ${"a".repeat(600)}`))).toEqual(UNKNOWN);
    expect(entryContext(h(`${"a".repeat(600)} KAKAOTALK`, "?1"))).toEqual(UNKNOWN);
  });

  it("헤더 이름의 대소문자와 상관없이 읽는다(Headers 객체)", () => {
    const hs = new Headers({ "user-agent": ANDROID_TABLET, "SEC-CH-UA-MOBILE": "?1" });
    expect(entryContext(hs)).toEqual(P());
  });
});
