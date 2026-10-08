// 네이티브 E2E fixture 서버: 경로·호스트 치환·조각 자르기·기대 결과(sha256). 실제 HTTP로 한 바퀴 돈다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  HLS_VIDEO_NO,
  MEDIA_HOSTS,
  OTHER_CHANNEL_ID,
  OTHER_CHANNEL_NAME,
  OTHER_VIDEO_NO,
  OWN_CHANNEL_ID,
  STUB_HANDLE,
  expectedOutput,
  otherVideoInfo,
  rewriteHosts,
  route,
  start,
  startWorker,
  truncateMedia,
  workerRoute,
} from './e2e-fixture-server.mjs';
import { ROOT } from './gates.mjs';

test('truncateMedia: 앞 두 조각과 그 앞 태그만 남기고 ENDLIST를 붙인다', () => {
  const m = '#EXTM3U\n#EXT-X-MAP:URI="i.m4s"\n#EXTINF:2,\na.m4v\n#EXTINF:2,\nb.m4v\n#EXTINF:2,\nc.m4v\n';
  assert.equal(truncateMedia(m), '#EXTM3U\n#EXT-X-MAP:URI="i.m4s"\n#EXTINF:2,\na.m4v\n#EXTINF:2,\nb.m4v\n#EXT-X-ENDLIST\n');
});

test('rewriteHosts: 합성 미디어 호스트를 모두 서버 주소로 바꾼다(이중 인코딩 JSON 안도)', () => {
  const s = MEDIA_HOSTS.map((h) => `https://${h}/x`).join(' ') + ' "{\\"path\\":\\"https://hls.example.invalid/y\\"}"';
  const out = rewriteHosts(s, 'http://127.0.0.1:9');
  assert.doesNotMatch(out, /example\.invalid/);
  assert.match(out, /http:\/\/127\.0\.0\.1:9\/y/);
});

