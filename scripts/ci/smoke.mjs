#!/usr/bin/env node
// 앱 기동 스모크(docs/design/cicd.md §6). 실제 바이너리를 `--smoke`로 띄워 종료 코드와 마커 JSON으로 판정한다.
//
//   node scripts/ci/smoke.mjs bin [--exe <경로>]       # debug 빌드(기본 <target>/debug/chzzk-app[.exe]) — smoke-bin gate
//   node scripts/ci/smoke.mjs install [--dir <폴더>]   # 번들 설치본(기본 target/ci/bundle) — smoke-install gate
//
// 마커는 정확히 {"version": <워크스페이스 버전>, "ready": true, "auth": <bool>}여야 한다. 설치 스모크(릴리스 번들)는 auth가 true여야 한다
// (Worker 주소 규칙이 실제 산출물에서 지켜졌다는 증거, worker.md 구현 중 변경 59). 앱은 60초 안에 프런트 신호가 없으면 스스로
// exit 2로 끝나고, 여기서는 그보다 긴 바깥 시간 제한(SMOKE_KILL_MS)으로 멈춘 프로세스를 죽인다.
// Linux는 DISPLAY가 없으면 `xvfb-run -a`로 감싼다. 설치 스모크는 설치 → 실행 → 제거 → 제거 확인까지 한다:
//   linux:   deb(apt-get install ./x.deb(실패면 dpkg --configure -a 뒤 한 번 더) → /usr/bin의 실행 파일 → apt-get purge → dpkg -s 실패),
//            AppImage(풀어서 실행)
//   darwin:  dmg(hdiutil attach → .app 복사 → quarantine 제거 → Contents/MacOS/<CFBundleExecutable> → detach),
//            릴리스면 updater의 .app.tar.gz도(풀기 → quarantine 제거 → 실행)
//   windows: NSIS(setup.exe /S → 설치 폴더의 exe → uninstall.exe /S → 폴더 사라짐), 그다음 MSI(msiexec /i → exe → /x)
// 종료 코드: 모두 통과 0, 실패 1, 사용법·환경 오류 2.

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT, workspaceVersion } from './gates.mjs';

const IS_WIN = process.platform === 'win32';
export const SMOKE_KILL_MS = 120_000;
const MARKER_KEYS = ['auth', 'ready', 'version'];

// 마커 텍스트 → { ok, why }
export function checkMarker(text, version, { auth } = {}) {
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, why: `마커가 JSON이 아니다: ${JSON.stringify(String(text).slice(0, 200))}` };
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return { ok: false, why: '마커가 객체가 아니다' };
  const keys = Object.keys(v).sort();
  if (keys.join(',') !== MARKER_KEYS.join(',')) return { ok: false, why: `마커 키 ${keys.join(',')} ≠ ${MARKER_KEYS.join(',')}` };
  if (v.ready !== true) return { ok: false, why: `ready = ${JSON.stringify(v.ready)}(프런트 신호가 오지 않았다)` };
  if (v.version !== version) return { ok: false, why: `version ${JSON.stringify(v.version)} ≠ 워크스페이스 ${version}` };
  if (typeof v.auth !== 'boolean') return { ok: false, why: `auth = ${JSON.stringify(v.auth)}(불리언이 아니다)` };
  if (auth !== undefined && v.auth !== auth) return { ok: false, why: `auth = ${v.auth}(릴리스 번들은 로그인이 켜져 있어야 한다)` };
  return { ok: true, why: null };
}

// 플랫폼 이름(번들 표의 키)
export const osKey = (p = process.platform) => (p === 'win32' ? 'windows' : p);

export function targetDir(env = process.env) {
  return env.CARGO_TARGET_DIR ? resolve(env.CARGO_TARGET_DIR) : join(ROOT, 'target');
}

function which(name) {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(IS_WIN ? ';' : ':').filter(Boolean);
  const exts = IS_WIN ? ['.exe', '.cmd', ''] : [''];
  for (const d of dirs) for (const e of exts) if (existsSync(join(d, name + e))) return join(d, name + e);
  return null;
}

function log(msg) {
  console.log(`smoke: ${msg}`);
}

