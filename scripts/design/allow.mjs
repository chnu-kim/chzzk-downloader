// 디자인 gate 넷(design-tokens·design-lint·design-copy·design-icons)이 함께 쓰는 허용 목록과 공통 CLI
// (governance §2.0). 항목은 위반 하나(규칙·파일·글자)에만 맞고, 맞는 위반이 없어진 항목은 gate가 실패시킨다.
//
//   node scripts/design/allow.mjs --write-from <a.json> [<b.json> …]
//     여러 gate의 `--print-allow` 출력(JSON 배열)을 합쳐 allow.json을 다시 쓴다. 단계 (a) 부트스트랩용.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ALLOW_PATH = 'scripts/design/allow.json';

const ENTRY_KEYS = new Set(['rule', 'file', 'pattern', 'reason', 'adr']);
const RULE_RE = /^D[TLSPXCI]\d{1,2}$/;
const ADR_RE = /^ADR-\d{4}$/;
export const DEFAULT_COMMENT =
  '디자인 gate 넷의 허용 목록(governance.md §2.0·§2.3). 항목 수는 ci/ratchet.json design.allow_entries(늘면 실패). 항목은 위반 하나(규칙·파일·글자)에만 맞고, 맞는 위반이 없어진 항목은 gate가 실패시킨다(지운다).';

/** 정규식 메타문자를 이스케이프한다. `u` 플래그에서도 유효하도록 하이픈은 건드리지 않는다. */
export function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const entryCmp = (a, b) => cmp(a.rule, b.rule) || cmp(a.file, b.file) || cmp(a.pattern, b.pattern);

/** 스키마·중복·정렬·정규식 컴파일 오류 목록. 비어 있으면 올바르다. */
export function validateAllow(json) {
  const errs = [];
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return ['최상위가 객체가 아니다'];
  for (const k of Object.keys(json)) {
    if (k !== '$comment' && k !== 'entries') errs.push(`허용 밖 최상위 키: ${k}`);
  }
  if (!Array.isArray(json.entries)) return [...errs, 'entries가 배열이 아니다'];
  const seen = new Set();
  json.entries.forEach((e, i) => {
    const at = `entries[${i}]`;
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      errs.push(`${at}: 객체가 아니다`);
      return;
    }
    for (const k of Object.keys(e)) if (!ENTRY_KEYS.has(k)) errs.push(`${at}: 허용 밖 키 ${k}`);
    if (typeof e.rule !== 'string' || !RULE_RE.test(e.rule)) errs.push(`${at}: rule이 ^D[TLSPXCI]\\d{1,2}$ 꼴이 아니다`);
    if (typeof e.file !== 'string' || e.file === '' || e.file.includes('\\') || e.file.startsWith('/')) {
      errs.push(`${at}: file은 저장소 상대 POSIX 경로여야 한다`);
    }
    if (typeof e.pattern !== 'string') errs.push(`${at}: pattern이 문자열이 아니다`);
    else {
      try {
        new RegExp(e.pattern, 'u');
      } catch (err) {
        errs.push(`${at}: pattern이 정규식(u)으로 컴파일되지 않는다: ${err.message}`);
      }
    }
    if (typeof e.reason !== 'string' || e.reason.trim().length < 4) errs.push(`${at}: reason(이유)은 공백 아닌 4자 이상이어야 한다`);
    if (e.adr !== undefined && (typeof e.adr !== 'string' || !ADR_RE.test(e.adr))) errs.push(`${at}: adr은 ADR-NNNN 꼴이어야 한다`);
    const key = JSON.stringify([e.rule, e.file, e.pattern]);
    if (seen.has(key)) errs.push(`${at}: (rule,file,pattern) 중복: ${e.rule} ${e.file} ${e.pattern}`);
    seen.add(key);
  });
  if (errs.length === 0) {
    for (let i = 1; i < json.entries.length; i++) {
      if (entryCmp(json.entries[i - 1], json.entries[i]) > 0) {
        errs.push(`entries[${i}]: rule·file·pattern 순으로 정렬되어 있지 않다`);
        break;
      }
    }
  }
  return errs;
}

