#!/usr/bin/env node
// gate 자체 검사(docs/design/cicd.md §2 `selftest`). 임시 저장소에 이 저장소의 scripts/ci·설정·ci.yml을 복사하고
// 씨앗(깨끗한 것·위반)을 넣은 뒤, 그 사본의 진입점 `node <tmp>/scripts/ci/run.mjs <gate>`를 돌린다.
// 그래서 도구가 아니라 gates.mjs의 gate 정의(인자 포함)를 검사한다: 예를 들어 fmt에서 --check를 빼면 씨앗이
// 통과해 여기서 실패한다(씨앗으로 드러나지 않는 플래그는 run.test.mjs가 본다). 깨끗하면 0, 위반이면 0이 아닌 코드여야 한다.
// 씨앗 문자열은 실행 중에 조립한다(이 파일이 누출 검사에 걸리지 않게).
//
//   node scripts/ci/selftest.mjs
//
// 도구가 없으면 로컬은 그 줄을 건너뛰고(skip), CI(CI=true)는 실패로 센다. 모두 기대대로면 0, 아니면 1.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ROOT } from './gates.mjs';
import { inCI, which } from './run.mjs';

const NODE = process.execPath;
const CI_YML = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');

const tmp = mkdtempSync(join(tmpdir(), 'ci-selftest-'));
const results = [];

// 한 줄: gate 이름, 씨앗, 기대(0 | 'nonzero'), 실행 함수(종료 코드를 돌려준다), 필요한 도구
function expect(gate, seed, want, run, needs = []) {
  const missing = needs.filter((t) => !which(t));
  if (missing.length) {
    results.push({ gate, seed, want, got: `도구 없음: ${missing.join(',')}`, ok: !inCI() ? 'skip' : false });
    return;
  }
  let got;
  try {
    got = run();
  } catch (e) {
    got = `예외: ${e.message}`;
  }
  const ok = typeof got === 'number' && (want === 0 ? got === 0 : got !== 0);
  results.push({ gate, seed, want, got, ok });
}

const exec = (bin, args, cwd, env = process.env) => {
  const r = spawnSync(bin === 'node' ? NODE : (which(bin) ?? bin), args, { cwd, env, encoding: 'utf8', shell: false });
  if (r.error) throw r.error;
  if (r.status !== 0 && process.env.SELFTEST_VERBOSE) console.error(`${bin} ${args.join(' ')} →\n${r.stdout}${r.stderr}`);
  return r.status;
};

