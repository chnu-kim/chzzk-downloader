# 미리보기 구간 편집 UX 1단계: 명세

**상태·확정 결정(2026-10-20)**: **설계, 적대적 검토 2종 반영(§15), 열린 질문 없음(§14).** 사용자 결정(2026-10-20)은 받기 전 미리보기의 구간 찍기 UX를 컷 편집 서비스 수준으로 올리는 것이다. 1단계 범위는 다음 여섯이다.
- (1) 구간 막대에 선택 구간을 색으로 칠하고 시작·끝 손잡이를 끌어 고친다. 키보드와 화면 낭독기로도 조작한다(슬라이더 역할).
- (2) [구간 보기]·구간 반복하기, [시작부터 보기].
- (3) 키보드: I/O로 시작·끝 찍기, ←/→로 몇 초 이동, 스페이스로 재생/일시정지. Esc와 전역 단축키와 충돌하지 않는다.
- (4) 시작·끝 ±1초 미세 조정.
- (5) 시각 칸(`RangeField`)과 영상을 양방향으로 잇는다.
- (6) 선택 길이와 예상 크기를 보인다.

2단계(썸네일 줄)는 범위 밖이다. 구간 받기는 빠른 다시보기(hls.js 경로)만이라는 계약(preview.md PV17, range.md R3)은 그대로다.

구현은 TDD로 한다. 실패 테스트를 먼저 쓰고, 최소 구현으로 녹색을 만든다(§10·§11). 상태 규칙은 순수 함수 하나(`rangeEdit.ts`)에 모아 표 테스트로 고정하고, 컴포넌트는 그 함수를 부르기만 한다.

기준 트리는 `feat/preview-ux` `5060ea0`(preview.md PV-1~PV-8 위, M-PV-5 통과 기록)이다. 형식과 근거 표기는 `preview.md`를 따른다.
- **[확인]**: 이 트리에서 직접 연 줄이 받친다.
- **[가정]**: 코드로 확인하지 못한 판단이다. 일반 지식이나 설계 선택이다.
- **[실측 필요]**: 3 OS 웹뷰나 보조기술로만 정할 수 있다(§13 M-PVU-*).
- **[잠정]**: 숫자 상수다. 근거가 약하고 실측으로 조인다.

예시 값(시각·길이)은 모두 가짜 값이다. 공개 저장소 규칙을 따른다.

---

## 0. 핵심 결정(요약)

| # | 결정 | 근거 |
|---|---|---|
| PVU1 | **네이티브 `controls`는 그대로 둔다.** 재생·일시정지·탐색·음량·전체 화면은 지금처럼 웹뷰가 맡는다. 구간 막대는 `<video>` 아래에 따로 둔다. 그래서 ADR-0027 결정 2(네이티브 컨트롤)와 components.md §2.29 규칙 ①은 뒤집지 않고 ADR-0028이 덧붙이기만 한다 | 자체 재생 막대로 바꾸면 전체 화면·음량·자막·접근성 상태를 모두 직접 책임진다(지도 market "위험 요약"). 유튜브 스튜디오의 다듬기도 재생기는 자기 컨트롤을 두고, 그 아래에 다듬기 막대를 따로 둔다(YouTube 도움말 9057455) [확인: 지도]. `<video controls>`(`WatchPanel.svelte:192-202`) [확인] |
| PVU2 | **일반 VOD·클립 미리보기는 1단계에서 바뀌지 않는다.** 사용자 요구는 "공통 컴포넌트면 함께"였다. PVU1로 재생 막대를 새로 만들지 않으므로 공통으로 나눌 재생 막대가 없다. 구간 막대·조작 줄은 `markable && usingHls && metaReady`일 때만 그린다 | 찍기 조건 `markable && usingHls`(`WatchPanel.svelte:203`) [확인]. `markable = tone === 'rewind'`(`ResolveCard.svelte` WatchPanel 배치) [확인]. 일반 VOD·클립은 구간을 받지 않는다(R3) |
| PVU3 | **"구간 편집 보기"는 모드 전환이 아니라 배치로 한다**(D65, §5). 빠른 다시보기 카드에서 구간 줄(`RangeField`)을 화질 아래에서 **미리보기 줄 바로 아래로 옮긴다**(접혀 있을 때도 같은 자리). 미리보기를 펼치면 영상 → 구간 막대 → 조작 줄 → 구간 줄(시각 칸·±1초·선택 길이)이 한 덩어리로 이어진다. 화질·폴더·이름은 숨기지 않는다. 모달(Dialog)과 새 View는 쓰지 않는다 | 문제의 뿌리는 영상(위)과 시각 칸(화질 아래) 사이에 화질 행이 낀 것이다(지도 market "카드 높이 예산"). ADR-0027은 모달을 이미 버렸다(포커스 가둠·Esc 처리가 늘고 화질과 번갈아 보기 어렵다) [확인: 지도]. 숨기는 모드 전환은 `inert`·`hidden` 상태, RangeField 다시 마운트(오류 `$effect`가 마운트 때 포커스를 빼앗는다, `RangeField.svelte:64-70`) [확인]가 따른다. 배치만 바꾸면 `<video>`도 RangeField도 다시 만들어지지 않는다 |
| PVU4 | 구간 막대는 기능 컴포넌트 `receive/RangeTimeline.svelte`다(`ui/` 아님). 손잡이 둘은 `<div role="slider" tabindex="0">`다. `ui/` 갤러리 매트릭스 대상이 아니고 화면 갤러리 장면으로 본다 | 쓰는 곳이 한 곳이다(governance §5 진입 심사, `governance.md:392-400`) [확인: 지도]. DS1 금지 목록에 `role="slider"`가 없다(`governance.md:158`) [확인]. 앱에 슬라이더 선례가 없다(`app/src` grep 0건) [확인: 지도] |
| PVU5 | **상태의 원천은 시각 칸 두 문자열(`rangeStart`·`rangeEnd`)과 `rangeOpen` 그대로다.** 손잡이·±1초·키는 순수 함수로 새 칸 문자열을 만들어 카드에 돌려준다. `effectiveRange`·`rangeError`·검사 열쇠·`enqueue`는 바꾸지 않는다. 새 DTO·command·Rust 변경은 없다 | 지금 구간은 문자열 상태 하나로 흐른다(`ResolveCard.svelte` `rangeInput`→`effectiveRange`→`key`·`sizeSecs`) [확인]. `markRange`(PV-7)도 같은 방식이다 [확인] |
| PVU6 | 시간 단위는 **정수 초**다. 손잡이 값, 키 이동, ±1초는 모두 정수 초다. ms는 `receive.ts` 경계(`parseClock`)에서만 쓴다. 시작은 `[0, 끝−1]`, 끝은 `[시작+1, floor(길이)]` 안으로 자른다(최소 간격 1초) | `parseClock`은 ms, `formatClock`은 초를 받는다(`duration.ts:22`, `:89`) [확인]. `rangeError`는 `e <= s`이면 `order`, `s >= ceil(d)`이면 `beyond`다(`receive.ts:151-163`) [확인]. 그래서 간격 0은 오류이고 시작 최댓값은 `floor(d)−1`이면 충분하다 |
| PVU7 | 막대 길이는 **`meta.durationSecs`가 있으면 그것**이다. 칸 초깃값과 `effectiveRange`가 같은 값을 쓴다. 없으면 `video.duration`(유한할 때)을 쓰고, 이때 끝 손잡이가 맨 끝이면 끝 칸에 시각 대신 **빈 문자열(끝까지)**을 쓴다. 둘 다 없으면 막대를 그리지 않는다(찍기·조작 줄은 남는다) | `initialEnd`는 `durationSecs`가 없으면 `''`다(`ResolveCard.svelte` 초깃값) [확인]. 빈 끝 칸은 끝까지다(`receive.ts` `effectiveRange`) [확인]. 끝 칸이 `floor(d)` 이상이면 전체(올림)까지다(`receive.ts:174-176`) [확인]. 그래서 끝 손잡이를 맨 끝까지 끌면 메타가 있을 때 `formatClock(floor(d))` → 전체 받기가 된다 |
| PVU8 | **처음 고치는 순간의 규칙**(`beginEdit`): 구간 줄이 접혀 있을 때(`rangeOpen = false`) 손잡이·±1초·키로 고치면, 먼저 두 칸을 전체 값(`0:00:00`, 초깃값 끝)으로 되돌린 뒤 그 하나만 바꾸고 `rangeOpen = true`로 한다. 접힌 동안 막대는 칸 값이 아니라 전체 구간을 보여 준다(보이는 것이 받는 것) | 접힌 구간 줄은 적용되지 않는다(`rangeInput.open`) [확인]. 접기는 칸 값을 지우지 않는다 [확인: `ontoggle`은 `rangeErr`만 지운다]. 그래서 접힌 채 옛 값이 남아 있을 수 있다 |
| PVU9 | **찍기(I/O, [시작 찍기]·[끝 찍기])는 PV-7 그대로 "그 시각을 그 칸에 넣는다"**이다. 다른 칸을 몰래 고치지 않고, 끝을 시작보다 앞에 찍으면 [받기] 때 순서 오류다. 단 PVU8은 찍기에도 적용한다(접힌 채 찍으면 다른 칸이 전체 값으로 돌아간다). 순서가 뒤집힌 동안(또는 시작이 길이 이상인 동안, `band = false`) 막대는 선택 띠를 그리지 않고 손잡이 둘만 그린다. **이 동안 두 손잡이의 경계는 모두 `[0, floor(len)]`이고, 움직인 손잡이는 다른 손잡이로 자르지 않는다**(검토 반영 V4). 순서가 바로 서면(`band = true`) 서로 제한하는 PVU6 경계로 돌아간다 | PV17·app.md 114 (나) [확인]. 기존 시험 `끝을 시작보다 앞에 찍으면 [받기]에서 순서 오류가 난다`(`receive.test.ts` 1350-1470) [확인]이 그대로 통과한다 |
| PVU10 | 손잡이를 끌거나 키로 움직이면 영상도 그 손잡이 시각으로 간다. 끌기 중에는 칸 값만 바꾸고, **놓을 때 한 번** 탐색한다. 키 조작은 누를 때마다 탐색한다. 시각 칸 → 영상은 **칸에서 포커스가 나갈 때(blur)** 그 칸이 읽히고 **포커스를 받은 때의 값과 다를 때만** 탐색한다(Tab으로 지나가기만 하면 탐색하지 않는다). 포커스가 **편집 영역 컨테이너 자신이나 손잡이**로 옮겨 가는 blur(`relatedTarget`이 그 셋 중 하나)는 탐색하지 않는다: 막대 누름과 손잡이 누름은 각자 탐색하므로 그쪽이 이긴다. 그 밖(조작 줄 단추·Switch·`<video>`·±1초)으로 옮겨 가면 탐색한다. 타이핑 중에는 움직이지 않는다. **손잡이·키·±1초·칸 blur로 생긴 탐색은 먼저 구간 보기 모드를 끈다**(§6.3, 검토 반영 V6). 탐색 목표는 `WatchPanel.seek`이 `[0, video.duration]`으로 한 번 더 자른다(검토 반영 V11) | `TextField`의 `onchange`는 글자마다 불린다(`TextField.svelte` `handleInput`) [확인]. 그래서 "바뀔 때마다 탐색"은 `0:10`(M:SS로 읽힘) 같은 중간 값에서 튄다. `<input>`의 Enter 분기는 DX6이 금지한다(`governance.md:282`) [확인] |
| PVU11 | [구간 보기]는 시작으로 가서 재생하고 끝에서 일시정지한다. 구간은 `start ≤ t < end`(끝 제외)이고 `t ≥ end`인 첫 `timeupdate`가 끝이다. "구간 반복하기"(Switch)가 켜져 있으면 끝에서 시작으로 돌아간다. [시작부터 보기]는 시작으로 가서 재생만 한다(끝에서 멈추지 않는다). 끝 판정은 `timeupdate`(약 4Hz)로 하고, 끝이 영상 끝이면 `ended`로 한다. 사용자가 일시정지하거나 구간 밖으로 탐색하면 구간 보기에서 빠진다(§6.3 표) | 끝 넘침은 한 번의 `timeupdate` 간격(약 0.25초) [가정]이다. 받을 때 조각 경계로 앞뒤 한 조각 미만이 넓어진다(약 2초, range.md:47) [확인: 지도]. 그래서 프레임 정밀도는 의미가 없다. `requestAnimationFrame`은 쓰지 않는다 |
| PVU12 | 키보드는 **편집 영역(영상 + 막대 + 조작 줄)의 `onkeydown` 하나**가 받는다. window에 달지 않는다. 대상이 `<video>`이면 **I/O만** 처리하고 Space·←/→·Esc는 네이티브 몫으로 둔다(재생을 누르면 포커스가 보통 `<video>`에 있어서다). I/O는 `e.code`(`KeyI`·`KeyO`)로 받고 수식 키가 있으면 무시한다. **I/O가 듣는 대상은 손잡이·편집 영역 컨테이너·`<video>`·[시작 찍기]·[끝 찍기]뿐이다**(구간 보기 단추·시작부터 보기 단추·Switch에서는 듣지 않는다, WCAG 2.1.4 "포커스가 있을 때만"을 대상 단위로 좁힘, 검토 반영 V12). 찍기 단추는 `aria-keyshortcuts`를 달므로 그 단추 위에서 I/O가 동작해야 거짓 안내가 아니다. Space·←/→ 등은 **Alt·Ctrl·Meta가 눌렸으면 처리하지 않는다**(Shift만 허용, 검토 반영 V13). 카드가 busy(`disabled`)면 **칸을 바꾸는 키(I/O·손잡이 키)는 무시**하고 Space·재생 위치 ←/→는 그대로 둔다(칸을 바꾸지 않는다, 검토 반영 V20). 입력칸·`<video>`·단추·Switch 위의 Space/Enter는 건드리지 않는다. Esc는 받지 않고, `GlobalShortcuts`는 대상이 미디어 요소이거나 `[data-local-keys]` 안이면 카드를 닫지 않는다(§7). **키 범위는 편집 영역뿐이다.** 구간 줄(시각 칸·±1초)은 영역 밖의 일반 폼 행이라 그곳의 Esc는 지금처럼 카드를 닫는다(검토 반영 V9) | 한글 자판에서 `e.key`는 `ㅑ`·`ㅐ`다 [가정]. Esc 예외는 지금 `HTMLMediaElement`뿐이다(`GlobalShortcuts.svelte:18`) [확인]. 창 단축키는 Esc·Mod+L·Mod+,뿐이다(`:14-37`) [확인]. 키 처리기가 있는 파일은 `isImeKey`를 import한다(DX6) [확인] |
| PVU13 | 단축키는 **보조**다. 모든 동작에 단추가 있다([시작 찍기]·[끝 찍기]·[구간 보기]·[시작부터 보기]·구간 반복하기·±1초). 1단계에서 단추 옆 `Kbd` 힌트는 두지 않고, 찍기 단추에 `aria-keyshortcuts`를 달며 `patterns.md` §8 표에 적는다(도움말은 §12 후속, 검토 반영 V18) | patterns §8 규칙 1(모든 동작에 버튼) [확인]. `Kbd` 글자는 `platform.md` §6 표와 `shortcutText`로만 오고(DC9), `SHORTCUT` 표는 paste·submit·devtools뿐이다(`platform.ts:14-19`) [확인]. 글자 `I` 하나짜리 값은 DC11 "식별자만인 값"에 걸릴 수 있다(`copy.mjs:838-840`) [확인]. 힌트는 Q4 |
| PVU14 | 문구는 **"보기" 계열**이다. "재생"은 문구 전체 금지어라 쓰지 않는다: [구간 보기], [시작부터 보기], 스위치 "구간 반복하기", ±1초 단추 [1초 당기기]·[1초 미루기]. 일시정지는 네이티브 컨트롤 몫이라 새 문구가 없다 | `terms.json` 패턴 `"재생"`, glossary "완성 파일 열기" avoid "재생", "정지"(일시 제외)·"멈춤"·"중단" 금지 [확인]. DC1 범위는 copy deck·`help/*.md`·`patterns.md`·`web.md`(preview.md §6.3) [확인]. 스위치 이름은 "`-기`로 끝나는 명사구"(`content.md` §5.1 스위치 행), 버튼은 "동사 어간 + 기"(같은 표 기본형) [확인]. "돌아가기"는 avoid 패턴(`terms.json` "창·카드·오류를 닫는 일"), `-해서` 연결은 금지라 "구간 끝에서 처음으로 돌아가기"·"구간 반복해서 보기"는 쓰지 않는다 [확인] (검토 반영 V10) |
| PVU15 | 위치는 **`style:--p` 디렉티브만** 쓴다. 손잡이 둘과 재생 위치 표시가 각자 자기 `--p`(0~1)를 갖는다. 선택 띠는 두 겹이다: "끝까지 채움"(`--p` = 끝) 위에 "시작 앞 가림"(`--p` = 시작, 트랙 색). 너비는 `calc(var(--p) * 100%)`, 손잡이는 너비 0 앵커 안에서 flex로 가운데 둔다(`translate(-50%)` 없음). 새 커스텀 속성 이름·새 `style:` 디렉티브는 없다 | DL7은 `--p` 말고 선언을 막고(`lint.mjs:434`), DS2는 `style:--p` 말고 디렉티브를 막는다(`lint.mjs:709`) [확인]. 둘 다 파일을 가리지 않는다 [확인]. DL2는 `px` 글자만 본다(`lint.mjs:470-485`) [확인]. DL11은 정지 상태 `transform`을 `scaleX(`·spinner만 빼고 막고, `translate(-50%`를 막는다(`lint.mjs:487-499`) [확인] |
| PVU16 | 새 토큰은 **되도록 두지 않는다.** 막대 두께 `--progress-h`, 손잡이·막대 누름 영역 `--hit-min`, 손잡이 보이는 폭 `--space-4`·높이 `--control-h-sm`, 간격 `--space-8`로 짠다. 기존 조합으로 안 되는 치수가 나오면 그 PR에서 `--range-*` 접두를 세 곳(foundations §1 표, `check-tokens.mjs` `DIMENSION_PROPS`, `spec-check.mjs` 접두)에 더하고 ADR-0028에 적는다 | `--hit-min` 24/40, `--progress-h` 6, `--control-h-sm` 24/40(`foundations.md:437-453`) [확인]. `DIMENSION_PROPS` 목록(`check-tokens.mjs:411`) [확인]. ADR-0027이 `watch`를 같은 세 곳에 더한 선례(app.md 110 (라)) [확인] |
| PVU17 | 선택 길이는 구간 줄 아래 한 줄이다: "구간 길이: {길이}"와 알면 "· {예상 크기}"(용어집에 없는 "선택"을 새로 쓰지 않고 기존 `range.label` "구간"을 쓴다, W1, 검토 반영 V10). 길이는 `rangeSecs(effectiveRange)` 또는 접힘이면 영상 길이, 크기는 지금 고른 화질의 `qualitySize`다. 끝을 모르면(길이 없음 + 끝 칸 빈칸) 줄을 그리지 않는다 | `rangeSecs`(`receive.ts:183`)·`qualitySize`(`receive.ts:95`, `formatEstimate`가 "약"을 붙인다, `bytes.ts:128-131`) [확인]. 화질 행 "약 N GB"는 이미 구간 기준이다(`sizeSecs`) [확인] |
| PVU18 | 선택 길이·예상 크기는 **요청한 구간** 기준이다. 실제 받는 구간은 조각 경계로 조금 넓다는 안내는 기존 `range.help`("앞뒤로 몇 초 더 받을 수 있어요.") 하나로 한다 | `ko.ts:76` [확인]. 크기는 "약"(추정)이다 |

