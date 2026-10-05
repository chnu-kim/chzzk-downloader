import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppError } from './bindings';
import { copyReport } from './report';
import { toasts } from './stores/toast.svelte';

const err: AppError = { code: 'internal', message: '/Users/me/x', stage: null, resumable: false, payload: null };

describe('copyReport', () => {
  afterEach(() => {
    for (const i of toasts.items) toasts.dismiss(i.id);
    vi.unstubAllGlobals();
  });

  function stubClipboard(writeText: () => Promise<void>) {
    vi.stubGlobal('navigator', { ...navigator, userAgent: 'test', clipboard: { writeText } });
  }

  it('복사하면 경로 경고와 복사했어요', async () => {
    stubClipboard(() => Promise.resolve());
    await copyReport(err, null);
    expect(toasts.items.map((i) => [i.kind, i.message])).toEqual([
      ['info', '복사한 정보에 파일 경로가 들어 있어요'],
      ['copied', '복사했어요'],
    ]);
  });

  it('클립보드 쓰기가 막히면 실패를 알린다', async () => {
    stubClipboard(() => Promise.reject(new Error('denied')));
    await copyReport(err, null);
    expect(toasts.items.map((i) => [i.kind, i.message])).toEqual([
      ['info', '복사한 정보에 파일 경로가 들어 있어요'],
      ['danger', '복사하지 못했어요. 다시 시도해 주세요.'],
    ]);
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
      },
      new Date('2026-10-05T00:00:00Z'),
    );
    expect(text.split('\n')[0]).toBe('앱: 0.1.0 (코어 0.2.0)');
    expect(text).toContain('시각: 2026-10-05T00:00:00.000Z');
    expect(text).not.toContain('/Users/me');
  });
});
