// 셸·OS 통합의 화면 쪽(platform.md (f)): 엔진 프로브, macOS 메뉴 이벤트, 잠자기 방지 토글·표시, 연결 대기·회복·멈춘 지 30일.
// 가짜 백엔드는 시간을 쓰지 않으므로 Rust 이벤트는 window.__e2e.emit으로 흉내 낸다.
import { job, prog } from '../src/test/jobFixtures';
import { engineFixText, formatFileSize, RECOVERY_NOTICE_MS, RECOVERY_SILENT_MS, STALE_DAYS, t } from './copy';
import { expect, test } from './fixtures';

const GB = 1024 ** 3;

test('frontend_ready에 엔진 프로브 다섯 키를 실어 보내고, 모두 true면 경고가 없다', async ({ app }) => {
  await app.open();
  await expect.poll(async () => (await app.args('frontend_ready')).length).toBe(1);
  const [{ probe }] = (await app.args('frontend_ready')) as { probe: Record<string, boolean> }[];
  expect(Object.keys(probe).sort()).toEqual(['colorMix', 'containerQuery', 'has', 'inert', 'oklch']);
  expect(Object.values(probe)).toEqual([true, true, true, true, true]);
  await expect(app.page.getByText(t('engine.old.title'))).toHaveCount(0);
});

test('프로브가 하나라도 false면 경고 배너(OS별 고치는 법), 닫을 수 있고 앱은 그대로 쓴다', async ({ app }) => {
  const { page } = app;
  // oklch만 없는 오래된 엔진
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = ((a: string, b?: string) => (String(b ?? a).includes('oklch') ? false : b === undefined ? supports(a) : supports(a, b))) as typeof CSS.supports;
  });
  await app.open({ platform: 'windows' });
  await expect(page.getByText(t('engine.old.title'))).toBeVisible();
  await expect(page.getByText(t('engine.old.body', { fix: engineFixText('windows') }))).toBeVisible();
  const [{ probe }] = (await app.args('frontend_ready')) as { probe: Record<string, boolean> }[];
  expect(probe).toMatchObject({ oklch: false, colorMix: true });
  await app.axe('엔진 경고 배너');
  // 앱은 막히지 않는다
  await expect(page.getByLabel(t('url.label'))).toBeEnabled();
  await page.getByRole('button', { name: t('common.close') }).click();
  await expect(page.getByText(t('engine.old.title'))).toHaveCount(0);
});

test('macOS 메뉴: menu-settings는 설정 화면, menu-about은 설정의 정보 절 제목으로 포커스', async ({ app }) => {
  const { page } = app;
  await app.open({ platform: 'macos' });
  await app.ctl((c) => c.emit('menu-settings', null), null);
  await expect(page.getByRole('heading', { name: t('header.settings'), level: 1 })).toBeVisible();
  await page.getByRole('button', { name: t('header.back') }).click();
  await expect(page.getByLabel(t('url.label'))).toBeVisible();
  await app.ctl((c) => c.emit('menu-about', null), null);
  await expect(page.getByRole('heading', { name: t('settings.about.title') })).toBeFocused();
});

test('잠자기 방지: 설정 토글은 keepAwake를 저장하고, keep-awake 이벤트가 받는 중 그룹 옆 한 줄을 켜고 끈다', async ({ app }) => {
  const { page } = app;
  await app.open({ jobs: [job(1, { title: '받는 영상', status: 'running', progress: prog() })] });
  await expect(page.getByRole('article', { name: '받는 영상' })).toBeVisible();
  await expect(page.getByText(t('power.keepingAwake'))).toHaveCount(0);
  await app.ctl((c) => c.emit('keep-awake', { active: true }), null);
  await expect(page.getByText(t('power.keepingAwake'))).toBeVisible();
  await app.axe('잠자기 방지 표시');
  await app.ctl((c) => c.emit('keep-awake', { active: false }), null);
  await expect(page.getByText(t('power.keepingAwake'))).toHaveCount(0);

  await page.getByRole('button', { name: t('header.settings') }).click();
  const sw = page.getByRole('switch', { name: t('settings.keepAwake') });
  await expect(sw).toBeChecked();
  await expect(sw).toHaveAccessibleDescription(t('settings.keepAwake.help'));
  await sw.click();
  await expect.poll(() => app.args('update_settings')).toEqual([{ patch: { keepAwake: false } }]);
  await expect(sw).not.toBeChecked();
  await app.axe('설정 잠자기 방지');
});

