#!/usr/bin/env node
// 네이티브 E2E(docs/design/cicd.md §6 "네이티브 E2E", gate `e2e-native`). `--features e2e`로 만든 실제 앱을 tauri-driver
// (Linux: WebKitWebDriver, Windows: msedgedriver)로 띄워 받기 흐름 하나를 끝까지 돌린다:
//   입력줄에 합성 영상 주소 → [불러오기] → 카드의 [다운로드] → 목록 항목이 "완료".
// 앱은 CHZZK_E2E_API_BASE로 로컬 fixture 서버(e2e-fixture-server.mjs, testdata/만 서빙)에 붙고, CHZZK_E2E_DIR 아래만 쓴다.
//
//   node scripts/ci/e2e-native.mjs [--exe <경로>]   # 기본 <target>/debug/chzzk-app[.exe] (gate가 먼저 빌드한다)
//
// 판정(결정적): 결과 폴더에 .mp4가 정확히 하나, .part 없음, 그 sha256이 init‖seg0‖seg1과 같음, fixture 서버가 받은 요청이
// 모두 200이고 info·master·media·init·조각 둘을 모두 받음. 화면 글자는 기다림의 신호로만 쓴다(판정은 파일이다).
// 실패하면 target/ci/e2e-native/에 스크린샷·페이지 HTML·드라이버 로그·앱 로그를 남긴다(합성 fixture라 공개해도 된다).
// macOS는 WebDriver가 없다(tauri-driver 미지원): 2로 끝난다. 종료 코드: 통과 0, 실패 1, 환경·사용법 2.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HLS_URL, HLS_VIDEO_NO, expectedOutput, start } from './e2e-fixture-server.mjs';
import { ROOT } from './gates.mjs';
import { which } from './run.mjs';
import { osKey, targetDir } from './smoke.mjs';

const IS_WIN = process.platform === 'win32';
export const DRIVER_PORT = 4444;
export const NATIVE_PORT = 4445;
export const OUT_DIR = 'target/ci/e2e-native';
const READY_MS = 60_000; // 드라이버가 뜰 때까지
const STEP_MS = 60_000; // 화면 요소 하나를 기다리는 시간
const DONE_MS = 120_000; // 다운로드가 끝날 때까지
const POLL_MS = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`e2e-native: ${m}`);

// W3C WebDriver 요소 키
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf';

// 요소 찾기 응답 → 요소 id. W3C 키가 표준이지만 옛 JSON Wire 키(ELEMENT)로 오는 드라이버도 받는다.
// 둘 다 없으면 응답을 보여 주며 실패한다(조용히 거짓이 되어 시간 초과로만 보이지 않게).
export function elementId(v) {
  const id = v?.[ELEMENT] ?? v?.ELEMENT;
  if (typeof id !== 'string' || !id) throw new Error(`요소 응답에 id가 없다: ${JSON.stringify(v).slice(0, 200)}`);
  return id;
}
// 스크립트 인자로 넘길 요소 참조(두 키 모두)
export const elementRef = (id) => ({ [ELEMENT]: id, ELEMENT: id });

// 최소 W3C WebDriver 클라이언트(fetch). WebdriverIO 대신 쓴다: 의존성 트리 없이 필요한 명령 여섯 개뿐이다.
export function client(base) {
  const call = async (method, path, body) => {
    const r = await fetch(new URL(path, base), {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`WebDriver ${method} ${path}: JSON이 아닌 응답(HTTP ${r.status}): ${text.slice(0, 300)}`);
    }
    if (!r.ok || json?.value?.error) {
      const e = new Error(`WebDriver ${method} ${path}: HTTP ${r.status} ${json?.value?.error ?? ''} ${json?.value?.message ?? ''}`.trim());
      e.wd = json?.value?.error;
      throw e;
    }
    return json.value;
  };
  return {
    call,
    async newSession(application) {
      const v = await call('POST', 'session', { capabilities: { alwaysMatch: { 'tauri:options': { application } } } });
      return v.sessionId;
    },
    find: (sid, using, value) => call('POST', `session/${sid}/element`, { using, value }).then(elementId),
    click: (sid, el) => call('POST', `session/${sid}/element/${el}/click`, {}),
    type: (sid, el, text) => call('POST', `session/${sid}/element/${el}/value`, { text }),
    exec: (sid, script, args = []) => call('POST', `session/${sid}/execute/sync`, { script, args }),
    screenshot: (sid) => call('GET', `session/${sid}/screenshot`),
    deleteSession: (sid) => call('DELETE', `session/${sid}`),
  };
}

