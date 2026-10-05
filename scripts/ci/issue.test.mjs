// node --test scripts/ci/issue.test.mjs — 자동 이슈(docs/design/cicd.md §4.1). gh는 가짜 실행기로 바꾼다.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { readFileSync } from 'node:fs';

import { ROOT } from './gates.mjs';
import { assertPublishable, body, isStale, REPORT_JOB_NAME, reportJobStatus, SCHEDULE_ONLY, jobHistory, JOBS_JQ, KIND_NOTES, KINDS, label, lastJobSuccess, leadingFailures, loopStatuses, marker, masterStatus, NEEDS_LOOPS, refScope, reportLoop, report, runHistory, RUNS_JQ, scheduledWorkflows, sync, threshold, title, validate } from './issue.mjs';
import { parseJobs } from './parity.mjs';

const REPO = 'o/r';
const SHA = 'a'.repeat(40);
const URL = 'https://github.com/o/r/actions/runs/123';

// 이슈 저장소를 흉내 내는 gh. calls에 인자를 남긴다.
function fakeGh({ issues = [], jobs = '', workflows = {}, runs = {}, heads = { master: SHA }, history = {} } = {}) {
  const calls = [];
  let next = 100;
  const gh = (args, input) => {
    calls.push([args, input]);
    const [a, b] = args;
    if (a === 'issue' && b === 'list') {
      const lab = args[args.indexOf('--label') + 1];
      return JSON.stringify(issues.filter((i) => i.open && i.labels.includes(lab)).map(({ number, body }) => ({ number, body })));
    }
    if (a === 'label' && b === 'create') return '';
    if (a === 'issue' && b === 'create') {
      const n = next++;
      issues.push({ number: n, body: input, open: true, labels: [args[args.indexOf('--label') + 1]], comments: [] });
      return `https://github.com/o/r/issues/${n}\n`;
    }
    if (a === 'issue' && b === 'comment') {
      issues.find((i) => i.number === Number(args[2])).comments.push(input);
      return '';
    }
    if (a === 'issue' && b === 'close') {
      const i = issues.find((x) => x.number === Number(args[2]));
      i.open = false;
      i.comments.push(args[args.indexOf('--comment') + 1]);
      return '';
    }
    if (a === 'api' && /\/jobs$/.test(b)) return jobs;
    if (a === 'api' && /\/git\/ref\/heads\//.test(b)) {
      const h = heads[b.split('/git/ref/heads/')[1]];
      if (!h) {
        const e = new Error('gh api → exit 1: HTTP 404');
        e.stderr = 'HTTP 404: Not Found';
        throw e;
      }
      return `${h}\n`;
    }
    if (a === 'api' && /actions\/workflows\/[^/]+$/.test(b)) {
      const f = b.split('/').at(-1);
      if (!workflows[f]) {
        const e = new Error('gh api → exit 1: HTTP 404');
        e.stderr = 'HTTP 404: Not Found';
        throw e;
      }
      return JSON.stringify(workflows[f]);
    }
    // runHistory: 완료 실행 목록({id, event})과 실행별 작업 목록({name, conclusion, completed_at})
    if (a === 'api' && /\/runs\?/.test(b) && args.includes(RUNS_JQ)) {
      assert.match(b, /status=completed/);
      return JSON.stringify((history.runs ?? []).map((r) => ({ head_repository: REPO, ...(typeof r === 'object' ? r : { id: Number(r), event: 'schedule' }) })));
    }
    if (a === 'api' && /\/runs\/\d+\/jobs\?/.test(b) && args.includes(JOBS_JQ)) {
      return JSON.stringify(history.jobs?.[b.split('/')[5]] ?? []);
    }
    if (a === 'api' && /\/runs\?/.test(b)) {
      // nightly-stale은 워크플로 전체의 성공이 아니라 마지막 완료 예약 실행을 본다(구현 중 변경 49)
      assert.match(b, /event=schedule&status=completed/);
      return (runs[b.split('/')[5]] ?? '') + '\n';
    }
    if (a === 'workflow' && b === 'enable') return '';
    throw new Error(`예상 밖 gh 호출: ${args.join(' ')}`);
  };
  return { gh, calls, issues };
}

test('validate: 허용 목록 밖 입력은 거부(이슈를 쓰지 않는다)', () => {
  const base = { loop: 'master-failure', status: 'fail', repo: REPO, runUrl: URL, sha: SHA };
  assert.ok(validate(base));
  assert.throws(() => validate({ ...base, loop: 'x' }), /loop/);
  assert.throws(() => validate({ ...base, status: 'bad' }), /status/);
  assert.throws(() => validate({ ...base, runUrl: 'https://evil.example/x' }), /run-url/);
  assert.throws(() => validate({ ...base, sha: 'abc' }), /sha/);
  assert.throws(() => validate({ ...base, jobs: ['rust (ubuntu)', '제목 <script>'] }), /jobs/);
  assert.throws(() => validate({ ...base, kinds: ['free text'] }), /kind/);
  assert.throws(() => validate({ ...base, workflows: ['../x.yml'] }), /workflows/);
  assert.deepEqual(validate({ ...base, jobs: ['b', 'a', 'a'] }).jobs, ['a', 'b']);
});