// 사본 저장소: scripts/ci 전체, 설정, ci.yml, 최소 Cargo 워크스페이스와 app 버전 파일. files로 덮어쓴다.
// git 저장소로 만들고 모두 add한다(scan은 인덱스, actionlint는 저장소 루트를 본다).
function mkRoot(name, files = {}) {
  const d = join(tmp, name);
  mkdirSync(d, { recursive: true });
  cpSync(join(ROOT, 'scripts/ci'), join(d, 'scripts/ci'), { recursive: true });
  for (const f of ['rust-toolchain.toml', 'zizmor.yml', '_typos.toml']) cpSync(join(ROOT, f), join(d, f));
  const base = {
    '.github/workflows/ci.yml': CI_YML,
    'Cargo.toml': '[workspace]\nresolver = "3"\nmembers = ["a"]\n\n[workspace.package]\nversion = "0.1.0"\nrust-version = "1.90"\n',
    'a/Cargo.toml': '[package]\nname = "a"\nversion.workspace = true\nedition = "2024"\n',
    'a/src/lib.rs': 'pub fn one() -> u32 {\n    1\n}\n',
    'app/package.json': JSON.stringify({ name: 'x', version: '0.1.0' }) + '\n',
    'app/src-tauri/tauri.conf.json': JSON.stringify({ version: '0.1.0' }) + '\n',
  };
  for (const [rel, text] of Object.entries({ ...base, ...files })) {
    if (text === null) continue;
    const p = join(d, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  exec('git', ['init', '-q'], d);
  exec('git', ['add', '-A'], d);
  return d;
}

// 사본의 진입점으로 gate를 돌린다. 사본의 ROOT는 사본 폴더다(gates.mjs가 자기 위치로 정한다).
const gate = (d, name, ...args) => exec('node', [join(d, 'scripts/ci/run.mjs'), name, ...args], d);

// ci.yml 한 군데를 바꾼 사본. 바꿀 곳이 없으면 예외(씨앗이 조용히 깨끗해지지 않게).
const ciWith = (from, to) => {
  if (!CI_YML.includes(from)) throw new Error(`ci.yml에 없음: ${from.slice(0, 40)}`);
  return { '.github/workflows/ci.yml': CI_YML.replace(from, to) };
};
const RUST_RUN = '        run: node scripts/ci/run.mjs rust\n';

// ---- scan ----
{
  expect('scan', '깨끗한 사본', 0, () => gate(mkRoot('scan-clean'), 'scan'), ['git']);
  const leak = 'https://h.example.invalid/a/hdntl=exp=' + '17000' + '00000' + '~acl=*/x\n';
  expect('scan', '서명 토큰', 'nonzero', () => gate(mkRoot('scan-leak', { 'leak.txt': leak }), 'scan'), ['git']);
  expect('scan-staged', '인덱스의 서명 토큰', 'nonzero', () => gate(mkRoot('staged-leak', { 'leak.txt': leak }), 'scan-staged'), ['git']);
}

// ---- fmt ----
{
  expect('fmt', '맞춘 .rs', 0, () => gate(mkRoot('fmt-clean'), 'fmt'), ['cargo', 'rustfmt']);
  const bad = { 'a/src/lib.rs': 'pub fn one()->u32{1}\n' };
  expect('fmt', '안 맞춘 .rs', 'nonzero', () => gate(mkRoot('fmt-bad', bad), 'fmt'), ['cargo', 'rustfmt']);
}

// ---- typos ----
{
  expect('typos', '오타 없음', 0, () => gate(mkRoot('typos-clean'), 'typos'), ['typos']);
  const bad = { 'note.md': 'the quick ' + 'te' + 'h fox\n' };
  expect('typos', '오타', 'nonzero', () => gate(mkRoot('typos-bad', bad), 'typos'), ['typos']);
}

// ---- workflows: pin-check → actionlint → zizmor. 씨앗마다 앞 단계는 통과하고 그 단계에서 걸리게 만든다 ----
{
  const W = ['actionlint', 'zizmor'];
  expect('workflows', '저장소 ci.yml 그대로', 0, () => gate(mkRoot('wf-clean'), 'workflows'), W);
  const pinLine = /uses: actions\/checkout@[0-9a-f]{40} # v[0-9.]+/.exec(CI_YML)[0];
  const seeds = [
    ['pin-check uses @v4', ciWith(pinLine, 'uses: actions/checkout@v' + '4')],
    ['pin-check persist-credentials 없음', ciWith('        with:\n          persist-credentials: false\n      # packageManager', '      # packageManager')],
    ['pin-check timeout 없음', ciWith('    timeout-minutes: 45\n', '')],
    ['actionlint 모르는 키', ciWith('    timeout-minutes: 45\n', '    timeout-minutes: 45\n    bogus-key: 1\n')],
    ['zizmor 과한 권한', ciWith('    permissions:\n      contents: read # checkout\n    steps:\n      # Windows 러너가 fixture·bindings', '    permissions: write-all\n    steps:\n      # Windows 러너가 fixture·bindings')],
    // --pedantic이 빠지는 것은 씨앗으로 드러나지 않아 run.test.mjs가 인자를 직접 본다
    ['zizmor run:에 needs 출력 전개', ciWith(RUST_RUN, '        run: echo "${{ needs.changes.outputs.code }}"\n')],
  ];
  seeds.forEach(([seed, files], i) => expect('workflows', seed, 'nonzero', () => gate(mkRoot(`wf-${i}`, files), 'workflows'), W));
}

// ---- parity ----
{
  expect('parity', '저장소 ci.yml 그대로', 0, () => gate(mkRoot('par-clean'), 'parity'));
  const tool = /tool: typos@([0-9.]+)/.exec(CI_YML);
  const seeds = [
    ['run:에 raw cargo', ciWith(RUST_RUN, '        run: cargo test --locked\n')],
    ['run.mjs 뒤 || true', ciWith(RUST_RUN, '        run: node scripts/ci/run.mjs rust || true\n')],
    ['continue-on-error', ciWith('      - name: fmt\n', '      - name: fmt\n        continue-on-error: true\n')],
    ['run.mjs 단계 if: false', ciWith('      - name: fmt\n        if: ${{ !cancelled() }}\n', '      - name: fmt\n        if: false\n')],
    ['tool: 버전 불일치', ciWith(tool[0], 'tool: typos@0.0.1')],
    ['fallback: none 없음', ciWith('          fallback: none\n', '')],
    ['ci-ok needs에서 작업 빠짐', ciWith(', tauri]', ']')],
    ['ci-ok guard 바뀜', ciWith('        run: exit 1\n', '        run: exit 0\n')],
    ['ci-ok 없음', { '.github/workflows/ci.yml': CI_YML.slice(0, CI_YML.indexOf('  # 필수 체크는 이 작업 하나다')) }],
    ['훅이 run.mjs를 거치지 않음', { '.githooks/pre-commit': '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/public-scan.mjs" --staged\n' }],
  ];
  seeds.forEach(([seed, files], i) => expect('parity', seed, 'nonzero', () => gate(mkRoot(`par-${i}`, files), 'parity')));
}

// ---- versions ----
{
  const C = ['cargo'];
  const same = mkRoot('ver-same');
  expect('versions', '모두 같음', 0, () => gate(same, 'versions'), C);
  expect('versions', '모두 같음 + 같은 태그', 0, () => gate(same, 'versions', '--tag', 'v0.1.0'), C);
  const conf = { 'app/src-tauri/tauri.conf.json': JSON.stringify({ version: '0.2.0' }) };
  expect('versions', 'tauri.conf.json만 다름', 'nonzero', () => gate(mkRoot('ver-conf', conf), 'versions'), C);
  const pkg = { 'app/package.json': JSON.stringify({ name: 'x', version: '0.1.1' }) };
  expect('versions', 'package.json만 다름', 'nonzero', () => gate(mkRoot('ver-pkg', pkg), 'versions'), C);
  expect('versions', '태그 다름', 'nonzero', () => gate(same, 'versions', '--tag', 'v0.1.1'), C);
}

// ---- ci-ok ----
{
  const ciok = (needs, event = 'pull_request') =>
    exec('node', [join(ROOT, 'scripts/ci/run.mjs'), 'ci-ok'], ROOT, {
      ...process.env,
      NEEDS: JSON.stringify(needs),
      EVENT: event,
      GITHUB_STEP_SUMMARY: '',
    });
  const ok = { result: 'success', outputs: {} };
  const changes = (code) => ({ result: 'success', outputs: { code: String(code) } });
  const skipped = { result: 'skipped' };
  expect('ci-ok', '모두 success', 0, () => ciok({ changes: changes(true), lint: ok, rust: ok }));
  expect('ci-ok', '작업 하나 failure', 'nonzero', () => ciok({ changes: changes(true), lint: ok, rust: { result: 'failure' } }));
  expect('ci-ok', '작업 하나 cancelled', 'nonzero', () => ciok({ changes: changes(true), lint: { result: 'cancelled' } }));
  expect('ci-ok', 'PR 문서만: 무거운 작업 skipped', 0, () => ciok({ changes: changes(false), lint: ok, rust: skipped }));
  expect('ci-ok', 'push인데 skipped', 'nonzero', () => ciok({ changes: changes(false), lint: ok, rust: skipped }, 'push'));
  expect('ci-ok', 'dispatch인데 skipped', 'nonzero', () => ciok({ changes: changes(false), lint: ok, rust: skipped }, 'workflow_dispatch'));
  expect('ci-ok', '코드 변경인데 skipped', 'nonzero', () => ciok({ changes: changes(true), lint: ok, rust: skipped }));
  expect('ci-ok', 'lint skipped', 'nonzero', () => ciok({ changes: changes(false), lint: skipped }));
}

rmSync(tmp, { recursive: true, force: true });

let bad = 0;
for (const r of results) {
  const mark = r.ok === true ? 'ok  ' : r.ok === 'skip' ? 'skip' : 'FAIL';
  if (r.ok === false) bad++;
  console.log(`${mark} ${r.gate.padEnd(10)} ${r.seed.padEnd(34)} 기대 ${String(r.want).padEnd(8)} 결과 ${r.got}`);
}
console.log(bad ? `\nselftest: ${bad}개가 기대와 다르다` : `\nselftest: ${results.length}개 모두 기대대로`);
process.exit(bad ? 1 : 0);
