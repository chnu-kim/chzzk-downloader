// 검증 gate 표(docs/design/cicd.md §2·§3.1). 훅과 CI는 모두 `node scripts/ci/run.mjs <gate>`로 이 표를 실행한다.
//
// 항목: { desc, steps: [{ cmd: [bin, ...args], cwd? }], needs: [도구], ciOnly?, passArgs? }
//   - cmd[0]이 'node'면 지금 돌고 있는 Node(process.execPath)로 실행한다.
//   - needs는 실행 전에 PATH에서 찾는 도구 이름이다(tools.json에 있으면 버전도 본다).
//     로컬에서 없으면 "건너뜀: CI가 검사함"으로 0, CI(CI=true)에서 없으면 2.
//   - ciOnly: CI가 아니면 건너뛴다(예: --all-history는 비공개 원격 ref가 있는 로컬 클론에서 반드시 걸린다).
//   - passArgs: run.mjs <gate> 뒤의 인자를 모든 단계 명령 끝에 붙인다.
//   - stdin: gate가 표준 입력을 읽는다(push-guard). run.mjs는 한 번 읽어 단계에 input으로 넘긴다.

import { readdirSync, readFileSync } from 'node:fs';
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

const CLIPPY = ['--all-targets', '--locked', '--', '-D', 'warnings'];

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
    desc: 'chzzk-app clippy + test + debug 빌드(번들 없음)',
    needs: ['cargo', 'pnpm'],
    steps: [
      { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'app' },
      { cmd: ['cargo', 'clippy', '-p', 'chzzk-app', ...CLIPPY] },
      { cmd: ['cargo', 'test', '-p', 'chzzk-app', '--locked'] },
      { cmd: ['pnpm', 'tauri', 'build', '--ci', '--debug', '--no-bundle'], cwd: 'app' },
    ],
  },
};

// run.mjs가 gate 말고도 받는 하위 명령
export const COMMANDS = ['changes', 'ci-ok', 'doctor', 'hook', 'install-hooks', 'install-tool', 'list'];

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

// changes.code == 'false'일 때 건너뛰는 작업(ci.yml 작업 id). ci-ok는 이 작업들의 skipped만 허용한다.
export const CODE_GATED_JOBS = ['supply', 'rust', 'frontend', 'tauri'];
