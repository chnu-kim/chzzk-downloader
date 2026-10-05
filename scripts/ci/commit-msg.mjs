#!/usr/bin/env node
// 커밋 메시지 제목 형식 검사(docs/design/cicd.md §2 `scan-msg`의 형식 절반. 누출 절반은 public-scan --message-file).
//
//   node scripts/ci/commit-msg.mjs <메시지 파일>
//
// 제목(주석·빈 줄을 뺀 첫 줄)이 `type(scope)?: 요약`이어야 한다. git이 스스로 만드는 제목
// (Merge …, Revert "…", fixup!/squash!/amend! …)은 통과시킨다(git 2.24부터 merge도 commit-msg 훅을 부른다).
// 맞으면 0, 아니면 1, 사용법 오류 2.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { cleanMessage } from './public-scan.mjs';

export const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'ci', 'build', 'perf', 'style', 'revert'];
export const SUBJECT = new RegExp(`^(?:${TYPES.join('|')})(?:\\(.+\\))?: \\S.*$`);
const GIT_MADE = /^(?:Merge |Revert "|(?:fixup|squash|amend)! )/;

/** 메시지 본문 → null(통과) 또는 이유 문자열 */
export function checkMessage(text) {
  const msg = cleanMessage(text);
  if (msg === '') return '빈 메시지';
  const subject = msg.split('\n')[0];
  if (GIT_MADE.test(subject)) return null;
  if (!SUBJECT.test(subject)) return `제목이 '<type>(<scope>)?: <요약>' 형식이 아니다(type: ${TYPES.join('|')})`;
  return null;
}

export function main(argv) {
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    console.error('사용법: commit-msg.mjs <메시지 파일>');
    return 2;
  }
  if (!existsSync(argv[0])) {
    console.error(`메시지 파일이 없다: ${argv[0]}`);
    return 2;
  }
  const why = checkMessage(readFileSync(argv[0], 'utf8'));
  if (why) {
    console.error(`commit-msg: ${why}`);
    return 1;
  }
  console.log('commit-msg: 형식 통과');
  return 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
