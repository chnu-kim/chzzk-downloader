#!/usr/bin/env node
// cargo-fuzz 4 target(docs/design/cicd.md §2 `fuzz`, 구현 중 변경 54). `node scripts/ci/run.mjs fuzz`가 부른다.
//
//   env FUZZ_SECONDS   target마다 시간(초, 기본 300, 1~3600)
//
// 1. fuzz/Cargo.lock이 최신인지 본다(`cargo metadata --locked`: cargo fuzz에는 --locked가 없다).
// 2. target마다 seed corpus를 target/ci/fuzz/corpus/<t>에 만든다: testdata/의 합성 fixture(실제 응답이 아니다)와 고정 주소 몇 개.
// 3. `cargo +<nightly> fuzz run <t> <corpus> -- -max_total_time=<s>`. crash·timeout·oom 입력은 target/ci/fuzz/artifacts/<t>/에
//    남고(합성 seed에서 변이한 입력이라 공개해도 된다) 워크플로가 artifact로 올린다.
// 모든 target이 끝까지 돈다. 하나라도 실패하면 1, 입력 오류 2. 툴체인은 tools.json의 rust-nightly(gate의 첫 단계가 깐다).

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
  if (argv.length) {
    console.error('사용법: fuzz.mjs (env FUZZ_SECONDS)');
    return 2;
  }
  const secs = seconds(env);
  if (secs === null) {
    console.error('fuzz: FUZZ_SECONDS는 1~3600의 정수다');
    return 2;
  }
  const tc = `+${NIGHTLY}`;
  const lock = spawnSync('cargo', [tc, 'metadata', '--locked', '--format-version', '1', '--manifest-path', 'fuzz/Cargo.toml'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  if (lock.status !== 0) {
    console.error('::error::fuzz: fuzz/Cargo.lock이 최신이 아니다(cd fuzz && cargo +<nightly> metadata로 갱신해 커밋한다)');
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
  return failed.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
