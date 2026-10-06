// 쿠키(docs/design/worker.md §6.2). 이름·Secure는 PUBLIC_ORIGIN의 프로토콜로 가른다(devMode가 아니다):
// https(https 루프백 포함)면 __Host- 접두 + Secure, http(루프백 dev)면 접두 없음. 공통 HttpOnly; SameSite=Lax; Path=/
// (콜백이 /auth/callback이라 Path를 좁히면 __Host-가 허용하지 않는다).

export type CookieRole = "session" | "flow";

export interface CookieSpec {
  readonly session: string;
  readonly flow: string;
  readonly secure: boolean;
}

export const SESSION_MAX_AGE = 43_200;
export const FLOW_MAX_AGE = 600;

const MAX_AGE: Readonly<Record<CookieRole, number>> = { session: SESSION_MAX_AGE, flow: FLOW_MAX_AGE };
// 값은 토큰 문자 집합만(헤더 주입·따옴표 값 방지)
const VALUE = /^[A-Za-z0-9_-]{1,128}$/;

export function cookieSpec(publicOrigin: string): CookieSpec {
  const protocol = new URL(publicOrigin).protocol;
  if (protocol === "https:") return { session: "__Host-cdl_s", flow: "__Host-cdl_f", secure: true };
  if (protocol === "http:") return { session: "cdl_s", flow: "cdl_f", secure: false };
  throw new TypeError("쿠키 출처는 http 또는 https다");
}

function attrs(spec: CookieSpec, maxAge: number): string {
  return `; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${spec.secure ? "; Secure" : ""}`;
}

export function setCookie(spec: CookieSpec, role: CookieRole, value: string): string {
  if (!VALUE.test(value)) throw new TypeError("쿠키 값 형식이 틀렸다");
  return `${spec[role]}=${value}${attrs(spec, MAX_AGE[role])}`;
}

/** 지우기: 빈 값 + Max-Age=0에 같은 속성(__Host- 쿠키는 Secure가 있어야 지워진다) */
export function clearCookie(spec: CookieSpec, role: CookieRole): string {
  return `${spec[role]}=${attrs(spec, 0)}`;
}

/** Cookie 헤더에서 이름이 정확히 같은 값 하나. 없음·중복(모호)·형식 밖 값은 null */
export function readCookie(header: string | null, name: string): string | null {
  if (header === null) return null;
  let found: string | null = null;
  let count = 0;
  for (const part of header.split(";")) {
    const t = part.trim();
    const i = t.indexOf("=");
    if (i < 0 || t.slice(0, i).trim() !== name) continue;
    count++;
    found = t.slice(i + 1).trim();
  }
  if (count !== 1 || found === null || !VALUE.test(found)) return null;
  return found;
}
