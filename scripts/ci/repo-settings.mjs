#!/usr/bin/env node
// 저장소 설정·ruleset drift와 적용(docs/design/cicd.md §4.4 "설정 drift", §7, nightly `ruleset-drift`). 선언은
// scripts/ci/repo-settings.json과 .github/rulesets/*.json이다. 실제 값은 gh api로 읽고 쓴다(GH_TOKEN).
//
//   node scripts/ci/repo-settings.mjs --check [--repo o/r]          # 다르면 1, 읽기 실패(권한 등) 2
//   node scripts/ci/repo-settings.mjs --apply [--yes] [--repo o/r]  # 기본은 계획만 찍는다(쓰지 않는다). --yes면 쓰고 --check 결과를 낸다
//
// 판정(순수 함수 diffExpect): 선언한 필드마다 실제 응답의 같은 경로 값이 같아야 한다. 응답에 그 필드가 없으면(토큰 권한이
// 모자라 security_and_analysis를 숨기는 경우 등) 불일치다. 배열은 정렬한 집합으로 비교한다. 항목의 `pick`({경로: [키…]})은
// 그 경로의 배열 원소를 선언한 키만 남긴다(id·node_id가 섞인 환경 배포 정책·protection_rules를 {name,type}·{type,wait_timer}로).
// ruleset은 이름 집합이 같아야 하고, 선언마다 실제 ruleset의 target·enforcement·conditions·rules·bypass_actors가 같아야 한다.
// 403은 RULESET_READ_TOKEN이 필요하다는 뜻이다.
//
// 적용(순수 함수 planEntry·planRulesets): 항목의 `apply`가 {method, endpoint?, body?}면 다를 때 그 호출 하나(body 기본값은 expect),
// {kind: "set", key, endpoint}면 expect[key]의 원소 집합을 맞춘다(없는 것 POST, 선언에 없는 것 DELETE <endpoint>/<id>). `apply`가
// 없으면 손으로 바꾼다(계획에 "수동"으로 나오고 exit 1). 항목은 선언 순서대로 읽고 쓴다(앞 항목이 뒤 항목의 전제일 수 있다:
// allowed_actions가 selected여야 selected-actions를 읽을 수 있다, 환경을 만든 뒤 배포 정책을 넣는다).

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROOT } from './gates.mjs';

const RE_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;

// expect ⊆ actual(경로별). → [{path, want, got}] (got은 응답에 필드가 없으면 MISSING)
export const MISSING = Symbol('없음');
const show = (v) => (v === MISSING ? '(없음)' : JSON.stringify(v));
export function diffExpect(expect, actual, path = '') {
  const out = [];
  if (expect !== null && typeof expect === 'object' && !Array.isArray(expect)) {
    for (const [k, v] of Object.entries(expect)) {
      const p = path ? `${path}.${k}` : k;
      if (actual === null || typeof actual !== 'object' || !Object.hasOwn(actual, k)) out.push({ path: p, want: v, got: MISSING });
      else out.push(...diffExpect(v, actual[k], p));
    }
    return out;
  }
  if (JSON.stringify(normalize(expect)) !== JSON.stringify(normalize(actual))) out.push({ path, want: expect, got: actual });
  return out;
}

// 배열은 원소의 정규화한 JSON 순으로 정렬해 집합으로 비교한다(API가 rules·정책의 순서를 보장하지 않는다. type만으로 정렬하면
// type이 같은 원소 둘(branch 정책 둘 등)이 입력 순서로 남아 같은 집합이 다르다고 나온다)
export function normalize(v) {
  if (Array.isArray(v)) {
    const items = v.map(normalize);
    const keys = items.map((x) => JSON.stringify(x));
    return items.map((x, i) => [keys[i], x]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map((p) => p[1]);
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalize(v[k])]));
  return v;
}

