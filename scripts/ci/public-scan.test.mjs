// node --test scripts/ci/
// 심어 둔 표본은 실행 중에 조립한다(이 파일 자체가 검사에 걸리지 않게).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  decode,
  DENYLIST_PATH,
  emailAllowed,
  entriesFor,
  hashBlob,
  hashCommit,
  lineRules,
  loadDenylist,
  parseRange,
  PRIVATE_COMMITS_PATH,
  scanBuffer,
  scanText,
} from './public-scan.mjs';
import { gitEnv, gitRun } from './test-git.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SCANNER = join(HERE, 'public-scan.mjs');

const hex = (pair, n) => pair.repeat(n);
const PLANTED = {
  'signed-token': 'https://h.example.invalid/a/hdntl=exp=' + '1700000000' + '~acl=*/x/seg.m4v',
  hmac: 'master.m3u8?hdnts=st=0~exp=0~hmac=' + hex('f1', 8),
  'pd-signature': 'a.mp4?_lsu_sa_=' + hex('6b', 10),
  'key-endpoint': '#EXT-X-KEY:METHOD=AES-128,URI="https://k/' + 'aes' + '_key"',
  'naver-cookie': '{"NID_' + 'AUT": "' + 'Ab9'.repeat(10) + '"}',
  'hex-id': '"channelId": "' + hex('ab', 16) + '"',
  'aes-research': 'key' + 'UriTemplate=https://k/{id}/key',
  'keyed-hex': '"sig":"' + hex('7c', 32) + '"',
};

// 규칙을 피하려는 표기(이스케이프·인코딩·모양 바꾸기). 모두 잡혀야 한다.
const EVASIONS = {
  'hmac 짧은 값': ['hmac', 'hdntl=exp=0~hmac=' + '7c1d'],
  'hmac JSON 키': ['hmac', '"hmac":"' + hex('9d', 16) + '"'],
  'hmac 이중 인코딩': ['hmac', 'hmac%253D' + hex('9d', 8)],
  'lsu 이중 인코딩': ['pd-signature', '_lsu_sa_%253D' + hex('6b', 10)],
  'hdnts 이중 인코딩': ['signed-token', 'hdnts%253Dst%253D' + '1700000000' + '%257Eexp%253D' + '1700000001'],
  'hdnts JSON 이스케이프': ['signed-token', 'hdnts\\u003dst\\u003d' + '1700000000'],
  'exp가 400자 뒤': ['signed-token', 'hdnts=acl=*~' + 'x'.repeat(420) + '~exp=' + '1700000000'],
  '다른 이름의 st/exp': ['signed-token', 'a.m3u8?token=st=' + '1700000000' + '~exp=' + '1700000001'],
  '키 주소 JSON 슬래시': ['key-endpoint', 'https://k/' + 'encryption' + '\\/videos/1'],
  '키 주소 %2F': ['key-endpoint', 'encryption' + '%2Fvideos'],
  '키 주소 %5F': ['key-endpoint', 'aes' + '%5Fkey'],
  '키 주소 대시': ['key-endpoint', 'aes' + '-key'],
  '쿠키 내보내기 모양': ['naver-cookie', '{"name":"NID_' + 'AUT","value":"' + 'Zx8'.repeat(4) + '"}'],
  '쿠키 %3D': ['naver-cookie', 'Cookie: NID_' + 'AUT%3D' + 'Zx8'.repeat(4)],
  '쿠키 12자 값': ['naver-cookie', 'NID_' + 'SES=' + 'Zx8'.repeat(4)],
  '대시 UUID': ['hex-id', 'id="' + ['1a2b3c4d', '72ca', '11f1', '8066', hex('a5', 6)].join('-') + '"'],
  'inKey 모양': ['hex-id', 'key=V1' + hex('3e', 41)],
};

const git = (cwd, ...args) => {
  const r = gitRun(cwd, args);
  assert.equal(r.status, 0, r.stderr);
};

const scan = (cwd, ...args) => spawnSync(process.execPath, [SCANNER, ...args], { cwd, env: gitEnv() });

