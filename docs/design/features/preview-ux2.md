# 미리보기·구간 섹션 개편(구간 편집 UX 2단계): 명세

**상태·확정 결정(2026-10-21)**: **구현 완료(PS-1~PS-4, §16), 실측 대기. 열린 질문 없음(§14, 사용자 위임으로 추천안 확정). 적대적 재검토 반영(§15).** 사용자가 PVU-1~6(`preview-ux.md`)을 직접 써 본 뒤 내린 결정(2026-10-21)은 둘이다.
- (1) 시작·끝 ±1초 단추 네 개([1초 당기기]·[1초 미루기])를 없앤다. 대신 시작·끝 시각 칸에 포커스가 있을 때 ↑/↓ 키로 1초씩 바꾸고, 영상도 그 시각으로 따라간다. 순수 모델 `rangeEdit.nudge`를 그대로 쓴다.
- (2) 미리보기와 일부만 받기를 눌러야 보이던 것을 기본으로 보여 준다.
  - 미리보기 영역은 처음부터 펼쳐져 있다. 영상 자리에는 표지 자리와 [영상 보기] 단추만 있다.
  - 미리보기 세션(`watch_open`)은 그 단추를 눌렀을 때 연다. 누르기 전에는 네트워크 요청이 없다.
  - 빠른 다시보기 카드에서는 미리보기와 구간을 **한 섹션 "미리보기·구간"**으로 묶는다. 영상 아래 구간 편집(막대·칸·길이)이 늘 보이고, 칸이 비면 "전체"임이 드러난다.
  - 섹션을 접으면 하나로 함께 접힌다. 그 상태는 다음 카드에도 이어진다.
  - 일반 VOD·클립은 같은 섹션에 미리보기만 있다.
  - [받기] 줄은 카드 아래에 고정이다. 이미 sticky라 확인만 한다(PS13).
  - `ownership`이 `notOwn`·`unknown`인 카드와 생방송에는 지금처럼 섹션을 그리지 않는다.

구현은 TDD다(§10·§11). 실패 테스트를 먼저 쓰고 최소 구현으로 녹색을 만든다. 상태 규칙은 지금처럼 순수 함수(`rangeEdit.ts`·`receive.ts`)에 두고 컴포넌트는 부르기만 한다.

기준 트리는 `feat/preview-ux2` = origin/master `8bd9cf9`다. 미리보기 PV-1~8(`preview.md`)과 구간 편집 PVU-1~6(`preview-ux.md`)이 모두 들어 있다. 형식과 근거 표기는 `preview-ux.md`를 따른다.
- **[확인]**: 이 트리에서 직접 연 줄이 받친다.
- **[가정]**: 코드로 확인하지 못한 판단이다. 일반 지식이나 설계 선택이다.
- **[실측 필요]**: 3 OS 웹뷰나 보조기술로만 정할 수 있다(§13 M-PVU2-*).
- **[잠정]**: 숫자 상수다. 근거가 약하고 실측으로 조인다.

예시 값(시각·길이·크기)은 모두 가짜다. 공개 저장소 규칙을 따른다.

---

## 0. 핵심 결정(요약)

