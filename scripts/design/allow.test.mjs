// node --test scripts/design/allow.test.mjs — 디자인 gate 공용 허용 목록
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ALLOW_PATH,
  ROOT,
  applyAllow,
  defaultReason,
  escapeRegExp,
  formatAllow,
  loadAllow,
  report,
  runGate,
  toEntries,
  validateAllow,
  writeFrom,
} from './allow.mjs';

const SELF = fileURLToPath(new URL('./allow.mjs', import.meta.url));
const entry = (o = {}) => ({ rule: 'DL2', file: 'app/src/a.svelte', pattern: '^padding: 0 12px$', reason: '단계 (b)에서 제거', ...o });
const viol = (o = {}) => ({ rule: 'DL2', file: 'app/src/a.svelte', line: 3, text: 'padding: 0 12px', msg: '길이 리터럴', ...o });

function tmpRoot() {
  const d = mkdtempSync(join(tmpdir(), 'ds-'));
  mkdirSync(join(d, 'scripts', 'design'), { recursive: true });
  return d;
}

test('저장소의 allow.json은 validateAllow 오류가 없다', () => {
  const json = JSON.parse(readFileSync(join(ROOT, ALLOW_PATH), 'utf8'));
  assert.deepEqual(validateAllow(json), []);
  assert.doesNotThrow(() => loadAllow(ROOT));
});

test('validateAllow: 올바른 항목은 통과, adr은 선택', () => {
  assert.deepEqual(validateAllow({ $comment: 'x', entries: [entry(), entry({ rule: 'DL3', adr: 'ADR-0003' })] }), []);
  assert.deepEqual(validateAllow({ entries: [] }), []);
});

test('validateAllow: 이유가 없거나 짧으면 거부한다', () => {
  assert.match(validateAllow({ entries: [entry({ reason: '' })] })[0], /reason/);
  assert.match(validateAllow({ entries: [entry({ reason: '   ' })] })[0], /reason/);
  assert.match(validateAllow({ entries: [entry({ reason: '임시' })] })[0], /reason/);
  const { reason, ...noReason } = entry();
  assert.match(validateAllow({ entries: [noReason] })[0], /reason/);
});

test('validateAllow: 규칙 모양·file·pattern·adr·여분 키', () => {
  assert.match(validateAllow({ entries: [entry({ rule: 'XX1' })] })[0], /rule/);
  assert.match(validateAllow({ entries: [entry({ rule: 'DL123' })] })[0], /rule/);
  assert.match(validateAllow({ entries: [entry({ file: 'a\\b.css' })] })[0], /file/);
  assert.match(validateAllow({ entries: [entry({ file: '/abs.css' })] })[0], /file/);
  assert.match(validateAllow({ entries: [entry({ pattern: '(' })] })[0], /pattern/);
  assert.match(validateAllow({ entries: [entry({ pattern: '\\-' })] })[0], /pattern/, 'u 플래그에서 쓸모없는 이스케이프는 거부');
  assert.match(validateAllow({ entries: [entry({ adr: 'ADR-3' })] })[0], /adr/);
  assert.match(validateAllow({ entries: [entry({ extra: 1 })] })[0], /extra/);
  assert.match(validateAllow({ entries: [], other: 1 })[0], /other/);
  assert.match(validateAllow({ entries: {} })[0], /entries/);
  assert.match(validateAllow([])[0], /객체/);
});

test('validateAllow: 중복과 정렬', () => {
  assert.match(validateAllow({ entries: [entry(), entry()] }).join('\n'), /중복/);
  const sorted = [entry({ rule: 'DL1' }), entry({ rule: 'DL2', file: 'a.css' }), entry({ rule: 'DL2', file: 'b.css' })];
  assert.deepEqual(validateAllow({ entries: sorted }), []);
  assert.match(validateAllow({ entries: [...sorted].reverse() }).join('\n'), /정렬/);
});