test('본문: 마커로 시작하고 허용 필드만, 누출 검사를 통과한다', () => {
  const f = validate({ loop: 'master-failure', status: 'fail', repo: REPO, runUrl: URL, sha: SHA, jobs: ['rust (windows-latest)', 'ci-ok'] });
  const b = body(f, { first: true });
  assert.ok(b.startsWith(marker('master-failure')));
  assert.match(b, /rust \(windows-latest\)/);
  assertPublishable(b);
  assertPublishable(title('master-failure'));
  for (const loop of ['nightly-stale', 'drift', 'release']) assertPublishable(body(validate({ loop, status: 'fail', kinds: ['target_gone'] }), { first: true }));
});

test('assertPublishable: 서명 토큰·실제 ID 모양이 든 본문은 거부', () => {
  const tok = 'https://h.example.invalid/a/hdntl=exp=' + '17000' + '00000' + '~acl=*/x';
  assert.throws(() => assertPublishable(`실패\n${tok}\n`), /누출/);
  assert.throws(() => assertPublishable(`id ${'ab'.repeat(16)}`), /hex-id/);
});

test('sync: 실패 → 생성, 다시 실패 → 댓글, 성공 → 닫기, 다시 성공 → 아무것도 안 함', () => {
  const { gh, issues, calls } = fakeGh();
  const f = { loop: 'master-failure', repo: REPO, runUrl: URL, sha: SHA, jobs: ['lint'] };
  assert.deepEqual(sync({ ...f, status: 'fail' }, gh), { action: 'created', numbers: [100] });
  assert.ok(calls.some(([a]) => a[0] === 'label' && a.includes(label('master-failure')) && a.includes('--force')));
  assert.deepEqual(sync({ ...f, status: 'fail' }, gh), { action: 'commented', numbers: [100] });
  assert.equal(issues.length, 1);
  assert.deepEqual(sync({ ...f, status: 'ok' }, gh), { action: 'closed', numbers: [100] });
  assert.equal(issues[0].open, false);
  assert.match(issues[0].comments.at(-1), /복구/);
  assert.deepEqual(sync({ ...f, status: 'ok' }, gh), { action: 'none', numbers: [] });
  // 다시 실패하면 새 이슈
  assert.deepEqual(sync({ ...f, status: 'fail' }, gh), { action: 'created', numbers: [101] });
});

test('sync: 같은 label이어도 마커가 없는 이슈(사람이 연 것)는 건드리지 않는다', () => {
  const { gh, issues } = fakeGh({ issues: [{ number: 7, body: '사람이 쓴 글', open: true, labels: [label('master-failure')], comments: [] }] });
  assert.deepEqual(sync({ loop: 'master-failure', status: 'ok', repo: REPO }, gh), { action: 'none', numbers: [] });
  assert.equal(issues[0].open, true);
});

