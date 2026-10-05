// node --test scripts/ci/issue.test.mjs — 자동 이슈(docs/design/cicd.md §4.1). gh는 가짜 실행기로 바꾼다.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertPublishable, body, isStale, label, loopStatuses, marker, masterStatus, reportLoop, report, scheduledWorkflows, sync, title, validate } from './issue.mjs';

const REPO = 'o/r';
const SHA = 'a'.repeat(40);
const URL = 'https://github.com/o/r/actions/runs/123';

// 이슈 저장소를 흉내 내는 gh. calls에 인자를 남긴다.
function fakeGh({ issues = [], jobs = '', workflows = {}, runs = {}, heads = { master: SHA } } = {}) {
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
    if (a === 'api' && /\/runs\?/.test(b)) return (runs[b.split('/')[5]] ?? '') + '\n';
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
      runs: { 'nightly.yml': '2026-10-04T12:00:00Z', 'weekly.yml': '2026-09-20T00:00:00Z' },
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
    { loop: 'e2e-native-linux', status: 'ok' },
    { loop: 'e2e-native-windows', status: null },
  ]);
  assert.deepEqual(loopStatuses(JSON.stringify({ 'e2e-native-linux': { result: 'cancelled' }, 'e2e-native-windows': { result: 'failure' } })).map((x) => x.status), ['fail', 'fail']);
  assert.throws(() => loopStatuses(JSON.stringify({ rust: { result: 'success' } })), /고리가 없는 작업/);
  assert.throws(() => loopStatuses('{}'), /비었거나/);
});

test('reportLoop: Windows 실패 이슈는 Windows가 건너뛴 다음 날(Linux 녹색)에도 열려 있고, Windows 녹색에 닫힌다', () => {
  const fk = fakeGh();
  const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '77', GITHUB_SHA: SHA };
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
