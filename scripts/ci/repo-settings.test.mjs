// node --test scripts/ci/repo-settings.test.mjs — 설정·ruleset drift 판정(gh는 가짜)
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { check, diffExpect, main, MISSING } from './repo-settings.mjs';

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
