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
  // (생방송 카드도 같다: live.spec.ts와 같은 방식으로 켜질 때까지 기다린다)
  await expect(card.getByRole('button', { name: t('card.download') })).not.toHaveAttribute('aria-disabled', 'true');
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

/** HLS 장면용 자리표시 playlist 주소. 응답은 test가 쥐고 있다가 놓는다(hls.js가 읽는 동안의 모습을 안정적으로 본다) */
const HLS_SRC = 'http://watch.example.invalid/pl.m3u8';
function holdPlaylist(page: Page) {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const seen: string[] = [];
  void page.route(HLS_SRC, async (route) => {
    seen.push(route.request().url());
    await gate;
    // 200이지만 playlist가 아니다: 브라우저 console.error 없이 hls.js만 치명 오류(manifestParsingError)로 간다
    await route.fulfill({ status: 200, contentType: 'application/vnd.apple.mpegurl', body: 'not a playlist' });
  });
  return { release, seen };
}

test('빠른 다시보기 카드에도 줄이 있고, 펼치면 hls.js가 playlist를 읽는다', async ({ app }) => {
  const held = holdPlaylist(app.page);
  const REWIND = resolved();
  const card = await openCard(app, REWIND, { watchSrc: HLS_SRC });
  await expect(toggle(card)).toBeVisible();
  await toggle(card).click();
  const video = card.locator('video');
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('aria-label', t('watch.player.a11y', { title: REWIND.meta.title }));
  // MSE로 붙이므로 video의 src는 playlist 주소가 아니라 hls.js가 만든 blob 주소다(CSP media-src blob:)
  const videoSrc = await video.getAttribute('src');
  expect(videoSrc === null || videoSrc.startsWith('blob:')).toBe(true);
  expect(await app.args('watch_open')).toEqual([{ url: REWIND.url, content: REWIND.content }]);
  await expect.poll(() => held.seen.length).toBeGreaterThan(0);
  await app.axe('미리보기 펼침(빠른 다시보기)');

  // playlist가 깨져 있으면(치명 오류) 한 문구의 실패 Notice와 세션 닫기
  held.release();
  await expect(card.getByRole('alert')).toContainText(t('watch.error.body'), { timeout: 15_000 });
  await expect(video).toHaveCount(0);
  await expect.poll(() => app.args('watch_close')).toEqual([{ id: 'a'.repeat(32) }]);
  await app.axe('미리보기 실패(빠른 다시보기)');
});

test('빠른 다시보기 카드를 펼쳤다 접으면 세션을 닫는다', async ({ app }) => {
  holdPlaylist(app.page);
  const card = await openCard(app, resolved(), { watchSrc: HLS_SRC });
  await toggle(card).click();
  await expect(card.locator('video')).toBeVisible();
  await toggle(card).click();
  await expect(card.locator('video')).toBeHidden();
  await expect.poll(() => app.args('watch_close')).toEqual([{ id: 'a'.repeat(32) }]);
});

/** 메타데이터가 읽혔고 재생 위치가 `time`초인 것처럼 만든다(chromium은 존재하지 않는 주소를 재생하지 못한다) */
async function loadedAt(card: Locator, time: number) {
  await card.locator('video').evaluate((v: HTMLVideoElement, tm: number) => {
    Object.defineProperty(v, 'currentTime', { value: tm, configurable: true, writable: true });
    v.dispatchEvent(new Event('loadedmetadata'));
  }, time);
}

test('빠른 다시보기에서 찍은 시각이 구간 칸을 채우고 받기 요청의 range가 된다', async ({ app }) => {
  holdPlaylist(app.page);
  const REWIND = resolved();
  const card = await openCard(app, REWIND, { watchSrc: HLS_SRC });
  await toggle(card).click();
  await expect(card.locator('video')).toBeVisible();
  const markStart = card.getByRole('button', { name: t('watch.mark.start') });
  const markEnd = card.getByRole('button', { name: t('watch.mark.end') });
  // 메타데이터가 읽히기 전에는 비활성이다
  await expect(markStart).toBeDisabled();
  await app.axe('찍기 버튼 비활성(빠른 다시보기)');

  await loadedAt(card, 600.7);
  await expect(markStart).toBeEnabled();
  await markStart.click();
  await loadedAt(card, 1200.1);
  await markEnd.click();
  await expect(card.getByLabel(t('range.start'))).toHaveValue('0:10:00');
  await expect(card.getByLabel(t('range.end'))).toHaveValue('0:20:00');
  await app.axe('찍은 구간(빠른 다시보기)');

  await expect(card.getByRole('button', { name: t('card.download') })).not.toHaveAttribute('aria-disabled', 'true');
  await card.getByRole('button', { name: t('card.download') }).click();
  await expect.poll(async () => (await app.args('enqueue')).length).toBe(1);
  const [{ req }] = (await app.args('enqueue')) as Array<{ req: { range?: unknown } }>;
  expect(req.range).toEqual({ startMs: 600000, endMs: 1200000 });
});

test('일반 VOD 카드에는 찍기 버튼이 없다', async ({ app }) => {
  await canPlay(app.page, 'maybe');
  await swallowMediaErrors(app.page);
  const card = await openCard(app, VOD, { watchSrc: DUMMY_SRC });
  await toggle(card).click();
  await expect(card.locator('video')).toBeVisible();
  await expect(card.getByRole('button', { name: t('watch.mark.start') })).toHaveCount(0);
  await expect(card.getByRole('button', { name: t('watch.mark.end') })).toHaveCount(0);
});
