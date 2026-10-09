// node --test scripts/ci/smoke.test.mjs — 마커 판정과 번들 수집 표(docs/design/cicd.md §6)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { pick } from './bundle.mjs';
import { ROOT } from './gates.mjs';
import {
  APT_OPTS,
  bundleSpec,
  checkMarker,
  DIAG_TIMEOUT_MS,
  failureText,
  INSTALL_STEPS,
  INSTALLERS,
  installBudgetMs,
  msiInstallDir,
  PKG_ATTEMPT_S,
  PKG_DIAG,
  PKG_KILL_GRACE_S,
  PKG_TIMEOUT_MS,
  pkgArgv,
  retryOnce,
} from './smoke.mjs';

test('마커: 정확히 {version, ready:true, auth}', () => {
  const m = (o) => JSON.stringify({ version: '0.1.0', ready: true, auth: true, ...o });
  assert.equal(checkMarker(`${m({})}\n`, '0.1.0').ok, true);
  assert.match(checkMarker(m({ ready: false }), '0.1.0').why, /ready/);
  assert.match(checkMarker(m({ version: '0.2.0' }), '0.1.0').why, /version/);
  assert.match(checkMarker(m({ x: 1 }), '0.1.0').why, /키/);
  assert.match(checkMarker('{"ready":true}', '0.1.0').why, /키/);
  assert.match(checkMarker('{"version":"0.1.0","ready":true}', '0.1.0').why, /키/);
  assert.match(checkMarker('ready', '0.1.0').why, /JSON/);
  assert.match(checkMarker('[1]', '0.1.0').why, /객체/);
  assert.match(checkMarker(m({ ready: 'true' }), '0.1.0').why, /ready/);
  // auth: 불리언이어야 하고, 설치 스모크는 true를 요구한다
  assert.equal(checkMarker(m({}), '0.1.0', { auth: true }).ok, true);
  assert.match(checkMarker(m({ auth: false }), '0.1.0', { auth: true }).why, /auth/);
  assert.equal(checkMarker(m({ auth: false }), '0.1.0', {}).ok, true);
  assert.match(checkMarker(m({ auth: 'yes' }), '0.1.0').why, /auth/);
});

const LINUX = bundleSpec().linux;

test('번들 표: OS마다 arch·bundles·artifacts가 있고 이름이 겹치지 않는다', () => {
  const spec = bundleSpec();
  const names = new Set();
  for (const os of ['linux', 'darwin', 'windows']) {
    assert.ok(spec[os].arch && spec[os].bundles.length && spec[os].artifacts.length, os);
    for (const a of spec[os].artifacts) {
      assert.ok(!names.has(a.name), a.name);
      names.add(a.name);
      assert.ok(Object.hasOwn(INSTALLERS, a.smoke), a.smoke);
    }
  }
});

test('pick: 항목마다 정확히 한 파일', () => {
  const ok = pick({ appimage: ['x_0.1.0_amd64.AppImage'], deb: ['x_0.1.0_amd64.deb'] }, LINUX);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.picks.map((p) => p.file), ['x_0.1.0_amd64.AppImage', 'x_0.1.0_amd64.deb']);
  // AppImage 폴더의 다른 파일(.AppDir 등은 폴더라 목록에 없다, 다른 확장자)은 무시
  assert.equal(pick({ appimage: ['a.AppImage', 'build_appimage.sh'], deb: ['a.deb'] }, LINUX).ok, true);
});

test('pick: 없음·둘·모르는 번들 폴더는 실패', () => {
  assert.match(pick({ deb: ['a.deb'] }, LINUX).problems.join(), /appimage.*0개/);
  assert.match(pick({ appimage: ['a.AppImage', 'b.AppImage'], deb: ['a.deb'] }, LINUX).problems.join(), /2개/);
  assert.match(pick({ appimage: ['a.AppImage'], deb: ['a.deb'], rpm: ['a.rpm'] }, LINUX).problems.join(), /모르는 번들 폴더 bundle\/rpm/);
  // macOS는 app 번들 폴더(macos)를 허용한다
  assert.equal(pick({ dmg: ['a.dmg'], macos: [] }, bundleSpec().darwin).ok, true);
});

