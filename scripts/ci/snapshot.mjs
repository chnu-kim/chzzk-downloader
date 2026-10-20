// 훅의 조건부 gate를 "커밋·push될 내용"에서 돌린다(docs/design/cicd.md §3.2). run.mjs hook이 쓴다.
//
// 작업 트리에는 올리지 않은 변경·추적하지 않는 파일이 있을 수 있다. 그 상태로 gate를 돌리면 결과가
// 커밋될 내용(인덱스)이나 push할 커밋과 갈린다. 그래서:
//   pre-commit  작업 트리 = 인덱스(올리지 않은 변경·새 파일 없음)면 제자리, 아니면 인덱스를 커밋 객체로 만들어 임시 worktree에서
//   pre-push    push할 커밋 = HEAD이고 작업 트리가 깨끗하면 제자리, 아니면 그 커밋의 임시 worktree에서
// 어느 쪽이든 그 트리의 진입점 `node <트리>/scripts/ci/run.mjs <gate>`를 부른다(CI가 체크아웃한 커밋에서 하는 것과 같다).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

// 훅 안에서 git이 넘기는 변수. 임시 worktree와 그 안의 gate가 바깥 저장소·인덱스를 가리키지 않게 지운다.
const GIT_LOCAL = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX|COMMON_DIR|NAMESPACE)$/;

export function cleanGitEnv(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!GIT_LOCAL.test(k)) out[k] = v;
  return out;
}

