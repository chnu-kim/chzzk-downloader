// 오디오만 받기(audio-only.md §6): 일반 VOD 카드의 맨 끝 "오디오만" 행 → 이름 칸 확장자 `.m4a` → [받기] → 작업 행.
// 가짜 백엔드가 check_output·enqueue에서 셸처럼 화질 키(`audio`)로 확장자를 정한다. 화면 글자는 e2e/copy.ts(copy deck)에서 가져온다.
import type { Locator } from '@playwright/test';
import { quality, resolved, vodResolved } from '../src/test/fixtures';
import { t } from './copy';
import { expect, test, type App } from './fixtures';

const enqReqs = async (app: App) => ((await app.args('enqueue')) as { req: Record<string, unknown> }[]).map((e) => e.req);
const downloadBtn = (card: Locator) => card.getByRole('button', { name: t('card.download') });

async function openCard(app: App, r = vodResolved()) {
  await app.open({ resolve: { [r.url]: r } });
  await app.page.getByLabel(t('url.label')).fill(r.url);
  await app.page.getByRole('button', { name: t('common.load') }).click();
  const card = app.page.getByRole('region', { name: r.meta.title });
  await expect(card).toBeVisible();
  return card;
}

test('"오디오만"을 고르면 확장자가 .m4a가 되고, 받으면 작업 행에 "오디오만"이 보인다', async ({ app }) => {
  const r = vodResolved();
  const card = await openCard(app, r);
  const rows = card.getByRole('radio');
  await expect(rows).toHaveCount(3);
  const audio = card.locator('label').filter({ hasText: t('quality.audioOnly') });
  // 맨 끝 행: 이름과 크기, 꼬리표 없음. 꼬리표는 비디오 행 하나에만
  await expect(audio).toContainText('약');
  await expect(audio).not.toContainText(t('quality.best'));
  await expect(card.getByText(t('quality.best'))).toHaveCount(1);
  await expect(card.locator('.ext')).toHaveText('.mp4');
  // 검사가 끝나 [받기]가 켜진 뒤의 모습(비활성 면의 대비는 잴 대상이 아니다)
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await app.axe('일반 VOD 카드(오디오만 행)');

  await audio.click();
  await expect(card.locator('.ext')).toHaveText('.m4a');
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  const checks = (await app.args('check_output')) as { qualityId: string }[];
  expect(checks.at(-1)?.qualityId).toBe('audio');
  await app.axe('오디오만 고름');

  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const reqs = await enqReqs(app);
  expect(reqs).toHaveLength(1);
  expect(reqs[0]).toMatchObject({ qualityId: 'audio', qualityLabel: t('quality.audioOnly'), expectedKind: 'progressive' });
  expect('range' in reqs[0]).toBe(false);
  const item = app.page.getByRole('article', { name: r.meta.title });
  await expect(item.locator('.job-quality')).toHaveText(t('quality.audioOnly'));
  // 작업의 산출 경로는 .m4a(가짜 백엔드가 셸처럼 화질 키로 정한다)
  const job = await app.ctl((c) => c.job(1), null);
  expect(job?.output.endsWith('.m4a')).toBe(true);
  expect(job?.audioOnly).toBe(true);
});

test('비디오 화질로 되돌리면 .mp4이고, 오디오가 기본 선택이 되지 않는다', async ({ app }) => {
  const card = await openCard(app);
  await expect(card.getByRole('radio').nth(0)).toBeChecked();
  await card.locator('label').filter({ hasText: t('quality.audioOnly') }).click();
  await expect(card.locator('.ext')).toHaveText('.m4a');
  await card.locator('label').filter({ hasText: '720p' }).click();
  await expect(card.locator('.ext')).toHaveText('.mp4');
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect(card).toBeHidden();
  const reqs = await enqReqs(app);
  expect(reqs[0]).toMatchObject({ qualityId: 'q720', qualityLabel: '720p' });
});

test('빠른 다시보기·클립 카드에는 "오디오만" 행이 없다', async ({ app }) => {
  const rewind = resolved();
  const card = await openCard(app, rewind);
  await expect(card.getByText(t('quality.audioOnly'))).toHaveCount(0);
  await expect(card.getByRole('radio')).toHaveCount(3);
  await expect(card.locator('.ext')).toHaveText('.mp4');

  const clip = resolved({
    url: 'https://chzzk.naver.com/clips/abc',
    content: { kind: 'clip', clipId: 'abc' },
    meta: { ...rewind.meta, kind: 'clip', title: '재미있는 클립' },
    playbackKind: 'progressive',
    qualities: [quality(), quality({ id: 'q720', label: '720p', resolution: 720 })],
  });
  await app.ctl((c, r) => c.setResolve(r.url, r), clip);
  await card.getByRole('button', { name: t('common.close') }).first().click();
  await app.page.getByLabel(t('url.label')).fill(clip.url);
  await app.page.getByRole('button', { name: t('common.load') }).click();
  const clipCard = app.page.getByRole('region', { name: clip.meta.title });
  await expect(clipCard).toBeVisible();
  await expect(clipCard.getByText(t('quality.audioOnly'))).toHaveCount(0);
  await expect(clipCard.getByRole('radio')).toHaveCount(2);
});
