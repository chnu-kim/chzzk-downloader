// 가짜 백엔드의 AuthGate(worker.md 구현 중 변경 55): 로그인 상태가 아니면 허용 목록 밖 command는 notLoggedIn이다.
// 로그인 화면(A3) 전이라 화면 흐름 대신 IPC를 직접 불러 가짜 백엔드의 분기만 고정한다.
import type { AuthStatusDto } from '../src/lib/bindings';
import { expect, test } from './fixtures';

type Outcome = { ok: true } | { ok: false; code: string };

test('로그인 전에는 허용 목록 밖 command가 notLoggedIn, 허용 목록과 로그인 뒤는 통과', async ({ app }) => {
  await app.open();
  const call = (cmds: string[]) =>
    app.page.evaluate(async (names) => {
      const inv = (window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__.invoke;
      const out: Record<string, Outcome> = {};
      for (const n of names) {
        try {
          await inv(n, {});
          out[n] = { ok: true };
        } catch (e) {
          out[n] = { ok: false, code: (e as { code?: string }).code ?? String(e) };
        }
      }
      return out;
    }, cmds);
  const signedOut: AuthStatusDto = { state: 'signedOut', channelId: null, channelName: null, reason: null, pending: null, offline: null, verifiedAt: null };
  await app.ctl((c, s) => c.setAuth(s), signedOut);
  const gated = await call(['get_settings', 'clear_finished']);
  expect(gated).toEqual({ get_settings: { ok: false, code: 'notLoggedIn' }, clear_finished: { ok: false, code: 'notLoggedIn' } });
  const open = await call(['app_info', 'list_jobs', 'auth_status']);
  expect(open).toEqual({ app_info: { ok: true }, list_jobs: { ok: true }, auth_status: { ok: true } });
  await app.ctl((c, s) => c.setAuth(s), { ...signedOut, state: 'signedIn', channelId: 'e2e-channel', channelName: '채널', verifiedAt: 1 } satisfies AuthStatusDto);
  expect(await call(['get_settings'])).toEqual({ get_settings: { ok: true } });
});
