// 구간 편집 화면(range-editor.md RE-3, D67): 열기(요청 0) → [영상 보기] → hls.js → 찍기·손잡이·I/O·칸 ↑/↓ → [구간 적용하기] → 받기 요청의 range.
// 닫기·Esc·Mod+Enter, 좁은 창·큰 글자에서의 배치. 화면 글자는 모두 e2e/copy.ts(copy deck)에서 가져온다.
// Playwright chromium은 실제 재생을 하지 않는다(§10): playlist 응답은 가짜이고, 메타데이터가 읽힌 상태는 스크립트로 만든다.
import type { Locator, Page } from '@playwright/test';
import { resolved } from '../src/test/fixtures';
import { t } from './copy';
import { expect, test, type App } from './fixtures';

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

const REWIND = resolved();
const dialog = (app: App) => app.page.getByRole('dialog', { name: t('rangeEditor.title') });
const editBtn = (card: Locator) => card.getByRole('button', { name: t('range.edit.label') });
const start = (app: App) => dialog(app).getByRole('textbox', { name: t('range.start') });
const end = (app: App) => dialog(app).getByRole('textbox', { name: t('range.end') });
const applyBtn = (app: App) => dialog(app).getByRole('button', { name: new RegExp(t('rangeEditor.apply.label')) });
/** 제목에서 시작해 Tab을 눌러 `target`에 닿는지 본다(Tab 순서·trapTab을 거친다). 닿으면 보이는지도 본다 */
async function tabTo(app: App, target: Locator) {
  await dialog(app).getByRole('heading', { name: t('rangeEditor.title') }).focus();
  for (let i = 0; i < 60; i += 1) {
    await app.page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) {
      await expect(target).toBeInViewport();
      return;
    }
  }
  throw new Error('Tab으로 닿지 않았다');
}

const closeBtn = (app: App) => dialog(app).getByRole('button', { name: t('common.close') });
const markStart = (app: App) => dialog(app).getByRole('button', { name: t('watch.mark.start') });
const markEnd = (app: App) => dialog(app).getByRole('button', { name: t('watch.mark.end') });
const downloadBtn = (card: Locator) => card.getByRole('button', { name: t('card.download') });
const videoOf = (app: App) => dialog(app).locator('video');

async function openCard(app: App, extra: Record<string, unknown> = {}) {
  await app.open({ resolve: { [REWIND.url]: REWIND }, watchSrc: HLS_SRC, ...extra });
  await app.page.getByLabel(t('url.label')).fill(REWIND.url);
  await app.page.getByRole('button', { name: t('common.load') }).click();
  const card = app.page.getByRole('region', { name: REWIND.meta.title });
  await expect(card).toBeVisible();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  return card;
}

/** 편집 화면을 열고 [영상 보기]를 눌러 hls.js 경로로 붙인다 */
async function openPlayer(app: App, card: Locator) {
  await editBtn(card).click();
  await expect(dialog(app)).toBeVisible();
  await dialog(app).getByRole('button', { name: t('watch.start.label') }).click();
  await expect(videoOf(app)).toBeVisible();
}

/** 메타데이터가 읽혔고 재생 위치가 `time`초(영상 길이가 `duration`초)인 것처럼 만든다(chromium은 존재하지 않는 주소를 재생하지 못한다) */
async function loadedAt(app: App, time: number, duration?: number) {
  await videoOf(app).evaluate(
    (v: HTMLVideoElement, [tm, dur]: [number, number | undefined]) => {
      Object.defineProperty(v, 'currentTime', { value: tm, configurable: true, writable: true });
      if (dur != null) Object.defineProperty(v, 'duration', { value: dur, configurable: true });
      v.dispatchEvent(new Event('loadedmetadata'));
    },
    [time, duration] as [number, number | undefined],
  );
}