/** root의 allow.json을 읽어 검증한 항목을 돌려준다. 파일이 없거나 깨졌으면 던진다(gate는 2로 끝낸다). */
export function loadAllow(root = ROOT) {
  const p = join(root, ALLOW_PATH);
  if (!existsSync(p)) throw new Error(`${ALLOW_PATH} 없음`);
  let json;
  try {
    json = JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`${ALLOW_PATH}: JSON 오류: ${err.message}`);
  }
  const errs = validateAllow(json);
  if (errs.length) throw new Error(`${ALLOW_PATH}: ${errs.join('; ')}`);
  return json.entries;
}

/**
 * 위반에서 허용 항목에 맞는 것을 걸러 낸다. `families`는 그 gate의 규칙 접두 배열이고
 * 접두가 맞는 항목만 본다. 항목 e가 위반 v에 맞음 ⇔ 규칙·파일이 같고 pattern(u)이 v.text에 맞는다.
 */
export function applyAllow(violations, entries, families) {
  const mine = entries
    .filter((e) => families.some((f) => e.rule.startsWith(f)))
    .map((e) => ({ e, re: new RegExp(e.pattern, 'u'), used: false }));
  const remaining = [];
  for (const v of violations) {
    let hit = false;
    for (const m of mine) {
      if (m.e.rule === v.rule && m.e.file === v.file && m.re.test(v.text ?? '')) {
        m.used = true;
        hit = true;
      }
    }
    if (!hit) remaining.push(v);
  }
  return { remaining, unused: mine.filter((m) => !m.used).map((m) => m.e) };
}

/** GitHub 주석 값의 이스케이프(워크플로 명령 규칙). */
const ghData = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
const ghProp = (s) => ghData(s).replace(/:/g, '%3A').replace(/,/g, '%2C');

/** 위반 한 줄을 §0 형식으로 찍고, 위반이나 지울 항목이 있으면 1을 돌려준다. */
export function report(gate, { remaining, unused }, { env = process.env, log = console.log } = {}) {
  const gh = env.GITHUB_ACTIONS === 'true';
  const emit = (file, line, rule, text) => {
    if (gh) log(`::error file=${ghProp(file)},line=${line}::${ghData(`${rule}: ${text}`)}`);
    else log(`${file}:${line}: ${rule}: ${text}`);
  };
  for (const v of remaining) emit(v.file, v.line ?? 0, v.rule, v.msg ?? v.text ?? '');
  for (const e of unused) {
    emit(ALLOW_PATH, 0, e.rule, `허용 목록 항목이 맞는 위반이 없다(지운다): ${e.file} /${e.pattern}/`);
  }
  log(`[${gate}] 위반 ${remaining.length}, 지울 허용 항목 ${unused.length}`);
  return remaining.length === 0 && unused.length === 0 ? 0 : 1;
}

/** 허용 항목에 적는 기본 이유(위에서부터 처음 맞는 것). 단계 번호는 governance §10. */
export function defaultReason(rule, file) {
  if (file.startsWith('worker/')) return '단계 (e)에서 제거(Worker 페이지)';
  if (
    rule.startsWith('DC') ||
    file.startsWith('app/src/lib/copy/') ||
    file === 'docs/design/system/content.md' ||
    file.startsWith('help/')
  ) {
    return '단계 (d)에서 제거(문구)';
  }
  if (
    file.startsWith('app/src/lib/components/ui/') ||
    file.startsWith('design/ui.css') ||
    file.startsWith('app/src/app.css') ||
    file.startsWith('licenses/') ||
    rule.startsWith('DI') ||
    rule.startsWith('DP')
  ) {
    return '단계 (b)에서 제거(ui/ 기본 컴포넌트)';
  }
  if (rule === 'DT3') return '단계 (b)·(c)에서 사용처가 생기면 제거(미사용 토큰)';
  return '단계 (c)에서 제거(기능 화면)';
}

/** 위반을 허용 항목으로 바꾼다. pattern은 text 전체에 맞는 정규식이고 중복은 하나로 합친다. */
export function toEntries(violations) {
  const map = new Map();
  for (const v of violations) {
    const pattern = `^${escapeRegExp(v.text ?? '')}$`;
    const key = JSON.stringify([v.rule, v.file, pattern]);
    if (!map.has(key)) map.set(key, { rule: v.rule, file: v.file, pattern, reason: defaultReason(v.rule, v.file) });
  }
  return [...map.values()].sort(entryCmp);
}

