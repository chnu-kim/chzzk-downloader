// node --test scripts/ci/smoke.test.mjs — 마커 판정과 번들 수집 표(docs/design/cicd.md §6)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { pick } from './bundle.mjs';
import { ROOT } from './gates.mjs';
import { bundleSpec, checkMarker, INSTALL_STEPS, INSTALLERS, installBudgetMs, msiInstallDir } from './smoke.mjs';

test('마커: 정확히 {version, ready:true}', () => {
  assert.equal(checkMarker('{"version":"0.1.0","ready":true}\n', '0.1.0').ok, true);
  assert.match(checkMarker('{"version":"0.1.0","ready":false}', '0.1.0').why, /ready/);
  assert.match(checkMarker('{"version":"0.2.0","ready":true}', '0.1.0').why, /version/);
  assert.match(checkMarker('{"version":"0.1.0","ready":true,"x":1}', '0.1.0').why, /키/);
  assert.match(checkMarker('{"ready":true}', '0.1.0').why, /키/);
  assert.match(checkMarker('ready', '0.1.0').why, /JSON/);
  assert.match(checkMarker('[1]', '0.1.0').why, /객체/);
  assert.match(checkMarker('{"version":"0.1.0","ready":"true"}', '0.1.0').why, /ready/);
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
  assert.match(pick({ appimage: ['a.AppImage', 'a.AppImage.sig'], deb: ['a.deb', 'a.deb.sig'] }, LINUX, { release: true }).problems.join(), /deb\/a\.deb\.sig/);
  assert.equal(pick({ appimage: ['a.AppImage', 'a.AppImage.sig'], deb: ['a.deb'] }, LINUX, { release: true }).ok, true);
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
  assert.ok(at >= 0, `ci.yml에 작업 ${id}가 없다`);
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
});
