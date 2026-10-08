// node --test scripts/ci/commit-msg.test.mjs — 커밋 제목 형식(scan-msg의 형식 절반, CI의 subjects)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkMessage, checkSubject, editorSubject, storedSubject } from './commit-msg.mjs';
import { gitEnv, gitOk } from './test-git.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'commit-msg.mjs');

test('type(scope)?: 요약은 통과한다', () => {
  for (const m of ['feat: 기능', 'fix(core): 고침', 'ci: G2 훅\n\n본문\n\nCo-Authored-By: x <x@example.invalid>', 'revert: 되돌림', 'feat!: 깨지는 변경', 'fix(core)!: 형식 바꿈']) {
    assert.equal(checkMessage(m), null, m);
  }
});

test('형식이 아니면 거부한다', () => {
  for (const m of ['Add feature', 'feat:no space', 'feat : x', 'feature: x', 'feat(): x', 'feat: ', '', '# 주석만\n', 'feat !: x', 'feat!x', 'feat!!: x', 'feat(core) !: x']) {
    assert.notEqual(checkMessage(m), null, JSON.stringify(m));
  }
});

test('git이 만드는 제목(merge·revert·fixup/squash/amend)은 통과한다', () => {
  for (const m of ["Merge branch 'master' into ci/pipeline", 'Revert "feat: 기능"', 'fixup! feat: 기능', 'squash! fix: x', 'amend! docs: y']) {
    assert.equal(checkMessage(m), null, m);
  }
});

test('편집기 기준: 주석 줄·scissors 아래는 제목이 아니다, core.commentChar를 따른다', () => {
  assert.equal(editorSubject('# Please enter the commit message\nfeat: x\n'), 'feat: x');
  assert.equal(editorSubject('\n\n# c\n# ------------------------ >8 ------------------------\nfeat: x\n'), '');
  assert.equal(editorSubject('; c\nfix: y\n', ';'), 'fix: y');
  assert.equal(editorSubject('# x\nfix: y\n', ';'), '# x');
});

test('저장된 메시지: 첫 줄을 그대로 본다(-m "# x" -m "fix: y"는 제목이 # x다)', () => {
  assert.equal(storedSubject('# x\n\nfix: y\n'), '# x');
  assert.notEqual(checkSubject(storedSubject('# x\n\nfix: y\n')), null);
  assert.equal(checkSubject(storedSubject('fix: y\r\n\r\nbody')), null);
});

test('--stored: 기준선 이후 저장된 제목을 검사한다(실제 git 이력)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'commit-msg-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const g = (...a) => gitOk(dir, a);
  g('init', '-q');
  g('commit', '-q', '--allow-empty', '-m', 'Initial legacy subject');
  const base = g('rev-parse', 'HEAD');
  g('commit', '-q', '--allow-empty', '-m', 'feat: 기능');
  g('commit', '-q', '--allow-empty', '--cleanup=verbatim', '-m', '# x', '-m', 'fix: y');
  const run = (rev) => {
    // 기준선 상수(공개 master) 대신 이 임시 저장소의 첫 커밋을 기준선 인자로 준다
    const code = `import('${pathToFileURL(SCRIPT).href}').then((m) => { const r = m.checkStored('${rev}', '${base}'); console.log(JSON.stringify(r)); })`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: dir, env: gitEnv(), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const all = run('HEAD');
  assert.equal(all.n, 2);
  assert.equal(all.bad.length, 1, '# x 제목이 걸려야 한다');
  assert.equal(run('HEAD~1').bad.length, 0);
  // 얕은 클론 등으로 기준선이 없으면 2
  const shallow = spawnSync(process.execPath, [SCRIPT, '--stored'], { cwd: dir, env: gitEnv(), encoding: 'utf8' });
  assert.equal(shallow.status, 2, shallow.stderr);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--stored', '--all'], { cwd: dir, env: gitEnv() }).status, 2);
});
