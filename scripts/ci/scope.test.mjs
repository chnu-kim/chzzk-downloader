// node --test scripts/ci/scope.test.mjs — PR 영역 스코프(gates.mjs AREA_SKIP)의 교차 의존 오라클(cicd.md 구현 중 변경 110).
// AREA_SKIP은 "그 영역 작업이 읽지 않는 경로" 표다. 표가 거짓이면 그 영역의 PR이 필요한 검사를 건너뛴 채 녹색이 된다.
// 그래서 표 밖의 사실(훅 표, 디렉터리를 훑는 도구, import·하위 프로세스 그래프, 문자열 경로)과 표를 대조한다. 이 파일은 scripts-test만 실행한다(LINT_ONLY).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { test } from 'node:test';

import { AREA_SKIP, AREAS, CODE_GATED_JOBS, GATES, HOOKS, OBSERVED_JOBS, ROOT } from './gates.mjs';
import { parseJobs, runCommands } from './parity.mjs';
import { classify } from './run.mjs';

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).stdout.split('\0').filter(Boolean);
const trackedSet = new Set(tracked);
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const isTest = (f) => /\.test\.mjs$/.test(f);

// ---- ci.yml 작업 → 영역·gate ----
const jobs = parseJobs(read('.github/workflows/ci.yml'));
const jobArea = { ...CODE_GATED_JOBS, ...Object.fromEntries(Object.entries(OBSERVED_JOBS).filter(([, k]) => k !== 'master')) };
const ENTRY = /^node scripts\/ci\/run\.mjs ([a-z0-9-]+)(?: |$)/;
const jobGates = (id) => runCommands(jobs[id].body.join('\n')).flatMap((c) => ENTRY.exec(c.cmd)?.[1] ?? []);
// 영역 → 그 영역 작업이 실행하는 gate 집합
const areaGates = Object.fromEntries(AREAS.map((a) => [a, new Set(Object.keys(jobArea).filter((id) => jobArea[id] === a).flatMap(jobGates))]));

test('영역 작업이 ci.yml에 있고 gate를 실행한다(표가 비어 통과하지 않는다)', () => {
  for (const [id, a] of Object.entries(jobArea)) assert.ok(jobs[id], `${id}(${a})가 ci.yml에 없다`);
  for (const a of AREAS) assert.ok(areaGates[a].size > 0, a);
  assert.ok(areaGates.app.has('release-selftest') && areaGates.worker.has('worker'));
});

// 훅 표의 경로 중 영역 작업이 실제로는 읽지 않아 하한에서 빼는 것(gate → [[경로, 이유]]). 지금은 없다: deny 행의 fuzz/는
// cargo deny가 보지 않지만 같은 supply 작업의 machete가 본다(아래 WALKERS). 작업 단위로 따져 하한을 줄일 때만 적는다
const HOOK_WAIVERS = {};

// (A) 훅 표(pre-push when)를 하한으로: 훅이 그 gate를 돌리는 경로는 그 gate를 실행하는 영역 작업을 켜야 한다
test('(A) 훅 pre-push 표의 경로는 그 gate를 돌리는 영역을 켠다', () => {
  for (const row of HOOKS['pre-push'].when) {
    const waived = (HOOK_WAIVERS[row.gate] ?? []).map(([re]) => re);
    const files = tracked.filter((f) => row.paths.some((re) => re.test(f)) && !waived.some((re) => re.test(f)));
    for (const a of AREAS) {
      if (!areaGates[a].has(row.gate)) continue;
      for (const f of files) assert.equal(classify([f])[a], true, `훅 ${row.gate} 행의 ${f}가 ${a} 영역을 켜지 않는다`);
    }
  }
});

// (A') 디렉터리를 훑는 외부 도구: 루트 워크스페이스의 exclude와 상관없이 하위 디렉터리의 패키지를 모두 읽는다. import·문자열 오라클이
// 보지 못하므로 gate → 맞는 경로를 따로 적는다. cargo machete는 찾은 모든 Cargo.toml과 그 패키지의 소스(마지막 사용처를 지우면 미사용)를 본다
const WALKERS = {
  machete: (f) => /(^|\/)Cargo\.toml$/.test(f) || (f.endsWith('.rs') && cargoDirs.some((d) => f.startsWith(d))),
};
const cargoDirs = tracked.filter((f) => /(^|\/)Cargo\.toml$/.test(f)).map((f) => (f.includes('/') ? `${dirname(f)}/` : ''));

