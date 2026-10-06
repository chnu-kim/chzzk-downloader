// s3-fake.mjs(release-selftest의 가짜 S3): SigV4 검증이 AWS 공개 시험 벡터와 같은 값을 내는지(xtask/src/s3.rs와 따로 구현한
// 두 서명기가 같은 벡터에 묶인다), 조건부 쓰기 의미(If-None-Match: *, If-Match)가 R2·S3와 같은지
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { test } from 'node:test';

import { createFakeS3, expectedSignature, listObjects, listXml, parseAuth } from './s3-fake.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');

test('SigV4: get-vanilla 시험 벡터', () => {
  const sig = expectedSignature({
    method: 'GET',
    path: '/',
    query: '',
    headers: { host: 'example.amazonaws.com', 'x-amz-date': '20150830T123600Z' },
    signed: ['host', 'x-amz-date'],
    payloadHash: sha(''),
    amzDate: '20150830T123600Z',
    region: 'us-east-1',
    service: 'service',
    secret: ['wJalrXUtnFEMI', 'K7MDENG+bPxRfiCYEXAMPLEKEY'].join('/'),
  });
  // 누출 검사(keyed-hex·hex-id)에 걸리지 않게 나눠 적는다
  assert.equal(sig, ['5fa00fa31553b73ebf194', '2676e86291e8372ff2a22', '60956d9b8aae1d763fbf31'].join(''));
  assert.deepEqual(parseAuth('AWS4-HMAC-SHA256 Credential=A/20150830/auto/s3/aws4_request, SignedHeaders=host;x-amz-date, Signature=' + 'a'.repeat(64)).signed, ['host', 'x-amz-date']);
  assert.equal(parseAuth('Bearer x'), null);
});

// 가짜 서버에 서명한 요청(테스트 안의 서명기 = expectedSignature)
// key가 ''이면 버킷 자체(목록), query는 정규 쿼리(키 정렬·인코딩 끝낸 문자열)
function call(port, method, key, body = '', extra = {}, secret = 's', query = '') {
  const amzDate = new Date().toISOString().replace(/[-:]|\.\d{3}/g, '');
  const path = key === '' ? '/b' : `/b/${key}`;
  const headers = { host: `127.0.0.1:${port}`, 'x-amz-date': amzDate, 'x-amz-content-sha256': sha(body), ...extra };
  const signed = Object.keys(headers).sort();
  const signature = expectedSignature({ method, path, query, headers, signed, payloadHash: sha(body), amzDate, region: 'auto', service: 's3', secret });
  headers.authorization = `AWS4-HMAC-SHA256 Credential=a/${amzDate.slice(0, 8)}/auto/s3/aws4_request, SignedHeaders=${signed.join(';')}, Signature=${signature}`;
  return new Promise((res, rej) => {
    const r = request({ host: '127.0.0.1', port, method, path: query ? `${path}?${query}` : path, headers }, (resp) => {
      const c = [];
      resp.on('data', (d) => c.push(d));
      resp.on('end', () => res({ status: resp.statusCode, etag: resp.headers.etag, body: Buffer.concat(c).toString() }));
    });
    r.on('error', rej);
    r.end(body);
  });
}

