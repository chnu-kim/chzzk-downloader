#!/usr/bin/env node
// ratchet 측정(docs/design/cicd.md §4.2). 결과는 target/ci/measure/<kind>.json(평평한 키 경로)이고 ratchet.mjs가 판정한다.
//
//   node scripts/ci/measure.mjs coverage   # cargo llvm-cov(chzzk-core·chzzk-shell) 줄 커버리지 + vitest v8 줄 커버리지
//   node scripts/ci/measure.mjs tests      # cargo test 목록 수(llvm-cov 빌드를 다시 쓴다) + vitest 통과 테스트 수
//   node scripts/ci/measure.mjs tests-app  # chzzk-app 테스트 목록 수(tauri gate의 테스트 빌드를 다시 쓴다) → tests.app.<os>,
//                                          # e2e:: 테스트 수(--features e2e) → tests.app_e2e.<os>(0이면 실패)
//   node scripts/ci/measure.mjs tests-playwright  # e2e-web(Playwright) 통과 테스트 수(target/e2e-web/report.json) → tests.playwright
//   node scripts/ci/measure.mjs size       # app/dist gzip 합, 릴리스 바이너리, 수집한 번들(target/ci/bundle/bundles.json)
//   node scripts/ci/measure.mjs mutants-shard  # env MUTANTS_SHARD=k/n: cargo mutants -p chzzk-core의 한 shard →
//                                              # target/ci/mutants/shard-<k>/summary.json(weekly mutants-shard 작업)
//   node scripts/ci/measure.mjs mutants    # shard 요약을 모두 모아(정확히 0..n-1) 살아남은 mutant 수 → mutants_missed.chzzk-core
//
// 값은 CI 러너에서만 기준으로 삼는다(ratchet.mjs write --from-run). 종료 코드: 0, 측정 실패 1, 사용법 2.

import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';
import { MEASURE_DIR } from './ratchet.mjs';
import { spawnTool } from './run.mjs';
import { osKey, targetDir } from './smoke.mjs';

const RUST_PKGS = ['-p', 'chzzk-core', '-p', 'chzzk-shell', '--locked'];
const round2 = (x) => Math.round(x * 100) / 100;

// cargo llvm-cov --json --summary-only 결과 → 줄 커버리지(%)
export function llvmLinesPct(json) {
  const t = json?.data?.[0]?.totals?.lines;
  if (!t || typeof t.percent !== 'number') throw new Error('llvm-cov JSON에 data[0].totals.lines.percent가 없다');
  return round2(t.percent);
}

// vitest coverage-summary.json → 줄 커버리지(%)
export function vitestLinesPct(json) {
  const t = json?.total?.lines;
  if (!t || typeof t.pct !== 'number') throw new Error('coverage-summary.json에 total.lines.pct가 없다');
  return round2(t.pct);
}

// `cargo test -- --list --format terse` 출력 → 테스트 수(벤치·문서 줄 제외)
export function countListed(stdout) {
  return stdout.split('\n').filter((l) => /: test$/.test(l.trim())).length;
}

// 실제로 도는 Rust 테스트 수 = `--list` − `--list --ignored`. #[ignore]로 끈 테스트는 세지 않는다
// (끄면 수가 줄어 ratchet이 잡는다).
export function countActive(all, ignored) {
  const n = countListed(all) - countListed(ignored);
  if (n < 0) throw new Error(`--ignored 목록(${countListed(ignored)})이 전체(${countListed(all)})보다 많다`);
  return n;
}

// vitest json reporter → **통과한** 테스트 수(skip·todo 제외). 실패가 있으면 오류(측정이 아니라 테스트 실패다).
export function vitestCount(json) {
  if (typeof json?.numPassedTests !== 'number') throw new Error('vitest JSON에 numPassedTests가 없다');
  if (json.success !== true || json.numFailedTests) throw new Error(`vitest 실패 ${json.numFailedTests}개`);
  return json.numPassedTests;
}

// Playwright json reporter → 통과한 테스트 수(stats.expected). 실패·flaky가 있으면 오류(재시도 없이 돌므로 flaky는 0이어야
// 한다), 건너뛴 테스트(skip·fixme)는 세지 않는다.
export function playwrightCount(json) {
  const s = json?.stats;
  if (!s || typeof s.expected !== 'number') throw new Error('Playwright JSON에 stats.expected가 없다');
  if (s.unexpected || s.flaky) throw new Error(`Playwright 실패 ${s.unexpected ?? 0}개, flaky ${s.flaky ?? 0}개`);
  return s.expected;
}

export const PLAYWRIGHT_REPORT = 'target/e2e-web/report.json';

// 폴더 아래 파일마다 gzip(level 9) 크기의 합. 순서는 경로순(결정적).
export function gzipTotal(dir) {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else total += gzipSync(readFileSync(p), { level: 9 }).length;
    }
  };
  walk(dir);
  return total;
}

