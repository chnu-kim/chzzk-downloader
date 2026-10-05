// 네이티브 E2E 판정(순수 함수)과 기다림. 실제 앱·드라이버는 CI의 e2e-native 작업이 돌린다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HLS_VIDEO_NO } from './e2e-fixture-server.mjs';
import { judge, until } from './e2e-native.mjs';

const EXP = { sha256: 'a'.repeat(64), bytes: 10 };
const LOG = [
  `/service/v2/videos/${HLS_VIDEO_NO}`,
  '/live_rewind/kr/streamkey0/vod_playlist.m3u8',
  '/live_rewind/kr/streamkey0/144p/h/vod_chunklist.m3u8',
  '/live_rewind/kr/streamkey0/144p/h/144p_0_0_0.m4s',
  '/live_rewind/kr/streamkey0/144p/h/144p_seg0.m4v',
  '/live_rewind/kr/streamkey0/144p/h/144p_seg1.m4v',
].map((path) => ({ method: 'GET', path, status: 200 }));
const OK = { files: ['[260102] 테스트채널 - 테스트 다시보기.mp4'], sha256: EXP.sha256, bytes: 10 };

test('judge: 파일 하나·해시 같음·요청 모두 200이면 통과', () => {
  assert.deepEqual(judge(OK, LOG, EXP), []);
});

test('judge: 파일 수·중간 파일·해시·크기·요청 누락·404는 실패', () => {
  const cases = {
    '파일 없음': [{ files: [], sha256: null, bytes: null }, LOG],
    '파일 둘': [{ ...OK, files: ['a.mp4', 'b.mp4'] }, LOG],
    '.part 남음': [{ ...OK, files: [...OK.files, 'x.mp4.part', 'x.mp4.part.json'] }, LOG],
    '해시 다름': [{ ...OK, sha256: 'b'.repeat(64) }, LOG],
    '크기 다름': [{ ...OK, bytes: 11 }, LOG],
    '조각 요청 없음': [OK, LOG.filter((l) => !l.path.endsWith('seg1.m4v'))],
    '404 응답': [OK, [...LOG, { method: 'GET', path: '/x', status: 404 }]],
  };
  for (const [name, [r, log]] of Object.entries(cases)) assert.ok(judge(r, log, EXP).length > 0, name);
});

test('until: 참 값을 돌려주고, 시간이 지나면 마지막 오류와 함께 실패', async () => {
  let n = 0;
  assert.equal(await until('x', () => (++n >= 2 ? 'ok' : null), 2000), 'ok');
  await assert.rejects(
    until('항상 실패', () => {
      throw new Error('boom');
    }, 300),
    /항상 실패: 0\.3초 안에 되지 않았다 \(마지막 오류: boom\)/,
  );
});
