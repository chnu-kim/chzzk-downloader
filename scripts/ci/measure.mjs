#!/usr/bin/env node
// ratchet 측정(docs/design/cicd.md §4.2). 결과는 target/ci/measure/<kind>.json(평평한 키 경로)이고 ratchet.mjs가 판정한다.
//
//   node scripts/ci/measure.mjs coverage   # cargo llvm-cov(chzzk-core·chzzk-shell) 줄 커버리지 + vitest v8 줄 커버리지
//   node scripts/ci/measure.mjs tests      # cargo test 목록 수(llvm-cov 빌드를 다시 쓴다) + vitest 통과 테스트 수
//   node scripts/ci/measure.mjs tests-app  # chzzk-app 테스트 목록 수(tauri gate의 테스트 빌드를 다시 쓴다) → tests.app.<os>
//   node scripts/ci/measure.mjs size       # app/dist gzip 합, 릴리스 바이너리, 수집한 번들(target/ci/bundle/bundles.json)
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
function testsApp() {
  const list = (extra) => run('cargo', ['test', '-p', 'chzzk-app', '--locked', '--', '--list', ...extra, '--format', 'terse'], { capture: true });
  save('tests', { [`tests.app.${osKey()}`]: countActive(list([]), list(['--ignored'])) });
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

const MODES = { coverage, tests, 'tests-app': testsApp, size };

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
