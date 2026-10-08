#!/usr/bin/env node
// 릴리스 진입점(docs/design/cicd.md §5, 구현 중 변경 G6). release.yml·rollback.yml·훅은 run.mjs gate로 이 파일을 부른다.
// 판정은 모두 결정적이다(종료 코드, 해시, 서명, 스키마, 실제 빌드·실행). 무거운 일은 xtask(Rust)가 하고 여기서는 순서를 정한다.
//
//   node scripts/ci/release.mjs pubkey        # release/updater.pub == tauri.conf.json plugins.updater.pubkey, release/tauri.release.json 허용 목록
//   node scripts/ci/release.mjs gate          # 태그 = 버전 파일, 단조 증가, 올림 자리(docs/versioning.md), master 조상, 그 커밋의 master ci-ok·네이티브 E2E 녹색(기다림)
//   node scripts/ci/release.mjs next-version  # HEAD 기준 다음 릴리스의 최소 버전(지난 조상 태그 뒤 커밋으로 계산)
//   node scripts/ci/release.mjs build         # 임시 키로 릴리스 번들 + updater 산출물 → collect --release → 서명 형식 자체 확인
//   node scripts/ci/release.mjs xtask         # xtask를 빌드해 target/ci/xtask-bin에 담고 sha256을 출력(시크릿 없는 작업에서만)
//   node scripts/ci/release.mjs stage         # 받은 3 OS 산출물로 publish → verify를 가짜 S3에(임시 키, 시크릿 없음. 리허설의 끝)
//   node scripts/ci/release.mjs preflight     # 시크릿·변수가 모두 있는지(없으면 정확한 메시지로 실패), tag는 Worker 프로브까지
//   node scripts/ci/release.mjs publish       # collect → sign → verify-sig → sums → manifest → put → promote(latest.json은 마지막)
//   node scripts/ci/release.mjs verify        # latest.json을 보고 결정표(verifyPlan)대로 확인. 판정 실패면 prev로 rollback하고 1
//   node scripts/ci/release.mjs rollback      # rollback.yml: ROLLBACK_VERSION으로 latest.json을 바꾼다(되돌리기·다시 올리기)
//   node scripts/ci/release.mjs prune         # R2 보존 상한: latest가 이번 버전일 때만 releases/를 latest 이하 최신 5개 + latest의 previous로(높은 폴더는 남김, verify 뒤)
//   node scripts/ci/release.mjs selftest      # 가짜 S3(s3-fake.mjs)에 합성 산출물로 publish·verify·rollback 진입점 시나리오(release-selftest gate)
//   node scripts/ci/release.mjs worker-bundle # worker 번들 + dist/wrangler.json + 배포용 wrangler → tgz·sha256, 풀어서 자격 없이 deploy --dry-run(시크릿 없음)
//   node scripts/ci/release.mjs worker        # superseded 가드 → 묶음 sha256·플랫폼·설정 동일성 → secret 이름 확인 → latest.json 다시 읽기 → deploy --no-bundle → §9.4 배포 뒤 검사
//   node scripts/ci/release.mjs worker --check-only --base <출처> --version <semver> [--build <id>]   # 배포 뒤 검사만(배포 없음)
//
// 종료 코드: 0 통과, 1 검사 실패(판정), 2 사용법·환경·기반 시설 오류(네트워크, HTTP 5xx: 되돌리지 않는다).

import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { ROOT, WORKER_PLACEHOLDER, workspaceVersion } from './gates.mjs';
import { spawnTool } from './run.mjs';
import { osKey, targetDir } from './smoke.mjs';
import { main as versionCheck } from './version-check.mjs';
import { DEPLOY_DIR, deployConfig, parseJsonc } from './worker-config.mjs';

const IS_WIN = process.platform === 'win32';
const log = (m) => console.log(`release: ${m}`);
const err = (m) => console.error(`::error::release: ${m}`);
const sha256hex = (b) => createHash('sha256').update(b).digest('hex');

// release.yml sign-publish의 preflight가 보는 이름(docs/design/cicd.md §8). 순서가 메시지 순서다
export const RELEASE_SECRETS = [
  'TAURI_SIGNING_PRIVATE_KEY',
  'TAURI_SIGNING_PRIVATE_KEY_PASSWORD',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCOUNT_ID',
  'R2_BUCKET',
  'DIST_BASE_URL',
];
export const preflightMessage = (missing) => `릴리스 시크릿 없음: ${missing.join(', ')}. 빌드·설치 스모크·수집·서명·매니페스트(가짜 S3, stage)까지는 통과, 업로드하지 않음`;
export const REHEARSAL_MESSAGE = '리허설은 업로드하지 않는다(시크릿이 모두 있어도 여기서 멈춘다)';
// 태그 릴리스의 verify는 클라이언트가 받는 길(Worker)로만 다시 받는다(worker.md 구현 중 변경 42 (아), cicd.md 구현 중 변경 104).
// 환경 release의 변수라 gate 작업에서는 보이지 않는다: sign-publish preflight(업로드 전)가 주 검사, verify는 방어다. dry·리허설은 보지 않는다
export const TAG_VERIFY_VIA = 'worker';
export const tagVerifyViaMessage = (got) =>
  `태그 릴리스는 VERIFY_VIA=worker여야 한다(지금 ${JSON.stringify(String(got ?? '').slice(0, 32))}). 환경 release 변수 VERIFY_VIA를 worker로 둔다(worker.md 구현 중 변경 42 (아))`;
export const TAG_VERIFY_TOKEN_MESSAGE = '태그 릴리스는 CI_VERIFY_TOKEN이 필요하다(환경 release secret, verify가 Worker로 다시 받을 때 쓴다)';
// → null(문제 없음) | 메시지 하나(VERIFY_VIA가 먼저)
export function tagVerifyProblem(env) {
  if (env.RELEASE_MODE !== 'tag') return null;
  if (env.VERIFY_VIA !== TAG_VERIFY_VIA) return tagVerifyViaMessage(env.VERIFY_VIA);
  if (!env.CI_VERIFY_TOKEN) return TAG_VERIFY_TOKEN_MESSAGE;
  return null;
}

function ghOutput(env, pairs) {
  if (!env.GITHUB_OUTPUT) return;
  appendFileSync(env.GITHUB_OUTPUT, Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join(''));
}

// ---- semver ----

// xtask/src/semver.rs와 같은 규칙이다(worker.md 구현 중 변경 16 (마)). 공유 벡터 xtask/testdata/semver-vectors.json을
// release.test.mjs가 읽는다. 한쪽만 고치지 않는다.
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const U64_MAX = '18446744073709551615';
// 숫자 문자열 → BigInt(u64 범위) | null. 앞자리 0은 값으로 읽는다(Rust parse::<u64>)
export function parseU64(s) {
  if (!/^\d+$/.test(s)) return null;
  const t = s.replace(/^0+(?=\d)/, '');
  if (t.length > 20 || (t.length === 20 && t > U64_MAX)) return null;
  return BigInt(t);
}
export function parseSemver(v) {
  const m = typeof v === 'string' ? SEMVER.exec(v) : null;
  if (!m) return null;
  const nums = [parseU64(m[1]), parseU64(m[2]), parseU64(m[3])];
  if (nums.some((n) => n === null)) return null;
  return { nums, pre: m[4] ? m[4].split('.') : [] };
}
export function cmpSemver(a, b) {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) throw new Error(`semver가 아니다: ${!x ? a : b}`);
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] < y.nums[i] ? -1 : 1;
  if (!x.pre.length || !y.pre.length) return x.pre.length === y.pre.length ? 0 : x.pre.length ? -1 : 1;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    const [pv, qv] = [parseU64(p), parseU64(q)];
    if (pv !== null && qv !== null) {
      if (pv !== qv) return pv < qv ? -1 : 1;
      continue;
    }
    // 한쪽만 숫자면 숫자가 작다. 둘 다 숫자가 아니면(u64를 넘는 숫자열 포함) 문자열 비교
    if (pv !== null) return -1;
    if (qv !== null) return 1;
    return p < q ? -1 : 1;
  }
  return Math.sign(x.pre.length - y.pre.length);
}

// ---- pubkey ----

// 공개 키 파일 내용 → 문제 목록. Tauri 형식: base64("untrusted comment: minisign public key: <16 hex>\n<base64 56자>\n"), 끝 줄바꿈 없음
export function pubkeyProblems(text) {
  const out = [];
  if (text !== text.trim() || text === '') return ['앞뒤 공백·줄바꿈 없는 base64 한 줄이어야 한다'];
  if (!/^[A-Za-z0-9+/]+=*$/.test(text)) return ['base64가 아니다'];
  const inner = Buffer.from(text, 'base64').toString('utf8');
  if (!/^untrusted comment: minisign public key: [0-9A-F]{16}\nRW[A-Za-z0-9+/]{54}\n$/.test(inner)) out.push('minisign 공개 키 텍스트(base64)가 아니다');
  return out;
}

// app/src-tauri/tauri*.conf.json마다 plugins.updater.pubkey·requireSignedVersion → [{file, pubkey, requireSigned}](없으면 undefined)
export function confPubkeys(root = ROOT) {
  const dir = join(root, 'app/src-tauri');
  return readdirSync(dir)
    .filter((f) => /^tauri(\.[a-z0-9-]+)?\.conf\.json$/.test(f))
    .sort()
    .map((f) => {
      const u = JSON.parse(readFileSync(join(dir, f), 'utf8'))?.plugins?.updater;
      return { file: `app/src-tauri/${f}`, pubkey: u?.pubkey, requireSigned: u?.requireSignedVersion };
    });
}

// release/tauri.release.json(릴리스 빌드가 기본 설정 위에 덮어쓰는 파일) → 문제 목록. 허용 목록이다: bundle.createUpdaterArtifacts
// = true 하나만 둘 수 있다. plugins.updater.pubkey·endpoints 같은 키를 여기서 바꾸면 릴리스 앱만 다른 키·주소를 믿게 되는데
// 다른 어떤 검사도 그 파일을 보지 않는다(리뷰 G6).
export const RELEASE_CONF = 'release/tauri.release.json';
export function releaseConfProblems(conf) {
  const out = [];
  if (!conf || typeof conf !== 'object' || Array.isArray(conf)) return [`${RELEASE_CONF}: 객체가 아니다`];
  for (const k of Object.keys(conf)) if (k !== 'bundle') out.push(`${RELEASE_CONF}: 허용하지 않는 키 ${k}(bundle.createUpdaterArtifacts만 둔다)`);
  const b = conf.bundle;
  if (!b || typeof b !== 'object' || Array.isArray(b)) out.push(`${RELEASE_CONF}: bundle이 객체가 아니다`);
  else {
    for (const k of Object.keys(b)) if (k !== 'createUpdaterArtifacts') out.push(`${RELEASE_CONF}: 허용하지 않는 키 bundle.${k}`);
    if (b.createUpdaterArtifacts !== true) out.push(`${RELEASE_CONF}: bundle.createUpdaterArtifacts가 true가 아니다`);
  }
  return out;
}

export function checkPubkey(root = ROOT) {
  const problems = [];
  const rc = join(root, RELEASE_CONF);
  if (!existsSync(rc)) problems.push(`${RELEASE_CONF}가 없다`);
  else {
    try {
      problems.push(...releaseConfProblems(JSON.parse(readFileSync(rc, 'utf8'))));
    } catch (e) {
      problems.push(`${RELEASE_CONF}: JSON이 아니다(${e.message})`);
    }
  }
  const p = join(root, 'release/updater.pub');
  if (!existsSync(p)) return ['release/updater.pub가 없다'];
  const pub = readFileSync(p, 'utf8');
  for (const x of pubkeyProblems(pub)) problems.push(`release/updater.pub: ${x}`);
  const confs = confPubkeys(root);
  const base = confs.find((c) => c.file === 'app/src-tauri/tauri.conf.json');
  if (!base || base.pubkey === undefined) problems.push('tauri.conf.json에 plugins.updater.pubkey가 없다');
  // 버전 묶인 서명 강제(worker.md 구현 중 변경 79). 플러그인은 serde default라 키 오타·누락이 조용히 false가 된다
  if (!base || base.requireSigned !== true) problems.push('tauri.conf.json plugins.updater.requireSignedVersion이 true가 아니다(다운그레이드 재생 방지)');
  for (const c of confs) {
    // 플랫폼별 덮어쓰기 파일은 pubkey를 두지 않거나 같은 값이어야 한다(다른 키로 바뀐 빌드가 나오지 않게)
    if (c.pubkey !== undefined && c.pubkey !== pub) problems.push(`${c.file} plugins.updater.pubkey ≠ release/updater.pub`);
    if (c.requireSigned !== undefined && c.requireSigned !== true) problems.push(`${c.file} plugins.updater.requireSignedVersion을 끈다`);
  }
  return problems;
}

function cmdPubkey() {
  const problems = checkPubkey();
  for (const p of problems) err(`pubkey: ${p}`);
  if (problems.length) return 1;
  log(`pubkey: release/updater.pub = tauri.conf.json plugins.updater.pubkey, ${RELEASE_CONF}는 허용 목록 안`);
  return 0;
}

// ---- gate ----

const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout ?? '').trim() };
};

// 태그 릴리스 차단(worker.md 구현 중 변경 88 (아)·89, cicd.md 108 (나)). master의 Worker는 루프백(폴링 없음)인데 앱은 아직 폴링을 쓴다:
// 이 사이 태그를 찍으면 deploy-worker가 둘을 함께 배포해 모든 새 로그인이 깨진다. **L2(앱 + 네이티브 E2E) PR이 이 상수를 지운다**(null).
export const TAG_BLOCK = 'login-loopback';
export const TAG_BLOCK_REASON = '앱 로그인 루프백 전환 중(Worker L1 머지, 앱 L2 전)이라 태그 릴리스를 막는다(새 Worker와 폴링 앱이 함께 배포되면 모든 새 로그인이 깨진다)';
// → 차단 사유 | null. tag 모드이고 차단 상수가 있을 때만(RELEASE_TAG가 아니라 모드로 판정: 리허설의 tag 입력은 막지 않는다)
export function tagBlockProblem(mode, block = TAG_BLOCK) {
  return mode === 'tag' && block ? `${TAG_BLOCK_REASON} [${block}]` : null;
}

// 태그 이름과 저장소의 다른 v* 태그 → 문제 목록(단조 증가)
export function tagProblems(tag, others) {
  const v = tag.replace(/^v/, '');
  if (!/^v/.test(tag) || !parseSemver(v)) return [`태그 ${tag}는 v<semver>여야 한다`];
  const out = [];
  for (const o of others) {
    const ov = o.replace(/^v/, '');
    if (!parseSemver(ov)) continue; // semver가 아닌 v* 태그는 비교하지 않는다
    if (cmpSemver(v, ov) <= 0) out.push(`${tag}가 기존 태그 ${o}보다 크지 않다`);
  }
  return out;
}

// ---- 올림 자리(docs/versioning.md) ----

const BUMPS = ['patch', 'minor', 'major'];
const BREAKING_SUBJECT = /^[a-z]+(?:\(.+\))?!: /;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const FEAT_SUBJECT = /^feat(?:\(.+\))?!?: /;

// 지난 릴리스 뒤 커밋 메시지(%B, 머지 커밋 제외) 목록과 지난 버전 → 필요한 최소 올림('patch'|'minor'|'major').
// 깨지는 변경(`type!:`·BREAKING CHANGE 꼬리말)은 MAJOR, 0.x 동안은 MINOR. feat는 MINOR. 나머지는 PATCH
export function requiredBump(messages, prev) {
  const zero = parseSemver(prev).nums[0] === 0n;
  let bump = 'patch';
  for (const m of messages) {
    const subject = m.replace(/\r\n/g, '\n').split('\n')[0];
    if (BREAKING_SUBJECT.test(subject) || BREAKING_FOOTER.test(m)) return zero ? 'minor' : 'major';
    if (FEAT_SUBJECT.test(subject)) bump = 'minor';
  }
  return bump;
}

// 쓰지 않는 MAJOR.MINOR: 비공개 이력의 옛 Go 태그 v0.2.0·v0.2.1과 이름이 겹친다(docs/versioning.md §5). CI 클론에는 그 태그가 없어
// 단조 증가 검사로는 못 막으므로 여기서 막는다
export const RESERVED_MINORS = ['0.2'];
const reserved = (a, b) => RESERVED_MINORS.includes(`${a}.${b}`);

// 지난 버전·올림 → 허용되는 가장 작은 다음 버전(예약된 MAJOR.MINOR는 건너뛴다)
export function minNextVersion(prev, bump) {
  const [a, b, c] = parseSemver(prev).nums;
  if (bump === 'patch' && !reserved(a, b)) return `${a}.${b}.${c + 1n}`;
  let [na, nb] = bump === 'major' ? [a + 1n, 0n] : [a, b + 1n];
  while (reserved(na, nb)) nb++;
  return `${na}.${nb}.0`;
}