// cond가 참 값을 낼 때까지 POLL_MS마다 다시 부른다. 시간 초과면 마지막 오류와 함께 실패.
export async function until(what, cond, ms) {
  const end = Date.now() + ms;
  let last = null;
  for (;;) {
    try {
      const v = await cond();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    if (Date.now() > end) throw new Error(`${what}: ${ms / 1000}초 안에 되지 않았다${last ? ` (마지막 오류: ${last.message})` : ''}`);
    await sleep(POLL_MS);
  }
}

// 판정: 결과 폴더와 서버 요청 기록 → 문제 목록(빈 배열이면 통과)
export function judge({ files, sha256, bytes }, serverLog, expected) {
  const bad = [];
  const mp4 = files.filter((f) => f.endsWith('.mp4'));
  const partial = files.filter((f) => /\.part$|\.part\.json$/.test(f));
  if (mp4.length !== 1) bad.push(`결과 .mp4가 ${mp4.length}개다(정확히 1개여야 한다): ${files.join(', ') || '(없음)'}`);
  if (partial.length) bad.push(`남은 중간 파일: ${partial.join(', ')}`);
  if (mp4.length === 1 && (sha256 !== expected.sha256 || bytes !== expected.bytes)) {
    bad.push(`결과 파일이 init‖seg0‖seg1과 다르다(sha256 ${sha256} ${bytes}B ≠ ${expected.sha256} ${expected.bytes}B)`);
  }
  const not200 = serverLog.filter((l) => l.status !== 200);
  if (not200.length) bad.push(`fixture 서버가 200이 아닌 응답을 했다: ${not200.map((l) => `${l.method} ${l.path} ${l.status}`).join(', ')}`);
  const need = [
    ['info', (p) => p === `/service/v2/videos/${HLS_VIDEO_NO}`],
    ['master', (p) => p.endsWith('/vod_playlist.m3u8')],
    ['media', (p) => p.endsWith('/vod_chunklist.m3u8')],
    ['init', (p) => /_0_0_0\.m4s$/.test(p)],
    ['seg0', (p) => /_seg0\.m4v$/.test(p)],
    ['seg1', (p) => /_seg1\.m4v$/.test(p)],
  ];
  for (const [name, test] of need) if (!serverLog.some((l) => test(l.path))) bad.push(`fixture 서버가 ${name} 요청을 받지 않았다`);
  return bad;
}

// WebView2 런타임 버전: EdgeUpdate Clients 아래에서 이름이 "Microsoft Edge WebView2 Runtime"인 키의 pv(Windows 레지스트리).
// 앱 GUID를 적지 않고 이름으로 찾는다. 없으면 null.
export const EDGEUPDATE_CLIENTS = [
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients',
  'HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients',
];
// `reg query <Clients> /s` 출력 → WebView2 런타임 pv
export function parseRegPv(text) {
  for (const block of (text ?? '').split(/\r?\n(?=HKEY_)/)) {
    if (!/\bname\s+REG_SZ\s+Microsoft Edge WebView2 Runtime\s*$/m.test(block)) continue;
    const v = /\bpv\s+REG_SZ\s+(\d+(?:\.\d+){3})/.exec(block)?.[1];
    if (v) return v;
  }
  return null;
}
function webview2Version() {
  for (const k of EDGEUPDATE_CLIENTS) {
    const r = spawnSync('reg', ['query', k, '/s'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const v = r.status === 0 ? parseRegPv(r.stdout) : null;
    if (v) return v;
  }
  return null;
}
const driverVersion = (exe) => /(\d+(?:\.\d+){3})/.exec(spawnSync(exe, ['--version'], { encoding: 'utf8' }).stdout ?? '')?.[1] ?? null;

// msedgedriver는 앱이 쓰는 WebView2 런타임과 같은 버전이어야 한다(다르면 세션 생성이 DevToolsActivePort 오류로 실패한다,
// 실측 37320692512). 러너 이미지의 것(EDGEWEBDRIVER, Edge 브라우저 버전)이 다르면 그 WebView2 버전의 드라이버를
// Microsoft 배포처에서 받는다. 버전이 러너에 따라 바뀌어 해시를 미리 고정할 수 없다: 그래서 이 작업은 weekly다(§6).
async function windowsDriver() {
  const wv = webview2Version();
  const d = process.env.EDGEWEBDRIVER;
  const img = d && existsSync(join(d, 'msedgedriver.exe')) ? join(d, 'msedgedriver.exe') : which('msedgedriver');
  const have = img ? driverVersion(img) : null;
  log(`WebView2 런타임 ${wv ?? '알 수 없음'}, 러너 msedgedriver ${have ?? '없음'} (${img ?? '-'})`);
  if (!wv || (img && have === wv)) return img;
  const dir = mkdtempSync(join(tmpdir(), 'msedgedriver-'));
  const zip = join(dir, 'edgedriver_win64.zip');
  const url = `https://msedgedriver.microsoft.com/${wv}/edgedriver_win64.zip`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(zip, buf);
  log(`msedgedriver ${wv} 받음: ${url} (sha256 ${createHash('sha256').update(buf).digest('hex')})`);
  const r = spawnSync('tar', ['-xf', zip, '-C', dir, 'msedgedriver.exe'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('msedgedriver 압축 풀기 실패');
  return join(dir, 'msedgedriver.exe');
}

async function nativeDriver() {
  if (process.platform === 'linux') return which('WebKitWebDriver');
  if (IS_WIN) return windowsDriver();
  return null;
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), r);
      else out.push(r);
    }
  };
  walk(dir, '');
  return out;
}

// 실패 진단을 남긴다(가능한 만큼만)
async function keepDiagnostics(wd, sid, e2eDir, driverLog) {
  const out = join(ROOT, OUT_DIR);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'driver.log'), driverLog.join(''));
  if (sid) {
    try {
      writeFileSync(join(out, 'screenshot.png'), Buffer.from(await wd.screenshot(sid), 'base64'));
    } catch (e) {
      log(`스크린샷 실패: ${e.message}`);
    }
    try {
      writeFileSync(join(out, 'page.html'), String(await wd.exec(sid, 'return document.documentElement.outerHTML')));
    } catch (e) {
      log(`페이지 HTML 실패: ${e.message}`);
    }
  }
  if (existsSync(join(e2eDir, 'logs'))) cpSync(join(e2eDir, 'logs'), join(out, 'app-logs'), { recursive: true });
  log(`진단을 ${out}에 남겼다`);
}

