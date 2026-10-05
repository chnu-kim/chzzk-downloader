#!/usr/bin/env node
// gate 자체 검사(docs/design/cicd.md §2 `selftest`). 임시 폴더에 씨앗(깨끗한 것·위반)을 만들고
// gate가 쓰는 같은 도구를 돌려 깨끗하면 0, 위반이면 0이 아닌 코드를 내는지 본다. 검사기가 조용히 망가져
// 무엇이든 통과시키는 것을 막는다. 씨앗 문자열은 실행 중에 조립한다(이 파일이 누출 검사에 걸리지 않게).
//
//   node scripts/ci/selftest.mjs
//
// 도구가 없으면 로컬은 그 줄을 건너뛰고(skip), CI(CI=true)는 실패로 센다. 모두 기대대로면 0, 아니면 1.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';
import { inCI, which } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
const SHA = 'a'.repeat(8) + 'b'.repeat(8) + 'c'.repeat(8) + 'd'.repeat(8) + 'e'.repeat(8);

const tmp = mkdtempSync(join(tmpdir(), 'ci-selftest-'));
const results = [];

function write(rel, text) {
  const p = join(tmp, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text);
  return p;
}

function sub(name) {
  const d = join(tmp, name);
  mkdirSync(d, { recursive: true });
  return d;
}

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

const exec = (bin, args, cwd = ROOT, env = process.env) => {
  const r = spawnSync(bin === 'node' ? NODE : which(bin) ?? bin, args, { cwd, env, encoding: 'utf8', shell: false });
  if (r.error) throw r.error;
  return r.status;
};

// ---- scan: 누출 검사기 ----
{
  const repo = sub('scan');
  exec('git', ['init', '-q'], repo);
  write('scan/clean.txt', 'hello\n');
  exec('git', ['add', '.'], repo);
  expect('scan', '깨끗한 파일', 0, () => exec('node', [join(HERE, 'public-scan.mjs')], repo), ['git']);
  write('scan/leak.txt', 'https://h.example.invalid/a/hdntl=exp=' + '17000' + '00000' + '~acl=*/x\n');
  exec('git', ['add', '.'], repo);
  expect('scan', '서명 토큰', 'nonzero', () => exec('node', [join(HERE, 'public-scan.mjs')], repo), ['git']);
}

// ---- fmt: rustfmt(cargo fmt가 부르는 것) ----
{
  const good = write('fmt/good.rs', 'fn main() {\n    let x = 1;\n    println!("{x}");\n}\n');
  const bad = write('fmt/bad.rs', 'fn main(){let x=1;println!("{x}");}\n');
  const fmt = (f) => exec('rustfmt', ['--check', '--edition', '2024', f]);
  expect('fmt', '맞춘 .rs', 0, () => fmt(good), ['rustfmt']);
  expect('fmt', '안 맞춘 .rs', 'nonzero', () => fmt(bad), ['rustfmt']);
}

// ---- typos ----
{
  const d = sub('typos');
  write('typos/good.md', 'the quick brown fox\n');
  write('typos/bad.md', 'the quick ' + 'te' + 'h fox\n');
  expect('typos', '오타 없음', 0, () => exec('typos', ['good.md'], d), ['typos']);
  expect('typos', '오타', 'nonzero', () => exec('typos', ['bad.md'], d), ['typos']);
}

// ---- workflows: pin-check · actionlint · zizmor ----
const CLEAN_WF = `name: seed
on:
  push:
    branches: [master]
permissions: {}
concurrency:
  group: seed-\${{ github.ref }}
  cancel-in-progress: true
jobs:
  seed:
    name: seed
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      contents: read # checkout
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
      - name: hello
        run: node scripts/ci/run.mjs list
`;
{
  const clean = sub('wf-clean');
  write('wf-clean/.github/workflows/seed.yml', CLEAN_WF);
  const unpinned = sub('wf-unpinned');
  write('wf-unpinned/.github/workflows/seed.yml', CLEAN_WF.replace(`@${SHA} # v7.0.1`, '@v' + '4'));
  const creds = sub('wf-creds');
  write('wf-creds/.github/workflows/seed.yml', CLEAN_WF.replace('        with:\n          persist-credentials: false\n', ''));
  const noTimeout = sub('wf-timeout');
  write('wf-timeout/.github/workflows/seed.yml', CLEAN_WF.replace('    timeout-minutes: 5\n', ''));
  const pin = (d) => exec('node', [join(HERE, 'pin-check.mjs'), '--root', d]);
  expect('workflows', 'pin-check 깨끗함', 0, () => pin(clean));
  expect('workflows', 'pin-check uses @v4', 'nonzero', () => pin(unpinned));
  expect('workflows', 'pin-check persist-credentials 없음', 'nonzero', () => pin(creds));
  expect('workflows', 'pin-check timeout 없음', 'nonzero', () => pin(noTimeout));

  const wf = join(clean, '.github/workflows/seed.yml');
  const broken = write('wf-broken/seed.yml', CLEAN_WF.replace('    timeout-minutes: 5\n', '    timeout-minutes: 5\n    bogus-key: 1\n'));
  expect('workflows', 'actionlint 깨끗함', 0, () => exec('actionlint', [wf]), ['actionlint']);
  expect('workflows', 'actionlint 모르는 키', 'nonzero', () => exec('actionlint', [broken]), ['actionlint']);

  const inject = write(
    'wf-inject/.github/workflows/seed.yml',
    CLEAN_WF.replace('run: node scripts/ci/run.mjs list', 'run: echo "${{ github.event.head_commit.message }}"'),
  );
  const zz = (f) => exec('zizmor', ['--offline', '--pedantic', '--config', join(ROOT, 'zizmor.yml'), f]);
  expect('workflows', 'zizmor 깨끗함', 0, () => zz(wf), ['zizmor']);
  expect('workflows', 'zizmor 템플릿 주입', 'nonzero', () => zz(inject), ['zizmor']);
}

