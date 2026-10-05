// node --test scripts/ci/repo-settings.test.mjs — 설정·ruleset drift 판정(gh는 가짜)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { check, diffExpect, main, MISSING, planEntry, planRulesets, project } from './repo-settings.mjs';

test('diffExpect: 선언한 필드만, 없는 필드는 불일치, 배열은 type 순', () => {
  assert.deepEqual(diffExpect({ a: 1, b: { c: 'x' } }, { a: 1, b: { c: 'x', d: 2 }, e: 3 }), []);
  assert.deepEqual(diffExpect({ a: 1 }, { a: 2 }), [{ path: 'a', want: 1, got: 2 }]);
  // 토큰 권한이 모자라 security_and_analysis가 빠진 응답은 일치가 아니다
  assert.deepEqual(diffExpect({ s: { x: { status: 'enabled' } } }, { name: 'r' }), [{ path: 's', want: { x: { status: 'enabled' } }, got: MISSING }]);
  assert.deepEqual(diffExpect({ rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }] }, { rules: [{ type: 'non_fast_forward' }, { type: 'deletion' }] }), []);
  assert.equal(diffExpect({ rules: [{ type: 'deletion' }] }, { rules: [{ type: 'deletion' }, { type: 'update' }] }).length, 1);
});

const SETTINGS = { wf: { endpoint: 'repos/{repo}/actions/permissions/workflow', expect: { default_workflow_permissions: 'read' } } };
function fake({ wf = { default_workflow_permissions: 'read' }, rulesets = [], full = {}, fail } = {}) {
  return (args) => {
    const p = args[1];
    if (fail && p.includes(fail)) {
      const e = new Error('gh api → exit 1');
      e.stderr = 'HTTP 403: Resource not accessible by integration';
      throw e;
    }
    if (p === 'repos/o/r/actions/permissions/workflow') return JSON.stringify(wf);
    if (p.startsWith('repos/o/r/rulesets?')) return JSON.stringify(rulesets);
    const m = /^repos\/o\/r\/rulesets\/(\d+)$/.exec(p);
    if (m) return JSON.stringify(full[m[1]]);
    throw new Error(`예상 밖: ${p}`);
  };
}

test('check: 설정 같음·다름, ruleset 이름 집합과 내용', () => {
  assert.deepEqual(check({ repo: 'o/r', settings: SETTINGS, rulesets: [], gh: fake() }), []);
  assert.match(check({ repo: 'o/r', settings: SETTINGS, rulesets: [], gh: fake({ wf: { default_workflow_permissions: 'write' } }) })[0], /wf\.default_workflow_permissions: 선언 "read", 실제 "write"/);
  // 선언 없는 ruleset이 저장소에 있다(누가 손으로 만들었다), 선언한 것이 없다(지워졌다)
  assert.match(check({ repo: 'o/r', settings: {}, rulesets: [], gh: fake({ rulesets: [{ id: 1, name: 'x' }] }) })[0], /선언이 없다/);
  assert.match(check({ repo: 'o/r', settings: {}, rulesets: [{ name: 'master' }], gh: fake() })[0], /저장소에 없다/);
  const decl = { name: 'master', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] };
  const full = { 7: { id: 7, name: 'master', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }], bypass_actors: [] } };
  assert.deepEqual(check({ repo: 'o/r', settings: {}, rulesets: [decl], gh: fake({ rulesets: [{ id: 7, name: 'master' }], full }) }), []);
  full[7].enforcement = 'disabled';
  assert.match(check({ repo: 'o/r', settings: {}, rulesets: [decl], gh: fake({ rulesets: [{ id: 7, name: 'master' }], full }) })[0], /enforcement/);
});

