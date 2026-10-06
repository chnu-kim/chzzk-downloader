#!/usr/bin/env node
// release-selftest용 작은 S3 서버(docs/design/cicd.md §5.8, 구현 중 변경 G6). MinIO 이미지를 더 받을 수 없어(2026-10-06 실측:
// minio/minio·quay.io/minio/minio 모두 pull 거부) 설계의 대체안대로 Node로 만들었다. xtask(Rust)와 **따로 구현한** SigV4 검증으로
// 서명이 틀린 요청은 403으로 거부하고, R2·S3의 조건부 쓰기를 흉내 낸다:
//   PUT  If-None-Match: * → 있으면 412, If-Match: <etag> → 없으면 404·다르면 412, x-amz-checksum-sha256·x-amz-content-sha256 불일치 400
//   GET  200 + ETag(본문 md5, 따옴표 포함) / 404,  DELETE 204,  다른 버킷 404
//   GET  /<bucket>?list-type=2&prefix=…&max-keys=…  ListObjectsV2(사전순 <Key>만, delimiter 없음. max-keys를 넘으면 IsTruncated true)
//   POST /__fault: 장애 주입(아래 matchFault. 목록은 method LIST, key = 요청한 prefix)
// 저장은 메모리뿐이다. 경로 방식(/<bucket>/<key>)만 받는다.
//
//   node scripts/ci/s3-fake.mjs --bucket <b> --access <id> --secret <키> [--region auto]   # stdout 첫 줄: "listening <port>"

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const hmac = (k, m) => createHmac('sha256', k).update(m).digest();

// SigV4 Authorization 헤더 → { access, date, region, service, signed: [이름], signature } | null
export function parseAuth(h) {
  const m = /^AWS4-HMAC-SHA256 Credential=([^/,\s]+)\/(\d{8})\/([^/,\s]+)\/([^/,\s]+)\/aws4_request, ?SignedHeaders=([a-z0-9;-]+), ?Signature=([0-9a-f]{64})$/.exec(h ?? '');
  return m ? { access: m[1], date: m[2], region: m[3], service: m[4], signed: m[5].split(';'), signature: m[6] } : null;
}

// 요청 → 서명(16진). path는 받은 그대로(이미 인코딩된 경로), query는 정렬한 문자열
export function expectedSignature({ method, path, query, headers, signed, payloadHash, amzDate, region, service, secret }) {
  const canonHeaders = signed.map((n) => `${n}:${String(headers[n] ?? '').trim().replace(/\s+/g, ' ')}\n`).join('');
  const creq = [method, path, query, canonHeaders, signed.join(';'), payloadHash].join('\n');
  const scope = `${amzDate.slice(0, 8)}/${region}/${service}/aws4_request`;
  const sts = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(creq)].join('\n');
  let k = hmac(`AWS4${secret}`, amzDate.slice(0, 8));
  for (const p of [region, service, 'aws4_request']) k = hmac(k, p);
  return createHmac('sha256', k).update(sts).digest('hex');
}

const xmlEscape = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// store(키 → 객체) → 목록(순수). 사전순, prefix로 거르고 maxKeys를 넘으면 잘린다(truncated)
export function listObjects(store, { prefix = '', maxKeys = 1000 } = {}) {
  const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
  return { keys: all.slice(0, maxKeys), truncated: all.length > maxKeys };
}