test('report: ci-ok 실패면 실패한 작업 이름으로 이슈, 성공이면 닫는다. 예약 워크플로가 없으면 stale 아님', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'on:\n  push:\n');
    const fk = fakeGh({ jobs: 'rust (windows-latest)\nci-ok\nreport\n' });
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master', CI_OK_RESULT: 'failure' };
    assert.equal(report(env, fk.gh, { root }), 0);
    const mf = fk.issues.find((i) => i.labels.includes(label('master-failure')));
    assert.ok(mf.open);
    assert.match(mf.body, /`ci-ok`, `rust \(windows-latest\)`/);
    assert.doesNotMatch(mf.body, /`report`/);
    assert.equal(fk.issues.filter((i) => i.labels.includes(label('nightly-stale'))).length, 0);
    assert.equal(report({ ...env, CI_OK_RESULT: 'success' }, fk.gh, { root }), 0);
    assert.equal(mf.open, false);
    assert.equal(report({ ...env, GITHUB_RUN_ID: 'x' }, fk.gh, { root }), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('masterStatus: ci-ok가 녹색이어도 D14 관찰 작업이 실패·취소면 fail, skipped·없음은 ok', () => {
  const needs = (r) => JSON.stringify({ 'ci-ok': { result: 'success' }, 'e2e-web': { result: 'success' }, 'e2e-native': { result: r } });
  assert.deepEqual(masterStatus('success', needs('success')), { status: 'ok', observedFailed: [] });
  assert.deepEqual(masterStatus('success', needs('failure')), { status: 'fail', observedFailed: ['e2e-native'] });
  assert.deepEqual(masterStatus('success', needs('cancelled')), { status: 'fail', observedFailed: ['e2e-native'] });
  assert.deepEqual(masterStatus('success', needs('skipped')), { status: 'ok', observedFailed: [] });
  assert.deepEqual(masterStatus('success', undefined), { status: 'ok', observedFailed: [] });
  assert.deepEqual(masterStatus('success', '{깨진'), { status: 'ok', observedFailed: [] });
  assert.equal(masterStatus('failure', needs('success')).status, 'fail');
  // 관찰 목록 밖의 작업은 보지 않는다(ci-ok가 판정한다)
  assert.equal(masterStatus('success', JSON.stringify({ rust: { result: 'failure' } })).status, 'ok');
});

test('report: ci-ok 녹색 + 관찰 작업 실패면 master-failure를 열고, 다음 녹색에 닫는다', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'on:\n  push:\n');
    const fk = fakeGh({ jobs: 'e2e-native (linux)\n' });
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master', CI_OK_RESULT: 'success', NEEDS: JSON.stringify({ 'ci-ok': { result: 'success' }, 'e2e-native': { result: 'failure' } }) };
    assert.equal(report(env, fk.gh, { root }), 0);
    const mf = fk.issues.find((i) => i.labels.includes(label('master-failure')));
    assert.ok(mf.open);
    assert.match(mf.body, /`e2e-native \(linux\)`/);
    assert.equal(report({ ...env, NEEDS: JSON.stringify({ 'e2e-native': { result: 'success' } }) }, fk.gh, { root }), 0);
    assert.equal(mf.open, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('report: 예약 워크플로 — 꺼졌으면 켜고, 72시간 넘게 성공이 없으면 nightly-stale, 기본 브랜치에 없으면 건너뜀', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    const sched = 'on:\n  schedule:\n    - cron: "17 18 * * *"\n';
    writeFileSync(join(root, '.github/workflows/nightly.yml'), sched);
    writeFileSync(join(root, '.github/workflows/weekly.yml'), sched);
    writeFileSync(join(root, '.github/workflows/new.yml'), sched);
    assert.deepEqual(scheduledWorkflows(root), ['new.yml', 'nightly.yml', 'weekly.yml']);
    const now = Date.parse('2026-10-05T00:00:00Z');
    const fk = fakeGh({
      workflows: {
        'nightly.yml': { id: 1, state: 'disabled_inactivity', created_at: '2026-01-01T00:00:00Z' },
        'weekly.yml': { id: 2, state: 'active', created_at: '2026-01-01T00:00:00Z' },
      },
      runs: { 'nightly.yml': '1001\t2026-10-04T12:00:00Z', 'weekly.yml': '1002\t2026-09-20T00:00:00Z' },
    });
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '9', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master', CI_OK_RESULT: 'success' };
    assert.equal(report(env, fk.gh, { root, now }), 0);
    assert.ok(fk.calls.some(([a]) => a[0] === 'workflow' && a[1] === 'enable' && a[2] === '1'));
    const st = fk.issues.find((i) => i.labels.includes(label('nightly-stale')));
    assert.ok(st && st.open);
    assert.match(st.body, /`weekly\.yml`/);
    assert.doesNotMatch(st.body, /nightly\.yml|new\.yml/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('report: 머리가 아닌 커밋의 실행은 master-failure를 열지도 닫지도 않는다(늦게 끝난 옛 실행)', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    const OLD = 'b'.repeat(40);
    const base = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '5', GITHUB_RUN_ATTEMPT: '1', GITHUB_REF: 'refs/heads/master' };
    // 열린 이슈가 있고 머리(SHA)는 아직 빨갛다: 옛 커밋 OLD의 녹색 실행이 늦게 끝나도 닫지 않는다
    const open = { number: 3, body: `${marker('master-failure')}\n\n실패`, open: true, labels: [label('master-failure')], comments: [] };
    const fk = fakeGh({ issues: [open], jobs: 'lint\n' });
    assert.equal(report({ ...base, GITHUB_SHA: OLD, CI_OK_RESULT: 'success' }, fk.gh, { root }), 0);
    assert.equal(open.open, true);
    assert.deepEqual(open.comments, []);
    // 머리는 녹색인데 옛 커밋의 빨간 실행이 늦게 끝나도 열지 않는다
    const fk2 = fakeGh({ jobs: 'lint\n' });
    assert.equal(report({ ...base, GITHUB_SHA: OLD, CI_OK_RESULT: 'failure' }, fk2.gh, { root }), 0);
    assert.equal(fk2.issues.length, 0);
    // 머리 커밋의 실행이면 연다. 브랜치 dispatch(loop_test)는 그 브랜치의 머리와 비교한다
    const fk3 = fakeGh({ jobs: 'lint\n', heads: { 'ci/pipeline': OLD } });
    assert.equal(report({ ...base, GITHUB_REF: 'refs/heads/ci/pipeline', GITHUB_SHA: OLD, CI_OK_RESULT: 'failure' }, fk3.gh, { root }), 0);
    assert.equal(fk3.issues.length, 1);
    assert.deepEqual(fk3.issues[0].labels, [label('master-failure', true)], '브랜치 dispatch는 시험 이름공간에만 쓴다');
    // 브랜치가 아닌 ref·브랜치가 없으면 실패(1)로 보고한다
    assert.equal(report({ ...base, GITHUB_REF: 'refs/tags/v1', GITHUB_SHA: SHA, CI_OK_RESULT: 'success' }, fakeGh().gh, { root }), 1);
    assert.equal(report({ ...base, GITHUB_REF: 'refs/heads/gone', GITHUB_SHA: SHA, CI_OK_RESULT: 'success' }, fakeGh().gh, { root }), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('isStale: 마지막 성공(없으면 워크플로 생성 시각)이 72시간보다 오래면 stale', () => {
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(isStale({ lastSuccess: '2026-10-03T00:00:01Z', created: null }, now), false);
  assert.equal(isStale({ lastSuccess: '2026-10-01T23:59:59Z', created: null }, now), true);
  assert.equal(isStale({ lastSuccess: null, created: '2026-10-04T00:00:00Z' }, now), false, '새 워크플로는 72시간 유예');
  assert.equal(isStale({ lastSuccess: null, created: '2026-09-01T00:00:00Z' }, now), true);
  assert.equal(isStale({ lastSuccess: null, created: null }, now), true);
});

test('loopStatuses: 작업마다 fail·ok, skipped는 null, 고리 없는 작업·빈 값은 오류', () => {
  assert.deepEqual(loopStatuses(JSON.stringify({ 'e2e-native-windows': { result: 'skipped' }, 'e2e-native-linux': { result: 'success' } })), [
    { loop: 'e2e-native-linux', status: 'ok', kinds: [], simulated: false },
    { loop: 'e2e-native-windows', status: null, kinds: [], simulated: false },
  ]);
  // outputs.kinds는 KINDS enum만: 모르는 값은 글자를 옮기지 않고 unknown
  const k = loopStatuses(JSON.stringify({ 'e2e-native-linux': { result: 'failure', outputs: { kinds: 'http_5xx, 비밀제목,target_gone,http_5xx' } } }));
  assert.deepEqual(k[0].kinds, ['http_5xx', 'target_gone', 'unknown']);
  assert.deepEqual(loopStatuses(JSON.stringify({ 'e2e-native-linux': { result: 'cancelled' }, 'e2e-native-windows': { result: 'failure' } })).map((x) => x.status), ['fail', 'fail']);
  assert.throws(() => loopStatuses(JSON.stringify({ rust: { result: 'success' } })), /고리가 없는 작업/);
  assert.throws(() => loopStatuses('{}'), /비었거나/);
});

test('reportLoop: Windows 실패 이슈는 Windows가 건너뛴 다음 날(Linux 녹색)에도 열려 있고, Windows 녹색에 닫힌다', () => {
  const fk = fakeGh();
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '77', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const needs = (lin, win) => JSON.stringify({ 'e2e-native-linux': { result: lin }, 'e2e-native-windows': { result: win } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'failure') }, fk.gh), 0);
  const win = () => fk.issues.find((x) => x.labels.includes(label('e2e-native-windows')));
  assert.ok(win().open);
  assert.match(win().body, /`e2e-native-windows`/);
  assert.match(win().body, /actions\/runs\/77/);
  assert.equal(fk.issues.filter((x) => x.labels.includes(label('e2e-native-linux'))).length, 0);
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'skipped') }, fk.gh), 0);
  assert.ok(win().open, '건너뛴 Windows가 이슈를 닫으면 안 된다');
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'success') }, fk.gh), 0);
  assert.equal(win().open, false);
  assert.equal(reportLoop({ ...env, NEEDS: '깨짐' }, fk.gh), 2);
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'success'), GITHUB_RUN_ID: '' }, fk.gh), 2);
});

