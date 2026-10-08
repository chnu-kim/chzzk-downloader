// 요청 읽기 도우미(docs/design/worker.md §4, 구현 중 변경 27 (바)·28). 입력은 모두 믿지 않는다: 크기·형식을 먼저 거른다.

/** JSON 본문 상한(바이트). /auth/start·redeem·refresh·logout 본문은 모두 ASCII이고 이보다 훨씬 작다 */
export const JSON_MAX = 4096;

/** Content-Type의 미디어 형식이 application/json이다(대소문자 무시, ;charset 같은 매개변수는 허용) */
export function isJsonContentType(req: Request): boolean {
  const type = (req.headers.get("Content-Type") ?? "").split(";")[0] ?? "";
  return type.trim().toLowerCase() === "application/json";
}

/**
 * 본문을 상한까지만 읽는다(구현 중 변경 28). Content-Length가 상한을 넘으면 읽지 않고, 길이를 모르는 스트림은
 * 바이트를 세다 상한을 넘는 순간 끊는다. 넘으면 null, 올바른 UTF-8이 아니면 null.
 */
export async function readCapped(req: Request, max = JSON_MAX): Promise<string | null> {
  const body = req.body;
  if (body === null) return "";
  const declared = req.headers.get("Content-Length");
  if (declared !== null && (!/^\d{1,15}$/.test(declared) || Number(declared) > max)) {
    await body.cancel().catch(() => {});
    return null;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 본문 → 평범한 객체. 빈 본문은 allowEmpty면 {}(Content-Type과 무관), 아니면 null이다.
 * JSON이 아님·4096바이트 초과·해석 실패·배열·null이면 null. 크기와 Content-Type은 본문을 다 읽기 전에 거른다.
 */
export async function readJsonObject(req: Request, allowEmpty = false): Promise<Record<string, unknown> | null> {
  // JSON이 아닌 본문은 빈 본문인지만 보면 되므로 상한 0으로 읽는다(1바이트라도 오면 바로 끊는다)
  const text = await readCapped(req, isJsonContentType(req) ? JSON_MAX : 0);
  if (text === "") return allowEmpty ? {} : null;
  if (text === null || !isJsonContentType(req)) return null;
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 브라우저 POST 출처 검사(§8.1 (2)): Origin이 PUBLIC_ORIGIN과 정확히 같아야 한다(없음·"null"은 거부).
 * Sec-Fetch-Site가 있으면 same-origin이어야 한다.
 */
export function sameOriginPost(req: Request, publicOrigin: string): boolean {
  const origin = req.headers.get("Origin");
  if (origin === null || origin !== publicOrigin) return false;
  const site = req.headers.get("Sec-Fetch-Site");
  return site === null || site === "same-origin";
}

/** 폼 본문 상한(바이트). 웹 POST 필드는 csrf(43자)·채널 ID(32자)·메모(64자)뿐이다 */
export const FORM_MAX = 4096;

/** Content-Type의 미디어 형식이 application/x-www-form-urlencoded다(대소문자 무시, ;charset 같은 매개변수는 허용) */
export function isFormContentType(req: Request): boolean {
  const type = (req.headers.get("Content-Type") ?? "").split(";")[0] ?? "";
  return type.trim().toLowerCase() === "application/x-www-form-urlencoded";
}

/** 같은 이름이 정확히 하나일 때만 그 값, 아니면 null(중복 필드로 검사를 우회하지 못하게 한다) */
export function oneField(form: URLSearchParams, name: string): string | null {
  const all = form.getAll(name);
  return all.length === 1 ? (all[0] ?? null) : null;
}
