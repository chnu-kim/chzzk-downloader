// node --test scripts/ci/snapshot.test.mjs — 훅의 조건부 gate가 작업 트리가 아니라 커밋·push될 내용에서 도는지.
// 임시 저장소에 가짜 진입점 scripts/ci/run.mjs(gate `chk`: state.txt가 bad면 1)를 커밋하고, 인덱스·커밋·작업 트리를
// 서로 다르게 만든 뒤 runHookGates의 종료 코드로 어느 트리를 봤는지 확인한다.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { headIsCleanAt, indexMatchesWorktree, runHookGates } from './snapshot.mjs';
import { gitEnv, gitOk } from './test-git.mjs';

const FAKE = `import { readFileSync, appendFileSync } from 'node:fs';
const [gate] = process.argv.slice(2);
appendFileSync(process.env.SNAP_LOG, process.cwd() + '\\n');
if (gate !== 'chk') process.exit(2);
process.exit(readFileSync('state.txt', 'utf8').trim() === 'bad' ? 1 : 0);
`;

let d;
let repo;
let logFile;
const env = () => gitEnv({ extra: { SNAP_LOG: logFile } });
const g = (...a) => gitOk(repo, a);
const quiet = { log: () => {} };
const run = (target) => runHookGates(repo, target, ['chk'], env(), quiet);
const write = (text) => writeFileSync(join(repo, 'state.txt'), text + '\n');

before(() => {
  d = mkdtempSync(join(tmpdir(), 'snapshot-'));
  repo = join(d, 'repo');
  logFile = join(d, 'log.txt');
  mkdirSync(join(repo, 'scripts', 'ci'), { recursive: true });
  gitOk(d, ['init', '-q', repo]);
  writeFileSync(join(repo, 'scripts', 'ci', 'run.mjs'), FAKE);
  write('good');
  g('add', '-A');
  g('commit', '-q', '-m', 'chore: 시작');
});

after(() => rmSync(d, { recursive: true, force: true }));

const worktrees = () => g('worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).length;
// 가짜 진입점이 마지막으로 돈 폴더
const lastCwd = () => readFileSync(logFile, 'utf8').trim().split('\n').at(-1);

test('pre-commit: 깨끗하면 제자리, 올린 bad·작업 트리 good이면 인덱스를 본다(1)', () => {
  assert.equal(indexMatchesWorktree(repo, env()), true);
  assert.equal(run({ index: true }), 0);
  assert.equal(realpathSync(lastCwd()), realpathSync(repo), '제자리에서 돌아야 한다');
  write('bad');
  g('add', 'state.txt');
  write('good');
  assert.equal(indexMatchesWorktree(repo, env()), false);
  assert.equal(run({ index: true }), 1, '인덱스(bad)를 봐야 한다');
  assert.match(lastCwd(), /chzzk-hook-/, '임시 worktree에서 돌아야 한다');
  assert.equal(worktrees(), 1, '임시 worktree가 남았다');
  // 반대: 올린 good, 작업 트리 bad
  write('good');
  g('add', 'state.txt');
  write('bad');
  assert.equal(run({ index: true }), 0, '인덱스(good)를 봐야 한다');
  write('good');
});

test('pre-commit: 추적하지 않는 새 파일이 있으면 임시 worktree', () => {
  writeFileSync(join(repo, 'new.txt'), 'x\n');
  assert.equal(indexMatchesWorktree(repo, env()), false);
  rmSync(join(repo, 'new.txt'));
  assert.equal(indexMatchesWorktree(repo, env()), true);
});

test('pre-commit: GIT_INDEX_FILE(commit -a·commit <경로>의 임시 인덱스)을 따른다', () => {
  const alt = join(d, 'alt-index');
  const e = { ...env(), GIT_INDEX_FILE: alt };
  gitOk(repo, ['read-tree', 'HEAD'], { extra: { GIT_INDEX_FILE: alt } });
  write('bad');
  gitOk(repo, ['add', 'state.txt'], { extra: { GIT_INDEX_FILE: alt } });
  write('good');
  assert.equal(runHookGates(repo, { index: true }, ['chk'], e, quiet), 1, '임시 인덱스(bad)를 봐야 한다');
  assert.equal(run({ index: true }), 0, '기본 인덱스는 good');
});

test('pre-push: 커밋 bad·작업 트리 good(더러움)이면 커밋을 본다(1), 깨끗한 HEAD는 제자리', () => {
  write('bad');
  g('commit', '-q', '-am', 'test: bad');
  const bad = g('rev-parse', 'HEAD');
  assert.equal(headIsCleanAt(repo, bad, env()), true);
  assert.equal(run({ sha: bad }), 1);
  assert.equal(realpathSync(lastCwd()), realpathSync(repo));
  write('good'); // 고친 것은 작업 트리에만 있다
  assert.equal(headIsCleanAt(repo, bad, env()), false);
  assert.equal(run({ sha: bad }), 1, '작업 트리의 수정이 push 결과를 바꾸면 안 된다');
  g('commit', '-q', '-am', 'fix: good');
  const good = g('rev-parse', 'HEAD');
  // HEAD가 아닌 커밋을 push(git push origin <다른 커밋>:x)
  assert.equal(run({ sha: bad }), 1);
  assert.equal(run({ sha: good }), 0);
  assert.equal(worktrees(), 1);
});

test('gate 목록이 비면 아무것도 돌리지 않는다', () => {
  assert.equal(runHookGates(repo, { index: true }, [], env(), quiet), 0);
});
