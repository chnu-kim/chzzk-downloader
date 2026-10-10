// node --test scripts/ci/artifact-check.test.mjs — glibc-floor·release-hygiene 판정(docs/design/cicd.md §2)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { E2E_MARK, GALLERY_MARK, GLIBC_MAX, e2eFeatureLines, galleryTraces, glibcOk, maxGlibc, scanSources, sourceFiles } from './artifact-check.mjs';
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

// ---- 소스 훑기(DX14~16) ----
const f = (path, text) => [{ path, text }];
const BUILDER = 'let h = keepawake::Builder::default().idle(true).display(false).sleep(false).create();';

test('scanSources: 깨끗한 소스는 위반 0', () => {
  assert.deepEqual(scanSources(f('crates/shell/src/app.rs', 'fn main() { println!("hi"); }')), []);
  assert.deepEqual(scanSources(f('crates/shell/src/power.rs', BUILDER)), []);
  assert.deepEqual(scanSources(f('app/src-tauri/src/power/mod.rs', BUILDER)), []);
  // set_var가 다른 변수면 통과
  assert.deepEqual(scanSources(f('app/src-tauri/src/lib.rs', 'unsafe { std::env::set_var("RUST_LOG", "info") };')), []);
});

test('scanSources DX14: 금지 글자 여섯 개는 각각 위반', () => {
  for (const w of ['PreventSystem' + 'Sleep', 'ES_AWAYMODE_' + 'REQUIRED', 'ES_DISPLAY_' + 'REQUIRED', 'PreventUserIdleDisplay' + 'Sleep', 'handle-lid-' + 'switch', 'disable' + 'sleep']) {
    const r = scanSources(f('crates/shell/src/power.rs', `// ${w}\n`));
    assert.equal(r.length, 1, w);
    assert.match(r[0], /^DX14 .*:1 /);
  }
});

test('scanSources DX14: keepawake 빌더는 display(false)·sleep(false)가 둘 다 있어야 한다', () => {
  assert.match(scanSources(f('crates/shell/src/power.rs', 'keepawake::Builder::default().idle(true).sleep(false)'))[0], /display\(false\)/);
  assert.match(scanSources(f('crates/shell/src/power.rs', 'keepawake::Builder::default().idle(true).display(false)'))[0], /sleep\(false\)/);
  assert.equal(scanSources(f('crates/shell/src/power.rs', 'keepawake::Builder::default()')).length, 2);
});

test('scanSources DX15: 전원 심볼은 power 모듈 밖이면 위반', () => {
  for (const sym of ['keep' + 'awake', 'IOPM' + 'Assertion', 'SetThreadExecution' + 'State', 'PowerCreate' + 'Request', 'beginActivityWith' + 'Options', 'org.freedesktop.' + 'login1']) {
    assert.equal(scanSources(f('crates/shell/src/manager.rs', `use ${sym};`)).filter((v) => v.startsWith('DX15')).length, 1, sym);
    assert.deepEqual(scanSources(f('crates/shell/src/power.rs', `use ${sym};`)).filter((v) => v.startsWith('DX15')), []);
    assert.deepEqual(scanSources(f('app/src-tauri/src/power.rs', `use ${sym};`)).filter((v) => v.startsWith('DX15')), []);
  }
  assert.equal(scanSources(f('app/src-tauri/src/lib.rs', 'x::SetThreadExecution' + 'State(1)')).length, 1);
});

test('scanSources DX16: WebKit·NVIDIA 환경 변수를 set_var로 켜면 위반', () => {
  const same = 'unsafe { std::env::set_var("WEBKIT_DISABLE_' + 'DMABUF_RENDERER", "1") };';
  const multi = 'unsafe {\n  std::env::set_var(\n    "__NV_DISABLE_' + 'EXPLICIT_SYNC",\n    "1",\n  )\n}';
  const bare = 'std::env::set_var(WEBKIT_DISABLE_' + 'COMPOSITING_MODE, "1");';
  for (const t of [same, multi, bare]) {
    const r = scanSources(f('app/src-tauri/src/lib.rs', t));
    assert.equal(r.length >= 1 && r.every((v) => v.startsWith('DX16')), true, t);
  }
  // 읽기만 하는 코드·문서 주석은 통과
  assert.deepEqual(scanSources(f('app/src-tauri/src/lib.rs', 'let v = std::env::var("WEBKIT_DISABLE_' + 'DMABUF_RENDERER");')), []);
});

test('sourceFiles: 실제 저장소 소스는 위반 0(가드가 현재 트리에서 통과한다)', () => {
  const files = sourceFiles(ROOT);
  assert.ok(files.length > 10);
  assert.deepEqual(scanSources(files), []);
});
