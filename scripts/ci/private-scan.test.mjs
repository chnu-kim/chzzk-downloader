// node --test scripts/ci/private-scan.test.mjs — 비공개 denylist 고리(nightly private-scan, 구현 중 변경 77)
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { ROOT } from './gates.mjs';
import { parseList, verdict } from './private-scan.mjs';
import { entriesFor } from './public-scan.mjs';
import { gitEnv, gitOk } from './test-git.mjs';

const H = 'a'.repeat(64);

test('parseList: 64 hex·blob:·commit:만 받고, 주석·빈 줄은 건너뛰고, 틀린 줄은 번호만', () => {
  assert.deepEqual(parseList(`# 주석\n${H}\n\nblob:${H}  # 끝 주석\r\ncommit:${H}\n`), { entries: [H, `blob:${H}`, `commit:${H}`], bad: [] });
  assert.deepEqual(parseList(`${H}\n원문 채널 이름\nABC\n${H.toUpperCase()}`), { entries: [H], bad: [2, 3, 4] });
  assert.deepEqual(parseList(undefined), { entries: [], bad: [] });
  assert.deepEqual(parseList('  \n# 만\n'), { entries: [], bad: [] });
});

test('verdict: 오류가 있으면 unknown(2), 발견이면 leak(1), 둘 다 0이면 통과', () => {
  assert.deepEqual(verdict([0, 0]), [0, null]);
  assert.deepEqual(verdict([1, 0]), [1, 'leak']);
  assert.deepEqual(verdict([0, 1]), [1, 'leak']);
  assert.deepEqual(verdict([1, 2]), [2, 'unknown']);
  assert.deepEqual(verdict([null, 0]), [2, 'unknown']);
});

test('private-scan.mjs: secret 없음·형식 오류·발견·깨끗함, 로그와 GITHUB_OUTPUT에 원문·해시가 없다', () => {
  const d = mkdtempSync(join(tmpdir(), 'private-scan-'));
  try {
    const repo = join(d, 'repo');
    const tmp = join(d, 'runner-temp');
    gitOk(d, ['init', '-q', repo]);
    // 비공개 항목은 이력에만 남는다(트리에서는 지웠다): --all-history가 봐야 잡힌다
    const SECRET = 'zqvx private channel';
    writeFileSync(join(repo, 'a.txt'), `hello\n${SECRET}\n`);
    gitOk(repo, ['add', '.']);
    gitOk(repo, ['commit', '-q', '-m', 'test: a']);
    writeFileSync(join(repo, 'a.txt'), 'hello\n');
    gitOk(repo, ['commit', '-q', '-am', 'test: b']);
    mkdirSync(tmp); // RUNNER_TEMP 자리
    const run = (list) => {
      const out = join(d, 'out');
      writeFileSync(out, '');
      // 훅 안에서 돌 때 바깥 저장소의 GIT_DIR 등을 물려받지 않는다(gitEnv)
      const env = { ...gitEnv(), PRIVATE_SCAN_CWD: repo, RUNNER_TEMP: tmp, GITHUB_OUTPUT: out };
      if (list === undefined) delete env.PRIVATE_DENYLIST;
      else env.PRIVATE_DENYLIST = list;
      const r = spawnSync(process.execPath, [join(ROOT, 'scripts/ci/private-scan.mjs')], { env, encoding: 'utf8' });
      return { code: r.status, log: r.stdout + r.stderr, kinds: readFileSync(out, 'utf8').trim() };
    };
    const hashes = entriesFor(SECRET);

    let r = run(undefined);
    assert.equal(r.code, 1);
    assert.equal(r.kinds, 'kinds=no_secret');
    assert.match(r.log, /PRIVATE_DENYLIST가 없다/);

    r = run(`${SECRET}\n`);
    assert.equal(r.code, 1);
    assert.equal(r.kinds, 'kinds=no_secret');
    assert.match(r.log, /줄 1/);
    assert.ok(!r.log.includes('private channel'), '형식 오류에 원문을 찍지 않는다');

    r = run(hashes.join('\n'));
    assert.equal(r.code, 1, r.log);
    assert.equal(r.kinds, 'kinds=leak');
    assert.match(r.log, /a\.txt@[0-9a-f]{12}:2 {2}\[denylist\]/);
    assert.match(r.log, /추적 중인 파일 깨끗함/);
    assert.ok(!r.log.includes('private channel'), '원문을 찍지 않는다');
    for (const h of hashes) assert.ok(!r.log.includes(h), '해시를 찍지 않는다');

    r = run(entriesFor('nothing like this here').join('\n'));
    assert.equal(r.code, 0, r.log);
    assert.equal(r.kinds, '');

    // 임시 denylist 파일은 지운다
    assert.deepEqual(readdirSync(tmp).filter((n) => n.startsWith('private-scan-')), []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});
