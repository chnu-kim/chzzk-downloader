// 채널 목록 실측 도구(scripts/listing-check.mjs)의 순수 판정. 기능 ③ 실측 질문 M-③-1~6-2.
// workerd vitest와 Node 스크립트가 같이 쓰므로 node:* import·입출력·시계·난수가 없다(code-binding-lib.mjs와 같은 방식).
// 반환 문자열은 그대로 출력되므로 ID·제목·값 원문을 담지 않는다. 숫자는 범주로만 낸다(채널 준식별자).

export const SERVICE_API = 'https://api.chzzk.naver.com';
// 아래 상수는 모두 [잠정] 근거 없음: 실측 결과로 정한다.
export const PAGE_SIZE = 50; // 정렬·필드 관찰에 쓰는 기본 size
export const SIZE_PROBES = [50, 100]; // 페이지 크기 상한 관찰(질문 1)
export const SORT_PAGES = 3; // 정렬 관찰에 훑는 최대 페이지 수
export const CLIP_SIZE = 30;
export const STEP_GAP_MS = 500; // 일반 단계 요청 사이
export const BURST_COUNT = 20; // 질문 6
export const BURST_GAP_MS = 250; // 질문 6 "짧은 간격"
export const SOAK_LIST_GAP_MS = 500; // 질문 6-2 목록 순회 간격
export const SOAK_INFO_GAP_MS = 700; // 질문 6-2 info 조회 간격
export const SOAK_INFO_MAX = 30; // 질문 6-2 info 조회 건수
export const REQUEST_TIMEOUT_MS = 10_000;

// 경로는 모두 추정이다(기억 기반, 실측으로 확인). 404는 "이 경로로는 안 된다"일 뿐 "목록이 없다"가 아니다.
export const infoPath = (no) => `/service/v2/videos/${no}`;
export const videoListPath = (channelId, page, size) =>
  `/service/v1/channels/${encodeURIComponent(channelId)}/videos?sortType=LATEST&pagingType=PAGE&page=${page}&size=${size}`;
export function clipListPath(channelId, extraQuery = {}) {
  const base = `/service/v1/channels/${encodeURIComponent(channelId)}/clips?orderType=RECENT&filterType=ALL&size=${CLIP_SIZE}`;
  const extra = Object.entries(extraQuery)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return extra ? `${base}&${extra}` : base;
}

export const VIDEO_FIELDS = [
  ['영상 번호', ['videoNo']],
  ['제목', ['videoTitle']],
  ['게시일', ['publishDate', 'publishDateAt']],
  ['길이', ['duration']],
  ['성인', ['adult']],
  ['암호화 표시', ['encryptionType', 'encrypted', 'isEncrypted']],
  ['종류 구분(빠른 다시보기/일반)', ['videoType']],
  ['방송 시작일(파일 이름 날짜)', ['liveOpenDate']],
  ['채널 이름(파일 이름)', ['channel.channelName']],
  ['채널 ID', ['channel.channelId', 'channelId']],
];

export const CLIP_FIELDS = [
  ['클립 ID', ['clipUID', 'clipId']],
  ['제목', ['clipTitle']],
  ['만든 날', ['createdDate']],
  ['길이', ['duration']],
  ['성인', ['adult']],
  ['원본 영상 번호', ['videoNo']],
  ['채널 ID', ['ownerChannelId', 'ownerChannel.channelId', 'channel.channelId']],
  ['채널 이름', ['ownerChannel.channelName', 'channel.channelName']],
];

