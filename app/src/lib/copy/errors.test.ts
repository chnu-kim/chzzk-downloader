import { describe, expect, it } from 'vitest';
import type { AppError, ErrorCode, ErrorPayload, Stage } from '../bindings';
import {
  ERROR_CODES,
  actionLabel,
  errorCopy,
  isAppError,
  toAppError,
  type ActionId,
  type ErrorContext,
  type ErrorDiagnosis,
  type ErrorPlace,
} from './errors';
import { t } from './ko';

// 이 파일은 content.md §15.2 표의 골든이다. 값은 표의 굵은 글자 그대로 옮긴다.

const RAW = 'RAW-MESSAGE-온리-L1';
const API_MSG = 'API-MESSAGE-온리-L1';

function err(code: ErrorCode, payload: ErrorPayload | null = null, stage: Stage | null = null): AppError {
  return { code, message: RAW, stage, resumable: false, payload };
}

const http = (status: number): AppError => err('http', { type: 'http', status, requestKind: 'api' });
const pathPayload = (path: string): ErrorPayload => ({ type: 'path', path });

const R: ErrorContext = { place: 'resolve' };
const D: ErrorContext = { place: 'job' };
const DP: ErrorContext = { place: 'job', partialBytes: 1024 };
const T: ErrorContext = { place: 'other' };

const PLACES: ErrorPlace[] = ['resolve', 'job', 'cookie', 'other'];
const DIAGNOSES: ErrorDiagnosis[] = ['local', 'service', 'unknown'];

/** 모든 코드를 payload까지 갖춰 만든다(전수 검사용) */
function sample(code: ErrorCode, stage: Stage | null = null): AppError {
  switch (code) {
    case 'api':
      return err(code, { type: 'api', code: 9, apiMessage: API_MSG }, stage);
    case 'http':
      return err(code, { type: 'http', status: 503, requestKind: 'api' }, stage);
    case 'authRequired':
      return err(code, { type: 'authRequired', status: 401 }, stage);
    case 'noPlayback':
      return err(code, { type: 'noPlayback', adult: true }, stage);
    case 'qualityNotFound':
      return err(code, { type: 'qualityNotFound', requested: '1080p', available: ['720p'] }, stage);
    case 'diskFull':
    case 'fileLocked':
    case 'io':
    case 'settings':
    case 'fileMissing':
      return err(code, pathPayload('D:\\영상'), stage);
    case 'duplicateOutput':
      return err(code, { type: 'duplicateOutput', jobId: 7 }, stage);
    default:
      return err(code, null, stage);
  }
}

