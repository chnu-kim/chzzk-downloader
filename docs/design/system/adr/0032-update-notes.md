# 0032 업데이트 바뀐 점: 배너 B4 안 접는 목록, 서명되지 않는 일반 텍스트

상태: 채택(잠정)   날짜: 2026-11-01   관련: D69, D5, D36, D57, patterns.md §12, content.md §13, app.md 128

## 맥락

앱 업데이트는 새 버전을 알리기만 하고 무엇이 바뀌었는지는 말하지 않는다. 셸(`FoundUpdate.notes`)과 DTO(`UpdateInfoDto.notes`)에는 자리가 있었지만 늘 `null`이었다. 버전마다 사람이 쓴 짧은 노트(`release/notes/<버전>.md`)를 `latest.json`의 `notes`로 실어 보내 "이번 버전에서 바뀐 점"을 보여 주기로 했다.

과제 문구는 "업데이트 대화상자"였지만 코드와 맞지 않았다. 대화상자 D5는 받는 중인 작업이 있을 때만 뜨고(`stores/update.svelte.ts`), 작업이 없으면 배너 B4의 [지금 업데이트]가 곧바로 설치한다. 대화상자에만 넣으면 대부분의 사람은 노트를 보지 못한다.

`latest.json`은 서명되지 않는다(서명은 설치 파일의 `.sig`에만 있다). R2나 Worker 경로가 뚫리면 `notes`를 바꿀 수 있으므로 앱은 이 값을 신뢰하지 않는 입력으로 다룬다.

## 결정

- **자리는 배너 B4 안이다.** 새 버전을 알리는 배너(`status === null`)의 동작 줄 아래에 `Disclosure variant="inline"` "이번 버전에서 바뀐 점"(`update.notes.title`)을 둔다. 기본은 접힘이다. 받는 중·설치 중·실패 배너에는 없다. D5와 `ConfirmDialog`는 바꾸지 않는다.
- **`Notice`에 `details` 슬롯을 더한다.** 동작 줄 뒤, `help` 앞의 자기 줄이고 라이브 영역(`notice-text`) 밖이다. 펼치고 접어도 배너가 다시 낭독되지 않는다. `row`에는 없다.
- **일반 텍스트 목록이다.** 줄마다 `<li><bdi>…</bdi></li>`, `{@html}`을 쓰지 않는다. HTML·마크다운은 해석하지도 지우지도 않는다(꺾쇠는 글자 그대로 나온다).
- **상한은 `UPDATE_NOTES_MAX_LINES`(5)줄, 줄당 `UPDATE_NOTES_LINE_MAX_GRAPHEMES`(80)자소다**(foundations §14). 넘치는 줄은 `…`로 자르고 넘치는 줄 수는 버린다. "외 n개" 같은 표시는 만들지 않는다(문구를 만들지 않기 위해서다).
- **정리 순서는 줄로 먼저 나눈 뒤 줄마다다.** `cleanDisplayText`·`clean_display_text`는 C0인 `\n`도 공백으로 바꾸므로 전체에 쓰면 줄이 합쳐진다. 셸 `clean_notes`가 신뢰 경계에서 한 번, 프런트 `updateNoteLines`가 한 번 더 막는다(mock·e2e는 셸을 거치지 않는다).
- **notes가 없으면 접는 줄 자체가 없다.** `null`·빈 문자열·정리 뒤 0줄 모두 같다. "바뀐 점이 없어요" 같은 빈 문구를 두지 않는다.
- **작성 쪽 형식**: `release/notes/<X.Y.Z>.md`는 0열 `- `로 시작하는 목록 줄만 쓴다(1~5개, 항목 1~80자). xtask `parse_notes`가 `<`·`>`·백틱·`](`·주소·`v` 뒤 숫자·제어 문자를 거부하고, `latest.json`의 `notes`는 항목을 `\n`으로 이은 일반 텍스트다. 태그 릴리스에서 그 버전 노트가 없으면 `release.mjs`의 gate와 publish가 실패한다(리허설·stage는 있으면 검증).

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 대화상자 D5는 받는 중인 작업이 있을 때만 뜬다. 없으면 [지금 업데이트]가 곧바로 설치한다 | E1 | `app/src/lib/stores/update.svelte.ts` `install`의 `needsConfirm` 분기, `update.spec.ts` 두 흐름 | 2026-11-01 |
| 새 버전 알림은 창을 띄우지 않는다. 사용자가 누를 때만 대화상자가 뜬다 | E0 | patterns.md §12, D5·D36 | 2026-11-01 |
| 보충 정보는 접는 영역으로 보여 준다 | E0 | D64·D66의 `Disclosure inline` 선례, components.md §2.8 | 2026-11-01 |
| 서명되지 않는 입력은 텍스트 노드로만 그리고 줄·길이를 막는다 | E0 | content.md §13 외부 문자열 위생, `latest.json`에는 서명이 없다(`xtask/src/manifest.rs`) | 2026-11-01 |
| 업데이트 플러그인이 `latest.json`의 `notes`를 `body`로 넘긴다 | E1 | `tauri-plugin-updater` 2.13 `updater.rs`(`notes` → `body`), `update_io.rs`의 `notes: u.body` | 2026-11-01 |