test('규칙마다 심은 표본을 잡는다', () => {
  for (const [rule, line] of Object.entries(PLANTED)) {
    assert.ok(lineRules(line).includes(rule), `${rule}: ${lineRules(line)}`);
  }
});

test('자리표시자와 가짜 ID는 통과한다', () => {
  const ok = [
    'https://hls.example.invalid/a/144p/hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=0000/x.m4v',
    'vod_playlist.m3u8?hdnts=st=0~exp=0~acl=*/kr/*~hmac=0000',
    'hdnts=exp%3D0%7Eacl%3D%2Fclip%2F*%7Ehmac%3D0000',
    'a.mp4?_lsu_sa_=0000',
    'Cookie: NID_AUT=a; NID_SES=b',
    'Cookie: NID_AUT=placeholder; NID_SES=placeholder', // 테스트 자리표시자(12자 미만)
    '"channelId": "000000000000000000000000000000a1"',
    'video 000000000000000000000000000000000B02',
    'sha256 ' + hex('ab', 32), // 64자리 hex(잠금 파일 체크섬)는 ID가 아니다
    'rev = "' + hex('ab', 20) + '"', // 키 이름 없는 40자리 hex(git rev)
    'id="00000000-0000-0000-0000-0000000000b1"', // 가짜 UUID
    'key=V1' + '0'.repeat(80) + 'c3', // 가짜 inKey
    '<ContentProtection schemeIdUri="urn:mpeg:dash:sea:2012"/>', // 표준 스킴 이름 자체는 괜찮다
    'progress 100% done, %zz', // 깨진 %xx는 디코드하지 않고 넘어간다
    'hdntl=exp=0~acl=*/kr/*~data=hdntl~hmac=tok1/x.m4v', // hex가 아닌 자리표시자
  ];
  for (const line of ok) assert.deepEqual(lineRules(line), [], line);
});

test('표기를 바꿔도 규칙이 잡는다', () => {
  for (const [name, [rule, line]] of Object.entries(EVASIONS)) {
    assert.ok(lineRules(line).includes(rule), `${name}: ${lineRules(line)}`);
  }
});

test('decode: JSON·HTML·%xx 이스케이프, NFKC, 폭 없는 문자', () => {
  assert.equal(decode('\\uac00\\ub098 &#45796;&#xB77C;'), '가나 다라');
  assert.equal(decode('a%253Db'), 'a=b');
  assert.equal(decode('１２３'), '123');
  assert.equal(decode('가\u200b나'), '가나');
  assert.equal(decode('100% %zz %E0%A4'), '100% %zz %E0%A4');
});

const sel = (...raw) => new Set(raw.flatMap((r) => entriesFor(r)));