describe('errorCopy 전체 표', () => {
  it('오류 코드는 28개(코어 20 + 셸 8)', () => {
    expect(ERROR_CODES).toHaveLength(28);
  });

  // 모든 code × 위치 × .part 유무 × 쿠키 사용 × 진단에서 3요소가 갖춰지고 DC8·C6 규칙을 지킨다.
  for (const code of ERROR_CODES) {
    for (const place of PLACES) {
      it(`${code} @ ${place}`, () => {
        for (const partialBytes of [null, 1024]) {
          for (const cookiesEnabled of [false, true]) {
            for (const diagnosis of DIAGNOSES) {
              const ctx: ErrorContext = { place, partialBytes, cookiesEnabled, diagnosis, channelName: '가짜 채널', myChannel: '내 가짜 채널' };
              for (const stage of [null, 'resolve', 'download'] as (Stage | null)[]) {
                const c = errorCopy(sample(code, stage), ctx);
                const label = `${code} ${place} part=${partialBytes} cookies=${cookiesEnabled} ${diagnosis} ${stage}`;
                // 제목: 사건 한 문장, 마침표 없음, 비어 있지 않다
                expect(c.title.length, label).toBeGreaterThan(0);
                expect(c.title, label).not.toMatch(/[.?!]$/);
                expect(c.title, label).not.toMatch(/\. /);
                // 본문: 문장마다 마침표(쿠키 입력의 invalidInput만 제목이 전부다)
                if (c.body) {
                  expect(c.body, label).toMatch(/\.$/);
                  expect(c.body, label).not.toBe('다시 시도해 주세요.');
                }
                // 빈 자리·변수 잔재 없음
                expect(`${c.title}${c.body}${c.rows.join('')}`, label).not.toMatch(/\{\w+\}|undefined|null|NaN/);
                // DC8: 제목·본문·행에 코드·HTTP 번호·코어 원문·치지직 응답 원문이 없다
                const l0 = `${c.title}\n${c.body}\n${c.rows.join('\n')}`;
                expect(l0, label).not.toMatch(/코드|HTTP|\(코드|0x|E\d{3,}/);
                expect(l0, label).not.toContain(RAW);
                expect(l0, label).not.toContain(API_MSG);
                // 버튼은 세 개까지, 중복 없음, 글자가 있다
                expect(c.actions.length, label).toBeLessThanOrEqual(3);
                expect(new Set(c.actions).size, label).toBe(c.actions.length);
                for (const a of c.actions) expect(actionLabel(a).length, `${label} ${a}`).toBeGreaterThan(0);
                // C6: 본문이 시키는 버튼은 L0에 있다
                if (c.body.includes('문제 보고용 정보를 복사해')) expect(c.actions, label).toContain('copyReport');
                // D에서 "다시 시도"와 "이어받기"는 .part 유무로만 갈린다(§6.3)
                if (place === 'job' && partialBytes == null) expect(c.actions, label).not.toContain('resume');
                if (place === 'job' && partialBytes != null) expect(c.actions, label).not.toContain('retry');
                // R에는 목록 동작이 없다.
                if (place === 'resolve') {
                  const jobOnly: ActionId[] = ['resume', 'restartFresh', 'remove', 'reresolve', 'openFolder'];
                  for (const a of jobOnly) expect(c.actions, label).not.toContain(a);
                }
              }
            }
          }
        }
      });
    }
  }
});

interface Row {
  name: string;
  error: AppError;
  ctx: ErrorContext;
  title: string;
  body: string;
  actions: ActionId[];
  detail: string | null;
  rows?: string[];
}

const PART_KEPT = '받은 부분은 그대로 있어요.';
const SEND = '문제 보고용 정보를 복사해 관리자에게 보내 주세요.';
const IF_PERSISTS = `계속되면 ${SEND}`;
const API_ERR = err('api', { type: 'api', code: 9, apiMessage: ` ${API_MSG} ` });
const QUALITY = err('qualityNotFound', { type: 'qualityNotFound', requested: '1080p', available: ['720p'] });
const AUTH = (stage: Stage | null) => err('authRequired', { type: 'authRequired', status: 401 }, stage);
const ADULT = err('noPlayback', { type: 'noPlayback', adult: true });
const PLAIN = err('noPlayback', { type: 'noPlayback', adult: false });
const DISK = err('diskFull', pathPayload('D:\\영상'));
const PATHED = (code: ErrorCode) => err(code, pathPayload('D:\\영상'));

// content.md §15.2: 코드 28개 × 자리별 L0(제목·본문·버튼)와 L1
const GOLDEN: Row[] = [
  {
    name: 'invalidUrl: 버튼 없음(입력칸이 행동)',
    error: err('invalidUrl'),
    ctx: R,
    title: '치지직 영상 주소가 아니에요',
    body: '영상 주소는 chzzk.naver.com/video/… 또는 …/clips/… 모양이에요. 라이브 주소는 받을 수 없어요.',
    actions: [],
    detail: null,
  },
  {
    name: 'api R: apiMessage는 L1',
    error: API_ERR,
    ctx: R,
    title: '치지직이 요청을 거절했어요',
    body: `잠시 뒤 다시 시도해 주세요. ${IF_PERSISTS}`,
    actions: ['retry', 'copyReport'],
    detail: `치지직 응답: ${API_MSG}\n치지직 응답 코드: 9`,
  },
  {
    name: 'api D .part: 받은 부분 문장이 본문 끝에',
    error: err('api', { type: 'api', code: 9, apiMessage: null }),
    ctx: DP,
    title: '치지직이 요청을 거절했어요',
    body: `잠시 뒤 다시 시도해 주세요. ${IF_PERSISTS} ${PART_KEPT}`,
    actions: ['resume', 'copyReport'],
    detail: '치지직 응답 코드: 9',
  },
  {
    name: 'http 404',
    error: http(404),
    ctx: R,
    title: '영상을 찾을 수 없어요',
    body: '삭제됐거나 비공개로 바뀌었을 수 있어요.',
    actions: ['close'],
    detail: '오류 코드: http-404',
  },
  {
    name: 'http 410 D',
    error: http(410),
    ctx: D,
    title: '영상을 찾을 수 없어요',
    body: '삭제됐거나 비공개로 바뀌었을 수 있어요.',
    actions: ['remove'],
    detail: '오류 코드: http-410',
  },
  {
    name: 'http 429: {mins}분 변수',
    error: http(429),
    ctx: R,
    title: '요청이 너무 많아요',
    body: '1분쯤 뒤 다시 시도해 주세요.',
    actions: ['retry'],
    detail: '오류 코드: http-429',
  },
  {
    name: 'http 429 D .part',
    error: http(429),
    ctx: DP,
    title: '요청이 너무 많아요',
    body: `1분쯤 뒤 다시 시도해 주세요. ${PART_KEPT}`,
    actions: ['resume'],
    detail: '오류 코드: http-429',
  },
  {
    name: 'http 그 밖, 진단 service',
    error: http(503),
    ctx: { ...R, diagnosis: 'service' },
    title: '치지직이 응답하지 않아요',
    body: '인터넷은 연결된 것 같아요. 치지직 쪽 문제일 수 있어 잠시 뒤 다시 시도해 주세요.',
    actions: ['retry'],
    detail: '오류 코드: http-503',
  },
  {
    name: 'http 그 밖, 진단 unknown(기본)',
    error: http(503),
    ctx: R,
    title: '치지직 응답을 받지 못했어요',
    body: `잠시 뒤 다시 시도해 주세요. ${IF_PERSISTS}`,
    actions: ['retry', 'copyReport'],
    detail: '오류 코드: http-503',
  },
  {
    name: 'http 403은 같은 요청이 끝내 실패한다: 받은 부분 문장이 없다',
    error: http(403),
    ctx: DP,
    title: '치지직 응답을 받지 못했어요',
    body: `잠시 뒤 다시 시도해 주세요. ${IF_PERSISTS}`,
    actions: ['resume', 'copyReport'],
    detail: '오류 코드: http-403',
  },
  {
    name: 'authRequired download',
    error: AUTH('download'),
    ctx: D,
    title: '영상 서버가 접근을 막았어요',
    body: '주소를 새로 받아도 계속 거절돼요. 받다 만 파일은 지웠어요.',
    actions: ['restartFresh'],
    detail: null,
  },
  {
    name: 'authRequired 쿠키 켜짐',
    error: AUTH('resolve'),
    ctx: { ...R, cookiesEnabled: true },
    title: '네이버 로그인 정보가 만료됐어요',
    body: '브라우저에서 네이버에 다시 로그인한 뒤 새 값을 넣어 주세요.',
    actions: ['reenterCookies'],
    detail: null,
  },
  {
    name: 'authRequired 쿠키 꺼짐',
    error: AUTH(null),
    ctx: { ...R, cookiesEnabled: false },
    title: '네이버 로그인이 필요한 영상이에요',
    body: '연령 제한이나 구독자 전용 영상이에요. 설정에서 네이버 로그인 정보를 넣으면 받을 수 있어요.',
    actions: ['openCookieSettings'],
    detail: null,
  },
  {
    name: 'noPlayback adult 쿠키 켜짐',
    error: ADULT,
    ctx: { ...R, cookiesEnabled: true },
    title: '성인 인증이 필요한 영상이에요',
    body: '성인 인증한 계정의 네이버 로그인 정보인지 확인해 주세요.',
    actions: ['reenterCookies'],
    detail: null,
  },
  {
    name: 'noPlayback adult 쿠키 꺼짐',
    error: ADULT,
    ctx: { ...R, cookiesEnabled: false },
    title: '성인 인증이 필요한 영상이에요',
    body: '네이버 로그인 정보가 있어야 받을 수 있어요.',
    actions: ['openCookieSettings'],
    detail: null,
  },
  {
    name: 'noPlayback 일반 R',
    error: PLAIN,
    ctx: R,
    title: '아직 받을 수 없는 영상이에요',
    body: '방송 직후라 처리 중이거나 다시보기가 꺼져 있을 수 있어요.',
    actions: ['retry'],
    detail: null,
  },
  {
    name: 'noPlayback 일반 D: 다시 불러오기',
    error: PLAIN,
    ctx: DP,
    title: '아직 받을 수 없는 영상이에요',
    body: '방송 직후라 처리 중이거나 다시보기가 꺼져 있을 수 있어요.',
    actions: ['reresolve'],
    detail: null,
  },
  {
    name: 'encrypted R: 우회 안내 없음',
    error: err('encrypted'),
    ctx: R,
    title: '보호된 영상이라 받을 수 없어요',
    body: '중계권 등의 이유로 암호화된 영상은 지원하지 않아요.',
    actions: ['close'],
    detail: null,
  },
  {
    name: 'encrypted D',
    error: err('encrypted'),
    ctx: D,
    title: '보호된 영상이라 받을 수 없어요',
    body: '중계권 등의 이유로 암호화된 영상은 지원하지 않아요.',
    actions: ['remove'],
    detail: null,
  },
  {
    name: 'noQualities R',
    error: err('noQualities'),
    ctx: R,
    title: '받을 수 있는 화질이 없어요',
    body: '영상 처리가 끝나지 않았을 수 있어요. 잠시 뒤 다시 시도해 주세요.',
    actions: ['retry'],
    detail: null,
  },
  {
    name: 'noQualities D .part',
    error: err('noQualities'),
    ctx: DP,
    title: '받을 수 있는 화질이 없어요',
    body: `영상 처리가 끝나지 않았을 수 있어요. 잠시 뒤 다시 시도해 주세요. ${PART_KEPT}`,
    actions: ['reresolve'],
    detail: null,
  },
  {
    name: 'qualityNotFound: 화질은 L1',
    error: QUALITY,
    ctx: D,
    title: '고른 화질이 더 이상 없어요',
    body: '다시 불러와서 다른 화질을 골라 주세요. 받다 만 파일은 지우고 새로 받아요.',
    actions: ['reresolve'],
    detail: '고른 화질: 1080p',
  },
  {
    name: 'playbackChanged',
    error: err('playbackChanged'),
    ctx: D,
    title: '영상 형식이 바뀌었어요',
    body: '치지직이 영상을 다시 처리했어요. 다시 불러와서 화질을 골라 처음부터 받아야 해요.',
    actions: ['reresolve'],
    detail: null,
  },
  {
    name: 'sourceChanged D',
    error: err('sourceChanged'),
    ctx: D,
    title: '원본 영상이 바뀌어 이어받을 수 없어요',
    body: '받다 만 파일은 지웠어요. 처음부터 다시 받아 주세요.',
    actions: ['restartFresh'],
    detail: null,
  },
  {
    name: 'refreshExhausted D .part',
    error: err('refreshExhausted'),
    ctx: DP,
    title: '영상 주소가 계속 만료돼요',
    body: `주소를 여러 번 새로 받았지만 이어받지 못했어요. ${PART_KEPT}`,
    actions: ['resume', 'copyReport'],
    detail: null,
  },
  {
    name: 'refreshExhausted R: 받은 부분이 없다',
    error: err('refreshExhausted'),
    ctx: R,
    title: '영상 주소가 계속 만료돼요',
    body: '주소를 여러 번 새로 받았지만 이어받지 못했어요.',
    actions: ['retry', 'copyReport'],
    detail: null,
  },
  {
    name: 'unsupported: 원문은 L1',
    error: err('unsupported'),
    ctx: R,
    title: '아직 지원하지 않는 영상 형식이에요',
    body: SEND,
    actions: ['copyReport'],
    detail: RAW,
  },
  {
    name: 'parse',
    error: err('parse'),
    ctx: R,
    title: '치지직 응답을 읽지 못했어요',
    body: '치지직이 바뀌었을 수 있어요. 잠시 뒤 다시 시도하고, 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
    actions: ['retry', 'copyReport'],
    detail: RAW,
  },
  {
    name: 'lengthMismatch D',
    error: err('lengthMismatch'),
    ctx: D,
    title: '받은 파일이 손상됐어요',
    body: '받은 크기가 예상과 달라 받다 만 파일을 지웠어요. 처음부터 다시 받아 주세요.',
    actions: ['restartFresh'],
    detail: null,
  },
  {
    name: 'network local R',
    error: err('network'),
    ctx: { ...R, diagnosis: 'local' },
    title: '인터넷에 연결되지 않은 것 같아요',
    body: '연결을 확인한 뒤 다시 시도해 주세요.',
    actions: ['retry'],
    detail: null,
  },
  {
    name: 'network local D .part',
    error: err('network'),
    ctx: { ...DP, diagnosis: 'local' },
    title: '인터넷에 연결되지 않은 것 같아요',
    body: `연결을 확인한 뒤 다시 시도해 주세요. ${PART_KEPT}`,
    actions: ['resume'],
    detail: null,
  },
  {
    name: 'network service',
    error: err('network'),
    ctx: { ...R, diagnosis: 'service' },
    title: '치지직이 응답하지 않아요',
    body: '인터넷은 연결된 것 같아요. 치지직 쪽 문제일 수 있어 잠시 뒤 다시 시도해 주세요.',
    actions: ['retry'],
    detail: null,
  },
  {
    name: 'network unknown D (.part 없음)',
    error: err('network'),
    ctx: { ...D, diagnosis: 'unknown' },
    title: '연결이 끊겼어요',
    body: '잠시 뒤 다시 시도해 주세요.',
    actions: ['retry'],
    detail: null,
  },
  {
    name: 'network unknown D .part',
    error: err('network'),
    ctx: DP,
    title: '연결이 끊겼어요',
    body: `잠시 뒤 다시 시도해 주세요. ${PART_KEPT}`,
    actions: ['resume'],
    detail: null,
  },
  {
    name: 'diskFull 행(.part 있음)',
    error: DISK,
    ctx: DP,
    title: '저장 공간이 부족해요',
    body: `공간을 비운 뒤 이어받으면 받던 곳부터 이어가요. ${PART_KEPT}`,
    actions: ['resume', 'openFolder'],
    detail: '저장 폴더: D:\\영상',
  },
  {
    name: 'diskFull 카드',
    error: DISK,
    ctx: R,
    title: '저장 공간이 부족해요',
    body: '공간을 비운 뒤 다시 시도해 주세요.',
    actions: ['retry', 'changeFolder'],
    detail: '저장 폴더: D:\\영상',
  },
  {
    name: 'fileLocked D',
    error: PATHED('fileLocked'),
    ctx: D,
    title: '다른 프로그램이 파일을 쓰고 있어요',
    body: '이 파일을 연 플레이어나 백신 검사가 끝난 뒤 다시 시도해 주세요.',
    actions: ['retry', 'openFolder'],
    detail: '경로: D:\\영상',
  },
  {
    name: 'io D: 경로와 원문은 L1',
    error: PATHED('io'),
    ctx: DP,
    title: '파일을 저장하지 못했어요',
    body: `폴더에 쓸 권한이 있는지 확인해 주세요. ${PART_KEPT}`,
    actions: ['resume', 'openFolder'],
    detail: `경로: D:\\영상\n${RAW}`,
  },
  {
    name: 'settings',
    error: PATHED('settings'),
    ctx: T,
    title: '설정을 저장하지 못했어요',
    body: '설정 폴더에 쓸 수 없어요. 디스크 공간과 권한을 확인해 주세요.',
    actions: ['openConfigFolder'],
    detail: '경로: D:\\영상',
  },
  {
    name: 'duplicateOutput',
    error: err('duplicateOutput', { type: 'duplicateOutput', jobId: 7 }),
    ctx: R,
    title: t('conflict.inQueue'),
    body: '같은 파일 이름으로 받는 중이거나 대기 중이에요.',
    actions: ['showInList'],
    detail: null,
  },
  {
    name: 'fileMissing D',
    error: PATHED('fileMissing'),
    ctx: D,
    title: '파일을 찾을 수 없어요',
    body: '옮기거나 지웠을 수 있어요.',
    actions: ['openFolder', 'restartFresh'],
    detail: '경로: D:\\영상',
  },
  {
    name: 'fileMissing 토스트: 제목만 혼자 읽힌다',
    error: PATHED('fileMissing'),
    ctx: T,
    title: '파일을 찾을 수 없어요',
    body: '옮기거나 지웠을 수 있어요.',
    actions: ['openFolder'],
    detail: '경로: D:\\영상',
  },
  {
    name: 'invalidInput 쿠키',
    error: err('invalidInput'),
    ctx: { place: 'cookie' },
    title: t('settings.cookie.bothRequired'),
    body: '',
    actions: [],
    detail: null,
  },
  {
    name: 'invalidInput 그 밖: 원문은 L1',
    error: err('invalidInput'),
    ctx: T,
    title: '입력한 값을 쓸 수 없어요',
    body: '다른 값을 넣어 주세요.',
    actions: [],
    detail: RAW,
  },
  {
    name: 'notLoggedIn',
    error: err('notLoggedIn'),
    ctx: R,
    title: '로그인이 필요해요',
    body: '치지직 계정으로 로그인한 뒤 다시 시도해 주세요.',
    actions: ['login'],
    detail: null,
  },
  {
    name: 'notOwnContent: 채널 행',
    error: err('notOwnContent'),
    ctx: { ...R, channelName: '남의 채널', myChannel: '내 채널' },
    title: '내 채널의 영상만 받을 수 있어요',
    body: '이 영상은 다른 채널의 영상이에요.',
    actions: ['close'],
    detail: null,
    rows: ['영상의 채널: ‘남의 채널’', '로그인한 채널: ‘내 채널’'],
  },
  {
    name: 'notOwnContent D: 이름을 모르면 행이 없다',
    error: err('notOwnContent'),
    ctx: D,
    title: '내 채널의 영상만 받을 수 있어요',
    body: '이 영상은 다른 채널의 영상이에요.',
    actions: ['remove'],
    detail: null,
    rows: [],
  },
  {
    name: 'ownershipUnknown R',
    error: err('ownershipUnknown'),
    ctx: R,
    title: '영상의 채널을 확인하지 못했어요',
    body: '내 채널의 영상인지 확인해야 받을 수 있어요. 다시 불러와 주세요.',
    actions: ['retry'],
    detail: RAW,
  },
  {
    name: 'internal',
    error: err('internal'),
    ctx: T,
    title: '문제가 생겼어요',
    body: '앱을 다시 시작해 주세요. 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
    actions: ['copyReport'],
    detail: RAW,
  },
  {
    name: 'jobNotFound는 internal과 같다',
    error: err('jobNotFound'),
    ctx: T,
    title: '문제가 생겼어요',
    body: '앱을 다시 시작해 주세요. 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
    actions: ['copyReport'],
    detail: RAW,
  },
  {
    name: 'cancelled는 프런트에 오면 internal이다',
    error: err('cancelled'),
    ctx: T,
    title: '문제가 생겼어요',
    body: '앱을 다시 시작해 주세요. 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
    actions: ['copyReport'],
    detail: RAW,
  },
];

describe('errorCopy 골든(§15.2 코드별 L0·L1)', () => {
  for (const g of GOLDEN) {
    it(g.name, () => {
      expect(errorCopy(g.error, g.ctx)).toEqual({
        title: g.title,
        body: g.body,
        rows: g.rows ?? [],
        detail: g.detail,
        actions: g.actions,
      });
    });
  }

  it('골든이 28개 코드를 모두 덮는다', () => {
    const covered = new Set(GOLDEN.map((g) => (g.error.code === 'cancelled' ? 'cancelled' : g.error.code)));
    for (const code of ERROR_CODES) expect(covered.has(code), code).toBe(true);
  });
});

describe('errorCopy 규칙', () => {
  it('제목·본문에는 e.message와 apiMessage가 들어가지 않고 L1(detail)에만 간다', () => {
    for (const code of ERROR_CODES) {
      for (const place of PLACES) {
        const c = errorCopy(sample(code), { place, partialBytes: 1, channelName: '가', myChannel: '나' });
        expect(`${c.title}${c.body}${c.rows.join('')}`, `${code} ${place}`).not.toContain(RAW);
        expect(`${c.title}${c.body}${c.rows.join('')}`, `${code} ${place}`).not.toContain(API_MSG);
      }
    }
    expect(errorCopy(sample('api'), R).detail).toContain(API_MSG);
    expect(errorCopy(sample('internal'), R).detail).toBe(RAW);
  });

  it('copyReport 문장 ↔ 버튼: 본문이 복사를 시키면 L0에 [문제 보고용 정보 복사]가 있다', () => {
    const asking: AppError[] = [API_ERR, http(503), err('unsupported'), err('parse'), err('internal'), err('jobNotFound'), err('refreshExhausted')];
    for (const e of asking) {
      for (const ctx of [R, D, DP, T]) {
        const c = errorCopy(e, ctx);
        if (c.body.includes('문제 보고용 정보를 복사해')) expect(c.actions, `${e.code} ${ctx.place}`).toContain('copyReport');
      }
    }
    // 이 문장은 "관리자"에게 보낸다(개발자 아님)
    expect(errorCopy(err('internal'), T).body).toContain('관리자에게 보내 주세요');
    expect(errorCopy(err('internal'), T).body).not.toContain('개발자');
  });

  it('network는 진단 세 분기(local/service/unknown)마다 제목이 다르고, 기본은 unknown이다', () => {
    const titles = DIAGNOSES.map((diagnosis) => errorCopy(err('network'), { ...R, diagnosis }).title);
    expect(new Set(titles).size).toBe(3);
    expect(titles).toEqual(['인터넷에 연결되지 않은 것 같아요', '치지직이 응답하지 않아요', '연결이 끊겼어요']);
    expect(errorCopy(err('network'), R).title).toBe('연결이 끊겼어요');
    // 사용자의 인터넷부터 의심하지 않는다(G-OUTAGE-R9)
    expect(JSON.stringify(titles)).not.toContain('불안정');
  });

  it('resumable 코드: .part가 있으면 body가 "받은 부분은 그대로 있어요." 또는 "받다 만 파일" 문장 중 하나를 말한다', () => {
    // 코어 `is_resumable`이 true인 코드(.part를 남긴다)
    const keep: AppError[] = [API_ERR, http(503), http(429), err('noQualities'), err('parse'), err('network'), DISK, PATHED('fileLocked'), PATHED('io'), err('refreshExhausted')];
    for (const e of keep) {
      expect(errorCopy(e, DP).body, `${e.code}`).toContain(PART_KEPT);
      // 받을 것이 없는 R에서는 말하지 않는다
      expect(errorCopy(e, R).body, `${e.code} R`).not.toContain(PART_KEPT);
    }
    // 코어가 .part를 지우는 코드는 지웠다고 말한다
    const deleted: AppError[] = [AUTH('download'), QUALITY, err('sourceChanged'), err('lengthMismatch')];
    for (const e of deleted) expect(errorCopy(e, DP).body, `${e.code}`).toContain('받다 만 파일');
    // 4xx(408·429 제외)는 같은 요청이 끝내 실패해 .part를 지운다: 남아 있다고 말하지 않는다
    expect(errorCopy(http(403), DP).body).not.toContain(PART_KEPT);
  });

  it('"다시 시도해 주세요."만 있는 본문은 없다(이유가 앞)', () => {
    for (const code of ERROR_CODES) {
      for (const place of PLACES) {
        const b = errorCopy(sample(code), { place, partialBytes: 1 }).body;
        expect(b, `${code} ${place}`).not.toBe('다시 시도해 주세요.');
        if (b.includes('다시 시도해 주세요.')) expect(b.indexOf('다시 시도해 주세요.'), `${code} ${place}`).toBeGreaterThan(0);
      }
    }
  });

  it('encrypted는 우회·쿠키·도구 안내 없이 닫기/지우기만', () => {
    const r = errorCopy(err('encrypted'), { ...R, cookiesEnabled: false });
    expect(`${r.title}${r.body}`).not.toMatch(/쿠키|로그인|도구|방법/);
    expect(r.actions).toEqual(['close']);
  });

  it('http 429의 분은 변수 하나에서 온다(문구에 숫자+단위를 박지 않는다)', () => {
    expect(errorCopy(http(429), R).body).toMatch(/^\d+분쯤 뒤 다시 시도해 주세요\.$/);
  });

  it('D에서 "다시 시도"와 "이어받기"는 .part 유무로만 갈린다', () => {
    expect(errorCopy(err('network'), D).actions).toEqual(['retry']);
    expect(errorCopy(err('network'), DP).actions).toEqual(['resume']);
    expect(errorCopy(DISK, D).actions).toEqual(['retry', 'changeFolder']);
    expect(errorCopy(DISK, DP).actions).toEqual(['resume', 'openFolder']);
  });
});

describe('actionLabel(용어집 라벨, 창을 여는 버튼은 …)', () => {
  const LABELS: [ActionId, string][] = [
    ['retry', '다시 시도'],
    ['resume', '이어받기'],
    ['restartFresh', '처음부터 다시 받기'],
    ['close', '닫기'],
    ['remove', '목록에서 지우기'],
    ['openCookieSettings', '네이버 로그인 정보 넣기…'],
    ['reenterCookies', '네이버 로그인 정보 다시 넣기…'],
    ['reresolve', '다시 불러오기'],
    ['copyReport', '문제 보고용 정보 복사'],
    ['openConfigFolder', '설정 폴더 열기'],
    ['showInList', '목록에서 보기'],
    ['changeFolder', '변경…'],
    ['login', '치지직으로 로그인'],
  ];
  for (const [id, label] of LABELS) {
    it(`${id} → ${label}`, () => {
      expect(actionLabel(id)).toBe(label);
    });
  }

  it('폴더 보기만 OS마다 다르다(D39)', () => {
    expect(actionLabel('openFolder', 'macos')).toBe('Finder에서 보기');
    expect(actionLabel('openFolder', 'windows')).toBe('폴더에서 보기');
    expect(actionLabel('openFolder')).toBe('폴더에서 보기');
  });

  it('창을 여는 버튼 라벨만 …로 끝난다', () => {
    const opens: ActionId[] = ['openCookieSettings', 'reenterCookies', 'changeFolder'];
    for (const [id, label] of LABELS) expect(label.endsWith('…'), id).toBe(opens.includes(id));
  });
});

describe('AppError 좁히기', () => {
  it('isAppError', () => {
    expect(isAppError(err('io'))).toBe(true);
    expect(isAppError({ code: 'nope', message: '' })).toBe(false);
    expect(isAppError('Command x not allowed')).toBe(false);
    expect(isAppError(null)).toBe(false);
  });

  it('toAppError: 문자열·Error는 internal, cancelled도 internal', () => {
    expect(toAppError('not allowed')).toMatchObject({ code: 'internal', message: 'not allowed' });
    expect(toAppError(new Error('boom'))).toMatchObject({ code: 'internal', message: 'boom' });
    expect(toAppError(err('cancelled')).code).toBe('internal');
    const io = err('io');
    expect(toAppError(io)).toBe(io);
  });
});
