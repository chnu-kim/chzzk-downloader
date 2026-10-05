// node --test scripts/ci/drift-classify.test.mjs — drift 분류기와 drift.mjs의 로그 위생(docs/design/cicd.md §4.3).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CANARY, classify, DRIFT_TESTS, RULES, SIMULATE, SYNTHETIC, syntheticOutput } from './drift-classify.mjs';
import { BUILD_BEGIN, BUILD_END, BUILD_STEPS, BUILD_TIMEOUT_MS, buildEnv, checkDriftLog, dlArgs, dlTarget, driftLogCheck, judgeDl, judgeLive, judgeRun, logKinds, nonEmptyFileCount, RUN_TIMEOUT_MS, SETUP_MARGIN_MS, summarize } from './drift.mjs';
import { parseJobs } from './parity.mjs';
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
    assert.match(r.output, new RegExp(`^status=fail\\nkinds=${kind}\\nsimulated=true\\n$`));
    for (const t of DRIFT_TESTS) assert.match(r.text, new RegExp(`drift: ${t} fail ${kind}`));
    noCanary(r.text, `${kind} 로그`);
    noCanary(r.summary, `${kind} 요약`);
    noCanary(r.output, `${kind} 출력`);
  }
  const ok = runDrift({ DRIFT_SIMULATE: 'ok' });
  assert.equal(ok.status, 0);
  assert.equal(ok.output, "status=ok\nkinds=\nsimulated=true\n");
  noCanary(ok.text, 'ok 로그');
});