export async function run(exe) {
  if (!['linux', 'windows'].includes(osKey())) {
    console.error(`e2e-native: ${osKey()}에는 WebDriver가 없다(tauri-driver는 Linux·Windows만 지원)`);
    return 2;
  }
  if (!existsSync(exe)) {
    console.error(`e2e-native: ${exe}가 없다(gate가 pnpm tauri build --debug --features e2e로 먼저 만든다)`);
    return 2;
  }
  const driver = which('tauri-driver');
  let native;
  try {
    native = await nativeDriver();
  } catch (e) {
    console.error(`::error::e2e-native: 네이티브 드라이버 준비 실패: ${e.message}`);
    return 1;
  }
  if (!driver || !native) {
    console.error(`e2e-native: tauri-driver(${driver ?? '없음'})·네이티브 드라이버(${native ?? '없음'})가 필요하다(run.mjs install-tool tauri-driver, Linux는 apt webkit2gtk-driver)`);
    return 2;
  }
  rmSync(join(ROOT, OUT_DIR), { recursive: true, force: true });
  const e2eDir = mkdtempSync(join(tmpdir(), 'chzzk-e2e-'));
  const server = await start();
  const env = { ...process.env, CHZZK_E2E_API_BASE: server.url, CHZZK_E2E_DIR: e2eDir, RUST_BACKTRACE: '1' };
  const args = ['--port', String(DRIVER_PORT), '--native-port', String(NATIVE_PORT), '--native-driver', native];
  // Linux 러너에는 화면이 없다: tauri-driver(→ WebKitWebDriver → 앱)를 가상 X 서버 안에서 띄운다
  const [bin, argv] = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', ['-a', driver, ...args]] : [driver, args];
  log(`fixture 서버 ${server.url}, 결과 폴더 ${e2eDir}, 드라이버 ${bin} ${argv.join(' ')}`);
  const driverLog = [];
  const proc = spawn(bin, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', (d) => driverLog.push(d.toString()));
  proc.stderr.on('data', (d) => driverLog.push(d.toString()));
  let exited = null;
  proc.on('exit', (code, sig) => (exited = code ?? sig));

  const wd = client(`http://127.0.0.1:${DRIVER_PORT}/`);
  let sid = null;
  let ok = false;
  try {
    await until('tauri-driver 준비', async () => {
      if (exited !== null) throw new Error(`tauri-driver가 끝났다(${exited}): ${driverLog.join('').slice(-2000)}`);
      const r = await fetch(`http://127.0.0.1:${DRIVER_PORT}/status`).catch(() => null);
      return r?.ok;
    }, READY_MS);
    sid = await wd.newSession(exe);
    log(`세션 ${sid}`);

    const input = await until('주소 입력줄', () => wd.find(sid, 'css selector', '#url-input'), STEP_MS);
    await wd.type(sid, input, HLS_URL);
    await wd.click(sid, await wd.find(sid, 'css selector', 'form.urlbar button[type=submit]'));
    log('불러오기를 눌렀다');

    // 카드의 [다운로드]: check_output(150ms 뒤)이 끝나야 눌린다
    const DL = "//section[contains(@class,'card')]//button[.//span[normalize-space(.)='다운로드']]";
    const btn = await until(
      '영상 카드의 다운로드 버튼',
      async () => {
        const el = await wd.find(sid, 'xpath', DL);
        const enabled = await wd.exec(sid, 'return !arguments[0].disabled', [elementRef(el)]);
        return enabled ? el : null;
      },
      STEP_MS,
    );
    await wd.click(sid, btn);
    log('다운로드를 눌렀다');

    // 목록 항목이 완료(실패면 바로 멈춘다)
    const state = await until(
      '다운로드 완료',
      async () => {
        const s = await wd.exec(
          sid,
          "const a = document.querySelector('article[data-job-id]'); return a ? { failed: a.classList.contains('failed'), text: a.innerText } : null",
        );
        if (s?.failed) return s;
        return s && /완료/.test(s.text) ? s : null;
      },
      DONE_MS,
    );
    if (state.failed) throw new Error(`작업이 실패했다: ${state.text.replace(/\s+/g, ' ').slice(0, 400)}`);
    log(`목록 항목: ${state.text.replace(/\s+/g, ' ').slice(0, 200)}`);

    const dl = join(e2eDir, 'data', 'downloads');
    const files = listFiles(dl);
    const mp4 = files.filter((f) => f.endsWith('.mp4'));
    let sha256 = null;
    let bytes = null;
    if (mp4.length === 1) {
      const buf = readFileSync(join(dl, mp4[0]));
      sha256 = createHash('sha256').update(buf).digest('hex');
      bytes = buf.length;
    }
    const bad = judge({ files, sha256, bytes }, server.log, expectedOutput());
    const result = { ok: bad.length === 0, os: osKey(), files, sha256, bytes, expected: expectedOutput(), requests: server.log, problems: bad };
    mkdirSync(join(ROOT, OUT_DIR), { recursive: true });
    writeFileSync(join(ROOT, OUT_DIR, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    for (const b of bad) console.error(`::error::e2e-native: ${b}`);
    if (!bad.length) log(`통과: ${mp4[0]} sha256 ${sha256} (${bytes}B), 요청 ${server.log.length}개 모두 200`);
    ok = bad.length === 0;
  } catch (e) {
    console.error(`::error::e2e-native: ${e.message}`);
  } finally {
    if (!ok) await keepDiagnostics(wd, sid, e2eDir, driverLog);
    if (sid) await wd.deleteSession(sid).catch((e) => log(`세션 닫기 실패: ${e.message}`));
    if (exited === null) {
      if (IS_WIN) spawnSync('taskkill', ['/T', '/F', '/PID', String(proc.pid)], { stdio: 'ignore' });
      else proc.kill('SIGTERM');
    }
    await server.close();
    rmSync(e2eDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  return ok ? 0 : 1;
}

export async function main(argv) {
  let exe = join(targetDir(), 'debug', `chzzk-app${IS_WIN ? '.exe' : ''}`);
  if (argv.length === 2 && argv[0] === '--exe') exe = resolve(argv[1]);
  else if (argv.length) {
    console.error('사용법: e2e-native.mjs [--exe <경로>]');
    return 2;
  }
  return run(exe);
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}
