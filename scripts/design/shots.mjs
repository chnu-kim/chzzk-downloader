#!/usr/bin/env node
// 시각 회귀 스냅샷 보조(docs/design/system/governance.md §2.7·§2.6b, ADR-0008). 기준선 PNG는 Linux CI 러너에서만 만든다.
// 대상 둘: app(design-shots, 갤러리·앱 화면)과 worker(design-worker, Worker 정적 HTML). 대상은 --target app|worker(기본 app).
//
//   node scripts/design/shots.mjs run [--target worker] [playwright 인자…]
//     대상 폴더(app/ 또는 worker/)에서 `playwright test -c <설정>`을 돈다(design-shots·design-worker gate). CI가 아니면
//     --update-snapshots(-u)를 거부한다: 로컬 글꼴·렌더러로 만든 기준선은 CI와 다르다.
//   node scripts/design/shots.mjs --accept <run id> [--target worker] [--repo <owner/name>]
//     그 CI 실행의 artifact(app: design-shots-actual = target/design-shots/, worker: design-worker-actual = target/design-worker/:
//     results/ + report.json)를 받아, 실패한 스냅샷마다 *-actual.png를 기준선 자리(<대상>/e2e/__shots__/<프로젝트>/<이름>.png)에
//     복사한다. 기준선이 없던 첫 실행도 같다(updateSnapshots 'missing'이 expected 첨부를 기준선 경로로 남긴다). 복사한 뒤 diff를 보고 커밋한다.
//
// 종료 코드: 0 성공, 1 받을 그림이 없음, 2 사용법·도구 오류.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/**
 * 대상별 표. artifact: CI가 올리는 이름, out: artifact 안의 경로 기준(= 업로드 경로), shots: 기준선 폴더(저장소 상대),
 * cwd: playwright를 돌리는 폴더, config: 그 폴더 기준 설정 파일
 */
export const TARGETS = {
  app: { artifact: 'design-shots-actual', out: 'target/design-shots/', shots: 'app/e2e/__shots__/', cwd: 'app', config: 'playwright.shots.config.ts' },
  worker: { artifact: 'design-worker-actual', out: 'target/design-worker/', shots: 'worker/e2e/__shots__/', cwd: 'worker', config: 'playwright.config.ts' },
};
// 옛 이름(app 대상)
export const ARTIFACT = TARGETS.app.artifact;
export const SHOTS_DIR = TARGETS.app.shots;

const posix = (p) => String(p).split('\\').join('/');

/** report.json의 모든 test 결과({ projectName, result })를 돈다 */
function* results(report) {
  const walk = function* (suite) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) for (const r of t.results ?? []) yield { projectName: t.projectName, result: r };
    }
    for (const s of suite.suites ?? []) yield* walk(s);
  };
  for (const s of report.suites ?? []) yield* walk(s);
}

/**
 * Playwright JSON 보고서 → 옮길 쌍 [{ from, to }]. from은 받은 artifact 폴더(dl) 안의 actual 그림, to는 저장소 상대 기준선 경로.
 * 짝은 같은 결과의 `<이름>-actual.png`와 `<이름>-expected.png` 첨부다(expected 경로에서 app/e2e/__shots__/ 아래만 쓴다).
 */
export function acceptPairs(report, dl, target = 'app') {
  const { shots: SHOTS, out: OUT_MARK } = TARGETS[target];
  const out = [];
  const seen = new Set();
  for (const { result } of results(report)) {
    if (result.status === 'passed') continue;
    const att = result.attachments ?? [];
    for (const a of att) {
      if (!a.path || !a.name?.endsWith('-actual.png')) continue;
      const base = a.name.slice(0, -'-actual.png'.length);
      const exp = att.find((x) => x.name === `${base}-expected.png` && x.path);
      if (!exp) continue;
      const ep = posix(exp.path);
      const at = ep.lastIndexOf(SHOTS);
      const ap = posix(a.path);
      const ao = ap.lastIndexOf(OUT_MARK);
      if (at < 0 || ao < 0) continue;
      const to = ep.slice(at);
      if (to.includes('..') || seen.has(to)) continue;
      seen.add(to);
      out.push({ from: join(dl, ap.slice(ao + OUT_MARK.length)), to });
    }
  }
  return out.sort((x, y) => (x.to < y.to ? -1 : x.to > y.to ? 1 : 0));
}