// 바깥 명령(설치·제거). 실패하면 예외.
// 설치기·제거기가 멈춰도 단계 시간 제한까지 끌지 않도록 명령마다 시간 제한(SH_TIMEOUT_MS)을 둔다. 최악의 합은
// installBudgetMs()이고 smoke.test.mjs가 ci.yml smoke-install 단계의 timeout-minutes보다 작은지 본다.
export const SH_TIMEOUT_MS = 240_000;
export const DIAG_TIMEOUT_MS = 30_000;
export const WAIT_GONE_MS = 60_000;
// OS별 설치 스모크의 바깥 명령(sh) 수와 앱 실행(runSmoke) 수. 함수를 고치면 같이 고친다.
export const INSTALL_STEPS = {
  // sh: dpkg-deb, dpkg -L / pkg(PKG_TIMEOUT_MS, 실패마다 진단 PKG_DIAG개): apt-get install 두 번, 그 사이 dpkg --configure -a, apt-get purge
  linux: { sh: 2, pkg: 4, smoke: 2, wait: 0 },
  // hdiutil attach, ditto, xattr, plutil, hdiutil detach + 릴리스의 .app.tar.gz: tar, xattr, plutil
  darwin: { sh: 8, smoke: 2, wait: 0 },
  windows: { sh: 4, smoke: 2, wait: 1 }, // NSIS setup, uninstall, msiexec /i, /x + waitGone
};
// 최악의 경우(모든 명령이 시간 제한까지 가고, Windows는 그때마다 진단 두 개도 시간 제한까지): ms
export function installBudgetMs(os) {
  const n = INSTALL_STEPS[os];
  const diag = os === 'windows' ? 2 * DIAG_TIMEOUT_MS : 0;
  const pkg = (n.pkg ?? 0) * (PKG_TIMEOUT_MS + PKG_DIAG.length * DIAG_TIMEOUT_MS);
  return n.sh * (SH_TIMEOUT_MS + diag) + pkg + n.smoke * (SMOKE_KILL_MS + diag) + n.wait * WAIT_GONE_MS;
}

// 시간 제한에 걸린 뒤(Windows): 남은 프로세스 목록을 남기고 그 pid의 트리를 끝까지 죽여 본다.
// spawnSync는 직계 자식만 죽인다. 자식이 이미 끝났으면 /T가 손주(NSIS 제거기 사본·msiexec)에 닿지 못할 수 있어
// 목록이 원인 추적의 근거다.
function afterTimeout(pid) {
  if (!IS_WIN) return;
  for (const [bin, args] of [
    ['tasklist', ['/v']],
    ['taskkill', ['/T', '/F', '/PID', String(pid)]],
  ]) {
    const r = spawnSync(bin, args, { encoding: 'utf8', timeout: DIAG_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 24 });
    console.error(`--- ${bin} ${args.join(' ')} → ${r.status ?? r.error?.code}\n${(r.stdout ?? '').slice(-8000)}${(r.stderr ?? '').slice(-2000)}`);
  }
}

function sh(bin, args, { ok = [0], input, quiet = false, env, timeout = SH_TIMEOUT_MS } = {}) {
  log(`$ ${basename(bin)} ${args.join(' ')}`);
  const r = spawnSync(bin, args, { encoding: 'utf8', input, env: env ?? process.env, maxBuffer: 1 << 26, timeout, killSignal: 'SIGKILL' });
  if (r.error?.code === 'ETIMEDOUT') {
    afterTimeout(r.pid);
    throw new Error(failureText(bin, args, r, timeout));
  }
  if (r.error) throw new Error(`${bin}: ${r.error.message}`);
  if (!ok.includes(r.status)) throw new Error(failureText(bin, args, r, timeout));
  if (!quiet && (r.stdout || r.stderr)) process.stdout.write(`${r.stdout ?? ''}${r.stderr ?? ''}`);
  return r.stdout ?? '';
}