test('escapeRegExp: 메타문자를 이스케이프해 u 플래그로도 통째로 맞는다', () => {
  const text = 'a.b*c+d?e^f${g}(h)|i[j]k\\l-m/n padding: 0 12px';
  const re = new RegExp(`^${escapeRegExp(text)}$`, 'u');
  assert.ok(re.test(text));
  assert.ok(!re.test(`${text}x`));
  assert.equal(escapeRegExp('a-b'), 'a-b');
});

test('applyAllow: 규칙·파일·pattern이 모두 맞아야 지운다, 접두가 다른 항목은 보지 않는다', () => {
  const entries = [
    entry(),
    entry({ rule: 'DC1', file: 'app/src/lib/copy/ko.ts', pattern: '클릭' }),
    entry({ rule: 'DL9', pattern: '^box-shadow: x$' }),
  ];
  const vs = [
    viol(),
    viol({ file: 'app/src/b.svelte' }), // 파일이 달라 남는다
    viol({ rule: 'DL3', text: 'padding: 0 12px' }), // 규칙이 달라 남는다
  ];
  const { remaining, unused } = applyAllow(vs, entries, ['DL', 'DS', 'DP', 'DX']);
  assert.deepEqual(remaining.map((v) => [v.rule, v.file]), [['DL2', 'app/src/b.svelte'], ['DL3', 'app/src/a.svelte']]);
  // DC 항목은 이 gate의 접두가 아니라 unused에도 나오지 않고, 맞는 위반이 없는 DL9만 나온다
  assert.deepEqual(unused.map((e) => e.rule), ['DL9']);
});

test('applyAllow: 항목 하나가 같은 text의 위반 여러 줄을 덮는다', () => {
  const { remaining, unused } = applyAllow([viol({ line: 1 }), viol({ line: 9 })], [entry()], ['DL']);
  assert.deepEqual([remaining, unused], [[], []]);
});

test('report: 일반 형식 한 줄, 지울 항목, 요약, 종료 코드', () => {
  const lines = [];
  const code = report('design-lint', { remaining: [viol()], unused: [entry({ rule: 'DL9', pattern: '^x$' })] }, { env: {}, log: (s) => lines.push(s) });
  assert.equal(code, 1);
  assert.deepEqual(lines, [
    'app/src/a.svelte:3: DL2: 길이 리터럴',
    'scripts/design/allow.json:0: DL9: 허용 목록 항목이 맞는 위반이 없다(지운다): app/src/a.svelte /^x$/',
    '[design-lint] 위반 1, 지울 허용 항목 1',
  ]);
});

test('report: 둘 다 0이면 0, GITHUB_ACTIONS면 ::error 주석', () => {
  const lines = [];
  assert.equal(report('g', { remaining: [], unused: [] }, { env: {}, log: (s) => lines.push(s) }), 0);
  assert.deepEqual(lines, ['[g] 위반 0, 지울 허용 항목 0']);

  const gh = [];
  const code = report('g', { remaining: [viol({ msg: '백분율 100%\n둘째 줄' })], unused: [] }, { env: { GITHUB_ACTIONS: 'true' }, log: (s) => gh.push(s) });
  assert.equal(code, 1);
  assert.equal(gh[0], '::error file=app/src/a.svelte,line=3::DL2: 백분율 100%25%0A둘째 줄');
});

test('report: 지울 항목만 있어도 1', () => {
  assert.equal(report('g', { remaining: [], unused: [entry()] }, { env: {}, log: () => {} }), 1);
});

