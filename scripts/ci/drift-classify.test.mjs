// node --test scripts/ci/drift-classify.test.mjs — drift 분류기와 drift.mjs의 로그 위생(docs/design/cicd.md §4.3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CANARY, classify, DRIFT_TESTS, RULES, SIMULATE, SYNTHETIC, syntheticOutput } from './drift-classify.mjs';
import { checkDriftLog, dlTarget, driftLogCheck, judgeRun, summarize } from './drift.mjs';
import { ROOT } from './gates.mjs';
import { KINDS } from './issue.mjs';

test('합성 출력: kind마다 그 kind로 분류된다(모든 테스트 이름), ok는 통과 출력', () => {
  for (const kind of Object.keys(SYNTHETIC)) {
    for (const t of DRIFT_TESTS) assert.equal(classify(syntheticOutput(kind, t)), kind, `${kind}/${t}`);
  }
  assert.ok(SIMULATE.includes('ok'));
  assert.throws(() => syntheticOutput('nope', 'dl'), /모르는 simulate/);
});

// 실제 출력 모양: 라이브 테스트의 unwrap·panic(Debug)과 examples/dl.rs의 "실패: <Display>"
const REAL = [
  ['called `Result::unwrap()` on an `Err` value: HttpStatus { status: 404, kind: Api }', 'target_gone'],
  ['called `Result::unwrap()` on an `Err` value: Api { code: 404, message: Some("x") }', 'target_gone'],
  ['called `Result::unwrap()` on an `Err` value: NoPlayback { adult: false }', 'target_gone'],
  ['\n실패: HTTP 404', 'target_gone'],
  ['\n실패: 재생 정보가 없습니다', 'target_gone'],
  ['called `Result::unwrap()` on an `Err` value: HttpStatus { status: 502, kind: Mpd }', 'http_5xx'],
  ['\n실패: HTTP 503', 'http_5xx'],
  ['called `Result::unwrap()` on an `Err` value: HttpStatus { status: 404, kind: Media }', 'http_4xx'],
  ['\n실패: HTTP 429', 'http_4xx'],
  ['\n실패: 로그인/성인 인증이 필요합니다 (HTTP 401)', 'auth'],
  ['\n실패: 응답 형식 오류(mpd): 화질 없음', 'schema_mismatch'],
  ['\n실패: API 오류 9001: None', 'schema_mismatch'],
  ['assertion `left == right` failed: 대상의 재생 방식이 다르다\n  left: Progressive', 'schema_mismatch'],
  ['Err(Unsupported(Discontinuity))', 'schema_mismatch'],
  ['\n실패: 첫 상자가 ftyp가 아닙니다: ["moof"]', 'media_invalid'],
  ['Err(LengthMismatch { expected: 10, actual: 9 })', 'media_invalid'],
  ['\n실패: 네트워크 오류: error sending request', 'network'],
  ['Err(Network(reqwest::Error { kind: Request, source: hyper_util::client::legacy::Error(Connect, TimedOut) }))', 'timeout'],
  ["thread 'x' panicked at src/lib.rs:1:1:\nboom", 'panic'],
  ['아무 말', 'unknown'],
  ['', 'unknown'],
];

test('실제 출력 모양 표: Error 변종(Debug)과 dl의 Display 문구가 고정 kind로', () => {
  for (const [text, want] of REAL) assert.equal(classify(text), want, JSON.stringify(text));
});

test('분류 결과는 늘 KINDS 안이고, 규칙의 kind도 모두 KINDS다', () => {
  for (const [kind] of RULES) assert.ok(KINDS.includes(kind), kind);
  for (const [text] of REAL) assert.ok(KINDS.includes(classify(text)));
});

test('judgeRun: 0 → pass, 시간 초과 → timeout, 실행 오류 → unknown, 그 밖은 출력 분류', () => {
  assert.deepEqual(judgeRun({ status: 0, stdout: CANARY.title }), { result: 'pass', kind: null });
  assert.deepEqual(judgeRun({ status: null, signal: 'SIGTERM', error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }), { result: 'fail', kind: 'timeout' });
  assert.deepEqual(judgeRun({ status: null, error: new Error('ENOENT') }), { result: 'fail', kind: 'unknown' });
  assert.deepEqual(judgeRun({ status: 101, stdout: syntheticOutput('http_5xx', 'dl'), stderr: '' }), { result: 'fail', kind: 'http_5xx' });
});

