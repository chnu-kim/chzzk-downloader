// 공용 fixture: 시나리오로 앱을 열고, 페이지 오류를 실패로 삼고, axe로 접근성 위반 0을 확인한다.
import { createRequire } from 'node:module';
import { test as base, expect, type Page } from '@playwright/test';
import type { E2EController, Scenario } from './mock/backend';
import { MOCK_BUNDLE } from './global-setup';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

export type App = {
  page: Page;
  /** 시나리오로 앱을 열고 구독(스냅샷)까지 기다린다 */
  open(scenario?: Scenario): Promise<void>;
  /** 브라우저 안의 가짜 백엔드 조작(window.__e2e). 함수는 직렬화되므로 바깥 변수는 arg로 넘긴다 */
  ctl<A, T>(fn: (c: E2EController, arg: A) => T | Promise<T>, arg: A): Promise<T>;
  /** 앱이 부른 command 이름(순서대로) */
  cmds(): Promise<string[]>;
  /** 그 command의 인자들(순서대로) */
  args(cmd: string): Promise<unknown[]>;
  /** axe-core(WCAG 2.x A·AA)로 위반 0 */
  axe(label: string): Promise<void>;
};

export const test = base.extend<{ app: App }>({
  app: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
    });
    const app: App = {
      page,
      async open(scenario = {}) {
        await page.addInitScript((s) => {
          window.__E2E_SCENARIO__ = s;
        }, scenario);
        await page.addInitScript({ path: MOCK_BUNDLE });
        await page.goto('/');
        await page.waitForFunction(() => window.__e2e?.subscribed() === true);
      },
      ctl: (fn, arg) => page.evaluate(([src, a]) => (0, eval)(`(${src})`)(window.__e2e, a), [fn.toString(), arg] as const),
      cmds: () => page.evaluate(() => window.__e2e.calls.map((c) => c.cmd)),
      args: (cmd) => page.evaluate((c) => window.__e2e.calls.filter((x) => x.cmd === c).map((x) => x.args), cmd),
      async axe(label) {
        // 열리는 중인 전환(Disclosure·대화상자)의 중간 색·크기를 재지 않도록 모든 애니메이션이 끝난 뒤 잰다
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
        await page.addScriptTag({ path: AXE });
        const violations = await page.evaluate(async () => {
          const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; any?: { message: string }[] }[] }[] }> } }).axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
            resultTypes: ['violations'],
          });
          // 대비 위반은 색·비율도 남긴다(원인을 trace 없이 읽을 수 있게)
          return r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => `${n.target.join(' ')} ${n.any?.[0]?.message ?? ''}`.trim()).join(' | ')}`);
        });
        expect(violations, `axe 위반(${label})`).toEqual([]);
      },
    };
    await use(app);
    expect(errors, '페이지 오류·console.error가 없어야 한다').toEqual([]);
  },
});

export { expect };
