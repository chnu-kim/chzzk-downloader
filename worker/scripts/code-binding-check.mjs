#!/usr/bin/env node
// 치지직 code 묶임 실측(docs/design/worker.md 구현 중 변경 29·42, W9 런북 docs/runbook/w9-first-deploy.md).
//
// 치지직은 PKCE가 없어 Worker는 "치지직이 code를 발급한 state·한 번 사용에 묶는다"를 가정한다. 이 도구가 실제 로그인 한 번으로
// 받은 code 하나에 대해 다음을 차례로 본다(순서가 중요하다: code가 일회용이면 먼저 쓴 교환이 code를 써 버린다).
//   ① 새로 만든 다른 state로 토큰 교환 → 거부/수락
//   ② (①이 수락이 아니면) 원래 state로 교환 → 성공해야 ①의 거부가 state 때문이다
//   대조 (①·② 모두 거부면) 두 번째 로그인을 받아 그 code를 원래 state로 **먼저** 교환 → 성공이면 "state 묶임 +
//        실패한 교환이 code를 소모할 수 있음", 실패면 자격·만료 문제로 판정 불가(다시 돌리지 않는다)
//   ③ (앞 교환 중 하나가 수락이면) 수락된 교환과 같은 code·state로 한 번 더 → 거부/수락
// 5xx·408·429·연결 실패·본문 끊김은 거부로 세지 않는다(판정 불가).
// **어떤 ID·토큰·code·state도 출력하지 않고** 단계별 거부/수락·성공/실패와 HTTP 상태·치지직 오류 code만 찍는다.
// 판정 규칙은 worker/test/code-binding-lib.mjs(순수 함수, vitest가 고정한다).
//
// 쓰는 법(사람이 직접 실행, 본인 계정):
//   node worker/scripts/code-binding-check.mjs
//   → 터미널에 나온 http://localhost:8787/auth/login 을 브라우저로 열어 치지직으로 로그인한다.
//
// 자격증명은 worker/.dev.vars(로컬 테스트 앱, 1Password Environment chzzk-local-dev 마운트)의 CHZZK_CLIENT_ID·CHZZK_CLIENT_SECRET.
// 그 앱에 등록된 리디렉션이 http://localhost:8787/auth/callback 이라 포트·경로는 바꿀 수 없다(wrangler dev를 먼저 끈다).
// 받은 치지직 토큰은 쓰지 않고 버린다. revoke는 부르지 않는다: 같은 앱·사용자의 모든 토큰을 지우는데(chzzk-oauth.md §4)
// chzzk-local-dev는 여러 로컬 서비스가 함께 쓰는 앱이라 다른 서비스의 로그인까지 끊는다.

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judgeExchange, needControl, needSecond, reportLines, thirdTarget, unreachable } from '../test/code-binding-lib.mjs';

const PORT = 8787;
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`;
const AUTHORIZE_URL = 'https://chzzk.naver.com/account-interlock';
const OPENAPI = 'https://openapi.chzzk.naver.com';
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

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
    fail('worker/.dev.vars를 읽지 못했다(1Password Environment chzzk-local-dev 마운트와 1Password 앱 잠금 해제를 확인)');
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

function sameText(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const newState = () => randomBytes(16).toString('hex');

// 토큰 교환 한 번(worker/src/core/chzzk.ts tokenRequest와 같은 모양: JSON POST, state를 본문에 싣는다). 응답 본문은 판정에만 쓰고 버린다
async function exchange(vars, code, state) {
  let res;
  try {
    res = await fetch(`${OPENAPI}/auth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantType: 'authorization_code', clientId: vars.CHZZK_CLIENT_ID, clientSecret: vars.CHZZK_CLIENT_SECRET, code, state }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    return unreachable(e?.name === 'TimeoutError');
  }
  let body;
  try {
    body = await res.text();
  } catch (e) {
    // 상태를 받은 뒤 본문이 끊겼다: 거부로 세지 않는다(2xx면 토큰이 발급돼 code가 쓰였을 수 있다)
    return unreachable(e?.name === 'TimeoutError', res.status);
  }
  return judgeExchange(res.status, body);
}

