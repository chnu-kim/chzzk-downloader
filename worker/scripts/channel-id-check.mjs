#!/usr/bin/env node
// channelId 동일성 게이트(docs/design/worker.md, ROADMAP Phase 3).
//
// OAuth `users/me`의 channelId가 서비스 API의 VOD `content.channel.channelId`·클립 `content.ownerChannel.channelId`와
// 같은 값인지 실제 로그인으로 확인한다. **어떤 ID·토큰·code도 출력하지 않고** "같다/다르다"와 형식 검사 결과만 찍는다.
//
// 쓰는 법(사람이 직접 실행, 본인 계정·본인 영상):
//   node worker/scripts/channel-id-check.mjs <본인 VOD 주소> <본인 클립 주소>
//   → 터미널에 나온 http://localhost:8787/auth/login 을 브라우저로 열어 치지직으로 로그인한다.
//
// 자격증명은 worker/.dev.vars(1Password Environment 마운트, gitignore)의 CHZZK_CLIENT_ID·CHZZK_CLIENT_SECRET.
// 치지직 앱에 등록된 리디렉션 URL이 http://localhost:8787/auth/callback 이라 포트·경로는 바꿀 수 없다.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const AUTHORIZE_URL = 'https://chzzk.naver.com/account-interlock';
const OPENAPI = 'https://openapi.chzzk.naver.com';
const SERVICE_API = 'https://api.chzzk.naver.com';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;
const HEX32 = /^[0-9a-f]{32}$/;

function fail(msg) {
  console.error(`실패: ${msg}`);
  process.exit(1);
}

function readDevVars() {
  const path = join(dirname(fileURLToPath(import.meta.url)), '..', '.dev.vars');
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    fail('worker/.dev.vars를 읽지 못했다(1Password Environment 마운트와 1Password 앱 잠금 해제를 확인)');
  }
  const vars = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) vars[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
  for (const k of ['CHZZK_CLIENT_ID', 'CHZZK_CLIENT_SECRET']) {
    if (!vars[k]) fail(`.dev.vars에 ${k}가 없다`);
  }
  return vars;
}

// core url.rs parse_content_url과 같은 규칙의 작은 판별(검사용이라 호스트만 엄격히 본다).
function parseContent(raw) {
  let u;
  try {
    u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!['chzzk.naver.com', 'm.chzzk.naver.com'].includes(u.hostname)) return null;
  const segs = u.pathname.split('/').filter(Boolean);
  if (segs[0] === 'video' && /^\d+$/.test(segs[1] ?? '')) return { kind: 'VOD', path: `/service/v2/videos/${segs[1]}` };
  const clip = segs[0] === 'clips' ? segs[1] : segs[0] === 'embed' && segs[1] === 'clip' ? segs[2] : null;
  if (clip && /^[A-Za-z0-9]+$/.test(clip)) return { kind: '클립', path: `/service/v1/play-info/clip/${clip}` };
  return null;
}

async function fetchJson(url, init, what) {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new Error(`${what}: 연결 실패`);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // 본문은 쓰지 않는다
  }
  if (!res.ok) throw new Error(`${what}: HTTP ${res.status}${body?.code ? ` (code ${body.code})` : ''}`);
  return body;
}

const unwrap = (json) => json?.content ?? json;

async function serviceChannelId(target) {
  const body = await fetchJson(
    `${SERVICE_API}${target.path}`,
    {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        Referer: 'https://chzzk.naver.com/',
        Origin: 'https://chzzk.naver.com',
        Accept: 'application/json, */*',
      },
    },
    `${target.kind} 정보`,
  );
  const c = body?.content;
  const ch = target.kind === 'VOD' ? c?.channel : c?.ownerChannel;
  return typeof ch?.channelId === 'string' ? ch.channelId : null;
}

