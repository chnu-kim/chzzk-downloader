// 검증 gate 표(docs/design/cicd.md §2·§3.1). 훅과 CI는 모두 `node scripts/ci/run.mjs <gate>`로 이 표를 실행한다.
//
// 항목: { desc, steps: [{ cmd: [bin, ...args], cwd? }], needs: [도구], ciOnly?, passArgs? }
//   - cmd[0]이 'node'면 지금 돌고 있는 Node(process.execPath)로 실행한다.
//   - needs는 실행 전에 PATH에서 찾는 도구 이름이다(tools.json에 있으면 버전도 본다).
//     로컬에서 없으면 "건너뜀: CI가 검사함"으로 0, CI(CI=true)에서 없으면 2.
//   - ciOnly: CI가 아니면 건너뛴다(예: --all-history는 비공개 원격 ref가 있는 로컬 클론에서 반드시 걸린다).
//   - passArgs: run.mjs <gate> 뒤의 인자를 모든 단계 명령 끝에 붙인다.
//   - stdin: gate가 표준 입력을 읽는다(push-guard). run.mjs는 한 번 읽어 단계에 input으로 넘긴다.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const S = (f) => `scripts/ci/${f}`;

// scripts/ 아래 *.test.mjs(node_modules 제외). 순서를 고정해 로그가 결정적이다.
export function testFiles(root = ROOT, { exclude = [] } = {}) {
  const out = [];
  const walk = (rel) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      if (e.name === 'node_modules') continue;
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.test.mjs') && !exclude.includes(p)) out.push(p);
    }
  };
  walk('scripts');
  return out;
}

// Cargo.toml [workspace.package] rust-version(MSRV)
export function msrv(root = ROOT) {
  const toml = readFileSync(join(root, 'Cargo.toml'), 'utf8');
  const m = /^\[workspace\.package\][^[]*?^rust-version\s*=\s*"([^"]+)"/ms.exec(toml);
  if (!m) throw new Error('Cargo.toml [workspace.package]에 rust-version이 없다');
  return m[1];
}

// Cargo.toml [workspace.package] version(앱 버전의 Rust 쪽 원천, versions gate가 나머지와 맞춘다)
export function workspaceVersion(root = ROOT) {
  const toml = readFileSync(join(root, 'Cargo.toml'), 'utf8');
  const m = /^\[workspace\.package\][^[]*?^version\s*=\s*"([^"]+)"/ms.exec(toml);
  if (!m) throw new Error('Cargo.toml [workspace.package]에 version이 없다');
  return m[1];
}

// scripts/ci/tools.json rust-nightly(fuzz가 쓰는 고정 nightly 툴체인 이름)
export function nightly(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'scripts/ci/tools.json'), 'utf8')).tools['rust-nightly'].version;
}

const CLIPPY = ['--all-targets', '--locked', '--', '-D', 'warnings'];

// 이 OS의 번들 종류(release/expected-artifacts.json). gate 표를 읽는 OS에서 정해진다.
const OS_KEY = process.platform === 'win32' ? 'windows' : process.platform;
// 표가 없는 사본(selftest의 최소 저장소 등)에서도 gate 표는 읽혀야 하므로 없으면 'none'이다(bundle.mjs collect가 실패한다).
function osBundles(root = ROOT) {
  const p = join(root, 'release/expected-artifacts.json');
  const spec = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8'))[OS_KEY] : null;
  return spec ? spec.bundles.join(',') : 'none';
}
// wrangler가 사용 통계를 보내지 않는다(wrangler.jsonc send_metrics: false와 이중). worker gate의 wrangler·vitest 단계
const WRANGLER_ENV = { WRANGLER_SEND_METRICS: 'false' };
// linuxdeploy(AppImage)는 FUSE 없이 풀어서 돈다(컨테이너·러너에 libfuse2가 없다)
const BUNDLE_ENV = process.platform === 'linux' ? { APPIMAGE_EXTRACT_AND_RUN: '1' } : undefined;

