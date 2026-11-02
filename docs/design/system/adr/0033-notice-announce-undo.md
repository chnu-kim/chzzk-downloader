# 0033 알림 낭독과 되돌리기 접근: 상주 라이브 영역, 키보드로 지운 작업 목록 되돌리기 토스트는 닫을 때까지, Mod+Z

상태: 채택(잠정)   날짜: 2026-11-02   관련: D70, D37, §6-7, §6-20, ADR-0009, ADR-0011, platform.md §12.2·§21 M26~M28, app.md 132

## 맥락
(가) 토스트는 Notice `role=status|alert`에만 낭독을 맡겼는데 Toaster가 `{#key item.id}`로 영역째 끼워 넣는다(`app/src/lib/components/app/Toaster.svelte:40-46`, `Notice.svelte:72,84`). 끼워 넣는 영역은 일부 조합에서 읽히지 않는다. 배너도 같다(`AppBanners.svelte:101-103`). 상주 polite 영역(`LiveAnnouncer.svelte:5`)은 있었지만 토스트·배너는 쓰지 않았다(`toast.svelte.ts:55-67`).
(나) 지연 삭제 토스트는 6초 뒤 닫히며 확정된다(`jobs.svelte.ts:416-433`, `timing.ts:9`). 포커스를 가져가지 않고(F-3), 단축키가 없고(`GlobalShortcuts.svelte:9-37`), 토스트는 main 뒤에 있어 키보드 사용자는 남은 행의 버튼을 Tab으로 다 지나야 닿는다. D37은 WCAG 2.2.2를 인용하면서 닿는 길을 정하지 않았다. 편집자 빼기도 같다(patterns.md §4).
(다) 작업 행 이름이 제목뿐이라(`JobItem.svelte:139`) 상태마다 다른 Enter·Delete의 결과를 알 수 없다. content.md 구현 기록 20이 §10 규칙을 미뤘다. platform.md §12.2의 "roving은 포커스 모드 role"과 작업 목록(`article`)이 어긋난다.
## 결정
- 앱의 Notice `toast`·`banner`에는 role이 없다. 토스트 store는 토스트가 보이게 될 때 한 번, AppBanners는 배너가 바뀌거나 업데이트 진행 문구가 바뀔 때 한 번 LiveAnnouncer에 넣는다. 오류(danger)는 새 assertive 영역(`aria-live="assertive"`, DS1 때문에 role 리터럴 없음). `inline`·Worker는 바꾸지 않는다.
- 낭독 문장에 동작 이름을 넣는다: `a11y.noticeAction`(‘{action}’ 버튼이 있어요), 되돌리기 토스트는 Windows·Linux에서 `a11y.noticeUndo`(Ctrl+Z 키로 되돌릴 수 있어요). macOS는 M27 전까지 버튼 이름만.
- 마지막 입력이 키보드이거나 `detail === 0` 클릭이면 **작업 목록 지우기**(작업 지우기·[완료 항목 지우기])의 되돌리기 토스트는 `sticky`(닫을 때까지)다. 지연 삭제 확정 시점(토스트가 닫힐 때)과 대기열 규칙은 그대로다. sticky는 로컬 데이터 정리에만 쓴다.
- **편집자 빼기는 sticky가 아니다**: 입력 방식과 무관하게 시간 제한 되돌리기(`TOAST_MS` + 정지, D37)다. 편집자 빼기는 권한 회수라, 닫을 때까지 밀리면 화면에서는 빠졌는데 서버에서는 권한이 남아 보안 상태가 사용자 인식과 어긋난다(Codex 리뷰 지적, `editorsRemove`가 토스트를 닫을 때만 나가고 받는 중이 없으면 종료가 D1을 거치지 않는다). 키보드 사용자는 [되돌리기]·Mod+Z로 6초 안에 무를 수 있고, 놓치면 다시 초대한다.
- 창 단축키 Mod+Z: 입력칸 밖, 모달 층 없음, 구간 편집 화면 닫힘(RE15)일 때 가장 최근에 올린 되돌리기 토스트를 실행하고 "되돌렸어요"를 읽는다.
- 작업 행 이름 `‘제목’: 상태`(+ `, N퍼센트`, 25% 단위 내림), 진행 낭독도 같은 25% 단위(P-9). 작업 목록 roving은 포커스 모드 role이 없는 예외이고 grid 전환은 M26 뒤 정한다.
## 근거
| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 라이브 영역은 먼저 (보통 빈 채로) 있어야 보조 기술이 변화를 안다 | E0 | MDN ARIA live regions | 2026-11-02 |
| 상태 메시지는 포커스 없이 보조 기술에 전달돼야 한다 | E0 | WCAG 2.2 SC 4.1.3 | 2026-11-02 |
| 시간 제한은 끄거나 늘릴 수 있어야 하고, 기능은 키보드로 할 수 있어야 한다 | E0 | WCAG 2.2 SC 2.2.1·2.1.1 | 2026-11-02 |
| 토스트가 끼워 넣는 영역에만 낭독을 맡기고, 되돌리기에 키보드로 닿는 길이 없다 | E1 | `Toaster.svelte:40-46`, `toast.svelte.ts:55-67`, `GlobalShortcuts.svelte:9-37`, `jobs.svelte.ts:416-433` | 2026-11-02 |
| 수동 알림은 놓치기 쉽다 | E0 | NN/g Indicators, Validations, and Notifications | 2026-11-02 |
| macOS 메뉴 가속키가 웹뷰 keydown보다 먼저 잡힐 수 있다 [잠정] | E1 | platform.md:174, `app/src-tauri/src/menu.rs:81` | 확인: §21 M27 |

