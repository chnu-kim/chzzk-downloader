# 창 전체 구간 편집 화면(구간 편집 UX 3단계): 명세

**상태·확정 결정(2026-10-22)**: **명세 확정, 구현 전. 열린 질문 없음(§18, 사용자 위임으로 추천안 확정). 적대적 재검토 반영(§19). 외부 검토 두 건(UX·접근성, 계획 정합) 반영(§20).**

사용자는 카드 안 "미리보기·구간" 섹션(`preview-ux2.md`, D66)을 써 본 뒤 UI가 별로라고 했다. 그리고 프리미어 프로 Source Monitor처럼 **창 전체를 쓰는 구간 편집 화면**을 원했다. 시안 여럿을 거쳐 **시안 7**로 확정했다. 시안 파일은 저장소 밖 작업 폴더의 `Editor7.dc.html`(보드 `V7Light`·`V7Zoom`·`V7ZoomDark`·`V7SmallZoom`)이다. 진입점 카드는 `V1Card.dc.html`·`Card.dc.html`을 참고하되 문구는 아래 규칙대로 고친다.

사용자가 확정한 결정은 여섯이다. 이 명세는 이것을 바꾸지 않는다.
1. **배치·머리**: 위는 영상, 아래는 타임라인 패널이다. 머리에는 제목 "구간 편집"과 부제를 둔다. 단추는 [닫기](초안을 버린다)와 [구간 적용하기](검증한 뒤 카드에 확정)이다.
2. **조작 줄**: 영상 폭(최소 380)에 맞춘 3칸이다.
   - 왼쪽은 지금 시각, 오른쪽은 전체 길이다.
   - 가운데는 아이콘 단추 일곱이고 툴팁이 붙는다: [시작 찍기(I)] [구간 처음으로] [5초 뒤로(←)] [일시정지/보기(Space)] [5초 앞으로(→)] [구간 끝으로] [끝 찍기(O)].
   - `role=group`이다.
3. **타임라인 패널**
   - 머리: 제목, 안내("휠로 이동, ⌘+휠로 확대해요…"), 확대했을 때만 [전체 보기], [구간 반복] 토글(`aria-pressed`, 켜지면 중립색 눌림 면).
   - 몸통은 두 칸 격자(이름 칸 64px)이고 위에서부터 다섯 줄이다.
     - (확대했을 때만) 보이는 범위 막대 24px(`scrollbar`)
     - 눈금 24
     - 영상 트랙 48
     - 소리 트랙 32
     - 구간 줄 48: 시작~끝 칸, "구간 길이: … · 약 …GB", [구간 지우기]
   - 트랙은 단색이고 가짜 파형은 없다.
   - 구간 밖은 흐리게 하고, 구간 위아래에 띠를 그린다.
   - 손잡이는 보이는 폭 12px, 누름 폭 24px다. `slider`이고 서로 넘지 못한다(min/max).
   - 지금 위치선은 본문색이다.
4. **휠·확대**
   - 휠·Shift+휠·트랙패드 좌우는 이동이다.
   - ⌘(Win/Linux는 Ctrl)+휠과 핀치는 커서를 중심으로 확대한다. 키 `+`·`-`·`0`도 쓴다.
   - 확대하면 범위 막대와 [전체 보기]가 나온다.
   - 화면 밖 손잡이는 가장자리에 붙는다. 조작할 수 있고, 누르면 그 자리로 보이는 범위가 옮겨 간다.
5. **받기 카드는 짧게**
   - 구간 줄 하나만 둔다: "구간 0:10:00~0:40:00 · 길이 0:30:00 [구간 편집…] [구간 지우기]". 구간이 없으면 "전체" + [구간 편집…]이다.
   - 편집 화면은 빠른 다시보기에서만 연다(hls.js 경로).
   - 일반 VOD·클립의 미리보기 섹션은 남길지 판단해 가장 작은 타당한 선택을 한다(§0 RE14).
6. **디자인 시스템**: 색·크기·문구는 디자인 시스템(`docs/design/system/`)의 토큰과 규칙을 따른다. 예외가 필요하면 D 번호로 적는다.

**결정 6(디자인 시스템 규칙)을 따르느라 시안과 달라진 점**(배치·동작은 그대로다)
- 보이는 이름: [구간 반복] → "구간 반복하기"(기존 키), [구간 처음으로]·[구간 끝으로] → "구간 처음으로 가기"·"구간 끝으로 가기", [5초 뒤로]·[5초 앞으로] → "{n}초 뒤로 가기"·"{n}초 앞으로 가기"(버튼 기본형 "-기", 숫자는 자리표시). 카드 문구는 지시대로 "0:10:00~0:40:00"·[구간 편집…]·[구간 지우기]다.
- "편집"을 굳은 한자어 허용 목록에 더한다([구간 편집…]).
- 좁은 레이아웃(폭 600 미만·`x-large`)에서는 조작 줄 최소 380을 쓰지 않고 줄바꿈한다(320 폭 가로 스크롤 0). 시안의 760px 분기는 쓰지 않는다(DL13).
- 손잡이·구간 띠는 `--accent`가 아니라 `--accent-ink`다(다크 대비).
- 보기/일시정지 단추는 원형 36이 아니라 다른 단추와 같은 IconButton 28이다.
- 구간 띠는 위아래 3px가 아니라 2px다(`prefers-contrast: more`에서 3px, §12.3).
- 툴팁은 키를 고정폭 muted로 붙인 스타일 툴팁이 아니라 IconButton 계약의 네이티브 `title`이다(§18 Q9, 스타일 툴팁은 §16 후속).
- 영상 상자 바탕은 #0E0E0E가 아니라 `--surface-2`이고, 모니터 바탕은 따로 둔 stage 색이 아니라 `--bg`다(토큰 밖 색 금지, §6.1).
- 구간 밖 흐림은 눈금 줄까지 덮지 않고 트랙 줄에만 그린다(눈금 글자 대비, §7.8).
- 범위 막대 엄지 가장자리를 끌어 폭을 바꾸고, 눈금을 두 번 눌러 확대한다(포인터 하나로 하는 확대, WCAG 2.5.1, §7.5·§7.2). 패널 머리 구성은 그대로다.

구현은 TDD다(§13·§14). 실패 테스트를 먼저 쓰고 최소 구현으로 녹색을 만든다. 규칙은 지금처럼 순수 함수(`rangeView.ts`(새)·`rangeEdit.ts`·`receive.ts`)에 둔다. 컴포넌트는 그 함수를 부르기만 한다.

기준 트리는 `feat/range-editor` = origin/master `3297cbe`다. 미리보기 PV-1~8(`preview.md`), 구간 편집 PVU-1~6(`preview-ux.md`), 섹션 개편 PS-1~4(`preview-ux2.md`)가 모두 들어 있다. 형식과 근거 표기는 `preview-ux2.md`를 따른다.
- **[확인]**: 이 트리에서 직접 연 줄이 받친다.
- **[가정]**: 코드로 확인하지 못한 판단이다. 일반 지식이나 설계 선택이다.
- **[실측 필요]**: 3 OS 웹뷰나 보조기술로만 정할 수 있다(§17 M-RE-*).
- **[잠정]**: 숫자 상수다. 근거가 약하고 실측으로 조인다(ADR-0009).

예시 값(시각·길이·크기·제목)은 모두 가짜다. 시안의 제목·길이·날짜는 옮기지 않았다(공개 저장소 규칙).

**이 명세가 해결하는 리뷰 지적**: Codex 시안 리뷰 두 건 중 동작·계약 지적이다. 시안 2 리뷰의 ②③④⑦⑩과 시안 6 리뷰의 ①②③⑤⑥⑦⑪이다. 겉모습 지적(시안 6의 ④⑧⑨⑩⑫⑬, ⑤ 일부)은 시안 7이 반영했고, 이 명세가 토큰과 계약으로 고정한다. 대응은 §19 표에 있다.

---

## 0. 핵심 결정(요약)

| # | 결정 | 근거 |
|---|---|---|
| RE1 | **편집 화면은 `ResolveCard`가 소유하는 창 전체 레이어**(`receive/RangeEditor.svelte`)다. 열 때 레이어를 `body` 직속으로 옮기고, `body`의 다른 자식에 `inert`를 단다. **이 일은 RE-3에서 Dialog와 함께 쓰는 공용 attach `ui/modalLayer.ts`로 뽑는다(필수).** `modalLayer`는 열린 층의 스택을 갖고, 층이 붙거나 떨어질 때마다 "맨 위 층 말고 `body`의 모든 자식은 inert"를 처음부터 다시 계산한다. 앱이 단 inert가 아닌 것(층이 붙기 전부터 있던 inert)은 따로 기억해 되돌린다. 저장값 복원 방식은 쓰지 않는다: 층이 생긴 역순으로 닫히지 않으면(편집 화면 위 UpdateDialog가 뜬 사이 카드가 사라짐) 앱 전체가 inert로 남는다(§20 ux2·H1). 레이어 뿌리는 `tabindex="-1"`이다(포커스할 수 없는 곳을 눌러도 포커스가 `body`로 가지 않게, Dialog 패널과 같다). 탭 순환은 `trapTab`, 접근 역할은 `role="dialog" aria-modal="true" aria-labelledby=<h1>`이다. 닫으면 `inert`를 되돌리고 연 단추([구간 편집…])로 포커스를 돌려준다. **`ui.view`에 새 뷰를 더하지 않는다**: App이 `HomeView`를 언마운트하면 카드의 화질·폴더·이름·검사 상태가 사라진다. 카드가 사라지면(새 주소, `{#key gen}` 다시 그리기, 로그인 잠금) 레이어도 함께 사라지고 `onDestroy`가 세션을 닫는다 | 뷰 분기(`App.svelte:166-172`), Dialog 레이어(`Dialog.svelte:126-153`, 이전 값 복원 `:131-145`), 탭·Esc(`:155-169`), 패널 `tabindex="-1"`(`:180`), 슬롯 대기열은 대화상자끼리만(`:24-40`), `trapTab`(`focus.ts:31-54`) [확인] |
| RE2 | **상태는 셋으로 나눈다**: 카드의 **확정 구간** `applied: TimeRangeDto \| null`, 편집 화면의 **초안** `draft: { start: string; end: string }`, **열림** `editorOpen: boolean`. 카드의 검사 열쇠·`checkOutput`·`enqueue`·화질 크기·저장될 이름은 모두 `applied` 하나만 읽는다. 초안은 [구간 적용하기]를 눌러 검증을 통과할 때만 `applied`가 된다. [닫기]·Esc는 초안만 버리고 `applied`는 그대로 둔다. 열림은 받을 구간과 무관하다(D66 PS9 "섹션이 펼쳐져 있을 때만 적용"을 뒤집는다, §2) | 지금은 섹션 열림이 적용 조건이다(`ResolveCard.svelte:125-128`) [확인]. Codex 시안 2 ②③, 시안 6 ① |
| RE3 | **적용 = `applyDraft(draft, durationSecs)` 순수 함수**(receive.ts). `rangeError({open: true, …draft})`가 먼저 돈다. 빈칸은 전체, 빈 시작 칸은 0초, 형식 오류, 시작 ≥ 끝, 시작 ≥ 길이는 지금 규칙 그대로다. 통과하면 `effectiveRange`가 `applied`를 만든다(전체를 덮으면 `null`). 길이 초과 끝은 오류가 아니고 영상 끝으로 자른다. 길이를 모르면 끝이 빈 구간 `{startMs, endMs: null}`을 그대로 둔다. 실패하면 편집 화면은 열린 채 남는다. 그 칸 아래에 inline danger를 두고, 그 칸에 `aria-invalid`·`aria-describedby`를 달고, 포커스를 옮기고 전체 선택한다(IME 조합 중이 아니면). 초안은 지우지 않는다 | `rangeError`·`effectiveRange`(`receive.ts:156-185`), 빈 시작 = 0(`:151-153`) [확인]. 오류 포커스 선례 `RangeField.svelte:77-84` [확인]. patterns §6.1(검증은 제출 때) |
| RE4 | **초안은 열 때 `draftOf(applied, durationSecs)`로 만든다.** 시작이 0이면 `''`, 아니면 `formatClock`이다. 끝이 없거나 영상 끝(내림 길이 이상)이면 `''`, 아니면 `formatClock`이다. 그래서 확정값이 없으면 두 칸이 비어 "처음부터"·"끝까지"가 보인다. 왕복(`draftOf` → `applyDraft`)은 같은 `applied`를 돌려준다(표 테스트) | PS10 빈칸 = 전체(`preview-ux2.md`) [확인: 문서] |
| RE5 | **카드 구간 줄**(새 `receive/RangeSummary.svelte`): FieldRow(라벨 `range.label` "구간") + 값 글자 + [구간 편집…] + (구간이 있을 때만) [구간 지우기]. 빠른 다시보기이고 `watchable`인 카드에만 그린다. 생방송, `notOwn`·`unknown`에는 그리지 않는다(PS15 그대로). 값은 `rangeSummary(applied, durationSecs)`이고 셋 중 하나다. 확정값이 없으면 "전체"다. 끝을 모르면 `range.chipToEnd`("0:10:00~")이고 길이 조각은 없다. 그 밖에는 `range.summary.label`("0:10:00~0:40:00 · 길이 0:30:00")이다. 카드의 [구간 지우기]는 `applied`를 **곧바로** `null`로 만든다(초안이 아니다). 단추가 사라지므로 포커스를 [구간 편집…]으로 옮긴다(F-4: `body`로 떨어지지 않게). [받기] 요청 중(`busy`)에는 두 단추를 막는다 | `watchable`(`ResolveCard.svelte:121-123`), `range.chip`·`range.chipToEnd`(`ko.ts:77-78`), `rangeChip`(`receive.ts:195-198`) [확인]. 사용자 결정 5 |
| RE6 | **편집 화면 안 [구간 지우기]는 초안만 지운다.** 두 칸을 `''`로 만들고 길이 줄은 "전체 길이: …"가 된다. 앞 적용의 구간 오류도 지운다. 단추는 늘 있고 늘 누를 수 있다(초안이 이미 전체면 아무것도 바뀌지 않는다). 그래서 누른 뒤에도 포커스가 그 자리에 남는다 | 사용자 지시. 단추가 사라지거나 비활성이 되면 포커스가 `body`로 떨어진다(F-4) |
| RE7 | **세션은 편집 화면 안의 [영상 보기]를 눌렀을 때 연다.** 편집 화면을 여는 것만으로는 `watch_open`을 부르지 않는다. 단계는 D66과 같은 `idle`·`opening`·`ready`·`failed`이다. 편집 화면을 닫으면(적용·닫기·Esc) 세션을 닫는다. 다시 열면 `idle`부터다. `ready`가 되면 `play()`를 한 번 시도한다. 포커스는 [영상 보기]나 `body`에 있을 때만 `<video>`로 옮긴다(PS6) | D66 "누르기 전 요청 0"과 ADR-0029 결정을 편집 화면으로 그대로 옮긴다. 칸만 고치는 사용자는 요청과 소유 게이트 호출이 0이다. 지금 단계·포커스 규칙(`WatchPanel.svelte:74,151-179`) [확인] |
| RE8 | **결합 조건은 PS12 그대로 `coupled = usingHls && metaReady`다.** 결합 전(`idle`·`opening`·hls.js 메타데이터 전·네이티브 m3u8·`failed`)에는 타임라인과 칸이 **칸 편집기로만** 동작한다. 막대는 meta 길이로 그리고, 손잡이는 초안만 고치며, 영상 탐색·지금 위치선·찍기는 없다. 조작 줄은 늘 그리되(배치가 흔들리지 않게, §6.2) 일곱 단추가 모두 `disabled`다. 네이티브 m3u8 대체 경로에서는 패널 머리 안내 줄 자리에 `rangeEditor.uncoupled.body`가 나온다. **진입 단추는 hls.js 지원을 미리 묻지 않는다**: hls.js 지원 여부는 동적 import(`openHls`) 뒤에야 알 수 있고, 칸 편집은 영상 없이도 된다. 구간을 자르는 일은 Rust가 한다(`TimeRangeDto`) | `coupled`(`WatchPanel.svelte:112`), hls.js 판정이 import 뒤다(`:239-258`) [확인]. PV17 [확인: 문서]. Codex 시안 2 ④, 시안 6 ③ |
| RE9 | **음량·음소거·전체 화면은 `<video>`의 네이티브 `controls`에 맡긴다**(`controls`를 그대로 둔다). 조작 줄은 구간 동작과 키보드용 보기·탐색만 더한다. 그래서 네이티브 조작부와 자체 조작 줄에 보기·탐색이 겹친다. 하지만 음량·전체 화면·속도를 다시 만들지 않고 D65·ADR-0027 "네이티브 controls"를 지킨다 | Codex 시안 2 ⑦·시안 6 ⑪의 첫 대안. `controls` 속성(`WatchPanel.svelte:530`) [확인] |
| RE10 | **타임라인 좌표는 하나의 순수 변환이다**: `secs = view.start + clamp(x / width, 0, 1) × view.span`(`rangeView.secsAtX`). 그리기는 역함수 `xOfSecs`를 쓰고 자르지 않는다. `view = { start, span }`(초)이고 늘 `0 ≤ start`, `start + span ≤ L`, `min(minSpan, L) ≤ span ≤ L`이다(유한하지 않거나 0 이하인 L은 `{0, 0}`). 확대·이동·화면 밖 판정·눈금·따라가기·범위 막대 값이 모두 이 모듈 안에 있다(§7) | 지금 `secsAt`·`fractionOf`는 `[0, L]` 전체만 안다(`rangeEdit.ts:69-79`) [확인]. Codex 시안 6 ⑦ |
| RE11 | **휠 계약**(§7.3)
- 타임라인 시간 영역(눈금·트랙·범위 막대 줄)에 `addEventListener('wheel', h, { passive: false })`를 직접 단다. Svelte `onwheel` 속성은 쓰지 않는다.
- `deltaMode`를 px로 정규화한다.
- 확대: `ctrlKey`이거나 macOS에서 `metaKey`면 확대다. 커서를 중심으로 하고 상하한이 있다.
- 이동: 그 밖은 이동이다. `|deltaX| ≥ |deltaY|`면 `deltaX`, 아니면 `deltaY` 하나만 쓴다(**합산하지 않는다**).
- `preventDefault`: 처리한 이벤트에만 한다. 확대는 확대할 수 있는 길이일 때 늘 처리한다. 이동은 확대돼 있고 그 방향으로 움직일 수 있을 때만 처리한다. 그래서 전체 보기이거나 끝에 닿으면 바깥 스크롤로 넘어간다 | UI Events `deltaMode`, DOM `passive`(Codex 시안 6 ⑥). WebView2 페이지 확대 단축키는 이미 꺼져 있다(`tauri.conf.json:25` `zoomHotkeysEnabled: false`) [확인]. 핀치 전달 방식은 [실측 필요: M-RE-1] |
| RE12 | **화면 밖 손잡이는 DOM에서 빼지 않는다.** 보이는 범위 밖이면 가장자리에 붙인 꼴(`pinned`)로 그리고, `role="slider"`·값·Tab 순서는 그대로다. 누르면 값은 그대로 두고 보이는 범위만 그 손잡이로 옮긴다(`reveal`). 키로 값을 바꾸면 바뀐 값이 보이게 범위를 옮긴다. 포커스만으로는 옮기지 않는다(Tab으로 지나가며 화면이 튀지 않게). 두 손잡이가 같은 쪽 밖에 있으면 세로로 반씩 나눠 쌓는다(시작이 위) | APG multi-thumb slider(Codex 시안 6 ④) |
| RE13 | **끌기 중에는 보이는 범위를 고정한다.** 휠·`+`·`-`·`0`·범위 막대 조작을 무시한다(휠은 `preventDefault`만 한다). 가장자리 자동 이동은 없다: 손잡이 값은 보이는 범위 `[view.start, view.start + span]`과 상대 손잡이 경계 안에서 자른다. 더 멀리 가려면 놓고 이동·축소하거나 칸·키를 쓴다. 끌기 중 Esc는 끌기를 취소하고 누르기 전 값으로 되돌린다 | 가장 작은 선택. 자동 이동은 후속(§16) |
| RE14 | **일반 VOD·클립은 지금의 "미리보기" 섹션(D66 중 VOD·클립 부분)을 그대로 둔다.** 구간이 없는 카드(R3)라 편집 화면에서 고칠 것이 없다. 섹션을 지우면 받기 전 확인 수단이 사라지고, 편집 화면으로 보내면 쓸모없는 타임라인을 연다. `WatchPanel`은 구간 기능을 떼어 내고 일반 VOD·클립 전용이 된다. `ui.previewOpen`(기본 펼침·앱 메모리 기억)도 이 섹션에만 쓴다. 빠른 다시보기 카드에서는 섹션이 없어지고 구간 줄(RE5)이 그 자리에 들어간다 | `markable={tone === 'rewind'}`(`ResolveCard.svelte:445`), `ui.previewOpen`(`ui.svelte.ts:28-33`) [확인]. 사용자 결정 5 |
| RE15 | **편집 화면이 열린 동안 창 수준 처리기를 거른다.** `ui.rangeEditorOpen`(앱 메모리 깃발) 하나를 두고 아래 다섯 곳이 각각 본다. 카드의 Mod+Enter는 `download()` 대신 편집 화면의 [구간 적용하기]가 받는다. **편집 화면 뿌리는 Mod+Enter를 받으면 적용의 성공·실패와 관계없이 `preventDefault` + `stopPropagation`을 한다.** 적용에 성공하면 Svelte가 microtask로 레이어를 정리하며 깃발을 내리는데, 실제 사용자 이벤트에서는 리스너 하나가 끝날 때마다 microtask가 돌아 window 리스너에 닿을 때 깃발이 이미 `false`다. 그래서 카드 처리기의 주 근거는 `defaultPrevented`이고 깃발은 둘째 거름이다(포커스가 `body`에 떨어져 뿌리를 지나지 않은 Mod+Enter는 깃발이 막는다). GlobalShortcuts의 Mod+L·Mod+,는 무시한다(설정으로 가면 카드가 언마운트된다). 입력칸 밖 붙여넣기도 무시한다(새 주소를 불러오면 카드가 바뀐다). 창 드롭(DropOverlay)도 무시하고, macOS 메뉴의 "설정…"·"…에 관하여"(`App.svelte:74-75`의 `onMenuSettings`·`onMenuAbout` → `ui.goSettings`)도 무시한다. 다섯 모두 테스트로 고정한다(jsdom `fireEvent`는 동기 디스패치라 microtask 순서를 재현하지 못하므로 Mod+Enter는 Playwright로도 본다) | `ResolveCard.svelte:394-401`(`!e.defaultPrevented`만 본다), `GlobalShortcuts.svelte:20-32,37-43`, 메뉴(`App.svelte:74-75`) [확인]. DropOverlay(`InputPanel.svelte:117,167`) [확인] |
| RE16 | **Esc 순서**(편집 화면 안, 첫 줄은 `isImeKey`). (0) **`e.repeat`인 Esc는 `preventDefault` + `stopPropagation`만 하고 아무것도 닫지 않는다**(끌기 취소 뒤나 전체 화면을 푼 뒤의 반복이 편집 화면을 닫아 초안을 버리지 않게). (1) 손잡이를 끄는 중이면 끌기를 취소한다. (2) 영상이 전체 화면이면(`document.fullscreenElement` 또는 `webkitDisplayingFullscreen`) `preventDefault`는 하지 않고(웹뷰가 전체 화면을 푼다) `stopPropagation`만 한다(창 처리기가 카드를 닫지 않게). (3) 편집 화면을 닫는다(초안을 버린다). (1)·(3)은 `preventDefault` + `stopPropagation`이다. **같은 규칙을 둘째 경로에도 건다**: 포커스가 `body`로 떨어져 키가 뿌리를 지나지 않을 때를 위해, 편집 화면은 열린 동안 `ui.onEscape` 사다리 맨 안쪽에 처리기를 쌓는다. 이 처리기는 (1)·(2)일 때도 `true`를 돌려준다(닫지 않아도 받은 것으로 친다. `false`면 사다리가 카드 닫기로 내려간다). **길게 누른 Esc는 창 처리기(GlobalShortcuts)와 Dialog도 무시한다**(공통 규칙 "길게 누른 Esc는 한 층만 닫는다"). 그래서 대화상자가 닫힌 뒤 포커스가 편집 화면으로 돌아와도 반복 keydown이 편집 화면을 닫지 않는다 | 창 Esc 사다리(`ui.svelte.ts:36-58`, `GlobalShortcuts.svelte:11-17`: 대상이 `HTMLMediaElement`일 때만 건너뛴다), 대화상자 Esc(`Dialog.svelte:155-162`: `e.repeat`를 보지 않는다) [확인]. Codex 시안 6 ⑤ |
| RE17 | **Esc로 편집 화면을 닫을 때 확인을 묻지 않는다.** PVU12("찍는 중 실수로 편집 내용을 잃지 않게")의 판단을 이 화면에서는 뒤집는다. 잃는 것은 초안뿐이고 카드의 확정 구간은 그대로다. 다시 열면 확정값부터 시작한다. 대화상자를 더하면 "[닫기] = 초안 버림"이라는 사용자 결정이 한 단계 늘어난다 | 사용자 결정 1. M-RE-8에서 "초안을 잃어 놀랐다"가 나오면 다시 본다(§18 Q2) |
| RE18 | **조작 줄은 `role="group"`**(이름 `rangeEditor.controls.label`)이고 toolbar가 아니다. 그래서 단추마다 Tab으로 닿고 ←/→는 포커스 이동이 아니라 5초 탐색이다(§9). 일곱 단추는 `IconButton` md(28, coarse 40)이고 툴팁은 IconButton 계약의 `title`이다. 단축키가 있는 단추는 `title`에 `{label}({key})`(새 키 `shortcut.hint.label`)를 쓰고 `aria-keyshortcuts`를 단다. 보기/일시정지는 같은 단추에서 아이콘과 이름이 바뀐다(`play` "영상 보기" ↔ `pause` "일시정지"). 원형·36px 같은 새 모양은 만들지 않는다 | APG toolbar 방향키 예약과의 충돌(Codex 시안 6 ⑤). IconButton 치수·`title`(`components.md` §2.2) [확인] |
| RE19 | **아이콘 단추 허용 목록을 넓힌다(D67).** 조작 줄 일곱 + [전체 보기]가 글자 없는 아이콘 단추다. foundations §9의 허용 목록(10개)에 미디어 조작 묶음을 더한다. 은유 표에도 행을 더한다. 이름은 개념만 정하고 lucide-static 1.48.0의 실제 이름·path는 RE-5가 정한다(§12.3) | 허용 목록(foundations §9 표), DI7(`icons.mjs:399-407`), DI4 같은 아이콘 다른 동작 금지(`icons.mjs:322-347`) [확인]. Codex 시안 6 ⑫ |
| RE20 | **구간 반복은 토글 단추 하나다**(`Button` sm, 아이콘 `repeat` 계열 + 글자, `aria-pressed`). 글자는 기존 키 `watch.range.loop.label` "구간 반복하기"를 다시 쓴다(시안의 "구간 반복"이 아니다. content §5.1 기본형 "-기", DC11 같은 값 금지). 켜진 모양은 IconButton `aria-pressed` 행과 같은 중립 면(`--surface-2`, 글자 `--fg`)이다. 파란 면은 쓰지 않는다. **면 차이(`--surface-2` / `--surface` 약 1.24:1)만으로는 상태가 보이지 않으므로 켜짐에 색이 아닌 둘째 단서로 1px `--border-strong` 테두리를 더한다**(꺼짐은 테두리 없음. D67에 결정으로 적는다). 반복 규칙은 §8.2다 | 기존 키(`ko.ts:100`) [확인]. components §2.2 매트릭스 [확인]. Codex 시안 6 ⑬ |
| RE21 | **[구간 보기]·[시작부터 보기]·구간 보기 모드(`playMode 'range'`)를 지운다.** 시안 7의 조작 줄에 없다. 구간 확인은 [구간 처음으로] + [보기]에 반복을 켜서 한다. 반복을 끄고 보면 구간 끝을 지나 계속 간다(Source Monitor와 같다) | 시안 7 조작 줄. `playStep`(`rangeEdit.ts:200-221`), 단추(`WatchPanel.svelte:564-569`) [확인] |