// ---- parity ----
{
  const mk = (name, wf) => {
    const d = sub(name);
    cpSync(join(HERE, 'tools.json'), join(d, 'scripts/ci/tools.json'), { recursive: true });
    write(`${name}/.github/workflows/ci.yml`, wf);
    return d;
  };
  const withCiOk = (s) =>
    s +
    `  ci-ok:
    name: ci-ok
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - run: node scripts/ci/run.mjs ci-ok
`;
  const par = (d) => exec('node', [join(HERE, 'parity.mjs'), '--root', d]);
  expect('parity', '깨끗함', 0, () => par(mk('par-clean', withCiOk(CLEAN_WF))));
  expect(
    'parity',
    'run:에 raw cargo',
    'nonzero',
    () => par(mk('par-raw', withCiOk(CLEAN_WF.replace('run: node scripts/ci/run.mjs list', 'run: cargo test --locked')))),
  );
  expect(
    'parity',
    'tool: 버전 불일치',
    'nonzero',
    () =>
      par(
        mk(
          'par-tool',
          withCiOk(
            CLEAN_WF.replace(
              '      - name: hello\n',
              `      - uses: taiki-e/install-action@${SHA} # v2.0.0\n        with:\n          tool: typos@0.0.1\n      - name: hello\n`,
            ),
          ),
        ),
      ),
  );
  expect('parity', 'ci-ok 없음', 'nonzero', () => par(mk('par-nociok', CLEAN_WF)));
}

// ---- versions ----
{
  const mk = (name, { crate = '0.1.0', conf = '0.1.0', pkg = '0.1.0' }) => {
    const d = sub(name);
    write(`${name}/Cargo.toml`, `[workspace]\nresolver = "3"\nmembers = ["a"]\n\n[workspace.package]\nversion = "${crate}"\n`);
    write(`${name}/a/Cargo.toml`, '[package]\nname = "a"\nversion.workspace = true\nedition = "2024"\n');
    write(`${name}/a/src/lib.rs`, '');
    write(`${name}/app/package.json`, JSON.stringify({ name: 'x', version: pkg }));
    write(`${name}/app/src-tauri/tauri.conf.json`, JSON.stringify({ version: conf }));
    return d;
  };
  const vc = (d, ...extra) => exec('node', [join(HERE, 'version-check.mjs'), '--root', d, ...extra]);
  const same = mk('ver-same', {});
  expect('versions', '모두 같음', 0, () => vc(same), ['cargo']);
  expect('versions', '모두 같음 + 같은 태그', 0, () => vc(same, '--tag', 'v0.1.0'), ['cargo']);
  expect('versions', 'tauri.conf.json만 다름', 'nonzero', () => vc(mk('ver-conf', { conf: '0.2.0' })), ['cargo']);
  expect('versions', 'package.json만 다름', 'nonzero', () => vc(mk('ver-pkg', { pkg: '0.1.1' })), ['cargo']);
  expect('versions', '태그 다름', 'nonzero', () => vc(same, '--tag', 'v0.1.1'), ['cargo']);
}

// ---- ci-ok ----
{
  const ciok = (needs) =>
    exec('node', [join(HERE, 'run.mjs'), 'ci-ok'], ROOT, { ...process.env, NEEDS: JSON.stringify(needs), GITHUB_STEP_SUMMARY: '' });
  const ok = { result: 'success', outputs: {} };
  const changes = (code) => ({ result: 'success', outputs: { code: String(code) } });
  expect('ci-ok', '모두 success', 0, () => ciok({ changes: changes(true), lint: ok, rust: ok }));
  expect('ci-ok', '작업 하나 failure', 'nonzero', () => ciok({ changes: changes(true), lint: ok, rust: { result: 'failure' } }));
  expect('ci-ok', '작업 하나 cancelled', 'nonzero', () => ciok({ changes: changes(true), lint: { result: 'cancelled' } }));
  expect('ci-ok', '문서만: 무거운 작업 skipped', 0, () => ciok({ changes: changes(false), lint: ok, rust: { result: 'skipped' } }));
  expect('ci-ok', '코드 변경인데 skipped', 'nonzero', () => ciok({ changes: changes(true), lint: ok, rust: { result: 'skipped' } }));
  expect('ci-ok', 'lint skipped', 'nonzero', () => ciok({ changes: changes(false), lint: { result: 'skipped' } }));
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
