#!/usr/bin/env node
// 공개 저장소 누출 검사기. 결정적이며 외부 의존성이 없다(Node 18+).
//
//   node scripts/ci/public-scan.mjs                 # 추적 중인 파일(작업 트리)을 검사
//   node scripts/ci/public-scan.mjs --all-history   # 모든 ref의 모든 blob·경로·커밋 메시지를 검사
//   node scripts/ci/public-scan.mjs --hash < list   # 줄마다 denylist 항목(해시)을 만든다(원문은 저장소에 두지 않는다)
//
// 찾으면 종료 코드 1, 깨끗하면 0, 사용법·git 오류는 2. 결과에는 일치한 원문을 싣지 않는다.
//
// 규칙
//   signed-token   hdnts=/hdntl= 토큰에 실제 시각(9자리 이상 숫자)이 든 것
//   hmac           hmac= 뒤 8자리 이상 hex가 0이 아닌 것(%3D 인코딩 포함)
//   pd-signature   _lsu_sa_= 뒤 16자리 이상 hex가 0이 아닌 것
//   key-endpoint   암호화 키 주소의 경로 조각
//   naver-cookie   NID_AUT / NID_SES 뒤에 20자 이상 값
//   hex-id         32·36자리 hex 토큰 중 허용 목록(가짜 ID)에 없는 것
//   denylist       scripts/ci/public-denylist.txt의 해시와 같은 토큰·n-gram·blob

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DENYLIST_PATH = join(HERE, 'public-denylist.txt');
const SALT = 'chzzk-public-scan\0';

// 가짜 ID 허용 목록(소문자). testdata/README.md와 scripts/fixtures/gen-fixtures.mjs의 값이다.
export const HEX_ID_ALLOWLIST = new Set([
  '000000000000000000000000000000a1',
  '000000000000000000000000000000b2',
  '000000000000000000000000000000c3',
  '000000000000000000000000000000000a01',
  '000000000000000000000000000000000b02',
  '000000000000000000000000000000000c03',
  '000000000000000000000000000000000c04',
]);

// 이 파일과 테스트가 스스로 걸리지 않도록 일부 패턴은 조각을 이어 만든다.
const KEY_ENDPOINT = [new RegExp('aes' + '_key', 'i'), new RegExp('encryption' + '/videos', 'i')];

const nonZeroHex = (h) => /[1-9a-f]/i.test(h);

