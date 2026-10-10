// ADR 기계 검사 DA1~DA11(governance.md §4.3). docs/design/system/adr/*.md 열 장이 통과해야 한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYS = join(ROOT, 'docs/design/system');
const ADR_DIR = join(SYS, 'adr');

const STATUS_RE = /^(제안|채택\(잠정\)|채택|폐기\(→ \d{4}\))$/;
const SECTIONS = ['맥락', '결정', '근거', '결과', '대안과 버린 이유'];
const GRADE_RE = /최고 등급:\s*E([0-4])\b/;
const IMPACT_RE = /결정 영향:\s*(작음|중간|큼)/;

const read = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

/** `## 이름` 절로 나눈다. 반환: [{ name, body, line }] (line은 1부터) */
function splitH2(text) {
  const lines = text.split('\n');
  const out = [];
  let cur = null;
  lines.forEach((l, i) => {
    const m = l.match(/^## (.+?)\s*$/);
    if (m) { cur = { name: m[1], body: [], line: i + 1 }; out.push(cur); }
    else if (cur) cur.body.push(l);
  });
  return out.map((s) => ({ ...s, body: s.body.join('\n') }));
}

/** 마크다운 표의 데이터 행을 셀 배열로 돌려준다(헤더·구분선 제외). */
function tableRows(body) {
  const rows = body.split('\n').filter((l) => /^\|.*\|\s*$/.test(l));
  return rows.map((l) => l.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim()));
}

/**
 * ADR 파일 모음을 검사한다. adrs: [{ file, text }]. docs: [{ file, text }](시스템 문서, DA11용).
 * 반환: `file: DAn: 내용` 문자열 목록.
 */
