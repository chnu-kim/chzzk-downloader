// release.mjs(selftest·worker-bundle·worker 배포)와 worker-config.mjs가 함께 쓰는 jsonc 해석과 배포 설정. release.mjs가 worker 불변식 검사기(worker-config.mjs)를 import 그래프에 들이지 않게 따로 둔다(cicd.md 구현 중 변경 110).

export const DEPLOY_DIR = 'deploy';
// dist/wrangler.json의 main. 설정 파일 위치(dist/) 기준이라 index.js다(worker.md 구현 중 변경 35 (나): dist/index.js는 not found)
export const DEPLOY_MAIN = 'index.js';

// 문자열 밖만 훑는다. comments: 주석(// …, /* … */)을 지운다, 아니면 끝 쉼표(다음 의미 있는 글자가 } 또는 ])를 지운다.
// 문자열 안(예: "https://…")은 그대로 둔다. 주석을 먼저 지우고 쉼표를 지워야 `1, // 주석\n}`도 풀린다.
function scanJsonc(text, comments) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (comments && c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (comments && c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) throw new Error('닫히지 않은 /* 주석');
      i = end + 2;
    } else if (!comments && c === ',') {
      let j = i + 1;
      while (j < n && /\s/.test(text[j])) j++;
      if (text[j] !== '}' && text[j] !== ']') out += c;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

export function stripJsonc(text) {
  return scanJsonc(scanJsonc(text, true), false);
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

// dist/wrangler.json = 원본 wrangler.jsonc에서 main·no_bundle만 바꾼 것(worker.md 구현 중 변경 2·35, 순수). $schema는 둔다
export function deployConfig(cfg) {
  return { ...structuredClone(cfg), main: DEPLOY_MAIN, no_bundle: true };
}