최고 등급: E1 / 결정 영향: 중간 / 판정: 채택(잠정)

## 결과

- 바뀌는 문서: README D69 행·ADR 목록, patterns.md §12, components.md §2.12(`details`), content.md §3.2·§4·§13·§15.1·§15.4, foundations §14, governance.md §6.4, app.md 128, cicd.md·worker.md 구현 중 변경, `docs/versioning.md`.
- 코드: `release/latest.schema.json`·xtask(`parse_notes`·`check_notes`·`--notes`), `release.mjs`(gate·publish), 셸 `clean_notes`, `Notice.svelte`·`UpdateNotes.svelte`·`UpdateBanner.svelte`·`display.ts`·`ko.ts`, e2e와 갤러리 장면 `update-notes`. DTO·command·bindings는 바뀌지 않는다.
- Worker는 고치지 않는다. `decideUpdate`는 원본 바이트를 그대로 넘기거나 `platforms[*].url`만 바꿔 다시 직렬화하므로 `notes`는 통과한다(`updater.test.ts`가 고정).
- 알려진 한계: `latest.json`이 변조되면 노트 내용도 바뀔 수 있다. 앱은 정리·상한·텍스트 렌더로 피해를 줄일 뿐 변조 자체를 탐지하지 못한다. `check_notes`는 verify·rollback에도 걸리므로 규칙을 강화하면 과거 매니페스트의 rollback이 깨질 수 있어 느슨하게만 바꾼다. `design-shots`의 `update-notes` 기준선은 Linux CI에서만 만든다.
- gate: `frontend`, `rust`, `e2e-web`, `design-tokens`, `design-copy`, `scripts-test`, `release-selftest`, `worker`, `design-shots`(관찰), `scan`.

### 재검증 조건

- **D62 과업(V11)**: 새 버전 배너에서 이번 버전에서 바뀐 점을 찾아 읽게 한다. 접힌 줄을 찾지 못하면(기본 펼침, 또는 D5 쪽 자리) 다시 본다.
- **실기**: 배너를 펼쳐 줄 모양·큰 글자·forced-colors에서 목록이 읽히는지 확인한다.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| (나) [지금 업데이트]를 누르면 늘 D5를 거치고 본문 아래에 목록을 둔다 | 설치가 한 단계 늘고, 확인용 대화상자(D36)에 정보를 섞는다. content §3.2 "본문 1~2문장"에 예외가 필요하고 `update.spec.ts` 흐름과 D5 기준선이 바뀐다 |
| (다) D5 본문에만 넣는다 | 받는 중인 작업이 있는 사람만 본다 |
| 새 대화상자 D9 | 새 버전 알림은 창을 띄우지 않는다(patterns §12). 대화상자 종 하나를 더하는 값이 정보 몇 줄보다 크다 |
| 첫 실행 "새 기능" 화면, /help 변경 이력 | 이번 범위 밖이다(`features` 목록에서 따로 본다) |