## 1. 목표와 범위

### 1.1 목표
- 빠른 다시보기에서 받을 구간을 **영상을 보면서** 고르고, 고친 값이 곧바로 영상과 칸에 함께 보인다.
- 마우스·키보드·화면 낭독기 어느 쪽으로도 같은 일을 할 수 있다.
- 기본 흐름(붙여넣기 → [받기])에는 단계를 하나도 더하지 않는다(range.md §1.1, README P3).

### 1.2 하지 않는 것
- 썸네일 줄(2단계).
- 자체 재생 막대로 네이티브 컨트롤 바꾸기(PVU1, §12 후속).
- 일반 VOD·클립의 구간(R3), 네이티브 m3u8 대체 경로의 구간(PV17·Q9).
- 길이 하한·상한. 우리는 완성 파일을 받는 다운로더라 range.md 계약(제한 없음)을 유지한다(지도 market "뺄 것").
- J/K/L 변속, 프레임 단위 이동, 분할·중간 컷, 구간 여러 개.
- 막대 확대(zoom). 긴 영상(수 시간)에서 끌기 정밀도는 낮고, 정밀은 ±1초·키·시각 칸이 맡는다.

### 1.3 사용자 흐름
1. 빠른 다시보기 주소를 불러오면 카드가 열린다. 메타 줄 아래에 접힌 "미리보기" 줄과, **그 바로 아래**에 접힌 "일부만 받기" 줄이 있다(PVU3). 그 아래가 화질·폴더·이름이다.
2. "미리보기"를 펼치면 영상이 뜬다. hls.js로 붙고 메타데이터를 읽으면 영상 아래에 구간 막대와 조작 줄([시작 찍기]·[끝 찍기] · [구간 보기]·[시작부터 보기] · 구간 반복하기)이 나온다.
3. 막대에는 재생 위치 표시와 시작·끝 손잡이가 있다. 처음에는 전체 구간이다.
4. 손잡이를 끌거나, 손잡이에 포커스를 두고 ←/→를 누르거나, I/O를 누르면 "일부만 받기"가 펼쳐지고 칸이 바뀐다(PVU8·PVU9). 영상이 그 시각으로 간다(PVU10).
5. "일부만 받기" 줄의 칸 옆 [1초 당기기]·[1초 미루기]로 미세하게 고친다. 칸을 손으로 고치고 다른 곳을 누르면 영상이 그 시각으로 간다.
6. 칸 아래에 "구간 길이: 0:01:30 · 약 120 MB"처럼 길이와 크기가 보인다(가짜 값).
7. [구간 보기]로 확인한다. "구간 반복하기"를 켜면 계속 돈다.
8. [받기]는 지금과 같다. 검증도 지금처럼 [받기] 때 한다.
9. 미리보기를 접으면 막대·조작 줄이 사라지고 "일부만 받기"는 그대로 남는다(값 유지).

## 2. 실측 근거

M-PV-5 통과(2026-10-20, 사용자): hls.js 경로에서 찍은 시작·중간·끝 세 시각이 받은 파일과 조각 경계 넓힘 안에서 맞았다. 그래서 구간 막대도 같은 `currentTime` 시간축을 쓴다. 새 실측은 §13이다.

## 3. 기존 결정과의 관계

| 기존 | 이 기능에서 | 근거 |
|---|---|---|
| ADR-0027 결정 2 네이티브 `controls` | 그대로다(PVU1) | `WatchPanel.svelte:194` [확인] |
| ADR-0027 모달 버림 | 그대로다. 편집 보기는 카드 안 배치다(PVU3) | 지도 design·market [확인: 지도] |
| PV17 찍기는 hls.js 경로·빠른 다시보기만 | 막대·조작 줄도 같은 조건이다(PVU2) | `WatchPanel.svelte:203` [확인] |
| 구간 검증은 [받기] 때만(patterns §6.1) | 그대로다. 막대·±1초는 순서가 바로 선 상태에서 틀린 값을 만들지 않는다(PVU6). 손으로 친 칸과 찍기만 [받기] 때 검증한다. **손잡이·±1초로 칸을 고치면 앞 [받기]가 남긴 구간 오류(`rangeErr`)를 지운다**(검토 반영 V14). 찍기는 지금처럼 오류를 남긴다(시험 `찍어도 앞 [받기]가 남긴 구간 오류는 지워지지 않는다`, `receive.test.ts:1460`, 범위는 찍기뿐) | `ResolveCard.svelte` `download()` [확인] |
| 구간 줄은 화질 아래(patterns §6.5, range.md §5) | 미리보기 줄 바로 아래로 옮긴다(PVU3). 접힌 카드 높이는 같다 | §5.3 |
| Esc 순서: 불러오기 취소 → 카드 닫기 → 대화상자 → 설정에서 뒤로 | 순서는 그대로다. 편집 영역 안 Esc는 아무것도 닫지 않는다(PVU12). 지금은 [시작 찍기]·[끝 찍기] 위 Esc가 카드를 닫는데 이것이 바뀐다. 이유: 편집 영역은 영상·손잡이와 한 묶음이라 영상 위 Esc(P9 예외)와 같은 묶음 안에서 결과가 갈리지 않게 하고, 끌기·키 조작 중 Esc 실수로 카드와 미리보기 세션(재생 위치)을 잃지 않게 한다(Q8). 구간 줄은 영역 밖이라 그대로다 | `patterns.md` §8 표, `GlobalShortcuts.svelte:16-21` [확인] |
| `--p`는 진행 막대 하나의 예외 | 같은 이름을 구간 막대에서도 쓴다. 문서 예외 범위를 ADR-0028이 넓힌다(PVU15) | `components.md` §2.20, governance DL7·DS2 [확인] |
| "재생" 금지 | 그대로다(PVU14) | `terms.json` [확인] |

## 4. 코어·셸 변경

