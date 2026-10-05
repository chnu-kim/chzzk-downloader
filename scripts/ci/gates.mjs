// 검증 gate 표(docs/design/cicd.md §2·§3.1). 훅과 CI는 모두 `node scripts/ci/run.mjs <gate>`로 이 표를 실행한다.
//
// 항목: { desc, steps: [{ cmd: [bin, ...args], cwd? }], needs: [도구], ciOnly?, passArgs? }
//   - cmd[0]이 'node'면 지금 돌고 있는 Node(process.execPath)로 실행한다.
//   - needs는 실행 전에 PATH에서 찾는 도구 이름이다(tools.json에 있으면 버전도 본다).
//     로컬에서 없으면 "건너뜀: CI가 검사함"으로 0, CI(CI=true)에서 없으면 2.
//   - ciOnly: CI가 아니면 건너뛴다(예: --all-history는 비공개 원격 ref가 있는 로컬 클론에서 반드시 걸린다).
//   - passArgs: run.mjs <gate> 뒤의 인자를 마지막 단계 명령에 붙인다.

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
  'scan-history': {
    desc: '모든 ref의 이력 누출 검사(공개 저장소의 새 클론에서만)',
    ciOnly: true,
    steps: [{ cmd: ['node', S('public-scan.mjs'), '--all-history'] }],
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
export const COMMANDS = ['changes', 'ci-ok', 'doctor', 'install-hooks', 'install-tool', 'list'];

// changes.code == 'false'일 때 건너뛰는 작업(ci.yml 작업 id). ci-ok는 이 작업들의 skipped만 허용한다.
export const CODE_GATED_JOBS = ['supply', 'rust', 'frontend', 'tauri'];
