// node --test scripts/ci/
// 심어 둔 표본은 실행 중에 조립한다(이 파일 자체가 검사에 걸리지 않게).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  pngParts,
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
// IDAT가 없는 PNG(문지기를 통과하지 못해 원본 그대로 예전 검사를 탄다)
const pngNoIdat = (...chunks) => Buffer.concat([PNG_SIG, IHDR, ...chunks, IEND]);
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
const le16 = (s) => Buffer.from(s, 'utf16le');
const be16 = (s) => Buffer.from(s, 'utf16le').swap16();
const tEXt = (key, body) => chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), NUL, Buffer.from(body)]));
const zTXt = (key, body) => chunk('zTXt', Buffer.concat([Buffer.from(key, 'latin1'), NUL, Buffer.from([0]), deflateSync(body)]));
const iTXt = (body, key = 'Title') => chunk('iTXt', Buffer.concat([Buffer.from(key), NUL, Buffer.from([0, 0]), NUL, NUL, Buffer.from(body)]));
const iTXtZ = (body, key = 'Title') => chunk('iTXt', Buffer.concat([Buffer.from(key), NUL, Buffer.from([1, 0]), NUL, NUL, deflateSync(body)]));
const zeroedOf = (buf) => pngParts(buf).zeroed;

test('PNG: 문지기를 통과하면 IDAT 데이터 바이트만 0으로 바꾼 사본을 검사한다(#75 픽셀 오탐)', () => {
  const deny = sel('가짜스트리머');
  const { hdr, idat, buf: shot } = grayShot('nam 가짜스트리머 ' + PLANTED['signed-token']);
  assert.deepEqual(scanBuffer(shot, deny), []);
  // 사본은 원본과 길이가 같고, IDAT 데이터 자리만 0이다(길이·형식·CRC 포함 나머지는 그대로)
  const z = zeroedOf(shot);
  assert.ok(z);
  assert.equal(z.length, shot.length);
  const dataAt = PNG_SIG.length + hdr.length + 8;
  const dataEnd = PNG_SIG.length + hdr.length + idat.length - 4;
  for (let i = 0; i < shot.length; i++) assert.equal(z[i], i >= dataAt && i < dataEnd ? 0 : shot[i], `바이트 ${i}`);
  // IDAT를 여러 청크로 나눠도(연달아 있으면) 같다
  const half = IDAT0_DATA.length >> 1;
  const split = Buffer.concat([PNG_SIG, IHDR, chunk('IDAT', IDAT0_DATA.subarray(0, half)), chunk('IDAT', IDAT0_DATA.subarray(half)), IEND]);
  assert.ok(zeroedOf(split));
  // 픽셀에 글자가 있어도 메타데이터(UTF-16 본문 포함)는 그대로 보고, 픽셀은 보지 않는다
  const meta = tEXt('Software', 'playwright');
  const u16 = tEXt('Comment', le16('NID_' + 'AUT=' + 'Ab9'.repeat(10)));
  const withMeta = Buffer.concat([PNG_SIG, hdr, meta, u16, idat, iTXtZ(Buffer.from('shot')), IEND]);
  assert.ok(zeroedOf(withMeta));
  assert.deepEqual([...new Set(scanBuffer(withMeta, deny).map((f) => f.rule))], ['naver-cookie']);
  // 내용 전체 해시(denylist-blob)는 원본 바이트에 건다
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
    assert.ok(zeroedOf(png(c)), name);
  }
});