test('refScope: master만 진짜 이름공간, 다른 브랜치는 시험, 브랜치가 아니면 null', () => {
  assert.deepEqual(refScope('refs/heads/master'), { branch: 'master', test: false });
  assert.deepEqual(refScope('refs/heads/ci/pipeline'), { branch: 'ci/pipeline', test: true });
  assert.equal(refScope('refs/tags/v1'), null);
  assert.equal(refScope(undefined), null);
  assert.equal(label('e2e-native-linux', true), 'ci-loop-test:e2e-native-linux');
  assert.ok(!marker('e2e-native-linux', true).startsWith(marker('e2e-native-linux').slice(0, -4)), '시험 마커는 진짜 마커의 접두가 아니다');
});

// 리뷰(G4): 브랜치 loop_test dispatch의 녹색이 master·예약 실행이 연 진짜 이슈(#3)를 닫았다
test('reportLoop: master가 아닌 브랜치는 ci-loop: 이슈를 열지도 닫지도 않고 ci-loop-test:에만 쓴다', () => {
  const real = { number: 3, body: `${marker('e2e-native-windows')}\n\n실패`, open: true, labels: [label('e2e-native-windows')], comments: [] };
  const fk = fakeGh({ issues: [real] });
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '78', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/ci/pipeline' };
  const needs = (lin, win) => JSON.stringify({ 'e2e-native-linux': { result: lin }, 'e2e-native-windows': { result: win } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('failure', 'success') }, fk.gh), 0);
  assert.equal(real.open, true);
  assert.deepEqual(real.comments, []);
  for (const [args] of fk.calls) {
    const i = args.indexOf('--label');
    if (i >= 0) assert.match(args[i + 1], /^ci-loop-test:/);
    if (args[0] === 'label') assert.match(args[2], /^ci-loop-test:/);
  }
  const t = fk.issues.find((x) => x.labels.includes(label('e2e-native-linux', true)));
  assert.ok(t && t.open && t.body.startsWith(marker('e2e-native-linux', true)));
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'success') }, fk.gh), 0);
  assert.equal(t.open, false);
  assert.equal(real.open, true, '진짜 이슈는 그대로');
  assert.equal(reportLoop({ ...env, GITHUB_REF: 'refs/tags/v1', NEEDS: needs('success', 'success') }, fk.gh), 2);
  assert.equal(reportLoop({ ...env, GITHUB_REF: undefined, NEEDS: needs('success', 'success') }, fk.gh), 2);
});

