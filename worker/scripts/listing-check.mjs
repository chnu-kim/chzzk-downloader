#!/usr/bin/env node
// 채널 목록 실측 도구(기능 ③ 실측 질문 M-③-1~6-2, docs/design 밖 features/backup.md §15).
//
// 사용: node worker/scripts/listing-check.mjs <본인 VOD 주소> [--burst] [--soak <초>]
//   환경 변수(선택): CHZZK_NID_AUT · CHZZK_NID_SES — 둘 다 있으면 쿠키 비교(질문 4)를 더 한다
//   --burst        짧은 간격 BURST_COUNT회(질문 6). 기본 꺼짐
//   --soak <초>    목록 순회 + info 조회를 그 시간 동안 겹쳐 돌린다(질문 6-2). 다른 터미널에서
//                  vod_chat_check를 같이 돌린다. 1~1800 정수
//
// 어떤 ID·제목·응답 원문·쿠키도 출력하지 않는다. 출력은 범주·된다/안 된다·예/아니오뿐이다.
// 실제 비밀값 파일·OAuth를 쓰지 않는다(공개 서비스 API만, 쿠키는 환경 변수로만).
// 목록 경로는 추정이다. "안 된다(404)"는 "이 경로로는 안 된다"일 뿐 "목록이 없다"가 아니다.
import {
  BURST_COUNT,
  BURST_GAP_MS,
  CLIP_FIELDS,
  PAGE_SIZE,
  REQUEST_TIMEOUT_MS,
  SERVICE_API,
  SIZE_PROBES,
  SOAK_INFO_GAP_MS,
  SOAK_INFO_MAX,
  SOAK_LIST_GAP_MS,
  SORT_PAGES,
  STEP_GAP_MS,
  VIDEO_FIELDS,
  adultLabel,
  channelVerdict,
  clipListPath,
  cookieDelta,
  cookieHeader,
  countBucket,
  distinctCount,
  fieldPresence,
  findItems,
  infoPath,
  judgeResponse,
  nextCursorQuery,
  pagingKind,
  parseVodUrl,
  pickClipChannel,
  pickVideoChannel,
  rateLines,
  rateVerdict,
  sizeLine,
  sortVerdict,
  statusLabel,
  unreachable,
  videoListPath,
} from '../test/listing-check-lib.mjs';

const USAGE = '사용: node worker/scripts/listing-check.mjs <본인 VOD 주소> [--burst] [--soak <초>]';

function fail(msg) {
  console.error(`실패: ${msg}`);
  process.exit(1);
}

