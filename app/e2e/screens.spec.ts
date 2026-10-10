// 화면 갤러리(design-gallery의 화면 몫, docs/design/system/governance.md §2.6, 계약 J6): 실제 앱(dist) + 가짜 백엔드 시나리오로
// 홈 빈 상태 두 종류·최근 영상·불러오는 중·카드 최악 조합·작업 목록·설정(macOS·Linux·Windows)·로그인·대화상자 6종(D6은 v1.1)을 연다.
// `gallery.html`에 가짜 화면을 만들지 않는다: 화면은 진짜이고 데이터만 합성이다.
//
// 환경 행렬은 한 번에 한 축씩 바꾼 목록이다(곱집합은 너무 크다. gallery.spec의 ui/ 행렬과 같은 방식):
// 라이트·다크 × 960×700·720×520·320×231, forced-colors, contrast more, reduce 해제, 글자 "아주 크게"(720·320), OS(macOS·Windows·Linux).
// 검사: axe 위반 0 · 가로 스크롤 0 · 정렬선(툴바 첫·끝 요소·입력줄·배너·카드·토스트 = 열 안쪽 x ± 2) ·
//   `inert` 아닌 층의 `.btn-primary` ≤ 1(대화상자가 열려 있으면 그 안의 하나) · 대화상자의 첫 포커스 = 오른쪽 끝 ·
//   720×520 기본 글자·마우스에서 카드 [받기]와 로그인 요소가 뷰포트 안(그 밖의 조합은 스크롤로 닿음) · 토스트 중 마지막 행 버튼이 가려지지 않음.
// 화면의 글자는 모두 e2e/copy.ts(copy deck)에서 온다.
import type { Locator, Page } from '@playwright/test';
import { LOADER_DELAY_MS, t } from './copy';
import { expect, test } from './fixtures';
import { ENVS, SCREENS, V720, open, scenarioFor, type App, type Env, type Screen } from './screens-data';

// ───────────────────────── 검사 ─────────────────────────

/**
 * 화면 안(뷰포트 안)에 있는가. `full`이면 통째로, 아니면 위쪽 가장자리가 보이고 가로로 안에 있으면 된다
 * (320 폭 "아주 크게"의 긴 안내 글처럼 화면보다 큰 것은 스크롤로 나눠 읽는다)
 */
const inViewport = (l: Locator, full: boolean) =>
  l.evaluate((el, whole) => {
    const r = el.getBoundingClientRect();
    const toolbar = document.querySelector('header.toolbar')?.getBoundingClientRect().bottom ?? 0;
    const horizontal = r.left >= -0.5 && r.right <= innerWidth + 0.5;
    if (whole) return horizontal && r.top >= -0.5 && r.bottom <= innerHeight + 0.5;
    return horizontal && r.top >= toolbar - 0.5 && r.top < innerHeight;
  }, full);

/** 기본 글자·마우스의 720×520에서는 스크롤 없이 통째로 안에 있어야 하고, 그 밖의 조합은 스크롤로 닿으면 된다 */
async function expectReachable(l: Locator, label: string, mustFit: boolean, full = true) {
  if (mustFit) {
    expect(await inViewport(l, true), `${label}: 720×520 기본 글자에서 스크롤 없이 뷰포트 안`).toBe(true);
    return;
  }
  await l.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  expect(await inViewport(l, full), `${label}: 스크롤로 닿는다`).toBe(true);
}

async function checkNoHorizontalScroll(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const over = (el: Element | null) => (el ? el.scrollWidth - el.clientWidth : 0);
    return { html: over(document.documentElement), body: over(document.body), main: over(document.querySelector('.main')) };
  });
  expect(r, `가로 스크롤(${label}): 문서·본문·.main 모두 0`).toEqual({ html: 0, body: 0, main: 0 });
}