test('denylist: 토큰·n-gram·한글 부분 문자열·blob 해시로 정확히 맞춘다', () => {
  const deny = sel('가짜스트리머', 'Fake Title Words Here Extra', '9876543', 'Zq7Kp2Lm9X');
  assert.equal(scanText('채널: 가짜스트리머님 방송', deny).length, 1); // 한글 덩어리 안의 부분 문자열
  assert.equal(scanText('"title": "fake  title-words HERE"', deny).length, 1); // 4토큰 창, 대소문자·구두점 무시
  assert.equal(scanText('"title": "Title Words Here Extra"', deny).length, 1); // 제목 중간에서 시작하는 창
  assert.equal(scanText('/video/v9876543', deny).length, 1); // 토큰 안의 숫자
  assert.equal(scanText('가짜스트리 fake title 9876542 987654', deny).length, 0);
  // 표기 바꾸기
  const esc = (s) => [...s].map((c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
  const ent = (s) => [...s].map((c) => `&#${c.codePointAt(0)};`).join('');
  const variants = {
    'JSON 이스케이프': `"channelName": "${esc('가짜스트리머')}"`,
    'HTML 엔티티': ent('가짜스트리머'),
    '폭 없는 문자': '가짜\u200b스트리머',
    '전각 숫자': '/video/９８７６５４３',
    '숫자 구분자 _': 'const NO: u64 = 9_876_543;',
    '숫자 구분자 ,': 'videoNo 9,876,543',
    '긴 토큰 안의 ID': 'clipZq7Kp2Lm9Xtail',
    '줄을 넘는 제목': 'fake title\nwords here',
    base64: 'data:text/plain;base64,' + Buffer.from('채널 가짜스트리머 방송입니다').toString('base64'),
  };
  for (const [name, text] of Object.entries(variants)) {
    assert.ok(scanText(text, deny).some((f) => f.rule === 'denylist'), name);
  }
  const bin = Buffer.from([0, 1, 2, 3, 0, 9]);
  assert.deepEqual(
    scanBuffer(bin, new Set([hashBlob(bin)])).map((f) => f.rule),
    ['denylist-blob'],
  );
  assert.deepEqual(scanBuffer(bin, new Set()), []);
});

test('NUL이 든 파일도 글자 조각과 UTF-16을 본다', () => {
  const deny = sel('가짜스트리머');
  const mp4 = Buffer.concat([
    Buffer.from([0, 0, 0, 0x20, 0x75, 0x64, 0x74, 0x61, 0]),
    Buffer.from('nam 가짜스트리머 ' + PLANTED['signed-token']),
    Buffer.from([0, 0, 1]),
  ]);
  const rules = scanBuffer(mp4, deny).map((f) => f.rule);
  assert.ok(rules.includes('denylist') && rules.includes('signed-token'), String(rules));
  const u16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('x ' + PLANTED['hex-id'], 'utf16le')]);
  assert.ok(scanBuffer(u16, new Set()).some((f) => f.rule === 'hex-id'));
  const u16be = Buffer.from('x ' + PLANTED['hex-id'], 'utf16le').swap16();
  assert.ok(scanBuffer(u16be, new Set()).some((f) => f.rule === 'hex-id'));
});

test('작성자 이메일 허용 목록', () => {
  for (const ok of ['1+someone@users.noreply.github.com', 'someone@users.noreply.github.com', 'noreply@github.com', 'noreply@anthropic.com', 't@example.invalid', '49699333+dependabot[bot]@users.noreply.github.com', '114627259+chnu-kim@users.noreply.github.com', 'chanuuuu@naver.com', 'Chanuuuu@Naver.com']) {
    assert.ok(emailAllowed(ok), ok);
  }
  for (const bad of ['someone@example.com', 'a@users.noreply.github.com.evil.example', '', 'chanwoo@company.co.kr', 'other@naver.com', 'xchanuuuu@naver.com', 'chanuuuu@naver.com.evil.example', 'chanuuuu@naver.co']) {
    assert.ok(!emailAllowed(bad), bad);
  }
});

test('저장소 denylist는 blob·commit 해시만 담는다(대입으로 되돌릴 수 있는 항목은 비공개 목록에)', () => {
  const deny = loadDenylist([DENYLIST_PATH]);
  assert.ok(deny.size > 0);
  for (const e of deny) assert.match(e, /^blob:[0-9a-f]{64}$/);
  // 커밋 지문 파일: commit: 줄만, 정렬·중복 없음, 주석 없음(--hash-commit 출력과 바이트 동일해야 다시 만들 수 있다)
  const raw = readFileSync(PRIVATE_COMMITS_PATH, 'utf8');
  const lines = raw.split('\n').filter(Boolean);
  assert.ok(lines.length > 0);
  for (const l of lines) assert.match(l, /^commit:[0-9a-f]{64}$/);
  assert.deepEqual(lines, [...new Set(lines)].sort());
  assert.equal(raw, lines.join('\n') + '\n');
});

test('지금 저장소의 추적 파일은 깨끗하다', () => {
  const r = scan(ROOT);
  assert.equal(r.status, 0, r.stdout.toString() + r.stderr.toString());
});

test('합성 fixture가 생성기 출력과 같다', () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/fixtures/gen-fixtures.mjs'), '--check']);
  assert.equal(r.status, 0, r.stderr.toString());
});

