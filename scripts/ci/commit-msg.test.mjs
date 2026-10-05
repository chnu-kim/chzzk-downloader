// node --test scripts/ci/commit-msg.test.mjs — 커밋 제목 형식(scan-msg의 형식 절반)
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkMessage } from './commit-msg.mjs';

test('type(scope)?: 요약은 통과한다', () => {
  for (const m of ['feat: 기능', 'fix(core): 고침', 'ci: G2 훅\n\n본문\n\nCo-Authored-By: x <x@example.invalid>', 'revert: 되돌림']) {
    assert.equal(checkMessage(m), null, m);
  }
});

test('형식이 아니면 거부한다', () => {
  for (const m of ['Add feature', 'feat:no space', 'feat : x', 'feature: x', 'feat(): x', 'feat: ', '', '# 주석만\n']) {
    assert.notEqual(checkMessage(m), null, JSON.stringify(m));
  }
});

test('git이 만드는 제목(merge·revert·fixup/squash/amend)은 통과한다', () => {
  for (const m of ["Merge branch 'master' into ci/pipeline", 'Revert "feat: 기능"', 'fixup! feat: 기능', 'squash! fix: x', 'amend! docs: y']) {
    assert.equal(checkMessage(m), null, m);
  }
});

test('주석 줄은 제목으로 보지 않는다', () => {
  assert.equal(checkMessage('# Please enter the commit message\nfeat: x\n'), null);
});