// channel-id-check.mjs의 VOD 분기와 같은 규칙. 클립·생방송·그 밖은 null.
export function parseVodUrl(raw) {
  let u;
  try {
    u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!['chzzk.naver.com', 'm.chzzk.naver.com'].includes(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs[0] === 'video' && /^\d+$/.test(segs[1] ?? '')) return segs[1];
  return null;
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function judgeResponse(status, bodyText) {
  if (status < 200 || status >= 300) return { kind: 'http', status };
  let body;
  try {
    body = JSON.parse(bodyText ?? '');
  } catch {
    return { kind: 'shape' };
  }
  if (!isObject(body) || typeof body.code !== 'number') return { kind: 'shape' };
  if (body.code !== 200) return { kind: 'api', code: body.code };
  if (!isObject(body.content)) return { kind: 'shape' };
  return { kind: 'ok', content: body.content };
}

export const unreachable = (timedOut) => ({ kind: 'down', timedOut });

export function statusLabel(j) {
  switch (j.kind) {
    case 'ok':
      return '된다';
    case 'http': {
      const s = j.status;
      if (s === 401 || s === 403) return '안 된다(401·403)';
      if (s === 404) return '안 된다(404)';
      if (s === 429) return '안 된다(429)';
      if (s >= 400 && s < 500) return '안 된다(그 밖 4xx)';
      if (s >= 500 && s < 600) return '안 된다(5xx)';
      return '안 된다(그 밖)';
    }
    case 'api':
      return '안 된다(API 코드)';
    case 'shape':
      return '안 된다(형식)';
    default:
      return j.timedOut ? '안 된다(시간 초과)' : '안 된다(연결)';
  }
}

export function findItems(content) {
  for (const k of ['data', 'videos', 'clips', 'items']) {
    if (Array.isArray(content?.[k])) return content[k];
  }
  return null;
}

export function pagingKind(content) {
  if (Number.isInteger(content?.totalPages) || Number.isInteger(content?.page)) return '페이지 번호';
  if ((isObject(content?.page) && 'next' in content.page) || (content && typeof content === 'object' && 'next' in content)) {
    return '커서';
  }
  return '판정 불가';
}

export function nextCursorQuery(content) {
  const next = content?.page?.next ?? content?.next;
  if (!isObject(next)) return null;
  const out = {};
  for (const [k, v] of Object.entries(next)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = String(v);
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function countBucket(n) {
  if (!Number.isInteger(n) || n < 0) return '없음';
  if (n === 0) return '0';
  if (n < 10) return '1~9';
  if (n < 50) return '10~49';
  if (n < 100) return '50~99';
  if (n < 500) return '100~499';
  if (n < 1000) return '500~999';
  return '1000 이상';
}

export function sizeVerdict(requested, got, total) {
  if (got === requested) return '요청 크기 그대로';
  if (got < requested && Number.isInteger(total) && total > got) return `줄어듦(상한 ≤ ${got})`;
  return '판정 불가(항목 부족)';
}

// 항목이 요청 크기보다 적으면 got이 곧 채널 총 개수라 준식별자다. 상한 관찰일 때만 숫자를 낸다.
export function sizeLine(requested, got, total) {
  const v = sizeVerdict(requested, got, total);
  if (v.startsWith('판정 불가')) return `${countBucket(got)} → ${v}`;
  return `${got}개 → ${v}`;
}

export function itemDate(item) {
  if (Number.isFinite(item?.publishDateAt)) return item.publishDateAt;
  for (const k of ['publishDate', 'createdDate']) {
    const s = item?.[k];
    if (typeof s !== 'string') continue;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
    if (m) return Number(m.slice(1, 7).join(''));
  }
  return null;
}

// 메모리 비교 전용. 출력 금지.
export function itemKey(item) {
  if (typeof item?.videoNo === 'number') return String(item.videoNo);
  if (typeof item?.videoNo === 'string') return item.videoNo;
  if (typeof item?.clipUID === 'string') return item.clipUID;
  if (typeof item?.clipId === 'string') return item.clipId;
  return null;
}

// repeatOk=false: 두 번째 첫 페이지 요청이 실패했다. 비교 자료가 없으니 '아님'이 아니라 판정 불가다.
export function sortVerdict({ repeatA, repeatB, pages, repeatOk = true }) {
  const calls = pages.length + 1;
  const seen = new Set();
  const items = [];
  let overlap = false;
  for (const it of pages.flat()) {
    const k = itemKey(it);
    if (k !== null) {
      if (seen.has(k)) {
        overlap = true;
        continue;
      }
      seen.add(k);
    }
    items.push(it);
  }
  const out = (verdict) => ({ verdict, calls, items: items.length, overlap });
  if (items.length < 2 || !repeatOk) return out('판정 불가');
  if (repeatA.map(itemKey).join() !== repeatB.map(itemKey).join()) return out('아님');
  const dates = items.map(itemDate);
  if (dates.some((d) => d === null)) return out('판정 불가');
  for (let i = 0; i + 1 < dates.length; i++) {
    if (dates[i] < dates[i + 1]) return out('아님');
  }
  return out('내림차순');
}

export function channelVerdict(items, infoChannelId, pick) {
  if (infoChannelId === null) return '비교 불가(info 채널 ID 없음)';
  const ids = items.map(pick).filter((v) => typeof v === 'string');
  if (ids.length === 0) return '항목에 채널 ID 없음';
  const diff = ids.filter((v) => v !== infoChannelId);
  if (diff.length === 0) return '같다';
  const lower = infoChannelId.toLowerCase();
  if (diff.every((v) => v.toLowerCase() === lower)) return '대소문자만 다르다';
  return `다르다(${diff.length}개)`;
}

export const pickVideoChannel = (item) => item?.channel?.channelId ?? item?.channelId;
export const pickClipChannel = (item) =>
  item?.ownerChannelId ?? item?.ownerChannel?.channelId ?? item?.channel?.channelId ?? item?.channelId;

function atPath(obj, path) {
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

export function fieldPresence(items, fields) {
  return fields.map(([label, paths]) => {
    if (items.length === 0) return [label, '판정 불가(항목 없음)'];
    const k = items.filter((it) => paths.some((p) => {
      const v = atPath(it, p);
      return v !== undefined && v !== null;
    })).length;
    return [label, k === items.length ? '있음' : k === 0 ? '없음' : '일부'];
  });
}

// 값 자체는 내지 않고 서로 다른 값의 개수만.
export function distinctCount(items, path) {
  const set = new Set();
  for (const it of items) {
    const v = atPath(it, path);
    if (v !== undefined && v !== null) set.add(JSON.stringify(v));
  }
  return set.size;
}

export function adultLabel(items) {
  const flags = items.map((it) => it?.adult).filter((v) => typeof v === 'boolean');
  if (flags.length === 0) return '판정 불가(필드 없음)';
  return flags.some((v) => v === true) ? '있다' : '없다';
}

export function cookieDelta(anonTotal, cookieTotal) {
  if (!Number.isInteger(anonTotal) || !Number.isInteger(cookieTotal)) return '비교 불가';
  if (anonTotal === cookieTotal) return '같다';
  return cookieTotal > anonTotal ? '쿠키 켬이 많다' : '쿠키 켬이 적다';
}

export function rateVerdict(results) {
  let first429 = null;
  let first403 = null;
  results.forEach((r, i) => {
    if (r.kind !== 'http') return;
    if (r.status === 429 && first429 === null) first429 = i + 1;
    if ((r.status === 401 || r.status === 403) && first403 === null) first403 = i + 1;
  });
  return { requests: results.length, first429, first403 };
}

export function rateLines(title, v) {
  return [
    `${title}: 요청 ${v.requests}회`,
    `${title} 429: ${v.first429 === null ? '없음' : `첫 429까지 ${v.first429}회`}`,
    `${title} 401·403: ${v.first403 === null ? '없음' : `${v.first403}회째`}`,
  ];
}

// 코어 crates/core/src/http.rs와 같은 모양. 값은 출력하지 않는다.
export function cookieHeader(aut, ses) {
  const a = aut.trim();
  const s = ses.trim();
  const ok = (v) => v !== '' && /^[\x21-\x7e]+$/.test(v);
  return ok(a) && ok(s) ? `NID_AUT=${a}; NID_SES=${s}` : null;
}