| # | 결정 | 근거 |
|---|---|---|
| PS1 | **±1초 단추 네 개와 문구 여섯 키를 지우고, 시작·끝 칸의 `onkeydown`에서 ↑(+1초)·↓(−1초)를 받는다.** 새 칸은 기존 `rangeEdit.nudge`가 만든다. 칸 값을 바꾸고, 앞 [받기]의 구간 오류를 지우고, 미리보기가 붙어 있으면 영상도 그 시각으로 보낸다. 지금 `nudgeRange` 몸통이 하는 일과 같다. ↑가 "늘림"인 것은 `<input type=number>`·슬라이더(APG)의 관례와 같다. 수식 키(Shift·Alt·Ctrl·Meta)가 있으면 처리하지 않는다. Shift+↑ 선택, ⌘↑ 줄 처음 같은 칸의 기본 편집 동작을 남긴다 | 단추 몸통 `nudgeRange`(`ResolveCard.svelte:215-223`), 활성 판정 `canNudge`(`:210-212`) [확인]. 단추 스니펫(`RangeField.svelte:95-107`)과 키 여섯(`ko.ts:79-84`) [확인]. `TextField`는 나머지 속성을 `<input>`에 그대로 넘긴다(`TextField.svelte:6,28,47`, `onkeydown`·`aria-keyshortcuts`가 닿는다) [확인] |
| PS2 | **수식 키 없는 ↑/↓는 두 칸에서 늘 `preventDefault`한다**(사용자 요구 "칸 안 ↑/↓의 기본 동작 막기"). 첫 줄에서 `isImeKey`로 거른다(조합 중 ↑/↓는 IME 후보 이동이라 막지 않는다). 칸을 못 읽어 `nudge`가 `null`이면 기본 동작만 막고 값은 그대로 둔다(캐럿이 칸 처음·끝으로 튀지 않는다). 키를 누르고 있으면(`e.repeat`) 칸은 누를 때마다 바뀌고, 영상 탐색은 **첫 keydown과 keyup에서 한 번씩만** 한다. keyup 전에 포커스가 떠나면(Tab·클릭) **blur에서 남은 탐색을 한 번 한다**. 연달은 탐색은 중계·hls.js에 몰린다(preview-ux §12 "탐색은 한 번에 하나") | DX6: keydown 리스너 파일은 `isImeKey`를 import한다(`governance.md:282`, `lint.mjs:679-685`) [확인]. `ResolveCard.svelte`는 이미 import한다(`:49`) [확인]. 연달은 탐색의 위험은 preview-ux §12 [확인: 문서] |
| PS3 | ↑/↓로 칸을 바꾼 뒤에는 **카드가 기억한 "포커스 때 글자"(`focusText`)를 새 값으로 바꾼다.** 그래야 blur가 같은 시각으로 한 번 더 탐색해 구간 보기를 끄지 않는다(PVU10은 "포커스 때와 다를 때만 탐색"이다) | `focusField`·`blurField`(`ResolveCard.svelte:186-207`) [확인] |
| PS4 | **"모든 동작에 버튼이 있다"(patterns §8 규칙 1)와의 관계**: ↑/↓는 새 명령이 아니라 **칸 값 편집의 가속기**다. 같은 일을 단추 없이 타이핑(칸), 손잡이 끌기·키(막대), [시작 찍기]·[끝 찍기]로 할 수 있다. 그래서 규칙 1을 깨지 않는다. patterns §8 표에 "구간 칸: ↑/↓" 행을 더하고 칸에 `aria-keyshortcuts="ArrowUp ArrowDown"`을 단다. 보이는 힌트는 1단계(PVU13·Q4)처럼 두지 않는다 | `patterns.md:463` 규칙 1, `:467` 규칙 5 [확인]. 찍기 단추의 `aria-keyshortcuts` 선례(`WatchPanel.svelte` 조작 줄) [확인] |
| PS5 | **프런트가 쓸 수 있는 표지는 없다. 그래서 표지 대신 "표지 자리"를 그린다.** `.stage`와 같은 16:9 상자(`--surface-2`, 최대 높이 `--watch-max-h`)의 가운데에 [영상 보기] 단추(아이콘 `play` + 글자)를 둔다. 이미지 요청은 없다. 재생기와 같은 상자라 눌러도 배치가 밀리지 않는다. 실제 표지 이미지는 §12 후속이다(새 command가 필요하고, 그 요청은 "누르기 전 요청 없음"과 부딪혀 사용자 확인이 필요하다) | 표지 주소는 코어 `Resolved.thumbnail_url`에만 있다. 주석이 "화면에는 쓰지 않는다(`ResolvedDto`가 옮기지 않는다)"이다(`crates/core/src/model.rs:179-183`) [확인]. `ResolvedDto`에 필드가 없다(`app/src/lib/bindings/ResolvedDto.ts`) [확인]. 쿼리가 서명일 수 있다(`model.rs:174`, `mp4meta.rs:42`) [확인]. 그래서 DTO 계약 "서명 URL은 없다"를 깨지 않고는 주소를 넘길 수 없다. CSP는 `img-src 'self' data:`다(`tauri.conf.json:35`) [확인]. 표지 바이트는 받기 마무리(`download/mod.rs:571-575`)에서만 받는다 [확인]. 클립·생방송은 주소가 없다(`model.rs:180`, mp4-metadata.md §1.2) [확인]. 아이콘 `play`는 이미 있다(`icons.ts:66`) [확인] |
| PS6 | **세션은 [영상 보기]를 눌렀을 때 연다(지연 시작).** 섹션을 펼치는 것만으로는 `watch_open`을 부르지 않는다. 단계는 `closed`·`opening`·`ready`·`failed`에 **`idle`(표지 자리)**을 더한 다섯이다(§5.2). 누르면 `opening` 동안 단추를 `loading`으로 그대로 두어 포커스를 잃지 않는다. `ready`가 되면 `play()`를 한 번 시도하고, **포커스가 아직 [영상 보기] 단추나 `body`에 있을 때만** `<video>`로 옮긴다(그 사이 칸·손잡이로 옮겨 간 사용자를 끌어내지 않는다). 거절되면(자동재생 정책: IPC를 기다리는 사이 사용자 활성화가 끊길 수 있다) 일시정지 상태로 두고 오류로 보지 않는다. 접으면 세션을 닫고 `idle`로 돌아간다. 다시 펴도 자동으로 열지 않는다 | 지금은 펼침 = `openSession`이다(`WatchPanel.svelte:232-242`) [확인]. 단계 넷(`:68`) [확인]. `Button`에 `loading`이 있다(`Button.svelte:13,29,40`) [확인]. 자동재생 거절은 이미 `startPlay`가 받아 낸다(`WatchPanel.svelte` `startPlay`) [확인]. 활성화가 끊기는지는 웹뷰마다 다르다 [실측 필요: M-PVU2-2] |
| PS7 | **섹션은 `Disclosure variant="inline"` 하나다.** 빠른 다시보기 카드의 제목은 "미리보기·구간", 일반 VOD·클립은 지금처럼 "미리보기"다. 빠른 다시보기에서는 섹션 안에 위에서부터 영상 자리 → 편집 영역(막대, 결합되면 조작 줄) → 구간 칸 줄(`RangeField`, 자기 Disclosure 없음)이 놓인다. `RangeField`는 카드가 `WatchPanel`에 넘기는 스니펫 `below`로 그린다. 그래서 칸 상태의 주인은 그대로 카드다(PVU5). "일부만 받기" 줄(`range.toggle`)은 없어진다 | 지금 두 줄이 따로다(`ResolveCard.svelte:383-416`) [확인]. `<details>`는 접혀도 자식을 DOM에 둔다(`Disclosure.svelte:57-69`, `{@render children()}`가 조건 없이 그린다) [확인]. 그래서 접고 펴도 `RangeField`가 다시 마운트되지 않는다(preview-ux PVU3의 성질 유지) |
| PS8 | **섹션은 기본으로 펼친다.** 열림은 **앱 메모리 상태 `ui.previewOpen`(처음 `true`)** 하나이고 Disclosure가 `bind:open`으로 직접 묶는다. 사용자가 접으면 그 자리에서 `false`가 되어 다음 카드도 접힌 채 열린다. 앱을 다시 켜면 펼침으로 돌아간다. 설정 파일(`settings.json`)에 쓰지 않는다 | 완료 그룹 접힘이 같은 방식이다: `jobs.finishedOpen = $state(false)`(`stores/jobs.svelte.ts:75`)를 `Disclosure bind:open`이 묶고 "화면을 오가도 유지한다"(ADR-0018 결정) [확인]. 앱 소스에 `localStorage`는 0건이다(`grep -rn localStorage app/src`) [확인]. 설정 서비스로 기억하면 코어·셸·DTO·bindings·가짜 백엔드·`rust` gate가 따라온다(`settings.rs:91-95`의 `keep_awake` 꼴) [확인]. 사용자 요구는 "다음 카드에도"다. 앱 재시작 뒤까지 원하면 §14 Q2의 다시 볼 조건이다 |
| PS9 | **구간은 "섹션이 펼쳐져 있을 때만" 적용된다.** `rangeInput.open = ui.previewOpen && tone === 'rewind'`이다. 접힌 채 [받기]하면 전체를 받고, 칸 값은 지우지 않는다(다시 펴면 그대로). PVU8의 "보이는 것이 받는 것"을 섹션 단위로 옮긴 것이다. 기억하는 것은 열림 하나뿐이다. 칸 값은 카드마다 새로 시작한다(range.md R62 "다음 영상에서 실수로 구간을 받지 않게"는 그대로 지켜진다) | 지금 구간 적용 조건 `rangeOpen && tone === 'rewind'`(`ResolveCard.svelte:119`) [확인]. 접힘이 칸을 지우지 않는다(`:412-414`는 `rangeErr`만 지운다) [확인]. R62(`range.md:337`) [확인] |
| PS10 | **칸은 빈칸으로 시작하고 빈칸은 "전체"다.** 시작 칸 placeholder는 새 키 `range.fromBegin`("처음부터"), 끝 칸은 기존 `range.toEnd`("끝까지")를 늘 쓴다. **빈 시작 칸은 0초로 읽는다**(지금은 형식 오류). 길이 줄은 받을 구간이 전체이면(`effectiveRange`가 `null`) "전체 길이: {length}"(크기가 있으면 "· {size}")를, 길이를 모르면 "전체 구간"을 보인다. 손잡이를 맨 끝으로 끌어 칸에 시각이 들어가도 전체이면 같은 "전체" 줄이 나온다 | 빈 시작 칸은 지금 `format` 오류다(`receive.ts:153-154`, 시험 `receive.test.ts:357`) [확인]. 빈 끝 칸은 이미 "끝까지"다(`receive.ts:155-157,171`) [확인]. 끝 칸 placeholder는 지금 길이를 모를 때만이다(`RangeField.svelte:138`) [확인]. 초깃값 끝은 지금 meta 길이(`ResolveCard.svelte:81-83`) [확인]. 칸이 늘 보이므로 실수로 지운 시작 칸이 [받기]를 막지 않게 한다 |
| PS11 | **구간 막대는 재생 전에도 그린다.** 조건은 "빠른 다시보기 && `len`(막대 길이)이 있음"이다. `len`은 지금처럼 meta 길이가 먼저이고, 없으면 영상이 알려 준 길이다(PVU7). meta 길이가 없으면 재생 전에는 막대가 없고 칸·길이 줄만 있다. 재생 전 막대의 손잡이는 칸을 고치고, 영상 탐색은 없다(`seek`이 무시한다). 재생 위치 표시는 그리지 않는다(`position = null`). 막대 누름은 아무것도 하지 않는다 | 지금 막대 조건 `editing && metaReady && len && sel`(`WatchPanel.svelte:103,462-463`) [확인]. `seek`은 메타데이터 전이면 모드만 끈다(`:264-273`, app.md 117 (마)⑥) [확인]. `RangeTimeline`의 `position`은 지금 필수 숫자다(`RangeTimeline.svelte:19,114`) [확인] |
| PS12 | **영상과 구간의 "결합"은 `coupled = usingHls && metaReady`일 때만이다.** 찍기·구간 보기·시작부터 보기·구간 반복하기(조작 줄), 재생 위치, 손잡이 commit 탐색, 칸 → 영상 탐색, ↑/↓ 탐색이 모두 이 조건이다. 재생 전과 네이티브 m3u8 대체 경로에서는 막대·칸이 **칸 편집기로만** 동작하고 조작 줄은 그리지 않는다. 미리보기가 실패해도 막대·칸은 남아 구간을 고를 수 있다 | PV17: 네이티브 m3u8 경로는 시간축이 다를 수 있어 찍기를 그리지 않는다(`WatchPanel.svelte:5-7`, preview.md PV17) [확인]. 칸은 영상과 독립인 원천이다(PVU5) [확인: 문서] |
| PS13 | **[받기] 줄은 이미 카드 아래에 고정이다.** `.card-footer { position: sticky; bottom: 0 }`이고 카드가 열린 동안 `.main`의 `scroll-padding-bottom`이 비켜 간다. 이 개편은 그 줄을 바꾸지 않는다. 기본 펼침으로 카드가 길어지므로 갤러리의 "[받기]가 뷰포트 안" 확인을 기본 펼침 장면에도 건다 | `design/ui.css:981-992` [확인]. `App.svelte:197` 주석과 app.md 117 (다) [확인] |
| PS14 | **편집 영역(`data-local-keys`)은 막대가 있을 때부터 붙인다.** 조건이 `markable && usingHls`에서 `markable && (막대가 있음 || coupled)`로 바뀐다. 재생 전 손잡이 위 Esc도 카드를 닫지 않게 하기 위해서다(PVU12). 구간 칸 줄은 계속 편집 영역 **밖**이다. 칸의 Esc는 카드를 닫고(V9), 칸의 ↑/↓는 칸 자신의 `onkeydown`이 받는다 | `editing` 조건과 영역 속성(`WatchPanel.svelte:103,439-443`) [확인]. Esc 예외 `[data-local-keys]`(`GlobalShortcuts.svelte:13-14`) [확인] |
| PS15 | **소유 판정 `notOwn`·`unknown`·생방송에는 섹션이 없다.** 그래서 이 판정의 빠른 다시보기 카드에서 구간 칸 줄도 사라진다(지금은 `tone === 'rewind'`이면 늘 그렸다). 이 카드는 어차피 받을 수 없다(`canDownload`가 소유 판정을 본다) | `watchable`(`ResolveCard.svelte:166-168`), 구간 줄 조건 `tone === 'rewind'`(`:399`) [확인]. `canDownload`의 `ownership` 인자(`:129`) [확인] |
| PS16 | 단추 이름은 **"영상 보기"**다. "재생"은 문구 전체 금지어다. 접근 이름은 `‘{title}’ 영상 보기`이고 보이는 글자를 포함한다(WCAG 2.5.3). "영상 보기"는 patterns §8 표가 이미 "재생" 대신 쓰는 말이다 | `terms.json` 패턴 `"재생"`, glossary "완성 파일 열기" avoid "재생" [확인]. patterns §8 편집 영역 행 "영상 보기 위치"·"영상 보기 ↔ 일시정지"(`patterns.md:455-456`, app.md 118 (다)) [확인]. 같은 값 키 없음(`ko.ts`에 "영상 보기" 0건, DC11) [확인] |
| PS17 | 디자인 시스템: **D66 "미리보기·구간 한 섹션, 기본 펼침, 누를 때 세션"과 ADR-0029**를 새로 쓴다. ADR-0027은 결정 1(기본 접힘, 카드마다 새로 시작, 펼칠 때 `watch_open`)이 뒤집히므로 상태를 `폐기(→ 0029)`로 바꾼다. 본문은 고치지 않는다. 이어지는 결정(자동재생 없음 → "누를 때 한 번 시도"로 좁힘, 네이티브 controls, 실패 한 Notice, 16:9·`--watch-max-h`, 소유 판정·생방송 제외)은 ADR-0029가 다시 적는다. ADR-0028(구간 막대)은 그대로 두고, D65 행 끝에 "재생 전 막대·결합 조건은 D66" 한 문장을 더한다 | ADR 상태 값은 넷뿐이고 "개정"은 없다(`adr.test.mjs:12`) [확인]. 뒤집을 때 옛 파일은 상태 줄만 바꾼다(`governance.md:336`, `README.md:282`) [확인]. ADR-0028 결정에는 배치가 없다(`0028-range-editor.md` "결정") [확인] |

## 1. 목표와 범위

### 1.1 목표
- 카드를 열자마자 미리보기 자리와 (빠른 다시보기면) 받을 구간이 보이고, 손을 대지 않으면 전체를 받는다는 것이 화면에 드러난다.
- 미리보기는 사용자가 [영상 보기]를 누르기 전까지 아무것도 받지 않는다.
- 구간을 1초 단위로 고치는 일은 단추 없이 칸에서 ↑/↓로 한다.
- 기본 흐름(붙여넣기 → [받기])에 단계를 더하지 않는다(range.md §1.1). 기본 펼침은 보이기만 하고 클릭을 요구하지 않는다.

### 1.2 하지 않는 것
- 실제 표지 이미지(PS5, §12 후속).
- 열림 상태를 앱 재시작 뒤까지 기억하기(PS8, §14 Q2).
- 칸 옆 ↑/↓ 힌트 글자·`Kbd`(PS4, §14 Q9).
- 썸네일 줄, 자체 재생 막대, 막대 확대(preview-ux §12 그대로).
- 일반 VOD·클립의 구간(R3), 네이티브 m3u8 경로의 찍기(PV17).
- Rust·command·DTO 변경. 이 개편은 앱 프런트와 문서만 바꾼다(§3).

### 1.3 사용자 흐름
1. 빠른 다시보기 주소를 불러오면 카드가 열린다. 메타 줄 아래 "미리보기·구간" 섹션이 펼쳐져 있다.
2. 섹션 맨 위는 16:9 표지 자리이고 가운데에 [영상 보기]가 있다. 이때까지 미리보기 요청은 없다.
3. 그 아래 구간 막대가 영상 길이(메타)로 그려져 있다. 손잡이는 양 끝이다. 그 아래에 구간 줄이 있다: 시작 칸(빈칸, "처음부터") ~ 끝 칸(빈칸, "끝까지"). 길이 줄은 "전체 길이: 1:30:00 · 약 2.1 GB"(가짜 값)이다.
4. 손잡이를 끌거나 칸에 적으면 길이 줄이 "구간 길이: …"로 바뀐다. 칸에서 ↑/↓를 누르면 1초씩 바뀐다.
5. [영상 보기]를 누르면 단추가 잠깐 "불러오는 중" 모양이 되고, 영상이 붙으면 같은 자리에 재생기가 나타나 시작된다. 포커스는 재생기로 간다. 조작 줄([시작 찍기]·[끝 찍기]·[구간 보기]·[시작부터 보기]·구간 반복하기)이 막대 아래에 나타난다.
6. 이제 손잡이·찍기·칸 ↑/↓·칸 blur가 영상을 그 시각으로 보낸다(preview-ux와 같다).
7. 섹션 머리 "미리보기·구간"을 누르면 영상·막대·칸이 한꺼번에 접힌다. 재생 중이었다면 세션이 닫힌다. 접힌 동안 [받기]는 전체를 받는다. 다음에 여는 카드도 접힌 채 열린다.
8. 일반 VOD·클립은 섹션 이름이 "미리보기"이고 안에는 표지 자리와 [영상 보기]만 있다.
9. [받기] 줄은 어디로 스크롤해도 카드 아래에 붙어 있다.