// 리뷰(G4): 매주 Windows 작업이 예약 누락·조건식 어긋남으로 조용히 꺼져도 고리가 열려야 한다
test('reportLoop: 건너뛴 작업의 마지막 성공이 staleHours보다 오래면 fail(stale)로 열고, 그 작업이 녹색이면 닫는다', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  const W = NEEDS_LOOPS['e2e-native-windows'].name;
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '79', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const needs = (lin, win) => JSON.stringify({ 'e2e-native-linux': { result: lin }, 'e2e-native-windows': { result: win } });
  const workflows = { 'nightly.yml': { id: 1, state: 'active', created_at: '2026-09-01T00:00:00Z' } };
  // 최근 실행 3개 중 Windows는 10일 전에만 성공 → stale
  const fk = fakeGh({
    workflows,
    history: { runs: [30, 20, 10], jobs: { 10: [{ name: W, conclusion: 'success', completed_at: '2026-10-10T00:00:00Z' }] } },
  });
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'skipped') }, fk.gh, { now }), 0);
  const win = fk.issues.find((x) => x.labels.includes(label('e2e-native-windows')));
  assert.ok(win && win.open);
  assert.match(win.body, /`stale`/);
  // 7일 전에 성공했으면(한계 8일) 건드리지 않는다: 새 저장소(이슈 없음)
  const fk2 = fakeGh({ workflows, history: { runs: [30, 20], jobs: { 20: [{ name: W, conclusion: 'success', completed_at: '2026-10-13T00:00:00Z' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'skipped') }, fk2.gh, { now }), 0);
  assert.equal(fk2.issues.length, 0);
  // 성공 기록이 없어도 워크플로가 새것이면(생성 8일 안) 유예, 워크플로가 기본 브랜치에 없으면(404) 건너뜀
  const fk3 = fakeGh({ workflows: { 'nightly.yml': { id: 1, created_at: '2026-10-15T00:00:00Z' } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'skipped') }, fk3.gh, { now }), 0);
  assert.equal(fk3.issues.length, 0);
  const fk4 = fakeGh();
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'skipped') }, fk4.gh, { now }), 0);
  assert.equal(fk4.issues.length, 0);
  // 열린 stale 이슈는 Windows 녹색에 닫힌다
  assert.equal(reportLoop({ ...env, NEEDS: needs('success', 'success') }, fk.gh, { now }), 0);
  assert.equal(win.open, false);
});

test('lastJobSuccess: 새 실행부터 그 이름의 작업이 success인 첫 시각, 없으면 null', () => {
  const j = (c, t) => [{ name: 'x', conclusion: c, completed_at: t }];
  const fk = fakeGh({ history: { runs: [3, 2, 1], jobs: { 3: j('failure', '2026-10-03T00:00:00Z'), 2: j('success', '2026-10-02T00:00:00Z'), 1: j('success', '2026-10-01T00:00:00Z') } } });
  const h = runHistory(fk.gh, { repo: REPO, workflow: 'nightly.yml', branch: 'master' });
  assert.equal(lastJobSuccess(h, { jobName: 'x' }), '2026-10-02T00:00:00Z');
  assert.equal(lastJobSuccess(h, { jobName: 'y' }), null);
  // 실행 목록·실행별 작업 목록은 한 번씩만 읽는다(고리 수와 무관한 API 호출 수)
  const apis = fk.calls.filter(([a]) => a[0] === 'api').map(([a]) => a[1]);
  assert.equal(apis.length, new Set(apis).size);
});

// stale 판정은 작업 표시 이름으로 찾으므로 nightly.yml의 name:과 같아야 한다(이름을 바꾸면 여기서 걸린다)
test('NEEDS_LOOPS: 키는 nightly.yml 작업 id, name은 그 작업의 name:, report의 needs와 같다', () => {
  const jobs = parseJobs(readFileSync(`${ROOT}/.github/workflows/nightly.yml`, 'utf8'));
  for (const [id, { name }] of Object.entries(NEEDS_LOOPS)) {
    assert.ok(jobs[id], `nightly.yml에 작업 ${id}가 없다`);
    assert.equal(jobs[id].name, name);
  }
  assert.deepEqual([...jobs.report.needs].sort(), Object.keys(NEEDS_LOOPS).sort());
});

// G5: drift는 2회 연속 실패에 연다(no_target은 3회). 연속은 같은 브랜치의 완료된 비-PR 실행에서 그 작업이 돈 것만 센다.
const DRIFT = { name: 'nightly drift', staleHours: 72, consecutive: 2, consecutiveKinds: { no_target: 3 } };
const LOOPS2 = { drift: DRIFT };

test('threshold·leadingFailures: kind별 문턱, 새것부터 이어지는 실패 수', () => {
  assert.equal(threshold(DRIFT, ['http_5xx']), 2);
  assert.equal(threshold(DRIFT, ['no_target']), 3);
  assert.equal(threshold(DRIFT, ['no_target', 'http_5xx']), 2, '섞이면 기본 문턱');
  assert.equal(threshold(DRIFT, []), 2);
  assert.equal(threshold({ name: 'x', staleHours: 1 }, ['no_target']), 1);
  assert.equal(leadingFailures(['failure', 'cancelled', 'success', 'failure']), 2);
  assert.equal(leadingFailures(['success', 'failure']), 0);
  assert.equal(leadingFailures([]), 0);
});