test('심은 표본: 작업 트리와 --all-history가 잡고, 지운 뒤에는 이력만 잡는다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'clean.txt'), 'hello\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  assert.equal(scan(dir).status, 0);
  assert.equal(scan(dir, '--all-history').status, 0);

  writeFileSync(join(dir, 'leak.txt'), Object.values(PLANTED).join('\n') + '\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'add');
  const tree = scan(dir);
  assert.equal(tree.status, 1);
  const out = tree.stdout.toString();
  for (const rule of Object.keys(PLANTED)) assert.ok(out.includes(`[${rule}]`), `${rule}\n${out}`);

  git(dir, 'rm', '-q', 'leak.txt');
  git(dir, 'commit', '-qm', 'remove');
  assert.equal(scan(dir).status, 0);
  const hist = scan(dir, '--all-history');
  assert.equal(hist.status, 1);
  assert.match(hist.stdout.toString(), /leak\.txt@[0-9a-f]{12}:\d+ {2}\[hmac\]/);

  // 커밋 메시지도 본다.
  const dir2 = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir2, { recursive: true, force: true }));
  git(dir2, 'init', '-q');
  writeFileSync(join(dir2, 'a.txt'), 'a\n');
  git(dir2, 'add', '.');
  git(dir2, 'commit', '-qm', 'fix ' + PLANTED['hex-id']);
  assert.equal(scan(dir2).status, 0);
  assert.match(scan(dir2, '--all-history').stdout.toString(), /메시지:1 {2}\[hex-id\]/);
});

test('--all-history: 작성자 이메일과 ref 이름, --denylist로 넘긴 비공개 목록', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  assert.equal(scan(dir, '--all-history').status, 0);

  const deny = join(dir, '..', `private-deny-${process.pid}.txt`);
  t.after(() => rmSync(deny, { force: true }));
  writeFileSync(deny, entriesFor('Zq7Kp2Lm9X').join('\n') + '\n');
  git(dir, 'branch', 'clip-Zq7Kp2Lm9X');
  assert.equal(scan(dir, '--all-history').status, 0); // 공개 목록만으로는 모른다
  const withDeny = scan(dir, '--all-history', '--denylist', deny);
  assert.equal(withDeny.status, 1);
  assert.match(withDeny.stdout.toString(), /refs\/heads\/clip-Zq7Kp2Lm9X \(ref 이름\) {2}\[denylist\]/);
  const viaEnv = spawnSync(process.execPath, [SCANNER, '--all-history'], {
    cwd: dir,
    env: gitEnv({ extra: { PUBLIC_SCAN_DENYLIST: deny } }),
  });
  assert.equal(viaEnv.status, 1);
  assert.equal(scan(dir, '--denylist', join(dir, 'nope.txt')).status, 2);
  git(dir, 'branch', '-D', 'clip-Zq7Kp2Lm9X');

  // 공개하기로 한 작성자 이메일은 통과한다
  const kept = gitRun(dir, ['commit', '-q', '--allow-empty', '-m', 'k'], { email: 'chanuuuu@naver.com' });
  assert.equal(kept.status, 0);
  assert.equal(scan(dir, '--all-history').status, 0);

  const r = gitRun(dir, ['commit', '-q', '--allow-empty', '-m', 'x'], { email: 'person@example.com' });
  assert.equal(r.status, 0);
  const hist = scan(dir, '--all-history');
  assert.equal(hist.status, 1);
  const out = hist.stdout.toString();
  assert.match(out, /작성자 이메일 {2}\[identity\]/);
  assert.ok(!out.includes('person@'), '결과에 원문 이메일을 싣지 않는다');
});

test('--staged는 인덱스 내용을 본다(작업 트리가 아니라)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'a.txt'), PLANTED.hmac + '\n');
  git(dir, 'add', '.');
  writeFileSync(join(dir, 'a.txt'), 'clean\n'); // 올리지 않은 수정으로 덮어도
  const staged = scan(dir, '--staged');
  assert.equal(staged.status, 1);
  assert.match(staged.stdout.toString(), /a\.txt:1 {2}\[hmac\]/);
  assert.equal(scan(dir).status, 0);
  git(dir, 'add', '.');
  assert.equal(scan(dir, '--staged').status, 0);
});

test('알 수 없는 인자는 2', () => {
  assert.equal(scan(ROOT, '--nope').status, 2);
});

