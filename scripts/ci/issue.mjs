#!/usr/bin/env node
// 닫힌 고리의 자동 이슈(docs/design/cicd.md §4.1, §4.4). 공개 저장소라 이슈 본문도 누출 규칙을 따른다:
// 본문은 **허용 목록 필드**(고리 이름, 상태, 실행 URL, 커밋 SHA, 작업 이름, 고정 enum kind, 워크플로 파일 이름)만으로
// 만들고, 자유 문자열 인자는 받지 않으며, 게시 전에 public-scan의 scanText()를 통과해야 한다.
//
//   node scripts/ci/issue.mjs sync --repo o/r --loop <이름> --status fail|ok [--run-url U] [--sha S]
//                                  [--jobs a,b] [--kinds k1,k2] [--workflows w.yml]
//   node scripts/ci/run.mjs report    # ci.yml report 작업: master-failure, 예약 워크플로 keep-alive, nightly-stale
//
// 멱등: label `ci-loop:<이름>` + 본문 첫 줄의 숨은 마커 `<!-- ci-loop:<이름> -->`. fail: 열린 이슈가 없으면 만들고 있으면 댓글.
// ok: 열린 이슈가 있으면 복구 댓글을 달고 닫는다. gh CLI(GH_TOKEN)를 쓴다. 종료 코드: 0, gh 실패 1, 입력 오류 2.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBSERVED_JOBS, ROOT } from './gates.mjs';
import { loadDenylist, scanText } from './public-scan.mjs';

export const LOOPS = {
  'master-failure': 'master CI(ci-ok)가 실패했다',
  'nightly-stale': '예약 워크플로가 72시간 넘게 성공하지 못했다',
  drift: '실서버 drift 검사가 실패했다',
  advisories: '의존성 보안 권고가 있다',
  fuzz: 'fuzz가 crash를 찾았다',
  mutants: '살아남은 mutant가 늘었다',
  'ruleset-drift': '저장소 ruleset·설정이 선언과 다르다',
  toolchain: '새 Rust stable이 나왔다',
  release: '릴리스 파이프라인이 실패했다',
  'e2e-native': '예약 네이티브 E2E(Linux 매일·Windows 매주)가 실패했다',
};
// report-loop(예약 워크플로의 report 작업)이 다루는 고리. needs 결과만으로 판정하는 고리다.
export const NEEDS_LOOPS = ['e2e-native'];
export const KINDS = [
  'build',
  'test',
  'http_4xx',
  'http_5xx',
  'auth',
  'target_gone',
  'schema_mismatch',
  'timeout',
  'media_invalid',
  'panic',
  'no_target',
  'unknown',
];
export const STALE_HOURS = 72;

const RE = {
  repo: /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/,
  runUrl: /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/,
  sha: /^[0-9a-f]{40}$/,
  job: /^[A-Za-z0-9 ()._,\/-]{1,80}$/,
  workflow: /^[A-Za-z0-9._-]+\.ya?ml$/,
  branchRef: /^refs\/heads\/([A-Za-z0-9._][A-Za-z0-9._\/-]{0,200})$/,
};

export const label = (loop) => `ci-loop:${loop}`;
export const marker = (loop) => `<!-- ci-loop:${loop} -->`;
export const title = (loop) => `[ci-loop] ${loop}: ${LOOPS[loop]}`;

