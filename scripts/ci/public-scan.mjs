#!/usr/bin/env node
// 공개 저장소 누출 검사기. 결정적이며 외부 의존성이 없다(Node 18+).
//
//   node scripts/ci/public-scan.mjs                 # 추적 중인 파일(작업 트리)을 검사
//   node scripts/ci/public-scan.mjs --staged        # 인덱스에 올린 내용(커밋될 내용)을 검사. pre-commit 훅용
//   node scripts/ci/public-scan.mjs --all-history   # 모든 ref의 blob·경로·커밋/태그 메시지·ref 이름·작성자를 검사
//   ... --denylist <파일>                           # 저장소 밖 비공개 denylist를 더한다(여러 번 줄 수 있다)
//   node scripts/ci/public-scan.mjs --hash < list   # 줄마다 denylist 항목(해시)을 만든다
//   node scripts/ci/public-scan.mjs --hash-file f…  # 파일 내용 전체의 blob: 항목을 만든다
//
// 환경 변수 PUBLIC_SCAN_DENYLIST(경로, 여러 개면 OS 경로 구분자로 잇는다)도 --denylist와 같다.
// 찾으면 종료 코드 1, 깨끗하면 0, 사용법·git 오류는 2. 결과에는 일치한 원문을 싣지 않는다.
//
// 줄마다 원문과, 디코드한 형태(JSON \uXXXX·\/, HTML 엔티티, %xx를 세 겹까지, NFKC, 폭 없는 문자 제거)를
// 함께 본다. 줄 안의 base64 덩어리가 글자로 풀리면 그것도 본다. NUL이 든 파일은 UTF-16과 글자 조각을 뽑아 본다.
//
// 규칙
//   signed-token   hdnts=/hdntl= 토큰에 실제 시각(9자리 이상 숫자)이 든 것, 또는 어디서든 st=/exp=에 10자리 시각
//   hmac           hmac=·hmac:·"hmac":" 뒤 4자리 이상 hex가 0이 아닌 것
//   pd-signature   _lsu_sa_ 뒤 16자리 이상 hex가 0이 아닌 것
//   key-endpoint   암호화 키 주소의 경로 조각
//   aes-research   암호화 조사 기록의 용어
//   naver-cookie   NID_AUT / NID_SES 뒤에 12자 이상 값(헤더·JSON·쿠키 내보내기 모양)
//   hex-id         32·36자리 hex, 대시 UUID, V1로 시작하는 inKey 중 가짜(0으로 채운 값)가 아닌 것
//   keyed-hex      sig·signature·token·secret 뒤 40자리 이상 hex
//   denylist       denylist의 해시와 같은 토큰·토큰 안 6~13글자·n-gram·한글 부분 문자열·blob
//   identity       (이력) 작성자·커미터·태거 이메일이 noreply 허용 목록에 없는 것

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DENYLIST_PATH = join(HERE, 'public-denylist.txt');
const SALT = 'chzzk-public-scan\0';

// 가짜 ID 허용 목록(소문자). testdata/README.md와 scripts/fixtures/gen-fixtures.mjs의 값이다.
export const HEX_ID_ALLOWLIST = new Set([
  '000000000000000000000000000000a1',
  '000000000000000000000000000000b2',
  '000000000000000000000000000000c3',
  '000000000000000000000000000000d4',
  '000000000000000000000000000000000a01',
  '000000000000000000000000000000000b02',
  '000000000000000000000000000000000c03',
  '000000000000000000000000000000000c04',
]);

// 이 파일과 테스트가 스스로 걸리지 않도록 일부 패턴은 조각을 이어 만든다.
const KEY_ENDPOINT = [new RegExp('aes' + '[-_]key', 'i'), new RegExp('encryption' + '/videos', 'i')];
const AES_RESEARCH = new RegExp(['key' + 'UriTemplate', 'aes' + '128-cbc', 'DASH' + '-SEA'].join('|'), 'i');

const nonZeroHex = (h) => /[1-9a-f]/i.test(h);

// ---- 디코드 ----

const ZERO_WIDTH = /[­᠎​-‏⁠-⁤﻿]/g;
const NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

function codePoint(n) {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff)
    ? String.fromCodePoint(n)
    : '';
}

