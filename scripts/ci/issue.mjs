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
// master가 아닌 브랜치의 실행(loop_test dispatch)은 시험 이름공간 `ci-loop-test:<이름>`에만 쓴다: 브랜치의 녹색이
// master·예약 실행이 연 진짜 고리 이슈를 닫지 못한다(실측: 브랜치 dispatch 37328558124가 #3을 닫았다).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { OBSERVED_JOBS, ROOT } from './gates.mjs';
import { loadDenylist, scanText } from './public-scan.mjs';

export const LOOPS = {
  'master-failure': 'master CI(ci-ok)가 실패했다',
  'nightly-stale': '예약 워크플로가 72시간 넘게 예약 실행을 끝내지 못했다',
  drift: '실서버 drift 검사가 실패했다',
  advisories: '의존성 보안 권고가 있다',
  fuzz: 'fuzz가 crash를 찾았다',
  mutants: '살아남은 mutant가 늘었다',
  'ruleset-drift': '저장소 ruleset·설정이 선언과 다르다',
  toolchain: '새 Rust stable이 나왔다',
  pins: '워크플로 핀 SHA 또는 온라인 audit이 어긋났다',
  release: '릴리스 파이프라인이 실패했다',
  'e2e-native-linux': '예약 네이티브 E2E(Linux, 매일)가 실패했다',
  'e2e-native-windows': '예약 네이티브 E2E(Windows, 매주)가 실패했거나 오래 돌지 않았다',
};
// report-loop(예약 워크플로의 report 작업)이 다루는 고리. 고리 이름 = nightly.yml 작업 id이고, 작업마다 따로 연다(한
// 작업이 건너뛴 날 다른 작업의 녹색이 그 이슈를 닫지 않게). name은 그 작업의 표시 이름(nightly.yml name:, issue.test가
// 맞춘다), staleHours는 건너뛴 실행에서 그 작업의 마지막 성공이 이보다 오래면 fail(kind stale)로 보는 한계다: 예약이
// 떨어지거나(GitHub가 부하로 건너뜀) 조건식이 cron과 어긋나 작업이 조용히 꺼지는 것을 잡는다.
// consecutive(기본 1)는 이슈를 여는 연속 실패 횟수다(이번 실행 포함). consecutiveKinds는 이번 실패의 kind가 모두 그 kind일
// 때의 횟수다(drift: 실서버는 한 번 흔들릴 수 있어 2회, 대상 secret이 없는 no_target은 3회, docs/design/cicd.md §4.3).
// 연속 횟수는 같은 브랜치의 완료된 실행(pull_request 실행 제외)에서 그 작업이 돈 것만 새것부터 센다(jobHistory).
export const NEEDS_LOOPS = {
  'e2e-native-linux': { name: 'nightly e2e-native (linux)', staleHours: 72 },
  'e2e-native-windows': { name: 'nightly e2e-native (windows)', staleHours: 8 * 24 },
  drift: { name: 'nightly drift', staleHours: 72, consecutive: 2, consecutiveKinds: { no_target: 3 } },
  advisories: { name: 'nightly advisories', staleHours: 72 },
  pins: { name: 'nightly pins', staleHours: 72 },
  'ruleset-drift': { name: 'nightly ruleset-drift', staleHours: 72 },
  fuzz: { name: 'nightly fuzz', staleHours: 72 },
  toolchain: { name: 'nightly toolchain', staleHours: 8 * 24 },
  mutants: { name: 'nightly mutants', staleHours: 8 * 24 },
};
export const LOOP_WORKFLOW = 'nightly.yml';
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
  'stale',
  'network',
  'settings_mismatch',
  'unknown',
];
// 고리·kind마다 이슈에 붙이는 고정 문구(자유 문자열이 아니다). 사람이 할 일을 알려 준다.
export const KIND_NOTES = {
  drift: {
    target_gone: 'drift 대상이 만료·삭제됐다: 환경 drift의 secret(CHZZK_LIVE_*)을 본인의 다른 영상으로 교체 필요',
    no_target: 'drift 대상 secret이 없다: 환경 drift에 CHZZK_LIVE_HLS·CHZZK_LIVE_DASH·CHZZK_LIVE_CLIP을 넣는다(docs/design/cicd.md §8)',
    auth: '실서버가 인증을 요구했다: 대상이 본인 공개 영상인지 확인한다',
    schema_mismatch: '치지직 응답 형식이 바뀌었을 수 있다: 코어 파서(info·mpd·hls)를 확인한다',
  },
  'ruleset-drift': {
    auth: '이 토큰으로는 저장소 설정을 읽을 수 없다: 저장소 Administration 읽기 권한의 fine-grained PAT를 환경 audit의 secret RULESET_READ_TOKEN으로 넣는다(docs/design/cicd.md §8)',
    settings_mismatch: '저장소 설정·ruleset이 선언(scripts/ci/repo-settings.json, .github/rulesets/)과 다르다: 실행 로그의 항목을 보고 설정을 되돌리거나 선언을 고친다',
  },
};
export const STALE_HOURS = 72;