// 입력 → 검사한 필드. 어긋나면 예외(이슈를 쓰지 않는다).
export function validate(o) {
  const err = (m) => {
    throw new Error(m);
  };
  if (!Object.hasOwn(LOOPS, o.loop ?? '')) err(`모르는 loop: ${o.loop}`);
  if (!['fail', 'ok'].includes(o.status)) err(`status는 fail|ok: ${o.status}`);
  if (o.repo !== undefined && !RE.repo.test(o.repo)) err(`repo 형식: ${o.repo}`);
  if (o.runUrl !== undefined && !RE.runUrl.test(o.runUrl)) err(`run-url 형식: ${o.runUrl}`);
  if (o.sha !== undefined && !RE.sha.test(o.sha)) err(`sha 형식: ${o.sha}`);
  const list = (xs, re, what, max) => {
    const v = xs ?? [];
    if (!Array.isArray(v) || v.length > max) err(`${what}: 최대 ${max}개`);
    for (const x of v) if (typeof x !== 'string' || !re.test(x)) err(`${what} 형식: ${JSON.stringify(x)}`);
    return [...new Set(v)].sort();
  };
  const jobs = list(o.jobs, RE.job, 'jobs', 40);
  const workflows = list(o.workflows, RE.workflow, 'workflows', 20);
  const kinds = list(o.kinds, /./, 'kinds', KINDS.length);
  for (const k of kinds) if (!KINDS.includes(k)) err(`모르는 kind: ${k}`);
  return { loop: o.loop, status: o.status, repo: o.repo, runUrl: o.runUrl, sha: o.sha, jobs, kinds, workflows };
}