// 실패·시간 초과 메시지. spawnSync는 시간 초과로 죽인 뒤에도 그때까지 받은 stdout·stderr를 돌려주므로 끝부분을 붙인다
// (예전에는 시간 초과 때 이것을 버려 로그에 명령 줄 하나만 남았다, cicd.md 구현 중 변경 113).
export function failureText(bin, args, r, timeoutMs) {
  const head =
    r.error?.code === 'ETIMEDOUT'
      ? `${bin} ${args.join(' ')}: ${timeoutMs / 1000}초 안에 끝나지 않았다`
      : `${bin} ${args.join(' ')} → exit ${r.status ?? r.signal}`;
  const tail = (label, text) => (text ? `\n--- ${label} 끝부분\n${text.slice(-4000)}` : '');
  return `${head}${tail('stdout', r.stdout)}${tail('stderr', r.stderr)}`;
}

const asRoot = () => IS_WIN || !process.getuid || process.getuid() === 0;

// ---- 패키지 명령(linux deb) ----
// 2026-10-09 deb 설치(apt-get install ./x.deb)가 두 번 240초 동안 출력 없이 멈췄다(재실행은 15초). 출력이 버려져 원인을 못 봤으므로
// (cicd.md 구현 중 변경 113) 패키지 명령은 이렇게 돈다:
//  - 출력을 그대로 흘린다(stdio inherit): 줄마다 시각이 찍혀 멈춘 단계(마지막 Get:·Unpacking·트리거)가 로그에 남는다.
//  - 시간 제한을 sudo 안쪽 `timeout -k`에 둔다. 바깥 spawnSync의 SIGKILL은 sudo만 죽이고 apt-get·dpkg는 고아로 남아 잠금을
//    쥘 수 있다. timeout은 자기 프로세스 그룹 전체(apt 다운로드 메서드·dpkg 포함)에 신호를 보낸다.
//    다만 apt 기본 pty 모드는 dpkg를 setsid로 새 세션에 띄워 그룹 신호를 못 받을 수 있어 `Dpkg::Use-Pty=0`을 준다(그때만 그룹 전체에 닿는다).
//  - `stdbuf -oL -eL`: apt 출력이 줄 단위로 흘러, 죽을 때 버퍼에 갇힌 출력이 남지 않는다(stdbuf는 LD_PRELOAD를 물려 자식에게 전한다).
//  - `env DEBIAN_FRONTEND=noninteractive`: sudo의 env_reset을 지나 부모 환경 변수가 닿는다는 보장이 없다.
//  - 잠금은 명시적으로 기다리고(DPkg::Lock::Timeout) 미러는 다시 받고 연결 대기를 줄인다(Acquire::Retries·http::Timeout).
//  - 실패하면 PKG_DIAG(apt·dpkg 프로세스, 잠금 파일 보유자)를 남긴다. 설치는 dpkg --configure -a 뒤 한 번 더 한다.
export const PKG_ATTEMPT_S = 150; // 안쪽 timeout. 녹색 실행의 설치는 11~15초
export const PKG_KILL_GRACE_S = 10; // TERM 뒤 KILL까지
export const PKG_TIMEOUT_MS = (PKG_ATTEMPT_S + PKG_KILL_GRACE_S + 10) * 1000; // 바깥 제한: 안쪽이 늘 먼저 걸린다
export const APT_OPTS = ['-o', 'DPkg::Lock::Timeout=60', '-o', 'Acquire::Retries=3', '-o', 'Acquire::http::Timeout=30', '-o', 'Dpkg::Use-Pty=0'];
const DPKG_LOCKS = ['/var/lib/dpkg/lock-frontend', '/var/lib/dpkg/lock', '/var/cache/apt/archives/lock'];
export const PKG_DIAG = [
  ['sh', ['-c', "ps -ww -eo pid,ppid,etime,stat,cmd | grep -E 'apt|dpkg|unattended|/usr/lib/apt/methods' | grep -v grep"]],
  ['fuser', ['-v', ...DPKG_LOCKS]],
];

// 패키지 명령 하나의 실제 argv. root가 아니면 sudo로 감싼다.
export function pkgArgv(bin, args, { root = asRoot() } = {}) {
  const inner = ['env', 'DEBIAN_FRONTEND=noninteractive', 'stdbuf', '-oL', '-eL', 'timeout', '-k', `${PKG_KILL_GRACE_S}s`, `${PKG_ATTEMPT_S}s`, bin, ...args];
  return root ? inner : ['sudo', ...inner];
}

