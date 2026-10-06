#!/usr/bin/env node
// 치지직 code 묶임 실측(docs/design/worker.md 구현 중 변경 29·42, W9 런북 docs/runbook/w9-first-deploy.md).
//
// 치지직은 PKCE가 없어 Worker는 "치지직이 code를 발급한 state·한 번 사용에 묶는다"를 가정한다. 이 도구가 실제 로그인 한 번으로
// 받은 code 하나에 대해 다음을 차례로 본다(순서가 중요하다: code가 일회용이면 먼저 쓴 교환이 code를 써 버린다).
//   ① 새로 만든 다른 state로 토큰 교환 → 거부/수락
//   ② (①이 수락이 아니면) 원래 state로 교환 → 성공해야 ①의 거부가 state 때문이다
//   ③ (앞 교환 중 하나가 수락이면) 같은 code로 원래 state 한 번 더 → 거부/수락
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
import { judgeExchange, needSecond, needThird, reportLines, unreachable } from '../test/code-binding-lib.mjs';

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
  let status;
  let body;
  try {
    const res = await fetch(`${OPENAPI}/auth/v1/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grantType: 'authorization_code', clientId: vars.CHZZK_CLIENT_ID, clientSecret: vars.CHZZK_CLIENT_SECRET, code, state }),
      signal: AbortSignal.timeout(10_000),
    });
    status = res.status;
    body = await res.text();
  } catch (e) {
    return unreachable(e?.name === 'TimeoutError');
  }
  return judgeExchange(status, body);
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
        if (host === '127.0.0.1') reject(new Error(`포트 ${PORT}을 열지 못했다(${e.code}). wrangler dev·pnpm dev:real·channel-id-check가 떠 있으면 끈다`));
      });
      srv.listen(PORT, host);
      servers.push(srv);
    }
  });
  return done.finally(() => {
    for (const srv of servers) srv.close();
  });
}

async function main() {
  if (process.argv.length > 2) fail('인자를 받지 않는다');
  const vars = readDevVars();
  const state = newState();
  console.log(`브라우저에서 http://localhost:${PORT}/auth/login 을 열어 치지직으로 로그인하세요(10분 대기).`);
  let code;
  try {
    code = await waitForCode(vars, state);
  } catch (e) {
    fail(e.message);
  }

  // ① 다른 state(새로 만든 값, 원래 값과 다름을 확인)
  let other = newState();
  while (sameText(other, state)) other = newState();
  const first = await exchange(vars, code, other);
  // ② 원래 state(①이 수락이 아닐 때만)
  const second = needSecond(first) ? await exchange(vars, code, state) : null;
  // ③ 같은 code 재교환(앞 교환 중 하나가 수락일 때만)
  const third = needThird(first, second) ? await exchange(vars, code, state) : null;

  console.log('');
  for (const line of reportLines({ first, second, third })) console.log(line);
  console.log('');
  console.log('ROADMAP에는 ①·②·③의 거부/수락·성공/실패와 결론만 적는다(값·시각을 옮기지 않는다).');
}

main().catch(() => fail('예상하지 못한 오류(세부는 출력하지 않는다)'));