test("(A') 디렉터리를 훑는 gate(WALKERS)를 실행하는 영역은 그 도구가 읽는 모든 추적 파일에 켜진다", () => {
  for (const [g, hit] of Object.entries(WALKERS)) {
    const areas = AREAS.filter((a) => areaGates[a].has(g));
    assert.ok(areas.length > 0, `낡은 WALKERS: ${g}를 실행하는 영역 작업이 없다`);
    const files = tracked.filter(hit);
    assert.ok(files.some((f) => f.startsWith('fuzz/')), 'fuzz/ 패키지가 대상에 있어야 한다');
    for (const a of areas) for (const f of files) assert.equal(classify([f])[a], true, `${g}가 읽는 ${f}가 ${a} 영역을 켜지 않는다`);
  }
});

// ---- 정적 import 그래프 ----
const SPEC = /(?:^|[\s;}])(?:import|export)\s*(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const CODE_EXT = /\.(mjs|js|ts)$/;
function resolveSpec(from, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return null; // node:·bare·cloudflare: 는 저장소 밖
  const base = posix.normalize(posix.join(dirname(from), spec.split('?')[0]));
  for (const c of [base, `${base}.ts`, `${base}.js`, `${base}.mjs`, `${base}/index.ts`, `${base}/index.js`]) if (trackedSet.has(c)) return c;
  return null;
}
// 하위 프로세스로 띄우는 스크립트(영역 → [띄우는 파일, 띄워지는 파일, 이유]). import가 아니라 (B)·(C)가 따라가지 못하므로 닫힘의 간선으로
// 더한다. 띄우는 파일이 그 영역 닫힘에 있고 소스에 띄워지는 경로 리터럴이 있어야 한다(낡은 간선 금지). 저장소 루트 기준 .mjs 리터럴은
// 이 표나 READ_WAIVERS에 있어야 한다((F)가 새 spawn을 잡는다)
const SPAWN_ENTRIES = {
  app: [
    ['scripts/ci/release.mjs', 'scripts/ci/s3-fake.mjs', 'release-selftest가 가짜 S3를 띄운다'],
    ['scripts/ci/release.mjs', 'scripts/ci/worker-stub.mjs', 'release-selftest가 가짜 Worker를 띄운다(--check-only 시나리오)'],
  ],
  worker: [['worker/scripts/e2e-dev.mjs', 'scripts/ci/release.mjs', 'worker-e2e가 배포 뒤 검사(release.mjs worker --check-only)를 띄운다']],
};
function closure(entries, spawns = []) {
  const seen = new Set();
  const q = [...entries];
  while (q.length) {
    const f = q.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const [from, to] of spawns) if (from === f) q.push(to);
    if (!CODE_EXT.test(f)) continue;
    const text = read(f);
    for (const m of text.matchAll(SPEC)) {
      const r = resolveSpec(f, m[1] ?? m[2]);
      if (r) q.push(r);
    }
  }
  return seen;
}
const stepScripts = (g) => (GATES[g]?.steps ?? []).flatMap((s) => s.cmd.filter((t) => /^scripts\/ci\/[\w.-]+\.mjs$/.test(t)));
function entriesFor(a) {
  const e = new Set(['scripts/ci/run.mjs']);
  for (const g of areaGates[a]) for (const f of stepScripts(g)) e.add(f);
  if (a === 'worker') for (const f of tracked) if (f.startsWith('worker/') && CODE_EXT.test(f)) e.add(f);
  return [...e].filter((f) => trackedSet.has(f));
}
const closures = Object.fromEntries(AREAS.map((a) => [a, closure(entriesFor(a), SPAWN_ENTRIES[a] ?? [])]));