// 실패한 패키지 명령 뒤의 진단. 각자 DIAG_TIMEOUT_MS로 끊고, 진단의 실패는 무시한다.
function pkgDiag() {
  for (const [bin, args] of PKG_DIAG) {
    const argv = bin === 'fuser' && !asRoot() ? ['sudo', bin, ...args] : [bin, ...args];
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', timeout: DIAG_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 24 });
    console.error(`--- 진단 ${argv.join(' ')} → ${r.status ?? r.error?.code ?? r.signal}\n${(r.stdout ?? '').slice(-8000)}${(r.stderr ?? '').slice(-2000)}`);
  }
}

// 패키지 명령 하나. 반환: { ok, why }. 실패면 진단을 남긴다.
function pkg(bin, args) {
  const argv = pkgArgv(bin, args);
  log(`$ ${argv.join(' ')}`);
  const started = Date.now();
  const r = spawnSync(argv[0], argv.slice(1), { stdio: ['ignore', 'inherit', 'inherit'], timeout: PKG_TIMEOUT_MS, killSignal: 'SIGKILL' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (!r.error && r.status === 0) return { ok: true, why: null };
  const why = r.error
    ? `${bin}: ${r.error.code === 'ETIMEDOUT' ? `바깥 제한 ${PKG_TIMEOUT_MS / 1000}초에 죽였다` : r.error.message}`
    : `${bin} → exit ${r.status ?? r.signal}${r.status === 124 || r.status === 137 ? `(안쪽 제한 ${PKG_ATTEMPT_S}초)` : ''}`;
  console.error(`smoke: ${why}, ${secs}초`);
  pkgDiag();
  return { ok: false, why };
}

// 첫 시도가 실패하면 repair 뒤 한 번 더. run·repair는 { ok, why }를 돌려준다. 반환: 마지막 결과(시도 수 포함).
// 실행 스모크 오류(Error|null)와 purge 실패 이유(string|null)를 하나로. 둘 다면 합친다.
export function combineSmokeErrors(runErr, purgeWhy) {
  const purgeMsg = purgeWhy ? `deb 제거: ${purgeWhy}` : null;
  if (runErr && purgeMsg) return new Error(`${runErr.message} / ${purgeMsg}`);
  if (runErr) return runErr;
  return purgeMsg ? new Error(purgeMsg) : null;
}

export function retryOnce(run, repair) {
  const first = run();
  if (first.ok) return { ...first, attempts: 1 };
  repair();
  const second = run();
  return second.ok ? { ...second, firstWhy: first.why, attempts: 2 } : { ok: false, why: `두 번 실패: ${first.why} / ${second.why}`, attempts: 2 };
}

// 실행 파일 하나를 --smoke로 돌린다. 반환: { ok, why }
export function runSmoke(exe, { env = {}, label = basename(exe), auth } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'chzzk-smoke-'));
  const out = join(work, 'marker.json');
  const version = workspaceVersion();
  let cmd = exe;
  let args = ['--smoke'];
  if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    const xvfb = which('xvfb-run');
    if (!xvfb) return { ok: false, why: 'DISPLAY가 없고 xvfb-run도 없다(apt-get install xvfb)', env: true };
    cmd = xvfb;
    args = ['-a', exe, '--smoke'];
  }
  log(`${label}: ${[cmd, ...args].join(' ')}`);
  const started = Date.now();
  const r = spawnSync(cmd, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    timeout: SMOKE_KILL_MS,
    killSignal: 'SIGKILL',
    env: { ...process.env, ...env, CHZZK_SMOKE_OUT: out, CHZZK_SMOKE_DIR: join(work, 'data') },
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  try {
    if (r.error && r.error.code !== 'ETIMEDOUT') return { ok: false, why: `실행 실패: ${r.error.message}` };
    if (r.status === null) {
      if (r.error?.code === 'ETIMEDOUT') afterTimeout(r.pid);
      return { ok: false, why: `${secs}초 뒤 신호 ${r.signal}로 멈췄다(바깥 제한 ${SMOKE_KILL_MS / 1000}초)` };
    }
    const text = existsSync(out) ? readFileSync(out, 'utf8') : null;
    if (text !== null) log(`${label}: 마커 ${text.trim()}`);
    if (r.status !== 0) return { ok: false, why: `exit ${r.status}(${secs}초)${r.status === 2 ? ' — 60초 안에 frontend_ready가 오지 않았다' : ''}` };
    if (text === null) return { ok: false, why: 'exit 0인데 마커 파일이 없다' };
    const m = checkMarker(text, version, { auth });
    if (!m.ok) return m;
    log(`${label}: 통과(${secs}초)`);
    return { ok: true, why: null };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- 번들 표 ----

export function bundleSpec(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'release/expected-artifacts.json'), 'utf8'));
}