## 1. 목표와 범위

### 1.1 목표
- 받기 카드는 다시 짧아진다. 빠른 다시보기 카드는 구간 줄 하나로 "무엇을 받는지"(전체 또는 구간)를 보인다.
- 구간을 고르는 일은 창 전체 화면에서 영상을 크게 보며 초 단위로 한다. 확대·이동으로 3시간짜리 영상에서도 1초를 손잡이로 맞출 수 있다.
- 편집은 초안이다. 적용하기 전까지 카드가 받을 구간은 바뀌지 않는다.
- 기본 흐름(붙여넣기 → [받기])에 단계를 더하지 않는다(range.md §1.1). 편집 화면을 열지 않으면 전체를 받는다.

### 1.2 하지 않는 것
- 실제 장면 썸네일·소리 파형(데이터가 없다. 트랙은 단색이다, Codex 시안 2 ⑤).
- 실제 표지 이미지(PS5 후속 그대로).
- 손잡이 끌기 중 가장자리 자동 이동(RE13, §16).
- 스크러빙(눈금·트랙을 끄는 동안 연속 탐색). 누름은 한 번 탐색이다(§7.4).
- 일반 VOD·클립의 구간(R3), 네이티브 m3u8 경로의 결합(PV17).
- Rust·command·DTO 변경. 앱 프런트와 문서만 바뀐다(§4).
- 확인 대화상자(닫기·Esc 때, RE17).

### 1.3 사용자 흐름
1. 빠른 다시보기 주소를 불러오면 카드가 열린다. 메타 줄 아래에 구간 줄 "구간 전체 [구간 편집…]"이 있다. 미리보기 섹션은 없다.
2. [구간 편집…]을 누르면 창 전체에 편집 화면이 뜨고 포커스는 제목 "구간 편집"(h1)에 간다. 요청은 아직 없다.
3. 위쪽 영상 자리는 표지 자리와 [영상 보기]다. 아래 타임라인은 meta 길이로 그린 눈금·트랙과 양 끝 손잡이이고, 구간 줄은 빈 두 칸("처음부터"·"끝까지")과 "전체 길이: 1:30:00 · 약 2.1GB"다.
4. 손잡이를 끌거나 칸에 적으면 초안이 바뀌고 길이 줄이 "구간 길이: …"가 된다. ⌘/Ctrl+휠로 커서 둘레를 확대하면 범위 막대와 [전체 보기]가 나오고, 휠로 이동한다.
5. [영상 보기]를 누르면 영상이 붙는다(hls.js). 조작 줄 단추가 켜지고, 지금 위치선이 생긴다. I/O·[시작 찍기]·[끝 찍기]로 지금 시각을 찍고, Space로 보기/일시정지(포커스가 단추 위면 Space는 그 단추를 누른다. 영상 위면 네이티브 보기), ←/→로 5초 이동한다. [구간 반복하기]를 켜고 [구간 처음으로]를 누른 뒤 [영상 보기] 단추(또는 시간 영역에서 Space, 네이티브 controls)로 구간만 돌려 본다. 어느 경로로 보기를 시작해도 반복·따라가기 규칙은 같다(`play` 이벤트 한 곳, §8.2).
6. [구간 적용하기](⌘↩ / Ctrl+Enter)를 누르면 검증한다. 통과하면 화면이 닫히고 세션도 닫힌다. 카드 구간 줄은 "구간 0:10:00~0:40:00 · 길이 0:30:00 [구간 편집…] [구간 지우기]"가 되고, 화질 크기·저장될 이름이 그 구간 기준으로 바뀐다. 포커스는 [구간 편집…]으로 돌아온다.
7. 검증에 실패하면(예: 끝이 시작보다 앞) 화면은 열린 채이고, 끝 칸 아래에 오류가 나오고 끝 칸으로 포커스가 간다.
8. [닫기]나 Esc는 초안을 버리고 닫는다. 카드의 구간은 그대로다.
9. 카드의 [구간 지우기]는 곧바로 전체로 되돌린다. 포커스는 [구간 편집…]으로 간다.

## 2. 기존 결정과의 관계

| 기존 | 이 명세에서 | 근거 |
|---|---|---|
| D66·ADR-0029: 빠른 다시보기는 "미리보기·구간" 한 섹션, 기본 펼침, 열림 기억 | **빠른 다시보기 부분이 바뀐다**: 섹션이 없어지고 구간 줄 + 편집 화면이 된다. 일반 VOD·클립 "미리보기" 섹션(기본 펼침·기억·표지 자리·누를 때 세션)은 그대로다. D66 행 끝에 "→ 빠른 다시보기는 D67로 바뀜"을 적는다. ADR-0029는 `폐기(→ 0030)`이고, 이어지는 결정(VOD·클립 섹션)은 ADR-0030이 다시 적는다 | RE14, §12 |
| D64·ADR-0027: 기본 접힘 미리보기 줄 | 이미 D66·ADR-0029로 바뀌었다(`폐기(→ 0029)`). 이 명세는 D64 행과 ADR-0027을 건드리지 않는다 | — |
| D66 PS9: 구간은 섹션이 펼쳐져 있을 때만 적용 | **뒤집힘**: 확정 구간은 열림과 무관하게 늘 적용된다. "보이는 것이 받는 것"은 카드 구간 줄이 확정값을 늘 보이는 것으로 지킨다 | RE2 |
| D66 PS6: [영상 보기]를 누를 때 `watch_open` | 그대로. 자리만 편집 화면 안이다 | RE7 |
| PS12 `coupled`, PV17 | 그대로 | RE8 |
| D65·ADR-0028: 카드 안 `<video>` 아래 구간 막대(`RangeTimeline`) | **바뀜(RE-4)**: 타임라인 패널(눈금·트랙·손잡이·확대)로 대체되고 `RangeTimeline.svelte`는 지운다. ADR-0028은 `폐기(→ 0030)`, D65 행 끝에 "→ D67로 바뀜"을 적는다. 손잡이 값 계약(정수 초, 서로 넘지 못함, `handleBounds`·`clampHandle`·`handleKey`)과 지금 위치선 `--fg`는 그대로 쓴다 | §7.4 |
| preview-ux PVU12·patterns §8: 편집 영역의 Esc는 카드를 닫지 않는다 | 편집 화면의 Esc는 **편집 화면을 닫는다**(초안 버림). 카드는 닫지 않는다 | RE16·RE17 |
| PVU11·§6.3 구간 보기 모드, [구간 보기]·[시작부터 보기] | **지움** | RE21 |
| PS1~PS3: 칸 ↑/↓ 1초, 길게 누르면 뗄 때 한 번 탐색, blur 탐색(PVU10) | 그대로. 편집 화면의 칸으로 옮긴다 | §9 |
| PS10: 빈칸 = 전체, 빈 시작 = 0 | 그대로(초안 규칙) | RE3·RE4 |
| PS15: `notOwn`·`unknown`·생방송에는 없음 | 그대로(구간 줄·진입 없음) | RE5 |
| PVU8 접힌 줄을 처음 고칠 때 되돌림(`rangeEdit.begin`·`initialEnd`·`Fields.open`) | **지움**: 초안은 늘 "열려" 있다. 안전 경로였을 뿐 닿지 않는다 | §3.2 |
| range.md R62: 칸은 카드마다 새로 시작 | 그대로: `applied`는 카드마다 `null`로 시작한다 | RE2 |
| patterns §8 규칙 5: 편집 영역 키는 그 영역 안에서만 | 그대로. 영역 = 편집 화면 전체다(I/O·Space·`+`·`-`·`0`이 칸 밖 어디서나) | §9 |
| foundations §9 아이콘 단추 허용 목록 10개 | 넓힘(D67) | RE19 |
| content §5.1 굳은 한자어 허용 목록 | "편집"을 더함([구간 편집…]) | §11 |

## 3. 기존 구현 지도(이 트리, `3297cbe`)

### 3.1 파일과 줄

| 파일 | 줄 | 지금 하는 일 | 이 명세에서 | 근거 |
|---|---|---|---|---|
| `app/src/App.svelte` | 74-75 | macOS 메뉴 `onMenuSettings`·`onMenuAbout` → `ui.goSettings` | `ui.rangeEditorOpen`이면 무시한다(RE15) | [확인] |
| `app/src/lib/components/receive/ResolveCard.svelte` | 81-91 | 칸 상태 `rangeStart`·`rangeEnd`·`rangeErr`·`videoSecs`·`barLen`·`watchPanel` | `applied`·`editorOpen`으로 바꾼다. 칸·`videoSecs`·`barLen`은 편집 화면으로 옮긴다 | [확인] |
| 〃 | 121-130 | `watchable`, `sectionOpen = ui.previewOpen && rewind && watchable`, `rangeInput`, `range = effectiveRange(...)`, `key`, `sizeSecs` | `range = rangeApplies ? applied : null`(`rangeApplies = tone === 'rewind' && watchable`). `key`·`sizeSecs`·요청은 그대로 `range`를 읽는다 | [확인] |
| 〃 | 169-251 | `setFields`·`markRange`·`handleFields`·`focusField`·`blurField`·`seekSecsOf`·`flushSeek`·`fieldKey`·`fieldKeyUp` | 편집 화면으로 옮긴다(동작 그대로, PS1~PS3·PVU10) | [확인] |
| 〃 | 257-275 | `lengthText`, 접을 때 `rangeErr` 지움 | 순수 `lengthLine(input, durationSecs, sizeOf)`(receive.ts)로 뽑아 편집 화면이 쓴다. 접힘 효과는 지운다 | [확인] |
| 〃 | 347-355 | `download()`: [받기] 때 `rangeError` | 지운다(`applied`는 적용 때 검증됐다. §5.2) | [확인] |
| 〃 | 394-401 | 창 Mod+Enter → `download()`(`!e.defaultPrevented`만 본다) | `defaultPrevented`이거나 `ui.rangeEditorOpen`이면 처리하지 않는다(편집 화면 뿌리가 늘 `preventDefault`, RE15) | [확인] |
| 〃 | 406-420, 441-455 | `rangeLine` 스니펫(RangeField), `WatchPanel` 배선(`markable`·`fields`·`len`·`onfields`·`below` …) | 빠른 다시보기: `RangeSummary` + `RangeEditor`. 일반 VOD·클립: `WatchPanel`(구간 props 없음) | [확인] |
| `app/src/lib/components/receive/WatchPanel.svelte` | 74-112 | 단계·세션·hls·`usingHls`·`metaReady`·`position`·`playMode`·`loop`·`coupled` | 세션 부분은 `watchSession.svelte.ts`로 추출(RE-2). 구간 부분(`playMode`·`loop`·`position`·`coupled`)은 편집 화면으로 옮긴다(RE-3) | [확인] |
| 〃 | 151-304 | `focusIsFree`·`afterReady`·`afterFailed`·`closeSession`·`openSession`·`openHls`·`onchange`·`onvideoerror` | 추출(RE-2). 포커스 복귀 대상(`<summary>`)은 호출부가 넘기는 콜백이 된다 | [확인] |
| 〃 | 306-475 | `mark`·`sel`·`barShown`·`region`·`seek`·`moveTo`·`stepSel`·`ownSeek`·`startPlay`·`playRange`·`playFromStart`·`onloop`·`apply`·`ontimeupdate`·`onseeked`·`onpause`·`onended`·`onEditorKey` | 편집 화면으로 옮긴다(RE-3). `playRange`·`playFromStart`·`'range'` 모드는 RE-5가 지운다 | [확인] |
| 〃 | 487-578 | Disclosure + 표지 자리 + 실패 Notice + `.editor` + 막대 + 조작 줄 + `below` | VOD·클립용으로 줄인다: Disclosure + 표지 자리 + 실패 Notice + `<video>` | [확인] |
| `app/src/lib/components/receive/RangeTimeline.svelte` | 1-270 | 카드 막대: 손잡이 둘(`slider`)·끌기 앵커 오프셋·막대 누름 탐색·`--p` 위치 | RE-3은 편집 화면 안에서 그대로 쓴다. RE-4가 `EditorTimeline`으로 바꾸고 지운다. 끌기 앵커 오프셋(`:56-60`)·포인터 캡처(`:61-65`)·키(`:93-104`)·ARIA 값(`:122-130`)은 새 손잡이로 옮긴다 | [확인] |
| `app/src/lib/components/receive/RangeField.svelte` | 1-180 | 카드 칸 줄(FieldRow + 칸 둘 + 길이 줄 + 오류), IME 거름(`:57-60`), 오류 포커스(`:77-84`) | 지운다(RE-3). 칸·오류 마크업과 IME 거름은 편집 화면의 구간 줄로 옮긴다 | [확인] |
| `app/src/lib/rangeEdit.ts` | 8-12, 130-133, 144-192 | `Fields.open`, `begin`(접힘 되돌림), `moveHandle`·`nudge`·`mark`의 `initialEnd` | `open`·`begin`·`initialEnd`를 지운다(RE-3, 호출부와 함께) | [확인] |
| 〃 | 54-128 | `selection`·`handleBounds`·`fractionOf`·`secsAt`·`clampHandle`·`handleKey`·`seekKey` | 그대로 쓴다. `fractionOf`·`secsAt`은 RE-4 뒤 쓰는 곳이 없으면 지운다(`rangeView`가 대신한다) | [확인] |
| 〃 | 200-221 | `playStep`(`off`·`range`·`loop`) | `'range'`를 지우고 반복 규칙(§8.2)으로 좁힌다(RE-5) | [확인] |
| `app/src/lib/receive.ts` | 125-198 | `RangeInput`·`RangeError`·`rangeError`·`effectiveRange`·`rangeSecs`·`rangeChip` | 그대로 쓴다. `applyDraft`·`draftOf`·`rangeSummary`·`lengthLine`을 더한다(RE-1) | [확인] |
| `app/src/lib/stores/ui.svelte.ts` | 28-58 | `previewOpen`, Esc 처리기 사다리 | `previewOpen` 주석을 "일반 VOD·클립 섹션만"으로 고친다. `rangeEditorOpen = $state(false)`를 더한다 | [확인] |
| `app/src/lib/components/app/GlobalShortcuts.svelte` | 9-43 | Esc(`HTMLMediaElement`·`[data-local-keys]` 예외), Mod+L·Mod+,, 입력칸 밖 붙여넣기 | `e.repeat` Esc 무시(RE16), `ui.rangeEditorOpen`이면 Mod+L·Mod+,·붙여넣기 무시(RE15). `[data-local-keys]` 예외는 편집 화면이 생기면 쓰는 곳이 없어 지운다(RE-3) | [확인] |
| `app/src/lib/components/receive/InputPanel.svelte` | 117, 150-160, 167 | 드롭 주소 불러오기, Esc 사다리에 카드 닫기 | 드롭은 `ui.rangeEditorOpen`이면 무시한다. Esc 사다리는 그대로다(편집 화면이 먼저 막는다) | [확인] |
| `app/src/lib/components/ui/Dialog.svelte` | 126-169 | `layer`(body로 옮김·나머지 inert·opener 포커스 복귀)·Esc·`trapTab` | RE-3에서 공용 attach `ui/modalLayer.ts`(층 스택, inert 다시 계산)로 **뽑는다**(RE1). Dialog와 편집 화면이 함께 쓴다. 기존 Dialog 테스트는 무수정 녹색이어야 한다. Dialog Esc 처리기에 `e.repeat` 무시를 더한다(RE16) | [확인] |
| `app/src/lib/components/ui/IconButton.svelte` | 1-37 | `aria-label = title = label` | `title` 덮어쓰기 prop(`hint`)을 더한다(단축키 툴팁, RE18) | [확인] |
| `app/src/lib/components/ui/vocab.ts` | 44-47 | `ICON_BUTTON_ICONS`(허용 목록 10) | 미디어 조작 아이콘을 더한다(RE19) | [확인] |
| `app/src/lib/platform.ts` | 13-23 | 단축키 표기 표(`paste`·`submit` …) | `zoomMod`(⌘ / Ctrl)를 더한다 | [확인] |
| `app/src/lib/copy/ko.ts` | 71-100, 192 | `range.*`·`watch.*`·`action.pause` | §11 | [확인] |
| `app/src/App.svelte` | 159-182 | `.main`·뷰 분기·대화상자들·Toaster·LiveAnnouncer | 바꾸지 않는다(메뉴 거름은 위 74-75 행). 편집 화면 레이어는 `body` 직속이라 `.app`과 같은 층이다 | [확인] |
| `app/e2e/mock/backend.ts` | 151-155, 385-402 | `watch_open`(ok/error/src 덮어쓰기)·`watch_close` | command는 그대로다. 호출 기록만 spec이 본다 | [확인] |
| `app/e2e/watch.spec.ts` | 138-366 | 빠른 다시보기 섹션·찍기·손잡이·I/O·칸 ↑/↓·재생 전 막대·720×520 | 빠른 다시보기 부분은 새 `app/e2e/range-editor.spec.ts`로 옮겨 고쳐 쓴다. 47-117(일반 VOD)은 그대로다 | [확인] |
| `app/e2e/range.spec.ts` | 25-154 | 칸 입력 → `enqueue` range, 접힘 → range 없음, 오류, 길이 미상, 생방송 | 편집 화면 경로로 고쳐 쓴다. "접힘 → range 없음" 시험은 "[닫기] → range 그대로"·"[구간 지우기] → range 없음"으로 바꾼다 | [확인] |
| `app/e2e/screens-data.ts` | 127-135, 205-409 | 갤러리 장면 `card-watch-*`·`card-range*`·`card-rewind-default`·`card-section-collapsed` | 빠른 다시보기 장면을 다시 쓰고 편집 화면 장면을 더한다(§14) | [확인] |
| `app/src/lib/components/receive/{receive,WatchPanel,RangeTimeline}.test.ts`, `app/src/lib/{rangeEdit,receive}.test.ts` | — | 카드·섹션·막대·순수 시험(합 5125줄) | 빠른 다시보기 시험은 `RangeEditor.test.ts`·`EditorTimeline.test.ts`·`rangeView.test.ts`로 **옮긴다**(지우지 않는다. `tests.vitest` ratchet) | [확인] |
| `scripts/design/spec-check.mjs` | 95 | D 번호 상한 66 | 67로 올린다(RE-3) | [확인] |
| `app/src-tauri/tauri.conf.json` | 20-25 | 최소 창 720×520, `zoomHotkeysEnabled: false` | 바꾸지 않는다 | [확인] |

### 3.2 재사용·이동·삭제 요약

| 무엇 | 처리 | PR |
|---|---|---|
| `rangeEdit` `selection`·`handleBounds`·`clampHandle`·`handleKey`·`seekKey`·`nudge`·`mark`·`seekTargetOf`·`timelineLength`·`consumeOwnSeek`·`reachesEnd` | 재사용(시그니처에서 `open`·`initialEnd`만 빠진다) | RE-3 |
| `rangeEdit.playStep` | `'range'` 모드를 지우고 반복 규칙으로 | RE-5 |
| `rangeEdit.begin`·`Fields.open`·`initialEnd` | 삭제 | RE-3 |
| `receive.rangeError`·`effectiveRange`·`rangeSecs`·`rangeChip`·`checkKey`·`buildEnqueueRequest` | 재사용 | — |
| WatchPanel 세션 수명(`openSession`·`openHls`·`closeSession`·`attempt`·`onvideoerror`·포커스 판단) | `watchSession.svelte.ts`로 추출, VOD·클립 섹션과 편집 화면이 함께 쓴다 | RE-2 |
| WatchPanel 구간 편집부(막대·조작 줄·키·`playStep` 배선) | 편집 화면으로 이동 | RE-3 |
| `RangeField.svelte` | 삭제(마크업은 편집 화면 구간 줄로) | RE-3 |
| `RangeTimeline.svelte` | RE-3에서 편집 화면 안에서 임시로 쓰고 RE-4에서 삭제 | RE-4 |
| 카드 칸 처리기(`fieldKey`·`blurField` …) | 편집 화면으로 이동 | RE-3 |
| `GlobalShortcuts` `[data-local-keys]` 예외 | 삭제(쓰는 곳 없음) | RE-3 |
| 문구 `watch.toggle.range`·`watch.editor.a11y` | 삭제 | RE-3 |
| 문구 `watch.range.play.label`·`watch.range.fromStart.label` | 삭제 | RE-5 |