test('defaultReason: 표의 순서대로 처음 맞는 이유', () => {
  assert.equal(defaultReason('DL1', 'worker/src/http/pages.ts'), '단계 (e)에서 제거(Worker 페이지)');
  assert.equal(defaultReason('DC1', 'worker/src/http/copy.ts'), '단계 (e)에서 제거(Worker 페이지)');
  assert.equal(defaultReason('DC1', 'app/src/lib/copy/ko.ts'), '단계 (d)에서 제거(문구)');
  assert.equal(defaultReason('DL1', 'app/src/lib/copy/ko.ts'), '단계 (d)에서 제거(문구)');
  assert.equal(defaultReason('DL1', 'docs/design/system/content.md'), '단계 (d)에서 제거(문구)');
  assert.equal(defaultReason('DL1', 'help/start.md'), '단계 (d)에서 제거(문구)');
  assert.equal(defaultReason('DL2', 'app/src/lib/components/ui/Button.svelte'), '단계 (b)에서 제거(ui/ 기본 컴포넌트)');
  assert.equal(defaultReason('DL2', 'design/ui.css'), '단계 (b)에서 제거(ui/ 기본 컴포넌트)');
  assert.equal(defaultReason('DL2', 'app/src/app.css'), '단계 (b)에서 제거(ui/ 기본 컴포넌트)');
  assert.equal(defaultReason('DI2', 'licenses/lucide.txt'), '단계 (b)에서 제거(ui/ 기본 컴포넌트)');
  assert.equal(defaultReason('DP1', 'app/src/lib/components/ui/vocab.ts'), '단계 (b)에서 제거(ui/ 기본 컴포넌트)');
  assert.equal(defaultReason('DI1', 'app/src/lib/views/A.svelte'), '단계 (b)에서 제거(ui/ 기본 컴포넌트)');
  assert.equal(defaultReason('DT3', 'app/src/styles/tokens.css'), '단계 (b)·(c)에서 사용처가 생기면 제거(미사용 토큰)');
  assert.equal(defaultReason('DL2', 'app/src/lib/components/jobs/JobItem.svelte'), '단계 (c)에서 제거(기능 화면)');
  assert.equal(defaultReason('DT2', 'app/src/lib/views/A.svelte'), '단계 (c)에서 제거(기능 화면)');
});

test('toEntries: text 전체에 맞는 pattern, 중복 제거, 정렬, 스키마 통과', () => {
  const vs = [
    viol({ file: 'b.css', text: 'width: calc(100% - 20px)' }),
    viol({ file: 'a.css', line: 1, text: 'margin: 4px' }),
    viol({ file: 'a.css', line: 8, text: 'margin: 4px' }),
    viol({ rule: 'DL1', file: 'a.css', text: 'color: #fff' }),
  ];
  const es = toEntries(vs);
  assert.deepEqual(es.map((e) => [e.rule, e.file]), [['DL1', 'a.css'], ['DL2', 'a.css'], ['DL2', 'b.css']]);
  assert.equal(es[2].pattern, '^width: calc\\(100% - 20px\\)$');
  assert.deepEqual(validateAllow({ entries: es }), []);
  // 만든 항목이 자기 위반을 다시 정확히 덮는다
  const { remaining, unused } = applyAllow(vs, es, ['DL']);
  assert.deepEqual([remaining, unused], [[], []]);
});

test('formatAllow: 항목마다 한 줄, 빈 목록은 []', () => {
  assert.equal(formatAllow('c', []), '{\n  "$comment": "c",\n  "entries": []\n}\n');
  const text = formatAllow('c', [entry(), entry({ rule: 'DL3', adr: 'ADR-0003' })]);
  assert.equal(text.split('\n').length, 8);
  assert.deepEqual(JSON.parse(text).entries[1].adr, 'ADR-0003');
});