// collect가 쓴 bundles.json → { release, files: { kind: 파일 경로 } }
function collected(dir) {
  const p = join(dir, 'bundles.json');
  if (!existsSync(p)) throw new Error(`${p}가 없다(bundle gate가 먼저 돌아야 한다)`);
  const b = JSON.parse(readFileSync(p, 'utf8'));
  return { release: b.release === true, files: Object.fromEntries(b.artifacts.map((a) => [a.kind, join(dir, a.file)])) };
}

const productName = (os) => {
  const base = JSON.parse(readFileSync(join(ROOT, 'app/src-tauri/tauri.conf.json'), 'utf8'));
  const over = join(ROOT, `app/src-tauri/tauri.${os}.conf.json`);
  return (existsSync(over) && JSON.parse(readFileSync(over, 'utf8')).productName) || base.productName;
};

// 정확히 하나. 아니면 예외(무엇이 있었는지 함께).
function one(list, what) {
  if (list.length !== 1) throw new Error(`${what}: ${list.length}개(${list.join(', ') || '없음'}) — 정확히 하나여야 한다`);
  return list[0];
}

function waitGone(path, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!existsSync(path)) return true;
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
  }
  return !existsSync(path);
}

// ---- linux ----

function smokeDeb(deb) {
  const name = sh('dpkg-deb', ['-f', deb, 'Package'], { quiet: true }).trim();
  const inst = retryOnce(
    () => pkg('apt-get', [...APT_OPTS, 'install', '-y', '--no-install-recommends', resolve(deb)]),
    // 끊긴 dpkg를 마저 설정한다(안 하면 다음 apt-get이 "dpkg was interrupted"로 멈춘다). 받아 둔 .deb는 캐시에 남는다
    () => pkg('dpkg', ['--configure', '-a']),
  );
  if (!inst.ok) throw new Error(`deb 설치: ${inst.why}`);
  if (inst.attempts > 1) {
    log(`deb ${name}: 두 번째 시도에서 설치됐다`);
    console.log(`::warning::deb 설치 1차 실패(재시도로 통과): ${String(inst.firstWhy ?? '').split('\n')[0]}`);
  }
  let runErr = null;
  try {
    const bins = sh('dpkg', ['-L', name], { quiet: true })
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\/usr\/bin\/[^/]+$/.test(l));
    const exe = one(bins, `deb ${name}의 /usr/bin 실행 파일`);
    const r = runSmoke(exe, { label: `deb ${basename(exe)}`, auth: true });
    if (!r.ok) throw new Error(r.why);
  } catch (e) {
    runErr = e;
  }
  const p = pkg('apt-get', [...APT_OPTS, 'purge', '-y', name]);
  const fail = combineSmokeErrors(runErr, p.ok ? null : p.why);
  if (fail) throw fail;
  const s = spawnSync('dpkg', ['-s', name], { encoding: 'utf8' });
  if (s.status === 0) throw new Error(`제거 뒤에도 dpkg -s ${name}가 0이다`);
  log(`deb ${name}: 설치·실행·제거 통과`);
}