## 4. 코어·셸 변경

없다. command·DTO·bindings·가짜 백엔드 command는 그대로다. `watch_open`·`watch_close`의 계약도 같다(부르는 자리만 바뀐다). 그래서 `rust`·`tauri` gate는 영향 밖이다.

## 5. 상태 모델

### 5.1 셋의 분리

| 상태 | 주인 | 처음 값 | 바꾸는 것 | 읽는 것 |
|---|---|---|---|---|
| `applied: TimeRangeDto \| null` | ResolveCard | `null`(전체) | 편집 화면의 적용 성공, 카드 [구간 지우기] | 구간 줄 요약, `checkKey`, `checkOutput`, `enqueue`, 화질 크기 `sizeSecs`, 저장될 이름 |
| `editorOpen: boolean` | ResolveCard(`ui.rangeEditorOpen`에 거울) | `false` | [구간 편집…](열기), 적용 성공·[닫기]·Esc(닫기), 카드 사라짐 | 레이어 그리기, 창 처리기 거름(RE15) |
| `draft: { start, end }` | RangeEditor | 열 때 `draftOf(applied, durationSecs)` | 칸 입력·↑/↓, 손잡이, 찍기, 편집 화면 [구간 지우기] | 타임라인 손잡이·띠, 길이 줄, 적용 |
| `draftErr: RangeError \| null` | RangeEditor | `null` | 적용 실패 때 세운다. 손잡이·↑/↓·찍기·[구간 지우기]로 초안이 바뀌면 지운다. 타이핑은 지우지 않는다(PS1 선례) | 오류 Notice·`aria-invalid`·포커스 |
| 세션 단계 `phase` | RangeEditor(`watchSession`) | `idle` | §5.4 | 영상 자리, `coupled` |
| 보이는 범위 `view` | EditorTimeline | `{0, L}`(전체) | 휠·키·범위 막대·[전체 보기]·`reveal`·따라가기 | 눈금·띠·손잡이 위치 |
| `loop: boolean` | RangeEditor | `false`(열 때마다) | [구간 반복하기] | §8.2 |

- `ui.rangeEditorOpen`은 `editorOpen`의 거울이다. 레이어의 attach가 붙을 때 `true`, 떨어질 때 `false`로 쓴다. 그래서 카드가 갑자기 사라져도 `false`로 돌아온다. 테스트로 고정한다.
- `ui.previewOpen`은 일반 VOD·클립 섹션에만 쓴다. 빠른 다시보기 카드는 읽지도 쓰지도 않는다.
- 편집 화면이 열린 동안 카드는 `inert`라 화질·폴더·이름을 바꿀 수 없다. 그래서 편집 화면이 쓰는 화질(길이 줄의 예상 크기)은 열린 동안 고정이다.

### 5.2 적용 검증(`applyDraft`, RE3)

`durationSecs`는 `view.meta.durationSecs`다. 영상이 알려 준 길이는 막대를 그릴 때만 쓰고 검증에는 쓰지 않는다. Rust가 받는 구간의 기준은 meta이고, 지금 `effectiveRange` 계약과 같다.

| 시작 칸 | 끝 칸 | meta 길이 | 결과 | `applied` | 오류 표시 |
|---|---|---|---|---|---|
| `''` | `''` | 5400 | 통과 | `null` | — |
| `''` | `''` | 없음 | 통과 | `null` | — |
| `0:10:00` | `0:40:00` | 5400 | 통과 | `{600000, 2400000}` | — |
| `''` | `0:40:00` | 5400 | 통과 | `{0, 2400000}` | — |
| `0:00:00` | `1:30:00` | 5400 | 통과(전체를 덮음) | `null` | — |
| `0:10:00` | `''` | 5400 | 통과 | `{600000, 5400000}` | — |
| `0:10:00` | `2:00:00` | 5400 | 통과(끝이 길이 초과 → 영상 끝으로 자름) | `{600000, 5400000}` | — |
| `0:10:00` | `''` | 없음 | 통과(길이 미상, 끝까지) | `{600000, null}` | — |
| `abc` | `''` | 5400 | `format`(시작) | 그대로 | 시작 칸 아래 `range.error.format` |
| `0:10:00` | `xyz` | 5400 | `format`(끝) | 그대로 | 끝 칸 |
| `0:40:00` | `0:10:00` | 5400 | `order`(끝) | 그대로 | 끝 칸 `range.error.order` |
| `0:10:00` | `0:10:00` | 5400 | `order`(끝) | 그대로 | 끝 칸 |
| `2:00:00` | `''` | 5400 | `beyond`(시작) | 그대로 | 시작 칸 `range.error.beyond` |
| `2:00:00` | `''` | 없음 | 통과(길이를 몰라 막을 수 없음, 작업 행이 알린다: range.spec "구간을 찾지 못하면") | `{7200000, null}` | — |

- 오류는 한 번에 하나다. 앞 칸·앞 규칙이 먼저다(`rangeError` 그대로).
- 오류 Notice는 구간 줄 아래에 붙는다. 그래서 타임라인 패널 높이가 한 줄(약 32) 늘고 영상 높이가 그만큼 준다(§6.2의 식은 패널의 실제 높이를 쓴다).
- 초안이 `applied`와 같아도 적용은 성공이다. 화면을 닫고, 바뀐 것이 없으면 알리지 않는다.
- [받기]는 더 이상 `rangeError`를 부르지 않는다. `applied`는 적용 때 검증된 값이고, 카드마다 meta 길이가 바뀌지 않기 때문이다. 카드의 `rangeErr` 상태와 오류 마크업은 지운다.

### 5.3 카드 구간 줄(`rangeSummary`, RE5)

> 경계: 시작이 내림 길이와 올림 길이 사이이면(예: 길이 5400.4초, 시작 1:30:00) 내림 끝이 시작 이하라 길이 0이 되므로 올림 끝을 그대로 보인다(`lengthLine`과 같은 1초).

| `applied` | meta 길이 | 값 글자 | 단추 |
|---|---|---|---|
| `null` | 무엇이든 | 전체 | [구간 편집…] |
| `{600000, 2400000}` | 5400 | 0:10:00~0:40:00 · 길이 0:30:00 | [구간 편집…] [구간 지우기] |
| `{600000, 5400000}` | 5400 | 0:10:00~1:30:00 · 길이 1:20:00 | 같다 |
| `{600000, 5401000}`(올림 끝) | 5400.4 | 0:10:00~1:30:00 · 길이 1:20:00(끝은 내림 길이로 보인다) | 같다 |
| `{600000, null}` | 없음 | 0:10:00~ | 같다 |

- 끝 시각은 `min(endMs/1000, meta 길이)`를 내려 보인다. `effectiveRange`가 끝을 올림 길이(`knownMs`)로 만들어서, 그대로 보이면 meta 줄의 길이보다 1초 길어 보인다(`receive.ts:141-148`) [확인].
- 줄은 `aria-live`가 없다. 적용·지우기 뒤 알림은 announcer가 한 번 한다(§10).

### 5.4 편집 화면 단계(`watchSession`의 `phase`)

| 지금 | 사건 | 다음 | 부수 효과 |
|---|---|---|---|
| (편집 화면 열림) | — | `idle` | 요청 0 |
| `idle` | 표지 자리 [영상 보기] | `opening` | `watch_open` 1회, 단추 `loading`(포커스 유지) |
| `opening` | 성공(hls, hls.js 지원) | `ready` | `attachMedia`, `usingHls`, `play()` 시도, 포커스 `<video>`(단추·`body`에 있을 때만) |
| `opening` | 성공(hls, 네이티브 m3u8) | `ready` | `src`, `usingHls = false`(결합 없음), `play()` 시도, 안내 줄 `rangeEditor.uncoupled.body` |
| `opening` | 성공(mp4) | `ready` | 빠른 다시보기는 hls가 온다 [가정]. mp4가 오면 지금처럼 `src`로 붙이고 결합하지 않는다(네이티브 대체와 같은 칸 편집기). 낯선 종류·mp4를 못 읽는 웹뷰는 지금처럼 실패다(`WatchPanel.svelte:212-217`) [확인] |
| `opening` | 실패·게이트 거부 | `failed` | Notice(`role=alert`), 포커스는 단추·`body`에 있을 때만 h1로 |
| `ready` | `<video>` 오류·hls fatal·세션 만료 | `failed` | 세션 닫음, 포커스는 `<video>`에 있을 때만 h1로 |
| `failed` | [다시 시도] | `opening` | `watch_open` 1회 |
| `ready` | 적용 성공·[닫기]·Esc·카드 사라짐 | (레이어 사라짐) | `attempt += 1`, `hls.destroy` → `watch_close` 1회 |
| `opening` | 같다 | (레이어 사라짐) | `attempt += 1`. 이때는 닫을 세션이 없어 `watch_close` 0회이고, 늦게 온 결과가 도착할 때 그 세션을 1회 닫는다(`WatchPanel.svelte:202-205`) [확인] |
| `idle`·`failed` | 같다 | (레이어 사라짐) | `watch_close` 0회(`idle`은 연 적이 없고, `failed`는 갈 때 이미 닫았다, `WatchPanel.svelte:291-304`) [확인] |

- 카드 사라짐은 `onDestroy`가 위와 같은 정리를 한다.

- `play()` 거절은 단계를 바꾸지 않는다(`ready`, 일시정지. 조작 줄·네이티브 controls로 다시 누를 수 있다, M-RE-5).
- 실패 Notice는 영상 자리(16:9 상자 자리)에 그린다. 타임라인과 칸은 남아 계속 고칠 수 있다(PS12 그대로).
- 실패의 포커스 대상이 `<summary>`가 아니라 h1인 까닭: 편집 화면에는 섹션 머리가 없다. h1은 `tabindex=-1`·`data-focus-container`라 링이 없다(F-5).

### 5.5 결합별 동작(RE8)

| 경우 | 막대(타임라인) | 손잡이 → 초안 | 손잡이 commit → 영상 | 눈금·트랙 누름 | 지금 위치선 | 조작 줄 | 칸 blur·↑/↓ → 영상 | 확대·이동 |
|---|---|---|---|---|---|---|---|---|
| `idle`·`opening`, meta 길이 있음 | meta 길이 | 예 | 아니오 | 없음 | 없음 | 그림, 모두 `disabled` | 아니오 | 예 |
| `idle`·`opening`, meta 길이 없음 | 없음(눈금·트랙·손잡이 줄 대신 `rangeEditor.noLength.body` 한 줄) | — | — | — | — | 그림, `disabled` | 아니오 | 아니오 |
| hls.js, 메타데이터 전 | meta가 있으면 있음 | 예 | 아니오 | 없음 | 없음 | `disabled` | 아니오 | 예 |
| hls.js, 메타데이터 뒤(`coupled`) | meta, 없으면 영상 길이 | 예 | 예(놓을 때·키) | 한 번 탐색 | 있음 | 켜짐 | 예 | 예 |
| 네이티브 m3u8 | meta, 없으면 영상 길이 | 예 | 아니오 | 없음 | 없음 | `disabled` + 안내 줄 | 아니오 | 예 |
| `failed` | meta가 있으면 있음 | 예 | 아니오 | 없음 | 없음 | `disabled` | 아니오 | 예 |

- 막대 길이 `len = timelineLength(meta, videoSecs)`(PVU7 그대로)다. meta가 양수면 늘 meta라(`rangeEdit.ts:22-26`) meta → video 전환은 없다. 실제로 L이 바뀌는 경우는 셋이다: null → video(meta 없음, 영상이 붙음), video → null(`closeSession`의 `reportDuration(null)`, `WatchPanel.svelte:186`), video 값 변경(hls 길이가 늦게 갱신됨) [확인]. **L이 바뀌면 규칙 하나다**: 바뀌기 전 전체 보기였으면 `fullView(새 L)`, 확대돼 있었으면 `clampView(view, 새 L)`. L이 null이 되면 시간 영역을 그리지 않는다(§5.5 meta 없음 행).
- 길이가 2초보다 짧으면(`clampHandle`이 `null`) 손잡이는 그리되 고칠 수 없다. 확대도 없다(`L < minSpan`).

## 6. 화면 구성

### 6.1 영역과 DOM 순서(= 읽는 순서·Tab 순서, F-1)

```
[레이어 role=dialog aria-modal aria-labelledby=h1 aria-describedby=부제 tabindex=-1]
 ├ 머리(sticky top): h1 "구간 편집"(tabindex -1) · 부제(caption 12, `--fg`, 말줄임) · [닫기](secondary) · [구간 적용하기 ⌘↩](primary)
 ├ 모니터(section, 이름 "영상"): 영상 자리(표지 자리+[영상 보기] | <video controls> | 실패 Notice)
 │   └ 조작 줄(role=group): 지금 시각 · [시작 찍기][구간 처음으로][N초 뒤로][영상 보기|일시정지][N초 앞으로][구간 끝으로][끝 찍기] · 전체 길이
 └ 타임라인 패널(section, 이름 "타임라인")
     ├ 패널 머리: 제목 "타임라인" · 안내 줄 · ([전체 보기]) · [구간 반복하기](aria-pressed)
     ├ 시간 영역(role=group, 이름 "타임라인", tabindex -1, 휠 리스너): (범위 막대 scrollbar) · 눈금 · 영상 트랙 · 소리 트랙 · 흐림·띠·지금 위치선(aria-hidden) · 손잡이 둘(slider)
     └ 구간 줄(role=group, 이름 "구간"): 시작 칸 ~ 끝 칸 · 길이 줄 · [구간 지우기] · (오류 Notice)
```

- 레이어 배경은 `--bg`, 모니터 영역도 `--bg`, 머리·패널은 `--surface`, 영역 경계는 `--separator` 1px이다. 영상 상자 바탕은 지금 `.player`와 같은 `--surface-2`이고 테두리 반경은 `--radius-control`이다. **단 `--watch-max-h`(360)는 쓰지 않는다**: 편집 화면의 영상 크기는 §6.2 `monitorSize`가 정한다(카드 `.player`의 `max-height`를 가져오면 960×700에서 395 대신 360에 묶인다).
- 부제는 어느 영상인지 말하는 유일한 글자라 `--fg-muted`가 아니라 `--fg`로 쓰고 레이어의 `aria-describedby`로 잇는다(foundations §3 "12px `--fg-muted` 글자 하나만으로 의미를 전하지 않는다").
- 레이어 `z-index`는 `--z-dialog`다. 레이어가 `body`에 먼저 붙으므로, 나중에 뜨는 대화상자(CloseGuard·UpdateDialog·LogoutDialog)는 DOM 뒤에 붙어 그 위에 뜨고 편집 화면을 `inert`로 만든다. 편집 화면은 Dialog의 슬롯 대기열(`Dialog.svelte:24-40`) 밖이라 대화상자와 겹칠 수 있고, UpdateDialog는 비동기로 뜬다. 지금 Dialog의 "열 때 찍어 둔 이전 값으로 되돌리기"(`:131-145`)는 층이 생긴 역순으로 닫힐 때만 맞다 [확인]. 편집 화면 위에 대화상자가 뜬 사이 카드가 사라지면(로그인 잠금·`{#key}`) 대화상자가 닫힐 때 `.app`을 inert로 되돌려 앱 전체가 잠긴다. 그래서 RE-3에서 둘 다 `modalLayer`(층 스택, 닫힐 때마다 "맨 위 층 말고 모두 inert"를 다시 계산)로 바꾼다(RE1).
- 레이어는 모든 레이아웃에서 `overflow-y: auto`를 안전망으로 둔다(§6.3).
- 토스트(Toaster)와 LiveAnnouncer는 앱 뿌리 안에 있어 편집 화면이 열린 동안 `inert`·가림 아래다. 그래서 **편집 화면 안 알림은 화면 안 `role=alert`(오류 Notice)만 쓴다.** 적용·지우기 알림은 레이어가 떨어진 뒤(`tick`) announcer로 한다. 그 사이 끝난 받기 토스트는 편집 화면을 닫으면 보인다(목록이 상태를 가진다).

### 6.2 크기(순수 함수 `monitorSize`, 레이아웃 계산의 한 곳)

모니터 영역 크기(`stageW`·`stageH`, ResizeObserver)에서 영상 상자와 조작 줄 폭을 계산한다. 영상을 높이에서 16:9로 맞추는 일은 CSS만으로는 조작 줄 폭(영상 폭과 같고 최소 380)까지 묶기 어렵다. 그래서 JS 한 곳이 계산한다 [가정: RE-3에서 CSS `aspect-ratio`만으로 되면 함수는 테스트 전용 기준으로 남긴다].

```
videoH = max(VIDEO_MIN_H, stageH − controlsH − padTop)
videoW = min(stageW, round(videoH × 16 / 9));  videoH = round(videoW × 9 / 16)
rowW   = narrow ? stageW : min(stageW, max(videoW, CONTROLS_MIN_W))
narrow:  videoW = stageW;  videoH = max(VIDEO_MIN_H, round(stageW × 9 / 16))   // 폭에서만 정한다
```

- `narrow`는 좁은 레이아웃이면 레이어가 세로로 스크롤되므로 `stageH`를 쓰지 않는다. 높이를 쓰면 `stageH`가 다시 영상 높이에 기대 ResizeObserver가 돈다.
- `narrow`의 출처는 `layout.css`다. 두 좁은 레이아웃 블록이 `--layout-narrow: 1`(기본 0)을 세우고, 편집 화면은 이를 `getComputedStyle`로 읽는다(ResizeObserver 콜백 안). 컴포넌트에 `matchMedia`·폭 미디어 쿼리를 두지 않는다(DL13).
- `CONTROLS_MIN_W`도 계산값으로 읽는다(아래 표, coarse에서 커진다).
- 기본 레이아웃에서도 `VIDEO_MIN_H`에 닿은 뒤 패널이 더 커질 수 있다(coarse 줄 40, 오류 Notice, 두 줄 머리, `data-text-scale="large"`). 그때 아래가 잘리지 않게 레이어는 늘 `overflow-y: auto`다(§6.3).

| 상수 | 값 | 자리 |
|---|---|---|
| `VIDEO_MIN_H` | 90px [잠정] | 새 토큰 `--editor-video-min-h`(foundations §13 상수 표) |
| `CONTROLS_MIN_W` | 380px(coarse 464) [잠정] | 새 토큰 `--editor-controls-min-w: calc(7 * var(--control-h) + 184px)`. 가운데 일곱 단추 7×`--control-h` + 간격 6×4 + 좌우 칸(시각 최소 `--timeline-label-w` 64)×2 + 간격 2×8 = 364(coarse 448)에 여유 16. `--control-h`를 따라가므로 `@media (any-pointer: coarse)`(터치 화면 노트북 포함, `tokens.css:241`)에서 40×7로 커진다 |
| 머리 높이 | `--control-h` + 2×`--space-8` ≈ 44(부제가 있으면 두 줄 ≈ 52) | 기존 토큰 |
| 조작 줄 높이 | `--control-h` + 2×`--space-8` ≈ 44(coarse는 40 단추 → 56) | 기존 토큰 |
| 패널 | 머리 40 + (범위 막대 24) + 눈금 24 + 영상 48 + 소리 32 + 구간 줄 48 + 경계 ≈ 193(확대 217) | 새 토큰 `--timeline-lane-h` 48·`--timeline-lane-sm-h` 32·`--timeline-label-w` 64, 눈금·범위 막대 줄은 `--hit-min` 24 |

| 창 | 영상(약) | 비고 [잠정: 계산값, 갤러리 측정으로 조인다] |
|---|---|---|
| 960×700, 전체 보기 | 700 − 52 − 16 − 44 − 193 ≈ 395 높이 → 702×395 | 시안 V7Light와 같은 비율 |
| 960×700, 확대 | ≈ 371 → 660×371 | |
| 720×520, 전체 보기 | ≈ 215 → 382×215, 조작 줄 382 | 시안 V7SmallZoom 계열 |
| 720×520, 확대 | ≈ 191 → 340×191, 조작 줄 **380**(영상보다 넓다) | Codex 시안 6 ⑨: 양쪽 시각 칸이 최소 64를 지킨다 |
| 720×520, 확대 + 오류 Notice | ≈ 159 → 283×159 | 오류가 패널을 늘린다(§5.2) |
| 720×520, 확대, coarse | ≈ 179 → 318×179, 조작 줄 **464** | 단추 40·조작 줄 56. 가로 스크롤 0(680 안) |
| 320×231(Windows 225%·`x-large`) | `VIDEO_MIN_H` 90, 편집 화면 전체가 세로로 스크롤 | §6.3 |

### 6.3 좁은 레이아웃(폭 600 미만 또는 `x-large`, patterns §15)

컴포넌트 안에 폭 미디어 쿼리를 두지 않는다(DL13). `layout.css`의 두 블록(`@media (max-width: 599px)`·`:root[data-text-scale="x-large"]`)에 같은 선언으로 더한다. 시안의 `max-width: 760px` 분기(안내·부제·크기 숨김)는 옮기지 않는다. 안내 줄과 부제는 숨기지 않고 줄바꿈한다.

| 부분 | 기본 | 좁은 레이아웃 |
|---|---|---|
| 레이어 | `overflow-y: auto`(안전망). 보통은 영상이 줄어 스크롤이 생기지 않는다. `VIDEO_MIN_H`에 닿은 뒤에만 스크롤된다 | `overflow-y: auto`, 영상 크기는 폭에서만(§6.2) |
| 머리 고정 | 두 레이아웃 모두 `position: sticky; top: 0`이라 [닫기]·[구간 적용하기]가 늘 보인다(Codex 시안 2 ①). 레이어에 `scroll-padding-top: <머리 높이>`(머리 ResizeObserver가 CSS 변수로 쓴다)를 둬 Tab으로 거꾸로 갈 때 포커스된 요소가 머리 밑에 가리지 않는다(WCAG 2.4.11) | 같다 |
| 머리 | h1·부제 왼쪽, 단추 둘 오른쪽 | 단추 둘이 h1 아래 줄로(`flex-wrap`), 부제는 두 줄까지 |
| 조작 줄 | 3칸 격자 `minmax(64px,1fr) auto minmax(64px,1fr)` | 첫 줄: 지금 시각 ↔ 전체 길이, 둘째 줄: 일곱 단추(`flex-wrap`, coarse 40이면 두 줄). `CONTROLS_MIN_W`를 쓰지 않는다 |
| 패널 머리 | 제목 · 안내 · 단추들 한 줄(안내는 넘치면 두 줄) | 제목 + 단추 한 줄, 안내 줄은 그 아래 |
| 시간 영역 이름 칸 | 64 | 0. 트랙 이름("영상"·"소리")은 숨긴다(트랙은 `aria-hidden` 장식이라 정보 손실이 없다) |
| 구간 줄 | 칸 둘 · 길이 · [구간 지우기] 한 줄 | 첫 줄: 라벨 "구간" + 칸 둘, 둘째 줄: 길이 줄 + [구간 지우기] |
| 가로 스크롤 | 0 | 0(WCAG 1.4.10, patterns §15 강제) |

## 7. 타임라인

### 7.1 좌표 변환(`rangeView.ts`, 순수)

