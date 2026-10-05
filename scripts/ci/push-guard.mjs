#!/usr/bin/env node
// 비공개 이력 가드(docs/design/cicd.md §3.3). pre-push 훅이 부른다. 결정적이다: 로컬 ref와 객체만 본다(네트워크 없음).
//
//   node scripts/ci/push-guard.mjs <원격 이름> <원격 URL>  < git이 주는 줄들
//
// stdin 줄: `<local_ref> <local_sha> <remote_ref> <remote_sha>`(git pre-push 형식).
// 규칙(위반을 모두 모아 보고한다)
//   1 비공개 원격(이름 `private` 또는 URL에 `chzzk-downloader-private`)으로의 push는 검사하지 않는다(보관용, 더는 push하지 않는다).
//   2 삭제(local_sha가 0)는 통과한다(master 삭제는 ruleset이 막는다).
//   3 local_ref가 refs/remotes/private/*면 거부한다(`git push origin private/master:x`).
//   4 주 규칙: N = rev-list <local> --not --remotes=<원격>, P = rev-list --remotes=private --not --remotes=origin.
//     N ∩ P ≠ ∅이면 거부하고 교집합 SHA(최대 20개)와 해결 방법을 찍는다. 태그는 ^{commit}으로 벗겨 같은 규칙을 쓴다.
//   5 remote_ref가 refs/heads/*도 refs/tags/v*도 아니면 거부한다.
//   6 비공개 원격이 설정돼 있는데 refs/remotes/private/*가 하나도 없으면 경고한다(P가 비어 4번이 아무것도 못 막는다).
// 통과 0, 거부 1, 사용법·git 오류 2.

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZERO = /^0+$/;
const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
export const PRIVATE_URL = 'chzzk-downloader-private';
export const PRIVATE_REMOTE = 'private';
const MAX_SHOW = 20;

class GitError extends Error {}

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new GitError(`git ${args.join(' ')} 실패: ${(r.stderr ?? String(r.error)).trim()}`);
  return r.stdout;
}
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/** stdin 본문 → [{localRef, localSha, remoteRef, remoteSha}]. 형식이 틀린 줄이 있으면 null. */
export function parseLines(text) {
  const out = [];
  for (const l of text.split(/\r?\n/)) {
    if (l.trim() === '') continue;
    const p = l.trim().split(/\s+/);
    if (p.length !== 4 || !SHA.test(p[1]) || !SHA.test(p[3])) return null;
    out.push({ localRef: p[0], localSha: p[1], remoteRef: p[2], remoteSha: p[3] });
  }
  return out;
}

export const isPrivateTarget = (remote, url) => remote === PRIVATE_REMOTE || `${remote} ${url}`.includes(PRIVATE_URL);

// N에서 뺄 공개 추적 ref의 원격: push 대상이 설정된 원격이면 그 원격, 아니면(URL로 push) origin
export function publicRemote(cwd, remote) {
  return lines(git(cwd, ['remote'])).includes(remote) ? remote : 'origin';
}

/** pre-push가 이어서 돌릴 scan-range 인자(public-scan.mjs --rev-range 뒤). 삭제는 빠진다. */
export function scanRanges(cwd, remote, refs) {
  const pub = publicRemote(cwd, remote);
  return refs
    .filter((r) => !ZERO.test(r.localSha))
    .map((r) => ({ ref: r.remoteRef, args: [r.localSha, '--not-remote', pub, '--ref', r.remoteRef] }));
}

/** push 범위의 새 커밋들이 건드린 경로(pre-push의 조건부 gate용). */
export function pushedPaths(cwd, remote, refs) {
  const pub = publicRemote(cwd, remote);
  const out = new Set();
  for (const r of refs) {
    if (ZERO.test(r.localSha)) continue;
    const t = git(cwd, ['log', '--no-show-signature', '--format=', '--name-only', '-z', r.localSha, '--not', `--remotes=${pub}`, '--']);
    for (const f of t.split('\0')) if (f.trim()) out.add(f.trim());
  }
  return [...out];
}

