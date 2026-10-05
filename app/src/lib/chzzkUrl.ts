// 치지직 VOD·클립 주소 모양 검사. 코어 `parse_content_url`(crates/core/src/url.rs)과 같은 규칙을 따르지만
// 판정은 늘 Rust가 다시 한다(`resolve`가 `invalidUrl`을 돌려준다). 여기서는 드롭한 글에서 주소 하나를 고를 때만 쓴다.

const HOSTS = new Set(['chzzk.naver.com', 'm.chzzk.naver.com']);
const MAX_SCAN = 4096; // 셸 `chzzk_link`와 같은 상한

function isClipId(s: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(s);
}

export function isChzzkContentUrl(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (!HOSTS.has(url.hostname)) return false;
  const segs = url.pathname.split('/').slice(1);
  if (segs.length > 0 && segs[segs.length - 1] === '') segs.pop();
  if (segs.length === 2 && segs[0] === 'video') return /^\d+$/.test(segs[1]);
  if (segs.length === 2 && segs[0] === 'clips') return isClipId(segs[1]);
  if (segs.length === 3 && segs[0] === 'embed' && segs[1] === 'clip') return isClipId(segs[2]);
  return false;
}

/** 공백으로 나눈 글 중 첫 치지직 영상 주소. 셸 `chzzk_link`와 같은 방식이다. */
export function pickChzzkLink(text: string): string | null {
  if (!text || text.length > MAX_SCAN) return null;
  return text.split(/\s+/).find((t) => isChzzkContentUrl(t)) ?? null;
}

/**
 * 드롭한 데이터에서 불러올 글. `text/uri-list`(주석 `#` 줄 제외)를 먼저, 없으면 `text/plain`.
 * 치지직 주소가 있으면 그것을, 없으면 첫 줄을 그대로 돌려준다(Rust가 `invalidUrl`로 알려 준다).
 */
export function textFromDrop(getData: (type: string) => string): string | null {
  const uriList = getData('text/uri-list') || '';
  const uris = uriList
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const plain = getData('text/plain') || '';
  const all = [...uris, plain].join('\n');
  const link = pickChzzkLink(all);
  if (link) return link;
  const first = (uris[0] ?? plain.split(/\r?\n/)[0] ?? '').trim();
  return first || null;
}