// 지난 버전 → 다음 버전이 규칙을 지키는지 → 문제 목록. 더 높게 올리는 건 허용하고(1.0.0 직행), 올린 자리 아래는 0이어야 하며, 예약된 MAJOR.MINOR는 거부한다
export function bumpProblems(prev, next, messages) {
  const p = parseSemver(prev);
  const n = parseSemver(next);
  if (!p || !n) return [`semver가 아니다: ${!p ? prev : next}`];
  if (n.pre.length) return [`${next}: prerelease는 쓰지 않는다`];
  if (cmpSemver(next, prev) <= 0) return [`${next}가 지난 릴리스 ${prev}보다 크지 않다`];
  if (reserved(n.nums[0], n.nums[1])) return [`${next}: ${n.nums[0]}.${n.nums[1]}.x는 옛 태그 이름과 겹쳐 쓰지 않는다(docs/versioning.md §5)`];
  const [na, nb, nc] = n.nums;
  const [pa, pb] = p.nums;
  const actual = na !== pa ? 'major' : nb !== pb ? 'minor' : 'patch';
  const out = [];
  if (actual === 'major' && (nb !== 0n || nc !== 0n)) out.push(`${next}: MAJOR를 올리면 MINOR·PATCH는 0이어야 한다`);
  if (actual === 'minor' && nc !== 0n) out.push(`${next}: MINOR를 올리면 PATCH는 0이어야 한다`);
  const need = requiredBump(messages, prev);
  if (BUMPS.indexOf(actual) < BUMPS.indexOf(need)) out.push(`${prev} 뒤 커밋에 ${need} 올림이 필요한 변경이 있다(최소 ${minNextVersion(prev, need)})`);
  return out;
}

// sha의 조상인 v<semver> 태그 중 version보다 작은 가장 큰 것(없으면 null). 비공개 이력의 태그(조상이 아님)는 고르지 않는다
function previousRelease(sha, version) {
  let best = null;
  for (const t of git(['tag', '-l', 'v*']).out.split('\n')) {
    const v = t.replace(/^v/, '');
    if (!t || !parseSemver(v) || cmpSemver(v, version) >= 0) continue;
    if (best && cmpSemver(v, best.version) <= 0) continue;
    if (git(['merge-base', '--is-ancestor', t, sha]).code !== 0) continue;
    best = { tag: t, version: v };
  }
  return best;
}

// prev 태그부터 sha까지 머지가 아닌 커밋 메시지
function messagesSince(tag, sha) {
  const r = git(['log', '--no-merges', '--no-show-signature', '--format=%B%x00', `${tag}..${sha}`]);
  if (r.code !== 0) throw new Error(`git log ${tag}..${sha} 실패`);
  return r.out.split('\0').map((s) => s.trim()).filter(Boolean);
}

// HEAD 기준으로 다음 릴리스의 최소 버전을 알려 준다(버전을 올리는 PR 전에 사람이 본다)
function cmdNextVersion() {
  const head = git(['rev-parse', 'HEAD']).out;
  const prev = previousRelease(head, '18446744073709551615.0.0');
  if (!prev) {
    err('next-version: HEAD의 조상인 v<semver> 태그가 없다');
    return 1;
  }
  const messages = messagesSince(prev.tag, head);
  const need = requiredBump(messages, prev.version);
  log(`next-version: 지난 릴리스 ${prev.tag}, 커밋 ${messages.length}개, 필요한 올림 ${need} → 최소 ${minNextVersion(prev.version, need)}`);
  return 0;
}

// 태그 gate가 녹색을 요구하는 master ci.yml 작업(GitHub가 보이는 이름 = ci.yml의 `name:`). ci-ok는 필수 체크이고, 네이티브 E2E 둘은
// D14 관찰 중이라 ci-ok 밖(gates.mjs OBSERVED_JOBS)이지만 배포 전에는 녹색이어야 한다(cicd.md 구현 중 변경 107). push는 changes가
// 늘 code=true라 둘은 건너뛰지 않는다(skipped면 실패로 본다)
export const RELEASE_REQUIRED_JOBS = ['ci-ok', 'e2e-native (linux)', 'e2e-native (windows)'];

// master에서 그 커밋을 빌드한 ci.yml push 실행들([{id, status, jobs:[{name, conclusion, status}]}])과 작업 이름 → 'success'|'failure'|'pending'
// 성공: 어느 실행이든 그 작업이 success. 실패: 모든 실행이 끝났고 success가 없다(재실행으로 녹색이 되면 그때 다시 태그).
export function jobDecision(runs, name) {
  if (runs.some((r) => r.jobs.some((j) => j.name === name && j.conclusion === 'success'))) return 'success';
  if (runs.length && runs.every((r) => r.status === 'completed')) return 'failure';
  return 'pending';
}

export const ciOkDecision = (runs) => jobDecision(runs, 'ci-ok');

// RELEASE_REQUIRED_JOBS 모두: 하나라도 실패면 'failure', 아니면 하나라도 기다림이면 'pending', 모두 성공이면 'success'.
// 작업마다 다른 실행(재실행)의 성공을 써도 된다. { decision, failed, pending }
export function releaseJobsDecision(runs, names = RELEASE_REQUIRED_JOBS) {
  const by = names.map((n) => [n, jobDecision(runs, n)]);
  const failed = by.filter(([, d]) => d === 'failure').map(([n]) => n);
  const pending = by.filter(([, d]) => d === 'pending').map(([n]) => n);
  return { decision: failed.length ? 'failure' : pending.length ? 'pending' : 'success', failed, pending };
}

