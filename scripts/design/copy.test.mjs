// design-copy(copy.mjs) 단위 테스트. 임시 루트에 최소 사본을 만들어 규칙마다 통과·위반 씨앗을 본다.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { toEntries, validateAllow } from './allow.mjs';
import {
  ROOT,
  allStrings,
  check,
  deckEntries,
  errorEntries,
  glossaryParity,
  loadTerms,
  parseDocKeys,
  parseGlossaryTable,
  parseNewCopyPairs,
  tokenize,
} from './copy.mjs';

const REAL_TERMS = readFileSync(join(ROOT, 'design/copy/terms.json'), 'utf8');
const REAL_CONTENT = readFileSync(join(ROOT, 'docs/design/system/content.md'), 'utf8').replace(/\r\n/g, '\n');
/** §5 앞까지만 자른 content.md(용어집 §4만 있고 §15 쌍은 없다) */
const MD_GLOSSARY_ONLY = REAL_CONTENT.slice(0, REAL_CONTENT.indexOf('\n## 5. '));

function mkRoot(files = {}) {
  const d = mkdtempSync(join(tmpdir(), 'ds-copy-'));
  const all = { 'design/copy/terms.json': REAL_TERMS, 'docs/design/system/content.md': MD_GLOSSARY_ONLY, ...files };
  for (const [rel, text] of Object.entries(all)) {
    mkdirSync(dirname(join(d, rel)), { recursive: true });
    writeFileSync(join(d, rel), text);
  }
  return d;
}

const ko = (body) => ({ 'app/src/lib/copy/ko.ts': `export const ko = {\n${body}\n} as const;\n` });
const run = (files) => check(mkRoot(files), { checkRefs: false });
const rules = (v) => v.map((x) => x.rule);
const has = (v, rule, text) => v.some((x) => x.rule === rule && (text === undefined || x.text === text));

// ---------------------------------------------------------------------------
// 토크나이저·deck 파서
// ---------------------------------------------------------------------------

test('tokenize: 주석은 건너뛰고 문자열 이스케이프를 푼다', () => {
  const toks = tokenize("// '주석'\n/* \"블록\"\n주석 */ const a = '한\\n글' + \"b\\u0041\";");
  const strs = toks.filter((t) => t.t === 'str');
  assert.deepEqual(strs.map((t) => t.v), ['한\n글', 'bA']);
  assert.equal(strs[0].line, 3);
});

test('tokenize: 템플릿의 ${n}은 {n}으로, 식은 {expr}로 정규화하고 식 안 문자열은 inner에 둔다', () => {
  const [t] = tokenize('`${n}개 · ${a ?? "저장 폴더"}가 있어요`');
  assert.equal(t.v, '{n}개 · {expr}가 있어요');
  assert.equal(t.tpl, true);
  assert.deepEqual(t.inner.map((x) => x.v), ['저장 폴더']);
});

test('tokenize: 정규식 리터럴 안의 따옴표가 문자열을 열지 않는다', () => {
  const toks = tokenize("const re = /[\"']+/g; const s = '값';");
  assert.deepEqual(toks.filter((t) => t.t === 'str').map((t) => t.v), ['값']);
});

test('tokenize: 객체 키 자리와 import 경로 문자열은 표시되고 allStrings에서 빠진다', () => {
  const toks = tokenize("import x from '../a';\nconst o = { 'k.a': '값', b: cond ? '예' : '아니오' };");
  assert.deepEqual(allStrings(toks).map((t) => t.v), ['값', '예', '아니오']);
});

test('deckEntries: 평평한 키와 중첩 객체 경로, 함수 몸통의 템플릿', () => {
  const src = `export const COPY = {
  siteName: 'VOD 클립 다운로더',
  'a.b': '값 하나',
  artifact: { dmg: 'macOS', deb: "Linux" },
  signedInAs: (name: string): string => \`\${name} 채널로 로그인했어요.\`,
  version: (v: string, d: string | null): string => (d === null ? \`최신 \${v}\` : \`최신 \${v} · \${d}\`),
  longer: '앞 ' +
    '뒤',
} as const;
export const NOTICE_SHORT = '비공식 도구예요';
`;
  const e = deckEntries(src);
  const byKey = (k) => e.filter((x) => x.key === k).map((x) => x.value);
  assert.deepEqual(byKey('siteName'), ['VOD 클립 다운로더']);
  assert.deepEqual(byKey('a.b'), ['값 하나']);
  assert.deepEqual(byKey('artifact.dmg'), ['macOS']);
  assert.deepEqual(byKey('artifact.deb'), ['Linux']);
  assert.deepEqual(byKey('signedInAs'), ['{name} 채널로 로그인했어요.']);
  assert.deepEqual(byKey('version'), ['최신 {v}', '최신 {v} · {d}']);
  assert.deepEqual(byKey('longer'), ['앞 ', '뒤']);
  assert.deepEqual(byKey('NOTICE_SHORT'), ['비공식 도구예요']);
  assert.equal(e.find((x) => x.key === 'signedInAs').line, 5);
});