// (B) 영역 작업의 진입점이 닿는 모든 추적 파일은 그 영역을 켠다
test('(B) 영역 작업의 import 닫힘은 그 영역을 켠다', () => {
  for (const a of AREAS) {
    for (const f of closures[a]) assert.equal(classify([f])[a], true, `${a} 영역 작업이 닿는 ${f}가 ${a}를 켜지 않는다`);
  }
});

test('(B) 기대: app 진입점의 닫힘에 worker-config.mjs가 없고(worker-deploy로 분리), worker 쪽은 ?raw·worker-config를 닫힘에 둔다', () => {
  assert.ok(closures.app.has('scripts/ci/release.mjs'));
  assert.ok(closures.app.has('scripts/ci/worker-deploy.mjs'));
  assert.equal(closures.app.has('scripts/ci/worker-config.mjs'), false);
  for (const f of ['release/expected-artifacts.json', 'release/latest.schema.json', 'xtask/testdata/semver-vectors.json', 'scripts/ci/worker-config.mjs']) {
    assert.ok(closures.worker.has(f), f);
    assert.equal(classify([f]).worker, true, f);
  }
});

// (C) 문자열 경로 읽기: 영역의 제외 목록에 걸리는 모양의 리터럴을 비테스트 .mjs에서 찾는다
const SHAPES = {
  app: (s) => s.startsWith('worker/') || s === 'scripts/ci/worker-config.mjs',
  worker: (s) => /^(crates|app|xtask|testdata|fuzz|\.cargo)\//.test(s) || /^(Cargo\.(toml|lock)|rust-toolchain\.toml|deny\.toml)$/.test(s),
};
// 파일 → 리터럴 → 이유. 그 영역 작업이 실행하지 않는 하위 명령만 적는다. 소스에서 리터럴이 사라지면 실패한다(낡은 예외 금지)
const READ_WAIVERS = {
  'scripts/ci/gates.mjs': {
    'worker/deploy': 'worker·advisories gate의 cwd(표 정의일 뿐 app 작업은 그 gate를 실행하지 않는다)',
    'Cargo.toml': 'gates.mjs가 import할 때 msrv()로 읽는다(모든 run.mjs 호출). 깨지면 늘 도는 lint가 같은 import에서 실패하므로 worker 영역을 켤 필요가 없다',
  },
  'scripts/ci/measure.mjs': {
    'app/dist': 'measure size 모드(bundle gate 뒤)만 읽는다. worker는 tests-worker 모드만 부른다',
  },
  'scripts/ci/release.mjs': {
    'app/src-tauri': 'confPubkeys(pubkey gate·tag preflight)만 읽는다. worker 영역은 SPAWN_ENTRIES의 worker --check-only만 띄운다',
    'scripts/ci/worker-config.mjs': 'worker-bundle 하위 명령 전용(release.yml worker-bundle, app 영역 작업은 실행하지 않는다)',
  },
  'scripts/ci/version-check.mjs': {
    'Cargo.toml': 'main()의 readSources(versions gate·tag preflight)만 읽는다. worker 영역은 release.mjs worker --check-only만 띄운다',
  },
};
const STRING = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`([^`$\\\n]*)`/g;
// 경로 모양(공백 없는 글자)만 본다: 설명 문구는 경로가 아니다
const literals = (text) => [...text.matchAll(STRING)].map((m) => m[1] ?? m[2] ?? m[3]).filter((s) => /^[\w.@/-]+$/.test(s));

test('(C) 제외 목록 모양의 문자열 경로는 그 영역을 켜거나 READ_WAIVERS에 이유가 있다', () => {
  const used = new Set();
  const missing = [];
  for (const a of AREAS) {
    for (const f of closures[a]) {
      if (!f.endsWith('.mjs') || isTest(f)) continue;
      for (const lit of new Set(literals(read(f)))) {
        if (!SHAPES[a](lit)) continue;
        if (classify([lit])[a]) continue;
        if (READ_WAIVERS[f]?.[lit]) used.add(`${f}\0${lit}`);
        else missing.push(`${f}의 '${lit}'는 ${a} 영역을 켜지 않는 경로를 읽는다(AREA_SKIP을 고치거나 READ_WAIVERS에 이유를 적는다)`);
      }
    }
  }
  assert.deepEqual(missing, []);
  for (const [f, m] of Object.entries(READ_WAIVERS)) {
    for (const lit of Object.keys(m)) assert.ok(used.has(`${f}\0${lit}`), `낡은 예외: ${f}의 '${lit}'`);
  }
});

// (F) 하위 프로세스: SPAWN_ENTRIES는 살아 있고, 닫힘 안 비테스트 .mjs의 저장소 루트 기준 .mjs 리터럴은 간선이거나 닫힘 안이거나 예외다
// 파일 → 리터럴 → 이유. 닫힘에 있어도 그 영역 작업이 부르지 않는 하위 명령만 적는다(영역에 간선이 있으면 그쪽이 먼저다)
const SPAWN_WAIVERS = {
  'scripts/ci/gates.mjs': { 'scripts/fixtures/gen-fixtures.mjs': 'fixtures gate의 step(lint·훅만 실행한다, 영역 작업은 실행하지 않는다)' },
  'scripts/ci/release.mjs': {
    'scripts/ci/bundle.mjs': 'cmdBuild(release.yml build 작업 전용, release-build gate)만 띄운다',
    'scripts/ci/s3-fake.mjs': 'selftest 하위 명령만 띄운다(app 영역은 SPAWN_ENTRIES 간선, worker --check-only는 띄우지 않는다)',
    'scripts/ci/worker-stub.mjs': 'selftest 하위 명령만 띄운다(app 영역은 SPAWN_ENTRIES 간선, worker --check-only는 띄우지 않는다)',
  },
};
test('(F) 하위 프로세스로 띄우는 스크립트는 SPAWN_ENTRIES로 닫힘에 든다', () => {
  for (const a of AREAS) {
    for (const [from, to] of SPAWN_ENTRIES[a] ?? []) {
      assert.ok(closures[a].has(from), `낡은 간선: ${from}가 ${a} 닫힘에 없다`);
      assert.ok(literals(read(from)).includes(to), `낡은 간선: ${from}에 '${to}' 리터럴이 없다`);
    }
  }
  const missing = [];
  for (const a of AREAS) {
    for (const f of closures[a]) {
      if (!f.endsWith('.mjs') || isTest(f)) continue;
      for (const lit of new Set(literals(read(f)))) {
        if (!/\.mjs$/.test(lit) || !trackedSet.has(lit) || isTest(lit) || closures[a].has(lit)) continue;
        if (READ_WAIVERS[f]?.[lit] || SPAWN_WAIVERS[f]?.[lit]) continue;
        missing.push(`${a}: ${f}가 '${lit}'를 띄울 수 있다(SPAWN_ENTRIES에 간선을 더하거나 SPAWN_WAIVERS에 이유를 적는다)`);
      }
    }
  }
  assert.deepEqual(missing, []);
  for (const [f, m] of Object.entries(SPAWN_WAIVERS)) {
    for (const lit of Object.keys(m)) assert.ok(literals(read(f)).includes(lit), `낡은 예외: ${f}의 '${lit}'`);
  }
});

// (D) 테스트 파일 전제: *.test.mjs는 scripts-test만 실행하므로 LINT_ONLY에 둔다
test('(D) 비테스트 파일은 *.test.mjs를 import하지 않고, scripts-test가 아닌 gate는 테스트 파일을 실행하지 않는다', () => {
  for (const f of tracked) {
    if (!/\.(mjs|js|ts)$/.test(f) || isTest(f)) continue;
    for (const m of read(f).matchAll(SPEC)) assert.ok(!/\.test\.mjs/.test(m[1] ?? m[2]), `${f}가 ${m[1] ?? m[2]}를 import한다`);
  }
  for (const [g, def] of Object.entries(GATES)) {
    if (g === 'scripts-test') continue;
    for (const s of def.steps ?? []) assert.ok(!s.cmd.some((t) => /\.test\.mjs/.test(t)), `${g} gate가 테스트 파일을 실행한다`);
  }
});

// (E) 제외 목록의 정규식 각각이 정말 그 영역 밖인지(실패 메시지가 어느 행인지 알려 준다)
test('(E) 제외 목록의 각 정규식에 걸리는 파일이 그 영역의 닫힘에 없다', () => {
  for (const a of AREAS) {
    for (const re of AREA_SKIP[a]) {
      const hit = [...closures[a]].filter((f) => re.test(f));
      assert.deepEqual(hit, [], `${a} 제외 ${re}에 걸리는 파일을 ${a} 작업이 읽는다`);
    }
  }
});

// (G) Rust 소스의 파일 읽기: app 영역(rust·tauri·coverage)의 테스트·빌드는 .rs가 컴파일 때(include_str!·include_bytes!) 또는 실행 때
// (CARGO_MANIFEST_DIR 기준 경로, 저장소 루트 기준 fixture 경로) 읽는 파일에 의존한다. JS 닫힘(B)(C)는 .rs를 보지 않으므로 따로 푼다.
//   include_str!/include_bytes!("x") → 그 .rs 파일의 폴더 기준
//   CARGO_MANIFEST_DIR가 있는 줄과 다음 두 줄의 경로 리터럴 → 가장 가까운 Cargo.toml 폴더 기준(앞의 / 를 뗀다)
//   그 밖의 경로 리터럴(슬래시 포함) → 저장소 루트 기준(fixture("vod/…")류의 rel은 testdata/를 붙인 것도 본다)
// 풀린 경로가 추적 파일이거나 추적 파일의 폴더면 그 파일들은 app을 켜야 한다.
const RS_STRING = /"((?:[^"\\\n]|\\.)*)"/g;
const rsPaths = (line) => [...line.matchAll(RS_STRING)].map((m) => m[1]).filter((s) => /^[\w.@/-]+$/.test(s) && s.includes('/'));
const cargoDirList = cargoDirs.slice().sort((a, b) => b.length - a.length);
const crateDirOf = (f) => cargoDirList.find((d) => f.startsWith(d)) ?? '';
function trackedUnder(p) {
  const n = p.replace(/\/+$/, '');
  if (!n || n.startsWith('..')) return [];
  if (trackedSet.has(n)) return [n];
  return tracked.filter((t) => t.startsWith(`${n}/`));
}
function rustReads() {
  const out = new Map(); // 읽히는 추적 파일 → 읽는 .rs
  const add = (from, p) => {
    for (const t of trackedUnder(posix.normalize(p))) if (!out.has(t)) out.set(t, from);
  };
  for (const f of tracked) {
    if (!f.endsWith('.rs')) continue;
    const lines = read(f).split('\n');
    const dir = dirname(f);
    const crate = crateDirOf(f);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\binclude_(?:str|bytes)!\(\s*"([^"]+)"/g)) add(f, posix.join(dir, m[1]));
      if (line.includes('CARGO_MANIFEST_DIR')) {
        for (const l of lines.slice(i, i + 3)) for (const s of rsPaths(l)) add(f, posix.join(crate, s.replace(/^\/+/, '')));
      }
      for (const s of rsPaths(line)) {
        add(f, s);
        add(f, posix.join('testdata', s));
      }
    });
  }
  return out;
}

test('(G) Rust 소스가 읽는 저장소 파일은 app 영역을 켠다(include_str!·CARGO_MANIFEST_DIR·루트 기준 경로)', () => {
  const reads = rustReads();
  // 앵커: 푸는 규칙이 어긋나 아무것도 못 찾고 녹색이 되지 않게
  assert.equal(reads.get('xtask/testdata/semver-vectors.json'), 'xtask/src/semver.rs', 'include_str! 기준(파일 폴더)이 어긋났다');
  assert.ok(reads.has('testdata/vod/video_info.json'), 'CARGO_MANIFEST_DIR 기준(크레이트 폴더)이 어긋났다');
  const missing = [...reads].filter(([t]) => !classify([t]).app).map(([t, from]) => `${from}가 읽는 ${t}가 app 영역을 켜지 않는다`);
  assert.deepEqual(missing, []);
});
