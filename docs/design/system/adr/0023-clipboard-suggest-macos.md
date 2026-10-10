# 0023 클립보드 제안: macOS는 alwaysAllow일 때만 읽고, 셀렉터가 없는 OS에서는 읽는다

상태: 채택(잠정)   날짜: 2026-10-10   관련: D56, platform §17.2·§22 37, app.md 구현 중 변경 37·44·67 (자)

## 맥락

앱은 창이 포커스를 얻을 때마다 클립보드에서 치지직 주소를 찾아 홈에 제안한다(app.md 44). macOS 15.4부터 일반 pasteboard의 프로그램 접근은 기본이 "묻는다"이고, 창 포커스마다 읽는 우리 동작은 사용자 입력이 아니어서 확인 창이 계속 뜰 수 있다. 그 창은 앱에 대한 신뢰를 깎는다(g-ime §4.1). 한편 `accessBehavior` 셀렉터는 macOS 15.4에 처음 생겼고 13.3~15.3(앱의 최소 지원 버전은 13.3)에서 그냥 부르면 Objective-C 예외로 프로세스가 죽는다. 코드는 `crates/shell/src/pasteboard.rs`와 `clipboard_link` command다.

## 결정

자동 읽기(클립보드 제안)는 **macOS에서 `accessBehavior`가 `alwaysAllow`이거나 셀렉터가 없을 때(`Unsupported`)만** 한다. `ask`·`default`·`alwaysDeny`, 그리고 모르는 값은 제안을 켜지 않고 붙여넣기·최근 목록 경로를 쓴다. Windows·Linux는 늘 읽는다.

- 순수 함수 `suggest_allowed(os, behavior)`가 표를 가진다. macOS는 `AlwaysAllow`·`Unsupported`만 true, 그 밖 OS는 늘 true.
- macOS 구현은 `NSPasteboard.general`에 **`respondsToSelector:`로 먼저 물은 뒤** `accessBehavior`를 부른다. 없으면 `Unsupported`다.
- `clipboard_link`는 읽기 전에 정책을 보고 false면 `Ok(None)`을 돌려준다(읽지 않는다). 테스트가 설 수 있게 정책을 `ClipboardPolicy(fn() -> bool)`로 관리 상태에 둔다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| macOS 15.4+는 프로그램의 일반 pasteboard 접근을 기본으로 "묻는다"고 SDK 헤더가 적는다 | E1 | SDK 헤더 `NSPasteboard.accessBehavior`, g-ime §4.1 | 2026-10-10 |
| 우리 읽기는 창 포커스마다라 사용자 입력이 아니다 | E1 | g-ime §4.1, app.md 44 | 2026-10-10 |
| 13.3~15.3에서 15.4 전용 셀렉터를 그냥 부르면 예외로 죽으므로 응답 여부를 먼저 확인해야 한다 | E1 | Objective-C 런타임 동작, 앱 `minimumSystemVersion` 13.3(platform §13) | 2026-10-10 |
| 26.x에서 기본값이 실제로 바뀌어 확인 창이 뜨는지는 아직 모른다 | E0 | 헤더 문서만 있고 실기 기록 없음. 설계가 두 경우를 모두 덮는다 | — |

최고 등급: E1 / 결정 영향: 작음 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: `crates/shell/src/pasteboard.rs`(`AccessBehavior`·`PasteboardAccess`·`suggest_allowed`·`system_suggest_allowed`), `clipboard_link`(정책 seam), platform §17.2·§22 37, app.md 67 (자).
- 모르는 `accessBehavior` 값은 읽지 않는 쪽(`Ask`)으로 매핑한다. 읽기를 줄이는 방향의 실패가 사용자에게 확인 창을 띄우는 방향보다 안전하다.
- gate: `rust`(가짜 `PasteboardAccess` 표 테스트: macOS Default·Ask·AlwaysDeny → false, AlwaysAllow·Unsupported → true, Windows·Linux 늘 true), `tauri`(IPC에서 정책이 false면 `None`).

### 재검증 조건

- macOS 26.x 실기에서 기본값이 `alwaysAllow`이거나 확인 창 없이 읽히는 것이 확인되면 "묻기 기본" 가정을 접는다. 확인: macOS 15.4+·26.x 실기(platform §21에 항목을 더한다), 개발 기기는 기본 정책이 "묻기"라 `ClipboardPolicy` seam 없이는 읽기 테스트가 서지 않는다.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 모든 macOS에서 계속 읽는다 | 15.4+에서 포커스마다 확인 창이 뜰 수 있다 |
| 클립보드 제안을 없앤다 | Windows·Linux와 15.4 미만 macOS의 사용자는 이 제안을 쓴다. 붙여넣기 경로는 있으나 한 단계가 늘어난다 |
| 셀렉터 확인 없이 `accessBehavior`를 호출한다 | 13.3~15.3에서 예외로 앱이 죽는다 |
| 첫 실행에 사용자에게 "클립보드를 읽어도 되나요"를 묻는다 | OS 확인 창과 이중이 되고 앱이 따로 허락을 받는 것처럼 보인다 |
| 모르는 값을 읽는 쪽으로 둔다 | 새 OS가 값을 더했을 때 확인 창을 일으킬 수 있다 |
