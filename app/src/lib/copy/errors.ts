// 오류 문구와 복구 동작(docs/design/system/content.md §9 틀·§15.2 코드별 L0 표). `errorCopy`가 표를 조합한다.
// L0 = 제목(사건 한 문장) + 본문(할 일 한 가지, 알면 이유를 앞에) + 버튼(≤3). L1 = '자세히' 안에만 가는 `detail`.
// 코어·셸 원문(`e.message`)과 `apiMessage`는 제목·본문에 넣지 않는다(DC8): `detail`로만 간다.
import type { AppError, ErrorCode, ErrorPayload, Os } from '../bindings';
import { revealLabel } from '../platform';
import { t, type CopyKey } from './ko';

/** 오류 문구 옆에 놓는 동작. 버튼 하나가 하나다. */
export type ActionId =
  | 'retry' // resolve를 다시 부른다(R) / `.part`가 없는 작업을 다시 시작한다(D, resume_job)
  | 'resume' // `.part`가 있는 작업을 이어받는다(D, resume_job)
  | 'restartFresh' // resume_job(id, true)
  | 'close' // 카드·오류를 닫는다(R)
  | 'remove' // 목록에서 지운다(D)
  | 'openCookieSettings' // 설정의 고급 섹션을 펼쳐 연다
  | 'reenterCookies' // 같은 곳, 문구만 다르다
  | 'reresolve' // 그 작업의 주소를 입력줄에 넣고 다시 불러온다(D)
  | 'copyReport'
  | 'openFolder'
  | 'openConfigFolder'
  | 'showInList'
  | 'changeFolder' // 저장 폴더를 바꾼다(설정의 저장 위치, 폴더 고르기 창)
  | 'login'; // 치지직 로그인을 시작한다

export type ErrorPlace =
  | 'resolve' // R: 불러오기 InlineAlert
  | 'job' // D: 목록 항목
  | 'cookie' // 설정의 쿠키 입력(인라인)
  | 'other'; // T: 토스트·배너(제목만 혼자 읽힌다)

/** 연결 진단(g-outage §5.5): 내 쪽 / 치지직 쪽 / 모름 */
export type ErrorDiagnosis = 'local' | 'service' | 'unknown';

export interface ErrorContext {
  place: ErrorPlace;
  /** D: 작업의 `partialBytes`. 있으면 "이어받기", 없으면 "다시 시도" */
  partialBytes?: number | null;
  /** 지금 네이버 로그인 정보를 쓰고 있는가(설정 `useNaverCookies && naverCookiesSaved`) */
  cookiesEnabled?: boolean;
  /** `network`·`http`의 진단. 없으면 `unknown` */
  diagnosis?: ErrorDiagnosis;
  /** (Phase 3) 영상의 채널 이름과 로그인한 채널 이름 */
  channelName?: string;
  myChannel?: string;
}

export interface ErrorCopy {
  /** 무슨 일인지 한 문장. 마침표 없음, 토스트에 혼자 나가도 읽힌다 */
  title: string;
  /** 할 일 한 가지(이유가 앞). 없으면 빈 문자열 */
  body: string;
  /** 본문 아래 "라벨: 값" 행(`notOwnContent`의 두 채널). 없으면 빈 배열 */
  rows: string[];
  /** L1 "자세히" 안에만 보이는 줄(오류 코드·경로·서버/코어 원문), 줄바꿈으로 잇는다. 없으면 `null` */
  detail: string | null;
  /** L0 버튼, 최대 3 */
  actions: ActionId[];
}

const ALL_CODES: Record<ErrorCode, true> = {
  invalidUrl: true,
  api: true,
  http: true,
  authRequired: true,
  noPlayback: true,
  encrypted: true,
  noQualities: true,
  qualityNotFound: true,
  playbackChanged: true,
  sourceChanged: true,
  refreshExhausted: true,
  unsupported: true,
  parse: true,
  lengthMismatch: true,
  network: true,
  diskFull: true,
  fileLocked: true,
  io: true,
  settings: true,
  cancelled: true,
  jobNotFound: true,
  duplicateOutput: true,
  invalidInput: true,
  fileMissing: true,
  notLoggedIn: true,
  notOwnContent: true,
  ownershipUnknown: true,
  internal: true,
};

/** 모든 오류 코드(테스트·검사용). */
export const ERROR_CODES = Object.keys(ALL_CODES) as ErrorCode[];