최고 등급: E1 / 결정 영향: 중간 / 판정: 채택(잠정). 보조 기술 실측 없음.
## 결과
- 문서: README D70·D37 덧붙임·§6-20·§7.3, components.md §2.12 role 문단·§2.13 API·지속, patterns.md §1.3·§1.5·§4·§14.3, content.md §10·§15.1·§19-27, platform.md §12.2·§21 M26~M28, app.md 132.
- 코드: `Notice.svelte`·`Toast.svelte`·`LiveAnnouncer.svelte`·`announce.svelte.ts`·`toast.svelte.ts`·`spoken.ts`·`inputModality.ts`·`GlobalShortcuts.svelte`·`AppBanners.svelte`·`JobItem.svelte`·`jobs.ts`·`jobs.svelte.ts`·`editors.svelte.ts`·`platform.ts`·`ko.ts`·`design/copy/terms.json`·`CloseGuard.svelte`·`timing.ts`(`QUIT_FLUSH_MS`, foundations §14). DTO·command·bindings·가짜 백엔드는 그대로.
- 상주 영역은 body 직속으로 옮겨 `data-live-announcer`로 두고 `modalLayer`가 inert 대상에서 뺀다. 대화상자·구간 편집 화면이 열린 동안에도 25% 틱·배너·토스트 낭독이 막히지 않는다.
- sticky 토스트가 맨 앞이면 그 뒤에 온 토스트(정보·완료는 다음 토스트에 대체되고 오류는 줄을 선다)는 보이기 전에 바로 읽는다(오류는 assertive). 보일 때 다시 읽지 않는다.
- Mod+Z의 "되돌렸어요"는 같은 프레임에 기다리는 낭독 앞에 붙여 한 문장으로 읽는다(`announcer.lead`).
- 포커스가 그 행(`article`) **자체**에 있으면 25% 틱을 읽지 않는다(행 이름이 같은 문장으로 바뀌어 보조 기술이 알린다). 행 안 버튼([일시정지]·[더 보기] 등)에 포커스가 있으면 읽는다: 바뀌는 것은 조상의 이름뿐이라 보조 기술이 알리지 않는다. 건너뛴 단위도 읽은 것으로 올린다(행 이름이 이미 알렸고, 올리지 않으면 포커스가 떠난 뒤 지난 단위를 늦게 읽는다). 행 이름의 퍼센트도 틱과 같은 바닥(`state.percent`)에서 낸다.
- D1 [닫기]는 `quit` 전에 토스트를 비워 남은 지연 삭제(작업 목록 sticky, 아직 시간이 남은 편집자 빼기)를 확정하고 그 요청이 끝날 때까지 기다린다. `toasts.clear()`는 각 `onclose`가 돌려준 Promise를 `allSettled`로 모은 Promise를 돌려주고(실패해도 종료한다), CloseGuard는 `QUIT_FLUSH_MS`(5초, foundations §14)를 넘기면 기다리지 않고 `quit`한다(네트워크 요청에 종료가 묶이지 않게).
- 알려진 한계: sticky 토스트 뒤에 온 정보·완료 토스트는 읽히지만 화면에는 보이지 않을 수 있다. 받는 중인 작업이 없으면 셸 `guard_close`가 닫기를 허용해(`app/src-tauri/src/lib.rs` `guard_close`·`request_quit`·`on_run_event`) 창 닫기·메뉴 종료·Cmd+Q·Dock 종료가 프런트에 알리지 않고 끝난다(Windows 업데이트 설치의 `process::exit`도 같다). 프런트가 그 닫힘을 받을 길이 없고, 받게 하려면 셸이 프런트 응답을 기다리는 새 이벤트·기한이 필요해(프런트가 멈추면 앱이 닫히지 않는 위험) 두지 않았다. `pagehide`·`beforeunload`의 IPC는 전달이 보장되지 않는다. 그래서 그 길과 웹뷰 새로고침에서는 남은 지연 삭제가 확정되지 않는다: 작업 목록은 숨긴 작업이 `jobs.json`에서 지워지지 않아 다음 실행 때 다시 보인다(데이터 손실 아님). 편집자 빼기는 sticky가 아니므로 무기한 밀리지는 않지만, `TOAST_MS` 안에 앱을 닫으면 내보내기가 보내지지 않는다(sticky 이전부터 있던 한계, 다음 실행에 편집자가 목록에 다시 보인다). 프레임 안 마지막 낭독만 남는다(Mod+Z는 예외). macOS ⌘Z [잠정]
  확인: §21 M27.
