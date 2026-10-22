# 0030 구간 편집 화면: 창 전체 레이어, 상태 셋(확정·초안·열림), 공용 모달 층

상태: 채택(잠정)   날짜: 2026-10-22   관련: D67, D66, D65, D64, ADR-0005, ADR-0027, ADR-0028, ADR-0029, `docs/design/features/range-editor.md` RE1~RE21, components.md §2.29·§2.31~§2.33, patterns.md §6.5·§8, app.md 124

## 맥락

사용자는 카드 안 "미리보기·구간" 섹션(ADR-0029)을 써 본 뒤 UI가 별로라고 했고, 프리미어 프로 Source Monitor처럼 창 전체를 쓰는 구간 편집 화면을 원했다(2026-10-22). 시안 여럿을 거쳐 시안 7로 확정했고 Codex 시안 리뷰 두 건과 외부 검토 두 건을 명세에 반영했다. 이 ADR은 단계 RE-3(셸·상태·진입)의 결정을 적는다. 디자인 시스템의 세 가지를 건드린다(README §7.1).

- 4번 새 패턴: 창 전체 시트(레이어)와 초안/확정 두 단계 편집.
- 5번 [잠정] 항목: 영상 높이 계산(`VIDEO_MIN_H` 90, 조작 줄 최소 폭 380/464). 확인: 아래 재검증 조건.
- 기존 결정 번복: D66 PS9("구간은 섹션이 펼쳐져 있을 때만 적용")를 뒤집는다. 확정 구간은 열림과 무관하게 늘 적용된다.

## 결정

