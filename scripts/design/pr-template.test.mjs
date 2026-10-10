// PR 템플릿 패리티(governance.md §3.0): README §4.2 표 ↔ .github/PULL_REQUEST_TEMPLATE.md ↔ governance §3 표.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** README §4.2 표의 [번호, 요지] 행. */
export function readmeRows(readme) {
  const sec = readme.split('### 4.2 리뷰 체크리스트')[1]?.split(/\n---/)[0] ?? '';
  return [...sec.matchAll(/^\| (R\d+) \| (.+) \|$/gm)].map((m) => [m[1], m[2]]);
}

/** 템플릿의 `- **Rn** 요지` 줄. */
export function templateRows(tpl) {
  return [...tpl.matchAll(/^- \*\*(R\d+)\*\* (.+)$/gm)].map((m) => [m[1], m[2]]);
}

/** governance §3 표의 굵은 번호 열(`| **Rn** |`). */
export function governanceIds(gov) {
  const sec = gov.split('## 3. 리뷰 체크리스트')[1]?.split(/\n## 4\./)[0] ?? '';
  return [...sec.matchAll(/^\| \*\*(R\d+)\*\* \|/gm)].map((m) => m[1]);
}

const FIRST = '화면·문구·토큰을 건드린 PR만 아래를 채운다. 해당 없는 항목은 `해당 없음`으로 둔다.';
const IDS = Array.from({ length: 10 }, (_, i) => `R${i + 1}`);

test('README §4.2 표는 R1~R10 열 줄이다', () => {
  assert.deepEqual(readmeRows(read('docs/design/system/README.md')).map((r) => r[0]), IDS);
});

test('템플릿은 governance §3.0 첫 문장으로 시작한다', () => {
  assert.ok(read('.github/PULL_REQUEST_TEMPLATE.md').startsWith(FIRST));
});

test('템플릿 R1~R10 줄 = README §4.2 표(번호·요지)', () => {
  assert.deepEqual(templateRows(read('.github/PULL_REQUEST_TEMPLATE.md')), readmeRows(read('docs/design/system/README.md')));
});

test('governance §3 표 번호 = README §4.2 번호', () => {
  assert.deepEqual(governanceIds(read('docs/design/system/governance.md')), IDS);
});

test('음성: 요지나 번호가 어긋나면 패리티 비교가 다르다', () => {
  const readme = read('docs/design/system/README.md');
  const tpl = read('.github/PULL_REQUEST_TEMPLATE.md');
  assert.notDeepEqual(templateRows(tpl.replace('**R3**', '**R30**')), readmeRows(readme));
  assert.notDeepEqual(templateRows(tpl.replace('copy deck diff', 'copy deck 차이')), readmeRows(readme));
  assert.notDeepEqual(governanceIds('## 3. 리뷰 체크리스트\n| **R1** | a |\n## 4. x'), IDS);
});