/** `invoke`가 던진 값이 셸 `AppError`인가. */
export function isAppError(e: unknown): e is AppError {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.code === 'string' && o.code in ALL_CODES && typeof o.message === 'string';
}

/**
 * `invoke`가 던진 아무 값을 `AppError`로. ACL 거부·처리기 없음처럼 문자열로 오는 것과,
 * 프런트에 와서는 안 되는 `cancelled`(§5)는 `internal`로 바꾼다.
 */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) {
    return e.code === 'cancelled' ? { ...e, code: 'internal' } : e;
  }
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : String(e);
  return { code: 'internal', message, stage: null, resumable: false, payload: null };
}

type P<K extends ErrorPayload['type']> = Extract<ErrorPayload, { type: K }>;

function payload<K extends ErrorPayload['type']>(e: AppError, type: K): P<K> | null {
  return e.payload && e.payload.type === type ? (e.payload as P<K>) : null;
}

function pathOf(e: AppError): string | null {
  return payload(e, 'path')?.path ?? null;
}

function copy(
  title: string,
  body: string,
  actions: ActionId[],
  detail: string | null = null,
  rows: string[] = [],
): ErrorCopy {
  return { title, body, rows, detail, actions };
}

/** 줄 목록에서 빈 것을 빼고 잇는다. 하나도 없으면 `null` */
function lines(...xs: (string | null | undefined | false)[]): string | null {
  const l = xs.filter((x): x is string => typeof x === 'string' && x !== '');
  return l.length > 0 ? l.join('\n') : null;
}

/** 코어·셸 원문. 개발자용이라 L1에만 간다(content §2 "코어 원문 비노출") */
function rawOf(e: AppError): string | null {
  const m = e.message?.trim();
  return m ? m : null;
}

/** 429 다음 시도까지 기다리라고 말하는 분(`{mins}`). 숫자와 단위를 문구에 박지 않는다 */
const RATE_LIMIT_RETRY_MINS = 1;

/** 받다 만 파일이 남은 실패: 현우의 첫 질문에 답한다(content §9.2-5) */
const PART_KEPT = '받은 부분은 그대로 있어요.';

/** 같은 요청이 끝내 실패하는 4xx가 아니면 코어가 `.part`를 남긴다(`Error::is_resumable`의 `HttpStatus`) */
function httpKeepsPart(status: number): boolean {
  return !(status >= 400 && status < 500) || status === 408 || status === 429;
}

/** 이 오류로 끝나도 `.part`가 남는 코드(코어 `is_resumable`). 본문 끝에 `PART_KEPT`를 붙이는 코드의 집합 */
function keepsPart(e: AppError): boolean {
  switch (e.code) {
    case 'api':
    case 'noQualities':
    case 'parse':
    case 'network':
    case 'fileLocked':
    case 'io':
    case 'refreshExhausted':
      return true;
    case 'http':
      return httpKeepsPart(payload(e, 'http')?.status ?? 0);
    default:
      return false;
  }
}

/** 본문 끝에 받은 부분 문장을 붙인다 */
function withKept(sentences: string): string {
  return `${sentences} ${PART_KEPT}`;
}

/** 본문 문장 뒤에 받은 부분 문장을 붙인다. 목록 항목에 `.part`가 있을 때만 */
function withPart(e: AppError, sentences: string, ctx: ErrorContext): string {
  const hasPart = ctx.place === 'job' && (ctx.partialBytes ?? 0) > 0;
  return hasPart && keepsPart(e) ? withKept(sentences) : sentences;
}

/** L1: 치지직 응답(원문 메시지와 번호). 제목·본문에는 들어가지 않는다 */
function apiDetail(e: AppError): string | null {
  const p = payload(e, 'api');
  const msg = p?.apiMessage?.trim();
  return lines(msg ? `치지직 응답: ${msg}` : null, p ? `치지직 응답 코드: ${p.code}` : null);
}

/** L1: HTTP 번호는 소문자 kebab 오류 코드로만 보인다(`http-404`) */
function httpDetail(status: number): string | null {
  return status > 0 ? `오류 코드: http-${status}` : null;
}

/** L1 한 줄 "경로: …" */
function pathLine(label: string, path: string | null): string | null {
  return path ? `${label}: ${path}` : null;
}

