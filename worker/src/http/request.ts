// 요청 읽기 도우미(docs/design/worker.md §4, 구현 중 변경 27 (바)). 입력은 모두 믿지 않는다: 크기·형식을 먼저 거른다.

/** JSON 본문 상한(글자 수). /auth/start·poll·refresh·logout 본문은 모두 이보다 훨씬 작다 */
export const JSON_MAX = 4096;

/** Content-Type의 미디어 형식이 application/json이다(대소문자 무시, ;charset 같은 매개변수는 허용) */
export function isJsonContentType(req: Request): boolean {
  const type = (req.headers.get("Content-Type") ?? "").split(";")[0] ?? "";
  return type.trim().toLowerCase() === "application/json";
}

/**
 * 본문 → 평범한 객체. 빈 본문은 allowEmpty면 {}, 아니면 null이다.
 * JSON이 아님·4096자 초과·해석 실패·배열·null이면 null.
 */
export async function readJsonObject(req: Request, allowEmpty = false): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (text === "") return allowEmpty ? {} : null;
  if (!isJsonContentType(req) || text.length > JSON_MAX) return null;
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
