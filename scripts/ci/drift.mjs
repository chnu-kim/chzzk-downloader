#!/usr/bin/env node
// 실서버 drift 검사(docs/design/cicd.md §4.3, 구현 중 변경 50). `node scripts/ci/run.mjs drift`가 부른다.
//
//   env CHZZK_LIVE_HLS·CHZZK_LIVE_DASH·CHZZK_LIVE_CLIP   사용자 본인 영상(환경 drift의 secret). 비면 그 대상은 no_target.
//   env DRIFT_SIMULATE=<ok|kind>                         실서버 대신 합성 출력(drift-classify.mjs SYNTHETIC)으로 같은 경로를
//                                                       돈다. 고리(2회 연속 → 이슈, 성공 → 닫기)와 로그 위생을 시크릿 없이 확인한다.
//
// 1. 빌드(`cargo test --no-run`, `cargo build --example dl`)는 출력을 그대로 보인다(서버 응답이 없다). 실패하면 kind build.
// 2. 실행(라이브 테스트 3개, examples/dl 하나)은 stdout·stderr를 **메모리로만** 받는다. 출력에는 서버가 돌려준 제목·채널
//    이름이 섞이고 secret 마스킹은 영상 번호만 가린다. 그래서 원문을 찍지도, 파일·artifact로 남기지도 않는다.
// 3. drift-classify.mjs가 실패 출력마다 kind 하나를 고른다. 찍는 것은 `drift: <테스트 이름> <pass|fail> [kind]`와 요약 JSON뿐이다.
// 4. dl이 받은 파일(이름에 제목이 든다)이 있는 임시 폴더는 지운다.
// GITHUB_OUTPUT: status=ok|fail, kinds=<쉼표 목록>(nightly report-loop가 이슈 kind로 쓴다). 종료: 모두 통과 0, 실패 1, 입력 오류 2.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CANARY, classify, DRIFT_TESTS, SIMULATE, syntheticOutput } from './drift-classify.mjs';
import { ROOT } from './gates.mjs';
import { KINDS } from './issue.mjs';

const TARGET_ENV = { live_hls_partial: 'CHZZK_LIVE_HLS', live_dash_partial: 'CHZZK_LIVE_DASH', live_clip_full: 'CHZZK_LIVE_CLIP' };
export const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const BUILD_TIMEOUT_MS = 30 * 60 * 1000;

// 실행 결과(spawnSync) → { result, kind }. 출력은 분류에만 쓰고 버린다.
export function judgeRun(r) {
  if (r.error?.code === 'ETIMEDOUT' || (r.status === null && r.signal)) return { result: 'fail', kind: 'timeout' };
  if (r.error) return { result: 'fail', kind: 'unknown' };
  if (r.status === 0) return { result: 'pass', kind: null };
  return { result: 'fail', kind: classify(`${r.stdout ?? ''}\n${r.stderr ?? ''}`) };
}

// 결과 목록 → 요약(찍어도 되는 필드만)
export function summarize(rows) {
  const kinds = [...new Set(rows.filter((r) => r.result === 'fail').map((r) => r.kind))].sort();
  return { status: kinds.length ? 'fail' : 'ok', kinds, tests: rows.map(({ test, result, kind }) => ({ test, result, kind })) };
}

// dl 대상 주소: DASH(일반 VOD)가 있으면 그것, 없으면 HLS. 숫자가 아니면 null(주소를 조립하지 않는다).
export function dlTarget(env) {
  for (const k of ['CHZZK_LIVE_DASH', 'CHZZK_LIVE_HLS']) {
    const v = (env[k] ?? '').trim();
    if (/^\d+$/.test(v)) return `https://chzzk.naver.com/video/${v}`;
  }
  return null;
}

const quietEnv = (env) => {
  const e = { ...env, RUST_BACKTRACE: '0', CARGO_TERM_COLOR: 'never' };
  delete e.RUST_LOG;
  return e;
};

function build(env) {
  for (const args of [
    ['test', '-p', 'chzzk-core', '--test', 'live', '--locked', '--no-run'],
    ['build', '-p', 'chzzk-core', '--example', 'dl', '--locked'],
  ]) {
    console.log(`drift: cargo ${args.join(' ')}`);
    const r = spawnSync('cargo', args, { cwd: ROOT, stdio: 'inherit', env: quietEnv(env), timeout: BUILD_TIMEOUT_MS });
    if (r.status !== 0) return false;
  }
  return true;
}

