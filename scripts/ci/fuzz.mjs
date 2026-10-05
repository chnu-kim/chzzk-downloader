#!/usr/bin/env node
// cargo-fuzz 4 target(docs/design/cicd.md §2 `fuzz`, 구현 중 변경 54). `node scripts/ci/run.mjs fuzz`가 부른다.
//
//   env FUZZ_SECONDS   target마다 시간(초, 기본 300, 1~3600)
//   node scripts/ci/fuzz.mjs --lock-check   # (gate fuzz-lock, PR lint) fuzz/Cargo.lock이 최신이고 루트 Cargo.lock과 같은
//                                           # 버전을 쓰는지, fuzz target이 기본(stable) 툴체인으로 컴파일되는지(cargo check,
//                                           # nightly·sanitizer 없음) 본다. lock 다시 만들기:
//                                           #   cp Cargo.lock fuzz/Cargo.lock && (cd fuzz && cargo metadata --format-version 1 >/dev/null)
//
// 1. fuzz/Cargo.lock이 최신인지 본다(`cargo metadata --locked`: cargo fuzz에는 --locked가 없다).
// 1'. `cargo fuzz build`로 모든 target을 먼저 빌드한다. 여기서 실패하면 kind build(crash가 아니다).
// 2. target마다 seed corpus를 target/ci/fuzz/corpus/<t>에 만든다: testdata/의 합성 fixture(실제 응답이 아니다)와 고정 주소 몇 개.
// 3. `cargo +<nightly> fuzz run <t> <corpus> -- -max_total_time=<s>`. crash·timeout·oom 입력은 target/ci/fuzz/artifacts/<t>/에
//    남고(합성 seed에서 변이한 입력이라 공개해도 된다) 워크플로가 artifact로 올린다.
// 모든 target이 끝까지 돈다. 하나라도 실패하면 1, 입력 오류 2. 툴체인은 tools.json의 rust-nightly(gate의 첫 단계가 깐다).
// GITHUB_OUTPUT kinds: lock·빌드 실패는 build, 실행 실패(crash·timeout·oom 입력, 비정상 종료)는 crash(nightly report가 이슈
// kind로 쓴다).

import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

export { ROOT };

export const TARGETS = ['url', 'info', 'mpd', 'hls'];
export const NIGHTLY = JSON.parse(readFileSync(join(ROOT, 'scripts/ci/tools.json'), 'utf8')).tools['rust-nightly'].version;
const OUT = join(ROOT, 'target/ci/fuzz');

// target → seed 파일(저장소 상대 경로) 목록. 합성 fixture만이다(testdata/README.md).
export function seedFiles(root = ROOT) {
  const pick = (dir, re) => (existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => re.test(f)).sort().map((f) => `${dir}/${f}`) : []);
  return {
    url: [],
    info: [...pick('testdata/hls', /\.json$/), ...pick('testdata/vod', /\.json$/), ...pick('testdata/clip', /\.json$/), ...pick('testdata/synthetic', /\.json$/)],
    mpd: [...pick('testdata/vod', /\.mpd$/), ...pick('testdata/clip', /\.mpd$/)],
    hls: [...pick('testdata/hls', /\.m3u8$/), ...pick('testdata/synthetic', /\.m3u8$/)],
  };
}
// url target의 seed: 받는 모양과 거부하는 모양(합성 번호)
export const URL_SEEDS = [
  'https://chzzk.naver.com/video/9000001',
  'https://m.chzzk.naver.com/video/9000001/',
  'chzzk.naver.com/video/9000001?t=1#x',
  'https://chzzk.naver.com/clips/AbC-123_x',
  'https://chzzk.naver.com/embed/clip/AbC-123_x',
  'https://chzzk.naver.com/live/abc',
  'ftp://chzzk.naver.com/video/1',
];

// Cargo.lock 본문 → Map(이름 → Set(버전))
export function lockPackages(text) {
  const m = new Map();
  for (const block of text.split('[[package]]').slice(1)) {
    const n = /^name = "([^"]+)"/m.exec(block)?.[1];
    const v = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!n || !v) continue;
    if (!m.has(n)) m.set(n, new Set());
    m.get(n).add(v);
  }
  return m;
}

// fuzz lock의 패키지 중 루트 lock에도 이름이 있는 것은 같은 버전이어야 한다(fuzz가 앱이 쓰는 것보다 낡은 파서를 시험하지
// 않게). 루트에 이름이 없는 것(libfuzzer-sys·arbitrary·chzzk-fuzz)은 fuzz 전용이다. → 어긋난 "이름@버전" 목록
export function lockDrift(rootText, fuzzText) {
  const root = lockPackages(rootText);
  const out = [];
  for (const [n, vs] of lockPackages(fuzzText)) {
    if (!root.has(n)) continue;
    for (const v of vs) if (!root.get(n).has(v)) out.push(`${n}@${v}`);
  }
  return out.sort();
}