test('pick --release: updater 산출물의 .sig는 정확히 있어야 하고 그 밖의 .sig는 없어야 한다', () => {
  const D = bundleSpec().darwin;
  const listing = { dmg: ['a.dmg'], macos: ['a.app.tar.gz', 'a.app.tar.gz.sig'] };
  assert.equal(pick(listing, D, { release: true }).ok, true);
  assert.deepEqual(pick(listing, D, { release: true }).picks.map((p) => p.artifact.kind), ['dmg', 'app-tar']);
  // 보통 모드는 release 전용 항목을 찾지 않는다
  assert.deepEqual(pick({ dmg: ['a.dmg'], macos: [] }, D).picks.map((p) => p.artifact.kind), ['dmg']);
  assert.match(pick({ dmg: ['a.dmg'], macos: ['a.app.tar.gz'] }, D, { release: true }).problems.join(), /a\.app\.tar\.gz\.sig가 없다/);
  assert.match(pick({ dmg: ['a.dmg', 'a.dmg.sig'], macos: ['a.app.tar.gz', 'a.app.tar.gz.sig'] }, D, { release: true }).problems.join(), /a\.dmg\.sig: 표의 updater 산출물이 아닌데/);
  // deb도 updater 산출물이다(Tauri 2.12가 .deb.sig를 만든다, 첫 리허설 실측)
  assert.equal(pick({ appimage: ['a.AppImage', 'a.AppImage.sig'], deb: ['a.deb', 'a.deb.sig'] }, LINUX, { release: true }).ok, true);
  assert.match(pick({ appimage: ['a.AppImage', 'a.AppImage.sig'], deb: ['a.deb'] }, LINUX, { release: true }).problems.join(), /deb\/a\.deb\.sig가 없다/);
});

test('msiInstallDir: 설치 로그의 마지막 INSTALLDIR', () => {
  const log = 'MSI (s) x\r\nProperty(S): INSTALLDIR = C:\\A\\\r\nProperty(S): INSTALLDIR = C:\\Users\\u\\AppData\\Local\\앱\\\r\nProperty(S): X = 1\r\n';
  assert.equal(msiInstallDir(log), 'C:\\Users\\u\\AppData\\Local\\앱');
  assert.equal(msiInstallDir('nothing'), null);
});

// ci.yml에서 작업 하나의 본문(두 칸 들여쓴 작업 키부터 다음 작업 키 전까지)
function jobBody(yml, id) {
  const lines = yml.split('\n');
  const at = lines.findIndex((l) => l === `  ${id}:`);
  assert.ok(at >= 0, `워크플로에 작업 ${id}가 없다`);
  const end = lines.findIndex((l, i) => i > at && /^ {2}[A-Za-z0-9_-]+:\s*$/.test(l));
  return lines.slice(at, end < 0 ? undefined : end).join('\n');
}

test('설치 스모크 최악 시간 < CI 시간 제한(안쪽 명령 제한이 먼저 걸려 로그가 남는다)', () => {
  const yml = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  // linux: smoke-install (linux) 작업 전체 시간 제한
  const linuxJob = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(jobBody(yml, 'smoke-install-linux'))[1]);
  // darwin·windows: bundle 작업의 smoke-install 단계 시간 제한
  const step = /- name: smoke-install\n(?: {8}.*\n)*? {8}timeout-minutes: (\d+)/.exec(jobBody(yml, 'bundle'));
  assert.ok(step, 'bundle 작업의 smoke-install 단계에 timeout-minutes가 없다');
  const stepMin = Number(step[1]);
  const margin = 60_000; // 준비·출력 여유
  assert.ok(installBudgetMs('linux') + margin <= linuxJob * 60_000, `linux ${installBudgetMs('linux')}ms vs ${linuxJob}분`);
  for (const os of ['darwin', 'windows']) assert.ok(installBudgetMs(os) + margin <= stepMin * 60_000, `${os} ${installBudgetMs(os)}ms vs ${stepMin}분`);
  assert.deepEqual(Object.keys(INSTALL_STEPS).sort(), Object.keys(bundleSpec()).filter((k) => !k.startsWith('$')).sort());
  // release.yml도 같은 예산이다(릴리스는 macOS .app.tar.gz 스모크가 더해져 가장 길다)
  const rel = readFileSync(join(ROOT, '.github/workflows/release.yml'), 'utf8');
  const relLinux = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(jobBody(rel, 'smoke-linux'))[1]);
  const relStep = /- name: smoke-install\n(?: {8}.*\n)*? {8}timeout-minutes: (\d+)/.exec(jobBody(rel, 'build'));
  assert.ok(relStep, 'release.yml build 작업의 smoke-install 단계에 timeout-minutes가 없다');
  assert.ok(installBudgetMs('linux') + margin <= relLinux * 60_000);
  for (const os of ['darwin', 'windows']) assert.ok(installBudgetMs(os) + margin <= Number(relStep[1]) * 60_000, `release ${os}`);
});

// ---- 패키지 명령(cicd.md 구현 중 변경 113) ----