function runReal(env) {
  const rows = [];
  const missing = DRIFT_TESTS.filter((t) => TARGET_ENV[t] && !(env[TARGET_ENV[t]] ?? '').trim());
  const dlUrl = dlTarget(env);
  if (missing.length === 3) {
    // 대상이 하나도 없다: 빌드도 하지 않는다
    for (const t of DRIFT_TESTS) rows.push({ test: t, result: 'fail', kind: 'no_target' });
    return rows;
  }
  if (!build(env)) return DRIFT_TESTS.map((t) => ({ test: t, result: 'fail', kind: 'build' }));
  const capture = { cwd: ROOT, env: quietEnv(env), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 26 };
  for (const t of DRIFT_TESTS.filter((x) => x !== 'dl')) {
    if (missing.includes(t)) {
      rows.push({ test: t, result: 'fail', kind: 'no_target' });
      continue;
    }
    // --nocapture 없음: 통과한 테스트의 println(크기·상자 목록)도 받지 않는다
    const r = spawnSync('cargo', ['test', '-p', 'chzzk-core', '--test', 'live', '--locked', '--', '--ignored', '--exact', t], capture);
    rows.push({ test: t, ...judgeRun(r) });
  }
  if (!dlUrl) rows.push({ test: 'dl', result: 'fail', kind: 'no_target' });
  else {
    const out = mkdtempSync(join(tmpdir(), 'drift-dl-'));
    try {
      const bin = join(env.CARGO_TARGET_DIR ?? join(ROOT, 'target'), 'debug', 'examples', process.platform === 'win32' ? 'dl.exe' : 'dl');
      const r = spawnSync(bin, [dlUrl, '--lowest', '--limit-mb', '2', '--out', out], capture);
      rows.push({ test: 'dl', ...judgeRun(r) });
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }
  return rows;
}

function runSimulated(kind) {
  // 실서버 대신 합성 출력. 원문(canary 제목 포함)은 여기서도 분류에만 쓰고 버린다.
  return DRIFT_TESTS.map((t) => {
    const text = syntheticOutput(kind, t);
    return { test: t, ...judgeRun({ status: kind === 'ok' ? 0 : 101, stdout: text, stderr: '' }) };
  });
}

export function main(argv, env = process.env) {
  if (argv.length) {
    console.error('사용법: drift.mjs (env CHZZK_LIVE_*, DRIFT_SIMULATE)');
    return 2;
  }
  const sim = (env.DRIFT_SIMULATE ?? '').trim();
  if (sim && sim !== 'none' && !SIMULATE.includes(sim)) {
    console.error(`drift: DRIFT_SIMULATE는 ${SIMULATE.join('|')} 중 하나다`);
    return 2;
  }
  const simulated = sim && sim !== 'none';
  if (simulated) console.log(`drift: simulate=${sim} — 실서버 대신 합성 출력으로 분류·고리 경로를 돈다`);
  const rows = simulated ? runSimulated(sim) : runReal(env);
  const s = summarize(rows);
  for (const r of s.tests) console.log(`drift: ${r.test} ${r.result}${r.kind ? ` ${r.kind}` : ''}`);
  console.log(JSON.stringify({ status: s.status, kinds: s.kinds, simulated: Boolean(simulated) }));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `status=${s.status}\nkinds=${s.kinds.join(',')}\n`);
  if (env.GITHUB_STEP_SUMMARY) {
    const lines = s.tests.map((r) => `| \`${r.test}\` | ${r.result} | ${r.kind ? `\`${r.kind}\`` : ''} |`);
    appendFileSync(env.GITHUB_STEP_SUMMARY, `### drift: ${s.status}${simulated ? ` (simulate ${sim})` : ''}\n\n| 테스트 | 결과 | kind |\n|---|---|---|\n${lines.join('\n')}\n`);
  }
  if (s.status !== 'ok') console.error(`::error::drift: ${s.kinds.join(', ')}`);
  return s.status === 'ok' ? 0 : 1;
}