없다. 새 DTO·command·bindings·Rust 변경이 없다(PVU5). 가짜 백엔드(`app/e2e/mock/backend.ts`)의 command도 바뀌지 않는다.

## 5. 앱 변경

### 5.1 순수 모델 `app/src/lib/rangeEdit.ts`(새 파일, PVU-1)

컴포넌트는 이 함수만 부른다. DOM·Svelte·`t()`를 import하지 않는다(`formatClock`·`parseClock`만). 모든 함수는 정수 초를 다룬다.

```ts
export type Handle = 'start' | 'end';
export interface Fields { open: boolean; start: string; end: string } // = receive.ts RangeInput

/** 막대 길이(PVU7). meta가 있으면 meta, 없으면 유한한 video.duration, 둘 다 없으면 null */
export function timelineLength(metaSecs: number | null, videoSecs: number | null): { secs: number; source: 'meta' | 'video' } | null;

/** 막대에 그릴 선택(PVU8·PVU9). 접힘이면 전체. 칸을 못 읽으면 그 손잡이는 끝값(0 또는 길이). 두 값은 [0, floor(len)]로 자른다.
 *  순서가 뒤집혔거나(start ≥ end) 시작이 길이 이상이면 band=false */
export function selection(f: Fields, len: number): { start: number; end: number; band: boolean };

/** 손잡이 하나의 슬라이더 경계(aria-valuemin/max, 검토 반영 V4). band면 PVU6(서로 제한), 아니면 둘 다 [0, floor(len)] */
export function handleBounds(h: Handle, sel: { start: number; end: number; band: boolean }, len: number): { min: number; max: number };

/** 막대 위 비율 ↔ 초. 0..1로 자르고 초는 내림 */
export function fractionOf(secs: number, len: number): number;
export function secsAt(fraction: number, len: number): number;

/** 손잡이 값 자르기(PVU6): other가 수면 start ∈ [0, other−1], end ∈ [other+1, floor(len)].
 *  other가 null이면(band=false, PVU9) [0, floor(len)]만. len < 2면 null(고칠 수 없음). 소수 secs는 내림 */
export function clampHandle(h: Handle, secs: number, other: number | null, len: number): number | null;

type Mods = { shift: boolean; alt: boolean; ctrl: boolean; meta: boolean };
/** 키 → 손잡이 이동(APG): ←/↓ −1, →/↑ +1, Shift는 ×10, PageDown/PageUp ∓60, Home/End는 'min'/'max'.
 *  Alt·Ctrl·Meta 중 하나라도 있으면 null(검토 반영 V13). 그 밖은 null */
export function handleKey(key: string, mods: Mods): number | 'min' | 'max' | null;

/** 키 → 재생 위치 이동(편집 영역, 손잡이 밖): ←/→ ∓5. Shift·Alt·Ctrl·Meta가 있으면 null. 그 밖은 null */
export function seekKey(key: string, mods: Mods): number | null;

/** 손잡이 하나를 secs로 옮긴 뒤의 새 칸(PVU6·PVU7·PVU8·PVU9). 접힘이면 다른 칸을 전체 값으로 되돌리고 open=true.
 *  자르기는 selection(f).band가 참이면 다른 손잡이로, 거짓이면 [0, floor(len)]만(clampHandle other=null) */
export function moveHandle(f: Fields, h: Handle, secs: number, len: { secs: number; source: 'meta' | 'video' }, initialEnd: string): Fields | null;

/** ±n초(PVU6, 검토 반영 V15). len은 카드의 막대 길이(없으면 null: 끝 상한 없이 시작만 끝−1로 묶는다).
 *  고칠 칸을 못 읽으면 null(단추 비활성). 순서가 뒤집혔으면 그 칸만 [0, floor(len)](len null이면 [0, ∞))로 자른다 */
export function nudge(f: Fields, h: Handle, delta: number, len: { secs: number; source: 'meta' | 'video' } | null, initialEnd: string): Fields | null;

/** 찍기(PVU9): 그 칸에 formatClock(floor(t))만 넣는다(자르지 않음). 접힘이면 다른 칸을 전체 값으로 */
export function mark(f: Fields, h: Handle, t: number, initialEnd: string): Fields;

/** 칸 → 영상(PVU10): 읽히면 그 초(길이로 자름), 아니면 null. 빈 끝 칸은 null(이동 없음) */
export function seekTargetOf(text: string, len: number): number | null;

/** 구간 보기 한 걸음(PVU11, §6.3 표) */
export type PlayMode = 'off' | 'range' | 'loop';
export function playStep(mode: PlayMode, ev: { kind: 'time' | 'ended' | 'pause' | 'seeked'; t: number; byUs: boolean }, sel: { start: number; end: number; toEnd: boolean }):
  { mode: PlayMode; action: 'none' | 'pause' | 'restart' };

/** 우리 탐색 표시(검토 반영 V6). 우리가 currentTime을 쓸 때 목표를 남기고, 다음 seeked가 |t − target| ≤ 0.5이면 byUs=true로 한 번 쓰고 버린다.
 *  pause는 우리가 pause()를 부르기 직전에 세운 깃발로 같은 방식(한 번 쓰고 버림) */
export function consumeOwnSeek(pending: number | null, t: number): { byUs: boolean; pending: null };

/** 끝이 영상 끝인가: 끝 칸이 빈칸(끝까지)이거나 end ≥ floor(len) */
export function reachesEnd(sel: { end: number }, endText: string, len: number): boolean;
```

- `formatClockLong(secs)`(`format/duration.ts`에 더함): `1시간 2분 3초`, `2분 0초`가 아니라 `2분`, `0초`. 손잡이 `aria-valuetext`용이다. `formatSpan`은 한 시간이 넘으면 초를 버려 손잡이 값을 정확히 읽지 못한다(`duration.ts:11-20`) [확인].
- 끝 칸 텍스트: `source === 'video'`이고 끝이 `floor(len)`이면 `''`(끝까지), 아니면 `formatClock(end)`.

### 5.2 `receive/RangeTimeline.svelte`(새 기능 컴포넌트, PVU-2)

```ts
type RangeTimelineProps = {
  length: number;                 // 막대 길이(초, 정수 아님 허용)
  start: number; end: number;     // 손잡이 값(초, selection() 결과)
  band: boolean;                  // 선택 띠를 그리는가
  position: number;               // 재생 위치(초)
  disabled?: boolean;             // 카드 busy
  onmove: (h: 'start' | 'end', secs: number, phase: 'drag' | 'commit') => void;
  onseek: (secs: number) => void; // 막대(손잡이 밖)를 눌렀을 때
};
```

- **해부**(검토 반영 V1·V7): 막대(`.track`, 누름 영역 높이 `--hit-min`, 보이는 두께 `--progress-h`, 바탕 `--track`) 안에 선택 띠 두 겹(`.upto-end` **`--accent`** → `.before-start` `--track`), 재생 위치 표시(`.position`, 너비 0 앵커 + `border-inline-start: 2px solid var(--fg)`, **높이는 트랙 두께 `--progress-h`만**: `width: 2px`는 DL2에 걸린다), 손잡이 둘(`.thumb`, 너비 0 앵커 + 안쪽 보이는 막대 `--space-4`×`--control-h-sm`, 면 `--accent`, 테두리 1px `--surface`, **대괄호 모양**: 시작 손잡이는 `[`(세로 막대의 위·아래 끝에서 짧은 턱이 구간 쪽인 오른쪽으로 나온다), 끝 손잡이는 `]`(턱이 왼쪽으로). 턱은 막대 위·아래 끝의 `border-block`으로 그리고 길이는 `--space-4`). 위치는 PVU15.
  - 띠를 `--accent-soft`로 칠하면 트랙 대비가 라이트 1.06·다크 1.35라 1.4.11(3:1)에 못 미친다 [확인: foundations §2.3 값으로 계산]. `--accent`는 트랙 위 4.28·3.60으로 이미 있는 쌍이다(foundations §2.4 `accent / track`) [확인].
  - 손잡이는 트랙(6)보다 높아(24/40) 위·아래로 튀어나온 부분이 카드 `--surface` 위에서 보인다(`accent / surface` 5.24·3.09, 기존 쌍). 띠 안에서는 손잡이 테두리와 턱 모양, 띠 밖으로 튀어나온 부분으로 구별한다.
  - 재생 위치 `--fg`가 띠 위에 놓일 때 `fg / accent`는 라이트 3.29·다크 3.74다(계산). 이 쌍을 `design/tokens/contrast.tokens.json`에 "상태 표시" 3:1 행으로 더한다(DT8, PVU-2). 재생 위치는 트랙 두께 안에만 있고 손잡이는 트랙 밖으로 튀어나오므로 **높이와 턱 모양**이 둘을 가른다(색만이 아니다, WCAG 1.4.1).
- **손잡이 = 슬라이더**: `role="slider"`, `tabindex="0"`, `aria-label`은 `range.start`·`range.end`(기존 키), `aria-valuemin`·`aria-valuemax`는 `handleBounds`(band면 서로를 제한하는 APG multi-thumb, band가 아니면 둘 다 `[0, floor(len)]`, 검토 반영 V4), `aria-valuenow`는 정수 초, `aria-valuetext`는 `formatClockLong`. 그래서 `valuenow`가 늘 `[valuemin, valuemax]` 안이고 min ≤ max다. `disabled`면 `aria-disabled="true"`이고 조작을 무시한다(포커스는 닿는다). **Tab 순서는 DOM 순서로 시작 → 끝 고정이다.** 순서가 뒤집힌 동안에는 끝 손잡이가 시작 손잡이보다 왼쪽에 그려질 수 있지만 Tab 순서는 바꾸지 않는다(이름이 "시작 시각"·"끝 시각"이라 읽기 순서와 맞다).
- **누름 영역**(검토 반영 V2): 각 손잡이의 누름 영역(폭 `--hit-min`)은 **앵커에서 바깥쪽으로만** 편다. 시작은 앵커 왼쪽, 끝은 앵커 오른쪽이다. 그래서 두 손잡이가 붙어 있어도(1초 간격, 막대에서 1px 미만) 누름 영역이 겹치지 않는다. band가 아닐 때(뒤집힘)도 같은 규칙이다(그때는 두 영역이 서로 마주 보는 쪽으로 펴질 수 있으나 각 영역은 자기 손잡이 하나에만 속한다. 겹친 곳은 DOM 뒤의 끝 손잡이가 받는다: 뒤집힌 상태는 찍기로만 생기는 드문 상태이고 키·칸으로 고칠 수 있다).
- **끌기**: 손잡이 `pointerdown` → `setPointerCapture` → `pointermove`마다 `onmove(h, secsAt(x), 'drag')` → `pointerup`에 `'commit'`. 막대에 `touch-action: none`. `wheel`·`contextmenu`는 쓰지 않는다(DX4). 끌기 중 영상 미리 탐색(스크러빙)은 1단계에 없다(§12, 검토 반영 V16).
- **막대 누름**(손잡이 밖): `onseek(secsAt(x))`만 부른다. 손잡이 값은 바꾸지 않는다. **포커스를 코드로 옮기지 않는다**(검토 반영 V8). 막대는 포커스를 받지 않으므로 누르면 브라우저가 가장 가까운 포커스 가능 조상인 편집 영역 컨테이너(`tabindex="-1"`)로 포커스를 준다. 그래서 막대를 누른 뒤에도 I/O·Space·←/→가 동작한다. 컨테이너에는 `data-focus-container`를 달지 않는다: 키를 받는 조작 대상이라 전역 포커스 링 규칙(`:focus-visible`)을 그대로 받는다(포인터로 누른 경우는 브라우저 휴리스틱상 보통 링이 없다).
- **키**: 손잡이 `onkeydown`이 `handleKey` → `clampHandle`(other는 band면 다른 손잡이, 아니면 null) → `onmove(h, v, 'commit')`, `preventDefault`. 첫 줄 `isImeKey`.
- **색만으로 전하지 않는다**: 손잡이 모양(트랙 밖으로 튀어나온 `[`·`]`)과 구간 줄의 시각 칸·구간 길이 글자가 함께 있다.
- **움직임**: 전환 없음(값은 데이터다, P5). 호버 효과 없음(D21). 눌림은 손잡이 `:active`에서 **면을 `--accent-pressed`로 채운다**(foundations §1 규칙 6 "눌림은 채움", 면이 `--accent`인 컨트롤의 짝은 `--accent-pressed`, 검토 반영 V17). 다크 `accent-pressed / surface`는 2.29라 눌린 순간에는 튀어나온 부분의 대비가 3:1 아래다. 눌림은 포인터를 쥔 동안만의 일시 상태이고 위치는 턱 모양·테두리로 남으므로 참고 행으로만 적는다(foundations §2.4의 "참고값" 행 선례).
- `cursor`·`user-select`는 쓰지 않는다(DX2, D25).