test('PNG: 문지기를 통과하지 못하면 원본 그대로 예전처럼 검사한다(면제 없음)', () => {
  const deny = sel('가짜스트리머');
  const { hdr, idat, idatData, buf: good } = grayShot('nam 가짜스트리머 방송');
  const hit = (buf) => scanBuffer(buf, deny).some((f) => f.rule === 'denylist');
  const cookie = Buffer.from(PLANTED['naver-cookie']);
  const hitCookie = (buf) => scanBuffer(buf, new Set()).some((f) => f.rule === 'naver-cookie');
  assert.equal(hit(good), false);
  // 문지기가 null을 내고, 픽셀 글자가 다시 보이는 것까지 확인한다
  const fallback = (buf, name) => {
    assert.equal(zeroedOf(buf), null, name);
    assert.ok(hit(buf), name);
  };
  // IDAT CRC 한 바이트 바꿈
  const badCrc = Buffer.from(good);
  badCrc[PNG_SIG.length + hdr.length + idat.length - 4] ^= 0xff;
  fallback(badCrc, 'CRC');
  // 길이가 파일 끝을 넘음
  const badLen = Buffer.from(good);
  badLen.writeUInt32BE(0x7fffffff, PNG_SIG.length + hdr.length);
  fallback(badLen, '길이');
  fallback(Buffer.concat([good, Buffer.from(' 가짜스트리머 ')]), 'IEND 뒤');
  fallback(Buffer.concat([PNG_SIG, hdr, idat]), 'IEND 없음');
  fallback(Buffer.concat([PNG_SIG, hdr, chunk('ID@T', idatData), IEND]), '형식 이름');
  fallback(Buffer.concat([PNG_SIG, idat, hdr, IEND]), 'IHDR 먼저');
  fallback(Buffer.concat([PNG_SIG.subarray(0, 7), Buffer.from([0]), hdr, idat, IEND]), '시그니처');
  // IDAT: 없음, zlib가 아님, 스트림 뒤 평문, 풀린 크기가 IHDR과 다름, 사이에 다른 청크, 인터레이스
  const withIdat = (...cs) => Buffer.concat([PNG_SIG, IHDR, ...cs, IEND]);
  assert.equal(zeroedOf(withIdat()), null, 'IDAT 없음');
  fallback(withIdat(chunk('IDAT', Buffer.from('nam 가짜스트리머 방송'))), 'IDAT zlib 아님');
  const tailIdat = withIdat(chunk('IDAT', Buffer.concat([IDAT0_DATA, cookie])));
  assert.equal(zeroedOf(tailIdat), null, 'IDAT 스트림 뒤');
  assert.ok(hitCookie(tailIdat), 'IDAT 스트림 뒤');
  assert.equal(zeroedOf(withIdat(chunk('IDAT', deflateSync(Buffer.from([0, 1, 2]))))), null, 'IDAT 짧음');
  assert.equal(zeroedOf(withIdat(chunk('IDAT', deflateSync(Buffer.from([0, 1, 2, 3, 4]))))), null, 'IDAT 김');
  const half = IDAT0_DATA.length >> 1;
  const gap = tEXt('k', 'v');
  assert.equal(zeroedOf(withIdat(chunk('IDAT', IDAT0_DATA.subarray(0, half)), gap, chunk('IDAT', IDAT0_DATA.subarray(half)))), null, 'IDAT 사이');
  assert.equal(zeroedOf(Buffer.concat([PNG_SIG, chunk('IHDR', ihdrData(1, 1, 8, 2, 1)), IDAT0, IEND])), null, '인터레이스');
  assert.equal(zeroedOf(Buffer.concat([PNG_SIG, IHDR, IHDR, IDAT0, IEND])), null, 'IHDR 둘');
  // 너비 65536은 IDAT 크기가 맞아도 받지 않는다
  const wide = (w) => Buffer.concat([PNG_SIG, chunk('IHDR', ihdrData(w, 1, 1, 0)), chunk('IDAT', deflateSync(Buffer.alloc(1 + w / 8))), IEND]);
  assert.ok(zeroedOf(wide(0xfff8)), '너비 65528');
  assert.equal(zeroedOf(wide(0x10000)), null, '너비 65536');
  // IHDR·IEND는 지우지 않으므로 모양이 틀려도 그 안의 글자는 어차피 보지만, 문지기도 받지 않는다
  const withHdr = (h) => Buffer.concat([PNG_SIG, h, IDAT0, IEND]);
  assert.ok(hitCookie(withHdr(chunk('IHDR', Buffer.concat([ihdrData(1, 1, 8, 2), cookie])))), 'IHDR 길이');
  assert.ok(hitCookie(Buffer.concat([PNG_SIG, IHDR, IDAT0, chunk('IEND', cookie)])), 'IEND 길이');
  const ihdr = (w, depth, color) => withHdr(chunk('IHDR', ihdrData(w, 1, depth, color)));
  assert.ok(zeroedOf(ihdr(1, 8, 2)));
  for (const [name, buf] of Object.entries({
    '너비 0': ihdr(0, 8, 2),
    '너비에 글자': ihdr(0x41424344, 8, 2),
    '비트 깊이': ihdr(1, 7, 2),
    '색 형식': ihdr(1, 8, 5),
  })) {
    assert.equal(zeroedOf(buf), null, name);
  }
  // 텍스트 청크의 압축이 깨져도 문지기와는 상관없다(그 바이트는 지우지 않으므로 예전처럼 본다)
  const z = (m, data) => chunk('zTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([m]), data]));
  assert.ok(zeroedOf(png(z(1, deflateSync(Buffer.from('x'))))), '압축 방식');
  assert.ok(zeroedOf(png(z(0, Buffer.from('not zlib')))), '풀리지 않음');
  // 압축 스트림 뒤에 덧붙인 평문(inflate는 남은 바이트를 말없이 버린다): 파일 바이트에 있으므로 잡힌다
  const tail = Buffer.concat([deflateSync(Buffer.from('ok')), Buffer.from(' 가짜스트리머 ')]);
  assert.ok(hit(png(z(0, tail))), 'zTXt 스트림 뒤');
  const it = chunk('iTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([1, 0]), NUL, NUL, tail]));
  assert.ok(hit(png(it)), 'iTXt 스트림 뒤');
  // 깨진 PNG라도(또는 CRC만 틀린 그 청크에서도) 압축 메타데이터는 풀어 검사한다(압축된 글자는 바이트 검사로 못 본다)
  const zCookie = z(0, deflateSync(Buffer.from((PLANTED['naver-cookie'] + ' ').repeat(4))));
  assert.ok(!zCookie.includes(Buffer.from('NID_')));
  const badEnd = Buffer.from(png(zCookie));
  badEnd[badEnd.length - 1] ^= 0xff;
  assert.equal(zeroedOf(badEnd), null);
  assert.ok(hitCookie(badEnd), '압축 쿠키 + IEND CRC');
  assert.ok(hitCookie(png(zCookie, chunk('ID@T', Buffer.from('x')))), '압축 쿠키 + 형식 이름');
  const badZ = Buffer.from(png(zCookie));
  badZ[PNG_SIG.length + IHDR.length + IDAT0.length + zCookie.length - 1] ^= 0xff;
  assert.equal(zeroedOf(badZ), null);
  assert.ok(hitCookie(badZ), '압축 쿠키 청크의 CRC');
  // IDAT가 아닌 청크(보조·모르는 청크)는 지우지 않으므로 데이터를 예전처럼 글자 검사한다
  for (const t of ['gAMA', 'PLTE', 'tRNS', 'cHRM', 'pHYs', 'iCCP', 'eXIf', 'prVt']) {
    assert.ok(zeroedOf(png(chunk(t, cookie))), t);
    assert.ok(hitCookie(png(chunk(t, cookie))), `${t} 쿠키`);
    assert.ok(hit(png(chunk(t, Buffer.from('nam 가짜스트리머 x')))), t);
  }
});

test('PNG: 텍스트 청크 본문의 UTF-16도 검사한다', () => {
  const le = le16(('NID_' + 'AUT=' + 'abcdefghijklmnop').repeat(12));
  const be = Buffer.from(le).swap16();
  const hitCookie = (buf) => scanBuffer(buf, new Set()).some((f) => f.rule === 'naver-cookie');
  // Codex 재현: CRC가 맞는 tEXt 'Comment\0' + UTF-16LE 쿠키(origin/master는 잡았다)
  assert.ok(hitCookie(png(tEXt('Comment', le))), 'tEXt UTF-16LE');
  assert.ok(hitCookie(png(tEXt('Comment', be))), 'tEXt UTF-16BE');
  // 앞에 NUL 없는 큰 청크가 있어 파일 전체의 UTF-16 추정(앞 8000바이트)이 빗나가도 본문 디코드가 잡는다
  const filler = chunk('prVt', Buffer.alloc(9000, 0x2e));
  assert.ok(hitCookie(png(filler, tEXt('Comment', le))), '큰 청크 뒤 tEXt UTF-16LE');
  assert.ok(hitCookie(png(filler, tEXt('Comment', be))), '큰 청크 뒤 tEXt UTF-16BE');
  const zLe = deflateSync(le);
  assert.ok(!zLe.includes(Buffer.from('N\0I\0D\0')));
  const cases = {
    'zTXt UTF-16LE': zTXt('Comment', le),
    'iTXt 압축 UTF-16LE': iTXtZ(le),
    'iTXt 비압축 UTF-16BE': iTXt(be),
  };
  for (const [name, c] of Object.entries(cases)) {
    assert.ok(hitCookie(png(c)), name);
    assert.ok(hitCookie(png(filler, c)), `큰 청크 뒤 ${name}`);
  }
});

// Codex 리뷰가 이전 접근(필드별 수집)에서 찾은 우회 재현. origin/master가 잡은 것은 모두 잡아야 한다.
const CODEX_CASES = (() => {
  const cookie1 = 'NID_' + 'AUT=' + 'Ab9'.repeat(10);
  const zc = deflateSync(Buffer.from((PLANTED['naver-cookie'] + ' ').repeat(4)));
  const tail = Buffer.concat([zc, Buffer.from([0x20])]);
  const A = ' Fake Studio ';
  const B = ' Demo Reel ';
  const phrase = 'Fake Studio Demo Reel';
  return {
    'iTXt 비압축 BOM 없는 UTF-16BE 쿠키 하나(첫 글자)': [new Set(), iTXt(be16(cookie1)), 'naver-cookie'],
    'tEXt BOM 없는 UTF-16BE 쿠키 하나(첫 글자)': [new Set(), tEXt('Comment', be16(cookie1)), 'naver-cookie'],
    'tEXt UTF-16LE 쿠키': [new Set(), tEXt('Comment', le16(cookie1)), 'naver-cookie'],
    'tEXt UTF-16LE BOM 쿠키': [new Set(), tEXt('Comment', Buffer.concat([Buffer.from([0xff, 0xfe]), le16(cookie1)])), 'naver-cookie'],
    'zTXt 압축 쿠키 + 꼬리 1바이트': [new Set(), chunk('zTXt', Buffer.concat([Buffer.from('Comment'), NUL, Buffer.from([0]), tail])), 'naver-cookie'],
    'iTXt 압축 쿠키 + 꼬리 1바이트': [new Set(), chunk('iTXt', Buffer.concat([Buffer.from('Title'), NUL, Buffer.from([1, 0]), Buffer.from('ko'), NUL, NUL, tail])), 'naver-cookie'],
    'tEXt 키워드 + 본문 n-gram': [sel(phrase), tEXt('Title Fake Studio', 'Demo Reel '), 'denylist'],
    'zTXt 키워드 + 풀린 본문 n-gram': [sel(phrase), zTXt('Fake Studio', Buffer.from('Demo Reel ')), 'denylist'],
    'tEXt 청크 둘 n-gram': [sel(phrase), Buffer.concat([tEXt('Title', 'Fake Studio'), tEXt('Demo', 'Reel')]), 'denylist'],
    'iTXt 비압축 UTF-16LE 둘': [sel(phrase), Buffer.concat([iTXt(le16(A)), iTXt(le16(B))]), 'denylist'],
    'iTXt 비압축 UTF-16BE 둘': [sel(phrase), Buffer.concat([iTXt(be16(A)), iTXt(be16(B))]), 'denylist'],
    'iTXt 압축 UTF-16LE 둘': [sel(phrase), Buffer.concat([iTXtZ(le16(A)), iTXtZ(le16(B))]), 'denylist'],
    'zTXt UTF-16BE 둘': [sel(phrase), Buffer.concat([zTXt('Comment', be16(A)), zTXt('Comment', be16(B))]), 'denylist'],
    'LE·BE 섞음': [sel(phrase), Buffer.concat([iTXt(le16(A)), zTXt('Comment', be16(B))]), 'denylist'],
    '홀짝 엇갈림': [sel(phrase), Buffer.concat([iTXt(le16(A), 'Title'), iTXt(le16(B), 'Titles')]), 'denylist'],
    'tEXt UTF-16 + zTXt 압축 UTF-16': [sel(phrase), Buffer.concat([tEXt('Comment', le16(A)), zTXt('Comment', le16(B))]), 'denylist'],
    // 두 tEXt 본문 사이에 키워드가 끼임: 키워드 'X'(5바이트 미만 조각)가 끼면 구가 끊긴다
    'tEXt 본문 둘 사이 키워드': [sel(phrase), Buffer.concat([tEXt('X', '\n Fake Studio \n'), tEXt('X', '\n Demo Reel \n')]), 'denylist'],
    // 모르는 청크의 짧은 payload: 데이터만 떼어 보면 6바이트 미만이라 글자 조각이 안 된다(형식 이름과 붙어 잡힌다)
    '모르는 청크 짧은 payload': [sel('Bob'), chunk('prVt', Buffer.from(' Bob ')), 'denylist'],
  };
})();

test('PNG: 회귀(Codex 리뷰 재현) 모두 잡는다', () => {
  for (const [name, [deny, meta, rule]] of Object.entries(CODEX_CASES)) {
    for (const [kind, buf] of [['IDAT 있음', png(meta)], ['IDAT 없음', pngNoIdat(meta)]]) {
      assert.ok(scanBuffer(buf, deny).some((f) => f.rule === rule), `${name} (${kind})`);
    }
    assert.ok(zeroedOf(png(meta)), `${name}: 온전한 PNG(문지기 통과)`);
  }
  // 본문 앞에 NUL 없는 긴 글자를 두어 본문별 UTF-16 추정(한쪽 바이트 30%)이 빗나가도 LE·BE로 다 읽는다
  const deny = sel('Fake Studio Demo Reel');
  const hit = (buf) => scanBuffer(buf, deny).some((f) => f.rule === 'denylist');
  const pad = Buffer.from('x'.repeat(400));
  assert.ok(hit(png(iTXt(Buffer.concat([pad, le16(' Fake Studio ')])), iTXt(Buffer.concat([pad, le16(' Demo Reel ')])))), 'iTXt 비압축, 추정 빗나감');
  assert.ok(hit(png(zTXt('k', Buffer.concat([pad, be16(' Fake Studio ')])), zTXt('k', Buffer.concat([pad, be16(' Demo Reel ')])))), 'zTXt 압축 BE, 추정 빗나감');
});

// origin/master의 scanBuffer(PNG 처리 전, blob c2f4025)를 고정 오라클로 둔다. CI의 얕은 클론(Windows)에서도 돌게
// git show 대신 저장소에 그대로 넣은 사본을 쓰고, 사본이 그 blob과 같은지 확인한다.
const ORACLE_BLOB = 'c2f4025ad7cd1a22b77a26634463107ab11288f1';
const ORACLE_PATH = join(HERE, 'testdata', 'public-scan-master.mjs');

test('오라클 사본은 origin/master의 public-scan.mjs(blob c2f4025) 그대로다', () => {
  const body = Buffer.from(readFileSync(ORACLE_PATH, 'utf8').replace(/\r\n/g, '\n'));
  const sha = createHash('sha1').update(`blob ${body.length}\0`).update(body).digest('hex');
  assert.equal(sha, ORACLE_BLOB);
});

// 작은 결정적 난수(mulberry32)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('PNG: 속성 — 이 브랜치의 결과 ⊇ origin/master scanBuffer의 결과(오라클과 직접 비교)', async () => {
  const master = await import(pathToFileURL(ORACLE_PATH).href);
  const WORDS = ['Fake', 'Studio', 'Demo', 'Reel', 'Bob', 'Zq7Kp2Lm9X', '가짜스트리머', '9876543'];
  const PHRASES = [...WORDS, 'Fake Studio', 'Demo Reel', 'Fake Studio Demo Reel', 'Studio Demo'];
  const rand = rng(0x75);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const SEPS = [' ', '\n', '\0', '', '\t', ' x ', '\0\0'];
  const text = () => {
    const n = 1 + Math.floor(rand() * 4);
    let s = pick(SEPS);
    for (let i = 0; i < n; i++) s += pick(WORDS) + pick(SEPS);
    if (rand() < 0.15) s += 'NID_' + 'AUT=' + 'Ab9'.repeat(10) + pick(SEPS);
    return s;
  };
  const enc = (s) => {
    const r = rand();
    if (r < 0.35) return Buffer.from(s);
    if (r < 0.5) return Buffer.from(s, 'latin1');
    if (r < 0.75) return le16(s);
    if (r < 0.9) return be16(s);
    return Buffer.concat([Buffer.from([0xff, 0xfe]), le16(s)]);
  };
  const meta = () => {
    const r = rand();
    const key = pick(['Title', 'Comment', 'X', 'Software', pick(WORDS)]);
    if (r < 0.3) return tEXt(key, enc(text()));
    if (r < 0.5) return iTXt(enc(text()), key);
    if (r < 0.62) return zTXt(key, enc(text()));
    if (r < 0.72) return iTXtZ(enc(text()), key);
    if (r < 0.8) return chunk(pick(['gAMA', 'pHYs', 'eXIf']), enc(text()));
    return chunk(pick(['prVt', 'abCd']), enc(text()));
  };
  const cases = Object.entries(CODEX_CASES).map(([name, [, m]]) => [name, m]);
  for (let i = 0; i < 120; i++) {
    const n = 1 + Math.floor(rand() * 4);
    cases.push([`무작위 ${i}`, Buffer.concat(Array.from({ length: n }, meta))]);
  }
  // 큰 청크로 파일 전체 UTF-16 추정의 경계를 흔든 것도 섞는다
  for (let i = 0; i < 20; i++) {
    const filler = chunk('prVt', Buffer.alloc(Math.floor(rand() * 9000), pick([0x2e, 0])));
    cases.push([`큰 청크 ${i}`, Buffer.concat([filler, meta(), meta()])]);
  }
  const rulesOf = (fs) => new Set(fs.map((f) => f.rule));
  let masterHits = 0;
  const codexHit = new Set();
  for (const [name, m] of cases) {
    for (const [kind, buf] of [['IDAT 있음', png(m)], ['IDAT 없음', pngNoIdat(m)]]) {
      const where = `${name} (${kind})`;
      // 규칙 집합(denylist 없음): 쿠키 등
      const mine0 = rulesOf(scanBuffer(buf, new Set()));
      for (const r of rulesOf(master.scanBuffer(buf, new Set()))) assert.ok(mine0.has(r), `${where}: ${r}`);
      // denylist 항목 하나씩: master가 잡으면 이 브랜치도 잡는다
      let any = mine0.size > 0;
      for (const p of PHRASES) {
        const deny = sel(p);
        if (!master.scanBuffer(buf, deny).some((f) => f.rule === 'denylist')) continue;
        any = true;
        masterHits++;
        assert.ok(scanBuffer(buf, deny).some((f) => f.rule === 'denylist'), `${where}: '${p}'`);
      }
      if (CODEX_CASES[name] && any) codexHit.add(name);
    }
  }
  // 비교가 헛돌지 않게: master가 실제로 잡는 사례가 충분해야 한다(압축 재현은 master가 못 본다)
  assert.ok(codexHit.size >= 10, `master가 잡은 Codex 재현 ${codexHit.size}개: ${[...codexHit]}`);
  assert.ok(masterHits > 200, `master 일치 ${masterHits}건`);
});

