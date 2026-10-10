// 설정(S2)과 닫기 가드(D1).
import { expect, test } from './fixtures';

test('설정: 값을 바꾸면 바로 저장하고, 쿠키는 저장 뒤 다시 채우지 않는다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await page.getByRole('button', { name: '설정' }).click();
  await expect(page.getByRole('heading', { name: '설정', level: 2 }).or(page.getByRole('heading', { name: '설정' })).first()).toBeVisible();
  await app.axe('설정');

  await page.getByRole('combobox', { name: '동시에 받는 영상 수' }).selectOption('3');
  await page.getByRole('combobox', { name: '빠른 다시보기 연결 수' }).selectOption('8');
  await page.getByRole('switch', { name: '앱을 열면 멈춘 다운로드를 자동으로 이어받기' }).click();
  await expect.poll(() => app.args('update_settings')).toEqual([
    { patch: { maxParallelDownloads: 3 } },
    { patch: { segmentConcurrency: 8 } },
    { patch: { autoResumeInterrupted: true } },
  ]);

  // 고급: 네이버 로그인 정보. 가짜 값이다(실제 쿠키 모양이 아니다)
  // Disclosure는 네이티브 <details>라 제목줄이 <summary>다(role=button이 아니다)
  await page.locator('summary', { hasText: '고급: 네이버 로그인 정보' }).click();
  await app.axe('쿠키 섹션');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('두 값을 모두 넣어 주세요')).toBeVisible();
  await page.getByLabel('NID_AUT', { exact: true }).fill('e2e-aut');
  await page.getByLabel('NID_SES', { exact: true }).fill('e2e-ses');
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(page.getByText('저장됨', { exact: true })).toBeVisible();
  expect(await app.args('set_naver_cookies')).toEqual([{ nidAut: 'e2e-aut', nidSes: 'e2e-ses' }]);
  await expect(page.getByLabel('NID_AUT', { exact: true })).toHaveValue('');

  // 뒤로 → 홈, 입력줄로 포커스
  await page.getByRole('button', { name: '뒤로' }).click();
  await expect(page.getByLabel('영상 주소')).toBeFocused();
});

test('닫기 가드: [계속 받기]는 닫지 않고, [닫기]는 quit을 한 번 부른다', async ({ app }) => {
  const { page } = app;
  await app.open();
  await app.ctl((c, p) => c.emit('close-requested', p), { running: 2 });
  const dialog = page.getByRole('dialog', { name: '다운로드를 멈추고 닫을까요?' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('받는 중인 영상이 2개 있어요');
  await expect(dialog.getByRole('button', { name: '계속 받기' })).toBeFocused();
  await app.axe('닫기 확인');
  await dialog.getByRole('button', { name: '계속 받기' }).click();
  await expect(dialog).toBeHidden();
  expect(await app.cmds()).not.toContain('quit');

  await app.ctl((c, p) => c.emit('close-requested', p), { running: 1 });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '닫기', exact: true }).click();
  await expect.poll(async () => (await app.cmds()).filter((c) => c === 'quit').length).toBe(1);
});