export function checkAdrs(adrs, docs = []) {
  const problems = [];
  const warn = (file, rule, msg) => problems.push(`${file}: ${rule}: ${msg}`);
  const byNum = new Map();

  // DA1: 파일명·연속 번호
  const nums = [];
  for (const { file } of adrs) {
    if (!/^\d{4}-[a-z0-9-]+\.md$/.test(file)) { warn(file, 'DA1', '파일명이 ^\\d{4}-[a-z0-9-]+\\.md$ 가 아니다'); continue; }
    nums.push(Number(file.slice(0, 4)));
  }
  const sorted = [...nums].sort((a, b) => a - b);
  sorted.forEach((n, i) => {
    if (i > 0 && n === sorted[i - 1]) warn(String(n).padStart(4, '0'), 'DA1', '번호가 중복이다');
    if (n !== i + 1 && !(i > 0 && n === sorted[i - 1])) warn(String(n).padStart(4, '0'), 'DA1', `번호가 0001부터 연속이 아니다(${i + 1}번이 비었다)`);
  });

  for (const { file, text } of adrs) {
    const num = file.slice(0, 4);
    const lines = text.split('\n');
    const secs = splitH2(text);
    const head = text.split(/^## /m)[0];
    byNum.set(num, head);

    // DA2: 제목 번호 = 파일명 번호
    const t = lines[0].match(/^# (\d{4}) \S/);
    if (!t) warn(file, 'DA2', '첫 줄이 `# NNNN 제목` 꼴이 아니다');
    else if (t[1] !== num) warn(file, 'DA2', `제목 번호 ${t[1]} ≠ 파일명 번호 ${num}`);

    // DA3: 상태·날짜·관련
    const status = head.match(/상태:\s*(.+?)(?=\s{2,}|\n|$)/)?.[1];
    const date = head.match(/날짜:\s*(\d{4}-\d{2}-\d{2})/)?.[1]; // 뒤에 `(편집 …)` 같은 주석이 붙어도 된다
    const related = head.match(/관련:\s*(.+)/)?.[1];
    if (!status || !STATUS_RE.test(status)) warn(file, 'DA3', `상태 값이 넷 중 하나가 아니다(${status ?? '없음'})`);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) warn(file, 'DA3', `날짜가 YYYY-MM-DD가 아니다(${date ?? '없음'})`);
    if (!related || !related.trim()) warn(file, 'DA3', '관련이 없다');

    // DA4: 절 다섯이 이 순서로, 결과 안에 재검증 조건 소절
    const names = secs.map((s) => s.name);
    const idx = SECTIONS.map((n) => names.indexOf(n));
    if (idx.some((i) => i < 0)) warn(file, 'DA4', `절이 빠졌다: ${SECTIONS.filter((_, k) => idx[k] < 0).join(', ')}`);
    else if (idx.some((v, k) => k > 0 && v <= idx[k - 1])) warn(file, 'DA4', `절 순서가 ${SECTIONS.join(' → ')} 가 아니다`);
    const result = secs.find((s) => s.name === '결과');
    const hasRevisit = !!result && /^### 재검증 조건\s*$/m.test(result.body);
    if (result && !hasRevisit) warn(file, 'DA4', '`## 결과` 안에 `### 재검증 조건` 소절이 없다');

    // DA5: 근거 표·최고 등급·결정 영향(사람 결정은 결정자 줄로 대신)
    const basis = secs.find((s) => s.name === '근거');
    let grade = null;
    let impact = null;
    if (basis) {
      const humanOnly = /결정자:/.test(basis.body);
      const headerRow = basis.body.split('\n').find((l) => /주장\s*\|\s*등급\s*\|\s*출처\s*\|\s*표본·날짜/.test(l)); // 맨 앞 `#` 열은 있어도 된다
      if (!headerRow) warn(file, 'DA5', '근거 표 헤더 `주장 | 등급 | 출처 | 표본·날짜`가 없다');
      grade = basis.body.match(GRADE_RE)?.[1] ?? null;
      impact = basis.body.match(IMPACT_RE)?.[1] ?? null;
      if (!humanOnly) {
        if (grade === null) warn(file, 'DA5', '`최고 등급: E0~E4` 줄이 없다');
        if (impact === null) warn(file, 'DA5', '`결정 영향: 작음|중간|큼` 줄이 없다');
      }

      // DA8: 표본·날짜 열(4번째)에 % 금지, "명 중" 셀은 `N명 중 M명`
      const cols = headerRow ? headerRow.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim()) : [];
      const dateCol = cols.indexOf('표본·날짜');
      const rows = tableRows(basis.body).filter((r) => dateCol >= 0 && r.length === cols.length && r[cols.indexOf('주장')] !== '주장' && !/^-+$/.test(r[0].replace(/[: ]/g, '')));
      for (const r of rows) {
        const cell = r[dateCol];
        if (/\d+%/.test(cell)) warn(file, 'DA8', `표본·날짜 열에 퍼센트가 있다: ${cell}`);
        if (cell.includes('명 중') && !/\d+명 중 \d+명/.test(cell)) warn(file, 'DA8', `표본 표기가 \`N명 중 M명\`이 아니다: ${cell}`);
      }
    }

    // DA6: 채택은 E4, 또는 E3 이상이고 영향 작음
    if (status === '채택') {
      const g = grade === null ? -1 : Number(grade);
      if (!(g === 4 || (g >= 3 && impact === '작음'))) warn(file, 'DA6', `상태 \`채택\`인데 최고 등급 E${grade ?? '?'}, 영향 ${impact ?? '?'}`);
    }

    // DA7: 영향 큼이면 재검증 조건 필수
    if (impact === '큼' && !hasRevisit) warn(file, 'DA7', '영향이 큼인데 `### 재검증 조건` 소절이 없다');

    // DA9: 텔레메트리 말 금지
    lines.forEach((l, i) => {
      for (const w of ['이탈률', '사용 빈도', '전환율']) if (l.includes(w)) warn(file, 'DA9', `${i + 1}행에 \`${w}\`가 있다(텔레메트리 없음)`);
    });

    // DA10: [잠정]·[취향] 표시는 같은 줄 또는 다음 줄에 "확인:"
    // 표 머리에 `확인 …` 열이 있으면 그 칸이 비지 않은 행은 "확인:"을 대신한다
    let confirmCol = -1;
    lines.forEach((l, i) => {
      if (/^\|.*\|\s*$/.test(l)) {
        const cells = l.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
        const h = cells.findIndex((c) => /^확인/.test(c));
        if (h >= 0 && !/^\|[-| :]+\|$/.test(l)) confirmCol = h;
        else if (/^\|[-| :]+\|$/.test(l)) { /* 구분선 */ }
        else if (confirmCol >= 0 && cells[confirmCol]) return;
      } else confirmCol = -1;
      if (/\[(잠정|취향)\]/.test(l) && !l.includes('확인:') && !(lines[i + 1] ?? '').includes('확인:')) warn(file, 'DA10', `${i + 1}행 [잠정]·[취향] 표시 뒤에 "확인:"이 없다`);
    });
  }

  // DA11: 시스템 문서의 ADR-NNNN 인용
  for (const { file, text } of docs) {
    text.split('\n').forEach((l, i) => {
      for (const m of l.matchAll(/ADR-(\d{4})/g)) {
        const head = byNum.get(m[1]);
        if (head === undefined) { warn(file, 'DA11', `${i + 1}행 ADR-${m[1]} 파일이 없다`); continue; }
        // 인용 맥락 = 인용 바로 앞 절(`|`·`;`·괄호·마침표로 끊은 마지막 조각)의 D 번호
        const clause = l.slice(0, m.index).split(/[|;()]|\.\s/).pop();
        const dNums = [...clause.matchAll(/(?<![A-Za-z-])D(\d{1,2})\b/g)].map((x) => x[1]);
        if (dNums.length === 0) continue;
        const ctx = head.split('\n').filter((h) => h.startsWith('#') || h.includes('관련:')).join('\n');
        if (!dNums.some((d) => new RegExp(`(?<![A-Za-z0-9-])D${d}\\b`).test(ctx))) warn(file, 'DA11', `${i + 1}행 ADR-${m[1]}의 관련·제목에 인용 맥락 D${dNums.join('·D')}가 없다`);
      }
    });
  }
  return problems;
}