test('속성 — PNG가 아닌 파일(UTF-16 등)도 이 브랜치의 결과 ⊇ origin/master scanBuffer의 결과', async () => {
  const master = await import(pathToFileURL(ORACLE_PATH).href);
  // 재현: BOM 없는 UTF-16BE에서 master는 앞 두 바이트를 떼고 읽는다. 첫 글자를 살려 읽기만 하면
  // 'X'가 첫 토큰에 붙어(xbob) 'Bob' 일치를 잃는다. 두 해석을 모두 본다
  const bob = sel('Bob');
  const xb = be16('XBob rest');
  assert.ok(master.scanBuffer(xb, bob).some((f) => f.rule === 'denylist'));
  assert.ok(scanBuffer(xb, bob).some((f) => f.rule === 'denylist'), 'BOM 없는 UTF-16BE 앞 글자 + 토큰');
  const WORDS = ['Fake', 'Studio', 'Demo', 'Reel', 'Bob', 'Zq7Kp2Lm9X', '가짜스트리머', '9876543'];
  const PHRASES = [...WORDS, 'Fake Studio', 'Demo Reel', 'Fake Studio Demo Reel'];
  const rand = rng(0x16);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  let masterHits = 0;
  for (let i = 0; i < 200; i++) {
    let s = pick(['', 'X', 'a1', ' ', '\n']);
    for (let k = 1 + Math.floor(rand() * 4); k > 0; k--) s += pick(WORDS) + pick([' ', '\n', '', '\0', 'x']);
    if (rand() < 0.2) s += 'NID_' + 'AUT=' + 'Ab9'.repeat(10);
    const r = rand();
    const body = r < 0.3 ? le16(s) : r < 0.6 ? be16(s) : r < 0.75 ? Buffer.concat([Buffer.from([0xff, 0xfe]), le16(s)]) : r < 0.9 ? Buffer.concat([Buffer.from([0xfe, 0xff]), be16(s)]) : Buffer.concat([Buffer.from(s), NUL, Buffer.from(pick(WORDS))]);
    const mine0 = new Set(scanBuffer(body, new Set()).map((f) => f.rule));
    for (const f of master.scanBuffer(body, new Set())) assert.ok(mine0.has(f.rule), `${i}: ${f.rule}`);
    for (const p of PHRASES) {
      const deny = sel(p);
      if (!master.scanBuffer(body, deny).some((f) => f.rule === 'denylist')) continue;
      masterHits++;
      assert.ok(scanBuffer(body, deny).some((f) => f.rule === 'denylist'), `${i}: '${p}'`);
    }
  }
  assert.ok(masterHits > 100, `master 일치 ${masterHits}건`);
});