test('errorEntries: copy(title, body) 호출을 case 코드별 합성 키로 뽑는다', () => {
  const src = `function copy(title: string, body: string) { return { title, body }; }
export function errorCopy(e) {
  switch (e.code) {
    case 'invalidUrl':
      return copy('주소가 아니에요', '영상 주소를 확인해 주세요.', ['retry']);
    case 'http': {
      return copy(s ? \`문제예요 (\${s})\` : '문제예요', body);
    }
  }
}`;
  const e = errorEntries(src);
  assert.deepEqual(e.map((x) => x.key), ['errors.invalidUrl.title', 'errors.invalidUrl.body', 'errors.http.title', 'errors.http.title']);
  assert.equal(e[1].value, '영상 주소를 확인해 주세요.');
});

// ---------------------------------------------------------------------------
// 용어집 패리티(terms.json ↔ content.md §4): 허용 목록 없이 통과해야 한다
// ---------------------------------------------------------------------------

test('parseGlossaryTable: 굵게·백틱을 벗기고 괄호 안 쉼표는 구분자로 보지 않는다', () => {
  const md = '## 4. 용어집\n\n| 개념 | 쓰는 말 | 쓰지 않는 말 | 비고 |\n|---|---|---|---|\n| **행위** | **받다** | 다운로드하다, `.part`(문구에), 값(단독, 입력칸 밖), "허가된" | x |\n\n## 5. 다음\n';
  const rows = parseGlossaryTable(md);
  assert.deepEqual(rows[0], { concept: '행위', avoid: ['다운로드하다', '.part(문구에)', '값(단독, 입력칸 밖)', '허가된'], line: 5 });
});

test('저장소의 terms.json과 content.md §4 표가 행 단위로 같다(양방향 패리티)', () => {
  const terms = loadTerms(ROOT);
  assert.deepEqual(glossaryParity(ROOT, terms), []);
  assert.equal(terms.glossary.length, parseGlossaryTable(REAL_CONTENT).length);
});

test('용어집 패리티: 표에만 있는 행·json에만 있는 쓰지 않는 말을 각각 잡는다', () => {
  const t = JSON.parse(REAL_TERMS);
  t.glossary.pop();
  t.glossary[0].avoid.push('없는말');
  t.patterns['없는말'] = null;
  const v = check(mkRoot({ 'design/copy/terms.json': JSON.stringify(t) }), { checkRefs: false });
  const msgs = v.filter((x) => x.rule === 'DC1').map((x) => x.msg).join('\n');
  assert.match(msgs, /용어집 행이 terms\.json glossary에 없다/);
  assert.match(msgs, /terms\.json의 쓰지 않는 말이 content\.md §4 표에 없다/);
});

test('loadTerms: patterns에 없는 avoid 항목은 입력 오류(throw)다', () => {
  const t = JSON.parse(REAL_TERMS);
  delete t.patterns['링크'];
  assert.throws(() => check(mkRoot({ 'design/copy/terms.json': JSON.stringify(t) })), /patterns에 "링크" 키가 없다/);
  assert.throws(() => check(mkRoot({ 'design/copy/terms.json': '{' })), /JSON이 깨졌다/);
});

// ---------------------------------------------------------------------------
// 글자 규칙: 깨끗한 deck은 0, 씨앗은 규칙별로 잡힌다
// ---------------------------------------------------------------------------

test('깨끗한 deck은 위반 0', () => {
  const v = run(
    ko(`  'app.title': 'VOD 클립 다운로더',
  'url.label': '영상 주소',
  'card.download': '받기',
  'dialog.cancel.title': '‘{title}’ 받기를 취소할까요?',
  'dialog.cancel.body': '{size}까지 받았어요. 취소하면 받다 만 파일이 지워지고 되돌릴 수 없어요.',
  'action.cancel': '취소…',
  'job.status.paused': '일시정지됨',
  'list.group.stopped': '받다 만 {n}',
  'toast.copyFailed': '복사하지 못했어요',
  'a11y.more': '‘{title}’ 더 보기',
  'update.banner': '새 버전이 있어요: {version}',`),
  );
  assert.deepEqual(v, []);
});