/**
 * §15.2 표를 조합한다. 같은 코드라도 위치(R/D/T), 단계, 쿠키 사용 여부, `.part` 유무, 연결 진단으로
 * 문구·동작이 달라진다. 자리 조합은 이 함수 하나가 한다(content §9.2-10).
 */
export function errorCopy(raw: AppError, ctx: ErrorContext): ErrorCopy {
  const e = raw.code === 'cancelled' ? { ...raw, code: 'internal' as const } : raw;
  const job = ctx.place === 'job';
  const hasPart = job && (ctx.partialBytes ?? 0) > 0;
  // "다시 시도 / 이어받기": R은 다시 불러오고, D는 `.part`가 있으면 이어받기, 없으면 다시 시도(§6.3)
  const again: ActionId = hasPart ? 'resume' : 'retry';
  // "다시 불러오기": D는 그 작업의 주소를 입력줄에 넣고 다시 불러온다. R은 같은 주소를 다시 부르는 retry다
  const reload: ActionId = job ? 'reresolve' : 'retry';
  // "처음부터 다시 받기": R에는 지울 받다 만 파일이 없다
  const fresh: ActionId = job ? 'restartFresh' : 'retry';
  // "닫기 / 목록에서 지우기"
  const dismiss: ActionId = job ? 'remove' : 'close';
  const diagnosis = ctx.diagnosis ?? 'unknown';

  switch (e.code) {
    case 'invalidUrl':
      // 유일하게 버튼이 없다: 입력칸이 행동이다
      return copy(
        '치지직 영상 주소가 아니에요',
        '영상 주소는 chzzk.naver.com/video/… 또는 …/clips/… 모양이에요. 라이브 주소는 받을 수 없어요.',
        [],
      );

    case 'api':
      return copy(
        '치지직이 요청을 거절했어요',
        withPart(e, '잠시 뒤 다시 시도해 주세요. 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.', ctx),
        [again, 'copyReport'],
        apiDetail(e),
      );

    case 'http': {
      const status = payload(e, 'http')?.status ?? 0;
      if (status === 404 || status === 410) {
        return copy('영상을 찾을 수 없어요', '삭제됐거나 비공개로 바뀌었을 수 있어요.', [dismiss], httpDetail(status));
      }
      if (status === 429) {
        return copy(
          '요청이 너무 많아요',
          withPart(e, `${RATE_LIMIT_RETRY_MINS}분쯤 뒤 다시 시도해 주세요.`, ctx),
          [again],
          httpDetail(status),
        );
      }
      if (diagnosis === 'service') {
        return copy(
          '치지직이 응답하지 않아요',
          withPart(e, '인터넷은 연결된 것 같아요. 치지직 쪽 문제일 수 있어 잠시 뒤 다시 시도해 주세요.', ctx),
          [again],
          httpDetail(status),
        );
      }
      return copy(
        '치지직 응답을 받지 못했어요',
        withPart(e, '잠시 뒤 다시 시도해 주세요. 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.', ctx),
        [again, 'copyReport'],
        httpDetail(status),
      );
    }

    case 'authRequired':
      if (e.stage === 'download') {
        return copy(
          '영상 서버가 접근을 막았어요',
          '주소를 새로 받아도 계속 거절돼요. 받다 만 파일은 지웠어요.',
          [fresh],
        );
      }
      return ctx.cookiesEnabled
        ? copy(
            '네이버 로그인 정보가 만료됐어요',
            '브라우저에서 네이버에 다시 로그인한 뒤 새 값을 넣어 주세요.',
            ['reenterCookies'],
          )
        : copy(
            '네이버 로그인이 필요한 영상이에요',
            '연령 제한이나 구독자 전용 영상이에요. 설정에서 네이버 로그인 정보를 넣으면 받을 수 있어요.',
            ['openCookieSettings'],
          );

    case 'noPlayback':
      if (payload(e, 'noPlayback')?.adult) {
        return ctx.cookiesEnabled
          ? copy(
              '성인 인증이 필요한 영상이에요',
              '성인 인증한 계정의 네이버 로그인 정보인지 확인해 주세요.',
              ['reenterCookies'],
            )
          : copy(
              '성인 인증이 필요한 영상이에요',
              '네이버 로그인 정보가 있어야 받을 수 있어요.',
              ['openCookieSettings'],
            );
      }
      return copy(
        '아직 받을 수 없는 영상이에요',
        '방송 직후라 처리 중이거나 다시보기가 꺼져 있을 수 있어요.',
        [reload],
      );

    case 'encrypted':
      // 우회 방법이나 쿠키 안내를 넣지 않는다(§9.2-6).
      return copy(
        '보호된 영상이라 받을 수 없어요',
        '중계권 등의 이유로 암호화된 영상은 지원하지 않아요.',
        [dismiss],
      );

    case 'noQualities':
      return copy(
        '받을 수 있는 화질이 없어요',
        withPart(e, '영상 처리가 끝나지 않았을 수 있어요. 잠시 뒤 다시 시도해 주세요.', ctx),
        [reload],
      );

    case 'qualityNotFound': {
      const requested = payload(e, 'qualityNotFound')?.requested;
      return copy(
        '고른 화질이 더 이상 없어요',
        '다시 불러와서 다른 화질을 골라 주세요. 받다 만 파일은 지우고 새로 받아요.',
        [reload],
        requested ? `고른 화질: ${requested}` : null,
      );
    }

    case 'playbackChanged':
      return copy(
        '영상 형식이 바뀌었어요',
        '치지직이 영상을 다시 처리했어요. 다시 불러와서 화질을 골라 처음부터 받아야 해요.',
        [reload],
      );

    case 'sourceChanged':
      return copy(
        '원본 영상이 바뀌어 이어받을 수 없어요',
        '받다 만 파일은 지웠어요. 처음부터 다시 받아 주세요.',
        [fresh],
      );

    case 'refreshExhausted':
      return copy(
        '영상 주소가 계속 만료돼요',
        hasPart
          ? withKept('주소를 여러 번 새로 받았지만 이어받지 못했어요.')
          : '주소를 여러 번 새로 받았지만 이어받지 못했어요.',
        [again, 'copyReport'],
      );

    case 'unsupported':
      return copy(
        '아직 지원하지 않는 영상 형식이에요',
        '문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
        ['copyReport'],
        rawOf(e),
      );

    case 'parse':
      return copy(
        '치지직 응답을 읽지 못했어요',
        withPart(
          e,
          '치지직이 바뀌었을 수 있어요. 잠시 뒤 다시 시도하고, 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
          ctx,
        ),
        [again, 'copyReport'],
        rawOf(e),
      );

    case 'lengthMismatch':
      return copy(
        '받은 파일이 손상됐어요',
        '받은 크기가 예상과 달라 받다 만 파일을 지웠어요. 처음부터 다시 받아 주세요.',
        [fresh],
      );

    case 'network':
      // 3분류 진단(g-outage §5.5): 진단 없이 사용자의 인터넷부터 의심하지 않는다
      if (diagnosis === 'local') {
        return copy(
          '인터넷에 연결되지 않은 것 같아요',
          withPart(e, '연결을 확인한 뒤 다시 시도해 주세요.', ctx),
          [again],
        );
      }
      if (diagnosis === 'service') {
        return copy(
          '치지직이 응답하지 않아요',
          withPart(e, '인터넷은 연결된 것 같아요. 치지직 쪽 문제일 수 있어 잠시 뒤 다시 시도해 주세요.', ctx),
          [again],
        );
      }
      return copy('연결이 끊겼어요', withPart(e, '잠시 뒤 다시 시도해 주세요.', ctx), [again]);

    case 'diskFull': {
      const detail = pathLine('저장 폴더', pathOf(e));
      // 행: 받다 만 파일이 남아 있어 이어받을 수 있다. 그 밖(카드·토스트·받다 만 파일 없음): 저장 폴더를 바꾸거나 다시 시도
      return hasPart
        ? copy(
            '저장 공간이 부족해요',
            withKept('공간을 비운 뒤 이어받으면 받던 곳부터 이어가요.'),
            ['resume', 'openFolder'],
            detail,
          )
        : copy('저장 공간이 부족해요', '공간을 비운 뒤 다시 시도해 주세요.', ['retry', 'changeFolder'], detail);
    }

    case 'fileLocked':
      return copy(
        '다른 프로그램이 파일을 쓰고 있어요',
        withPart(e, '이 파일을 연 플레이어나 백신 검사가 끝난 뒤 다시 시도해 주세요.', ctx),
        job ? [again, 'openFolder'] : [again],
        pathLine('경로', pathOf(e)),
      );

    case 'io':
      return copy(
        '파일을 저장하지 못했어요',
        withPart(e, '폴더에 쓸 권한이 있는지 확인해 주세요.', ctx),
        job ? [again, 'openFolder'] : [again],
        lines(pathLine('경로', pathOf(e)), rawOf(e)),
      );

    case 'settings':
      return copy(
        '설정을 저장하지 못했어요',
        '설정 폴더에 쓸 수 없어요. 디스크 공간과 권한을 확인해 주세요.',
        ['openConfigFolder'],
        pathLine('경로', pathOf(e)),
      );

    case 'duplicateOutput':
      return copy(t('conflict.inQueue'), '같은 파일 이름으로 받는 중이거나 대기 중이에요.', ['showInList']);

    case 'fileMissing':
      // 완료 항목의 [열기]에서 나온다(토스트·항목). 폴더는 그 작업의 폴더다.
      return copy(
        '파일을 찾을 수 없어요',
        '옮기거나 지웠을 수 있어요.',
        ctx.place === 'resolve' ? [] : job ? ['openFolder', 'restartFresh'] : ['openFolder'],
        pathLine('경로', pathOf(e)),
      );

    case 'invalidInput':
      // 입력칸이 행동이다. 합니다체 원문은 L1에만 간다
      return ctx.place === 'cookie'
        ? copy(t('settings.cookie.bothRequired'), '', [])
        : copy('입력한 값을 쓸 수 없어요', '다른 값을 넣어 주세요.', [], rawOf(e));

    case 'notLoggedIn':
      // 로그인 화면이 막는 게이트 뒤의 command가 로그인 전에 불렸을 때(드물다)
      return copy('로그인이 필요해요', '치지직 계정으로 로그인한 뒤 다시 시도해 주세요.', ['login']);

    case 'notOwnContent': {
      // 본문은 한 문장, 두 채널 이름은 "라벨: ‘값’" 행이다(서술형과 섞지 않는다, §6.4)
      const rows =
        ctx.channelName && ctx.myChannel
          ? [`영상의 채널: ‘${ctx.channelName}’`, `로그인한 채널: ‘${ctx.myChannel}’`]
          : [];
      return copy('내 채널의 영상만 받을 수 있어요', '이 영상은 다른 채널의 영상이에요.', [dismiss], null, rows);
    }

    case 'ownershipUnknown':
      return copy(
        '영상의 채널을 확인하지 못했어요',
        '내 채널의 영상인지 확인해야 받을 수 있어요. 다시 불러와 주세요.',
        [reload],
        rawOf(e),
      );

    case 'jobNotFound':
    case 'internal':
    case 'cancelled': // 위에서 internal로 바꿨다. 타입 검사를 위해 남긴다.
    default:
      return copy(
        '문제가 생겼어요',
        '앱을 다시 시작해 주세요. 계속되면 문제 보고용 정보를 복사해 관리자에게 보내 주세요.',
        ['copyReport'],
        rawOf(e),
      );
  }
}

