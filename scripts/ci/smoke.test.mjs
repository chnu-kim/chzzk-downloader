// node --test scripts/ci/smoke.test.mjs — 마커 판정과 번들 수집 표(docs/design/cicd.md §6)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pick } from './bundle.mjs';
import { bundleSpec, checkMarker, msiInstallDir } from './smoke.mjs';

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
      assert.ok(['deb', 'appimage', 'dmg', 'nsis', 'msi'].includes(a.smoke), a.smoke);
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

test('msiInstallDir: 설치 로그의 마지막 INSTALLDIR', () => {
  const log = 'MSI (s) x\r\nProperty(S): INSTALLDIR = C:\\A\\\r\nProperty(S): INSTALLDIR = C:\\Users\\u\\AppData\\Local\\앱\\\r\nProperty(S): X = 1\r\n';
  assert.equal(msiInstallDir(log), 'C:\\Users\\u\\AppData\\Local\\앱');
  assert.equal(msiInstallDir('nothing'), null);
});