## 2. 기존 결정과의 관계

| 기존 | 이 개편에서 | 근거 |
|---|---|---|
| D64·ADR-0027 결정 1: 기본 접힘, 카드마다 새로 시작, 펼칠 때 `watch_open` | **뒤집힘**: 기본 펼침(PS8), 열림 기억(앱 메모리), 누를 때 `watch_open`(PS6). D66·ADR-0029, ADR-0027은 `폐기(→ 0029)` | PS17 |
| ADR-0027 결정 2: 자동재생 없음, `preload="metadata"` | 펼쳐도 아무것도 받지 않는다. [영상 보기]를 누른 뒤에만 `play()`를 한 번 시도한다(사용자가 고른 동작이라 자동재생이 아니다) | PS6 |
| ADR-0027 결정 3~5(줄의 대상, 실패 한 Notice, 16:9·`--watch-max-h`) | 그대로. ADR-0029가 다시 적는다 | PS17 |
| preview.md PV14: 펼칠 때 `watch_open`, 접거나 카드가 사라지면 `watch_close` | "펼칠 때"만 "[영상 보기]를 누를 때"로 바뀐다. 닫는 규칙은 그대로 | PS6 |
| preview.md PV17: 찍기는 hls.js 경로에서만 | 그대로(PS12의 `coupled`) | PS12 |
| preview-ux PVU3·D65: 구간 줄을 미리보기 줄 바로 아래 따로 둔 Disclosure | 따로 둔 줄이 없어지고 섹션 안으로 들어간다. 막대 자체(D65·ADR-0028)는 그대로 | PS7 |
| preview-ux PVU7: 막대 길이 meta → video | 그대로. 재생 전에도 meta로 그린다 | PS11 |
| preview-ux PVU8: 접힌 구간 줄은 적용되지 않는다, 처음 고칠 때 되돌림 | 접힘이 섹션 단위가 된다(PS9). 섹션이 접히면 막대·칸이 보이지 않아 "접힌 채 고치기"가 없다. `rangeEdit.begin`의 되돌림은 손대지 않는다(닿지 않는 안전 경로) | PS9 |
| preview-ux PVU13·PVU14: ±1초 단추, 용어 "당기기·미루기" | **뒤집힘**: 단추·키 여섯·용어집 행이 없어진다(PS1·§8) | PS1 |
| range.md §5(R62): 펼침은 카드마다 새로 시작, 기억 안 함 | 열림은 기억하되 칸 값은 카드마다 빈칸으로 시작한다. 그래서 "다음 영상에서 실수로 구간을 받는 일"은 생기지 않는다 | PS9·PS10 |
| range.md: 빈 시작 칸은 형식 오류 | 빈 시작 칸 = 0초(PS10). Rust·DTO는 그대로다(구간은 프런트가 `TimeRangeDto`로 만든다) | PS10 |
| patterns §8 규칙 1(모든 동작에 버튼) | 깨지 않는다(PS4) | PS4 |

## 3. 코어·셸 변경

없다. command·DTO·bindings·가짜 백엔드 command는 바뀌지 않는다. `watch_open`·`watch_close`의 계약도 같다(부르는 시점만 바뀐다). 그래서 `rust`·`tauri` gate는 이 개편과 무관하다.

## 4. 앱 변경

### 4.1 P1: 칸 ↑/↓(단추 제거)

- `RangeField.svelte`: `nudges` 스니펫·`NUDGE_SECS`·`NUDGE_NAME`·props `onnudge`·`canNudge`를 지운다. 두 `TextField`에 `onkeydown={(e) => onfieldkey?.(field, e)}`와 `aria-keyshortcuts="ArrowUp ArrowDown"`을 단다. `.group`·`.tail` 묶음은 칸 하나와 `~`만 남으므로 단순해진다(`~`는 시작 칸 묶음 끝).
- `ResolveCard.svelte`: `nudgeRange`를 `fieldKey(field, e)`로 바꾼다.
  1. `isImeKey(e)`면 끝.
  2. `e.key`가 `ArrowUp`·`ArrowDown`이 아니거나 Shift·Alt·Ctrl·Meta가 있으면 끝.
  3. `preventDefault`(늘, PS2).
  4. `next = nudge(fields, field, ±1, barLen, initialEnd)`가 `null`이면 끝(값 그대로).
  5. `handleFields(next)`(구간 오류 지움) → `focusText = next[field]`(PS3).
  6. `!e.repeat`이면 탐색(지금 `nudgeRange`의 탐색 식 그대로: 빈 끝 칸이면 `floor(len)`). `e.repeat`이면 "남은 탐색" 표시를 세운다.
- 같은 칸의 `onkeyup`, 또는 keyup 없이 온 blur에서 "남은 탐색" 표시가 있으면 마지막 값으로 한 번 탐색하고 표시를 지운다(PS2). 탐색은 `watchPanel.seek`이 `coupled`가 아니면 무시한다.
- `canNudge`는 지운다. 칸을 못 읽을 때의 처리는 3단계가 맡는다.
- 지우는 키: `range.nudge.earlier.label`·`range.nudge.later.label`·`range.nudge.{start,end}{Earlier,Later}.label`(`ko.ts:79-84`). `content.md` §4의 "당기기·미루기" 용어집 행, §15의 두 행(`content.md:476-477`), `terms.json` glossary 행과 그 쓰지 않는 말 패턴 `"증가·감소"`·`"플러스·마이너스"`도 지운다. DC10은 용어집 두 곳의 짝을 본다 [가정: 패턴만 남겨도 gate가 통과하는지는 P1에서 `design-copy`로 확인하고, 통과하면 패턴은 남긴다(금지어가 남는 쪽이 안전하다)].
- `patterns.md` §8 표에 행을 더한다: "구간 칸: ↑ / ↓ | 그 칸 시각을 1초 미루기 / 당기기. 미리보기가 붙어 있으면 영상도 그 시각으로 | 수식 키·IME 조합 중에는 처리하지 않는다. 칸을 못 읽으면 값만 그대로". 문서 표 안의 "미루기·당기기"는 DC1 범위(`patterns.md`) 안이지만 쓰지 않는 말이 아니다.

### 4.2 P2: 표지 자리와 지연 세션

- `WatchPanel.svelte`
  - 단계에 `idle`을 더한다. 펼치면(`onchange(true)`) `phase = 'idle'`만 한다. 접으면 지금처럼 `attempt += 1; closeSession()` 뒤 `phase = 'idle'`이다(`closed`는 처음 마운트 전 값으로만 남는다).
  - `idle`과 `opening`은 같은 `.stage` 상자를 그린다. 상자 안 가운데에 `Button icon="play"` [영상 보기](`watch.start.label`, 접근 이름 `watch.start.a11y`)를 둔다. `opening` 동안 단추는 `loading`이다. 지금 `opening`의 `aria-hidden` 빈 상자는 단추가 들어가므로 `aria-hidden`을 뗀다.
  - 단추 클릭 → `openSession()`. `ready`가 되면 `startPlay()`를 부르고, `await tick()` 뒤 **포커스가 [영상 보기] 단추나 `body`에 있을 때만** `videoEl.focus()`(PS6). hls.js 경로는 `attachMedia` 뒤에 부른다.
  - `opening → failed`이면 포커스가 [영상 보기] 단추나 `body`에 있을 때만 섹션 머리(`<summary>`)로 옮긴다(단추가 사라져 포커스가 `body`로 떨어지는 것을 막는다). 알림은 같은 순간 그려지는 Notice의 `role="alert"`가 한 번 알린다(`announcer`를 또 부르면 같은 말이 두 번 들린다). `ready → failed`(재생 중 `<video>` 오류·hls fatal·유휴 10분 세션 만료, PV5)도 같고, 포커스는 **`<video>`에 있을 때만** `<summary>`로 옮긴다(영상이 사라져 `body`로 떨어지는 것을 막는다. 칸 등 다른 곳에 있으면 그대로 둔다). Notice의 [다시 시도]는 지금처럼 `openSession()`이다.
  - 표지 자리 상자는 `role`이 없는 장식이다. 이미지가 없으므로 `alt` 규칙은 후속(§12)에서 적용한다.
- 이 PR에서는 아직 섹션이 기본 접힘이고(D64 값 그대로) "미리보기"·"일부만 받기" 두 줄이다. 그래서 master 어느 시점에서도 "카드를 열면 세션이 열린다"는 상태가 없다(PR 순서의 이유, §11.1).

### 4.3 P3: 한 섹션, 기본 펼침, 기억, 재생 전 막대

- `stores/ui.svelte.ts`: `previewOpen = $state(true)`. 주석에 ADR-0018 선례와 "앱 재시작 때 펼침으로"를 적는다.
- `WatchPanel.svelte`
  - `Disclosure`의 `title`은 `markable ? t('watch.toggle.range') : t('watch.toggle')`, `bind:open={ui.previewOpen}`. 지금의 지역 `open` 상태는 없어진다.
  - 마운트 때 이미 펼쳐져 있으면 `idle`로 시작한다(`onchange`는 사용자가 바꿀 때만 불린다, `Disclosure.svelte:30-36`).
  - props에 `below?: Snippet`을 더한다. 섹션 패널 맨 아래에 그린다.
  - `coupled = usingHls && metaReady`. `barShown = markable && !!len && !!sel`. 편집 영역 속성(`role="group"`, 이름, `tabindex=-1`, `data-local-keys`, `onkeydown`)은 `markable && (barShown || coupled)`일 때 붙인다(PS14). 영상 요소를 감싸는 `.editor`는 지금처럼 늘 둔다(app.md 117 (마)④). 막대는 영상 자리(표지 자리·재생기·실패 Notice) **아래**에 둔다. 실패해도 막대는 남는다(PS12).
  - 조작 줄은 `markable && coupled`일 때만 그린다(재생 전·네이티브 경로·실패에는 없다).
  - `RangeTimeline`에 `position={coupled ? position : null}`을 넘긴다. `seek()`·`moveTo`의 탐색·`onEditorKey`의 I/O·Space·←/→는 `coupled`가 아니면 하지 않는다(손잡이 키는 `RangeTimeline`이 처리하고 `moveTo`가 칸만 바꾼다).
- `RangeTimeline.svelte`: `position: number | null`. `null`이면 재생 위치 선을 그리지 않는다. 막대 누름(`onseek`)은 부모가 무시한다.
- `RangeField.svelte`: `Disclosure`를 떼고 `FieldRow` + 길이 줄 + 오류만 남긴다. props `open`(오류 포커스 조건)은 섹션 열림을 받는다. 시작 칸 `placeholder={t('range.fromBegin')}`, 끝 칸 `placeholder={t('range.toEnd')}`(늘). `lengthUnknown` prop은 없어진다.
- `ResolveCard.svelte`
  - `rangeOpen` 상태를 없애고 `rangeInput.open = ui.previewOpen && tone === 'rewind' && watchable`이다(PS9·PS15). `rangeEdit` 함수에 넘기는 `Fields.open`도 같은 값이다.
  - `rangeStart`·`rangeEnd`는 `''`로 시작한다. `initialEnd`는 `''`이다(PS10).
  - `{#if tone === 'rewind'}<RangeField …/>{/if}` 블록을 지우고 `WatchPanel`의 `below` 스니펫으로 옮긴다.
  - `lengthText`: `range`가 `null`이면(전체) `range.wholeLength*` 또는 길이를 모르면 `range.whole.label`, 아니면 지금 `range.length*`.
  - 섹션을 접으면 앞 [받기]의 `rangeErr`를 지운다(지금 `RangeField` `ontoggle`이 하던 일, `:412-414`). `$effect`로 `ui.previewOpen`이 `false`가 될 때 지운다.
