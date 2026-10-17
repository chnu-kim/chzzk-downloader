// node --test scripts/ci/
// 심어 둔 표본은 실행 중에 조립한다(이 파일 자체가 검사에 걸리지 않게).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

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
  pngTexts,
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

test('signing-key: Tauri updater 개인 키(base64 텍스트·풀어 쓴 텍스트)는 잡고 공개 키·서명은 통과한다', () => {
  // 이 파일도 scan 대상이라 머리줄을 글자 그대로 두지 않는다
  const head = ['untrusted comment:', 'rsign', 'encrypted', 'secret', 'key'].join(' ');
  const raw = `${head}\n${'RWRT' + 'Y0I' + 'y'}${'A'.repeat(140)}\n`;
  const rules = (t) => [...new Set(scanText(t, new Set()).map((f) => f.rule))];
  assert.deepEqual(rules(raw), ['signing-key']);
  assert.deepEqual(rules(Buffer.from(raw).toString('base64')), ['signing-key']);
  assert.deepEqual(rules(`TAURI_SIGNING_PRIVATE_KEY=${Buffer.from(raw).toString('base64')}`), ['signing-key']);
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  assert.deepEqual(rules(readFileSync(join(root, 'release/updater.pub'), 'utf8')), []);
  assert.deepEqual(rules(readFileSync(join(root, 'xtask/testdata/tauri-cli/sample.bin.sig'), 'utf8')), []);
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
  // BOM 없는 UTF-16BE: 추정한 엔디언을 BOM처럼 보고 앞 두 바이트를 떼면 첫 글자를 잃는다(Codex 리뷰)
  const bareBe = Buffer.from('NID_' + 'AUT=' + 'Ab9'.repeat(10), 'utf16le').swap16();
  assert.ok(scanBuffer(bareBe, new Set()).some((f) => f.rule === 'naver-cookie'), 'BOM 없는 UTF-16BE 첫 글자');
  const bareLe = Buffer.from('NID_' + 'AUT=' + 'Ab9'.repeat(10), 'utf16le');
  assert.ok(scanBuffer(bareLe, new Set()).some((f) => f.rule === 'naver-cookie'), 'BOM 없는 UTF-16LE 첫 글자');
});

test('base64 후보 찾기는 공백 없는 아주 긴 줄에서도 스택이 넘치지 않는다', () => {
  // 정규식 {24,}가 수백만 글자 덩어리에서 'Maximum call stack size exceeded'로 죽었다(8M 글자에서 재현)
  const line = 'QUFB'.repeat(2_500_000);
  assert.doesNotThrow(() => scanText(line, new Set()));
  // 같은 경로가 덩어리를 그대로 풀어 검사하는지(길이 24 이상, 뒤 '=' 두 개까지)
  const deny = sel('가짜스트리머');
  const b64 = Buffer.from('채널 가짜스트리머 방송입니다').toString('base64');
  assert.ok(scanText('x' + '!' + b64 + ' y', deny).some((f) => f.rule === 'denylist'));
});

// PNG 조립: 청크마다 길이·형식·데이터·CRC(테스트 안의 표로 따로 계산한다)
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data) {
  const td = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
const ihdrData = (w, h, depth, color, interlace = 0) => {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0);
  d.writeUInt32BE(h, 4);
  d[8] = depth;
  d[9] = color;
  d[12] = interlace;
  return d;
};
// 1×1 RGB 8비트: 픽셀 데이터는 필터 바이트 하나 + 3바이트
const IHDR = chunk('IHDR', ihdrData(1, 1, 8, 2));
const IDAT0_DATA = deflateSync(Buffer.from([0, 1, 2, 3]));
const IDAT0 = chunk('IDAT', IDAT0_DATA);
const IEND = chunk('IEND', Buffer.alloc(0));
const png = (...chunks) => Buffer.concat([PNG_SIG, IHDR, IDAT0, ...chunks, IEND]);
// 회색 8비트 한 줄 이미지의 픽셀 바이트가 곧 글자다. 무압축 블록(level 0)이라 IDAT에 글자가 그대로 남는다
// (실제 스냅샷에서 압축 픽셀 바이트가 우연히 글자 모양이 된 오탐을 흉내 낸다).
function grayShot(text) {
  const px = Buffer.from(text);
  const hdr = chunk('IHDR', ihdrData(px.length, 1, 8, 0));
  const idatData = deflateSync(Buffer.concat([NUL, px]), { level: 0 });
  assert.ok(idatData.includes(px));
  const idat = chunk('IDAT', idatData);
  return { hdr, idat, idatData, buf: Buffer.concat([PNG_SIG, hdr, idat, IEND]) };
}
const NUL = Buffer.from([0]);

