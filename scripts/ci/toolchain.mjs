#!/usr/bin/env node
// 툴체인 고리(docs/design/cicd.md §4.4 "툴체인", 매주). rust-toolchain.toml의 channel이 최신 stable보다 낮으면 실패한다
// (Dependabot이 보지 않는 파일). 실패는 nightly report가 ci-loop:toolchain 이슈로 연다. 올리기는 사람이 커밋한다(CI 결과로
// 바꾸고 확인: msrv와 다른 원천이다).
//
//   node scripts/ci/toolchain.mjs            # static.rust-lang.org/dist/channel-rust-stable.toml과 비교
//   env TOOLCHAIN_STABLE_TOML=<파일>         # 테스트용: 네트워크 대신 이 파일
//
// 종료: 최신 0, 새 stable 있음 1, 입력·네트워크 오류 2.

import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

export const STABLE_URL = 'https://static.rust-lang.org/dist/channel-rust-stable.toml';

// rust-toolchain.toml → channel(정확한 x.y.z만 받는다: "stable" 같은 움직이는 이름은 재현되지 않는다)
export function pinnedChannel(text) {
  const m = /^\s*channel\s*=\s*"([^"]+)"/m.exec(text);
  if (!m) throw new Error('rust-toolchain.toml에 channel이 없다');
  if (!/^\d+\.\d+\.\d+$/.test(m[1])) throw new Error(`channel은 x.y.z로 고정한다: ${m[1]}`);
  return m[1];
}

// channel-rust-stable.toml → [pkg.rust] version의 x.y.z
export function stableVersion(toml) {
  const m = /^\[pkg\.rust\]\s*\nversion\s*=\s*"(\d+\.\d+\.\d+) /m.exec(toml);
  if (!m) throw new Error('channel-rust-stable.toml에서 [pkg.rust] version을 찾지 못했다');
  return m[1];
}

export function cmp(a, b) {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export async function main(argv, env = process.env) {
  if (argv.length) {
    console.error('사용법: toolchain.mjs');
    return 2;
  }
  let pinned;
  let latest;
  try {
    pinned = pinnedChannel(readFileSync(join(ROOT, 'rust-toolchain.toml'), 'utf8'));
    let toml;
    if (env.TOOLCHAIN_STABLE_TOML) toml = readFileSync(env.TOOLCHAIN_STABLE_TOML, 'utf8');
    else {
      const res = await fetch(STABLE_URL);
      if (!res.ok) throw new Error(`${STABLE_URL} → HTTP ${res.status}`);
      toml = await res.text();
    }
    latest = stableVersion(toml);
  } catch (e) {
    console.error(`::error::toolchain: ${e.message}`);
    return 2;
  }
  const c = cmp(pinned, latest);
  console.log(`toolchain: rust-toolchain.toml ${pinned}, 최신 stable ${latest}`);
  if (c < 0) {
    console.error(`::error::toolchain: 새 stable ${latest}이 나왔다. rust-toolchain.toml channel을 올리고 CI(rust·tauri·coverage)가 녹색인지 본다`);
    return 1;
  }
  console.log('toolchain: 최신이다');
  return 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
