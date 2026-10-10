#!/usr/bin/env node
// 네이티브 E2E(docs/design/cicd.md §6 "네이티브 E2E", gate `e2e-native`). `--features e2e`로 만든 실제 앱을 tauri-driver
// (Linux: WebKitWebDriver, Windows: msedgedriver)로 띄워 로그인과 받기 흐름을 끝까지 돌린다:
//   [치지직으로 로그인] → 대기 화면 → 홈(브라우저는 열지 않는다: 스텁의 303 → `E2eAuthIo`가 앱 수신기에 GET → redeem 1번)
//   → 입력줄에 본인 영상 주소 → [불러오기] → 카드의 [다운로드] → 목록 항목이 "완료"
//   → 남의 영상 주소 → 카드가 "내 채널의 영상만 받을 수 있어요"로 막히고 [다운로드]가 꺼짐
//   → WebDriver execute/async로 enqueue를 직접 불러(웹뷰의 channelId를 본인 채널로 속여) 셸이 notOwnContent로 거부함(A5).
// 앱은 CHZZK_E2E_API_BASE로 로컬 fixture 서버(e2e-fixture-server.mjs, testdata/만 서빙)에, CHZZK_E2E_WORKER_BASE로 Worker 스텁에
// 붙고, CHZZK_E2E_DIR 아래만 쓴다.
//
//   node scripts/ci/e2e-native.mjs [--exe <경로>]   # 기본 <target>/debug/chzzk-app[.exe] (gate가 먼저 빌드한다)
//
// 판정(결정적): 결과 폴더에 .mp4가 정확히 하나(남의 영상이 받히지 않았음도 증명한다), .part 없음, 그 sha256이 init‖seg0‖seg1과
// 같음, fixture 서버가 받은 요청이 모두 200이고 info·남의 영상 info·master·media·init·조각 둘을 모두 받음, Worker 스텁이 start 201·
// 확인 페이지 303·redeem 200을 각각 정확히 1번 받고 오류 응답이 없음. 화면 글자는 기다림의 신호로만 쓴다(판정은 파일이다).
// 실패하면 target/ci/e2e-native/에 스크린샷·페이지 HTML·드라이버 로그·앱 로그를 남긴다(합성 fixture라 공개해도 된다).
// macOS는 WebDriver가 없다(tauri-driver 미지원): 2로 끝난다. 종료 코드: 통과 0, 실패 1, 환경·사용법 2.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HLS_URL,
  HLS_VIDEO_NO,
  OTHER_CHANNEL_NAME,
  OTHER_URL,
  OTHER_VIDEO_NO,
  OWN_CHANNEL_ID,
  STUB_HANDLE,
  expectedOutput,
  start,
  startWorker,
} from './e2e-fixture-server.mjs';
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

// 카드의 [다운로드]. 버튼 안에 단축키 표시(aria-hidden이어도 innerText에 남는다)가 있어 버튼 글자 전체가 아니라
// 이름 span 하나로 찾는다
// 이름 글자 노드로 찾는다: 라벨 span 안에 단축키 표시도 들어 있어 span 전체 글자는 '다운로드'가 아니다
export const CARD_DOWNLOAD_XPATH = "//section[contains(@class,'card')]//button[.//text()[normalize-space(.)='다운로드']]";
// 못 누르는 버튼: primary는 disabled 대신 aria-disabled를 쓴다(components.md §2.1)
const IS_OFF = "const b = arguments[0]; return b.disabled || b.getAttribute('aria-disabled') === 'true'";

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
    clear: (sid, el) => call('POST', `session/${sid}/element/${el}/clear`, {}),
    exec: (sid, script, args = []) => call('POST', `session/${sid}/execute/sync`, { script, args }),
    // 마지막 인자가 완료 콜백이다(W3C execute/async)
    execAsync: (sid, script, args = []) => call('POST', `session/${sid}/execute/async`, { script, args }),
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
    ['other info', (p) => p === `/service/v2/videos/${OTHER_VIDEO_NO}`],
    ['master', (p) => p.endsWith('/vod_playlist.m3u8')],
    ['media', (p) => p.endsWith('/vod_chunklist.m3u8')],
    ['init', (p) => /_0_0_0\.m4s$/.test(p)],
    ['seg0', (p) => /_seg0\.m4v$/.test(p)],
    ['seg1', (p) => /_seg1\.m4v$/.test(p)],
  ];
  for (const [name, test] of need) if (!serverLog.some((l) => test(l.path))) bad.push(`fixture 서버가 ${name} 요청을 받지 않았다`);
  return bad;
}

