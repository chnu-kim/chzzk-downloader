// flash 쿠키(계약 §2.4): 303으로 옮겨 간 화면에 안내를 한 번 보이는 길. 값은 종류 코드 셋뿐이고 모르는 값은 무시한다.
// 쓰기는 응답의 Set-Cookie(web-session의 seeOther에 cookies 배열로 넣는다), 읽기는 다음 GET에서 하고 같은 응답에서 지운다.
// 속성은 공통(HttpOnly; SameSite=Lax; Path=/)에 Max-Age=60이고 https면 __Host-cdl_flash + Secure, http(루프백 dev)면 cdl_flash다.
import { type CookieSpec, clearCookie, hasCookieName, readCookie, setCookie } from "../core/cookies";

export type FlashKind = "loggedIn" | "alreadyDone" | "sessionGone";

const KINDS: readonly FlashKind[] = ["loggedIn", "alreadyDone", "sessionGone"];

const isFlashKind = (v: string): v is FlashKind => (KINDS as readonly string[]).includes(v);

/** Set-Cookie 줄 하나 */
export function flashCookie(spec: CookieSpec, kind: FlashKind): string {
  return setCookie(spec, "flash", kind);
}

/**
 * 요청의 flash를 읽는다. kind는 종류 코드일 때만(없음·중복·모르는 값은 null), clear는 그 이름의 쿠키가 요청에 있기만 하면
 * 지우는 Set-Cookie 줄이다(값이 이상해도 지운다: 남겨 두면 매 요청에 실려 온다)
 */
export function readFlash(req: Request, spec: CookieSpec): { readonly kind: FlashKind | null; readonly clear: string | null } {
  const header = req.headers.get("Cookie");
  const v = readCookie(header, spec.flash);
  return { kind: v !== null && isFlashKind(v) ? v : null, clear: hasCookieName(header, spec.flash) ? clearCookie(spec, "flash") : null };
}