test('selftest 씨앗: ko.ts 끝의 top-level 리터럴 "클릭하세요"가 잡힌다(deck 밖 리터럴 포함)', () => {
  const src = `export const ko = {\n  'app.title': 'VOD 클립 다운로더',\n} as const;\nexport const selftestSeed = '여기를 클릭하세요';\n`;
  const v = run({ 'app/src/lib/copy/ko.ts': src });
  assert.ok(has(v, 'DC1', '여기를 클릭하세요'));
  assert.ok(has(v, 'DC2', '여기를 클릭하세요'));
  assert.ok(v.every((x) => x.file === 'app/src/lib/copy/ko.ts' && x.line === 4 || x.rule === 'DC11'));
});

const SEEDS = [
  ['DC1 클릭', "'a.x': '여기를 클릭해요'", 'DC1'],
  ['DC1 우리', "'a.x': '우리가 도와요'", 'DC1'],
  ['DC1 용어집(링크)', "'a.x': '링크를 복사해요'", 'DC1'],
  ['DC1 용어집(허가된)', "'a.x': '허가된 채널이에요'", 'DC1'],
  ['DC1 공식 앱', "'a.x': '공식 앱이에요'", 'DC1'],
  ['DC1 감탄사', "'a.x': '아, 안 됐어요'", 'DC1'],
  ['DC1 잠시 후', "'a.x': '잠시 후 다시 해 주세요'", 'DC1'],
  ['DC2 합니다체', "'a.x': '완료되었습니다'", 'DC2'],
  ['DC2 하세요', "'a.x': '확인하세요'", 'DC2'],
  ['DC2 해주세요 붙임', "'a.x': '확인해주세요'", 'DC2'],
  ['DC2 상태 키 어요', "'job.status.x': '대기 중 · 곧 시작해요'", 'DC2'],
  ['DC3 변수 뒤 조사', "'a.x': '새 버전 {version}이 있어요'", 'DC3'],
  ['DC3 이중 표기', "'a.x': '영상을(를) 받아요'", 'DC3'],
  ['DC4 숫자+단위', "'a.x': '최대 40초쯤 걸려요'", 'DC4'],
  ['DC4 용량', "'a.x': '약 7.8GB를 받아요'", 'DC4'],
  ['DC5 세 점', "'a.x': '불러오는 중...'", 'DC5'],
  ['DC5 느낌표', "'a.x': '다 됐어요!'", 'DC5'],
  ['DC5 직선 따옴표', "'a.x': \"'{title}' 받기\"", 'DC5'],
  ['DC5 제목 끝 마침표', "'a.title': '받기를 마쳤어요.'", 'DC5'],
  ['DC5 본문 끝 마침표 없음', "'a.body': '다시 해 주세요'", 'DC5'],
  ['DC5 물음표', "'a.x': '열리지 않나요?'", 'DC5'],
  ['DC5 진행 말줄임', "'a.x': '불러오는 중…'", 'DC5'],
  ['DC5 괄호 앞 공백', "'a.x': '이름 (선택)'", 'DC5'],
  ['DC5 화살표', "'a.x': '설정 → 보기'", 'DC5'],
  ['DC7 번호', "'a.x': '1. 먼저 열어 주세요'", 'DC7'],
  ['DC8 title에 코드', "'a.title': '오류 코드 404'", 'DC8'],
  ['DC9 OS 문자열', "'a.x': 'Finder에서 보여 줘요'", 'DC9'],
  ['DC11 복합어 띄어쓰기', "'a.x': '이어 받기'", 'DC11'],
  ['DC11 키 접미 tip', "'a.tip': '도움이 돼요'", 'DC11'],
  ['DC11 쉼표로 시작', "'a.x': ', 네이버 로그인 정보'", 'DC11'],
  ['DC11 식별자만', "'a.x': '.mp4'", 'DC11'],
  ['DC12 a11y 어순', "'a11y.x': '더 보기 ‘{title}’'", 'DC12'],
  ['DC12 auth 로그인 정보', "'auth.x': '로그인 정보를 확인해요'", 'DC12'],
  ['DC12 revoked 관리자', "'auth.revoked.body': '관리자가 끊었어요.'", 'DC12'],
];
for (const [name, line, rule] of SEEDS) {
  test(`씨앗: ${name}`, () => {
    const v = run(ko(`  ${line},`));
    assert.ok(rules(v).includes(rule), `${rule} 없음: ${JSON.stringify(v)}`);
  });
}