function loadRepo() {
  const adrs = readdirSync(ADR_DIR).sort().map((file) => ({ file, text: read(join(ADR_DIR, file)) }));
  const docs = readdirSync(SYS).filter((f) => f.endsWith('.md')).sort().map((file) => ({ file, text: read(join(SYS, file)) }));
  return { adrs, docs };
}

test('ADR 열 장이 DA1~DA11을 통과한다', () => {
  const { adrs, docs } = loadRepo();
  assert.ok(adrs.length >= 10, `ADR 파일 ${adrs.length}장`);
  assert.deepEqual(checkAdrs(adrs, docs), []);
});

// ---- 음성 씨앗: 올바른 최소 ADR을 만들어 하나씩 깨뜨린다 ----
const GOOD = [
  '# 0001 예시',
  '',
  '상태: 채택(잠정)   날짜: 2026-10-09   관련: D5',
  '',
  '## 맥락', '문제.', '',
  '## 결정', '한다.', '',
  '## 근거',
  '| 주장 | 등급 | 출처 | 표본·날짜 |',
  '|---|---|---|---|',
  '| 가짜 근거 | E1 | 가짜 | 3명 중 2명 |',
  '',
  '최고 등급: E1 / 결정 영향: 큼 / 판정: 채택(잠정)', '',
  '## 결과', '바뀐다.', '',
  '### 재검증 조건', '본다.', '',
  '## 대안과 버린 이유', '없다.', '',
].join('\n');
const seed = (text, file = '0001-example.md') => checkAdrs([{ file, text }]);

test('음성 씨앗: 올바른 최소 ADR은 통과한다', () => {
  assert.deepEqual(seed(GOOD), []);
});

const NEG = [
  ['DA1', (t) => t, '0001-Bad_Name.md'],
  ['DA2', (t) => t.replace('# 0001 예시', '# 0002 예시')],
  ['DA3', (t) => t.replace('상태: 채택(잠정)', '상태: 대기')],
  ['DA3', (t) => t.replace('날짜: 2026-10-09', '날짜: 2026/10/09')],
  ['DA4', (t) => t.replace('## 결정\n한다.\n\n', '')],
  ['DA4', (t) => t.replace('### 재검증 조건', '### 다시 본다').replace('결정 영향: 큼', '결정 영향: 작음')],
  ['DA5', (t) => t.replace('최고 등급: E1 / ', '')],
  ['DA6', (t) => t.replace('상태: 채택(잠정)', '상태: 채택')],
  ['DA7', (t) => t.replace('### 재검증 조건\n본다.\n\n', '')],
  ['DA8', (t) => t.replace('3명 중 2명', '80%')],
  ['DA8', (t) => t.replace('3명 중 2명', '3명 중 약 2')],
  ['DA9', (t) => t.replace('한다.', '이탈률을 본다.')],
  ['DA10', (t) => t.replace('한다.', '값은 13px [취향]이다.')],
];
for (const [rule, mutate, file] of NEG) {
  test(`음성 씨앗: ${rule}이 잡힌다`, () => {
    const p = seed(mutate(GOOD), file);
    assert.ok(p.some((x) => x.includes(`${rule}:`)), `${rule} 없음: ${JSON.stringify(p)}`);
  });
}

test('음성 씨앗: DA1 번호 빈칸·중복', () => {
  const two = [{ file: '0001-a.md', text: GOOD }, { file: '0003-c.md', text: GOOD.replace('# 0001', '# 0003') }];
  assert.ok(checkAdrs(two).some((x) => x.includes('DA1:')));
  const dup = [{ file: '0001-a.md', text: GOOD }, { file: '0001-b.md', text: GOOD }];
  assert.ok(checkAdrs(dup).some((x) => x.includes('중복')));
});

test('양성 씨앗: [취향] 표시에 같은 줄 "확인:"이 있으면 통과, 채택은 E4면 통과', () => {
  assert.deepEqual(seed(GOOD.replace('한다.', '값은 13px [취향]이다. 확인: D62 과업.')), []);
  assert.deepEqual(seed(GOOD.replace('상태: 채택(잠정)', '상태: 채택').replace('E1 | 가짜', 'E4 | 가짜').replace('최고 등급: E1', '최고 등급: E4')), []);
});

test('음성 씨앗: DA11 없는 ADR 인용과 맥락 D 번호 불일치', () => {
  const adrs = [{ file: '0001-example.md', text: GOOD }];
  assert.ok(checkAdrs(adrs, [{ file: 'x.md', text: 'D5, ADR-0099' }]).some((x) => x.includes('DA11:')));
  assert.ok(checkAdrs(adrs, [{ file: 'x.md', text: 'D36, ADR-0001' }]).some((x) => x.includes('DA11:')));
  assert.deepEqual(checkAdrs(adrs, [{ file: 'x.md', text: 'D5, ADR-0001' }]), []);
});
