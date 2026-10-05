// node --test scripts/ci/
// 심어 둔 표본은 실행 중에 조립한다(이 파일 자체가 검사에 걸리지 않게).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  entryFor,
  hashBlob,
  lineRules,
  loadDenylist,
  scanBuffer,
  scanText,
} from './public-scan.mjs';

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
};

const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
  });
  assert.equal(r.status, 0, r.stderr.toString());
};

const scan = (cwd, ...args) => spawnSync(process.execPath, [SCANNER, ...args], { cwd });

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
    '"channelId": "000000000000000000000000000000a1"',
    'video 000000000000000000000000000000000B02',
    'sha256 ' + hex('ab', 32), // 64자리 hex(잠금 파일 체크섬)는 ID가 아니다
  ];
  for (const line of ok) assert.deepEqual(lineRules(line), [], line);
});

test('denylist: 토큰·n-gram·한글 부분 문자열·blob 해시로 정확히 맞춘다', () => {
  const deny = new Set([entryFor('가짜스트리머'), entryFor('Fake Title Words Here Extra'), entryFor('9876543')]);
  assert.equal(scanText('채널: 가짜스트리머님 방송', deny).length, 1); // 한글 덩어리 안의 부분 문자열
  assert.equal(scanText('"title": "fake  title-words HERE"', deny).length, 1); // 앞 4토큰, 대소문자·구두점 무시
  assert.equal(scanText('/video/v9876543', deny).length, 1); // 토큰 안의 7~10자리 숫자
  assert.equal(scanText('가짜스트리 fake title 98765432', deny).length, 0);
  const bin = Buffer.from([0, 1, 2, 3, 0, 9]);
  assert.deepEqual(
    scanBuffer(bin, new Set([hashBlob(bin)])).map((f) => f.rule),
    ['denylist-blob'],
  );
  assert.deepEqual(scanBuffer(bin, new Set()), []);
});

test('저장소 denylist는 해시만 담는다', () => {
  const deny = loadDenylist();
  assert.ok(deny.size > 0);
  for (const e of deny) assert.match(e, /^(blob:)?[0-9a-f]{64}$/);
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

test('알 수 없는 인자는 2', () => {
  assert.equal(scan(ROOT, '--nope').status, 2);
});
