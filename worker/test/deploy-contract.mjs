// deploy-worker 배포 뒤 검사 계약(docs/design/worker.md §9.4, 구현 중 변경 36 (아)). 한 표를 세 곳이 읽는다:
//   - worker/test/http/update.test.ts: 진짜 Worker(exports)가 이 표대로 답한다
//   - scripts/ci/release.test.mjs: release.mjs WORKER_CHECKS(id·경로·자격)가 deploy 행과 같고, judgeCheck가 이 응답을 통과로 보며,
//     selftest의 가짜 Worker(scripts/ci/worker-stub.mjs)가 모든 행에 같은 상태·본문을 준다
// node:* 없는 순수 모듈이라 vitest(Workers 런타임)와 node가 함께 쓴다(seed-release.mjs와 같은 방식).
//
// 행: id, path("{version}" = 이번 태그 = latest.json의 version), cred("ci" = CI 토큰, "none" = Authorization 없음,
// "garbage" = CI 토큰도 앱 토큰도 아닌 Bearer), 기대: status(숫자) 또는 notOk(2xx가 아니면 된다), body "latest"(latest.json 바이트 그대로),
// code(오류 본문 {"code"}), location(Location 헤더). deploy: true인 행만 release.mjs가 배포 뒤에 친다(health는 따로, 배포 반영을 기다린다).
// deploy: false 행은 가짜 Worker가 진짜와 같은 규칙인지 보는 대조 행이다.

/** CI 토큰도 앱 토큰(cda_)도 아닌 Bearer 값 */
export const GARBAGE_BEARER = "not-a-token";

export const DEPLOY_CONTRACT = [
  { id: "update-latest", path: "/update/0.0.0", cred: "ci", status: 200, body: "latest", deploy: true },
  { id: "update-current", path: "/update/{version}", cred: "ci", status: 204, deploy: true },
  { id: "releases-latest-ci", path: "/releases/latest.json", cred: "ci", status: 200, body: "latest", deploy: true },
  // /admin은 W6부터 세션 없음 = 303 /(CI 토큰은 웹 경로에서 쓰레기 Bearer와 같다, 구현 중 변경 32 (다)).
  // release.mjs judgeCheck는 W6 전 Worker의 404도 통과로 보지만(2xx가 아니면 된다), 이 표는 지금 Worker의 답을 고정한다
  { id: "neg-admin", path: "/admin", cred: "ci", status: 303, location: "/", deploy: true },
  { id: "neg-latest-anon", path: "/releases/latest.json", cred: "none", status: 401, code: "invalid_token", deploy: true },
  { id: "neg-update-garbage", path: "/update/0.0.0", cred: "garbage", status: 401, code: "invalid_token", deploy: true },
  { id: "neg-me-ci", path: "/api/me", cred: "ci", status: 401, code: "invalid_token", deploy: true },
  // 대조 행: 버전 문법은 자격보다 먼저(400, R2 0회), 토큰 없음은 401, latest보다 높은 current는 204
  { id: "x-update-bad-version", path: "/update/not-semver", cred: "ci", status: 400, code: "bad_version", deploy: false },
  { id: "x-update-bad-version-anon", path: "/update/not-semver", cred: "none", status: 400, code: "bad_version", deploy: false },
  { id: "x-update-bad-escape", path: "/update/%E0%A4%A", cred: "ci", status: 400, code: "bad_version", deploy: false },
  { id: "x-update-anon", path: "/update/0.0.0", cred: "none", status: 401, code: "invalid_token", deploy: false },
  { id: "x-update-newer", path: "/update/999.0.0", cred: "ci", status: 204, deploy: false },
  { id: "x-latest-garbage", path: "/releases/latest.json", cred: "garbage", status: 401, code: "invalid_token", deploy: false },
];

/** 행의 경로(이번 버전을 채운다) */
export const contractPath = (row, version) => row.path.replace("{version}", version);
