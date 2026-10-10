// copy deck의 오류 카드 전부(docs/design/system/content.md §15.2 표): 모든 ErrorCode를 불러오기(R)와 목록 항목(D)에 띄워 제목·본문·행·동작
// 버튼이 copy deck(errorCopy)과 같은지 본다. 기대값은 앱과 같은 errorCopy가 만든다(문구가 바뀌어도 이 파일은 고치지 않는다):
// 이 테스트는 문구 표 자체가 아니라 표가 화면에 실제로 그려지는지(그리고 접근성 위반이 없는지)를 본다.
// 표의 내용(코드 28개 골든)은 vitest(errors.test.ts)가 본다. 연결 진단은 앱이 넘기지 않으므로 기본값(unknown)이다.
import type { AppError, ErrorCode, JobDto } from '../src/lib/bindings';
import { ERROR_CODES } from '../src/lib/copy/errors';
import { job } from '../src/test/jobFixtures';
import { resolved } from '../src/test/fixtures';
import { actionLabel, errorCopy, t } from './copy';
import { expect, test } from './fixtures';

const err = (code: ErrorCode, stage: AppError['stage']): AppError => ({ code, message: `e2e ${code}`, stage, resumable: false, payload: null });
const urlFor = (i: number) => `https://chzzk.naver.com/video/${9_100_000 + i}`;

test('불러오기 오류: 모든 코드의 Notice가 copy deck대로 그려진다', async ({ app }) => {
  const { page } = app;
  const resolve = Object.fromEntries(ERROR_CODES.map((c, i) => [urlFor(i), { error: err(c, 'resolve') }]));
  await app.open({ resolve });
  const input = page.getByLabel(t('url.label'));
  for (const [i, code] of ERROR_CODES.entries()) {
    await input.fill(urlFor(i));
    await input.press('Enter');
    const want = errorCopy(err(code, 'resolve'), { place: 'resolve', cookiesEnabled: false });
    const alert = page.getByRole('alert').filter({ hasText: want.title });
    await expect(alert, code).toBeVisible();
    if (want.body) await expect(alert, code).toContainText(want.body);
    // role=alert는 .notice-text에만 있고 동작 버튼은 그 바깥(.notice-actions)이다: 알림 전체는 alert를 품은 .notice
    const notice = page.locator('.notice').filter({ has: alert });
    for (const a of want.actions) await expect(notice.getByRole('button', { name: actionLabel(a), exact: true }), `${code} ${a}`).toBeVisible();
    if (i === 0) await app.axe(`불러오기 오류 ${code}`);
  }
  expect((await app.args('resolve')).length).toBe(ERROR_CODES.length);
});

test('작업 오류: 모든 코드의 실패 항목이 copy deck대로 그려진다', async ({ app }) => {
  const { page } = app;
  const jobs: JobDto[] = ERROR_CODES.map((c, i) =>
    job(i + 1, { title: `오류 ${c}`, status: 'failed', error: err(c, 'download'), partialBytes: i % 2 ? 1024 : null, finishedAt: 100 + i }),
  );
  await app.open({ jobs });
  for (const j of jobs) {
    const item = page.getByRole('article', { name: j.title, exact: true });
    const want = errorCopy(j.error as AppError, { place: 'job', partialBytes: j.partialBytes, cookiesEnabled: false });
    await expect(item, j.title).toContainText(want.title);
    if (want.body) await expect(item, j.title).toContainText(want.body);
    for (const row of want.rows) await expect(item, `${j.title} ${row}`).toContainText(row);
  }
  await app.axe('실패 항목 전부');
});

test('불러오기 오류의 [다시 시도]는 같은 주소로 다시 부르고, 성공하면 카드가 뜬다', async ({ app }) => {
  const r = resolved();
  const { page } = app;
  await app.open({ resolve: { [r.url]: { error: err('network', 'resolve') } } });
  await page.getByLabel(t('url.label')).fill(r.url);
  await page.getByRole('button', { name: t('common.load') }).click();
  const want = errorCopy(err('network', 'resolve'), { place: 'resolve', cookiesEnabled: false });
  await expect(page.getByRole('alert').filter({ hasText: want.title })).toBeVisible();
  // 시나리오를 바꾼다: 다음 resolve는 성공
  await app.ctl((c, view) => c.setResolve(view.url, view), r);
  await page.getByRole('button', { name: actionLabel('retry'), exact: true }).click();
  await expect(page.getByRole('region', { name: r.meta.title })).toBeVisible();
  expect(await app.args('resolve')).toEqual([{ url: r.url }, { url: r.url }]);
});
