// 진입 맥락 판정(docs/design/system/web.md §9.1, 계약 §2.4). 순수 함수: 요청 헤더에서 읽기만 한다.
// 판정 순서: 길이 상한 → 봇 → 휴대폰 → 데스크톱(OS 토큰이 있으면) → 그 밖은 unknown.
// 이 결과는 랜딩의 순서와 강조만 바꾼다(행·버튼을 숨기거나 막지 않는다). 인앱 토큰은 KAKAOTALK 하나뿐이다
// (다른 앱은 실기 캡처 전까지 넣지 않는다). 이 파일은 외부 앱을 여는 주소 형식을 다루지 않는다.

export interface EntryContext {
  readonly kind: "bot" | "phone" | "desktop" | "unknown";
  readonly os: "mac" | "windows" | "linux" | "other" | null;
  readonly inApp: "kakao" | null;
}

/** UA 길이 상한(글자). 넘으면 unknown */
const UA_MAX = 512;

const UNKNOWN: EntryContext = { kind: "unknown", os: null, inApp: null };
const BOT: EntryContext = { kind: "bot", os: null, inApp: null };
// 링크 미리보기 수집기(카카오·디스코드·페이스북). 사람이 아니므로 인앱 표지도 없다
const BOT_TOKEN = /kakaotalk-scrap|discordbot|facebookexternalhit/i;
const IN_APP_KAKAO = /\bKAKAOTALK\b/i;

type Os = NonNullable<EntryContext["os"]>;

/** UA의 OS 토큰 → 종류. 순서가 중요하다: Android·CrOS는 "Linux"를, iPhone·iPad는 "like Mac OS X"를 품는다 */
function osOf(ua: string): Os | null {
  if (/Android|CrOS|iPhone|iPad|iPod/.test(ua)) return "other";
  if (/Windows/.test(ua)) return "windows";
  if (/Macintosh|Mac OS X/.test(ua)) return "mac";
  if (/Linux|X11/.test(ua)) return "linux";
  return null;
}

export function entryContext(h: { get(name: string): string | null }): EntryContext {
  const ua = h.get("User-Agent") ?? "";
  if (ua.length > UA_MAX) return UNKNOWN;
  if (BOT_TOKEN.test(ua)) return BOT;
  const inApp = IN_APP_KAKAO.test(ua) ? "kakao" : null;
  // 휴대폰: Sec-CH-UA-Mobile: ?1 또는 UA의 Mobi만. OS 토큰으로 가르지 않는다(Android 태블릿은 데스크톱)
  if (h.get("Sec-CH-UA-Mobile")?.trim() === "?1" || ua.includes("Mobi")) return { kind: "phone", os: null, inApp };
  const os = osOf(ua);
  if (os !== null) return { kind: "desktop", os, inApp };
  return { kind: "unknown", os: null, inApp };
}
