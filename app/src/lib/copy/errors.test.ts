import { describe, expect, it } from 'vitest';
import type { AppError, ErrorCode, ErrorPayload, Stage } from '../bindings';
import {
  ERROR_CODES,
  actionLabel,
  errorCopy,
  isAppError,
  toAppError,
  type ActionId,
  type ErrorPlace,
} from './errors';

function err(code: ErrorCode, payload: ErrorPayload | null = null, stage: Stage | null = null): AppError {
  return { code, message: `msg-${code}`, stage, resumable: false, payload };
}

const PLACES: ErrorPlace[] = ['resolve', 'job', 'cookie', 'other'];

describe('errorCopy 전체 표', () => {
  it('오류 코드는 28개(코어 20 + 셸 8)', () => {
    expect(ERROR_CODES).toHaveLength(28);
  });

  // 모든 code × 위치 × .part 유무 × 쿠키 사용에서 제목이 있고, 동작 이름이 알려진 것이며, 문구가 빈 자리 없이 채워진다.
  for (const code of ERROR_CODES) {
    for (const place of PLACES) {
      it(`${code} @ ${place}`, () => {
        for (const partialBytes of [null, 1024]) {
          for (const cookiesEnabled of [false, true]) {
            const c = errorCopy(err(code), { place, partialBytes, cookiesEnabled });
            expect(c.title.length).toBeGreaterThan(0);
            expect(`${c.title}${c.body}`).not.toMatch(/\{\w+\}|undefined|null/);
            for (const a of c.actions) expect(actionLabel(a).length).toBeGreaterThan(0);
            // D에서 "다시 시도"와 "이어받기"는 .part 유무로만 갈린다(§6.3). settings는 배너(B2) 전용이다.
            if (place === 'job' && partialBytes == null) expect(c.actions).not.toContain('resume');
            if (place === 'job' && partialBytes != null && code !== 'settings') expect(c.actions).not.toContain('retry');
            // R에는 목록 동작이 없다.
            if (place === 'resolve') {
              const jobOnly: ActionId[] = ['resume', 'restartFresh', 'remove', 'reresolve', 'openFolder'];
              for (const a of jobOnly) expect(c.actions).not.toContain(a);
            }
          }
        }
      });
    }
  }
});