test('PNG: 픽셀·구조 청크(IHDR·IDAT·IEND)의 바이트는 글자로 검사하지 않는다', () => {
  const deny = sel('가짜스트리머');
  const { buf: shot } = grayShot('nam 가짜스트리머 ' + PLANTED['signed-token']);
  assert.deepEqual(scanBuffer(shot, deny), []);
  assert.deepEqual(pngTexts(shot), []);
  // IDAT를 여러 청크로 나눠도(연달아 있으면) 같다
  const half = IDAT0_DATA.length >> 1;
  const split = Buffer.concat([PNG_SIG, IHDR, chunk('IDAT', IDAT0_DATA.subarray(0, half)), chunk('IDAT', IDAT0_DATA.subarray(half)), IEND]);
  assert.deepEqual(pngTexts(split), []);
  // 내용 전체 해시(denylist-blob)는 PNG에도 그대로 건다
  assert.deepEqual(scanBuffer(shot, new Set([hashBlob(shot)])).map((f) => f.rule), ['denylist-blob']);
});

test('PNG: tEXt·zTXt·iTXt(압축·비압축) 메타데이터는 검사한다', () => {
  const deny = sel('가짜스트리머');
  // 압축본에 원문 바이트가 그대로 남지 않게 반복한다(짧으면 deflate가 무압축 블록으로 둔다)
  const zKo = deflateSync(Buffer.from('채널 가짜스트리머 '.repeat(8)));
  const zTok = deflateSync(Buffer.from((PLANTED['signed-token'] + ' ').repeat(4)));
  assert.ok(!zKo.includes(Buffer.from('가짜스트리머')) && !zTok.includes(Buffer.from('hdntl')));
  const cases = {
    tEXt: chunk('tEXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from('fake ' + PLANTED['signed-token'], 'latin1')])),
    'tEXt 키워드': chunk('tEXt', Buffer.concat([Buffer.from(PLANTED['hex-id'].slice(0, 70), 'latin1'), NUL, Buffer.from('x')])),
    zTXt: chunk('zTXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from([0]), zTok])),
    'iTXt 비압축': chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([0, 0]), Buffer.from('ko'), NUL, NUL, Buffer.from('채널 가짜스트리머')])),
    'iTXt 압축': chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([1, 0]), Buffer.from('ko'), NUL, NUL, zKo])),
    // 규격(latin1)을 어기고 UTF-8을 넣은 tEXt·zTXt도 원래 바이트대로 잡는다
    'tEXt UTF-8': chunk('tEXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from('채널 가짜스트리머 방송')])),
    'tEXt UTF-8 키워드': chunk('tEXt', Buffer.concat([Buffer.from('가짜스트리머'), NUL, Buffer.from('x')])),
    'zTXt UTF-8': chunk('zTXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from([0]), zKo])),
    'iTXt 언어 태그 UTF-8': chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([0, 0]), Buffer.from('가짜스트리머'), NUL, NUL, Buffer.from('x')])),
    'iTXt 번역 키워드': chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([0, 0]), Buffer.from('ko'), NUL, Buffer.from('가짜스트리머'), NUL, Buffer.from('x')])),
  };
  // 규격대로 latin1로 쓴 글자(UTF-8로는 깨진다): 위 첨자 ³(0xB3)은 NFKC로 숫자 3이 된다
  const latin = chunk('tEXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from('no 987654³ x', 'latin1')]));
  assert.ok(scanBuffer(png(latin), sel('9876543')).some((f) => f.rule === 'denylist'), 'tEXt latin1');
  for (const [name, c] of Object.entries(cases)) {
    const rules = scanBuffer(png(c), deny).map((f) => f.rule);
    assert.ok(rules.includes('denylist') || rules.includes('signed-token') || rules.includes('hex-id'), `${name}: ${rules}`);
    assert.notEqual(pngTexts(png(c)), null, name);
  }
});

