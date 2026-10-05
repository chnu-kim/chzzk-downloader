// node --test scripts/ci/push-guard.test.mjs — 비공개 이력 가드(docs/design/cicd.md §3.3).
// 임시 bare 저장소 둘(가짜 origin과 private, 같은 루트를 공유)과 작업 클론으로 실제 git 객체·ref를 만든다.
// 시나리오 7개(새 브랜치, 삭제, 태그, private/x:refs/heads/x, 비공개 커밋 merge, 정상 공개 커밋, private 원격으로의 push)의
// 기대 코드는 0/0/0/1/1/0/0이다. 마지막에 실제 `git push`를 pre-push 훅과 함께 돌려 git이 주는 stdin 형식도 확인한다.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseLines, PRIVATE_URL, pushedPaths, scanRanges } from './push-guard.mjs';
import { gitEnv, gitOk, gitRun } from './test-git.mjs';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'push-guard.mjs');
const Z = '0'.repeat(40);

let d; // 임시 폴더
let work; // 작업 클론
let originUrl;
let privateUrl;
const sha = {};

const g = (...args) => gitOk(work, args);
function commit(file, text, msg) {
  writeFileSync(join(work, file), text);
  g('add', file);
  g('commit', '-q', '-m', msg);
  return g('rev-parse', 'HEAD');
}

before(() => {
  d = mkdtempSync(join(tmpdir(), 'push-guard-'));
  originUrl = join(d, 'chzzk-downloader.git');
  privateUrl = join(d, `${PRIVATE_URL}.git`);
  work = join(d, 'work');
  gitOk(d, ['init', '-q', '--bare', originUrl]);
  gitOk(d, ['init', '-q', '--bare', privateUrl]);
  gitOk(d, ['init', '-q', work]);
  g('remote', 'add', 'origin', originUrl);
  g('remote', 'add', 'private', privateUrl);
  // 공통 루트 A(공개·비공개 모두), 비공개에만 B
  sha.A = commit('readme.txt', 'root\n', 'docs: 루트');
  g('push', '-q', 'origin', 'master');
  g('push', '-q', 'private', 'master');
  g('checkout', '-q', '-b', 'pv');
  sha.B = commit('research.txt', 'private notes\n', 'docs: 비공개 조사');
  g('push', '-q', 'private', 'pv:master');
  g('checkout', '-q', 'master');
  g('branch', '-q', '-D', 'pv');
  g('fetch', '-q', 'origin');
  g('fetch', '-q', 'private');
  // 공개 기준 위의 새 브랜치 C와 그 위 태그
  g('checkout', '-q', '-b', 'feat');
  sha.C = commit('feature.txt', 'feature\n', 'feat: 기능');
  g('tag', '-a', 'v1.0.0', '-m', 'v1.0.0');
  sha.tagC = g('rev-parse', 'v1.0.0');
  // 비공개 커밋을 merge한 브랜치
  g('checkout', '-q', '-b', 'merged', 'master');
  g('merge', '-q', '--no-ff', '-m', 'Merge private', 'private/master');
  sha.M = g('rev-parse', 'HEAD');
  // 비공개 커밋 위의 태그
  g('tag', '-a', 'v0.0.9', '-m', 'v0.0.9', 'private/master');
  sha.tagB = g('rev-parse', 'v0.0.9');
  // master의 정상 공개 커밋
  g('checkout', '-q', 'master');
  sha.D = commit('readme.txt', 'root\nmore\n', 'docs: 더함');
});

after(() => rmSync(d, { recursive: true, force: true }));