const RE = {
  repo: /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/,
  runUrl: /^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/\d+(?:\/attempts\/\d+)?$/,
  sha: /^[0-9a-f]{40}$/,
  job: /^[A-Za-z0-9 ()._,\/-]{1,80}$/,
  workflow: /^[A-Za-z0-9._-]+\.ya?ml$/,
  branchRef: /^refs\/heads\/([A-Za-z0-9._][A-Za-z0-9._\/-]{0,200})$/,
};

// test: 시험 이름공간(master가 아닌 브랜치의 실행)
const ns = (test) => (test ? 'ci-loop-test' : 'ci-loop');
export const label = (loop, test = false) => `${ns(test)}:${loop}`;
export const marker = (loop, test = false) => `<!-- ${ns(test)}:${loop} -->`;
export const title = (loop, test = false) => `[${ns(test)}] ${loop}: ${LOOPS[loop]}`;
export const DEFAULT_BRANCH = 'master';
// GITHUB_REF → { branch, test }(브랜치가 아니면 null). test = 기본 브랜치가 아니다.
export function refScope(ref) {
  const m = RE.branchRef.exec(ref ?? '');
  return m ? { branch: m[1], test: m[1] !== DEFAULT_BRANCH } : null;
}

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
  if (o.test !== undefined && typeof o.test !== 'boolean') err(`test는 boolean: ${o.test}`);
  return { loop: o.loop, status: o.status, repo: o.repo, runUrl: o.runUrl, sha: o.sha, jobs, kinds, workflows, test: o.test === true };
}