test('PNG: 깨지거나 모르는 모양이면 파일 전체를 지금처럼 글자 검사한다', () => {
  const deny = sel('가짜스트리머');
  const { hdr, idat, idatData, buf: good } = grayShot('nam 가짜스트리머 방송');
  const hit = (buf) => scanBuffer(buf, deny).some((f) => f.rule === 'denylist');
  const cookie = Buffer.from(PLANTED['naver-cookie']);
  const hitCookie = (buf) => scanBuffer(buf, new Set()).some((f) => f.rule === 'naver-cookie');
  assert.equal(hit(good), false);
  // IDAT CRC 한 바이트 바꿈
  const badCrc = Buffer.from(good);
  badCrc[PNG_SIG.length + hdr.length + idat.length - 4] ^= 0xff;
  assert.equal(pngTexts(badCrc), null);
  assert.ok(hit(badCrc), 'CRC');
  // 길이가 파일 끝을 넘음
  const badLen = Buffer.from(good);
  badLen.writeUInt32BE(0x7fffffff, PNG_SIG.length + hdr.length);
  assert.ok(hit(badLen), '길이');
  // IEND 뒤에 붙인 바이트
  assert.ok(hit(Buffer.concat([good, Buffer.from(' 가짜스트리머 ')])), 'IEND 뒤');
  // IEND 없음
  assert.ok(hit(Buffer.concat([PNG_SIG, hdr, idat])), 'IEND 없음');
  // 형식 이름이 글자가 아님
  const badType = Buffer.concat([PNG_SIG, hdr, chunk('ID@T', idatData), IEND]);
  assert.equal(pngTexts(badType), null, '형식 이름');
  assert.ok(hit(badType), '형식 이름');
  // 첫 청크가 IHDR이 아님
  assert.equal(pngTexts(Buffer.concat([PNG_SIG, idat, hdr, IEND])), null, 'IHDR 먼저');
  // IDAT: 없음, zlib가 아님, 스트림 뒤 평문, 풀린 크기가 IHDR과 다름, 사이에 다른 청크, 인터레이스
  const withIdat = (...cs) => Buffer.concat([PNG_SIG, IHDR, ...cs, IEND]);
  assert.equal(pngTexts(withIdat()), null, 'IDAT 없음');
  assert.ok(hit(withIdat(chunk('IDAT', Buffer.from('nam 가짜스트리머 방송')))), 'IDAT zlib 아님');
  assert.ok(hitCookie(withIdat(chunk('IDAT', Buffer.concat([IDAT0_DATA, cookie])))), 'IDAT 스트림 뒤');
  assert.equal(pngTexts(withIdat(chunk('IDAT', deflateSync(Buffer.from([0, 1, 2]))))), null, 'IDAT 짧음');
  assert.equal(pngTexts(withIdat(chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3, 4]))))), null, 'IDAT 김');
  const half = IDAT0_DATA.length >> 1;
  const gap = chunk('tEXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from('v')]));
  assert.equal(pngTexts(withIdat(chunk('IDAT', IDAT0_DATA.subarray(0, half)), gap, chunk('IDAT', IDAT0_DATA.subarray(half)))), null, 'IDAT 사이');
  assert.equal(pngTexts(Buffer.concat([PNG_SIG, chunk('IHDR', ihdrData(1, 1, 8, 2, 1)), IDAT0, IEND])), null, '인터레이스');
  assert.equal(pngTexts(Buffer.concat([PNG_SIG, IHDR, IHDR, IDAT0, IEND])), null, 'IHDR 둘');
  // 너비 65536은 IDAT 크기가 맞아도 받지 않는다(너비·높이 위 두 바이트가 늘 0이게)
  const wide = (w) => Buffer.concat([PNG_SIG, chunk('IHDR', ihdrData(w, 1, 1, 0)), chunk('IDAT', deflateSync(Buffer.alloc(1 + w / 8))), IEND]);
  assert.notEqual(pngTexts(wide(0xfff8)), null, '너비 65528');
  assert.equal(pngTexts(wide(0x10000)), null, '너비 65536');
  // 압축 방식이 0이 아니거나 풀리지 않는 zTXt
  const z = (m, data) => chunk('zTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([m]), data]));
  assert.equal(pngTexts(png(z(1, deflateSync(Buffer.from('x'))))), null, '압축 방식');
  assert.equal(pngTexts(png(z(0, Buffer.from('not zlib')))), null, '풀리지 않음');
  // 압축 스트림 뒤에 덧붙인 평문(inflate는 남은 바이트를 말없이 버린다)
  const tail = Buffer.concat([deflateSync(Buffer.from('ok')), Buffer.from(' 가짜스트리머 ')]);
  assert.ok(hit(png(z(0, tail))), 'zTXt 스트림 뒤');
  const it = chunk('iTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([1, 0]), NUL, NUL, tail]));
  assert.ok(hit(png(it)), 'iTXt 스트림 뒤');
  // 깨진 PNG라도 그때까지(또는 CRC만 틀린 그 청크에서) 풀어 낸 압축 메타데이터는 검사한다(압축된 글자는 바이트 검사로 못 본다)
  const zCookie = z(0, deflateSync(Buffer.from((PLANTED['naver-cookie'] + ' ').repeat(4))));
  assert.ok(!zCookie.includes(Buffer.from('NID_')));
  const badEnd = Buffer.from(png(zCookie));
  badEnd[badEnd.length - 1] ^= 0xff;
  assert.equal(pngTexts(badEnd), null);
  assert.ok(hitCookie(badEnd), '압축 쿠키 + IEND CRC');
  assert.ok(hitCookie(png(zCookie, chunk('ID@T', Buffer.from('x')))), '압축 쿠키 + 형식 이름');
  const badZ = Buffer.from(png(zCookie));
  badZ[PNG_SIG.length + IHDR.length + IDAT0.length + zCookie.length - 1] ^= 0xff;
  assert.equal(pngTexts(badZ), null);
  assert.ok(hitCookie(badZ), '압축 쿠키 청크의 CRC');
  // 건너뛰는 청크도 정해진 모양이어야 한다: 길이가 틀린 IHDR·IEND, 필드가 틀린 IHDR은 파일 전체 검사
  const withHdr = (h) => Buffer.concat([PNG_SIG, h, IDAT0, IEND]);
  assert.ok(hitCookie(withHdr(chunk('IHDR', Buffer.concat([ihdrData(1, 1, 8, 2), cookie])))), 'IHDR 길이');
  assert.ok(hitCookie(Buffer.concat([PNG_SIG, IHDR, IDAT0, chunk('IEND', cookie)])), 'IEND 길이');
  const ihdr = (w, depth, color) => withHdr(chunk('IHDR', ihdrData(w, 1, depth, color)));
  assert.notEqual(pngTexts(ihdr(1, 8, 2)), null);
  for (const [name, buf] of Object.entries({
    '너비 0': ihdr(0, 8, 2),
    '너비 65536': ihdr(0x10000, 8, 2),
    '너비에 글자': ihdr(0x41424344, 8, 2),
    '비트 깊이': ihdr(1, 7, 2),
    '색 형식': ihdr(1, 8, 5),
  })) {
    assert.equal(pngTexts(buf), null, name);
  }
  // 픽셀이 아닌 보조 청크(gAMA·PLTE·tRNS·cHRM 등)와 모르는 청크(iCCP·eXIf·사설 청크)는
  // 건너뛰지 않고 그 데이터를 글자 검사한다
  for (const t of ['gAMA', 'PLTE', 'tRNS', 'cHRM', 'pHYs', 'iCCP', 'eXIf', 'prVt']) {
    assert.notEqual(pngTexts(png(chunk(t, cookie))), null, t);
    assert.ok(hitCookie(png(chunk(t, cookie))), `${t} 쿠키`);
    assert.ok(hit(png(chunk(t, Buffer.from('nam 가짜스트리머 x')))), t);
  }
});

test('PNG: 텍스트 청크 본문의 UTF-16도 검사한다(본문 UTF-16 디코드 + tEXt 본문의 NUL은 형식 위반, 이중 방어)', () => {
  const le = Buffer.from(('NID_' + 'AUT=' + 'abcdefghijklmnop').repeat(12), 'utf16le');
  const be = Buffer.from(le).swap16();
  const hitCookie = (buf) => scanBuffer(buf, new Set()).some((f) => f.rule === 'naver-cookie');
  const tEXt = (b) => chunk('tEXt', Buffer.concat([Buffer.from('Comment'), NUL, b]));
  // Codex 재현: CRC가 맞는 tEXt 'Comment\0' + UTF-16LE 쿠키(origin/master는 잡았다)
  assert.ok(hitCookie(png(tEXt(le))), 'tEXt UTF-16LE');
  assert.ok(hitCookie(png(tEXt(be))), 'tEXt UTF-16BE');
  // tEXt 본문(키워드 구분 NUL 뒤)의 NUL은 형식 위반이라 파일 전체 검사로 돌아간다
  assert.equal(pngTexts(png(tEXt(le))), null, 'tEXt 본문 UTF-16');
  assert.equal(pngTexts(png(tEXt(Buffer.from([0x61, 0, 0x62])))), null, 'tEXt 본문 NUL 하나');
  // 앞에 NUL 없는 큰 청크가 있어 파일 전체의 UTF-16 추정(앞 8000바이트)이 빗나가도 본문 디코드가 잡는다
  const filler = chunk('prVt', Buffer.alloc(9000, 0x2e));
  assert.ok(hitCookie(png(filler, tEXt(le))), '큰 청크 뒤 tEXt UTF-16LE');
  assert.ok(hitCookie(png(filler, tEXt(be))), '큰 청크 뒤 tEXt UTF-16BE');
  // zTXt·iTXt: 풀린(또는 비압축) 본문이 UTF-16이어도 잡는다
  const zLe = deflateSync(le);
  assert.ok(!zLe.includes(Buffer.from('N\0I\0D\0')));
  const cases = {
    'zTXt UTF-16LE': chunk('zTXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from([0]), zLe])),
    'iTXt 압축 UTF-16LE': chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([1, 0]), Buffer.from('ko'), NUL, NUL, zLe])),
    'iTXt 비압축 UTF-16BE': chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([0, 0]), Buffer.from('ko'), NUL, NUL, be])),
  };
  for (const [name, c] of Object.entries(cases)) {
    assert.notEqual(pngTexts(png(c)), null, name);
    assert.ok(hitCookie(png(c)), name);
    assert.ok(hitCookie(png(filler, c)), `큰 청크 뒤 ${name}`);
  }
});