- `receive.ts`: `rangeError`·`effectiveRange`에서 빈 시작 칸(`trim() === ''`)을 0으로 읽는다(PS10).
- `rangeEdit.ts`: `nudge`가 빈 시작 칸을 0으로 읽는다(지금 `readSecs('')`가 `null`이라 ↑/↓가 아무것도 하지 않는다, `rangeEdit.ts:158-163`). `selection`은 이미 0으로 본다(`:52`). `seekTargetOf`는 시작 칸에 쓸 때 빈칸 → 0을 돌려준다(끝 칸 빈칸은 지금처럼 `null`, 탐색 없음). 표 테스트로 고정한다.
- `content.md`·`terms.json`·`ko.ts`: `range.toggle` 키를 지운다(§8). `patterns.md` §6.5 카드 행(`patterns.md:403`)과 목업(`:721`)을 고친다.

## 5. 상태 모델

### 5.1 섹션 열림과 기억

| 사건 | `ui.previewOpen` | 세션 | 구간 적용 | 칸 값 |
|---|---|---|---|---|
| 앱 시작 | `true` | — | — | — |
| 카드 마운트 | 그대로 읽음 | 없음(`idle` 또는 접힘) | `open && rewind && watchable` | `''`·`''` |
| 사용자가 접음 | `false`(곧바로, 쓰기 경합 없음) | 열려 있으면 `watch_close`, `idle`로 | 꺼짐(전체 받기) | 유지 |
| 사용자가 폄 | `true` | 열지 않음(`idle`) | 켜짐 | 유지(그대로 다시 적용) |
| 카드 닫기·다음 카드 | 그대로 | `onDestroy`가 닫음 | 새 카드 기준 | 새 카드는 `''`·`''` |
| `notOwn`·`unknown`·생방송 카드 | 읽지도 쓰지도 않음 | 없음 | 꺼짐 | 줄 없음 |

- 쓰기는 사용자가 섹션 머리를 누를 때뿐이다. 마운트 때 `<details open>`이 쏘는 `toggle` 사건은 값이 같아 쓰지 않는다(`Disclosure.handleToggle`의 `next === open` 거름, `Disclosure.svelte:30-36`). 시험으로 고정한다(P3 시험 5).
- 저장소가 메모리라 카드를 바꾸는 사이의 비동기 쓰기 경합이 없다(설정 서비스였다면 `patch` 응답 전 다음 카드가 옛 값을 읽을 수 있었다, PS8).
- **깃발은 카드 종류와 무관하게 하나다.** 클립 카드에서 "미리보기"를 접으면 다음 빠른 다시보기 카드의 "미리보기·구간"도 접힌 채 열린다. 같은 자리의 같은 섹션이라 하나로 둔다(종류별 깃발은 상태가 늘고 "접었는데 다시 열렸다"가 생긴다). M-PVU2-6에서 혼동이 보이면 Q2와 함께 다시 본다.

### 5.2 미리보기 단계(`WatchPanel` `phase`)

| 지금 | 사건 | 다음 | 부수 효과 |
|---|---|---|---|
| (마운트, 펼침) | — | `idle` | 없음(요청 0) |
| (마운트, 접힘) | — | `closed` | 없음 |
| `closed` | 폄 | `idle` | 없음 |
| `idle` | [영상 보기] | `opening` | `watch_open` 1회, 단추 `loading` |
| `opening` | 성공(mp4) | `ready` | `src`, `play()` 시도, 포커스 `<video>`(단추·`body`에 있을 때만) |
| `opening` | 성공(hls, hls.js 지원) | `ready` | `attachMedia`, `usingHls`, `play()` 시도, 포커스(같은 조건) |
| `opening` | 성공(hls, 네이티브 m3u8) | `ready` | `src`, `usingHls = false`(결합 없음), `play()` 시도, 포커스(같은 조건) |
| `opening` | 실패·게이트 거부 | `failed` | Notice의 alert가 알림, 포커스 `<summary>`(단추·`body`에 있을 때만) |
| `opening` | 접음 | `idle` | `attempt += 1`, 늦게 온 세션은 바로 `watch_close` |
| `ready` | 접음 | `idle` | `hls.destroy` → `watch_close` 1회, `videoSecs = null`, 구간 보기 끔 |
| `ready` | `<video>` 오류·hls fatal·세션 만료 | `failed` | 세션 닫음(지금과 같다), Notice의 alert가 알림, 포커스는 `<video>`에 있었을 때만 `<summary>` |
| `failed` | [다시 시도] | `opening` | `watch_open` 1회 |
| `failed` | 접음 | `idle` | 오류 지움 |
| `idle`·`failed` | 폄(다시) | `idle` | 없음(자동으로 열지 않는다) |
| 어디서든 | 카드 사라짐 | — | `onDestroy`가 닫는다 |

`play()` 거절은 단계를 바꾸지 않는다(`ready`, 일시정지, 네이티브 controls로 다시 누를 수 있다).

### 5.3 칸 → 받을 구간(PS9·PS10)

| 섹션 | 시작 칸 | 끝 칸 | meta 길이 | `rangeError` | `effectiveRange` | 길이 줄 |
|---|---|---|---|---|---|---|
| 접힘 | 무엇이든 | 무엇이든 | 무엇이든 | `null` | `null`(전체) | (보이지 않음) |
| 펼침 | `''` | `''` | 5400 | `null` | `null` | 전체 길이: 1:30:00 · 약 … |
| 펼침 | `''` | `''` | 없음 | `null` | `null` | 전체 구간 |
| 펼침 | `''` | `0:10:00` | 5400 | `null` | `{0, 600000}` | 구간 길이: 0:10:00 · 약 … |
| 펼침 | `0:00:00` | `1:30:00` | 5400 | `null` | `null` | 전체 길이: 1:30:00 · 약 … |
| 펼침 | `0:10:00` | `''` | 없음 | `null` | `{600000, null}` | (끝을 몰라 줄 없음, 지금과 같다) |
| 펼침 | `abc` | `''` | 5400 | `format`(시작) | `null` | 전체 길이(Q5 선례: 칸이 틀리면 영상 길이) |
| 펼침 | `''` | `0:00:00` | 5400 | `order`(끝) | `null` | 전체 길이 |

마지막 행: 빈 시작 = 0이라 끝 `0:00:00`은 `e <= s`로 순서 오류다(지금 규칙 그대로, `receive.ts:160`).

### 5.4 막대와 결합(PS11·PS12)

| 경우 | 막대 | 손잡이 → 칸 | 손잡이 commit → 영상 | 막대 누름 | 재생 위치 | 조작 줄 | 칸 blur·↑/↓ → 영상 |
|---|---|---|---|---|---|---|---|
| 재생 전, meta 길이 있음 | 있음(meta) | 예 | 아니오 | 없음 | 없음 | 없음 | 아니오 |
| 재생 전, meta 길이 없음 | 없음 | — | — | — | — | 없음 | 아니오 |
| `opening` | 재생 전과 같다 | 예 | 아니오 | 없음 | 없음 | 없음 | 아니오 |
| hls.js, 메타데이터 전 | meta가 있으면 있음 | 예 | 아니오 | 없음 | 없음 | 없음(지금은 찍기가 비활성으로 보인다 → 그리지 않음으로 바뀐다) | 아니오 |
| hls.js, 메타데이터 뒤(`coupled`) | 있음(meta, 없으면 video) | 예 | 예(놓을 때) | 탐색 | 있음 | 있음 | 예 |
| 네이티브 m3u8 | meta가 있으면 있음 | 예 | 아니오 | 없음 | 없음 | 없음 | 아니오 |
| `failed` | meta가 있으면 있음 | 예 | 아니오 | 없음 | 없음 | 없음 | 아니오 |
| 섹션 접힘 | 보이지 않음 | — | — | — | — | — | — |

"메타데이터 전 찍기 비활성"이 "그리지 않음"으로 바뀌는 것은 PS12의 단순화다. 기존 시험 `editor appears only on hls path after metadata`(preview-ux PVU-3 시험 1)의 "찍기는 비활성으로 있음" 부분을 고친다.

## 6. 키보드

| 대상 | 키 | 동작 | 충돌 검토 |
|---|---|---|---|
| 구간 칸(시작·끝) | ↑ / ↓ | 그 칸 +1초 / −1초(`nudge`). `coupled`면 영상도 그 시각으로(누름 한 번·누르고 있으면 뗄 때 또는 포커스가 떠날 때 한 번). 늘 `preventDefault` | 칸은 편집 영역 밖이다(PS14). 창 처리기는 Esc·Mod+L·Mod+,·Mod+Enter뿐이다(`GlobalShortcuts.svelte`, `ResolveCard.svelte:352-359`) [확인]. 목록 ↑↓는 목록 안 roving이다(patterns §8 K16) [확인]. 손잡이 ↑/↓(`handleKey`)는 손잡이가 대상일 때만이다 |
| 구간 칸 | Shift·Alt·Ctrl·Meta + ↑/↓ | 처리하지 않음(기본 편집: 선택 넓히기, 줄 처음·끝) | — |
| 구간 칸 | IME 조합 중 ↑/↓ | 처리하지 않음(`isImeKey`, 후보 이동) | DX6 |
| 구간 칸 | 못 읽는 값에서 ↑/↓ | 기본 동작만 막고 값은 그대로(PS2) | — |
| 구간 칸 | Esc | 카드를 닫는다(지금과 같다, V9) | — |
| 구간 칸 | Enter | 아무것도 하지 않는다(DX6 Enter 분기 금지) | — |
| 편집 영역(손잡이·컨테이너·찍기 단추·영상) | I / O | `coupled`일 때만 찍기(지금과 같다) | 섹션이 접히면 영역이 보이지 않아 포커스가 닿지 않는다. 카드의 다른 곳에서는 I/O를 듣지 않는다 |
| 편집 영역 | Space, ←/→ | `coupled`일 때만(지금과 같다) | 재생 전 손잡이 위 ←/→는 손잡이 이동이다(`RangeTimeline`이 먼저 처리) |
| 편집 영역 | Esc | 카드를 닫지 않는다. 재생 전에도 막대가 있으면 영역이 있으므로 같다(PS14) | `GlobalShortcuts.svelte:14` |
| [영상 보기] | Space·Enter | 단추 기본 동작(세션 열기) | 편집 영역 안이어도 단추 위 Space는 단추 몫이다(지금 규칙 `command` 거름) |
| 섹션 머리(`<summary>`) | Space·Enter | 펴기·접기(브라우저 기본) | — |

## 7. 접근성