/** 정렬선: 툴바 첫·끝 요소(끝자리 보정 뒤)·입력줄·배너·카드·토스트의 상자 x = 열 안쪽 x ± 2 */
async function checkAlignment(page: Page, label: string, expected: string[]) {
  const { misses, checked } = await page.evaluate(() => {
    const out: string[] = [];
    const checked: string[] = [];
    const col = document.querySelector<HTMLElement>('.main > .col');
    if (!col) return { misses: ['.main > .col 없음'], checked };
    const cs = getComputedStyle(col);
    const r = col.getBoundingClientRect();
    const left = r.left + parseFloat(cs.paddingLeft);
    const right = r.right - parseFloat(cs.paddingRight);
    const near = (name: string, x: number, want: number) => {
      checked.push(name);
      if (Math.abs(x - want) > 2) out.push(`${name} x=${x.toFixed(1)} (열 안쪽 ${want.toFixed(1)})`);
    };
    // 툴바: 첫 요소는 .edge-start 보정(음수 margin) 뒤의 왼쪽, 끝 요소는 .edge-end 보정 뒤의 오른쪽
    const bar = document.querySelector('header.toolbar > .col');
    const first = bar?.firstElementChild as HTMLElement | null;
    if (first) near('툴바 첫 요소', first.getBoundingClientRect().left - parseFloat(getComputedStyle(first).marginLeft), left);
    const end = bar?.querySelector('.toolbar-end');
    const lastEnd = end?.lastElementChild as HTMLElement | null;
    if (lastEnd) near('툴바 끝 요소', lastEnd.getBoundingClientRect().right + parseFloat(getComputedStyle(lastEnd).marginRight), right);
    const boxes: [string, string][] = [
      ['입력줄', 'form.urlbar'],
      ['배너', '.notice-banner'],
      ['카드', '.video-card'],
      ['토스트', '.notice-toast'],
    ];
    for (const [name, sel] of boxes) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const b = el.getBoundingClientRect();
      near(`${name} 왼쪽`, b.left, left);
      near(`${name} 오른쪽`, b.right, right);
    }
    // 세로 간격(patterns.md §15 예산): 배너 아래 8, 입력줄(입력칸 28 + 패딩 8) 아래 카드까지 24.
    // sticky 입력줄은 스크롤하면 제자리를 떠나므로 위치가 아니라 여백 값으로 본다
    const margin = (name: string, sel: string, prop: 'marginTop' | 'marginBottom', want: number) => {
      const el = document.querySelector(sel);
      if (!el) return;
      checked.push(name);
      const px = parseFloat(getComputedStyle(el)[prop]);
      if (Math.abs(px - want) > 0.5) out.push(`${name} ${px} (기대 ${want})`);
    };
    margin('배너 아래 간격', '.banner-slot', 'marginBottom', 8);
    margin('입력줄 카드 간격', '.card-slot', 'marginTop', 24);
    return { misses: out, checked };
  });
  expect(misses, `정렬선(${label})`).toEqual([]);
  expect(checked, `정렬선을 잰 상자(${label})`).toEqual(expect.arrayContaining(['툴바 첫 요소', ...expected]));
}

/** 채움 버튼: `inert` 아닌 층에 대화상자가 열려 있으면 그 안의 하나, 아니면 많아야 하나 */
async function checkPrimary(page: Page, label: string, dialog: boolean) {
  const prim = await page.evaluate(() => [...document.querySelectorAll('.btn-primary')].filter((e) => !e.closest('[inert]')).map((e) => !!e.closest('.dialog')));
  if (dialog) expect(prim, `채움 버튼(${label}): 대화상자 안의 하나`).toEqual([true]);
  else expect(prim.length, `채움 버튼(${label}): 층에 많아야 하나`).toBeLessThanOrEqual(1);
}

/** 대화상자의 첫 포커스는 오른쪽 끝 버튼(= 안전한 쪽, 채움, Enter) */
async function checkDialogFocus(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const buttons = [...document.querySelectorAll<HTMLElement>('.dialog .actions button')];
    const maxRight = Math.max(...buttons.map((b) => b.getBoundingClientRect().right));
    return {
      isButton: !!active && buttons.includes(active),
      rightmost: !!active && Math.abs(active.getBoundingClientRect().right - maxRight) < 0.5,
      primary: !!active?.classList.contains('btn-primary'),
    };
  });
  expect(r, `대화상자 첫 포커스(${label})`).toEqual({ isButton: true, rightmost: true, primary: true });
}