test('PNG: 회귀(Codex 리뷰) BOM 없는 UTF-16BE 본문 하나, 압축 스트림 뒤 꼬리, 필드 경계를 넘는 n-gram', () => {
  const hitCookie = (buf) => scanBuffer(buf, new Set()).some((f) => f.rule === 'naver-cookie');
  // (1) 비압축 iTXt 본문에 BOM 없는 UTF-16BE 쿠키 하나(반복 없음): 첫 글자 'N'을 잃으면 'ID_AUT='가 된다
  const be = Buffer.from('NID_' + 'AUT=' + 'Ab9'.repeat(10), 'utf16le').swap16();
  assert.equal(be[0], 0);
  const itBe = chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([0, 0]), Buffer.from('ko'), NUL, NUL, be]));
  assert.notEqual(pngTexts(png(itBe)), null);
  assert.ok(hitCookie(png(itBe)), 'iTXt 비압축 UTF-16BE 쿠키 하나');
  // (2) 압축 스트림 뒤 꼬리 1바이트: 풀린 쿠키를 버리고 압축 바이트만 보면 놓친다
  const zc = deflateSync(Buffer.from((PLANTED['naver-cookie'] + ' ').repeat(4)));
  assert.ok(!zc.includes(Buffer.from('NID_')));
  const tail = Buffer.concat([zc, Buffer.from([0x20])]);
  const zt = chunk('zTXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from([0]), tail]));
  const it = chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([1, 0]), Buffer.from('ko'), NUL, NUL, tail]));
  for (const [name, c] of Object.entries({ zTXt: zt, 'iTXt 압축': it })) {
    assert.equal(pngTexts(png(c)), null, `${name}: 꼬리는 형식 위반`);
    assert.ok(hitCookie(png(c)), `${name} 꼬리 1바이트`);
  }
  // (3) 키워드와 본문에 걸친 구(합성 denylist): 필드를 따로 검사하면 4토큰 창이 끊긴다
  const deny = sel('Fake Studio Demo Reel');
  const hit = (buf) => scanBuffer(buf, deny).some((f) => f.rule === 'denylist');
  const tx = chunk('tEXt', Buffer.concat([Buffer.from('Title Fake Studio'), NUL, Buffer.from('Demo Reel ')]));
  assert.notEqual(pngTexts(png(tx)), null);
  assert.ok(hit(png(tx)), 'tEXt 키워드 + 본문');
  const zDemo = deflateSync(Buffer.from('Demo Reel '));
  const ztx = chunk('zTXt', Buffer.concat([Buffer.from('Fake Studio'), NUL, Buffer.from([0]), zDemo]));
  assert.ok(hit(png(ztx)), 'zTXt 키워드 + 풀린 본문');
  // 청크를 넘어서도 순서대로 이어진다
  const a = chunk('tEXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from('Fake Studio')]));
  const b = chunk('tEXt', Buffer.concat([Buffer.from('Demo'), NUL, Buffer.from('Reel')]));
  assert.ok(hit(png(a, b)), '청크 둘');
  // 다른 해석(UTF-16)은 흐름에 섞지 않는다: 흐름은 UTF-8·latin1 따로, 빈 PNG는 빈 목록
  assert.deepEqual(pngTexts(png()), []);
});