/** allow.json 글자: 항목 하나가 한 줄이라 diff가 안정적이다. */
export function formatAllow(comment, entries) {
  const one = (e) => {
    const keys = ['rule', 'file', 'pattern', 'reason', 'adr'].filter((k) => e[k] !== undefined);
    return `    { ${keys.map((k) => `${JSON.stringify(k)}: ${JSON.stringify(e[k])}`).join(', ')} }`;
  };
  const body = entries.length ? `[\n${entries.map(one).join(',\n')}\n  ]` : '[]';
  return `{\n  "$comment": ${JSON.stringify(comment)},\n  "entries": ${body}\n}\n`;
}

/** 여러 `--print-allow` 출력을 합쳐 allow.json을 다시 쓴다($comment 유지). 쓴 항목 수를 돌려준다. */
export function writeFrom(root, files) {
  const merged = new Map();
  for (const f of files) {
    const arr = JSON.parse(readFileSync(resolve(f), 'utf8'));
    if (!Array.isArray(arr)) throw new Error(`${f}: JSON 배열이 아니다`);
    for (const e of arr) {
      const key = JSON.stringify([e.rule, e.file, e.pattern]);
      if (!merged.has(key)) merged.set(key, e);
    }
  }
  const entries = [...merged.values()].sort(entryCmp);
  const p = join(root, ALLOW_PATH);
  let comment = DEFAULT_COMMENT;
  if (existsSync(p)) {
    try {
      comment = JSON.parse(readFileSync(p, 'utf8')).$comment ?? comment;
    } catch {
      // 깨진 파일은 기본 $comment로 새로 쓴다
    }
  }
  const out = { $comment: comment, entries };
  const errs = validateAllow(out);
  if (errs.length) throw new Error(errs.join('; '));
  writeFileSync(p, formatAllow(comment, entries));
  return entries.length;
}

/**
 * 네 gate 공통 CLI.
 * - `--print-allow`: check의 위반 전부를 허용 항목 JSON 배열로 stdout에 쓰고 0.
 * - 아니면 허용 목록을 읽어 걸러 낸 뒤 report. check가 던지거나 허용 목록이 깨졌으면 2.
 * - `--root <dir>`: 다른 저장소 루트(테스트·selftest 사본).
 */
export async function runGate({ gate, families, check, argv = process.argv.slice(2), root = ROOT, log = console.log, error = console.error, env = process.env, out = (s) => process.stdout.write(s) }) {
  let r = root;
  const i = argv.indexOf('--root');
  if (i !== -1) {
    if (!argv[i + 1]) {
      error(`[${gate}] --root에 경로가 없다`);
      return 2;
    }
    r = resolve(argv[i + 1]);
  }
  try {
    const violations = await check(r);
    if (argv.includes('--print-allow')) {
      out(`${JSON.stringify(toEntries(violations), null, 2)}\n`);
      return 0;
    }
    const entries = loadAllow(r);
    return report(gate, applyAllow(violations, entries, families), { env, log });
  } catch (err) {
    error(`[${gate}] ${err?.message ?? err}`);
    return 2;
  }
}

// 직접 실행: --write-from
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const w = argv.indexOf('--write-from');
  if (w === -1) {
    console.error('사용법: node scripts/design/allow.mjs --write-from <a.json> [<b.json> …] [--root <dir>]');
    process.exit(2);
  }
  const ri = argv.indexOf('--root');
  const root = ri !== -1 ? resolve(argv[ri + 1]) : ROOT;
  const files = argv.slice(w + 1).filter((a, k, arr) => !a.startsWith('--') && arr[k - 1] !== '--root');
  if (files.length === 0) {
    console.error('--write-from 뒤에 --print-allow 출력 파일이 하나 이상 필요하다');
    process.exit(2);
  }
  try {
    const n = writeFrom(root, files);
    console.log(`${ALLOW_PATH}: 항목 ${n}개를 썼다`);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
}
