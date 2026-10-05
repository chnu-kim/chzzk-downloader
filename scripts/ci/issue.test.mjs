// node --test scripts/ci/issue.test.mjs — 자동 이슈(docs/design/cicd.md §4.1). gh는 가짜 실행기로 바꾼다.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { assertPublishable, body, isStale, label, marker, report, scheduledWorkflows, sync, title, validate } from './issue.mjs';

const REPO = 'o/r';
const SHA = 'a'.repeat(40);
const URL = 'https://github.com/o/r/actions/runs/123';

// 이슈 저장소를 흉내 내는 gh. calls에 인자를 남긴다.
function fakeGh({ issues = [], jobs = '', workflows = {}, runs = {} } = {}) {
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
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: SHA, CI_OK_RESULT: 'failure' };
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
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_RUN_ID: '9', GITHUB_SHA: SHA, CI_OK_RESULT: 'success' };
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

test('isStale: 마지막 성공(없으면 워크플로 생성 시각)이 72시간보다 오래면 stale', () => {
  const now = Date.parse('2026-10-05T00:00:00Z');
  assert.equal(isStale({ lastSuccess: '2026-10-03T00:00:01Z', created: null }, now), false);
  assert.equal(isStale({ lastSuccess: '2026-10-01T23:59:59Z', created: null }, now), true);
  assert.equal(isStale({ lastSuccess: null, created: '2026-10-04T00:00:00Z' }, now), false, '새 워크플로는 72시간 유예');
  assert.equal(isStale({ lastSuccess: null, created: '2026-09-01T00:00:00Z' }, now), true);
  assert.equal(isStale({ lastSuccess: null, created: null }, now), true);
});