test('PNG: 풀린 크기가 상한(8 MiB)을 넘는 압축 메타데이터는 검사 오류(unscannable)로 실패한다', () => {
  const MAX = 8 * 1024 * 1024;
  const big = (n) => deflateSync(Buffer.alloc(n, 0x20));
  const z = (n) => chunk('zTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([0]), big(n)]));
  const it = (n) => chunk('iTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([1, 0]), NUL, NUL, big(n)]));
  const rules = (buf) => scanBuffer(buf, new Set()).map((f) => f.rule);
  for (const [name, c] of Object.entries({ zTXt: z, iTXt: it })) {
    assert.deepEqual(rules(png(c(MAX))), [], `${name} 상한 그대로`);
    assert.notEqual(pngTexts(png(c(MAX))), null, `${name} 상한 그대로`);
    assert.deepEqual(rules(png(c(MAX + 1))), ['unscannable'], `${name} 상한 넘음`);
    assert.equal(pngTexts(png(c(MAX + 1))), null, `${name} 상한 넘음`);
    // CRC만 틀린 청크, 깨진 PNG(IEND 뒤 바이트)에서도 같다
    const badCrc = Buffer.from(png(c(MAX + 1)));
    badCrc[badCrc.length - IEND.length - 1] ^= 0xff;
    assert.ok(rules(badCrc).includes('unscannable'), `${name} CRC`);
    assert.ok(rules(Buffer.concat([png(c(MAX + 1)), Buffer.from('x')])).includes('unscannable'), `${name} IEND 뒤`);
  }
  // 픽셀(IDAT)이 IHDR 크기보다 크게 풀리는 것은 검사 오류가 아니라 깨진 PNG(파일 전체 검사)다
  const fat = Buffer.concat([PNG_SIG, IHDR, chunk('IDAT', big(MAX + 1)), IEND]);
  assert.equal(pngTexts(fat), null);
  assert.ok(!rules(fat).includes('unscannable'));
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