function ghJson(args, env) {
  const r = spawnSync('gh', args, { encoding: 'utf8', env, maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')}: exit ${r.status} ${(r.stderr ?? '').trim().slice(0, 300)}`);
  return JSON.parse(r.stdout || 'null');
}

function masterRuns(env, sha) {
  const repo = env.GITHUB_REPOSITORY;
  const runs = ghJson(['api', `repos/${repo}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=master&per_page=20`, '--jq', '[.workflow_runs[] | {id, status, repo: .head_repository.full_name}]'], env);
  return runs
    .filter((r) => r.repo === repo)
    .map((r) => ({ ...r, jobs: ghJson(['api', `repos/${repo}/actions/runs/${r.id}/jobs?per_page=100`, '--jq', '[.jobs[] | {name, status, conclusion}]'], env) }));
}

async function cmdGate(env) {
  const mode = env.RELEASE_MODE;
  const sha = env.GITHUB_SHA;
  if (!['tag', 'rehearsal'].includes(mode) || !/^[0-9a-f]{40}$/.test(sha ?? '')) {
    err('gate: RELEASE_MODE(tag|rehearsal)·GITHUB_SHA가 필요하다');
    return 2;
  }
  // 0. 태그 차단 상수: 있으면 다른 검사(cargo metadata·ci-ok 기다림) 없이 바로 1
  const blocked = tagBlockProblem(mode);
  if (blocked) {
    err(`gate: ${blocked}`);
    return 1;
  }
  const version = workspaceVersion();
  const tag = env.RELEASE_TAG ?? '';
  let bad = 0;
  // 1. 버전 파일 = 태그(리허설은 tag 입력이 있을 때만 비교: 버전 불일치 입력으로 gate가 빨개지는지 확인하는 용도)
  if (mode === 'tag' || tag) {
    if (versionCheck(['--tag', tag]) !== 0) {
      err(`gate: 버전 파일 ≠ 태그 ${tag}`);
      bad++;
    }
  } else if (versionCheck([]) !== 0) bad++;
  if (mode === 'tag') {
    // 2. 단조 증가: 저장소의 다른 v* 태그보다 커야 한다
    const others = git(['tag', '-l', 'v*']).out.split('\n').filter((t) => t && t !== tag);
    for (const p of tagProblems(tag, others)) {
      err(`gate: ${p}`);
      bad++;
    }
    // 2-1. 올림 자리: 지난 릴리스(조상 태그) 뒤 커밋이 요구하는 자리 이상을 올렸다(docs/versioning.md). 첫 릴리스면 건너뛴다
    try {
      const prev = parseSemver(version) ? previousRelease(sha, version) : null;
      for (const p of prev ? bumpProblems(prev.version, version, messagesSince(prev.tag, sha)) : []) {
        err(`gate: ${p}`);
        bad++;
      }
    } catch (e) {
      err(`gate: 올림 자리 검사 실패: ${e.message}`);
      bad++;
    }
    // 3. 태그 커밋이 master의 조상(master 밖 커밋은 배포하지 않는다)
    if (git(['merge-base', '--is-ancestor', sha, 'origin/master']).code !== 0) {
      err(`gate: ${sha}가 origin/master의 조상이 아니다`);
      bad++;
    }
    // 4. 그 커밋의 master ci-ok와 네이티브 E2E(linux·windows)가 녹색. 태그가 master CI보다 먼저 올 수 있어 기다린다
    if (!bad) {
      const timeout = Number(env.CI_WAIT_TIMEOUT ?? 1800) * 1000;
      const start = Date.now();
      let d = { decision: 'pending', failed: [], pending: RELEASE_REQUIRED_JOBS };
      for (;;) {
        try {
          d = releaseJobsDecision(masterRuns(env, sha));
        } catch (e) {
          err(`gate: ${e.message}`);
          d = { decision: 'pending', failed: [], pending: RELEASE_REQUIRED_JOBS };
        }
        if (d.decision !== 'pending' || Date.now() - start >= timeout) break;
        log(`gate: master ${d.pending.join(', ')}를 기다린다(${Math.round((Date.now() - start) / 1000)}초)`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
      if (d.decision !== 'success') {
        const what = d.decision === 'pending' ? `시간 초과: ${d.pending.join(', ')}` : `실패: ${d.failed.join(', ')}`;
        err(`gate: ${sha}의 master 작업이 녹색이 아니다(${what}). 작업을 다시 돌려 녹색이 되면 이 gate를 다시 돌린다`);
        bad++;
      } else log(`gate: master ${RELEASE_REQUIRED_JOBS.join(', ')} 녹색(${sha})`);
    }
  }
  const pubDate = git(['show', '-s', '--format=%cI', sha]).out;
  ghOutput(env, { version, pub_date: pubDate });
  log(`gate: mode=${mode} version=${version} pub_date=${pubDate}`);
  return bad ? 1 : 0;
}

// ---- xtask 바이너리 ----

const exe = (name) => (IS_WIN ? `${name}.exe` : name);
// 미리 빌드한 xtask를 담는 곳(release.yml xtask 작업이 올리고 시크릿 작업이 받는다. artifact 이름은 release-<v>-*와 겹치지 않는다)
export const XTASK_PACK_DIR = 'target/ci/xtask-bin';
const builtXtask = () => join(targetDir(), 'debug', exe('xtask'));
// 부를 xtask: env XTASK_BIN(미리 빌드해 받은 것) 또는 이 checkout에서 빌드한 것
export const xtaskBin = (env = process.env) => (env.XTASK_BIN ? resolve(ROOT, env.XTASK_BIN) : builtXtask());

function step(what, r) {
  if (r.status !== 0) {
    err(`${what}: exit ${r.status ?? r.error?.message}`);
    return false;
  }
  return true;
}

// xtask를 빌드해 XTASK_PACK_DIR에 담고 sha256을 GITHUB_OUTPUT(sha256)에 쓴다. 시크릿·환경이 없는 작업에서만 부른다:
// 시크릿 작업은 컴파일러를 돌리지 않는다(의존성 build.rs가 GITHUB_ENV·GITHUB_PATH나 target/에 무엇을 남겨도 시크릿 단계에
// 닿지 않게, D10, 리뷰 G6). 시크릿 작업은 받은 바이너리의 sha256을 이 작업의 출력과 맞춘 뒤에만 부른다(prepareXtask).
// cargo에는 받은 env를 그대로 준다: cmdBuild가 DIST_BASE_URL·RELEASE_MODE를 뺀 env를 넘기므로 xtask 의존성 build.rs에도 닿지 않는다
// (cicd.md 구현 중 변경 105 (가)).
export function cmdXtask(env = process.env) {
  if (!step('xtask 빌드', spawnTool('cargo', ['build', '-p', 'xtask', '--locked'], { cwd: ROOT, env }))) return 1;
  const dir = join(ROOT, XTASK_PACK_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const out = join(dir, exe('xtask'));
  cpSync(builtXtask(), out);
  const sha = sha256hex(readFileSync(out));
  ghOutput(env, { sha256: sha });
  log(`xtask: ${XTASK_PACK_DIR}/${exe('xtask')} sha256 ${sha}`);
  return 0;
}

// 미리 빌드한 xtask(XTASK_BIN)를 쓰기 전에: sha256이 XTASK_SHA256(빌드 작업의 출력, artifact 안의 값이 아니다)과 같아야 하고,
// artifact는 실행 비트를 잃으므로 되살린다. tag 모드는 미리 빌드한 xtask만 받는다(시크릿 작업에서 빌드하지 않는다).
// → 문제 문자열 또는 null
export function prepareXtask(env) {
  if (!env.XTASK_BIN) {
    if (env.RELEASE_MODE === 'tag') return 'tag 모드는 미리 빌드한 xtask(XTASK_BIN·XTASK_SHA256)만 부른다';
    return existsSync(builtXtask()) ? null : `${builtXtask()}가 없다(release.mjs xtask 먼저)`;
  }
  if (!/^[0-9a-f]{64}$/.test(env.XTASK_SHA256 ?? '')) return 'XTASK_BIN에는 XTASK_SHA256(xtask 작업의 출력)이 있어야 한다';
  const bin = xtaskBin(env);
  if (!existsSync(bin)) return `${bin}가 없다(xtask artifact를 받지 않았다)`;
  const got = sha256hex(readFileSync(bin));
  if (got !== env.XTASK_SHA256) return `${bin} sha256 ${got} ≠ xtask 작업의 출력 ${env.XTASK_SHA256}`;
  if (!IS_WIN) chmodSync(bin, 0o755);
  return null;
}

// xtask release <args>. XTASK_ROOT: 미리 빌드한 바이너리도 이 checkout의 release/ 표·스키마를 읽게 한다
function xtask(args, env = process.env, opts = {}) {
  const bin = xtaskBin(env);
  if (!existsSync(bin)) return { status: 2, error: new Error(`${bin}가 없다(release.mjs xtask 먼저)`) };
  return spawnSync(bin, ['release', ...args], { stdio: 'inherit', env: { ...env, XTASK_ROOT: ROOT }, cwd: ROOT, ...opts });
}

// ---- build(OS마다) ----

// 릴리스 빌드의 Worker 주소(worker.md §11.1, cicd.md 82 (나), 구현 중 변경 105). → { mode, base, problems }
// 태그: DIST_BASE_URL(저장소 secret)을 그대로 쓴다. 경로 없는 https 출처이고 자리표시(.invalid)가 아니어야 한다.
// 그 밖(리허설·ci.yml·로컬): CHZZK_WORKER_BASE가 있으면 그것, 없으면 자리표시. 메시지에는 값을 넣지 않는다
const safeHost = (v) => {
  try {
    return new URL(v).hostname;
  } catch {
    return '';
  }
};
export function buildWorkerBase(env) {
  if (env.RELEASE_MODE === 'tag') {
    const v = env.DIST_BASE_URL || '';
    const problems = [];
    if (!v) problems.push('태그 빌드에 DIST_BASE_URL이 없다(release.yml release-build 단계의 secrets.DIST_BASE_URL)');
    else {
      if (distBaseProblems(v).length) problems.push('DIST_BASE_URL은 경로 없는 https 출처여야 한다(값은 찍지 않는다)');
      if (v === WORKER_PLACEHOLDER || /\.invalid$/.test(safeHost(v))) problems.push('태그 빌드에 자리표시 주소(.invalid)를 넣을 수 없다');
    }
    return { mode: 'tag', base: v, problems };
  }
  return { mode: 'other', base: env.CHZZK_WORKER_BASE || WORKER_PLACEHOLDER, problems: [] };
}

// 태그 빌드 바이너리 검사(D8): 원본 실행 파일에 넣은 출처 바이트가 있고 자리표시 호스트가 없어야 한다.
// 번들(dmg·msi·deb·AppImage·tar.gz)은 압축이라 stage에서는 볼 수 없다. → 문제 목록(값 없음)
export function binaryWorkerBaseProblems(buf, { mode, base }) {
  if (mode !== 'tag') return [];
  const out = [];
  if (!buf.includes(Buffer.from(base, 'utf8'))) out.push('릴리스 바이너리에 DIST_BASE_URL이 없다(build.rs가 다른 값을 넣었다)');
  if (buf.includes(Buffer.from(new URL(WORKER_PLACEHOLDER).hostname, 'utf8'))) out.push('릴리스 바이너리에 자리표시 호스트가 있다');
  return out;
}

function cmdBuild(env) {
  const os = osKey();
  const spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'))[os];
  if (!spec) {
    err(`build: ${os}의 항목이 release/expected-artifacts.json에 없다`);
    return 2;
  }
  const wb = buildWorkerBase(env);
  if (wb.mode === 'tag') for (const m of maskValues(wb.base)) console.log(`::add-mask::${m}`);
  if (wb.problems.length) {
    for (const p of wb.problems) err(`build: ${p}`);
    return 1;
  }
  // 자식(pnpm·tauri·cargo·의존성 build.rs)에는 주소만 넘긴다. DIST_BASE_URL·RELEASE_MODE는 빼고 CHZZK_WORKER_BASE를 정한다
  const { DIST_BASE_URL: _d, RELEASE_MODE: _m, ...rest } = env;
  const childEnv = { ...rest, CHZZK_WORKER_BASE: wb.base };
  const version = workspaceVersion();
  const work = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'chzzk-eph-'));
  const key = join(work, 'eph.key');
  const pw = randomBytes(18).toString('hex');
  try {
    // 1. 임시 키(createUpdaterArtifacts는 키 없이 빌드가 실패한다). 진짜 키는 이 작업에 오지 않는다(D10)
    if (!step('임시 키 만들기', spawnTool('pnpm', ['tauri', 'signer', 'generate', '--ci', '-p', pw, '-w', key, '-f'], { cwd: join(ROOT, 'app'), env: childEnv }))) return 1;
    const eph = { ...childEnv, TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pw };
    if (os === 'linux') eph.APPIMAGE_EXTRACT_AND_RUN = '1';
    // 2. 릴리스 번들 + updater 산출물
    const conf = resolve(ROOT, 'release/tauri.release.json');
    if (!step('tauri build', spawnTool('pnpm', ['tauri', 'build', '--ci', '--config', conf, '--bundles', spec.bundles.join(',')], { cwd: join(ROOT, 'app'), env: eph }))) return 1;
    // 태그 빌드는 원본 바이너리에서 주소를 확인한다(번들은 압축이라 stage에서 바이트를 볼 수 없다, D8)
    const bin = join(targetDir(childEnv), 'release', `chzzk-app${os === 'windows' ? '.exe' : ''}`);
    const bp = binaryWorkerBaseProblems(readFileSync(bin), wb);
    if (bp.length) {
      for (const p of bp) err(`build: ${p}`);
      return 1;
    }
    // 3. 모으기(표와 정확히 같은 집합, Tauri가 만든 임시 .sig는 따로)
    const sigDir = join(work, 'tauri-sig');
    if (!step('collect --release', spawnSync(process.execPath, [join(ROOT, 'scripts/ci/bundle.mjs'), 'collect', '--release'], { stdio: 'inherit', env: { ...childEnv, RELEASE_TAURI_SIG_DIR: sigDir } }))) return 1;
    // 4. 서명 형식 자체 확인: Tauri CLI의 서명을 xtask(updater와 같은 검증)가 받고, xtask가 같은 키로 한 서명도 받는다.
    //    tauri-cli 2.12.1의 서명에는 version 필드가 없어 그 단계만 --allow-unversioned다. 올리는 서명(xtask sign)은 버전에 묶인다(worker.md 구현 중 변경 79)
    if (cmdXtask({ ...childEnv, GITHUB_OUTPUT: '' }) !== 0) return 1;
    const check = join(work, 'check');
    const bundle = join(ROOT, 'target/ci/bundle');
    const ok =
      step('xtask collect --os', xtask(['collect', '--from', bundle, '--out', check, '--version', version, '--os', os], childEnv)) &&
      step('Tauri CLI 서명 검증', xtask(['verify-sig', '--dir', check, '--sig-dir', sigDir, '--pubkey', `${key}.pub`, '--allow-unversioned'], childEnv)) &&
      step('xtask 서명', xtask(['sign', '--dir', check], { ...childEnv, TAURI_SIGNING_PRIVATE_KEY: eph.TAURI_SIGNING_PRIVATE_KEY, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pw })) &&
      step('xtask 서명 검증', xtask(['verify-sig', '--dir', check, '--pubkey', `${key}.pub`], childEnv));
    if (!ok) return 1;
    log(`build: ${os} 번들·updater 산출물 모음, Worker 주소 ${wb.mode === 'tag' ? '태그(DIST_BASE_URL, 바이너리 확인)' : '자리표시 또는 CHZZK_WORKER_BASE'}, 임시 서명 형식 확인(임시 키·서명은 버린다)`);
    return 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- 모드·경계 ----

// publish·verify·rollback의 RELEASE_MODE:
//   tag: 진짜 릴리스(R2, 시크릿, 환경 release). DRY_OVERRIDES(R2_ENDPOINT·RELEASE_PUBKEY·RELEASE_VERSION·RELEASE_STAGE_DIR·WORKER_BUNDLE·
//        WORKER_SECRET_LIST·XTASK_LIST_MAX_KEYS) 덮어쓰기를 받지 않고 미리 빌드한 xtask(XTASK_BIN + XTASK_SHA256)만 부른다.
//        WORKER_BUNDLE(묶음 위치)·WORKER_SECRET_LIST(secret list 출력 주입)·XTASK_LIST_MAX_KEYS(prune 목록 페이지 크기, 잘림 시험용)도 dry에서만 받는다.
//   dry: 가짜 S3(release.yml stage 작업과 selftest). R2_ENDPOINT가 루프백이어야 하고 위 덮어쓰기를 받는다.
// 같은 publish·verify 코드가 두 모드에서 돈다(selftest·stage가 배포하는 코드를 그대로 부른다, 리뷰 G6).
export const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;
export const DRY_OVERRIDES = ['R2_ENDPOINT', 'RELEASE_PUBKEY', 'RELEASE_VERSION', 'RELEASE_STAGE_DIR', 'WORKER_BUNDLE', 'WORKER_SECRET_LIST', 'XTASK_LIST_MAX_KEYS'];
export function boundaryProblems(env) {
  const mode = env.RELEASE_MODE;
  if (mode === 'tag') return DRY_OVERRIDES.filter((n) => env[n]).map((n) => `tag 모드는 ${n}를 받지 않는다(진짜 릴리스를 다른 곳·키·버전으로 돌리지 못하게)`);
  if (mode === 'dry') return LOOPBACK.test(env.R2_ENDPOINT ?? '') ? [] : [`dry 모드의 R2_ENDPOINT는 루프백(가짜 S3)이어야 한다: ${JSON.stringify(env.R2_ENDPOINT ?? '')}`];
  return [`RELEASE_MODE는 tag|dry여야 한다: ${JSON.stringify(mode ?? '')}`];
}
const dry = (env) => env.RELEASE_MODE === 'dry';
const pubkeyPath = (env) => (dry(env) && env.RELEASE_PUBKEY ? resolve(env.RELEASE_PUBKEY) : join(ROOT, 'release/updater.pub'));
const releaseVersion = (env) => (dry(env) && env.RELEASE_VERSION ? env.RELEASE_VERSION : workspaceVersion());
const stageDir = (env) => (dry(env) && env.RELEASE_STAGE_DIR ? resolve(env.RELEASE_STAGE_DIR) : join(ROOT, 'target/ci/release-stage'));

// publish·verify·rollback의 공통 시작(경계 → xtask). 문제가 있으면 2
function begin(what, env) {
  const problems = boundaryProblems(env);
  if (!problems.length) {
    const x = prepareXtask(env);
    if (x) problems.push(x);
  }
  for (const p of problems) err(`${what}: ${p}`);
  return problems.length ? 2 : 0;
}

// ---- preflight / publish / verify / rollback ----

export function preflight(env) {
  const missing = RELEASE_SECRETS.filter((n) => !env[n]);
  if (missing.length) return { code: 1, message: preflightMessage(missing), missing };
  if (env.RELEASE_MODE !== 'tag' && env.RELEASE_MODE !== 'dry') return { code: 1, message: REHEARSAL_MESSAGE, missing };
  // 매니페스트 url이 `${DIST_BASE_URL}/releases/<v>/<file>`이라 값은 경로 없는 https 출처여야 한다(cicd.md 82 (가)). 값은 찍지 않는다
  if (distBaseProblems(env.DIST_BASE_URL).length) return { code: 1, message: 'DIST_BASE_URL은 경로 없는 https 출처여야 한다(값은 찍지 않는다)', missing: [] };
  const via = tagVerifyProblem(env);
  if (via) return { code: 1, message: `${via}. 업로드하지 않음`, missing: [] };
  return { code: 0, message: null, missing };
}

// 태그 릴리스의 업로드 전 Worker 프로브(cicd.md 구현 중 변경 104 (가)): verify가 Worker로 다시 받을 수 있는지 한 번 본다.
// 토큰 drift(환경 release의 CI_VERIFY_TOKEN ≠ Worker secret)·Worker 장애를 업로드·승격 뒤 verify의 exit 2(되돌리지 않음)가 아니라
// 업로드 전 1로 잡는다. GET(Worker는 HEAD도 받지만 가짜 Worker는 GET만 받는다), 리디렉션은 따라가지 않는다(3xx는 실패).
//   200: 토큰이 맞고 latest.json이 있다 / 404: 토큰이 맞고 latest.json이 없다(첫 릴리스. Worker는 자격을 R2보다 먼저 본다, releases.ts)
//   401·403·그 밖의 상태·네트워크·시간 초과: 실패
// 출력은 상태 코드나 오류 이름뿐이다(본문·토큰·주소를 싣지 않는다). base는 인자로 받는다(시험은 루프백 http를 준다)
export const TAG_PROBE_TIMEOUT_MS = 10_000;
export async function probeVerifyWorker({ base, token, fetchImpl = fetch, timeoutMs = TAG_PROBE_TIMEOUT_MS }) {
  try {
    const r = await fetchImpl(`${base}/${LATEST_KEY}`, { method: 'GET', redirect: 'manual', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
    await r.body?.cancel().catch(() => {});
    if (r.status === 200 || r.status === 404) return { code: 0, status: r.status };
    const why = r.status === 401 || r.status === 403 ? '토큰이 Worker secret과 다르다(환경 release의 CI_VERIFY_TOKEN을 확인한다)' : 'Worker 응답이 예상 밖이다';
    return { code: 1, status: r.status, message: `태그 릴리스 Worker 프로브 실패(HTTP ${r.status}): ${why}` };
  } catch (e) {
    const c = String(e?.cause?.code ?? e?.name ?? 'error');
    const cause = /^[A-Za-z0-9_.-]{1,40}$/.test(c) ? c : 'error';
    return { code: 1, cause, message: `태그 릴리스 Worker 프로브 실패(${cause}): Worker에 닿지 못했다` };
  }
}

// preflight + (tag만) Worker 프로브. dry·리허설·stage·selftest는 RELEASE_MODE가 tag가 아니라 프로브하지 않는다
async function tagProbe(env, what) {
  if (env.RELEASE_MODE !== 'tag') return 0;
  const p = await probeVerifyWorker({ base: env.DIST_BASE_URL, token: env.CI_VERIFY_TOKEN });
  if (p.code === 0) {
    log(`${what}: Worker 프로브 통과(HTTP ${p.status})`);
    return 0;
  }
  console.error(`::error::${p.message}. 업로드하지 않음`);
  return 1;
}

async function cmdPreflight(env) {
  const r = preflight(env);
  ghOutput(env, { missing: r.missing.join(',') });
  if (r.code) {
    console.error(`::error::${r.message}`);
    return r.code;
  }
  log('preflight: 시크릿·변수 모두 있음');
  return tagProbe(env, 'preflight');
}

// 업로드 순서(이 목록 하나뿐이다: release.yml sign-publish, stage, selftest가 모두 이 함수를 지난다)
export const PUBLISH_STEPS = ['collect', 'sign', 'verify-sig', 'sums', 'manifest', 'put', 'promote'];

async function cmdPublish(env) {
  const p = preflight(env);
  if (p.code) {
    console.error(`::error::${p.message}`);
    return 1;
  }
  if (begin('publish', env)) return 2;
  // 업로드 직전 마지막 검사(경계·xtask 뒤): preflight 단계와 같은 프로브를 다시 본다
  if (await tagProbe(env, 'publish')) return 1;
  const version = releaseVersion(env);
  const stage = stageDir(env);
  rmSync(stage, { recursive: true, force: true });
  const from = resolve(env.RELEASE_IN || join(ROOT, 'target/ci/release-in'));
  const pub = pubkeyPath(env);
  const args = {
    collect: ['collect', '--from', from, '--out', stage, '--version', version],
    sign: ['sign', '--dir', stage],
    // 시크릿의 개인 키가 커밋된 공개 키와 짝인지(아니면 아무것도 올리지 않는다)
    'verify-sig': ['verify-sig', '--dir', stage, '--pubkey', pub],
    sums: ['sums', '--dir', stage],
    manifest: ['manifest', '--dir', stage, '--version', version, '--pub-date', env.RELEASE_PUB_DATE ?? '', '--base-url', env.DIST_BASE_URL],
    put: ['put', '--dir', stage, '--version', version],
    // 마지막: releases/latest.json(CAS)
    promote: ['promote', '--dir', stage, '--version', version],
  };
  for (const name of PUBLISH_STEPS) if (!step(`publish ${name}`, xtask(args[name], env))) return 1;
  log(`publish: ${version} 올림, latest.json 승격(${env.RELEASE_MODE})`);
  return 0;
}

export const LATEST_KEY = 'releases/latest.json';

// 객체 하나 → { code: 0 있음 | 1 없음 | 2 기반 시설 오류, data }
// timeoutMs: 하위 프로세스 상한(deploy-worker만 준다, workerWorstCaseMs). 넘기면 status null → 기반 시설(2)
function getObject(env, key, { timeoutMs } = {}) {
  const dir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'release-get-'));
  try {
    const out = join(dir, 'obj');
    const r = xtask(['get', '--key', key, '--out', out], env, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...(timeoutMs ? { timeout: timeoutMs } : {}) });
    if (r.status === 0) return { code: 0, data: readFileSync(out) };
    if (r.status === 1) return { code: 1, data: null };
    process.stderr.write(r.stderr ?? '');
    if (r.status === null) err(`get ${key}: ${timeoutMs}ms 상한을 넘겼다(기반 시설)`);
    return { code: 2, data: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const versionOf = (bytes) => {
  try {
    const v = JSON.parse(bytes.toString('utf8'))?.version;
    return typeof v === 'string' ? v : '?';
  } catch {
    return '?';
  }
};

// 지금 latest.json의 버전(없으면 null, 읽을 수 없으면 '?')과 이번 버전 → 할 일(verify 결정표, release.test.mjs가 표로 본다)
//   full:         latest = 이번 버전. 전부 확인하고 판정 실패(1)면 prev로 되돌린다. 기반 시설 오류(2)는 되돌리지 않는다.
//   superseded:   latest가 더 높은 버전(다른 태그 실행이 뒤에 승격했다). 이번 버전의 객체만 확인하고 되돌리지 않는다.
//   not-promoted: latest가 없거나 낮거나 읽을 수 없다(승격 전에 실패). 바뀐 것이 없어 되돌리지 않고 실패한다.
export function verifyPlan(latest, version) {
  if (latest === version) return 'full';
  if (latest && parseSemver(latest) && cmpSemver(latest, version) > 0) return 'superseded';
  return 'not-promoted';
}

const validPrev = (v) => v === 'none' || !!parseSemver(v);

// release.yml verify 작업(sign-publish가 어떻게 끝났든 돈다: 승격 뒤에 실패하거나 취소돼도 latest.json을 확인한다)
function cmdVerify(env) {
  // 시크릿이 없으면(sign-publish가 preflight에서 멈춘 태그 실행) 같은 메시지로 멈춘다(기반 시설 오류로 보이지 않게)
  const missing = RELEASE_SECRETS.filter((n) => !n.startsWith('TAURI_') && !env[n]);
  if (missing.length) {
    console.error(`::error::${preflightMessage(missing)}`);
    return 1;
  }
  // 방어: preflight 뒤 변수가 바뀌었으면 xtask를 부르기 전에 멈춘다. 판정이 아니므로 되돌리지 않는다(2)
  const via = tagVerifyProblem(env);
  if (via) {
    err(`verify: ${via} — 판정이 아니므로 되돌리지 않는다`);
    return 2;
  }
  if (begin('verify', env)) return 2;
  const version = releaseVersion(env);
  const envPrev = env.RELEASE_PREV ?? '';
  if (envPrev && !validPrev(envPrev)) {
    err(`verify: RELEASE_PREV(sign-publish의 prev 출력) 형식이 아니다: ${JSON.stringify(envPrev)}`);
    return 2;
  }
  const base = ['--pubkey', pubkeyPath(env), '--base-url', env.DIST_BASE_URL ?? ''];
  const cur = getObject(env, LATEST_KEY);
  if (cur.code === 2) {
    err('verify: latest.json을 읽지 못했다(기반 시설 오류) — 판정이 아니므로 되돌리지 않는다. verify 작업을 다시 실행한다');
    return 2;
  }
  const latest = cur.data ? versionOf(cur.data) : null;
  const plan = verifyPlan(latest, version);
  ghOutput(env, { plan });
  if (plan === 'not-promoted') {
    err(`verify: latest.json이 ${latest ?? '없음'}이다 — ${version}은 승격되지 않았다(바뀐 것이 없어 되돌리지 않는다)`);
    return 1;
  }
  if (plan === 'superseded') {
    const c = xtask(['verify', '--version', version, ...base, '--objects-only'], env).status;
    if (c === 0) console.log(`::notice::release verify: latest.json은 더 높은 ${latest}다(나중 태그가 승격). ${version}은 객체만 확인했고 통과`);
    else err(`verify: ${version} 객체 확인 실패(exit ${c}). latest.json은 ${latest}라 되돌리지 않는다`);
    return c === 0 ? 0 : c === 2 ? 2 : 1;
  }
  const c = xtask(['verify', '--version', version, ...base], env).status;
  if (c === 0) {
    log(`verify: ${version} 통과`);
    return 0;
  }
  if (c !== 1) {
    err(`verify: 기반 시설 오류(exit ${c}) — 판정이 아니므로 되돌리지 않는다. verify 작업을 다시 실행한다(docs/design/cicd.md §5.7)`);
    ghOutput(env, { rolled_back: 'no' });
    return 2;
  }
  // 판정 실패 → prev로 되돌린다. prev는 sign-publish의 출력, 없으면(승격 뒤 그 작업이 실패·취소) releases/<v>/previous
  let prev = envPrev;
  if (!prev) {
    const p = getObject(env, `releases/${version}/previous`);
    const t = p.code === 0 ? p.data.toString('utf8') : '';
    prev = validPrev(t) ? t : '';
  }
  if (!prev) {
    err(`verify: ${version} 확인 실패인데 되돌릴 버전을 모른다(releases/${version}/previous 없음) — 사람이 rollback.yml로 되돌린다`);
    ghOutput(env, { rolled_back: 'failed' });
    return 1;
  }
  err(`verify: ${version} 확인 실패 → ${prev}로 되돌린다`);
  const r = xtask(['rollback', '--to', prev, '--from', version, ...base], env);
  if (r.status === 0) err(`verify: latest.json을 ${prev}로 되돌렸다(실패한 버전의 객체는 진단용으로 남긴다)`);
  else err('verify: 되돌리기도 실패했다 — 사람이 rollback.yml로 되돌린다');
  ghOutput(env, { rolled_back: r.status === 0 ? prev : 'failed' });
  return 1;
}

// rollback.yml: latest.json을 ROLLBACK_VERSION으로(낮은 버전으로 되돌리기, 잘못 되돌린 뒤 다시 올리기 모두. none이면 지운다)
function cmdRollback(env) {
  const v = env.ROLLBACK_VERSION ?? '';
  if (!validPrev(v)) {
    err(`rollback: ROLLBACK_VERSION은 semver 또는 none: ${JSON.stringify(v)}`);
    return 2;
  }
  const missing = RELEASE_SECRETS.filter((n) => !n.startsWith('TAURI_') && !env[n]);
  if (missing.length) {
    console.error(`::error::${preflightMessage(missing)}`);
    return 1;
  }
  if (begin('rollback', env)) return 2;
  const r = xtask(['rollback', '--to', v, '--pubkey', pubkeyPath(env), '--base-url', env.DIST_BASE_URL], env);
  return r.status === 0 ? 0 : r.status === 2 ? 2 : 1;
}

// ---- 보존 상한(prune, worker.md 구현 중 변경 11 (마), cicd.md 구현 중 변경 97) ----

// releases/ 아래에 남기는 버전 수(최신순). latest·그 previous는 이 수와 별개로 늘 남긴다
export const RELEASE_KEEP = 5;

// 목록 키(releases/<dir>/…) + latest + previous → { keep, delete, ignored, abort? }(순수, release.test.mjs가 표로 본다).
// keep개는 latest 이하 버전에서 최신순으로 센다. latest보다 높은 폴더(판정 실패로 되돌린 버전, 올리는 중인 버전, rollback.yml로
// 다시 올릴 수 있는 버전)는 늘 남기고 자리로 세지 않는다(cicd.md 구현 중 변경 97 (나)). 지우는 것은 latest 이하 semver 디렉터리 중
// (최신 keep개 ∪ latest ∪ previous) 밖이다. semver가 아닌 디렉터리는 건드리지 않는다(ignored).
// latest가 semver가 아니거나 목록에 없으면 목록을 믿을 수 없으므로 아무것도 지우지 않는다(abort).
export function prunePlan({ keys, latest, previous, keep = RELEASE_KEEP }) {
  if (!Number.isInteger(keep) || keep < 1) throw new Error(`keep은 1 이상의 정수여야 한다: ${keep}`);
  const dirs = [...new Set(keys.map((k) => /^releases\/([^/]+)\//.exec(k)?.[1]).filter((d) => d !== undefined))];
  const ignored = dirs.filter((d) => !parseSemver(d)).sort();
  const versions = dirs.filter((d) => parseSemver(d)).sort((a, b) => cmpSemver(b, a) || (a < b ? -1 : 1));
  if (!parseSemver(latest)) return { keep: [], delete: [], ignored, abort: 'latest가 semver가 아니다' };
  if (!versions.includes(latest)) return { keep: [], delete: [], ignored, abort: `latest(${latest})가 목록에 없다 — 목록을 믿을 수 없어 지우지 않는다` };
  const above = versions.filter((v) => cmpSemver(v, latest) > 0);
  const keepSet = new Set([...above, ...versions.filter((v) => cmpSemver(v, latest) <= 0).slice(0, keep), latest]);
  if (parseSemver(previous)) keepSet.add(previous);
  return { keep: versions.filter((v) => keepSet.has(v)), delete: versions.filter((v) => !keepSet.has(v)).reverse(), ignored };
}

// prune 작업에 R2 설정이 없을 때(sign-publish의 preflight 문구와 다르다: 업로드와 상관없는 작업이다)
export const pruneMissingMessage = (missing) => `prune: R2 설정 없음(시크릿·변수): ${missing.join(', ')}. 지우지 않는다`;

// release.yml prune 작업·stage·selftest. latest가 이번 버전일 때만 지운다(latest를 가진 실행만): 나중 태그가 승격했거나 되돌려졌으면
// 이번 실행은 아무것도 지우지 않는다. 지울 목록은 prunePlan이 정하고, 지우는 일은 xtask delete-version(latest·previous를 다시 확인)이 한다.
function cmdPrune(env) {
  const missing = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET'].filter((n) => !env[n]);
  if (missing.length) {
    console.error(`::error::${pruneMissingMessage(missing)}`);
    return 1;
  }
  if (begin('prune', env)) return 2;
  const version = releaseVersion(env);
  const cur = getObject(env, LATEST_KEY);
  if (cur.code === 2) return 2;
  const latest = cur.data ? versionOf(cur.data) : null;
  if (latest !== version) {
    console.log(`::notice::release prune: latest.json이 ${latest ?? '없음'}이라 ${version} 실행은 지우지 않는다(latest를 가진 실행이 지운다)`);
    return 0;
  }
  const p = getObject(env, `releases/${version}/previous`);
  if (p.code === 2) return 2;
  if (p.code === 1) {
    err(`prune: releases/${version}/previous가 없다 — 지우지 않는다`);
    return 1;
  }
  const previous = p.data.toString('utf8');
  if (!validPrev(previous)) {
    err(`prune: releases/${version}/previous 형식이 아니다 — 지우지 않는다`);
    return 1;
  }
  const ls = xtask(['list-keys', '--prefix', 'releases/'], env, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (ls.status !== 0) return ls.status === 1 ? 1 : 2;
  const keys = (ls.stdout ?? '').split('\n').filter(Boolean);
  const plan = prunePlan({ keys, latest, previous });
  if (plan.abort) {
    err(`prune: ${plan.abort}`);
    return 1;
  }
  log(`prune: 남김 [${plan.keep.join(', ')}] 지움 [${plan.delete.join(', ')}] 모름 [${plan.ignored.join(', ')}]`);
  for (const v of plan.delete) {
    const c = xtask(['delete-version', '--version', v], env).status;
    if (c !== 0) return c === 1 ? 1 : 2;
  }
  log(`prune: ${plan.delete.length}개 버전 지움`);
  return 0;
}

// ---- 가짜 S3 실행(stage·selftest) ----

export const FAKE_BASE = 'https://dist.example.invalid';

function startFake(creds) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [join(ROOT, 'scripts/ci/s3-fake.mjs'), '--bucket', creds.R2_BUCKET, '--access', creds.R2_ACCESS_KEY_ID, '--secret', creds.R2_SECRET_ACCESS_KEY], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      const m = /listening (\d+)/.exec(buf);
      if (m) {
        const port = Number(m[1]);
        // 가짜 서버는 5초 놀면 연결을 닫는다. 오래 걸리는 하위 프로세스 뒤에는 풀의 연결이 죽어 있을 수 있어 닫는 요청으로 보내고,
        // 그래도 실패하면 한 번 더 시도한다
        const post = (f) => fetch(`http://127.0.0.1:${port}/__fault`, { method: 'POST', body: JSON.stringify(f), headers: { connection: 'close' } }).then((r) => r.status);
        const fault = (f) => post(f).catch(() => post(f));
        res({ port, fault, stop: () => p.kill() });
      }
    });
    p.on('exit', (c) => rej(new Error(`s3-fake가 끝났다(${c})`)));
  });
}

// scripts/ci/worker-stub.mjs(가짜 Worker)를 별도 프로세스로 띄운다 → { port, set(설정), stop }
function startWorkerStub({ token, version, build }) {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [join(ROOT, 'scripts/ci/worker-stub.mjs'), '--token', token, '--version', version, '--build', build], { stdio: ['ignore', 'pipe', 'inherit'] });
    let buf = '';
    p.stdout.on('data', (c) => {
      buf += c;
      const m = /listening (\d+)/.exec(buf);
      if (m) {
        const port = Number(m[1]);
        const post = (o) => fetch(`http://127.0.0.1:${port}/__set`, { method: 'POST', body: JSON.stringify(o), headers: { connection: 'close' } }).then((r) => r.status);
        res({ port, set: (o) => post(o).catch(() => post(o)), stop: () => p.kill() });
      }
    });
    p.on('exit', (c) => rej(new Error(`worker-stub이 끝났다(${c})`)));
  });
}

const fakeCreds = () => ({ R2_ACCESS_KEY_ID: 'dry-access', R2_SECRET_ACCESS_KEY: randomBytes(16).toString('hex'), R2_BUCKET: 'dry-bucket', R2_ACCOUNT_ID: 'dry-run', R2_REGION: 'auto' });

// dry 모드 env: 가짜 S3 자격 증명·루프백 엔드포인트·시험 키. 시크릿 이름은 모두 채운다(preflight가 진짜와 같은 길로 지난다)
function dryEnv(env, creds, port, { key, pw, pub }) {
  const D = { ...env, ...creds, RELEASE_MODE: 'dry', R2_ENDPOINT: `http://127.0.0.1:${port}`, DIST_BASE_URL: FAKE_BASE, TAURI_SIGNING_PRIVATE_KEY: readFileSync(key, 'utf8'), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: pw, RELEASE_PUBKEY: pub };
  for (const n of ['VERIFY_VIA', 'CI_VERIFY_TOKEN', 'RELEASE_PREV', 'GITHUB_OUTPUT']) delete D[n];
  return D;
}

// release.mjs <cmd>를 하위 프로세스로(배포하는 진입점 그대로)
function runRelease(cmd, env, capture = false, args = []) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), cmd, ...args], { env, cwd: ROOT, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', maxBuffer: 1 << 26 });
  return { status: r.status, out: capture ? `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() : '' };
}

const readOutput = (file) =>
  existsSync(file)
    ? Object.fromEntries(
        readFileSync(file, 'utf8')
          .split('\n')
          .filter((l) => l.includes('='))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      )
    : {};

// release.yml stage 작업(시크릿·환경 없음, 리허설과 태그 모두): 진짜로 받은 3 OS artifact로 publish → verify를 가짜 S3에 그대로
// 돌린다(collect의 OS 집합·bundles.json 하나씩·download-artifact 폴더 모양, 진짜 크기 파일의 서명·SHA256SUMS·매니페스트·put·
// promote·다시 받아 확인). 키는 xtask keygen 임시 키다. 리허설은 여기서 끝난다(업로드 경계). 태그는 sign-publish가 진짜로 돈다.
async function cmdStage(env) {
  const mode = env.RELEASE_MODE;
  if (mode !== 'tag' && mode !== 'rehearsal') {
    err(`stage: RELEASE_MODE는 tag|rehearsal: ${JSON.stringify(mode ?? '')}`);
    return 2;
  }
  const pre = prepareXtask({ ...env, RELEASE_MODE: 'dry' });
  if (pre) {
    err(`stage: ${pre}`);
    return 2;
  }
  const work = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'release-stage-'));
  const creds = fakeCreds();
  let fake;
  try {
    const key = join(work, 'eph.key');
    const pw = randomBytes(18).toString('hex');
    if (!step('임시 키', xtask(['keygen', '--out', key], { ...env, XTASK_KEY_PASSWORD: pw }))) return 1;
    fake = await startFake(creds);
    const out = join(work, 'publish.out');
    const D = { ...dryEnv(env, creds, fake.port, { key, pw, pub: `${key}.pub` }), RELEASE_IN: env.RELEASE_IN || join(ROOT, 'target/ci/release-in'), RELEASE_STAGE_DIR: join(work, 'stage') };
    if (runRelease('publish', { ...D, GITHUB_OUTPUT: out }).status !== 0) {
      err('stage: publish(가짜 S3)가 실패했다');
      return 1;
    }
    const prev = readOutput(out).prev;
    if (prev !== 'none') {
      err(`stage: 빈 가짜 버킷인데 prev가 ${JSON.stringify(prev)}다`);
      return 1;
    }
    if (runRelease('verify', { ...D, RELEASE_PREV: prev, GITHUB_OUTPUT: join(work, 'verify.out') }).status !== 0) {
      err('stage: verify(가짜 S3)가 실패했다');
      return 1;
    }
    // verify 뒤 보존 상한(빈 버킷이라 지우는 것이 없다. 진짜 prune 작업과 같은 진입점이 도는지 본다)
    if (runRelease('prune', { ...D, GITHUB_OUTPUT: join(work, 'prune.out') }).status !== 0) {
      err('stage: prune(가짜 S3)이 실패했다');
      return 1;
    }
    const next = mode === 'tag' ? 'sign-publish가 진짜 키·R2로 같은 단계를 돈다' : '리허설은 여기서 끝난다(업로드 경계, 진짜 키·R2에는 닿지 않는다)';
    console.log(`::notice::release stage: 받은 3 OS 산출물로 collect·서명·서명 검증·SHA256SUMS·매니페스트·put·promote·verify·prune을 가짜 S3에서 통과. ${next}`);
    return 0;
  } catch (e) {
    err(`stage: ${e.message}`);
    return 1;
  } finally {
    fake?.stop();
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- selftest(가짜 S3) ----

// 표의 산출물마다 합성 파일(버전마다 다른 내용)을 download-artifact가 만드는 모양(<dir>/release-<v>-<os>/)으로 만들고
// bundles.json(collect --release 형식)을 쓴다
export function synthBundles(dir, version, spec = JSON.parse(readFileSync(join(ROOT, 'release/expected-artifacts.json'), 'utf8'))) {
  for (const os of ['linux', 'darwin', 'windows']) {
    const d = join(dir, `release-${version}-${os}`);
    mkdirSync(d, { recursive: true });
    const artifacts = spec[os].artifacts.map((a) => {
      const file = `chzzk-downloader_${version}_${a.name}`;
      const data = Buffer.from(`synthetic ${os} ${a.kind} ${version}\n`.repeat(64));
      writeFileSync(join(d, file), data);
      return { kind: a.kind, file, bytes: data.length, sha256: sha256hex(data), size: a.size ?? null, updater: a.updater ?? [] };
    });
    writeFileSync(join(d, 'bundles.json'), JSON.stringify({ os, version, release: true, artifacts }, null, 2) + '\n');
  }
}

// publish·verify·rollback은 배포하는 진입점(release.mjs <cmd>)을 하위 프로세스로 부른다(RELEASE_MODE=dry). xtask를 직접 부르는
// 것은 변조·진단(get, put-raw)과 낮은 수준의 거부(CAS, 덮어쓰기)를 보는 곳뿐이다.
async function cmdSelftest(env) {
  if (cmdXtask({ ...env, GITHUB_OUTPUT: '' }) !== 0) return 1;
  const work = mkdtempSync(join(tmpdir(), 'release-selftest-'));
  const creds = fakeCreds();
  const fake = await startFake(creds);
  const results = [];
  const stubs = [];
  const key = join(work, 'test.key');
  let last = '';
  // 다시 시도 대기를 짧게(가짜 서버의 일시 오류 시나리오)
  const base0 = { ...env, ...creds, R2_ENDPOINT: `http://127.0.0.1:${fake.port}`, XTASK_RETRY_ATTEMPTS: '3', XTASK_RETRY_BASE_MS: '20', XTASK_ROOT: ROOT };
  for (const n of ['VERIFY_VIA', 'CI_VERIFY_TOKEN', 'RELEASE_PREV', 'GITHUB_OUTPUT', 'XTASK_BIN', 'XTASK_SHA256']) delete base0[n];
  const x = (args, extra = {}) => {
    const r = spawnSync(xtaskBin(base0), ['release', ...args], { env: { ...base0, ...extra }, cwd: ROOT, encoding: 'utf8' });
    last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
    return r.status;
  };
  const expect = (name, want, got) => {
    const ok = want === 'nonzero' ? got !== 0 && got !== null : got === want;
    results.push({ name, want, got, ok, out: ok ? '' : last });
  };
  const get = (k) => {
    const out = join(work, 'get.bin');
    rmSync(out, { force: true });
    return x(['get', '--key', k, '--out', out]) === 0 ? readFileSync(out) : null;
  };
  const same = (a, b) => (a && b && Buffer.compare(a, b) === 0 ? 0 : 1);
  try {
    if (x(['keygen', '--out', key], { XTASK_KEY_PASSWORD: 'selftest-pw' }) !== 0) throw new Error('keygen 실패');
    const pub = `${key}.pub`;
    const S = dryEnv(base0, creds, fake.port, { key, pw: 'selftest-pw', pub });
    let n = 0;
    const publish = (v, pubDate, extra = {}) => {
      const inDir = join(work, `in-${v}`);
      const st = join(work, `stage-${v}`);
      const out = join(work, `out-${++n}`);
      if (!existsSync(inDir)) synthBundles(inDir, v);
      const r = runRelease('publish', { ...S, RELEASE_VERSION: v, RELEASE_IN: inDir, RELEASE_STAGE_DIR: st, RELEASE_PUB_DATE: pubDate, GITHUB_OUTPUT: out, ...extra }, true);
      last = r.out;
      return { code: r.status, prev: readOutput(out).prev, st };
    };
    const verify = (v, prev = '', extra = {}) => {
      const out = join(work, `out-${++n}`);
      const r = runRelease('verify', { ...S, RELEASE_VERSION: v, RELEASE_PREV: prev, GITHUB_OUTPUT: out, ...extra }, true);
      last = r.out;
      return { code: r.status, ...readOutput(out) };
    };
    const rollback = (v) => {
      const r = runRelease('rollback', { ...S, ROLLBACK_VERSION: v }, true);
      last = r.out;
      return r.status;
    };
    const vx = (v, k = pub, objectsOnly = false) => x(['verify', '--version', v, '--pubkey', k, '--base-url', FAKE_BASE, ...(objectsOnly ? ['--objects-only'] : [])]);

    // (a) 빈 버킷 happy path: publish(preflight → 경계 → PUBLISH_STEPS) → verify
    const p1 = publish('1.0.0', '2026-10-06T00:00:00Z');
    expect('(a) publish 1.0.0', 0, p1.code);
    expect('(a) prev 출력 = none', 0, p1.prev === 'none' ? 0 : 1);
    expect('(a) verify 1.0.0(full)', 0, verify('1.0.0', 'none').code);
    expect('(a) latest.json = 1.0.0 manifest.json(바이트)', 0, same(get(LATEST_KEY), readFileSync(join(p1.st, 'manifest.json'))));
    expect('(a) 커밋된 공개 키로 verify(시험 키 ≠ release/updater.pub)', 'nonzero', vx('1.0.0', join(ROOT, 'release/updater.pub')));
    expect('(a) 커밋된 공개 키로 verify-sig', 'nonzero', x(['verify-sig', '--dir', p1.st, '--pubkey', join(ROOT, 'release/updater.pub')]));
    // (b) 두 번째 버전과 CAS·단조 증가
    const before = get(LATEST_KEY);
    const p2 = publish('1.1.0', '2026-10-07T00:00:00+09:00');
    expect('(b) publish 1.1.0', 0, p2.code);
    expect('(b) prev 출력 = 1.0.0', 0, p2.prev === '1.0.0' ? 0 : 1);
    expect('(b) verify 1.1.0', 0, verify('1.1.0', '1.0.0').code);
    expect('(b) previous = 1.0.0', 0, (get('releases/1.1.0/previous') ?? '').toString() === '1.0.0' ? 0 : 1);
    // (b) 다운그레이드 재생(worker.md 구현 중 변경 79): 1.1.0 폴더에 1.0.0 산출물과 그 (유효한) 서명을 1.1.0 이름으로 넣으면
    // 서명 자체는 통과해도 묶인 버전이 1.0.0이라 verify-sig가 거부한다(앱의 requireSignedVersion과 같은 판정)
    const st2r = join(work, 'stage-1.1.0-replay');
    cpSync(p2.st, st2r, { recursive: true });
    const sig1 = readdirSync(p1.st).find((f) => f.endsWith('.sig'));
    const art2 = sig1.slice(0, -'.sig'.length).replaceAll('1.0.0', '1.1.0');
    cpSync(join(p1.st, sig1.slice(0, -'.sig'.length)), join(st2r, art2));
    cpSync(join(p1.st, sig1), join(st2r, `${art2}.sig`));
    const replay = x(['verify-sig', '--dir', st2r, '--pubkey', pub]);
    expect('(b) 옛 버전 서명 재생 verify-sig 거부(버전 불일치)', 0, replay !== 0 && last.includes('서명의 버전 1.0.0 ≠ 1.1.0') ? 0 : 1);
    expect('(b) --allow-unversioned로도 버전이 다르면 거부', 'nonzero', x(['verify-sig', '--dir', st2r, '--pubkey', pub, '--allow-unversioned']));
    expect('(b) 낮은 버전 승격 거부(1.0.0)', 'nonzero', x(['promote', '--dir', p1.st, '--version', '1.0.0']));
    expect('(b) 1.0.0 objects-only는 그대로 통과', 0, vx('1.0.0', pub, true));
    // (c) 객체 하나 변조 → release.mjs verify가 실패하고 되돌린다. prev 출력이 없어도(승격 뒤 sign-publish 실패) 버킷의 previous로
    const victim = 'releases/1.1.0/chzzk-downloader_1.1.0_windows-x86_64.msi';
    const bad = Buffer.from(get(victim));
    bad[Math.floor(bad.length / 2)] ^= 1;
    writeFileSync(join(work, 'bad.bin'), bad);
    expect('(c) 변조(put-raw)', 0, x(['put-raw', '--key', victim, '--file', join(work, 'bad.bin')], { XTASK_ALLOW_RAW: '1' }));
    expect('(c) put-raw는 XTASK_ALLOW_RAW 없이 거부', 'nonzero', x(['put-raw', '--key', victim, '--file', join(work, 'bad.bin')]));
    const vc = verify('1.1.0', '');
    expect('(c) verify 1.1.0 실패(prev 출력 없음)', 1, vc.code);
    expect('(c) previous를 읽어 1.0.0으로 되돌림', 0, vc.rolled_back === '1.0.0' ? 0 : 1);
    expect('(c) latest.json = 승격 전(바이트 동일)', 0, same(get(LATEST_KEY), before));
    expect('(c) 되돌린 뒤 verify 1.0.0', 0, verify('1.0.0').code);
    expect('(c) 망가진 1.1.0으로는 rollback.yml도 거부', 'nonzero', rollback('1.1.0'));
    expect('(c) 거부 뒤에도 latest.json = 1.0.0', 0, same(get(LATEST_KEY), before));
    // (d) 재실행 멱등: 같은 내용은 성공, 다른 내용은 덮어쓰지 않는다
    expect('(d) put 1.0.0 재실행', 0, x(['put', '--dir', p1.st, '--version', '1.0.0']));
    expect('(d) promote 1.0.0 재실행(이미 승격)', 0, x(['promote', '--dir', p1.st, '--version', '1.0.0']));
    const st2b = join(work, 'stage-1.1.0-b');
    cpSync(p2.st, st2b, { recursive: true });
    writeFileSync(join(st2b, 'chzzk-downloader_1.1.0_linux-x86_64.deb'), 'different\n');
    expect('(d) 다른 내용 put 거부', 'nonzero', x(['put', '--dir', st2b, '--version', '1.1.0']));
    const st1c = join(work, 'stage-1.0.0-c');
    cpSync(p1.st, st1c, { recursive: true });
    writeFileSync(join(st1c, 'SHA256SUMS'), readFileSync(join(st1c, 'SHA256SUMS'), 'utf8').split('\n').filter((l) => !l.endsWith('.AppImage.sig')).join('\n'));
    expect('(d) 서명 없는 sums 목록(.sig 지움) put 거부', 'nonzero', x(['put', '--dir', st1c, '--version', '1.0.0']));
    // (e) preflight·경계: 시크릿 없음 → 정확한 메시지, 리허설은 멈춤, tag는 엔드포인트·키 덮어쓰기와 빌드한 xtask를 거부
    const pf = preflight({ RELEASE_MODE: 'tag' });
    expect('(e) preflight 메시지(시크릿 없음)', 0, pf.code === 1 && pf.message === preflightMessage(RELEASE_SECRETS) ? 0 : 1);
    const pf2 = preflight({ RELEASE_MODE: 'rehearsal', ...Object.fromEntries(RELEASE_SECRETS.map((s) => [s, 'x'])) });
    expect('(e) 리허설은 시크릿이 있어도 멈춤', 0, pf2.code === 1 && pf2.message === REHEARSAL_MESSAGE ? 0 : 1);
    const bare = { PATH: env.PATH, SystemRoot: env.SystemRoot, RELEASE_MODE: 'tag' };
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/release.mjs'), 'preflight'], { env: bare, encoding: 'utf8' });
    expect('(e) preflight 프로세스: exit 1 + 정확한 줄', 0, r.status === 1 && r.stderr.split('\n').includes(`::error::${preflightMessage(RELEASE_SECRETS)}`) ? 0 : 1);
    const latestE = get(LATEST_KEY);
    const TAG_OK = { VERIFY_VIA: TAG_VERIFY_VIA, CI_VERIFY_TOKEN: 'selftest-token' };
    const pe = publish('1.5.0', '2026-10-08T00:00:00Z', { RELEASE_MODE: 'tag', RELEASE_VERSION: '', RELEASE_STAGE_DIR: '', RELEASE_PUBKEY: '', ...TAG_OK });
    expect('(e) tag 모드 publish는 R2_ENDPOINT 덮어쓰기 거부(exit 2)', 0, pe.code === 2 && last.includes('tag 모드는 R2_ENDPOINT를 받지 않는다') ? 0 : 1);
    const pv = publish('1.5.0', '2026-10-08T00:00:00Z', { RELEASE_MODE: 'tag', RELEASE_VERSION: '', RELEASE_STAGE_DIR: '', RELEASE_PUBKEY: '', ...TAG_OK, VERIFY_VIA: 's3' });
    expect('(e) tag 모드 publish는 VERIFY_VIA=s3면 preflight에서 1(업로드 전)', 0, pv.code === 1 && last.includes(`::error::${tagVerifyViaMessage('s3')}. 업로드하지 않음`) ? 0 : 1);
    const pe2 = publish('1.5.0', '2026-10-08T00:00:00Z', { R2_ENDPOINT: 'https://example.r2.cloudflarestorage.com' });
    expect('(e) dry 모드 publish는 루프백이 아닌 엔드포인트 거부(exit 2)', 2, pe2.code);
    const secretsX = Object.fromEntries(RELEASE_SECRETS.map((s) => [s, 'x']));
    const vx2 = runRelease('verify', { ...bare, ...secretsX, ...TAG_OK }, true);
    last = vx2.out;
    expect('(e) tag 모드 verify는 빌드한 xtask 거부(XTASK_BIN 없음, exit 2)', 0, vx2.status === 2 && vx2.out.includes('tag 모드는 미리 빌드한 xtask') ? 0 : 1);
    const vs3 = runRelease('verify', { ...bare, ...secretsX, ...TAG_OK, VERIFY_VIA: 's3' }, true);
    last = vs3.out;
    expect('(e) tag 모드 verify는 VERIFY_VIA=s3 거부(exit 2, xtask 전)', 0, vs3.status === 2 && vs3.out.includes(tagVerifyViaMessage('s3')) && !vs3.out.includes('xtask') ? 0 : 1);
    expect('(e) 시크릿 없는 verify는 preflight 메시지로 1', 1, runRelease('verify', bare, true).status);
    expect('(e) XTASK_SHA256이 다르면 거부(exit 2)', 2, verify('1.0.0', '', { XTASK_BIN: xtaskBin(base0), XTASK_SHA256: '0'.repeat(64) }).code);
    expect('(e) 거부들 뒤 latest.json 그대로', 0, same(get(LATEST_KEY), latestE));
    // (h) 기반 시설 오류와 판정을 가른다(리뷰 G6): 일시 5xx는 다시 시도해 통과, 계속되면 exit 2로 되돌리지 않음,
    //     CAS가 적용된 뒤 응답을 잃으면(500) 다시 읽어 성공
    expect('(h) 장애 주입 GET SHA256SUMS 503×2', 204, await fake.fault({ method: 'GET', key: 'releases/1.0.0/SHA256SUMS', mode: 'before', status: 503, times: 2 }));
    expect('(h) 일시 503 뒤 verify 1.0.0 통과', 0, verify('1.0.0').code);
    expect('(h) 장애 주입 GET SHA256SUMS 503×3(시도 횟수만큼)', 204, await fake.fault({ method: 'GET', key: 'releases/1.0.0/SHA256SUMS', mode: 'before', status: 503, times: 3 }));
    const vh = verify('1.0.0', 'none');
    expect('(h) 계속된 503: verify exit 2', 2, vh.code);
    expect('(h) 계속된 503: 되돌리지 않음', 0, vh.rolled_back === 'no' ? 0 : 1);
    expect('(h) 계속된 503 뒤 latest.json 그대로(1.0.0)', 0, same(get(LATEST_KEY), before));
    expect('(h) 장애 주입 PUT latest.json 적용 뒤 500×1', 204, await fake.fault({ method: 'PUT', key: LATEST_KEY, mode: 'after', status: 500, times: 1 }));
    const p3 = publish('1.2.0', '2026-10-09T00:00:00Z');
    expect('(h) 응답 잃은 CAS: publish 1.2.0 성공', 0, p3.code);
    expect('(h) latest.json = 1.2.0 manifest.json', 0, same(get(LATEST_KEY), readFileSync(join(p3.st, 'manifest.json'))));
    expect('(h) verify 1.2.0', 0, verify('1.2.0', p3.prev).code);
    // (i) verify 결정표의 나머지: 나중 태그가 승격(superseded), 승격 전에 실패(not-promoted)
    const vs = verify('1.0.0');
    expect('(i) latest가 더 높으면 objects-only로 통과(superseded)', 0, vs.code === 0 && vs.plan === 'superseded' ? 0 : 1);
    const vn = verify('1.3.0', '1.2.0');
    expect('(i) 승격되지 않은 버전: exit 1, 되돌리지 않음(not-promoted)', 0, vn.code === 1 && vn.plan === 'not-promoted' && vn.rolled_back === undefined ? 0 : 1);
    expect('(i) latest.json = 1.2.0 그대로', 0, same(get(LATEST_KEY), readFileSync(join(p3.st, 'manifest.json'))));
    // (f) rollback.yml 경로: 잘못 되돌린 뒤 다시 올리기(낮은 → 높은 버전), 첫 릴리스 전으로 되돌리기(latest.json 지움)
    expect('(f) rollback.yml 1.0.0', 0, rollback('1.0.0'));
    expect('(f) latest.json = 1.0.0', 0, same(get(LATEST_KEY), before));
    expect('(f) rollback.yml 1.2.0(다시 올리기)', 0, rollback('1.2.0'));
    expect('(f) latest.json = 1.2.0', 0, same(get(LATEST_KEY), readFileSync(join(p3.st, 'manifest.json'))));
    expect('(f) rollback --to none --from 9.9.9 거부(지금 latest와 다름)', 'nonzero', x(['rollback', '--to', 'none', '--from', '9.9.9', '--pubkey', pub]));
    expect('(f) rollback.yml none', 0, rollback('none'));
    expect('(f) latest.json 없음', 0, get(LATEST_KEY) === null ? 0 : 1);
    // (g) 서명 검증 서버: 틀린 비밀 키는 403 → 기반 시설 오류(exit 2, 판정이 아니다)
    expect('(g) 틀린 S3 비밀 키는 exit 2', 2, x(['get', '--key', 'releases/1.0.0/SHA256SUMS', '--out', join(work, 'g.bin')], { R2_SECRET_ACCESS_KEY: 'wrong' }));
    // (j) R2 보존 상한 prune(latest 이하 최신 5개 + latest의 previous). 상태는 1.0.0·1.1.0(변조)·1.2.0에 오래된 씨앗, latest보다 높은
    //     폴더(1.9.0: 판정 실패로 되돌린 버전의 남은 객체 자리), semver가 아닌 폴더를 더한다
    const seed = join(work, 'seed.bin');
    writeFileSync(seed, 'seed\n');
    const putSeed = (k) => x(['put-raw', '--key', k, '--file', seed], { XTASK_ALLOW_RAW: '1' });
    let seeded = 0;
    for (const v of ['0.1.0', '0.2.0', '0.3.0', '1.2.1', '1.2.2', '1.2.3', '1.9.0']) for (const f of ['SHA256SUMS', 'manifest.json']) seeded += putSeed(`releases/${v}/${f}`);
    seeded += putSeed('releases/tmp/x.bin');
    expect('(j) 씨앗 올림', 0, seeded);
    expect('(j) rollback.yml 1.0.0(latest 없음 → 1.0.0)', 0, rollback('1.0.0'));
    const p13 = publish('1.3.0', '2026-10-10T00:00:00Z');
    expect('(j) publish 1.3.0', 0, p13.code);
    expect('(j) prev 출력 = 1.0.0', 0, p13.prev === '1.0.0' ? 0 : 1);
    expect('(j) verify 1.3.0', 0, verify('1.3.0', '1.0.0').code);
    const listing = () => {
      const r = spawnSync(xtaskBin(base0), ['release', 'list-keys', '--prefix', 'releases/'], { env: base0, cwd: ROOT, encoding: 'utf8' });
      last = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
      return r.status === 0 ? (r.stdout ?? '').split('\n').filter(Boolean) : null;
    };
    const dirs = () => [...new Set((listing() ?? []).map((k) => /^releases\/([^/]+)\//.exec(k)?.[1]).filter(Boolean))].sort().join(',');
    const prune = (v, extra = {}) => {
      const r = runRelease('prune', { ...S, RELEASE_VERSION: v, ...extra }, true);
      last = r.out;
      return r.status;
    };
    expect('(j) 지우기 전 폴더 11개 + tmp', 0, dirs() === '0.1.0,0.2.0,0.3.0,1.0.0,1.1.0,1.2.0,1.2.1,1.2.2,1.2.3,1.3.0,1.9.0,tmp' ? 0 : 1);
    const before13 = get(LATEST_KEY);
    expect('(j) prune(latest = 1.3.0)', 0, prune('1.3.0'));
    // latest 이하 최신 5개(1.3.0·1.2.3·1.2.2·1.2.1·1.2.0) + latest + previous(1.0.0, 상위 5개 밖이어도 남긴다). latest보다 높은 1.9.0은
    // 남기되 자리로 세지 않는다(셌다면 1.2.0이 지워진다). semver가 아닌 tmp는 그대로
    const kept = '1.0.0,1.2.0,1.2.1,1.2.2,1.2.3,1.3.0,1.9.0,tmp';
    expect('(j) 남은 폴더', 0, dirs() === kept ? 0 : 1);
    expect('(j) semver가 아닌 releases/tmp/x.bin은 남음', 0, (listing() ?? []).includes('releases/tmp/x.bin') ? 0 : 1);
    expect('(j) latest.json 바이트 그대로(1.3.0 manifest)', 0, same(get(LATEST_KEY), before13) + same(before13, readFileSync(join(p13.st, 'manifest.json'))));
    // 1.1.0은 (c)에서 변조돼 지우지 않았어도 rollback이 거부되므로 키가 실제로 없는지를 먼저 본다
    expect('(j) 지운 버전(1.1.0)의 manifest.json·SHA256SUMS가 없다', 0, get('releases/1.1.0/manifest.json') === null && get('releases/1.1.0/SHA256SUMS') === null ? 0 : 1);
    expect('(j) 지운 버전(1.1.0)으로는 rollback.yml 거부', 'nonzero', rollback('1.1.0'));
    expect('(j) 거부 뒤 latest.json 그대로', 0, same(get(LATEST_KEY), before13));
    expect('(j) previous(1.0.0)로는 rollback 가능', 0, rollback('1.0.0'));
    expect('(j) 다시 1.3.0으로', 0, rollback('1.3.0'));
    expect('(j) prune 멱등', 0, prune('1.3.0') + (dirs() === kept ? 0 : 1));
    expect('(j) latest가 아닌 버전(1.2.0) 실행은 지우지 않고 0', 0, prune('1.2.0') + (dirs() === kept ? 0 : 1));
    expect('(j) xtask delete-version 1.3.0(latest) 거부', 1, x(['delete-version', '--version', '1.3.0']));
    expect('(j) xtask delete-version 1.0.0(previous) 거부', 1, x(['delete-version', '--version', '1.0.0']));
    expect('(j) 거부 뒤 목록 그대로', 0, dirs() === kept ? 0 : 1);
    putSeed('releases/0.0.1/SHA256SUMS');
    expect('(j) 목록이 잘리면(max-keys 3) exit 2, 지우지 않음', 2, prune('1.3.0', { XTASK_LIST_MAX_KEYS: '3' }));
    expect('(j) 잘린 뒤에도 0.0.1 그대로', 0, dirs().startsWith('0.0.1,1.0.0,') ? 0 : 1);
    expect('(j) 장애 주입 LIST 503×2', 204, await fake.fault({ method: 'LIST', key: 'releases/', mode: 'before', status: 503, times: 2 }));
    expect('(j) 일시 503 뒤 prune 통과, 0.0.1을 지움', 0, prune('1.3.0') + (dirs() === kept ? 0 : 1));
    // (w) 배포 뒤 검사(--check-only): 가짜 Worker(별도 프로세스)에 정상·틀림 사례. 인자는 배포 모드가 부르는 runWorkerChecks와 같은 코드다
    const TOKEN = 'ci-test-token';
    const stub = await startWorkerStub({ token: TOKEN, version: '1.2.0', build: 'abc1234' });
    stubs.push(stub);
    const WB = `http://127.0.0.1:${stub.port}`;
    const wenv = { PATH: env.PATH, SystemRoot: env.SystemRoot, CI_VERIFY_TOKEN: TOKEN, WORKER_CHECK_INTERVAL_MS: '20', WORKER_CHECK_DEADLINE_MS: '300', WORKER_CHECK_RETRY_BASE_MS: '5' };
    const check = async (set, { args = ['--check-only', '--base', WB, '--version', '1.2.0', '--build', 'abc1234'], envOverride = {}, drop = [] } = {}) => {
      await stub.set(set);
      const e = { ...wenv, ...envOverride };
      for (const n of drop) delete e[n];
      const r = runRelease('worker', e, true, args);
      last = r.out;
      return r.status;
    };
    expect('(w) 정상', 0, await check({}));
    expect('(w) 204 틀림: 이번 버전 요청이 200', 1, await check({ routes: { 'GET /update/1.2.0': { status: 200, json: { version: '1.2.0' } } } }));
    expect('(w) 200 틀림: 0.0.0 요청의 버전이 다름', 1, await check({ routes: { 'GET /update/0.0.0': { status: 200, json: { version: '1.1.0' } } } }));
    expect('(w) 200 틀림: 0.0.0 요청이 204', 1, await check({ routes: { 'GET /update/0.0.0': { status: 204 } } }));
    expect('(w) 음성 틀림: /admin이 200', 1, await check({ routes: { 'GET /admin': { status: 200, body: 'x' } } }));
    expect('(w) 음성 틀림: 토큰 없는 latest.json이 200', 1, await check({ routes: { 'GET /releases/latest.json': { status: 200, body: '{}' } } }));
    expect('(w) 음성 틀림: /api/me가 200', 1, await check({ routes: { 'GET /api/me': { status: 200, body: '{}' } } }));
    expect('(w) CI 토큰의 latest.json이 401', 1, await check({ routes: { 'GET /releases/latest.json': { status: 401, json: { code: 'invalid_token' } } } }));
    expect('(w) 음성 틀림: 틀린 Bearer로 /update가 200(자격을 보지 않는 Worker)', 1, await check({ routes: { 'GET /update/0.0.0': { status: 200, json: { version: '1.2.0' } } } }));
    expect('(w) 늦은 반영: 옛 build 둘 뒤 이번 build', 0, await check({ healthBuilds: ['old0000', 'old0000'] }));
    expect('(w) 반영 안 됨: 끝까지 옛 build(판정 실패)', 1, await check({ healthBuilds: Array(1000).fill('old0000') }));
    expect('(w) config_error는 기다리지 않고 실패', 1, await check({ routes: { 'GET /health': { status: 503, json: { ok: false, code: 'config_error' } } } }));
    expect('(w) 계속된 5xx는 기반 시설 오류(exit 2)', 2, await check({ routes: { 'GET /update/0.0.0': { status: 503, body: '' } } }));
    expect('(w) 틀린 토큰', 1, await check({}, { envOverride: { CI_VERIFY_TOKEN: 'wrong-token' } }));
    expect('(w) 토큰 없음', 2, await check({}, { drop: ['CI_VERIFY_TOKEN'] }));
    expect('(w) 나쁜 base(https도 루프백도 아님)', 2, await check({}, { args: ['--check-only', '--base', 'http://example.test', '--version', '1.2.0'] }));
    expect('(w) 모르는 인자', 2, await check({}, { args: ['--check-only', '--nope'] }));
    expect('(w) 로그에 base 호스트·토큰이 없다', 0, (await check({})) + (/127\.0\.0\.1|ci-test-token/.test(last) ? 1 : 0));
    // (w-dry) 배포 모드 가드(RELEASE_MODE=dry: 묶음·설정·superseded 가드까지, wrangler·Cloudflare에는 닿지 않는다)
    const tools = toolsWrangler();
    const wrangler = parseJsonc(readFileSync(join(ROOT, 'worker/wrangler.jsonc'), 'utf8'));
    const mkBundle = (name, { config = deployConfig(wrangler), meta = bundleMeta(tools) } = {}) => {
      const d = join(work, `bundle-${name}`);
      mkdirSync(join(d, 'dist'), { recursive: true });
      mkdirSync(join(d, DEPLOY_DIR), { recursive: true });
      writeFileSync(join(d, 'dist/wrangler.json'), `${JSON.stringify(config, null, 2)}\n`);
      writeFileSync(join(d, 'dist/worker-bundle.json'), `${JSON.stringify(meta)}\n`);
      writeFileSync(join(d, DEPLOY_DIR, '.keep'), '');
      const tgz = join(work, `${name}.tgz`);
      const r = spawnSync('tar', ['-czf', relative(d, tgz), 'dist', DEPLOY_DIR], { cwd: d, encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`tar 실패: ${r.stderr}`);
      return { tgz, sha: sha256hex(readFileSync(tgz)) };
    };
    const good = mkBundle('good');
    // wrangler secret list --format json 출력 모양(dry는 WORKER_SECRET_LIST로 받는다)
    const secretList = (names) => JSON.stringify(names.map((name) => ({ name, type: 'secret_text' })), null, '  ');
    const ALL_SECRETS = secretList(['ADMIN_CHANNEL_IDS', 'CHZZK_CLIENT_ID', 'CHZZK_CLIENT_SECRET', 'CI_VERIFY_TOKEN']);
    const wd = (version, { bundle = good, sha = bundle?.sha ?? '0'.repeat(64), extra = {}, mode } = {}) => {
      const e = { ...S, ...(mode ? { RELEASE_MODE: mode } : {}), RELEASE_VERSION: version, CLOUDFLARE_API_TOKEN: 'dry-token', CLOUDFLARE_ACCOUNT_ID: 'dry-account', CI_VERIFY_TOKEN: TOKEN, GITHUB_SHA: 'a'.repeat(40), WORKER_BUNDLE_SHA256: sha, WORKER_SECRET_LIST: ALL_SECRETS, ...(bundle ? { WORKER_BUNDLE: bundle.tgz } : {}), ...extra };
      for (const n of Object.keys(extra)) if (extra[n] === undefined) delete e[n];
      const r = runRelease('worker', e, true);
      last = r.out;
      return r.status;
    };
    expect('(w-dry) superseded: latest(1.3.0)가 더 높으면 배포 없이 0(묶음이 없어도)', 0, wd('1.2.0', { bundle: null }) + (/superseded/.test(last) ? 0 : 1));
    expect('(w-dry) not-promoted: latest보다 높은 1.4.0은 1', 1, wd('1.4.0'));
    expect('(w-dry) 묶음 sha256이 다르면 2', 2, wd('1.3.0', { sha: '0'.repeat(64) }));
    expect('(w-dry) 묶음 dist/wrangler.json에 account_id가 끼면 1', 1, wd('1.3.0', { bundle: mkBundle('acct', { config: { ...deployConfig(wrangler), account_id: 'dry-account' } }) }));
    expect('(w-dry) 묶음의 main이 다르면 1', 1, wd('1.3.0', { bundle: mkBundle('main', { config: { ...deployConfig(wrangler), main: 'dist/index.js' } }) }));
    expect('(w-dry) 다른 플랫폼 묶음은 2', 2, wd('1.3.0', { bundle: mkBundle('arch', { meta: { ...bundleMeta(tools), arch: 'other' } }) }));
    expect('(w-dry) 다른 wrangler 버전 묶음은 2', 2, wd('1.3.0', { bundle: mkBundle('ver', { meta: bundleMeta('0.0.1') }) }));
    expect('(w-dry) 좋은 묶음은 dry에서 멈추고 0', 0, wd('1.3.0') + (/dry — 배포·검사하지 않는다/.test(last) ? 0 : 1));
    // secret 이름 확인(배포 전, 값은 원래 나오지 않는다)
    const noSecret = wd('1.3.0', { extra: { WORKER_SECRET_LIST: secretList(['ADMIN_CHANNEL_IDS', 'CHZZK_CLIENT_ID']) } });
    expect('(w-dry) 필수 secret이 없으면 1, 없는 이름만', 0, noSecret === 1 && /Worker secret 없음: CHZZK_CLIENT_SECRET, CI_VERIFY_TOKEN\./.test(last) && !/dry — 배포/.test(last) ? 0 : 1);
    const boot = wd('1.3.0', { extra: { WORKER_SECRET_LIST: secretList(['CHZZK_CLIENT_ID', 'CHZZK_CLIENT_SECRET', 'CI_VERIFY_TOKEN']) } });
    expect('(w-dry) ADMIN_CHANNEL_IDS만 없으면 경고(부트스트랩) 뒤 0', 0, boot === 0 && /::warning::.*ADMIN_CHANNEL_IDS/.test(last) ? 0 : 1);
    expect('(w-dry) secret list 출력이 JSON 배열이 아니면 2', 2, wd('1.3.0', { extra: { WORKER_SECRET_LIST: 'Error: not found' } }));
    expect('(w-dry) secret list 결과가 없으면(dry 주입 없음) 2', 2, wd('1.3.0', { extra: { WORKER_SECRET_LIST: undefined } }));
    // 배포 직전 다시 읽기: 첫 가드는 지나가고(skip 1) 두 번째 latest.json 읽기만 시도 3번(XTASK_RETRY_ATTEMPTS) 내내 503이면 배포하지 않고 2
    expect('(w-dry) 장애 주입 latest.json 두 번째 GET부터 503×3', 204, await fake.fault({ method: 'GET', key: LATEST_KEY, mode: 'before', status: 503, times: 3, skip: 1 }));
    const reread = wd('1.3.0');
    expect('(w-dry) 배포 직전 latest.json을 다시 읽지 못하면 2(dry 멈춤 전)', 0, reread === 2 && /다시 읽지 못했다/.test(last) && !/dry — 배포/.test(last) ? 0 : 1);
    expect('(w-dry) 장애를 다 쓴 뒤 latest.json은 다시 읽힌다', 0, get(LATEST_KEY) === null ? 1 : 0);
    expect('(w-dry) GITHUB_SHA가 40자리 hex가 아니면 2', 2, wd('1.3.0', { extra: { GITHUB_SHA: 'abc' } }));
    expect('(w-dry) DIST_BASE_URL에 경로가 있으면 1', 1, wd('1.3.0', { extra: { DIST_BASE_URL: 'https://dist.example.invalid/x' } }));
    // exit 2만으로는 tag 모드의 'XTASK_BIN 없음'(begin의 다음 단계)과 갈리지 않아 경계 문구를 함께 본다
    const tagBundle = wd('1.3.0', { mode: 'tag', extra: { RELEASE_VERSION: undefined, R2_ENDPOINT: undefined, RELEASE_PUBKEY: undefined, RELEASE_STAGE_DIR: undefined } });
    expect('(w-dry) tag 모드는 WORKER_BUNDLE 덮어쓰기 거부(경계, exit 2 + 문구)', 0, tagBundle === 2 && last.includes('tag 모드는 WORKER_BUNDLE를 받지 않는다') ? 0 : 1);
    expect('(w-dry) tag 모드는 WORKER_SECRET_LIST 주입 거부(경계)', 0, tagBundle === 2 && last.includes('tag 모드는 WORKER_SECRET_LIST를 받지 않는다') ? 0 : 1);
    const tagPrune = prune('1.3.0', { RELEASE_MODE: 'tag', XTASK_LIST_MAX_KEYS: '3', RELEASE_VERSION: undefined, R2_ENDPOINT: undefined, RELEASE_PUBKEY: undefined, RELEASE_STAGE_DIR: undefined });
    expect('(w-dry) tag 모드 prune은 XTASK_LIST_MAX_KEYS 거부(경계, exit 2 + 문구)', 0, tagPrune === 2 && last.includes('tag 모드는 XTASK_LIST_MAX_KEYS를 받지 않는다') ? 0 : 1);
    const noTok = wd('1.3.0', { extra: { CLOUDFLARE_API_TOKEN: '' } });
    expect('(w-dry) CLOUDFLARE_API_TOKEN 없으면 1과 정확한 메시지', 0, noTok === 1 && last.split('\n').includes('::error::Worker 배포 설정 없음(시크릿·변수): CLOUDFLARE_API_TOKEN. 배포하지 않는다') ? 0 : 1);
    expect('(w-dry) 시크릿 값은 로그에 없다', 0, /dry-token|dry-account/.test(last) ? 1 : 0);
  } catch (e) {
    results.push({ name: `예외: ${e.message}`, want: 0, got: 'throw', ok: false, out: last });
  } finally {
    fake.stop();
    for (const st of stubs) st.stop();
    rmSync(work, { recursive: true, force: true });
  }
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(60)} 기대 ${String(r.want).padEnd(8)} 결과 ${r.got}`);
    if (r.out) console.log(r.out.replace(/^/gm, '     | '));
  }
  const bad = results.filter((r) => !r.ok).length;
  if (bad) err(`selftest: ${bad}개가 기대와 다르다`);
  else log(`selftest: ${results.length}개 모두 기대대로`);
  return bad ? 1 : 0;
}

// ---- Worker 배포(worker-bundle·deploy-worker, docs/design/worker.md §9.4·§13.4, cicd.md 구현 중 변경 81·96) ----

// DIST_BASE_URL(= Worker 출처 = PUBLIC_ORIGIN) → 문제 목록. 경로·쿼리·조각·끝 슬래시·대문자 호스트·기본 포트·사용자 정보가 없는 https 출처
// (매니페스트 url이 `${DIST_BASE_URL}/releases/<v>/<file>`이고 Worker의 PUBLIC_ORIGIN과 글자가 같아야 한다, cicd.md 82 (가)). 값은 싣지 않는다
export function distBaseProblems(v) {
  let u;
  try {
    u = new URL(v);
  } catch {
    return ['URL이 아니다'];
  }
  const out = [];
  if (u.protocol !== 'https:') out.push('https가 아니다');
  if (u.username || u.password) out.push('사용자 정보가 있다');
  if (v !== u.origin) out.push('경로·쿼리·조각·끝 슬래시·대문자·기본 포트가 없는 출처(scheme://host[:port])가 아니다');
  return out;
}

// 로그에서 가릴 문자열(::add-mask::, cicd.md 84 (다)): 출처의 호스트와, <이름>.<계정 서브도메인>.workers.dev면 계정 서브도메인 조각.
// 마스킹은 등록한 문자열이 그대로 나올 때만 가려서 출처 전체뿐 아니라 `https://`를 뗀 호스트도 등록한다
export function maskValues(origin) {
  let host;
  try {
    host = new URL(origin).hostname;
  } catch {
    return [];
  }
  if (!host) return [];
  const parts = host.split('.');
  const out = [host];
  if (parts.length === 4 && parts[2] === 'workers' && parts[3] === 'dev' && parts[1].length >= 4) out.push(parts[1]);
  return out;
}

// GITHUB_SHA → BUILD_ID(앞 7자). 40자리 소문자 hex가 아니면 null
export const buildIdOf = (sha) => (/^[0-9a-f]{40}$/.test(sha ?? '') ? sha.slice(0, 7) : null);

// `release.mjs worker` 인자. 없으면 배포. `--check-only --base <출처> --version <semver> [--build <id>]`면 검사만(배포 없음).
// → {mode:'deploy'} | {mode:'check', base, version, build|null} | {error}
export function parseWorkerArgs(argv) {
  if (!argv.length) return { mode: 'deploy' };
  const o = { checkOnly: false, base: undefined, version: undefined, build: undefined };
  const names = { '--base': 'base', '--version': 'version', '--build': 'build' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check-only') {
      if (o.checkOnly) return { error: '--check-only가 두 번 있다' };
      o.checkOnly = true;
    } else if (names[a]) {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a}에 값이 없다` };
      if (o[names[a]] !== undefined) return { error: `${a}가 두 번 있다` };
      o[names[a]] = v;
      i++;
    } else return { error: `모르는 인자 ${a}` };
  }
  if (!o.checkOnly) return { error: '--check-only 없이는 인자를 받지 않는다(배포는 인자 없이)' };
  if (!o.base) return { error: '--check-only는 --base <출처>가 필요하다' };
  if (!o.version || !parseSemver(o.version)) return { error: '--check-only는 --version <semver>가 필요하다' };
  if (o.build !== undefined && !/^[0-9A-Za-z._-]{1,40}$/.test(o.build)) return { error: '--build 형식이 아니다' };
  return { mode: 'check', base: o.base, version: o.version, build: o.build ?? null };
}

// 배포 뒤 검사(§9.4, worker.md 구현 중 변경 36 (아)). health는 따로 돈다(배포 반영을 기다린다). 나머지는 순서대로. path는 version을 받는다.
// cred: ci = CI 토큰, none = Authorization 없음, garbage = CI 토큰도 앱 토큰도 아닌 Bearer. 이 표는 worker/test/deploy-contract.mjs의
// deploy 행과 같아야 한다(release.test.mjs가 대조하고, 같은 표를 worker/test/http/update.test.ts가 진짜 Worker로 본다)
export const GARBAGE_BEARER = 'not-a-token';
export const WORKER_CHECKS = [
  { id: 'update-latest', path: () => '/update/0.0.0', cred: 'ci' },
  { id: 'update-current', path: (v) => `/update/${v}`, cred: 'ci' },
  { id: 'releases-latest-ci', path: () => '/releases/latest.json', cred: 'ci' },
  { id: 'neg-admin', path: () => '/admin', cred: 'ci' },
  { id: 'neg-latest-anon', path: () => '/releases/latest.json', cred: 'none' },
  { id: 'neg-update-garbage', path: () => '/update/0.0.0', cred: 'garbage' },
  { id: 'neg-me-ci', path: () => '/api/me', cred: 'ci' },
];

// 응답 하나의 판정(순수, release.test.mjs가 표로 본다). res: {status, body: Buffer} | {error: string}.
// ctx: {version, build|null, latestBytes: Buffer|null} → 'pass' | 'fail' | 'retry'(네트워크·5xx·429) | 'wait'(health만: 아직 옛 Worker)
export function judgeCheck(id, res, ctx) {
  if (res.error !== undefined) return 'retry';
  const { status } = res;
  const json = () => {
    try {
      return JSON.parse(res.body.toString('utf8'));
    } catch {
      return undefined;
    }
  };
  // 설정 가드(config_error)는 기다려도 낫지 않는다
  if (id === 'health' && status === 503 && json()?.code === 'config_error') return 'fail';
  if (status === 429 || status >= 500) return 'retry';
  switch (id) {
    case 'health': {
      if (status !== 200) return 'fail';
      const j = json();
      if (!j || j.ok !== true) return 'fail';
      // 옛 Worker도 200을 준다: 이번 BUILD_ID를 내놓을 때까지 기다린다
      return ctx.build && j.build !== ctx.build ? 'wait' : 'pass';
    }
    case 'update-latest':
    case 'releases-latest-ci': {
      if (status !== 200) return 'fail';
      if (json()?.version !== ctx.version) return 'fail';
      return ctx.latestBytes && Buffer.compare(res.body, ctx.latestBytes) !== 0 ? 'fail' : 'pass';
    }
    case 'update-current':
      return status === 204 ? 'pass' : 'fail';
    case 'neg-admin':
      // 로그인으로 보내는 303이든 아직 없는 경로의 404든 200이 아니면 된다
      return status >= 300 && status <= 499 ? 'pass' : 'fail';
    case 'neg-latest-anon':
    case 'neg-update-garbage':
    case 'neg-me-ci':
      return status === 401 ? 'pass' : 'fail';
    default:
      throw new Error(`모르는 검사 ${id}`);
  }
}

// 정수 1..600000(ms)만 받고 아니면 기본값
export function envMs(env, name, def) {
  const v = env[name];
  return /^\d{1,6}$/.test(v ?? '') && +v >= 1 && +v <= 600_000 ? +v : def;
}

// deploy-worker 작업 안의 하위 프로세스·요청 상한(ms). release.yml deploy-worker의 timeout-minutes는 workerWorstCaseMs() + 준비 여유보다
// 커야 한다(release.test.mjs가 워크플로 값을 읽어 본다). xtask get 하나는 reqwest 600초 × 4회까지 갈 수 있어 하위 프로세스에 상한을 준다
export const WORKER_LIMITS = { s3ReadMs: 90_000, extractMs: 60_000, secretListMs: 120_000, deployMs: 300_000, requestMs: 10_000 };
// 배포 뒤 검사 시간(기본값). 배포 모드의 tag 실행은 env WORKER_CHECK_*를 읽지 않고 늘 이 값이다(상한 계산이 깨지지 않게)
export const WORKER_CHECK_DEFAULTS = { intervalMs: 30_000, deadlineMs: 300_000, retryBaseMs: 2_000, attempts: 4 };
// 작업 안에서 release.mjs worker가 쓸 수 있는 최악의 시간(ms):
//   latest.json 읽기 3번(첫 가드·배포 직전·검사 실패 뒤) + 묶음 풀기 + secret list + deploy
//   + health(마지막 요청이 기한 직전에 시작: deadline + 요청 상한)
//   + 나머지 검사 WORKER_CHECKS개 × (attempts × 요청 상한 + 대기 base·(1+2+…+2^(attempts-2)))
// 기본값: 3×90 + 60 + 120 + 300 + (300 + 10) + 7 × (4×10 + 14) = 1438초 ≈ 24분
export function workerWorstCaseMs(t = WORKER_CHECK_DEFAULTS, l = WORKER_LIMITS) {
  const health = t.deadlineMs + l.requestMs;
  const perCheck = t.attempts * l.requestMs + t.retryBaseMs * (2 ** (t.attempts - 1) - 1);
  return 3 * l.s3ReadMs + l.extractMs + l.secretListMs + l.deployMs + health + WORKER_CHECKS.length * perCheck;
}

// 배포 뒤 검사 전부. → { code: 0 통과 | 1 판정 실패 | 2 기반 시설(5xx·429·네트워크가 끝까지 남음), results }
// base·token은 로그에 찍지 않고, 네트워크 오류는 cause.code만 남긴다(메시지에 호스트가 들어간다)
export async function runWorkerChecks({
  base,
  token,
  version,
  build = null,
  latestBytes = null,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  intervalMs = 30_000,
  deadlineMs = 300_000,
  retryBaseMs = 2_000,
  attempts = 4,
  requestTimeoutMs = WORKER_LIMITS.requestMs,
  log = (m) => console.log(`release: ${m}`),
}) {
  const ctx = { version, build, latestBytes };
  const results = [];
  const authHeaders = { ci: { authorization: `Bearer ${token}` }, garbage: { authorization: `Bearer ${GARBAGE_BEARER}` }, none: {} };
  const get = async (path, cred) => {
    try {
      const r = await fetchImpl(base + path, { method: 'GET', redirect: 'manual', headers: authHeaders[cred], signal: AbortSignal.timeout(requestTimeoutMs) });
      return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
    } catch (e) {
      const c = String(e?.cause?.code ?? e?.name ?? 'error');
      return { error: /^[A-Za-z0-9_.-]{1,40}$/.test(c) ? c : 'error' };
    }
  };
  const line = (id, path, outcome, res) => log(`worker check ${id} ${path}: ${outcome}${res.status !== undefined ? ` (HTTP ${res.status})` : ''}${res.error !== undefined ? ` (${res.error})` : ''}`);
  const record = (id, outcome, res) => results.push({ id, outcome, ...(res.status !== undefined ? { status: res.status } : {}), ...(res.error !== undefined ? { cause: res.error } : {}) });

  // 1) health: 이번 빌드가 보일 때까지 기다린다(전파 지연)
  const start = now();
  for (;;) {
    const res = await get('/health', 'none');
    const o = judgeCheck('health', res, ctx);
    line('health', '/health', o, res);
    if (o === 'pass') {
      record('health', 'pass', res);
      break;
    }
    if (o === 'fail') {
      record('health', 'fail', res);
      return { code: 1, results };
    }
    if (now() - start + intervalMs > deadlineMs) {
      // 끝까지 옛 Worker(wait)면 반영이 안 된 판정 실패, 5xx·네트워크(retry)면 기반 시설
      record('health', o === 'wait' ? 'fail' : 'infra', res);
      return { code: o === 'wait' ? 1 : 2, results };
    }
    await sleep(intervalMs);
  }

  // 2) 나머지: 검사마다 5xx·429·네트워크는 다시 시도한다
  for (const c of WORKER_CHECKS) {
    const path = c.path(version);
    let res;
    let o;
    for (let n = 1; n <= attempts; n++) {
      res = await get(path, c.cred);
      o = judgeCheck(c.id, res, ctx);
      if (o !== 'retry') break;
      if (n < attempts) {
        line(c.id, path, `retry ${n}/${attempts}`, res);
        await sleep(retryBaseMs * 2 ** (n - 1));
      }
    }
    const outcome = o === 'pass' ? 'pass' : o === 'retry' ? 'infra' : 'fail';
    line(c.id, path, outcome, res);
    record(c.id, outcome, res);
  }
  const code = results.some((r) => r.outcome === 'fail') ? 1 : results.some((r) => r.outcome === 'infra') ? 2 : 0;
  return { code, results };
}

// ---- wrangler 실행(묶음 안의 wrangler, 설치·컴파일 없음) ----

export const WORKER_BUNDLE_DIR = 'target/ci/worker-bundle';
export const WORKER_BUNDLE_FILE = `${WORKER_BUNDLE_DIR}/worker-bundle.tgz`;

// deploy [--dry-run] 인자(dry-run과 실제가 같은 배열에 --dry-run만 더한다). PUBLIC_ORIGIN 값은 인자로만 간다(env로는 넘기지 않는다)
export function wranglerDeployArgs({ origin, build, dryRun }) {
  return ['deploy', '--no-bundle', '--config', 'dist/wrangler.json', '--var', `PUBLIC_ORIGIN:${origin}`, '--var', `BUILD_ID:${build}`, ...(dryRun ? ['--dry-run'] : [])];
}

// wrangler 하위 프로세스의 env(허용 목록). 넘기지 않는 것: CI_VERIFY_TOKEN, R2 자격, DIST_BASE_URL(값은 --var 인자로만), GITHUB_*,
// CLOUDFLARE_API_BASE_URL, 로컬 wrangler login 상태(빈 임시 HOME). Cloudflare 자격은 실제 배포(credentials)에서만
export function wranglerEnv(env, { home, credentials }) {
  const out = { PATH: env.PATH ?? '', HOME: home, XDG_CONFIG_HOME: join(home, '.config'), CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  if (IS_WIN) {
    out.USERPROFILE = home;
    if (env.SystemRoot) out.SystemRoot = env.SystemRoot;
  }
  if (credentials) {
    out.CLOUDFLARE_API_TOKEN = env.CLOUDFLARE_API_TOKEN ?? '';
    out.CLOUDFLARE_ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID ?? '';
  }
  return out;
}

// 묶음의 실행 환경 표시(worker-bundle이 dist/worker-bundle.json으로 넣고 deploy-worker가 맞춰 본다). node_modules에 workerd
// 플랫폼 바이너리가 들어가므로 묶음은 OS·arch 전용이다(worker.md 구현 중 변경 35 (다))
export const bundleMeta = (wrangler) => ({ platform: process.platform, arch: process.arch, wrangler });
const toolsWrangler = () => JSON.parse(readFileSync(join(ROOT, 'scripts/ci/tools.json'), 'utf8')).tools.wrangler.version;
// .bin shim이 아니라 wrangler.js를 node로 직접 부른다(Windows .cmd·셸 해석을 피한다)
const wranglerJs = (x) => join(x, DEPLOY_DIR, 'node_modules/wrangler/bin/wrangler.js');

// 묶음 tgz를 새 임시 폴더에 푼다 → 폴더 | null. 작업 폴더의 .env·.env.local을 wrangler가 읽지 않게 늘 빈 새 폴더에서 돈다(worker.md 구현 중 변경 35 (사)).
// tar는 cwd + 상대 경로로 부른다(Windows GNU tar가 `C:`를 원격 호스트로 읽는다)
function extractBundle(tgz, env) {
  const x = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'worker-bundle-x-'));
  try {
    cpSync(tgz, join(x, 'bundle.tgz'));
    const r = spawnSync('tar', ['-xzf', 'bundle.tgz'], { cwd: x, stdio: 'inherit', timeout: WORKER_LIMITS.extractMs });
    if (r.status !== 0) throw new Error(`tar -x exit ${r.status}`);
    rmSync(join(x, 'bundle.tgz'));
    return x;
  } catch (e) {
    err(`worker: 묶음을 풀지 못했다(${e.message})`);
    rmSync(x, { recursive: true, force: true });
    return null;
  }
}

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

// wrangler를 묶음 폴더에서(argv에 PUBLIC_ORIGIN이 실리므로 명령줄을 찍지 않고 오류에도 인자를 싣지 않는다) → exit code.
// capture면 stdout을 찍지 않고 { status, stdout }을 돌려준다(stderr는 그대로 흘린다)
function runWrangler(x, args, env, credentials, { timeoutMs = WORKER_LIMITS.deployMs, capture = false } = {}) {
  const home = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), 'worker-home-'));
  try {
    const r = spawnSync(process.execPath, [wranglerJs(x), ...args], {
      cwd: x,
      env: wranglerEnv(env, { home, credentials }),
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
      timeout: timeoutMs,
      ...(capture ? { encoding: 'utf8', maxBuffer: 1 << 20 } : {}),
    });
    if (r.status === null) err(`worker: wrangler ${args[0]}이 ${timeoutMs}ms 상한을 넘겼거나 시작하지 못했다`);
    return capture ? { status: r.status ?? 2, stdout: r.stdout ?? '' } : (r.status ?? 2);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

// ---- Worker secret 이름 확인(배포 전, worker.md 구현 중 변경 36) ----

// 운영 모드에서 없으면 config_error인 secret(worker/src/config.ts: 클라이언트 id·secret·CI 토큰). 없으면 배포하지 않는다(1)
export const WORKER_REQUIRED_SECRETS = ['CHZZK_CLIENT_ID', 'CHZZK_CLIENT_SECRET', 'CI_VERIFY_TOKEN'];
// 없어도 되는 secret: ADMIN_CHANNEL_IDS가 비면 부트스트랩 모드다(worker.md §8.3, 첫 배포 뒤 로그인으로 값을 얻어 넣는다). 경고만 한다
export const WORKER_OPTIONAL_SECRETS = ['ADMIN_CHANNEL_IDS'];

// `wrangler secret list --format json` → 인자(이름만 나온다, 값은 API가 돌려주지 않는다)
export const wranglerSecretListArgs = () => ['secret', 'list', '--config', 'dist/wrangler.json', '--format', 'json'];

// secret list 출력 → { names } | { error }. 줄 머리의 `[`에서 시작하는 JSON 배열을 찾는다(앞뒤 안내 줄은 건너뛴다).
// 항목은 { name: string }이어야 한다. error 문구에 출력 내용은 싣지 않는다
export function parseSecretNames(text) {
  const s = String(text ?? '');
  const end = s.lastIndexOf(']');
  for (const m of s.matchAll(/^\[/gm)) {
    if (end < m.index) break;
    let a;
    try {
      a = JSON.parse(s.slice(m.index, end + 1));
    } catch {
      continue;
    }
    if (!Array.isArray(a) || !a.every((e) => e && typeof e === 'object' && typeof e.name === 'string')) return { error: '배열 항목에 name이 없다' };
    return { names: a.map((e) => e.name) };
  }
  return { error: 'JSON 배열을 찾지 못했다' };
}

// 이름 목록 → { missing: 필수 중 없는 것, bootstrap: ADMIN_CHANNEL_IDS가 없음 }
export function secretCheck(names) {
  const have = new Set(names);
  return { missing: WORKER_REQUIRED_SECRETS.filter((n) => !have.has(n)), bootstrap: !have.has('ADMIN_CHANNEL_IDS') };
}

// ---- 배포 순서(묶음 확인 뒤, release.test.mjs가 가짜 의존성으로 본다) ----
//   secret 이름 확인 → latest.json 다시 읽기(첫 superseded 가드 뒤에 다른 태그가 승격했으면 배포하지 않는다) → (dry면 멈춤)
//   → wrangler deploy → 배포 뒤 검사 → 실패면 latest.json을 한 번 더 읽어 다른 태그의 승격을 오류에 싣는다.
// 의존성: listSecrets() → { status, stdout }, readLatest() → getObject 모양 { code, data }, deploy() → exit code,
// checks(latestBytes) → { code }, emit(kind: notice|warning|error|log, 문구)
export async function workerDeploySteps({ version, dryRun = false, listSecrets, readLatest, deploy, checks, emit = defaultEmit }) {
  const sl = await listSecrets();
  if (sl.status !== 0) {
    emit('error', `worker: wrangler secret list 실패(exit ${sl.status}). Worker가 아직 없으면 첫 배포는 사람이 한다(W9). 배포하지 않는다`);
    return 2;
  }
  const parsed = parseSecretNames(sl.stdout);
  if (parsed.error) {
    emit('error', `worker: secret list 출력을 읽지 못했다(${parsed.error}). 배포하지 않는다`);
    return 2;
  }
  const sc = secretCheck(parsed.names);
  if (sc.missing.length) {
    emit('error', `worker: Worker secret 없음: ${sc.missing.join(', ')}. wrangler secret put으로 넣은 뒤 deploy-worker를 다시 실행한다. 배포하지 않는다`);
    return 1;
  }
  if (sc.bootstrap) emit('warning', 'worker: ADMIN_CHANNEL_IDS secret이 없다 — 부트스트랩 모드로 뜬다(worker.md §8.3)');

  const re = await readLatest();
  if (re.code === 2) {
    emit('error', 'worker: 배포 직전에 latest.json을 다시 읽지 못했다. 배포하지 않는다');
    return 2;
  }
  const latest = re.data ? versionOf(re.data) : null;
  const plan = verifyPlan(latest, version);
  if (plan === 'superseded') {
    emit('notice', `release worker: 배포 직전에 다시 읽은 latest.json이 더 높은 ${latest}다 — 배포하지 않는다(첫 가드 뒤 다른 태그가 승격했다, superseded)`);
    return 0;
  }
  if (plan === 'not-promoted') {
    emit('error', `worker: 배포 직전에 다시 읽은 latest.json이 ${latest ?? '없음'}이다 — ${version}이 승격된 상태가 아니라 배포하지 않는다`);
    return 1;
  }
  if (dryRun) {
    emit('log', 'worker: dry — 배포·검사하지 않는다(묶음·설정·secret 이름·superseded 가드 둘까지 확인)');
    return 0;
  }
  const c = await deploy();
  if (c !== 0) {
    emit('error', 'worker: wrangler deploy 실패(판정 전이라 되돌릴 것이 없다). 원인을 고친 뒤 deploy-worker를 다시 실행한다');
    return 2;
  }
  const r = await checks(re.data);
  if (r.code !== 0) {
    // 검사 중에 다른 태그가 승격했으면(/update 본문이 바뀐다) 그것을 함께 알린다
    const post = await readLatest();
    const now = post.code === 0 && post.data ? versionOf(post.data) : null;
    const other = now && verifyPlan(now, version) === 'superseded' ? ` 다른 태그 ${now}가 승격됐다(검사 중 latest.json이 바뀌었을 수 있다. 그 태그의 deploy-worker를 본다).` : '';
    emit('error', `worker: 배포 뒤 검사 실패.${other} 필요하면 사람이 wrangler rollback(docs/design/worker.md §9.4)`);
  }
  return r.code;
}

function defaultEmit(kind, m) {
  if (kind === 'error') err(m);
  else if (kind === 'log') log(m);
  else console.log(`::${kind}::${m}`);
}

// release.yml worker-bundle 작업(시크릿·환경 없음, 태그·리허설 모두): worker 번들(dist) + dist/wrangler.json(원본에서 main·no_bundle만)
// + 배포용 wrangler(worker/deploy, --ignore-scripts) → tar·sha256. 끝에 묶음을 풀어 자격 없이 deploy --dry-run을 돌린다(리허설마다 worker.md 구현 중 변경 35 (다) 확인)
function cmdWorkerBundle(env) {
  const wenv = { ...env, WRANGLER_SEND_METRICS: 'false' };
  const workerDir = join(ROOT, 'worker');
  const outDir = join(ROOT, WORKER_BUNDLE_DIR);
  const tgz = join(ROOT, WORKER_BUNDLE_FILE);
  rmSync(outDir, { recursive: true, force: true });
  // 남은 dist·deploy/node_modules가 묶음에 섞이거나 옛 dist/wrangler.json 동일성 검사를 어지럽히지 않게
  rmSync(join(workerDir, 'dist'), { recursive: true, force: true });
  rmSync(join(workerDir, DEPLOY_DIR, 'node_modules'), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  if (!step('worker 설치', spawnTool('pnpm', ['install', '--frozen-lockfile'], { cwd: workerDir, env: wenv }))) return 1;
  if (!step('worker 빌드(deploy --dry-run)', spawnTool('pnpm', ['build'], { cwd: workerDir, env: wenv }))) return 1;
  const wranglerVersion = toolsWrangler();
  writeFileSync(join(workerDir, 'dist/wrangler.json'), `${JSON.stringify(deployConfig(parseJsonc(readFileSync(join(workerDir, 'wrangler.jsonc'), 'utf8'))), null, 2)}\n`);
  writeFileSync(join(workerDir, 'dist/worker-bundle.json'), `${JSON.stringify(bundleMeta(wranglerVersion))}\n`);
  if (!step('worker-config --dist', spawnSync(process.execPath, [join(ROOT, 'scripts/ci/worker-config.mjs'), '--dist'], { cwd: ROOT, stdio: 'inherit' }))) return 1;
  if (!step('배포용 wrangler 설치(--ignore-scripts)', spawnTool('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], { cwd: join(workerDir, DEPLOY_DIR), env: wenv }))) return 1;
  if (!step('묶음 tar', spawnSync('tar', ['-czf', relative(workerDir, tgz), 'dist', DEPLOY_DIR], { cwd: workerDir, stdio: 'inherit' }))) return 1;
  // 자체 확인: 묶음을 풀어 자격 없이 deploy --dry-run(묶음 안의 wrangler가 --no-bundle·exports·--var로 떠야 한다)
  const x = extractBundle(tgz, env);
  if (!x) return 1;
  try {
    const c = runWrangler(x, wranglerDeployArgs({ origin: 'https://worker.example.invalid', build: 'bundlecheck', dryRun: true }), env, false);
    if (c !== 0) {
      err(`worker-bundle: 묶음을 풀어 돌린 deploy --dry-run이 실패했다(exit ${c})`);
      return 1;
    }
  } finally {
    rmSync(x, { recursive: true, force: true });
  }
  const sha = sha256hex(readFileSync(tgz));
  ghOutput(env, { sha256: sha });
  log(`worker-bundle: ${WORKER_BUNDLE_FILE} sha256 ${sha}`);
  return 0;
}

// release.yml deploy-worker 작업(환경 release, 태그 + vars.WORKER_DEPLOY_ENABLED). 인자 없이 = 배포 + 검사, `--check-only`면 검사만
export const WORKER_SECRETS = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'CI_VERIFY_TOKEN', 'DIST_BASE_URL', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ACCOUNT_ID', 'R2_BUCKET'];

// 시크릿(Cloudflare·CI_VERIFY_TOKEN·DIST_BASE_URL·R2 자격)과 저장소 변수(R2_BUCKET)가 섞여 있어 종류를 함께 적는다
export const workerMissingMessage = (missing) => `Worker 배포 설정 없음(시크릿·변수): ${missing.join(', ')}. 배포하지 않는다`;

async function cmdWorker(env, argv) {
  const a = parseWorkerArgs(argv);
  if (a.error) {
    console.error(`사용법: release.mjs worker  |  release.mjs worker --check-only --base <출처> --version <semver> [--build <id>] (${a.error})`);
    return 2;
  }
  const D = WORKER_CHECK_DEFAULTS;
  const envTimes = { intervalMs: envMs(env, 'WORKER_CHECK_INTERVAL_MS', D.intervalMs), deadlineMs: envMs(env, 'WORKER_CHECK_DEADLINE_MS', D.deadlineMs), retryBaseMs: envMs(env, 'WORKER_CHECK_RETRY_BASE_MS', D.retryBaseMs) };
  if (a.mode === 'check') {
    const times = envTimes;
    if (!env.CI_VERIFY_TOKEN) {
      err('worker: CI_VERIFY_TOKEN이 없다');
      return 2;
    }
    if (distBaseProblems(a.base).length && !LOOPBACK.test(a.base)) {
      err('worker: --base는 경로 없는 https 출처 또는 루프백 http여야 한다(값은 찍지 않는다)');
      return 2;
    }
    return (await runWorkerChecks({ base: a.base, token: env.CI_VERIFY_TOKEN, version: a.version, build: a.build, ...times })).code;
  }

  // ---- 배포 모드 ----
  const missing = WORKER_SECRETS.filter((n) => !env[n]);
  if (missing.length) {
    console.error(`::error::${workerMissingMessage(missing)}`);
    return 1;
  }
  if (distBaseProblems(env.DIST_BASE_URL).length) {
    err('worker: DIST_BASE_URL은 경로 없는 https 출처여야 한다(값은 찍지 않는다)');
    return 1;
  }
  // 출처와 workers.dev 계정 서브도메인 조각을 로그에서 가린다(wrangler 출력·오류에 실릴 수 있다)
  for (const m of maskValues(env.DIST_BASE_URL)) console.log(`::add-mask::${m}`);
  if (begin('worker', env)) return 2;
  const build = buildIdOf(env.GITHUB_SHA);
  if (!build) {
    err('worker: GITHUB_SHA(40자리 hex)가 필요하다(BUILD_ID = 앞 7자)');
    return 2;
  }
  if (!/^[0-9a-f]{64}$/.test(env.WORKER_BUNDLE_SHA256 ?? '')) {
    err('worker: WORKER_BUNDLE_SHA256(worker-bundle 작업의 출력)이 필요하다');
    return 2;
  }
  const version = releaseVersion(env);
  // superseded 가드: VERIFY_VIA와 상관없이 S3로 latest.json을 읽는다(S3가 latest.json의 원천이라 Worker 상태와 무관하게 판정한다,
  // worker.md 구현 중 변경 36 (마)). 고장 난 Worker의 복구는 이 작업이 아니다: verify가 실패하면 deploy-worker는 돌지 않는다
  const readLatest = () => getObject(env, LATEST_KEY, { timeoutMs: WORKER_LIMITS.s3ReadMs });
  const cur = readLatest();
  if (cur.code === 2) return 2;
  const latest = cur.data ? versionOf(cur.data) : null;
  const plan = verifyPlan(latest, version);
  if (plan === 'superseded') {
    console.log(`::notice::release worker: latest.json은 더 높은 ${latest}다 — 배포하지 않는다(낮은 태그가 늦게 끝나 옛 Worker로 덮지 않게, superseded)`);
    return 0;
  }
  if (plan === 'not-promoted') {
    err(`worker: latest.json이 ${latest ?? '없음'}이다 — ${version}이 승격된 상태가 아니라 배포하지 않는다`);
    return 1;
  }
  const tgz = dry(env) && env.WORKER_BUNDLE ? resolve(env.WORKER_BUNDLE) : join(ROOT, WORKER_BUNDLE_FILE);
  if (!existsSync(tgz)) {
    err(`worker: 묶음 ${relative(ROOT, tgz)}이 없다(worker-bundle artifact를 받지 않았다)`);
    return 2;
  }
  const got = sha256hex(readFileSync(tgz));
  if (got !== env.WORKER_BUNDLE_SHA256) {
    err(`worker: 묶음 sha256 ${got} ≠ worker-bundle 작업의 출력 ${env.WORKER_BUNDLE_SHA256}`);
    return 2;
  }
  const x = extractBundle(tgz, env);
  if (!x) return 2;
  try {
    const meta = readJson(join(x, 'dist/worker-bundle.json'));
    const want = bundleMeta(toolsWrangler());
    if (!isDeepStrictEqual(meta, want)) {
      err(`worker: 묶음은 ${meta?.platform}-${meta?.arch}(wrangler ${meta?.wrangler})용이다. 이 실행은 ${want.platform}-${want.arch}(wrangler ${want.wrangler})`);
      return 2;
    }
    // 묶음의 dist/wrangler.json이 이 커밋의 원본에서 만든 배포 설정과 같아야 한다(worker-bundle 작업이 다른 설정을 끼우지 않았다)
    const dist = readJson(join(x, 'dist/wrangler.json'));
    if (!isDeepStrictEqual(dist, deployConfig(parseJsonc(readFileSync(join(ROOT, 'worker/wrangler.jsonc'), 'utf8'))))) {
      err('worker: 묶음의 dist/wrangler.json이 이 커밋의 원본에서 만든 배포 설정과 다르다');
      return 1;
    }
    // dry는 secret list 출력을 WORKER_SECRET_LIST로 받는다(selftest 묶음에는 wrangler가 없고 Cloudflare에 닿지 않는다). 없으면 기반 시설(2)
    const listSecrets = dry(env)
      ? () => (env.WORKER_SECRET_LIST === undefined ? { status: 2, stdout: '' } : { status: 0, stdout: env.WORKER_SECRET_LIST })
      : () => runWrangler(x, wranglerSecretListArgs(), env, true, { timeoutMs: WORKER_LIMITS.secretListMs, capture: true });
    // tag 실행은 env WORKER_CHECK_*를 읽지 않는다(workerWorstCaseMs 상한)
    const times = dry(env) ? envTimes : { intervalMs: D.intervalMs, deadlineMs: D.deadlineMs, retryBaseMs: D.retryBaseMs };
    return await workerDeploySteps({
      version,
      dryRun: dry(env),
      listSecrets,
      readLatest,
      deploy: () => runWrangler(x, wranglerDeployArgs({ origin: env.DIST_BASE_URL, build, dryRun: false }), env, true),
      checks: async (latestBytes) => runWorkerChecks({ base: env.DIST_BASE_URL, token: env.CI_VERIFY_TOKEN, version, build, latestBytes, ...times }),
    });
  } finally {
    rmSync(x, { recursive: true, force: true });
  }
}

export function main(argv, env = process.env) {
  const [cmd, ...rest] = argv;
  if (rest.length && cmd !== 'worker') {
    console.error('사용법: release.mjs <pubkey|gate|next-version|build|xtask|preflight|publish|verify|rollback|prune|stage|selftest|worker-bundle|worker>');
    return 2;
  }
  switch (cmd) {
    case 'pubkey':
      return cmdPubkey();
    case 'gate':
      return cmdGate(env);
    case 'next-version':
      return cmdNextVersion();
    case 'build':
      return cmdBuild(env);
    case 'xtask':
      return cmdXtask(env);
    case 'preflight':
      return cmdPreflight(env);
    case 'publish':
      return cmdPublish(env);
    case 'verify':
      return cmdVerify(env);
    case 'rollback':
      return cmdRollback(env);
    case 'stage':
      return cmdStage(env);
    case 'prune':
      return cmdPrune(env);
    case 'selftest':
      return cmdSelftest(env);
    case 'worker':
      return cmdWorker(env, rest);
    case 'worker-bundle':
      return cmdWorkerBundle(env);
    default:
      console.error('사용법: release.mjs <pubkey|gate|next-version|build|xtask|preflight|publish|verify|rollback|prune|stage|selftest|worker-bundle|worker>');
      return 2;
  }
}

// 심볼릭 링크 경로(/tmp → /private/tmp 등)로 불러도 main이 돌도록 실제 경로로 비교한다. 안 돌면 조용히 0으로 끝난다.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve(main(process.argv.slice(2))).then((c) => process.exit(c));
}
