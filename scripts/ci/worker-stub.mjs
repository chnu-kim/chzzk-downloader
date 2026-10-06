#!/usr/bin/env node
// release-selftest용 가짜 Worker(docs/design/worker.md §9.4, 구현 중 변경 36 (아), cicd.md 구현 중 변경 81·96). `release.mjs worker
// --check-only`의 배포 뒤 검사가 보는 응답만 흉내 낸다: 진짜 Worker 코드는 부르지 않는다. 규칙은 W5 코드(worker/src/http/update.ts·
// release-auth.ts·releases.ts·session.ts)와 같고, release.test.mjs가 worker/test/deploy-contract.mjs 표의 모든 행으로 대조한다
// (같은 표를 worker/test/http/update.test.ts가 진짜 Worker로 본다).
//
//   GET /health              200 {ok:true, schema:1, build}   (healthBuilds를 앞에서부터 하나씩 쓴 뒤 build)
//   GET /update/:v           v가 semver 아님(디코드 실패 포함) → 400 bad_version(자격보다 먼저) / Bearer 틀림·없음 → 401 invalid_token
//                            / latest(version) > v → 200 + latest.json 본문 / 그 밖 → 204
//   GET /releases/latest.json  Bearer 맞음 → 200 latest.json / 아니면 401 invalid_token
//   GET /admin               303 Location: /(W6 동작. W5까지 진짜 Worker는 404, 둘 다 검사를 통과한다)
//   GET /api/me              401 invalid_token(CI 토큰은 앱 토큰 형식이 아니다)
//   그 밖                     404 not_found
// POST /__set {routes?, healthBuilds?} → 204. 앞 설정을 지우고 이 설정으로 바꾼다. routes의 "GET /path"는 기본 응답보다 먼저 적용된다:
//   {status, json?, body?, headers?}. 저장은 메모리뿐이고 127.0.0.1에만 연다.
//
//   node scripts/ci/worker-stub.mjs --token <t> --version <v> --build <b>   # stdout 첫 줄: "listening <port>"

import { createServer } from 'node:http';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { cmpSemver, parseSemver } from './release.mjs';

function safeDecode(seg) {
  try {
    return decodeURIComponent(seg);
  } catch {
    return null;
  }
}

export function createWorkerStub({ token, version, build }) {
  const latest = JSON.stringify({ version, pub_date: '2026-10-07T00:00:00Z', platforms: {} });
  let routes = {};
  let healthBuilds = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const send = (status, data = '', headers = {}) => {
        res.writeHead(status, { 'content-length': Buffer.byteLength(data), ...headers });
        res.end(data);
      };
      if (req.method === 'POST' && url.pathname === '/__set') {
        try {
          const o = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          routes = o.routes ?? {};
          healthBuilds = Array.isArray(o.healthBuilds) ? [...o.healthBuilds] : [];
          return send(204);
        } catch {
          return send(400, '{"code":"bad_set"}');
        }
      }
      const authed = req.headers.authorization === `Bearer ${token}`;
      const json = (status, v, headers = {}) => send(status, JSON.stringify(v), { 'content-type': 'application/json', ...headers });
      const custom = routes[`${req.method} ${url.pathname}`];
      if (custom) {
        const body = custom.json !== undefined ? JSON.stringify(custom.json) : (custom.body ?? '');
        return send(custom.status, body, { ...(custom.json !== undefined ? { 'content-type': 'application/json' } : {}), ...(custom.headers ?? {}) });
      }
      if (req.method !== 'GET') return send(404, '{"code":"not_found"}');
      if (url.pathname === '/health') return json(200, { ok: true, schema: 1, build: healthBuilds.shift() ?? build });
      const up = /^\/update\/([^/]+)$/.exec(url.pathname);
      if (up) {
        const current = safeDecode(up[1]);
        if (current === null || !parseSemver(current)) return json(400, { code: 'bad_version' });
        if (!authed) return json(401, { code: 'invalid_token' });
        return cmpSemver(version, current) > 0 ? send(200, latest, { 'content-type': 'application/json' }) : send(204);
      }
      if (url.pathname === '/releases/latest.json') return authed ? send(200, latest, { 'content-type': 'application/json' }) : json(401, { code: 'invalid_token' });
      if (url.pathname === '/admin') return send(303, '', { location: '/' });
      if (url.pathname === '/api/me') return json(401, { code: 'invalid_token' });
      return json(404, { code: 'not_found' });
    });
  });
  return { server, latest };
}

function main(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i]?.replace(/^--/, '');
    if (!['token', 'version', 'build'].includes(k) || argv[i + 1] === undefined) {
      console.error('사용법: worker-stub.mjs --token <t> --version <v> --build <b>');
      process.exit(2);
    }
    o[k] = argv[i + 1];
  }
  if (!o.token || !o.version || !o.build) {
    console.error('worker-stub: --token·--version·--build가 필요하다');
    process.exit(2);
  }
  const { server } = createWorkerStub(o);
  server.listen(0, '127.0.0.1', () => console.log(`listening ${server.address().port}`));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
