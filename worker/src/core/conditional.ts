// 조건부 요청(docs/design/worker.md §9.2, 구현 중 변경 31 (라)). R2 onlyIf는 형식이 틀린 ETag에 던지므로(구현 중 변경 30 (나)) Worker가 비교한다.
export const IF_NONE_MATCH_MAX = 1024;

// 따옴표로 감싼 opaque-tag(RFC 9110 §8.8.3): etagc = %x21 / %x23-7E
const ENTITY_TAG = /^"[\x21\x23-\x7e]*"$/;

function strong(tag: string): string {
  return tag.startsWith("W/") ? tag.slice(2) : tag;
}

/** If-None-Match가 etag(R2 httpEtag, 따옴표 포함)와 맞는가. 약한 비교(W/ 무시). null·1024자 초과는 false(무시), 형식이 틀린 조각은 건너뛴다 */
export function ifNoneMatchHit(header: string | null, etag: string): boolean {
  if (header === null || header.length > IF_NONE_MATCH_MAX) return false;
  if (header.trim() === "*") return true;
  const want = strong(etag);
  for (const piece of header.split(",")) {
    const tag = strong(piece.trim());
    if (ENTITY_TAG.test(tag) && tag === want) return true;
  }
  return false;
}