// pick: {"a.b": ["name","type"]} → 그 경로의 배열 원소마다 선언한 키만 남긴다(없는 키는 넣지 않는다). 원본은 바꾸지 않는다.
export function project(actual, pick = {}) {
  let out = structuredClone(actual);
  for (const [path, keys] of Object.entries(pick)) {
    const parts = path.split('.');
    let cur = out;
    for (const p of parts.slice(0, -1)) cur = cur && typeof cur === 'object' ? cur[p] : undefined;
    const last = parts.at(-1);
    if (cur && typeof cur === 'object' && Array.isArray(cur[last])) {
      cur[last] = cur[last].map((x) => Object.fromEntries(keys.filter((k) => x && Object.hasOwn(x, k)).map((k) => [k, x[k]])));
    }
  }
  return out;
}

export const RULESET_FIELDS = ['target', 'enforcement', 'conditions', 'rules', 'bypass_actors'];

// 선언한 ruleset 목록(.github/rulesets/*.json, 이름 순). file은 보고용이고 API 본문에 넣지 않는다(rulesetBody).
export function declaredRulesets(root = ROOT) {
  const dir = join(root, '.github/rulesets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: `.github/rulesets/${f}`, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}
export const rulesetBody = (decl) => Object.fromEntries(['name', ...RULESET_FIELDS].filter((f) => Object.hasOwn(decl, f)).map((f) => [f, decl[f]]));

const api = (gh, endpoint) => JSON.parse(gh(['api', endpoint]));
const fill = (endpoint, repo) => endpoint.replaceAll('{repo}', repo);

// 항목 하나: 실제 응답(원본) → {problems, calls}. calls: [{method, endpoint, body?, desc}] 또는 {manual: true, desc}
export function planEntry(name, s, repo, actual) {
  const problems = diffExpect(s.expect, project(actual, s.pick)).map((d) => `${name}.${d.path}: 선언 ${JSON.stringify(d.want)}, 실제 ${show(d.got)}`);
  if (!problems.length) return { problems, calls: [] };
  const a = s.apply;
  if (!a) return { problems, calls: [{ manual: true, desc: `${name}: apply가 선언되지 않아 손으로 바꾼다` }] };
  if (a.kind === 'set') {
    const want = s.expect[a.key] ?? [];
    const got = Array.isArray(actual?.[a.key]) ? actual[a.key] : [];
    const keys = s.pick?.[a.key];
    const sig = (x) => JSON.stringify(normalize(keys ? Object.fromEntries(keys.filter((k) => Object.hasOwn(x, k)).map((k) => [k, x[k]])) : x));
    const wantSigs = new Set(want.map(sig));
    const gotSigs = new Set(got.map(sig));
    const ep = fill(a.endpoint, repo);
    const calls = [];
    for (const x of got.filter((x) => !wantSigs.has(sig(x)))) calls.push({ method: 'DELETE', endpoint: `${ep}/${x.id}`, desc: `${name}: 선언에 없는 ${sig(x)} 지움` });
    for (const x of want.filter((x) => !gotSigs.has(sig(x)))) calls.push({ method: 'POST', endpoint: ep, body: x, desc: `${name}: ${sig(x)} 더함` });
    return { problems, calls };
  }
  return { problems, calls: [{ method: a.method, endpoint: fill(a.endpoint ?? s.endpoint, repo), body: a.body ?? s.expect, desc: `${name}: ${a.method}` }] };
}

// ruleset: 선언·목록·상세(id → 응답) → {problems, calls}. 선언에 없는 ruleset은 지우는 계획이다(--yes 없이는 찍기만 한다).
export function planRulesets(repo, decls, list, full) {
  const problems = [];
  const calls = [];
  const actualNames = list.map((r) => r.name).sort();
  const declNames = decls.map((r) => r.name).sort();
  for (const decl of decls) {
    const hit = list.find((r) => r.name === decl.name);
    if (!hit) {
      problems.push(`ruleset ${decl.name}: 선언했지만 저장소에 없다`);
      calls.push({ method: 'POST', endpoint: `repos/${repo}/rulesets`, body: rulesetBody(decl), desc: `ruleset ${decl.name}: 만듦(${decl.file ?? ''})` });
      continue;
    }
    const expect = Object.fromEntries(RULESET_FIELDS.filter((f) => Object.hasOwn(decl, f)).map((f) => [f, decl[f]]));
    const diffs = diffExpect(expect, full[hit.id]);
    for (const d of diffs) problems.push(`ruleset ${decl.name}.${d.path}: 선언 ${JSON.stringify(d.want)}, 실제 ${show(d.got)}`);
    if (diffs.length) calls.push({ method: 'PUT', endpoint: `repos/${repo}/rulesets/${hit.id}`, body: rulesetBody(decl), desc: `ruleset ${decl.name}: 선언으로 바꿈` });
  }
  for (const n of actualNames.filter((n) => !declNames.includes(n))) {
    problems.push(`ruleset ${n}: 저장소에 있지만 .github/rulesets/에 선언이 없다`);
    const hit = list.find((r) => r.name === n);
    calls.push({ method: 'DELETE', endpoint: `repos/${repo}/rulesets/${hit.id}`, desc: `ruleset ${n}: 선언에 없어 지움` });
  }
  return { problems, calls };
}

function readRulesets(repo, decls, gh) {
  const list = api(gh, `repos/${repo}/rulesets?includes_parents=false&per_page=100`);
  const full = {};
  for (const r of list) if (decls.some((d) => d.name === r.name)) full[r.id] = api(gh, `repos/${repo}/rulesets/${r.id}`);
  return { list, full };
}

// 선언·실제 → 문제 목록(문자열). gh(args) → stdout. 읽기 실패는 예외.
export function check({ repo, settings, rulesets, gh }) {
  const problems = [];
  for (const [name, s] of Object.entries(settings)) problems.push(...planEntry(name, s, repo, api(gh, fill(s.endpoint, repo))).problems);
  const { list, full } = readRulesets(repo, rulesets, gh);
  problems.push(...planRulesets(repo, rulesets, list, full).problems);
  return problems;
}

// 계획(yes=false) 또는 적용(yes=true). 항목 순서대로 읽고(필요하면) 쓴다. → {problems, calls, manual}
// 계획 모드에서 앞 항목에 쓸 것이 있는데 뒤 항목 읽기가 실패하면(전제가 아직 없다) 그 항목은 body 그대로 쓰는 계획으로 둔다.
export function apply({ repo, settings, rulesets, gh, yes, log = console.log }) {
  const all = [];
  const run = (c) => {
    log(`${yes ? '적용' : '계획'}: ${c.method} ${c.endpoint}  # ${c.desc}`);
    if (c.body !== undefined) log(`      ${JSON.stringify(c.body)}`);
    if (!yes) return;
    const args = ['api', '--method', c.method, c.endpoint];
    if (c.body !== undefined) args.push('--input', '-');
    gh(args, c.body !== undefined ? JSON.stringify(c.body) : undefined);
  };
  let manual = 0;
  for (const [name, s] of Object.entries(settings)) {
    let actual;
    try {
      actual = api(gh, fill(s.endpoint, repo));
    } catch (e) {
      if (yes || !all.length || !s.apply || s.apply.kind) throw e;
      log(`계획: ${name}: 아직 읽을 수 없다(앞 변경이 전제): ${e.message.split('\n')[0]}`);
      const c = { method: s.apply.method, endpoint: fill(s.apply.endpoint ?? s.endpoint, repo), body: s.apply.body ?? s.expect, desc: `${name}: ${s.apply.method}` };
      all.push(c);
      run(c);
      continue;
    }
    const { calls } = planEntry(name, s, repo, actual);
    for (const c of calls) {
      if (c.manual) {
        manual++;
        log(`수동: ${c.desc}`);
        continue;
      }
      all.push(c);
      run(c);
    }
  }
  const { list, full } = readRulesets(repo, rulesets, gh);
  for (const c of planRulesets(repo, rulesets, list, full).calls) {
    all.push(c);
    run(c);
  }
  if (!all.length && !manual) log('repo-settings: 바꿀 것이 없다');
  return { calls: all, manual };
}

export function realGh(env = process.env) {
  return (args, input) => {
    const r = spawnSync('gh', args, { encoding: 'utf8', env, maxBuffer: 1 << 24, input });
    if (r.error) throw new Error(`gh: ${r.error.message}`);
    if (r.status !== 0) {
      const e = new Error(`gh ${args.slice(0, 2).join(' ')} → exit ${r.status}: ${(r.stderr ?? '').trim().slice(0, 300)}`);
      e.stderr = r.stderr ?? '';
      throw e;
    }
    return r.stdout;
  };
}

function originRepo() {
  const r = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' });
  return /github\.com[:/]([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec((r.stdout ?? '').trim())?.[1] ?? null;
}

const USAGE = '사용법: repo-settings.mjs --check | --apply [--yes]  [--repo o/r]';

export function main(argv, env = process.env, gh = realGh(env), root = ROOT, log = console.log) {
  let repo = env.GITHUB_REPOSITORY || null;
  let mode = null;
  let yes = false;
  let bad = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check' || argv[i] === '--apply') {
      if (mode) bad = true;
      mode = argv[i].slice(2);
    } else if (argv[i] === '--yes') yes = true;
    else if (argv[i] === '--repo' && argv[i + 1]) repo = argv[++i];
    else bad = true;
  }
  if (bad || !mode || (yes && mode !== 'apply')) {
    console.error(USAGE);
    return 2;
  }
  repo ??= originRepo();
  if (!RE_REPO.test(repo ?? '')) {
    console.error(`repo-settings: 저장소 이름이 없다(${repo})`);
    return 2;
  }
  const settings = JSON.parse(readFileSync(join(root, 'scripts/ci/repo-settings.json'), 'utf8')).settings;
  const rulesets = declaredRulesets(root);
  if (mode === 'apply') {
    let r;
    try {
      r = apply({ repo, settings, rulesets, gh, yes, log });
    } catch (e) {
      console.error(`::error::repo-settings: ${yes ? '적용' : '계획'} 실패: ${e.message}`);
      return 2;
    }
    if (!yes) {
      if (r.calls.length) log(`repo-settings: 위 ${r.calls.length}건은 계획이다. 쓰려면 --apply --yes`);
      return r.calls.length || r.manual ? 1 : 0;
    }
    if (r.manual) console.error(`::error::repo-settings: 손으로 바꿀 항목 ${r.manual}건`);
    // 쓴 뒤 다시 읽어 선언과 같은지가 결과다
    return main(['--check', '--repo', repo], env, gh, root, log);
  }
  // nightly report가 이슈 kind로 쓴다(auth: 토큰이 못 읽음, settings_mismatch: 선언과 다름)
  const kinds = (k) => env.GITHUB_OUTPUT && appendFileSync(env.GITHUB_OUTPUT, `kinds=${k}\n`);
  let problems;
  try {
    problems = check({ repo, settings, rulesets, gh });
  } catch (e) {
    const forbidden = /HTTP 403|HTTP 404|Resource not accessible/.test(`${e.message}\n${e.stderr ?? ''}`);
    console.error(`::error::repo-settings: 읽기 실패: ${e.message}`);
    if (forbidden) {
      console.error('::error::repo-settings: 이 토큰으로는 읽을 수 없다. 저장소 Administration·Environments 읽기 권한이 있는 fine-grained PAT를 환경 audit의 secret RULESET_READ_TOKEN으로 준다(docs/design/cicd.md §8)');
      kinds('auth');
    }
    return 2;
  }
  for (const p of problems) console.error(`::error::ruleset-drift: ${p}`);
  if (problems.length) kinds('settings_mismatch');
  if (!problems.length) log(`repo-settings: ${repo}의 설정 ${Object.keys(settings).length}종·ruleset ${rulesets.length}개가 선언과 같다`);
  return problems.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