function git(cwd, args, env) {
  const r = spawnSync('git', args, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${(r.stderr ?? String(r.error)).trim()}`);
  return r.stdout;
}

/** pre-commit: 작업 트리가 인덱스와 같은가(추적 파일 변경 없음, 무시되지 않는 새 파일 없음). env의 GIT_INDEX_FILE을 따른다. */
export function indexMatchesWorktree(root, env) {
  if (spawnSync('git', ['diff', '--quiet'], { cwd: root, env }).status !== 0) return false;
  return git(root, ['ls-files', '--others', '--exclude-standard', '-z'], env) === '';
}

/** pre-push: sha가 HEAD이고 작업 트리가 깨끗한가 */
export function headIsCleanAt(root, sha, env) {
  const e = cleanGitEnv(env);
  const head = spawnSync('git', ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { cwd: root, env: e, encoding: 'utf8' });
  if (head.status !== 0 || head.stdout.trim() !== sha) return false;
  return git(root, ['status', '--porcelain', '--untracked-files=all', '-z'], e) === '';
}

/** 인덱스(env의 GIT_INDEX_FILE)를 커밋 객체로 만든다. ref는 만들지 않는다(gc가 치운다). */
export function indexCommit(root, env) {
  const tree = git(root, ['write-tree'], env).trim();
  const id = { GIT_AUTHOR_NAME: 'hook', GIT_AUTHOR_EMAIL: 'hook@example.invalid', GIT_COMMITTER_NAME: 'hook', GIT_COMMITTER_EMAIL: 'hook@example.invalid' };
  return git(root, ['commit-tree', '--no-gpg-sign', tree, '-m', 'pre-commit snapshot'], { ...cleanGitEnv(env), ...id }).trim();
}

/**
 * 임시 worktree의 고정 경로(저장소마다 하나). 경로가 실행마다 다르면 공유 CARGO_TARGET_DIR에 남은 테스트 바이너리가
 * 이미 지워진 경로의 `env!("CARGO_MANIFEST_DIR")`을 품은 채 재사용된다(cargo는 이 값이 바뀌었다고 다시 빌드하지 않는다).
 */
export function hookWorktreePath(root) {
  const h = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 10);
  return join(tmpdir(), `chzzk-hook-${h}`);
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/** 고정 경로의 잠금(<경로>.lock/pid)을 잡는다. 살아 있는 소유자가 있으면 false, 죽은 소유자의 잠금은 넘겨받는다. */
function acquire(lock) {
  for (let i = 0; i < 2; i++) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'pid'), String(process.pid));
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let pid = NaN;
      try {
        pid = Number(readFileSync(join(lock, 'pid'), 'utf8'));
      } catch {}
      if (Number.isInteger(pid) && pid > 0 && alive(pid)) return false;
      rmSync(lock, { recursive: true, force: true });
    }
  }
  return false;
}

/**
 * sha의 임시 worktree에서 fn(dir, shared)을 부르고 지운다. 보통 고정 경로(hookWorktreePath)를 쓰고 shared=true다.
 * 다른 훅이 그 경로를 쓰는 중이면 유일한 경로로 비켜서 shared=false로 부른다(그 worktree는 공유 target을 쓰면 안 된다).
 */
export function withWorktree(root, sha, env, fn) {
  const e = cleanGitEnv(env);
  const fixed = hookWorktreePath(root);
  const lock = `${fixed}.lock`;
  const shared = acquire(lock);
  const dir = shared ? fixed : mkdtempSync(join(tmpdir(), 'chzzk-hook-x-'));
  const remove = () => {
    spawnSync('git', ['worktree', 'remove', '--force', dir], { cwd: root, env: e });
    rmSync(dir, { recursive: true, force: true });
    spawnSync('git', ['worktree', 'prune'], { cwd: root, env: e });
  };
  try {
    if (shared) remove(); // 앞 실행이 죽어 남긴 것
    else rmSync(dir, { recursive: true, force: true });
    git(root, ['worktree', 'add', '--detach', '--quiet', dir, sha], e);
    return fn(dir, shared);
  } finally {
    remove();
    if (shared) rmSync(lock, { recursive: true, force: true });
  }
}

/**
 * dir의 진입점으로 gate들을 차례로 돌린다. 첫 0이 아닌 코드에서 멈춘다.
 * extraPath: 바깥 저장소의 install-tool 폴더(임시 worktree에는 없다). targetDir: cargo 빌드 캐시를 나눠 쓴다.
 */
export function runGatesIn(dir, gates, env, { extraPath, targetDir, forceTargetDir, log = console.log } = {}) {
  const e = cleanGitEnv(env);
  if (extraPath) {
    const key = Object.keys(e).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    e[key] = [e[key], extraPath].filter(Boolean).join(delimiter);
  }
  if (forceTargetDir) e.CARGO_TARGET_DIR = forceTargetDir; // 비켜 도는 worktree: 물려받은 값도 덮어쓴다
  else if (targetDir && !e.CARGO_TARGET_DIR) e.CARGO_TARGET_DIR = targetDir;
  for (const g of gates) {
    const r = spawnSync(process.execPath, [join(dir, 'scripts', 'ci', 'run.mjs'), g], { cwd: dir, env: e, stdio: 'inherit' });
    if (r.error) {
      log(`[${g}] 실행 실패: ${r.error.message}`);
      return 2;
    }
    if (r.status !== 0) return r.status || 1;
  }
  return 0;
}

/**
 * 훅의 조건부 gate 실행. target: { index: true } (pre-commit) 또는 { sha } (pre-push).
 * 반환: 종료 코드. 제자리로 돌았는지는 log로 알린다.
 */
export function runHookGates(root, target, gates, env, opts = {}) {
  const log = opts.log ?? console.log;
  if (gates.length === 0) return 0;
  const inPlace = target.index ? indexMatchesWorktree(root, env) : headIsCleanAt(root, target.sha, env);
  if (inPlace) return runGatesIn(root, gates, env, opts);
  const sha = target.index ? indexCommit(root, env) : target.sha;
  log(`${target.index ? '인덱스' : `커밋 ${sha.slice(0, 12)}`}가 작업 트리와 달라 임시 worktree에서 돌린다: ${gates.join(', ')}`);
  return withWorktree(root, sha, env, (dir, shared) => runGatesIn(dir, gates, env, shared ? opts : { ...opts, targetDir: undefined, forceTargetDir: join(dir, 'target') }));
}
