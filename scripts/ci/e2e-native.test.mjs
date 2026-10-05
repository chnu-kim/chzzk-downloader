// 네이티브 E2E 판정(순수 함수)과 기다림. 실제 앱·드라이버는 CI의 e2e-native 작업이 돌린다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { HLS_VIDEO_NO } from './e2e-fixture-server.mjs';
import { judge, pickWindowsDriver, until } from './e2e-native.mjs';

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

test('elementId: W3C 키·옛 ELEMENT 키를 받고, 없으면 응답을 보여 주며 실패', async () => {
  const { elementId } = await import('./e2e-native.mjs');
  assert.equal(elementId({ 'element-6066-11e4-a52e-4f735466cecf': 'a' }), 'a');
  assert.equal(elementId({ ELEMENT: 'b' }), 'b');
  assert.throws(() => elementId({ other: 'c' }), /요소 응답에 id가 없다: \{"other":"c"\}/);
  assert.throws(() => elementId(null), /id가 없다/);
});

test('parseRegPv: reg query /s 출력에서 이름이 WebView2 런타임인 키의 pv만', async () => {
  const { parseRegPv } = await import('./e2e-native.mjs');
  const out = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{edge}',
    '    name    REG_SZ    Microsoft Edge',
    '    pv    REG_SZ    142.0.1.1',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{webview}',
    '    name    REG_SZ    Microsoft Edge WebView2 Runtime',
    '    pv    REG_SZ    141.0.3537.57',
    '',
  ].join('\r\n');
  assert.equal(parseRegPv(out), '141.0.3537.57');
  assert.equal(parseRegPv('nothing'), null);
});

// 리뷰(G4): 버전이 다르면 해시를 고정할 수 없는 드라이버를 받아 실행하지 않고 실패한다
test('pickWindowsDriver: 러너 드라이버가 WebView2와 같은 버전일 때만 쓰고, 아니면 두 버전을 적고 실패', () => {
  const image = 'C:\\SeleniumWebDrivers\\EdgeDriver\\msedgedriver.exe';
  assert.equal(pickWindowsDriver({ webview2: '153.0.4234.48', image, imageVersion: '153.0.4234.48' }), image);
  assert.throws(() => pickWindowsDriver({ webview2: '153.0.4234.48', image, imageVersion: '154.0.1.2' }), /154\.0\.1\.2 ≠ WebView2 런타임 153\.0\.4234\.48/);
  assert.throws(() => pickWindowsDriver({ webview2: '153.0.4234.48', image: null, imageVersion: null }), /msedgedriver가 없다/);
  assert.throws(() => pickWindowsDriver({ webview2: null, image, imageVersion: '153.0.4234.48' }), /WebView2 런타임 버전/);
});