test('pkgArgv: sudo 안쪽에 env·timeout을 두고, 안쪽 제한이 바깥 제한보다 먼저 걸린다', () => {
  const a = pkgArgv('apt-get', [...APT_OPTS, 'install', '-y', '/x.deb'], { root: false });
  assert.deepEqual(a.slice(0, 7), ['sudo', 'env', 'DEBIAN_FRONTEND=noninteractive', 'timeout', '-k', `${PKG_KILL_GRACE_S}s`, `${PKG_ATTEMPT_S}s`]);
  assert.deepEqual(a.slice(7, 8), ['apt-get']);
  assert.equal(a.at(-1), '/x.deb');
  // root면 sudo 없이 같은 모양
  assert.deepEqual(pkgArgv('dpkg', ['--configure', '-a'], { root: true }), a.slice(1, 7).concat(['dpkg', '--configure', '-a']));
  assert.ok((PKG_ATTEMPT_S + PKG_KILL_GRACE_S) * 1000 < PKG_TIMEOUT_MS);
});

test('APT_OPTS: 잠금 대기·다시 받기·연결 대기가 명시되고 한 시도 안에 끝난다', () => {
  const o = Object.fromEntries(APT_OPTS.filter((_, i) => i % 2 === 1).map((kv) => kv.split('=')));
  assert.ok(APT_OPTS.every((x, i) => (i % 2 === 0 ? x === '-o' : /^[\w:]+=\d+$/.test(x))));
  assert.ok(Number(o['DPkg::Lock::Timeout']) > 0 && Number(o['DPkg::Lock::Timeout']) < PKG_ATTEMPT_S);
  assert.ok(Number(o['Acquire::Retries']) >= 1);
  assert.ok(Number(o['Acquire::http::Timeout']) > 0 && Number(o['Acquire::http::Timeout']) < PKG_ATTEMPT_S);
});

test('PKG_DIAG: apt·dpkg·unattended 프로세스와 잠금 파일 보유자를 본다', () => {
  const text = PKG_DIAG.map(([b, a]) => [b, ...a].join(' ')).join('\n');
  for (const w of ['apt', 'dpkg', 'unattended', '/usr/lib/apt/methods', 'etime', 'fuser', '/var/lib/dpkg/lock-frontend', '/var/cache/apt/archives/lock']) {
    assert.ok(text.includes(w), w);
  }
});

test('failureText: 시간 초과·실패 때 stdout·stderr 끝부분을 남긴다', () => {
  const t = failureText('sudo', ['apt-get', 'install'], { error: { code: 'ETIMEDOUT' }, stdout: 'Get:3 x\n', stderr: 'W: y\n' }, 240_000);
  assert.match(t, /240초 안에 끝나지 않았다/);
  assert.match(t, /stdout 끝부분\nGet:3 x/);
  assert.match(t, /stderr 끝부분\nW: y/);
  assert.match(failureText('dpkg', ['-L', 'p'], { status: 1, stdout: '', stderr: 'no' }, 1000), /exit 1\n--- stderr 끝부분\nno$/);
  // 긴 출력은 끝 4000자만
  assert.equal(failureText('a', [], { status: 2, stdout: 'x'.repeat(9000), stderr: null }, 1).match(/x{2,}/)[0].length, 4000);
});

test('spawnSync는 시간 초과로 죽인 뒤에도 그때까지의 출력을 돌려준다(failureText의 전제)', () => {
  const code = "const fs=require('fs');fs.writeSync(1,'out-line\\n');fs.writeSync(2,'err-line\\n');setTimeout(()=>{},60000)";
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 5000, killSignal: 'SIGKILL' });
  assert.equal(r.error?.code, 'ETIMEDOUT');
  assert.match(failureText('node', [], r, 5000), /끝나지 않았다[\s\S]*out-line[\s\S]*err-line/);
});

test('retryOnce: 첫 시도 실패면 repair 뒤 한 번 더, 두 번 실패면 두 이유를 함께', () => {
  const seq = (...rs) => {
    const calls = [];
    return { calls, run: () => (calls.push('run'), rs.shift()), repair: () => (calls.push('repair'), { ok: true }) };
  };
  let s = seq({ ok: true });
  assert.deepEqual(retryOnce(s.run, s.repair), { ok: true, attempts: 1 });
  assert.deepEqual(s.calls, ['run']);
  s = seq({ ok: false, why: 'a' }, { ok: true, why: null });
  assert.deepEqual(retryOnce(s.run, s.repair), { ok: true, why: null, attempts: 2 });
  assert.deepEqual(s.calls, ['run', 'repair', 'run']);
  s = seq({ ok: false, why: 'a' }, { ok: false, why: 'b' });
  const r = retryOnce(s.run, s.repair);
  assert.equal(r.ok, false);
  assert.match(r.why, /a.*b/);
});

test('linux 설치 예산: 패키지 명령마다 바깥 제한 + 진단, 그 밖은 그대로', () => {
  const n = INSTALL_STEPS.linux;
  assert.equal(n.pkg, 4); // install 두 번, dpkg --configure -a, purge
  assert.equal(installBudgetMs('linux'), n.sh * 240_000 + n.pkg * (PKG_TIMEOUT_MS + PKG_DIAG.length * DIAG_TIMEOUT_MS) + n.smoke * 120_000);
});
