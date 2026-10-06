#!/usr/bin/env node
// 비공개 denylist 고리(docs/design/cicd.md 구현 중 변경 77, nightly private-scan). 공개 denylist(public-denylist.txt)에 둘 수
// 없는 항목(경우의 수가 적어 공개 salt로 되돌릴 수 있는 채널 이름·영상 번호 등의 해시)은 환경 audit의 secret
// PRIVATE_DENYLIST에만 있다. 이 스크립트는 그 값을 임시 파일(0600)에 쓰고 public-scan.mjs로 추적 중인 트리와 공개 이력 전체를
// 본 뒤 파일을 지운다. 스캐너는 위치(파일:줄, 커밋 SHA, 경로·ref 이름)와 규칙 이름만 찍고 원문·해시는 찍지 않는다.
//
//   PRIVATE_DENYLIST=<목록> node scripts/ci/private-scan.mjs
//   env PRIVATE_SCAN_CWD=<저장소>   # 테스트용: 검사할 git 작업 트리(기본은 이 저장소)
//
// 목록 형식은 public-denylist.txt와 같다: 줄마다 64 hex(글자 항목), blob:<64 hex>, commit:<64 hex>. '#' 뒤는 주석이다.
// 종료: 깨끗함 0, 발견·secret 없음·형식 오류 1, 사용법·스캐너 오류 2.
// GITHUB_OUTPUT kinds: 발견 leak, secret 없음·형식 오류 no_secret, 스캐너 오류 unknown(nightly report가 이슈 kind로 쓴다).
// 형식 오류는 줄 번호만 찍는다(원문을 잘못 넣었을 때 그 글자를 로그에 옮기지 않는다).

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

const ENTRY = /^(?:blob:|commit:)?[0-9a-f]{64}$/;

// secret 값 → { entries, bad: [줄 번호] }. 빈 줄·주석은 건너뛴다(public-scan.mjs loadDenylist와 같은 규칙).
export function parseList(text) {
  const entries = [];
  const bad = [];
  String(text ?? '')
    .split(/\r?\n/)
    .forEach((raw, i) => {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) return;
      if (ENTRY.test(line)) entries.push(line);
      else bad.push(i + 1);
    });
  return { entries, bad };
}

// 두 검사의 종료 코드 → [코드, kind]. 오류(2)가 하나라도 있으면 그 결과는 믿을 수 없다(unknown, 2).
export function verdict(codes) {
  if (codes.some((c) => c !== 0 && c !== 1)) return [2, 'unknown'];
  if (codes.includes(1)) return [1, 'leak'];
  return [0, null];
}

export function main(argv, env = process.env) {
  const out = (kind) => {
    if (env.GITHUB_OUTPUT && kind) appendFileSync(env.GITHUB_OUTPUT, `kinds=${kind}\n`);
  };
  if (argv.length) {
    console.error('사용법: PRIVATE_DENYLIST=<목록> private-scan.mjs');
    return 2;
  }
  const { entries, bad } = parseList(env.PRIVATE_DENYLIST);
  if (bad.length) {
    console.error(`::error::private-scan: secret PRIVATE_DENYLIST의 ${bad.length}줄이 해시 목록 형식(64 hex, blob:·commit: 접두)이 아니다: 줄 ${bad.slice(0, 20).join(', ')}. 원문이 아니라 public-scan.mjs --hash 출력을 넣는다`);
    out('no_secret');
    return 1;
  }
  if (entries.length === 0) {
    console.error('::error::private-scan: secret PRIVATE_DENYLIST가 없다(비었다). 환경 audit(배포 브랜치 master)에 해시 목록을 넣는다(docs/design/cicd.md §8). master가 아닌 브랜치의 실행은 환경 밖이라 늘 이 오류다');
    out('no_secret');
    return 1;
  }
  console.log(`private-scan: 비공개 denylist ${entries.length}개`);
  const dir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'private-scan-'));
  const file = join(dir, 'denylist.txt');
  try {
    writeFileSync(file, entries.join('\n') + '\n', { mode: 0o600 });
    const scan = (args) =>
      spawnSync(process.execPath, [join(ROOT, 'scripts/ci/public-scan.mjs'), ...args, '--denylist', file], { cwd: env.PRIVATE_SCAN_CWD || ROOT, stdio: 'inherit' }).status;
    const codes = [scan([]), scan(['--all-history'])];
    const [code, kind] = verdict(codes);
    out(kind);
    if (code === 1) console.error('::error::private-scan: 비공개 denylist 항목이 공개 저장소에 있다. 위 위치(파일:줄·커밋)를 보고 정리한다(docs/public-release.md)');
    else if (code === 2) console.error('::error::private-scan: 검사를 끝내지 못했다(스캐너 오류)');
    else console.log('private-scan: 트리·전체 이력 깨끗함');
    return code;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