test('main: 같으면 0, 다르면 1, 403은 2(RULESET_READ_TOKEN 안내), 인자 오류 2', () => {
  const root = mkdtempSync(join(tmpdir(), 'rs-'));
  try {
    mkdirSync(join(root, 'scripts/ci'), { recursive: true });
    writeFileSync(join(root, 'scripts/ci/repo-settings.json'), JSON.stringify({ settings: SETTINGS }));
    const env = { GITHUB_REPOSITORY: 'o/r' };
    assert.equal(main(['--check'], env, fake(), root), 0);
    assert.equal(main(['--check'], env, fake({ wf: { default_workflow_permissions: 'write' } }), root), 1);
    assert.equal(main(['--check'], env, fake({ fail: 'permissions' }), root), 2);
    assert.equal(main([], env, fake(), root), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('normalize: 배열은 집합(type이 같은 원소의 순서도 무시)', () => {
  const a = [{ name: 'master', type: 'branch' }, { name: 'dev', type: 'branch' }];
  assert.deepEqual(diffExpect({ p: a }, { p: [...a].reverse() }), []);
  assert.equal(diffExpect({ p: a }, { p: [a[0]] }).length, 1);
});

test('project: pick한 경로의 배열 원소에서 선언한 키만 남긴다', () => {
  const actual = { protection_rules: [{ id: 1, node_id: 'x', type: 'wait_timer', wait_timer: 5 }], name: 'release' };
  assert.deepEqual(project(actual, { protection_rules: ['type', 'wait_timer'] }), { protection_rules: [{ type: 'wait_timer', wait_timer: 5 }], name: 'release' });
  assert.equal(actual.protection_rules[0].id, 1);
});

const ENV = {
  endpoint: 'repos/{repo}/environments/release',
  pick: { protection_rules: ['type', 'wait_timer'] },
  expect: { can_admins_bypass: false, protection_rules: [{ type: 'branch_policy' }] },
  apply: { method: 'PUT', body: { wait_timer: 0, can_admins_bypass: false } },
};
const POL = {
  endpoint: 'repos/{repo}/environments/release/deployment-branch-policies',
  pick: { branch_policies: ['name', 'type'] },
  expect: { branch_policies: [{ name: 'master', type: 'branch' }, { name: 'v*', type: 'tag' }] },
  apply: { kind: 'set', key: 'branch_policies', endpoint: 'repos/{repo}/environments/release/deployment-branch-policies' },
};
const pol = (...xs) => ({ total_count: xs.length, branch_policies: xs.map(([name, type], i) => ({ id: 10 + i, node_id: `n${i}`, name, type })) });

test('planEntry 환경: 정책 집합·wait timer·관리자 우회가 다르면 불일치이고 적용 계획이 나온다', () => {
  // 같음(id·node_id·순서는 보지 않는다)
  assert.deepEqual(planEntry('pol', POL, 'o/r', pol(['v*', 'tag'], ['master', 'branch'])), { problems: [], calls: [] });
  // 정책 * 가 더해지면 실패하고 그것만 지운다
  const extra = planEntry('pol', POL, 'o/r', pol(['master', 'branch'], ['v*', 'tag'], ['*', 'branch']));
  assert.equal(extra.problems.length, 1);
  assert.deepEqual(extra.calls.map((c) => `${c.method} ${c.endpoint}`), ['DELETE repos/o/r/environments/release/deployment-branch-policies/12']);
  // 태그 정책이 빠지면 더한다(body는 {name,type})
  const missing = planEntry('pol', POL, 'o/r', pol(['master', 'branch']));
  assert.deepEqual(missing.calls, [{ method: 'POST', endpoint: 'repos/o/r/environments/release/deployment-branch-policies', body: { name: 'v*', type: 'tag' }, desc: 'pol: {"name":"v*","type":"tag"} 더함' }]);
  const base = { can_admins_bypass: false, protection_rules: [{ id: 1, node_id: 'a', type: 'branch_policy' }] };
  assert.deepEqual(planEntry('env', ENV, 'o/r', base).problems, []);
  const timer = { ...base, protection_rules: [...base.protection_rules, { id: 2, node_id: 'b', type: 'wait_timer', wait_timer: 5 }] };
  assert.match(planEntry('env', ENV, 'o/r', timer).problems[0], /protection_rules/);
  const r = planEntry('env', ENV, 'o/r', { ...base, can_admins_bypass: true });
  assert.match(r.problems[0], /can_admins_bypass/);
  assert.deepEqual(r.calls[0].body, { wait_timer: 0, can_admins_bypass: false });
  // apply가 없으면 수동
  assert.equal(planEntry('x', { ...ENV, apply: undefined }, 'o/r', { ...base, can_admins_bypass: true }).calls[0].manual, true);
});

test('planRulesets: 없으면 POST(file 키 없이), 다르면 PUT, 선언에 없으면 DELETE', () => {
  const decl = { file: '.github/rulesets/master.json', name: 'master', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] };
  const created = planRulesets('o/r', [decl], [], {});
  assert.deepEqual(created.calls[0].body, { name: 'master', target: 'branch', enforcement: 'active', rules: [{ type: 'deletion' }] });
  assert.equal(created.calls[0].method, 'POST');
  const full = { 7: { id: 7, name: 'master', target: 'branch', enforcement: 'disabled', rules: [{ type: 'deletion' }] } };
  assert.deepEqual(planRulesets('o/r', [decl], [{ id: 7, name: 'master' }], full).calls.map((c) => `${c.method} ${c.endpoint}`), ['PUT repos/o/r/rulesets/7']);
  assert.deepEqual(planRulesets('o/r', [], [{ id: 9, name: 'hand' }], {}).calls.map((c) => `${c.method} ${c.endpoint}`), ['DELETE repos/o/r/rulesets/9']);
});

// 쓰기 호출을 기록하는 가짜 gh. state를 바꿔 적용 뒤 --check가 0이 되는지 본다.
function writable() {
  const state = { wf: { default_workflow_permissions: 'write' }, rulesets: [] };
  const writes = [];
  const gh = (args, input) => {
    if (args[1] === '--method') {
      writes.push(`${args[2]} ${args[3]}`);
      if (args[3] === 'repos/o/r/actions/permissions/workflow') state.wf = JSON.parse(input);
      if (args[3] === 'repos/o/r/rulesets') state.rulesets.push({ id: 7, ...JSON.parse(input) });
      return '{}';
    }
    const p = args[1];
    if (p === 'repos/o/r/actions/permissions/workflow') return JSON.stringify(state.wf);
    if (p.startsWith('repos/o/r/rulesets?')) return JSON.stringify(state.rulesets.map(({ id, name }) => ({ id, name })));
    if (p === 'repos/o/r/rulesets/7') return JSON.stringify(state.rulesets[0]);
    throw new Error(`예상 밖: ${p}`);
  };
  return { gh, writes };
}

test('main --apply: 기본은 계획만(쓰기 없음, 바꿀 것이 있으면 1), --yes는 쓰고 --check 결과(0)', () => {
  const root = mkdtempSync(join(tmpdir(), 'rs-'));
  try {
    mkdirSync(join(root, 'scripts/ci'), { recursive: true });
    mkdirSync(join(root, '.github/rulesets'), { recursive: true });
    writeFileSync(join(root, 'scripts/ci/repo-settings.json'), JSON.stringify({ settings: { wf: { ...SETTINGS.wf, apply: { method: 'PUT' } } } }));
    writeFileSync(join(root, '.github/rulesets/master.json'), JSON.stringify({ name: 'master', target: 'branch', enforcement: 'active' }));
    const env = { GITHUB_REPOSITORY: 'o/r' };
    const quiet = () => {};
    const dry = writable();
    assert.equal(main(['--apply'], env, dry.gh, root, quiet), 1);
    assert.deepEqual(dry.writes, []);
    const w = writable();
    assert.equal(main(['--apply', '--yes'], env, w.gh, root, quiet), 0);
    assert.deepEqual(w.writes, ['PUT repos/o/r/actions/permissions/workflow', 'POST repos/o/r/rulesets']);
    // 이제 계획할 것이 없다
    assert.equal(main(['--apply'], env, w.gh, root, quiet), 0);
    assert.equal(main(['--check', '--yes'], env, w.gh, root, quiet), 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// 실제 선언과 저장소 파일의 정합(결정적, 네트워크 없음)
const decl = JSON.parse(readFileSync(join(ROOT, 'scripts/ci/repo-settings.json'), 'utf8')).settings;
const workflows = readdirSync(join(ROOT, '.github/workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => readFileSync(join(ROOT, '.github/workflows', f), 'utf8'));

test('선언: 워크플로가 쓰는 action은 모두 허용 목록 안이다(used ⊆ allowed)', () => {
  const sel = decl.actions_selected.expect;
  const allowed = (repo) => (sel.github_owned_allowed && /^(actions|github)\//.test(repo)) || sel.patterns_allowed.includes(`${repo}@*`);
  const used = new Set(workflows.flatMap((t) => [...t.matchAll(/^\s*(?:-\s*)?uses:\s*([^@\s]+)@/gm)].map((m) => m[1].split('/').slice(0, 2).join('/'))));
  assert.ok(used.size > 0);
  for (const u of used) assert.ok(u.startsWith('./') || allowed(u), `${u}가 actions_selected 허용 목록에 없다`);
  assert.equal(decl.actions_permissions.expect.sha_pinning_required, true);
});

// 환경 이름은 `environment: <이름>` 또는 `${{ … && '<이름>' || '' }}` 꼴이다
test('선언: 워크플로가 쓰는 환경마다 설정·배포 정책 선언이 있고 모두 적용 방법이 있다', () => {
  const envs = new Set(workflows.flatMap((t) => [...t.matchAll(/^\s*environment:\s*(.+)$/gm)].flatMap((m) => [...m[1].matchAll(/&& '([a-z]+)'|^([a-z]+)\s*$/g)].map((x) => x[1] ?? x[2]))));
  assert.deepEqual([...envs].sort(), ['audit', 'drift', 'release']);
  for (const e of envs) {
    assert.ok(decl[`environment_${e}`] && decl[`environment_${e}_policies`], `환경 ${e} 선언 없음`);
    assert.equal(decl[`environment_${e}`].expect.can_admins_bypass, false);
  }
  for (const [n, s] of Object.entries(decl)) assert.ok(s.apply, `${n}에 apply가 없다`);
  assert.equal(decl.fork_pr_contributor_approval.expect.approval_policy, 'all_external_contributors');
});