| 함수 | 정의 | 경계 |
|---|---|---|
| `fullView(L)` | `{start: 0, span: L}` | `L ≤ 0`이거나 유한하지 않으면(`Infinity`·NaN) `{0, 0}` |
| `clampView(v, L, minSpan)` | `span ∈ [min(minSpan, L), L]`, `start ∈ [0, L − span]`. **`span ≥ L − SNAP_SECS`(0.5초)면 `span = L`, `start = 0`으로 맞춘다**(휠 배율 `exp`가 확대·축소를 정확히 상쇄하지 않아 `L − ε`가 남으면 범위 막대·[전체 보기]가 사라지지 않는다). 맞춤 폭은 `min(SNAP_SECS, (L − 하한)/2)`라 L이 20.5초 이하여도 확대가 막히지 않는다. 한계: 작은 L에서 휠 한 번의 확대량이 맞춤 폭보다 작으면 전체로 돌아간다(이벤트마다 맞추므로 누적되지 않는다) | NaN → `fullView`, 유한하지 않은 L → `{0, 0}` |
| `secsAtX(x, w, v)` | `v.start + clamp(x / w, 0, 1) × v.span`(내리지 않는다) | `w ≤ 0` → `v.start` |
| `xOfSecs(secs, w, v)` | `(secs − v.start) / v.span × w`(자르지 않는다) | `span = 0` → 0 |
| `placement(secs, v)` | `< start` → `'before'`, `> start + span` → `'after'`, 그 밖 `'inside'`(양 끝 포함) | — |
| `zoomed(v, L)` | `v.span < L` | — |

손잡이 값은 `Math.floor(secsAtX(...))`를 `clampHandle`에 넘겨 정수 초로 만든다(지금 규칙 그대로). 탐색(눈금·트랙 누름)은 내리지 않은 값을 `seek()`에 넘긴다.

### 7.2 확대·이동

| 함수 | 정의 |
|---|---|
| `zoomAt(v, factor, anchor, L, minSpan)` | `span' = clamp(v.span / factor, min(minSpan, L), L)`, `start' = anchor − (anchor − v.start) × span' / v.span`, 그 뒤 `clampView`. 성질: 범위 안에서 `anchor`의 화면 위치가 바뀌지 않는다(자르기가 걸리지 않을 때) |
| `panBy(v, dSecs, L)` | `start + dSecs`를 `[0, L − span]`로 자른다. 움직였는지 함께 돌려준다(`moved: boolean`, 휠 `preventDefault` 판단). 휠의 px는 `dSecs = px / trackW × span`으로 바꾼다(`trackW` = 트랙 칸 폭, §7.4). 마우스 한 칸 약 100px / 트랙 616~856px ≈ 보이는 범위의 12~16%(M-RE-2 통과 기준 10~30% 안) |
| `reveal(v, secs, L, margin = 0.1)` | `secs`가 `[start + margin·span, start + (1 − margin)·span]` 밖이면 그 가장자리 margin 자리에 오게 옮긴다. 안이면 그대로 |
| `follow(v, pos, L)` | `pos ∈ [start, start + span)`이면 그대로, 아니면 `start = pos − 0.1·span`(쪽 넘김). 전체 보기면 그대로 |

| 상수 | 값 | 이유 |
|---|---|---|
| `MIN_VIEW_SECS` | 20초 [잠정] | 트랙 칸 폭은 시안대로 창 폭 − 104라 960 창에서 856(1초 ≈ 43px), 720 창에서 616(≈ 31px)이다. 12px 손잡이로 1초를 맞출 수 있다 |
| `SNAP_SECS` | 0.5초 [잠정] | `clampView`가 거의 전체인 span을 전체로 맞추는 허용치 |
| 키 `+`·`-` 배율 | 2 [잠정] | |
| 휠 확대 배율 | `factor = exp(−dyPx × 0.002)`, 한 이벤트당 `[0.5, 2]`로 자름 [잠정] | 마우스 한 칸(약 100px) ≈ 1.22배. 트랙패드 연속 이벤트는 작게 쌓인다(M-RE-3) |
| 확대 중심 | 휠·핀치·눈금 두 번 누르기: 커서 x의 `secsAtX`. 키: 지금 위치선이 보이면 그 시각, 아니면 보이는 범위 가운데 | 사용자 결정 4 |
| 포인터 하나로 확대(WCAG 2.5.1) | 눈금 줄 `dblclick`(터치 두 번 누르기 포함) → 그 자리 중심 ×2. 축소·폭 조절은 범위 막대 엄지 가장자리 끌기(§7.5), 전체는 [전체 보기] | 핀치(다중 포인터)와 수식 키+휠만으로는 터치 전용 사용자가 확대할 수 없다. 패널 머리에 확대·축소 단추를 더하는 안은 사용자 결정 3(머리 구성)을 바꾸므로 버렸다. 범위 막대는 확대했을 때만 있으므로 전체 보기에서 처음 확대하는 단일 포인터 수단은 두 번 누르기 하나다. 결합 중이면 두 번 누르기가 그 자리로 한 번씩 두 번 탐색한 뒤 확대한다. 두 탐색이 같은 자리라 해가 없다 |

### 7.3 휠 처리 계약(`wheelIntent`, RE11)

```ts
wheelIntent(e: { deltaX; deltaY; deltaMode; ctrlKey; metaKey; shiftKey }, ctx: { mac: boolean; trackW: number })
  → { kind: 'zoom'; dyPx: number } | { kind: 'pan'; px: number } | null
```

1. 정규화: `deltaMode` 0(px)은 그대로, 1(줄)은 ×`LINE_PX` 16 [잠정], 2(쪽)는 ×`trackW`다.
2. 확대 판정: `ctrlKey || (mac && metaKey)`. Chromium 계열(WebView2)과 Chrome은 핀치를 `ctrlKey: true` 휠로 보낸다 [가정]. macOS WKWebView는 핀치를 `gesturechange`(WebKit 전용 `scale`)로 보낼 수 있다 [실측 필요: M-RE-1]. 그 경우 RE-4 범위 밖이고, M-RE-1 결과로 후속 PR에서 `gesture*`를 더한다(§16).
3. 이동 축: `|dx| ≥ |dy|`면 `dx`, 아니면 `dy`다(Shift+휠이 `deltaY`에 오든 `deltaX`로 바뀌어 오든 같은 값 하나). 대각선 트랙패드 움직임을 두 번 더하지 않는다. `0`이면 `null`이다.
4. 처리기(EditorTimeline):
   - `null` → 아무것도 하지 않는다(기본 동작 그대로).
   - 끌기 중 → `preventDefault`만 한다(RE13).
   - zoom: `L ≥ MIN_VIEW_SECS`이면 `preventDefault` 후 `zoomAt(view, factor(dyPx), secsAtX(cursorX))`를 하고 따라가기를 끈다. 상한·하한에 닿아 더 바뀌지 않아도 `preventDefault`는 한다(바깥 확대·스크롤로 새지 않게).
   - pan: `zoomed(view)`이고 `panBy`가 `moved`일 때만 `preventDefault`하고 따라가기를 끈다. 그 밖(전체 보기, 끝에 닿음)은 `preventDefault`하지 않는다(좁은 레이아웃의 세로 스크롤로 넘어간다).
5. 리스너는 시간 영역 요소에 `{ passive: false }`로 attach하고 떼어 낼 때 지운다. 구간 줄(칸)·패널 머리·모니터에는 달지 않는다.
6. 방향: `dy > 0`(아래로 굴림)은 나중 시각 쪽으로 이동이다. 트랙패드 자연 스크롤은 OS가 이미 뒤집어 보낸다 [가정: M-RE-2].

### 7.4 손잡이·끌기·누름

- **모양(D67)**: 손잡이는 눈금 줄 아래부터 소리 트랙 아래까지(높이 = 눈금 줄을 뺀 트랙 합 80)다. 보이는 폭은 `--timeline-handle-w` 12, 누름 폭은 `--hit-min`(24, coarse 40)이다. 누름 영역은 앵커에서 구간 바깥쪽으로만 편다(D65의 "붙은 손잡이가 겹치지 않음" 그대로). 면은 `--accent-ink`, 테두리 1px `--surface`, 손잡이 가운데 세로 그립 2px `--surface`다. 시작은 오른쪽이 열린 `[`, 끝은 왼쪽이 열린 `]` 모서리다.
- **값**: `role="slider"`, `aria-valuemin`·`aria-valuemax` = `handleBounds`(시작 `[0, end−1]`, 끝 `[start+1, floor(L)]`, 띠가 없으면 둘 다 `[0, floor(L)]`), `aria-valuenow` 정수 초, `aria-valuetext` = `formatClockLong`(화면 밖이면 `rangeEditor.offscreen.label`), `aria-controls` = 구간 줄 칸의 id 둘 중 같은 쪽 칸 [가정: 칸과 같은 값이라는 관계 표시. 보조기술이 무시해도 해가 없다].
- **좌표의 기준 요소**: 휠·끌기·누름·확대 중심의 x와 `w`는 모두 **트랙 칸 요소**(이름 칸을 뺀 시간 축, 범위 막대·눈금·트랙이 같은 칸을 쓴다)의 `getBoundingClientRect()`에서 잰다. 시간 영역 group의 rect를 쓰면 이름 칸 64px만큼 어긋나고, 좁은 레이아웃에서 이름 칸이 0이 되면 그 양이 바뀐다.
- **끌기**: `pointerdown`(왼쪽 단추) → 포커스 → 포인터 캡처 → 누른 점과 앵커의 px 차이를 기억한다(지금 `RangeTimeline` 방식 그대로). `pointermove` → `secsAtX(clientX − offset − trackRect.left, trackRect.width, view)` → 내림 → `clampHandle`(상대 손잡이) → 보이는 범위로 한 번 더 자른다(RE13) → 초안을 바꾼다(`phase: 'drag'`). 영상 탐색은 하지 않는다(PVU 그대로). `pointerup` → `commit`이고, `coupled`면 그 손잡이 시각으로 `seek`한다. `pointercancel`이면 마지막 값으로 `commit`한다. 움직이지 않은 누름은 아무것도 하지 않는다.
- **끌기 취소**: Esc → 누르기 전 초안(스냅샷)으로 되돌리고 캡처를 놓는다. `commit`도 탐색도 없다. Esc는 여기서 멈춘다(`stopPropagation`).
- **화면 밖(`pinned`, RE12)**: `placement`가 `before`면 시간 영역 왼쪽 가장자리, `after`면 오른쪽 가장자리에 폭 32·높이 64(같은 쪽이 둘이면 각 32)의 꼴로 그린다. 안에 `chevron-left`·`chevron-right`(아이콘 sm)를 둔다. 누르면(`pointerdown`) 끌기를 시작하지 않고 `reveal`만 한다. 키(←/→ 등)로 값이 바뀌면 바뀐 값으로 `reveal`한다.
- **눈금·트랙 누름**(손잡이 밖): `coupled`면 `seek(secsAtX(x))` 한 번이다. 포커스는 옮기지 않는다(시간 영역 `tabindex=-1`이 받는다). 결합 전에는 아무것도 하지 않는다. 끌어도 연속 탐색은 없다(스크러빙은 후속).
- **busy**: 카드가 받기 요청 중이면 편집 화면을 열 수 없으므로(RE5) 편집 화면 안에는 `disabled` 상태가 없다.

### 7.5 보이는 범위 막대(`role="scrollbar"`, 확대했을 때만)

| 속성 | 값 |
|---|---|
| 자리 | 시간 영역 맨 위 줄(24, `--hit-min`). 누름 높이 24(coarse 40) |
| `aria-controls` | 시간 영역 group의 id(눈금·트랙·손잡이를 품는다. Codex 시안 6 ⑩: 눈금 줄만 가리키지 않는다) |
| `aria-orientation` | `horizontal` |
| `aria-valuemin`·`max`·`now` | 0·100·`round(start / (L − span) × 100)`. `L − span = 0`이면 0(막대는 확대했을 때만 있으므로 보통 닿지 않는다. `clampView`의 `SNAP_SECS`와 함께 발산을 막는다) |
| `aria-valuetext` | `rangeEditor.viewport.value.label` "{from}부터 {to}까지" |
| 키 | ←/→ ∓10% span, Shift+←/→·PageUp/PageDown ∓1 span, Home/End 맨 앞·맨 뒤. 모두 `preventDefault`, 따라가기 끔 |
| 엄지 폭 | `thumbW = max(--hit-min, span / L × 막대 폭)`(24, coarse 40). 20초 창 / 10800초 / 막대 800px이면 비례 폭은 약 1.5px라 최소 폭이 없으면 엄지를 잡으려는 누름이 대부분 쪽 넘김이 된다 |
| 끌기 | 엄지 몸통을 끌면 `start = 엄지 왼쪽 x / (막대 폭 − thumbW) × (L − span)`(오프셋 유지). 막대의 엄지 밖을 누르면 그쪽으로 1 span 이동 |
| 엄지 가장자리 끌기 | 엄지 양 끝 8px(누름 영역은 바깥으로 편다)를 끌면 반대쪽 끝을 고정하고 span을 바꾼다(`clampView`의 상하한 그대로). 포인터 하나로 하는 확대·축소(WCAG 2.5.1, §7.2). 키보드 대안은 `+`·`-`다 |
| 모양 | 바탕 줄 `--track` 4px, 그 위 구간 위치 `--accent-ink` 4px(위치 참고), 엄지 `--fg` 1.5px 테두리 상자(높이 12, 반경 `--radius-badge`) |

### 7.6 눈금(`ticks(view, w)`)

- 간격은 `NICE = [1, 2, 5, 10, 15, 30초, 1, 2, 5, 10, 15, 30분, 1, 2시간]` 중 한 칸의 px이 `TICK_MIN_PX` 80 [잠정] 이상인 가장 작은 값이다(`formatClock` 7자 12px 고정폭 ≈ 56 + 여백). 목록을 다 써도 모자라면(예: 43200초를 약 300px에) 2시간의 정수배 중 80px 이상인 가장 작은 값을 쓴다(43200초·300px → 4시간 ≈ 100px).
- 첫 눈금은 `ceil(start / step) × step`이다. 글자는 `formatClock`(`--text-caption`, 고정폭, `--fg-muted`), 선은 1px `--border-strong`이다.
- 표 테스트: 5400초·전체·860px → 10분 간격(600초 ≈ 95px ≥ 80, 5분은 47px라 모자란다. RE-1에서 앞 문구 "30분"을 식에 맞게 고쳤다). 20초 창 → 2초 또는 5초. 320 폭 → 간격이 넓어진다.

### 7.7 지금 위치선과 따라가기

- 선: `--fg` 2px, 눈금 줄 위 머리 12×10(반경 아래쪽만). 시간 영역 전체 높이다. 흐림·띠보다 위, 손잡이보다 아래에 그린다. `coupled`일 때만 있다. 보이는 범위 밖이면 그리지 않는다.
- 따라가기 `following`(처음 `true`)
  - 끈다: 휠 이동·확대, 범위 막대 조작, `+`·`-`.
  - 켠다: 보기가 시작될 때(`<video>`의 `play` 이벤트 한 곳. 조작 줄 단추·Space·네이티브 controls·`play()` 시도 어느 경로든 같다, §8.2), [전체 보기]·`0`, [구간 처음으로]·[구간 끝으로]·[N초 뒤로/앞으로](그 뒤 한 번 `reveal`).
  - 켜져 있고 확대돼 있으며 보는 중일 때만, `timeupdate`·`seeked`마다 `follow`를 적용한다.
- 손잡이 끌기 중에는 따라가기를 적용하지 않는다(RE13 범위 고정).

### 7.8 시각 규칙(토큰)

