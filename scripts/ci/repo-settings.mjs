#!/usr/bin/env node
// 저장소 설정·ruleset drift(docs/design/cicd.md §4.4 "설정 drift", nightly `ruleset-drift`). 선언은 scripts/ci/repo-settings.json과
// .github/rulesets/*.json(G7)이다. 실제 값은 gh api로 읽는다(GH_TOKEN).
//
//   node scripts/ci/repo-settings.mjs --check [--repo o/r]   # 다르면 1, 읽기 실패(권한 등) 2
//
// 판정(순수 함수 diffExpect): 선언한 필드마다 실제 응답의 같은 경로 값이 같아야 한다. 응답에 그 필드가 없으면(토큰 권한이
// 모자라 security_and_analysis를 숨기는 경우 등) 불일치다. ruleset은 이름 집합이 같아야 하고, 선언마다 실제 ruleset의
// target·enforcement·conditions·rules(type 순)·bypass_actors가 선언과 같아야 한다. 403은 RULESET_READ_TOKEN이 필요하다는 뜻이다.
// G7이 --apply를 더한다.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
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

// 배열은 type(또는 JSON) 순으로 정렬해 비교한다(API가 rules 순서를 보장하지 않는다)
function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, normalize(v[k])]));
  return v;
}
const key = (x) => (x && typeof x === 'object' && typeof x.type === 'string' ? x.type : JSON.stringify(x));

export const RULESET_FIELDS = ['target', 'enforcement', 'conditions', 'rules', 'bypass_actors'];

// 선언한 ruleset 목록(.github/rulesets/*.json, 이름 순)
export function declaredRulesets(root = ROOT) {
  const dir = join(root, '.github/rulesets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: `.github/rulesets/${f}`, ...JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

// 선언·실제 → 문제 목록(문자열). gh(args) → stdout. 읽기 실패는 예외.
export function check({ repo, settings, rulesets, gh }) {
  const problems = [];
  for (const [name, s] of Object.entries(settings)) {
    const actual = JSON.parse(gh(['api', s.endpoint.replace('{repo}', repo)]));
    for (const d of diffExpect(s.expect, actual)) problems.push(`${name}.${d.path}: 선언 ${JSON.stringify(d.want)}, 실제 ${show(d.got)}`);
  }
  const list = JSON.parse(gh(['api', `repos/${repo}/rulesets?includes_parents=false&per_page=100`]));
  const actualNames = list.map((r) => r.name).sort();
  const declNames = rulesets.map((r) => r.name).sort();
  for (const n of declNames.filter((n) => !actualNames.includes(n))) problems.push(`ruleset ${n}: 선언했지만 저장소에 없다`);
  for (const n of actualNames.filter((n) => !declNames.includes(n))) problems.push(`ruleset ${n}: 저장소에 있지만 .github/rulesets/에 선언이 없다`);
  for (const decl of rulesets) {
    const hit = list.find((r) => r.name === decl.name);
    if (!hit) continue;
    const full = JSON.parse(gh(['api', `repos/${repo}/rulesets/${hit.id}`]));
    const expect = Object.fromEntries(RULESET_FIELDS.filter((f) => Object.hasOwn(decl, f)).map((f) => [f, decl[f]]));
    for (const d of diffExpect(expect, full)) problems.push(`ruleset ${decl.name}.${d.path}: 선언 ${JSON.stringify(d.want)}, 실제 ${show(d.got)}`);
  }
  return problems;
}

export function realGh(env = process.env) {
  return (args) => {
    const r = spawnSync('gh', args, { encoding: 'utf8', env, maxBuffer: 1 << 24 });
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

export function main(argv, env = process.env, gh = realGh(env), root = ROOT) {
  let repo = env.GITHUB_REPOSITORY || null;
  let mode = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--check') mode = 'check';
    else if (argv[i] === '--repo' && argv[i + 1]) repo = argv[++i];
    else mode = 'bad';
  }
  if (mode !== 'check') {
    console.error('사용법: repo-settings.mjs --check [--repo o/r]');
    return 2;
  }
  repo ??= originRepo();
  if (!RE_REPO.test(repo ?? '')) {
    console.error(`repo-settings: 저장소 이름이 없다(${repo})`);
    return 2;
  }
  const settings = JSON.parse(readFileSync(join(root, 'scripts/ci/repo-settings.json'), 'utf8')).settings;
  let problems;
  try {
    problems = check({ repo, settings, rulesets: declaredRulesets(root), gh });
  } catch (e) {
    const forbidden = /HTTP 403|HTTP 404|Resource not accessible/.test(`${e.message}\n${e.stderr ?? ''}`);
    console.error(`::error::repo-settings: 읽기 실패: ${e.message}`);
    if (forbidden) console.error('::error::repo-settings: 이 토큰으로는 읽을 수 없다. 저장소 관리 읽기 권한이 있는 fine-grained PAT를 환경 audit의 secret RULESET_READ_TOKEN으로 준다(docs/design/cicd.md §8)');
    return 2;
  }
  for (const p of problems) console.error(`::error::ruleset-drift: ${p}`);
  if (!problems.length) console.log(`repo-settings: ${repo}의 설정 ${Object.keys(settings).length}종·ruleset ${declaredRulesets(root).length}개가 선언과 같다`);
  return problems.length ? 1 : 0;
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