test('편집 화면을 열기만 해서는 요청이 없고, [영상 보기]를 누르면 hls.js가 playlist를 읽는다', async ({ app }) => {
  const held = holdPlaylist(app.page);
  const card = await openCard(app);
  await expect(card.locator('.watch')).toHaveCount(0); // 섹션이 없다(D67)
  await editBtn(card).click();
  await expect(dialog(app)).toBeVisible();
  await expect(dialog(app).getByRole('heading', { level: 1, name: t('rangeEditor.title') })).toBeFocused();
  expect(await app.args('watch_open')).toEqual([]);
  await app.axe('구간 편집(열기 직후)');

  await dialog(app).getByRole('button', { name: t('watch.start.label') }).click();
  const video = videoOf(app);
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute('aria-label', t('watch.player.a11y', { title: REWIND.meta.title }));
  // MSE로 붙이므로 video의 src는 playlist 주소가 아니라 hls.js가 만든 blob 주소다(CSP media-src blob:)
  const videoSrc = await video.getAttribute('src');
  expect(videoSrc === null || videoSrc.startsWith('blob:')).toBe(true);
  expect(await app.args('watch_open')).toEqual([{ url: REWIND.url, content: REWIND.content }]);
  await expect.poll(() => held.seen.length).toBeGreaterThan(0);
  await app.axe('구간 편집(영상 보기)');

  // playlist가 깨져 있으면(치명 오류) 한 문구의 실패 Notice와 세션 닫기
  held.release();
  await expect(dialog(app).getByRole('alert')).toContainText(t('watch.error.body'), { timeout: 15_000 });
  await expect(video).toHaveCount(0);
  await expect.poll(() => app.args('watch_close')).toEqual([{ id: 'a'.repeat(32) }]);
  // 실패해도 타임라인과 칸은 남아 계속 고칠 수 있다
  await expect(dialog(app).getByRole('slider')).toHaveCount(2);
  await app.axe('구간 편집(미리보기 실패)');
});

test('Esc는 편집 화면만 닫고 세션을 닫는다. 카드는 그대로다', async ({ app }) => {
  holdPlaylist(app.page);
  const card = await openCard(app);
  await openPlayer(app, card);
  await app.page.keyboard.press('Escape');
  await expect(dialog(app)).toBeHidden();
  await expect(card).toBeVisible();
  await expect(editBtn(card)).toBeFocused();
  await expect.poll(() => app.args('watch_close')).toEqual([{ id: 'a'.repeat(32) }]);
});

test('찍은 시각이 칸을 채우고, 적용하면 받기 요청의 range가 된다', async ({ app }) => {
  holdPlaylist(app.page);
  const card = await openCard(app);
  await openPlayer(app, card);
  // 메타데이터가 읽히기 전에는 영상과 구간이 결합되지 않아 조작 줄이 모두 disabled다(PS12)
  await expect(markStart(app)).toBeDisabled();
  await app.axe('구간 편집(결합 전)');

  await loadedAt(app, 600.7);
  await expect(markStart(app)).toBeEnabled();
  await markStart(app).click();
  await loadedAt(app, 1200.1);
  await markEnd(app).click();
  await expect(start(app)).toHaveValue('0:10:00');
  await expect(end(app)).toHaveValue('0:20:00');
  await app.axe('구간 편집(찍은 구간)');

  await applyBtn(app).click();
  await expect(dialog(app)).toBeHidden();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect.poll(async () => (await app.args('enqueue')).length).toBe(1);
  const [{ req }] = (await app.args('enqueue')) as Array<{ req: { range?: unknown } }>;
  expect(req.range).toEqual({ startMs: 600000, endMs: 1200000 });
});

test('재생 전에도 타임라인과 칸이 있고 칸이 비면 전체라는 줄이 보인다. 손잡이는 칸만 고치고 요청은 없다', async ({ app }) => {
  const card = await openCard(app);
  await editBtn(card).click();
  await expect(dialog(app).getByRole('slider')).toHaveCount(2);
  await expect(start(app)).toHaveValue('');
  await expect(start(app)).toHaveAttribute('placeholder', t('range.fromBegin'));
  await expect(end(app)).toHaveAttribute('placeholder', t('range.toEnd'));
  await expect(dialog(app).getByText(/^전체 길이: 3:12:45/)).toBeVisible();
  expect(await app.args('watch_open')).toEqual([]);
  await dialog(app).getByRole('slider', { name: t('range.start') }).press('ArrowRight');
  await expect(start(app)).toHaveValue('0:00:01');
  await expect(dialog(app).getByText(/^구간 길이:/)).toBeVisible();
  expect(await app.args('watch_open')).toEqual([]);
  await app.axe('구간 편집(재생 전)');
  // 편집 화면 [구간 지우기]는 초안만 지운다
  await dialog(app).getByRole('button', { name: t('range.clear.label') }).click();
  await expect(start(app)).toHaveValue('');
});

