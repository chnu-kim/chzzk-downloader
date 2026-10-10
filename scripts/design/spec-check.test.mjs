// spec-check.mjs 단위 테스트: 저장소 문서가 0건이고, 작은 가짜 루트에서 위반이 잡히는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { check, ROOT } from './spec-check.mjs';

const SCRIPT = fileURLToPath(new URL('./spec-check.mjs', import.meta.url));
const NAMES = ['README', 'foundations', 'components', 'patterns', 'content', 'platform', 'web', 'governance'];

const FOUNDATIONS = [
  '# foundations',
  '## 9. 아이콘',
  '| 글자 없는 아이콘 버튼 | 허용 목록(2개): `x` · `settings`. 모두 `aria-label` | 근거 | 강제 |',
  '## 13. 생성물 기대 모양',
  '```css',
  ':root {',
  '  --space-8: 8px;',
  '}',
  '```',
  '## 14. 상수 표',
  '| `TOAST_MS` | 5000 |',
].join('\n');

/** 가짜 루트를 만든다. `docs`로 문서별 본문을 덮어쓴다. */
function mkRoot(docs = {}, extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ds-'));
  const sys = join(root, 'docs/design/system');
  mkdirSync(join(sys, 'adr'), { recursive: true });
  mkdirSync(join(root, 'docs/research'), { recursive: true });
  writeFileSync(join(root, 'docs/research/design-system.md'), '# 연구\n');
  for (const n of NAMES) writeFileSync(join(sys, `${n}.md`), docs[n] ?? (n === 'foundations' ? FOUNDATIONS : `# ${n}\n`));
  writeFileSync(join(sys, 'adr/0001-x.md'), '# 0001 x\n');
  for (const [p, t] of Object.entries(extra)) {
    mkdirSync(join(root, p, '..'), { recursive: true });
    writeFileSync(join(root, p), t);
  }
  return root;
}

test('저장소 문서 전수 대조가 0건이다', () => {
  assert.deepEqual(check(ROOT), []);
});

test('깨끗한 가짜 루트는 0건이다', () => {
  const root = mkRoot();
  try { assert.deepEqual(check(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('§13에 없는 토큰 이름을 잡는다', () => {
  const root = mkRoot({ components: '# c\n버튼은 `--fg-nowhere`를 쓴다.\n' });
  try {
    const p = check(root);
    assert.equal(p.length, 1);
    assert.match(p[0], /^components\.md:2: .*--fg-nowhere/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('없는 ADR 번호와 범위 밖 검사 번호를 잡는다', () => {
  const root = mkRoot({ patterns: '# p\nADR-0099를 본다.\nDT99 검사.\n' });
  try {
    const p = check(root).join('\n');
    assert.match(p, /없는 ADR-0099/);
    assert.match(p, /DT99 범위 밖/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('토큰 값이 §13과 다르면 잡는다', () => {
  const root = mkRoot({ components: '# c\n`--space-8` 9px 간격.\n' });
  try { assert.match(check(root).join('\n'), /토큰 값 불일치 --space-8: 문서 9, §13 8/); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('vocab.ts가 없으면 ICON_BUTTON_ICONS 비교를 건너뛴다', () => {
  const root = mkRoot();
  try { assert.deepEqual(check(root), []); } finally { rmSync(root, { recursive: true, force: true }); }
});

test('vocab.ts의 ICON_BUTTON_ICONS가 §9 표와 다르면 잡는다', () => {
  const VOCAB = 'app/src/lib/components/ui/vocab.ts';
  const ok = mkRoot({}, { [VOCAB]: "export const ICON_BUTTON_ICONS = ['x', 'settings'] as const;\n" });
  const bad = mkRoot({}, { [VOCAB]: "export const ICON_BUTTON_ICONS = ['x', 'eye'] as const;\n" });
  try {
    assert.deepEqual(check(ok), []);
    const p = check(bad).join('\n');
    assert.match(p, /ICON_BUTTON_ICONS에 없는 아이콘 settings/);
    assert.match(p, /§9 표에 없는 아이콘 eye/);
  } finally {
    rmSync(ok, { recursive: true, force: true });
    rmSync(bad, { recursive: true, force: true });
  }
});

test('CLI: 저장소는 종료 0, 문제가 있는 루트는 1', () => {
  const clean = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(clean.status, 0);
  assert.match(clean.stdout, /spec-check: 0 건/);
  const root = mkRoot({ components: '# c\nADR-0099\n' });
  try {
    const r = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /1 건/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