| 요소 | 라이트·다크 공통 토큰 | 대비 확인(`design/tokens/contrast.tokens.json`에 쌍을 더한다) |
|---|---|---|
| 영상 트랙 면 | `--surface-pressed` | 3:1 쌍 `accent-ink / surface-pressed` |
| 소리 트랙 면 | `--surface-2` | `accent-ink / surface-2` |
| 패널 바탕 | `--surface` | `accent-ink / surface`(이미 텍스트 쌍) |
| 구간 띠(위·아래 2px)·손잡이 면 | `--accent-ink`(D65의 `--accent`가 아니다: 다크 `--accent` #1E72E4는 회색 트랙 위 3:1 미달, Codex 시안 6 ⑧) | 위 셋 |
| 손잡이 테두리·그립 | `--surface` | `surface / accent-ink` 3:1 |
| 구간 밖 흐림 | 새 토큰 `--range-dim`(라이트 흰색 α 0.6, 다크 검정 α 0.45) [잠정]. **트랙 줄(영상·소리)에만 그리고 눈금 줄·범위 막대 줄은 덮지 않는다**(시안은 `top: 0`부터 덮지만, 그러면 라이트 `--fg-muted` 눈금 글자가 흰 패널 위 약 1.8:1, 다크 약 2:1로 떨어진다) | 띠는 구간 안쪽이라 흐림 위에 놓이지 않는다. **보이는 12px 손잡이는 시안대로 띠 바깥(흐림 위)에 놓으므로** 쌍 `accent-ink / (surface-pressed + range-dim)`·`accent-ink / (surface-2 + range-dim)` 3:1을 더한다(합성 색은 생성기가 계산) |
| 지금 위치선 | `--fg` | `fg / accent-ink`·`fg / surface-pressed`·`fg / range-dim 위 트랙` |
| 눈금 글자·이름 칸 | `--fg-muted`, `--text-caption` 12(최소 12, foundations §3) | 기존 쌍. foundations §3의 "12px `--fg-muted` 단독 금지" 허용 목록에 "타임라인 눈금·트랙 이름(보조: 시각은 손잡이 `aria-valuetext`·칸·조작 줄 시각이, 트랙 이름은 장식이 말한다)"을 근거와 함께 더한다(RE-4) |
| 반복 토글 켜짐 | 면 `--surface-2`, 글자·아이콘 `--fg`, 테두리 1px `--border-strong`(색이 아닌 둘째 단서, RE20) | 기존 IconButton `aria-pressed` 행 + `border-strong / surface` |

**forced-colors**: 트랙은 `Canvas` + 1px `CanvasText` 테두리, 흐림은 그리지 않는다(`background` 무시). 띠·손잡이·범위 막대 구간 위치는 `Highlight`, 손잡이 테두리는 `CanvasText`, 지금 위치선·범위 막대 엄지는 `CanvasText`다. 화면 밖 손잡이는 `Highlight` 면이고 안의 chevron은 `HighlightText`다(`currentColor`를 그대로 두면 Highlight 면 위에서 대비를 잃는다). 반복 토글 켜짐은 **`Highlight` 면 + `HighlightText` 글자·아이콘**이다(2px `Highlight` 윤곽은 포커스 outline과 모양이 같아 구별되지 않는다. 라디오 선택 행의 1px 선례, components.md 부록 5). 지금 RangeTimeline forced 규칙(`RangeTimeline.svelte:245-269`)의 연장이다 [확인]. foundations §2.7 표의 `RangeTimeline` 행은 RE-4에서 편집 화면 행(타임라인·화면 밖 손잡이·반복 토글·조작 줄)으로 바꾼다(R9).

## 8. 조작 줄과 영상 동작

### 8.1 단추 표(`coupled`일 때만 켜진다. 그 밖에는 `disabled`)

| 순서 | 이름(`aria-label` = 툴팁) | 아이콘 개념 | 키 | 동작 |
|---|---|---|---|---|
| 1 | 시작 찍기 | 왼쪽 표시(In) | I | 초안 시작 = `floor(currentTime)`(`mark`, 자르지 않음). 오류 지움 |
| 2 | 구간 처음으로 가기 | 막대+왼쪽 삼각(처음으로) | — | `ownSeek(sel.start)`. 보던 상태 유지. 반복이 켜져 있고 보는 중이면 반복 모드 |
| 3 | {n}초 뒤로 가기 | 이중 왼쪽 삼각 | ← | `seek(t − n)`, `[0, duration]`로 자름. 반복 모드는 끈다(§8.2) |
| 4 | 영상 보기 ↔ 일시정지 | `play` ↔ `pause` | Space | 멈춰 있으면 §8.2 "보기 시작", 보는 중이면 `pause()` |
| 5 | {n}초 앞으로 가기 | 이중 오른쪽 삼각 | → | `seek(t + n)` |
| 6 | 구간 끝으로 가기 | 오른쪽 삼각+막대 | — | 보는 중이면 일시정지(`pausedByUs`) 뒤 `ownSeek(sel.end)`. 끝이 "끝까지"면 `floor(L)` |
| 7 | 끝 찍기 | 오른쪽 표시(Out) | O | 초안 끝 = `floor(currentTime)` |

- `n = SEEK_STEP_SECS = 5`(코드 상수, 문구는 `{n}`. content W5)다.
- 왼쪽 칸은 지금 시각 `formatClock(position)`(고정폭 600, `--accent-ink`)이다. 결합 전에는 비운다. 오른쪽 칸은 전체 길이 `formatClock(L)`(`--fg-muted`)이고, 길이를 모르면 비운다. 둘 다 `aria-hidden` 글자와 숨은 글자(`rangeEditor.now.label`·`range.wholeLength.label`)의 짝이다. 값이 바뀔 때마다 읽지 않게 `aria-live`는 없다.
- 단추가 `disabled`인 동안에는 포커스가 닿지 않는다. 그래서 결합 전 머리 다음 Tab 순서는 [영상 보기](표지 자리) → 타임라인이다.

### 8.2 보기·반복 규칙(`rangeEdit.playStep`을 좁힌다)

| 상황 | 반복 꺼짐 | 반복 켜짐 |
|---|---|---|
| 보기 시작(`play` 이벤트: 조작 줄 단추·Space·네이티브 controls·[영상 보기] 뒤 `play()` 시도) | 지금 자리부터 본다. 구간 끝에서 멈추지 않는다 | 지금 자리가 `[start, end)` 밖이면 `ownSeek(start)` 뒤 본다. 모드 `loop` |
| 보는 중 `t ≥ end` | 계속 본다 | `ownSeek(start)`(restart) |
| 영상 끝(`ended`) | 멈춤 | 끝이 "끝까지"면 `ownSeek(start)` + `play()`, 아니면(이미 restart했어야 한다) 멈춤 |
| 사용자 탐색(손잡이 commit·트랙 누름·N초)으로 구간 밖 | — | 모드 `off`(그 자리에서 계속 보고 반복하지 않는다). 토글은 켜진 채이고 다음 "보기 시작"에서 다시 건다 |
| 구간 처음으로·구간 끝으로(`byUs`) | — | 처음으로는 모드 유지, 끝으로는 일시정지라 모드 `off` |
| 보는 중 토글 켬 | — | `t ∈ [start, end)`면 모드 `loop`. 구간 앞이면 구간에 들어가 반복한다. 구간 뒤면 다음 `timeupdate`가 `start`로 되돌린다 |
| 보는 중 토글 끔 | 모드 `off` | — |
| 사용자 일시정지(네이티브·Space) | — | 모드 `off`(다시 보면 "보기 시작" 규칙) |
| 찍기·칸으로 구간이 바뀜 | — | 새 `sel`로 판단한다(`stepSel`이 매번 다시 읽는다) |

- **"보기 시작"은 `<video>`의 `play` 이벤트 한 곳에서 판단한다.** 지금 코드에는 `onplay`가 없고(`WatchPanel.svelte:536-545`는 timeupdate·seeked·pause·ended뿐) 반복·따라가기가 조작 경로에만 걸려 있어, 네이티브 controls(RE9가 유지한다)로 보기를 시작하면 반복 토글이 켜져 보여도 구간 끝을 지나간다 [확인]. 조작 줄 단추와 Space는 `play()`만 부르고 규칙을 따로 갖지 않는다. 우리가 부른 `play()`인지는 `playByUs` 표식(다음 `play` 이벤트에서 소비, `ownSeek`의 `consumeOwnSeek`와 같은 방식)으로 구분한다. 규칙이 경로에 따라 달라지지 않으므로 표식은 기록·시험용이다. 따라가기 켜기(§7.7)도 같은 처리기에서 한다.

`playStep`의 `'range'` 분기(구간 끝에서 일시정지)와 `playRange`·`playFromStart`는 지운다(RE21). 표는 `rangeEdit.test.ts`의 표 테스트로 고정한다(RE-5).

## 9. 키보드

### 9.1 우선순위 표

편집 화면의 keydown은 하나의 처리기(레이어 뿌리, `tabindex=-1`)가 받고, 첫 줄에서 `isImeKey`를 거른다. 키가 뿌리를 지나려면 포커스가 레이어 안에 있어야 한다. 그래서 포커스가 `body`로 떨어지지 않게 한다: 결합이 풀려 조작 줄 단추가 `disabled`가 될 때 포커스가 그 줄에 있었으면 h1로 옮기고(`failed`로 갈 때 영상에 포커스가 없던 경우 포함), 뿌리는 `tabindex=-1`이라 빈 곳을 누르면 뿌리가 포커스를 받는다. 그래도 `body`에 떨어진 Esc·Mod+Enter는 RE16의 사다리 처리기와 RE15의 깃발이 받는다. 손잡이·범위 막대·칸은 자기 처리기가 먼저 받고, 처리했으면 `preventDefault`한다. 뿌리 처리기는 `defaultPrevented`이면 건너뛴다. "결합"은 `coupled`이다. 결합이 아니면 그 칸의 영상 동작은 하지 않고 `preventDefault`도 하지 않는다(손잡이·막대·칸 동작은 결합과 무관하다).

| 키 | 손잡이(slider) | 시각 칸(input) | 영상(`<video>`) | 단추(조작 줄·머리·패널 머리·[구간 지우기]·[영상 보기]) | 반복 토글 | 시간 영역 빈 곳·뿌리 | 범위 막대(scrollbar) |
|---|---|---|---|---|---|---|---|
| ←/→ | 값 ∓1(`handleKey`), 화면 밖이면 `reveal` | 캐럿(기본) | 네이티브 | 결합: ∓5초 탐색 | 결합: ∓5초 | 결합: ∓5초 | 보이는 범위 ∓10% |
| Shift+←/→ | 값 ∓10 | 선택(기본) | 네이티브 | 없음 | 없음 | 없음 | ∓1 span |
| ↑/↓ | 값 ±1 | ±1초(`nudge`, PS1~PS3), 늘 `preventDefault` | 네이티브 | 없음 | 없음 | 없음 | 없음 |
| PageUp/PageDown | 값 ±60 | 기본 | 네이티브 | 없음 | 없음 | 없음 | ∓1 span |
| Home/End | 경계 min/max | 캐럿(기본) | 네이티브 | 없음 | 없음 | 없음 | 맨 앞·맨 뒤 |
| Space | 결합: 보기/일시정지 | 글자(기본) | 네이티브 | 단추 누름(기본) | 토글(기본) | 결합: 보기/일시정지 | 결합: 보기/일시정지 |
| Enter | 없음 | **없음**(DX6) | 네이티브 | 누름(기본) | 토글(기본) | 없음 | 없음 |
| I / O(수식 키 없음) | 결합: 찍기 | 글자(기본) | 결합: 찍기 | 결합: 찍기 | 결합: 찍기 | 결합: 찍기 | 결합: 찍기 |
| `+`·`=` / `-`·`_` / `0`(`e.key`, Shift 허용) | 확대/축소/전체(시간 영역이 있을 때) | 글자(기본) | 같다(네이티브는 쓰지 않는다 [가정]) | 같다 | 같다 | 같다 | 같다 |
| Mod+Enter | [구간 적용하기], 성공·실패와 관계없이 `preventDefault` + `stopPropagation`(RE15) | 같다 | 같다 | 같다 | 같다 | 같다 | 같다 |
| Esc | `e.repeat`면 거름만, 끌기 중이면 취소, 아니면 편집 화면 닫기 | 편집 화면 닫기 | 전체 화면이면 웹뷰 몫(`stopPropagation`만), 아니면 닫기 | 닫기 | 닫기 | 닫기 | 닫기 |
| Tab / Shift+Tab | 화면 안에서 돈다(`trapTab`) | 같다 | 같다 | 같다 | 같다 | 같다 | 같다 |
| Alt·Ctrl·Meta + 위 키 | 처리하지 않는다(창·OS 몫). Mod+Enter만 예외 | 같다(Mod+화살표는 칸 기본 편집) | 같다 | 같다 | 같다 | 같다 | 같다 |
| IME 조합 중 아무 키 | 처리하지 않는다 | 같다 | — | — | — | — | — |

- **I/O 수신 범위를 넓힌다(의도한 변경)**: 지금은 단추 중 `aria-keyshortcuts`가 달린 찍기 단추만 I/O를 받는다(`WatchPanel.svelte:451-455`) [확인]. 편집 화면에서는 표대로 모든 단추에서 찍는다. 옛 제한은 카드 안 섹션에서 카드의 다른 단추(받기 등)와 키를 나누려던 것이고, 편집 화면은 창 전체가 편집 영역이라 막을 까닭이 없다. 칸에서만 글자다.
- **I/O는 지금처럼 `e.code`(`KeyI`·`KeyO`)로 판정한다**(`WatchPanel.svelte:451`) [확인]. 한글 입력 상태에서는 `e.key`가 'ㅑ'·'ㅐ'가 되어 `e.key`로는 찍기가 동작하지 않는다. 반대로 `+`·`-`·`0`은 `e.key`로 판정한다. 자판마다 물리 위치가 달라 `e.code`로는 `+`를 알 수 없다(한글 입력 상태에서도 기호·숫자는 `e.key`가 그대로다 [가정: M-RE-2 때 함께 확인]). `isImeKey`는 `isComposing`뿐 아니라 `keyCode === 229`도 거른다(`ui/focus.ts:18-20`) [확인]. 한글 입력 상태의 비편집 요소에서 웹뷰가 229를 보내면 I/O·Space·`+`·`0`이 모두 막히므로 M-RE-2 통과 기준에 넣는다.
- `+`는 대부분 자판에서 Shift가 같이 눌린다. 그래서 확대 키는 "Alt·Ctrl·Meta가 없음"만 보고 Shift는 막지 않는다. 판정은 `e.key`(`'+'`·`'='`, `'-'`·`'_'`, `'0'`)로 하고, 숫자 패드 `+`·`-`·`0`도 같다. Ctrl/⌘ + `+`·`-`·`0`은 처리하지 않는다(웹뷰 확대 단축키는 꺼져 있다, `zoomHotkeysEnabled: false`) [확인].
- 끌기 중에는 I/O·`+`·`-`·`0`·Space·←/→를 처리하지 않는다(RE13). Esc만 받는다.
- 반복 keydown(`e.repeat`)
  - 손잡이 값과 칸 ±1은 누를 때마다 바뀐다. 칸의 영상 탐색은 뗄 때 한 번이다(PS2 그대로).
  - ←/→ 5초 탐색은 반복마다 한다(`seek` 하나씩, 키 반복 속도에 묶인다).
  - I/O는 반복을 무시한다. Esc 반복은 편집 화면 뿌리·사다리 처리기·Dialog·창 처리기 모두 아무것도 닫지 않는다(RE16).
- 칸 blur 탐색(PVU10)의 예외 대상은 그대로다: `relatedTarget`이 시간 영역 group(`tabindex=-1`)이거나 손잡이면 탐색하지 않는다. `[data-local-keys]` 대신 시간 영역 group의 `data-timeline`으로 판정한다.

### 9.2 창 수준 처리기와의 관계(RE15·RE16)

| 처리기 | 편집 화면이 열린 동안 |
|---|---|
| GlobalShortcuts Esc → `ui.escape()`(카드 닫기 등) | 편집 화면이 `stopPropagation`해 닿지 않는다(전체 화면 해제 단계 포함). 포커스가 `body`라 뿌리를 지나지 않으면 `ui.escape()`가 사다리 맨 안쪽의 편집 화면 처리기를 먼저 부르고, 그 처리기는 끌기 취소·전체 화면일 때도 `true`를 돌려준다(카드까지 내려가지 않는다). `e.repeat` Esc는 늘 무시한다(공통) |
| GlobalShortcuts Mod+L·Mod+, | 무시 |
| GlobalShortcuts 입력칸 밖 붙여넣기 | 무시 |
| ResolveCard 창 Mod+Enter → `download()` | 무시. 뿌리 처리기가 [구간 적용하기]로 받고 늘 `preventDefault`하므로 `defaultPrevented`가 주 근거, 깃발이 둘째다(RE15) |
| InputPanel DropOverlay 드롭 → 불러오기 | 무시 |
| macOS 메뉴 "설정…"·"…에 관하여" | 무시(`App.svelte:74-75`) [확인] |
| 대화상자(CloseGuard 등) | 위에 뜬다(§6.1). 자기 Esc를 먼저 받는다 |

## 10. 접근성

- **레이어**: `role="dialog" aria-modal="true" aria-labelledby=<h1 id>`. 열리면 포커스는 h1(`tabindex=-1`, `data-focus-container`, 링 없음, F-5). 닫히면 [구간 편집…](연 단추)이다. 연 단추가 사라졌으면(카드가 바뀜) `ui.urlTarget.focus()`, 그것도 없으면 그대로다.
- **[구간 편집…]**: 보이는 글자 "구간 편집…". 다른 화면을 여는 단추라 말줄임표가 붙는다(content §5.2·§6.3). `design-copy` DC5는 `…` 앞 글자가 `terms.json` `opensWindow`에 있을 때만 통과시키므로(`scripts/design/copy.mjs` DC5, `design/copy/terms.json:912`) RE-3에서 `opensWindow`에 "구간 편집"을 더한다 [확인].
- **조작 줄**: `role="group"`, 이름 `rangeEditor.controls.label`. 단추마다 `aria-label` = `title`(+단축키 `{label}({key})`, `aria-keyshortcuts` `I`·`O`·`Space`·`ArrowLeft`·`ArrowRight`). 보기/일시정지는 이름이 바뀌는 단추다(`aria-pressed`를 쓰지 않는다: 이름이 상태를 말한다).
- **반복 토글**: `Button` + `aria-pressed`. 이름 "구간 반복하기"는 상태와 무관하다.
- **손잡이**: §7.4. 대상 크기는 누름 24×80(coarse 40)이다. 붙은 두 손잡이는 바깥쪽으로만 편 누름 영역이라 겹치지 않는다. 화면 밖 꼴은 32×64(같은 쪽 둘이면 32×32)다.
- **범위 막대**: §7.5. 누름 높이 24(coarse 40)다.
- **시간 영역**: `role="group"`, 이름 `rangeEditor.timeline.title`, `aria-describedby` = 안내 줄(휠·확대 방법과 키 안내 `rangeEditor.timeline.keys`), `aria-keyshortcuts`로 `+`·`-`·`0`을 단다(값의 철자, 예: `Plus Minus 0` 또는 `+ - 0`은 [가정: RE-4의 axe·ARIA 검사로 정한다]), `tabindex=-1`(누르면 포커스를 받아 키를 받는다). 눈금·트랙·흐림·띠·지금 위치선은 `aria-hidden`이다.
- **구간 줄**: `role="group"`, 이름 `range.label`. 칸 이름 `range.start`·`range.end`, placeholder `range.fromBegin`·`range.toEnd`, `aria-keyshortcuts="ArrowUp ArrowDown"`. 오류는 `aria-invalid` + `aria-describedby`(오류 Notice) + 포커스(+IME 조합이 아니면 전체 선택)다.
- **알림**: 화면 안 오류는 Notice `role=alert` 하나다. 적용 성공은 레이어가 떨어진 뒤 announcer로 `range.applied.body`(전체이면 `range.appliedWhole.body`)를, 카드 [구간 지우기]는 `range.cleared.body`를 한 번 알린다. 바뀐 것이 없는 적용은 알리지 않는다.
- **대상 크기**: 모든 단추는 IconButton md 28·Button sm/md(coarse 40)다. 손잡이·범위 막대는 위와 같다. `design-gallery`의 target-size 검사를 편집 화면 장면에 건다.
- **forced-colors**: §7.8.
- **움직임 줄이기**: 따라가기 쪽 넘김·`reveal`은 애니메이션 없이 바로 옮긴다(전환 없음).
- **아이콘 등록**: §12.3. 아이콘은 모두 `Icon`을 거친다(`<svg` 직접 금지, DI). 장식이라 `aria-hidden`이다.

## 11. 문구(copy deck `ko.ts`, `content.md` §15에 같은 행)

| 키 | 문구 | PR | 쓰는 곳·규칙 |
|---|---|---|---|
| `range.edit.label` | 구간 편집… | RE-3 | 카드 진입 단추. 다른 화면을 여는 단추라 말줄임(content §5.2). "편집"을 굳은 한자어 허용 목록에 더한다(§12) |
| `range.clear.label` | 구간 지우기 | RE-3 | 카드(확정값)와 편집 화면(초안)이 같은 키를 쓴다. 대상을 밝힌 "지우기"(content §5.1) |
| `range.summary.label` | {range} · 길이 {length} | RE-3 | 카드 구간 줄 값. 라벨 "구간"은 FieldRow가 단다. `{range}`는 `range.chip` 결과 |
| `range.summaryWhole.label` | 전체 | RE-3 | 확정값이 없을 때 |
| `range.applied.body` | 받을 구간을 정했어요. | RE-3 | announcer, 적용 성공 |
| `range.appliedWhole.body` | 영상 전체를 받아요. | RE-3 | announcer, 적용 결과가 전체 |
| `range.cleared.body` | 구간을 지웠어요. 영상 전체를 받아요. | RE-3 | announcer, 카드 [구간 지우기] |
| `rangeEditor.title` | 구간 편집 | RE-3 | h1 |
| `rangeEditor.context.label` | {kind} · {title} | RE-3 | 부제. `{kind}` = `kindLabel('rewind')` |
| `rangeEditor.apply.label` | 구간 적용하기 | RE-3 | primary, kbd `submit` 힌트 |
| `rangeEditor.timeline.title` | 타임라인 | RE-3 | 패널 제목, 시간 영역 이름 |
| `rangeEditor.timeline.help` | 휠로 앞뒤로 움직이고 {mod}+휠로 확대해요. | RE-4 | 안내 줄 첫 문장. `{mod}` = `shortcutText(os, 'zoomMod')`(DC9: 기호를 deck에 박지 않는다). 둘째 문장은 기존 `range.help`("앞뒤로 몇 초 더 받을 수 있어요.")를 따로 붙인다(조각 결합이 아니라 두 문장) |
| `rangeEditor.timeline.keys` | {zoomIn}·{zoomOut} 키나 눈금 두 번 누르기로 확대·축소하고 {fit} 키로 전체를 봐요. | RE-4 | 안내 줄 셋째 문장(확대 키를 찾을 길). 키 글자는 `EDITOR_KEYS` 상수를 자리표시로 넣는다(DC9). 좁은 레이아웃에서도 숨기지 않는다 |
| `rangeEditor.uncoupled.body` | 이 영상은 타임라인과 칸으로만 구간을 고를 수 있어요. | RE-3 | 네이티브 m3u8 대체 경로 안내(안내 줄 자리). W1: 화면의 이름은 "타임라인"이고 "막대"는 쓰지 않는다 |
| `rangeEditor.noLength.body` | 영상 길이를 몰라 타임라인을 그릴 수 없어요. 영상을 보면 타임라인이 나와요. | RE-3 | meta 길이 없음 + 결합 전 |
| `rangeEditor.track.video.label` | 영상 | RE-4 | 이름 칸 |
| `rangeEditor.track.audio.label` | 소리 | RE-4 | 이름 칸 |
| `rangeEditor.fit.label` | 전체 보기 | RE-4 | 아이콘 단추 이름·툴팁(`0`) |
| `rangeEditor.viewport.label` | 보이는 범위 | RE-4 | 범위 막대 이름 |
| `rangeEditor.viewport.value.label` | {from}부터 {to}까지 | RE-4 | 범위 막대 `aria-valuetext` |
| `rangeEditor.offscreen.label` | {time} · 보이는 범위 밖 | RE-4 | 화면 밖 손잡이 `aria-valuetext` |
| `rangeEditor.controls.label` | 영상 조작 | RE-5 | 조작 줄 group 이름 |
| `rangeEditor.toStart.label` | 구간 처음으로 가기 | RE-5 | 아이콘 단추. 기본형 "-기"(시안 "구간 처음으로"를 고침) |
| `rangeEditor.toEnd.label` | 구간 끝으로 가기 | RE-5 | 같다 |
| `rangeEditor.back.label` | {n}초 뒤로 가기 | RE-5 | 숫자는 `{n}`(content W5) |
| `rangeEditor.forward.label` | {n}초 앞으로 가기 | RE-5 | 같다 |
| `rangeEditor.now.label` | 지금 위치: {time} | RE-5 | 숨은 글자(왼쪽 칸) |
| `shortcut.hint.label` | {label}({key}) | RE-4 | 단축키 툴팁. 괄호는 앞말에 붙인다(content §6.5). [전체 보기] 툴팁 "전체 보기(0)"가 먼저 쓰므로 RE-4로 당겼다 |
| `watch.toggle.range` | (지움) | RE-3 | 섹션이 없어진다 |
| `watch.editor.a11y` | (지움) | RE-3 | 편집 영역 group 이름. 편집 화면에서는 dialog·group 이름이 대신한다 |
| `watch.range.play.label`·`watch.range.fromStart.label` | (지움) | RE-5 | RE21 |

- **그대로 쓰는 키**: `common.close`(닫기), `watch.start.label`·`watch.start.a11y`(영상 보기), `action.pause`(일시정지), `watch.mark.start`·`watch.mark.end`(시작 찍기·끝 찍기), `watch.range.loop.label`(구간 반복하기), `watch.player.a11y`, `watch.error.body`, `watch.openInChzzk.label`, `action.retry`, `range.label`·`range.start`·`range.end`·`range.fromBegin`·`range.toEnd`·`range.help`, `range.length*`·`range.wholeLength*`·`range.whole.label`, `range.error.*`, `range.chip`·`range.chipToEnd`.
- **플랫폼 표**(RE-4, 안내 줄이 먼저 쓴다): `platform.mac.zoomMod` "⌘", `platform.other.zoomMod` "Ctrl"(`platform.ts` `SHORTCUT`에 `zoomMod`). 단축키 글자 I·O·Space·←·→·`+`·`-`·0은 OS와 무관한 코드 상수다(`platform.ts` `EDITOR_KEYS`, RE-4에 `+`·`-`·`0`, RE-5에 나머지. DC9는 deck 문자열만 본다 [가정: RE-4에서 `design-copy`로 확인]).
- **금지어**: "재생"·"재생기"는 문구 전체에서 금지다(DC1. copy deck·`help/*.md`·`patterns.md`·`web.md`). 이 명세의 "지금 위치선"·"보기"는 그 대체어다. patterns·components 문서에 행을 더할 때도 "재생 위치"라고 쓰지 않는다(이 기능 문서는 DC1 범위 밖이지만 같은 말을 쓴다).
- **확인할 것(gate)**: DC11(같은 값 금지): "구간 편집"과 "구간 편집…"은 다른 값이다. "전체"·"영상"·"소리"·"타임라인"·"보이는 범위"·"전체 보기"는 지금 deck에 단독 값이 없다 [확인: `ko.ts` grep]. DC12: `.a11y` 키를 새로 만들지 않는다(아이콘 단추 이름은 `.label`).
- **용어집**: 새 행 "타임라인"(쓰지 않는 말: 타임 라인, 시간 막대, 막대), "구간 편집"(쓰지 않는 말: 트리밍, 자르기·잘라내기: 파일을 자르는 것으로 읽힌다)을 더한다. DC10 짝은 두 곳(content §4·`terms.json`) 함께다.

## 12. 디자인 시스템 변경

### 12.1 결정·ADR

- **D67 구간 편집 화면**(README §5 G 표, RE-3에서 쓴다): 빠른 다시보기 구간은 창 전체 편집 화면에서 고르고 카드에는 구간 줄 하나만 둔다.
  - 레이어·상태 셋·적용 검증·닫기 = 초안 버림·Esc 순서·결합 조건(D66 PS12 그대로)·네이티브 controls 유지·조작 줄 group·반복 토글 중립 눌림 면.
  - 타임라인: 눈금·단색 트랙·흐림·띠·`--accent-ink` 손잡이·`--fg` 지금 위치선·확대·이동·범위 막대·화면 밖 손잡이.
  - 아이콘 단추 허용 목록 확장, 굳은 한자어 "편집", 반복 토글 켜짐의 둘째 단서(`--border-strong` 테두리, RE20), 포인터 하나로 하는 확대(눈금 두 번 누르기·범위 막대 엄지 가장자리, WCAG 2.5.1).
  - **ADR-0005(대화상자 버튼 배치)의 범위 밖이다**: 편집 화면은 `role="dialog"`이지만 확인·선택을 묻는 대화상자가 아니라 창 전체 시트형 편집기다. 그래서 오른쪽 끝 primary가 "현 상태 유지"가 아니라 상태를 바꾸는 [구간 적용하기]이고, [닫기]가 단독 라벨이다(ADR-0005 `adr/0005-dialog-button-placement.md` 결정 표의 오른쪽 끝·라벨 행과 다르다). 근거는 사용자 결정 1(2026-10-22)이고, 안전은 "닫기 = 초안만 버림, 확정값 그대로"(RE2·RE17)로 지킨다. ADR-0005 본문은 고치지 않는다.
  - 근거 표에는 사람 결정을 등급 없이 `결정자: 사용자, 2026-10-22`로 적고(`governance.md:336` "등급은 쓰지 않는다"), 나머지 근거는 E1이라 상태는 `채택(잠정)`이다.
  - **적용 단계를 밝힌다**: RE-3 셸·상태·진입(막대는 옛 막대, 조작 줄은 옛 글자 단추) / RE-4 타임라인 / RE-5 조작 줄·키(D66이 PS-2·PS-3을 나눠 적은 선례).
  - D66 행 끝에 "→ 빠른 다시보기는 D67로 바뀜(2026-10-22). 일반 VOD·클립 섹션은 그대로"를, D65 행 끝에(RE-4) "→ D67로 바뀜"을 적는다.
- **ADR-0030 `adr/0030-range-editor-screen.md`**(RE-3)
  - 맥락: 사용자가 카드 안 섹션을 써 본 뒤 "별로", Source Monitor식 요구. 시안 1~7, Codex 리뷰 두 건.
  - 결정: RE1~RE21. ADR-0029에서 이어지는 결정(일반 VOD·클립 섹션: 기본 펼침·앱 메모리 기억·표지 자리·누를 때 세션·실패 한 Notice·16:9·`--watch-max-h`·소유 판정·생방송 제외)을 다시 적는다.
  - 근거 표, 결과(카드 높이 약 1000 → 약 546, §12.4).
  - ADR-0005 예외(위 D67 항목)와 그 근거를 결정 절에 적는다.
  - 대안과 버린 이유(표): `ui.view` 새 뷰, 대화상자 `Dialog` 재사용(버튼 줄 규칙·크기 제한이 맞지 않는다. 버튼 줄 규칙 = ADR-0005, 위 예외), 패널 머리 확대·축소 아이콘 단추(사용자 결정 3의 머리 구성을 바꾼다 → 눈금 두 번 누르기·엄지 가장자리 끌기), 열 때 곧바로 세션, 닫기 확인 대화상자, 자체 조작부로 controls 대체, 가장자리 자동 이동, toolbar 역할, 원형 보기 단추.
  - 재검증 조건: M-RE-1~9.
- **ADR 상태 줄**: ADR-0029 → `폐기(→ 0030)`(RE-3), ADR-0028 → `폐기(→ 0030)`(RE-4). 본문은 고치지 않는다(`governance.md:336`, `adr.test.mjs:12`) [확인].
- `spec-check.mjs:95` 상한 66 → 67(RE-3), 테스트 함께.

### 12.2 components.md

- §2.29 WatchPanel: 빠른 다시보기·구간 props 제거, "일반 VOD·클립 전용"(RE-3).
- §2.30 RangeTimeline: 삭제 표시(RE-4) → 새 항목 **RangeEditor**(RE-3: 해부·상태 표 `idle`…`failed`·props `view`·`applied`·`quality`·`onapply`·`onclose`. 영상 상자는 `--watch-max-h`를 쓰지 않고 `monitorSize`를 따른다), **EditorTimeline**(RE-4: 해부·`view`·손잡이 꼴 셋(보통·화면 밖·같은 쪽 둘)·범위 막대·forced), **RangeSummary**(RE-3).
- §2.2 IconButton: `hint` prop(툴팁 덮어쓰기, 이름과 다른 `title`은 설명으로 계산된다는 점), 허용 목록 참조(RE-4: [전체 보기]가 먼저 쓴다).
- §2.1 Button: `aria-pressed` 행(중립 눌림 면 + 1px `--border-strong` 테두리, forced는 `Highlight` 면 + `HighlightText`)(RE-5).
- 공용 `modalLayer`(RE-3): Dialog 항목에 "층 스택·inert 다시 계산·`e.repeat` Esc 무시"를 적는다.

### 12.3 foundations.md

- §9 표 "글자 없는 아이콘 버튼" 허용 목록에 미디어 조작 묶음을 더한다: 전체 보기는 RE-4(`IconButton`의 `icon` prop이 `vocab.ts` `ICON_BUTTON_ICONS` 유니온 타입이라 목록에 없으면 타입 오류이고 DI7도 실패한다, `IconButton.svelte:8`·`vocab.ts:44`) [확인], 나머지는 RE-5: 시작 표시·끝 표시(In/Out), 구간 처음으로·구간 끝으로, N초 뒤로·N초 앞으로, 보기(`play`)·일시정지(`pause`). 화면 밖 손잡이의 `chevron-left/right`는 이미 목록에 있다. 이름 후보는 lucide `skip-back`·`skip-forward`·`rewind`·`fast-forward`·`scan`·`repeat`이다. In/Out은 `flag-triangle-left`·`flag-triangle-right` 또는 대괄호 계열이다 [가정: lucide-static 1.48.0에 있는 이름을 RE-5가 확인한다. 없으면 같은 은유의 다른 이름을 쓰고 표에 적는다].
- §9.1 은유 표에 행을 더한다(서로 다른 동작 = 서로 다른 모양, DI4). `play`는 이미 [이어받기]·[영상 보기]에 쓰인다. 편집 화면 보기 단추의 이름은 "영상 보기"(같은 키)라 DI4가 같은 동작으로 센다. `pause`는 "일시정지"(`action.pause`)로 같다 [가정: DI4 집계는 RE-5 gate로 확인].
- §3 "12px `--fg-muted` 단독 금지" 허용 목록에 타임라인 눈금·트랙 이름을 근거와 함께 더한다(RE-4, §7.8).
- §2.7 forced-colors 표의 `RangeTimeline` 행을 편집 화면 행(트랙·띠·손잡이·화면 밖 손잡이 chevron `HighlightText`·범위 막대·반복 토글 `Highlight` 면 + `HighlightText`)으로 바꾼다(RE-4, R9).
- §13 상수 표: `--editor-video-min-h` 90, `--editor-controls-min-w` `calc(7 × --control-h + 184px)`(380, coarse 464), `--timeline-label-w` 64, `--timeline-lane-h` 48, `--timeline-lane-sm-h` 32, `--timeline-handle-w` 12, `MIN_VIEW_SECS` 20, `SNAP_SECS` 0.5, `TICK_MIN_PX` 80, `LINE_PX` 16, 휠 배율 0.002, `SEEK_STEP_SECS` 5. 모두 [잠정](ADR-0009).
- 새 색 토큰 `--range-dim`(라이트·다크·`prefers-contrast: more`에서는 흐림 α를 줄이지 않고 띠 두께를 2px → 3px로 늘려 구분). 토큰 원천 `design/tokens/*.tokens.json`을 고치고 생성기로 만든다(`design-tokens` DT1). 대비 쌍(§7.8)은 `contrast.tokens.json`에 더한다(RE-4).

### 12.4 patterns.md

- §6.5 카드 폼 "구간" 행(`patterns.md:403`)을 다시 쓴다: 구간 줄(FieldRow + 요약 + [구간 편집…] + [구간 지우기]), 편집 화면 참조, "섹션이 접히면 적용 안 됨" 문장 삭제(RE-3).
- §8 키 표: "미리보기 편집 영역" 네 행을 "구간 편집 화면" 행으로 바꾼다(§9.1 요약: I/O·Space·←/→·↑/↓·`+`/`-`/`0`·Esc·Mod+Enter). "구간 칸: ↑/↓" 행은 "편집 화면의 시각 칸"으로 고친다. Esc 행에 "구간 편집 화면 → (그 안: 끌기 취소 → 전체 화면 → 화면 닫기)"를 사다리 맨 안쪽에 더한다. 규칙 5를 "편집 화면 안에서만"으로 고친다. 새 규칙: "길게 누른 Esc는 한 층만 닫는다"(RE16. 편집 화면 뿌리·Dialog·창 처리기 모두 `e.repeat` Esc로는 닫지 않는다).
- §15 높이 520 행: 빠른 다시보기 카드는 섹션이 없어져 약 1000 → 506 + 구간 줄(28 + 위 12) ≈ **546**이다. 편집 화면의 높이 예산은 §6.2 표를 옮긴다(RE-3 기본, RE-4 확대 줄).
- §9 포커스 표에 F-10: "창 전체 레이어(구간 편집 화면): 열면 h1, 닫으면 연 단추"(RE-3).

### 12.5 content.md

- §4 용어집 두 행(§11), §5.1 굳은 한자어에 "편집", §15 문구 표 행 전체(§11), 지운 키의 행 삭제.
- §5.2 다른 창을 여는 단추 예시에 [구간 편집…]을 더하고, `design/copy/terms.json` `opensWindow`에 "구간 편집"을 더한다(RE-3, DC5). §6.3 말줄임표 강제 문장("`action.*` 끝")을 "`opensWindow`에 있는 라벨 끝"으로 실제 검사와 맞춘다(`range.edit.label`은 `action.*`가 아니다).
- 용어집 "구간 보기·시작부터 보기·구간 반복하기: … 단추 둘과 스위치" 행(content.md:111, `terms.json` 같은 행)을 RE-5에서 "구간 반복하기(토글 단추)" 하나로 고친다(RE20·RE21). 두 곳 함께(DC10).

## 13. 테스트 원칙

- 규칙은 순수 함수 표 테스트로 고정한다: `rangeView.test.ts`(새), `receive.test.ts`(`applyDraft`·`draftOf`·`rangeSummary`·`lengthLine`), `rangeEdit.test.ts`(`playStep` 좁힘).
- 성질 테스트는 표로 쓴다(무작위 생성기를 들이지 않는다).
  - `zoomAt`의 앵커 고정.
  - `secsAtX ∘ xOfSecs`의 항등(범위 안).
  - `draftOf` → `applyDraft`의 왕복.
  - `clampView` 뒤 불변식(`0 ≤ start`, `start + span ≤ L`).
- 컴포넌트 시험은 "규칙 함수를 불렀고 결과를 썼다", "세션 command를 몇 번 불렀다"를 본다. `mockIPC` 호출 기록으로 `watch_open` 0회를 확인한다.
- 휠: jsdom에서 `new WheelEvent('wheel', { deltaY, deltaMode, ctrlKey, cancelable: true })`를 쏘고 `defaultPrevented`·`view`를 본다. `addEventListener` 옵션은 `vi.spyOn(Element.prototype, 'addEventListener')`로 `{ passive: false }`를 확인한다.
- 키: `fireEvent.keyDown(target, { key, code, repeat, shiftKey, isComposing })`를 쓰고 `defaultPrevented`·초안·`currentTime` 쓰기 횟수를 본다.
- 레이어: `document.body` 직속 여부, 다른 자식의 `inert`, 닫힌 뒤 복원, `document.activeElement`.
- `ui` 저장소(`rangeEditorOpen`·`previewOpen`)는 `beforeEach`에서 처음 값으로 되돌린다.
- Playwright: 빠른 다시보기 흐름은 [구간 편집…] → (편집) → [구간 적용하기] → `enqueue` range다. 가짜 백엔드 호출 기록으로 [영상 보기] 전 `watch_open` 0회를 본다. 매 단계 axe. 720×520·320×231·`x-large`에서 가로 스크롤 0과 [닫기]·[구간 적용하기]가 뷰포트 안에 있는지 본다. 포커스 요소가 sticky 머리와 겹치지 않는지(WCAG 2.4.11), Mod+Enter 적용 뒤 `enqueue` 0회(jsdom 동기 디스패치로는 microtask 순서를 못 본다)도 Playwright가 본다.
- 보강 테스트는 구현을 일부러 깨서 잡히는지 본다(메모리 규칙 TDD). PR 본문에 "깨 본 변이" 목록을 적는다.
- **테스트 수 ratchet**: 빠른 다시보기 시험은 지우지 않고 옮긴다(`WatchPanel.test.ts`의 구간·결합 시험 → `RangeEditor.test.ts`, `RangeTimeline.test.ts` → `EditorTimeline.test.ts`, `receive.test.ts`의 칸 시험 → `RangeEditor.test.ts`). PR마다 `tests.vitest`·`tests.playwright`가 base보다 줄지 않는다. 기준은 base의 `ci/ratchet.json`이다.

## 14. 구현 단계

### 14.1 PR 표(stacked, 직렬)

| id | slug(브랜치) | 내용 | type | gates | 깊은 리뷰 | 중간 master가 릴리스돼도 되는가 |
|---|---|---|---|---|---|---|
| RE-1 | `refactor/range-editor-model` | 순수 모델: `rangeView.ts`(뷰포트·좌표·확대·이동·`reveal`·`follow`·눈금·휠 정규화·`monitorSize`), receive.ts `applyDraft`·`draftOf`·`rangeSummary`·`lengthLine`(카드 `lengthText`가 이것을 부르게 바꾼다, 화면 무변경). **이 명세 커밋을 첫 커밋으로 품는다** | `refactor` | `frontend`, `e2e-web`, `design-shots`(관찰), `coverage`, `scan` | 아니오(표 테스트) | 예(화면 무변경) |
| RE-2 | `refactor/watch-session` | WatchPanel의 세션 수명을 `watchSession.svelte.ts`로 추출(동작 무변경). 늦게 온 결과 버리기·`attempt`·`hls.destroy` 순서·포커스 판단 콜백 | `refactor` | `frontend`, `e2e-web`, `design-shots`(관찰), `scan` | **예**(세션 수명·늦게 온 세션 닫기·서명 주소 비노출 회귀) | 예(화면 무변경) |
| RE-3 | `feat/range-editor-shell` | 공용 `modalLayer`(층 스택·inert 다시 계산, Dialog도 옮김·Dialog `e.repeat` Esc 무시), 편집 화면 레이어(머리·[닫기]·[구간 적용하기]·초안·검증·오류·Esc·`trapTab`·inert·포커스 복귀·`scroll-padding-top`), `monitorSize` 적용(영상 크기, 레이어 `overflow-y: auto` 안전망), 상태 셋 분리(`applied`), 카드 구간 줄 + [구간 편집…]·[구간 지우기], 빠른 다시보기 섹션 제거, 편집 화면 안에 표지 자리·세션·옛 `RangeTimeline`·옛 글자 조작 줄·구간 줄 이식, 창 처리기 거름(RE15·RE16, 메뉴 `App.svelte` 포함), `rangeEdit` `open`·`initialEnd` 정리, `opensWindow` "구간 편집", `RangeField` 삭제. D67·ADR-0030·ADR-0029 `폐기(→ 0030)`·D66 한 문장·`spec-check` 67·components §2.29·RangeEditor·RangeSummary·patterns §6.5·§8(Esc·키)·§9 F-10·§15·content | `feat` | `frontend`, `e2e-web`, `design-tokens`, `design-copy`, `design-lint`, `design-icons`, `scripts-test`(`spec-check.test.mjs`·`adr.test.mjs`), `design-shots`(관찰), `coverage`, `scan` | **예**(D66 계약 변경, 받기 요청 range, 레이어·inert·포커스, 공용 `modalLayer`·Dialog, 창 처리기) | 예: 옛 막대·글자 단추이지만 기능이 모두 있고, 확정값 계약이 완성돼 있다 |
| RE-4 | `feat/range-editor-timeline` | 타임라인 패널: 머리(제목·안내·[전체 보기]·반복 토글 자리), 눈금·영상/소리 트랙·흐림·띠·지금 위치선, 새 손잡이(보이는 12·누름 24·화면 밖 꼴·같은 쪽 쌓기), 확대·이동·휠(`passive: false`)·`+`/`-`/`0`·눈금 두 번 누르기·범위 막대 scrollbar(엄지 최소 폭·가장자리 끌기)·따라가기, 좁은 레이아웃. [전체 보기] 때문에 앞당기는 것: 아이콘 허용 목록 [전체 보기] 행·아이콘, IconButton `hint`, `shortcut.hint.label`, `platform` `zoomMod`·`EDITOR_KEYS`(`+`·`-`·`0`). `RangeTimeline` 삭제·ADR-0028 `폐기(→ 0030)`·D65 한 문장. 새 토큰·대비 쌍 | `feat` | `frontend`, `e2e-web`, `design-tokens`, `design-lint`, `design-copy`, `design-icons`, `scripts-test`, `design-shots`(관찰), `coverage`, `scan` | **예**(입력 처리·좌표·접근성·대비) | 예 |
| RE-5 | `feat/range-editor-controls` | 조작 줄 3칸 아이콘 단추 일곱(행 폭 `rowW`·`CONTROLS_MIN_W`)·툴팁(RE-4의 `hint`를 쓴다)·`aria-keyshortcuts`, 반복 토글(`Button aria-pressed`)·§8.2 반복 규칙(`playStep` 좁힘, `play` 이벤트 한 곳)·[구간 보기]·[시작부터 보기] 삭제, 키 우선순위 표 전체(§9.1), 아이콘 허용 목록(미디어 조작 묶음)·은유 표·icons.ts 벤더링, `EDITOR_KEYS` 나머지 | `feat` | `frontend`, `e2e-web`, `design-icons`, `design-copy`, `design-lint`, `design-tokens`, `scripts-test`, `design-shots`(관찰), `scan` | **예**(키 충돌·IME·반복) | 예 |
| RE-6 | `chore/range-editor-docs` | 이 문서 §21 구현 결과, D67·ADR-0030 상태, README 열린 항목(M-RE), `features/README.md`·`plan.md`·ROADMAP, ratchet(사람) | `chore` | `scan`, `scripts-test`, `design-copy` | 아니오 | — |

**순서의 이유**(작업 지시의 예시 순서와 다르다)
- 진입점을 RE-3에 넣었다. 예시대로 마지막에 붙이면 RE-3~RE-5 동안 편집 화면이 master에서 닿지 않는 코드로 남는다. 그동안 앱 경로 e2e·`design-shots`로 확인할 수 없다(ui 갤러리는 `ui/` 원형만 그린다, `gallery.spec.ts:1-3`) [확인].
- 진입과 옛 섹션 제거를 한 PR(RE-3)에 둔다. 그래서 master가 "섹션도 있고 편집 화면도 있는" 두 원천 상태를 거치지 않는다(preview-ux2 A6 선례: 사용자 결정을 어기는 중간 상태를 만들지 않는다).
- RE-3이 커지는 대신 RE-1(순수)·RE-2(세션 추출)를 앞에 떼어 둔다. RE-3의 diff는 배선과 화면이고, 규칙은 이미 녹색인 모델을 부른다.
- RE-4와 RE-5는 서로 다른 파일(EditorTimeline / 조작 줄·키)이 중심이지만 `RangeEditor.svelte`를 함께 건드려 직렬로 둔다.
- 각 PR은 앞 PR이 master에 머지된 뒤 master에서 시작한다. 그래야 ratchet·갤러리 기준선이 앞 PR을 품는다. 갤러리 기준선은 Linux CI artifact로 받는다(`shots.mjs --accept`).
- 가짜 백엔드 command는 어느 PR에서도 바뀌지 않는다. 화면이 바뀌는 PR(RE-3·4·5)이 갤러리·spec을 함께 고친다.

### 14.2 PR별 TDD 순서(먼저 쓸 실패 테스트)

#### RE-1 순수 모델(`rangeView.test.ts` 새, `receive.test.ts`)
1. `fullView/clampView`: `L = 5400`에서 `{−10, 100}` → `{0, 100}`, `{5390, 100}` → `{5300, 100}`, span 5 → `minSpan` 20, span 9999 → 5400, `L = 10`(< minSpan) → `{0, 10}`(불변식 `min(minSpan, L) ≤ span`), NaN → 전체, `L = Infinity`·0·음수 → `{0, 0}`, span `L − 0.3` → `{0, L}`(`SNAP_SECS`).
2. `secsAtX`: `x = 0`·`w`·`w/2`, 음수·폭 초과(자름), `w = 0` → `start`, 확대 뷰 `{600, 60}`에서 가운데 → 630.
3. `xOfSecs`: 보이는 범위 밖 값이 음수·폭 초과로 나온다(자르지 않음). `secsAtX(xOfSecs(s))` = s(범위 안 표).
4. `placement`: 양 끝 포함, 밖 둘.
5. `zoomAt`: 앵커 고정(자르기 없을 때, 앵커 화면 x 동일), 상한(span = L), 하한(span = 20), 0 근처·L 근처 앵커의 자르기, `factor` 1 → 그대로, 휠 배율로 ×k 뒤 ×1/k → `zoomed` 거짓(정확히 전체).
6. `panBy`: `moved` 참/거짓(끝에 닿음), 전체 보기 → `moved` 거짓. `wheelPanSecs(px, trackW, span)` = `px / trackW × span`(100px·616px·span 600 → 약 97초).
7. `reveal`: 안(그대로)·왼쪽 밖·오른쪽 밖·margin 경계.
8. `follow`: 안 → 그대로, 끝 넘김 → `pos − 0.1 span`, 앞(반복 restart) → 같은 규칙, 전체 보기 → 그대로, 끝 근처 자르기.
9. `ticks`: 5400·860px → 10분 간격 첫 눈금 0, 20초 창 → 5초 이하 간격, 320px → 간격 넓어짐, 첫 눈금 `ceil`, 43200·300px → 4시간(목록을 넘으면 2시간의 정수배).
10. `wheelIntent`
    - `deltaMode` 0·1·2 정규화.
    - `ctrlKey` → zoom, mac `metaKey` → zoom, 비mac `metaKey` → pan.
    - `|dx| ≥ |dy|` 축 선택. 대각선 `{dx: 30, dy: 40}` → pan 40 하나(합 70 아님).
    - Shift+`deltaY` → pan.
    - `{0, 0}` → `null`.
11. `zoomFactor(dyPx)`: 0 → 1, 큰 값 → [0.5, 2]로 자름, 부호.
12. `monitorSize`: 960×700 전체·확대, 720×520 확대(rowW 380 > videoW), coarse(`controlsMinW` 464), 좁은 레이아웃(rowW = stageW, 영상은 폭에서만: `stageH`를 바꿔도 결과가 같다), `stageH` 작음 → `VIDEO_MIN_H`.
12a. `scrollThumb(view, L, barW, hitMin)`: 엄지 폭 = `max(hitMin, span/L × barW)`(20초/10800초/800px → 24), 엄지 x ↔ `start` 왕복이 `(barW − thumbW)` 기준, 가장자리 끌기 → 반대 끝 고정·span 상하한.
13. `applyDraft`: §5.2 표 전 행.
14. `draftOf`: `null` → `''·''`, `{0, x}` → `''`, 끝 = 올림 길이 → `''`, `{s, null}` → 끝 `''`. 왕복 표(`draftOf` → `applyDraft`)가 같은 `applied`.
15. `rangeSummary`: §5.3 표 전 행(내림 끝 포함).
16. `lengthLine`: 지금 `lengthText`의 분기 전부(전체+크기, 전체 길이 미상 → `range.whole.label`, 구간+크기, 끝 미상 → null, 오류 → null). 카드 화면은 바뀌지 않는다(기존 receive.test 녹색).

엣지: `L = 0`·음수·`Infinity`, `w = 0`, `span = 0`, 2초 영상(`minSpan` > L), 3시간(10800) 영상의 눈금.
완료 조건: 표의 gate 녹색 + 위 시험 녹색 + `tests.vitest`가 base 이상 + 카드 화면이 바뀌지 않음(기존 `receive.test.ts`·Playwright·갤러리 기준선이 무수정 녹색).
변이 확인: `clampView` 하한 제거(1), `SNAP_SECS` 제거(1·5), 앵커 식에서 비율 빼기(5), 축 합산(10), `deltaMode` 무시(10), 엄지 최소 폭 제거(12a), 좁은 레이아웃에서 `stageH` 쓰기(12), `draftOf` 올림 끝 처리 제거(14), 내림 끝 제거(15) — 각각 괄호 안 시험이 잡는다.
바뀌는 파일: `app/src/lib/rangeView.ts`(새)·`rangeView.test.ts`(새), `receive.ts`·`receive.test.ts`, `ResolveCard.svelte`(`lengthText` → `lengthLine` 한 줄). 문서: 이 명세. app.md 번호 없음(화면 무변경, PVU-1 선례).

#### RE-2 세션 추출(`watchSession.test.ts` 새, 기존 `WatchPanel.test.ts` 그대로 녹색)
1. 기존 `WatchPanel.test.ts`·`watch.spec.ts`가 손대지 않고 녹색이다(동작 무변경의 증거).
2. `open → ready(mp4)`: `phase`, `src`, `watch_open` 1회.
3. `open → ready(hls.js)`: `usingHls`, `attachMedia` 뒤 `onready` 콜백.
4. `native m3u8 fallback`: `usingHls = false`.
5. `late result after close is closed immediately`: `close()` 뒤 도착한 dto → `watch_close` 1회, 상태 그대로.
6. `reopen during opening discards first`(`attempt`).
7. `close order: hls.destroy before watch_close`(호출 순서 기록).
8. `video error → failed, session closed once`, `onfailed` 콜백에 "포커스가 영상에 있었나" 인자.
9. `gate denial keeps error for copy`(`notLoggedIn`·`notOwnContent`·`ownershipUnknown`).
10. `no signed URL leaves the controller`: 외부에 노출하는 값은 `src`(`watch:` 주소)와 `phase`뿐(타입·스냅샷).

변이 확인: `attempt` 비교 제거(5·6), destroy 순서 뒤집기(7).
완료 조건: 표의 gate 녹색 + 위 시험 녹색 + **기존 `WatchPanel.test.ts`·`watch.spec.ts`를 무수정으로 녹색** + 갤러리 기준선 변화 0 + `tests.vitest`·`tests.playwright`가 base 이상.
바뀌는 파일: `app/src/lib/components/receive/watchSession.svelte.ts`(새)·테스트, `WatchPanel.svelte`. 문서: app.md **123**.

#### RE-3 편집 화면 셸·상태·진입(`RangeEditor.test.ts` 새, `receive.test.ts`, `WatchPanel.test.ts`, `GlobalShortcuts`·`ui` 시험, `range.spec.ts`, `range-editor.spec.ts` 새, `watch.spec.ts`, `screens-data.ts`)
1. `rewind card shows range line, no preview section`: "구간" + "전체" + [구간 편집…], `<details>` 없음, "미리보기·구간" 없음. `vod/clip card keeps 미리보기 section`(기존 유지).
2. `notOwn/unknown/live: no range line`(PS15 유지).
3. `open editor: layer is body child, others inert, focus on h1, ui.rangeEditorOpen true, watch_open 0`.
4. `close restores inert and focus to 구간 편집…`, `ui.rangeEditorOpen false`. `card destroyed while open → flag false, focus to url bar`. `modalLayer` 순서 시험(`modalLayer.test.ts`): 편집 화면 → 대화상자 → 카드 소멸(편집 화면이 먼저 사라짐) → 그 사이 `.app`은 inert 그대로 → 대화상자 닫기 → `.app`에 inert 없음. 층이 붙기 전부터 있던 inert는 그대로 남는다. 기존 Dialog 시험은 무수정 녹색.
5. `draft starts from applied`(`null` → 빈 두 칸, 확정값 → `draftOf`).
6. `apply valid: applied set, editor closed, enqueue carries range, check_output key uses range`. `ui.previewOpen = false`인 상태에서도 적용한 range가 `enqueue`·`check_output`에 실린다(옛 열림 조건이 남으면 실패). 세션 닫기는 단계별로 나눈다: `ready` → `watch_close` 1회, `idle`·`failed` → 0회, `opening` → 닫을 때 0회 + 늦은 결과 도착 때 1회(§5.4).
7. `apply invalid (format/order/beyond): editor stays, aria-invalid, describedby, focus+select, draft kept`. `IME composing: focus without select`.
8. `close/Esc discards draft, applied unchanged`(카드 요약 그대로, 다음 열기 = 옛 확정값).
9. `editor 구간 지우기 clears draft only; applied unchanged until apply`, `focus stays on button`.
10. `card 구간 지우기 sets applied null immediately, focus moves to 구간 편집…, announces range.cleared.body`.
11. `apply whole → applied null, announces appliedWhole after layer removed`, `unchanged apply → no announcement`.
12. `Esc order`: 영상 전체 화면 흉내(`document.fullscreenElement` 스텁) → `defaultPrevented` 거짓·전파 멈춤·편집 화면과 **카드 둘 다 그대로**, 그 밖 → 닫기(칸·단추·영상·막대 각각에서). 카드는 열린 채다. **포커스가 `body`일 때**: Esc → 사다리 처리기가 편집 화면을 닫고 카드는 그대로, 전체 화면 스텁 + `body` → 편집 화면·카드 둘 다 그대로. 결합이 풀려 조작 줄이 `disabled`가 되면 포커스가 h1로 간다. 끌기 취소는 새 손잡이와 함께 RE-4 시험 5가 맡는다(RE-3의 옛 막대 위 Esc는 편집 화면을 닫고 끌기도 끝난다).
13. `repeated Esc does not close card`: keydown(Esc) → 닫힘 → keydown(Esc, repeat) → 카드 그대로. `GlobalShortcuts ignores repeat Esc` 단독 시험. 편집 화면 위 대화상자에서 Esc → 대화상자 닫힘 → keydown(Esc, repeat) → 편집 화면 그대로(Dialog·뿌리 둘 다 repeat 무시). 편집 화면 안 repeat Esc 단독 → 닫히지 않음.
14. `while editor open: Mod+Enter applies (no download), Mod+L/Mod+, ignored, paste ignored, drop ignored, menu settings/about events ignored`(각각). 뿌리 Mod+Enter는 성공·실패 모두 `defaultPrevented`. 카드 처리기는 깃발이 `false`여도 `defaultPrevented`면 받지 않는다. Playwright: Mod+Enter로 적용한 뒤 `enqueue` 0회(실제 이벤트 순서에서 microtask가 깃발을 먼저 내리는 경우를 본다).
15. `Tab cycles inside editor`(`trapTab`).
16. `session lazy`: [영상 보기] 전 `watch_open` 0, 누르면 1, `ready` 포커스 규칙(PS6), 실패 포커스 h1(단추·`body`일 때만), 재생 중 오류 포커스(영상일 때만).
17. `coupling table`(§5.5): 결합 전 손잡이 → 초안만·`currentTime` 쓰기 0, 결합 뒤 commit 탐색, 네이티브 대체 안내 줄, meta 없음 + 결합 전 → `noLength` 줄·손잡이 없음.
18. `field ↑/↓ and blur seek moved from card`(PS-1 시험 2~14를 편집 화면 칸으로. 이름 유지).
19. `busy: 구간 편집… and 구간 지우기 disabled`.
19a. `monitorSize applied via ResizeObserver; jsdom without RO falls back to CSS`(옛 RE-5 시험 10을 당김), `--layout-narrow`를 읽어 좁은 레이아웃 분기.
20. `[data-local-keys] exception removed`: 카드 안 어디에도 그 속성이 없다.
21. E2E `range.spec.ts`(고쳐 씀): 편집 → 칸 입력 → 적용 → `enqueue` range·이름 접미사, 손대지 않으면 range 없음, [닫기] → range 그대로(옛 값), 카드 [구간 지우기] → range 없음, 형식·순서 오류는 편집 화면 칸 아래, 길이 미상 끝 빈칸, 생방송 줄 없음, 작업 행 "구간을 찾지 못함".
22. E2E `range-editor.spec.ts`(새, `watch.spec.ts`의 빠른 다시보기 시험을 옮김): 열기 → `watch_open` 0 → [영상 보기] → hls.js playlist 읽음 → 찍기·손잡이·I/O·칸 ↑/↓ → 적용 → `enqueue` range. Esc → 닫힘 + `watch_close`. 720×520·320×231·`x-large`에서 [닫기]·[구간 적용하기] 뷰포트 안·가로 스크롤 0, 720×520에서 구간 줄의 두 칸에 Tab으로 닿고 보인다, 320×231에서 Shift+Tab으로 거꾸로 돌 때 포커스 요소의 rect가 머리와 겹치지 않는다(`scroll-padding-top`). 매 단계 axe.
23. 갤러리: `card-rewind-default`(구간 줄 "전체"), `card-range`(확정 구간), 새 `editor-idle`·`editor-coupled`·`editor-error`·`editor-native`·`editor-failed`·`editor-no-length`(라이트·다크·720×520·320). 지우는 장면: `card-section-collapsed`(빠른 다시보기 기준), `card-watch-hls*`(편집 화면 장면으로 옮김).

엣지: 열기 중 카드 닫힘 불가(inert) 확인, `opening` 중 [닫기] → 늦은 세션 닫기, 적용 직후 같은 키 검사 디바운스로 [받기]가 잠깐 비활성, 2초 영상, meta 길이 0.
완료 조건: 표의 gate 녹색 + 위 시험 녹색 + **기존 Dialog 시험 무수정 녹색** + `tests.vitest`·`tests.playwright`가 base 이상(옮긴 시험 포함) + **[받기]·`check_output` 요청의 range가 `applied`에서만 나온다**(편집 화면이 열린 동안의 초안은 요청에 섞이지 않는다, 가짜 백엔드 호출 기록) + 갤러리 새 장면 기준선은 Linux CI에서 받는다.
변이 확인: `rangeApplies`에 열림 조건 남기기(6: `previewOpen = false` 행), 닫기에서 `applied` 쓰기(8), 오류 때 닫기(7), inert 복원 빼기(4), `modalLayer`를 저장값 복원으로 되돌리기(4: 순서 시험), repeat Esc 거름 제거(13), Dialog repeat 거름 제거(13), 사다리 처리기가 전체 화면에서 `false` 돌려주기(12), 뿌리 Mod+Enter `preventDefault` 빼기(14: Playwright), 레이어 attach 정리에서 깃발 내리기 제거(4).
바뀌는 파일: `RangeEditor.svelte`·`RangeSummary.svelte`(새), `ResolveCard.svelte`, `WatchPanel.svelte`, `RangeField.svelte`(삭제), `rangeEdit.ts`, `stores/ui.svelte.ts`, `GlobalShortcuts.svelte`, `InputPanel.svelte`, `App.svelte`(메뉴 거름), `ui/modalLayer.ts`(새)·`modalLayer.test.ts`(새), `ui/Dialog.svelte`(`modalLayer` 사용·repeat Esc), `styles/layout.css`(`--layout-narrow`), `design/tokens`(`--editor-video-min-h`·`--editor-controls-min-w`)·생성물, 테스트, `ko.ts`, `terms.json`(`opensWindow`·용어집), `docs/design/system/{README.md,components.md,patterns.md,content.md}`, `adr/0030-range-editor-screen.md`(새), `adr/0029-preview-section.md`(상태 줄만), `scripts/design/spec-check.mjs`·테스트, `app/e2e/{range.spec.ts,range-editor.spec.ts,watch.spec.ts,screens-data.ts}`. PR 본문에 로컬 `dist` gzip 증가량. 문서: app.md **124**.

#### RE-4 타임라인(`EditorTimeline.test.ts` 새(옛 `RangeTimeline.test.ts` 시험을 옮김), `RangeEditor.test.ts`, `range-editor.spec.ts`, `screens-data.ts`)
1. `renders ruler, video lane, audio lane, range row in order; tracks aria-hidden`.
2. `ticks follow view`(전체·확대).
3. `handle ARIA`: `valuemin/max`가 상대 손잡이로 제한(시작 `0…end−1`, 끝 `start+1…floor(L)`), `valuetext`, 띠 없으면 둘 다 전체.
4. `drag keeps anchor offset`(옛 시험 이식), `drag clamps to visible window`(RE13), `drag clamps by other handle`, `no move → no commit`, `pointercancel commits last`.
5. `Esc during drag restores snapshot, no commit, stops propagation`. 끌기 취소 뒤 keydown(Esc, repeat) → 편집 화면 그대로(RE16 (0)).
6. `offscreen handle stays in DOM as slider, pinned left/right, pointerdown reveals without value change`, `both on same side stack(start top)`, `key change on offscreen handle reveals`, `focus alone does not reveal`.
7. `wheel listener is non-passive`(spy), `ctrl-wheel zooms around cursor and preventDefault`, `mac meta-wheel zooms`, `wheel pans only when zoomed and movable`, `full view wheel → not prevented`, `at edge → not prevented`, `diagonal not summed`, `deltaMode line/page normalized`, `wheel during drag only prevented`.
8. `+/-/0 keys`(Shift+`=` 포함, Ctrl+`+` 무시, 칸 안에서는 글자), `전체 보기 button appears only when zoomed and resets`, 툴팁 `title` "전체 보기(0)"(`hint`·`shortcut.hint.label`), 시간 영역 `aria-keyshortcuts`·안내 줄 키 문장. `ruler dblclick zooms ×2 around pointer`(결합 중이면 같은 자리 탐색 두 번 뒤 확대).
9. `scrollbar only when zoomed; aria-controls points to time group; keys ←/→/PageUp/Down/Home/End; drag thumb; valuetext`, 엄지 최소 폭 `--hit-min`(43200초에서도 24), 엄지 가장자리 끌기 → span 변경·반대 끝 고정, 거의 전체로 축소 → 막대·[전체 보기] 사라짐(`SNAP_SECS`). 휠·끌기 x는 트랙 칸 rect 기준(이름 칸 64 어긋남 없음, 좁은 레이아웃 포함).
10. `track click seeks once when coupled; does nothing before`; `playhead only when coupled and inside view`.
11. `follow: on by default, off after wheel/scrollbar/+/-; page turns when position leaves view; on again after play event/전체 보기/0`(`구간 처음으로` 뒤 켜짐은 그 단추가 생기는 RE-5 시험 4가 맡는다).
12. `L change`: null → video(전체 보기 → `fullView`), video → null(시간 영역 사라짐), video 값 변경(확대 중이면 `clampView`, 전체면 새 전체). `L < 20 → no zoom (wheel not prevented, keys no-op)`.
13. `narrow layout`: 이름 칸 숨김, 구간 줄 두 줄(클래스·계산값 확인은 Playwright). 흐림은 트랙 줄에만(눈금 줄에 흐림 요소 없음).
14. E2E: 휠 확대(`page.mouse.wheel` + Control/Meta)·이동·범위 막대 끌기·엄지 가장자리 끌기·눈금 두 번 누르기·화면 밖 손잡이 누름 → 값 그대로·범위 이동, 키 `+`·`0`. 720×520 확대에서 가로 스크롤 0(조작 줄 380은 RE-5 시험 11). axe(scrollbar·slider 이름·값).
15. 갤러리: `editor-zoomed`(라이트·다크), `editor-zoomed-small`(720×520), `editor-offscreen-end`, `editor-forced`(forced-colors: 화면 밖 chevron `HighlightText`), `editor-320`. 대비 쌍(`accent-ink / 흐림 위 트랙` 둘, `border-strong / surface`)은 `design-tokens`가 본다.

엣지: 손잡이 둘이 같은 초(띠 없음), 끝 = `floor(L)`, 시작 = 0, `L = 1`·`2`, 매우 긴 영상(43200), 창 크기 변경 중 확대 유지(초 단위 view).
완료 조건: 표의 gate 녹색(`design-tokens` 대비 쌍 포함) + 위 시험 녹색 + `tests.vitest`·`tests.playwright`가 base 이상(옮긴 `RangeTimeline` 시험 포함) + 720×520 확대·320×231 장면에서 가로 스크롤 0.
변이 확인: `{passive:false}` 빼기(7), 축 합산(7), 보이는 범위 자르기 제거(4), 화면 밖 손잡이를 `{#if}`로 빼기(6), `reveal` 대신 값 이동(6), `follow` 끄기 누락(11), 엄지 최소 폭 제거(9), 시간 영역 group rect로 x 재기(9), L 변경 때 `clampView` 빼기(12).
바뀌는 파일: `EditorTimeline.svelte`(새, 필요하면 `TimelineHandle.svelte`), `RangeEditor.svelte`, `RangeTimeline.svelte`·테스트(삭제·이식), `layout.css`(좁은 레이아웃 블록 두 곳), `design/tokens/*.tokens.json`·생성물, `contrast.tokens.json`, `ko.ts`(`rangeEditor.timeline.*`·`shortcut.hint.label`·`platform.*.zoomMod`), `ui/IconButton.svelte`(`hint`), `ui/vocab.ts`·`ui/icons.ts`([전체 보기] 아이콘), `platform.ts`(`zoomMod`·`EDITOR_KEYS` 일부)·`platform.test.ts`, `docs/design/system/{README.md(D65 한 문장),components.md(§2.2 `hint`),foundations.md(§2.7 행·§3 허용 목록·§9 [전체 보기] 행·§13·대비),patterns.md(§15 확대 줄),content.md}`, `adr/0028-range-editor.md`(상태 줄만), e2e·갤러리. 문서: app.md **125**.

#### RE-5 조작 줄·키(`RangeEditor.test.ts`, `rangeEdit.test.ts`, `EditorControls.test.ts` 새, `platform.test.ts`, `range-editor.spec.ts`)
1. `controls row is role=group with name, seven icon buttons in order, disabled until coupled`.
2. `tooltips: title = {label}({key}) for I/O/Space/←/→, aria-keyshortcuts`, `no shortcut → title = label`.
3. `play button toggles icon and name(영상 보기 ↔ 일시정지)`.
4. `±n seconds clamp to [0, duration]`, `구간 처음으로 seeks start keeps playing`, `구간 끝으로 pauses then seeks end (toEnd → floor(L))`, 셋 모두 뒤 따라가기 켜짐(옛 RE-4 시험 11에서 옮김).
5. `loop table`(§8.2 전 행, `playStep` 표 테스트): 꺼짐 끝 통과, 켜짐 밖에서 시작 → start, `t ≥ end` restart, `ended`+끝까지 restart, 사용자 탐색 밖 → off·토글 유지, 일시정지 → off, 보는 중 토글 켬/끔. **네이티브 `play` 이벤트로 시작(우리가 부르지 않은 `play`) → 반복 모드·따라가기 켜짐**.
6. `range mode removed`: `playStep('range', …)` 타입 오류(컴파일), [구간 보기]·[시작부터 보기] 없음.
7. `key priority table`(§9.1): 열마다 한 시험 묶음. 손잡이 ←는 값, 칸 ←는 캐럿(기본 동작 유지), 단추 ←는 5초, 범위 막대 ←는 범위, 영상 위 Space는 네이티브(처리 안 함), 시간 영역 Space는 보기, I/O는 칸에서 글자·그 밖 찍기, 수식 키 거름, IME 거름, 결합 전에는 영상 동작 없음 + `defaultPrevented` 거짓.
8. `toggle 구간 반복하기 has aria-pressed and neutral pressed style class`.
9. `platform zoomMod`: mac "⌘", 그 밖 "Ctrl", 안내 줄 문구.
10. 조작 줄 폭 `rowW`: 넓은 창에서 영상 폭, 720×520 확대에서 `CONTROLS_MIN_W`(coarse 464). (`monitorSize` 적용 자체는 RE-3 시험 19a.)
11. E2E: Space·I·O·←·→·`+`로 한 흐름, 툴팁 `title`, 반복 켜고 구간 처음으로 → [영상 보기] 단추 → 끝 넘김 없이 되돌아옴(가짜 시계·`currentTime` 기록), 720×520 확대에서 조작 줄 380(옛 RE-4 시험 14에서 옮김), axe.
12. 갤러리: `editor-coupled`(아이콘 조작 줄) 기준선 갱신, `editor-controls-coarse`(40px, **720×520 확대 크기**로 찍어 조작 줄 464가 넘치지 않는지 본다), `editor-320`, 반복 토글 켜짐(테두리)·forced(`Highlight` 면).

엣지: 끝이 "끝까지"인 구간 반복, 구간 길이 1초, 영상 끝에서 [영상 보기](브라우저가 처음부터), 보는 중 찍기로 구간이 지금 위치 앞으로 줄어듦(다음 `timeupdate`에서 restart).
완료 조건: 표의 gate 녹색(`design-icons` DI4·DI7 포함) + 위 시험 녹색 + `tests.vitest`·`tests.playwright`가 base 이상 + §9.1 표의 칸마다 시험이 하나 이상 있다.
변이 확인: `'range'` 분기 남기기(5·6), 반복 규칙을 단추 경로에만 두기(5: 네이티브 `play` 행), 단추 위 ← 거름 제거(7), Shift 확대 거름 넣기(7: `+` 실패), 결합 전 거름 제거(7), `title` 덮어쓰기 제거(2).
바뀌는 파일: `RangeEditor.svelte`, `EditorControls.svelte`(새), `rangeEdit.ts`, `ui/Button.svelte`(`aria-pressed` 면·테두리·forced), `ui/vocab.ts`·`ui/icons.ts`(미디어 조작 묶음, [전체 보기]는 RE-4), `licenses/lucide.txt`(버전 같으면 그대로), Worker `icons.generated.ts`(DI1 비교 대상이면 `worker-gen.mjs --write`), `platform.ts`(`EDITOR_KEYS` 나머지), `ko.ts`, `terms.json`(용어집 "구간 반복하기" 행), `docs/design/system/{foundations.md(§9·§9.1),components.md(§2.1),patterns.md(§8),content.md(용어집 행)}`, e2e·갤러리. 문서: app.md **126**.

#### RE-6 문서 마감
1. D67·ADR-0030: `채택(잠정)` 유지(E0~E1) 또는 실측으로 바꾼다. README 열린 항목에 M-RE 남은 것.
2. 이 문서 §21 구현 결과, `features/README.md` 행, `plan.md` 트랙, ROADMAP "현재 위치"·체크리스트.
3. `tests.vitest`·`tests.playwright`·`size.dist_gz`는 CI 녹색 실행 뒤 사람이 올린다(`ratchet.mjs write --from-run`).

완료 조건: `scan`, `scripts-test`, `design-copy` 녹색.

### 14.3 gate 요약
`frontend`, `design-tokens`(RE-4 새 토큰·대비)·`design-lint`(DL13 폭 미디어 쿼리는 `layout.css`만)·`design-copy`·`design-icons`(RE-5 허용 목록·DI4), `scripts-test`(`spec-check`·ADR 형식), `e2e-web`(Playwright·`design-gallery`), `design-shots`(관찰), `coverage`, `scan`. 크기는 CI `bundle (linux)`의 `size`가 본다(새 의존성 없음). Rust·`.github/`·`worker/`(RE-5에서 Worker 아이콘 생성물이 바뀌면 `worker` 영역도 돈다)·`help/`는 바꾸지 않는다.

## 15. 번호 예약

- app.md 구현 중 변경 **123**(RE-2)·**124**(RE-3)·**125**(RE-4)·**126**(RE-5) [확인: 마지막 122, `app.md:1529`]. RE-1·RE-6은 번호 없음(화면 무변경·문서, PVU-1·PS-4 선례).
- 디자인 결정 **D67** [확인: 마지막 D66, `README.md:215`, `plan.md:258` "이후 새 D는 D67"]. **ADR-0030** [확인: 마지막 `0029-preview-section.md`]. ADR-0029 → `폐기(→ 0030)`(RE-3), ADR-0028 → `폐기(→ 0030)`(RE-4).
- `spec-check.mjs` D 상한 67.
- core.md: 없음.
- 미머지 PR과 겹치면 나중에 머지되는 쪽이 번호를 옮긴다(preview.md 선례).

## 16. 후속(범위 밖)
- macOS WKWebView 핀치(`gesturestart`·`gesturechange`의 `scale`): M-RE-1에서 ctrl-휠로 오지 않으면 RE-4 뒤 작은 PR로 더한다(같은 `zoomAt`, 시간 영역 한정, 처리할 때만 `preventDefault`).
- 손잡이 끌기 중 가장자리 자동 이동(RE13). M-RE-8에서 "놓고 다시 잡기가 번거롭다"가 나오면 한다.
- 스크러빙(눈금 끌기 연속 탐색), 프레임 단위 이동, 썸네일 줄·실제 파형(데이터·요청 비용).
- 키보드 포커스 때 보이는 스타일 툴팁(지금은 네이티브 `title`. 키보드 사용자는 이름과 `aria-keyshortcuts`로 안다).
- 닫기 확인(초안이 바뀌었을 때, RE17 다시 볼 조건).
- 편집 화면 상태(확대·반복) 기억.

## 17. 실측 필요(사용자 손, 출력은 판정만)

| ID | 무엇 | 누가 | 통과 기준 |
|---|---|---|---|
| M-RE-1 | 트랙패드 핀치가 3 OS 웹뷰에서 어떻게 오는가: Ctrl+휠(`ctrlKey`)인가, WKWebView `gesture*`인가, 페이지가 확대되지 않는가 | 사용자, 본인 빠른 다시보기 | 셋 다 타임라인만 확대되고 창 확대는 없다. 아니면 §16 후속 |
| M-RE-2 | 휠 단위·방향: 마우스 휠 한 칸의 `deltaMode`·크기(Windows 줄 단위 여부), Shift+휠 축, 트랙패드 좌우·관성, 자연 스크롤 방향. 한글 입력 상태(3 OS)에서 비편집 요소의 키가 `keyCode` 229로 오는지 | 사용자 | 이동 방향이 손 방향과 맞고, 한 칸에 보이는 범위의 대략 10~30%가 움직인다. 한글 입력 상태에서 I/O·Space·`+`·`0`이 동작한다 |
| M-RE-3 | ⌘/Ctrl+휠 확대 체감(배율 0.002, 최소 20초): 너무 빠르거나 느리지 않은가, 1초 손잡이 맞춤이 되는가 | 사용자 | "적당"이고 20초 창에서 1초를 손잡이로 맞춘다 |
| M-RE-4 | 영상 전체 화면에서 Esc: 편집 화면이 닫히지 않고 전체 화면만 풀리는가(3 OS), 풀린 뒤 포커스 | 사용자 | 전체 화면만 풀린다 |
| M-RE-5 | 편집 화면 [영상 보기] 뒤 영상이 시작되는가(자동재생 정책, M-PVU2-2와 같은 질문) | 사용자 | 시작되거나 일시정지로 남고 조작 줄·controls로 시작할 수 있다 |
| M-RE-6 | 화면 낭독기: 대화상자 이름 "구간 편집", 손잡이 값·경계·화면 밖 값, 범위 막대 값, 조작 줄 단추 이름·단축키, 적용·지우기 알림 | 사용자 | 각각 읽힌다. 알림은 한 번 |
| M-RE-7 | 720×520·`x-large`·Windows 225%: 영상 높이 체감, 조작 줄 줄바꿈, 머리 단추가 늘 보이는가 | 사용자 또는 갤러리 | 가로 스크롤 0, 머리 단추 보임 |
| M-RE-8 | 사용자 시험(D62 UT): [구간 편집…]을 찾는가, 닫기·Esc로 초안을 잃어 놀라는가, 반복 토글을 이해하는가(켜짐 테두리 포함), 끌기 범위 제한이 답답한가, 포인터만으로 확대(눈금 두 번 누르기·엄지 가장자리)를 찾는가 | 사용자 시험 | "N명 중 M명". RE13·RE17의 다시 볼 조건 |
| M-RE-9 | 3시간 영상에서 확대·이동·끌기 연속 입력의 체감(끊김) | 사용자 | 끊김을 못 느낀다 |
| M-RE-10 | 누르기 전 요청 0: 편집 화면을 열고 [영상 보기] 전까지 앱 로그에 미리보기 세션·중계 줄이 없다 | 사용자(로그 확인) | 0줄 |

## 18. 결정된 질문(2026-10-22, 사용자 위임으로 추천안 확정)

| # | 질문 | 확정 | 이유·다시 볼 조건 |
|---|---|---|---|
| Q1 | 세션을 여는 시점 | **편집 화면 안 [영상 보기]를 누를 때**(RE7) | D66 "누르기 전 요청 0"을 그대로 잇고, 칸만 고치는 사용자의 요청·게이트 호출이 0이다. 사용자가 "열 때 바로 보고 싶다"고 하면 열 때 `watch_open`(자동재생 없음)으로 바꾼다 |
| Q2 | 닫기·Esc의 확인 | **묻지 않는다**(RE17) | 잃는 것은 초안뿐이다. M-RE-8에서 놀람이 보이면 "초안이 바뀌었을 때만" 확인 대화상자를 더한다 |
| Q3 | 일반 VOD·클립 미리보기 | **지금 섹션 유지**(RE14) | 구간이 없는 카드다. 섹션을 지우면 확인 수단이 사라진다. 편집 화면으로 보내면 쓸모없는 타임라인이 열린다 |
| Q4 | 네이티브 controls | **유지**(RE9) | 음량·전체 화면·속도를 다시 만들지 않는다. 보기·탐색 중복은 받아들인다 |
| Q5 | 진입 단추와 hls.js 지원 | **카드 종류·소유로만 판정, hls.js는 화면 안 상태로**(RE8) | 지원 여부는 import 뒤에 안다. 칸 편집은 영상 없이 된다 |
| Q6 | 결합 전 조작 줄 | **그리고 `disabled`**(RE8) | 창 전체 화면이라 줄이 사라지면 영상 높이가 흔들린다(PS Q6의 "그리지 않음"과 다른 이유: 카드에서는 소음, 여기서는 배치) |
| Q7 | 끌기 중 확대·가장자리 이동 | **범위 고정, 자동 이동 없음**(RE13) | 좌표가 끌기 중 바뀌지 않아 값이 튀지 않는다. M-RE-8 |
| Q8 | 반복 토글 문구 | **기존 "구간 반복하기"**(RE20) | 기본형 "-기"와 DC11. 시안의 "구간 반복"은 명사형이다 |
| Q9 | 툴팁 | **네이티브 `title`**(RE18) | IconButton 계약 그대로. 새 Tooltip 컴포넌트는 후속 |
| Q10 | 휠 세로 | **이동**(사용자 결정 4). 확대돼 있지 않거나 끝이면 처리하지 않는다 | 바깥 스크롤을 막지 않는다 |
| Q11 | 따라가기 | **쪽 넘김**(넘으면 왼쪽 10% 자리로) | 연속 스크롤은 손잡이·눈금을 계속 움직여 읽기 어렵다 |
| Q12 | 화면 밖 손잡이 포커스 | **포커스만으로는 옮기지 않고, 값 변경·누름에서 옮긴다**(RE12) | Tab으로 지나갈 때 화면이 튀지 않는다 |
| Q13 | 레이어 vs 새 뷰 | **카드 소유 레이어**(RE1) | 카드 상태 보존 |
| Q14 | [받기] 때 구간 검증 | **지운다**(§5.2) | `applied`는 적용 때 검증된 값이다 |

## 19. 적대적 재검토 반영(작성자 자기 검토, 2026-10-22)

초안을 "이대로 구현하면 어디서 틀리나"로 다시 읽고 빠진 엣지를 본문에 넣었다. Codex 리뷰 대응도 함께 적는다.

| # | 빠졌던 것·지적 | 판정 | 반영 |
|---|---|---|---|
| A1 | Codex 시안 2 ②·시안 6 ②: 닫기·적용의 값 처리, 검증 시점, 전체·오류 상태 | 수용 | RE2·RE3·RE6, §5.2 표, RE-3 시험 6~9 |
| A2 | Codex 시안 2 ③·시안 6 ①: 화면 열림과 확정 구간 분리(D66 PS9 뒤집음) | 수용 | RE2, §2, §5.1, RE-3 시험 6·변이 |
| A3 | Codex 시안 2 ④·시안 6 ③: 결합 전·실패·네이티브 대체, 세션 열기·닫기, 포커스 복귀 | 수용 | RE7·RE8, §5.4·§5.5, §10 |
| A4 | Codex 시안 6 ④: 확대하면 끝 손잡이가 DOM에서 사라짐, ARIA 경계 고정 | 수용 | RE12, §7.4, RE-4 시험 3·6 |
| A5 | Codex 시안 6 ⑤: toolbar 방향키 충돌, Esc 범위 | 수용 | RE16·RE18, §9.1 표 |
| A6 | Codex 시안 6 ⑥: 휠 계약 | 수용 | RE11, §7.3, RE-1 시험 10, RE-4 시험 7 |
| A7 | Codex 시안 6 ⑦: 확대·끌기·따라가기 우선순위, 공통 변환 | 수용 | RE10·RE13, §7.1·§7.7 |
| A8 | Codex 시안 2 ⑦·시안 6 ⑪: [보기]가 일반 보기인지, 음량·전체 화면 위치 | 수용 | RE9·RE21, §8.2 |
| A9 | Codex 시안 2 ⑩: 빈칸·오류 보드 | 수용 | §5.2, 갤러리 `editor-error` |
| A10 | Codex 시안 6 ⑧: 다크 트랙 위 선택 경계 대비 미달 | 수용 | §7.8(`--accent-ink`, 대비 쌍 추가) |
| A11 | Codex 시안 6 ⑨: 720×520 확대에서 조작 줄 부족 | 수용 | §6.2 표(row 380 > video 340), §6.3 |
| A12 | Codex 시안 6 ⑩: 범위 막대 `aria-controls`·누름 영역 | 수용 | §7.5 |
| A13 | Codex 시안 6 ⑫: 아이콘 허용 목록·툴팁 | 수용 | RE18·RE19, §12.3 |
| A14 | 길게 누른 Esc가 편집 화면을 닫은 뒤 반복 keydown이 카드까지 닫는다 | 수용 | RE16, RE-3 시험 13 |
| A15 | 편집 화면이 열린 동안 Mod+Enter가 뒤의 카드에서 옛 구간으로 받기를 시작한다. Mod+,가 설정으로 가며 카드를 언마운트한다. 붙여넣기·드롭이 새 주소를 불러온다 | 수용 | RE15, §9.2, RE-3 시험 14 |
| A16 | 레이어가 열린 동안 LiveAnnouncer가 `inert` 아래라 알림이 읽히지 않는다 | 수용 | §6.1(화면 안 alert만, 적용 알림은 레이어가 떨어진 뒤) |
| A17 | 대화상자(CloseGuard 등)가 편집 화면 위에 뜰 때의 층·inert 복원 | 수용 | §6.1 |
| A18 | 카드가 갑자기 사라질 때(잠금·`{#key}`) `ui.rangeEditorOpen`이 `true`로 남아 단축키가 영영 막힌다 | 수용 | §5.1(attach 정리에서 내림), RE-3 시험 4 |
| A19 | 카드 [구간 지우기]가 사라지며 포커스가 `body`로 떨어진다 | 수용 | RE5, RE-3 시험 10 |
| A20 | 편집 화면 [구간 지우기]를 비활성으로 두면 누른 직후 포커스를 잃는다 | 수용 | RE6 |
| A21 | `effectiveRange`의 올림 끝 때문에 카드 요약이 1초 길어 보인다, 다시 열 때 끝 칸이 시각으로 채워진다 | 수용 | §5.3 내림 표시, RE4 `draftOf`, RE-1 시험 14·15 |
| A22 | 길이 미상 + 영상 길이는 앎: 검증 기준이 둘이면 Rust와 어긋난다 | 수용 | §5.2(meta만 기준) |
| A23 | `+`가 Shift를 동반해 "수식 키면 무시"에 걸린다 | 수용 | §9.1 주석, RE-5 시험 7 |
| A24 | 휠이 처리하지 않은 경우에도 `preventDefault`하면 좁은 레이아웃·큰 글자에서 화면 스크롤이 막힌다 | 수용 | §7.3 4, RE-4 시험 7 |
| A25 | 시안의 760px 미디어 쿼리는 DL13 위반, 380 최소폭은 320에서 가로 스크롤 | 수용 | §6.3 |
| A26 | 막대 길이가 meta → video로 바뀌면 초 단위 `view`가 새 L을 넘을 수 있다 | 수용 | §5.5(전체로 되돌림), RE-4 시험 12 |
| A27 | 확대 키·휠이 칸 안에서 글자 입력을 막는다 | 수용 | §9.1(칸은 기본), §7.3 5(칸에 리스너 없음) |
| A28 | 손잡이와 칸이 같은 이름("시작 시각")이다 | 수용(기록) | 역할이 달라(slider/textbox) 구별된다. `aria-controls`로 관계를 단다(§7.4). M-RE-6 |
| A29 | 기존 Playwright·갤러리가 섹션 클릭·`range.toggle`류를 쓴다 | 수용 | §3.1 e2e 행, RE-3 시험 21~23 |
| A30 | 빠른 다시보기 시험을 지우면 `tests.vitest` ratchet이 준다 | 수용 | §13 마지막 항목(옮긴다) |
| A31 | 시안의 실제 같은 제목·길이·날짜 | 수용 | 머리말(가짜 값), 갤러리 고정 데이터도 가짜 |
| A32 | "재생"이 patterns·components 문서에 새로 들어갈 수 있다(DC1) | 수용 | §11 금지어 항목 |
| A33 | RE-3을 예시대로 마지막에 배선하면 중간 PR이 앱 경로로 검증되지 않는다 | 수용 | §14.1 순서의 이유 |
| A34 | 결합 전 조작 줄 `disabled` 단추는 포커스·툴팁이 닿지 않는다 | 수용(기록) | §8.1. 결합 전 할 수 있는 일은 표지 자리 [영상 보기]이고 그것이 Tab 순서 첫 자리다 |
| A35 | 반복이 켜진 채 사용자가 구간 밖으로 가면 토글은 켜져 보이는데 반복하지 않는다 | 수용(기록) | §8.2(다음 보기 시작에서 다시 건다). M-RE-8에서 혼동이 보이면 "밖으로 가면 토글도 끔"으로 바꾼다 |

## 20. 검토 반영(2026-10-22, 외부 검토 두 건)

UX·접근성·디자인 시스템 렌즈 검토(ux, 22건)와 계획 정합 검토(plan, 18건)를 지적마다 이 트리의 파일을 열어 확인했다. 모두 맞아 수용했고 기각은 없다. 겹치는 지적은 짝으로 적었다(ux2↔H1, ux6↔L3, H3↔M9). 사용자 확정 결정(시안 7 배치, [닫기]/[구간 적용하기], 휠 규칙, [구간 반복] 토글, 카드 진입점)은 바꾸지 않았다. 열린 판단은 위임대로 추천안으로 정했다(ux7: 패널 머리 단추 대신 눈금 두 번 누르기·엄지 가장자리).

| # | 지적 | 확인한 근거 | 판정 | 반영 |
|---|---|---|---|---|
| ux1 | Mod+Enter 한 번이 적용과 [받기]를 함께 일으킬 수 있다(깃발이 microtask로 먼저 내려감), jsdom 시험으로는 못 잡는다 | `ResolveCard.svelte:394-401`(`!e.defaultPrevented`만 봄) | 수용 | RE15(뿌리 늘 `preventDefault`+`stopPropagation`, 카드는 `defaultPrevented` 주 근거), §3.1·§9.1·§9.2, RE-3 시험 14(Playwright `enqueue` 0), §13 |
| ux2 | 층이 역순으로 닫히지 않으면 앱 전체가 inert로 남는다 | `Dialog.svelte:131-145`(이전 값 복원), `:24-40`(슬롯 대기열은 대화상자끼리) | 수용(= H1) | RE1(공용 `modalLayer` 필수, 층 스택·다시 계산), §3.1, §6.1, RE-3 시험 4·변이·바뀌는 파일 |
| ux3 | 길게 누른 Esc가 두 층을 닫아 초안을 잃는다 | `Dialog.svelte:155-162`(`e.repeat` 안 봄) | 수용 | RE16 (0)·Dialog·창 처리기 공통, §9.1, patterns 새 규칙, RE-3 시험 13, RE-4 시험 5 |
| ux4 | [구간 편집…]이 DC5에서 실패한다 | `scripts/design/copy.mjs` DC5(`opensWindow`), `terms.json:912`, content.md §6.3 "`action.*` 끝" | 수용 | §10, §12.5(`opensWindow`·§5.2 예시·§6.3 문장), RE-3 내용·바뀌는 파일 |
| ux5 | coarse에서 조작 줄 380이 모자라 넘친다(448 필요) | `tokens.css:241-249`(`--control-h` 40) | 수용 | §6.2 `CONTROLS_MIN_W` = `calc(7 × --control-h + 184px)`(380/464), 720×520 coarse 행, §12.3, RE-1 시험 12, RE-5 시험 10·12(720×520 확대 크기) |
| ux6 | 범위 막대 엄지에 최소 폭이 없다 | 계산(20초/10800초/800px ≈ 1.5px) | 수용(= L3) | §7.5 엄지 폭·끌기 식, RE-1 시험 12a, RE-4 시험 9 |
| ux7 | 포인터 하나로 확대할 수 없다(WCAG 2.5.1) | RE11·사용자 결정 4 | 수용(추천안) | §7.2 표(눈금 두 번 누르기 ×2, 두 탐색이 같은 자리라 무해), §7.5 엄지 가장자리 끌기, 시안과 달라진 점, D67·ADR-0030 대안 표(머리 단추는 결정 3을 바꿔 버림), §11 `rangeEditor.timeline.keys`, RE-4 시험 8·9·14, M-RE-8 |
| ux8 | 흐림이 눈금 글자를 덮어 대비 미달, 띠 바깥 손잡이의 대비 쌍 없음 | `Editor7.dc.html:120-130`(흐림 `top: 0`, 손잡이가 띠 바깥) | 수용 | §7.8(흐림은 트랙 줄만, 손잡이는 시안대로 바깥, 쌍 둘 추가, "필요 없다" 문장 삭제), 시안과 달라진 점, RE-4 시험 13·15 |
| ux9 | sticky 머리가 포커스를 가린다(WCAG 2.4.11) | §6.3 | 수용 | §6.3 `scroll-padding-top`, RE-3 시험 22, §13 |
| ux10 | 머리 단추 배치가 ADR-0005와 어긋나는데 예외 기록이 없다 | `adr/0005-dialog-button-placement.md` 결정 표(오른쪽 끝 = 안전, "닫기" 단독 금지) | 수용 | §12.1 D67 항목(ADR-0005 범위 밖: 시트형 편집기, 사용자 결정 1), ADR-0030 결정 절·대안 표 |
| ux11 | 12px `--fg-muted` 글자가 혼자 뜻을 전한다(부제·눈금) | foundations.md §3 허용 목록 | 수용 | §6.1(부제 `--fg` + `aria-describedby`), §7.8·§12.3(눈금·트랙 이름을 허용 목록에 근거와 함께) |
| ux12 | 반복 토글 켜짐이 면 색 차이 하나뿐이다 | `tokens.css:45-46`(약 1.24:1) | 수용 | RE20(켜짐에 1px `--border-strong`, D67 결정), §7.8, §12.2, RE-5 시험 12 |
| ux13 | forced-colors 빈칸(켜짐 2px 윤곽 = 포커스 모양, chevron `currentColor`, §2.7 행 없음) | components.md 부록 5(라디오 1px `Highlight`), foundations.md §2.7·R9, `RangeTimeline.svelte:245-269` | 수용 | §7.8 forced 문단(켜짐 `Highlight` 면 + `HighlightText`, chevron `HighlightText`), §12.2·§12.3(§2.7 행 교체), RE-4 시험 15 |
| ux14 | W1 위반: "막대" | `ko.ts`에 "막대" 0건, §11 용어집 행 | 수용 | §11 `uncoupled`·`noLength` 문구를 "타임라인"으로, 용어집 쓰지 않는 말에 "막대" |
| ux15 | 용어집에 지운 낱말이 남는다 | content.md:111(`terms.json` 같은 행) | 수용 | §12.5(RE-5에서 "구간 반복하기(토글 단추)" 하나로), RE-5 바뀌는 파일 |
| ux16 | 근거 등급 표기가 governance와 어긋난다 | `governance.md:336` | 수용 | §12.1(`결정자: 사용자, 2026-10-22`, 등급 없음) |
| ux17 | "시안과 달라진 점" 목록이 불완전하다 | `Editor7.dc.html:31-32`(stage 색·#0E0E0E), `:42`(스타일 툴팁), `:125`(띠 3px) | 수용 | 머리말 목록에 넷(+흐림 범위·포인터 확대) 추가 |
| ux18 | 720 창 시간 영역 폭 계산이 틀렸다 | `Editor7.dc.html:170`(트랙 = W − 104) | 수용 | §7.2 `MIN_VIEW_SECS` 근거(856·616px, 43·31px) |
| ux19 | 확대 키 `+`·`-`·`0`을 찾을 길이 없다 | §10·§11 | 수용 | §10 시간 영역 `aria-keyshortcuts`(철자는 [가정], RE-4 axe), §11 `rangeEditor.timeline.keys` |
| ux20 | I/O 수신 범위가 바뀌었는데 적지 않았다 | `WatchPanel.svelte:451-455` | 수용 | §9.1 첫 항목(의도한 변경과 이유) |
| ux21 | M-RE-2가 IME(`keyCode` 229)를 다루지 않는다 | `ui/focus.ts:18-20` | 수용 | §9.1 주석, §17 M-RE-2 통과 기준 |
| ux22 | 기본 레이아웃에서 넘치면 잘리고, 좁은 레이아웃은 RO 순환 | `tokens.css:208`·`:241`, §6.2 식 | 수용 | §6.1·§6.2·§6.3(모든 레이아웃 `overflow-y: auto`, 좁으면 폭에서만 16:9), RE-1 시험 12 |
| H1 | inert 복원 순서(ux2와 같다) | `Dialog.svelte:131-145` | 수용(= ux2) | ux2와 같다 |
| H2 | 포커스가 `body`면 키가 뿌리를 지나지 않아 Esc가 카드를 닫는다 | `GlobalShortcuts.svelte:11-17`, `ui.svelte.ts:36-58`, `Dialog.svelte:180` | 수용 | RE1(뿌리 `tabindex=-1`), RE16(사다리 맨 안쪽 처리기, 끌기·전체 화면에도 `true`), §9.1(결합이 풀리면 포커스를 h1로), §9.2, RE-3 시험 12 |
| H3 | 대표 흐름에서 반복·따라가기가 걸리지 않는다(단추 위 Space, 네이티브 controls) | `WatchPanel.svelte:536-545`(`onplay` 없음) | 수용(= M9) | §1.3 5단계, §7.7, §8.2(`play` 이벤트 한 곳, `playByUs` 표식), RE-5 시험 5·11·변이 |
| H4 | RE-4가 RE-5 산출물에 기댄다 | `IconButton.svelte:8`·`vocab.ts:44`(유니온 타입), `WatchPanel.svelte:564-569` | 수용 | [전체 보기] 허용 목록 행·아이콘, `hint`, `shortcut.hint.label`, `zoomMod`를 RE-4로(§11·§12.2·§12.3·§14.1·RE-4 바뀌는 파일), RE-4 시험 11의 [구간 처음으로] → RE-5 시험 4, 시험 14의 380 → RE-5 시험 11 |
| M1 | `monitorSize` 적용 시점이 어긋나 RE-3 "릴리스 가능" 근거가 약하다 | §6.3·§12.2·§14.1 | 수용 | `monitorSize` 적용과 `overflow-y: auto`를 RE-3으로(§14.1, RE-3 시험 19a·22), RE-5는 조작 줄 폭만(시험 10), RE-3 gate에 `design-tokens` |
| M2 | 열림 조건 변이를 시험 6이 못 잡는다 | `ResolveCard.svelte:125`, `receive.test.ts:122` | 수용 | RE-3 시험 6(`previewOpen = false` 행)·변이 |
| M3 | 세션 닫기 횟수가 단계마다 다르다 | `WatchPanel.svelte:202-205`·`:291-304` | 수용 | §5.4 표를 단계별로, RE-3 시험 6 |
| M4 | 메뉴 경로에 시험이 없고 [가정]은 확인된다 | `App.svelte:74-75` | 수용 | RE15·§3.1·§9.2 [확인], RE-3 시험 14·바뀌는 파일 |
| M5 | 전체 화면 Esc를 "처리 안 함"으로만 적어 창 처리기가 카드를 닫는다 | `GlobalShortcuts.svelte:14`(미디어 대상만 건너뜀) | 수용 | RE16 (2) `stopPropagation`만, §9.1, RE-3 시험 12(카드도 그대로) |
| M6 | "meta→video" 전환은 일어나지 않는다 | `rangeEdit.ts:22-26`, `WatchPanel.svelte:186` | 수용 | §5.5(실제 전환 셋, 규칙 하나), RE-4 시험 12 |
| M7 | 확대 뒤 축소해도 부동소수 오차로 확대가 남는다 | §7.2 휠 배율 `exp` | 수용 | §7.1 `clampView` `SNAP_SECS`, §7.5 `valuenow` 0 나눔, RE-1 시험 1·5 |
| M8 | 좌표 기준 요소와 `narrow` 출처가 없다 | §6.1 이름 칸 64, DL13 | 수용 | §7.4(트랙 칸 rect), §6.2(`layout.css`의 `--layout-narrow`를 `getComputedStyle`로), RE-4 시험 9 |
| M9 | 네이티브 controls로 보면 따라가기가 안 켜진다(H3과 같다) | 같다 | 수용(= H3) | §7.7 |
| L1 | 휠 px → 초 식이 없다 | §7.2·§7.3 | 수용 | §7.2 `panBy` 행, RE-1 시험 6 |
| L2 | 눈금 간격이 바닥나는 경우가 없다 | §7.6 | 수용 | §7.6(2시간의 정수배), RE-1 시험 9 |
| L3 | 엄지 최소 폭(ux6과 같다) | — | 수용(= ux6) | ux6과 같다 |
| L4 | `L = Infinity`·`L < minSpan` 경계가 불변식과 충돌한다 | RE10, §7.1 | 수용 | RE10 불변식 `min(minSpan, L)`, §7.1 유한하지 않은 L → `{0, 0}`, RE-1 시험 1 |
| L5 | RE-1 gate 열과 완료 조건이 맞지 않는다 | §14.1, RE-1 완료 조건 | 수용 | RE-1 gate에 `e2e-web`·`design-shots` |

- 구현 결과는 RE-6에서 §21로 적는다.