// 검사한 필드 → 본문(첫 이슈) / 댓글
export function body(f, { first = false } = {}) {
  const lines = [];
  if (first) lines.push(marker(f.loop), '');
  lines.push(f.status === 'fail' ? `**실패** — ${LOOPS[f.loop]}` : `**복구** — 다음 실행이 성공했다`);
  lines.push('');
  if (f.runUrl) lines.push(`- 실행: ${f.runUrl}`);
  if (f.sha) lines.push(`- 커밋: ${f.sha}`);
  if (f.jobs.length) lines.push(`- 실패한 작업: ${f.jobs.map((j) => `\`${j}\``).join(', ')}`);
  if (f.kinds.length) lines.push(`- 종류: ${f.kinds.map((k) => `\`${k}\``).join(', ')}`);
  if (f.workflows.length) lines.push(`- 워크플로: ${f.workflows.map((w) => `\`${w}\``).join(', ')}`);
  if (first) {
    lines.push('');
    lines.push('이 이슈는 `scripts/ci/issue.mjs`가 열었고 같은 고리의 다음 성공 실행이 닫는다. 본문은 허용 목록 필드만 담는다(docs/design/cicd.md §4.1). 자세한 내용은 실행 로그를 본다.');
  }
  return lines.join('\n') + '\n';
}

// 게시 전 누출 검사. 걸리면 예외(게시하지 않는다).
export function assertPublishable(text, deny = loadDenylist()) {
  const found = scanText(text, deny);
  if (found.length) throw new Error(`이슈 본문이 누출 검사에 걸렸다(${[...new Set(found.map((f) => f.rule))].join(', ')}) — 게시하지 않는다`);
}

// gh 실행기: (args, input?) → stdout 문자열. 실패하면 예외. 테스트는 가짜를 넣는다.
export function realGh(env = process.env) {
  return (args, input) => {
    const r = spawnSync('gh', args, { encoding: 'utf8', input, env, maxBuffer: 1 << 26 });
    if (r.error) throw new Error(`gh: ${r.error.message}`);
    if (r.status !== 0) {
      const e = new Error(`gh ${args.slice(0, 3).join(' ')} … → exit ${r.status}: ${(r.stderr ?? '').trim().slice(0, 500)}`);
      e.stderr = r.stderr ?? '';
      throw e;
    }
    return r.stdout ?? '';
  };
}

// 고리 하나를 맞춘다. → { action: 'created'|'commented'|'closed'|'none', numbers }
export function sync(fields, gh, deny) {
  const f = validate(fields);
  if (!f.repo) throw new Error('repo가 없다');
  const R = ['-R', f.repo];
  const open = JSON.parse(gh(['issue', 'list', ...R, '--label', label(f.loop), '--state', 'open', '--json', 'number,body', '--limit', '50']) || '[]')
    .filter((i) => typeof i.body === 'string' && i.body.startsWith(marker(f.loop)))
    .map((i) => i.number)
    .sort((a, b) => a - b);
  if (f.status === 'fail') {
    if (open.length) {
      const text = body(f);
      assertPublishable(text, deny);
      gh(['issue', 'comment', String(open[0]), ...R, '--body-file', '-'], text);
      return { action: 'commented', numbers: [open[0]] };
    }
    const text = body(f, { first: true });
    assertPublishable(text, deny);
    assertPublishable(title(f.loop), deny);
    gh(['label', 'create', label(f.loop), ...R, '--color', 'B60205', '--description', 'CI 닫힌 고리 자동 이슈(scripts/ci/issue.mjs)', '--force']);
    const out = gh(['issue', 'create', ...R, '--title', title(f.loop), '--label', label(f.loop), '--body-file', '-'], text);
    const n = Number(/\/issues\/(\d+)/.exec(out)?.[1]);
    return { action: 'created', numbers: Number.isFinite(n) ? [n] : [] };
  }
  if (!open.length) return { action: 'none', numbers: [] };
  const text = body(f);
  assertPublishable(text, deny);
  for (const n of open) gh(['issue', 'close', String(n), ...R, '--comment', text]);
  return { action: 'closed', numbers: open };
}

// ---- report(ci.yml report 작업) ----

// 로컬 .github/workflows 중 schedule 트리거가 있는 파일(keep-alive·stale 대상). G5·G6가 더하면 따라 늘어난다.
export function scheduledWorkflows(root = ROOT) {
  const dir = join(root, '.github/workflows');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => RE.workflow.test(f))
    .filter((f) => /^\s+schedule:\s*$/m.test(readFileSync(join(dir, f), 'utf8')))
    .sort();
}

// 예약 워크플로 하나의 상태 → stale인지(순수). lastSuccess·created는 ISO 문자열 또는 null.
export function isStale({ lastSuccess, created }, now, hours = STALE_HOURS) {
  const limit = hours * 3600 * 1000;
  const t = Date.parse(lastSuccess ?? created ?? '');
  if (!Number.isFinite(t)) return true;
  return now - t > limit;
}

const notFound = (e) => /HTTP 404|Not Found/.test(`${e.message}\n${e.stderr ?? ''}`);

// master-failure 상태(순수). ci-ok가 success가 아니거나, D14 관찰 작업(OBSERVED_JOBS, ci-ok에 없다)이 실패·취소됐으면
// 'fail'. needsJson은 report 작업의 toJSON(needs)(없거나 깨졌으면 관찰 작업은 보지 않는다: ci-ok 판정이 먼저다).
// 관찰 작업의 skipped는 실패가 아니다(dispatch의 force_fail처럼 앞 작업이 건너뛰게 한 경우).
export function masterStatus(ciOkResult, needsJson, observed = Object.keys(OBSERVED_JOBS)) {
  if (ciOkResult !== 'success') return { status: 'fail', observedFailed: [] };
  let needs = {};
  try {
    needs = JSON.parse(needsJson ?? '{}') ?? {};
  } catch {
    needs = {};
  }
  const observedFailed = observed.filter((id) => ['failure', 'cancelled'].includes(needs[id]?.result)).sort();
  return { status: observedFailed.length ? 'fail' : 'ok', observedFailed };
}

// env → 0(보고함) | 1(gh 실패) | 2(입력 오류)
export function report(env, gh, { root = ROOT, now = Date.now(), deny } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const runId = env.GITHUB_RUN_ID;
  const attempt = env.GITHUB_RUN_ATTEMPT || '1';
  if (env.GITHUB_SERVER_URL && env.GITHUB_SERVER_URL !== 'https://github.com') {
    console.error(`report: github.com만 지원한다(${env.GITHUB_SERVER_URL})`);
    return 2;
  }
  if (!RE.repo.test(repo ?? '') || !/^\d+$/.test(runId ?? '') || !/^\d+$/.test(attempt)) {
    console.error('report: GITHUB_REPOSITORY·GITHUB_RUN_ID·GITHUB_RUN_ATTEMPT가 필요하다');
    return 2;
  }
  const runUrl = `https://github.com/${repo}/actions/runs/${runId}`;
  const sha = env.GITHUB_SHA;
  let bad = 0;
  const step = (name, fn) => {
    try {
      fn();
    } catch (e) {
      bad++;
      console.error(`::error::report ${name}: ${e.message}`);
    }
  };

  // 1. master-failure. 실행은 커밋 순서대로 끝나지 않는다(느린 옛 커밋이 새 커밋보다 늦게 끝난다).
  // 이 실행의 커밋이 지금 그 브랜치의 머리일 때만 열고 닫는다. 머리가 아니면 머리 커밋의 실행이 보고한다.
  step('master-failure', () => {
    const ref = RE.branchRef.exec(env.GITHUB_REF ?? '');
    if (!ref) throw new Error(`GITHUB_REF가 브랜치가 아니다: ${env.GITHUB_REF}`);
    if (!RE.sha.test(sha ?? '')) throw new Error(`GITHUB_SHA 형식: ${sha}`);
    const head = gh(['api', `repos/${repo}/git/ref/heads/${ref[1]}`, '--jq', '.object.sha']).trim();
    if (head !== sha) {
      console.log(`master-failure: 이 실행의 커밋 ${sha}는 ${ref[1]}의 머리(${head || '없음'})가 아니다 — 건너뜀(머리 커밋의 실행이 보고한다)`);
      return;
    }
    const result = env.CI_OK_RESULT;
    const { status, observedFailed } = masterStatus(result, env.NEEDS);
    if (observedFailed.length) console.log(`master-failure: ci-ok는 ${result}지만 관찰 작업(D14)이 실패했다: ${observedFailed.join(', ')}`);
    let jobs = [];
    if (status === 'fail') {
      const out = gh([
        'api',
        `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs`,
        '--paginate',
        '--jq',
        '.jobs[] | select(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") | .name',
      ]);
      jobs = out.split('\n').map((s) => s.trim()).filter((s) => s && s !== 'report');
    }
    const r = sync({ loop: 'master-failure', status, repo, runUrl, sha, jobs: jobs.slice(0, 40), kinds: [] }, gh, deny);
    console.log(`master-failure: ci-ok ${result} → ${r.action} ${r.numbers.join(',')}`);
  });

  // 2. 예약 워크플로: 꺼졌으면 켜고(keep-alive), 72시간 넘게 성공이 없으면 nightly-stale
  step('nightly-stale', () => {
    const stale = [];
    const files = scheduledWorkflows(root);
    if (!files.length) console.log('예약 워크플로 없음(nightly.yml은 G5에서 생긴다)');
    for (const f of files) {
      let wf;
      try {
        wf = JSON.parse(gh(['api', `repos/${repo}/actions/workflows/${f}`]));
      } catch (e) {
        if (notFound(e)) {
          console.log(`${f}: 기본 브랜치에 아직 없다 — 건너뜀`);
          continue;
        }
        throw e;
      }
      if (wf.state === 'disabled_inactivity') {
        gh(['workflow', 'enable', String(wf.id), '-R', repo]);
        console.log(`${f}: 60일 비활성으로 꺼져 있어 다시 켰다(keep-alive)`);
      } else console.log(`${f}: state ${wf.state}`);
      const last = gh(['api', `repos/${repo}/actions/workflows/${f}/runs?branch=master&status=success&per_page=1`, '--jq', '.workflow_runs[0].updated_at // ""']).trim();
      const s = isStale({ lastSuccess: last || null, created: wf.created_at ?? null }, now);
      console.log(`${f}: 마지막 성공 ${last || '없음'} → ${s ? 'stale' : 'ok'}`);
      if (s) stale.push(f);
    }
    const r = sync({ loop: 'nightly-stale', status: stale.length ? 'fail' : 'ok', repo, runUrl, sha, workflows: stale }, gh, deny);
    console.log(`nightly-stale: ${r.action} ${r.numbers.join(',')}`);
  });
  return bad ? 1 : 0;
}