- **편집 화면은 `ResolveCard`가 소유하는 창 전체 레이어**(`receive/RangeEditor.svelte`, 뿌리는 `ui/Sheet.svelte`)다. `ui.view`에 새 뷰를 더하지 않는다: `HomeView`가 언마운트되면 카드의 화질·폴더·이름이 사라진다. 카드가 사라지면 레이어도 함께 사라지고 세션을 닫는다.
- **공용 `ui/modalLayer.ts`**(Dialog와 편집 화면이 함께 쓴다): 열린 층의 스택을 갖고, 층이 붙거나 떨어질 때마다 "맨 위 층 말고 body의 모든 자식은 inert"를 처음부터 다시 계산한다. 층이 붙기 전부터 있던 inert는 따로 기억해 되돌린다. 저장값 복원 방식은 쓰지 않는다: 편집 화면 위에 대화상자가 뜬 사이 카드가 사라지면(로그인 잠금·`{#key}`) 층이 생긴 역순이 아니어서 앱 전체가 inert로 남는다.
- **상태는 셋**: 확정 구간 `applied`(카드, 처음 null = 전체), 초안 `draft`(편집 화면, 열 때 `draftOf(applied)`), 열림 `editorOpen`. 검사 열쇠·`checkOutput`·`enqueue`·화질 크기·저장될 이름은 `applied` 하나만 읽는다. [구간 적용하기]가 `applyDraft`를 통과해야만 `applied`가 된다. 실패하면 화면은 열린 채 그 칸 아래 오류·포커스, 초안은 지우지 않는다. 카드 [받기]는 더 이상 구간을 검증하지 않는다.
- **[닫기]·Esc는 초안만 버리고 확인을 묻지 않는다.** 잃는 것은 초안뿐이고 확정값은 그대로다. 편집 화면 안 [구간 지우기]는 초안만, 카드의 [구간 지우기]는 확정값을 곧바로 지운다(포커스는 [구간 편집…]).
- **세션은 편집 화면 안 [영상 보기]를 눌렀을 때 연다**(D66 그대로). 영상과의 결합(`coupled` = hls.js로 붙고 메타데이터를 읽음)이 되기 전에는 조작 줄이 모두 disabled이고 타임라인·칸이 칸 편집기로만 동작한다. 진입 단추는 hls.js 지원을 미리 묻지 않는다(지원 여부는 동적 import 뒤에 안다).
- **창 수준 처리기를 거른다**: `ui.rangeEditorOpen`(레이어가 붙을 때 true, 떨어질 때 false) 하나를 Mod+L·Mod+,·입력칸 밖 붙여넣기·드롭·macOS 메뉴 "설정…"·"…에 관하여"가 본다. 카드의 Mod+Enter는 `defaultPrevented`가 주 근거이고 깃발이 둘째 거름이다. 편집 화면 뿌리는 Mod+Enter를 적용의 성공·실패와 관계없이 `preventDefault` + `stopPropagation`한다.
- **Esc 순서**: 길게 누른 Esc(`e.repeat`)는 편집 화면 뿌리·Esc 사다리 처리기·Dialog·창 처리기 모두 아무것도 닫지 않는다. 영상이 전체 화면이면 `stopPropagation`만 한다. 포커스가 body로 떨어져도 편집 화면은 Esc 사다리 맨 안쪽에 같은 규칙의 처리기를 쌓는다.
- **일반 VOD·클립의 "미리보기" 섹션은 그대로 둔다**(ADR-0029에서 이어지는 결정을 다시 적는다): 기본 펼침·앱 메모리 기억(`ui.previewOpen`)·표지 자리·[영상 보기]를 누를 때 세션·실패는 한 Notice(게이트 거부는 받기와 같은 문구)·16:9와 `--watch-max-h`·소유 판정 `notOwn`·`unknown`과 생방송에는 섹션이 없다. 구간이 없는 카드(R3)라 고칠 것이 없고, 섹션을 지우면 받기 전 확인 수단이 사라진다. 빠른 다시보기 카드에는 섹션이 없고 구간 줄이 그 자리에 든다.
- **ADR-0005(대화상자 버튼 배치)의 범위 밖이다.** 편집 화면은 `role="dialog"`지만 확인·선택을 묻는 대화상자가 아니라 창 전체 시트형 편집기다. 그래서 오른쪽 끝 primary가 "현 상태 유지"가 아니라 상태를 바꾸는 [구간 적용하기]이고 [닫기]가 단독 라벨이다. 근거는 사용자 결정 1이고, 안전은 "닫기 = 초안만 버림, 확정값 그대로"로 지킨다. ADR-0005 본문은 고치지 않는다.
- **구현 선택(RE-3, 명세와 다른 점)**: 새 토큰을 더하지 않았다. 토큰 gate는 컴포넌트 전용 치수 어휘와 coarse 블록을 고정하므로 영상 상자 최소 높이는 코드 상수 `VIDEO_MIN_H`(90), 조작 줄 최소 폭은 `controlsMinW(--control-h)` = 7×`--control-h` + 184(380, coarse 464)로 `rangeView.ts`에 둔다. 좁은 레이아웃 신호는 커스텀 프로퍼티 `--layout-narrow`(DL7 위반) 대신 `layout.css`가 `block`으로 바꾸는 보이지 않는 표지 `.fullsheet-probe`를 `getComputedStyle`로 읽는다. 레이어 CSS `.fullsheet`는 `--z-dialog`의 유일한 사용처 `design/ui.css`에 둔다(DT13). 머리 줄은 sticky가 아니라 시트 안 세로 flex의 고정 줄이고 몸통만 스크롤된다(`z-index` 토큰을 더 쓰지 않는다).

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 섹션 UI가 별로이고 Source Monitor식 창 전체 편집 화면을 원한다 | 사람 결정 | 사용자(range-editor.md 머리, 결정 1~6), 결정자: 사용자, 2026-10-22 | 2026-10-22 |
| 저장값 복원 방식의 inert는 층이 역순으로 닫히지 않으면 앱 전체를 잠근다 | E1 | `Dialog.svelte` 이전 값 복원(range-editor.md RE1·§20 ux2·H1), `modalLayer.test.ts` 순서 시험 | 2026-10-22 |
| 새 뷰를 만들면 카드가 언마운트되어 화질·폴더·이름·검사 상태가 사라진다 | E1 | `App.svelte` 뷰 분기, range-editor.md RE1 | 2026-10-22 |
| 닫기 확인은 "닫기 = 초안 버림"에 걸음을 더한다. 잃는 것은 초안뿐이다 | [가정] | 사용자 결정 1, range-editor.md RE17·Q2 | 2026-10-22 |
| 길게 누른 Esc가 두 층을 닫아 초안을 잃는다 | E1 | `GlobalShortcuts.svelte`·`Dialog.svelte` 이전 Esc 처리(`e.repeat`를 보지 않았다), range-editor.md RE16·§20 ux3 | 2026-10-22 |
| 토큰 gate는 속성 자리 어휘·coarse 블록·층 토큰 단일 사용처를 고정한다 | E1 | `scripts/design/check-tokens.mjs` DT3·DT7·DT11·DT13 | 2026-10-22 |

최고 등급: E1 / 결정 영향: 큼 / 판정: 채택(잠정)

등급 열의 "사람 결정"은 사용자가 정한 것이고 E0~E4 근거가 아니다. "[가정]"은 설계자의 판단이다.

## 결과

