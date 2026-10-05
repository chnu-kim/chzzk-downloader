#!/usr/bin/env node
// 실서버 drift 출력의 분류기(docs/design/cicd.md §4.3). 공개 저장소의 로그·이슈에 남는 것은 **테스트 이름(고정 목록)과
// kind(고정 enum)뿐**이다. 실서버가 돌려준 제목·채널 이름·영상 번호가 든 원문은 이 모듈 밖으로 나가지 않는다:
// classify()는 원문을 받아 KINDS 중 하나만 돌려주고, 원문의 어떤 조각도 반환값에 옮기지 않는다.
//
//   node scripts/ci/drift-classify.mjs <로그 파일>   # 그 파일 전체를 한 실패 출력으로 보고 kind 하나를 찍는다(사람용)
//
// kind는 chzzk_core::Error 변종 이름(Debug, 테스트의 unwrap·panic)과 그 Display 문구(examples/dl.rs "실패: …")에 대한
// 고정 정규식으로 고른다. 첫 번째로 맞는 규칙이 이긴다. 규칙을 바꾸면 drift-classify.test.mjs의 표도 바뀌어야 한다.

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { KINDS } from './issue.mjs';

// drift가 돌리는 것(표시 이름 = 이 목록의 글자). 이 밖의 이름은 찍지 않는다.
export const DRIFT_TESTS = ['live_hls_partial', 'live_dash_partial', 'live_clip_full', 'dl'];

// [kind, 정규식]. 순서가 우선순위다.
//   target_gone [확인 필요]: 빠른 다시보기 만료·삭제의 실제 응답 모양은 아직 관찰하지 못했다. info API의 404·410과
//   재생 정보 없음(NoPlayback)을 대상 소멸로 본다. 첫 실제 만료에서 응답을 보고(로그는 남기지 않으므로 로컬에서) 고친다.
export const RULES = [
  ['no_target', /환경 변수로 대상을 주세요/],
  ['timeout', /Network\([^\n]*(?:TimedOut|timed out|Timeout)|operation timed out|deadline has elapsed/i],
  ['auth', /AuthRequired|로그인\/성인 인증이 필요합니다/],
  ['target_gone', /HttpStatus \{ status: (?:404|410), kind: Api \}|Api \{ code: (?:404|410)\b|NoPlayback|재생 정보가 없습니다|실패: HTTP (?:404|410)\b/],
  ['http_5xx', /HttpStatus \{ status: 5\d\d\b|(?:^|\s)HTTP 5\d\d\b/m],
  ['http_4xx', /HttpStatus \{ status: 4\d\d\b|(?:^|\s)HTTP 4\d\d\b/m],
  [
    'schema_mismatch',
    /\bParse \{|응답 형식 오류|NoQualities|다운로드 가능한 화질이 없습니다|Unsupported\(|지원하지 않는 스트림|QualityNotFound|화질\([^\n]*\)을 찾을 수 없습니다|PlaybackChanged|재생 방식이 바뀌었습니다|EncryptedVod|암호화된 VOD|대상의 재생 방식이 다르다|\bApi \{ code:|API 오류 -?\d+/,
  ],
  ['media_invalid', /LengthMismatch|길이 불일치|SourceChanged|원본이 바뀌어|첫 상자가 ftyp|assertion `left == right` failed|assertion failed: /],
  ['network', /Network\(|네트워크 오류/],
  ['panic', /panicked at/],
];

// 실패한 실행 하나의 출력 → kind(KINDS의 값). 원문은 돌려주지 않는다.
export function classify(text) {
  for (const [kind, re] of RULES) if (re.test(text ?? '')) return kind;
  return 'unknown';
}

// 합성 로그(simulate 입력·테스트용). 실제 출력처럼 서버가 준 제목·채널 이름(canary)을 섞는다: 분류기와 drift.mjs가
// 그것을 어디에도 옮기지 않는지 보려는 것이다. canary는 testdata의 합성 fixture 문구다(실제 값이 아니다).
export const CANARY = { title: '테스트 다시보기', channel: '테스트채널', videoNo: '9000001' };

const PANIC = (test, msg) =>
  [
    'running 1 test',
    `test ${test} ... FAILED`,
    '',
    'failures:',
    '',
    `---- ${test} stdout ----`,
    `[${CANARY.channel}] ${CANARY.title} (video ${CANARY.videoNo})`,
    '',
    `thread '${test}' panicked at crates/core/tests/live.rs:50:47:`,
    msg,
    'note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace',
    '',
    'failures:',
    `    ${test}`,
    '',
    'test result: FAILED. 0 passed; 1 failed; 0 ignored; 0 measured; 3 filtered out; finished in 1.23s',
    '',
  ].join('\n');

const UNWRAP = (v) => `called \`Result::unwrap()\` on an \`Err\` value: ${v}`;

// kind → 그 kind로 분류되는 실패 출력(테스트 이름 test). ok는 통과 출력.
export const SYNTHETIC = {
  no_target: (t) => PANIC(t, 'CHZZK_LIVE_HLS 환경 변수로 대상을 주세요'),
  timeout: (t) => PANIC(t, UNWRAP('Network(reqwest::Error { kind: Request, source: TimedOut })')),
  auth: (t) => PANIC(t, UNWRAP('AuthRequired { status: 403 }')),
  target_gone: (t) => PANIC(t, UNWRAP('HttpStatus { status: 404, kind: Api }')),
  http_5xx: (t) => PANIC(t, UNWRAP('HttpStatus { status: 503, kind: Media }')),
  http_4xx: (t) => PANIC(t, UNWRAP('HttpStatus { status: 403, kind: Media }')),
  schema_mismatch: (t) => PANIC(t, UNWRAP(`Parse { what: "video info", detail: "missing field \`${CANARY.title}\`" }`)),
  media_invalid: (t) => PANIC(t, 'assertion `left == right` failed\n  left: ["moof"]\n right: ["ftyp", "moov"]'),
  network: (t) => PANIC(t, UNWRAP('Network(reqwest::Error { kind: Request, source: ConnectionRefused })')),
  panic: (t) => PANIC(t, `index out of bounds: the len is 0 but the index is 0 (${CANARY.title})`),
  unknown: (t) => `test ${t} ... FAILED\nerror: test failed, to rerun pass \`--test live\`\n${CANARY.title}\n`,
};
export const SIMULATE = ['ok', ...Object.keys(SYNTHETIC)];

export function syntheticOutput(kind, test) {
  if (kind === 'ok') return `running 1 test\n${CANARY.title}\ntest ${test} ... ok\n\ntest result: ok. 1 passed; 0 failed\n`;
  const f = SYNTHETIC[kind];
  if (!f) throw new Error(`모르는 simulate 값(${SIMULATE.join('|')})`);
  return f(test);
}

// 모든 SYNTHETIC kind는 KINDS 안이다(이슈 validate가 받는다)
for (const k of Object.keys(SYNTHETIC)) if (!KINDS.includes(k)) throw new Error(`drift kind ${k}가 issue.mjs KINDS에 없다`);

export function main(argv) {
  if (argv.length !== 1 || argv[0].startsWith('-')) {
    console.error('사용법: drift-classify.mjs <로그 파일>');
    return 2;
  }
  console.log(classify(readFileSync(argv[0], 'utf8')));
  return 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