- gate: `frontend`, `e2e-web`, `design-tokens`(design-lint·design-copy), `scripts-test`, `scan`. `design-shots`는 픽셀 변화 없음.
### 재검증 조건
- §21 M26~M28 실기(VoiceOver·NVDA+WebView2·Orca). 이중 낭독이 들리면 행 이름에서 퍼센트를 빼거나 틱을 포커스 밖 행만으로 줄인다. macOS ⌘Z가 keydown에 닿지 않으면 메뉴 "실행 취소"를 입력칸 밖일 때 프런트 이벤트로 잇는다. 브라우즈 모드가 목록 ↑↓를 막아 쓰기 어렵다고 확인되면 grid 전환 ADR.
- D62 V8(토스트) 과업 옆에서 키보드 사용자가 [되돌리기]·Mod+Z를 찾는지 관찰한다(N명 중 M명).
## 대안과 버린 이유
| 대안 | 버린 이유 |
|---|---|
| 토스트 영역을 상주시키고 role을 그대로 둔다 | Toaster의 대기열·퇴장 전환이 `{#key}`로 노드를 바꾼다. 상주 영역 둘(polite·assertive)이 더 단순하고 이중 낭독도 없다 |
| F6으로 토스트 랜드마크 이동 | 발견성이 가장 낮고 6초 안에 세 조작 |
| 모든 되돌리기 토스트를 sticky | 포인터 사용자에게 토스트가 쌓여 대기열이 막힌다. 키보드·보조 기술 경로만 시간 제한이 문제다 |
| 키보드로 뺀 편집자 빼기도 sticky(처음 안) | 권한 회수가 토스트를 닫을 때까지 밀리고, 받는 중이 없으면 종료가 D1을 거치지 않아 회수가 사라진다. 화면과 서버의 권한 상태가 어긋나는 쪽이 6초 시간 제한보다 나쁘다(Codex 리뷰) |
| 행 이름에 상태 줄 전체 | 속도·남은 시간·상대 시각이 매초 바뀌어 포커스 둔 행의 이름이 계속 바뀐다 |
| 작업 목록을 listbox로 | 행 안 버튼 때문에 axe nested-interactive·aria-required-children 위반 |
| 작업 목록을 grid로 지금 바꾼다 | 2차원 탐색 기대를 만들고 구조·axe·스냅샷을 다시 봐야 한다. 실측(M26) 뒤 |
