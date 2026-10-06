// node --test scripts/ci/pin-check.test.mjs — 씨앗은 실행 중에 조립한다
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkRoot, checkWorkflow } from './pin-check.mjs';
import { ROOT } from './gates.mjs';

const SHA = '0123456789abcdef'.repeat(2) + '01234567';
const WF = `name: x
on: [push]
permissions: {}
jobs:
  a:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - name: co
        uses: actions/checkout@${SHA} # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: ./local-action
      - run: node scripts/ci/run.mjs list
  b:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: org/repo/sub/path@${SHA} # v1
`;
const rules = (t) => checkWorkflow(t).map((v) => v.rule);

test('깨끗한 워크플로', () => {
  assert.deepEqual(checkWorkflow(WF), []);
});

test('저장소의 워크플로는 규칙을 지킨다', () => {
  assert.deepEqual(checkRoot(ROOT), []);
});

test('태그·브랜치·짧은 SHA·주석 없는 SHA는 pin 위반', () => {
  for (const ref of ['v' + '4', 'main', SHA.slice(0, 7), SHA]) {
    const t = WF.replace(`actions/checkout@${SHA} # v7.0.1`, `actions/checkout@${ref}`);
    assert.deepEqual(rules(t), ['pin'], ref);
  }
});

test('docker 이미지는 digest가 있어야 한다', () => {
  assert.deepEqual(rules(WF.replace('./local-action', 'docker://alpine:3')), ['pin']);
  assert.deepEqual(rules(WF.replace('./local-action', 'docker://alpine@sha256:' + 'a'.repeat(64))), []);
});

test('permissions: {} 없음', () => {
  assert.deepEqual(rules(WF.replace('permissions: {}\n', 'permissions:\n  contents: read\n')), ['permissions']);
});

test('persist-credentials 없음', () => {
  assert.deepEqual(rules(WF.replace('          persist-credentials: false\n', '')), ['credentials']);
});

test('timeout-minutes 없음', () => {
  const t = WF.replace('    timeout-minutes: 5\n    steps:\n      - uses: org', '    steps:\n      - uses: org');
  assert.deepEqual(checkWorkflow(t).map((v) => [v.rule, v.msg.includes(' b')]), [['timeout', true]]);
});

test('pull_request_target·workflow_run 금지', () => {
  assert.deepEqual(rules(WF.replace('on: [push]', 'on:\n  pull_request_target:')), ['trigger']);
  assert.deepEqual(rules(WF.replace('on: [push]', 'on: [push, workflow_run]')), ['trigger']);
});

test('container·services 이미지는 digest로 고정한다', () => {
  const D = 'ubuntu:22.04@sha256:' + 'b'.repeat(64);
  const withC = (c) => WF.replace('    runs-on: ubuntu-24.04\n    timeout-minutes: 5\n    steps:\n      - uses: org', `    runs-on: ubuntu-24.04\n${c}    timeout-minutes: 5\n    steps:\n      - uses: org`);
  assert.deepEqual(rules(withC(`    container: ${D}\n`)), []);
  assert.deepEqual(rules(withC(`    container:\n      image: ${D}\n`)), []);
  assert.deepEqual(rules(withC('    container: ubuntu:22.04\n')), ['image']);
  assert.deepEqual(rules(withC('    container:\n      image: ubuntu:22.04\n')), ['image']);
  assert.deepEqual(rules(withC('    container:\n      image: ${{ matrix.image }}\n')), ['image']);
  assert.deepEqual(rules(withC(`    services:\n      s3:\n        image: minio/minio:latest\n`)), ['image']);
});
