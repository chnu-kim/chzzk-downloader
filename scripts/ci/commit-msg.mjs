#!/usr/bin/env node
// 커밋 메시지 제목 형식 검사(docs/design/cicd.md §2 `scan-msg`의 형식 절반·`subjects` gate. 누출 절반은 public-scan --message-file).
//
//   node scripts/ci/commit-msg.mjs <메시지 파일>     # commit-msg 훅: 편집 중인 메시지(주석 줄은 제목이 아니다)
//   node scripts/ci/commit-msg.mjs --stored [rev]    # CI: rev(기본 HEAD)에서 닿고 SUBJECT_BASELINE에서 안 닿는 커밋의
//                                                    #     저장된 메시지 첫 줄을 그대로 본다
//
// 제목이 `type(scope)?: 요약`이어야 한다. git이 스스로 만드는 제목
// (Merge …, Revert "…", fixup!/squash!/amend! …)은 통과시킨다(git 2.24부터 merge도 commit-msg 훅을 부른다).
//
// 두 모드의 차이: 훅은 cleanup 모드를 알 수 없다(-m·-F·--cleanup=verbatim이면 # 줄도 이력에 남는다).
// 그래서 훅은 편집기 기준(첫 비주석 줄)으로 보고, 이력에 실제로 남은 첫 줄은 CI의 --stored가 본다.
// 맞으면 0, 아니면 1, 사용법·git 오류 2.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const TYPES = ['feat', 'fix', 'docs', 'chore', 'refactor', 'test', 'ci', 'build', 'perf', 'style', 'revert'];
export const SUBJECT = new RegExp(`^(?:${TYPES.join('|')})(?:\\(.+\\))?: \\S.*$`);
const GIT_MADE = /^(?:Merge |Revert "|(?:fixup|squash|amend)! )/;

// 이 커밋(공개 master, 2026-10-05)까지의 이력에는 규칙 이전의 제목("Update .gitignore" 등)이 있다. 그 뒤만 본다.
export const SUBJECT_BASELINE = '0b66887af800288b9227ab7be77efdce205b8ce8';

/** 편집기 기준 제목: scissors 줄 위에서 주석 문자로 시작하지 않는 첫 비어 있지 않은 줄 */
export function editorSubject(text, commentChar = '#') {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cut = lines.findIndex((l) => l === `${commentChar} ------------------------ >8 ------------------------`);
  for (const l of cut < 0 ? lines : lines.slice(0, cut)) {
    if (l.startsWith(commentChar)) continue;
    if (l.trim() !== '') return l.trimEnd();
  }
  return '';
}

/** 저장된 메시지(git log %B)의 제목: 첫 줄 그대로 */
export const storedSubject = (text) => text.replace(/\r\n/g, '\n').split('\n')[0].trimEnd();

/** 제목 → null(통과) 또는 이유 문자열 */
export function checkSubject(subject) {
  if (subject === '') return '빈 제목';
  if (GIT_MADE.test(subject)) return null;
  if (!SUBJECT.test(subject)) return `제목이 '<type>(<scope>)?: <요약>' 형식이 아니다(type: ${TYPES.join('|')})`;
  return null;
}

/** 편집 중인 메시지 본문 → null 또는 이유 */
export const checkMessage = (text, commentChar = '#') => checkSubject(editorSubject(text, commentChar));

// core.commentChar(없거나 auto면 #)
function commentChar() {
  const r = spawnSync('git', ['config', '--get', 'core.commentChar'], { encoding: 'utf8' });
  const v = r.status === 0 ? r.stdout.trim() : '';
  return v && v !== 'auto' ? v : '#';
}

function git(args) {
  const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 실패: ${(r.stderr ?? String(r.error)).trim()}`);
  return r.stdout;
}

/** rev에서 닿고 기준선에서 안 닿는 커밋들의 [sha, 이유] 목록 */
export function checkStored(rev = 'HEAD', baseline = SUBJECT_BASELINE) {
  git(['cat-file', '-e', `${baseline}^{commit}`]); // 얕은 클론이면 여기서 실패(2)
  const log = git(['log', '--no-show-signature', '--format=%H%x00%B%x00', rev, '--not', baseline, '--']).split('\0');
  const bad = [];
  let n = 0;
  for (let i = 0; i + 1 < log.length; i += 2) {
    const sha = log[i].trim();
    if (!sha) continue;
    n++;
    const why = checkSubject(storedSubject(log[i + 1]));
    if (why) bad.push([sha, why]);
  }
  return { n, bad };
}

export function main(argv) {
  if (argv[0] === '--stored') {
    const rev = argv[1] ?? 'HEAD';
    if (argv.length > 2 || !/^[0-9A-Za-z][0-9A-Za-z._\/@{}^~-]*$/.test(rev)) {
      console.error('사용법: commit-msg.mjs --stored [rev]');
      return 2;
    }
    let res;
    try {
      res = checkStored(rev);
    } catch (e) {
      console.error(`commit-msg: ${e.message}`);
      return 2;
    }
    // 제목 원문은 찍지 않는다(공개 로그). SHA와 이유만.
    for (const [sha, why] of res.bad) console.error(`commit-msg: 커밋 ${sha.slice(0, 12)}: ${why}`);
    if (res.bad.length) return 1;
    console.log(`commit-msg: 저장된 제목 ${res.n}개 형식 통과(기준선 ${SUBJECT_BASELINE.slice(0, 12)} 이후)`);
    return 0;
  }
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    console.error('사용법: commit-msg.mjs <메시지 파일> | --stored [rev]');
    return 2;
  }
  if (!existsSync(argv[0])) {
    console.error(`메시지 파일이 없다: ${argv[0]}`);
    return 2;
  }
  const why = checkMessage(readFileSync(argv[0], 'utf8'), commentChar());
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