test('loadAllow: 파일이 없거나 깨졌으면 던진다', () => {
  const d = tmpRoot();
  try {
    assert.throws(() => loadAllow(d), /없음/);
    writeFileSync(join(d, ALLOW_PATH), '{ 깨짐');
    assert.throws(() => loadAllow(d), /JSON/);
    writeFileSync(join(d, ALLOW_PATH), JSON.stringify({ entries: [entry({ reason: '' })] }));
    assert.throws(() => loadAllow(d), /reason/);
    writeFileSync(join(d, ALLOW_PATH), JSON.stringify({ entries: [entry()] }));
    assert.equal(loadAllow(d).length, 1);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('runGate: --print-allow, 통과·위반·지울 항목·오류 종료 코드', async () => {
  const d = tmpRoot();
  try {
    const lines = [];
    const errs = [];
    const base = { gate: 'g', families: ['DL'], root: d, env: {}, log: (s) => lines.push(s), error: (s) => errs.push(s) };
    const check = () => [viol()];

    // --print-allow는 허용 목록 파일이 없어도 위반 전부를 낸다
    let printed = '';
    assert.equal(await runGate({ ...base, check, argv: ['--print-allow'], out: (s) => (printed += s) }), 0);
    assert.deepEqual(JSON.parse(printed).map((e) => e.rule), ['DL2']);

    // 허용 목록 없음 → 2
    assert.equal(await runGate({ ...base, check, argv: [] }), 2);
    assert.match(errs.join('\n'), /allow\.json 없음/);

    // 비어 있으면 위반 1
    writeFileSync(join(d, ALLOW_PATH), formatAllow('c', []));
    assert.equal(await runGate({ ...base, check, argv: [] }), 1);

    // 항목이 덮으면 0
    writeFileSync(join(d, ALLOW_PATH), formatAllow('c', toEntries([viol()])));
    assert.equal(await runGate({ ...base, check, argv: [] }), 0);

    // 위반이 없어졌는데 항목이 남으면 1
    assert.equal(await runGate({ ...base, check: () => [], argv: [] }), 1);

    // check가 던지면 2
    assert.equal(await runGate({ ...base, check: () => { throw new Error('입력 오류'); }, argv: [] }), 2);

    // --root로 다른 루트를 받는다
    const other = tmpRoot();
    try {
      writeFileSync(join(other, ALLOW_PATH), formatAllow('c', []));
      assert.equal(await runGate({ ...base, check: (r) => (r === other ? [] : [viol()]), argv: ['--root', other] }), 0);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('--write-from: 여러 출력을 합쳐(중복 제거·정렬) $comment를 유지하고 다시 쓴다', () => {
  const d = tmpRoot();
  try {
    writeFileSync(join(d, ALLOW_PATH), formatAllow('내 설명', [entry()]));
    const a = join(d, 'a.json');
    const b = join(d, 'b.json');
    writeFileSync(a, JSON.stringify(toEntries([viol({ file: 'z.css', text: 'top: 3px' }), viol({ rule: 'DT2', file: 'x.css', text: '--nope' })])));
    writeFileSync(b, JSON.stringify(toEntries([viol({ file: 'z.css', text: 'top: 3px' }), viol({ rule: 'DC1', file: 'k.ts', text: '클릭' })])));
    const r = spawnSync(process.execPath, [SELF, '--write-from', a, b, '--root', d], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const json = JSON.parse(readFileSync(join(d, ALLOW_PATH), 'utf8'));
    assert.equal(json.$comment, '내 설명');
    assert.deepEqual(json.entries.map((e) => `${e.rule} ${e.file}`), ['DC1 k.ts', 'DL2 z.css', 'DT2 x.css']);
    assert.deepEqual(validateAllow(json), []);
    assert.deepEqual(loadAllow(d).length, 3);
    assert.equal(readFileSync(join(d, ALLOW_PATH), 'utf8'), formatAllow(json.$comment, json.entries));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('--write-from: 입력이 배열이 아니거나 인자가 없으면 2', () => {
  const d = tmpRoot();
  try {
    const bad = join(d, 'bad.json');
    writeFileSync(bad, '{}');
    assert.equal(spawnSync(process.execPath, [SELF, '--write-from', bad, '--root', d], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [SELF, '--write-from', '--root', d], { encoding: 'utf8' }).status, 2);
    assert.equal(spawnSync(process.execPath, [SELF], { encoding: 'utf8' }).status, 2);
    assert.throws(() => writeFrom(d, [bad]), /배열/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