function usage(msg) {
  console.error(`${msg}\n${USAGE}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (line) => console.log(line);

const BASE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  Referer: 'https://chzzk.naver.com/',
  Origin: 'https://chzzk.naver.com',
  Accept: 'application/json, */*',
};

// 응답 본문·URL·헤더는 출력하지 않는다.
async function get(path, { cookie } = {}) {
  const headers = cookie ? { ...BASE_HEADERS, Cookie: cookie } : BASE_HEADERS;
  let res;
  try {
    res = await fetch(SERVICE_API + path, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    return unreachable(e?.name === 'TimeoutError');
  }
  return judgeResponse(res.status, await res.text().catch(() => null));
}

function parseArgs(argv) {
  let url = null;
  let burst = false;
  let soak = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--burst') burst = true;
    else if (a === '--soak') {
      const v = argv[++i];
      if (!/^\d+$/.test(v ?? '') || Number(v) < 1 || Number(v) > 1800) usage('--soak은 1~1800 정수(초)여야 한다');
      soak = Number(v);
    } else if (a.startsWith('--')) usage('모르는 옵션이다');
    else if (url === null) url = a;
    else usage('주소는 하나만 준다');
  }
  if (url === null) usage('본인 VOD 주소가 필요하다');
  const videoNo = parseVodUrl(url);
  if (videoNo === null) usage('치지직 VOD(https://chzzk.naver.com/video/<번호>) 주소여야 한다');
  return { videoNo, burst, soak };
}

function readCookie() {
  const aut = process.env.CHZZK_NID_AUT;
  const ses = process.env.CHZZK_NID_SES;
  if (!aut && !ses) return null;
  if (!aut || !ses) usage('CHZZK_NID_AUT와 CHZZK_NID_SES는 둘 다 주거나 둘 다 비운다');
  const header = cookieHeader(aut, ses);
  if (header === null) fail('쿠키 값 형식이 맞지 않는다(값은 출력하지 않는다)');
  return header;
}

const itemsOf = (j) => (j.kind === 'ok' ? (findItems(j.content) ?? []) : []);

async function listVideos(channelId, cookie) {
  // 질문 1~5, 7: 비로그인 목록.
  const A = await get(videoListPath(channelId, 0, PAGE_SIZE));
  say(`VOD 목록(비로그인): ${statusLabel(A)}`);
  if (A.kind !== 'ok') {
    for (const k of ['페이지 방식', '크기 관찰', '정렬', '필드', '항목 채널 ID']) say(`VOD ${k}: 건너뜀`);
    return { A, items: [] };
  }
  await sleep(STEP_GAP_MS);
  const B = await get(videoListPath(channelId, 0, PAGE_SIZE));
  const itemsA = itemsOf(A);
  const itemsB = itemsOf(B);
  const c = A.content;
  say(`VOD 페이지 방식: ${pagingKind(c)}`);
  say(`VOD 총 개수: ${countBucket(c.totalCount)}`);
  say(`VOD 총 페이지: ${countBucket(c.totalPages)}`);
  for (const s of SIZE_PROBES) {
    let r = A;
    if (s !== PAGE_SIZE) {
      await sleep(STEP_GAP_MS);
      r = await get(videoListPath(channelId, 0, s));
    }
    say(`VOD size ${s} 요청: ${r.kind === 'ok' ? sizeLine(s, itemsOf(r).length, r.content.totalCount) : statusLabel(r)}`);
  }
  // 정렬: 같은 첫 페이지 두 번과, 이어지는 페이지.
  const pages = [itemsA];
  const totalPages = Number.isInteger(c.totalPages) ? c.totalPages : null;
  const limit = totalPages !== null ? Math.min(totalPages, SORT_PAGES) : SORT_PAGES;
  for (let p = 1; p < limit; p++) {
    if (totalPages === null && itemsA.length !== PAGE_SIZE) break;
    await sleep(STEP_GAP_MS);
    const r = await get(videoListPath(channelId, p, PAGE_SIZE));
    const its = itemsOf(r);
    if (r.kind !== 'ok' || its.length === 0) break;
    pages.push(its);
  }
  const sv = sortVerdict({ repeatA: itemsA, repeatB: itemsB, pages });
  say(`VOD 정렬(관찰 표본): ${sv.verdict} (호출 ${sv.calls}회 · 항목 ${countBucket(sv.items)})`);
  say(`VOD 페이지 겹침 항목: ${sv.overlap ? '있음' : '없음'}`);
  say('  ※ 관찰일 뿐 보장이 아니다. 조기 종료를 켜는 근거로 쓰지 않는다(E1)');
  const all = pages.flat();
  for (const [label, presence] of fieldPresence(all, VIDEO_FIELDS)) say(`VOD 필드 ${label}: ${presence}`);
  say(`VOD 종류 구분 값 종류 수: ${distinctCount(all, 'videoType')}`);
  return { A, items: all, totalPages };
}

async function main() {
  const { videoNo, burst, soak } = parseArgs(process.argv.slice(2));
  const cookie = readCookie();

  const info = await get(infoPath(videoNo));
  say(`info 조회: ${statusLabel(info)}`);
  if (info.kind !== 'ok') process.exit(1);
  const channelId = typeof info.content.channel?.channelId === 'string' ? info.content.channel.channelId : null;
  say(`info 채널 ID: ${channelId === null ? '없음' : '있음'}`);
  if (channelId === null) {
    say('VOD 목록: 건너뜀(info 채널 ID 없음)');
    say('클립 목록: 건너뜀(info 채널 ID 없음)');
    process.exit(1);
  }
  await sleep(STEP_GAP_MS);

  const { A, items, totalPages } = await listVideos(channelId, null);
  say(`VOD 항목 채널 ID: ${A.kind === 'ok' ? channelVerdict(items, channelId, pickVideoChannel) : '건너뜀'}`);
  say(`VOD 성인 표시 항목: ${A.kind === 'ok' ? adultLabel(items) : '건너뜀'}`);

  // 클립(질문 2). 경로는 추정이다.
  await sleep(STEP_GAP_MS);
  const clip = await get(clipListPath(channelId));
  say(`클립 목록(이 경로): ${statusLabel(clip)}`);
  if (clip.kind === 'ok') {
    const kind = pagingKind(clip.content);
    say(`클립 페이지 방식: ${kind}`);
    await sleep(STEP_GAP_MS);
    if (kind === '커서') {
      const q = nextCursorQuery(clip.content);
      if (q) say(`클립 다음 페이지(커서): ${statusLabel(await get(clipListPath(channelId, q)))}`);
      else say('클립 다음 페이지(커서): 다음 없음');
    } else if (kind === '페이지 번호') {
      say(`클립 다음 페이지(번호): ${statusLabel(await get(clipListPath(channelId, { page: '1' })))}`);
    } else {
      say('클립 다음 페이지: 판정 불가');
    }
    const clipItems = itemsOf(clip);
    for (const [label, presence] of fieldPresence(clipItems, CLIP_FIELDS)) say(`클립 필드 ${label}: ${presence}`);
    say(`클립 항목 채널 ID: ${channelVerdict(clipItems, channelId, pickClipChannel)}`);
  }

  // 쿠키(질문 4).
  if (cookie === null) {
    say('쿠키 비교: 건너뜀(환경 변수 없음)');
  } else {
    await sleep(STEP_GAP_MS);
    const C = await get(videoListPath(channelId, 0, PAGE_SIZE), { cookie });
    say(`VOD 목록(쿠키): ${statusLabel(C)}`);
    if (C.kind === 'ok') {
      say(`쿠키 켬 총 개수 비교: ${cookieDelta(A.kind === 'ok' ? A.content.totalCount : undefined, C.content.totalCount)}`);
      say(`VOD 성인 표시 항목(쿠키): ${adultLabel(itemsOf(C))}`);
    }
    say('  ※ 비공개·구독자 전용 여부는 이 도구가 가리지 못한다. 개발 빌드에서 확인(질문 4)');
  }

  // 짧은 간격(질문 6). 첫 429 또는 401·403에서 멈춘다(재시도 없음).
  if (burst) {
    const results = [];
    for (let i = 0; i < BURST_COUNT; i++) {
      if (i > 0) await sleep(BURST_GAP_MS);
      const r = await get(videoListPath(channelId, 0, PAGE_SIZE));
      results.push(r);
      if (r.kind === 'http' && [429, 401, 403].includes(r.status)) break;
    }
    for (const l of rateLines('짧은 간격', rateVerdict(results))) say(l);
  } else {
    say('짧은 간격: 건너뜀(--burst)');
  }

  // 겹쳐 돌리기(질문 6-2). 목록 순회와 info 조회 두 박자를 같은 시간 동안.
  if (soak !== null) {
    say(`겹쳐 돌리기: ${soak}초 동안 시작. 다른 터미널에서 vod_chat_check를 같이 돌린다`);
    const results = [];
    const endAt = Date.now() + soak * 1000;
    let stop = false;
    const record = (r) => {
      results.push(r);
      if (r.kind === 'http' && [429, 401, 403].includes(r.status)) stop = true;
    };
    const pageCount = Math.max(1, Math.min(totalPages ?? 1, 50));
    const nos = items.map((it) => it?.videoNo).filter((v) => typeof v === 'number').slice(0, SOAK_INFO_MAX);
    const listLoop = async () => {
      for (let i = 0; !stop && Date.now() < endAt; i++) {
        record(await get(videoListPath(channelId, i % pageCount, PAGE_SIZE)));
        await sleep(SOAK_LIST_GAP_MS);
      }
    };
    const infoLoop = async () => {
      for (const no of nos) {
        if (stop || Date.now() >= endAt) break;
        record(await get(infoPath(String(no))));
        await sleep(SOAK_INFO_GAP_MS);
      }
    };
    await Promise.all([listLoop(), infoLoop()]);
    for (const l of rateLines('겹쳐 돌리기', rateVerdict(results))) say(l);
  } else {
    say('겹쳐 돌리기: 건너뜀(--soak)');
  }
}

main().catch(() => fail('예상하지 못한 오류(세부는 출력하지 않는다)'));