test('연결 대기: 줄무늬 막대·퍼센트 유지·경과 시간, 1분 넘겨 풀리면 회복 줄이 10초 보인다', async ({ app }) => {
  const { page } = app;
  await page.clock.install({ time: new Date('2026-03-01T00:00:00+09:00') });
  await app.open({ jobs: [job(1, { title: '끊기는 영상', status: 'running', progress: prog() })] });
  const item = page.getByRole('article', { name: '끊기는 영상' });
  await expect(item).toBeVisible();

  await app.ctl((c, gb) => c.progress(1, 2 * gb, 4 * gb, 'waitingNetwork'), GB);
  await expect(item.getByText(t('job.waitingNetwork.body'))).toBeVisible();
  await expect(item.getByRole('progressbar')).toHaveAttribute('data-state', 'waiting');
  // 퍼센트는 뒤로 가지 않는다(P-4): 처음 보인 57%가 바닥이라 2GiB/4GiB(50%)로 줄어도 57%를 유지한다
  await expect(item).toContainText('57%');
  await expect(item).not.toContainText(/\/s|남음/);
  await expect(item).toContainText(`연결 대기 중 · 1분째 · ${formatFileSize(2 * GB, 1000)} 받음`);
  await app.axe('연결 대기 행');

  // 1분 넘게 기다린 뒤: 경과 글자가 흐르고, 풀리면 회복 줄
  await page.clock.runFor(RECOVERY_SILENT_MS + 5000);
  await expect(item).toContainText('연결 대기 중 · 1분째');
  await app.ctl((c, gb) => c.progress(1, 3 * gb, 4 * gb), GB);
  await expect(item.getByText(t('job.recovered.body'))).toBeVisible();
  await expect(item.getByText(t('job.waitingNetwork.body'))).toHaveCount(0);
  await page.clock.runFor(RECOVERY_NOTICE_MS + 100);
  await expect(item.getByText(t('job.recovered.body'))).toHaveCount(0);
});

test('1분 안에 풀린 단절은 회복 줄 없이 조용히 넘어간다', async ({ app }) => {
  const { page } = app;
  await page.clock.install({ time: new Date('2026-03-01T00:00:00+09:00') });
  await app.open({ jobs: [job(1, { title: '잠깐 끊긴 영상', status: 'running', progress: prog() })] });
  const item = page.getByRole('article', { name: '잠깐 끊긴 영상' });
  await app.ctl((c, gb) => c.progress(1, 2 * gb, 4 * gb, 'waitingNetwork'), GB);
  await expect(item.getByText(t('job.waitingNetwork.body'))).toBeVisible();
  await page.clock.runFor(RECOVERY_SILENT_MS - 5000);
  await app.ctl((c, gb) => c.progress(1, 3 * gb, 4 * gb), GB);
  await expect(item.getByText(t('job.waitingNetwork.body'))).toHaveCount(0);
  await expect(item.getByText(t('job.recovered.body'))).toHaveCount(0);
});

test('멈춘 지 30일: 31일 전에 멈춘 행에만 본문 줄, 29일 전·옛 기록(멈춘 시각 없음)은 없다', async ({ app }) => {
  const { page } = app;
  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;
  await app.open({
    jobs: [
      job(1, { title: '오래 멈춘 영상', status: 'paused', partialBytes: 1_288_490_189, stoppedAt: now - (STALE_DAYS + 1) * DAY }),
      job(2, { title: '며칠 전 영상', status: 'interrupted', partialBytes: 1_288_490_189, stoppedAt: now - (STALE_DAYS - 1) * DAY }),
      job(3, { title: '옛 기록 영상', status: 'paused', partialBytes: 1_288_490_189, stoppedAt: null }),
    ],
  });
  const old = page.getByRole('article', { name: '오래 멈춘 영상' });
  await expect(old.getByText(t('job.stale.body', { days: STALE_DAYS + 1, size: formatFileSize(1_288_490_189, 1000) }))).toBeVisible();
  await expect(page.getByRole('article', { name: '며칠 전 영상' })).toBeVisible();
  await expect(page.getByText(/일 전에 멈췄어요/)).toHaveCount(1);
  await app.axe('멈춘 지 30일 행');
});