function decodeLayer(s) {
  return (
    s
      // JSON 이스케이프(서로게이트 쌍은 두 개가 이어져 한 글자가 된다)
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\\//g, '/')
      // HTML 엔티티
      .replace(/&#(\d{1,7});/g, (m, d) => codePoint(Number(d)) || m)
      .replace(/&#x([0-9a-fA-F]{1,6});/g, (m, h) => codePoint(parseInt(h, 16)) || m)
      .replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_, n) => NAMED[n])
      // %xx: 잘못된 조각(100%, %zz, 깨진 UTF-8)은 그대로 둔다
      .replace(/(?:%[0-9a-fA-F]{2})+/g, (m) => {
        const t = Buffer.from(m.replace(/%/g, ''), 'hex').toString('utf8');
        return t.includes('�') ? m : t;
      })
  );
}

/** 사람이 같은 글자로 읽는 여러 표기를 하나로 모은다. */
export function decode(s) {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    const next = decodeLayer(cur);
    if (next === cur) break;
    cur = next;
  }
  return cur.normalize('NFKC').replace(ZERO_WIDTH, '');
}

// ---- 규칙 ----

const EMAIL_OK = [/^(?:\d+\+)?[A-Za-z0-9-]+@users\.noreply\.github\.com$/i, /^noreply@github\.com$/i, /^noreply@anthropic\.com$/i, /@[a-z0-9.-]+\.invalid$/i];
export const emailAllowed = (e) => EMAIL_OK.some((re) => re.test(e.trim()));

