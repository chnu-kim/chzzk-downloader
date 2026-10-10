// node --test scripts/ci/artifact-check.test.mjs — glibc-floor·release-hygiene 판정(docs/design/cicd.md §2)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { E2E_MARK, GALLERY_MARK, GLIBC_MAX, e2eFeatureLines, galleryTraces, glibcOk, maxGlibc } from './artifact-check.mjs';
import { ROOT } from './gates.mjs';

const OBJDUMP = `
target/release/chzzk-app:     file format elf64-x86-64

DYNAMIC SYMBOL TABLE:
0000000000000000      DF *UND*	0000000000000000 (GLIBC_2.2.5) free
0000000000000000      DF *UND*	0000000000000000 (GLIBC_2.34) __libc_start_main
0000000000000000      DF *UND*	0000000000000000 (GLIBC_2.9) pipe2
0000000000000000  w   DF *UND*	0000000000000000 (GLIBC_2.32) gnu_get_libc_version
0000000000000000      DF *UND*	0000000000000000 (GLIBCXX_3.4.30) _ZSt...
`;

test('maxGlibc: 버전을 수로 비교한다(2.9 < 2.34)', () => {
  assert.equal(maxGlibc(OBJDUMP), '2.34');
  assert.equal(maxGlibc('no symbols'), null);
  assert.equal(maxGlibc(OBJDUMP + '(GLIBC_2.39) x\n'), '2.39');
});

test('glibcOk: 한도 이하만 통과, 기호가 없으면 실패', () => {
  assert.equal(GLIBC_MAX, '2.35');
  assert.equal(glibcOk('2.34', '2.35'), true);
  assert.equal(glibcOk('2.35', '2.35'), true);
  assert.equal(glibcOk('2.36', '2.35'), false);
  assert.equal(glibcOk('2.4', '2.35'), true);
  assert.equal(glibcOk(null, '2.35'), false);
});

test('e2eFeatureLines: 이 워크스페이스 crate의 e2e feature만', () => {
  const tree = ['chzzk-app v0.1.0', '├── chzzk-core feature "default"', '│   └── chzzk-app feature "e2e"', '└── somecrate feature "e2e"'].join('\n');
  assert.deepEqual(e2eFeatureLines(tree), ['│   └── chzzk-app feature "e2e"']);
  assert.deepEqual(e2eFeatureLines('chzzk-app v0.1.0\n├── chzzk-core feature "default"'), []);
  assert.equal(E2E_MARK, 'CHZZK_' + 'E2E_');
});

test('galleryTraces: 릴리스 dist의 갤러리 흔적(이름·표식)을 찾는다', () => {
  const d = mkdtempSync(join(tmpdir(), 'dist-'));
  try {
    mkdirSync(join(d, 'assets'));
    writeFileSync(join(d, 'index.html'), '<div id="app"></div>');
    writeFileSync(join(d, 'assets', 'index-abc.js'), 'console.log(1)');
    assert.deepEqual(galleryTraces(d), []);
    writeFileSync(join(d, 'gallery.html'), '<div id="gallery"></div>');
    writeFileSync(join(d, 'assets', 'app-x.js'), `const m="${GALLERY_MARK}"`);
    assert.deepEqual(galleryTraces(d), ['assets/app-x.js', 'gallery.html']);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('GALLERY_MARK는 갤러리 진입점의 표식과 같은 글자다(조각을 이어 쓴다)', () => {
  const src = readFileSync(join(ROOT, 'app/src/gallery/main.ts'), 'utf8');
  const m = /GALLERY_MARK\s*=\s*'([^']*)'\s*\+\s*'([^']*)'/.exec(src);
  assert.ok(m, 'app/src/gallery/main.ts에 GALLERY_MARK가 없다');
  assert.equal(m[1] + m[2], GALLERY_MARK);
});
