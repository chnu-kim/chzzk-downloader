/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mockIPC } from '@tauri-apps/api/mocks';
import { describe, expect, it } from 'vitest';
import * as api from './api';
import type { ContentRef, EngineProbe, EnqueueRequest, JobEvent } from './bindings';

// Rust command 목록(app/src-tauri/src/command_names.rs)과 api.ts가 1:1인지, 인자가 camelCase인지 본다.
const namesFile = readFileSync(
  fileURLToPath(new globalThis.URL('../../src-tauri/src/command_names.rs', import.meta.url).href),
  'utf8',
);
const COMMANDS = [...namesFile.matchAll(/^\s*"([a-z_]+)",/gm)].map((m) => m[1]);

const PROBE: EngineProbe = { colorMix: true, has: true, oklch: true, containerQuery: true, inert: false };
const content: ContentRef = { kind: 'video', videoNo: 7 };
const req: EnqueueRequest = {
  url: 'https://chzzk.naver.com/video/7',
  content,
  title: 't',
  channelName: 'c',
  channelId: null,
  qualityId: 'q',
  qualityLabel: '1080p',
  expectedKind: 'progressive',
  folder: null,
  fileName: 'f',
  onExisting: 'overwrite',
  restart: false,
};

type Call = [string, Record<string, unknown> | undefined];

async function record(run: () => Promise<unknown>): Promise<Call[]> {
  const calls: Call[] = [];
  mockIPC((cmd, args) => {
    calls.push([cmd, args as Record<string, unknown> | undefined]);
    return null;
  });
  await run();
  return calls;
}

describe('api.ts', () => {
  it('command 목록을 읽었다', () => {
    expect(COMMANDS).toHaveLength(33);
  });

  // Channel은 생성 때 IPC 내부를 쓰므로 mockIPC 뒤(호출 안)에서 만든다.
  // [함수 호출, command, 기대 인자]
  const table: [() => Promise<unknown>, string, Record<string, unknown>][] = [
    [() => api.appInfo(), 'app_info', {}],
    [() => api.getSettings(), 'get_settings', {}],
    [() => api.updateSettings({ maxParallelDownloads: 3 }), 'update_settings', { patch: { maxParallelDownloads: 3 } }],
    [() => api.setNaverCookies('a', 'b'), 'set_naver_cookies', { nidAut: 'a', nidSes: 'b' }],
    [() => api.clearNaverCookies(), 'clear_naver_cookies', {}],
    [() => api.importLegacy(null), 'import_legacy', { dir: null }],
    [() => api.pickFolder(), 'pick_folder', { initial: null }],
    [() => api.resolve('u'), 'resolve', { url: 'u' }],
    [
      () => api.checkOutput({ folder: null, fileName: 'f', content, qualityId: 'q', expectedKind: 'liveRewindHls' }),
      'check_output',
      { folder: null, fileName: 'f', content, qualityId: 'q', expectedKind: 'liveRewindHls' },
    ],
    [() => api.enqueue(req), 'enqueue', { req }],
    [() => api.listJobs(), 'list_jobs', {}],
    [() => api.subscribeJobs(new api.Channel<JobEvent>()), 'subscribe_jobs', { onEvent: expect.anything() }],
    [() => api.pauseJob(3), 'pause_job', { id: 3 }],
    [() => api.resumeJob(3), 'resume_job', { id: 3, restart: false }],
    [() => api.removeJob(3), 'remove_job', { id: 3 }],
    [() => api.clearFinished(), 'clear_finished', {}],
    [() => api.openOutput(3), 'open_output', { id: 3 }],
    [() => api.revealOutput(3), 'reveal_output', { id: 3 }],
    [() => api.quit(), 'quit', {}],
    [() => api.openWebPage('privacy'), 'open_web_page', { page: 'privacy' }],
    [() => api.authStatus(), 'auth_status', {}],
    [() => api.authLogin(), 'auth_login', {}],
    [() => api.authReopen(), 'auth_reopen', {}],
    [() => api.authCopyLoginUrl(), 'auth_copy_login_url', {}],
    [() => api.authCancel(), 'auth_cancel', {}],
    [() => api.authRetry(), 'auth_retry', {}],
    [() => api.authLogout(), 'auth_logout', {}],
    [() => api.updateCheck(), 'update_check', {}],
    [() => api.updateAvailable(), 'update_available', {}],
    [() => api.updateInstall(true), 'update_install', { confirmPause: true }],
    [() => api.clipboardLink(), 'clipboard_link', {}],
    [() => api.openAppFolder('logs'), 'open_app_folder', { kind: 'logs' }],
    [() => api.frontendReady(PROBE), 'frontend_ready', { probe: PROBE }],
  ];

  it('모든 Rust command에 함수가 하나씩 있다', () => {
    expect(new Set(table.map(([, cmd]) => cmd))).toEqual(new Set(COMMANDS));
  });

  it.each(table)('%#: 이름과 camelCase 인자', async (run, cmd, args) => {
    const calls = await record(run);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(cmd);
    expect(calls[0][1] ?? {}).toEqual(args);
  });

  it('resumeJob(id, true)는 restart를 넘긴다', async () => {
    const calls = await record(() => api.resumeJob(5, true));
    expect(calls[0][1]).toEqual({ id: 5, restart: true });
  });

  it('pickFolder(initial)', async () => {
    const calls = await record(() => api.pickFolder('/v'));
    expect(calls[0][1]).toEqual({ initial: '/v' });
  });

  it('AppError는 그대로, 문자열 거부는 internal로 던진다', async () => {
    const appErr = { code: 'invalidUrl', message: 'm', stage: null, resumable: false, payload: null };
    mockIPC(() => {
      throw appErr;
    });
    await expect(api.resolve('x')).rejects.toEqual(appErr);

    mockIPC(() => {
      throw 'Command resolve not allowed by ACL';
    });
    await expect(api.resolve('x')).rejects.toMatchObject({
      code: 'internal',
      message: 'Command resolve not allowed by ACL',
    });
  });

  it('subscribeJobs의 Channel로 이벤트가 온다', async () => {
    const got: JobEvent[] = [];
    mockIPC((cmd, args) => {
      if (cmd === 'subscribe_jobs') {
        // mock은 Channel 객체를 그대로 넘긴다. Rust가 보내는 것처럼 직접 부른다(§13).
        const on = (args as { onEvent: api.Channel<JobEvent> }).onEvent;
        on.onmessage({ type: 'removed', id: 4 });
      }
      return [];
    });
    const ch = new api.Channel<JobEvent>((e) => got.push(e));
    await expect(api.subscribeJobs(ch)).resolves.toEqual([]);
    expect(got).toEqual([{ type: 'removed', id: 4 }]);
  });
});

describe('close-requested', () => {
  it('Rust가 보낸 받는 중 작업 수를 넘기고, 그만 들으면 더 받지 않는다', async () => {
    mockIPC(() => undefined, { shouldMockEvents: true });
    const { emit } = await import('@tauri-apps/api/event');
    const got: number[] = [];
    const off = await api.onCloseRequested((n) => got.push(n));
    await emit(api.CLOSE_REQUESTED, { running: 2 });
    off();
    await emit(api.CLOSE_REQUESTED, { running: 3 });
    expect(got).toEqual([2]);
  });
});
