#!/usr/bin/env node
// release-selftest용 작은 S3 서버(docs/design/cicd.md §5.8, 구현 중 변경 G6). MinIO 이미지를 더 받을 수 없어(2026-10-06 실측:
// minio/minio·quay.io/minio/minio 모두 pull 거부) 설계의 대체안대로 Node로 만들었다. xtask(Rust)와 **따로 구현한** SigV4 검증으로
// 서명이 틀린 요청은 403으로 거부하고, R2·S3의 조건부 쓰기를 흉내 낸다:
//   PUT  If-None-Match: * → 있으면 412, If-Match: <etag> → 없으면 404·다르면 412, x-amz-checksum-sha256·x-amz-content-sha256 불일치 400
//   GET  200 + ETag(본문 md5, 따옴표 포함) / 404,  DELETE 204,  다른 버킷 404
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

const xmlErr = (code) => `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code></Error>`;

export function createFakeS3({ bucket, access, secret, region = 'auto', now = () => Date.now() }) {
  const store = new Map();
  const counts = { requests: 0, rejectedAuth: 0 };
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      counts.requests++;
      const body = Buffer.concat(chunks);
      const send = (status, data = '', headers = {}) => {
        res.writeHead(status, { 'content-length': Buffer.byteLength(data), ...headers });
        res.end(data);
      };
      const url = new URL(req.url, 'http://x');
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

      const m = /^\/([^/]+)\/(.+)$/.exec(url.pathname);
      if (!m || decodeURIComponent(m[1]) !== bucket) return send(404, xmlErr('NoSuchBucket'));
      const key = decodeURIComponent(m[2]);
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
  return { server, store, counts };
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