test('parseRange: A..B와 B만, 옵션처럼 보이는 값은 거부', () => {
  assert.deepEqual(parseRange('origin/master..HEAD'), ['HEAD', '^origin/master']);
  assert.deepEqual(parseRange('abc123'), ['abc123']);
  for (const bad of ['--all', 'a..--all', '..b', 'a..', 'a...b', 'a..b..c', '', 'a b']) assert.equal(parseRange(bad), null, bad);
});

test('--rev-range: 범위 안의 blob·경로·메시지·작성자·태그만 본다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'leak.txt'), PLANTED.hmac + '\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'old');
  git(dir, 'rm', '-q', 'leak.txt');
  git(dir, 'commit', '-qm', 'remove');
  git(dir, 'tag', 'base');
  writeFileSync(join(dir, 'a.txt'), 'clean\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'new');
  // 범위 밖(base 이전)의 누출은 보지 않고, 전체 조상은 본다
  assert.equal(scan(dir, '--rev-range', 'base..HEAD').status, 0);
  assert.equal(scan(dir, '--rev-range', 'HEAD').status, 1);

  // 범위 안의 blob
  writeFileSync(join(dir, 'b.txt'), PLANTED['signed-token'] + '\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'b');
  const blob = scan(dir, '--rev-range', 'base..HEAD');
  assert.equal(blob.status, 1);
  assert.match(blob.stdout.toString(), /b\.txt@[0-9a-f]{12}:1 {2}\[signed-token\]/);
  git(dir, 'rm', '-q', 'b.txt');
  git(dir, 'commit', '-qm', 'rm b');
  assert.equal(scan(dir, '--rev-range', 'base..HEAD').status, 1, '지운 뒤에도 범위 안 이력에 남는다');
  git(dir, 'tag', 'base2');

  // 메시지와 작성자
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'fix ' + PLANTED['hex-id']);
  assert.match(scan(dir, '--rev-range', 'base2..HEAD').stdout.toString(), /메시지:1 {2}\[hex-id\]/);
  git(dir, 'tag', 'base3');
  assert.equal(gitRun(dir, ['commit', '-q', '--allow-empty', '-m', 'x'], { email: 'person@example.com' }).status, 0);
  const who = scan(dir, '--rev-range', 'base3..HEAD');
  assert.equal(who.status, 1);
  assert.ok(!who.stdout.toString().includes('person@'));
  git(dir, 'tag', 'base4');

  // annotated 태그 객체(태그 push: local_sha가 태그 객체)
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'y');
  git(dir, 'tag', '-a', 'v9.9.9', '-m', 'release ' + PLANTED['keyed-hex']);
  const tagSha = gitRun(dir, ['rev-parse', 'v9.9.9']).stdout.trim();
  const tag = scan(dir, '--rev-range', `base4..${tagSha}`);
  assert.equal(tag.status, 1, tag.stderr.toString());
  assert.match(tag.stdout.toString(), /태그 객체 [0-9a-f]{12}:1 {2}\[keyed-hex\]/);
  assert.equal(scan(dir, '--rev-range', 'base4..v9.9.9^{commit}').status, 0);
});

test('--rev-range: --not-remote는 원격 추적 ref에서 닿는 것을 빼고, --ref는 원격 ref 이름을 본다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'leak.txt'), PLANTED.hmac + '\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'already public');
  const pub = gitRun(dir, ['rev-parse', 'HEAD']).stdout.trim();
  git(dir, 'update-ref', 'refs/remotes/pub/master', pub);
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'new');
  assert.equal(scan(dir, '--rev-range', 'HEAD').status, 1);
  assert.equal(scan(dir, '--rev-range', 'HEAD', '--not-remote', 'pub').status, 0);
  // 아무것도 새로 보내지 않는 push(빈 범위)는 깨끗하다
  assert.equal(scan(dir, '--rev-range', pub, '--not-remote', 'pub').status, 0);

  const deny = join(dir, '..', `range-deny-${process.pid}.txt`);
  t.after(() => rmSync(deny, { force: true }));
  writeFileSync(deny, entriesFor('Zq7Kp2Lm9X').join('\n') + '\n');
  const named = scan(dir, '--rev-range', 'HEAD', '--not-remote', 'pub', '--ref', 'refs/heads/clip-Zq7Kp2Lm9X', '--denylist', deny);
  assert.equal(named.status, 1);
  assert.match(named.stdout.toString(), /refs\/heads\/clip-Zq7Kp2Lm9X \(ref 이름\) {2}\[denylist\]/);
});