function smokeAppImage(file) {
  const work = mkdtempSync(join(tmpdir(), 'chzzk-appimage-'));
  try {
    const copy = join(work, basename(file));
    cpSync(file, copy);
    chmodSync(copy, 0o755);
    // FUSE 없이 풀어서 실행한다(러너·컨테이너에 libfuse2가 없을 수 있다)
    const r = runSmoke(copy, { env: { APPIMAGE_EXTRACT_AND_RUN: '1' }, label: 'AppImage', auth: true });
    if (!r.ok) throw new Error(r.why);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- darwin ----

function smokeDmg(dmg) {
  const work = mkdtempSync(join(tmpdir(), 'chzzk-dmg-'));
  const mnt = join(work, 'mnt');
  mkdirSync(mnt);
  sh('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mnt, resolve(dmg)]);
  try {
    const app = one(readdirSync(mnt).filter((n) => n.endsWith('.app')), 'dmg 안의 .app');
    const dest = join(work, 'Applications');
    mkdirSync(dest);
    sh('ditto', [join(mnt, app), join(dest, app)]);
    sh('xattr', ['-dr', 'com.apple.quarantine', join(dest, app)]);
    const exeName = sh('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(dest, app, 'Contents/Info.plist')], { quiet: true }).trim();
    const exe = join(dest, app, 'Contents/MacOS', exeName);
    if (!existsSync(exe)) throw new Error(`CFBundleExecutable ${exeName}이 ${app}에 없다`);
    const r = runSmoke(exe, { label: `dmg ${app}`, auth: true });
    if (!r.ok) throw new Error(r.why);
  } finally {
    sh('hdiutil', ['detach', mnt]);
    rmSync(work, { recursive: true, force: true });
  }
  log('dmg: 설치·실행 통과');
}

// updater가 받는 .app.tar.gz(릴리스): 풀어서 그 안의 .app이 뜨는지
function smokeAppTar(tgz) {
  const work = mkdtempSync(join(tmpdir(), 'chzzk-apptar-'));
  try {
    sh('tar', ['-xzf', resolve(tgz), '-C', work]);
    const app = one(readdirSync(work).filter((n) => n.endsWith('.app')), '.app.tar.gz 안의 .app');
    sh('xattr', ['-dr', 'com.apple.quarantine', join(work, app)]);
    const exeName = sh('plutil', ['-extract', 'CFBundleExecutable', 'raw', '-o', '-', join(work, app, 'Contents/Info.plist')], { quiet: true }).trim();
    const exe = join(work, app, 'Contents/MacOS', exeName);
    if (!existsSync(exe)) throw new Error(`CFBundleExecutable ${exeName}이 ${app}에 없다`);
    const r = runSmoke(exe, { label: `app.tar.gz ${app}`, auth: true });
    if (!r.ok) throw new Error(r.why);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  log('app.tar.gz: 풀기·실행 통과');
}

// ---- windows ----

const exeIn = (dir) => one(readdirSync(dir).filter((n) => /\.exe$/i.test(n) && !/^uninstall\.exe$/i.test(n)), `${dir}의 앱 exe`);

function installedDir(candidates, what) {
  return one(candidates.filter((d) => existsSync(d)), `${what} 설치 폴더(후보 ${candidates.join(', ')})`);
}

function smokeNsis(setup) {
  const name = productName('windows');
  sh(resolve(setup), ['/S']);
  const local = process.env.LOCALAPPDATA;
  const dir = installedDir([join(local, name), join(local, 'Programs', name)], 'NSIS');
  const exe = join(dir, exeIn(dir));
  const r = runSmoke(exe, { label: `NSIS ${basename(exe)}`, auth: true });
  const uninstall = join(dir, 'uninstall.exe');
  if (!existsSync(uninstall)) throw new Error(`${uninstall}가 없다`);
  sh(uninstall, ['/S']);
  // NSIS 제거기는 자신을 임시 폴더로 복사해 다시 띄우고 곧바로 끝난다. 폴더가 사라질 때까지 기다린다
  if (!waitGone(dir, WAIT_GONE_MS)) throw new Error(`제거 뒤 ${WAIT_GONE_MS / 1000}초가 지나도 ${dir}가 남아 있다: ${readdirSync(dir).join(', ')}`);
  if (!r.ok) throw new Error(r.why);
  log('NSIS: 설치·실행·제거 통과');
}

// msiexec /l*v 로그(UTF-16LE를 푼 글) → 마지막 `Property(S): INSTALLDIR = <경로>`(끝의 \ 제거). 없으면 null
export function msiInstallDir(text) {
  let dir = null;
  for (const m of text.matchAll(/^Property\(S\): INSTALLDIR = (.+?)\s*$/gm)) dir = m[1];
  return dir ? dir.replace(/[\\/]+$/, '') : null;
}

function smokeMsi(msi) {
  const work = mkdtempSync(join(tmpdir(), 'chzzk-msi-'));
  const abs = resolve(msi);
  try {
    // 3010 = 성공, 재부팅 필요(/norestart)
    sh('msiexec', ['/i', abs, '/qn', '/norestart', '/l*v', join(work, 'install.log')], { ok: [0, 3010] });
    // 설치 폴더는 WiX 템플릿이 정한다(실측: Program Files\<productName>이 아니었다). 설치 로그의 INSTALLDIR을 읽는다
    const dir = msiInstallDir(readFileSync(join(work, 'install.log')).toString('utf16le'));
    if (!dir || !existsSync(dir)) throw new Error(`MSI 설치 로그의 INSTALLDIR(${dir ?? '없음'})이 없다`);
    log(`MSI 설치 폴더: ${dir}`);
    const exe = join(dir, exeIn(dir));
    const r = runSmoke(exe, { label: `MSI ${basename(exe)}`, auth: true });
    sh('msiexec', ['/x', abs, '/qn', '/norestart', '/l*v', join(work, 'uninstall.log')], { ok: [0, 3010] });
    if (existsSync(exe)) throw new Error(`제거 뒤에도 ${exe}가 남아 있다`);
    if (!r.ok) throw new Error(r.why);
  } catch (e) {
    for (const f of ['install.log', 'uninstall.log']) {
      const p = join(work, f);
      // msiexec 로그는 UTF-16LE다. 실패 원인 줄만 보인다
      if (existsSync(p)) {
        const t = readFileSync(p).toString('utf16le');
        const lines = t.split(/\r?\n/).filter((l) => /error|return value 3|failed/i.test(l)).slice(-30);
        console.error(`--- ${f}(오류 줄)\n${lines.join('\n')}`);
      }
    }
    throw e;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  log('MSI: 설치·실행·제거 통과');
}

export const INSTALLERS = { deb: smokeDeb, appimage: smokeAppImage, dmg: smokeDmg, apptar: smokeAppTar, nsis: smokeNsis, msi: smokeMsi };

function cmdInstall(dir) {
  const os = osKey();
  const spec = bundleSpec()[os]?.artifacts;
  if (!spec) {
    console.error(`smoke install: ${os}의 번들 표가 없다(release/expected-artifacts.json)`);
    return 2;
  }
  const { release, files } = collected(dir);
  let bad = 0;
  // release 전용 항목(.app.tar.gz)은 릴리스로 모은 폴더에만 있다
  for (const a of spec.filter((x) => release || !x.release)) {
    const f = files[a.kind];
    try {
      if (!f || !existsSync(f)) throw new Error(`${a.kind} 파일이 없다(${dir})`);
      log(`== ${a.kind}: ${basename(f)} (${statSync(f).size} bytes)`);
      INSTALLERS[a.smoke](f);
    } catch (e) {
      bad++;
      console.error(`::error::smoke install ${a.kind}: ${e.message}`);
    }
  }
  return bad ? 1 : 0;
}

function cmdBin(exe) {
  const path = exe ?? join(targetDir(), 'debug', `chzzk-app${IS_WIN ? '.exe' : ''}`);
  if (!existsSync(path)) {
    console.error(`smoke bin: ${path}가 없다(먼저 tauri-build gate의 debug 빌드)`);
    return 2;
  }
  const r = runSmoke(path, { label: 'debug 빌드' });
  if (!r.ok) {
    console.error(`::error::smoke bin: ${r.why}`);
    return r.env ? 2 : 1;
  }
  return 0;
}

export function main(argv) {
  const [mode, ...rest] = argv;
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const known = (names) => rest.every((a, i) => (i % 2 === 0 ? names.includes(a) : rest[i - 1] && names.includes(rest[i - 1])));
  if (mode === 'bin' && known(['--exe']) && rest.length % 2 === 0) return cmdBin(opt('--exe'));
  if (mode === 'install' && known(['--dir']) && rest.length % 2 === 0) return cmdInstall(resolve(opt('--dir') ?? join(ROOT, 'target/ci/bundle')));
  console.error('사용법: smoke.mjs bin [--exe <경로>] | smoke.mjs install [--dir <폴더>]');
  return 2;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
