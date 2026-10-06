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
import { hashCommit } from './public-scan.mjs';
import { PRIVATE_URL } from './push-guard.mjs';
import { inCI, which } from './run.mjs';
import { osKey } from './smoke.mjs';
import { gitEnv, gitOk } from './test-git.mjs';

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

const exec = (bin, args, cwd, env = process.env, input = undefined) => {
  const r = spawnSync(bin === 'node' ? NODE : (which(bin) ?? bin), args, { cwd, env, encoding: 'utf8', shell: false, input });
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
  cpSync(join(ROOT, '.githooks'), join(d, '.githooks'), { recursive: true }); // 모드(실행 비트)를 유지한다
  for (const f of ['rust-toolchain.toml', 'zizmor.yml', '_typos.toml']) cpSync(join(ROOT, f), join(d, f));
  for (const dir of ['ci', 'release']) cpSync(join(ROOT, dir), join(d, dir), { recursive: true });
  const base = {
    '.github/workflows/ci.yml': CI_YML,
    'Cargo.toml': '[workspace]\nresolver = "3"\nmembers = ["a"]\n\n[workspace.package]\nversion = "0.1.0"\nrust-version = "1.90"\n',
    'a/Cargo.toml': '[package]\nname = "a"\nversion.workspace = true\nedition = "2024"\n',
    'a/src/lib.rs': 'pub fn one() -> u32 {\n    1\n}\n',
    'app/package.json': JSON.stringify({ name: 'x', version: '0.1.0' }) + '\n',
    // 사본도 pubkey gate를 통과해야 한다(훅 씨앗이 release/·tauri.conf.json을 함께 스테이징한다)
    'app/src-tauri/tauri.conf.json': JSON.stringify({ version: '0.1.0', plugins: { updater: { pubkey: readFileSync(join(ROOT, 'release/updater.pub'), 'utf8') } } }) + '\n',
  };
  for (const [rel, text] of Object.entries({ ...base, ...files })) {
    if (text === null) continue;
    const p = join(d, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  gitOk(d, ['init', '-q']);
  gitOk(d, ['add', '-A']);
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
const HOOK = (name) => `#!/bin/sh\nset -eu\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" hook ${name} "$@"\n`;
// 사본의 진입점으로 훅을 돌린다(.githooks/<이름>이 exec하는 것과 같은 명령). 격리된 git 환경을 쓴다.
const hook = (d, name, args, input) => exec('node', [join(d, 'scripts/ci/run.mjs'), 'hook', name, ...args], d, gitEnv({ extra: { CHZZK_HOOK_FAST: '1' } }), input);

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
    ['ci-ok needs에서 작업 빠짐', ciWith(', bundle]', ']')],
    // Worker(worker.md §13.3): ci-ok needs·guard 둘 다에 있어야 한다(parity가 CODE_GATED_JOBS로 guard 식을 만든다)
    ['ci-ok needs에서 worker 빠짐', ciWith(', frontend, worker, tauri-clippy', ', frontend, tauri-clippy')],
    ['ci-ok guard에서 worker 빠짐', ciWith(" || needs.worker.result == 'skipped'", '')],
    ['worker 작업이 CODE_IF 없이 늘 돎', ciWith("  worker:\n    name: worker\n    needs: changes\n    if: needs.changes.outputs.code == 'true'\n", '  worker:\n    name: worker\n    needs: changes\n')],
    ['bundle 작업이 PR에서도 돎', ciWith("  bundle:\n    name: bundle (${{ matrix.os }})\n    needs: changes\n    if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'\n", "  bundle:\n    name: bundle (${{ matrix.os }})\n    needs: changes\n    if: needs.changes.outputs.code == 'true'\n")],
    ['report가 ci-ok 뒤가 아님', ciWith('    needs: [ci-ok, e2e-web, e2e-native, e2e-native-windows, worker-e2e]\n', '    needs: [changes, e2e-web, e2e-native, e2e-native-windows, worker-e2e]\n')],
    ['관찰 작업(e2e-native)이 report needs에 없음', ciWith('    needs: [ci-ok, e2e-web, e2e-native, e2e-native-windows, worker-e2e]\n', '    needs: [ci-ok, e2e-web, e2e-native-windows, worker-e2e]\n')],
    ['관찰 작업(e2e-native-windows)이 report needs에 없음', ciWith('    needs: [ci-ok, e2e-web, e2e-native, e2e-native-windows, worker-e2e]\n', '    needs: [ci-ok, e2e-web, e2e-native, worker-e2e]\n')],
    ['관찰 작업(worker-e2e)이 report needs에 없음', ciWith('    needs: [ci-ok, e2e-web, e2e-native, e2e-native-windows, worker-e2e]\n', '    needs: [ci-ok, e2e-web, e2e-native, e2e-native-windows]\n')],
    ['관찰 중인 e2e-native-windows를 ci-ok needs에 넣음(OBSERVED_JOBS와 다름)', ciWith(', smoke-install-linux, bundle]', ', smoke-install-linux, bundle, e2e-native-windows]')],
    ['관찰 중인 e2e-web을 ci-ok needs에 넣음(OBSERVED_JOBS와 다름)', ciWith(', smoke-install-linux, bundle]', ', smoke-install-linux, bundle, e2e-web]')],
    ['관찰 중인 worker-e2e를 ci-ok needs에 넣음(OBSERVED_JOBS와 다름)', ciWith(', smoke-install-linux, bundle]', ', smoke-install-linux, bundle, worker-e2e]')],
    ['ci-ok guard 바뀜', ciWith('        run: exit 1\n', '        run: exit 0\n')],
    ['ci-ok 없음', { '.github/workflows/ci.yml': CI_YML.slice(0, CI_YML.indexOf('  # 필수 체크는 이 작업 하나다')) }],
    ['훅이 run.mjs를 거치지 않음', { '.githooks/pre-commit': '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/public-scan.mjs" --staged\n' }],
    ['훅이 gate를 직접 부름', { '.githooks/pre-push': '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" push-guard "$@"\n' }],
    ['훅 이름이 파일과 다름', { '.githooks/pre-push': HOOK('pre-commit') }],
    ['훅 gate의 CI 짝이 ci.yml에 없음', { '.github/workflows/ci.yml': CI_YML.replace('        run: node scripts/ci/run.mjs scan-history\n', '        run: node scripts/ci/run.mjs list\n') }],
  ];
  seeds.forEach(([seed, files], i) => expect('parity', seed, 'nonzero', () => gate(mkRoot(`par-${i}`, files), 'parity')));
}

// ---- parity: nightly.yml(리뷰 G4: 겹치는 체크 이름, cron과 어긋난 조건식, 손으로 나열한 PR 경로) ----
{
  const NIGHTLY = readFileSync(join(ROOT, '.github/workflows/nightly.yml'), 'utf8');
  const nightlyWith = (from, to) => {
    if (!NIGHTLY.includes(from)) throw new Error(`nightly.yml에 없음: ${from.slice(0, 40)}`);
    return { '.github/workflows/nightly.yml': NIGHTLY.replace(from, to) };
  };
  expect('parity', '저장소 ci.yml + nightly.yml 그대로', 0, () => gate(mkRoot('par-n-clean', { '.github/workflows/nightly.yml': NIGHTLY }), 'parity'));
  const seeds = [
    ['nightly 작업 이름이 ci.yml e2e-native와 같음', nightlyWith('name: nightly e2e-native (linux)', 'name: e2e-native (linux)')],
    ['nightly 작업 이름이 ci.yml e2e-native-windows와 같음', nightlyWith('name: nightly e2e-native (windows)', 'name: e2e-native (windows)')],
    ['weekly cron을 바꾸고 조건식은 그대로', nightlyWith('- cron: "47 18 * * 0"', '- cron: "50 18 * * 0"')],
    // nightly.yml에는 PR 트리거가 없다(구현 중 변경 78). 다시 더하면서 경로를 손으로 나열하면 pr-paths가 거부한다
    ['nightly PR 트리거가 paths: 나열', nightlyWith('on:\n  schedule:\n', 'on:\n  pull_request:\n    paths:\n      - crates/**\n  schedule:\n')],
  ];
  seeds.forEach(([seed, files], i) => expect('parity', seed, 'nonzero', () => gate(mkRoot(`par-n-${i}`, files), 'parity')));
}

// ---- 훅: commit-msg·pre-commit ----
{
  const d = mkRoot('hook-msg');
  const msg = (name, text) => {
    const f = join(d, name);
    writeFileSync(f, text);
    return f;
  };
  expect('scan-msg', '형식 맞는 메시지', 0, () => hook(d, 'commit-msg', [msg('m0', 'feat: 기능\n\n# 주석\n')]));
  expect('scan-msg', '제목 형식 틀림', 'nonzero', () => hook(d, 'commit-msg', [msg('m1', 'Add feature\n')]));
  const hexId = 'ab'.repeat(16);
  expect('scan-msg', '메시지의 실제 ID', 'nonzero', () => hook(d, 'commit-msg', [msg('m2', `fix: 고침\n\nid ${hexId}\n`)]));
  // -m·--cleanup=verbatim이면 # 줄도 이력에 남는다
  expect('scan-msg', '# 줄의 실제 ID', 'nonzero', () => hook(d, 'commit-msg', [msg('m3', `fix: 고침\n\n# id ${hexId}\n`)]));
  expect('pre-commit', '깨끗한 인덱스', 0, () => hook(mkRoot('hook-pc-clean'), 'pre-commit', []));
  const leak = 'https://h.example.invalid/a/hdntl=exp=' + '17000' + '00000' + '~acl=*/x\n';
  expect('pre-commit', '인덱스의 서명 토큰', 'nonzero', () => hook(mkRoot('hook-pc-leak', { 'leak.txt': leak }), 'pre-commit', []));
  // 조건부 gate는 작업 트리가 아니라 인덱스에서 돈다: 인덱스에는 틀린 훅, 작업 트리는 원래대로 → parity가 걸려야 한다
  {
    const pc = mkRoot('hook-pc-index');
    const good = readFileSync(join(pc, '.githooks/pre-push'), 'utf8');
    writeFileSync(join(pc, '.githooks/pre-push'), '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" push-guard "$@"\n');
    gitOk(pc, ['add', '.githooks/pre-push']);
    writeFileSync(join(pc, '.githooks/pre-push'), good);
    expect('pre-commit', '인덱스만 틀린 훅(작업 트리는 맞음)', 'nonzero', () => hook(pc, 'pre-commit', []));
    // 반대: 인덱스는 맞고 작업 트리만 틀리면 통과
    const pc2 = mkRoot('hook-pc-index2');
    writeFileSync(join(pc2, '.githooks/pre-push'), '#!/bin/sh\nexec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" push-guard "$@"\n');
    expect('pre-commit', '작업 트리만 틀린 훅(인덱스는 맞음)', 0, () => hook(pc2, 'pre-commit', []));
  }
}

// ---- 훅: pre-push(push-guard → scan-range). 가짜 origin·private(같은 루트) ----
{
  const d = mkRoot('hook-push');
  const origin = join(tmp, 'hook-push-origin.git');
  const priv = join(tmp, `${PRIVATE_URL}.git`);
  const g = (...a) => gitOk(d, a);
  g('commit', '-q', '-m', 'chore: 루트');
  gitOk(tmp, ['init', '-q', '--bare', origin]);
  gitOk(tmp, ['init', '-q', '--bare', priv]);
  g('remote', 'add', 'origin', origin);
  g('remote', 'add', 'private', priv);
  g('push', '-q', 'origin', 'HEAD:refs/heads/master');
  g('checkout', '-q', '-b', 'pv');
  writeFileSync(join(d, 'research.txt'), 'private\n');
  g('add', 'research.txt');
  g('commit', '-q', '-m', 'docs: 비공개');
  g('push', '-q', 'private', 'pv:refs/heads/master');
  // 사본의 지문 목록은 이 임시 저장소의 비공개 커밋으로 바꾼다(저장소의 실제 목록은 여기 커밋을 모른다)
  const fpFile = join(d, 'scripts/ci/private-commits.txt');
  writeFileSync(fpFile, hashCommit(g('rev-parse', 'HEAD')) + '\n');
  g('fetch', '-q', 'origin');
  g('fetch', '-q', 'private');
  const Z = '0'.repeat(40);
  const branch = (name, file, text, mergePrivate = false) => {
    g('checkout', '-q', '-b', name, 'origin/master');
    if (mergePrivate) g('merge', '-q', '--no-ff', '-m', 'Merge private', 'private/master');
    else {
      writeFileSync(join(d, file), text);
      g('add', file);
      g('commit', '-q', '-m', `feat: ${name}`);
    }
    return `refs/heads/${name} ${g('rev-parse', 'HEAD')} refs/heads/${name} ${Z}\n`;
  };
  const clean = branch('clean', 'f.txt', 'ok\n');
  const merged = branch('merged', '', '', true);
  const leaky = branch('leaky', 'leak.txt', 'https://h.example.invalid/a/hdntl=exp=' + '17000' + '00000' + '~acl=*/x\n');
  const pm = g('rev-parse', 'private/master');
  expect('pre-push', '정상 공개 브랜치', 0, () => hook(d, 'pre-push', ['origin', origin], clean));
  expect('pre-push', '비공개 커밋 merge', 'nonzero', () => hook(d, 'pre-push', ['origin', origin], merged));
  expect('pre-push', 'private/master:refs/heads/x', 'nonzero', () => hook(d, 'pre-push', ['origin', origin], `refs/remotes/private/master ${pm} refs/heads/x ${Z}\n`));
  expect('pre-push', '새 커밋 blob의 서명 토큰', 'nonzero', () => hook(d, 'pre-push', ['origin', origin], leaky));
  expect('pre-push', 'private 원격으로', 0, () => hook(d, 'pre-push', ['private', priv], merged));
  // 지문 목록이 낡으면(로컬 P에 목록 밖 커밋) 정상 브랜치도 거부한다. 끝나면 되돌린다
  const fpText = readFileSync(fpFile, 'utf8');
  writeFileSync(fpFile, '');
  expect('pre-push', '지문 목록 낡음', 'nonzero', () => hook(d, 'pre-push', ['origin', origin], clean));
  writeFileSync(fpFile, fpText);
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

// ---- pubkey(updater 공개 키) · signing-key(누출 규칙) ----
{
  const pub = readFileSync(join(ROOT, 'release/updater.pub'), 'utf8');
  const conf = (pubkey) => ({ 'app/src-tauri/tauri.conf.json': JSON.stringify({ version: '0.1.0', plugins: { updater: { pubkey } } }) + '\n' });
  expect('pubkey', 'conf = release/updater.pub', 0, () => gate(mkRoot('pub-same', conf(pub)), 'pubkey'));
  expect('pubkey', 'conf의 키가 다름', 'nonzero', () => gate(mkRoot('pub-diff', conf(pub.slice(0, -4) + 'AAAA')), 'pubkey'));
  expect('pubkey', 'updater.pub 끝 줄바꿈', 'nonzero', () => gate(mkRoot('pub-nl', { ...conf(pub), 'release/updater.pub': `${pub}\n` }), 'pubkey'));
  // Tauri 형식 개인 키(머리줄 텍스트의 base64)를 커밋하면 scan이 막는다
  const head = ['untrusted comment:', 'rsign', 'encrypted', 'secret', 'key'].join(' ');
  const key = Buffer.from(`${head}\n${'RWRT' + 'Y0I' + 'y'}${'B'.repeat(140)}\n`).toString('base64');
  expect('scan', 'updater 개인 키(base64)', 'nonzero', () => gate(mkRoot('scan-key', { 'app/updater.key': key }), 'scan'), ['git']);
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
  expect('ci-ok', 'PR에서 bundle skipped', 0, () => ciok({ changes: changes(true), lint: ok, rust: ok, bundle: skipped }));
  expect('ci-ok', 'push에서 bundle skipped', 'nonzero', () => ciok({ changes: changes(true), lint: ok, rust: ok, bundle: skipped }, 'push'));
  expect('ci-ok', 'force_fail', 'nonzero', () =>
    exec('node', [join(ROOT, 'scripts/ci/run.mjs'), 'ci-ok'], ROOT, {
      ...process.env,
      NEEDS: JSON.stringify({ changes: changes(true), lint: ok }),
      EVENT: 'workflow_dispatch',
      CI_FORCE_FAIL: 'true',
      GITHUB_STEP_SUMMARY: '',
    }),
  );
}

// ---- ratchet: 사본의 ci/ratchet.json 기준과 가짜 측정값(target/ci/measure/<kind>.json) ----
{
  const R = {
    $pending: [],
    coverage_lines: { rust: 80, frontend: 90, tolerance_pp: 0.1 },
    tests: { rust: 300, vitest: 400, playwright: 7, app: { linux: 30, darwin: 30, windows: 30 } },
    size: { dist_gz: 1000, binary: { linux: 10000, darwin: 10000, windows: 10000 }, bundle: {}, tolerance_pct: 3 },
    mutants_missed: { 'chzzk-core': 10 },
  };
  const bin = `size.binary.${osKey()}`;
  const rjson = (r) => JSON.stringify(r, null, 2) + '\n';
  const withMeasure = (name, kind, m) => mkRoot(name, { 'ci/ratchet.json': rjson(R), [`target/ci/measure/${kind}.json`]: JSON.stringify(m) });
  const check = (d, kind) => exec('node', [join(d, 'scripts/ci/ratchet.mjs'), 'check', kind], d, { ...process.env, GITHUB_STEP_SUMMARY: '' });
  const seeds = [
    ['coverage −0.05pp(허용치 안)', 'coverage', { 'coverage_lines.rust': 79.95, 'coverage_lines.frontend': 90 }, 0],
    ['coverage −1pp', 'coverage', { 'coverage_lines.rust': 79, 'coverage_lines.frontend': 90 }, 'nonzero'],
    ['tests 그대로', 'tests', { 'tests.rust': 300, 'tests.vitest': 400 }, 0],
    ['tests −1', 'tests', { 'tests.rust': 299, 'tests.vitest': 400 }, 'nonzero'],
    ['tests playwright 7 그대로', 'tests', { 'tests.playwright': 7 }, 0],
    ['tests playwright −1(e2e spec을 끔)', 'tests', { 'tests.playwright': 6 }, 1],
    ['tests app −1(#[ignore] 하나)', 'tests', { [`tests.app.${osKey()}`]: 29 }, 'nonzero'],
    ['size +2%', 'size', { 'size.dist_gz': 1020, [bin]: 10200 }, 0],
    ['size +5%', 'size', { 'size.dist_gz': 1000, [bin]: 10500 }, 'nonzero'],
    ['size 이 OS 바이너리 빠짐', 'size', { 'size.dist_gz': 1000 }, 'nonzero'],
    ['size 모르는 키', 'size', { 'size.dist_gz': 1000, [bin]: 10000, 'size.binary.freebsd': 1 }, 'nonzero'],
    ['mutants 살아남음 그대로', 'mutants', { 'mutants_missed.chzzk-core': 10 }, 0],
    ['mutants 살아남음 +1', 'mutants', { 'mutants_missed.chzzk-core': 11 }, 'nonzero'],
  ];
  seeds.forEach(([seed, kind, m, want], i) => expect('ratchet', seed, want, () => check(withMeasure(`rat-${i}`, kind, m), kind)));
  // log-check: 기준 커밋에서 기준을 낮추면 ci/RATCHET_LOG.md에 키를 적은 줄이 있어야 한다
  const logRoot = (name, lower, logLine) => {
    const d = mkRoot(name, { 'ci/ratchet.json': rjson(R) });
    gitOk(d, ['commit', '-q', '-m', 'chore: 기준']);
    const base = gitOk(d, ['rev-parse', 'HEAD']);
    const r2 = structuredClone(R);
    r2.coverage_lines.rust = lower;
    writeFileSync(join(d, 'ci/ratchet.json'), rjson(r2));
    if (logLine) writeFileSync(join(d, 'ci/RATCHET_LOG.md'), readFileSync(join(d, 'ci/RATCHET_LOG.md'), 'utf8') + logLine + '\n');
    return { d, base };
  };
  const logCheck = ({ d, base }) => exec('node', [join(d, 'scripts/ci/run.mjs'), 'ratchet-log'], d, gitEnv({ extra: { RATCHET_BASE: base } }));
  expect('ratchet-log', '기준 올림(조임)', 0, () => logCheck(logRoot('rlog-0', 81, null)));
  expect('ratchet-log', '기준 낮춤, 기록 없음', 'nonzero', () => logCheck(logRoot('rlog-1', 79, null)));
  expect('ratchet-log', '기준 낮춤, 기록 있음', 0, () => logCheck(logRoot('rlog-2', 79, '| 2026-10-05 | `coverage_lines.rust` | 80 → 79 | 씨앗 |')));
}

// ---- drift: 사본의 진입점으로 합성 출력(simulate). 실서버·secret 없이 gate 정의(진입점 → drift.mjs → 분류 → 종료 코드)를 본다 ----
{
  const d = mkRoot('drift');
  const drift = (sim) => exec('node', [join(d, 'scripts/ci/run.mjs'), 'drift'], d, { ...process.env, DRIFT_SIMULATE: sim, CHZZK_LIVE_HLS: '', CHZZK_LIVE_DASH: '', CHZZK_LIVE_CLIP: '', GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' });
  expect('drift', 'simulate ok', 0, () => drift('ok'), ['cargo']);
  expect('drift', 'simulate target_gone', 'nonzero', () => drift('target_gone'), ['cargo']);
  expect('drift', '대상 secret 없음(no_target)', 'nonzero', () => drift(''), ['cargo']);
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
