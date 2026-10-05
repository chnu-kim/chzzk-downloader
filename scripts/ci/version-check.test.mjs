// node --test scripts/ci/version-check.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { compareVersions } from './version-check.mjs';

const src = (...vs) => vs.map((v, i) => ({ source: `s${i}`, version: v }));

test('같으면 통과', () => {
  assert.equal(compareVersions(src('0.1.0', '0.1.0', '0.1.0')).ok, true);
  assert.equal(compareVersions(src('1.2.3', '1.2.3'), 'v1.2.3').ok, true);
  assert.equal(compareVersions(src('1.2.3-rc.1', '1.2.3-rc.1'), 'v1.2.3-rc.1').ok, true);
});

test('하나라도 다르면 실패', () => {
  assert.equal(compareVersions(src('0.1.0', '0.1.0', '0.2.0')).ok, false);
  assert.equal(compareVersions(src('0.1.0', '0.1.0'), 'v0.1.1').ok, false);
});

test('태그는 v로 시작해야 하고 값은 semver여야 한다', () => {
  assert.equal(compareVersions(src('0.1.0'), '0.1.0').ok, false);
  assert.equal(compareVersions(src('0.1')).ok, false);
  assert.equal(compareVersions(src('01.0.0')).ok, false);
  assert.equal(compareVersions(src(undefined)).ok, false);
});