### 5.3 배치(PVU-3)

`ResolveCard.svelte`:
- 빠른 다시보기 카드의 순서를 바꾼다: 메타 → `WatchPanel`(있으면) → `RangeField` → `.fields`(화질 → 폴더 → 이름). `RangeField`는 `{#if tone === 'rewind'}` 그대로이고 `.fields` 앞으로 나온다. 인스턴스는 하나이고 미리보기를 펼치거나 접어도 다시 마운트되지 않는다.
- **`len`의 주인은 카드다**(검토 반영 V15). 카드가 `timelineLength(view.meta.durationSecs, videoSecs)`로 막대 길이를 만든다. `videoSecs`는 `WatchPanel`이 `onduration(secs | null)`로 알린다(`loadedmetadata`·`durationchange`, 접기·실패에서 null). 그래서 미리보기가 닫혀 있어도 ±1초(`nudge`)가 같은 `len`(meta만 있으면 meta, 없으면 null)을 쓴다.
- `WatchPanel`에 넘기는 것이 는다: `fields`(`{open, start, end}`), `len`, `initialEnd`, `onfields(next: Fields, cause: 'handle' | 'mark')`(카드가 세 상태에 쓰고, `'handle'`이면 `rangeErr`도 지운다, 검토 반영 V14), `onduration`, 그리고 `bind:this`로 `seek(secs)`를 부를 수 있다. `seek`은 구간 보기 모드를 끄고(§6.3) 목표를 `[0, video.duration]`으로 자른다(검토 반영 V11).
- `markRange`는 `rangeEdit.mark`를 거친다(PVU9, `cause = 'mark'`: 오류를 지우지 않는다).
- `RangeField`에 `onfocusfield(field)`·`onblurfield(field, relatedTarget)`(PVU10: 카드가 포커스 때 값을 기억하고, 바뀌었고 `relatedTarget`이 편집 영역 컨테이너·손잡이가 아닐 때만 탐색), `nudge`(±1초 단추, PVU-5, 누르면 `rangeErr`를 지운다), `lengthText`(PVU17, PVU-5)를 더한다.
- 카드가 열려 있는 동안 스크롤 영역 `.main`에 sticky 바닥 줄 높이만큼 `scroll-padding-bottom`을 둔다(검토 반영 V3). 토스트가 떠 있으면 두 값을 더한다(`.main.has-toast`의 값을 덮어쓰지 않는다, `App.svelte:197-200`) [확인]. 바닥 줄 높이는 `calc(var(--control-h) + 2 * var(--space-12) + 1px)`(ui.css `.card-footer` 패딩·윗줄) [가정: 버튼 높이 `--control-h`].

`WatchPanel.svelte`(ready + `markable && usingHls`일 때):
```
<div class="editor" role="group" aria-label={watch.editor.a11y} tabindex="-1" data-local-keys onkeydown>
  <video controls …>                    ← 그대로(편집 영역 안으로 들어간다)
  {#if metaReady && len}<RangeTimeline …/>{/if}
  <div class="controls">  [시작 찍기] [끝 찍기] · [구간 보기] [시작부터 보기] · Switch 구간 반복하기  </div>
</div>
```
(`data-focus-container` 없음, 검토 반영 V8.)
- 조작 줄은 지금의 `.marks` 줄을 넓힌 것이다(`flex-wrap: wrap`, 간격 `--space-8`). 320 폭에서는 두 줄로 접힌다.
- 재생 위치는 `timeupdate`·`seeked`에서 `video.currentTime`을 읽어 갱신한다.

**높이 예산**(patterns.md §15 "높이 520" 행):
- 접힌 카드: 바뀌지 않는다. 순서만 바뀐다.
- 그런데 지금 표의 문장은 빠른 다시보기 카드를 "미리보기 줄이 없는 카드"로 적고 구간 줄(24 + 간격)도 세지 않는다. PV-6이 빠른 다시보기에 미리보기 줄을 더한 뒤 고치지 않았다(`patterns.md:863`) [확인]. PVU-3이 이 행을 고친다: 빠른 다시보기 = 506 + 미리보기 줄 36 + 구간 줄 36 [가정: `.range` `margin-block: var(--space-12)` + Disclosure 24, `RangeField.svelte:112-114`] = **578** [잠정, 갤러리 측정으로 확정].
- 펼친 미리보기: 영상(최대 `--watch-max-h` 360) + 막대 24 + 8 + 조작 줄 24(지금 찍기 줄 자리) + 8. 지금 찍기 줄 +32에 막대 **+32**가 더해진다.
- **960×700 계산(검토 반영 V3, 확정)** [잠정: 갤러리로 조인다]: 위쪽(툴바·입력 120 + 카드 머리~메타 약 122 + 미리보기 줄 36) 278 → 영상(열 800 − 카드 패딩 32 = 768 폭, 16:9면 432라 상한 360) 638 → 막대 670 → 조작 줄 **702**. 바닥 줄(약 52)이 sticky로 그 위를 덮으므로 **첫 화면에는 영상과 막대 위쪽까지 들고 조작 줄은 한 번 스크롤해야 보인다.** 그래서 목표를 "첫 화면에 다 든다"에서 "**영상이 첫 화면에 들고, 막대·조작 줄·구간 줄로 Tab하면 바닥 줄에 가리지 않는다**"로 바꾼다(WCAG 2.4.11, patterns F-7과 같은 종류: 위 `scroll-padding-bottom`). 편집 중 `--watch-max-h`를 줄이는 안은 버린다: 960×700이 아닌 큰 창에서도 영상이 작아지고, 새 토큰 또는 상태별 치수가 생긴다(PVU16).
- 520에서 [받기]는 지금처럼 sticky 바닥 줄로만 보인다. M-PVU-5는 위 목표로 본다.

### 5.4 키보드(PVU-4)

편집 영역 `onkeydown`(첫 줄 `isImeKey`; `e.defaultPrevented`면 무시; 대상이 `editable()`이면 무시):

| 키 | 대상 | 동작 | 막는 기본 동작 |
|---|---|---|---|
| I (`KeyI`, 수식 없음) | `<video>`·손잡이·컨테이너·[시작 찍기]·[끝 찍기] | 시작 찍기(= [시작 찍기]). busy면 무시 | 예 |
| O (`KeyO`, 수식 없음) | 같다 | 끝 찍기. busy면 무시 | 예 |
| I·O | 구간 보기·시작부터 보기 단추·Switch | 처리하지 않는다(검토 반영 V12) | 아니오 |
| Space(수식 없음) | 손잡이·컨테이너 | 재생 ↔ 일시정지(`video.paused`로 판정). `<video>` 위는 네이티브 몫 | 예(스크롤) |
| Space·Enter | 단추·Switch | 건드리지 않는다(단추를 누른다) | 아니오 |
| ←/→ (Shift ×10), ↑/↓, PageUp/PageDown, Home/End(Alt·Ctrl·Meta 없음) | 손잡이 | 손잡이 이동(`handleKey`), 영상도 그 시각으로(구간 보기 모드는 꺼진다). busy면 무시 | 예 |
| ←/→(수식 없음) | 단추·Switch·컨테이너 | 재생 위치 ∓5초(`seekKey`) [잠정] | 예 |
| Alt·Ctrl·Meta + Space·화살표 | 어디든 | 처리하지 않는다(창·OS 몫, Alt+←/→는 `guards.ts`가 먼저 막는다) | 아니오 |
| Esc | 편집 영역 안 어디든 | 아무것도 하지 않는다(카드를 닫지 않는다) | 아니오 |
| 그 밖(Mod+Enter·Mod+L·Mod+,) | — | 지금처럼 창 처리기로 간다 | — |

- `<video>` 위에서는 I/O만 우리가 받고 나머지 키는 네이티브 처리 그대로다. `<video>`의 keydown이 감싼 요소로 버블되는지(네이티브 컨트롤이 막지 않는지)는 [가정 → M-PVU-7]이다. 버블되지 않으면 I/O는 영상 밖 포커스에서만 동작하고 단추가 대신한다(PVU13).
- **문서로 옮길 때 "재생"을 쓰지 않는다.** 이 표의 "재생 ↔ 일시정지"는 설계 문서 표기다. `patterns.md` §8·§15(DC1 대상)에는 "영상 보기 ↔ 일시정지"처럼 적는다.
- `GlobalShortcuts`: Esc 분기를 `e.target instanceof HTMLMediaElement || (e.target instanceof Element && e.target.closest('[data-local-keys]'))`로 넓힌다. `editable()`을 `ui/focus.ts`로 옮겨 편집 영역과 함께 쓴다.
- 단추의 `aria-keyshortcuts`: [시작 찍기] `I`, [끝 찍기] `O`(속성 값은 한글이 아니라 DS6과 무관하다).

### 5.5 양방향·미세 조정·길이(PVU-5)

- **칸 → 영상**: `RangeField`가 칸 `onblur`에 `onblurfield(field)`를 부른다. 카드가 `seekTargetOf(text, len)`이 숫자면 `watch.seek(secs)`. 미리보기가 닫혀 있거나 메타데이터 전이면 아무것도 하지 않는다.
- **영상 → 칸**: 찍기·손잡이(지금 있음 + PVU-3).
- **칸 → 영상 조건**(검토 반영 V5): 칸 `onfocus`에 값을 기억하고, `onblur`에서 (1) 값이 바뀌었고 (2) `relatedTarget`이 편집 영역 컨테이너(`[data-local-keys]` 요소 자신)나 손잡이(`role="slider"`)가 아니고 (3) `seekTargetOf`가 숫자일 때만 탐색한다. 칸에 포커스가 있는 채 막대를 누르면 `pointerdown`의 `onseek`이 먼저 돌고 이어지는 blur는 (2)에 걸려 탐색하지 않으므로 누른 위치가 이긴다.
- **±1초**: 각 칸 오른쪽에 `[1초 당기기] [1초 미루기]`(`Button size=sm`, 검토 반영 V10). 접근 이름은 "시작 시각 1초 당기기" 꼴이고 보이는 글자를 포함한다(WCAG 2.5.3). 칸을 못 읽거나 `busy`면 비활성. 누르면 `nudge` → 칸(앞 [받기]의 구간 오류를 지운다), 미리보기가 열려 있으면 영상도 그 시각으로(구간 보기 모드는 꺼진다).
- **좁은 폭**(검토 반영 V23): 칸 하나와 그 칸의 두 단추를 한 묶음(`.clock-group`, `flex-wrap: nowrap` 안쪽 + 바깥 `flex-wrap: wrap`)으로 둔다. 320 폭에서는 시작 묶음과 끝 묶음이 두 줄로 접히고 칸과 그 단추는 떨어지지 않는다. `~` 구분은 시작 묶음 끝에 붙인다. 갤러리 320×231 장면에 펼친 구간 줄을 더한다.
- **구간 길이**: 구간 줄 Disclosure 안, 칸 줄 아래 caption 한 줄(PVU17). `aria-live` 없음(값이 바뀔 때마다 읽으면 시끄럽다). 길이는 `formatClock`(구간 칸과 같은 표기).

## 6. 상태 모델

### 6.1 원천과 파생

| 값 | 주인 | 비고 |
|---|---|---|
| `rangeOpen`·`rangeStart`·`rangeEnd`(문자열) | `ResolveCard` | 유일한 원천(PVU5) |
| `videoSecs` | `WatchPanel` → `onduration` | `loadedmetadata`·`durationchange`에서 유한한 `video.duration`, 접기·실패에서 null |
| `len` | `ResolveCard`(`timelineLength(meta, videoSecs)`) | 미리보기가 닫혀도 meta가 있으면 있다(검토 반영 V15) |
| `selection`·`handleBounds` | `WatchPanel` 파생 | `selection(fields, len)` |
| 칸 포커스 때 값 | `ResolveCard` | blur 탐색 비교용(PVU10) |
| `position` | `WatchPanel` | `timeupdate`·`seeked` |
| `playMode` | `WatchPanel` | `'off'`·`'range'`·`'loop'`, 접기·실패·다시 열기, 그리고 `seek()`(손잡이·키·±1초·칸)에서 `'off'` |
| 우리 탐색 목표·우리 일시정지 깃발 | `WatchPanel` | `consumeOwnSeek`(§5.1), 한 번 쓰고 버린다 |
| 구간 반복하기 스위치 | `WatchPanel` | 카드마다 새로 시작(기억하지 않음) |

### 6.2 손잡이 규칙 표(PVU-1 표 테스트의 원천)

len = 600(meta), initialEnd = `0:10:00`.

