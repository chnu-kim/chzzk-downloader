// 테스트·selftest용 격리된 git. 사용자 전역·시스템 설정(서명, core.hooksPath, autocrlf, 자격 증명 등)을
// 읽지 않으므로 어느 머신에서나 같은 결과가 나온다. 예: 전역 commit.gpgsign이 외부 서명 도구를 부르면
// 임시 저장소의 커밋이 멈추거나 실패한다(실측: 1Password SSH 서명이 60초 뒤 실패).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let empty = null;
function emptyConfig() {
  if (!empty) {
    // /dev/null은 Windows에서 같은 뜻이 아니므로 빈 파일을 만든다
    empty = join(mkdtempSync(join(tmpdir(), 'git-cfg-')), 'empty.gitconfig');
    writeFileSync(empty, '');
  }
  return empty;
}

const BASE_ENV_DROP = /^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|PREFIX|CONFIG|CONFIG_PARAMETERS|CONFIG_COUNT|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/;

/** 격리된 git 환경. email·name은 작성자·커미터 모두에 쓴다. 훅 안에서 불려도 바깥 저장소를 가리키지 않게 GIT_DIR 등을 지운다. */
export function gitEnv({ email = 't@example.invalid', name = 't', extra = {} } = {}) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!BASE_ENV_DROP.test(k)) env[k] = v;
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: emptyConfig(),
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    ...extra,
  };
}

/** 격리된 git 실행. 결과(spawnSync)를 돌려준다. */
export function gitRun(cwd, args, opts = {}) {
  const { email, name, extra, ...rest } = opts;
  return spawnSync('git', ['-c', 'init.defaultBranch=master', ...args], {
    cwd,
    env: gitEnv({ email, name, extra }),
    encoding: 'utf8',
    ...rest,
  });
}

/** 격리된 git 실행. 실패하면 예외. stdout(앞뒤 공백 제거)을 돌려준다. */
export function gitOk(cwd, args, opts = {}) {
  const r = gitRun(cwd, args, opts);
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} → ${r.status}\n${r.stderr}`);
  return (r.stdout ?? '').trim();
}