// ListObjectsV2 응답 XML. 값은 & < > 이스케이프, 잘렸으면 NextContinuationToken(이어받기는 지원하지 않는다)
export function listXml(bucket, prefix, maxKeys, { keys, truncated }) {
  const contents = keys.map((k) => `<Contents><Key>${xmlEscape(k)}</Key><Size>0</Size></Contents>`).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<ListBucketResult><Name>${xmlEscape(bucket)}</Name><Prefix>${xmlEscape(prefix)}</Prefix><KeyCount>${keys.length}</KeyCount><MaxKeys>${maxKeys}</MaxKeys>` +
    `<IsTruncated>${truncated}</IsTruncated>${truncated ? '<NextContinuationToken>t1</NextContinuationToken>' : ''}${contents}</ListBucketResult>`
  );
}

const xmlErr = (code) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;

// 장애 주입(selftest가 기반 시설 오류를 재현한다). POST /__fault {method, key, mode, status, times, skip?}:
//   mode 'before': 요청을 적용하지 않고 status로 답한다(일시 오류 5xx·429).
//   mode 'after':  요청을 적용한 뒤 응답만 status로 바꾼다(서버는 썼는데 응답을 잃은 경우).
//   skip(선택, 기본 0): 처음 skip번 맞는 요청은 그대로 지나가게 한다(두 번째 읽기만 실패시키기).
//   times번 쓰면 사라진다. 서명 검사 전에 처리하는 시험 전용 경로다(가짜 서버는 127.0.0.1에만 열린다).
export function matchFault(faults, method, key) {
  const f = faults.find((x) => x.times > 0 && x.method === method && x.key === key);
  if (f && f.skip > 0) {
    f.skip--;
    return null;
  }
  if (f) f.times--;
  return f ?? null;
}

export function createFakeS3({ bucket, access, secret, region = 'auto', now = () => Date.now() }) {
  const store = new Map();
  const faults = [];
  const counts = { requests: 0, rejectedAuth: 0, faults: 0 };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      counts.requests++;
      const body = Buffer.concat(chunks);
      let override = null;
      const send = (status, data = '', headers = {}) => {
        if (override !== null) [status, data, headers] = [override, xmlErr('InternalError'), {}];
        res.writeHead(status, { 'content-length': Buffer.byteLength(data), ...headers });
        res.end(data);
      };
      const url = new URL(req.url, 'http://x');
      if (url.pathname === '/__fault' && req.method === 'POST') {
        try {
          const f = JSON.parse(body.toString('utf8'));
          if (!['GET', 'PUT', 'DELETE', 'LIST'].includes(f.method) || typeof f.key !== 'string' || !['before', 'after'].includes(f.mode) || !Number.isInteger(f.status) || !Number.isInteger(f.times)) throw new Error('형식');
          if (f.skip !== undefined && !(Number.isInteger(f.skip) && f.skip >= 0)) throw new Error('형식');
          faults.push({ method: f.method, key: f.key, mode: f.mode, status: f.status, times: f.times, skip: f.skip ?? 0 });
          return send(204);
        } catch {
          return send(400, xmlErr('BadFault'));
        }
      }
      const auth = parseAuth(req.headers.authorization);
      const amzDate = req.headers['x-amz-date'] ?? '';
      const payloadHash = req.headers['x-amz-content-sha256'] ?? '';
      const reject = (code) => {
        counts.rejectedAuth++;
        return send(403, xmlErr(code));
      };
      if (!auth || auth.access !== access || auth.region !== region || auth.service !== 's3') return reject('InvalidAccessKeyId');
      if (!auth.signed.includes('host') || !auth.signed.includes('x-amz-date') || !auth.signed.includes('x-amz-content-sha256')) return reject('AccessDenied');
      const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(amzDate);
      if (!t || auth.date !== amzDate.slice(0, 8)) return reject('AccessDenied');
      const at = Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6]);
      if (Math.abs(now() - at) > 15 * 60_000) return reject('RequestTimeTooSkewed');
      const query = [...url.searchParams].sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      const want = expectedSignature({ method: req.method, path: url.pathname, query, headers: req.headers, signed: auth.signed, payloadHash, amzDate, region, service: 's3', secret });
      if (!timingSafeEqual(Buffer.from(want), Buffer.from(auth.signature))) return reject('SignatureDoesNotMatch');
      if (payloadHash !== sha256(body)) return send(400, xmlErr('XAmzContentSHA256Mismatch'));

      // 목록: GET /<bucket>(끝 슬래시 허용) + list-type=2. 객체 경로보다 먼저 본다
      const lm = /^\/([^/]+)\/?$/.exec(url.pathname);
      if (req.method === 'GET' && lm && url.searchParams.get('list-type') === '2') {
        if (decodeURIComponent(lm[1]) !== bucket) return send(404, xmlErr('NoSuchBucket'));
        const prefix = url.searchParams.get('prefix') ?? '';
        const mk = Number(url.searchParams.get('max-keys') ?? 1000);
        const maxKeys = Number.isInteger(mk) && mk >= 1 && mk <= 1000 ? mk : 1000;
        const lf = matchFault(faults, 'LIST', prefix);
        if (lf) counts.faults++;
        if (lf) return send(lf.status, xmlErr('InternalError'));
        return send(200, listXml(bucket, prefix, maxKeys, listObjects(store, { prefix, maxKeys })), { 'content-type': 'application/xml' });
      }
      const m = /^\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (!m || decodeURIComponent(m[1]) !== bucket) return send(404, xmlErr('NoSuchBucket'));
      const key = decodeURIComponent(m[2]);
      const fault = matchFault(faults, req.method, key);
      if (fault) counts.faults++;
      if (fault?.mode === 'before') return send(fault.status, xmlErr('InternalError'));
      if (fault?.mode === 'after') override = fault.status;
      const cur = store.get(key);
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (!cur) return send(404, xmlErr('NoSuchKey'));
        return send(200, req.method === 'GET' ? cur.body : '', { etag: cur.etag });
      }
      if (req.method === 'DELETE') {
        store.delete(key);
        return send(204);
      }
      if (req.method === 'PUT') {
        const ck = req.headers['x-amz-checksum-sha256'];
        if (ck !== undefined && ck !== createHash('sha256').update(body).digest('base64')) return send(400, xmlErr('BadDigest'));
        const inm = req.headers['if-none-match'];
        const im = req.headers['if-match'];
        if (inm !== undefined && inm !== '*') return send(501, xmlErr('NotImplemented'));
        if (inm === '*' && cur) return send(412, xmlErr('PreconditionFailed'));
        if (im !== undefined && !cur) return send(404, xmlErr('NoSuchKey'));
        if (im !== undefined && im !== cur.etag) return send(412, xmlErr('PreconditionFailed'));
        const etag = `"${createHash('md5').update(body).digest('hex')}"`;
        store.set(key, { body, etag });
        return send(200, '', { etag });
      }
      return send(405, xmlErr('MethodNotAllowed'));
    });
  });
  return { server, store, counts, faults };
}

function main(argv) {
  const o = { region: 'auto' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, '');
    if (!['bucket', 'access', 'secret', 'region'].includes(k) || argv[i + 1] === undefined) {
      console.error('사용법: s3-fake.mjs --bucket <b> --access <id> --secret <키> [--region auto]');
      process.exit(2);
    }
    o[k] = argv[i + 1];
  }
  if (!o.bucket || !o.access || !o.secret) {
    console.error('s3-fake: --bucket·--access·--secret이 필요하다');
    process.exit(2);
  }
  const { server } = createFakeS3(o);
  server.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
