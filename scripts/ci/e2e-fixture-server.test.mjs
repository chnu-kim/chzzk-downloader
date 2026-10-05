// 네이티브 E2E fixture 서버: 경로·호스트 치환·조각 자르기·기대 결과(sha256). 실제 HTTP로 한 바퀴 돈다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { HLS_VIDEO_NO, MEDIA_HOSTS, expectedOutput, rewriteHosts, start, truncateMedia } from './e2e-fixture-server.mjs';

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