// 검사한 필드 → 본문(첫 이슈) / 댓글
export function body(f, { first = false } = {}) {
  const lines = [];
  if (first) lines.push(marker(f.loop, f.test), '');
  lines.push(f.status === 'fail' ? `**실패** — ${LOOPS[f.loop]}` : `**복구** — 다음 실행이 성공했다`);
  lines.push('');
  if (f.runUrl) lines.push(`- 실행: ${f.runUrl}`);
  if (f.sha) lines.push(`- 커밋: ${f.sha}`);
  if (f.jobs.length) lines.push(`- 실패한 작업: ${f.jobs.map((j) => `\`${j}\``).join(', ')}`);
  if (f.kinds.length) lines.push(`- 종류: ${f.kinds.map((k) => `\`${k}\``).join(', ')}`);
  if (f.workflows.length) lines.push(`- 워크플로: ${f.workflows.map((w) => `\`${w}\``).join(', ')}`);
  if (f.status === 'fail') for (const k of f.kinds) if (KIND_NOTES[f.loop]?.[k]) lines.push(`- 할 일(${k}): ${KIND_NOTES[f.loop][k]}`);
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
  const lab = label(f.loop, f.test);
  const open = JSON.parse(gh(['issue', 'list', ...R, '--label', lab, '--state', 'open', '--json', 'number,body', '--limit', '50']) || '[]')
    .filter((i) => typeof i.body === 'string' && i.body.startsWith(marker(f.loop, f.test)))
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
    assertPublishable(title(f.loop, f.test), deny);
    const desc = f.test ? 'CI 닫힌 고리 시험(브랜치 loop_test dispatch, scripts/ci/issue.mjs)' : 'CI 닫힌 고리 자동 이슈(scripts/ci/issue.mjs)';
    gh(['label', 'create', lab, ...R, '--color', f.test ? 'C5DEF5' : 'B60205', '--description', desc, '--force']);
    const out = gh(['issue', 'create', ...R, '--title', title(f.loop, f.test), '--label', lab, '--body-file', '-'], text);
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
  // master가 아닌 브랜치(loop_test dispatch)는 시험 이름공간에 쓴다(refScope).
  const scope = refScope(env.GITHUB_REF);
  step('master-failure', () => {
    if (!scope) throw new Error(`GITHUB_REF가 브랜치가 아니다: ${env.GITHUB_REF}`);
    if (!RE.sha.test(sha ?? '')) throw new Error(`GITHUB_SHA 형식: ${sha}`);
    const head = gh(['api', `repos/${repo}/git/ref/heads/${scope.branch}`, '--jq', '.object.sha']).trim();
    if (head !== sha) {
      console.log(`master-failure: 이 실행의 커밋 ${sha}는 ${scope.branch}의 머리(${head || '없음'})가 아니다 — 건너뜀(머리 커밋의 실행이 보고한다)`);
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
    const r = sync({ loop: 'master-failure', status, repo, runUrl, sha, jobs: jobs.slice(0, 40), kinds: [], test: scope.test }, gh, deny);
    console.log(`${label('master-failure', scope.test)}: ci-ok ${result} → ${r.action} ${r.numbers.join(',')}`);
  });

  // 2. 예약 워크플로: 꺼졌으면 켜고(keep-alive), 72시간 넘게 완료된 예약 실행이 없으면 nightly-stale
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
      // 워크플로 전체의 성공이 아니라 **완료된 마지막 예약 실행**을 본다(G5, 구현 중 변경 49): 예약 워크플로에는 설계상
      // 빨간 작업이 있다(drift no_target, 새 stable이 나온 toolchain, crash를 찾은 fuzz). 그 작업들의 건강은 작업별 고리
      // (report-loop, staleHours 포함)가 보고, 여기서는 스케줄러가 살아 있는지만 본다.
      const last = gh(['api', `repos/${repo}/actions/workflows/${f}/runs?branch=master&event=schedule&status=completed&per_page=1`, '--jq', '.workflow_runs[0].updated_at // ""']).trim();
      const s = isStale({ lastSuccess: last || null, created: wf.created_at ?? null }, now);
      console.log(`${f}: 마지막 완료 예약 실행 ${last || '없음'} → ${s ? 'stale' : 'ok'}`);
      if (s) stale.push(f);
    }
    const r = sync({ loop: 'nightly-stale', status: stale.length ? 'fail' : 'ok', repo, runUrl, sha, workflows: stale, test: scope?.test !== false }, gh, deny);
    console.log(`${label('nightly-stale', scope?.test !== false)}: ${r.action} ${r.numbers.join(',')}`);
  });
  return bad ? 1 : 0;
}

// 예약 워크플로의 report 작업(nightly.yml): needs의 작업마다 그 이름의 고리(NEEDS_LOOPS)를 열고 닫는다.
// env: NEEDS(toJSON(needs)), GITHUB_REPOSITORY·GITHUB_RUN_ID·GITHUB_SHA. 작업 결과 → failure·cancelled면 fail, success면 ok,
// skipped면 아무것도 하지 않는다(매주 도는 Windows가 건너뛴 날 그 이슈를 닫지 않는다). → 0 | 1(gh 실패) | 2(입력 오류)
// 작업의 outputs.kinds(쉼표 목록)는 KINDS enum만 받는다. 모르는 값은 글자를 옮기지 않고 'unknown'으로 바꾼다.
export function loopStatuses(needsJson, loops = NEEDS_LOOPS) {
  const needs = JSON.parse(needsJson);
  if (!needs || typeof needs !== 'object' || Array.isArray(needs) || !Object.keys(needs).length) throw new Error('NEEDS가 비었거나 객체가 아니다');
  const out = [];
  for (const [job, v] of Object.entries(needs).sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!Object.hasOwn(loops, job)) throw new Error(`고리가 없는 작업: ${job}(issue.mjs NEEDS_LOOPS)`);
    const r = v?.result;
    const raw = typeof v?.outputs?.kinds === 'string' ? v.outputs.kinds.split(',').map((k) => k.trim()).filter(Boolean) : [];
    const kinds = [...new Set(raw.map((k) => (KINDS.includes(k) ? k : 'unknown')))].sort();
    // 합성 결과(drift simulate)는 진짜 고리에 쓰지 않는다(reportLoop가 시험 이름공간으로 보낸다)
    const simulated = v?.outputs?.simulated === 'true';
    if (r === 'failure' || r === 'cancelled') out.push({ loop: job, status: 'fail', kinds, simulated });
    else if (r === 'success') out.push({ loop: job, status: 'ok', kinds: [], simulated });
    else out.push({ loop: job, status: null, kinds: [], simulated });
  }
  return out;
}

// 이슈를 열 연속 실패 횟수(이번 실행 포함). kind가 모두 consecutiveKinds의 같은 kind면 그 값.
export function threshold(spec, kinds) {
  const byKind = spec.consecutiveKinds ?? {};
  const ks = kinds.filter((k) => Object.hasOwn(byKind, k));
  if (kinds.length && ks.length === kinds.length && new Set(ks.map((k) => byKind[k])).size === 1) return byKind[ks[0]];
  return spec.consecutive ?? 1;
}

// branch의 workflow 완료 실행 기록. 실행 목록과 실행별 작업 목록을 한 번씩만 읽어(report-loop가 고리 여럿에 나눠 쓴다)
// API 호출 수를 고리 수와 무관하게 둔다. 실행은 새것부터다.
export const RUNS_JQ = '[.workflow_runs[] | {id, event, created_at}]';
export const JOBS_JQ = '[.jobs[] | {name, conclusion, completed_at}]';
export function runHistory(gh, { repo, workflow, branch, runs = 30 }) {
  let list = null;
  const jobs = new Map();
  return {
    runs() {
      if (!list) {
        const out = gh(['api', `repos/${repo}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&status=completed&per_page=${runs}`, '--jq', RUNS_JQ]);
        list = (JSON.parse(out || '[]') ?? []).filter((r) => Number.isInteger(r?.id)).map((r) => ({ id: String(r.id), event: r.event, created_at: r.created_at ?? null }));
      }
      return list;
    },
    jobs(id) {
      if (!jobs.has(id)) jobs.set(id, JSON.parse(gh(['api', `repos/${repo}/actions/runs/${id}/jobs?per_page=100`, '--jq', JOBS_JQ]) || '[]') ?? []);
      return jobs.get(id);
    },
  };
}

// 작업 jobName이 돈(skipped가 아닌) 실행의 conclusion 목록(새것부터). excludeRunId는 지금 실행.
// events: 셀 실행의 event. 진짜 이름공간(master)은 예약 실행만 센다(dispatch, 특히 simulate의 합성 결과가 실제 연속을
// 늘이거나 끊지 않게). 시험 이름공간(브랜치)은 pull_request만 뺀다(브랜치 dispatch로 고리를 확인한다).
export function jobHistory(h, { jobName, excludeRunId, events = null }) {
  const out = [];
  for (const r of h.runs()) {
    if (r.id === String(excludeRunId)) continue;
    if (events ? !events.includes(r.event) : r.event === 'pull_request') continue;
    const c = h.jobs(r.id).find((j) => j.name === jobName)?.conclusion;
    if (c && c !== 'skipped') out.push(c);
  }
  return out;
}

// 새것부터 이어지는 실패(failure·cancelled·timed_out) 수
export const leadingFailures = (history) => {
  let n = 0;
  for (const c of history) {
    if (!['failure', 'cancelled', 'timed_out'].includes(c)) break;
    n++;
  }
  return n;
};

// 작업(표시 이름 jobName)이 마지막으로 성공한 시각(ISO) 또는 null. 워크플로 전체가 빨개도 그 작업은 성공했을 수 있어
// 실행을 status=success로 거르지 않는다.
export function lastJobSuccess(h, { jobName }) {
  for (const r of h.runs()) {
    const t = h.jobs(r.id).find((j) => j.name === jobName && j.conclusion === 'success')?.completed_at;
    if (t) return t;
  }
  return null;
}

// 건너뛴 작업이 staleHours 넘게 성공하지 못했는지. 워크플로가 기본 브랜치에 없으면(404) false.
function skippedStale(gh, h, { repo, branch, loop, now, loops }) {
  const { name, staleHours } = loops[loop];
  let wf;
  try {
    wf = JSON.parse(gh(['api', `repos/${repo}/actions/workflows/${LOOP_WORKFLOW}`]));
  } catch (e) {
    if (notFound(e)) return false;
    throw e;
  }
  const last = lastJobSuccess(h, { jobName: name });
  // 성공 기록이 없으면 "관찰을 시작한 때"부터 센다: 워크플로 생성 시각과 이 브랜치의 가장 오래된 완료 실행 중 늦은 쪽.
  // 이 브랜치에 완료 실행이 하나도 없으면 유예한다(머지 뒤 첫 예약 실행이 매주 작업을 바로 stale로 열지 않게).
  const runs = h.runs();
  if (!last && !runs.length) {
    console.log(`${loop}: 건너뜀, ${branch}에 완료 실행이 아직 없다 — 유예`);
    return false;
  }
  const since = [wf.created_at, runs.at(-1)?.created_at].filter((t) => Number.isFinite(Date.parse(t ?? ''))).sort().at(-1) ?? null;
  const s = isStale({ lastSuccess: last, created: since }, now, staleHours);
  console.log(`${loop}: 건너뜀, '${name}'의 마지막 성공 ${last ?? '없음'}(${branch}) → ${s ? `stale(${staleHours}시간 초과)` : 'ok'}`);
  return s;
}

export function reportLoop(env, gh, { deny, now = Date.now(), loops = NEEDS_LOOPS } = {}) {
  const repo = env.GITHUB_REPOSITORY;
  if (!RE.repo.test(repo ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '')) {
    console.error('report-loop: GITHUB_REPOSITORY·GITHUB_RUN_ID가 필요하다');
    return 2;
  }
  // 고리는 커밋이 아니라 환경을 보므로 머리 커밋 검사는 하지 않는다. 다만 master가 아니면 시험 이름공간에만 쓴다.
  const scope = refScope(env.GITHUB_REF);
  if (!scope) {
    console.error(`report-loop: GITHUB_REF가 브랜치가 아니다: ${env.GITHUB_REF}`);
    return 2;
  }
  if (scope.test) console.log(`report-loop: ${scope.branch}는 ${DEFAULT_BRANCH}가 아니다 — 시험 이름공간(${label('…', true)})에만 쓴다`);
  let sts;
  try {
    sts = loopStatuses(env.NEEDS ?? '', loops);
  } catch (e) {
    console.error(`report-loop: NEEDS(toJSON(needs)): ${e.message}`);
    return 2;
  }
  const runUrl = `https://github.com/${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  let bad = 0;
  const h = runHistory(gh, { repo, workflow: LOOP_WORKFLOW, branch: scope.branch });
  for (const { loop, status: st, kinds: k, simulated } of sts) {
    try {
      let status = st;
      let kinds = k;
      // 합성 결과(simulate)는 master에서도 시험 이름공간에만 쓴다(G4 48 (라)와 같은 종류: 시험이 진짜 이슈를 닫지 않게)
      const test = scope.test || simulated;
      if (simulated && !scope.test) console.log(`${loop}: 합성 결과(simulate) — 시험 이름공간(${label(loop, true)})에만 쓴다`);
      if (!status) {
        // 건너뜀: 마지막 성공이 오래됐으면 fail(stale), 아니면 이슈를 건드리지 않는다(매주 도는 Windows가 건너뛴 날 닫지 않는다)
        if (!skippedStale(gh, h, { repo, branch: scope.branch, loop, now, loops })) continue;
        status = 'fail';
        kinds = ['stale'];
      } else if (status === 'fail') {
        // 연속 실패 규칙(drift 2회, no_target 3회): 문턱 아래면 이슈를 열지도, 댓글을 달지도, 닫지도 않는다
        const need = threshold(loops[loop], kinds);
        if (need > 1) {
          const prior = leadingFailures(jobHistory(h, { jobName: loops[loop].name, excludeRunId: env.GITHUB_RUN_ID, events: test ? null : ['schedule'] }));
          const n = Math.min(prior + 1, need);
          console.log(`${loop}: 실패 ${kinds.join(',') || '-'} — 연속 ${prior + 1}회(문턱 ${need}회)`);
          if (n < need) continue;
        }
      }
      const r = sync({ loop, status, repo, runUrl, sha: env.GITHUB_SHA, jobs: status === 'fail' ? [loop] : [], kinds, test }, gh, deny);
      console.log(`${label(loop, test)}: ${status} → ${r.action} ${r.numbers.join(',')}`);
    } catch (e) {
      bad++;
      console.error(`::error::report-loop ${loop}: ${e.message}`);
    }
  }
  return bad ? 1 : 0;
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