test('통과 짝: 비공식·마세요·해 주세요·dialog 제목 물음표·opensWindow 말줄임·주소 예시 말줄임', () => {
  const v = run(
    ko(`  'badge.x': '비공식 도구',
  'a.body': '하지 마세요.',
  'b.body': '다시 해 주세요.',
  'dialog.x.title': '닫을까요?',
  'action.change': '변경…',
  'url.hint': 'chzzk.naver.com/video/… 또는 …/clips/…',
  'c.body': '새 버전 {version}에서 받아요.',
  'd.x': '라이브 주소는 받을 수 없어요',
  'e.x': '성인 인증이 필요해요',
  'f.x': '처음부터 다시 받기',
  'g.x': '일시정지',
  'h.x': '설정 폴더 열기',`),
  );
  assert.deepEqual(v.filter((x) => x.rule !== 'DC11'), []);
});

test('DC5 쉘 명령 상수는 따옴표 검사에서 뺀다', () => {
  const v = run(ko(`  'mac.xattr': 'xattr -dr com.apple.quarantine "/Applications/VOD 클립 다운로더.app"',`));
  assert.deepEqual(v.filter((x) => x.rule === 'DC5'), []);
});

test('DC5 join(\', \')와 DC4 toLocaleString 직접 호출은 소스에서 잡는다', () => {
  const v = run({
    'app/src/lib/copy/ko.ts': "export const ko = { 'a.x': '값' } as const;\nexport const j = parts.join(', ');\nexport const n = (x: number) => x.toLocaleString('en-US');\n",
  });
  assert.ok(has(v, 'DC5', "join(', ')"));
  assert.ok(has(v, 'DC4', 'toLocaleString'));
});

test('DC9 platform 분기 객체 안의 OS 문자열은 통과한다', () => {
  const v = run(ko(`  platform: { macos: { reveal: 'Finder에서 보기' }, other: { reveal: '폴더에서 보기' } },`));
  assert.deepEqual(v.filter((x) => x.rule === 'DC9'), []);
});

test('DC11 값이 같은 키: 둘째부터 위반이고 템플릿 둘 이상인 키는 대상이 아니다', () => {
  const v = run(ko(`  'a.close': '닫기',\n  'b.close': '닫기',\n  'c.fn': (n) => (n ? '예' : '아니오'),`));
  assert.ok(has(v, 'DC11', 'b.close'));
  assert.ok(!has(v, 'DC11', 'a.close'));
  assert.ok(!has(v, 'DC11', 'c.fn'));
});

test('DC11 미참조 키: 다른 소스가 문자열·동적 접두로 쓰는 키는 통과, 안 쓰는 키는 위반', () => {
  const root = mkRoot({
    ...ko(`  'used.a': '쓰는 말',\n  'dyn.word.x': '동적으로 써요',\n  'dead.key': '안 써요',`),
    'app/src/lib/x.ts': "import { t } from './copy/ko';\nexport const a = t('used.a');\nexport const b = (w: string) => t(`dyn.word.${w}`);\n",
  });
  const v = check(root);
  assert.ok(has(v, 'DC11', 'dead.key'));
  assert.ok(!has(v, 'DC11', 'used.a'));
  assert.ok(!has(v, 'DC11', 'dyn.word.x'));
});

test('DC11 Worker deck: COPY.경로 참조와 중첩 객체 통째 참조를 인식한다', () => {
  const root = mkRoot({
    'worker/src/http/copy.ts': "export const COPY = {\n  siteName: 'VOD 클립 다운로더',\n  artifact: { dmg: 'macOS', deb: 'Linux' },\n  gone: '안 써요',\n} as const;\n",
    'worker/src/http/x.ts': "import { COPY } from './copy';\nexport const a = COPY.siteName + COPY.artifact[kind];\n",
  });
  const v = check(root);
  assert.ok(has(v, 'DC11', 'gone'));
  assert.ok(!has(v, 'DC11', 'siteName'));
  assert.ok(!has(v, 'DC11', 'artifact.dmg'));
});