/** 가드 판정. 반환: { code, errors:[...], warnings:[...] } */
export function guard({ cwd, remote, url, refs }) {
  const errors = [];
  const warnings = [];
  if (isPrivateTarget(remote, url)) {
    return { code: 0, errors, warnings: ['비공개 원격으로의 push다. 검사하지 않는다(private에는 더 이상 push하지 않는다)'] };
  }
  const remotes = lines(git(cwd, ['remote']));
  const pub = publicRemote(cwd, remote);
  const privateRefs = lines(git(cwd, ['for-each-ref', '--format=%(refname)', `refs/remotes/${PRIVATE_REMOTE}/`]));
  if (remotes.includes(PRIVATE_REMOTE) && privateRefs.length === 0) {
    warnings.push(`원격 ${PRIVATE_REMOTE}가 있는데 refs/remotes/${PRIVATE_REMOTE}/*가 없다. git fetch ${PRIVATE_REMOTE} 후 다시 push한다(지금은 비공개 커밋을 알아볼 수 없다)`);
  }
  // P는 push 한 번에 한 번만 계산한다
  const P = new Set(privateRefs.length ? lines(git(cwd, ['rev-list', `--remotes=${PRIVATE_REMOTE}`, '--not', '--remotes=origin'])) : []);

  for (const r of refs) {
    const label = `${r.localRef} → ${r.remoteRef}`;
    if (ZERO.test(r.localSha)) continue; // 2 삭제
    if (r.localRef.startsWith(`refs/remotes/${PRIVATE_REMOTE}/`)) {
      errors.push(`${label}: 비공개 원격 추적 ref(${r.localRef})를 공개 원격에 push할 수 없다`); // 3
    }
    if (!/^refs\/heads\/.+/.test(r.remoteRef) && !/^refs\/tags\/v.+/.test(r.remoteRef)) {
      errors.push(`${label}: refs/heads/* 또는 refs/tags/v*에만 push한다`); // 5
    }
    // 4 주 규칙(태그 객체는 커밋으로 벗긴다. 커밋이 아닌 것을 가리키는 태그는 객체가 없으니 N이 빈다)
    const pr = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${r.localSha}^{commit}`], { cwd, encoding: 'utf8' });
    const peeled = pr.status === 0 ? pr.stdout.trim() : null;
    const N = peeled ? lines(git(cwd, ['rev-list', peeled, '--not', `--remotes=${pub}`])) : [];
    const hit = N.filter((s) => P.has(s));
    if (hit.length) {
      errors.push(
        [
          `${label}: 비공개 저장소에만 있는 커밋 ${hit.length}개가 push 범위에 있다`,
          ...hit.slice(0, MAX_SHOW).map((s) => `    ${s}`),
          ...(hit.length > MAX_SHOW ? [`    … 외 ${hit.length - MAX_SHOW}개`] : []),
          `  해결: 공개 기준 위로 다시 쌓는다 — git rebase --onto ${pub}/master <비공개 커밋 직전 base> ${r.localRef.replace(/^refs\/heads\//, '')}`,
          '        또는 필요한 커밋만 git cherry-pick으로 공개 브랜치에 옮긴다.',
        ].join('\n'),
      );
    }
  }
  return { code: errors.length ? 1 : 0, errors, warnings };
}

export function main(argv, input, cwd = process.cwd()) {
  if (argv.length < 1 || argv.length > 2 || argv.some((a) => a.startsWith('-'))) {
    console.error('사용법: push-guard.mjs <원격 이름> <원격 URL>  (stdin: git pre-push 줄)');
    return 2;
  }
  const [remote, url = remote] = argv;
  const refs = parseLines(input);
  if (!refs) {
    console.error('push-guard: stdin이 `<local_ref> <local_sha> <remote_ref> <remote_sha>` 형식이 아니다');
    return 2;
  }
  let res;
  try {
    res = guard({ cwd, remote, url, refs });
  } catch (e) {
    if (!(e instanceof GitError)) throw e;
    console.error(`push-guard: ${e.message}`);
    return 2;
  }
  for (const w of res.warnings) console.error(`push-guard 경고: ${w}`);
  for (const e of res.errors) console.error(`push-guard 거부: ${e}`);
  if (res.code === 0) console.log(`push-guard: 통과(ref ${refs.length}개)`);
  return res.code;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  // 사용법 오류는 stdin을 기다리지 않고 바로 낸다(entry.test가 인자만으로 부른다)
  process.exit(args.some((a) => a.startsWith('-')) || args.length < 1 || args.length > 2 ? main(args, '') : main(args, readFileSync(0, 'utf8')));
}