test('jobHistory: PR 실행·작업이 없거나 건너뛴 실행은 빼고, 지금 실행은 넣지 않는다', () => {
  const d = (c) => [{ name: 'nightly drift', conclusion: c, completed_at: null }, { name: 'other', conclusion: 'failure', completed_at: null }];
  const fk = fakeGh({
    history: {
      runs: [{ id: 55, event: 'pull_request' }, 50, 45, 40, 30, 20],
      jobs: { 55: d('failure'), 50: d('failure'), 40: d('skipped'), 30: [{ name: 'other', conclusion: 'success' }], 20: d('success') },
    },
  });
  const h = () => runHistory(fk.gh, { repo: REPO, workflow: 'nightly.yml', branch: 'master' });
  assert.deepEqual(jobHistory(h(), { jobName: 'nightly drift' }), ['failure', 'success']);
  assert.deepEqual(jobHistory(h(), { jobName: 'nightly drift', excludeRunId: '50' }), ['success']);
});

test('reportLoop(drift): 한 번 실패는 아무것도 안 하고, 두 번 연속이면 열고(kind·할 일 문구), 성공 한 번에 닫는다', () => {
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '60', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const needs = (result, kinds) => JSON.stringify({ drift: { result, outputs: kinds ? { kinds } : {} } });
  // 첫 실패(앞 실행은 성공): 문턱 아래 → 이슈 없음, 댓글 없음
  const fk = fakeGh({ history: { runs: [59], jobs: { 59: [{ name: 'nightly drift', conclusion: 'success' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('failure', 'target_gone') }, fk.gh, { loops: LOOPS2 }), 0);
  assert.equal(fk.issues.length, 0);
  // 두 번째 연속 실패: 연다. 본문에 kind와 고정 할 일 문구
  const fk2 = fakeGh({ history: { runs: [59, 58], jobs: { 59: [{ name: 'nightly drift', conclusion: 'failure' }], 58: [{ name: 'nightly drift', conclusion: 'success' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('failure', 'target_gone') }, fk2.gh, { loops: LOOPS2 }), 0);
  assert.equal(fk2.issues.length, 1);
  const d = fk2.issues[0];
  assert.ok(d.open && d.labels.includes(label('drift')));
  assert.match(d.body, /`target_gone`/);
  assert.ok(d.body.includes(KIND_NOTES.drift.target_gone));
  // 다시 실패: 댓글
  assert.equal(reportLoop({ ...env, NEEDS: needs('failure', 'target_gone') }, fk2.gh, { loops: LOOPS2 }), 0);
  assert.equal(d.comments.length, 1);
  // 성공 한 번에 닫는다(연속 규칙은 여는 쪽에만)
  assert.equal(reportLoop({ ...env, NEEDS: needs('success') }, fk2.gh, { loops: LOOPS2 }), 0);
  assert.equal(d.open, false);
});

test('reportLoop(drift): 문턱 아래의 실패는 열린 이슈에 댓글도 닫기도 하지 않는다, no_target은 3회', () => {
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '70', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const needs = (kinds) => JSON.stringify({ drift: { result: 'failure', outputs: { kinds } } });
  const open = { number: 9, body: `${marker('drift')}\n\n실패`, open: true, labels: [label('drift')], comments: [] };
  const fk = fakeGh({ issues: [open], history: { runs: [69], jobs: { 69: [{ name: 'nightly drift', conclusion: 'success' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('http_5xx') }, fk.gh, { loops: LOOPS2 }), 0);
  assert.deepEqual(open.comments, []);
  assert.equal(open.open, true);
  // no_target: 두 번 연속은 아직, 세 번이면 연다
  const two = fakeGh({ history: { runs: [69, 68], jobs: { 69: [{ name: 'nightly drift', conclusion: 'failure' }], 68: [{ name: 'nightly drift', conclusion: 'success' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('no_target') }, two.gh, { loops: LOOPS2 }), 0);
  assert.equal(two.issues.length, 0);
  const three = fakeGh({ history: { runs: [69, 68], jobs: { 69: [{ name: 'nightly drift', conclusion: 'failure' }], 68: [{ name: 'nightly drift', conclusion: 'failure' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs('no_target') }, three.gh, { loops: LOOPS2 }), 0);
  assert.equal(three.issues.length, 1);
  assert.ok(three.issues[0].body.includes(KIND_NOTES.drift.no_target));
});

test('본문: 할 일 문구는 실패에만, 고정 문구라 누출 검사를 통과한다', () => {
  for (const [loop, notes] of Object.entries(KIND_NOTES)) {
    assert.ok(Object.hasOwn(NEEDS_LOOPS, loop), loop);
    for (const [k, t] of Object.entries(notes)) {
      assert.ok(KINDS.includes(k), k);
      assertPublishable(t);
    }
  }
  const f = validate({ loop: 'drift', status: 'ok', repo: REPO, kinds: ['target_gone'] });
  assert.doesNotMatch(body(f), /할 일/);
  // 문구는 고리마다: 같은 kind라도 다른 고리에는 붙지 않는다
  assert.doesNotMatch(body(validate({ loop: 'fuzz', status: 'fail', repo: REPO, kinds: ['auth'] })), /할 일/);
  assert.ok(body(validate({ loop: 'ruleset-drift', status: 'fail', repo: REPO, kinds: ['auth'] })).includes('RULESET_READ_TOKEN'));
});

// 리뷰(G5): master의 simulate dispatch가 진짜 ci-loop:drift를 열거나 닫으면 안 되고, dispatch 결과가 예약 실행의 연속을 바꾸면 안 된다
test('reportLoop(drift): 합성 결과(simulated)는 master에서도 시험 이름공간에만, 진짜 연속은 예약 실행만 센다', () => {
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '80', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const real = { number: 11, body: `${marker('drift')}\n\n실패`, open: true, labels: [label('drift')], comments: [] };
  const fk = fakeGh({ issues: [real], history: { runs: [79], jobs: { 79: [{ name: 'nightly drift', conclusion: 'failure' }] } } });
  // simulate=ok가 진짜 이슈를 닫지 않는다
  assert.equal(reportLoop({ ...env, NEEDS: JSON.stringify({ drift: { result: 'success', outputs: { simulated: 'true' } } }) }, fk.gh, { loops: LOOPS2 }), 0);
  assert.equal(real.open, true);
  // simulate=target_gone 두 번째(앞 실행 실패)는 시험 이름공간에 연다
  assert.equal(reportLoop({ ...env, NEEDS: JSON.stringify({ drift: { result: 'failure', outputs: { kinds: 'target_gone', simulated: 'true' } } }) }, fk.gh, { loops: LOOPS2 }), 0);
  assert.deepEqual(real.comments, []);
  assert.ok(fk.issues.some((i) => i.open && i.labels.includes(label('drift', true))));
  // 진짜 이름공간: 앞의 dispatch 실패는 세지 않는다(예약 실행만) → 첫 실패라 아무것도 안 함
  const fk2 = fakeGh({ history: { runs: [{ id: 79, event: 'workflow_dispatch' }, { id: 78, event: 'schedule' }], jobs: { 79: [{ name: 'nightly drift', conclusion: 'failure' }], 78: [{ name: 'nightly drift', conclusion: 'success' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: JSON.stringify({ drift: { result: 'failure', outputs: { kinds: 'http_5xx', simulated: 'false' } } }) }, fk2.gh, { loops: LOOPS2 }), 0);
  assert.equal(fk2.issues.length, 0);
  // 앞의 예약 실행이 실패였으면 연다
  const fk3 = fakeGh({ history: { runs: [{ id: 79, event: 'workflow_dispatch' }, { id: 78, event: 'schedule' }], jobs: { 79: [{ name: 'nightly drift', conclusion: 'success' }], 78: [{ name: 'nightly drift', conclusion: 'failure' }] } } });
  assert.equal(reportLoop({ ...env, NEEDS: JSON.stringify({ drift: { result: 'failure', outputs: { kinds: 'http_5xx' } } }) }, fk3.gh, { loops: LOOPS2 }), 0);
  assert.equal(fk3.issues.length, 1);
  assert.ok(fk3.issues[0].labels.includes(label('drift')));
});

// 리뷰(G5): 머지 뒤 첫 예약 실행이 매주 작업(성공 기록 없음, 워크플로 생성은 오래 전)을 바로 stale로 열면 안 된다
test('reportLoop: 성공 기록이 없을 때 stale 기준은 워크플로 생성과 이 브랜치의 가장 오래된 완료 실행 중 늦은 쪽, 실행이 없으면 유예', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '90', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const W = { 'nightly.yml': { id: 1, state: 'active', created_at: '2026-10-05T00:00:00Z' } };
  const needs = JSON.stringify({ 'e2e-native-linux': { result: 'success' }, 'e2e-native-windows': { result: 'skipped' } });
  const fk = fakeGh({ workflows: W });
  assert.equal(reportLoop({ ...env, NEEDS: needs }, fk.gh, { now }), 0);
  assert.equal(fk.issues.filter((i) => i.labels.includes(label('e2e-native-windows'))).length, 0, '완료 실행이 없으면 유예');
  const recent = fakeGh({ workflows: W, history: { runs: [{ id: 5, event: 'schedule', created_at: '2026-10-30T00:00:00Z' }] } });
  assert.equal(reportLoop({ ...env, NEEDS: needs }, recent.gh, { now }), 0);
  assert.equal(recent.issues.length, 0, '관찰 시작(첫 실행) 뒤 8일이 안 됐다');
  const old = fakeGh({ workflows: W, history: { runs: [{ id: 6, event: 'schedule', created_at: '2026-10-31T00:00:00Z' }, { id: 5, event: 'schedule', created_at: '2026-10-20T00:00:00Z' }] } });
  assert.equal(reportLoop({ ...env, NEEDS: needs }, old.gh, { now }), 0);
  assert.equal(old.issues.filter((i) => i.labels.includes(label('e2e-native-windows'))).length, 1);
});

// 리뷰(G5): PR 실행(fork의 master 브랜치 PR 포함)의 작업 성공이 매주 작업의 stale을 가렸다(37345297740의 Windows E2E)
test('runHistory: 진짜 이름공간은 질의에 event=schedule을 붙이고, 다른 저장소(fork)·다른 event의 실행은 세지 않는다', () => {
  const W = 'nightly e2e-native (windows)';
  const ok = (t) => [{ name: W, conclusion: 'success', completed_at: t }];
  const fk = fakeGh({
    history: {
      runs: [
        { id: 9, event: 'pull_request', head_repository: 'fork/r' },
        { id: 8, event: 'schedule', head_repository: 'fork/r' },
        { id: 7, event: 'pull_request' },
        { id: 6, event: 'workflow_dispatch' },
        { id: 5, event: 'schedule' },
      ],
      jobs: { 9: ok('2026-10-09T00:00:00Z'), 8: ok('2026-10-08T00:00:00Z'), 7: ok('2026-10-07T00:00:00Z'), 6: ok('2026-10-06T00:00:00Z'), 5: ok('2026-10-01T00:00:00Z') },
    },
  });
  const real = runHistory(fk.gh, { repo: REPO, workflow: 'nightly.yml', branch: 'master', events: SCHEDULE_ONLY });
  assert.deepEqual(real.runs().map((r) => r.id), ['5']);
  assert.equal(lastJobSuccess(real, { jobName: W }), '2026-10-01T00:00:00Z');
  assert.ok(fk.calls.some(([a]) => a[0] === 'api' && /runs\?branch=master&event=schedule&status=completed/.test(a[1])));
  // 시험 이름공간: pull_request만 빼고 dispatch는 센다. fork 실행은 여기서도 뺀다
  const t = runHistory(fk.gh, { repo: REPO, workflow: 'nightly.yml', branch: 'ci/x' });
  assert.deepEqual(t.runs().map((r) => r.id), ['6', '5']);
  assert.equal(lastJobSuccess(t, { jobName: W }), '2026-10-06T00:00:00Z');
});

// 리뷰(G5): report 작업 자신의 실패(gh 오류·NEEDS 어긋남)는 아무도 보지 않았다
test('reportLoop: 앞 실행의 nightly report가 실패면 nightly-report를 열고, 성공이면 닫는다', () => {
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '50', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master' };
  const needs = JSON.stringify({ 'e2e-native-linux': { result: 'success' } });
  const rep = (c) => [{ name: REPORT_JOB_NAME, conclusion: c, completed_at: null }];
  const fk = fakeGh({ history: { runs: [{ id: 50, event: 'schedule' }, { id: 49, event: 'workflow_dispatch' }, { id: 48, event: 'schedule' }], jobs: { 50: rep('success'), 49: rep('success'), 48: rep('failure') } } });
  assert.equal(reportLoop({ ...env, NEEDS: needs }, fk.gh), 0);
  const nr = fk.issues.find((i) => i.labels.includes(label('nightly-report')));
  assert.ok(nr && nr.open, '지금 실행(50)과 dispatch(49)는 빼고 앞 예약 실행(48)의 실패를 본다');
  assert.match(nr.body, /`nightly report`/);
  const h = (jobs) => runHistory(fakeGh({ history: { runs: [3, 2], jobs } }).gh, { repo: REPO, workflow: 'nightly.yml', branch: 'master', events: SCHEDULE_ONLY });
  assert.equal(reportJobStatus(h({ 3: rep('success') }), { excludeRunId: '3' }), null, '앞 실행에 report가 없다');
  assert.equal(reportJobStatus(h({ 2: rep('cancelled') }), { excludeRunId: '3' }), null);
  assert.equal(reportJobStatus(h({ 2: rep('success') }), { excludeRunId: '3' }), 'ok');
  const fk2 = fakeGh({ issues: fk.issues, history: { runs: [{ id: 51, event: 'schedule' }, { id: 50, event: 'schedule' }], jobs: { 50: rep('success') } } });
  assert.equal(reportLoop({ ...env, GITHUB_RUN_ID: '51', NEEDS: needs }, fk2.gh), 0);
  assert.equal(nr.open, false);
});

test('report(ci.yml): 마지막 예약 실행의 nightly report가 실패면 nightly-report를 연다(조용한 저장소에서는 push가 있어야 돈다)', () => {
  const root = mkdtempSync(join(tmpdir(), 'report-'));
  try {
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/nightly.yml'), 'on:\n  schedule:\n    - cron: "17 18 * * *"\n');
    const now = Date.parse('2026-10-05T00:00:00Z');
    const fk = fakeGh({
      workflows: { 'nightly.yml': { id: 1, state: 'active', created_at: '2026-01-01T00:00:00Z' } },
      runs: { 'nightly.yml': '1001\t2026-10-04T12:00:00Z' },
      history: { jobs: { 1001: [{ name: REPORT_JOB_NAME, conclusion: 'failure' }] } },
    });
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '9', GITHUB_SHA: SHA, GITHUB_REF: 'refs/heads/master', CI_OK_RESULT: 'success' };
    assert.equal(report(env, fk.gh, { root, now }), 0);
    assert.equal(fk.issues.filter((i) => i.labels.includes(label('nightly-stale'))).length, 0, '스케줄러는 살아 있다');
    const nr = fk.issues.find((i) => i.labels.includes(label('nightly-report')));
    assert.ok(nr && nr.open);
    assert.match(nr.body, /`nightly\.yml`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 리뷰(G5): 제목이 원인을 단정했다(조회 실패에도 '새 Rust stable이 나왔다')
test('LOOPS 제목은 원인을 단정하지 않고, kind별 할 일 문구가 원인을 말한다', () => {
  for (const loop of ['toolchain', 'advisories', 'ruleset-drift', 'fuzz', 'pins', 'mutants']) assert.match(title(loop), /검사가 실패했다/, loop);
  assert.ok(body(validate({ loop: 'toolchain', status: 'fail', repo: REPO, kinds: ['outdated'] })).includes(KIND_NOTES.toolchain.outdated));
  assert.equal(threshold(NEEDS_LOOPS.toolchain, ['network']), 2);
  assert.equal(threshold(NEEDS_LOOPS.toolchain, ['outdated']), 1);
  assert.equal(threshold(NEEDS_LOOPS['drift-log'], ['log_canary']), 1);
});
