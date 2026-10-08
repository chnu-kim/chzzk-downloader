# 버전 규칙

앱(Tauri 셸·코어)과 Worker는 버전 하나를 함께 쓴다. 버전은 [SemVer 2.0](https://semver.org/lang/ko/) 형식이고, 어느 자리를 올릴지는 지난 릴리스 뒤의 커밋 타입(Conventional Commit)으로 정한다. 태그 gate(`release.mjs gate`)가 이 규칙을 강제한다.

## 1. 형식

- `MAJOR.MINOR.PATCH` 숫자 셋. prerelease(`-rc.1`)와 빌드 메타데이터(`+…`)는 쓰지 않는다. 검증은 리허설(`release.yml` dispatch)로 한다. updater 채널이 하나라 prerelease를 올리면 모든 사용자가 받고, Windows MSI는 숫자가 아닌 prerelease를 받지 않는다.
- 태그는 `v` + 버전(`v0.3.0`). 버전 원천은 Cargo workspace `version`·`app/src-tauri/tauri.conf.json`·`app/package.json` 셋이고 `versions` gate가 일치를 본다(`fuzz/Cargo.lock`도 함께 올린다).
- MSI ProductVersion 한도 때문에 MAJOR·MINOR ≤ 255, PATCH ≤ 65535다(Tauri `bundle.windows.wix.version` 설명). 그래서 연도를 MAJOR에 두는 CalVer는 쓰지 않는다.
- Worker는 따로 버전을 두지 않는다. 앱 태그의 `deploy-worker`로 함께 배포된다.

## 2. 올림 규칙

지난 릴리스 태그(태그 커밋의 조상인 `v<semver>` 중 가장 큰 것) 뒤에 들어온, 머지가 아닌 커밋 메시지를 본다. 위에서부터 처음 맞는 줄을 쓴다.

| 커밋 | 1.0 이후 | 0.x 동안 |
|---|---|---|
| 깨지는 변경: 제목 `type!:`·`type(scope)!:` 또는 꼬리말 줄 머리 `BREAKING CHANGE:`·`BREAKING-CHANGE:` | MAJOR | MINOR |
| 제목 `feat:`·`feat(scope):` | MINOR | MINOR |
| 그 밖(`fix`·`docs`·`ci`·`chore`·`test`·`refactor`·`perf`·`build`·`style`·`revert`·`Revert "…"`) | PATCH | PATCH |

- 필요한 자리보다 **낮게** 올리면 태그 gate가 실패한다. **더 높게** 올리는 건 허용한다(1.0.0으로 올리기, 아래 0.2.x 건너뛰기).
- 올린 자리 아래는 0이다(0.3.2 → 0.4.0, 1.4.2 → 2.0.0). 0.3.0 → 0.4.1 같은 버전은 gate가 거부한다.
- 스쿼시 머지는 PR 제목이 커밋 제목이 되므로 PR 제목의 타입이 그 PR 전체를 대표한다. 본문의 커밋 목록(`* feat: …`)은 보지 않는다.
- 버전을 올리기 전에 `node scripts/ci/release.mjs next-version`으로 HEAD 기준 최소 버전을 본다.

## 3. 깨지는 변경(`!`)의 기준

다음 셋 중 하나라도 해당하면 `!`(또는 `BREAKING CHANGE:` 꼬리말)를 붙인다. 해당하지 않으면 붙이지 않는다.

1. **사용자 데이터**: `settings.json`·`jobs.json`·자격증명·`session.json`을 마이그레이션 없이 못 읽게 된다.
2. **앱 ↔ Worker 계약**: 운영 Worker가 이미 배포된 앱 버전의 요청(로그인·세션·updater·`/releases/**`)을 더는 받지 않는다. 옛 앱에 "새 버전을 받으세요"만 돌려주는 것도 여기에 든다.
3. **업데이트 경로**: 옛 앱이 자동 업데이트를 받지 못한다(`latest.json` 형식, updater 서명 키, 지원 OS·아키텍처 제외).

화면·문구 변경, 기능 제거라도 위 셋에 들지 않으면 `feat`/`fix`로 다룬다.

## 4. 1.0.0

다음 둘을 모두 만족하면 사람이 결정해 1.0.0으로 올린다.

- 실제 R2를 거친 자동 업데이트(설치된 앞 버전 → 새 버전)가 한 번 이상 성공했다.
- 앱 로그인이 루프백 방식으로 바뀌었고, 그 뒤로 앱 ↔ Worker 계약을 깰 계획이 없다.

1.0 이후 Worker는 같은 MAJOR의 모든 앱 버전 요청을 받는다.

## 5. 0.2.x를 건너뛴다

로컬 클론에는 비공개 저장소에서 온 옛 Go 시절 태그 `v0.2.0`·`v0.2.1`이 있다(origin에는 없다, cicd.md 21행). 같은 이름의 태그를 만들지 않도록 v0.1.1 다음 MINOR는 **0.3.0**이다. 규칙상 0.2.0이 최소지만 더 높게 올리는 건 허용된다. 태그는 지금처럼 `git push origin refs/tags/vX.Y.Z`로만 올린다(`--tags`면 옛 태그가 함께 나간다. 비공개 이력이라 push 가드가 막는다).

## 6. 지난 기록

- v0.1.0 → v0.1.1은 이 규칙 이전이다(그 사이 `feat`가 있었지만 PATCH). 소급하지 않는다.
- 이 규칙 이전 문서(worker.md 구현 중 변경 88, ROADMAP 루프백 L3)의 "0.1.2"는 루프백 묶음의 다음 릴리스를 가리키며, 이 규칙으로는 **0.3.0**이다(cicd.md 구현 중 변경 109).