/** 동작 버튼 글자의 키. `openFolder`만 OS마다 다르다(D39) */
const ACTION_LABEL: Record<Exclude<ActionId, 'openFolder'>, CopyKey> = {
  retry: 'action.retry',
  resume: 'action.resume',
  restartFresh: 'action.restartFresh',
  close: 'common.close',
  remove: 'action.remove',
  openCookieSettings: 'action.openCookieSettings',
  reenterCookies: 'action.reenterCookies',
  reresolve: 'action.reresolve',
  copyReport: 'action.copyReport',
  openConfigFolder: 'common.openConfigFolder',
  showInList: 'common.showInList',
  changeFolder: 'folder.change',
  login: 'auth.login',
};

/**
 * 동작 버튼 글자(용어집 라벨, 다른 창을 여는 버튼은 끝에 …). 폴더 보기(`openFolder`)만 OS마다 다르다
 * (D39: Finder에서 보기 / 폴더에서 보기).
 * 이 파일은 e2e(Node)도 읽는 순수 TS라 스토어를 읽지 않고, 호출부가 `platform.os`를 넘긴다(기본은 macOS가 아닌 쪽).
 */
export function actionLabel(a: ActionId, os: Os = 'linux'): string {
  return a === 'openFolder' ? revealLabel(os) : t(ACTION_LABEL[a]);
}
