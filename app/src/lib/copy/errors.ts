// 오류 문구와 복구 동작(docs/design/app.md §9 표). `errorCopy`가 표를 조합한다.
import type { AppError, ErrorCode, ErrorPayload } from '../bindings';
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
  | 'showInList';

export type ErrorPlace =
  | 'resolve' // R: 불러오기 InlineAlert
  | 'job' // D: 목록 항목
  | 'cookie' // 설정의 쿠키 입력(인라인)
  | 'other'; // 토스트·배너

export interface ErrorContext {
  place: ErrorPlace;
  /** D: 작업의 `partialBytes`. 있으면 "이어받기", 없으면 "다시 시도" */
  partialBytes?: number | null;
  /** 지금 네이버 로그인 정보를 쓰고 있는가(설정 `useNaverCookies && naverCookiesSaved`) */
  cookiesEnabled?: boolean;
  /** (Phase 3) 영상의 채널 이름과 로그인한 채널 이름 */
  channelName?: string;
  myChannel?: string;
}

export interface ErrorCopy {
  title: string;
  /** 왜 또는 무엇을 하면 되는지. 없으면 빈 문자열 */
  body: string;
  /** 문구 아래 작게 보이는 값(경로·원문 메시지). 없으면 `null` */
  detail: string | null;
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

function copy(title: string, body: string, actions: ActionId[], detail: string | null = null): ErrorCopy {
  return { title, body, detail, actions };
}

/**
 * §9 표를 조합한다. 같은 코드라도 위치(R/D), 단계, 쿠키 사용 여부, `.part` 유무로 문구·동작이 달라진다.
 */
export function errorCopy(raw: AppError, ctx: ErrorContext): ErrorCopy {
  const e = raw.code === 'cancelled' ? { ...raw, code: 'internal' as const } : raw;
  const job = ctx.place === 'job';
  const hasPart = (ctx.partialBytes ?? 0) > 0;
  // "다시 시도 / 이어받기": R은 다시 불러오고, D는 `.part`가 있으면 이어받기, 없으면 다시 시도(§6.3)
  const again: ActionId = job ? (hasPart ? 'resume' : 'retry') : 'retry';
  // "닫기 / 목록에서 지우기"
  const dismiss: ActionId = job ? 'remove' : 'close';

  switch (e.code) {
    case 'invalidUrl':
      return copy(
        '치지직 VOD나 클립 주소가 아니에요',
        '영상 주소는 chzzk.naver.com/video/… 또는 …/clips/… 형태예요. 라이브 주소는 받을 수 없어요.',
        job ? ['remove'] : ['retry'],
      );

    case 'api': {
      const p = payload(e, 'api');
      const body = p?.apiMessage?.trim()
        ? p.apiMessage.trim()
        : `잠시 뒤 다시 시도해 주세요. (코드 ${p?.code ?? '?'})`;
      return copy('치지직이 요청을 거절했어요', body, [again]);
    }

    case 'http': {
      const status = payload(e, 'http')?.status ?? 0;
      if (status === 404 || status === 410) {
        return copy('영상을 찾을 수 없어요', '삭제됐거나 비공개로 바뀌었을 수 있어요.', [dismiss]);
      }
      if (status === 429) {
        return copy('요청이 너무 많아요', '1분쯤 뒤에 다시 시도해 주세요.', [again]);
      }
      return copy(
        status ? `치지직 서버에 문제가 있어요 (HTTP ${status})` : '치지직 서버에 문제가 있어요',
        '잠시 뒤 다시 시도해 주세요.',
        [again],
      );
    }

    case 'authRequired':
      if (e.stage === 'download') {
        return copy(
          '영상 서버가 접근을 막았어요',
          '링크를 새로 받아도 계속 거절돼요. 받던 부분은 지워졌어요.',
          ['restartFresh'],
        );
      }
      return ctx.cookiesEnabled
        ? copy(
            '네이버 로그인 정보가 만료됐어요',
            '브라우저에서 네이버에 다시 로그인한 뒤 새 값을 넣어 주세요.',
            ['reenterCookies', again],
          )
        : copy(
            '네이버 로그인이 필요한 영상이에요',
            '연령 제한이나 구독자 전용 영상이에요. 설정에서 네이버 로그인 정보를 넣으면 받을 수 있어요.',
            ['openCookieSettings', again],
          );

    case 'noPlayback':
      if (payload(e, 'noPlayback')?.adult) {
        return copy(
          '성인 인증이 필요한 영상이에요',
          ctx.cookiesEnabled
            ? '성인 인증한 계정의 로그인 정보인지 확인해 주세요.'
            : '네이버 로그인 정보가 있어야 받을 수 있어요.',
          [ctx.cookiesEnabled ? 'reenterCookies' : 'openCookieSettings', again],
        );
      }
      return copy(
        '아직 받을 수 없는 영상이에요',
        '방송 직후라 처리 중이거나 다시보기가 꺼져 있을 수 있어요.',
        [again],
      );

    case 'encrypted':
      // 우회 방법이나 쿠키 안내를 넣지 않는다(§9).
      return copy(
        '보호된 영상이라 받을 수 없어요',
        '중계권 등의 이유로 암호화된 영상은 지원하지 않아요.',
        [dismiss],
      );

    case 'noQualities':
      return copy(
        '받을 수 있는 화질이 없어요',
        '영상 처리가 끝나지 않았을 수 있어요. 잠시 뒤 다시 시도해 주세요.',
        [again],
      );

    case 'qualityNotFound': {
      const requested = payload(e, 'qualityNotFound')?.requested ?? '';
      return copy(
        requested ? `고른 화질(${requested})이 더 이상 없어요` : '고른 화질이 더 이상 없어요',
        '다시 불러와서 다른 화질을 골라 주세요. 받던 부분은 지우고 새로 받아요.',
        job ? ['reresolve', 'remove'] : ['retry'],
      );
    }

    case 'playbackChanged':
      return copy(
        '영상 형식이 바뀌었어요',
        '치지직이 영상을 다시 처리했어요. 다시 불러와서 화질을 골라 처음부터 받아야 해요.',
        job ? ['reresolve', 'remove'] : ['retry'],
      );

    case 'sourceChanged':
      return copy(
        '원본 영상이 바뀌어 이어받을 수 없어요',
        '받던 부분은 지웠어요. 처음부터 다시 받아 주세요.',
        job ? ['restartFresh'] : ['retry'],
      );

    case 'refreshExhausted':
      return copy(
        '영상 링크가 계속 만료돼요',
        '링크를 여러 번 새로 받았지만 받기를 이어 가지 못했어요. 받은 부분은 남아 있어요.',
        [again],
      );

    case 'unsupported':
      return copy(
        '아직 지원하지 않는 영상 형식이에요',
        '문제 보고용 정보를 복사해 개발자에게 보내 주세요.',
        job ? ['copyReport', 'remove'] : ['copyReport'],
      );

    case 'parse':
      return copy(
        '치지직 응답을 읽지 못했어요',
        '치지직이 바뀌었을 수 있어요. 잠시 뒤 다시 시도하고, 계속되면 앱을 업데이트해 주세요.',
        [again, 'copyReport'],
      );

    case 'lengthMismatch':
      return copy(
        '받은 파일이 손상됐어요',
        '받은 크기가 예상과 달라 받던 부분을 지웠어요. 처음부터 다시 받아 주세요.',
        job ? ['restartFresh'] : ['retry'],
      );

    case 'network':
      return copy(
        '인터넷 연결이 불안정해요',
        job && hasPart
          ? '연결을 확인한 뒤 다시 시도해 주세요. 받은 부분은 남아 있어요.'
          : '연결을 확인한 뒤 다시 시도해 주세요.',
        [again],
      );

    case 'diskFull': {
      const path = pathOf(e);
      return copy(
        '저장 공간이 부족해요',
        path
          ? `${path}가 있는 디스크의 공간을 비운 뒤 이어받으세요.`
          : '저장 폴더가 있는 디스크의 공간을 비운 뒤 이어받으세요.',
        [again, 'openFolder'],
      );
    }

    case 'fileLocked':
      return copy(
        '다른 프로그램이 파일을 쓰고 있어요',
        '이 파일을 연 플레이어나 백신 검사가 끝난 뒤 다시 시도해 주세요.',
        [again, 'openFolder'],
        pathOf(e),
      );

    case 'io':
      return copy(
        '파일을 저장하지 못했어요',
        '폴더에 쓸 권한이 있는지 확인해 주세요.',
        [again, 'openFolder'],
        pathOf(e),
      );

    case 'settings':
      return copy(
        '설정을 저장하지 못했어요',
        '설정 폴더에 쓸 수 없어요. 디스크 공간과 권한을 확인해 주세요.',
        ['openConfigFolder', 'retry'],
      );

    case 'duplicateOutput':
      return copy(t('conflict.inQueue'), '', ['showInList']);

    case 'fileMissing':
      return copy('파일을 찾을 수 없어요. 옮기거나 지웠을 수 있어요', '', ['openFolder'], pathOf(e));

    case 'invalidInput':
      return ctx.place === 'cookie'
        ? copy(t('settings.cookie.bothRequired'), '', [])
        : copy('입력한 값을 쓸 수 없어요', '', [], e.message || null);

    case 'notLoggedIn':
    case 'notOwnContent':
    case 'ownershipUnknown': {
      const title = '내 채널의 영상만 받을 수 있어요';
      const actions: ActionId[] = job ? ['remove'] : ['close', 'retry'];
      if (e.code === 'notOwnContent') {
        const body =
          ctx.channelName && ctx.myChannel
            ? `이 영상은 '${ctx.channelName}' 채널의 영상이에요. 로그인한 채널: '${ctx.myChannel}'`
            : '로그인한 채널의 영상이 아니에요.';
        return copy(title, body, actions);
      }
      if (e.code === 'ownershipUnknown') {
        return copy(title, '영상의 채널을 확인하지 못해 받을 수 없어요.', actions);
      }
      return copy(title, '치지직 계정으로 로그인한 뒤 다시 불러와 주세요.', actions);
    }

    case 'jobNotFound':
    case 'internal':
      return copy('문제가 생겼어요. 앱을 다시 시작해 주세요.', '', ['copyReport'], e.message || null);

    case 'cancelled':
      // 위에서 internal로 바꿨다. 타입 검사를 위해 남긴다.
      return copy('문제가 생겼어요. 앱을 다시 시작해 주세요.', '', ['copyReport'], e.message || null);

    default: {
      const never: never = e.code;
      return copy('문제가 생겼어요. 앱을 다시 시작해 주세요.', '', ['copyReport'], String(never));
    }
  }
}

const ACTION_LABEL: Record<ActionId, CopyKey> = {
  retry: 'action.retry',
  resume: 'action.resume',
  restartFresh: 'action.restartFresh',
  close: 'action.close',
  remove: 'action.remove',
  openCookieSettings: 'action.openCookieSettings',
  reenterCookies: 'action.reenterCookies',
  reresolve: 'action.reresolve',
  copyReport: 'action.copyReport',
  openFolder: 'action.openFolder',
  openConfigFolder: 'action.openConfigFolder',
  showInList: 'action.showInList',
};

export function actionLabel(a: ActionId): string {
  return t(ACTION_LABEL[a]);
}