- **섹션 머리**: 네이티브 `<summary>`라 펼침 상태(expanded)를 브라우저가 알린다. `aria-expanded`를 손으로 달지 않는다(`Disclosure.svelte:57-65`). 이름은 "미리보기·구간" 또는 "미리보기"다.
- **[영상 보기]**: 보이는 글자 "영상 보기" + 아이콘(장식). 접근 이름 `‘{title}’ 영상 보기`는 보이는 글자를 품는다(2.5.3). `opening` 동안 `loading`(`aria-disabled`, 포커스 유지). 대상 크기는 `Button` md(28/40)다.
- **포커스 이동**: `opening → ready`는 `<video>`로, `opening → failed`는 `<summary>`로 옮긴다. 둘 다 포커스가 아직 [영상 보기] 단추나 `body`에 있을 때만이다(2.4.3: 사용자가 옮겨 간 포커스를 빼앗지 않는다). 오류 문구는 Notice의 alert가 알린다(`announcer`를 따로 부르지 않는다). `ready → failed`는 포커스가 `<video>`에 있을 때만 `<summary>`로 옮긴다. 접으면 포커스는 누른 `<summary>`에 있다.
- **표지 자리**: 이미지가 없는 장식 상자다. 이름·역할을 주지 않는다. 후속에서 이미지를 넣으면 `alt=""`(장식, 영상 제목은 카드 h3가 이미 말한다)과 `draggable="false"`(DX3)다.
- **구간 칸 ↑/↓**: `aria-keyshortcuts="ArrowUp ArrowDown"`. 값 변화는 따로 알리지 않는다(칸 값이 그 자리에 있다). 화면 낭독기가 스크립트로 바뀐 칸 값을 읽는지는 M-PVU2-4다.
- **빈칸 = 전체**: placeholder는 접근 이름이 아니다. 이름은 그대로 "시작 시각"·"끝 시각"(`range.start`·`range.end`)이다. "전체"는 길이 줄 글자로도 보인다(placeholder만으로 뜻을 전하지 않는다).
- **가림**: 기본 펼침으로 카드가 길어져도 `.main`의 `scroll-padding-bottom`이 sticky 바닥 줄을 비켜 간다(PS13, WCAG 2.4.11).
- forced-colors: 표지 자리 상자는 `.stage`와 같은 `1px solid CanvasText` 테두리를 받는다(`WatchPanel.svelte` 끝 `@media (forced-colors: active)`) [확인].

## 8. 문구(copy deck `ko.ts`, `content.md` §15 표에 같은 행)

| 키 | 문구 | PR | 쓰는 곳·규칙 |
|---|---|---|---|
| `range.nudge.earlier.label` 외 다섯 | (지움) | P1 | PS1. content §4 용어집 "당기기·미루기" 행, §15 두 행, `terms.json` glossary 행도 지운다 |
| `watch.start.label` | 영상 보기 | P2 | [영상 보기] 보이는 글자. 버튼 "동사 어간 + 기"(content §5.1). "재생" 금지(PS16) |
| `watch.start.a11y` | ‘{title}’ 영상 보기 | P2 | 접근 이름. DC12(‘{…}’로 시작), `watch.player.a11y`와 같은 꼴 |
| `watch.toggle.range` | 미리보기·구간 | P3 | 빠른 다시보기 섹션 머리. 열거 `·`(붙임, content §6.5) |
| `range.fromBegin` | 처음부터 | P3 | 시작 칸 placeholder. 쓰지 않는 말 "처음부터 받기"와 다르다(패턴은 그 말 전체다) [가정: DC1 부분 일치 여부는 P3 `design-copy`로 확인. 걸리면 "맨 처음"] |
| `range.wholeLength.label` | 전체 길이: {length} | P3 | 전체를 받을 때 길이 줄. "라벨: 값" 꼴 |
| `range.wholeLengthSize.label` | 전체 길이: {length} · {size} | P3 | 같다 + 예상 크기(`{size}`가 "약"을 품는다). 조각 결합은 deck 문자열 하나로(DS6) |
| `range.whole.label` | 전체 구간 | P3 | 전체를 받는데 길이를 모를 때 |
| `range.toggle` | (지움) | P3 | "일부만 받기" 줄이 없어진다. content §15 행(`content.md:479`)도 지운다 |

- 그대로 쓰는 키: `watch.toggle`("미리보기", 일반 VOD·클립 섹션 머리), `range.toEnd`("끝까지", 이제 늘 끝 칸 placeholder), `range.length.label`·`range.lengthSize.label`, `range.help`.
- 용어집: 새 행은 없다. "미리보기"(쓰지 않는 말 "프리뷰")가 그대로이고, "영상 보기"는 patterns §8 표가 이미 쓰는 말이다. 단추 이름이 용어집 개념(새 동작)인지 애매하면 P2에서 "받기 전에 영상을 미리 보는 일" 행의 쓰는 말에 "영상 보기"를 더한다(DC10 짝은 두 곳 함께).
- 확인할 것(gate): DC11(같은 값 키 금지): 위 값은 서로 다르고 기존 값과도 다르다 [확인: `ko.ts` grep "영상 보기"·"처음부터"(문장 안에만 있음, `ko.ts:113-114,197`)·"전체 길이"·"전체 구간" 단독 값 0건].

## 9. 디자인 시스템 변경

- **D66 미리보기·구간 섹션**(README §5 결정 표, P2에서 쓴다): 카드 안 `Disclosure variant="inline"` 한 섹션. 빠른 다시보기는 "미리보기·구간"(영상 자리 → 구간 막대 → 조작 줄(결합 때) → 구간 칸 줄), 일반 VOD·클립은 "미리보기"(영상 자리). 기본 펼침이고 열림은 앱 메모리에 기억(앱 재시작 때 펼침). 영상 자리는 처음에 표지 자리(16:9 `--surface-2` 상자 + [영상 보기])이고 누를 때 `watch_open`, 누르기 전 요청 0. 섹션이 접히면 구간은 적용되지 않는다. 칸 빈칸 = 전체. `notOwn`·`unknown`·생방송에는 섹션이 없다. 근거 등급 E0(사용자 결정)·E1이라 `채택(잠정)`. 행과 ADR-0029에 **적용 단계를 밝힌다**: "PS-2: 표지 자리·누를 때 세션 / PS-3: 한 섹션·기본 펼침·기억·빈칸 = 전체"(PS-2와 PS-3 사이 master는 아직 기본 접힘이다. PVU-2가 D65를 마운트 전에 쓴 선례). D64 행 끝에 "→ D66으로 바뀜(2026-10-21)"을 적는다(D64 본문은 기록으로 둔다).
- **ADR-0029 `adr/0029-preview-section.md`**(P2): 맥락(사용자 사용 뒤 두 줄이 숨어 있어 못 찾음, ±1초 단추가 칸 줄을 두 줄로 만듦), 결정(PS5~PS12·PS15, ADR-0027에서 이어지는 결정 다시 적기), 근거 표, 결과(카드 높이 증가 §9.1, 갤러리 기준선 다수 갱신), 대안과 버린 이유(표: 실제 표지 이미지(새 command, 누르기 전 요청) / 펼침과 동시에 세션 / 설정 파일 기억 / `localStorage` / 두 줄 유지 + 기본 펼침 / 섹션 둘). ADR-0027 머리 상태 줄만 `폐기(→ 0029)`.
- **D65 행**(P3): 끝에 "재생 전 막대(meta 길이)와 결합 조건은 D66" 한 문장. ADR-0028은 그대로.
- `spec-check.mjs`의 D 번호 상한 65 → 66(`spec-check.mjs:95`) [확인](P2).
- `components.md`: §2.29 WatchPanel 상태 표에 `idle`, 해부에 표지 자리·[영상 보기]·`below`(P2·P3). §2.30 RangeTimeline `position: number | null`(P3). RangeField 행(있으면)의 ±1초 단추 제거(P1).
- `patterns.md`: §6.5 카드 행·목업(P3, `:403`·`:721`), §8 표 "구간 칸: ↑/↓" 행(P1), §15 높이 행(P3, 아래).
- `foundations.md`: 새 토큰 없음. 표지 자리는 `.stage`의 기존 값(`--surface-2`, `--radius-control`, `--watch-max-h`)을 쓴다.
- 아이콘: 새 아이콘 없음(`play` 재사용).

### 9.1 높이 예산(patterns §15 "높이 520" 행 고침, P3)

열 안쪽 680, 카드 안쪽 648이면 16:9 높이는 364.5라 `--watch-max-h` 360으로 잘린다 [잠정: 지금 상수].

| 카드 | 지금(접힘) | 기본 펼침(재생 전) | 더하는 것 |
|---|---|---|---|
| 일반 VOD·클립 | 542 | **약 910** | 표지 자리 360 + 패널 간격 8 |
| 빠른 다시보기 | 578 | **약 1000** | 표지 자리 360 + 8 + 막대 32 + 구간 칸 줄(28 + 위 12) + 도움말 줄·길이 줄 약 44 − 없어진 "일부만 받기" 줄 36 |
| 빠른 다시보기, 재생 뒤 | — | 약 1030 | 조작 줄 32 |

[잠정: 계산값, 갤러리 측정으로 조인다.] 결과는 두 가지다.
- 960×700에서 카드 위쪽(툴바·입력줄·카드 머리·메타)이 약 290이라 첫 화면에는 표지 자리와 막대 윗부분까지 든다. 화질·폴더·이름은 스크롤해야 보인다. [받기]는 sticky라 늘 보인다(PS13).
- 720×520에서는 표지 자리의 일부만 첫 화면에 든다.

화질을 못 보고 받는 일이 생기는지는 M-PVU2-3·M-PVU2-6으로 본다. 문제가 되면 §14 Q10의 다시 볼 조건(재생 전 상자를 낮추기)이다.

## 10. 테스트 원칙

- 규칙은 순수 함수 표 테스트로 고정한다: `receive.test.ts`(빈 시작 칸), `rangeEdit.test.ts`(빈 시작 칸 `nudge`·`seekTargetOf`).
- 컴포넌트 시험은 "규칙 함수를 불렀고 결과를 썼다", "세션 command를 몇 번 불렀다"를 본다. 가짜 IPC(`mockIPC`)의 호출 기록으로 `watch_open` 0회를 확인한다(요청 0의 프런트 쪽 증거).
- 키: `fireEvent.keyDown(input, { key: 'ArrowUp' })`의 `defaultPrevented`·칸 값·`currentTime` 쓰기 횟수. IME는 `isComposing: true`와 `keyCode: 229` 둘 다. 반복은 `repeat: true`.
- jsdom `<details>`: `toggle` 사건을 직접 쏜다(마운트 때 사건 흉내 포함).
- 열림 기억은 `ui` 저장소를 시험 사이에 `true`로 되돌린다(`beforeEach`). 안 그러면 시험 순서에 따라 결과가 바뀐다.
- Playwright: 기본 펼침이라 기존 `getByText(t('watch.toggle')).click()`은 섹션을 **접는다**. 모든 장면·spec에서 그 줄을 [영상 보기] 클릭으로 바꾸고, `range.toggle` 클릭(`screens-data.ts:317,332,355`, `range.spec.ts:8`, `watch.spec.ts:233,300`)을 지운다. 가짜 백엔드 호출 기록으로 [영상 보기] 전 `watch_open` 0회를 본다. 매 단계 axe.
- 보강 테스트는 구현을 일부러 깨서 잡히는지 본다(메모리 규칙 TDD). PR 본문에 "깨 본 변이" 목록을 적는다.
- **테스트 수 ratchet**: P1은 단추 시험(`receive.test.ts` PVU-5 단추 묶음, `nudgeBtn` 도우미 `:1661-1662` 이하)을 지우므로, 같은 수 이상의 ↑/↓ 시험을 더해 `tests.vitest`가 줄지 않게 한다. `tests.playwright`는 spec 수가 같아야 한다(고쳐 쓰기만). 기준은 base의 `ci/ratchet.json`이다.