| 입력 | 동작 | 결과 칸 | open |
|---|---|---|---|
| open, 0:01:00~0:05:00 | start → 120 | 0:02:00~0:05:00 | true |
| open, 0:01:00~0:05:00 | start → 400 | 0:04:59~0:05:00(끝−1) | true |
| open, 0:01:00~0:05:00 | end → 30 | 0:01:00~0:01:01(시작+1) | true |
| open, 0:01:00~0:05:00 | end → 9999 | 0:01:00~0:10:00(→ `effectiveRange` 전체 끝) | true |
| open, 0:01:00~0:05:00 | start → −5 | 0:00:00~0:05:00 | true |
| closed, 0:03:00~0:04:00(옛 값) | start → 60 | 0:01:00~**0:10:00** | **true** |
| open, `abc`~0:05:00 | start → 60 | 0:01:00~0:05:00(못 읽은 칸은 0으로 보고 자름) | true |
| open, 0:01:00~`abc` | start → 60 | 0:01:00~`abc`(끝을 len으로 보고 자름, 끝 칸은 건드리지 않음) | true |
| len = 1 | 무엇이든 | `null`(고칠 수 없음) | — |
| meta 없음, video 599.6 | end → 9999 | 끝 칸 `''`(끝까지) | true |
| meta 없음, video 599.6 | end → 300 | `0:05:00` | true |
| 찍기 open, 0:05:00~0:06:00 | mark end t=65.9 | 0:05:00~0:01:05(순서 뒤집힘, 자르지 않음) | true |
| 찍기 closed, 0:03:00~0:04:00 | mark start t=10.2 | 0:00:10~0:10:00 | true |
| open, 0:05:30~0:01:05(뒤집힘) | start → 331(→ 한 번) | 0:05:31~0:01:05(다른 손잡이로 자르지 않음, 튀지 않음) | true |
| open, 0:05:30~0:01:05(뒤집힘) | end → 66(→ 한 번) | 0:05:30~0:01:06 | true |
| open, 0:05:30~0:01:05(뒤집힘) | end → 400 | 0:05:30~0:06:40(순서가 바로 섬 → 다음부터 서로 제한) | true |
| open, 0:05:30~0:01:05(뒤집힘) | start → 9999 | 0:10:00~0:01:05(`[0, floor(len)]`만) | true |
| open, 0:12:00~0:13:00(둘 다 len 넘음) | end → 30 | 0:12:00~0:00:30(band=false라 [0, 600]만) | true |

`selection`·`handleBounds` 표(같은 len = 600):

| 칸 | selection | 시작 min/max | 끝 min/max |
|---|---|---|---|
| open, 0:01:00~0:05:00 | 60·300·band | 0 / 299 | 61 / 600 |
| open, 0:05:30~0:01:05 | 330·65·**no band** | 0 / 600 | 0 / 600 |
| open, 0:12:00~0:13:00 | 600·600·no band | 0 / 600 | 0 / 600 |
| open, 0:01:00~`''` | 60·600·band | 0 / 599 | 61 / 600 |
| closed(무엇이든) | 0·600·band | 0 / 599 | 1 / 600 |

`clampHandle` 표(정수 초, 검토 반영 V21):

| h | secs | other | len | 결과 |
|---|---|---|---|---|
| start | 120 | 300 | 600 | 120 |
| start | 400 | 300 | 600 | 299 |
| start | −5 | 300 | 600 | 0 |
| start | 12.7 | 300 | 600 | 12 |
| end | 30 | 60 | 600 | 61 |
| end | 9999 | 60 | 600 | 600 |
| end | 9999 | 60 | 599.6 | 599 |
| start | 331 | null | 600 | 331 |
| end | −1 | null | 600 | 0 |
| start | 0 | 599 | 600 | 0(`floor(len)` = 시작+1 경계) |
| 무엇이든 | — | — | 1.9 | null |

### 6.3 구간 보기 표(`playStep`)

sel = {start 60, end 90, toEnd false}. 구간은 `60 ≤ t < 90`(끝 제외). `toEnd`는 `reachesEnd`(끝 칸이 빈칸이거나 end ≥ floor(len)).

`byUs`는 `consumeOwnSeek`로 정한다(검토 반영 V6): 우리가 `currentTime`을 쓸 때(시작·restart) 목표를 남기고, 다음 `seeked`가 목표와 0.5초 안이면 `byUs=true`로 한 번 쓰고 버린다. `pause`도 우리가 `pause()`를 부르기 직전에 세운 깃발로 같은 방식이다. **손잡이·키·±1초·칸 blur의 탐색은 `WatchPanel.seek()`을 거치고, `seek()`은 탐색 전에 `playMode = 'off'`로 만든다.** 그래서 그 탐색은 이 표에 닿지 않는다(구간을 고치는 동안 restart·pause가 끼어들지 않는다, 검토 반영 V6).

| mode | 사건 | 결과 mode | 동작 |
|---|---|---|---|
| range | time 89.8 | range | none |
| range | time 90(= end) | off | pause |
| range | time 90.1 | off | pause |
| loop | time 90.1 | loop | restart(→ 60, 재생 유지) |
| range·loop | time 59.9(시작 앞, 재생 중) | 그대로 | none(seeked가 아닌 time은 구간 밖 판정을 하지 않는다) |
| range·loop | pause(byUs=false, 사용자) | off | none |
| range·loop | seeked 30(구간 밖, byUs=false) | off | none |
| range·loop | seeked 90(= end, 구간 밖, byUs=false) | off | none |
| range·loop | seeked 75(구간 안, byUs=false) | 그대로 | none |
| range·loop | seeked 60(byUs=true, 시작·restart) | 그대로 | none |
| range | ended(toEnd=true) | off | none |
| loop | ended(toEnd=true) | loop | restart |
| range·loop | ended(toEnd=false: meta 길이가 실제 영상보다 길어 끝 전에 끝남) | off | none |
| off | 무엇이든(우리가 끝에서 부른 pause 포함) | off | none |

(옛 행 "range | pause(byUs=true)"는 바로 앞 time 행에서 이미 `off`가 되어 닿지 않으므로 지우고 마지막 행으로 덮는다. byUs=true는 목표(늘 구간 시작)와 0.5초 안이라는 뜻이라 "byUs=true인데 구간 밖" 행도 두지 않는다.)

- [구간 보기]: "구간 반복하기" 스위치에 따라 `range`/`loop`로 들어가고 `currentTime = start`(우리 탐색 목표를 남긴다) → `play()`. 끝이 이미 지났거나 band가 false(순서 뒤집힘)면 단추는 비활성이다.
- [시작부터 보기]: `mode = 'off'`, `currentTime = start` → `play()`.
- `play()`가 거부되면(Promise reject) 모드를 `'off'`로 되돌린다 [가정: 웹뷰 자동재생 정책은 사용자 제스처 안이라 통과].

## 7. 접근성

- 편집 영역은 `role="group"` + `watch.editor.a11y`("‘{title}’ 구간 고르기").
- 손잡이 이름은 기존 `range.start`("시작 시각")·`range.end`("끝 시각")라 시각 칸과 같은 말이다. 값 읽기는 `formatClockLong`("1분 5초").
- 손잡이 값이 바뀔 때 따로 알리지 않는다(슬라이더 `aria-valuetext`가 읽힌다). 칸 값은 `RangeField`가 보여 준다.
- 포커스: 찍기·±1초 뒤 포커스는 누른 단추에 남는다. 막대 누름 뒤에는 브라우저가 편집 영역 컨테이너(`tabindex="-1"`)에 포커스를 준다(코드로 옮기지 않는다, §5.2). 컨테이너는 키를 받는 조작 대상이라 `data-focus-container`(비대화형 컨테이너 전용 링 숨김, `app.css:71-74`)를 쓰지 않고 전역 링을 받는다(검토 반영 V8, WCAG 2.4.7).
- 가림 없음: 카드가 열려 있는 동안 `.main`의 `scroll-padding-bottom`이 sticky 바닥 줄을 비켜 간다(§5.3, WCAG 2.4.11).
- 대상 크기: 손잡이 누름 영역은 `--hit-min`(24/40) 이상이고 바깥쪽으로만 펴서 두 손잡이가 붙어도 겹치지 않는다(§5.2). ±1초 단추는 `Button size=sm`(24/40).
- forced-colors(검토 반영 V7): 트랙 `1px solid CanvasText`, 선택 띠 `Highlight`, 시작 앞 가림 `Canvas`, 손잡이 면 `Canvas` + `2px solid Highlight`(대괄호 턱 포함), 재생 위치 `CanvasText`(트랙 두께 안). 손잡이와 재생 위치는 색이 아니라 높이·모양으로 갈린다. 대비 증가: 트랙 `1px solid var(--fg)`(ProgressBar와 같다). reduce: 전환이 없어 바꿀 것이 없다.
- 보조기술 실기(VoiceOver·NVDA·Orca)는 M-PVU-2다(APG: 사용자 정의 슬라이더는 보조기술에 따라 불안정할 수 있다) [확인: 지도].

## 8. 문구(copy deck `ko.ts`, `content.md` §15 표에 같은 행)

| 키 | 문구 | 쓰는 곳·규칙 |
|---|---|---|
| `watch.editor.a11y` | ‘{title}’ 구간 고르기 | 편집 영역 이름. DC12(‘{…}’로 시작) |
| `watch.range.play.label` | 구간 보기 | 조작 줄 단추. 용어집 새 행 |
| `watch.range.fromStart.label` | 시작부터 보기 | 조작 줄 단추. 용어집 새 행 |
| `watch.range.loop.label` | 구간 반복하기 | Switch 이름. "`-기`로 끝나는 명사구"(content.md §5.1). 용어집 새 행(쓰지 않는 말 "루프") |
| `range.nudge.earlier.label` | {n}초 당기기 | ±1초 단추 보이는 글자(동사 어간 + 기). `n`은 코드 상수 1 |
| `range.nudge.later.label` | {n}초 미루기 | 같다 |
| `range.nudge.startEarlier.label` | 시작 시각 {n}초 당기기 | 접근 이름(보이는 글자 포함) |
| `range.nudge.startLater.label` | 시작 시각 {n}초 미루기 | 같다 |
| `range.nudge.endEarlier.label` | 끝 시각 {n}초 당기기 | 같다 |
| `range.nudge.endLater.label` | 끝 시각 {n}초 미루기 | 같다 |
| `range.length.label` | 구간 길이: {length} | 구간 길이(크기 모름). "라벨: 값" 꼴(content.md 기호 표) |
| `range.lengthSize.label` | 구간 길이: {length} · {size} | 구간 길이 + 예상 크기(`{size}`가 "약"을 품는다). `·` 조각 결합은 deck 문자열 하나로(DS6) |

(검토 반영 V10: 스위치 "반복" 단독, 버튼 "−1초"·"+1초", "선택 {length}"를 위처럼 바꿨다. 버튼 문구를 동사형으로 바꿔 U+2212 기호와 DC4 확인 거리도 없어졌다.)

- 찍기 단추는 기존 `watch.mark.start`·`watch.mark.end`, 손잡이 이름은 기존 `range.start`·`range.end`를 그대로 쓴다.
- 용어집(`content.md` §4 + `terms.json` glossary, DC10 패리티): "고른 구간만 미리 보는 일" → **구간 보기**, "구간 시작에서부터 미리 보는 일" → **시작부터 보기**, "구간 보기를 되풀이" → **구간 반복하기**(avoid "루프", `patterns`에 짝 패턴 `"루프"`), "시각을 조금 앞·뒤로 옮기는 일" → **당기기·미루기**. "재생" 계열은 avoid에 새로 넣지 않는다. 기존 패턴 `"재생"`이 이미 잡는다(preview.md §6.3 선례). "당기기"·"미루기"·"길이"는 지금 `terms.json`에 없다 [확인: grep 0건].
- 확인할 것(PVU-3·PVU-5에서 gate로): 값이 같은 키 금지(DC11 `byValue`)에 걸리는 값이 없는지(위 표는 서로 다르다). `{n}초`가 DC4(숫자+단위)에 걸리지 않는지 [가정: `{n}`은 자리표시라 숫자 리터럴이 아니다].
- **도움말은 1단계에 없다**(검토 반영 V18). `help/`에 미리보기·구간 문서가 없고 [확인: `help/` 11개 문서], 새 문서는 `ids.json`·Worker 생성 모듈(`http/help.generated.ts`)·`design-worker` 촬영·Worker 배포를 끌고 온다. 1단계는 `patterns.md` §8 키보드 표만 고친다. 도움말 단락은 §12 후속이다.

## 9. 디자인 시스템 변경

