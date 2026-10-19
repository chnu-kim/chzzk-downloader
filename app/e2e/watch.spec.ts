// 받기 전 미리보기(preview.md PV14, PD 재생기): 접힌 줄 → 펼치기 → watch_open 인자 → 실패 Notice·[치지직에서 보기].
// Playwright chromium은 실제 재생을 하지 않는다(§10): 가짜 백엔드의 `watch:` 주소는 존재하지 않는다. 그래서 웹뷰의 mp4 지원 여부는
// 스크립트로 고정하고(canPlayType), 재생기 화면은 media 오류 이벤트를 막아 펼친 모습만 확인한다. 매 단계 axe 위반 0.
// 화면 글자는 모두 e2e/copy.ts(copy deck)에서 가져온다.
import type { Locator, Page } from '@playwright/test';
import { liveResolved, resolved, vodResolved } from '../src/test/fixtures';
import { errorCopy, t } from './copy';
import { expect, test, type App } from './fixtures';
import type { Scenario } from './mock/backend';

const toggle = (card: Locator) => card.getByText(t('watch.toggle'));
const VOD = vodResolved();
/** 브라우저가 읽을 수 있는 자리표시 주소(`watch:` 주소는 console.error를 남긴다) */
const DUMMY_SRC = 'data:video/mp4;base64,AAAA';

/** 이 웹뷰가 mp4를 읽는지 고정한다(열기 전에 불러야 한다) */
const canPlay = (page: Page, value: '' | 'maybe') =>
  page.addInitScript((v) => {
    HTMLMediaElement.prototype.canPlayType = () => v;
  }, value);

/** media 오류를 앱이 보기 전에 삼킨다(존재하지 않는 주소 때문에 재생기가 곧바로 실패로 넘어가지 않게) */
const swallowMediaErrors = (page: Page) =>
  page.addInitScript(() => {
    window.addEventListener('error', (e) => e.target instanceof HTMLMediaElement && e.stopImmediatePropagation(), true);
  });

async function openCard(app: App, r = VOD, extra: Scenario = {}) {
  await app.open({ resolve: { [r.url]: r }, ...extra });
  await app.page.getByLabel(t('url.label')).fill(r.url);
  await app.page.getByRole('button', { name: t('common.load') }).click();
  const card = app.page.getByRole('region', { name: r.meta.title });
  await expect(card).toBeVisible();
  // 검사가 끝나 [받기]가 켜진 뒤에 잰다(비활성 면의 대비는 잴 대상이 아니다)
  if (r.playbackKind !== 'live') {
    await expect(card.getByRole('button', { name: t('card.download') })).not.toHaveAttribute('aria-disabled', 'true');
  }
  return card;
}

test('접힌 줄이 기본이고 펼치기 전에는 watch_open을 부르지 않는다', async ({ app }) => {
  await canPlay(app.page, 'maybe');
  const card = await openCard(app);
  await expect(toggle(card)).toBeVisible();
  await expect(toggle(card).locator('xpath=ancestor::details')).not.toHaveAttribute('open', '');
  expect(await app.args('watch_open')).toEqual([]);
  await app.axe('미리보기 줄 접힘');
});

test('펼치면 카드의 주소와 content로 watch_open을 부르고 재생기가 뜬다', async ({ app }) => {
  await canPlay(app.page, 'maybe');
  await swallowMediaErrors(app.page);
  const card = await openCard(app, VOD, { watchSrc: DUMMY_SRC });
  await toggle(card).click();
  const video = card.locator('video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('aria-label', t('watch.player.a11y', { title: VOD.meta.title }));
  await expect(video).toHaveAttribute('preload', 'metadata');
  await expect(video).toHaveAttribute('src', DUMMY_SRC);
  expect(await video.evaluate((v: HTMLVideoElement) => v.autoplay)).toBe(false);
  expect(await app.args('watch_open')).toEqual([{ url: VOD.url, content: VOD.content }]);
  await app.axe('미리보기 펼침');

  // 접으면 세션을 닫는다(가짜 백엔드의 세션 ID)
  await toggle(card).click();
  await expect(video).toBeHidden();
  await expect.poll(() => app.args('watch_close')).toEqual([{ id: 'a'.repeat(32) }]);
});

test('웹뷰가 mp4를 읽지 못하면 실패 Notice와 [치지직에서 보기]가 나오고, 누르면 content로 open_content_page를 부른다', async ({ app }) => {
  await canPlay(app.page, '');
  const card = await openCard(app);
  await toggle(card).click();
  const alert = card.getByRole('alert');
  await expect(alert).toContainText(t('watch.error.body'));
  await expect(card.locator('video')).toHaveCount(0);
  await app.axe('미리보기 실패');
  await card.getByRole('button', { name: t('watch.openInChzzk.label') }).click();
  await expect.poll(() => app.args('open_content_page')).toEqual([{ content: VOD.content }]);
});

test('열기에 실패하면 한 문구와 [다시 시도]가 나오고 재시도는 watch_open을 다시 부른다', async ({ app }) => {
  await canPlay(app.page, 'maybe');
  const card = await openCard(app, VOD, { watch: 'error' });
  await toggle(card).click();
  await expect(card.getByRole('alert')).toContainText(t('watch.error.body'));
  await app.axe('미리보기 열기 실패');
  await card.getByRole('button', { name: t('action.retry') }).click();
  await expect.poll(async () => (await app.args('watch_open')).length).toBe(2);
});

test('게이트가 거부하면 받기와 같은 오류 문구를 보인다', async ({ app }) => {
  await canPlay(app.page, 'maybe');
  const card = await openCard(app, VOD, { watch: 'denied' });
  await toggle(card).click();
  await expect(card.getByRole('alert')).toContainText(errorCopy({ code: 'notOwnContent' } as never, { place: 'resolve' }).title);
  await app.axe('미리보기 게이트 거부');
});

test('생방송 카드에는 줄이 없다', async ({ app }) => {
  const card = await openCard(app, liveResolved());
  await expect(toggle(card)).toHaveCount(0);
  await app.axe('생방송 카드(미리보기 줄 없음)');
});

test('빠른 다시보기 카드에는 아직 줄이 없다(PV-6에서 뒤집는다)', async ({ app }) => {
  const card = await openCard(app, resolved());
  await expect(toggle(card)).toHaveCount(0);
});