function sameText(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

async function main() {
  const targets = process.argv.slice(2).map((raw) => {
    const t = parseContent(raw);
    if (!t) fail('인자는 치지직 VOD(https://chzzk.naver.com/video/<번호>) 또는 클립(https://chzzk.naver.com/clips/<id>) 주소여야 한다');
    return t;
  });
  if (targets.length === 0) fail('본인 VOD 주소와 본인 클립 주소를 인자로 준다');
  const vars = readDevVars();

  // 서비스 API 쪽을 먼저 받아 둔다(로그인 뒤 기다리지 않게). 값은 메모리에만 둔다.
  const service = [];
  for (const t of targets) {
    try {
      service.push({ kind: t.kind, id: await serviceChannelId(t) });
    } catch (e) {
      fail(e.message);
    }
  }

  const state = randomBytes(16).toString('hex');
  const servers = [];
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('로그인 대기 시간(10분)이 지났다')), LOGIN_TIMEOUT_MS);
    const handler = async (req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname === '/auth/login') {
        const to = new URL(AUTHORIZE_URL);
        to.searchParams.set('clientId', vars.CHZZK_CLIENT_ID);
        to.searchParams.set('redirectUri', REDIRECT_URI);
        to.searchParams.set('state', state);
        res.writeHead(302, { Location: to.toString(), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (u.pathname !== '/auth/callback') {
        res.writeHead(404).end();
        return;
      }
      const page = (msg) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(`<!doctype html><meta charset="utf-8"><title>channelId 확인</title><p>${msg}</p>`);
      };
      const gotState = u.searchParams.get('state') ?? '';
      const code = u.searchParams.get('code');
      if (!sameText(gotState, state)) {
        page('state가 맞지 않습니다. 터미널을 확인하세요.');
        return; // 다른 탭의 잘못된 요청일 수 있으니 계속 기다린다
      }
      if (!code) {
        page('로그인이 취소됐습니다.');
        clearTimeout(timer);
        reject(new Error('로그인이 취소됐다(code 없음)'));
        return;
      }
      page('확인을 마쳤습니다. 터미널로 돌아가세요. 이 창은 닫아도 됩니다.');
      clearTimeout(timer);
      resolve(code);
    };
    for (const host of ['127.0.0.1', '::1']) {
      const srv = createServer((req, res) => {
        handler(req, res).catch(() => res.writeHead(500).end());
      });
      srv.on('error', (e) => {
        if (host === '127.0.0.1') reject(new Error(`포트 ${PORT}을 열지 못했다(${e.code}). wrangler dev가 떠 있으면 끈다`));
      });
      srv.listen(PORT, host);
      servers.push(srv);
    }
  });

  console.log(`브라우저에서 http://localhost:${PORT}/auth/login 을 열어 치지직으로 로그인하세요(10분 대기).`);
  let code;
  try {
    code = await done;
  } catch (e) {
    fail(e.message);
  } finally {
    for (const srv of servers) srv.close();
  }

  let me;
  let accessToken;
  try {
    const tok = unwrap(
      await fetchJson(
        `${OPENAPI}/auth/v1/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grantType: 'authorization_code',
            clientId: vars.CHZZK_CLIENT_ID,
            clientSecret: vars.CHZZK_CLIENT_SECRET,
            code,
            state,
          }),
        },
        '토큰 교환',
      ),
    );
    accessToken = tok?.accessToken;
    if (!accessToken) throw new Error('토큰 교환: 응답에 accessToken이 없다');
    me = unwrap(
      await fetchJson(
        `${OPENAPI}/open/v1/users/me`,
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } },
        'users/me',
      ),
    );
  } catch (e) {
    fail(e.message);
  }

  const oauthId = typeof me?.channelId === 'string' ? me.channelId : null;
  console.log('');
  console.log(`users/me channelId: ${oauthId === null ? '없음' : HEX32.test(oauthId) ? '32자리 소문자 hex' : '형식이 다르다'}`);
  for (const s of service) {
    const fmt = s.id === null ? '없음' : HEX32.test(s.id) ? '32자리 소문자 hex' : '형식이 다르다';
    const verdict =
      oauthId === null || s.id === null
        ? '비교 불가'
        : sameText(oauthId, s.id)
          ? '같다'
          : sameText(oauthId.toLowerCase(), s.id.toLowerCase())
            ? '대소문자만 다르다'
            : '다르다';
    console.log(`${s.kind} 채널 ID 형식: ${fmt} → users/me와 ${verdict}`);
  }

  // 이 확인에만 쓴 토큰을 정리한다(같은 앱·사용자의 모든 토큰이 지워진다, chzzk-oauth.md §4).
  try {
    await fetchJson(
      `${OPENAPI}/auth/v1/token/revoke`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: vars.CHZZK_CLIENT_ID,
          clientSecret: vars.CHZZK_CLIENT_SECRET,
          token: accessToken,
          tokenTypeHint: 'access_token',
        }),
      },
      '토큰 폐기',
    );
    console.log('토큰 폐기: 완료');
  } catch (e) {
    console.log(`토큰 폐기: ${e.message} (하루 뒤 만료된다)`);
  }
}

main().catch(() => fail('예상하지 못한 오류(세부는 출력하지 않는다)'));