/** 토스트가 떠 있어도 마지막 행의 버튼이 가려지지 않는다: 바닥까지 스크롤한 뒤 토스트 위에 있다 */
async function checkToastClearance(page: Page, label: string) {
  const r = await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>('.main');
    if (main) main.scrollTop = main.scrollHeight;
    const toast = document.querySelector('.notice-toast')?.getBoundingClientRect();
    const rows = [...document.querySelectorAll('article')];
    const buttons = [...(rows[rows.length - 1]?.querySelectorAll('button') ?? [])];
    return { toastTop: toast?.top ?? null, bottoms: buttons.map((b) => b.getBoundingClientRect().bottom) };
  });
  expect(r.toastTop, `토스트(${label})`).not.toBeNull();
  expect(r.bottoms.length, `마지막 행의 버튼(${label})`).toBeGreaterThan(0);
  for (const b of r.bottoms) expect(b, `마지막 행 버튼이 토스트에 가려진다(${label})`).toBeLessThanOrEqual((r.toastTop as number) + 0.5);
}

async function prepare(page: Page, env: Env) {
  await page.setViewportSize(env.vp);
  await page.emulateMedia({
    colorScheme: env.scheme,
    forcedColors: env.forced ? 'active' : 'none',
    contrast: env.contrast ?? 'no-preference',
    reducedMotion: env.motion ? 'no-preference' : 'reduce',
  });
}

async function inspect(app: App, env: Env, screen: Screen) {
  const { page } = app;
  const label = `${screen.id} · ${env.name}`;
  await app.open(scenarioFor(screen, env));
  await screen.drive?.(app, env);
  await screen.ready(page).waitFor({ timeout: LOADER_DELAY_MS + 5_000 });
  await page.evaluate(() => document.fonts.ready);
  if (env.xlarge) await expect(page.locator('html')).toHaveAttribute('data-text-scale', 'x-large');
  await screen.extra?.(page, screen.os ?? env.os);
  await screen.settle?.(page, env);
  await app.axe(label);
  await checkNoHorizontalScroll(page, label);
  await checkAlignment(page, label, screen.aligned ?? []);
  await checkPrimary(page, label, !!screen.dialog);
  if (screen.dialog) await checkDialogFocus(page, label);

  // 720×520 기본 글자·마우스: 카드 [받기]와 로그인 요소는 스크롤 없이 안에 있다. 그 밖은 스크롤로 닿는다
  const mustFit = env.vp.width === V720.width && env.vp.height === V720.height && !env.xlarge;
  if (screen.card) await expectReachable(open(page, t('card.download')), '카드 [받기]', mustFit);
  if (screen.login) {
    const targets: [string, Locator, boolean][] = [
      ['auth.intro', page.getByText(t('auth.intro')), false],
      ['notice.short', page.getByText(t('notice.short')), false],
      ['auth.consent', page.getByText(t('auth.consent')), false],
      ['[로그인]', open(page, t('auth.login')), true],
      ['auth.privacy', open(page, t('auth.privacy')), true],
    ];
    for (const [name, l, full] of targets) await expectReachable(l, `로그인 ${name}`, mustFit, full);
  }

  if (screen.toastAction) {
    // 토스트는 맨 아래를 덮는다. 스크롤 위치에 따라 행이 가려지는 것은 정상이라 axe(대상 크기)는 토스트만 보고,
    // 가림은 바닥까지 스크롤한 뒤 마지막 행이 토스트 위에 오는지로 본다
    await screen.toastAction(app);
    await page.locator('.notice-toast').waitFor();
    await app.axe(`${label} 토스트`, '.notice-toast');
    await checkAlignment(page, `${label} 토스트`, screen.alignedToast ?? []);
    await checkNoHorizontalScroll(page, `${label} 토스트`);
    await checkToastClearance(page, label);
  }
}

for (const screen of SCREENS) {
  for (const env of ENVS) {
    if (screen.only && !screen.only.includes(env.name)) continue;
    test(`${screen.id} · ${env.name}`, async ({ app }) => {
      await prepare(app.page, env);
      await inspect(app, env, screen);
    });
  }
}