test('서버: info → master → media → init·조각, 모르는 경로는 404, 결과는 init‖seg0‖seg1', async () => {
  const s = await start();
  try {
    const get = async (p) => {
      const r = await fetch(new URL(p, s.url));
      return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
    };
    const info = await get(`service/v2/videos/${HLS_VIDEO_NO}`);
    assert.equal(info.status, 200);
    const json = JSON.parse(info.body.toString('utf8'));
    const media = JSON.parse(json.content.liveRewindPlaybackJson).media[0].path;
    assert.ok(media.startsWith(s.url.replace(/\/$/, '')), media);
    const master = await get(new URL(media).pathname);
    assert.match(master.body.toString(), /^#EXTM3U/);
    const variant = master.body.toString().split('\n').find((l) => l.startsWith('144p/'));
    const chunk = await get(`/live_rewind/kr/streamkey0/${variant}`);
    assert.match(chunk.body.toString(), /#EXT-X-ENDLIST\n$/);
    const names = chunk.body.toString().split('\n').filter((l) => l && !l.startsWith('#'));
    assert.deepEqual(names, ['144p_seg0.m4v', '144p_seg1.m4v']);
    const init = await get('/x/144p/144p_0_0_0.m4s');
    const seg0 = await get('/x/144p/144p_seg0.m4v');
    const seg1 = await get('/x/144p/144p_seg1.m4v');
    const all = Buffer.concat([init.body, seg0.body, seg1.body]);
    assert.deepEqual(expectedOutput(), { bytes: all.length, sha256: createHash('sha256').update(all).digest('hex') });
    assert.equal((await get('/x/144p/144p_seg2.m4v')).status, 404);
    assert.equal((await get('/service/v2/videos/1')).status, 404);
    assert.deepEqual(
      s.log.map((l) => l.status),
      [200, 200, 200, 200, 200, 200, 404, 404],
    );
  } finally {
    await s.close();
  }
});

test('다른 채널 영상 info: 번호·채널 ID·이름만 바뀌고, 바꿀 것이 없으면 throw', () => {
  const info = readFileSync(join(ROOT, 'testdata/hls/video_info.json'), 'utf8');
  const other = JSON.parse(otherVideoInfo(info));
  assert.equal(other.content.videoNo, OTHER_VIDEO_NO);
  assert.equal(other.content.channel.channelId, OTHER_CHANNEL_ID);
  assert.equal(other.content.channel.channelName, OTHER_CHANNEL_NAME);
  assert.ok(!otherVideoInfo(info).includes(OWN_CHANNEL_ID));
  assert.throws(() => otherVideoInfo('{}'), /fixture에 .*이\(가\) 없다/);
  const hit = route(ROOT, `/service/v2/videos/${OTHER_VIDEO_NO}`, 'http://127.0.0.1:9');
  assert.equal(hit[0], 'application/json');
  assert.equal(JSON.parse(hit[1].toString()).content.channel.channelId, OTHER_CHANNEL_ID);
});

test('Worker 스텁 응답 모양: api.rs 파서 규칙', () => {
  const now = Date.now();
  const origin = 'http://127.0.0.1:9';
  const ctx = (over = {}) => ({ origin, now, polls: 1, bearer: null, channelId: OWN_CHANNEL_ID, ...over });
  const start = workerRoute('POST', '/auth/start', ctx());
  assert.equal(start.status, 201);
  assert.match(start.body.loginId, /^[A-Za-z0-9_-]{22}$/);
  assert.match(start.body.loginUrl.slice(`${origin}/auth/login/`.length), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(start.body.loginUrl, `${origin}/auth/login/${STUB_HANDLE}`);
  assert.match(start.body.userCode, /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
  assert.ok(Date.parse(start.body.expiresAt) > now);
  assert.ok(start.body.pollIntervalMs >= 2000);

  assert.deepEqual(workerRoute('POST', '/auth/poll', ctx({ polls: 1 })), { status: 200, body: { status: 'pending' } });
  const ok = workerRoute('POST', '/auth/poll', ctx({ polls: 2 }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'ok');
  assert.match(ok.body.accessToken, /^cda_[A-Za-z0-9_-]{43}$/);
  assert.match(ok.body.refreshToken, /^cdr_[A-Za-z0-9_-]{43}$/);
  assert.match(ok.body.channelId, /^[0-9a-f]{32}$/);
  assert.equal(ok.body.isAdmin, false);
  assert.ok(Date.parse(ok.body.accessExpiresAt) > now);
  assert.ok(Date.parse(ok.body.refreshExpiresAt) > Date.parse(ok.body.accessExpiresAt));
  assert.equal(workerRoute('POST', '/auth/refresh', ctx()).body.status, 'ok');

  assert.deepEqual(workerRoute('POST', '/auth/logout', ctx()), { status: 204, body: null });
  assert.deepEqual(workerRoute('GET', '/update/0.1.0', ctx()), { status: 204, body: null });
  assert.equal(workerRoute('GET', '/api/me', ctx()).status, 401);
  assert.equal(workerRoute('GET', '/api/me', ctx({ bearer: 'cda_x' })).body.channelId, OWN_CHANNEL_ID);
  const nf = workerRoute('GET', '/nope', ctx());
  assert.equal(nf.status, 404);
  assert.equal(nf.body.code, 'not_found');
});

test('startWorker 리스너: 실제 HTTP로 start → poll ×2', async () => {
  const w = await startWorker();
  try {
    const post = async (p) => {
      const r = await fetch(new URL(p, w.origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return { status: r.status, type: r.headers.get('content-type'), body: await r.json() };
    };
    const s = await post('/auth/start');
    assert.equal(s.type, 'application/json; charset=utf-8');
    assert.equal(s.body.loginUrl, `${w.origin}/auth/login/${STUB_HANDLE}`);
    assert.equal((await post('/auth/poll')).body.status, 'pending');
    assert.equal((await post('/auth/poll')).body.status, 'ok');
    assert.deepEqual(w.log.map((l) => l.status), [201, 200, 200]);
    assert.ok(!w.origin.endsWith('/'));
  } finally {
    await w.close();
  }
});
