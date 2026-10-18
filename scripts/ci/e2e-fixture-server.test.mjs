// 네이티브 E2E fixture 서버: 경로·호스트 치환·조각 자르기·기대 결과(sha256). 실제 HTTP로 한 바퀴 돈다.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  DELEGATED,
  DELEGATED_CHANNEL_ID,
  DELEGATED_CHANNEL_NAME,
  DELEGATED_VIDEO_NO,
  HLS_VIDEO_NO,
  MEDIA_HOSTS,
  OTHER_CHANNEL_ID,
  OTHER_CHANNEL_NAME,
  OTHER_VIDEO_NO,
  OWN_CHANNEL_ID,
  LOOPBACK_PATH,
  LOOPBACK_STATE_DOMAIN,
  STUB_GRANT,
  STUB_HANDLE,
  delegatedVideoInfo,
  expectedOutput,
  expectedOutputs,
  loopbackState,
  otherVideoInfo,
  rewriteHosts,
  route,
  start,
  startWorker,
  truncateMedia,
  verifierOf,
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

test('서버: info → master → media → init·조각, 모르는 경로는 404, 결과는 init‖seg0‖seg1의 일반 mp4 golden', async () => {
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
    // 서빙하는 조각은 fixture 그대로이고, 기대 결과는 그것을 일반 mp4로 바꾼 golden이다(core.md 71)
    const all = Buffer.concat([init.body, seg0.body, seg1.body]);
    const raw = ['init.mp4', 'seg0.m4v', 'seg1.m4v'].map((f) => readFileSync(join(ROOT, 'testdata', 'hls', f)));
    assert.deepEqual(all, Buffer.concat(raw));
    const flat = readFileSync(join(ROOT, 'testdata', 'hls', 'full2_flat.mp4'));
    assert.deepEqual(expectedOutput(), { bytes: flat.length, sha256: createHash('sha256').update(flat).digest('hex') });
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

test('표지 썸네일: info의 주소가 서버로 치환되고, 영상 번호별 경로가 thumb.jpg를 내며, 요청의 Cookie 유무를 기록한다', async () => {
  const s = await start();
  try {
    const info = JSON.parse((await (await fetch(new URL(`service/v2/videos/${HLS_VIDEO_NO}`, s.url))).text()));
    const thumb = new URL(info.content.thumbnailImageUrl);
    assert.equal(thumb.origin, s.url.replace(/\/$/, ''));
    assert.equal(thumb.pathname, `/thumb/${HLS_VIDEO_NO}.jpg`);
    const jpg = readFileSync(join(ROOT, 'testdata', 'synthetic', 'thumb.jpg'));
    const r = await fetch(thumb);
    assert.equal(r.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), jpg);
    // 남의 영상 변형은 번호가 따라 바뀐다
    const other = JSON.parse(otherVideoInfo(readFileSync(join(ROOT, 'testdata/hls/video_info.json'), 'utf8')));
    assert.match(other.content.thumbnailImageUrl, new RegExp(`/thumb/${OTHER_VIDEO_NO}\\.jpg$`));
    // 다른 확장자·문자가 든 경로는 404
    assert.equal((await fetch(new URL('/thumb/1.png', s.url))).status, 404);
    assert.equal((await fetch(new URL('/thumb/x.jpg', s.url))).status, 404);
    await fetch(thumb, { headers: { cookie: 'NID_AUT=x' } });
    const logs = s.log.filter((l) => l.path === thumb.pathname);
    assert.deepEqual(logs.map((l) => l.cookie), [false, true]);
  } finally {
    await s.close();
  }
});

test('expectedOutputs: 본인·맡은 채널 golden은 서로 다르고, 태그를 넣지 않은 golden과도 다르다', () => {
  const { own, delegated } = expectedOutputs();
  const sha = (rel) => createHash('sha256').update(readFileSync(join(ROOT, 'testdata', 'hls', rel))).digest('hex');
  assert.equal(own.sha256, sha('full2_tagged_own.mp4'));
  assert.equal(delegated.sha256, sha('full2_tagged_delegated.mp4'));
  assert.notEqual(own.sha256, delegated.sha256);
  assert.notEqual(own.sha256, expectedOutput().sha256);
  assert.ok(own.bytes > expectedOutput().bytes, '태그와 표지가 더해져 더 크다');
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

test('맡은 채널 영상 info: 번호·채널 ID·이름만 바뀌고, 스텁 delegatedChannels 원소와 같은 채널이다', () => {
  const info = readFileSync(join(ROOT, 'testdata/hls/video_info.json'), 'utf8');
  const d = JSON.parse(delegatedVideoInfo(info));
  assert.equal(d.content.videoNo, DELEGATED_VIDEO_NO);
  assert.equal(d.content.channel.channelId, DELEGATED_CHANNEL_ID);
  assert.equal(d.content.channel.channelName, DELEGATED_CHANNEL_NAME);
  assert.ok(!delegatedVideoInfo(info).includes(OWN_CHANNEL_ID));
  assert.throws(() => delegatedVideoInfo('{}'), /fixture에 .*이\(가\) 없다/);
  // 셸 token::is_channel_id(소문자 hex 32자)를 지나야 parse_delegated가 버리지 않는다
  assert.match(DELEGATED_CHANNEL_ID, /^[0-9a-f]{32}$/);
  assert.notEqual(DELEGATED_CHANNEL_ID, OWN_CHANNEL_ID);
  assert.notEqual(DELEGATED_CHANNEL_ID, OTHER_CHANNEL_ID);
  // 실제 Worker tokenBundleJson과 같은 두 키만
  assert.deepEqual(Object.keys(DELEGATED).sort(), ['channelId', 'channelName']);
  assert.deepEqual(DELEGATED, { channelId: DELEGATED_CHANNEL_ID, channelName: DELEGATED_CHANNEL_NAME });
  const hit = route(ROOT, `/service/v2/videos/${DELEGATED_VIDEO_NO}`, 'http://127.0.0.1:9');
  assert.equal(hit[0], 'application/json');
  assert.equal(JSON.parse(hit[1].toString()).content.channel.channelId, DELEGATED_CHANNEL_ID);
});

test('Worker 스텁 응답 모양: api.rs 파서 규칙', () => {
  const now = Date.now();
  const origin = 'http://127.0.0.1:9';
  const verifier = verifierOf('S'.repeat(43));
  const ctx = (over = {}) => ({ origin, now, bearer: null, channelId: OWN_CHANNEL_ID, body: null, login: null, ...over });

  // start: 포트(1024~65535 정수)와 43자 b64url verifier만 받는다
  for (const body of [null, {}, { port: 80, loginVerifier: verifier }, { port: 1023, loginVerifier: verifier }, { port: 65536, loginVerifier: verifier }, { port: '50000', loginVerifier: verifier }, { port: 50000, loginVerifier: 'short' }, { port: 50000 }]) {
    assert.deepEqual(workerRoute('POST', '/auth/start', ctx({ body })), { status: 400, body: { code: 'bad_request' } });
  }
  const c = ctx({ body: { port: 50000, loginVerifier: verifier, client: 'x' } });
  const start = workerRoute('POST', '/auth/start', c);
  assert.equal(start.status, 201);
  assert.deepEqual(Object.keys(start.body).sort(), ['expiresAt', 'loginUrl']);
  assert.match(start.body.loginUrl.slice(`${origin}/auth/login/`.length), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(start.body.loginUrl, `${origin}/auth/login/${STUB_HANDLE}`);
  assert.ok(Date.parse(start.body.expiresAt) > now);
  assert.deepEqual(c.login, { port: 50000, verifier });

  // 확인 페이지: 기록이 없으면 404, 있으면 루프백 수신기로 303
  assert.equal(workerRoute('GET', `/auth/login/${STUB_HANDLE}`, ctx()).status, 404);
  const login = workerRoute('GET', `/auth/login/${STUB_HANDLE}`, c);
  assert.equal(login.status, 303);
  assert.equal(login.body, null);
  assert.equal(
    login.headers.location,
    `http://127.0.0.1:50000/chzzk-downloader/login?grant=${STUB_GRANT}&state=${loopbackState(verifier)}`,
  );

  // redeem: grant가 스텁 grant이고 loginSecret의 해시가 기록한 verifier와 같을 때만
  const ok = workerRoute('POST', '/auth/redeem', ctx({ login: c.login, body: { grant: STUB_GRANT, loginSecret: 'S'.repeat(43) } }));
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'ok');
  assert.match(ok.body.accessToken, /^cda_[A-Za-z0-9_-]{43}$/);
  assert.match(ok.body.refreshToken, /^cdr_[A-Za-z0-9_-]{43}$/);
  assert.match(ok.body.channelId, /^[0-9a-f]{32}$/);
  assert.equal(ok.body.isAdmin, false);
  assert.ok(Date.parse(ok.body.accessExpiresAt) > now);
  assert.ok(Date.parse(ok.body.refreshExpiresAt) > Date.parse(ok.body.accessExpiresAt));
  for (const body of [{ grant: STUB_GRANT, loginSecret: 'T'.repeat(43) }, { grant: 'cdg_' + 'X'.repeat(43), loginSecret: 'S'.repeat(43) }, { grant: STUB_GRANT }, null]) {
    assert.deepEqual(workerRoute('POST', '/auth/redeem', ctx({ login: c.login, body })), { status: 404, body: { code: 'not_found' } });
  }
  assert.equal(workerRoute('POST', '/auth/redeem', ctx({ body: { grant: STUB_GRANT, loginSecret: 'S'.repeat(43) } })).status, 404);
  // 옛 폴링 경로는 없다
  assert.equal(workerRoute('POST', '/auth/poll', ctx()).status, 404);

  assert.equal(workerRoute('POST', '/auth/refresh', ctx()).body.status, 'ok');
  assert.deepEqual(workerRoute('POST', '/auth/logout', ctx()), { status: 204, body: null });
  assert.deepEqual(workerRoute('GET', '/update/0.1.0', ctx()), { status: 204, body: null });
  assert.equal(workerRoute('GET', '/api/me', ctx()).status, 401);
  assert.equal(workerRoute('GET', '/api/me', ctx({ bearer: 'cda_x' })).body.channelId, OWN_CHANNEL_ID);
  // 맡은 채널(편집자 위임): 기본은 빈 목록, delegated 옵션은 묶음에 두 키, /api/me에는 since까지
  assert.deepEqual(ok.body.delegatedChannels, []);
  assert.deepEqual(workerRoute('GET', '/api/me', ctx({ bearer: 'cda_x' })).body.delegatedChannels, []);
  const owner = { channelId: 'd'.repeat(32), channelName: '맡은채널' };
  const withOwner = ctx({ delegated: [owner] });
  assert.deepEqual(workerRoute('POST', '/auth/refresh', withOwner).body.delegatedChannels, [owner]);
  const meBody = workerRoute('GET', '/api/me', ctx({ bearer: 'cda_x', delegated: [owner] })).body;
  assert.deepEqual(meBody.delegatedChannels, [{ ...owner, since: meBody.delegatedChannels[0].since }]);
  assert.ok(Date.parse(meBody.delegatedChannels[0].since) > 0);
  assert.deepEqual(meBody.editors, []);
  assert.equal(meBody.pendingInviteUntil, null);
  assert.deepEqual(meBody.limits, { editors: 10, delegations: 20 });
  const nf = workerRoute('GET', '/nope', ctx());
  assert.equal(nf.status, 404);
  assert.equal(nf.body.code, 'not_found');
});

test('loopbackState·verifierOf: 공유 KAT(worker/test/vectors/loopback-vectors.json)', () => {
  const kat = JSON.parse(readFileSync(join(ROOT, 'worker/test/vectors/loopback-vectors.json'), 'utf8'));
  assert.equal(kat.domain, LOOPBACK_STATE_DOMAIN);
  assert.ok(kat.state.length > 0 && kat.url.length > 0);
  for (const row of kat.state) {
    assert.equal(loopbackState(row.loginVerifier), row.state);
    // loginSecret은 일부 행에만 있다
    if (row.loginSecret !== undefined) assert.equal(verifierOf(row.loginSecret), row.loginVerifier);
  }
  // 스텁식 조립이 url 행과 같다(스텁은 verifier로 state를 계산하므로 행의 state와 같은 verifier를 찾아 쓴다)
  for (const row of kat.url) {
    const v = kat.state.find((r) => r.state === row.state);
    assert.ok(v, `url 행의 state에 맞는 state 행이 없다`);
    const built = `http://127.0.0.1:${row.port}${LOOPBACK_PATH}?grant=${row.grant}&state=${loopbackState(v.loginVerifier)}`;
    assert.equal(built, row.url);
  }
});

test('startWorker 리스너: 실제 HTTP로 start → GET login 303 → redeem', async () => {
  const w = await startWorker();
  try {
    const verifier = verifierOf('R'.repeat(43));
    const post = async (p, body) => {
      const r = await fetch(new URL(p, w.origin), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return { status: r.status, type: r.headers.get('content-type'), body: await r.json() };
    };
    const s = await post('/auth/start', { port: 50123, loginVerifier: verifier, client: 'x' });
    assert.equal(s.type, 'application/json; charset=utf-8');
    assert.equal(s.body.loginUrl, `${w.origin}/auth/login/${STUB_HANDLE}`);
    const r = await fetch(new URL(`/auth/login/${STUB_HANDLE}`, w.origin), { redirect: 'manual' });
    assert.equal(r.status, 303);
    assert.equal(r.headers.get('location'), `http://127.0.0.1:50123${LOOPBACK_PATH}?grant=${STUB_GRANT}&state=${loopbackState(verifier)}`);
    const ok = await post('/auth/redeem', { grant: STUB_GRANT, loginSecret: 'R'.repeat(43) });
    assert.equal(ok.body.status, 'ok');
    assert.deepEqual(w.log.map((l) => l.status), [201, 303, 200]);
    assert.ok(!w.origin.endsWith('/'));
  } finally {
    await w.close();
  }
});