test('손잡이를 끌거나 키로 옮기면 칸이 바뀌고 적용한 값이 받기 요청의 range가 된다', async ({ app }) => {
  holdPlaylist(app.page);
  const card = await openCard(app);
  await openPlayer(app, card);
  await expect(dialog(app).getByRole('slider')).toHaveCount(2);
  await loadedAt(app, 0, REWIND.meta.durationSecs ?? 0);
  const startThumb = dialog(app).getByRole('slider', { name: t('range.start') });
  const endThumb = dialog(app).getByRole('slider', { name: t('range.end') });
  await expect(startThumb).toBeVisible();
  await app.axe('구간 편집(손잡이)');

  // 시작 손잡이를 마우스로 막대 가운데까지 끈다(pointer capture가 실제 브라우저에서 도는지 본다).
  // 손잡이의 누름 영역은 앵커에서 바깥쪽(시작은 왼쪽)으로만 펴지므로 몸통 왼쪽 가장자리 밖을 누른다
  const track = dialog(app).locator('.track');
  await track.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const tb = (await track.boundingBox())!;
  const sb = (await startThumb.boundingBox())!;
  const y = sb.y + sb.height / 2;
  await app.page.mouse.move(sb.x - 4, y);
  await app.page.mouse.down();
  await app.page.mouse.move(tb.x + tb.width / 2, y, { steps: 6 });
  await app.page.mouse.up();
  await expect(start(app)).not.toHaveValue('');
  await expect(end(app)).toHaveValue('');
  const startValue = await start(app).inputValue();

  // 끝 손잡이: Shift+←(−10초) 두 번
  await endThumb.focus();
  await endThumb.press('Shift+ArrowLeft');
  await endThumb.press('Shift+ArrowLeft');
  await expect(end(app)).toHaveValue('3:12:25');

  await applyBtn(app).click();
  await expect(dialog(app)).toBeHidden();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect.poll(async () => (await app.args('enqueue')).length).toBe(1);
  const [{ req }] = (await app.args('enqueue')) as Array<{ req: { range?: unknown } }>;
  const [h, m, sec] = startValue.split(':').map(Number);
  expect(req.range).toEqual({ startMs: (h * 3600 + m * 60 + sec) * 1000, endMs: 11545000 });
});

test('타임라인을 누른 뒤 I·O 키로 시작·끝을 찍으면 칸이 채워진다', async ({ app }) => {
  holdPlaylist(app.page);
  const card = await openCard(app);
  await openPlayer(app, card);
  await loadedAt(app, 0, REWIND.meta.durationSecs ?? 0);
  const track = dialog(app).locator('.track');
  await track.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const tb = (await track.boundingBox())!;
  const y = tb.y + tb.height / 2;
  const clock = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const now = () => videoOf(app).evaluate((v: HTMLVideoElement) => Math.floor(v.currentTime));

  // 막대를 누르면 그 시각으로 가고, 포커스는 시간 영역 그룹이 받아 I가 바로 동작한다(V8)
  await app.page.mouse.click(tb.x + tb.width * 0.25, y);
  const a = await now();
  expect(a).toBeGreaterThan(0);
  await app.page.keyboard.press('i');
  await expect(start(app)).toHaveValue(clock(a));

  await app.page.mouse.click(tb.x + tb.width * 0.5, y);
  const b = await now();
  expect(b).toBeGreaterThan(a);
  await app.page.keyboard.press('o');
  await expect(end(app)).toHaveValue(clock(b));
});

test('칸 ↑/↓가 칸을 고치고, 칸을 고친 뒤 빠져나가면 영상이 그 시각으로 간다', async ({ app }) => {
  holdPlaylist(app.page);
  const card = await openCard(app);
  await openPlayer(app, card);
  await loadedAt(app, 0, REWIND.meta.durationSecs ?? 0);
  const now = () => videoOf(app).evaluate((v: HTMLVideoElement) => Math.floor(v.currentTime));

  // 칸에 적고 Tab으로 빠져나가면 영상이 그 시각으로 간다
  await start(app).fill('0:10:00');
  await start(app).press('Tab');
  await expect.poll(now).toBe(600);

  // ↑/↓: 칸이 1초씩 바뀌고 영상도 따라간다
  await start(app).press('ArrowUp');
  await expect(start(app)).toHaveValue('0:10:01');
  await expect.poll(now).toBe(601);
  await end(app).press('ArrowDown');
  await expect(end(app)).toHaveValue('3:12:44');
  await expect(dialog(app).getByText(t('range.lengthSize.label', { length: '3:02:43', size: '' }).split(' · ')[0])).toBeVisible();
  await app.axe('구간 편집(칸 ↑/↓와 구간 길이)');

  await applyBtn(app).click();
  await expect(dialog(app)).toBeHidden();
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await downloadBtn(card).click();
  await expect.poll(async () => (await app.args('enqueue')).length).toBe(1);
  const [{ req }] = (await app.args('enqueue')) as Array<{ req: { range?: unknown } }>;
  expect(req.range).toEqual({ startMs: 601000, endMs: 11564000 });
});