test('--rev-range·--message-file 사용법 오류는 2', () => {
  assert.equal(scan(ROOT, '--rev-range').status, 2);
  assert.equal(scan(ROOT, '--rev-range', '--all').status, 2);
  assert.equal(scan(ROOT, '--rev-range', 'HEAD', '--staged').status, 2);
  assert.equal(scan(ROOT, '--not-remote', 'origin').status, 2);
  assert.equal(scan(ROOT, '--message-file', join(ROOT, 'no-such-file')).status, 2);
});

test('--message-file: 원문 전체를 본다(# 줄·scissors 아래도 -m·--cleanup=verbatim이면 이력에 남는다)', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const f = join(dir, 'COMMIT_EDITMSG');
  writeFileSync(f, 'fix: 고침\n\n본문\n');
  assert.equal(scan(dir, '--message-file', f).status, 0);
  writeFileSync(f, 'fix: 고침\n\n' + PLANTED.hmac + '\n');
  const r = scan(dir, '--message-file', f);
  assert.equal(r.status, 1);
  assert.match(r.stdout.toString(), /메시지:3 {2}\[hmac\]/);
  // # 로 시작하는 줄
  writeFileSync(f, 'fix: 고침\n\n# ' + PLANTED.hmac + '\n');
  assert.equal(scan(dir, '--message-file', f).status, 1);
  // scissors 줄 아래
  writeFileSync(f, 'fix: 고침\n# ------------------------ >8 ------------------------\n' + PLANTED['hex-id'] + '\n');
  assert.equal(scan(dir, '--message-file', f).status, 1);
  // denylist 항목이 # 줄에 있어도 잡는다
  const deny = join(dir, 'deny.txt');
  writeFileSync(deny, entriesFor('zebracanyon').join('\n') + '\n');
  writeFileSync(f, 'fix: x\n# zebracanyon\n');
  const d = scan(dir, '--message-file', f, '--denylist', deny);
  assert.equal(d.status, 1);
  assert.match(d.stdout.toString(), /\[denylist\]/);
});

test('commit: 지문 — 비공개 저장소에만 있는 커밋을 이력·범위에서 잡는다', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'public-scan-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q');
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  git(dir, 'add', 'a.txt');
  git(dir, 'commit', '-qm', 'pub');
  const pub = gitRun(dir, ['rev-parse', 'HEAD']).stdout.trim();
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'priv');
  const priv = gitRun(dir, ['rev-parse', 'HEAD']).stdout.trim();
  const deny = join(dir, '..', `commit-deny-${process.pid}-${Date.now()}.txt`);
  t.after(() => rmSync(deny, { force: true }));
  // --hash-commit은 정렬·중복 제거한 commit: 줄을 낸다
  const h = spawnSync(process.execPath, [SCANNER, '--hash-commit'], { input: `${priv}\n${priv}\n` });
  assert.equal(h.status, 0);
  assert.equal(h.stdout.toString(), hashCommit(priv) + '\n');
  assert.equal(spawnSync(process.execPath, [SCANNER, '--hash-commit'], { input: 'not-a-sha\n' }).status, 2);
  writeFileSync(deny, h.stdout);
  const hist = scan(dir, '--all-history', '--denylist', deny);
  assert.equal(hist.status, 1);
  assert.match(hist.stdout.toString(), new RegExp(`커밋 ${priv.slice(0, 12)} {2}\\[private-commit\\]`));
  assert.equal(scan(dir, '--rev-range', pub, '--denylist', deny).status, 0);
  assert.equal(scan(dir, '--rev-range', priv, '--denylist', deny).status, 1);
  // commit: 항목만 있으면 글자 n-gram을 켜지 않는다(깨끗한 트리는 그대로 깨끗하다)
  assert.equal(scan(dir, '--denylist', deny).status, 0);
});