export const LOCK_FIX = 'cp Cargo.lock fuzz/Cargo.lock && (cd fuzz && cargo metadata --format-version 1 >/dev/null)';
function lockCheck() {
  // 기본 툴체인(rust-toolchain.toml)으로 충분하다: metadata는 컴파일하지 않는다. 출력(JSON)은 크고 쓸모없어 버린다
  const r = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--manifest-path', 'fuzz/Cargo.toml'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) {
    console.error(`::error::fuzz-lock: fuzz/Cargo.lock이 최신이 아니다(코어 의존성이 바뀌었다). 다시 만들기: ${LOCK_FIX}`);
    return 1;
  }
  const drift = lockDrift(readFileSync(join(ROOT, 'Cargo.lock'), 'utf8'), readFileSync(join(ROOT, 'fuzz/Cargo.lock'), 'utf8'));
  if (drift.length) {
    console.error(`::error::fuzz-lock: fuzz/Cargo.lock의 버전이 루트 Cargo.lock과 다르다: ${drift.join(', ')}. 다시 만들기: ${LOCK_FIX}`);
    return 1;
  }
  console.log('fuzz-lock: fuzz/Cargo.lock이 최신이고 루트와 같은 버전이다');
  // target 컴파일(리뷰 G5: fuzz/는 워크스페이스 밖이라 PR의 clippy·test가 보지 않아, 코어 API 변경이 녹색으로 머지되고 다음
  // nightly가 crash로 보고했다). check는 libfuzzer-sys의 C++도 빌드 스크립트로 컴파일한다(로컬 약 25초)
  const c = spawnSync('cargo', ['check', '--manifest-path', 'fuzz/Cargo.toml', '--locked', '--bins'], { cwd: ROOT, stdio: 'inherit' });
  if (c.status !== 0) {
    console.error('::error::fuzz-lock: fuzz target(fuzz/fuzz_targets)이 컴파일되지 않는다. 코어 API 변경을 반영한다');
    return 1;
  }
  console.log('fuzz-lock: fuzz target 4개가 컴파일된다');
  return 0;
}

export function seconds(env = process.env) {
  const v = env.FUZZ_SECONDS ?? '300';
  if (!/^\d{1,4}$/.test(v) || Number(v) < 1 || Number(v) > 3600) return null;
  return Number(v);
}

function prepareCorpus(t) {
  const dir = join(OUT, 'corpus', t);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const seeds = seedFiles()[t];
  seeds.forEach((rel, i) => copyFileSync(join(ROOT, rel), join(dir, `seed-${i}`)));
  if (t === 'url') URL_SEEDS.forEach((s, i) => writeFileSync(join(dir, `seed-${i}`), s));
  return { dir, n: t === 'url' ? URL_SEEDS.length : seeds.length };
}

export function main(argv, env = process.env) {
  if (argv.length === 1 && argv[0] === '--lock-check') return lockCheck();
  if (argv.length) {
    console.error('사용법: fuzz.mjs [--lock-check] (env FUZZ_SECONDS)');
    return 2;
  }
  const secs = seconds(env);
  if (secs === null) {
    console.error('fuzz: FUZZ_SECONDS는 1~3600의 정수다');
    return 2;
  }
  const tc = `+${NIGHTLY}`;
  const kinds = (k) => {
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `kinds=${k}\n`);
  };
  const lock = spawnSync('cargo', [tc, 'metadata', '--locked', '--format-version', '1', '--manifest-path', 'fuzz/Cargo.toml'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  if (lock.status !== 0) {
    console.error(`::error::fuzz: fuzz/Cargo.lock이 최신이 아니다. 다시 만들기: ${LOCK_FIX}`);
    kinds('build');
    return 1;
  }
  // 실행 전에 모두 빌드한다: 빌드 실패를 crash로 보고하지 않는다(cargo fuzz run은 같은 설정이라 다시 빌드하지 않는다)
  const b = spawnSync('cargo', [tc, 'fuzz', 'build', '--fuzz-dir', 'fuzz'], { cwd: ROOT, stdio: 'inherit' });
  if (b.status !== 0) {
    console.error(`::error::fuzz: target 빌드 실패(exit ${b.status ?? b.signal}) — crash가 아니다`);
    kinds('build');
    return 1;
  }
  const failed = [];
  for (const t of TARGETS) {
    const { dir, n } = prepareCorpus(t);
    const art = join(OUT, 'artifacts', t);
    mkdirSync(art, { recursive: true });
    console.log(`fuzz: ${t} — seed ${n}개, ${secs}초 (${NIGHTLY})`);
    const r = spawnSync(
      'cargo',
      [tc, 'fuzz', 'run', '--fuzz-dir', 'fuzz', t, dir, '--', `-max_total_time=${secs}`, '-timeout=10', '-rss_limit_mb=2048', `-artifact_prefix=${art}/`, '-print_final_stats=1'],
      { cwd: ROOT, stdio: 'inherit' },
    );
    const found = readdirSync(art);
    if (r.status !== 0 || found.length) {
      failed.push(t);
      console.error(`::error::fuzz ${t}: exit ${r.status ?? r.signal}, 남은 입력 ${found.length}개(${found.join(', ') || '없음'}) — artifact fuzz-artifacts`);
    } else console.log(`fuzz: ${t} 통과`);
  }
  if (env.GITHUB_STEP_SUMMARY) {
    writeFileSync(env.GITHUB_STEP_SUMMARY, `### fuzz (${NIGHTLY}, target당 ${secs}초)\n\n${TARGETS.map((t) => `- \`${t}\`: ${failed.includes(t) ? '실패' : '통과'}`).join('\n')}\n`, { flag: 'a' });
  }
  if (failed.length) kinds('crash');
  return failed.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