describe('errorCopy 분기', () => {
  const R = { place: 'resolve' as const };
  const D = { place: 'job' as const };

  it('invalidUrl은 R에서 다시 시도', () => {
    const c = errorCopy(err('invalidUrl'), R);
    expect(c.title).toBe('치지직 VOD나 클립 주소가 아니에요');
    expect(c.body).toContain('라이브 주소는 받을 수 없어요');
    expect(c.actions).toEqual(['retry']);
  });

  it('api: apiMessage가 있으면 그대로, 없으면 코드', () => {
    const withMsg = errorCopy(err('api', { type: 'api', code: 9, apiMessage: ' 비공개 영상 ' }), R);
    expect(withMsg.title).toBe('치지직이 요청을 거절했어요');
    expect(withMsg.body).toBe('비공개 영상');
    const noMsg = errorCopy(err('api', { type: 'api', code: 9, apiMessage: null }), R);
    expect(noMsg.body).toBe('잠시 뒤 다시 시도해 주세요. (코드 9)');
  });

  it('http 404·410·429·그 밖', () => {
    const http = (status: number) => err('http', { type: 'http', status, requestKind: 'api' });
    for (const s of [404, 410]) {
      expect(errorCopy(http(s), R)).toMatchObject({ title: '영상을 찾을 수 없어요', actions: ['close'] });
      expect(errorCopy(http(s), D).actions).toEqual(['remove']);
    }
    expect(errorCopy(http(429), R)).toMatchObject({ title: '요청이 너무 많아요', actions: ['retry'] });
    expect(errorCopy(http(429), { ...D, partialBytes: 5 }).actions).toEqual(['resume']);
    expect(errorCopy(http(503), R).title).toBe('치지직 서버에 문제가 있어요 (HTTP 503)');
  });

  it('authRequired: 단계 × 쿠키', () => {
    const auth = (stage: Stage | null) => err('authRequired', { type: 'authRequired', status: 401 }, stage);
    expect(errorCopy(auth(null), { ...R, cookiesEnabled: false })).toMatchObject({
      title: '네이버 로그인이 필요한 영상이에요',
      actions: ['openCookieSettings', 'retry'],
    });
    expect(errorCopy(auth('resolve'), { ...R, cookiesEnabled: true })).toMatchObject({
      title: '네이버 로그인 정보가 만료됐어요',
      actions: ['reenterCookies', 'retry'],
    });
    expect(errorCopy(auth('resolve'), { ...D, cookiesEnabled: true, partialBytes: 10 }).actions).toEqual([
      'reenterCookies',
      'resume',
    ]);
    expect(errorCopy(auth('download'), { ...D, cookiesEnabled: true })).toMatchObject({
      title: '영상 서버가 접근을 막았어요',
      actions: ['restartFresh'],
    });
  });

  it('noPlayback: 성인 × 쿠키, 그 밖', () => {
    const adult = err('noPlayback', { type: 'noPlayback', adult: true });
    expect(errorCopy(adult, { ...R, cookiesEnabled: false })).toMatchObject({
      title: '성인 인증이 필요한 영상이에요',
      body: '네이버 로그인 정보가 있어야 받을 수 있어요.',
      actions: ['openCookieSettings', 'retry'],
    });
    expect(errorCopy(adult, { ...R, cookiesEnabled: true }).body).toBe(
      '성인 인증한 계정의 로그인 정보인지 확인해 주세요.',
    );
    const plain = err('noPlayback', { type: 'noPlayback', adult: false });
    expect(errorCopy(plain, R).title).toBe('아직 받을 수 없는 영상이에요');
  });

  it('encrypted는 우회·쿠키 안내 없이 닫기/지우기만', () => {
    const r = errorCopy(err('encrypted'), { ...R, cookiesEnabled: false });
    expect(r.actions).toEqual(['close']);
    expect(`${r.title}${r.body}`).not.toMatch(/쿠키|로그인/);
    expect(errorCopy(err('encrypted'), D).actions).toEqual(['remove']);
  });

  it('qualityNotFound·playbackChanged는 다시 불러오기', () => {
    const q = err('qualityNotFound', { type: 'qualityNotFound', requested: '1080p', available: ['720p'] });
    expect(errorCopy(q, D)).toMatchObject({
      title: '고른 화질(1080p)이 더 이상 없어요',
      actions: ['reresolve', 'remove'],
    });
    expect(errorCopy(err('playbackChanged'), D).actions).toEqual(['reresolve', 'remove']);
  });

  it('처음부터 다시: sourceChanged·lengthMismatch', () => {
    expect(errorCopy(err('sourceChanged'), D).actions).toEqual(['restartFresh']);
    expect(errorCopy(err('lengthMismatch'), D).actions).toEqual(['restartFresh']);
  });

  it('network는 .part가 있으면 남아 있다고 말한다', () => {
    expect(errorCopy(err('network'), { ...D, partialBytes: 100 })).toMatchObject({
      body: '연결을 확인한 뒤 다시 시도해 주세요. 받은 부분은 남아 있어요.',
      actions: ['resume'],
    });
    expect(errorCopy(err('network'), D)).toMatchObject({
      body: '연결을 확인한 뒤 다시 시도해 주세요.',
      actions: ['retry'],
    });
    expect(errorCopy(err('network'), { ...R, partialBytes: 100 }).body).not.toContain('남아');
  });

  it('경로를 넣는다: diskFull은 문장 안, fileLocked·io는 detail', () => {
    const path: ErrorPayload = { type: 'path', path: 'D:\\영상' };
    expect(errorCopy(err('diskFull', path), { ...D, partialBytes: 1 })).toMatchObject({
      body: 'D:\\영상가 있는 디스크의 공간을 비운 뒤 이어받으세요.',
      actions: ['resume', 'openFolder'],
    });
    // 불러오기 카드에는 이어받을 것이 없다: [다시 시도]와 같은 말
    expect(errorCopy(err('diskFull', path), R)).toMatchObject({
      body: 'D:\\영상가 있는 디스크의 공간을 비운 뒤 다시 시도해 주세요.',
      actions: ['retry'],
    });
    expect(errorCopy(err('diskFull'), R).body).not.toContain('이어받');
    expect(errorCopy(err('fileLocked', path), D).detail).toBe('D:\\영상');
    expect(errorCopy(err('io', path), D).detail).toBe('D:\\영상');
    expect(errorCopy(err('io'), D).detail).toBeNull();
  });

  it('셸 전용 코드', () => {
    expect(errorCopy(err('settings'), { place: 'other' }).actions).toEqual(['openConfigFolder', 'retry']);
    expect(errorCopy(err('duplicateOutput'), R)).toMatchObject({
      title: '이 파일은 이미 다운로드 목록에 있어요.',
      actions: ['showInList'],
    });
    expect(errorCopy(err('fileMissing'), { place: 'other' }).title).toBe(
      '파일을 찾을 수 없어요. 옮기거나 지웠을 수 있어요',
    );
    expect(errorCopy(err('invalidInput'), { place: 'cookie' }).title).toBe('두 값을 모두 넣어 주세요');
    expect(errorCopy(err('invalidInput'), { place: 'other' }).detail).toBe('msg-invalidInput');
    expect(errorCopy(err('internal'), { place: 'other' })).toMatchObject({
      title: '문제가 생겼어요. 앱을 다시 시작해 주세요.',
      detail: 'msg-internal',
      actions: ['copyReport'],
    });
  });

  it('Phase 3 소유 오류', () => {
    const c = errorCopy(err('notOwnContent'), { ...R, channelName: '남의 채널', myChannel: '내 채널' });
    expect(c.title).toBe('내 채널의 영상만 받을 수 있어요');
    expect(c.body).toBe("이 영상은 '남의 채널' 채널의 영상이에요. 로그인한 채널: '내 채널'");
    expect(errorCopy(err('ownershipUnknown'), R).body).toBe('영상의 채널을 확인하지 못해 받을 수 없어요.');
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