/** run 하위 명령의 인자 검사. 거부 사유 문자열 또는 null */
export function refuseUpdate(args, env = process.env) {
  const wants = args.some((a) => a === '-u' || a === '--update-snapshots' || a.startsWith('--update-snapshots='));
  if (wants && env.CI !== 'true') return '기준선은 Linux CI에서만 만든다(로컬 --update-snapshots 거부). 실패한 CI 실행을 shots.mjs --accept <run id>로 받는다';
  return null;
}

function cmdRun(args, target) {
  const why = refuseUpdate(args);
  if (why) {
    console.error(`shots: ${why}`);
    return 2;
  }
  const t = TARGETS[target];
  const r = spawnSync('pnpm', ['exec', 'playwright', 'test', '-c', t.config, ...args], {
    cwd: join(ROOT, t.cwd),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.error) {
    console.error(`shots: ${r.error.message}`);
    return 2;
  }
  return r.status ?? 2;
}

function repoFromGit() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' });
  const m = /github\.com[:/]([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec((r.stdout ?? '').trim());
  return m ? m[1] : null;
}

function cmdAccept(runId, repo, target) {
  const ARTIFACT = TARGETS[target].artifact;
  if (!/^\d+$/.test(runId ?? '')) {
    console.error('shots --accept: 실행 번호(숫자)가 필요하다');
    return 2;
  }
  const r0 = repo ?? repoFromGit();
  if (!r0) {
    console.error('shots --accept: 저장소를 모른다(--repo owner/name)');
    return 2;
  }
  const tmp = mkdtempSync(join(tmpdir(), 'shots-'));
  try {
    const d = spawnSync('gh', ['run', 'download', runId, '-R', r0, '-n', ARTIFACT, '--dir', tmp], { stdio: 'inherit' });
    if (d.status !== 0) {
      console.error(`shots --accept: gh run download 실패(실행 ${runId}에 ${ARTIFACT}가 있는지 본다)`);
      return 2;
    }
    const rp = join(tmp, 'report.json');
    if (!existsSync(rp)) {
      console.error(`shots --accept: artifact에 report.json이 없다`);
      return 2;
    }
    const pairs = acceptPairs(JSON.parse(readFileSync(rp, 'utf8')), tmp, target).filter((p) => existsSync(p.from));
    if (pairs.length === 0) {
      console.error('shots --accept: 받을 그림이 없다(그 실행에 실패한 스냅샷이 없다)');
      return 1;
    }
    for (const p of pairs) {
      const dest = join(ROOT, p.to);
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(p.from, dest);
      console.log(`기준선: ${p.to}`);
    }
    console.log(`shots --accept: ${pairs.length}장을 옮겼다. git diff로 보고 커밋한다`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** argv에서 --target <app|worker>를 뽑는다. 값이 틀리면 null, 없으면 'app' */
export function takeTarget(argv) {
  const i = argv.indexOf('--target');
  if (i === -1) return { target: 'app', rest: argv };
  const target = argv[i + 1];
  if (!Object.hasOwn(TARGETS, target ?? '')) return { target: null, rest: argv };
  return { target, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

const USAGE = '사용법: shots.mjs run [--target app|worker] [playwright 인자…] | --accept <run id> [--target app|worker] [--repo owner/name]';

export function main(argv = process.argv.slice(2)) {
  const { target, rest } = takeTarget(argv);
  if (target === null) {
    console.error(USAGE);
    return 2;
  }
  if (rest[0] === 'run') return cmdRun(rest.slice(1), target);
  const a = rest.indexOf('--accept');
  if (a !== -1) {
    const ri = rest.indexOf('--repo');
    return cmdAccept(rest[a + 1], ri !== -1 ? rest[ri + 1] : undefined, target);
  }
  console.error(USAGE);
  return 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