// 로그인 한 번 → 콜백의 code(메모리에만)
function waitForCode(vars, state) {
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
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
        res.end(`<!doctype html><meta charset="utf-8"><title>code 묶임 확인</title><p>${msg}</p>`);
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
      page('code를 받았습니다. 터미널로 돌아가세요. 이 창은 닫아도 됩니다.');
      clearTimeout(timer);
      resolve(code);
    };
    for (const host of ['127.0.0.1', '::1']) {
      const srv = createServer((req, res) => {
        handler(req, res).catch(() => res.writeHead(500).end());
      });
      srv.on('error', (e) => {
        // IPv6이 없는 기계(::1에 EADDRNOTAVAIL)만 넘긴다. ::1의 점유(EADDRINUSE) 등은 localhost 요청이 다른 프로세스로 갈 수 있어 멈춘다
        if (host === '::1' && e.code === 'EADDRNOTAVAIL') return;
        reject(new Error(`${host === '::1' ? '[::1]' : host}:${PORT}을 열지 못했다(${e.code}). wrangler dev·pnpm dev:real·channel-id-check가 떠 있으면 끈다`));
      });
      srv.listen(PORT, host);
      servers.push(srv);
    }
  });
  // 두 번째 로그인(대조)에서 같은 포트를 다시 열므로 브라우저의 keep-alive 연결까지 닫고 닫힘을 기다린다
  // (남은 연결이 새 /auth/login을 옛 state의 처리기로 보내지 않게). 듣지 않던 서버의 close 오류는 무시한다
  return done.finally(() =>
    Promise.all(
      servers.map(
        (srv) =>
          new Promise((resolve) => {
            srv.close(() => resolve());
            srv.closeAllConnections();
          }),
      ),
    ),
  );
}

// 로그인 한 번을 안내하고 code를 기다린다
function login(vars, state, what) {
  console.log(`브라우저에서 http://localhost:${PORT}/auth/login 을 열어 치지직으로 로그인하세요(${what}, 10분 대기).`);
  return waitForCode(vars, state);
}

async function main() {
  if (process.argv.length > 2) fail('인자를 받지 않는다');
  const vars = readDevVars();
  const state = newState();
  let code;
  try {
    code = await login(vars, state, '첫 로그인');
  } catch (e) {
    fail(e.message);
  }

  // ① 다른 state(새로 만든 값, 원래 값과 다름을 확인)
  let other = newState();
  while (sameText(other, state)) other = newState();
  const first = await exchange(vars, code, other);
  // ② 원래 state(①이 수락이 아닐 때만)
  const second = needSecond(first) ? await exchange(vars, code, state) : null;

  // 대조(①·② 모두 거부일 때만): 두 번째 로그인의 새 code를 그 원래 state로 먼저 교환한다.
  // 두 번째 로그인을 받지 못해도 ①·②의 결과는 찍는다("login_failed")
  let control = null;
  let code2 = null;
  let state2 = null;
  if (needControl(first, second)) {
    console.log('');
    console.log('①·② 모두 거부됐다. 대조를 위해 한 번 더 로그인한다.');
    state2 = newState();
    while (sameText(state2, state) || sameText(state2, other)) state2 = newState();
    try {
      code2 = await login(vars, state2, '대조용 두 번째 로그인');
    } catch (e) {
      console.error(`두 번째 로그인 실패: ${e.message}`);
      control = 'login_failed';
    }
    if (code2 !== null) control = await exchange(vars, code2, state2);
  }

  // ③ 수락된 교환과 같은 code·state로 한 번 더(수락된 교환이 없으면 건너뜀)
  const target = thirdTarget(first, second, control);
  let third = null;
  if (target === 'original') third = await exchange(vars, code, state);
  else if (target === 'control') third = await exchange(vars, code2, state2);

  console.log('');
  for (const line of reportLines({ first, second, control, third })) console.log(line);
  console.log('');
  console.log('ROADMAP에는 ①·②·대조·③의 거부/수락·성공/실패와 결론만 적는다(값·시각을 옮기지 않는다).');
}

main().catch(() => fail('예상하지 못한 오류(세부는 출력하지 않는다)'));