- **D65 구간 편집 배치**(README §5 결정 표): 빠른 다시보기 카드에서 구간 줄을 미리보기 줄 바로 아래로 옮기고, 펼친 미리보기(hls.js 경로)의 영상 아래에 구간 막대(손잡이 둘, `role="slider"`)와 조작 줄([시작 찍기]·[끝 찍기]·[구간 보기]·[시작부터 보기]·구간 반복하기)을 둔다. 선택 띠는 `--accent`, 손잡이는 트랙 밖으로 튀어나온 대괄호 모양, 누름 영역은 바깥쪽으로만. 네이티브 컨트롤 유지, 모달·새 View 없음, 일반 VOD·클립은 그대로. 근거 등급은 E1(유사 서비스 문서 + APG)이라 `채택(잠정)`(DA6).
- **ADR-0028 `adr/0028-range-editor.md`**: 맥락(영상과 칸이 떨어져 있음), 결정(D65, PVU1·PVU3·PVU15), 대안과 버린 이유(표: 자체 재생 막대 / 카드 안 모드 전환(나머지 숨김) / Dialog / 새 View / 그대로 쌓기), `--p` 예외 범위를 "진행 막대 하나"에서 "진행 막대와 구간 막대의 위치 값"으로 넓힘, 재검증 조건(M-PVU-1·2·5, 사용자 시험). 형식은 `scripts/design/adr.test.mjs`가 본다.
- `components.md` §2.30 RangeTimeline(해부·API·규칙·치수·접근성), §2.29 WatchPanel 규칙 ⑥ 갱신(편집 영역·조작 줄·`data-local-keys`), §3 표에 RangeTimeline 행, `foundations.md` §2.7 forced-colors 행.
- `patterns.md` §6.5 카드 도식(구간 줄 위치), §8 키보드 표(I·O·Space·←/→ 행, Esc 비고에 "편집 영역 안은 닫지 않는다"), §15 높이 520 행(§5.3).
- `spec-check.mjs`의 D 번호 상한 64 → 65(`spec-check.mjs:95`) [확인]. 같은 PR에서 README D65 행을 처음 쓴다.
- 새 토큰: 원칙적으로 없음(PVU16). 아이콘: 없음.

## 10. 테스트 원칙

- 규칙은 `rangeEdit.test.ts` 표 테스트(`it.each`)로 고정한다. 컴포넌트 시험은 "규칙 함수를 불렀고 결과를 썼다"만 본다.
- jsdom: `HTMLMediaElement`는 `src/test/setup.ts` 스텁을 쓴다. `duration`·`currentTime`·`paused`는 `Object.defineProperty`, 사건은 `dispatchEvent(new Event('timeupdate'|'seeked'|'ended'|'pause'|'loadedmetadata'))`.
- 끌기: jsdom에 레이아웃이 없으므로 막대의 `getBoundingClientRect`를 스텁(`{left: 0, width: 600}`)하고 `PointerEvent`(없으면 `MouseEvent` + `pointerId`)를 보낸다. `setPointerCapture`는 스텁.
- Playwright: 실제 재생이 없다(PV-6 `holdPlaylist`) [확인: 지도]. `loadedAt`(`watch.spec.ts:156-160`) [확인]처럼 `duration`·`currentTime`을 정하고 `loadedmetadata`를 보낸 뒤, 막대·손잡이 키·찍기 → `enqueue` range만 본다. 구간 보기·구간 반복하기는 vitest가 맡는다. 매 단계 axe.
- 보강 테스트는 구현을 일부러 깨서 잡히는지 확인한다(메모리 규칙 TDD). 각 PR 본문에 "깨 본 변이" 목록을 적는다.

## 11. 구현 단계

### 11.1 PR 표(stacked)

| PR | 내용 | 커밋 타입 |
|---|---|---|
| PVU-1 순수 모델 | `rangeEdit.ts` + 표 테스트, `formatClockLong` | `feat` |
| PVU-2 구간 막대 컴포넌트 | `RangeTimeline.svelte` 단독(마운트하지 않음), D65·ADR-0028(잠정)·components.md §2.30·§3·foundations §2.7, `spec-check` 상한, copy deck `watch.editor.a11y`는 PVU-3에서(쓰는 PR에서 더한다) | `feat` |
| PVU-3 편집 배치 | WatchPanel 편집 영역(막대 + 조작 줄 + 구간 보기·구간 반복하기·시작부터), `onduration`·카드 `len`, `.main` `scroll-padding-bottom`(`App.svelte`), ResolveCard 순서 이동·`onfields`·`seek`, copy deck·용어집, 갤러리 장면·`watch.spec.ts`, patterns §6.5·§15 | `feat` |
| PVU-4 키보드 | 편집 영역 키 처리, `GlobalShortcuts` Esc 넓힘, `editable()` 이동, `aria-keyshortcuts`, I/O 대상·수식 키·busy 규칙, patterns §8(도움말 없음) | `feat` |
| PVU-5 양방향·미세 조정·길이 | 칸 blur → 영상, ±1초 단추, 선택 길이·크기 줄, copy deck | `feat` |
| PVU-6 문서 마감 | D65·ADR-0028 상태, 이 문서 §16 구현 결과, `features/README.md`·`plan.md`·ROADMAP, ratchet(사람) | `chore` |