test('DC6 두 deck의 공통 상수가 다르면 잡는다', () => {
  const ok = run({
    ...ko("  'app.title': 'VOD 클립 다운로더',"),
    'worker/src/http/copy.ts': "export const COPY = { siteName: 'VOD 클립 다운로더' } as const;\n",
  });
  assert.ok(!has(ok, 'DC6'));
  const bad = run({
    ...ko("  'app.title': 'VOD 클립 다운로더',"),
    'worker/src/http/copy.ts': "export const COPY = { siteName: '치지직 내려받기' } as const;\n",
  });
  assert.ok(has(bad, 'DC6', 'app.title'));
});

// ---------------------------------------------------------------------------
// errors.ts
// ---------------------------------------------------------------------------

test('errors.ts: title·body 합성 키에 DC5·DC8 역할 규칙을 적용하고 apiMessage 유입을 잡는다', () => {
  const src = `function copy(title: string, body: string, actions: string[]) { return { title, body, actions }; }
export function errorCopy(e) {
  switch (e.code) {
    case 'http':
      return copy('요청이 거절됐어요 (HTTP 404)', '잠시 뒤 다시 시도해 주세요', []);
    case 'api': {
      const body = p?.apiMessage?.trim() ? p.apiMessage : '문제예요.';
      return copy('거절했어요', body, []);
    }
  }
}`;
  const v = run({ 'app/src/lib/copy/errors.ts': src });
  assert.ok(has(v, 'DC8', '요청이 거절됐어요 (HTTP 404)'));
  assert.ok(has(v, 'DC8', 'apiMessage'));
  assert.ok(has(v, 'DC5', '잠시 뒤 다시 시도해 주세요'));
});

// ---------------------------------------------------------------------------
// help/*.md
// ---------------------------------------------------------------------------

test('help/*.md: DC1·DC2·DC5가 적용되고 DC7(번호)은 적용되지 않는다', () => {
  const v = run({
    'help/a.md': '# 도움말\n\n1. 링크를 열어 주세요.\n2. 확인하세요.\n\n```\n링크 코드 블록은 안 본다\n```\n',
  });
  assert.ok(v.some((x) => x.file === 'help/a.md' && x.rule === 'DC1' && x.line === 3));
  assert.ok(v.some((x) => x.file === 'help/a.md' && x.rule === 'DC2' && x.line === 4));
  assert.ok(!v.some((x) => x.file === 'help/a.md' && (x.rule === 'DC7' || x.line > 5)));
});

// ---------------------------------------------------------------------------
// terms.json allow
// ---------------------------------------------------------------------------

test('terms.json allow: 키와 말이 맞는 위반만 건너뛴다', () => {
  const seed = ko("  'url.pasteHint': '{paste}로 붙여넣으면 바로 불러와요',\n  'other.hint': '{paste}로 붙여넣어요',");
  const v = run(seed);
  assert.ok(!has(v, 'DC3', '{paste}로 붙여넣으면 바로 불러와요'));
  assert.ok(has(v, 'DC3', '{paste}로 붙여넣어요'));
});

// ---------------------------------------------------------------------------
// DC10 문서 패리티
// ---------------------------------------------------------------------------

const MD_15 = `${MD_GLOSSARY_ONLY}

## 15. 고칠 문구

### 15.1 ko.ts

| 현재 키 | 현재 | 새 키·문구 | 규칙 |
|---|---|---|---|
| \`a\` | x | \`common.close\` **닫기** / \`common.later\` **나중에** | 규칙 |
| \`b\` | y | \`list.empty.title\` **아직 받은 영상이 없어요** | 규칙 |

## 16. 열린 항목
`;

test('parseNewCopyPairs: "새 키·문구" 열의 `키` **값** 쌍만 뽑는다', () => {
  const { pairs, keys } = parseNewCopyPairs(MD_15);
  assert.deepEqual(pairs.map((p) => [p.key, p.value]), [
    ['common.close', '닫기'],
    ['common.later', '나중에'],
    ['list.empty.title', '아직 받은 영상이 없어요'],
  ]);
  assert.ok(keys.has('common.close'));
});

test('parseDocKeys: 코드 블록 안·파일 이름·와일드카드는 보지 않는다', () => {
  const md = '`a11y.more` 와 `app.md` 와 `x.y.*` 와 `settings.cookie.title`\n```\n`auth.x.title`\n```\n`dialog.cancel.title`\n';
  const out = parseDocKeys(md, new Set(['settings.cookie.title', 'a11y.more']));
  assert.deepEqual(out.map((o) => o.key), ['a11y.more', 'settings.cookie.title', 'dialog.cancel.title']);
});