export const GATES = {
  scan: {
    desc: '추적 중인 파일 누출 검사',
    steps: [{ cmd: ['node', S('public-scan.mjs')] }],
  },
  'scan-staged': {
    desc: '인덱스(커밋될 내용) 누출 검사 — pre-commit 훅',
    steps: [{ cmd: ['node', S('public-scan.mjs'), '--staged'] }],
  },
  'scan-history': {
    desc: '모든 ref의 이력 누출 검사(공개 저장소의 새 클론에서만)',
    ciOnly: true,
    steps: [{ cmd: ['node', S('public-scan.mjs'), '--all-history'] }],
  },
  'scan-msg': {
    desc: '커밋 메시지 누출 검사 + 제목 형식 — commit-msg 훅(인자: 메시지 파일)',
    passArgs: true,
    steps: [{ cmd: ['node', S('public-scan.mjs'), '--message-file'] }, { cmd: ['node', S('commit-msg.mjs')] }],
  },
  subjects: {
    desc: '저장된 커밋 제목 형식(HEAD에서 닿고 기준선에서 안 닿는 커밋, 첫 줄 그대로)',
    passArgs: true,
    steps: [{ cmd: ['node', S('commit-msg.mjs'), '--stored'] }],
  },
  'push-guard': {
    desc: '비공개 이력 가드 — pre-push 훅(인자: 원격 이름 URL, stdin: git pre-push 줄)',
    passArgs: true,
    stdin: true,
    steps: [{ cmd: ['node', S('push-guard.mjs')] }],
  },
  'scan-range': {
    desc: 'push 범위 이력 누출 검사 — pre-push 훅(인자: <rev> [--not-remote r] [--ref name] 또는 A..B)',
    passArgs: true,
    steps: [{ cmd: ['node', S('public-scan.mjs'), '--rev-range'] }],
  },
  fixtures: {
    desc: 'testdata/가 생성기 출력과 바이트 동일',
    steps: [{ cmd: ['node', 'scripts/fixtures/gen-fixtures.mjs', '--check'] }],
  },
  fmt: {
    desc: 'cargo fmt --check',
    needs: ['cargo'],
    steps: [{ cmd: ['cargo', 'fmt', '--all', '--check'] }],
  },
  typos: {
    desc: '오타 검사(_typos.toml)',
    needs: ['typos'],
    steps: [{ cmd: ['typos'] }],
  },
  workflows: {
    desc: 'actionlint + zizmor(오프라인, pedantic) + SHA 핀·권한·timeout 규칙',
    needs: ['actionlint', 'zizmor'],
    steps: [
      { cmd: ['node', S('pin-check.mjs')] },
      { cmd: ['actionlint'] },
      { cmd: ['zizmor', '--offline', '--pedantic', '--config', 'zizmor.yml', '.'] },
    ],
  },
  versions: {
    desc: 'Cargo 멤버·tauri.conf.json·app/package.json 버전 일치(--tag vX.Y.Z도 비교)',
    needs: ['cargo'],
    passArgs: true,
    steps: [{ cmd: ['node', S('version-check.mjs')] }],
  },
  pubkey: {
    desc: 'release/updater.pub == tauri.conf.json plugins.updater.pubkey(바이트 동일, minisign 공개 키 형식, 플랫폼 conf도 같거나 없음)',
    steps: [{ cmd: ['node', S('release.mjs'), 'pubkey'] }],
  },
  parity: {
    desc: '훅·워크플로·tools.json이 같은 진입점·버전을 쓰는지',
    steps: [{ cmd: ['node', S('parity.mjs')] }],
  },
  'scripts-test': {
    desc: 'scripts/**/*.test.mjs',
    steps: [{ cmd: ['node', '--test', ...testFiles()] }],
  },
  selftest: {
    desc: '씨앗 위반마다 gate가 0이 아닌 코드를 내는지',
    steps: [{ cmd: ['node', S('selftest.mjs')] }],
  },
  deny: {
    desc: 'cargo deny check bans licenses sources',
    needs: ['cargo', 'cargo-deny'],
    steps: [{ cmd: ['cargo', 'deny', '--locked', 'check', 'bans', 'licenses', 'sources'] }],
  },
  machete: {
    desc: '쓰지 않는 의존성',
    needs: ['cargo', 'cargo-machete'],
    steps: [{ cmd: ['cargo', 'machete'] }],
  },
  msrv: {
    desc: 'MSRV(Cargo.toml rust-version)로 워크스페이스 check',
    needs: ['cargo', 'rustup', 'cargo-hack'],
    steps: [
      { cmd: ['rustup', 'toolchain', 'install', msrv(), '--profile', 'minimal', '--no-self-update'] },
      { cmd: ['cargo', 'hack', 'check', '--rust-version', '--workspace', '--locked'] },
    ],
  },
  rust: {
    desc: 'chzzk-core·chzzk-shell·xtask(릴리스 도구) clippy + test',
    needs: ['cargo'],
    steps: [
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-core', '-p', 'chzzk-shell', '-p', 'xtask', ...CLIPPY] },
      { cmd: ['cargo', 'test', '-p', 'chzzk-core', '-p', 'chzzk-shell', '-p', 'xtask', '--locked'] },
    ],
  },
  frontend: {
    desc: 'app/ 설치·타입 검사·vitest·vite build',
    needs: ['pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['pnpm', 'check'], cwd: 'app' },
      { cmd: ['pnpm', 'test'], cwd: 'app' },
      { cmd: ['pnpm', 'build'], cwd: 'app' },
    ],
  },
  // Cloudflare Worker(docs/design/worker.md §13.2, cicd.md 구현 중 변경 83·85·86). frontend와 같은 모양(pnpm, cwd worker)이고
  // 독립 lockfile이다. worker-config(의존성 없음)가 설치보다 먼저 돈다: allowBuilds를 넓힌 변경이 설치 스크립트를 돌리기 전에
  // 멈춘다. wrangler·vitest는 worker/의 실제 비밀값 파일을 열지 않는다(--config·--env-file·environment example·타입 출력
  // 경로, worker.md 구현 중 변경 4·5·9. worker-config.mjs가 그 설정을 고정한다). CI에서는 그 자리에 LEAK_SENTINEL 씨앗을
  // 심고(--sentinel plant) pnpm check·vitest 뒤에 지우며 새지 않았는지 본다(--sentinel check, 로컬은 건너뜀).
  // 테스트 수는 measure.mjs tests-worker → ratchet tests.worker.
  worker: {
    desc: 'worker/ 불변식(worker-config)·설치·wrangler types+tsc·vitest(Workers 런타임)·(CI) 비밀값 파일 누출 씨앗·deploy --dry-run 번들과 그 모듈 목록·테스트 수 ratchet',
    needs: ['pnpm'],
    steps: [
      { cmd: ['node', S('worker-config.mjs')] },
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'worker', env: WRANGLER_ENV },
      // 배포용 wrangler(worker/deploy)의 따로인 lockfile도 PR에서 설치해 본다(릴리스 worker-bundle 작업과 같은 인자, cicd.md 구현 중 변경 96).
      // --ignore-scripts라 설치 스크립트는 돌지 않는다
      { cmd: ['pnpm', 'install', '--frozen-lockfile', '--ignore-scripts'], cwd: 'worker/deploy', env: WRANGLER_ENV },
      { cmd: ['node', S('worker-config.mjs'), '--sentinel', 'plant'] },
      { cmd: ['pnpm', 'check'], cwd: 'worker', env: WRANGLER_ENV },
      { cmd: ['node', S('measure.mjs'), 'tests-worker'], env: WRANGLER_ENV },
      { cmd: ['node', S('worker-config.mjs'), '--sentinel', 'check'] },
      { cmd: ['pnpm', 'build'], cwd: 'worker', env: WRANGLER_ENV },
      { cmd: ['node', S('worker-config.mjs'), '--dist'] },
      { cmd: ['node', S('ratchet.mjs'), 'check', 'tests'] },
    ],
  },
  // wrangler dev E2E(docs/design/worker.md §12.3, 구현 중 변경 40·41, cicd.md 구현 중 변경 100). D14 관찰(OBSERVED_JOBS).
  // 실제 HTTP: 가짜 치지직(node:http, 127.0.0.1:8788) + wrangler dev(--env-file .dev.vars.example, --persist-to 임시 폴더의 로컬 R2 씨앗).
  // CI에서는 실제 비밀값 파일 자리에 LEAK_SENTINEL 씨앗을 심는다: wrangler dev가 그 파일을 읽으면 dev 설정 검사가 모르는 키로
  // config_error를 내 /health가 503이 되고 E2E가 멈춘다. 포트 8787(등록된 개발용 콜백)·8788을 쓰므로 훅에는 넣지 않는다.
  // 프로세스 그룹 정리(kill(-pid)) 때문에 Linux·macOS 전용이다.
  'worker-e2e': {
    desc: 'wrangler dev + 가짜 치지직으로 앱·웹 로그인·회전·updater·R2·관리 POST·Origin·스로틀 키·release.mjs worker --check-only를 실제 HTTP로, Worker 로그 카나리(D14 관찰)',
    needs: ['pnpm'],
    platforms: ['linux', 'darwin'],
    steps: [
      { cmd: ['node', S('worker-config.mjs')] },
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'worker', env: WRANGLER_ENV },
      { cmd: ['node', S('worker-config.mjs'), '--sentinel', 'plant'] },
      // --sentinel check가 보는 worker-env.d.ts를 만든다
      { cmd: ['pnpm', 'check'], cwd: 'worker', env: WRANGLER_ENV },
      { cmd: ['pnpm', 'e2e'], cwd: 'worker', env: WRANGLER_ENV },
      { cmd: ['node', S('worker-config.mjs'), '--sentinel', 'check'] },
    ],
  },
  // chzzk-app은 gate 셋이다(구현 중 변경 78): clippy(check)와 test·빌드(codegen)는 산출물을 나누지 않아 한 작업에서 차례로 돌면
  // 두 번의 전체 컴파일이 직렬이 된다. CI는 tauri-clippy를 따로 작업으로 돌리고, tauri 작업은 tauri → test-count-app →
  // tauri-build → smoke-bin 순서다(tauri build가 바꾸는 환경 변수 때문에 그 뒤의 test 목록이 다시 컴파일되지 않게).
  // 세 gate를 합치면 예전 tauri gate와 같은 명령이다.
  'tauri-clippy': {
    desc: 'chzzk-app clippy(보통·--features e2e) -D warnings',
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-app', ...CLIPPY] },
      // e2e feature 코드(Windows 전용 #[cfg] 블록 포함)도 3 OS의 모든 코드 PR에서 컴파일·lint·테스트한다(리뷰 G4: 보통
      // 빌드는 이 코드를 컴파일하지 않아 네이티브 E2E 작업에서만 깨짐이 드러났다). 테스트 수는 test-count-app이 센다.
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-app', '--features', 'e2e', ...CLIPPY] },
    ],
  },
  tauri: {
    desc: 'chzzk-app test(보통·--features e2e의 e2e::). clippy는 tauri-clippy, debug 빌드는 tauri-build',
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['cargo', 'test', '-p', 'chzzk-app', '--locked'] },
      { cmd: ['cargo', 'test', '-p', 'chzzk-app', '--locked', '--features', 'e2e', '--lib', '--', 'e2e::'] },
    ],
  },
  'tauri-build': {
    desc: 'chzzk-app debug 빌드(번들 없음, e2e 없음). smoke-bin이 이 바이너리를 띄운다',
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['pnpm', 'tauri', 'build', '--ci', '--debug', '--no-bundle'], cwd: 'app' },
    ],
  },
  'e2e-web': {
    desc: 'Playwright(chromium) + vite preview(프로덕션 dist) + mockIPC 가짜 백엔드 + axe 위반 0, 통과 수 ≥ ci/ratchet.json tests.playwright',
    needs: ['pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['pnpm', 'build'], cwd: 'app' },
      // 브라우저는 @playwright/test 버전이 고른 빌드를 받는다(lockfile이 버전을 고정한다). 이미 있으면 받지 않는다
      { cmd: ['pnpm', 'exec', 'playwright', 'install', 'chromium'], cwd: 'app' },
      { cmd: ['pnpm', 'exec', 'playwright', 'test'], cwd: 'app' },
      { cmd: ['node', S('measure.mjs'), 'tests-playwright'] },
      { cmd: ['node', S('ratchet.mjs'), 'check', 'tests'] },
    ],
  },
  'e2e-native': {
    desc: 'tauri-driver + WebKitWebDriver(Linux)·msedgedriver(Windows)로 --features e2e 앱을 띄워 받기 흐름 하나(fixture 서버, 결과 sha256)',
    needs: ['cargo', 'pnpm', 'tauri-driver'],
    platforms: ['linux', 'win32'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      // e2e feature 코드의 lint·단위 테스트는 tauri-clippy·tauri gate(3 OS, 코드 PR)가 한다
      { cmd: ['pnpm', 'tauri', 'build', '--ci', '--debug', '--no-bundle', '--features', 'e2e'], cwd: 'app' },
      { cmd: ['node', S('e2e-native.mjs')] },
    ],
  },
  'hygiene-seed': {
    desc: 'release-hygiene의 씨앗: --features e2e 빌드(target/debug)에는 E2E 표식이 있고 cargo tree에 e2e가 보여야 한다. e2e-native gate 뒤',
    needs: ['cargo'],
    steps: [{ cmd: ['node', S('artifact-check.mjs'), 'hygiene-seed'] }],
  },
  'smoke-bin': {
    desc: 'debug 빌드를 --smoke로 띄워 60초 안 exit 0 + 마커 JSON(Linux는 xvfb-run). tauri-build gate 뒤',
    steps: [{ cmd: ['node', S('smoke.mjs'), 'bin'] }],
  },
  bundle: {
    desc: `릴리스 번들(--no-sign, 이 OS: ${osBundles()})을 만들고 기대 집합과 정확히 같은지 확인해 target/ci/bundle에 모은다`,
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['pnpm', 'tauri', 'build', '--ci', '--no-sign', '--bundles', osBundles()], cwd: 'app', env: BUNDLE_ENV },
      { cmd: ['node', S('bundle.mjs'), 'collect'] },
    ],
  },
  'smoke-install': {
    desc: '모은 번들을 설치 → --smoke → 제거(deb·AppImage / dmg / NSIS·MSI). bundle gate 뒤',
    steps: [{ cmd: ['node', S('smoke.mjs'), 'install'] }],
  },
  'glibc-floor': {
    desc: `릴리스 바이너리의 GLIBC_ 심볼 최댓값 ≤ 2.35(Linux, ubuntu 22.04 컨테이너 빌드)`,
    steps: [{ cmd: ['node', S('artifact-check.mjs'), 'glibc'] }],
  },
  'release-hygiene': {
    desc: '릴리스 바이너리에 E2E 표식 없음 + chzzk-app feature 트리에 e2e 없음',
    needs: ['cargo'],
    steps: [{ cmd: ['node', S('artifact-check.mjs'), 'hygiene'] }],
  },
  size: {
    desc: 'dist gzip·릴리스 바이너리·번들 크기 → ci/ratchet.json size(+3% 넘으면 실패). bundle gate 뒤',
    steps: [{ cmd: ['node', S('measure.mjs'), 'size'] }, { cmd: ['node', S('ratchet.mjs'), 'check', 'size'] }],
  },
  coverage: {
    desc: 'cargo llvm-cov(chzzk-core·chzzk-shell) + vitest v8 줄 커버리지 → ci/ratchet.json(−0.1pp 넘게 내려가면 실패)',
    needs: ['cargo', 'cargo-llvm-cov', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['node', S('measure.mjs'), 'coverage'] },
      { cmd: ['node', S('ratchet.mjs'), 'check', 'coverage'] },
    ],
  },
  'test-count': {
    desc: 'cargo test 목록 수(#[ignore] 제외) + vitest 통과 수(skip·todo 제외) ≥ ci/ratchet.json tests',
    needs: ['cargo', 'cargo-llvm-cov', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['node', S('measure.mjs'), 'tests'] },
      { cmd: ['node', S('ratchet.mjs'), 'check', 'tests'] },
    ],
  },
  'test-count-app': {
    desc: 'chzzk-app 테스트 목록 수(#[ignore] 제외) ≥ ci/ratchet.json tests.app.<os>, e2e:: 테스트(--features e2e) 수 ≥ tests.app_e2e.<os>이고 0이 아니다. tauri gate 뒤(그 테스트 빌드를 쓴다)',
    needs: ['cargo'],
    steps: [
      { cmd: ['node', S('measure.mjs'), 'tests-app'] },
      { cmd: ['node', S('ratchet.mjs'), 'check', 'tests'] },
    ],
  },
  drift: {
    desc: '실서버 drift(nightly, 환경 drift의 본인 영상 secret): 라이브 테스트 3개 + examples/dl, 출력은 메모리로만 받아 kind만 찍는다. env DRIFT_SIMULATE=<ok|kind>면 합성 출력',
    needs: ['cargo'],
    steps: [{ cmd: ['node', S('drift.mjs')] }],
  },
  advisories: {
    desc: '의존성 보안 권고(nightly): cargo deny check advisories(deny.toml) + pnpm audit --audit-level high(app/·worker/·worker/deploy). 권고 DB가 날마다 바뀌어 PR에 두지 않는다',
    needs: ['cargo', 'cargo-deny', 'pnpm'],
    steps: [
      { cmd: ['cargo', 'deny', '--locked', 'check', 'advisories'] },
      { cmd: ['pnpm', 'audit', '--audit-level', 'high'], cwd: 'app' },
      // worker/는 독립 lockfile이다(worker.md §13.2). worker/deploy(배포용 wrangler 하나)도 따로인 lockfile이다(cicd.md 구현 중 변경 96)
      { cmd: ['pnpm', 'audit', '--audit-level', 'high'], cwd: 'worker' },
      { cmd: ['pnpm', 'audit', '--audit-level', 'high'], cwd: 'worker/deploy' },
    ],
  },
  pins: {
    desc: '핀 SHA 온라인 검증(nightly, GH_TOKEN): uses: 주석의 태그가 고정 SHA를 가리키는지(pin-actions.mjs) + zizmor 온라인 audit(impostor commit·알려진 취약 action 등)',
    needs: ['zizmor', 'gh'],
    // -v: 온라인 audit이 실제로 예약됐는지("scheduling impostor-commit …")가 로그에 남는다
    steps: [{ cmd: ['node', S('pin-actions.mjs')] }, { cmd: ['zizmor', '-v', '--pedantic', '--config', 'zizmor.yml', '.'] }],
  },
  toolchain: {
    desc: 'rust-toolchain.toml channel이 최신 stable인지(weekly, static.rust-lang.org). 낮으면 실패해 ci-loop:toolchain 이슈',
    steps: [{ cmd: ['node', S('toolchain.mjs')] }],
  },
  'ruleset-drift': {
    desc: '저장소 설정·ruleset이 scripts/ci/repo-settings.json·.github/rulesets/*.json 선언과 같은지(nightly, GH_TOKEN)',
    needs: ['gh'],
    steps: [{ cmd: ['node', S('repo-settings.mjs'), '--check'] }],
  },
  'private-scan': {
    desc: '비공개 denylist(nightly, 환경 audit의 secret PRIVATE_DENYLIST, env로 받는다)로 추적 트리와 공개 이력 전체를 검사. 위치만 찍는다. secret이 없거나 해시 목록이 아니면 실패',
    ciOnly: true,
    steps: [{ cmd: ['node', S('private-scan.mjs')] }],
  },
  'fuzz-lock': {
    desc: 'fuzz/Cargo.lock이 최신(cargo metadata --locked)이고 루트 Cargo.lock과 같은 버전인지, fuzz target이 stable로 컴파일되는지(cargo check, PR lint)',
    needs: ['cargo'],
    steps: [{ cmd: ['node', S('fuzz.mjs'), '--lock-check'] }],
  },
  fuzz: {
    desc: 'cargo-fuzz 4 target(url·info·mpd·hls), 고정 nightly(tools.json rust-nightly), seed는 testdata 합성 fixture, target당 FUZZ_SECONDS(기본 300)초',
    needs: ['cargo', 'rustup', 'cargo-fuzz'],
    steps: [
      { cmd: ['rustup', 'toolchain', 'install', nightly(), '--profile', 'minimal', '--no-self-update'] },
      { cmd: ['node', S('fuzz.mjs')] },
    ],
  },
  'mutants-shard': {
    desc: 'cargo mutants -p chzzk-core의 shard 하나(env MUTANTS_SHARD=k/n, weekly) → target/ci/mutants/shard-<k>/summary.json',
    needs: ['cargo', 'cargo-mutants'],
    steps: [{ cmd: ['node', S('measure.mjs'), 'mutants-shard'] }],
  },
  mutants: {
    desc: 'shard 요약을 모아(정확히 0..n-1) 살아남은 mutant 수 → ci/ratchet.json mutants_missed(늘면 실패). mutants-shard 작업들의 artifact를 받은 뒤',
    steps: [{ cmd: ['node', S('measure.mjs'), 'mutants'] }, { cmd: ['node', S('ratchet.mjs'), 'check', 'mutants'] }],
  },
  // ---- 릴리스(docs/design/cicd.md §5, release.yml·rollback.yml). 순서·판정은 release.mjs, 무거운 일은 xtask ----
  'release-gate': {
    desc: '릴리스 gate: 태그 = 버전 파일, 단조 증가, master 조상, 그 커밋의 master ci-ok 녹색(30초 간격으로 기다림). env RELEASE_MODE·RELEASE_TAG·GITHUB_SHA·GH_TOKEN',
    needs: ['cargo', 'git'],
    steps: [{ cmd: ['node', S('release.mjs'), 'gate'] }],
  },
  'release-build': {
    desc: '릴리스 번들(임시 키, release/tauri.release.json의 updater 산출물) → collect --release → Tauri CLI·xtask 서명 형식 자체 확인',
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['node', S('release.mjs'), 'build'] },
    ],
  },
  'release-xtask': {
    desc: 'xtask 빌드 → target/ci/xtask-bin + sha256 출력(시크릿·환경 없는 작업. 시크릿 작업은 컴파일하지 않고 sha256을 맞춘 이 바이너리만 부른다)',
    needs: ['cargo'],
    steps: [{ cmd: ['node', S('release.mjs'), 'xtask'] }],
  },
  'release-stage': {
    desc: '받은 3 OS 릴리스 산출물(target/ci/release-in)로 publish → verify를 가짜 S3에(임시 키, 시크릿·환경 없음). 리허설은 여기서 끝난다(업로드 경계)',
    steps: [{ cmd: ['node', S('release.mjs'), 'stage'] }],
  },
  'release-preflight': {
    desc: '릴리스 시크릿·변수가 모두 있는지(없으면 "릴리스 시크릿 없음: <이름들>…"으로 실패). 태그 실행 sign-publish의 첫 단계',
    steps: [{ cmd: ['node', S('release.mjs'), 'preflight'] }],
  },
  'release-publish': {
    desc: 'collect → sign → verify-sig(release/updater.pub) → sums → manifest → put(If-None-Match) → promote(latest.json CAS, 마지막)',
    steps: [{ cmd: ['node', S('release.mjs'), 'publish'] }],
  },
  'release-verify': {
    desc: 'latest.json 상태로 결정표(full|superseded|not-promoted)를 고른 뒤 다시 받아 해시·서명·스키마·버전 확인. 판정 실패면 RELEASE_PREV(없으면 releases/<v>/previous)로 rollback하고 1, 기반 시설 오류는 되돌리지 않고 2',
    steps: [{ cmd: ['node', S('release.mjs'), 'verify'] }],
  },
  'release-rollback': {
    desc: 'latest.json을 ROLLBACK_VERSION으로(그 버전 객체 확인 → CAS 교체 → 다시 확인, none이면 지운다)',
    steps: [{ cmd: ['node', S('release.mjs'), 'rollback'] }],
  },
  'release-prune': {
    desc: 'R2 보존 상한: latest가 이번 버전일 때만 releases/를 latest 이하 최신 5개 + latest의 previous로 줄인다(높은 폴더는 남김)(xtask list-keys·delete-version, 지울 목록은 release.mjs prunePlan). release.yml prune 작업(verify 뒤, 태그만)',
    steps: [{ cmd: ['node', S('release.mjs'), 'prune'] }],
  },
  'release-worker-bundle': {
    desc: '시크릿 없는 작업(release.yml worker-bundle): worker 설치·dry-run 번들 → dist/wrangler.json(원본에서 main·no_bundle만) → worker-config --dist → 배포용 wrangler(worker/deploy, --ignore-scripts) → tar·sha256 → 묶음을 풀어 자격 없이 deploy --dry-run',
    needs: ['pnpm'],
    steps: [{ cmd: ['node', S('release.mjs'), 'worker-bundle'] }],
  },
  'release-worker': {
    desc: 'Worker 배포·확인(release.yml deploy-worker, 환경 release, 태그 + vars.WORKER_DEPLOY_ENABLED): superseded 가드 → 묶음 sha256·플랫폼·설정 동일성 → 묶음의 wrangler로 secret list(필수 이름) → latest.json 다시 읽기(superseded) → deploy --no-bundle → §9.4 배포 뒤 검사(health의 build 일치·updater 200/204·음성 셋)',
    steps: [{ cmd: ['node', S('release.mjs'), 'worker'] }],
  },
  'release-selftest': {
    desc: '가짜 S3(s3-fake.mjs, SigV4 검증·조건부 쓰기·장애 주입)에 합성 산출물로 release.mjs publish·verify·rollback 진입점을 하위 프로세스로: happy path, CAS·단조 증가, 변조 → previous로 rollback(latest.json 바이트 동일), 재실행 멱등, preflight·경계, 일시·계속 5xx와 응답 잃은 CAS, superseded·not-promoted, 되돌리기·다시 올리기, 보존 상한 prune(최신 5개 + previous), 배포 뒤 검사(--check-only, 가짜 Worker worker-stub.mjs: 정상·204 틀림·200 틀림·음성 틀림·늦은 반영·5xx)와 배포 모드 가드(dry)',
    needs: ['cargo'],
    steps: [{ cmd: ['node', S('release.mjs'), 'selftest'] }],
  },
  'ratchet-log': {
    desc: 'ci/ratchet.json 모양(0은 $pending만) + 기준을 느슨하게 했으면 ci/RATCHET_LOG.md에 그 키를 적은 줄이 더해졌는지(env RATCHET_BASE)',
    steps: [{ cmd: ['node', S('ratchet.mjs'), 'lint'] }, { cmd: ['node', S('ratchet.mjs'), 'log-check'] }],
  },
};