## 11. 구현 단계

### 11.1 PR 표(stacked, 직렬)

| id | slug(브랜치) | 내용 | type | gates |
|---|---|---|---|---|
| PS-1 | `feat/preview-ux2-arrow-keys` | ±1초 단추·키 여섯·용어집 행 제거, 칸 ↑/↓(PS1~PS4), patterns §8 행. **이 명세 커밋을 첫 커밋으로 품는다** | `feat` | `frontend`, `e2e-web`, `design-copy`, `design-lint`, `scripts-test`, `design-shots`(관찰), `scan` |
| PS-2 | `feat/preview-ux2-lazy-session` | 표지 자리 + [영상 보기], 단계 `idle`, 누를 때 `watch_open`, 포커스·`play()` 시도(PS5·PS6·PS16). D66·ADR-0029·ADR-0027 `폐기(→ 0029)`·`spec-check` 66·components §2.29. 섹션은 아직 기본 접힘·두 줄 | `feat` | `frontend`, `e2e-web`, `design-copy`, `design-lint`, `scripts-test`(`spec-check.test.mjs`·`adr.test.mjs`), `design-shots`(관찰), `scan` |
| PS-3 | `feat/preview-ux2-section` | 한 섹션·기본 펼침·`ui.previewOpen` 기억, 구간 칸 줄을 섹션 안으로, 빈칸 = 전체(`receive.ts`·`rangeEdit.ts`), 재생 전 막대·`coupled`(PS7~PS15), copy·용어·patterns §6.5·§15·components §2.30·D65 한 문장 | `feat` | `frontend`, `e2e-web`, `design-copy`, `design-lint`, `scripts-test`, `design-shots`(관찰), `coverage`, `scan` |
| PS-4 | `chore/preview-ux2-docs` | 이 문서 §16 구현 결과, D66·ADR-0029 상태, README 열린 항목(M-PVU2), `features/README.md`·`plan.md`·ROADMAP, ratchet(사람) | `chore` | `scan`, `scripts-test`(spec-check·ADR), `design-copy` |

순서의 이유:
- **PS-2(지연 세션)는 PS-3(기본 펼침)보다 먼저다.** 거꾸로면 master에 "카드를 열면 곧바로 세션이 열린다"(요청·소유 게이트 호출)는 상태가 생겨 사용자 결정 "누르기 전 요청 없음"을 어긴다.
- PS-1은 독립이다. PS-3의 `rangeEdit.nudge` 변경(빈 시작 칸)과 같은 파일을 건드리므로 직렬로 둔다.
- 모두 직렬이다: PS-1 → PS-2 → PS-3 → PS-4.
- 각 PR은 앞 PR이 master에 머지된 뒤 master에서 시작한다. 그래야 ratchet·갤러리 기준선이 앞 PR을 품는다(preview-ux V19 선례).
- 갤러리 기준선은 Linux CI artifact로 받는다(`shots.mjs --accept`). 로컬 `--update-snapshots`는 거부된다.
- 가짜 백엔드 command는 어느 PR에서도 바뀌지 않는다. 화면이 바뀌는 PR(PS-1·2·3)이 갤러리·spec을 함께 고친다(CLAUDE.md).

### 11.2 PR별 TDD 순서(먼저 쓸 실패 테스트)

#### PS-1 칸 ↑/↓ (`receive.test.ts`, `watch.spec.ts`)
1. `no nudge buttons`: 빠른 다시보기 카드에 이름이 "당기기"·"미루기"를 품은 단추가 0개다.
2. `ArrowUp on start field adds one second`: `0:01:00` → `0:01:01`, ArrowDown → `0:00:59`. `defaultPrevented` 참.
3. `ArrowUp/Down on end field clamps`: 끝 = `floor(len)`에서 ↑ → 그대로(meta 경로는 시각 그대로), 끝 = 시작+1에서 ↓ → 그대로. 뒤집힌 순서에서는 그 칸만 `[0, floor(len)]`(`nudge` 표의 행과 같다).
4. `unreadable field: arrow blocked, value unchanged`: `abc`에서 ↑ → 값 그대로, `defaultPrevented` 참(PS2).
5. `modifier arrows not handled`: Shift·Alt·Ctrl·Meta + ↑ 각각 → 값 그대로, `defaultPrevented` 거짓.
6. `IME composing arrow ignored`: `isComposing: true`, `keyCode: 229` 각각.
7. `arrow seeks video when coupled`(미리보기 펼침·hls·메타데이터 뒤): `currentTime` = 새 칸 초. 끝 칸이 빈칸이 되면 `floor(len)`. `no seek when preview closed`.
8. `held key changes field each repeat but seeks once on keyup`: keydown ×1 + keydown(repeat) ×4 + keyup → 칸 +5초, `currentTime` 쓰기 2회(첫 누름·뗌).
8a. `held key then blur without keyup flushes final seek`: keydown + repeat ×3 → blur(다른 단추) → `currentTime` = 마지막 값, 쓰기 2회.
9. `blur after arrow does not seek again`: ↑ 뒤 다른 단추로 blur → 추가 `currentTime` 쓰기 0회(PS3).
10. `arrow clears previous range error, typing does not`.
11. `busy: field disabled, arrow does nothing`.
12. `aria-keyshortcuts on both fields` = `ArrowUp ArrowDown`.
13. `Esc in field still closes card`(V9 회귀 막기, 기존 5c 유지).
14. 기존 PVU-5 blur 6개·길이 4개는 그대로 통과한다.
15. E2E `watch.spec.ts`: 단추 클릭 두 줄(`:311`, `:314`)을 칸 포커스 + `press('ArrowUp')`·`press('ArrowDown')`로 바꾸고 칸 값 → `enqueue` range를 본다.

엣지: 길이 1·2초 영상(`nudge`가 `null` → 처리 안 함), meta 길이 없음 + 빈 끝 칸에서 ↑(끝은 값을 몰라 처리 안 함, 시작 ↑는 상한 없음).

변이 확인: `isImeKey` 거름 제거, 수식 키 거름 제거, `focusText` 갱신 제거, `repeat` 탐색 거름 제거, `null`일 때 `preventDefault` 빼기, blur 남은 탐색 제거 — 각각 시험 6·5·9·8·4·8a가 잡는다.

바뀌는 파일: `RangeField.svelte`, `ResolveCard.svelte`, `ko.ts`, `design/copy/terms.json`, `content.md` §4·§15, `patterns.md` §8, `receive.test.ts`, `app/e2e/watch.spec.ts`, 갤러리 기준선(`card-range`·`card-range-unknown`·`card-watch-hls-marked`·`card-watch-hls-edit`의 단추가 없어진다). 문서: app.md **120**.

#### PS-2 표지 자리·지연 세션 (`WatchPanel.test.ts`, `receive.test.ts`, `watch.spec.ts`, `screens-data.ts`)
1. `expand shows stage with 영상 보기 and makes no watch_open`: 펼침 → 단추 이름 `‘{title}’ 영상 보기`, `watch_open` 호출 0회.
2. `clicking 영상 보기 opens session once and shows loading`: 호출 1회, `opening` 동안 단추 `aria-disabled`·포커스 유지.
3. `ready moves focus to video and tries play`: `document.activeElement === video`, `play` 스텁 1회. `play rejection keeps ready without notice`.
3a. `focus moved away during opening stays put on ready`: `opening` 동안 구간 칸에 포커스 → `ready` 뒤에도 칸에 그대로. 같은 조건으로 `failed`도 포커스를 옮기지 않는다.
4. `collapse while opening closes late session`: 접음 → 늦게 온 dto에 `watch_close` 1회, 단계 `idle`.
5. `collapse while ready closes session once and returns to idle`, `re-expand shows idle and makes no watch_open`.
6. `failure moves focus to summary and leaves the announcing to the alert`: `announcer.say` 호출 없음, `role=alert` 존재, [다시 시도] → `watch_open` 1회 더.
6a. `mid-play error leaves focus elsewhere alone`: `ready`에서 칸에 포커스 → `<video>` `error` → `failed`, 포커스는 칸 그대로, `announcer.say` 없음. 6b. 포커스가 `<video>`에 있으면 `<summary>`로 옮긴다(`<video>` 오류·hls fatal 둘).
7. `gate denial keeps same copy without buttons`(기존 유지) + 포커스 `<summary>`.
8. `vod and rewind both start idle`, `notOwn/unknown/live: no watch row`(기존 유지).
9. `editor area appears only after play on hls`(PS-2 시점에는 지금 조건 그대로).
10. 기존 `WatchPanel.test.ts`·`receive.test.ts`의 "펼치면 `watch_open`" 시험은 "펼침 → [영상 보기]"로 고친다(검사 내용은 같다).
11. E2E `watch.spec.ts`: 펼침 → 가짜 백엔드 기록 `watch_open` 0 → [영상 보기] → 1. 기존 흐름에 [영상 보기] 한 걸음을 넣는다. axe.
12. 갤러리: 새 장면 `card-watch-idle`(일반 VOD, 펼침 + 표지 자리). 기존 `card-watch`·`card-watch-hls`·`card-watch-hls-marked`·`card-watch-hls-edit`·`card-watch-failed`는 [영상 보기] 클릭을 더한다.

엣지: [영상 보기] 연타(두 번째 클릭은 `loading`이라 무시), 열기 도중 카드 닫기(`onDestroy`), 네이티브 m3u8 대체 경로에서도 포커스·`play()` 시도.

변이 확인: 펼침에서 `openSession` 호출 남기기(시험 1), 포커스 이동 제거(3), 포커스 조건 제거(3a·6a), `attempt` 올림 제거(4). ("접을 때 `idle` 대신 `closed`"는 화면에서 관찰할 수 없어 뺐다.)

바뀌는 파일: `WatchPanel.svelte`, 테스트, `ko.ts`(`watch.start.*`), `content.md` §15, `docs/design/system/{README.md,components.md}`, `adr/0029-preview-section.md`(새), `adr/0027-watch-preview.md`(상태 줄만), `scripts/design/spec-check.mjs`·테스트, `app/e2e/{watch.spec.ts,screens-data.ts}`. 문서: app.md **121**.

