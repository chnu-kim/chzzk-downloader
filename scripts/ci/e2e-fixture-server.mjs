#!/usr/bin/env node
// 네이티브 E2E의 가짜 치지직 서버(docs/design/cicd.md §6 "네이티브 E2E"). `testdata/`의 합성 fixture만 서빙한다:
// 빠른 다시보기(HLS) 영상 하나(`testdata/hls/`)의 info → master → media(앞 두 조각 + ENDLIST) → init·조각 둘.
// 같은 info에서 영상 번호·채널만 바꾼 "남의 영상" 하나(OTHER_URL)도 준다(본인 영상 검사, A5).
// `--features e2e` 앱이 `CHZZK_E2E_API_BASE`로 이 서버를 API·vodplay 기본 주소로 쓴다. 네트워크는 루프백뿐이다.
//
// 같은 모듈의 `startWorker()`는 로그인 Worker 스텁이다(별도 리스너, `CHZZK_E2E_WORKER_BASE`). worker/src 계약과 같은 모양의
// /auth/start·login(303 루프백)·redeem·refresh·logout, /api/me, /update/:current만 답한다. 시각은 모두 실행 시각 기준이다.
//
//   node scripts/ci/e2e-fixture-server.mjs [--port N]   # 직접 띄워 보기(주소를 출력하고 Ctrl+C까지 돈다)
//
// 결과 파일은 init‖seg0‖seg1과 바이트가 같아야 한다(코어 segmented.rs fixture_concat_box_order와 같은 기대값).
// 판정용 sha256은 expectedOutput()이 fixture에서 계산한다.

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

// testdata/hls/video_info.json의 videoNo와 그 주소(앱 입력줄에 넣는다)
export const HLS_VIDEO_NO = 9000001;
export const HLS_URL = `https://chzzk.naver.com/video/${HLS_VIDEO_NO}`;
// fixture의 미디어 호스트(testdata/README.md). 서버 주소로 바꾼다(이중 인코딩 JSON 안에서도 단순 치환으로 된다)
export const MEDIA_HOSTS = ['hls.example.invalid', 'clip.example.invalid', 'vod.example.invalid'];
// 남의 영상(A5): 같은 HLS info에서 영상 번호·채널 ID·채널 이름만 바꾼다. 본인 채널은 fixture의 채널(OWN_CHANNEL_ID)이다.
export const OWN_CHANNEL_ID = '000000000000000000000000000000a1';
export const OTHER_CHANNEL_ID = '000000000000000000000000000000c3';
export const OTHER_VIDEO_NO = 9000101;
export const OTHER_URL = `https://chzzk.naver.com/video/${OTHER_VIDEO_NO}`;
export const OTHER_CHANNEL_NAME = '다른채널';
const OWN_CHANNEL_NAME = '테스트채널';
// media playlist에서 남길 조각 수(fixture 조각 파일은 seg0·seg1 둘뿐이다)
const KEEP_SEGMENTS = 2;

const fixture = (root, rel) => readFileSync(join(root, 'testdata', rel));

export function rewriteHosts(text, origin) {
  let s = text;
  for (const h of MEDIA_HOSTS) s = s.replaceAll(`https://${h}`, origin);
  return s;
}

// media playlist의 앞 n개 조각만 남기고 ENDLIST를 붙인다(태그 줄은 조각 앞의 것만 남는다)
export function truncateMedia(text, n = KEEP_SEGMENTS) {
  const kept = [];
  let uris = 0;
  for (const line of text.split('\n')) {
    if (uris === n) break;
    if (line !== '' && !line.startsWith('#')) uris++;
    kept.push(line);
  }
  return `${kept.join('\n')}\n#EXT-X-ENDLIST\n`;
}

// HLS info → 남의 영상 info. 바꿀 문자열이 하나라도 없으면 throw(fixture가 바뀐 것을 조용히 넘기지 않는다)
export function otherVideoInfo(text) {
  let s = text;
  for (const [from, to] of [
    [String(HLS_VIDEO_NO), String(OTHER_VIDEO_NO)],
    [OWN_CHANNEL_ID, OTHER_CHANNEL_ID],
    [OWN_CHANNEL_NAME, OTHER_CHANNEL_NAME],
  ]) {
    if (!s.includes(from)) throw new Error(`남의 영상 info: fixture에 ${from}이(가) 없다`);
    s = s.replaceAll(from, to);
  }
  return s;
}