test('Mod+Enter는 [구간 적용하기]다: 적용하고 받기(enqueue)를 시작하지 않는다', async ({ app }) => {
  const card = await openCard(app);
  await editBtn(card).click();
  await expect(dialog(app)).toBeVisible();
  // 구간을 바꾸지 않는다: 검사 열쇠가 그대로라 [받기]가 켜진 채로 있어, 같은 키가 카드까지 닿으면 바로 받기가 시작된다
  await expect(downloadBtn(card)).not.toHaveAttribute('aria-disabled', 'true');
  await app.page.keyboard.press('Control+Enter');
  await expect(dialog(app)).toBeHidden();
  // 실제 사용자 이벤트에서는 리스너 하나가 끝날 때마다 microtask가 돌아 깃발이 먼저 내려간다(jsdom 동기 디스패치로는 못 본다, RE15)
  await app.page.waitForTimeout(400);
  expect(await app.args('enqueue')).toHaveLength(0);
  await expect(card).toBeVisible();
  // 편집 화면이 닫힌 뒤의 같은 키는 [받기]다
  await app.page.keyboard.press('Control+Enter');
  await expect.poll(async () => (await app.args('enqueue')).length).toBe(1);
});

/** 몸통이 가로로 넘치지 않는다(WCAG 1.4.10) */
async function noHorizontalScroll(app: App) {
  const over = await app.page.evaluate(() => {
    const sheet = document.querySelector('.fullsheet') as HTMLElement;
    const body = sheet.querySelector('.body') as HTMLElement;
    return {
      doc: document.documentElement.scrollWidth - window.innerWidth,
      sheet: sheet.scrollWidth - sheet.clientWidth,
      body: body.scrollWidth - body.clientWidth,
    };
  });
  expect(over).toEqual({ doc: 0, sheet: 0, body: 0 });
}

for (const [label, size, xlarge] of [
  ['720×520', { width: 720, height: 520 }, false],
  ['320×231', { width: 320, height: 231 }, false],
  ['큰 글자(x-large) 720×520', { width: 720, height: 520 }, true],
] as const) {
  test(`${label}에서도 [닫기]·[구간 적용하기]가 뷰포트 안에 있고 가로 스크롤이 없다`, async ({ app }) => {
    await app.page.setViewportSize(size);
    holdPlaylist(app.page);
    const card = await openCard(app);
    if (xlarge) await app.page.evaluate(() => (document.documentElement.dataset.textScale = 'x-large'));
    await editBtn(card).scrollIntoViewIfNeeded();
    await editBtn(card).click();
    await expect(dialog(app)).toBeVisible();
    await expect(closeBtn(app)).toBeInViewport();
    await expect(applyBtn(app)).toBeInViewport();
    await noHorizontalScroll(app);
    // 구간 줄의 두 칸에 Tab으로 닿고 보인다
    await tabTo(app, start(app));
    await tabTo(app, end(app));
    await app.axe(`구간 편집(${label})`);
  });
}

test('320×231에서 Shift+Tab으로 거꾸로 돌 때 포커스된 요소가 머리 밑에 가리지 않는다(WCAG 2.4.11)', async ({ app }) => {
  await app.page.setViewportSize({ width: 320, height: 231 });
  const card = await openCard(app);
  await editBtn(card).click();
  await expect(dialog(app)).toBeVisible();
  const headBottom = async () => (await dialog(app).locator('.head').boundingBox())!.y + (await dialog(app).locator('.head').boundingBox())!.height;
  for (let i = 0; i < 14; i++) {
    await app.page.keyboard.press('Shift+Tab');
    const rect = await app.page.evaluate(() => {
      const a = document.activeElement as HTMLElement;
      const r = a.getBoundingClientRect();
      return { top: r.top, inHead: !!a.closest('.head') };
    });
    if (!rect.inHead) expect(rect.top).toBeGreaterThanOrEqual((await headBottom()) - 1);
  }
});