test('DC10: §15의 키가 deck에 없거나 값이 다르면 각각 위반이다', () => {
  const root = mkRoot({
    'docs/design/system/content.md': MD_15,
    ...ko("  'common.close': '닫기',\n  'common.later': '다음에',"),
    'docs/design/system/patterns.md': '문서는 `list.empty.title`과 `ghost.thing.title`을 가리킨다.\n',
  });
  const v = check(root, { checkRefs: false }).filter((x) => x.rule === 'DC10');
  const texts = v.map((x) => `${x.file}|${x.text}`).sort();
  assert.deepEqual(texts, [
    'app/src/lib/copy/ko.ts|common.later',
    'docs/design/system/content.md|list.empty.title',
    'docs/design/system/patterns.md|ghost.thing.title',
    'docs/design/system/patterns.md|list.empty.title',
  ]);
});

test('DC10: deck이 §15와 같으면 통과한다', () => {
  const root = mkRoot({
    'docs/design/system/content.md': MD_15,
    ...ko("  'common.close': '닫기',\n  'common.later': '나중에',\n  'list.empty.title': '아직 받은 영상이 없어요',"),
  });
  assert.deepEqual(check(root, { checkRefs: false }).filter((x) => x.rule === 'DC10'), []);
});

// ---------------------------------------------------------------------------
// 저장소 자체
// ---------------------------------------------------------------------------

test('저장소: check(ROOT)가 던지지 않고 위반 레코드가 계약 모양이며 --print-allow 항목이 스키마를 통과한다', () => {
  const v = check(ROOT);
  for (const x of v) {
    assert.match(x.rule, /^DC\d{1,2}$/);
    assert.ok(typeof x.file === 'string' && !x.file.includes('\\'));
    assert.ok(Number.isInteger(x.line) && x.line >= 0);
    assert.ok(typeof x.text === 'string' && x.text.length > 0);
  }
  const entries = toEntries(v);
  assert.deepEqual(validateAllow({ entries }), []);
});

test('저장소: 용어집 패리티 위반은 허용 목록으로 가릴 수 없는 단계 (a)에서 0이다', () => {
  const v = check(ROOT).filter((x) => x.file === 'design/copy/terms.json' || x.msg.includes('용어집 행'));
  assert.deepEqual(v, []);
});

test('content.md §15가 적은 새 문구는 design-copy 글자 규칙을 스스로 통과한다(문서 내부 모순 감시)', () => {
  const { pairs } = parseNewCopyPairs(REAL_CONTENT);
  assert.ok(pairs.length > 40);
  const lines = pairs.map((p) => `  ${JSON.stringify(p.key)}: ${JSON.stringify(p.value)},`);
  const v = check(mkRoot({ ...ko(lines.join('\n')), 'docs/design/system/content.md': MD_GLOSSARY_ONLY }), { checkRefs: false });
  // 값이 같은 키(DC11)는 문서의 약식 키(checkFailed.help 등)에서 생기므로 제외한다
  assert.deepEqual(v.filter((x) => !['DC10', 'DC11'].includes(x.rule)), []);
});

// ---------------------------------------------------------------------------
// L1 라벨 예외(terms.json key "L1")·Rust 대조 테스트 참조
// ---------------------------------------------------------------------------

test('DC8: errors.ts의 L1 고정 라벨("오류 코드")은 건너뛰고 다른 키 없는 "코드"는 잡는다', () => {
  const errors = (body) => ({ 'app/src/lib/copy/errors.ts': `export function f() {\n${body}\n}\n` });
  const ok = run(errors("  return `오류 코드: ${x}`;"));
  assert.ok(!ok.some((x) => x.rule === 'DC8'));
  const bad = run(errors("  return `확인 코드를 입력하세요 ${x}`;"));
  assert.ok(bad.some((x) => x.rule === 'DC8'));
});

test('DC11: 앱 deck 키는 app/src-tauri/src의 .rs 파일이 참조해도 쓰인 것으로 본다', () => {
  const files = { ...ko("  'notify.stalled': '받기가 멈췄어요',"), 'app/src/lib/other.ts': 'export const a = 1;\n' };
  const none = check(mkRoot(files), { checkRefs: true });
  assert.ok(none.some((x) => x.rule === 'DC11' && /notify\.stalled/.test(x.msg)));
  const withRs = check(mkRoot({ ...files, 'app/src-tauri/src/notify_copy.rs': 'let k = "notify.stalled";\n' }), { checkRefs: true });
  assert.ok(!withRs.some((x) => x.rule === 'DC11' && /notify\.stalled/.test(x.msg)));
});