export function expectedOutput(root = ROOT) {
  const bytes = Buffer.concat(['hls/init.mp4', 'hls/seg0.m4v', 'hls/seg1.m4v'].map((f) => fixture(root, f)));
  return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}

// 경로 → [content-type, body] (없으면 null). origin은 http://127.0.0.1:<port>
export function route(root, path, origin) {
  if (path === `/service/v2/videos/${HLS_VIDEO_NO}`) {
    return ['application/json', Buffer.from(rewriteHosts(fixture(root, 'hls/video_info.json').toString('utf8'), origin))];
  }
  if (path === `/service/v2/videos/${OTHER_VIDEO_NO}`) {
    const info = rewriteHosts(fixture(root, 'hls/video_info.json').toString('utf8'), origin);
    return ['application/json', Buffer.from(otherVideoInfo(info))];
  }
  if (path.endsWith('/vod_playlist.m3u8')) return ['application/vnd.apple.mpegurl', fixture(root, 'hls/master.m3u8')];
  if (path.endsWith('/vod_chunklist.m3u8')) {
    return ['application/vnd.apple.mpegurl', Buffer.from(truncateMedia(fixture(root, 'hls/media.m3u8').toString('utf8')))];
  }
  if (/\/\d+p_0_0_0\.m4s$/.test(path)) return ['video/mp4', fixture(root, 'hls/init.mp4')];
  const seg = /\/\d+p_seg(\d+)\.m4v$/.exec(path);
  if (seg && Number(seg[1]) < KEEP_SEGMENTS) return ['video/mp4', fixture(root, `hls/seg${seg[1]}.m4v`)];
  return null;
}

// 서버를 띄운다 → { url(끝에 /), log: [{method, path, status}], close() }. 요청 기록은 판정에 쓴다(쿼리는 버린다).
export function start({ root = ROOT, port = 0 } = {}) {
  const log = [];
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const origin = `http://127.0.0.1:${server.address().port}`;
      const hit = req.method === 'GET' ? route(root, u.pathname, origin) : null;
      log.push({ method: req.method, path: u.pathname, status: hit ? 200 : 404 });
      if (!hit) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': hit[0], 'content-length': hit[1].length }).end(hit[1]);
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}/`;
      resolve({ url, log, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

// ───────────────────────── 로그인 Worker 스텁 ─────────────────────────
// 앱 crates/shell/src/auth/api.rs 파서 규칙에 맞춘 응답(토큰·ID 모양). 실제 Worker(worker/src)와 같은 루프백 계약이다:
// start가 포트·loginVerifier를 기록하고, 확인 페이지 GET이 루프백 수신기로 303을 보내며, redeem이 grant와 loginSecret을 확인한다.

export const STUB_HANDLE = 'E2E' + 'H'.repeat(19); // 22자 b64url
export const STUB_GRANT = 'cdg_' + 'E2E' + 'G'.repeat(40); // cdg_ + 43자
export const STUB_CHANNEL_NAME = 'E2E 채널';
export const LOOPBACK_PATH = '/chzzk-downloader/login';
// worker/src/core/loopback.ts·crates/shell auth/token.rs와 같은 도메인(공유 KAT: worker/test/vectors/loopback-vectors.json)
export const LOOPBACK_STATE_DOMAIN = 'chzzk-downloader/loopback-state\n';

const JSON_TYPE = 'application/json; charset=utf-8';
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;
const iso = (ms) => new Date(ms).toISOString();

// b64url(SHA-256(UTF-8(domain + loginVerifier)))
export function loopbackState(verifier) {
  return createHash('sha256').update(LOOPBACK_STATE_DOMAIN + verifier, 'utf8').digest('base64url');
}

// loginVerifier = b64url(SHA-256(UTF-8(loginSecret 문자열)))
export function verifierOf(secret) {
  return createHash('sha256').update(secret, 'utf8').digest('base64url');
}

function bundle(ctx, access, refresh) {
  return {
    status: 'ok',
    accessToken: 'cda_' + access.repeat(43),
    accessExpiresAt: iso(ctx.now + 24 * 3600_000),
    refreshToken: 'cdr_' + refresh.repeat(43),
    refreshExpiresAt: iso(ctx.now + 30 * 24 * 3600_000),
    channelId: ctx.channelId ?? OWN_CHANNEL_ID,
    channelName: STUB_CHANNEL_NAME,
    isAdmin: false,
    serverTime: iso(ctx.now),
  };
}

// 순수에 가까운 함수: (method, path, ctx) → { status, body|null, headers? }.
// ctx = { origin, now(ms), bearer, channelId, body(파싱한 JSON|null), login(가변 {port, verifier}|null) }. /auth/start가 ctx.login을 채운다.
export function workerRoute(method, path, ctx) {
  if (method === 'POST' && path === '/auth/start') {
    const b = ctx.body ?? {};
    if (!Number.isInteger(b.port) || b.port < 1024 || b.port > 65535 || typeof b.loginVerifier !== 'string' || !B64URL_43.test(b.loginVerifier)) {
      return { status: 400, body: { code: 'bad_request' } };
    }
    ctx.login = { port: b.port, verifier: b.loginVerifier };
    return {
      status: 201,
      body: { loginUrl: `${ctx.origin}/auth/login/${STUB_HANDLE}`, expiresAt: iso(ctx.now + 600_000) },
    };
  }
  if (method === 'GET' && path === `/auth/login/${STUB_HANDLE}`) {
    if (!ctx.login) return { status: 404, body: { code: 'not_found' } };
    const { port, verifier } = ctx.login;
    return {
      status: 303,
      body: null,
      headers: { location: `http://127.0.0.1:${port}${LOOPBACK_PATH}?grant=${STUB_GRANT}&state=${loopbackState(verifier)}` },
    };
  }
  if (method === 'POST' && path === '/auth/redeem') {
    const b = ctx.body ?? {};
    if (ctx.login && b.grant === STUB_GRANT && typeof b.loginSecret === 'string' && verifierOf(b.loginSecret) === ctx.login.verifier) {
      return { status: 200, body: bundle(ctx, 'A', 'B') };
    }
    return { status: 404, body: { code: 'not_found' } };
  }
  if (method === 'POST' && path === '/auth/refresh') return { status: 200, body: bundle(ctx, 'C', 'D') };
  if (method === 'POST' && path === '/auth/logout') return { status: 204, body: null };
  if (method === 'GET' && path === '/api/me') {
    if (!ctx.bearer) return { status: 401, body: { code: 'invalid_token' } };
    return {
      status: 200,
      body: {
        channelId: ctx.channelId ?? OWN_CHANNEL_ID,
        channelName: STUB_CHANNEL_NAME,
        accessExpiresAt: iso(ctx.now + 24 * 3600_000),
        serverTime: iso(ctx.now),
      },
    };
  }
  if (method === 'GET' && path.startsWith('/update/')) return { status: 204, body: null };
  return { status: 404, body: { code: 'not_found' } };
}