function run(bin, args, { cwd = ROOT, capture = false } = {}) {
  const r = spawnTool(bin, args, { cwd, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.error) throw new Error(`${bin}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')} → exit ${r.status ?? r.signal}`);
  return r.stdout ?? '';
}

const outDir = () => {
  const d = join(ROOT, MEASURE_DIR);
  mkdirSync(d, { recursive: true });
  return d;
};

function save(kind, values) {
  const p = join(outDir(), `${kind}.json`);
  writeFileSync(p, JSON.stringify(values, null, 2) + '\n');
  console.log(`measure ${kind} → ${p}`);
  for (const [k, v] of Object.entries(values)) console.log(`  ${k} = ${v}`);
}

function coverage() {
  const d = outDir();
  const llvm = join(d, 'llvm-cov.json');
  run('cargo', ['llvm-cov', ...RUST_PKGS, '--json', '--summary-only', '--output-path', llvm]);
  const vdir = join(d, 'vitest-coverage');
  run('pnpm', ['exec', 'vitest', 'run', '--coverage', `--coverage.reportsDirectory=${vdir}`], { cwd: join(ROOT, 'app') });
  save('coverage', {
    'coverage_lines.rust': llvmLinesPct(JSON.parse(readFileSync(llvm, 'utf8'))),
    'coverage_lines.frontend': vitestLinesPct(JSON.parse(readFileSync(join(vdir, 'coverage-summary.json'), 'utf8'))),
  });
}

function tests() {
  // llvm-cov의 계측 빌드를 coverage와 같이 쓴다(목록만 내고 실행하지 않는다)
  const list = (extra) => run('cargo', ['llvm-cov', ...RUST_PKGS, '--no-report', '--', '--list', ...extra, '--format', 'terse'], { capture: true });
  const rust = countActive(list([]), list(['--ignored']));
  const vjson = join(outDir(), 'vitest-report.json');
  run('pnpm', ['exec', 'vitest', 'run', '--reporter=dot', '--reporter=json', `--outputFile.json=${vjson}`], { cwd: join(ROOT, 'app') });
  save('tests', {
    'tests.rust': rust,
    'tests.vitest': vitestCount(JSON.parse(readFileSync(vjson, 'utf8'))),
  });
}

// chzzk-app(webkit2gtk 등 OS 의존)은 coverage 작업이 아니라 tauri 작업(3 OS)에서 센다. OS별 #[cfg] 테스트가 있어 키도 OS별이다.
// e2e:: 테스트(--features e2e --lib)도 따로 센다: `cargo test -- e2e::`는 필터가 아무것도 고르지 않아도 0으로 끝난다
// (모듈 이름을 바꾸거나 테스트를 지우면 조용히 통과한다). 0개면 기준과 무관하게 실패한다.
export const E2E_FILTER = 'e2e::';
function testsApp() {
  const list = (feat, extra) => run('cargo', ['test', '-p', 'chzzk-app', '--locked', ...feat, '--', '--list', ...extra, '--format', 'terse'], { capture: true });
  const app = countActive(list([], []), list([], ['--ignored']));
  const e2eFeat = ['--features', 'e2e', '--lib'];
  const e2e = countActive(list(e2eFeat, [E2E_FILTER]), list(e2eFeat, ['--ignored', E2E_FILTER]));
  if (e2e === 0) throw new Error(`--features e2e --lib에서 ${E2E_FILTER} 테스트가 0개다(tauri gate의 cargo test 필터가 아무것도 돌리지 않는다)`);
  save('tests', { [`tests.app.${osKey()}`]: app, [`tests.app_e2e.${osKey()}`]: e2e });
}

function testsPlaywright() {
  const p = join(ROOT, PLAYWRIGHT_REPORT);
  if (!existsSync(p)) throw new Error(`${p}가 없다(e2e-web gate의 playwright test가 먼저 돌아야 한다)`);
  save('tests', { 'tests.playwright': playwrightCount(JSON.parse(readFileSync(p, 'utf8'))) });
}
function size() {
  const os = osKey();
  const values = {};
  const dist = join(ROOT, 'app/dist');
  if (!existsSync(dist)) throw new Error('app/dist가 없다(bundle gate가 먼저 돌아야 한다)');
  values['size.dist_gz'] = gzipTotal(dist);
  const bin = join(targetDir(), 'release', `chzzk-app${os === 'windows' ? '.exe' : ''}`);
  if (!existsSync(bin)) throw new Error(`${bin}가 없다`);
  values[`size.binary.${os}`] = statSync(bin).size;
  const manifest = join(ROOT, 'target/ci/bundle/bundles.json');
  if (!existsSync(manifest)) throw new Error(`${manifest}가 없다(bundle gate의 collect)`);
  for (const a of JSON.parse(readFileSync(manifest, 'utf8')).artifacts) values[`size.bundle.${a.size}`] = a.bytes;
  save('size', values);
}

// ---- mutants(weekly) ----
// cargo-mutants 27의 종료 코드: 0 모두 잡힘, 2 살아남은 mutant 있음, 3 시간 초과 있음 — 셋 다 측정 성공이다(판정은 ratchet).
// 1(사용법)·4(기준 빌드·테스트 실패) 등은 측정 실패다.
export const MUTANTS_DIR = 'target/ci/mutants';
export const MUTANTS_OK_CODES = [0, 2, 3];
export const MUTANTS_PKG = 'chzzk-core';

// "k/n" → {k, n}. 0 ≤ k < n ≤ 16
export function parseShard(s) {
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(s ?? '');
  const k = Number(m?.[1]);
  const n = Number(m?.[2]);
  if (!m || n < 1 || n > 16 || k >= n) throw new Error(`MUTANTS_SHARD는 k/n(0 ≤ k < n ≤ 16)이다: ${s}`);
  return { k, n };
}

// mutants.out/outcomes.json → 요약(정수만)
export function shardSummary(outcomes, { k, n }) {
  const out = { shard: k, of: n };
  for (const f of ['total_mutants', 'missed', 'caught', 'timeout', 'unviable']) {
    if (!Number.isInteger(outcomes?.[f]) || outcomes[f] < 0) throw new Error(`outcomes.json에 ${f}(0 이상의 정수)가 없다`);
    out[f] = outcomes[f];
  }
  out.cargo_mutants_version = String(outcomes.cargo_mutants_version ?? '');
  return out;
}

// shard 요약 목록 → 합. 정확히 0..n-1이 한 번씩 있고 n과 cargo-mutants 버전이 같아야 한다(빠진 shard는 수를 줄인다).
export function sumShards(list) {
  if (!list.length) throw new Error('shard 요약이 없다');
  const n = list[0].of;
  const ks = list.map((x) => x.shard).sort((a, b) => a - b);
  if (list.some((x) => x.of !== n) || ks.join(',') !== [...Array(n).keys()].join(',')) throw new Error(`shard가 0..${n - 1}을 정확히 덮지 않는다: ${ks.join(',')} (of ${[...new Set(list.map((x) => x.of))].join(',')})`);
  const versions = new Set(list.map((x) => x.cargo_mutants_version));
  if (versions.size !== 1) throw new Error(`shard마다 cargo-mutants 버전이 다르다: ${[...versions].join(', ')}`);
  const sum = (f) => list.reduce((a, x) => a + x[f], 0);
  return { shards: n, total: sum('total_mutants'), missed: sum('missed'), caught: sum('caught'), timeout: sum('timeout'), unviable: sum('unviable') };
}

function mutantsShard() {
  const shard = parseShard(process.env.MUTANTS_SHARD);
  const out = join(ROOT, MUTANTS_DIR, `shard-${shard.k}`);
  mkdirSync(out, { recursive: true });
  // 순서 고정(--no-shuffle), 작업 2개(러너 4 vCPU). 기준(baseline) 테스트는 shard마다 돈다
  const args = ['mutants', '-p', MUTANTS_PKG, '--shard', `${shard.k}/${shard.n}`, '--no-shuffle', '--jobs', '2', '--output', out];
  const r = spawnTool('cargo', args, { cwd: ROOT, stdio: 'inherit' });
  if (r.error) throw new Error(`cargo: ${r.error.message}`);
  if (!MUTANTS_OK_CODES.includes(r.status)) throw new Error(`cargo ${args.join(' ')} → exit ${r.status ?? r.signal}(측정 실패)`);
  const summary = shardSummary(JSON.parse(readFileSync(join(out, 'mutants.out', 'outcomes.json'), 'utf8')), shard);
  writeFileSync(join(out, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`mutants shard ${shard.k}/${shard.n}: ${JSON.stringify(summary)}`);
}

function mutants() {
  const dir = join(ROOT, MUTANTS_DIR);
  if (!existsSync(dir)) throw new Error(`${dir}가 없다(mutants-shard 작업의 artifact를 받아야 한다)`);
  const list = readdirSync(dir)
    .filter((d) => /^shard-\d+$/.test(d) && existsSync(join(dir, d, 'summary.json')))
    .sort()
    .map((d) => JSON.parse(readFileSync(join(dir, d, 'summary.json'), 'utf8')));
  const s = sumShards(list);
  console.log(`mutants: shard ${s.shards}개, mutant ${s.total}개(잡힘 ${s.caught}, 살아남음 ${s.missed}, 시간 초과 ${s.timeout}, 빌드 안 됨 ${s.unviable})`);
  save('mutants', { [`mutants_missed.${MUTANTS_PKG}`]: s.missed });
}

const MODES = { coverage, tests, 'tests-app': testsApp, 'tests-playwright': testsPlaywright, size, 'mutants-shard': mutantsShard, mutants };

export function main(argv) {
  if (argv.length !== 1 || !Object.hasOwn(MODES, argv[0])) {
    console.error(`사용법: measure.mjs <${Object.keys(MODES).join('|')}>`);
    return 2;
  }
  try {
    MODES[argv[0]]();
    return 0;
  } catch (e) {
    console.error(`::error::measure ${argv[0]}: ${e.message}`);
    return 1;
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
