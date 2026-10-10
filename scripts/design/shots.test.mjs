// shots.mjs(design-shots 보조) 테스트: 보고서 → 기준선 쌍, 로컬 --update-snapshots 거부.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { acceptPairs, refuseUpdate } from './shots.mjs';

const W = '/home/runner/work/r/r';
const res = (status, attachments) => ({ status, attachments });
const report = (tests) => ({ suites: [{ specs: [], suites: [{ specs: [{ tests }] }] }] });

test('acceptPairs: 실패한 스냅샷의 actual → 기준선(app/e2e/__shots__/…) 쌍, 통과·짝 없는 첨부는 뺀다', () => {
  const r = report([
    {
      projectName: 'dpr1-720',
      results: [
        res('failed', [
          { name: 'button-light-expected.png', path: `${W}/app/e2e/__shots__/dpr1-720/button-light.png` },
          { name: 'button-light-actual.png', path: `${W}/target/design-shots/results/shots-x-dpr1-720/button-light-actual.png` },
          { name: 'button-light-diff.png', path: `${W}/target/design-shots/results/shots-x-dpr1-720/button-light-diff.png` },
          // expected 짝이 없는 actual은 옮기지 않는다
          { name: 'lonely-actual.png', path: `${W}/target/design-shots/results/shots-x-dpr1-720/lonely-actual.png` },
          { name: 'error-context', path: `${W}/target/design-shots/results/shots-x-dpr1-720/error-context.md` },
        ]),
      ],
    },
    {
      projectName: 'dpr2-960',
      results: [
        res('passed', [
          { name: 'ok-expected.png', path: `${W}/app/e2e/__shots__/dpr2-960/ok.png` },
          { name: 'ok-actual.png', path: `${W}/target/design-shots/results/y/ok-actual.png` },
        ]),
      ],
    },
  ]);
  assert.deepEqual(acceptPairs(r, '/dl'), [
    { from: join('/dl', 'results/shots-x-dpr1-720/button-light-actual.png'), to: 'app/e2e/__shots__/dpr1-720/button-light.png' },
  ]);
});

test('acceptPairs: Windows 경로 구분자와 저장소 밖 경로', () => {
  const r = report([
    {
      projectName: 'dpr1-960',
      results: [
        res('failed', [
          { name: 'a-expected.png', path: 'D:\\a\\r\\r\\app\\e2e\\__shots__\\dpr1-960\\a.png' },
          { name: 'a-actual.png', path: 'D:\\a\\r\\r\\target\\design-shots\\results\\z\\a-actual.png' },
          { name: 'b-expected.png', path: '/elsewhere/b.png' },
          { name: 'b-actual.png', path: `${W}/target/design-shots/results/z/b-actual.png` },
        ]),
      ],
    },
  ]);
  assert.deepEqual(acceptPairs(r, '/dl').map((p) => p.to), ['app/e2e/__shots__/dpr1-960/a.png']);
});

test('refuseUpdate: CI가 아니면 -u·--update-snapshots를 거부한다', () => {
  assert.match(refuseUpdate(['-u'], {}), /CI에서만/);
  assert.match(refuseUpdate(['--update-snapshots=all'], { CI: 'false' }), /CI에서만/);
  assert.equal(refuseUpdate(['--update-snapshots'], { CI: 'true' }), null);
  assert.equal(refuseUpdate(['--grep', 'button'], {}), null);
});