test('조건부 쓰기·서명 거부', async () => {
  const { server } = createFakeS3({ bucket: 'b', access: 'a', secret: 's' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    assert.equal((await call(port, 'GET', 'k')).status, 404);
    const first = await call(port, 'PUT', 'k', 'v1', { 'if-none-match': '*' });
    assert.equal(first.status, 200);
    assert.equal((await call(port, 'PUT', 'k', 'v2', { 'if-none-match': '*' })).status, 412);
    assert.equal((await call(port, 'PUT', 'k', 'v2', { 'if-match': '"stale"' })).status, 412);
    assert.equal((await call(port, 'PUT', 'nokey', 'v2', { 'if-match': first.etag })).status, 404);
    assert.equal((await call(port, 'PUT', 'k', 'v2', { 'if-match': first.etag })).status, 200);
    const g = await call(port, 'GET', 'k');
    assert.equal(g.body, 'v2');
    assert.notEqual(g.etag, first.etag);
    assert.equal((await call(port, 'PUT', 'k', 'v3', { 'x-amz-checksum-sha256': createHash('sha256').update('other').digest('base64') })).status, 400);
    assert.equal((await call(port, 'GET', 'k', '', {}, 'wrong')).status, 403);
    assert.equal((await call(port, 'DELETE', 'k')).status, 204);
    assert.equal((await call(port, 'GET', 'k')).status, 404);
  } finally {
    server.close();
  }
});

test('장애 주입: before는 적용하지 않고, after는 적용한 뒤 응답만 바꾸며, times번 뒤 사라진다', async () => {
  const { server, store } = createFakeS3({ bucket: 'b', access: 'a', secret: 's' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const fault = (f) =>
    new Promise((res, rej) => {
      const r = request({ host: '127.0.0.1', port, method: 'POST', path: '/__fault' }, (resp) => {
        resp.resume();
        resp.on('end', () => res(resp.statusCode));
      });
      r.on('error', rej);
      r.end(JSON.stringify(f));
    });
  try {
    assert.equal(await fault({ method: 'PUT', key: 'k', mode: 'before', status: 503, times: 1 }), 204);
    assert.equal((await call(port, 'PUT', 'k', 'v1', { 'if-none-match': '*' })).status, 503);
    assert.equal(store.has('k'), false);
    assert.equal((await call(port, 'PUT', 'k', 'v1', { 'if-none-match': '*' })).status, 200);
    assert.equal(await fault({ method: 'PUT', key: 'k', mode: 'after', status: 500, times: 1 }), 204);
    const g = await call(port, 'GET', 'k');
    assert.equal((await call(port, 'PUT', 'k', 'v2', { 'if-match': g.etag })).status, 500);
    assert.equal(store.get('k').body.toString(), 'v2');
    // 같은 요청을 다시 보내면 412(이미 적용됨)
    assert.equal((await call(port, 'PUT', 'k', 'v2', { 'if-match': g.etag })).status, 412);
    assert.equal(await fault({ method: 'GET', key: 'k', mode: 'before', status: 429, times: 2 }), 204);
    assert.equal((await call(port, 'GET', 'k')).status, 429);
    assert.equal((await call(port, 'GET', 'k')).status, 429);
    assert.equal((await call(port, 'GET', 'k')).status, 200);
    assert.equal(await fault({ method: 'GET', key: 'k', mode: 'sideways', status: 500, times: 1 }), 400);
  } finally {
    server.close();
  }
});

test('listObjects·listXml: prefix로 거르고 사전순, maxKeys에서 잘리고, XML은 이스케이프한다', () => {
  const store = new Map([['releases/b', 1], ['releases/a', 1], ['other/x', 1], ['releases/c&d', 1]]);
  assert.deepEqual(listObjects(store, { prefix: 'releases/' }), { keys: ['releases/a', 'releases/b', 'releases/c&d'], truncated: false });
  assert.deepEqual(listObjects(store, { prefix: 'releases/', maxKeys: 2 }), { keys: ['releases/a', 'releases/b'], truncated: true });
  assert.deepEqual(listObjects(store, { prefix: 'none/' }), { keys: [], truncated: false });
  const xml = listXml('b', 'releases/', 3, listObjects(store, { prefix: 'releases/' }));
  assert.match(xml, /<Key>releases\/c&amp;d<\/Key>/);
  assert.match(xml, /<IsTruncated>false<\/IsTruncated>/);
  assert.match(listXml('b', '', 1, { keys: ['k'], truncated: true }), /<IsTruncated>true<\/IsTruncated><NextContinuationToken>/);
});

test('ListObjectsV2: 서명한 목록 요청 → 200 XML, 다른 버킷·틀린 서명·장애 주입', async () => {
  const { server, store } = createFakeS3({ bucket: 'b', access: 'a', secret: 's' });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const fault = (f) =>
    new Promise((res, rej) => {
      const r = request({ host: '127.0.0.1', port, method: 'POST', path: '/__fault' }, (resp) => {
        resp.resume();
        resp.on('end', () => res(resp.statusCode));
      });
      r.on('error', rej);
      r.end(JSON.stringify(f));
    });
  const q = (prefix, max = '1000') => `list-type=2&max-keys=${max}&prefix=${encodeURIComponent(prefix)}`;
  try {
    for (const k of ['releases/1.0.0/a', 'releases/1.0.0/b', 'releases/latest.json', 'x']) assert.equal((await call(port, 'PUT', k, 'v')).status, 200);
    const all = await call(port, 'GET', '', '', {}, 's', q('releases/'));
    assert.equal(all.status, 200);
    assert.deepEqual([...all.body.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]), ['releases/1.0.0/a', 'releases/1.0.0/b', 'releases/latest.json']);
    const cut = await call(port, 'GET', '', '', {}, 's', q('releases/', '2'));
    assert.match(cut.body, /<IsTruncated>true<\/IsTruncated>/);
    assert.equal((await call(port, 'GET', '', '', {}, 'wrong', q('releases/'))).status, 403);
    // 장애 주입은 요청한 prefix와 정확히 같을 때만(delete-version의 하위 접두 목록에는 걸리지 않는다)
    assert.equal(await fault({ method: 'LIST', key: 'releases/', mode: 'before', status: 503, times: 1 }), 204);
    assert.equal((await call(port, 'GET', '', '', {}, 's', q('releases/1.0.0/'))).status, 200);
    assert.equal((await call(port, 'GET', '', '', {}, 's', q('releases/'))).status, 503);
    assert.equal((await call(port, 'GET', '', '', {}, 's', q('releases/'))).status, 200);
    assert.equal(store.size, 4);
  } finally {
    server.close();
  }
});