**PVU-1은 PV-7(#190)·PV-8(#191)이 master에 머지된 뒤 master에서 시작한다**(그래야 base의 `ci/ratchet.json`이 hls.js 상향(202460)을 품는다, 검토 반영 V19). 모두 직렬이다: PVU-1 → PVU-2 → PVU-3 → PVU-4 → PVU-5 → PVU-6. PVU-4와 PVU-5는 `watch.spec.ts`·`WatchPanel.svelte`(키·seek)·app.md 번호(118·119)가 겹쳐 병렬로 두지 않는다(검토 반영 V21). 가짜 백엔드 command는 어느 PR에서도 바뀌지 않는다. 화면이 바뀌는 PR(PVU-3·4·5)이 갤러리·spec을 함께 고친다(CLAUDE.md).

### 11.2 PR별 TDD 순서(먼저 쓸 실패 테스트)

#### PVU-1 순수 모델 (`app/src/lib/rangeEdit.test.ts`, `format/duration.test.ts`)
1. `timelineLength`: meta 600 → `{600,'meta'}`; meta null + video 599.6 → `{599.6,'video'}`; video `NaN`·`Infinity`·0 → null; meta 0 → video로.
2. `selection`: 접힘 → `{0, len, band:true}`; 열림 정상; 못 읽는 시작 → 0; 못 읽는 끝·빈 끝 → len; 순서 뒤집힘 → `band:false`; 시작 ≥ len → 손잡이는 len으로 자르되 band false.
3. `fractionOf`·`secsAt`: 경계 0·1, 음수·1 초과 자름, 내림(599.9 → 599), len 0 → 0.
4. `clampHandle`: §6.2 `clampHandle` 표 전부(`other = null` 행 포함, len < 2 → null). `handleBounds`: §6.2 `selection`·`handleBounds` 표 전부(모든 행에서 min ≤ now ≤ max).
5. `handleKey`: ←·↓ −1, →·↑ +1, Shift ×10, PageUp +60, PageDown −60, Home 'min', End 'max', 'a' null, Alt·Ctrl·Meta + → null.
6. `seekKey`: ←/→ ∓5, 손잡이 키가 아닌 것 null, Shift·Alt·Ctrl·Meta + ← null.
7. `moveHandle`: §6.2 표(접힘 되돌림, `source:'video'` 끝 `''`, 끝 최댓값이 `effectiveRange` null이 되는지 `receive.ts`와 묶어 확인).
8. `nudge`: ±1, 자르기, 못 읽는 칸 → null, 접힘 되돌림, `len = null`(meta 없음·미리보기 닫힘)이면 끝 상한 없음·시작은 끝−1까지, 뒤집힘이면 그 칸만 [0, floor(len)].
9. `mark`: 자르지 않음, 내림, 접힘 되돌림(§6.2 마지막 두 행).
10. `seekTargetOf`: `0:01:05` → 65, 전각 콜론, 빈칸 → null, len 넘음 → len, 틀린 형식 → null.
11. `playStep`: §6.3 표 전부(끝 경계 90 포함, `ended` toEnd=false).
11a. `consumeOwnSeek`: 목표 60에 seeked 60.3 → true, 61 → false, 한 번 쓴 뒤 null. `reachesEnd`: 빈 끝 칸 → true, end 600(len 600.4) → true, 599 → false.
11b. `selection`·`handleBounds`: §6.2 둘째 표 전부.
12. `formatClockLong`: 0 → `0초`, 65 → `1분 5초`, 3600 → `1시간`, 3723 → `1시간 2분 3초`, 120 → `2분`, 음수·NaN → `0초`.

엣지: 소수 초 입력, 길이 1·2초 영상, `floor(len)` = 시작+1.

완료 조건: `frontend` 녹색. 변이 확인: `−1` 간격 제거, 접힘 되돌림 제거, `''` 끝까지 분기 제거가 각각 잡힌다.

바뀌는 파일: `app/src/lib/rangeEdit.ts`(새), `rangeEdit.test.ts`(새), `format/duration.ts`·테스트. 화면·가짜 백엔드·갤러리·e2e 변경 없음.

문서: app.md **115**.

#### PVU-2 구간 막대 컴포넌트 (`app/src/lib/components/receive/RangeTimeline.test.ts`)
1. `renders two sliders with names and values`: `role="slider"` 둘, 이름 "시작 시각"·"끝 시각", `aria-valuenow` 60·90, `aria-valuetext` `1분`·`1분 30초`.
2. `slider bounds constrain each other`: 시작 `aria-valuemax` = 끝−1, 끝 `aria-valuemin` = 시작+1, 끝 `aria-valuemax` = floor(len).
3. `arrow keys call onmove commit with clamped value`: → +1, Shift+→ +10, End → max, 시작에서 끝 너머 → 끝−1.
4. `ime key ignored`(`keyCode 229`).
5. `drag emits drag then commit`: pointerdown(손잡이) → move(x=300/600) → up ⇒ `onmove('start',300,'drag')` … `'commit'` 한 번.
6. `track click seeks and does not move thumbs`: `onseek(300)`, `onmove` 0회.
7. `disabled: aria-disabled and no onmove`.
8. `band hidden when band=false`, `position marker reflects position`(`style:--p` 값 0.5).
9. `Tab order is DOM order start then end even when inverted`(뒤집혀 끝이 왼쪽에 그려져도 DOM 순서 고정).
10. `inverted: both sliders bounded 0..floor(len) and valuenow within bounds`, `inverted: → on start moves +1 without jump`(검토 반영 V4).
11. `adjacent handles: pointerdown just left of start anchor grabs start`(1초 간격에서 시작 손잡이 끌기, 바깥쪽 누름 영역, 검토 반영 V2).

눌림 면 `--accent-pressed`는 CSS라 시험이 아니라 `design-lint`·리뷰로 본다.

엣지: len 0(그리지 않음은 부모 몫, 여기선 비율 0), 손잡이 붙음(start=end−1: 값과 누름 영역 둘 다).

완료 조건: `frontend`·`design-lint`(DL2·DL7·DL11·DS1·DS2·DX2·DX6)·`design-tokens`·`design-copy` 녹색. `role="slider"`는 DS1 역할 목록(`dialog`·`switch`·`menu`·`alert`, `lint.mjs:573`)에 없어 `ui/` 밖에서도 허용 목록 없이 통과한다 [확인].

바뀌는 파일: `RangeTimeline.svelte`(새)·테스트, `docs/design/system/{README.md,components.md,foundations.md}`(foundations §2.4에 `fg / accent` 상태 표시 행 둘과 `accent-pressed / surface` 참고 행), `design/tokens/contrast.tokens.json`(DT8 같은 쌍, 검토 반영 V1), `adr/0028-range-editor.md`(새), `scripts/design/spec-check.mjs`(상한 65)·테스트. 마운트하지 않으므로 갤러리·e2e·가짜 백엔드 변경 없음.

문서: app.md **116**.

#### PVU-3 편집 배치 (`WatchPanel.test.ts`, `receive.test.ts`, `app/e2e/watch.spec.ts`)
1. `editor appears only on hls path after metadata`: mp4·네이티브 m3u8·메타데이터 전에는 막대 없음(조작 줄의 찍기는 PV-7처럼 비활성으로 있음).
2. `no editor on vod/clip cards`(PVU2).
3. `range row sits right after watch row on rewind card`: DOM 순서 미리보기 → 일부만 받기 → 화질.
4. `range field not remounted when preview toggles`: 미리보기를 펼치고 접어도 칸 요소가 같은 노드다(RangeField는 `{#if tone === 'rewind'}` 하나라 다시 마운트되지 않는다. 그래서 오류 `$effect`를 고칠 일이 없다).
5. `dragging start handle opens range and writes field`(접힘 → 펼침, 다른 칸 전체 값).
6. `handle at end writes floor(duration) and enqueue has no range`(전체 받기).
7. `meta duration null: end handle at end writes empty end`.
8. `commit seeks video, drag does not`(`currentTime` 쓰기 횟수), `seek clamps to video.duration`(meta가 더 길 때, 검토 반영 V11).
8a. `handle commit during loop turns range play off`(끝 손잡이를 고쳐도 restart·pause가 끼어들지 않음, 검토 반영 V6).
8b. `handle move clears previous range error, mark does not`(검토 반영 V14).
8c. `len from meta stays when preview collapsed`, `len from video when meta missing`(`onduration`).
9. `range play: starts at start, pauses at end`, `loop restarts`, `user pause exits`, `range play disabled when order inverted`.
10. `from start plays without stopping at end`.
11. `collapse resets playMode and keeps fields`.
11a. `main has scroll-padding-bottom while card open, summed with toast`(검토 반영 V3).
12. PV-7 시험 9개(`receive.test.ts` `구간 찍기(ResolveCard, preview.md PV17)`)는 **그대로 통과**해야 한다. 새로: `marking while range collapsed resets the other field`(PVU9).
13. E2E `watch.spec.ts`: 빠른 다시보기 펼침 → `loadedAt` + `duration` 정의 → 시작 손잡이 포커스 → End·← → `enqueue` range, 매 단계 axe.

완료 조건: `frontend`·`e2e-web`·`design-*` 녹색, 갤러리 장면 더함(기준선은 Linux CI artifact → `shots.mjs --accept`), PR 본문에 로컬 `dist` gzip 증가량.

바뀌는 파일: `WatchPanel.svelte`, `ResolveCard.svelte`, `App.svelte`(`scroll-padding-bottom`), 테스트, `ko.ts`(`watch.editor.a11y`·`watch.range.*`), `design/copy/terms.json`, `docs/design/system/{content.md,patterns.md,components.md}`, `app/e2e/watch.spec.ts`, `app/e2e/screens-data.ts`(장면 `카드 구간 편집(빠른 다시보기)` slug `card-watch-hls-edit`: 길이·위치·선택이 있는 상태. 기존 `card-watch-hls`·`card-watch-hls-marked`·빠른 다시보기 카드 장면은 순서와 막대 때문에 기준선이 바뀐다). 가짜 백엔드 command는 그대로이고, 장면 데이터의 `durationSecs`만 쓴다.

문서: app.md **117**.

#### PVU-4 키보드 (`WatchPanel.test.ts`, `shortcuts.test.ts`, `watch.spec.ts`)
1. `I marks start, O marks end from editor`(대상: 컨테이너·찍기 단추·손잡이), `I on range-play button or switch ignored`(검토 반영 V12), `KeyI` with `key='ㅑ'` 도 동작. `I on focused video marks start`(대상 `<video>`), `Space/arrow on focused video not handled`(`defaultPrevented` 거짓, 재생 상태 그대로).
2. `I with modifier ignored`, `I in text field types`(칸이 편집 영역 밖이어도, 영역 안 입력칸이 생겨도 `editable` 거름).
3. `Space toggles play on slider and container`, `Space on button clicks button only`(재생 토글 없음).
4. `arrow on container seeks ∓5`, `arrow on slider moves handle not playhead`.
5. `ime composing key ignored`.
5a. `I/O and handle keys ignored while busy, Space still toggles`(검토 반영 V20).
5b. `Ctrl/Meta+arrow and Ctrl+Space not handled`(`defaultPrevented` 거짓, 검토 반영 V13).
5c. `Esc on range field still closes card`(편집 영역 밖, 검토 반영 V9).
6. `shortcuts.test.ts`: Esc 대상이 `[data-local-keys]` 안이면 `ui.escape` 안 부름, 밖이면 부름(기존 미디어 시험 유지).
7. `aria-keyshortcuts on mark buttons`.
8. E2E: 막대 누름 → I → O → `enqueue` range.

엣지: 반복 누름(키 자동 반복)에서 찍기 여러 번 = 마지막 값.

완료 조건: `frontend`·`e2e-web`·`design-lint`(DX6)·`design-copy` 녹색.

바뀌는 파일: `WatchPanel.svelte`, `GlobalShortcuts.svelte`, `ui/focus.ts`(`editable`), 테스트, `patterns.md` §8, `watch.spec.ts`. `help/`는 바꾸지 않는다.

문서: app.md **118**.

#### PVU-5 양방향·미세 조정·길이 (`receive.test.ts`, `RangeField` 시험은 `receive.test.ts` 안)
1. `blur on parsed start seeks video`, `typing does not seek`, `blur on invalid does not seek`, `blur with preview closed does nothing`, **`blur without change does not seek`**(Tab으로 지나가기), **`blur into editor (track press) does not override track seek`**, **`shift+tab from field into editor controls still seeks`**(검토 반영 V5).
2. `nudge buttons: earlier/later change field, clamp, disabled when field invalid or busy`, `nudge clears previous range error`. 접힌 구간 줄에서는 단추가 보이지 않으므로(`<details>` 안, `RangeField.svelte:74-108`) 컴포넌트 시험은 `nudge buttons hidden while collapsed`로 본다. 접힘 되돌림은 PVU-1 `nudge` 표 테스트로만 고정한다(검토 반영 V22).
2a. `narrow: field and its nudge buttons wrap together`(320 폭은 갤러리 장면으로, 검토 반영 V23).
3. `nudge seeks video when preview open`.
4. `accessible names include visible text`("시작 시각 1초 당기기" ⊃ "1초 당기기").
5. `length line`: 접힘 → 영상 길이, 열림 → 구간 길이, 크기 있음 → `선택 … · 약 …`, 끝 모름 → 줄 없음, 칸 틀림 → `effectiveRange` null이라 영상 길이(Q5).
6. E2E: ±1초 → 칸 값 → `enqueue` range.

완료 조건: `frontend`·`e2e-web`·`design-copy` 녹색, 갤러리 장면 갱신.

바뀌는 파일: `RangeField.svelte`, `ResolveCard.svelte`, `ko.ts`(`range.nudge.*`·`range.length*`), `design/copy/terms.json`(당기기·미루기 용어집 행), `content.md` §4·§15, 테스트, `watch.spec.ts`, `screens-data.ts`(320×231 펼친 구간 줄 장면).

문서: app.md **119**.

#### PVU-6 문서 마감
1. D65·ADR-0028: 상태 `채택(잠정)` 유지(E1) 또는 실측·시험 결과로 바꾼다. README 열린 항목에 M-PVU 남은 것.
2. 이 문서 §16 구현 결과, `features/README.md` 행, `plan.md` 트랙, ROADMAP "현재 위치"·체크리스트.
3. `tests.vitest`(지금 692)·`tests.playwright`(지금 63)·`size.dist_gz`(master 202460: PV-6 hls.js 증가분은 PV-6 머지 뒤 master에서 이미 올렸다. 이 트리의 87460은 옛 값이다, 검토 반영 V19) [확인: `git show origin/master:ci/ratchet.json`, PV-6 실행의 `size` 단계 `ok size.dist_gz 기준 202460`]는 CI 녹색 실행 뒤 사람이 올린다(`ratchet.mjs write --from-run`, 성공한 실행만, preview.md §16.4).

완료 조건: `scan`, `design-*` 녹색.

### 11.3 gate
`frontend`, `design-tokens`·`design-lint`·`design-copy`·`design-icons`, `e2e-web`, `design-shots`(관찰), `scan`, `coverage`. 크기는 CI `bundle (linux)`의 `size`(ci-ok 안)가 master 기준 202460 ±3%로 본다. Rust·`.github/`·`worker/`·`help/`는 바꾸지 않는다.

### 11.4 번호 예약
- app.md 구현 중 변경 **115~119**(PVU-1~5) [확인: 마지막 114].
- 디자인 결정 **D65** [확인: 마지막 D64, `README.md:213`], **ADR-0028** [확인: 마지막 `0027-watch-preview.md`].
- core.md: 없음.
- 미머지 PR과 겹치면 나중에 머지되는 쪽이 번호를 옮긴다(preview.md 선례: 한 칸씩 밀림).

## 12. 후속(범위 밖)
- 썸네일 줄(2단계).
- 자체 재생 막대로 네이티브 컨트롤 바꾸기(일반 VOD·클립 공통). 전체 화면·음량·접근성을 직접 맡는 큰 결정이라 따로 ADR.
- 막대 확대, 단추 옆 `Kbd` 힌트(Q4).
- 끌기 중 영상 미리 탐색(스크러빙): "탐색은 한 번에 하나, `seeked` 뒤 마지막 값" 규칙과 연달은 탐색의 중계·403 재조회 실측이 함께 필요하다(검토 반영 V16).
- 막대 위 포인터 위치의 시각 표시, "끝 몇 초 앞부터 보기"(검토 반영 V16).
- 도움말의 미리보기·구간 단축키 단락(새 `help/` 문서, Worker 생성 모듈·배포 승인이 따른다, 검토 반영 V18).
- 일반 VOD 구간 받기(range.md §12.1).

## 13. 실측 필요(사용자 손, 출력은 판정만)

| ID | 무엇 | 누가 | 통과 기준 |
|---|---|---|---|
| M-PVU-1 | 3 OS 웹뷰(WKWebView·WebView2·WebKitGTK)에서 손잡이 끌기·막대 누름·키 이동 | 사용자, 본인 빠른 다시보기 | 끌기가 손을 따라오고, 놓은 시각으로 영상이 3초 안에 간다. 키 반복에서 튀지 않는다 |
| M-PVU-2 | 화면 낭독기(VoiceOver·NVDA·Orca 중 가능한 것)로 손잡이 이름·값·이동 | 사용자 | "시작 시각, 1분 5초, 슬라이더"처럼 읽히고 ←/→로 값이 바뀐다 |
| M-PVU-3 | [구간 보기] 끝 멈춤·반복의 정확도 | 사용자 | 끝 시각을 1초 넘기지 않고 멈춘다. 반복이 시작으로 돌아간다 |
| M-PVU-4 | 막대·손잡이로 고른 구간으로 받은 파일의 시작·끝, 막대 길이 축 | 사용자 | M-PV-5와 같은 기준(조각 경계 넓힘 안). 끝 손잡이 맨 끝 = 전체 받기. **meta 길이와 `video.duration`의 차이가 1초 이내**(M-PV-5는 `currentTime` 시각만 검증했고 길이 축은 검증하지 않았다, 검토 반영 V11) |
| M-PVU-5 | 960×700과 720×520에서 펼친 편집 영역의 첫 화면과 가림 | 사용자 또는 갤러리 | 960×700에서 영상이 스크롤 없이 보이고(§5.3 계산), 막대·조작 줄·구간 줄로 Tab하면 어느 것도 sticky 바닥 줄에 가리지 않는다. 520에서는 [받기]가 sticky로 보인다 |
| M-PVU-6 | 네이티브 탐색 막대와 구간 막대가 함께 있을 때 헷갈림 | 사용자 시험(D62 UT) | "N명 중 M명"이 구간 막대를 받을 구간으로 읽는다 |
| M-PVU-7 | Space·←/→가 네이티브 `<video>` 키 처리와 겹치지 않는가, 영상에 포커스가 있을 때 I/O가 감싼 요소까지 오는가(3 OS) | 사용자 | 영상에 포커스가 있을 때 Space·←/→는 웹뷰 동작만, I/O는 찍기가 된다. 편집 영역의 다른 곳에서는 우리 동작만 한 번 일어난다 |

## 14. 결정된 질문(2026-10-20, 사용자 위임으로 추천안 확정)

열린 질문은 남기지 않는다. 사용자가 결정을 위임해 모두 추천안으로 확정했다. 검토 반영 중 새로 정한 것(Q9~Q13)도 여기에 결정으로 적는다.

| # | 질문 | 확정 | 이유·다시 볼 조건 |
|---|---|---|---|
| Q1 | 편집 보기 방식 | **(a) 배치만**(구간 줄을 미리보기 아래로, PVU3) | (b) 카드 안 모드 전환은 숨김 상태·다시 마운트·크기 예상이 안 보이는 문제가 생긴다. (c) Dialog는 ADR-0027이 버렸다. (d) 새 View는 `<video>`를 다시 만들어 세션을 새로 연다. §5.3 계산으로 960×700에서 조작 줄은 한 번 스크롤해야 보이므로 목표를 "영상이 첫 화면, Tab 때 가림 없음"으로 정했다. M-PVU-5에서 사용자가 스크롤을 문제로 꼽으면 (b)를 다시 본다 |
| Q2 | 네이티브 컨트롤 | **(a) 유지**(PVU1) | M-PVU-6에서 헷갈림이 크면 자체 재생 막대를 후속 ADR로 |
| Q3 | 칸 → 영상 시점 | **(a) blur, 값이 바뀌었을 때만**(PVU10) | 중간 값 튐이 없고 예측하기 쉽다. Tab으로 지나가기만 하면 영상이 움직이지 않는다 |
| Q4 | 단축키 힌트 | **(a) `aria-keyshortcuts` + `patterns.md` §8**(PVU13) | 단추 옆 `Kbd`는 `SHORTCUT` 표·platform.md §6·DC11 처리가 따른다. 사용자 시험에서 I/O를 못 찾으면 (b) |
| Q5 | 칸이 틀렸을 때 구간 길이 | **(a) 영상 길이**(= 지금 화질 행과 같다) | 화질 행 크기와 어긋나지 않는다 |
| Q6 | 손잡이 키 큰 걸음 | **Shift ×10, PageUp/Down 60** [잠정] | 클립챔프 Shift 선례 [확인: 지도] |
| Q7 | 재생 위치 ←/→ 걸음 | **5초** [잠정] | 유튜브 막대 위 ←/→ 5초 [확인: 지도] |
| Q8 | 편집 영역 안 Esc | **(a) 아무것도 안 함**(PVU12) | 미리보기를 접으면 세션이 닫히고 재생 위치를 잃는다. 키 범위는 편집 영역뿐이고 구간 줄 Esc는 지금처럼 카드를 닫는다 |
| Q9 | 순서가 뒤집힌 동안 손잡이 | **두 손잡이 모두 `[0, floor(len)]`, 다른 손잡이로 자르지 않음**(PVU9) | 맞바꿈은 사용자가 고르지 않은 칸을 바꾸고(PV-7 "몰래 고치지 않는다"와 어긋남), 다른 손잡이로 자르면 한 걸음에 수 분이 튄다 |
| Q10 | I/O가 듣는 대상 | **손잡이·컨테이너·`<video>`·찍기 단추 둘** | 구간 보기 단추·Switch는 뺀다(2.1.4). 찍기 단추는 `aria-keyshortcuts`가 거짓이 되지 않게 남긴다 |
| Q11 | 구간 보기 중 손잡이·키·±1초·칸 탐색 | **구간 보기 모드를 끈다** | 고친 끝 장면을 볼 수 있다. 다시 보려면 [구간 보기] |
| Q12 | 끌기 중 영상 미리 탐색 | **1단계에 없음(§12 후속)** | 연달은 탐색의 중계·403 재조회가 실측된 적이 없다 |
| Q13 | ±1초 단추 문구 | **[1초 당기기]·[1초 미루기]** | 버튼 "동사 어간 + 기" 규칙 안이라 예외 행이 필요 없고 기호(U+2212)도 없다. 대가로 단추가 넓어 좁은 폭은 칸 묶음째 접는다(§5.5) |

## 15. 검토 반영

두 적대적 검토(ux-a11y: UX·접근성·디자인 시스템, plan-tdd: 계획·TDD)의 지적을 이 트리의 파일로 하나씩 확인했다. 본문의 "검토 반영 V#"이 이 표의 행이다. 같은 지적은 한 행에 ID를 함께 적었다.

| V# | 지적(ID) | 판정 | 확인한 근거 | 반영 |
|---|---|---|---|---|
| V1 | 선택 띠 `--accent-soft`가 트랙과 구별되지 않음(ux-1) | 수용 | `--accent-soft`·`--track` 값(`foundations.md` §2.3 표) → 대비 라이트 1.06·다크 1.35 계산. `accent / track` 4.28·3.60 쌍이 §2.4에 있다 | §5.2 띠 `--accent`, `fg / accent` 쌍(3.29·3.74)을 contrast.tokens.json에 더함(PVU-2) |
| V2 | 짧은 구간에서 두 손잡이 누름 영역이 겹침(ux-2) | 수용 | 명세 §5.2 너비 0 앵커 + `--hit-min`, §1.2 확대 없음 | §5.2 누름 영역을 바깥쪽으로만, PVU-2 시험 11 |
| V3 | 960×700 첫 화면이 넘치고 sticky 바닥 줄이 포커스를 가림(ux-3) | 수용 | `.card-footer { position: sticky; bottom: 0 }`(`app/src/styles/ui.css`), `.main`은 `scroll-padding-top`만이고 바닥 여백은 `.has-toast`뿐(`App.svelte:189-200`) | §5.3 계산 확정(702), 목표 수정, 카드가 열린 동안 `scroll-padding-bottom`(토스트와 합산), M-PVU-5 기준 수정, PVU-3 시험 11a |
| V4 | 뒤집힌 순서에서 슬라이더 ARIA 경계 모순·한 걸음에 튐(ux-4, plan-1) | 수용 | `mark`는 자르지 않는다(`ResolveCard.svelte:161-164`, §6.2 찍기 행). 명세 :160의 서로 제한 경계와 함께면 valuenow가 범위 밖 | PVU9, `handleBounds`·`clampHandle(other: null)`, §6.2 뒤집힘 행·`selection`/`handleBounds` 표, PVU-2 시험 10, Tab 순서 근거를 "DOM 순서"로 고침 |
| V5 | 칸 blur 탐색이 막대 누름을 덮고 Tab만 해도 영상이 튐(ux-5, plan-3) | 수용 | 규칙이 "읽히면 탐색"뿐이었다(PVU10). 막대 누름 뒤 `container.focus()`가 칸 blur를 부른다 | PVU10·§5.5: 값이 바뀌었고 `relatedTarget`이 편집 영역 컨테이너·손잡이가 아닐 때만(Shift+Tab으로 조작 줄 Switch로 가거나 영상을 눌러도 탐색은 일어난다). PVU-5 시험 1 |
| V6 | 구간 보기 중 손잡이 조작이 곧바로 pause·restart, `byUs` 정의·`toEnd`·경계·닿지 않는 행(ux-6, plan-2) | 수용 | §6.3 표에 손잡이·키·칸 탐색 행이 없고 `seeked`에는 누가 탐색했는지가 없다. `range | pause(byUs=true)` 행은 앞 행에서 이미 off라 닿지 않는다 | `seek()`이 먼저 모드를 끈다(PVU10·Q11), `consumeOwnSeek`·`reachesEnd`, 경계 `start ≤ t < end`, `ended` toEnd=false 행, 닿지 않는 행 삭제, PVU-3 시험 8a |
| V7 | 손잡이와 재생 위치가 색으로만 구별됨(ux-7) | 수용 | 둘 다 세로 막대(명세 :159), forced-colors에서 둘 다 `CanvasText` 계열 | 손잡이는 트랙 밖으로 튀어나온 `[`·`]`, 재생 위치는 트랙 두께 안. forced-colors 손잡이 `Highlight` 테두리(§7) |
| V8 | 키를 받는 컨테이너에 `data-focus-container`(ux-8) | 수용 | `app.css:71-74` 주석 "비대화형 컨테이너에만", 카드 제목 선례는 비대화형 | 코드로 포커스를 옮기지 않고 `data-focus-container`를 빼 전역 링을 받는다(§5.2·§7) |
| V9 | 한 덩어리로 보이는 영역의 키 동작이 둘로 갈림, Esc 변경 근거 없음(ux-9) | 부분 수용 | `GlobalShortcuts.svelte:16-21`: 지금 예외는 미디어 요소뿐이라 [시작 찍기] 위 Esc는 카드를 닫는다 [확인] | 키 범위를 구간 줄까지 넓히지는 않는다: 구간 줄은 미리보기가 닫혀도 쓰는 일반 폼 행이고, 입력칸이 있는 행에서 한 글자 단축키를 받으면 잘못 잡힐 위험이 크다. 대신 키 범위(편집 영역뿐)와 Esc 변경 이유를 PVU12·§3에 적었다. PVU-4 시험 5c |
| V10 | 문구 규칙 위반: 스위치 "반복", 버튼 "−1초", "선택 {length}"(ux-10) | 수용 | `content.md` §5.1 기본형·스위치 행, W1(:20), `range.label` "구간"(`ko.ts:72`). "돌아가기"는 avoid 패턴(`terms.json`), `-해서` 금지라 검토가 든 예시 둘은 쓸 수 없다 | "구간 반복하기", "{n}초 당기기/미루기", "구간 길이: {length}"(§8, Q13) |
| V11 | meta 길이 우선(PVU7)이 M-PV-5 검증 범위 밖(plan-5) | 수용 | M-PV-5는 `currentTime` 시각만 검증(`preview.md` PV17 행) | `seek()`이 `[0, video.duration]`으로 자름, M-PVU-4에 길이 차이 1초 기준, PVU-3 시험 8 |
| V12 | 한 글자 단축키 I/O가 편집 영역 전체에서 켜짐(ux-12) | 수용 | WCAG 2.1.4 이해 문서의 "포커스가 있을 때만" 예외 | I/O 대상을 손잡이·컨테이너·영상·찍기 단추로 좁힘(PVU12, Q10) |
| V13 | Space·←/→의 수식 키 규칙 없음(ux-13) | 수용 | `handleKey`·`seekKey`가 `shift`만 받았다. Alt+←/→는 `guards.ts`가 막는다(`:27`) [확인] | `Mods` 인자, Alt·Ctrl·Meta면 null(§5.1·§5.4) |
| V14 | 손잡이로 고친 뒤에도 앞 [받기] 오류가 남음(ux-14) | 수용 | `receive.test.ts:1460` 시험이 찍기에서 오류 유지를 고정 [확인] | 손잡이·±1초는 `rangeErr`를 지우고 찍기는 지금처럼 남긴다(§3, `onfields` cause). PVU-3 시험 8b |
| V15 | `len`의 주인 불명, `nudge` 시그니처 빔(plan-4) | 수용 | 카드는 `view.meta.durationSecs`만 알고 ±1초는 미리보기가 닫혀도 쓰인다 | 카드가 `len` 주인(`onduration`), `nudge(len \| null)`(§5.1·§5.3·§6.1) |
| V16 | 끌기 중 미리 탐색·끝 확인·포인터 위치 시각이 없음(ux-16, 추론) | 보류(후속) | 검토 자신이 추론으로 표시. 연달은 탐색의 중계 동작은 실측 없음 | §12 후속, Q12 |
| V17 | 눌림을 `--surface-pressed` 테두리로 표현(ux-11) | 수용 | `foundations.md` §1 규칙 6 "눌림은 채움", `--accent-pressed`(§2.3) | 손잡이 `:active` 면 `--accent-pressed`, 다크 대비 2.29는 참고 행(§5.2) |
| V18 | 도움말 단락이 계획에 없는 Worker 범위를 끌어옴(plan-7) | 수용 | `help/` 11개 문서에 미리보기·구간 없음 [확인] | 1단계는 `patterns.md` §8만, 도움말은 §12 후속. PVU-4 파일·완료 조건에서 `help/` 뺌 |
| V19 | 크기 ratchet을 마지막 PR까지 미루면 앞 PR이 빨개짐(plan-6) | 부분 수용 | origin/master `ci/ratchet.json` `dist_gz`는 이미 202460이고 PV-6 실행(39382555711) `size` 단계가 `ok`였다 [확인]. 이 트리(pv8 위)의 87460은 옛 값이라 지적의 전제는 틀렸다. 다만 스택 base가 상향을 품지 않으면 같은 일이 생긴다 | 명세의 숫자를 고치고 PVU-1을 PV-7·8 머지 뒤 master에서 시작하게 함(§11.1·PVU-6) |
| V20 | busy 중 키 처리 미정(plan-8) | 수용 | 찍기 단추는 `disabled`일 때 비활성(`WatchPanel.svelte:205-206`) [확인] | 칸을 바꾸는 키는 busy면 무시, Space·재생 위치 이동은 유지(PVU12·§5.4), PVU-4 시험 5a |
| V21 | TDD 대응표 사실 오류: `clampHandle` 원천, PV-7 시험 수, PVU-4/5 겹침(plan-10) | 수용 | `receive.test.ts` 해당 describe의 `it` 9개 [확인: 1350~1474 셈] | `clampHandle` 전용 표(§6.2), "9개", PVU-4 → PVU-5 직렬(§11.1) |
| V22 | 접힌 구간 줄의 ±1초 시험은 화면에서 닿을 수 없음(plan-9) | 수용 | ±1초는 `<details>` 안(`RangeField.svelte:74-108`) [확인] | 시험을 "접힘이면 단추가 보이지 않는다"로 바꾸고 접힘 되돌림은 PVU-1 표 테스트로만 |
| V23 | 320 폭에서 ±1초 단추 배치 미정(ux-15) | 수용 | `.clock` 기준 폭 `6 × --text-body`(`RangeField.svelte:115-118`) [확인] | 칸 + 그 칸의 단추를 한 묶음으로 접기(§5.5), 320×231 장면 |

문제없음으로 판단한 것(plan-tdd 마지막 절): 상태의 한 방향 흐름(무한 루프 없음), hls.js 경로 한정(PV17), Esc 확장 근거 인용, 가짜 백엔드 무변경. 이 판단에는 반대하지 않았고 본문을 바꾸지 않았다.

## 16. 구현 결과

(PVU-6에서 채운다.)