#### PS-3 한 섹션·기본 펼침·기억·빈칸 = 전체 (`receive.test.ts`(카드·순수), `rangeEdit.test.ts`, `WatchPanel.test.ts`, `RangeTimeline.test.ts`, `ui` 저장소 시험, `range.spec.ts`, `watch.spec.ts`, `screens-data.ts`)
1. 순수 `receive.ts`: `rangeError(open('', ''))` → `null`(지금 `receive.test.ts:357`의 기대를 뒤집는다), `effectiveRange(open('', '0:10:00'), 5400)` → `{0, 600000}`, `effectiveRange(open('', ''), 5400)` → `null`, `rangeError(open('  ', '0:00:00'))` → `order`.
2. 순수 `rangeEdit.ts`: `nudge` 빈 시작 ↑ → `0:00:01`, ↓ → `0:00:00`. 빈 끝 ↓(meta 5400) → `1:29:59`. `seekTargetOf('', len, 'start')` → 0, 끝 빈칸 → `null`.
3. `section open by default`: 첫 카드에 `<details open>`, 제목 "미리보기·구간"(빠른 다시보기)·"미리보기"(일반 VOD·클립), "일부만 받기" 없음.
4. `rewind section holds stage, bar, fields in order`(DOM 순서: 표지 자리 → 막대 → 시작 칸), `vod/clip section has no bar or fields`.
5. `collapse is remembered for next card`: 접음 → `ui.previewOpen === false` → 다음 카드가 접힌 채. `mount with open details does not write`(마운트 `toggle` 사건 뒤에도 쓰기 없음). 펴면 `true`.
6. `fields start blank, enqueue has no range`; `length line says 전체 길이 with size`; `no duration → 전체 구간`; `range set → 구간 길이`; `handle back to end → 전체 길이 again`.
7. `collapsed section: enqueue full, values kept on expand`(PS9), `collapse clears previous range error`.
8. `bar before play from meta`: 재생 전 막대 있음, 손잡이 끌기 → 칸 바뀜, `currentTime` 쓰기 0회, 재생 위치 선 없음, 조작 줄 없음. `no meta → no bar before play, bar after hls duration`.
9. `native m3u8 fallback: bar stays, no controls row, handle commit does not seek`.
10. `collapse while playing`: `watch_close` 1회, `videoSecs = null` → 막대는 meta로 남고(펴면 보임) meta가 없으면 사라진다.
11. `I/O while collapsed does nothing`: 카드 안 다른 곳에 `KeyI` → 칸 그대로(편집 영역에 포커스가 닿지 않는다).
12. `failed preview keeps bar and fields usable`: 실패 Notice 아래 막대·칸, 칸 입력 → `enqueue` range.
13. `range field not remounted across collapse/expand`(같은 노드, 기존 PVU-3 시험 4를 섹션 기준으로).
14. `Esc on handle before play does not close card`, `Esc on field closes card`.
15. `notOwn/unknown rewind: no section and no range fields`(PS15, 동작 변경).
16. `RangeTimeline position null draws no marker`(`RangeTimeline.test.ts`).
17. `ui.previewOpen resets to true per test`(도우미, 시험 순서 독립).
18. E2E: `range.spec.ts`를 토글 없이 다시 쓴다(칸 입력 → `enqueue` range, 접힘 → range 없음). `watch.spec.ts`: 기본 펼침 → `watch_open` 0 → [영상 보기] → 손잡이·I/O·↑/↓ → `enqueue` range. 720×520 기본 펼침에서 [받기]가 뷰포트 안. 매 단계 axe.
19. 갤러리: 기본 펼침으로 카드 장면 대부분의 기준선이 바뀐다. 새 장면 `card-rewind-default`(빠른 다시보기, 재생 전, 빈칸·전체 길이 줄)와 `card-section-collapsed`(접힘 기억)를 더한다. 기존 `card-range*` 장면은 토글 클릭을 지운다.

엣지: meta 길이 0·음수(막대 없음), 길이 1·2초 영상(손잡이 고칠 수 없음), 시작 칸에 공백만, 끝 칸만 시각(시작 빈칸), 재생 중 접고 곧바로 펴기(`idle`, 요청 0), 열림 기억과 `{#key}`로 카드가 새로 만들어질 때(저장소 값만 읽음).

변이 확인: 빈 시작 0 읽기 제거(1·6), `rangeInput.open`에서 섹션 조건 제거(7), 마운트 쓰기 거름 제거(5), `coupled` 대신 `metaReady`만(9), 막대 조건을 `coupled`로 되돌림(8), 접을 때 `rangeErr` 지움 제거(7).

바뀌는 파일: `stores/ui.svelte.ts`, `WatchPanel.svelte`, `RangeField.svelte`, `RangeTimeline.svelte`, `ResolveCard.svelte`, `receive.ts`, `rangeEdit.ts`, 테스트, `ko.ts`, `terms.json`, `docs/design/system/{content.md,patterns.md,components.md,README.md}`, `app/e2e/{range.spec.ts,watch.spec.ts,screens-data.ts}`. PR 본문에 로컬 `dist` gzip 증가량. 문서: app.md **122**.

#### PS-4 문서 마감
1. D66·ADR-0029: `채택(잠정)` 유지(E0~E1) 또는 실측 결과로 바꾼다. README 열린 항목에 M-PVU2 남은 것.
2. 이 문서 §16 구현 결과, `features/README.md` 행("미리보기 구간 편집 UX" 행 옆에 2단계), `plan.md` 트랙, ROADMAP "현재 위치"·체크리스트.
3. `tests.vitest`·`tests.playwright`·`size.dist_gz`는 CI 녹색 실행 뒤 사람이 올린다(`ratchet.mjs write --from-run`, 성공한 실행만).

완료 조건: `scan`, `scripts-test`, `design-copy` 녹색.

### 11.3 gate
`frontend`, `design-tokens`·`design-lint`·`design-copy`·`design-icons`, `scripts-test`(시스템 문서·`spec-check`·ADR 형식은 `scripts/design/*.test.mjs`가 읽는다, `gates.mjs:604-605`), `e2e-web`, `design-shots`(관찰), `scan`, `coverage`. 토큰을 바꾸지 않으므로 `design-tokens`는 영향 밖이지만 CI가 늘 돈다. 크기는 CI `bundle (linux)`의 `size`가 본다(새 의존성 없음). Rust·`.github/`·`worker/`·`help/`는 바꾸지 않는다(`rust`·`tauri`·`worker` gate는 변경 영역 밖).

### 11.4 번호 예약
- app.md 구현 중 변경 **120**(PS-1)·**121**(PS-2)·**122**(PS-3) [확인: 마지막 119, `app.md:1526`]. PS-4는 번호 없음(PVU-6 선례).
- 디자인 결정 **D66** [확인: 마지막 D65, `README.md:214`], **ADR-0029** [확인: 마지막 `0028-range-editor.md`]. ADR-0027 상태 → `폐기(→ 0029)`.
- core.md: 없음(Rust 변경 없음).
- 미머지 PR과 겹치면 나중에 머지되는 쪽이 번호를 옮긴다(preview.md 선례).

## 12. 후속(범위 밖)
- **실제 표지 이미지**: 새 command `watch_cover(url, content)`를 둔다. 소유 게이트는 `watch_open`과 같다. 셸이 `Resolved.thumbnail_url`을 기존 `fetch_cover`(2 MiB 상한, JPEG·PNG만, 재시도 없음, `client.rs:294-335`)로 받아 `data:` 주소로 돌려준다. 그러면 CSP `img-src 'self' data:`를 넓히지 않고, 서명 주소도 프런트에 가지 않는다. 대신 **누르기 전 요청이 하나 생긴다**(이미지 CDN). 그래서 사용자 확인이 필요하다. 클립·생방송은 주소가 없어 표지 자리 그대로다. `<img alt="" draggable="false">`.
- 열림을 `settings.json`에 기억(앱 재시작 뒤까지): `UserSettings.preview_open`(없는 키 = 켬, `keep_awake` 규칙) + DTO·patch·bindings·가짜 백엔드.
- 칸 옆 ↑/↓ 힌트(Q9), 재생 전 상자 높이 줄이기(Q10).
- preview-ux §12의 나머지(썸네일 줄, 자체 재생 막대, 막대 확대, 스크러빙).

## 13. 실측 필요(사용자 손, 출력은 판정만)

| ID | 무엇 | 누가 | 통과 기준 |
|---|---|---|---|
| M-PVU2-1 | 3 OS 웹뷰에서 구간 칸 ↑/↓: 캐럿이 튀지 않는다, 한글 조합 중 ↑/↓는 IME 몫이다, 길게 누르면 칸은 계속 바뀌고 영상은 뗄 때 한 번 간다 | 사용자, 본인 빠른 다시보기 | 셋 다 된다 |
| M-PVU2-2 | [영상 보기]를 누른 뒤 영상이 시작되는가(IPC를 기다리는 사이 자동재생 정책), 3 OS | 사용자 | 시작되거나, 일시정지로 멈춰 있고 controls로 시작할 수 있다. 오류 Notice는 없다 |
| M-PVU2-3 | 960×700·720×520 기본 펼침 첫 화면: 무엇이 보이는가, [받기]가 보이는가, Tab으로 화질까지 갈 때 가림이 없는가 | 사용자 또는 갤러리 | [받기]가 늘 보이고 가림이 없다. 화질이 첫 화면 밖인 것은 기록만 한다 |
| M-PVU2-4 | 화면 낭독기로 섹션 머리 펼침 상태, [영상 보기] 이름, ↑/↓ 뒤 칸 값 | 사용자 | "미리보기·구간, 펼쳐짐", "‘…’ 영상 보기, 단추"로 읽히고, ↑/↓ 뒤 값이 읽히거나 칸에 머물러 다시 읽을 수 있다 |
| M-PVU2-5 | 누르기 전 요청 0: 카드를 열고 [영상 보기]를 누르기 전까지 앱 로그에 미리보기 세션·중계 줄이 없다 | 사용자(로그 확인) | 0줄 |
| M-PVU2-6 | 사용자 시험(D62 UT): 기본 펼침에서 화질을 놓치는가, 빈칸을 "전체"로 읽는가, ±1초 단추가 없어서 막히는가 | 사용자 시험 | "N명 중 M명"으로 기록. Q2·Q9·Q10의 다시 볼 조건 |

## 14. 결정된 질문(2026-10-21, 사용자 위임으로 추천안 확정)