function rulesOf(s, hits) {
  if (/hdnt[sl]\s*[=:]/i.test(s) && /(?:exp|st)\s*[=:]\s*\d{9,}/i.test(s)) hits.add('signed-token');
  if (/(?<![0-9A-Za-z])(?:exp|st)\s*=\s*1\d{9}(?!\d)/.test(s)) hits.add('signed-token');
  for (const m of s.matchAll(/hmac["']?\s*[=:]\s*["']?([0-9a-f]{4,})/gi)) {
    if (nonZeroHex(m[1])) hits.add('hmac');
  }
  for (const m of s.matchAll(/_lsu_sa_["']?\s*[=:]\s*["']?([0-9a-f]{16,})/gi)) {
    if (nonZeroHex(m[1])) hits.add('pd-signature');
  }
  if (KEY_ENDPOINT.some((re) => re.test(s))) hits.add('key-endpoint');
  if (AES_RESEARCH.test(s)) hits.add('aes-research');
  if (
    /NID_(?:AUT|SES)["'\s:=]+[A-Za-z0-9+/=_%.-]{12,}/.test(s) ||
    /NID_(?:AUT|SES)["']?\s*,\s*["']?value["']?\s*:\s*["'][^"']{12,}["']/i.test(s)
  ) {
    hits.add('naver-cookie');
  }
  for (const m of s.matchAll(/(?<![0-9A-Za-z])([0-9a-fA-F]{32}|[0-9a-fA-F]{36})(?![0-9A-Za-z])/g)) {
    if (!HEX_ID_ALLOWLIST.has(m[1].toLowerCase())) hits.add('hex-id');
  }
  for (const m of s.matchAll(
    /(?<![0-9A-Za-z])([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4})-[0-9a-f]{12}(?![0-9A-Za-z])/gi,
  )) {
    if (nonZeroHex(m[1])) hits.add('hex-id'); // 가짜 UUID는 앞 네 묶음이 0이다
  }
  for (const m of s.matchAll(/V1([0-9a-f]{60,})/g)) {
    if (!/^0+[0-9a-f]{0,2}$/.test(m[1])) hits.add('hex-id'); // 가짜 inKey: 0으로 채우고 끝 두 글자만 다르다
  }
  if (/(?:sig|signature|token|secret)["']?\s*[=:]\s*["']?[0-9a-f]{40,}/i.test(s)) hits.add('keyed-hex');
}

/** 한 줄에서 규칙 위반 이름 목록(원문과 디코드한 형태 모두). */
export function lineRules(line) {
  const hits = new Set();
  rulesOf(line, hits);
  const d = decode(line);
  if (d !== line) rulesOf(d, hits);
  return [...hits];
}

// ---- denylist ----

const norm = (s) =>
  decode(s)
    .toLowerCase()
    .replace(/(?<=\d)[_,](?=\d)/g, ''); // 12_345_678, 12,345,678
const TOKEN = /[0-9a-z]+|[가-힣]+/gu;

export const tokenize = (s) => norm(s).match(TOKEN) ?? [];

/** 토큰 하나에서 나오는 후보: 토큰 자체, 한글은 2~8글자 부분 문자열, 영숫자는 6~13글자 부분 문자열. */
function tokenCandidates(tok, out) {
  out.add(tok);
  if (/^[가-힣]+$/u.test(tok)) {
    for (let a = 0; a < tok.length; a++) {
      for (let len = 2; len <= 8 && a + len <= tok.length; len++) out.add(tok.slice(a, a + len));
    }
  } else if (tok.length > 6 && tok.length <= 128) {
    for (let a = 0; a < tok.length; a++) {
      for (let len = 6; len <= 13 && a + len <= tok.length; len++) out.add(tok.slice(a, a + len));
    }
  }
}

/** 한 줄의 후보(줄 안의 n-gram만). 테스트·디버깅용. */
export function candidates(line) {
  const out = new Set();
  const t = tokenize(line);
  for (let i = 0; i < t.length; i++) {
    tokenCandidates(t[i], out);
    for (let n = 2; n <= 4 && i + n <= t.length; n++) out.add(t.slice(i, i + n).join(' '));
  }
  return out;
}

export const hashCandidate = (s) => createHash('sha256').update(SALT + s).digest('hex');
export const hashBlob = (buf) => 'blob:' + createHash('sha256').update(buf).digest('hex');

/**
 * denylist 항목: 정규화한 문자열(토큰을 공백 하나로 이은 것)의 해시.
 * 4토큰 이하면 항목 하나, 넘으면 연속 4토큰 창마다 하나다(제목 중간 구절도 잡히게).
 */
export function entriesFor(raw) {
  const t = tokenize(raw);
  if (t.length === 0) throw new Error('토큰이 없는 항목');
  if (t.length <= 4) return [hashCandidate(t.join(' '))];
  const out = [];
  for (let i = 0; i + 4 <= t.length; i++) out.push(hashCandidate(t.slice(i, i + 4).join(' ')));
  return [...new Set(out)];
}

export function loadDenylist(paths = [DENYLIST_PATH]) {
  const set = new Set();
  for (const path of [].concat(paths)) {
    if (!existsSync(path)) continue;
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.replace(/#.*/, '').trim();
      if (line) set.add(line);
    }
  }
  return set;
}

const textEntries = new WeakMap();
function hasTextEntries(deny) {
  if (!textEntries.has(deny)) textEntries.set(deny, [...deny].some((e) => !e.startsWith('blob:')));
  return textEntries.get(deny);
}

// ---- 검사 ----

const B64 = /[A-Za-z0-9+/_-]{24,}={0,2}/g;

/** 줄 안의 base64 덩어리 중 글자로 풀리는 것. */
function base64Texts(line) {
  const out = [];
  for (const m of line.matchAll(B64)) {
    const buf = Buffer.from(m[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (buf.length < 12) continue;
    const t = buf.toString('utf8');
    if (t.includes('�')) continue;
    const printable = [...t].filter((c) => c >= ' ' || c === '\n' || c === '\t').length;
    if (printable / [...t].length >= 0.9) out.push(t);
  }
  return out;
}

/** 텍스트 하나를 검사한다. 결과: [{line, rule}]. n-gram은 줄을 넘어 이어진다(시작 줄로 보고한다). */
export function scanText(text, deny, depth = 0) {
  const found = [];
  const lines = text.split('\n');
  const textOn = hasTextEntries(deny);
  const toks = [];
  lines.forEach((line, i) => {
    for (const rule of lineRules(line)) found.push({ line: i + 1, rule });
    if (textOn) for (const t of tokenize(line)) toks.push([t, i + 1]);
    if (depth === 0) {
      for (const inner of base64Texts(line)) {
        for (const f of scanText(inner, deny, depth + 1)) found.push({ line: i + 1, rule: f.rule });
      }
    }
  });
  if (textOn) {
    const hitLines = new Set();
    for (let i = 0; i < toks.length; i++) {
      const line = toks[i][1];
      if (hitLines.has(line)) continue;
      const c = new Set();
      tokenCandidates(toks[i][0], c);
      for (let n = 2; n <= 4 && i + n <= toks.length; n++) {
        c.add(toks.slice(i, i + n).map((x) => x[0]).join(' '));
      }
      for (const s of c) {
        if (deny.has(hashCandidate(s))) {
          hitLines.add(line);
          found.push({ line, rule: 'denylist' });
          break;
        }
      }
    }
  }
  return found;
}

/** 바이너리에서 사람이 읽는 글자 조각(UTF-8 6바이트 이상)을 줄마다 하나씩 뽑는다. */
function textRuns(buf) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? buf[i] : 0;
    const ok = b === 9 || (b >= 0x20 && b !== 0x7f);
    if (ok && start < 0) start = i;
    if (!ok && start >= 0) {
      if (i - start >= 6) runs.push(buf.subarray(start, i).toString('utf8').replace(/�+/g, '\n'));
      start = -1;
    }
  }
  return runs.join('\n');
}

function utf16(buf) {
  let be = buf[0] === 0xfe && buf[1] === 0xff;
  const le = buf[0] === 0xff && buf[1] === 0xfe;
  if (!be && !le) {
    // BOM 없이 짝수/홀수 바이트 한쪽이 대부분 0이면 UTF-16으로 본다
    let even = 0;
    let odd = 0;
    const n = Math.min(buf.length, 8000) & ~1;
    for (let i = 0; i < n; i += 2) {
      if (buf[i] === 0) even++;
      if (buf[i + 1] === 0) odd++;
    }
    if (n === 0 || Math.max(even, odd) / (n / 2) < 0.3) return null;
    be = even > odd;
  }
  const body = buf.subarray(be || le ? 2 : 0);
  if (!be) return body.toString('utf16le');
  const sw = Buffer.from(body.subarray(0, body.length & ~1));
  return sw.swap16().toString('utf16le');
}

/** blob(파일 내용) 하나를 검사한다. NUL이 있으면 UTF-16 해석과 글자 조각을 본다(줄 번호 0). */
export function scanBuffer(buf, deny) {
  const found = [];
  if (deny.has(hashBlob(buf))) found.push({ line: 0, rule: 'denylist-blob' });
  const head = buf.subarray(0, 8000);
  if (!head.includes(0)) return found.concat(scanText(buf.toString('utf8'), deny));
  const texts = [textRuns(buf)];
  const u = utf16(buf);
  if (u) texts.push(u);
  for (const t of texts) for (const f of scanText(t, deny)) found.push({ line: 0, rule: f.rule });
  return found;
}

// ---- git ----

function git(args, opts = {}) {
  const r = spawnSync('git', args, { maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) {
    process.stderr.write(`git ${args.join(' ')} 실패: ${r.stderr?.toString() ?? r.error}\n`);
    process.exit(2);
  }
  return r.stdout;
}

/** cat-file --batch로 blob 여러 개를 읽는다. */
function readBlobs(cwd, shas) {
  const map = new Map();
  if (!shas.length) return map;
  const data = git(['cat-file', '--batch'], { cwd, input: shas.join('\n') + '\n' });
  let off = 0;
  while (off < data.length) {
    const nl = data.indexOf(0x0a, off);
    const [sha, type, size] = data.subarray(off, nl).toString().split(' ');
    if (type === 'missing') {
      off = nl + 1;
      continue;
    }
    const start = nl + 1;
    map.set(sha, data.subarray(start, start + Number(size)));
    off = start + Number(size) + 1;
  }
  return map;
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

/** 인덱스(다음 커밋에 들어갈 내용)를 검사한다. 작업 트리의 올리지 않은 변경은 보지 않는다. */
function scanStaged(cwd, deny) {
  const root = git(['rev-parse', '--show-toplevel'], { cwd }).toString().trim();
  const entries = git(['ls-files', '-s', '-z'], { cwd: root })
    .toString()
    .split('\0')
    .filter(Boolean)
    .map((e) => {
      const tab = e.indexOf('\t');
      const [mode, sha] = e.slice(0, tab).split(' ');
      return { mode, sha, rel: e.slice(tab + 1) };
    })
    .filter((e) => e.mode !== '160000');
  const blobs = readBlobs(root, [...new Set(entries.map((e) => e.sha))]);
  const out = [];
  for (const { sha, rel } of entries) {
    const buf = blobs.get(sha);
    if (buf) for (const f of scanBuffer(buf, deny)) out.push({ where: `${rel}:${f.line}`, rule: f.rule });
    for (const f of scanText(rel, deny)) out.push({ where: `${rel} (경로)`, rule: f.rule });
  }
  return out;
}

/** 모든 ref에서 닿는 blob(경로 포함), 커밋·태그 메시지, ref 이름, 작성자·커미터·태거를 검사한다. */
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
    for (const [sha, body] of readBlobs(cwd, blobs)) {
      for (const f of scanBuffer(body, deny)) {
        out.push({ where: `${pathOf.get(sha)}@${sha.slice(0, 12)}:${f.line}`, rule: f.rule });
      }
    }
  }
  const log = git(['log', '--all', '--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00'], { cwd })
    .toString()
    .split('\0');
  for (let i = 0; i + 5 < log.length; i += 6) {
    const sha = log[i].trim().slice(0, 12);
    const [an, ae, cn, ce, body] = log.slice(i + 1, i + 6);
    for (const f of scanText(body, deny)) out.push({ where: `커밋 ${sha} 메시지:${f.line}`, rule: f.rule });
    for (const [who, name, email] of [
      ['작성자', an, ae],
      ['커미터', cn, ce],
    ]) {
      if (!emailAllowed(email)) out.push({ where: `커밋 ${sha} ${who} 이메일`, rule: 'identity' });
      for (const f of scanText(name, deny)) out.push({ where: `커밋 ${sha} ${who} 이름`, rule: f.rule });
    }
  }
  const tags = git(['for-each-ref', 'refs/tags', '--format=%(refname)%00%(taggeremail)%00%(contents)%00'], { cwd })
    .toString()
    .split('\0');
  for (let i = 0; i + 2 < tags.length; i += 3) {
    const ref = tags[i].trim();
    const email = tags[i + 1].replace(/^<|>$/g, '');
    if (email && !emailAllowed(email)) out.push({ where: `${ref} 태거 이메일`, rule: 'identity' });
    for (const f of scanText(tags[i + 2], deny)) out.push({ where: `${ref}:${f.line}`, rule: f.rule });
  }
  for (const ref of git(['for-each-ref', '--format=%(refname)'], { cwd }).toString().split('\n').filter(Boolean)) {
    for (const f of scanText(ref, deny)) out.push({ where: `${ref} (ref 이름)`, rule: f.rule });
  }
  return out;
}

function parseArgs(argv) {
  const opts = { mode: 'tree', denylists: [DENYLIST_PATH], bad: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all-history') opts.mode = 'history';
    else if (a === '--staged') opts.mode = 'staged';
    else if (a === '--denylist' && i + 1 < argv.length) opts.denylists.push(argv[++i]);
    else opts.bad.push(a);
  }
  const env = process.env.PUBLIC_SCAN_DENYLIST;
  if (env) opts.denylists.push(...env.split(delimiter).filter(Boolean));
  return opts;
}

function main(argv) {
  if (argv.includes('--hash')) {
    const input = readFileSync(0, 'utf8');
    for (const raw of input.split('\n')) {
      if (raw.trim()) for (const e of entriesFor(raw)) console.log(e);
    }
    return 0;
  }
  if (argv.includes('--hash-file')) {
    for (const p of argv.slice(argv.indexOf('--hash-file') + 1)) console.log(hashBlob(readFileSync(p)));
    return 0;
  }
  const opts = parseArgs(argv);
  if (opts.bad.length) {
    process.stderr.write(`알 수 없는 인자: ${opts.bad.join(' ')}\n`);
    return 2;
  }
  const missing = opts.denylists.slice(1).filter((p) => !existsSync(p));
  if (missing.length) {
    process.stderr.write(`denylist 파일이 없다: ${missing.join(' ')}\n`);
    return 2;
  }
  const deny = loadDenylist(opts.denylists);
  const cwd = process.cwd();
  const scan = { tree: scanWorkTree, staged: scanStaged, history: scanHistory }[opts.mode];
  const found = scan(cwd, deny);
  const uniq = [...new Map(found.map((f) => [`${f.where} ${f.rule}`, f])).values()];
  for (const f of uniq) console.log(`${f.where}  [${f.rule}]`);
  const scope = { tree: '추적 중인 파일', staged: '인덱스', history: '전체 이력' }[opts.mode];
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