test('PNG: IDAT를 0으로 바꿔 UTF-16 추정이 뒤집혀도 원본 추정 쪽 해석을 잃지 않는다', async () => {
  const master = await import(pathToFileURL(ORACLE_PATH).href);
  const cookie = 'NID_' + 'AUT=' + 'Ab9'.repeat(10);
  const hitCookie = (s, buf) => s.scanBuffer(buf, new Set()).some((f) => f.rule === 'naver-cookie');
  // 텍스트 청크가 아닌 청크에 둔다(추가 검사가 아니라 파일 전체 UTF-16 해석만 본다).
  // 픽셀이 [x, 0]을 되풀이해 한쪽 홀짝에 0이 몰린 IDAT(무압축 블록)와, 반대쪽에 0이 몰린 큰 UTF-16 본문을 둔다.
  // 원본은 IDAT 쪽이 이겨 그 엔디언으로 쿠키 본문을 읽지만, IDAT를 0으로 지우면 양쪽이 같이 늘어 본문 쪽이 이긴다.
  let found = null;
  for (let w = 600; w <= 1400 && !found; w += 2) {
    for (let k = 1; k <= 4 && !found; k++) {
      for (const [big, small] of [[be16, le16], [le16, be16]]) {
        const px = Buffer.alloc(1 + w);
        for (let i = 1; i <= w; i++) px[i] = i % 2 ? 0x41 : 0;
        const hdr = chunk('IHDR', ihdrData(w, 1, 8, 0));
        const idat = chunk('IDAT', deflateSync(px, { level: 0 }));
        const buf = Buffer.concat([PNG_SIG, hdr, chunk('prVt', Buffer.concat([Buffer.alloc(k, 0x4b), big('b'.repeat(300))])), chunk('prVt', small(cookie)), idat, IEND]);
        const z = zeroedOf(buf);
        if (z && hitCookie(master, buf) && !hitCookie(master, z)) found = buf;
      }
    }
  }
  assert.ok(found, '추정이 뒤집히는 사례를 만들지 못했다');
  assert.ok(hitCookie({ scanBuffer }, found));
});