// push-guard를 git처럼 부른다: 인자 <원격 이름> <URL>, stdin 줄들
function guard(lines, remote = 'origin', url = remote === 'private' ? privateUrl : originUrl) {
  const r = spawnSync(process.execPath, [GUARD, remote, url], {
    cwd: work,
    env: gitEnv(),
    input: lines.map((l) => l.join(' ')).join('\n') + '\n',
    encoding: 'utf8',
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const SCENARIOS = [
  ['새 브랜치', () => [['refs/heads/feat', sha.C, 'refs/heads/feat', Z]], 0],
  ['삭제', () => [['(delete)', Z, 'refs/heads/old', sha.A]], 0],
  ['태그', () => [['refs/tags/v1.0.0', sha.tagC, 'refs/tags/v1.0.0', Z]], 0],
  ['private/x:refs/heads/x', () => [['refs/remotes/private/master', sha.B, 'refs/heads/x', Z]], 1],
  ['비공개 커밋 merge', () => [['refs/heads/merged', sha.M, 'refs/heads/merged', Z]], 1],
  ['정상 공개 커밋', () => [['refs/heads/master', sha.D, 'refs/heads/master', sha.A]], 0],
  ['private 원격으로의 push', () => [['refs/heads/merged', sha.M, 'refs/heads/master', sha.B]], 0, 'private'],
];

test('시나리오 7개: 기대 코드 0/0/0/1/1/0/0', () => {
  const got = SCENARIOS.map(([, lines, , remote]) => guard(lines(), remote).code);
  assert.deepEqual(got, SCENARIOS.map(([, , want]) => want), SCENARIOS.map(([n]) => n).join(' / '));
  assert.deepEqual(got, [0, 0, 0, 1, 1, 0, 0]);
});

test('거부하면 교집합 SHA와 해결 방법을 찍는다', () => {
  const r = guard([['refs/heads/merged', sha.M, 'refs/heads/merged', Z]]);
  assert.equal(r.code, 1);
  assert.ok(r.out.includes(sha.B), r.out);
  assert.ok(!r.out.includes(sha.M), '공개해도 되는 merge 커밋 자체는 교집합이 아니다');
  assert.match(r.out, /git rebase --onto origin\/master/);
  const p = guard([['refs/remotes/private/master', sha.B, 'refs/heads/x', Z]]);
  assert.ok(p.out.includes(sha.B) && p.out.includes('비공개 원격 추적 ref'), p.out);
});

test('비공개 커밋을 가리키는 태그는 벗겨서 거부한다', () => {
  assert.equal(guard([['refs/tags/v0.0.9', sha.tagB, 'refs/tags/v0.0.9', Z]]).code, 1);
});

test('refs/heads/*·refs/tags/v* 밖으로는 push하지 않는다', () => {
  assert.equal(guard([['refs/heads/feat', sha.C, 'refs/notes/x', Z]]).code, 1);
  assert.equal(guard([['refs/tags/v1.0.0', sha.tagC, 'refs/tags/release', Z]]).code, 1);
});

test('URL로 push해도(원격 이름이 URL) 같은 규칙을 쓴다', () => {
  assert.equal(guard([['refs/heads/merged', sha.M, 'refs/heads/m', Z]], originUrl, originUrl).code, 1);
  assert.equal(guard([['refs/heads/feat', sha.C, 'refs/heads/feat', Z]], originUrl, originUrl).code, 0);
  // URL에 비공개 저장소 이름이 있으면 보관용으로 본다
  assert.equal(guard([['refs/heads/merged', sha.M, 'refs/heads/m', Z]], privateUrl, privateUrl).code, 0);
});

test('여러 ref 중 하나라도 위반이면 거부한다', () => {
  const r = guard([
    ['refs/heads/feat', sha.C, 'refs/heads/feat', Z],
    ['refs/heads/merged', sha.M, 'refs/heads/merged', Z],
  ]);
  assert.equal(r.code, 1);
});

test('stdin 형식 오류·사용법 오류는 2', () => {
  const bad = spawnSync(process.execPath, [GUARD, 'origin', originUrl], { cwd: work, env: gitEnv(), input: 'garbage\n', encoding: 'utf8' });
  assert.equal(bad.status, 2);
  const usage = spawnSync(process.execPath, [GUARD], { cwd: work, env: gitEnv(), input: '', encoding: 'utf8' });
  assert.equal(usage.status, 2);
});

test('scan-range 범위와 바뀐 경로: 공개 원격에서 닿지 않는 커밋만', () => {
  const refs = parseLines(`refs/heads/feat ${sha.C} refs/heads/feat ${Z}\n(delete) ${Z} refs/heads/old ${sha.A}\n`);
  assert.deepEqual(scanRanges(work, 'origin', refs), [
    { ref: 'refs/heads/feat', args: [sha.C, '--not-remote', 'origin', '--ref', 'refs/heads/feat'] },
  ]);
  assert.deepEqual(pushedPaths(work, 'origin', refs), ['feature.txt']);
});

test('실제 git push: pre-push 훅이 비공개 이력을 막고 공개 브랜치는 보낸다', () => {
  const hooks = join(d, 'hooks');
  mkdirSync(hooks, { recursive: true });
  const node = process.execPath.replace(/\\/g, '/');
  const script = GUARD.replace(/\\/g, '/');
  writeFileSync(join(hooks, 'pre-push'), `#!/bin/sh\nexec "${node}" "${script}" "$@"\n`);
  chmodSync(join(hooks, 'pre-push'), 0o755);
  const push = (...args) => gitRun(work, ['-c', `core.hooksPath=${hooks.replace(/\\/g, '/')}`, 'push', ...args]);
  const remoteHas = (ref) => gitRun(originUrl, ['rev-parse', '--verify', '--quiet', ref]).status === 0;

  const denied = push('origin', 'refs/remotes/private/master:refs/heads/x');
  assert.notEqual(denied.status, 0, denied.stderr);
  assert.ok(denied.stderr.includes(sha.B), denied.stderr);
  assert.equal(remoteHas('refs/heads/x'), false, '거부된 push가 원격에 닿았다');

  const merged = push('origin', 'merged');
  assert.notEqual(merged.status, 0, merged.stderr);
  assert.equal(remoteHas('refs/heads/merged'), false);

  const ok = push('origin', 'feat');
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(remoteHas('refs/heads/feat'), true);
});
