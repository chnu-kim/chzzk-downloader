import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from './bindings';
import { t } from './copy/ko';
import { copyReport } from './report';
import { toasts } from './stores/toast.svelte';

const err: AppError = { code: 'internal', message: '/Users/me/x', stage: null, resumable: false, payload: null };
const plain: AppError = { code: 'internal', message: 'boom', stage: null, resumable: false, payload: null };

describe('copyReport', () => {
  afterEach(() => {
    for (const i of toasts.items) toasts.dismiss(i.id);
    vi.unstubAllGlobals();
  });

  function stubClipboard(writeText: () => Promise<void>) {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'test', clipboard: { writeText } });
  }

  it('경로가 들어 있으면 복사했어요 대신 경로 경고 한 장만 올린다(J23)', async () => {
    stubClipboard(() => Promise.resolve());
    await copyReport(err, null);
    expect(toasts.items.map((i) => [i.kind, i.message])).toEqual([['info', t('toast.reportHasPath')]]);
  });

  it('경로가 없으면 복사했어요 한 장', async () => {
    stubClipboard(() => Promise.resolve());
    await copyReport(plain, null);
    expect(toasts.items.map((i) => [i.kind, i.message])).toEqual([['copied', t('action.copied')]]);
  });

  it('클립보드 쓰기가 막히면 실패를 알린다', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    await copyReport(err, null);
    expect(toasts.items.map((i) => [i.kind, i.message])).toEqual([['danger', t('toast.copyFailed')]]);
  });
});

describe('buildReport(필드 이름은 영문, 모르는 값은 unknown)', () => {
  it('앱 정보가 없으면 unknown이고 status는 http일 때만', async () => {
    const { buildReport } = await import('./report');
    const now = new Date('2026-10-05T00:00:00Z');
    expect(buildReport(plain, null, now).split('\n')).toEqual([
      'app: unknown',
      'os: unknown',
      'code: internal',
      'stage: -',
      'message: boom',
      'time: 2026-10-05T00:00:00.000Z',
    ]);
    const http: AppError = { code: 'http', message: 'x', stage: 'resolve', resumable: false, payload: { type: 'http', status: 404, requestKind: 'api' } };
    expect(buildReport(http, null, now)).toContain('status: 404');
  });
});

describe('buildAppReport(설정 > 정보)', () => {
  it('앱·OS·시각만, 경로 없음', async () => {
    const { buildAppReport } = await import('./report');
    const text = buildAppReport(
      {
        version: '0.1.0',
        coreVersion: '0.2.0',
        configDir: '/Users/me/config',
        dataDir: '/Users/me/data',
        logDir: '/Users/me/log',
        defaultDownloadFolder: '/Users/me/Movies',
        features: { auth: false },
        legacyCandidate: null,
        platform: 'macos',
        textScale: 'default',
        theme: 'system',
      },
      new Date('2026-10-05T00:00:00Z'),
    );
    expect(text.split('\n')).toEqual(['app: 0.1.0 (core 0.2.0)', 'os: macos', 'time: 2026-10-05T00:00:00.000Z']);
    expect(text).not.toContain('/Users/me');
  });
});