test('summarize·dlTarget: 실패 kind 중복 제거, 숫자 대상만 주소로', () => {
  const s = summarize([
    { test: 'a', result: 'fail', kind: 'http_5xx', extra: CANARY.title },
    { test: 'b', result: 'pass', kind: null },
    { test: 'c', result: 'fail', kind: 'http_5xx' },
  ]);
  assert.deepEqual(s.kinds, ['http_5xx']);
  assert.equal(s.status, 'fail');
  assert.doesNotMatch(JSON.stringify(s), new RegExp(CANARY.title));
  assert.equal(dlTarget({ CHZZK_LIVE_DASH: ' 12 ', CHZZK_LIVE_HLS: '34' }), 'https://chzzk.naver.com/video/12');
  assert.equal(dlTarget({ CHZZK_LIVE_HLS: '34' }), 'https://chzzk.naver.com/video/34');
  assert.equal(dlTarget({ CHZZK_LIVE_DASH: '1; rm -rf /' }), null);
  assert.equal(dlTarget({}), null);
});

// drift.mjs를 실제 프로세스로 돌려 stdout·stderr·GITHUB_OUTPUT·GITHUB_STEP_SUMMARY에 canary(합성 제목·채널·번호)가
// 한 글자도 없는지 본다. 실서버 출력의 제목이 로그에 새지 않는다는 성질의 결정적 검사다.
function runDrift(extraEnv) {
  const d = mkdtempSync(join(tmpdir(), 'drift-'));
  try {
    const out = join(d, 'out');
    const sum = join(d, 'sum');
    writeFileSync(out, '');
    writeFileSync(sum, '');
    const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, ...extraEnv };
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/drift.mjs')], { env, encoding: 'utf8' });
    return { status: r.status, text: `${r.stdout}${r.stderr}`, output: readFileSync(out, 'utf8'), summary: readFileSync(sum, 'utf8') };
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const noCanary = (s, what) => {
  for (const v of Object.values(CANARY)) assert.ok(!s.includes(v), `${what}에 canary ${v}`);
};

test('drift.mjs simulate: kind마다 exit 1·kinds 출력, ok는 0, 어디에도 canary가 없다', () => {
  for (const kind of ['target_gone', 'http_5xx', 'schema_mismatch', 'no_target', 'panic', 'unknown']) {
    const r = runDrift({ DRIFT_SIMULATE: kind });
    assert.equal(r.status, 1, kind);
    assert.match(r.output, new RegExp(`^status=fail\\nkinds=${kind}\\n$`));
    for (const t of DRIFT_TESTS) assert.match(r.text, new RegExp(`drift: ${t} fail ${kind}`));
    noCanary(r.text, `${kind} 로그`);
    noCanary(r.summary, `${kind} 요약`);
    noCanary(r.output, `${kind} 출력`);
  }
  const ok = runDrift({ DRIFT_SIMULATE: 'ok' });
  assert.equal(ok.status, 0);
  assert.equal(ok.output, 'status=ok\nkinds=\n');
  noCanary(ok.text, 'ok 로그');
});

test('drift.mjs: 대상 secret이 하나도 없으면 빌드 없이 no_target(exit 1), 잘못된 simulate는 2', () => {
  const r = runDrift({});
  assert.equal(r.status, 1);
  assert.equal(r.output, 'status=fail\nkinds=no_target\n');
  assert.doesNotMatch(r.text, /cargo/);
  assert.equal(runDrift({ DRIFT_SIMULATE: '$(id)' }).status, 2);
});

// Actions 작업 로그 모양: 줄마다 타임스탬프, 단계 머리(##[group]Run …, env 표시), run.mjs의 ::group:: 줄
function jobLog(stepLines) {
  const ts = (l) => `2026-10-06T03:17:00.1234567Z ${l}`;
  return [
    '##[group]Run actions/checkout@abc',
    'with:',
    `  repository: ${CANARY.channel}`, // 다른 단계의 줄은 모양 검사 대상이 아니다(canary는 어디서든 잡는다 — 아래에서 따로)
    '##[endgroup]',
    '##[group]Run node scripts/ci/run.mjs drift',
    'node scripts/ci/run.mjs drift',
    'shell: /usr/bin/bash -e {0}',
    'env:',
    '  CARGO_TERM_COLOR: always',
    '  CHZZK_LIVE_HLS: ***',
    '  DRIFT_SIMULATE: target_gone',
    '##[endgroup]',
    '##[group]drift: node scripts/ci/drift.mjs',
    ...stepLines,
    '##[endgroup]',
    '##[error][drift] 실패(exit 1): drift: node scripts/ci/drift.mjs',
    '##[error]Process completed with exit code 1.',
    'Post job cleanup.',
    '[command]/usr/bin/git version',
  ]
    .map(ts)
    .join('\n');
}

test('checkDriftLog: drift 단계의 실제 출력은 통과, canary·허용 밖 줄은 줄 번호로만 걸린다', () => {
  const r = runDrift({ DRIFT_SIMULATE: 'target_gone' });
  // Actions는 ::error:: 명령을 로그에 ##[error]로 남긴다
  const step = r.text.split('\n').filter(Boolean).map((l) => l.replace(/^::error::/, '##[error]'));
  // checkout 단계의 canary 줄을 빼면 깨끗하다
  const clean = jobLog(step).replace(new RegExp(`.*${CANARY.channel}.*\\n`), '');
  assert.deepEqual(checkDriftLog(clean), []);
  // 다른 단계라도 canary는 잡는다
  assert.deepEqual(checkDriftLog(jobLog(step)).map((b) => b.rule), ['canary']);
  // drift 단계 안의 서버 응답 같은 줄
  const leak = checkDriftLog(jobLog([...step, `완료 ${CANARY.title}.mp4`]).replace(new RegExp(`.*${CANARY.channel}.*\\n`), ''));
  assert.deepEqual(leak.map((b) => b.rule), ['canary', 'shape']);
  const odd = checkDriftLog(jobLog([...step, 'HLS .part 4194304 B, 상자 12개']).replace(new RegExp(`.*${CANARY.channel}.*\\n`), ''));
  assert.deepEqual(odd.map((b) => b.rule), ['shape']);
  assert.deepEqual(checkDriftLog('2026-10-06T00:00:00Z nothing').map((b) => b.rule), ['no-step']);
  // 실서버 경로의 빌드 줄
  assert.deepEqual(checkDriftLog(jobLog(['drift: cargo test -p chzzk-core --test live --locked --no-run', '   Compiling chzzk-core v0.1.0 (/home/runner/work/x/x/crates/core)', '    Finished `test` profile [unoptimized + debuginfo] target(s) in 41.12s', '  Executable tests/live.rs (target/debug/deps/live-0123abcd)', ...step])).filter((b) => b.rule !== 'canary'), []);
});

test('driftLogCheck: drift가 건너뛰면 0, 작업 로그를 받아 판정, 작업이 없으면 1', async () => {
  const env = { GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '5', GITHUB_RUN_ATTEMPT: '1' };
  assert.equal(await driftLogCheck({ ...env, NEEDS: JSON.stringify({ drift: { result: 'skipped' } }) }, () => assert.fail('gh를 부르면 안 된다')), 0);
  assert.equal(await driftLogCheck({ ...env, NEEDS: '깨짐' }, () => ''), 2);
  const step = runDrift({ DRIFT_SIMULATE: 'ok' }).text.split('\n').filter(Boolean).map((l) => l.replace(/^::error::/, '##[error]'));
  const log = jobLog(step).replace(new RegExp(`.*${CANARY.channel}.*\\n`), '');
  const gh = (ids = '42\n') => () => ids;
  const fl = (text) => async (repo, id) => {
    assert.equal(id, '42');
    return text;
  };
  const needs = JSON.stringify({ drift: { result: 'success' } });
  // 실제 로그처럼 BOM과 ANSI 색 코드가 섞여도 통과한다
  const real = '\uFEFF' + log.replace('Z node scripts/ci/run.mjs drift', 'Z \x1b[36;1mnode scripts/ci/run.mjs drift\x1b[0m');
  assert.equal(await driftLogCheck({ ...env, NEEDS: needs }, gh(), fl(real)), 0);
  assert.equal(await driftLogCheck({ ...env, NEEDS: needs }, gh(), fl(log + `\n${CANARY.title}`)), 1);
  assert.equal(await driftLogCheck({ ...env, NEEDS: needs }, gh(''), fl(log)), 1);
});