// 판정: Worker 스텁이 받은 요청 → 문제 목록. `/update/*`는 보지 않는다(자동 확인은 실패해도 로그뿐이다)
export function judgeWorker(workerLog) {
  const bad = [];
  const n = (m, p, s) => workerLog.filter((l) => l.method === m && l.path === p && l.status === s).length;
  if (n('POST', '/auth/start', 201) !== 1) bad.push(`Worker 스텁이 POST /auth/start 201을 ${n('POST', '/auth/start', 201)}번 받았다(정확히 1번이어야 한다)`);
  const login = `/auth/login/${STUB_HANDLE}`;
  if (n('GET', login, 303) !== 1) bad.push(`Worker 스텁이 GET ${login} 303을 ${n('GET', login, 303)}번 받았다(정확히 1번이어야 한다)`);
  if (n('POST', '/auth/redeem', 200) !== 1) bad.push(`Worker 스텁이 POST /auth/redeem 200을 ${n('POST', '/auth/redeem', 200)}번 받았다(정확히 1번이어야 한다)`);
  const errs = workerLog.filter((l) => l.status >= 400 && !l.path.startsWith('/update/'));
  if (errs.length) bad.push(`Worker 스텁이 오류 응답을 했다: ${errs.map((l) => `${l.method} ${l.path} ${l.status}`).join(', ')}`);
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

// msedgedriver는 앱이 쓰는 WebView2 런타임과 같은 버전이어야 한다(Microsoft의 WebView2 자동화 안내). 러너 이미지의
// 것(EDGEWEBDRIVER, Edge 브라우저 버전)만 쓰고, 버전이 다르면 두 버전을 적고 실패한다. 다른 버전을 네트워크에서 받아
// 실행하지 않는다: 버전이 러너에 따라 바뀌어 해시를 고정할 수 없고(tools.json의 downloadVerified를 쓸 수 없다), 이 작업은
// 코드 PR에서도 돈다(리뷰 G4). 어긋남은 러너 이미지 변화라 예약 실행의 고리 이슈(ci-loop:e2e-native-windows)로 드러난다.
// (37320692512의 DevToolsActivePort 실패는 버전 차이가 아니었다: 두 버전 모두 153.0.4234.48이었고 원인은 wry의
// AdditionalBrowserArguments가 msedgedriver의 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS를 덮은 것이다. d598c82, cicd.md 47.)
export function pickWindowsDriver({ webview2, image, imageVersion }) {
  if (!image) throw new Error('러너에 msedgedriver가 없다(EDGEWEBDRIVER·PATH)');
  if (!webview2) throw new Error('WebView2 런타임 버전을 레지스트리에서 찾지 못했다');
  if (imageVersion !== webview2) {
    throw new Error(`러너 msedgedriver ${imageVersion ?? '알 수 없음'} ≠ WebView2 런타임 ${webview2}: 버전이 같은 드라이버가 필요하다(받지 않는다)`);
  }
  return image;
}
function windowsDriver() {
  const wv = webview2Version();
  const d = process.env.EDGEWEBDRIVER;
  const img = d && existsSync(join(d, 'msedgedriver.exe')) ? join(d, 'msedgedriver.exe') : which('msedgedriver');
  const have = img ? driverVersion(img) : null;
  log(`WebView2 런타임 ${wv ?? '알 수 없음'}, 러너 msedgedriver ${have ?? '없음'} (${img ?? '-'})`);
  return pickWindowsDriver({ webview2: wv, image: img, imageVersion: have });
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
  const worker = await startWorker();
  const env = {
    ...process.env,
    CHZZK_E2E_API_BASE: server.url,
    CHZZK_E2E_WORKER_BASE: worker.origin,
    CHZZK_E2E_DIR: e2eDir,
    RUST_BACKTRACE: '1',
  };
  const args = ['--port', String(DRIVER_PORT), '--native-port', String(NATIVE_PORT), '--native-driver', native];
  // Linux 러너에는 화면이 없다: tauri-driver(→ WebKitWebDriver → 앱)를 가상 X 서버 안에서 띄운다
  const [bin, argv] = process.platform === 'linux' && !process.env.DISPLAY ? ['xvfb-run', ['-a', driver, ...args]] : [driver, args];
  log(`fixture 서버 ${server.url}, Worker 스텁 ${worker.origin}, 결과 폴더 ${e2eDir}, 드라이버 ${bin} ${argv.join(' ')}`);
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
    // Windows 진단(cicd.md 구현 중 변경 44): 세션을 기다리는 동안 WebView2 프로세스 명령줄을 남긴다. msedgedriver가
    // 넘긴 --remote-debugging-port·--user-data-dir가 실제 WebView2 프로세스에 닿았는지로 가설을 가른다.
    const probe = IS_WIN
      ? setTimeout(() => {
          const r = spawnSync(
            'powershell',
            ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('msedgewebview2.exe','chzzk-app.exe','msedgedriver.exe') } | ForEach-Object { $_.Name + ' :: ' + $_.CommandLine }"],
            { encoding: 'utf8', timeout: 30_000 },
          );
          const text = `${r.stdout ?? ''}${r.stderr ?? ''}`;
          driverLog.push(`\n--- 프로세스 명령줄(세션 요청 30초 뒤) ---\n${text}\n`);
          log(`프로세스 명령줄(세션 요청 30초 뒤):\n${text.slice(0, 6000)}`);
        }, 30_000)
      : null;
    try {
      sid = await wd.newSession(exe);
    } finally {
      if (probe) clearTimeout(probe);
    }
    log(`세션 ${sid}`);

    // 로그인: 확인 코드 화면을 거쳐 홈(입력줄)으로 간다. 브라우저는 열지 않는다(E2E 입출력)
    const LOGIN = "//button[normalize-space(.)='치지직으로 로그인']";
    await wd.click(sid, await until('로그인 버튼', () => wd.find(sid, 'xpath', LOGIN), STEP_MS));
    log('로그인을 눌렀다');
    // 대기 화면은 루프백 사슬이 끝나기까지(스텁 303 → 수신기 GET → redeem)만 보일 수 있다. 드라이버 응답이 늦어 놓쳐도 입력줄이 이미 있으면 지나간다
    // (사슬을 거쳤다는 증명은 judgeWorker의 start 201·login 303·redeem 200 각 1번이 한다)
    const sawCode = await until(
      '대기 화면',
      () =>
        wd.exec(
          sid,
          "if (document.body.innerText.includes(arguments[0])) return 'code'; return document.querySelector('#url-input') ? 'home' : null",
          ['브라우저에서 로그인해 주세요'],
        ),
      STEP_MS,
    );
    log(sawCode === 'code' ? '대기 화면' : '대기 화면을 놓쳤다(이미 홈)');

    const input = await until('주소 입력줄(로그인 완료)', () => wd.find(sid, 'css selector', '#url-input'), STEP_MS);
    log('로그인 완료');
    await wd.type(sid, input, HLS_URL);
    await wd.click(sid, await wd.find(sid, 'css selector', 'form.urlbar button[type=submit]'));
    log('불러오기를 눌렀다');

    // 카드의 [다운로드]: check_output(150ms 뒤)이 끝나야 눌린다
    const DL = CARD_DOWNLOAD_XPATH;
    const btn = await until(
      '영상 카드의 다운로드 버튼',
      async () => {
        const el = await wd.find(sid, 'xpath', DL);
        const enabled = !(await wd.exec(sid, IS_OFF, [elementRef(el)]));
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

    // 남의 영상, 화면: 카드가 막히고 [다운로드]가 꺼진다
    const input2 = await until('주소 입력줄(남의 영상)', () => wd.find(sid, 'css selector', '#url-input'), STEP_MS);
    await wd.clear(sid, input2);
    await wd.type(sid, input2, OTHER_URL);
    await wd.click(sid, await wd.find(sid, 'css selector', 'form.urlbar button[type=submit]'));
    log('남의 영상을 불러왔다');
    await until(
      '남의 영상 카드의 안내',
      () =>
        wd.exec(
          sid,
          "const c = document.querySelector('section.video-card'); return !!c && c.innerText.includes(arguments[0]) && c.innerText.includes('내 채널의 영상만 받을 수 있어요')",
          [OTHER_CHANNEL_NAME],
        ),
      STEP_MS,
    );
    const dlDisabled = await wd.exec(sid, IS_OFF, [elementRef(await wd.find(sid, 'xpath', DL))]);
    if (dlDisabled !== true) throw new Error(`남의 영상 카드의 [다운로드]가 꺼져 있지 않다(${JSON.stringify(dlDisabled)})`);
    log('남의 영상 카드가 막혔다');

    // 남의 영상, 셸: 웹뷰가 channelId를 본인 채널로 속여 enqueue를 직접 불러도 셸이 거부한다
    const spoof = {
      url: OTHER_URL,
      content: { kind: 'video', videoNo: OTHER_VIDEO_NO },
      title: 'e2e',
      channelName: 'e2e',
      channelId: OWN_CHANNEL_ID,
      qualityId: 'e2e',
      qualityLabel: 'e2e',
      expectedKind: 'liveRewindHls',
      folder: null,
      fileName: 'e2e-other',
      onExisting: 'overwrite',
      restart: false,
    };
    const verdict = await wd.execAsync(
      sid,
      `const done = arguments[arguments.length - 1];
       window.__TAURI_INTERNALS__.invoke('enqueue', { req: arguments[0] })
         .then(() => done({ ok: true }), (e) => done({ ok: false, code: e && e.code ? e.code : String(e) }));`,
      [spoof],
    );
    if (verdict?.ok !== false || verdict.code !== 'notOwnContent') {
      throw new Error(`셸이 남의 영상 enqueue를 notOwnContent로 거부하지 않았다: ${JSON.stringify(verdict)}`);
    }
    log('셸이 남의 영상 enqueue를 notOwnContent로 거부했다');

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
    const bad = [...judge({ files, sha256, bytes }, server.log, expectedOutput()), ...judgeWorker(worker.log)];
    const result = {
      ok: bad.length === 0,
      os: osKey(),
      files,
      sha256,
      bytes,
      expected: expectedOutput(),
      requests: server.log,
      workerRequests: worker.log,
      problems: bad,
    };
    mkdirSync(join(ROOT, OUT_DIR), { recursive: true });
    writeFileSync(join(ROOT, OUT_DIR, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    for (const b of bad) console.error(`::error::e2e-native: ${b}`);
    if (!bad.length) log(`통과: ${mp4[0]} sha256 ${sha256} (${bytes}B), 요청 ${server.log.length}개 모두 200, Worker 스텁 요청 ${worker.log.length}개`);
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
    await worker.close();
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