/** 한 줄에서 규칙 위반 이름 목록. */
export function lineRules(line) {
  const hits = [];
  for (const m of line.matchAll(/hdnt[sl](?:=|%3D)([^\s"'<>]{0,400})/gi)) {
    if (/(?:exp|st)(?:=|%3D)\d{9,}/i.test(m[1])) hits.push('signed-token');
  }
  for (const m of line.matchAll(/hmac(?:=|%3D)([0-9a-f]{8,})/gi)) {
    if (nonZeroHex(m[1])) hits.push('hmac');
  }
  for (const m of line.matchAll(/_lsu_sa_(?:=|%3D)([0-9a-f]{16,})/gi)) {
    if (nonZeroHex(m[1])) hits.push('pd-signature');
  }
  if (KEY_ENDPOINT.some((re) => re.test(line))) hits.push('key-endpoint');
  if (/NID_(?:AUT|SES)["'\s:=]+[A-Za-z0-9+/=_%.-]{20,}/.test(line)) hits.push('naver-cookie');
  for (const m of line.matchAll(/(?<![0-9A-Za-z])([0-9a-fA-F]{32}|[0-9a-fA-F]{36})(?![0-9A-Za-z])/g)) {
    if (!HEX_ID_ALLOWLIST.has(m[1].toLowerCase())) hits.push('hex-id');
  }
  return hits;
}

const norm = (s) => s.normalize('NFC').toLowerCase();
const TOKEN = /[0-9a-z]+|[가-힣]+/gu;

export const tokenize = (s) => norm(s).match(TOKEN) ?? [];

/** denylist와 대조할 후보: 토큰, 연속 토큰 2~4개, 한글 덩어리의 2~8글자 부분 문자열, 토큰 안의 7~10자리 숫자. */
export function candidates(line) {
  const t = tokenize(line);
  const out = new Set();
  for (let i = 0; i < t.length; i++) {
    out.add(t[i]);
    for (let n = 2; n <= 4 && i + n <= t.length; n++) out.add(t.slice(i, i + n).join(' '));
    const tok = t[i];
    if (/^[가-힣]+$/u.test(tok)) {
      for (let a = 0; a < tok.length; a++) {
        for (let len = 2; len <= 8 && a + len <= tok.length; len++) out.add(tok.slice(a, a + len));
      }
    } else {
      for (const d of tok.match(/\d{7,10}/g) ?? []) out.add(d);
    }
  }
  return out;
}

export const hashCandidate = (s) => createHash('sha256').update(SALT + s).digest('hex');
export const hashBlob = (buf) => 'blob:' + createHash('sha256').update(buf).digest('hex');

/** denylist 항목: 정규화한 문자열(토큰을 공백 하나로 이은 것)의 해시. 4토큰 넘으면 앞 4토큰만 쓴다. */
export function entryFor(raw) {
  const t = tokenize(raw);
  if (t.length === 0) throw new Error('토큰이 없는 항목');
  return hashCandidate(t.slice(0, 4).join(' '));
}

export function loadDenylist(path = DENYLIST_PATH) {
  const set = new Set();
  if (!existsSync(path)) return set;
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (line) set.add(line);
  }
  return set;
}

/** 텍스트 하나를 검사한다. 결과: [{line, rule}] */
export function scanText(text, deny) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    for (const rule of lineRules(line)) found.push({ line: i + 1, rule });
    if (deny.size) {
      for (const c of candidates(line)) {
        if (deny.has(hashCandidate(c))) {
          found.push({ line: i + 1, rule: 'denylist' });
          break;
        }
      }
    }
  });
  return found;
}

/** blob(파일 내용) 하나를 검사한다. 바이너리는 통째 해시만 본다. */
export function scanBuffer(buf, deny) {
  const found = [];
  if (deny.has(hashBlob(buf))) found.push({ line: 0, rule: 'denylist-blob' });
  const head = buf.subarray(0, 8000);
  if (head.includes(0)) return found;
  return found.concat(scanText(buf.toString('utf8'), deny));
}

function git(args, opts = {}) {
  const r = spawnSync('git', args, { maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) {
    process.stderr.write(`git ${args.join(' ')} 실패: ${r.stderr?.toString() ?? r.error}\n`);
    process.exit(2);
  }
  return r.stdout;
}

function scanWorkTree(cwd, deny) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd }).toString().trim();
  const files = git(['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
  const out = [];
  for (const rel of files) {
    const p = join(root, rel);
    if (!existsSync(p)) continue;
    let buf;
    try {
      buf = readFileSync(p);
    } catch {
      continue; // 디렉토리(서브모듈) 등
    }
    for (const f of scanBuffer(buf, deny)) out.push({ where: `${rel}:${f.line}`, rule: f.rule });
    for (const f of scanText(rel, deny)) out.push({ where: `${rel} (경로)`, rule: f.rule });
  }
  return out;
}

/** 모든 ref에서 닿는 blob(경로 포함)과 커밋·태그 메시지를 검사한다. */
function scanHistory(cwd, deny) {
  const out = [];
  const objs = git(['rev-list', '--all', '--objects'], { cwd }).toString().split('\n').filter(Boolean);
  const pathOf = new Map();
  const paths = new Set();
  for (const l of objs) {
    const sp = l.indexOf(' ');
    if (sp < 0) continue;
    const sha = l.slice(0, sp);
    const p = l.slice(sp + 1);
    paths.add(p);
    if (!pathOf.has(sha)) pathOf.set(sha, p);
  }
  for (const p of paths) {
    for (const f of scanText(p, deny)) out.push({ where: `${p} (경로)`, rule: f.rule });
  }
  const shas = [...pathOf.keys()];
  if (shas.length) {
    const check = git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
      cwd,
      input: shas.join('\n') + '\n',
    })
      .toString()
      .split('\n')
      .filter(Boolean);
    const blobs = check.filter((l) => l.endsWith(' blob')).map((l) => l.split(' ')[0]);
    const data = git(['cat-file', '--batch'], { cwd, input: blobs.join('\n') + '\n' });
    let off = 0;
    while (off < data.length) {
      const nl = data.indexOf(0x0a, off);
      const [sha, , size] = data.subarray(off, nl).toString().split(' ');
      const start = nl + 1;
      const body = data.subarray(start, start + Number(size));
      off = start + Number(size) + 1;
      for (const f of scanBuffer(body, deny)) {
        out.push({ where: `${pathOf.get(sha)}@${sha.slice(0, 12)}:${f.line}`, rule: f.rule });
      }
    }
  }
  const log = git(['log', '--all', '--format=%H%x00%B%x00'], { cwd }).toString().split('\0');
  for (let i = 0; i + 1 < log.length; i += 2) {
    const sha = log[i].trim();
    for (const f of scanText(log[i + 1], deny)) {
      out.push({ where: `커밋 ${sha.slice(0, 12)} 메시지:${f.line}`, rule: f.rule });
    }
  }
  const tags = git(['for-each-ref', 'refs/tags', '--format=%(refname)%00%(contents)%00'], { cwd })
    .toString()
    .split('\0');
  for (let i = 0; i + 1 < tags.length; i += 2) {
    const ref = tags[i].trim();
    for (const f of scanText(ref + '\n' + tags[i + 1], deny)) {
      out.push({ where: `${ref}:${f.line}`, rule: f.rule });
    }
  }
  return out;
}

function main(argv) {
  if (argv.includes('--hash')) {
    const input = readFileSync(0, 'utf8');
    for (const raw of input.split('\n')) {
      if (raw.trim()) console.log(entryFor(raw));
    }
    return 0;
  }
  if (argv.includes('--hash-file')) {
    for (const p of argv.slice(argv.indexOf('--hash-file') + 1)) console.log(hashBlob(readFileSync(p)));
    return 0;
  }
  const unknown = argv.filter((a) => a !== '--all-history');
  if (unknown.length) {
    process.stderr.write(`알 수 없는 인자: ${unknown.join(' ')}\n`);
    return 2;
  }
  const deny = loadDenylist();
  const cwd = process.cwd();
  const history = argv.includes('--all-history');
  const found = history ? scanHistory(cwd, deny) : scanWorkTree(cwd, deny);
  const uniq = [...new Map(found.map((f) => [`${f.where} ${f.rule}`, f])).values()];
  for (const f of uniq) console.log(`${f.where}  [${f.rule}]`);
  const scope = history ? '전체 이력' : '추적 중인 파일';
  if (uniq.length) {
    console.error(`public-scan: ${scope}에서 ${uniq.length}건 발견`);
    return 1;
  }
  console.error(`public-scan: ${scope} 깨끗함 (denylist ${deny.size}개)`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
