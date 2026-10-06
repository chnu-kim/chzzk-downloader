// 토큰·id·해시·비교(docs/design/worker.md §6.1, 구현 중 변경 13). 순수 함수이고 난수원은 주입할 수 있다.
//
// 형식은 정규식으로만 판정하고 디코드하지 않는다. 길이를 정확히 정해 두어 긴 입력은 해시하기 전에 버린다.
// 저장 해시 = 접두를 포함한 토큰 문자열 전체의 UTF-8 바이트를 SHA-256한 소문자 hex.
// pollVerifier = b64url(SHA-256(UTF-8(pollSecret 문자열))): 원시 32바이트가 아니라 전송되는 b64url 문자열을 해시한다.

export const TOKEN_PREFIX = { access: "cda_", refresh: "cdr_", web: "cdw_", flow: "cdf_" } as const;
export type TokenKind = keyof typeof TOKEN_PREFIX;

/** n바이트 난수. 테스트는 고정 바이트를 주입한다 */
export type RandomBytes = (n: number) => Uint8Array;
export const randomBytes: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const B64URL_22 = /^[A-Za-z0-9_-]{22}$/;
const BEARER = /^Bearer +([^\s]+)$/i;

/** base64url, 패딩 없음(workerd Uint8Array.prototype.toBase64) */
export function b64url(bytes: Uint8Array): string {
  return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
}

function draw(n: number, rand: RandomBytes): Uint8Array {
  const b = rand(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new TypeError(`난수원이 ${n}바이트를 주지 않았다`);
  return b;
}

/** 접두 + b64url(32B) = 접두 + 43자 */
export function newToken(kind: TokenKind, rand: RandomBytes = randomBytes): string {
  return TOKEN_PREFIX[kind] + b64url(draw(32, rand));
}

/** b64url(16B) = 22자: loginId·handle·session id·웹 flow id */
export function newId(rand: RandomBytes = randomBytes): string {
  return b64url(draw(16, rand));
}

/** b64url(32B) = 43자: state·pollSecret·csrf */
export function newSecret(rand: RandomBytes = randomBytes): string {
  return b64url(draw(32, rand));
}

/** 정확히 그 종류의 접두 + 43자 */
export function isToken(kind: TokenKind, s: unknown): s is string {
  if (typeof s !== "string") return false;
  const prefix = TOKEN_PREFIX[kind];
  return s.startsWith(prefix) && B64URL_43.test(s.slice(prefix.length));
}

export function isId(s: unknown): s is string {
  return typeof s === "string" && B64URL_22.test(s);
}

/** state·pollSecret·csrf·pollVerifier 모양(43자) */
export function isSecret(s: unknown): s is string {
  return typeof s === "string" && B64URL_43.test(s);
}

async function digest(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}

/** UTF-8 바이트의 SHA-256, 소문자 hex 64자 */
export async function sha256Hex(s: string): Promise<string> {
  return (await digest(s)).toHex();
}

/** UTF-8 바이트의 SHA-256 → b64url 43자 */
export async function sha256B64url(s: string): Promise<string> {
  return b64url(await digest(s));
}

/** 상수 시간 비교. timingSafeEqual은 길이가 다르면 던지므로 두 값을 SHA-256(늘 32B)한 뒤 비교한다 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return crypto.subtle.timingSafeEqual(x, y);
}

/** Authorization 헤더의 Bearer 값(scheme 대소문자 무시). 모양이 다르면 null */
export function bearer(header: string | null): string | null {
  if (header === null) return null;
  const m = BEARER.exec(header);
  return m ? (m[1] ?? null) : null;
}