// ---- 로그 검사(nightly report 작업, `run.mjs drift-log-check`) ----
// drift 작업의 실제 Actions 로그를 받아 (1) 합성 canary(제목·채널·번호)가 한 번도 없고 (2) drift 단계 구간의 모든 줄이
// 허용 모양(테스트 이름·결과·kind·요약 JSON, cargo 빌드 진행 줄, 단계 머리의 env 표시)인지 본다. 어긋난 줄은 **번호만**
// 찍는다(내용이 곧 누출일 수 있다). simulate 실행은 canary를 실제로 출력 경로에 흘려 보내므로 이 검사가 위생을 증명한다.
export const DRIFT_JOB_NAME = 'nightly drift';
const TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const K = `(?:${KINDS.join('|')})`;
const T = `(?:${DRIFT_TESTS.join('|')})`;
export const LOG_ALLOW = [
  /^$/,
  /^##\[(?:group|endgroup)\]\s*$/,
  /^##\[group\]Run node scripts\/ci\/run\.mjs drift$/,
  /^##\[group\]drift: node scripts\/ci\/drift\.mjs$/,
  /^node scripts\/ci\/run\.mjs drift$/,
  /^shell: \/usr\/bin\/bash -e \{0\}$/,
  /^env:$/,
  /^ {2}[A-Z][A-Z0-9_]*: (?:\*\*\*|[A-Za-z0-9_.:/-]*)$/,
  new RegExp(`^drift: ${T} (?:pass|fail ${K})$`),
  new RegExp(`^drift: simulate=(?:ok|${K}) — 실서버 대신 합성 출력으로 분류·고리 경로를 돈다$`),
  /^drift: cargo (?:test -p chzzk-core --test live --locked --no-run|build -p chzzk-core --example dl --locked)$/,
  new RegExp(`^\\{"status":"(?:ok|fail)","kinds":\\[(?:"${K}"(?:,"${K}")*)?\\],"simulated":(?:true|false)\\}$`),
  new RegExp(`^##\\[error\\]drift: ${K}(?:, ${K})*$`),
  /^##\[error\]\[drift\] 실패\(exit \d+\): drift: node scripts\/ci\/drift\.mjs$/,
  /^\[drift\] 통과$/,
  /^##\[error\]Process completed with exit code \d+\.$/,
  /^\s*(?:Compiling|Checking|Finished|Downloaded|Downloading|Updating|Fresh|Blocking|Locking|Adding|Building|Executable|Running) [\x20-\x7e]*$/,
];

// 작업 로그 전체 → 위반 [{line, rule}] (내용은 담지 않는다)
export function checkDriftLog(log) {
  const lines = log.replace(/\r\n/g, '\n').split('\n').map((l) => l.replace(TS, ''));
  const bad = [];
  lines.forEach((l, i) => {
    for (const v of Object.values(CANARY)) if (l.includes(v)) bad.push({ line: i + 1, rule: 'canary' });
  });
  const start = lines.findIndex((l) => l === '##[group]Run node scripts/ci/run.mjs drift');
  if (start < 0) return [...bad, { line: 0, rule: 'no-step' }];
  for (let i = start; i < lines.length; i++) {
    const l = lines[i];
    if (i > start && (l.startsWith('##[group]Run ') || l.startsWith('Post job cleanup'))) break;
    if (!LOG_ALLOW.some((re) => re.test(l))) bad.push({ line: i + 1, rule: 'shape' });
  }
  return bad;
}

// env: NEEDS, GITHUB_REPOSITORY, GITHUB_RUN_ID, GITHUB_RUN_ATTEMPT. drift 작업이 돌지 않았으면 0.
export function driftLogCheck(env, gh) {
  let needs;
  try {
    needs = JSON.parse(env.NEEDS ?? '');
  } catch {
    console.error('drift-log-check: NEEDS가 JSON이 아니다');
    return 2;
  }
  const r = needs?.drift?.result;
  if (!r || r === 'skipped') {
    console.log(`drift-log-check: drift 작업이 돌지 않았다(${r ?? '없음'}) — 건너뜀`);
    return 0;
  }
  const repo = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) {
    console.error('drift-log-check: GITHUB_REPOSITORY·GITHUB_RUN_ID가 필요하다');
    return 2;
  }
  const attempt = /^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '') ? env.GITHUB_RUN_ATTEMPT : '1';
  const ids = gh(['api', `repos/${repo}/actions/runs/${env.GITHUB_RUN_ID}/attempts/${attempt}/jobs?per_page=100`, '--jq', `.jobs[] | select(.name == ${JSON.stringify(DRIFT_JOB_NAME)}) | .id`])
    .split('\n')
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x));
  if (ids.length !== 1) {
    console.error(`::error::drift-log-check: '${DRIFT_JOB_NAME}' 작업이 ${ids.length}개다`);
    return 1;
  }
  const log = gh(['api', `repos/${repo}/actions/jobs/${ids[0]}/logs`]);
  const bad = checkDriftLog(log);
  const n = log.split('\n').length;
  if (bad.length) {
    for (const b of bad.slice(0, 50)) console.error(`::error::drift-log-check: 로그 ${b.line}번째 줄 — ${b.rule === 'canary' ? '합성 제목·채널·번호(canary)가 보인다' : b.rule === 'no-step' ? 'drift 단계를 찾지 못했다' : '허용 모양이 아니다'}`);
    return 1;
  }
  console.log(`drift-log-check: 작업 로그 ${n}줄, canary 0건, drift 단계의 모든 줄이 허용 모양이다`);
  return 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
