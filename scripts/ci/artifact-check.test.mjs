// node --test scripts/ci/artifact-check.test.mjs — glibc-floor·release-hygiene 판정(docs/design/cicd.md §2)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { E2E_MARK, GLIBC_MAX, e2eFeatureLines, glibcOk, maxGlibc } from './artifact-check.mjs';

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