| # | 질문 | 확정 | 이유·다시 볼 조건 |
|---|---|---|---|
| Q1 | 표지 원천 | **(a) 표지 자리(이미지 없음)** | (b) DTO에 주소: 서명 주소 계약·CSP를 깬다. (c) 새 command: 누르기 전 요청이 생기고 Rust·게이트·가짜 백엔드가 따른다(§12). 사용자가 "누르기 전 요청 1개"를 받아들이면 (c) |
| Q2 | 열림 기억 저장소 | **(a) 앱 메모리 `ui.previewOpen`**(ADR-0018 선례) | (b) `settings.json`: Rust 4층 변경. (c) `localStorage`: 앱 선례 0건, 웹뷰 저장소 위치가 OS마다 다르다 [가정]. M-PVU2-6에서 "켤 때마다 다시 접는다"는 말이 나오면 (b). 종류마다 따로 기억하는 안은 "클립에서 접었더니 구간이 숨었다"는 혼동이 보이면 |
| Q3 | 접힌 섹션의 구간 | **적용 안 함, 값 유지**(PS9) | "보이는 것이 받는 것"(PVU8). 접힌 머리에 구간 요약을 보이는 안은 문구·상태가 늘어 후속 |
| Q4 | 칸 초깃값 | **빈칸 + placeholder, 빈 시작 = 0**(PS10) | 사용자 문장 "칸이 비면 전체". 시각으로 채운 초깃값은 "전체"가 글자로 드러나지 않는다 |
| Q5 | ↑/↓ 걸음 | **1초, 수식 키 없음**(PS1) | 사용자 요구. Shift ×10은 칸 기본 편집(선택)과 부딪힌다. 큰 걸음은 손잡이 키(Shift ×10·PageUp/Down)가 맡는다 |
| Q6 | 재생 전 조작 줄 | **그리지 않음**(PS12) | 찍기·구간 보기는 영상이 있어야 뜻이 있다. 비활성 단추 다섯은 소음이다. [구간 보기]로 세션을 여는 안은 후속 |
| Q7 | [영상 보기] 뒤 재생 | **`play()` 한 번 시도, 거절은 조용히** | 사용자가 누른 것은 "보기"다. 거절되면 controls가 남는다(M-PVU2-2) |
| Q8 | 네이티브 m3u8 경로의 막대 | **남김(칸 편집기), 결합 없음** | 칸은 영상과 독립이다. 막대가 사라지면 같은 카드에서 UI가 바뀐다 |
| Q9 | ↑/↓ 보이는 힌트 | **없음**(`aria-keyshortcuts` + patterns §8) | PVU13·Q4 선례. M-PVU2-6에서 못 찾으면 `range.help`에 한 문장 |
| Q10 | 재생 전 상자 높이 | **재생기와 같은 16:9·360** | 눌러도 배치가 밀리지 않는다. M-PVU2-3·6에서 화질을 놓치면 재생 전 상자를 낮추는 안을 ADR로 |

## 15. 적대적 재검토 반영(작성자 자기 검토, 2026-10-21)

초안을 "이대로 구현하면 어디서 틀리나"로 다시 읽고 빠진 엣지를 본문에 넣었다.

| # | 빠졌던 것 | 판정 | 반영 |
|---|---|---|---|
| A1 | 섹션 기억과 카드 전환: 설정 서비스였다면 `patch` 응답 전에 다음 카드가 옛 값을 읽는다. 마운트 때 `<details open>`의 `toggle` 사건이 쓰기를 일으킬 수 있다 | 수용 | PS8을 메모리 저장소로(경합 없음), §5.1 쓰기 규칙, PS-3 시험 5·17(시험 사이 초기화) |
| A2 | 접힌 채 I/O 키: 편집 영역이 숨어 포커스가 닿지 않는가, 카드의 다른 곳이 I/O를 듣는가 | 수용 | §6 표 I/O 행, PS-3 시험 11 |
| A3 | 재생 전 구간 막대 길이: meta가 있으면 그리고, 없으면 칸만. `opening` 동안·메타데이터 전 hls에서 무엇을 그리나 | 수용 | PS11, §5.4 표 전체, PS-3 시험 8 |
| A4 | 표지 없는 영상: 이 명세에서는 모든 카드가 표지 자리다. 후속에서도 클립·생방송·실패한 표지는 같은 자리 | 수용 | PS5, §7 표지 자리, §12 |
| A5 | 재생 중 접기 → 세션 닫기: `watch_close` 1회, `videoSecs` 비움, 막대 길이 되돌림, 다시 펴도 자동으로 열지 않음 | 수용 | §5.2 표, PS-2 시험 5, PS-3 시험 10 |
| A6 | PR 순서: 기본 펼침이 지연 세션보다 먼저 머지되면 master에서 카드마다 세션이 열린다 | 수용 | §11.1 순서와 이유 |
| A7 | ±1초 단추 제거가 patterns §8 규칙 1과 부딪힌다 | 수용 | PS4 |
| A8 | 단추가 사라질 때 포커스 유실([영상 보기] → `opening`·`failed`) | 수용 | PS6(`loading`으로 유지), §4.2 실패 포커스, PS-2 시험 2·6 |
| A9 | 빈 시작 칸이 지금 형식 오류라 "칸이 비면 전체"가 [받기]를 막는다. `nudge`도 빈 시작에서 멈춘다 | 수용 | PS10, §4.3 `receive.ts`·`rangeEdit.ts`, PS-3 시험 1·2 |
| A10 | ↑/↓ 뒤 blur가 다시 탐색해 구간 보기를 끈다, 길게 누르면 탐색이 몰린다 | 수용 | PS2·PS3, PS-1 시험 8·9 |
| A11 | 소유 판정 카드에서 구간 줄이 사라지는 동작 변경 | 수용(기록) | PS15, PS-3 시험 15 |
| A12 | 재생 전 손잡이 위 Esc가 카드를 닫는다(영역 속성이 `usingHls` 조건이라) | 수용 | PS14, PS-3 시험 14 |
| A13 | 단추 시험 삭제로 `tests.vitest` ratchet이 줄 수 있다 | 수용 | §10 마지막 항목 |
| A14 | 기본 펼침이라 기존 Playwright·갤러리의 "미리보기 줄 클릭"이 오히려 접는다 | 수용 | §10 Playwright 항목, PS-2·PS-3 시험 목록 |
| A15 | 실패한 미리보기에서 구간을 못 고르게 되는가 | 수용 | PS12, PS-3 시험 12 |
| A16 | 기본 펼침으로 카드가 1000 근처가 되어 화질이 첫 화면 밖으로 밀린다 | 수용(기록) | §9.1, M-PVU2-3·6, Q10 |
| A17 | 포커스 이동이 무조건이라 `opening` 사이 칸으로 옮겨 간 사용자나 재생 중 오류에서 포커스를 빼앗는다 | 수용 | PS6, §4.2, §5.2, §7, PS-2 시험 3a·6a |
| A18 | 못 읽는 값에서 ↑/↓를 막지 않으면 사용자 요구("기본 동작 막기")를 좁힌다 | 수용 | PS2, §4.1, §6, PS-1 시험 4 |
| A19 | 길게 누른 뒤 keyup 없이 포커스가 떠나면 마지막 탐색을 잃는다 | 수용 | PS2, §4.1, PS-1 시험 8a |
| A20 | 열림 깃발이 종류 사이에 공유된다는 것을 적지 않았다 | 수용 | §5.1, Q2 |
| A21 | ADR·`spec-check` 변경은 `scripts-test` gate가 본다(PR 표에 없었다) | 수용 | §11.1 표, §11.3 |

## 16. 구현 결과(PS-4, 2026-10-21)

PS-1~PS-3이 `feat/preview-ux2-arrow-keys`·`-lazy-session`·`-section` 브랜치(stacked)로 구현됐다. 아래는 명세와 달라진 점의 요약이고, 원문은 app.md 구현 중 변경 120~122다. 번호 예약(§11.4)은 어긋나지 않았다(120~122, D66·ADR-0029 그대로, core.md 변경 없음).

### 16.1 PR과 번호

| PR | 브랜치 | 구현 중 변경 | 비고 |
|---|---|---|---|
| PS-1 구간 칸 ↑/↓ | `feat/preview-ux2-arrow-keys` | app.md 120 | ±1초 단추·문구 여섯 키 삭제, `RangeField` `onfieldkey` |
| PS-2 표지 자리·지연 세션 | `feat/preview-ux2-lazy-session` | app.md 121, D66·ADR-0029 | 단계 `idle`, [영상 보기], ADR-0027 `폐기(→ 0029)` |
| PS-3 한 섹션·기본 펼침·빈칸 = 전체 | `feat/preview-ux2-section` | app.md 122 | `ui.previewOpen`, `coupled`·`barShown`·`region`, 길이 줄 "전체 길이" |
| PS-4 문서 마감 | `chore/preview-ux2-docs` | (번호 없음) | 이 절, 기능 안내·계획·ROADMAP |

PR 번호는 머지 때 ROADMAP에 채운다.

### 16.2 명세와 달라진 점

- **IME 거름 위치(PS-1)**: 조합 중 키 거름(`isImeKey`)은 카드가 아니라 `RangeField` 안에 둔다. DX6이 keydown 리스너가 있는 파일에 `isImeKey`를 요구해서다(app.md 120).
- **`<video>`의 `tabindex="0"`(PS-2)**: 이미 탭 순서에 있는 요소의 명시다. jsdom·일부 웹뷰에서 `focus()`가 먹게 한다(app.md 121).
- **announcer 대신 Notice alert(PS-2)**: 열기 실패 알림은 같은 순간 그려지는 Notice(`role=alert`)가 맡고 `announcer`는 부르지 않는다. 두 번 들리지 않게 한 선택이다. 포커스 이동은 포커스가 [영상 보기]·`body`(또는 재생 중 오류는 `<video>`)에 있을 때만 한다(app.md 121).
- **표지 자리 위치(PS-3)**: 표지 자리와 실패 Notice는 `.editor` 감싸개 밖(위)에 둔다. 그래서 [영상 보기] 위의 Esc는 카드를 닫는다(app.md 122).
- **비활성 찍기 단추는 그리지 않음(PS-3)**: 메타데이터 전에는 조작 줄 자체를 그리지 않는다(명세 Q6의 "비활성 단추 소음" 판단을 결합 전 전체로 넓힘, app.md 122).
- **`notOwn`·`unknown` 빠른 다시보기 카드는 칸 줄도 사라짐(PS15)**: 동작 변경이다(app.md 122).
- **PS-3 리뷰 반영**: 칸이 틀리면(틀린 글자·시작 ≥ 끝) 길이 줄을 숨긴다(content.md 정의에 맞춤). 갤러리 `settleFields`는 작은 창에서 섹션 머리를 입력줄 바로 아래에 두고 잰다. `WatchPanel` 시험은 실제 앱 경로(`{ open: true, start: '', end: '' }`, `initialEnd ''`)와 mp4·네이티브 m3u8 경로를 따로 탄다.
- **붙은 손잡이 `target-size`**: 기본 펼침으로 구간 막대가 첫 화면에 늘 노출돼 preview-ux.md:636의 한계도 노출이 늘었다. 알려진 한계로 두고 갤러리는 손잡이를 띄워 잰다(ADR-0029, app.md 122).

### 16.3 남은 것

- **사용자 실측 M-PVU2-1~6**(§13). 특히 M-PVU2-2(자동재생 정책)·M-PVU2-3(720×520 첫 화면에서 [받기]·화질)·M-PVU2-6(사용자 시험)이 D66·ADR-0029를 `확정`으로 바꿀 조건이다.
- **갤러리 기준선**: `card-range`·`card-range-error`·`card-watch-idle`·`card-rewind-default`·`card-section-collapsed` 등은 Linux CI에서만 만든다(`node scripts/design/shots.mjs --accept <run id>`).
- **후속(§12)**: 실제 표지 이미지(새 command `watch_cover`, 누르기 전 이미지 CDN 요청 1개라 사용자 확인 필요), 열림을 `settings.json`에 기억해 재시작 뒤까지 잇기, 칸 옆 ↑/↓ 힌트(Q9), 재생 전 상자 높이(Q10).

### 16.4 ratchet(사람)

CI 녹색 실행이 생기기 전이라 `ci/ratchet.json`은 건드리지 않았다. 이 트리의 로컬 측정은 Playwright 508개(`chromium`+`gallery`)이고 기준 `tests.playwright` 63은 옛 값이라 `ratchet.mjs write --from-run <run id>`가 CI 측정값으로 올린다(`tests.vitest`·`size.dist_gz`도 같다).