const MAX_BODY = 64 * 1024;

// Worker 스텁 리스너(127.0.0.1:0) → { origin(끝 / 없음), log: [{method, path, status}], close() }. 요청 기록은 fixture 서버와 따로다
// (fixture는 모든 응답이 200이어야 하고, 스텁은 201·204·303·404를 쓴다). 로그인 기록(포트·verifier)은 이 리스너가 쥔다.
export function startWorker({ channelId = OWN_CHANNEL_ID } = {}) {
  const log = [];
  const ctx = { login: null };
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1');
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= MAX_BODY) chunks.push(c);
      });
      req.on('end', () => {
        let body = null;
        if (size > 0 && size <= MAX_BODY) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            body = null;
          }
        }
        const origin = `http://127.0.0.1:${server.address().port}`;
        const bearer = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
        Object.assign(ctx, { origin, now: Date.now(), bearer, channelId, body });
        const r = workerRoute(req.method ?? 'GET', u.pathname, ctx);
        log.push({ method: req.method, path: u.pathname, status: r.status });
        if (r.body === null) {
          res.writeHead(r.status, r.headers ?? {}).end();
          return;
        }
        const buf = Buffer.from(JSON.stringify(r.body));
        res.writeHead(r.status, { 'content-type': JSON_TYPE, 'content-length': buf.length, ...(r.headers ?? {}) }).end(buf);
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const origin = `http://127.0.0.1:${server.address().port}`;
      resolve({ origin, log, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export async function main(argv) {
  let port = 0;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && /^\d+$/.test(argv[i + 1] ?? '')) port = Number(argv[++i]);
    else {
      console.error('사용법: e2e-fixture-server.mjs [--port N]');
      return 2;
    }
  }
  const s = await start({ port });
  console.log(`e2e fixture 서버: ${s.url} (영상 주소 ${HLS_URL}, 기대 결과 ${JSON.stringify(expectedOutput())})`);
  return new Promise(() => {});
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