test('drift.mjs: 대상 secret이 하나도 없으면 빌드 없이 no_target(exit 1), 잘못된 simulate는 2', () => {
  const r = runDrift({});
  assert.equal(r.status, 1);
  assert.equal(r.output, "status=fail\nkinds=no_target\nsimulated=false\n");
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
  // 실서버 경로의 빌드 줄: 성공은 고정 한 줄, cargo 진행 줄은 찍지 않는다(찍히면 모양 위반)
  const built = ['drift: cargo test -p chzzk-core --test live --locked --no-run', 'drift: 빌드 통과', 'drift: cargo build -p chzzk-core --example dl --locked', 'drift: 빌드 통과'];
  assert.deepEqual(checkDriftLog(jobLog([...built, ...step])).filter((b) => b.rule !== 'canary'), []);
  assert.deepEqual(checkDriftLog(jobLog([built[0], '   Compiling chzzk-core v0.1.0 (/home/runner/work/x/x/crates/core)', ...step])).filter((b) => b.rule !== 'canary').map((b) => b.rule), ['shape']);
  // 빌드 실패: 표시 사이의 컴파일러 출력(warning·error·코드 줄)은 모양을 보지 않는다. canary는 거기서도 잡는다. 끝 표시가 없으면 위반
  const compiler = ['warning: unused variable: `x`', '  --> crates/core/src/lib.rs:3:9', '   |', '3  |     let x = 1;', '   |         ^ help: if this is intentional, prefix it with an underscore: `_x`', 'error[E0425]: cannot find function `nope` in this scope', 'error: could not compile `chzzk-core` (lib) due to 1 previous error'];
  const failed = [built[0], BUILD_BEGIN, ...compiler, BUILD_END, 'drift: 빌드 실패(exit 101)', ...step];
  assert.deepEqual(checkDriftLog(jobLog(failed)).filter((b) => b.rule !== 'canary'), []);
  const strip = (t) => t.replace(new RegExp(`.*${CANARY.channel}.*\\n`), '');
  assert.deepEqual(checkDriftLog(strip(jobLog([built[0], BUILD_BEGIN, `x ${CANARY.title}`, BUILD_END, ...step]))).map((b) => b.rule), ['canary']);
  assert.ok(checkDriftLog(strip(jobLog([built[0], BUILD_BEGIN, ...compiler]))).some((b) => b.rule === 'shape'));
  assert.deepEqual(logKinds([{ rule: 'shape' }, { rule: 'canary' }, { rule: 'no-step' }]), ['log_canary', 'log_shape']);
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
  // 실패는 kind를 GITHUB_OUTPUT에 낸다(report가 ci-loop:drift-log 이슈로 연다). 로그를 받지 못하면 network
  const d = mkdtempSync(join(tmpdir(), 'dlc-'));
  try {
    const out = join(d, 'out');
    const kinds = async (g, f) => {
      writeFileSync(out, '');
      const code = await driftLogCheck({ ...env, NEEDS: needs, GITHUB_OUTPUT: out }, g, f);
      return `${code} ${readFileSync(out, 'utf8').trim()}`.trim();
    };
    assert.equal(await kinds(gh(), fl(real)), '0');
    assert.equal(await kinds(gh(), fl(log + `\n${CANARY.title}`)), '1 kinds=log_canary');
    assert.equal(await kinds(gh(), fl(log.replace('drift: dl pass', 'drift: dl pass\nHLS .part 4194304 B'))), '1 kinds=log_shape');
    assert.equal(await kinds(gh(), async () => { throw new Error('작업 로그 HTTP 502'); }), '1 kinds=network');
    assert.equal(await kinds(() => { throw new Error('gh: HTTP 500'); }, fl(real)), '1 kinds=network');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

// 리뷰(G5): `--exact`에 맞는 테스트가 없으면 cargo는 "running 0 tests … ok"로 exit 0이다(실측). 통과로 보면 실서버를 보지
// 않은 녹색이 ci-loop:drift를 닫는다
test('judgeLive: exit 0이어도 정확히 1개가 돌아 통과해야 pass, 0개면 kind test', () => {
  const zero = 'running 0 tests\n\ntest result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 4 filtered out; finished in 0.00s\n';
  assert.deepEqual(judgeLive({ status: 0, stdout: zero, stderr: '' }), { result: 'fail', kind: 'test' });
  assert.deepEqual(judgeLive({ status: 0, stdout: syntheticOutput('ok', 'live_hls_partial'), stderr: '' }), { result: 'pass', kind: null });
  const real = 'running 1 test\ntest live_hls_partial ... ok\n\ntest result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 3 filtered out; finished in 9.87s\n';
  assert.deepEqual(judgeLive({ status: 0, stdout: real, stderr: '' }), { result: 'pass', kind: null });
  assert.deepEqual(judgeLive({ status: 0, stdout: real.replace('1 passed', '2 passed'), stderr: '' }), { result: 'fail', kind: 'test' });
  assert.deepEqual(judgeLive({ status: 101, stdout: syntheticOutput('http_5xx', 'live_hls_partial'), stderr: '' }), { result: 'fail', kind: 'http_5xx' });
});

// 리뷰(G5): dl이 아무것도 쓰지 않고 0으로 끝나도 통과였다
test('judgeDl·nonEmptyFileCount: exit 0이어도 크기 > 0인 파일이 없으면 media_invalid, 하위 폴더도 센다', () => {
  const d = mkdtempSync(join(tmpdir(), 'dl-'));
  try {
    assert.equal(nonEmptyFileCount(d), 0);
    writeFileSync(join(d, 'empty.mp4'), '');
    assert.equal(nonEmptyFileCount(d), 0);
    mkdirSync(join(d, 'sub'));
    writeFileSync(join(d, 'sub', `${CANARY.title}.mp4`), 'x');
    assert.equal(nonEmptyFileCount(d), 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  assert.deepEqual(judgeDl({ status: 0, stdout: '' }, 0), { result: 'fail', kind: 'media_invalid' });
  assert.deepEqual(judgeDl({ status: 0, stdout: '' }, 1), { result: 'pass', kind: null });
  assert.deepEqual(judgeDl({ status: 1, stdout: '\n실패: HTTP 503' }, 0), { result: 'fail', kind: 'http_5xx' });
  // dl은 --limit-mb로 멈추면 --keep 없이는 .part를 지운다: 그러면 실서버 dl이 늘 media_invalid다
  const dl = readFileSync(join(ROOT, 'crates/core/examples/dl.rs'), 'utf8');
  assert.match(dl, /"--keep" =>/);
  assert.match(dl, /if !args\.keep \{\s*discard_partial/);
  const a = dlArgs('https://chzzk.naver.com/video/1', '/tmp/x');
  assert.ok(a.includes('--keep') && a.includes('--limit-mb'));
});

// 리뷰(G5): 빌드(의존성 build.rs·proc-macro)가 영상 번호 secret을 읽을 수 있었다
test('buildEnv: CHZZK_LIVE_*와 RUST_LOG를 빼고 나머지는 둔다', () => {
  const e = buildEnv({ PATH: '/bin', CHZZK_LIVE_HLS: '1', CHZZK_LIVE_DASH: '2', CHZZK_LIVE_CLIP: '3', chzzk_live_x: '4', RUST_LOG: 'debug', DRIFT_SIMULATE: 'none' });
  assert.deepEqual(Object.keys(e).sort(), ['CARGO_TERM_COLOR', 'DRIFT_SIMULATE', 'PATH', 'RUST_BACKTRACE']);
});

// 리뷰(G5): 작업 제한(45분)이 스크립트 제한 합(빌드 2×30 + 실행 4×10)보다 짧아 시간 초과가 kind 없는 실패가 됐다
test('drift 시간: 빌드·실행 제한 합 + 여유 ≤ nightly.yml drift 작업의 timeout-minutes', () => {
  const body = parseJobs(readFileSync(join(ROOT, '.github/workflows/nightly.yml'), 'utf8')).drift.body.join('\n');
  const minutes = Number(/^ {4}timeout-minutes: (\d+)/m.exec(body)?.[1]);
  assert.ok(minutes > 0, 'drift 작업의 timeout-minutes를 읽지 못했다');
  const worst = BUILD_STEPS * BUILD_TIMEOUT_MS + DRIFT_TESTS.length * RUN_TIMEOUT_MS + SETUP_MARGIN_MS;
  assert.ok(worst <= minutes * 60 * 1000, `최악 ${worst / 60000}분 > 작업 제한 ${minutes}분`);
});

// 리뷰(G5): DRIFT_TESTS와 live.rs의 함수 이름을 잇는 것이 없었다(이름을 바꾸면 drift가 영원히 녹색)
test('DRIFT_TESTS(dl 제외) = crates/core/tests/live.rs의 #[ignore] 테스트 함수 이름', () => {
  const src = readFileSync(join(ROOT, 'crates/core/tests/live.rs'), 'utf8');
  // #[ignore…] 뒤 속성들 다음의 (async) fn 이름
  const ignored = [...src.matchAll(/#\[ignore\b[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+([a-z0-9_]+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(ignored, DRIFT_TESTS.filter((t) => t !== 'dl').sort());
});