test('PNG: 추적 중인 PNG는 모두 문지기를 통과하고(픽셀을 지운다) 검사가 깨끗하다', () => {
  const files = spawnSync('git', ['ls-files', '-z', '*.png'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
  assert.ok(files.length > 0);
  const deny = loadDenylist([DENYLIST_PATH]);
  for (const f of files) {
    const buf = readFileSync(join(ROOT, f));
    assert.ok(zeroedOf(buf), f);
    assert.deepEqual(scanBuffer(buf, deny), [], f);
  }
});

test('PNG: 풀린 크기가 상한(8 MiB)을 넘는 압축 메타데이터는 검사 오류(unscannable)로 실패한다', () => {
  const MAX = 8 * 1024 * 1024;
  const big = (n) => deflateSync(Buffer.alloc(n, 0x20));
  const z = (n) => chunk('zTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([0]), big(n)]));
  const it = (n) => chunk('iTXt', Buffer.concat([Buffer.from('k'), NUL, Buffer.from([1, 0]), NUL, NUL, big(n)]));
  const rules = (buf) => scanBuffer(buf, new Set()).map((f) => f.rule);
  for (const [name, c] of Object.entries({ zTXt: z, iTXt: it })) {
    assert.deepEqual(rules(png(c(MAX))), [], `${name} 상한 그대로`);
    assert.deepEqual(rules(png(c(MAX + 1))), ['unscannable'], `${name} 상한 넘음`);
    // 상한은 청크 전체에 걸린다(작은 청크 여럿으로 나눠도 넘으면 실패)
    const half = (n) => c(n);
    assert.deepEqual(rules(png(half(MAX / 2), half(MAX / 2 + 1))), ['unscannable'], `${name} 둘로 나눔`);
    // CRC만 틀린 청크, 깨진 PNG(IEND 뒤 바이트)에서도 같다
    const badCrc = Buffer.from(png(c(MAX + 1)));
    badCrc[badCrc.length - IEND.length - 1] ^= 0xff;
    assert.ok(rules(badCrc).includes('unscannable'), `${name} CRC`);
    assert.ok(rules(Buffer.concat([png(c(MAX + 1)), Buffer.from('x')])).includes('unscannable'), `${name} IEND 뒤`);
  }
  // 픽셀(IDAT)이 IHDR 크기보다 크게 풀리는 것은 검사 오류가 아니라 문지기 실패(원본 검사)다
  const fat = Buffer.concat([PNG_SIG, IHDR, chunk('IDAT', big(MAX + 1)), IEND]);
  assert.equal(zeroedOf(fat), null);
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