// 예약 워크플로의 report 작업(nightly.yml): needs 결과로 고리 하나를 열고 닫는다.
// env: LOOP(NEEDS_LOOPS 중 하나), NEEDS(toJSON(needs)), GITHUB_REPOSITORY·GITHUB_RUN_ID·GITHUB_SHA. 실패·취소된 작업이
// 하나라도 있으면 fail(작업 id를 이슈에 적는다), 그 밖(success·skipped)이면 ok. → 0 | 1(gh 실패) | 2(입력 오류)
export function loopStatus(needsJson) {
  const needs = JSON.parse(needsJson);
  if (!needs || typeof needs !== 'object' || Array.isArray(needs) || !Object.keys(needs).length) throw new Error('NEEDS가 비었거나 객체가 아니다');
  const failed = Object.entries(needs)
    .filter(([, v]) => ['failure', 'cancelled'].includes(v?.result))
    .map(([k]) => k)
    .sort();
  return { status: failed.length ? 'fail' : 'ok', jobs: failed };
}

export function reportLoop(env, gh, { deny } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  const loop = env.LOOP;
  if (!NEEDS_LOOPS.includes(loop ?? '')) {
    console.error(`report-loop: LOOP는 ${NEEDS_LOOPS.join('|')} 중 하나다(받음: ${loop})`);
    return 2;
  }
  if (!RE.repo.test(repo ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) {
    console.error('report-loop: GITHUB_REPOSITORY·GITHUB_RUN_ID가 필요하다');
    return 2;
  }
  let st;
  try {
    st = loopStatus(env.NEEDS ?? '');
  } catch (e) {
    console.error(`report-loop: NEEDS(toJSON(needs)): ${e.message}`);
    return 2;
  }
  try {
    const r = sync({ loop, status: st.status, repo, runUrl: `https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}`, sha: env.GITHUB_SHA, jobs: st.jobs }, gh, deny);
    console.log(`${loop}: ${st.status}${st.jobs.length ? `(${st.jobs.join(', ')})` : ''} → ${r.action} ${r.numbers.join(',')}`);
    return 0;
  } catch (e) {
    console.error(`::error::report-loop ${loop}: ${e.message}`);
    return 1;
  }
}

// ---- CLI ----

function parseArgs(argv) {
  const o = {};
  const keys = { '--repo': 'repo', '--loop': 'loop', '--status': 'status', '--run-url': 'runUrl', '--sha': 'sha', '--jobs': 'jobs', '--kinds': 'kinds', '--workflows': 'workflows' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = keys[argv[i]];
    if (!k || argv[i + 1] === undefined) return null;
    o[k] = ['jobs', 'kinds', 'workflows'].includes(k) ? argv[i + 1].split(',').filter(Boolean) : argv[i + 1];
  }
  return o;
}

export function main(argv, env = process.env) {
  const [cmd, ...rest] = argv;
  const o = cmd === 'sync' ? parseArgs(rest) : null;
  if (!o) {
    console.error('사용법: issue.mjs sync --repo o/r --loop <이름> --status fail|ok [--run-url U] [--sha S] [--jobs a,b] [--kinds k] [--workflows w.yml]');
    return 2;
  }
  try {
    validate(o);
  } catch (e) {
    console.error(`issue: ${e.message}`);
    return 2;
  }
  try {
    const r = sync(o, realGh(env));
    console.log(`${o.loop}: ${r.action} ${r.numbers.join(',')}`);
    return 0;
  } catch (e) {
    console.error(`::error::issue: ${e.message}`);
    return 1;
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
