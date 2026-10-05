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

const CLIPPY = ['--all-targets', '--locked', '--', '-D', 'warnings'];

// 이 OS의 번들 종류(release/expected-artifacts.json). gate 표를 읽는 OS에서 정해진다.
const OS_KEY = process.platform === 'win32' ? 'windows' : process.platform;
// 표가 없는 사본(selftest의 최소 저장소 등)에서도 gate 표는 읽혀야 하므로 없으면 'none'이다(bundle.mjs collect가 실패한다).
function osBundles(root = ROOT) {
  const p = join(root, 'release/expected-artifacts.json');
  const spec = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8'))[OS_KEY] : null;
  return spec ? spec.bundles.join(',') : 'none';
}
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
    desc: 'chzzk-core·chzzk-shell clippy + test',
    needs: ['cargo'],
    steps: [
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-core', '-p', 'chzzk-shell', ...CLIPPY] },
      { cmd: ['cargo', 'test', '-p', 'chzzk-core', '-p', 'chzzk-shell', '--locked'] },
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
  tauri: {
    desc: 'chzzk-app clippy + test(보통·--features e2e) + debug 빌드(번들 없음, e2e 없음)',
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-app', ...CLIPPY] },
      // e2e feature 코드(Windows 전용 #[cfg] 블록 포함)도 3 OS의 모든 코드 PR에서 컴파일·lint·테스트한다(리뷰 G4: 보통
      // 빌드는 이 코드를 컴파일하지 않아 네이티브 E2E 작업에서만 깨짐이 드러났다). 테스트 수는 test-count-app이 센다.
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-app', '--features', 'e2e', ...CLIPPY] },
      { cmd: ['cargo', 'test', '-p', 'chzzk-app', '--locked'] },
      { cmd: ['cargo', 'test', '-p', 'chzzk-app', '--locked', '--features', 'e2e', '--lib', '--', 'e2e::'] },
      // 마지막: smoke-bin은 e2e가 없는 이 debug 빌드를 띄운다
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
      // e2e feature 코드의 lint·단위 테스트는 tauri gate(3 OS, 코드 PR)가 한다
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
    desc: 'debug 빌드를 --smoke로 띄워 60초 안 exit 0 + 마커 JSON(Linux는 xvfb-run). tauri gate 뒤',
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
  'ratchet-log': {
    desc: 'ci/ratchet.json 모양(0은 $pending만) + 기준을 느슨하게 했으면 ci/RATCHET_LOG.md에 그 키를 적은 줄이 더해졌는지(env RATCHET_BASE)',
    steps: [{ cmd: ['node', S('ratchet.mjs'), 'lint'] }, { cmd: ['node', S('ratchet.mjs'), 'log-check'] }],
  },
};

// run.mjs가 gate 말고도 받는 하위 명령
export const COMMANDS = ['changes', 'ci-ok', 'doctor', 'drift-log-check', 'hook', 'install-hooks', 'install-rustup', 'install-tool', 'list', 'report', 'report-loop'];

// 훅(docs/design/cicd.md §3.2). .githooks/<이름>은 `run.mjs hook <이름> "$@"`만 exec한다(parity hook-entry).
//   always: 항상 도는 gate(순서대로). when: 바뀐 경로(pre-commit은 staged, pre-push는 push 범위 커밋이 건드린 경로)가
//   paths 중 하나에 맞을 때만 도는 gate. fastSkip: CHZZK_HOOK_FAST=1이면 when을 건너뛴다(always는 끌 수 없다).
// parity가 보는 훅·워크플로·진입점 표(빠르다)
const HOOK_FILES = [/^\.githooks\//, /^\.gitattributes$/, /^\.github\//, /^scripts\/ci\/(?:gates\.mjs|tools\.json)$/];
const VERSION_FILES = [/(^|\/)Cargo\.toml$/, /^app\/package\.json$/, /^app\/src-tauri\/tauri\.conf\.json$/];
export const HOOKS = {
  'pre-commit': {
    always: ['scan-staged'],
    when: [
      { gate: 'fmt', paths: [/\.rs$/] },
      { gate: 'typos', paths: [/./] },
      { gate: 'workflows', paths: [/^\.github\//, /^zizmor\.yml$/] },
      { gate: 'versions', paths: VERSION_FILES },
      { gate: 'fixtures', paths: [/^testdata\//, /^scripts\/fixtures\//] },
      { gate: 'parity', paths: HOOK_FILES },
    ],
  },
  'commit-msg': { always: ['scan-msg'], when: [] },
  'pre-push': {
    always: ['push-guard', 'scan-range'],
    fastSkip: true,
    when: [
      { gate: 'rust', paths: [/^crates\//, /^testdata\//, /^Cargo\.(toml|lock)$/, /^rust-toolchain\.toml$/] },
      { gate: 'frontend', paths: [/^app\/(?!src-tauri\/)/] },
      { gate: 'scripts-test', paths: [/^scripts\//, /^\.githooks\//, /^\.gitattributes$/] },
      { gate: 'deny', paths: [/^Cargo\.lock$/, /^deny\.toml$/, /(^|\/)Cargo\.toml$/] },
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
export const CODE_GATED_JOBS = ['supply', 'rust', 'frontend', 'tauri', 'coverage'];

// pull_request에서는 돌지 않는 작업(ci.yml 작업 id, `if: github.event_name != 'pull_request'`). push(master)·dispatch에서
// 돈다. ci-ok는 pull_request에서만 이 작업들의 skipped를 허용한다(docs/design/cicd.md §2 "bundle (3 OS; push master만)").
export const MASTER_ONLY_JOBS = ['bundle', 'bundle-linux', 'smoke-install-linux'];

// D14 관찰 중인 작업(docs/design/cicd.md §1 D14, 구현 중 변경 36). 결정적이라고 설계했어도 러너 환경 요인은 실측으로만
// 드러나므로 2주 동안 ci-ok에 넣지 않고 지켜본다. 값은 작업 if 종류('code' = CODE_IF, 'master' = MASTER_IF)다.
//   - ci-ok의 needs·guard·decideCiOk에 없다(빨개져도 머지를 막지 않는다).
//   - report의 needs에 있다: master에서 실패하면 ci-ok가 녹색이어도 master-failure 이슈를 연다(issue.mjs masterStatus).
//   - 관찰 시작은 첫 녹색 실행, 편입 예정일은 그 14일 뒤다(ROADMAP Phase 4). 편입은 여기서 빼고 CODE_GATED_JOBS·
//     MASTER_ONLY_JOBS로 옮긴 뒤 ci.yml ci-ok needs·guard를 고치는 한 변경이다(parity가 둘을 맞춘다).
//   - e2e-native도 'code'다(리뷰 G4): master에서만 돌면 편입한 뒤에도 PR이 네이티브 E2E를 깨고 녹색으로 머지된다.
export const OBSERVED_JOBS = { 'e2e-web': 'code', 'e2e-native': 'code' };