// run.mjs가 gate 말고도 받는 하위 명령
export const COMMANDS = ['changes', 'ci-ok', 'doctor', 'drift-log-check', 'hook', 'install-hooks', 'install-rustup', 'install-tool', 'list', 'report', 'report-loop', 'report-release'];

// 훅(docs/design/cicd.md §3.2). .githooks/<이름>은 `run.mjs hook <이름> "$@"`만 exec한다(parity hook-entry).
//   always: 항상 도는 gate(순서대로). when: 바뀐 경로(pre-commit은 staged, pre-push는 push 범위 커밋이 건드린 경로)가
//   paths 중 하나에 맞을 때만 도는 gate. fastSkip: CHZZK_HOOK_FAST=1이면 when을 건너뛴다(always는 끌 수 없다).
// parity가 보는 훅·워크플로·진입점 표(빠르다)
const HOOK_FILES = [/^\.githooks\//, /^\.gitattributes$/, /^\.github\//, /^scripts\/ci\/(?:gates\.mjs|tools\.json)$/];
// pubkey gate(release.mjs checkPubkey)가 읽는 파일. release.test.mjs가 checkPubkey가 읽는 경로와 맞춘다
export const PUBKEY_FILES = [/^release\/updater\.pub$/, /^release\/tauri\.release\.json$/, /^app\/src-tauri\/tauri(\.[a-z0-9-]+)?\.conf\.json$/];
// release-selftest가 기대는 파일: xtask, release/ 표, release.mjs와 그 상대 import 전부, 배포 설정 원본(worker/wrangler.jsonc, tools.json의 wrangler 버전)(release.test.mjs가 import 그래프로
// 이 목록이 빠짐없는지 확인한다, 리뷰 G6), Cargo.lock(xtask 의존성)
export const RELEASE_SELFTEST_FILES = [/^xtask\//, /^release\//, /^scripts\/ci\/(release|s3-fake|bundle|smoke|version-check|gates|run|push-guard|snapshot|public-scan|worker-config|worker-stub)\.mjs$/, /^scripts\/ci\/tools\.json$/, /^worker\/wrangler\.jsonc$/, /^Cargo\.lock$/];
const VERSION_FILES = [/(^|\/)Cargo\.toml$/, /^app\/package\.json$/, /^app\/src-tauri\/tauri\.conf\.json$/];
export const HOOKS = {
  'pre-commit': {
    always: ['scan-staged'],
    when: [
      { gate: 'fmt', paths: [/\.rs$/] },
      { gate: 'typos', paths: [/./] },
      { gate: 'workflows', paths: [/^\.github\//, /^zizmor\.yml$/] },
      { gate: 'versions', paths: VERSION_FILES },
      { gate: 'pubkey', paths: PUBKEY_FILES },
      { gate: 'fixtures', paths: [/^testdata\//, /^scripts\/fixtures\//] },
      { gate: 'parity', paths: HOOK_FILES },
    ],
  },
  'commit-msg': { always: ['scan-msg'], when: [] },
  'pre-push': {
    always: ['push-guard', 'scan-range'],
    fastSkip: true,
    when: [
      { gate: 'rust', paths: [/^crates\//, /^xtask\//, /^release\//, /^testdata\//, /^Cargo\.(toml|lock)$/, /^rust-toolchain\.toml$/, /^\.cargo\//] },
      { gate: 'release-selftest', paths: RELEASE_SELFTEST_FILES },
      { gate: 'frontend', paths: [/^app\/(?!src-tauri\/)/] },
      // pre-commit에는 넣지 않는다(무겁다). release/ 표는 W5 계약 테스트가 읽는다(worker.md §13.2). semver 벡터는 worker vitest가
      // xtask와 함께 읽는다(worker.md 구현 중 변경 14 (다), cicd.md 구현 중 변경 87)
      { gate: 'worker', paths: [/^worker\//, /^scripts\/ci\/worker-config/, /^release\/(latest\.schema|expected-artifacts)\.json$/, /^xtask\/testdata\/semver-vectors\.json$/] },
      // release.test.mjs가 worker/test/deploy-contract.mjs(배포 뒤 검사 계약 표)를 import한다
      { gate: 'scripts-test', paths: [/^scripts\//, /^\.githooks\//, /^\.gitattributes$/, /^worker\/test\/deploy-contract\.mjs$/] },
      { gate: 'deny', paths: [/^Cargo\.lock$/, /^deny\.toml$/, /(^|\/)Cargo\.toml$/] },
      // 코어 API 변경이 fuzz target을 깨뜨린다(crates/core)
      { gate: 'fuzz-lock', paths: [/^Cargo\.lock$/, /(^|\/)Cargo\.toml$/, /^fuzz\//, /^crates\/core\//] },
    ],
  },
};

// 훅에서만 도는 gate와, CI에서 같은 위험을 보는 gate들(parity: 훅 gate ⊂ ci.yml gate ∪ 이 표의 짝, 짝은 모두 ci.yml에 있어야 한다).
//   scan-staged: 인덱스 대신 CI는 체크아웃한 트리(scan)를 본다.
//   scan-msg: 누출은 공개 이력 전체의 메시지(scan-history), 제목 형식은 저장된 첫 줄(subjects).
//   scan-range: 공개 이력 전체(scan-history)가 blob·경로·메시지·작성자를 본다.
//   push-guard: 비공개에만 있는 커밋의 지문(public-denylist.txt의 commit:)을 scan-history가 공개 이력의 모든 커밋과
//   맞춘다(CI의 새 클론에는 비공개 ref가 없다). 가드 로직 자체는 scripts-test(push-guard.test.mjs)가 ubuntu·windows에서 본다.
export const HOOK_ONLY = {
  'scan-staged': ['scan'],
  'scan-msg': ['scan-history', 'subjects'],
  'scan-range': ['scan-history'],
  'push-guard': ['scan-history'],
};

// 코드가 아닌 경로(changes가 code=false로 보는 것). 정규식은 run.mjs classify가, glob은 PR 경로 필터가 있는 워크플로
// (nightly.yml pull_request paths-ignore, parity pr-paths)가 쓴다. 둘이 같은 경로를 고르는지는 run.test.mjs가 본다.
export const NON_CODE = [/^docs\//, /^[^/]+\.md$/, /^\.claude\//, /^LICENSE(\.[^/]*)?$/];
export const NON_CODE_GLOBS = ['docs/**', '*.md', '.claude/**', 'LICENSE', 'LICENSE.*'];

// changes.code == 'false'일 때 건너뛰는 작업(ci.yml 작업 id). ci-ok는 이 작업들의 skipped만 허용한다.
export const CODE_GATED_JOBS = ['supply', 'rust', 'frontend', 'worker', 'tauri-clippy', 'tauri', 'coverage', 'bundle-linux', 'smoke-install-linux'];

// pull_request에서는 돌지 않는 작업(ci.yml 작업 id, `if: github.event_name != 'pull_request'`). push(master)·dispatch에서
// 돈다. ci-ok는 pull_request에서만 이 작업들의 skipped를 허용한다. Linux 릴리스 번들·설치 스모크는 PR에서도 돈다(CODE_GATED_JOBS,
// 리뷰 G6: 릴리스 빌드를 깨는 PR이 녹색으로 머지되지 않게). macOS·Windows는 push master에서만.
export const MASTER_ONLY_JOBS = ['bundle'];

// D14 관찰 중인 작업(docs/design/cicd.md §1 D14, 구현 중 변경 36). 결정적이라고 설계했어도 러너 환경 요인은 실측으로만
// 드러나므로 2주 동안 ci-ok에 넣지 않고 지켜본다. 값은 작업 if 종류('code' = CODE_IF, 'master' = MASTER_IF)다.
//   - ci-ok의 needs·guard·decideCiOk에 없다(빨개져도 머지를 막지 않는다).
//   - report의 needs에 있다: master에서 실패하면 ci-ok가 녹색이어도 master-failure 이슈를 연다(issue.mjs masterStatus).
//   - 관찰 시작은 첫 녹색 실행, 편입 예정일은 그 14일 뒤다(ROADMAP Phase 4). 편입은 여기서 빼고 CODE_GATED_JOBS·
//     MASTER_ONLY_JOBS로 옮긴 뒤 ci.yml ci-ok needs·guard를 고치는 한 변경이다(parity가 둘을 맞춘다).
//   - e2e-native도 'code'다(리뷰 G4): master에서만 돌면 편입한 뒤에도 PR이 네이티브 E2E를 깨고 녹색으로 머지된다.
//   - e2e-native-windows(구현 중 변경 79, 사용자 결정 2026-10-06)는 Linux와 따로 관찰·편입한다(작업 id가 달라 하나씩 옮긴다).
//   - worker-e2e(cicd.md 구현 중 변경 100)는 W7 머지 뒤 첫 master 녹색 실행부터 14일 관찰한다.
export const OBSERVED_JOBS = { 'e2e-web': 'code', 'e2e-native': 'code', 'e2e-native-windows': 'code', 'worker-e2e': 'code' };