- 바뀌는 문서: README D66 행 끝("→ D67")·D67·ADR 목록·열린 항목 18, components.md §2.29(WatchPanel은 일반 VOD·클립 전용)·RangeEditor·RangeSummary·Sheet·modalLayer, patterns.md §6.5·§8(Esc·키)·§9 F-10·§15, content.md §4·§5.1·§5.2·§15, ADR-0029 상태 `폐기(→ 0030)`, `scripts/design/spec-check.mjs` D 번호 상한 67, `design/copy/terms.json`(`opensWindow` "구간 편집", 용어집 둘).
- 코드: `ui/modalLayer.ts`·`ui/Sheet.svelte`(새), `Dialog.svelte`(`modalLayer` 사용·`e.repeat` Esc), `receive/RangeEditor.svelte`·`RangeSummary.svelte`(새), `ResolveCard.svelte`(`applied`·`editorOpen`), `WatchPanel.svelte`(일반 VOD·클립 전용), `RangeField.svelte`(삭제), `rangeEdit.ts`(`open`·`begin`·`initialEnd` 삭제), `stores/ui.svelte.ts`(`rangeEditorOpen`), `GlobalShortcuts`·`InputPanel`·`App`(거름), `layout.css`(`.fullsheet-probe`), `ui.css`(`.fullsheet`). command·DTO·bindings는 바뀌지 않는다.
- 알려진 한계(RE-3): 타임라인은 옛 막대(`RangeTimeline`), 조작 줄은 옛 글자 단추다. RE-4가 타임라인을, RE-5가 조작 줄·키·아이콘 단추를 바꾼다. 갤러리 기준선은 Linux CI에서 받는다.
- 카드 높이: 빠른 다시보기 카드는 섹션이 없어져 약 1000 → 약 546이 된다(patterns §15).
- gate: `frontend`, `e2e-web`, `design-tokens`, `design-copy`, `design-lint`, `design-icons`, `scripts-test`(`spec-check.test.mjs`·`adr.test.mjs`), `design-shots`(관찰), `coverage`, `scan`.

### 재검증 조건

- **트랙패드 핀치·휠 단위·한글 입력 상태의 키**(M-RE-1·2, RE-4가 쓰는 입력): 3 OS 웹뷰에서 확인한다. 안 되면 후속 PR로 더한다.
- **영상 전체 화면 Esc**(M-RE-4): 전체 화면만 풀리고 편집 화면은 남는지 본다. 닫히면 Esc 순서를 다시 연다.
- **[영상 보기] 뒤 자동재생**(M-RE-5): 시작되거나 일시정지로 남고 조작 줄·controls로 시작할 수 있어야 한다.
- **초안을 잃고 놀라는지**(M-RE-8): 닫기·Esc 확인을 더하는 안(초안이 바뀌었을 때만)을 연다.
- **영상 높이 계산**(M-RE-9, `VIDEO_MIN_H` 90·조작 줄 380/464 [잠정]): 갤러리 측정으로 조인다. 확인: 720×520 장면에서 영상 높이와 조작 줄이 넘치지 않는지.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| `ui.view`에 새 뷰 | App이 `HomeView`를 언마운트해 카드 상태가 사라진다 |
| 대화상자 `Dialog` 재사용 | 크기 제한(`--dialog-w`)과 버튼 줄 규칙(ADR-0005)이 창 전체 편집기에 맞지 않는다 |
| 저장값 복원 방식 inert 유지 | 층이 역순으로 닫히지 않으면 앱 전체가 inert로 남는다 |
| 열 때 곧바로 세션 | 칸만 고치는 사용자의 요청과 소유 게이트 호출이 생긴다. D66 "누르기 전 요청 0"과 어긋난다 |
| 닫기 확인 대화상자 | "닫기 = 초안 버림"이라는 사용자 결정이 한 걸음 늘어난다. 잃는 것은 초안뿐이다 |
| 자체 조작부로 `controls` 대체 | 음량·전체 화면·속도를 다시 만들어야 한다(D64 네이티브 controls) |
| 새 CSS 토큰 `--editor-*`·커스텀 프로퍼티 `--layout-narrow` | 토큰 gate의 속성 자리 어휘·coarse 블록과 DL7(컴포넌트 커스텀 프로퍼티 금지)에 걸린다. 코드 상수와 `.fullsheet-probe`로 같은 값을 얻는다 |
| sticky 머리 + 레이어 전체 스크롤 | `--z-sticky`는 한 파일만 쓸 수 있다(DT13). 머리 줄을 스크롤 밖에 두면 z-index가 필요 없다 |
