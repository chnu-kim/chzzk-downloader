# 기반 토큰 (foundations.md)

디자인 시스템 「무색」의 모든 토큰을 이름과 값으로 확정한다. `README.md`의 결정 표(D1~D62)가 "무엇을" 정했고, 이 문서는 그것을 "어떤 이름의 어떤 값"으로 코드에 내리는 단일 원천이다. 토큰은 여기 적힌 것만 존재한다. 여기 없는 값을 컴포넌트가 쓰면 `design-lint`가 막고, 여기 있는데 쓰지 않는 토큰은 `design-tokens`가 막는다.

읽는 법:
- 모든 길이는 **px**이고 루트 글자 크기는 **16px**이다. 어떤 토큰도 rem이 아니다. 문서의 숫자가 곧 화면의 숫자다(`A-VIS-01`, brief §6.2-4, ADR-0002. 강제 `design-tokens` DT4: rem 단위 0개, `html { font-size: 16px }` 고정).
- 층은 둘이다. **ref**(팔레트: 값만 있고 뜻이 없다)와 **sys**(의미: 컴포넌트가 쓰는 유일한 층). **comp 층은 비운다.** 컴포넌트·갤러리(`governance.md` §2.6)는 sys 토큰만 참조하고 자기 토큰을 만들지 않는다(gov, brief D3 권고. 강제 `design-lint` DL7: `.svelte`·컴포넌트 CSS 안의 `--` 선언 금지, 예외는 `components.md`가 적는 상태 변수 `--p` 하나). 컴포넌트 전용 치수(라벨 열·퍼센트 칸)도 여기(§5.2)의 토큰이다.
- 표기 **[잠정]**은 확인되지 않은 값이다. 확인 방법을 같은 줄에 적었고 `README.md` §6에 모았다. **[취향]**은 출처 없는 선택이다. 뒤집어도 체계가 깨지지 않는다.
- 근거는 `docs/research/design-system.md`의 ID로 인용한다(README 머리). refuted 값(`X-*`)은 쓰지 않았다.
- 원천은 `design/tokens/*.tokens.json`(DTCG 2025.10 부분집합, `governance.md` §1.2)과 UI 컴포넌트 CSS `design/ui.css`다. 생성기 `scripts/design/tokens.mjs`가 앱의 `app/src/styles/tokens.css`·`app/src/styles/ui.css`와 Worker의 `worker/src/http/site-css.generated.ts`(토큰 + ui + 웹 CSS를 이어 붙인 문자열 상수)를 만든다. 토큰 구간은 **앱 생성물에만 `data-text-scale` 블록, Worker 생성물에만 `data-scale="reading"` 블록**이 있고 그 둘을 뺀 나머지는 바이트까지 같다(brief §6.2-1, `A-WORKER-0`). 이 문서 §13의 CSS가 생성물의 기대 모양이고 `design-tokens`(DT1·DT14)가 비교한다. CSS 토큰이 아닌 상수(시간 임계값·셸 상수)는 §14 표가 이름·값을 정하고 `app/src/lib/timing.ts`·Rust 상수가 그 값을 든다.

---

## 1. 이름 규칙

형식은 `--{속성}-{의미}[-{강도}][-{상태}]`다. 하이픈으로만 나누고 접두는 없다(현재 앱 토큰과 연속, `A-WORKER-0` 공유안 권고). 토큰 원천의 DTCG `$type`은 속성이 정한다(`governance.md` §1.2).

| 자리 | 허용 값 | DTCG `$type` | 예 |
|---|---|---|---|
| 속성 | `bg` `surface` `raised` `track` `fg` `separator` `border` `accent` `danger` `warning` `on` `focus` `scrim` | `color` | `--fg` |
| 속성 | `shadow` | `shadow` | `--shadow-menu` |
| 속성 | `font` | `fontFamily` | `--font-sans` |
| 속성 | `weight` | `fontWeight` | `--weight-strong` |
| 속성 | `text` `leading` `space` `edge` `gap` `radius` `control` `row` `toolbar` `hit` `icon` `switch` `radio` `progress` `badge` `content` `reading` `dialog` `label` `pct` | `dimension` | `--space-8`, `--label-w` |
| 속성 | `motion` `progress-tween` | `duration` | `--motion-fast` |
| 속성 | `ease` | `cubicBezier` | `--ease-out` |
| 속성 | `z` | `number` | `--z-menu` |
| 의미 | 역할 이름(예: `muted` `ink` `soft` `pressed` `sibling` `label` `menu` `toast` `dialog` `caption` `body` `title` `display` `hero` `read` `sm` `md` `lg` `fast` `base` `slow` `spin` `sans` `mono` `h` `w` `knob` `size` `max` `min` `stroke` `badge` `control` `group` `overlay` `pill` `sticky` `drop` `regular` `strong` `in` `out`) 또는 값(`8` `20`) | — | `--accent-ink`, `--text-body` |
| 강도 | `2` `muted` `disabled` `soft` `strong` | — | `--surface-2`, `--border-strong` |
| 상태 | `pressed` | — | `--accent-pressed`, `--surface-pressed` |

규칙(강제 `design-tokens` DT7: 속성이 위 표의 허용 값이고, 값 이름 토큰은 이름 = 값이며, 전체 이름 집합이 §13 생성물과 같다. 의미 자리는 정규식으로 검사하지 않는다 — 새 이름은 §13에 더해야 생기고 그것이 ADR이다):

1. **역할 이름에는 값을 넣지 않는다.** `--text-body`는 13이지만 이름은 13을 말하지 않는다. 그래서 Windows 실기 뒤 14로 바꿔도 이름이 거짓이 되지 않는다(README D11).
2. **값 이름 토큰은 값을 바꾸지 않는다.** `--space-8`은 영원히 8px이다. 격자가 바뀌면 토큰을 새로 만들고 옛것을 지운다. "문서 숫자 = 화면 숫자"를 이름이 보증한다(B 후보의 방식, judgment §2.4 D12).
3. **ref는 `--ref-{색상}-{L}`**이고 L은 무채색 `gray`가 **×1000**(`--ref-gray-965` = OKLCH L 0.965. 계단이 촘촘해 세 자리가 필요하다), 유채색이 **×100**(`--ref-blue-54` = L 0.54)이다. 알파 색은 `--ref-{black|white}-a{α×100}`이다. ref는 컴포넌트가 직접 쓰지 않는다(`design-lint` DL6: 컴포넌트 CSS에 `--ref-` 0개).
4. **테마·OS·플랫폼은 이름에 넣지 않는다.** 다크 값은 같은 이름을 다크 블록이 재정의한다(brief §6.1-2). `--bg-dark` 같은 이름은 없다.
5. **비활성 전용 색은 이름에 `disabled`를 박는다.** `--fg-disabled`는 비활성 글자·아이콘에만 쓴다. 정보 글자에 쓰면 리뷰(`R1` 스크린샷)에서 걸리고 `design-gallery`의 axe 대비 검사가 잡는다(brief §6.5-3, `A-DRIFT-S2` `fg-faint` 오용 재발 방지).
6. 상태는 `pressed`만 둔다. hover 전용 색은 없다. hover는 `--surface-2` 채움, 눌림은 `--surface-pressed` 채움으로만 표현한다(D21. 둘이 같은 색이면 눌림 피드백이 없다 — 편집 전 `--track`을 눌림에 겸용하던 결함, §12-11).

---

## 2. 색

### 2.1 설계 원칙

- **바탕은 순수 무채색(OKLCH C=0)**이다(D6=B. Finder·시스템 설정 창 회색은 무채색, apple §3.4. 강제 `design-tokens`: `gray-*` ref의 HSL S = 0).
- **색은 두 뜻만 가진다.** 파랑 = 켜짐·선택·주 동작, 빨강 = 위험. 호박은 경고 글자·면에만 쓰고 채움 버튼은 없다. **초록(성공) 토큰은 두지 않는다[잠정]**. 완료는 ✓ 아이콘 + "완료" 글자 + 완료 그룹 위치로 전한다(judgment §2.5. 확인: D62 확인 과업 V1에서 3명 중 2명 이상이 못 찾으면 C1 경계 밖의 초록(README §6-5)을 ✓ 아이콘 색 토큰 `--success-ink` 하나로 더하고 ADR에 적는다. 임계값 "3명 중 2명"은 우리 결정이다, ADR-0004).
- **채움용과 글자용을 분리한다.** `--accent`는 채움(주 버튼·진행 채움·스위치 트랙), `--accent-ink`는 작은 표시(라디오 점·선택 ✓)·웹 링크·포커스 링이다. 하나로 글자 4.5:1과 흰 글자 4.5:1을 동시에 만족하는 파랑은 없다(a-drift "`--accent` 하나가 글자·배경·테두리를 겸한다" 결함 해소). `--danger`/`--danger-ink`도 같다.
- **글자 쌍은 모두 4.5:1 이상, 의미 있는 경계·상태 표시는 3:1 이상**이다(WCAG 2.2 1.4.3·1.4.11, `E-APPLE-09`·`E-APPLE-10`). HIG의 pt 표보다 WCAG가 이긴다(`E-APPLE-09`). §2.4 표가 전부 계산값이다.
- **C1 검사**(C1): 토큰 어디에도 HSL H 140~165°이면서 S ≥ 70%인 색이 없다. 채도 기준은 **HSL S**로 고정한다(brief §1.5의 미정 사항. B·C 후보가 같은 기준을 제안했고 다른 기준으로 바꿀 이유가 없다). H 140~170° 경계 색도 두지 않는다. 강제 `design-tokens`(§2.6 표를 생성기가 다시 계산해 FAIL이면 중단).
- **다크는 반전이 아니다.** 바탕 L 0.24부터 올라가는 네 단계 계단이고 순흑이 없다(D9. g-scale HDR: SDR 조각의 검정이 뜬다 → brief §6.3-5). 다크 채움 파랑은 macOS 자체 값보다 어둡게 잡아 흰 글자 4.5:1을 넘긴다(macOS #0A84FF는 3.4:1이라 못 쓴다).
- **다크 `--danger-ink`는 A 후보의 `#FD736D`(oklch .72 .17 25)를 `#FA8880`(oklch .75 .14 25)로 올렸다.** A 값은 `--surface-2` 위에서 4.25:1이라 유령 위험 버튼의 hover(바탕 `--surface-2`)에서 AA에 못 미쳤다. 모든 잉크는 네 바탕 전부에서 4.5:1을 넘긴다는 불변식을 지키기 위한 계산 결과다(§2.4 dark 표 `danger-ink / surface-2` 4.82). ADR-0010.

### 2.2 ref 팔레트

OKLCH로 설계하고 sRGB hex로 커밋한다(brief §6.1-3, `G-ENGINE-R4`). hex는 변환값과 ±1/255 안에서 같다(생성기 `scripts/design/tokens.mjs`가 같은 검사를 한다. 편집 때 쓴 대조 스크립트는 단계 (a)에서 `scripts/design/contrast.mjs`로 옮긴다).

| ref | OKLCH | hex | 쓰는 sys |
|---|---|---|---|
| `--ref-gray-965` | oklch(0.965 0 0) | `#F3F3F3` | 라이트 bg |
| `--ref-gray-930` | oklch(0.93 0 0) | `#E8E8E8` | 라이트 surface-2·track, 다크 fg |
| `--ref-gray-720` | oklch(0.72 0 0) | `#A4A4A4` | 다크 fg-muted |
| `--ref-gray-890` | oklch(0.89 0 0) | `#DBDBDB` | 라이트 surface-pressed |
| `--ref-gray-700` | oklch(0.70 0 0) | `#9E9E9E` | 라이트 fg-disabled |
| `--ref-gray-620` | oklch(0.62 0 0) | `#868686` | 다크 border-strong |
| `--ref-gray-600` | oklch(0.60 0 0) | `#808080` | 라이트 border-strong |
| `--ref-gray-540` | oklch(0.54 0 0) | `#6F6F6F` | 다크 fg-disabled |
| `--ref-gray-480` | oklch(0.48 0 0) | `#5D5D5D` | 라이트 fg-muted |
| `--ref-gray-400` | oklch(0.40 0 0) | `#484848` | 다크 surface-pressed |
| `--ref-gray-350` | oklch(0.35 0 0) | `#3A3A3A` | 다크 surface-2 |
| `--ref-gray-320` | oklch(0.32 0 0) | `#333333` | 다크 raised |
| `--ref-gray-290` | oklch(0.29 0 0) | `#2B2B2B` | 다크 surface |
| `--ref-gray-240` | oklch(0.24 0 0) | `#1F1F1F` | 다크 bg·track |
| `--ref-gray-220` | oklch(0.22 0 0) | `#1B1B1B` | 라이트 fg |
| `--ref-white` | 고정 | `#FFFFFF` | 라이트 surface·raised, on-accent |
| `--ref-blue-54` | oklch(0.54 0.20 258) | `#0067DF` | 라이트 accent |
| `--ref-blue-48` | oklch(0.48 0.19 258) | `#0056C5` | 라이트 accent-pressed |
| `--ref-blue-50` | oklch(0.50 0.18 258) | `#085DC7` | 라이트 accent-ink·focus, 다크 accent-pressed |
| `--ref-blue-57` | oklch(0.57 0.19 258) | `#1E72E4` | 다크 accent |
| `--ref-blue-74` | oklch(0.74 0.13 255) | `#70ADFB` | 다크 accent-ink·focus |
| `--ref-blue-95` | oklch(0.95 0.03 258) | `#E2F0FF` | 라이트 accent-soft |
| `--ref-blue-33` | oklch(0.33 0.055 258) | `#233651` | 다크 accent-soft |
| `--ref-red-53` | oklch(0.53 0.20 27) | `#C51E21` | 라이트 danger |
| `--ref-red-52` | oklch(0.52 0.19 27) | `#BE2323` | 라이트 danger-ink |
| `--ref-red-56` | oklch(0.56 0.19 27) | `#CC3430` | 다크 danger |
| `--ref-red-75` | oklch(0.75 0.14 25) | `#FA8880` | 다크 danger-ink(§2.1 보정) |
| `--ref-red-95` | oklch(0.95 0.03 27) | `#FFE7E4` | 라이트 danger-soft |
| `--ref-red-33` | oklch(0.33 0.06 27) | `#502824` | 다크 danger-soft |
| `--ref-amber-51` | oklch(0.51 0.12 65) | `#945500` | 라이트 warning-ink |
| `--ref-amber-78` | oklch(0.78 0.13 75) | `#E8AA4E` | 다크 warning-ink |
| `--ref-amber-96` | oklch(0.96 0.04 80) | `#FFF0D4` | 라이트 warning-soft |
| `--ref-amber-33` | oklch(0.33 0.05 80) | `#433215` | 다크 warning-soft |
| `--ref-black-a10` | 고정 | `rgba(0,0,0,.10)` | 라이트 separator |
| `--ref-black-a30` | 고정 | `rgba(0,0,0,.30)` | 라이트 scrim |
| `--ref-black-a50` | 고정 | `rgba(0,0,0,.50)` | 다크 scrim |
| `--ref-white-a10` | 고정 | `rgba(255,255,255,.10)` | 다크 separator·다크 대화상자 안쪽 선 |
| `--ref-white-a8` | 고정 | `rgba(255,255,255,.08)` | 다크 메뉴·토스트 안쪽 선 |

전부 38개다(무채색 16, 파랑 7, 빨강 6, 호박 4, 알파 5). 성공 초록·종류 색(호박·파랑·보라 배지)·청록은 없다. 변환 골든(`scripts-test`)은 알파를 뺀 33색이다.

### 2.3 sys 색 토큰

| 토큰 | 라이트 | 다크 | 쓰는 곳 | 쓰지 않는 곳 |
|---|---|---|---|---|
| `--bg` | `#F3F3F3` | `#1F1F1F` | 창 바탕, 툴바, Worker `theme-color` | — |
| `--surface` | `#FFFFFF` | `#2B2B2B` | 그룹 상자·카드·입력칸·버튼 면: "만질 수 있는 것"은 이 면 | bg 위에 직접 놓는 입력칸은 없다(`A-DRIFT-D2` UrlBar 해소) |
| `--surface-2` | `#E8E8E8` | `#3A3A3A` | hover 채움, 배지 바탕, 코드 블록, 정보 톤 안내 면, 읽기 전용 입력 면, 비활성 창의 선택 면 | 위에 `--accent` 채움 표시(§2.4 주석) |
| `--surface-pressed` | `#DBDBDB` | `#484848` | 눌림 채움(유령·아이콘 버튼, 메뉴 항목, 라디오 행, 최근 목록 행). 글자는 `--fg`, 아이콘은 `--fg-muted` | hover(hover는 `--surface-2`) |
| `--raised` | `#FFFFFF` | `#333333` | 대화상자·메뉴·토스트. 그림자와 함께만 | 떠 있지 않은 것 |
| `--track` | `#E8E8E8` | `#1F1F1F` | 진행 막대 트랙(막대는 `--surface` 위에만 놓인다 — 다크 `--bg` 위에서는 트랙이 보이지 않는다) | 눌림 채움 |
| `--fg` | `#1B1B1B` | `#E8E8E8` | 본문·제목·숫자·오류 상태 줄 | — |
| `--fg-muted` | `#5D5D5D` | `#A4A4A4` | 보조 설명, 상태 조각, 도움말, 그룹 머리, placeholder, ✓ 완료 아이콘, 아이콘 버튼 아이콘 | 유일한 정보 전달 글자(12px와 겹치지 않게. 허용 목록은 §3.2) |
| `--fg-disabled` | `#9E9E9E` | `#6F6F6F` | 비활성 글자·아이콘 **전용**(1.4.3 예외) | 그 밖의 모든 글자 |
| `--separator` | `rgba(0,0,0,.10)` | `rgba(255,255,255,.10)` | 장식 구분선, 그룹 상자 윤곽, 툴바 밑선, 비활성 버튼 테두리 | 의미 있는 경계 |
| `--border-strong` | `#808080` | `#868686` | 입력칸·테두리 버튼·팝업·라디오·스위치 꺼짐 트랙·멈춤 진행 채움 | 장식 |
| `--accent` | `#0067DF` | `#1E72E4` | 채움: 주 버튼, 진행 채움, 스위치 켜짐, 연결 대기 줄무늬 | 글자, 작은 표시(→ `--accent-ink`), surface-2·raised 위 |
| `--accent-pressed` | `#0056C5` | `#085DC7` | 주 버튼 눌림 | — |
| `--accent-ink` | `#085DC7` | `#70ADFB` | 웹 링크, 포커스 링, 라디오 점, 선택된 메뉴 항목의 ✓, 드롭 오버레이 선 | 채움, 앱의 글자 버튼(유령 버튼 글자는 `--fg`, D21) |
| `--accent-soft` | `#E2F0FF` | `#233651` | 선택된 라디오 행, 새 항목 1초 강조 | 배너·정보 안내 면(정보 톤은 중립, `A-VIS-41`) |
| `--on-accent` | `#FFFFFF` | `#FFFFFF` | `--accent`·`--accent-pressed` 위 글자 | — |
| `--danger` | `#C51E21` | `#CC3430` | 채움: 실패 진행 채움(track 위 4.79 / 3.22) | 버튼 채움(파괴 동작에 primary 금지, HIG buttons), 글자 |
| `--danger-ink` | `#BE2323` | `#FA8880` | 위험 글자 버튼, ⊗ 오류 아이콘, `aria-invalid` 테두리 | 본문 |
| `--danger-soft` | `#FFE7E4` | `#502824` | 오류 안내 면, 위험 유령 버튼의 눌림 면(hover는 `--surface-2`) | — |
| `--warning-ink` | `#945500` | `#E8AA4E` | ⚠ 경고 아이콘·글자 | 채움 |
| `--warning-soft` | `#FFF0D4` | `#433215` | 경고 안내 면, 서비스 공지 배너(block) | — |
| `--focus` | = `--accent-ink` | = `--accent-ink` | `outline` 색 | — |
| `--scrim` | `rgba(0,0,0,.30)` | `rgba(0,0,0,.50)` | 대화상자 뒤 | — |

성공색이 없는 이유와 재검토 조건은 §2.1. 정보 톤은 `--surface-2` + ⓘ 아이콘(`--fg-muted`)이다(D10=C. `A-VIS-41`: 정보 = 브랜드 = CTA가 구별되지 않던 결함). 종류 배지(일반 VOD·빠른 다시보기·클립)와 성인 "19"는 `--surface-2` 면 + **`--fg`** 12px 600 글자다(D10=B, `A-VIS-31`, `G-ICON-2` "종류 배지에 아이콘 불필요". 글자가 `--fg`인 이유: 배지는 종류·연령의 유일한 신호라 12px `--fg-muted` 단독 금지(§3.2)에 걸린다).

비활성 창(macOS `data-window-active="false"`, `E-APPLE-13`): `--accent-soft`를 `--surface-2`로 재정의하는 블록 하나다(selector는 §10). 새 토큰은 없다. 선택 행의 라디오 점은 `--accent-ink`라 `--surface-2` 위에서도 4.5:1을 넘긴다(§2.4). 편집 전 점이 `--accent`였을 때 다크 비활성 창에서 2.48이던 결함을 이것으로 닫았다.

### 2.4 대비 계산값

편집 때 쓴 대조 스크립트(단계 (a)에서 `scripts/design/contrast.mjs`)가 WCAG 2.x 상대 휘도로 계산했다(라이트 46쌍·다크 46쌍 판정 모두 PASS, 테마마다 참고값 3행). `design-tokens` DT8은 같은 쌍 목록을 `design/tokens/contrast.tokens.json`에서 읽어 다시 계산한다. 쌍 목록을 줄이는 변경은 ADR이 필요하다.

주석:
- 채움 `--accent`·`--danger`를 **상태 표시**(진행 채움·스위치 트랙)로 쓰는 바탕은 `bg`·`surface`·`track`뿐이다. `surface-2`·`raised`·`accent-soft` 위의 작은 표시(라디오 점·선택 ✓)는 `--accent-ink`로 그린다(다크 `accent / surface-2` 2.48, `/ raised` 2.76이라 3:1 미달). 강제 `design-gallery`(forced·다크 axe) + `R1`.
- 채움 **버튼**의 윤곽에는 대비 요구가 없다. WCAG 1.4.11 Understanding: 글자로 식별되는 컴포넌트의 경계는 예외다. 글자 대비(`on-accent / accent`)만 본다.
- 선택된 라디오의 상태 표시는 점(`--accent-ink`) ↔ 안쪽 고리(`--surface`)다(라이트 6.18·다크 6.11, `accent-ink / surface` 행). 고리 바깥 테두리 ↔ `--accent-soft` 면은 윤곽이라 요구가 없다.
- 눌림 면(`--surface-pressed`) 위에는 `--fg` 글자와 `--fg-muted` 아이콘만 놓인다(위험 톤의 눌림 면은 `--danger-soft`라 기존 쌍이 덮는다).
- `--fg-disabled`는 1.4.3 비활성 예외라 참고값만 적었다. 면 단계(`surface / bg`, `surface-2 / surface`)는 장식이고 의미를 싣지 않는다.

#### 라이트

| 전경 | 바탕 | 대비 | 최소 | 판정 | 종류 |
|---|---|---|---|---|---|
| `--fg` #1B1B1B | `--bg` #F3F3F3 | 15.52 | 4.5 | PASS | 글자 |
| `--fg-muted` #5D5D5D | `--bg` #F3F3F3 | 5.93 | 4.5 | PASS | 글자 |
| `--accent-ink` #085DC7 | `--bg` #F3F3F3 | 5.57 | 4.5 | PASS | 글자 |
| `--danger-ink` #BE2323 | `--bg` #F3F3F3 | 5.48 | 4.5 | PASS | 글자 |
| `--warning-ink` #945500 | `--bg` #F3F3F3 | 5.32 | 4.5 | PASS | 글자 |
| `--border-strong` #808080 | `--bg` #F3F3F3 | 3.56 | 3 | PASS | 경계 |
| `--fg` #1B1B1B | `--surface` #FFFFFF | 17.22 | 4.5 | PASS | 글자 |
| `--fg-muted` #5D5D5D | `--surface` #FFFFFF | 6.58 | 4.5 | PASS | 글자 |
| `--accent-ink` #085DC7 | `--surface` #FFFFFF | 6.18 | 4.5 | PASS | 글자 |
| `--danger-ink` #BE2323 | `--surface` #FFFFFF | 6.08 | 4.5 | PASS | 글자 |
| `--warning-ink` #945500 | `--surface` #FFFFFF | 5.90 | 4.5 | PASS | 글자 |
| `--border-strong` #808080 | `--surface` #FFFFFF | 3.95 | 3 | PASS | 경계 |
| `--fg` #1B1B1B | `--surface-2` #E8E8E8 | 14.06 | 4.5 | PASS | 글자 |
| `--fg-muted` #5D5D5D | `--surface-2` #E8E8E8 | 5.37 | 4.5 | PASS | 글자 |
| `--accent-ink` #085DC7 | `--surface-2` #E8E8E8 | 5.04 | 4.5 | PASS | 글자 |
| `--danger-ink` #BE2323 | `--surface-2` #E8E8E8 | 4.96 | 4.5 | PASS | 글자 |
| `--warning-ink` #945500 | `--surface-2` #E8E8E8 | 4.82 | 4.5 | PASS | 글자 |
| `--border-strong` #808080 | `--surface-2` #E8E8E8 | 3.22 | 3 | PASS | 경계 |
| `--fg` #1B1B1B | `--raised` #FFFFFF | 17.22 | 4.5 | PASS | 글자 |
| `--fg-muted` #5D5D5D | `--raised` #FFFFFF | 6.58 | 4.5 | PASS | 글자 |
| `--accent-ink` #085DC7 | `--raised` #FFFFFF | 6.18 | 4.5 | PASS | 글자 |
| `--danger-ink` #BE2323 | `--raised` #FFFFFF | 6.08 | 4.5 | PASS | 글자 |
| `--warning-ink` #945500 | `--raised` #FFFFFF | 5.90 | 4.5 | PASS | 글자 |
| `--border-strong` #808080 | `--raised` #FFFFFF | 3.95 | 3 | PASS | 경계 |
| `--accent` #0067DF | `--bg` #F3F3F3 | 4.72 | 3 | PASS | 상태 표시 채움 |
| `--accent` #0067DF | `--surface` #FFFFFF | 5.24 | 3 | PASS | 상태 표시 채움 |
| `--accent` #0067DF | `--track` #E8E8E8 | 4.28 | 3 | PASS | 상태 표시 채움 |
| `--fg` #1B1B1B | `--accent-soft` #E2F0FF | 14.88 | 4.5 | PASS | 글자(면 위) |
| `--fg-muted` #5D5D5D | `--accent-soft` #E2F0FF | 5.69 | 4.5 | PASS | 글자(면 위) |
| `--accent-ink` #085DC7 | `--accent-soft` #E2F0FF | 5.33 | 4.5 | PASS | 글자(면 위) |
| `--fg` #1B1B1B | `--danger-soft` #FFE7E4 | 14.60 | 4.5 | PASS | 글자(면 위) |
| `--fg-muted` #5D5D5D | `--danger-soft` #FFE7E4 | 5.58 | 4.5 | PASS | 글자(면 위) |
| `--danger-ink` #BE2323 | `--danger-soft` #FFE7E4 | 5.15 | 4.5 | PASS | 글자(면 위) |
| `--fg` #1B1B1B | `--warning-soft` #FFF0D4 | 15.31 | 4.5 | PASS | 글자(면 위) |
| `--fg-muted` #5D5D5D | `--warning-soft` #FFF0D4 | 5.85 | 4.5 | PASS | 글자(면 위) |
| `--warning-ink` #945500 | `--warning-soft` #FFF0D4 | 5.25 | 4.5 | PASS | 글자(면 위) |
| `--on-accent` #FFFFFF | `--accent` #0067DF | 5.24 | 4.5 | PASS | 채움 위 글자 |
| `--on-accent` #FFFFFF | `--accent-pressed` #0056C5 | 6.69 | 4.5 | PASS | 채움 위 글자 |
| `--danger` #C51E21 | `--track` #E8E8E8 | 4.79 | 3 | PASS | 실패 채움/트랙 |
| `--accent-ink` #085DC7 | `--danger-soft` #FFE7E4 | 5.23 | 4.5 | PASS | 글자(면 위) |
| `--accent-ink` #085DC7 | `--warning-soft` #FFF0D4 | 5.49 | 4.5 | PASS | 글자(면 위) |
| `--fg` #1B1B1B | `--surface-pressed` #DBDBDB | 12.44 | 4.5 | PASS | 글자(눌림 면) |
| `--fg-muted` #5D5D5D | `--surface-pressed` #DBDBDB | 4.76 | 3 | PASS | 아이콘(눌림 면) |
| `--border-strong` #808080 | `--track` #E8E8E8 | 3.22 | 3 | PASS | 일시정지 채움/트랙 |
| `--danger-ink` #BE2323 | `--surface` #FFFFFF | 6.08 | 3 | PASS | 오류 테두리(aria-invalid) |
| `--danger-ink` #BE2323 | `--bg` #F3F3F3 | 5.48 | 3 | PASS | 오류 테두리(aria-invalid) |
| `--fg-disabled` #9E9E9E | `--surface` #FFFFFF | 2.68 | — | — | 비활성(예외, 참고값) |
| `--surface` #FFFFFF | `--bg` #F3F3F3 | 1.11 | — | — | 면 단계(장식, 참고값) |
| `--surface-2` #E8E8E8 | `--surface` #FFFFFF | 1.23 | — | — | 면 단계(장식, 참고값) |

separator `rgba(0,0,0,.10)` 합성값: bg 위 `#DBDBDB`(1.25:1), surface 위 `#E6E6E6`(1.25:1). 장식이라 요구가 없고, 선 하나로 의미를 전하지 않는다(brief §6.3-3).
`--focus` / bg 5.57 · / surface 6.18 · / surface-2 5.04. 채움 버튼 위 포커스 링은 `outline-offset: 2px`의 틈으로 바탕이 보이므로 링의 인접 색은 바탕이다(§6.4).

#### 다크

| 전경 | 바탕 | 대비 | 최소 | 판정 | 종류 |
|---|---|---|---|---|---|
| `--fg` #E8E8E8 | `--bg` #1F1F1F | 13.45 | 4.5 | PASS | 글자 |
| `--fg-muted` #A4A4A4 | `--bg` #1F1F1F | 6.61 | 4.5 | PASS | 글자 |
| `--accent-ink` #70ADFB | `--bg` #1F1F1F | 7.11 | 4.5 | PASS | 글자 |
| `--danger-ink` #FA8880 | `--bg` #1F1F1F | 6.98 | 4.5 | PASS | 글자 |
| `--warning-ink` #E8AA4E | `--bg` #1F1F1F | 8.08 | 4.5 | PASS | 글자 |
| `--border-strong` #868686 | `--bg` #1F1F1F | 4.53 | 3 | PASS | 경계 |
| `--fg` #E8E8E8 | `--surface` #2B2B2B | 11.56 | 4.5 | PASS | 글자 |
| `--fg-muted` #A4A4A4 | `--surface` #2B2B2B | 5.68 | 4.5 | PASS | 글자 |
| `--accent-ink` #70ADFB | `--surface` #2B2B2B | 6.11 | 4.5 | PASS | 글자 |
| `--danger-ink` #FA8880 | `--surface` #2B2B2B | 6.00 | 4.5 | PASS | 글자 |
| `--warning-ink` #E8AA4E | `--surface` #2B2B2B | 6.94 | 4.5 | PASS | 글자 |
| `--border-strong` #868686 | `--surface` #2B2B2B | 3.89 | 3 | PASS | 경계 |
| `--fg` #E8E8E8 | `--surface-2` #3A3A3A | 9.28 | 4.5 | PASS | 글자 |
| `--fg-muted` #A4A4A4 | `--surface-2` #3A3A3A | 4.56 | 4.5 | PASS | 글자 |
| `--accent-ink` #70ADFB | `--surface-2` #3A3A3A | 4.91 | 4.5 | PASS | 글자 |
| `--danger-ink` #FA8880 | `--surface-2` #3A3A3A | 4.82 | 4.5 | PASS | 글자 |
| `--warning-ink` #E8AA4E | `--surface-2` #3A3A3A | 5.57 | 4.5 | PASS | 글자 |
| `--border-strong` #868686 | `--surface-2` #3A3A3A | 3.12 | 3 | PASS | 경계 |
| `--fg` #E8E8E8 | `--raised` #333333 | 10.31 | 4.5 | PASS | 글자 |
| `--fg-muted` #A4A4A4 | `--raised` #333333 | 5.07 | 4.5 | PASS | 글자 |
| `--accent-ink` #70ADFB | `--raised` #333333 | 5.45 | 4.5 | PASS | 글자 |
| `--danger-ink` #FA8880 | `--raised` #333333 | 5.35 | 4.5 | PASS | 글자 |
| `--warning-ink` #E8AA4E | `--raised` #333333 | 6.19 | 4.5 | PASS | 글자 |
| `--border-strong` #868686 | `--raised` #333333 | 3.47 | 3 | PASS | 경계 |
| `--accent` #1E72E4 | `--bg` #1F1F1F | 3.60 | 3 | PASS | 상태 표시 채움 |
| `--accent` #1E72E4 | `--surface` #2B2B2B | 3.09 | 3 | PASS | 상태 표시 채움 |
| `--accent` #1E72E4 | `--track` #1F1F1F | 3.60 | 3 | PASS | 상태 표시 채움 |
| `--fg` #E8E8E8 | `--accent-soft` #233651 | 9.98 | 4.5 | PASS | 글자(면 위) |
| `--fg-muted` #A4A4A4 | `--accent-soft` #233651 | 4.90 | 4.5 | PASS | 글자(면 위) |
| `--accent-ink` #70ADFB | `--accent-soft` #233651 | 5.27 | 4.5 | PASS | 글자(면 위) |
| `--fg` #E8E8E8 | `--danger-soft` #502824 | 10.26 | 4.5 | PASS | 글자(면 위) |
| `--fg-muted` #A4A4A4 | `--danger-soft` #502824 | 5.04 | 4.5 | PASS | 글자(면 위) |
| `--danger-ink` #FA8880 | `--danger-soft` #502824 | 5.33 | 4.5 | PASS | 글자(면 위) |
| `--fg` #E8E8E8 | `--warning-soft` #433215 | 10.05 | 4.5 | PASS | 글자(면 위) |
| `--fg-muted` #A4A4A4 | `--warning-soft` #433215 | 4.94 | 4.5 | PASS | 글자(면 위) |
| `--warning-ink` #E8AA4E | `--warning-soft` #433215 | 6.03 | 4.5 | PASS | 글자(면 위) |
| `--on-accent` #FFFFFF | `--accent` #1E72E4 | 4.58 | 4.5 | PASS | 채움 위 글자 |
| `--on-accent` #FFFFFF | `--accent-pressed` #085DC7 | 6.18 | 4.5 | PASS | 채움 위 글자 |
| `--danger` #CC3430 | `--track` #1F1F1F | 3.22 | 3 | PASS | 실패 채움/트랙 |
| `--accent-ink` #70ADFB | `--danger-soft` #502824 | 5.42 | 4.5 | PASS | 글자(면 위) |
| `--accent-ink` #70ADFB | `--warning-soft` #433215 | 5.31 | 4.5 | PASS | 글자(면 위) |
| `--fg` #E8E8E8 | `--surface-pressed` #484848 | 7.46 | 4.5 | PASS | 글자(눌림 면) |
| `--fg-muted` #A4A4A4 | `--surface-pressed` #484848 | 3.67 | 3 | PASS | 아이콘(눌림 면) |
| `--border-strong` #868686 | `--track` #1F1F1F | 4.53 | 3 | PASS | 일시정지 채움/트랙 |
| `--danger-ink` #FA8880 | `--surface` #2B2B2B | 6.00 | 3 | PASS | 오류 테두리(aria-invalid) |
| `--danger-ink` #FA8880 | `--bg` #1F1F1F | 6.98 | 3 | PASS | 오류 테두리(aria-invalid) |
| `--fg-disabled` #6F6F6F | `--surface` #2B2B2B | 2.82 | — | — | 비활성(예외, 참고값) |
| `--surface` #2B2B2B | `--bg` #1F1F1F | 1.16 | — | — | 면 단계(장식, 참고값) |
| `--surface-2` #3A3A3A | `--surface` #2B2B2B | 1.24 | — | — | 면 단계(장식, 참고값) |

separator `rgba(255,255,255,.10)` 합성값: bg 위 `#353535`(1.34:1), surface 위 `#404040`(1.37:1).
`--focus` / bg 7.11 · / surface 6.11 · / surface-2 4.91.

### 2.5 대비 증가(`prefers-contrast: more`)

macOS "대비 증가"와 GNOME 고대비는 `forced-colors`가 아니라 이 쿼리로 온다(brief §2.5, `G-A11Y-OS7`). 목표 7:1(HIG 사용자 정의 색 권고, `E-APPLE-09`).

| 토큰 | 재정의 | 결과 대비(라이트 / 다크) |
|---|---|---|
| `--fg-muted` | `var(--fg)` | fg / surface 17.22 / 11.56 |
| `--separator` | `var(--fg)` | 장식선이 의미 경계 수준으로 |
| `--border-strong` | `var(--fg)` | 17.22 / 11.56 |
| `--track` | 바꾸지 않는다(채움 accent / track 4.28 / 3.60 유지) | 대신 진행 막대 트랙에 `1px solid var(--fg)` 테두리를 더한다(components.md ProgressBar). 트랙을 진하게 하면 채움과의 대비가 깨진다 |

이 블록이 다크 블록을 이기려면 특이도가 같거나 높고 소스에서 뒤에 와야 한다. 그래서 테마·상태 블록의 selector는 전부 `:root:where(…)`로 특이도 (0,1,0)에 맞추고 순서로 결정한다(§10, §13. 편집 전 다크 블록이 (0,2,0)이라 다크 + 대비 증가에서 이 블록이 죽던 결함). 강제: `design-tokens` DT11(블록 값) + DT16(계산값: 다크 + `prefers-contrast: more`에서 `--fg-muted` = `--fg`, 비활성 창에서 `--accent-soft` = `--surface-2`) + `design-gallery`(에뮬레이션 axe).

### 2.6 C1 색상각 검사 결과

유채색 ref 19개 전부 PASS(H 140~170° 밖). 파랑 H 211~215°, 빨강 H 355~7°, 호박 H 34~39°. 무채색 14개는 S 0이라 대상이 아니다. 네이버 그린 `#03C75A`(H 146°)와 가장 가까운 토큰은 호박 `#E8AA4E`(H 36°)로 110° 떨어져 있다.

### 2.7 forced-colors 매핑(Windows 고대비)

`forced-colors: active`는 Windows WebView2에서만 켜진다(brief §2.5). 색·배경·테두리·outline·SVG fill/stroke가 시스템 색으로 강제되고 `box-shadow`·gradient는 `none`이 된다(`E-KO-B6` 실측). `forced-color-adjust: none`은 쓰지 않는다(`G-A11Y-OS3`. 강제 `design-lint` grep).

| sys 토큰 / 요소 | 시스템 색 | 비고 |
|---|---|---|
| `--bg` `--surface` `--surface-2` `--raised` `--track` | `Canvas` | 면 단계가 사라지므로 아래 경계 규칙이 위계를 대신한다 |
| `--fg` `--fg-muted` | `CanvasText` | 보조 글자도 `CanvasText`다. `GrayText`를 보조 글자에 쓰지 않는다(R-OS-4) |
| `--fg-disabled` | `GrayText` | 비활성에만 |
| `--separator` `--border-strong` | `CanvasText` | 모든 경계가 같은 색이 된다 |
| `--accent`(채움) + `--on-accent` | `Highlight` + `HighlightText` | 주 버튼·스위치 켜짐·진행 채움 |
| `--accent-soft`(선택 행) | `Highlight` 면 + `HighlightText` 글자, 또는 `outline: 1px solid Highlight` | 둘 중 하나. components.md가 컴포넌트별로 정한다 |
| `--accent-ink` 작은 표시 | `CanvasText`(라디오 점·✓), 웹 링크는 `LinkText` | — |
| `--danger-ink` `--warning-ink` | `CanvasText` | 색이 사라지므로 아이콘 모양(⊗·⚠)과 글자가 뜻을 전한다(§9 은유 표) |
| `--focus` | UA가 `outline`을 시스템 색으로 그린다 | `outline` 기반이므로 자동으로 살아 있다(D20). box-shadow 링은 사라진다 |
| `--scrim` | `transparent` | — |
| `--shadow-*` | `none`(자동) | 대신 대화상자·메뉴·토스트에 `2px solid CanvasText` 테두리 |
| 입력칸·버튼·배지·팝업 | `1px solid CanvasText` 테두리 | 면으로 구분하던 것을 선으로 |
| 진행 트랙 / 채움 / 일시정지 / 실패 | 트랙 `1px solid CanvasText`, 채움 `Highlight`, 일시정지 채움 `GrayText` + 오른쪽 `2px solid CanvasText` [잠정], 실패 채움 `CanvasText` + ⊗ 아이콘 | 형태 단서(brief §6.6-2, `G-A11Y-OS6`). 일시정지에 `GrayText`를 쓰는 것은 "멈춘 것"이 비활성에 가깝다는 판단이고 `platform.md` §21 M15에서 본다 |
| 아이콘 | `currentColor`(stroke) | 고정 fill·stroke 색 금지(R-OS-5) |
| 연결 대기 줄무늬(gradient) | 사라진다 → `1px dashed CanvasText` 테두리로 대체 | gradient는 none이 되므로 |
| Switch | 켜짐 트랙 `Highlight` + 손잡이 `Canvas`, 꺼짐 트랙 `Canvas` + 1px `CanvasText` + 손잡이 `CanvasText` | 위치가 상태를 말한다 |
| Menu·Toast·Dialog(떠 있는 것) | `2px solid CanvasText` 테두리, 항목 포커스는 UA outline | 그림자가 사라진다 |
| Disclosure·Surface·EmptyState | `1px solid CanvasText` 윤곽, 삼각형은 `currentColor` | — |
| Skeleton | `1px solid GrayText`(비활성 자리표시) | — |
| Spinner | `currentColor` 호 | — |
| Kbd·Badge | `1px solid CanvasText` | — |
| 드롭 오버레이 | `2px dashed CanvasText` | gradient·색이 사라진다 |

강제: `design-gallery`가 `emulateMedia({ forcedColors: 'active' })`로 네 화면과 실패·일시정지 행을 찍고 axe를 돈다. 새 컴포넌트는 이 표에 행을 더한다(`R9`). 컴포넌트별 세부는 `components.md` §3.

---

## 3. 글자

### 3.1 글꼴 스택

시스템 글꼴만 쓴다. 번들하지 않는다(사용자 결정 2. 강제 `design-tokens`: 기존 `tokens.test.ts`의 "번들 글꼴 없음" + `url(`·`@font-face` 0개, Worker는 `worker` gate의 `url(`·`@import` 금지).

```css
--font-sans: system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR', 'Noto Sans KR',
             'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
--font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Cascadia Mono', 'D2Coding', monospace;
```

| OS | 라틴·숫자 | 한글 | 확인 수준 |
|---|---|---|---|
| macOS | `system-ui` = SF. WKWebView 글자 폭이 AppKit과 0.02px 이내로 같다 | `.AppleSDGothicNeoI-*` 폴백, 크기 그대로 | [실측] `E-APPLE-05`·`E-APPLE-07` |
| Windows | `system-ui`가 Segoe UI인지 맑은 고딕인지 **[미확인]** | 맑은 고딕(굵기 Semilight·Regular·Bold 셋, `E-A11Y-D25`). CSS 600이 Bold로 폴백돼 400과 구별되는지 **[미확인]** | MDN: Windows CJK 기본 글꼴이 라틴을 어색하게 그릴 수 있다(`E-DESK-E32`). 확인: Windows 실기에서 `getComputedStyle` + 스크린샷(README §6-1) |
| Linux | fontconfig가 정한다(DejaVu Sans 기록) | Noto Sans CJK KR이 있어야 한다 **[미확인]** | 확인: Ubuntu 22.04·24.04 실기(README §6-2) |

규칙(근거 brief §2.3·§6.4):
- `system-ui`가 맨 앞이다. Chromium은 `-apple-system`을 시스템 글꼴로 쓰지 않는다(`E-APPLE-06`). `'SF Pro Text'` 같은 이름 지정은 폴백이 된다(확정 5). 강제 `design-lint`: `font-family` 선언은 토큰 둘만, 글꼴 이름 리터럴 금지.
- 이모지 글꼴 3종은 한글 글꼴 뒤, `sans-serif` 앞이다(g-ugt). Linux 흑백 이모지·Windows 국기 분리는 알려진 한계다.
- `ui-monospace`는 Chromium이 모르므로 Consolas·Cascadia 폴백이 있다(brief §2.1).
- 숫자는 라틴 시스템 글꼴에서 나온다. Apple SD Gothic Neo의 숫자는 `tabular-nums`가 안 되지만(`E-KO-A7` 실측) `system-ui`가 앞이라 숫자는 SF로 그려진다. Windows 맑은 고딕 폴백 때의 동작은 **[미확인]**(README §6-1).

### 3.2 앱 척도

macOS 텍스트 스타일 표를 그대로 가져왔다(`E-APPLE-02`: 17/22, 15/20, 13/16, 12/15 → 12는 행간 16으로 올려 4 격자에 맞춤). 웹뷰의 줄 상자는 한글만 있어도 SF 메트릭(13px에서 16)을 따르므로 모순이 없다(확정 7). 행간은 **정수 px 토큰**이다(bigtech 정수 행간 권장, B 후보 이름. brief §6.1-7 "단위 없는 숫자"는 `normal` 금지가 뜻이고 px 토큰도 결정적이므로 §12에 구현 중 변경으로 적는다).

| 역할 | `--text-*` | `--leading-*` | 굵기 | 쓰는 곳 |
|---|---|---|---|---|
| caption | **12px** | 16px | 400 (그룹 머리·배지는 600) | 보조 설명, 상태 조각 보조, 그룹 머리, 배지, kbd, 코드 블록, 바닥글 |
| body | **13px** | 16px | 400 | 본문, 컨트롤, 행, 상태 줄, 섹션 제목(600) |
| title | **15px** | 20px | 600 | 카드 제목, 대화상자 제목, 랜딩 CTA 글자 |
| display | **17px** | 22px | 600 | 화면 제목(설정), 빈 상태 머리 |
| read(행간만) | — | `--leading-read` 20px | — | 두 줄 넘는 문단(안내·오류 본문·대화상자 본문). 13px × 1.54. WCAG 1.4.12(1.5배 덮어쓰기)에 대비 |

- 최소 글자 크기는 **12px**이다. 11px은 쓰지 않는다(`G-SCALE-7`: Windows 캡션 12와 같은 하한, 100% 배율 Linux가 가장 취약. 강제 `design-tokens` DT5: 모든 `--text-*` ≥ 12, `design-lint` DL5: `font-size` 리터럴 금지). **12px `--fg-muted` 글자 하나만으로 의미를 전하지 않는다**(brief §6.4-3. 리뷰 `R1`). 허용 목록(다른 단서와 겹치거나 보조이기 때문): 그룹 머리의 개수(행이 셀 수 있다), 설정·입력 도움말(라벨이 뜻을 가진다), 붙여넣기 힌트, Worker 표 둘째 줄, kbd. 배지는 글자가 `--fg`이고(§2.3), "가장 좋은 화질" 꼬리표는 13px `--fg-muted`다.
- 섹션 제목(13/600) < 카드 제목(15) < 화면 제목(17)으로 역전이 없다(`A-VIS-17` 해소).
- 본문 13은 **[잠정]**이다(사용자 결정 4). 근거는 macOS 기본 13(`E-APPLE-01`), C3 "12~14", 치지직 웹 12~14(비공식). 반례는 데스크톱 수렴 14(bigtech confirmed). **Windows 실기(맑은 고딕 13px 판독, 600 렌더, tnum)에서 작으면 `--text-body`·`--leading-body` 두 줄을 14/18로 바꾼다.** 컨트롤 28은 14/18에서도 상하 5px 여유가 있어 연쇄 변경이 없다. 그 외 토큰은 건드리지 않는다. 확인 방법은 README §6-1.
- 앱 안 "글자 크기" 설정(D28)은 `:root[data-text-scale]`가 글자·행간 토큰만 재정의한다. 컨트롤 높이는 `min-height`라 따라 늘어난다(g-input: 크기 토큰은 글자와 분리).

| `data-text-scale` | caption | body | title | display | read | 근거 |
|---|---|---|---|---|---|---|
| (기본) | 12/16 | 13/16 | 15/20 | 17/22 | 20 | 위 표 |
| `large` | 16/20 | 17/22 | 20/26 | 22/28 | 26 | ×1.3 [잠정] |
| `x-large` | 24/30 | 26/34 | 30/38 | 34/44 | 40 | ×2.0 = WCAG 1.4.4 200%(`E-APPLE-08`) [잠정]. 720×520에서 리플로우가 깨지지 않아야 한다(`design-gallery` x-large 스냅) |

유도 규칙(생성기가 계산하고 원천에는 기본값과 배율 1.3·2.0만 둔다. 그래서 `--text-body`를 14로 바꾸면 이 블록도 따라온다, README D11): 크기 = round(기본 × 배율), 행간 = 크기 × 1.25 이상인 가장 작은 짝수, 읽기 행간 = round(20 × 배율). 강제 `design-tokens` DT11(블록 값이 이 식과 같다).

### 3.3 Worker 읽기 척도

문단을 읽는 페이지(랜딩·`/help`·`/privacy`·`/licenses`)는 **`<main data-scale="reading">`**으로 같은 토큰의 값만 올린다(C 후보의 구조, judgment §2.3-6). 속성이 `main`에 있으므로 사이트 헤더·바닥글은 앱 척도(13) 그대로다(페이지마다 헤더 크기가 달라지던 문제, `web.md` §2). 로그인·관리·결과 페이지는 UI 화면이라 앱 척도 그대로다. 앱의 13px이 1280 화면의 문단에는 작고(A 약점 6), C의 17은 다른 제품처럼 보여서 중간값 15를 쓴다. 15의 근거는 TDS 작은 본문 15(v-ko confirmed)이고 "문단을 읽는 화면"에만 적용한다.

| 역할 | 값 | 근거 |
|---|---|---|
| caption | 13/18 | TDS 13/19.5 → 정수 [잠정] |
| body | **15/22** | TDS 15/22.5 → 정수(confirmed). 문단 행간도 22 |
| title(h3) | 17/24 | TDS 17/25.5 → 정수 [잠정] |
| display(h2) | 22/28 | macOS 22/26 → 4 격자 28 [잠정] |
| hero(h1) | 28/36 | judgment §2.3-6 "h1 28" [잠정]. 폭 600 미만에서는 22/28 |
| `--control-h-lg` | 36 | 랜딩 CTA. 44는 쓰지 않는다(judgment §2.5) |
| `--reading-max` | 680px | 읽기 열 폭 **[취향]**(A, ADR-0009). 15px 한글 약 45자. 읽기 페이지의 사이트 헤더 안쪽 폭도 이 값이다 |

확인: 첫 시험 D62에서 소영 과업(랜딩 → 설치)을 1280 화면과 휴대폰 폭에서 보고, Windows·Linux 실기 스크린샷을 `R1`로 남긴다.

### 3.4 굵기·자간·다듬기

| 항목 | 값 | 근거 | 강제 |
|---|---|---|---|
| 굵기 | `--weight-regular: 400`, `--weight-strong: 600`. 둘뿐이다. 500·700·Light 없음 | D13=A. SEED "500은 플랫폼마다 다르게 보인다", KRDS 기본 400+700, 맑은 고딕 굵기 셋(`E-A11Y-D25`) 중 CSS 600의 폴백 렌더만 **[미확인]**이라 두 단계가 어느 결과에서도 안전하다. Light 계열은 쓰지 않는다(`E-APPLE-03`) | `design-lint`: `font-weight` 리터럴 금지, 토큰 두 개만 |
| 자간 | 0. `letter-spacing`을 선언하지 않는다 | D14=A. macOS는 SF 트래킹 곡선 위에 가산된다(`E-APPLE-04`·`E-APPLE-05`), klreq·KRDS 한글 0 | `design-lint`: `letter-spacing` 0개 |
| 다듬기 | `-webkit-font-smoothing`을 선언하지 않는다 | D15=A. macOS 전용이고(`E-DESK-E31`) 한글 굵기 단계를 흐린다(`G-ENGINE-R6`, g-scale) | `design-lint`: 0개 |
| 숫자 | 바뀌는 숫자(퍼센트·크기·속도·시각·개수·표)는 `font-variant-numeric: tabular-nums` | brief §6.4-4, `A-DRIFT-K5` | `design-lint`: `.num` 유틸은 `app/src/app.css`(Worker는 `worker/src/http/site.css`)에만 선언, 컴포넌트에서 숫자 표시 요소는 유틸 사용(리뷰 `R1`) |

### 3.5 줄바꿈과 말줄임

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 전역 | `word-break: keep-all; overflow-wrap: anywhere;` + `<html lang="ko">` | 한국어 UI 관례(`E-KO-A6`), g-ugt §4 | `design-lint`: `break-word`·`text-align: justify` 금지 |
| 경로 | `overflow-wrap: anywhere` + 가운데 말줄임은 JS(`g-save`) | brief §6.12-2 | copy/format 테스트 |
| 해시·코드 | `word-break: break-all` | brief §6.4-5 | — |
| 한 줄 말줄임 유틸 | `.ellipsis { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; overflow-wrap: normal; }`(`app.css`·`site.css`에만) + 전체 제목에 닿는 키보드 경로(작업 행은 2줄 `-webkit-line-clamp`, `patterns.md` §14.3) | brief §6.4-5·§6.11-4 | `design-lint`: `title=` 허용 목록(`G-INPUT-IN2`) |
| 고정 폭에 글자 폭 맞추기 | 하지 않는다. Chromium·WebKit 줄 수가 다를 수 있고 Linux 100%는 폭이 정수 반올림된다 | `E-KO-A6`, g-scale | 리뷰 `R1`(720 스크린샷) |
| `line-height` | `var(--leading-*)`만. `normal`·비율 리터럴 금지 | `E-KO-B7`, `E-DESK-E33` | `design-lint` |
| 외부 문자열 | `<bdi>` 격리, `cleanDisplayText` 한 곳, `{@html}` 금지 | g-ugt §5·§7 | `design-lint`(`{@html}` 0개) + `frontend` 단위 테스트 |

---

## 4. 간격

4px 격자 + 2px 반단계다(D17=A. bigtech §10: Fluent·Atlassian·Primer·Polaris·Spectrum 모두 2·6이 있다, confirmed. AppKit 상수 가장자리 20·형제 8·격자 6, `E-APPLE-17`). 이름은 값이다(§1 규칙 2).

| 토큰 | 값 | 쓰는 곳 |
|---|---|---|
| `--space-2` | 2px | 상태 줄 안 아이콘-글자 사이, 스위치 손잡이 안쪽 여백 |
| `--space-4` | 4px | 배지 사이, 라벨 아래 보조 글, 그룹 상자 안쪽 패딩(동심 10−4=6), 연결 대기 줄무늬 간격, 끝자리 아이콘 버튼 보정 |
| `--space-6` | 6px | **`--gap-label`** 라벨-컨트롤, 행 상하 패딩, 배지 가로 패딩 |
| `--space-8` | 8px | **`--gap-sibling`** 형제 컨트롤, 행 가로 패딩(아이콘 버튼 쪽), 행 동작 버튼 사이, 카드 머리 상하, 줄무늬 주기 |
| `--space-12` | 12px | 행 가로 패딩(글자 쪽), 버튼 가로 패딩, 폼 행 사이, 작업 행 상하, 대화상자 제목↔본문 |
| `--space-16` | 16px | 카드 안쪽 패딩, 열 상단 여백 |
| `--space-20` | 20px | **`--edge`** 창·열 가장자리, 대화상자 패딩, 대화상자 버튼 위 여백 |
| `--space-24` | 24px | 섹션 사이 |
| `--space-32` | 32px | 열 하단 여백, 빈 상태 상하 |
| `--space-40` | 40px | Worker 절 사이, 히어로 위 |

허용 값은 이 열 개뿐이다. 48·64는 쓸 자리가 없어 두지 않는다(미사용 토큰 0개 원칙). 광학 보정 토큰은 없다. 아이콘 글리프 보정은 에셋 안에서 하고(§9), 열·행 **끝자리**의 유령·아이콘 버튼은 자기 가로 패딩만큼 바깥 여백을 음수로 둬 글자·아이콘 상자 가장자리를 정렬선에 맞춘다(`components.md` §2.1·§2.2, `calc(0px - var(--space-6))`). 강제: `design-tokens` DT6(값 집합 고정) + `design-lint` DL2(컴포넌트의 px 리터럴 금지. 예외: `0`·`0px`, `1px`·`2px` 선 굵기, `50%`·`100%`).

**`calc()` 정책**(`design-lint` DL2): 피연산자가 전부 토큰·`0px`·`100%`·정수 계수인 `calc()`만 허용한다. 숫자 리터럴 피연산자(`calc(100% - 20px)`)는 금지다. 쓰는 곳: 스위치 손잡이 이동 `calc(var(--switch-w) - var(--switch-h))`, 대화상자 `max-width: calc(100% - 2 * var(--edge))`·`max-height`, 토스트 폭, 스크롤 영역 `scroll-padding`, 끝자리 보정 음수 여백.

의미 별칭 셋은 토큰이다(값 이름이 아니라 역할 이름이라 값이 바뀔 수 있다):

| 별칭 | 값 | 근거 |
|---|---|---|
| `--edge` | 20px | AppKit 창 가장자리 20(`E-APPLE-17`) |
| `--gap-sibling` | 8px | AppKit 형제·`NSStackView` 8 |
| `--gap-label` | 6px | AppKit `NSGridView` 6 |

---

## 5. 크기

### 5.1 컨트롤 높이

AppKit Tahoe 실측 regular 24 · large 28 · extraLarge 36(`E-APPLE-19`, `E-DESK-R37`). "빅테크 수렴 32"는 부분 refuted(verify-scales: Polaris 28, Carbon 48)라 쓰지 않는다. 36 기본은 "웹 냄새"(desktop)라 랜딩 CTA에만 둔다.

| 토큰 | 마우스 | 터치(`any-pointer: coarse`) | 쓰는 곳 | 근거 |
|---|---|---|---|---|
| `--control-h-sm` | **24px** | 40px | 행 안 보조 버튼, 아이콘 버튼(아이콘 16), 체크박스 상자 | AppKit regular 24, WCAG 2.5.8 바닥 24. 터치는 Windows 7.5mm ≈ 40epx(`G-INPUT-IN4`, confirmed) |
| `--control-h` | **28px** | 40px | 입력칸, 버튼, 팝업 기본, 툴바 아이콘 버튼(아이콘 20) | AppKit large 28. 24는 바닥과 같아 기본에는 여유를 둔다 |
| `--control-h-lg` | **36px** | 44px | 랜딩 CTA만 | AppKit extraLarge 36. 44는 Apple 터치 값 |
| `--row-h` | **36px** | 44px | 설정 행·최근 목록 행 최소 높이 | 28 컨트롤 + 상하 4 |
| `--toolbar-h` | **44px** | 44px | 앱 툴바(네이티브 타이틀바 아래) | [취향] A. Windows 타이틀바 32·검색 포함 48 사이 |
| `--hit-min` | **24px** | 40px | 모든 대화형 요소의 최소 폭·높이 | WCAG 2.5.8 AA |

터치 값은 `tokens.css`의 `@media (any-pointer: coarse)` 블록 **한 곳**에만 있다(`G-INPUT-IN5`·`G-INPUT-IN6`: `hover: none`·`pointer: coarse` 분기 금지, 시작 때 JS 판정 금지). 강제 `design-tokens`(coarse 블록 존재·값) + `design-lint`(컴포넌트 CSS 안 `@media (pointer`·`hover` 금지) + `design-gallery`(`availablePointerTypes` 흉내로 40·44 검사).

### 5.2 그 밖의 크기

| 토큰 | 값 | 근거 |
|---|---|---|
| `--icon-sm` / `--icon-md` | 16px / 20px | §9. 상자와의 차가 짝수(24−16, 28−20)라 반 픽셀 어긋남이 없다(g-icon §5.2) |
| `--switch-w` / `--switch-h` / `--switch-knob` | 54px / 24px / 20px | AppKit regular 스위치 54×24(`E-APPLE-19` 실측). 높이 24로 2.5.8 충족 |
| `--radio-size` | 16px | AppKit regular 라디오·체크박스 16(확정 19) |
| `--progress-h` | 6px | **[취향]**(A). AppKit 막대 상자 20 안의 실제 두께를 재지 않았다. 다크 720에서 트랙과 채움 구분(B의 4px은 가늘다, `J-F-B8`). 확인: 첫 시험 때 D62 "진행을 읽는가" |
| `--badge-h` | 18px | 캡션 행간 16 + 상하 1. 종류 배지·"19"·kbd. `min-height`라 큰 글자에서 늘어난다 |
| `--dialog-w` | 440px | **[취향]**(A, ADR-0009). 대화상자와 로그인 패널. 720 창에서 좌우 140(열 안쪽 680 기준 120) |
| `--label-w` | 80px | 카드 폼(FieldRow)의 라벨 열 폭 **[취향]**(A, ADR-0009). 4글자 라벨 + 여유. 좁은 레이아웃에서는 1열이라 쓰이지 않는다 |
| `--pct-w` | 40px | 작업 행 퍼센트 칸 폭 **[취향]**(A, ADR-0009). "100%" 네 글자 tabular 13px이 글꼴마다 달라 토큰으로 고정한다 |

컴포넌트 전용 치수도 여기 토큰(`--label-w`·`--pct-w`)이다. 그 밖의 치수는 위 토큰의 조합이고 산술은 §4의 `calc()` 정책 안에서만 한다(comp 층을 비운다는 원칙).

---

## 6. 반경·선·면·그림자

### 6.1 반경(동심)

| 토큰 | 값 | 쓰는 곳 | 근거 |
|---|---|---|---|
| `--radius-badge` | 4px | 글자 배지, kbd | Win11 페이지 안 컨트롤 4 |
| `--radius-control` | 6px | 버튼·입력칸·팝업·행 하이라이트·안내 상자·코드 블록 | 그룹 10 − 안쪽 패딩 4 = 6(동심. WWDC25 356 "동심 반지름 = 부모 − 패딩", 유도식임을 명시) |
| `--radius-group` | 10px | 그룹 상자·카드·`<details>` | Geist·Primer 6/12 사이 [취향 범위] |
| `--radius-overlay` | 12px | 대화상자·메뉴·토스트 | 오버레이가 면보다 둥글다(Win11 8/4, Geist menu·modal 12, confirmed) |
| `--radius-pill` | 999px | 스위치·진행 막대만 | HIG: 캡슐은 밀집 데스크톱에서 눈에 띄는 동작에만(`E-APPLE-20`) → 버튼에는 쓰지 않는다 |

맞닿는 모서리는 0이다(Win11). 강제 `design-lint`(`border-radius` 리터럴 금지) + `design-tokens`(값 집합).

### 6.2 선

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 굵기 | **1px과 2px만**. 0.5·1.5·소수 금지 | g-scale §2.2 실측: 1px은 125~175%에서 늘 1기기 픽셀 완전 덮임, 1.5는 125%에서 1·150%에서 2로 뒤집힘 | `design-lint`: `border`·`outline` 굵기 리터럴 1px·2px 외 금지 |
| 그리는 법 | `border`·`outline`만. box-shadow 링·gradient 선은 장식 윤곽에만 | g-scale §5.2. box-shadow 링은 125·175%에서 반 픽셀 번진다 | `design-lint`: `:focus-visible`에 `box-shadow` 금지 |
| 의미 경계 | `--border-strong`, 인접 모든 바탕에 ≥ 3:1(§2.4 표 8쌍 모두 통과) | WCAG 1.4.11 | `design-tokens` |
| 장식선 | `--separator` α.10. 대비 요구 없음, 단독으로 의미 전달 금지 | `E-APPLE-11`(separator α0.10 구조) | 리뷰 `R1` |
| 금지 | `calc(N - 1px)`, `translate(-50%,-50%)` 가운데 정렬, 정지 상태 글자 요소의 `transform` | g-scale §5.2(스냅 안 됨) | `design-lint` grep |

### 6.3 면 단계

바탕 회색 > 흰 그룹 상자 > 떠 있는 것(시스템 설정 방식, D19=C 혼합. `A-DRIFT-K10` 유지).

| 층 | 라이트 | 다크 | 경계 |
|---|---|---|---|
| 창 바탕 `--bg` | `#F3F3F3` | `#1F1F1F` | — |
| 만질 수 있는 면 `--surface` | `#FFFFFF` | `#2B2B2B` | `1px solid var(--separator)` 윤곽 |
| 눌림·채움 `--surface-2` | `#E8E8E8` | `#3A3A3A` | — |
| 떠 있는 것 `--raised` | `#FFFFFF` | `#333333` | 그림자(§6.4). 다크는 안쪽 1px 흰 α.08~.10 선이 경계 |

다크 계단은 L 0.24 → 0.29 → 0.32 → 0.35다(간격 0.03~0.05). 흰 면 = "만질 수 있는 것"이므로 입력칸·버튼은 bg 위에 직접 놓지 않고 `--surface` 면 위에 둔다(`A-DRIFT-D2`). 반투명·블러는 쓰지 않는다. `prefers-reduced-transparency`가 WebKit에 없다(`E-APPLE-14`. 강제 `design-lint`: `backdrop-filter` 0개).

### 6.4 그림자(떠 있는 것만)

| 토큰 | 라이트 | 다크 | 쓰는 곳 |
|---|---|---|---|
| `--shadow-menu` | `0 0 0 1px rgba(0,0,0,.08), 0 4px 12px rgba(0,0,0,.14)` | `inset 0 0 0 1px rgba(255,255,255,.08), 0 4px 12px rgba(0,0,0,.40)` | 메뉴·팝업 목록 |
| `--shadow-toast` | `0 0 0 1px rgba(0,0,0,.08), 0 6px 20px rgba(0,0,0,.16)` | `inset 0 0 0 1px rgba(255,255,255,.08), 0 6px 20px rgba(0,0,0,.45)` | 토스트 |
| `--shadow-dialog` | `0 0 0 1px rgba(0,0,0,.10), 0 16px 40px rgba(0,0,0,.22)` | `inset 0 0 0 1px rgba(255,255,255,.10), 0 16px 40px rgba(0,0,0,.55)` | 대화상자 |

세 단(menu < toast < dialog)이고 수치는 **[취향]**(ADR-0009. Fluent 2겹 ambient+key 구조를 따랐다, `E-SCALE-B*`). 그림자는 이 세 토큰 외에 없다(C3 "그림자는 떠 있는 것에만", K10. 강제 `design-lint`: `box-shadow` 선언은 `var(--shadow-*)`와 라디오 안쪽 고리 `inset 0 0 0 4px var(--surface)` 하나만 허용).

---

## 7. 모션과 층

### 7.1 모션

정지가 기본이다. 자주 쓰는 상호작용엔 전환이 없고(HIG motion, `E-APPLE-29`), 스프링·오버슈트가 없다(bounce 0이 범용, 확정 28). `linear()`는 하한 밖이라 쓸 수 없고 필요도 없다.

| 토큰 | 값 | 쓰는 곳 | 근거 |
|---|---|---|---|
| `--motion-fast` | 100ms | 눌림·호버 채움, 스위치 손잡이 | NN/g 단순 피드백 약 100(`E-KO-B2`) |
| `--motion-base` | 200ms | 메뉴·토스트 등장, 토스트 퇴장(`--ease-in`), 대화상자 퇴장 | NN/g 큰 변화 200~300, 퇴장 ≤ 등장. 메뉴 퇴장은 즉시(전환 없음) |
| `--motion-slow` | 300ms | 대화상자 등장(scrim opacity + 상자 scale .98→1) | 팝업 300 / 퇴장 200~250(confirmed) |
| `--ease-out` | `cubic-bezier(.2, 0, 0, 1)` | 등장 | 등장 ease-out(NN/g), Fluent decelerateMid = M3 standard-decelerate(confirmed) |
| `--ease-in` | `cubic-bezier(.4, 0, 1, 1)` | 퇴장 | 퇴장 ease-in |
| `--progress-tween` | 250ms | 진행 막대 `transform: scaleX`. 이징은 `linear` 글자 상수(`ui.css`, 토큰 아님) | D23=C. 틱 간격 250ms와 같아 계속 움직이는 것처럼 보인다(`G-LAUNCH-R8`). 값이 줄어들면 전환 없이 즉시(`G-INTER-DL6`). duration만 토큰인 이유: DTCG 단일 타입(`governance.md` §1.2) |
| `--motion-spin` | 800ms | Spinner 한 바퀴 **[취향]**(ADR-0009, 현재 코드 0.8s와 같다) | 반복 애니메이션은 이것 하나. reduce에서는 회전을 멈춘다(`components.md` §2.21) |

`prefers-reduced-motion: reduce`(D22=C): `--motion-base`·`--motion-slow`·`--progress-tween`을 **1ms**로 줄이고 `--motion-fast`(눌림 피드백)와 opacity는 남긴다. `--motion-spin`은 바꾸지 않고 Spinner가 `animation: none`으로 멈춘다(1ms 무한 회전은 깜박인다). 스위치 손잡이 이동(`--motion-fast`)은 피드백이라 남는다. 0ms가 아닌 이유는 `transitionend`·`animationend`가 살아 있어야 하기 때문이다(web.dev, `E-KO-B2`). 이동·크기·회전·반짝임은 CSS에서 `@media`로 끄되 진행 막대·스피너의 **정보**는 숨기지 않는다(brief §6.6-4, 현재 ProgressBar의 `display:none` 버그 해소). 장식 모션은 5초를 넘기지 않는다(WCAG 2.2.2). 강제 `design-tokens`(reduce 블록이 위 셋을 1ms로) + `design-lint`(`ms` 리터럴·`!important`·`transition: all` 금지) + `design-gallery`(reduce 에뮬레이션 axe).

### 7.2 z-index

층마다 주인이 하나다. 빌려 쓰지 않는다(a-visual P2 "DropOverlay가 z-banner를 씀" 해소). 배너는 흐름 안(h1 앞)이라 층이 없다.

| 토큰 | 값 | 주인 |
|---|---|---|
| `--z-sticky` | 10 | sticky 주소 입력줄(툴바는 스크롤 영역 `.main` 밖이라 층이 없다, `platform.md` §5) |
| `--z-menu` | 20 | 메뉴·팝업 목록 |
| `--z-drop` | 30 | 드롭 오버레이 |
| `--z-toast` | 40 | 토스트 |
| `--z-dialog` | 50 | 대화상자 + scrim(가장 위. 모달 중 토스트는 scrim 뒤에 남고 오류 토스트는 닫을 때까지 남으므로 유실되지 않는다) |

강제 `design-lint`(`z-index` 리터럴 금지) + `design-tokens`(각 토큰 사용처 정확히 1개 컴포넌트).

---

## 8. 레이아웃

| 항목 | 값 | 근거 | 강제 |
|---|---|---|---|
| 본문 열 `--content-max` | **800px**(가장자리 20 포함, 안쪽 760). 가운데 정렬 | 사용자 결정 5. 720 최소 창에서 꽉 차고(안쪽 680) 960 기본 창에서 좌우 80. A의 720과 B의 960 사이 절충이며 **출처 없음 → ADR-0001** | `design-tokens` + `design-gallery` 720·960 스냅 |
| 열 기준 | 툴바 안쪽·배너·토스트·대화상자 모두 같은 열에 정렬. 기준선 하나 | `A-VIS-02`~`A-VIS-04`(폭 3종·기준선 3종 P0 해소) | 리뷰 `R1` |
| 가장자리 `--edge` | 20px | §4 | — |
| 분기점 | **600px 하나**: 미만이면 좁은 레이아웃(Worker 휴대폰 폭, Windows 텍스트 225%) **[잠정]**. 미디어 쿼리에 변수를 못 쓰므로 토큰이 아니라 생성기 상수 `BREAKPOINT_NARROW`(§14)이고 폭 쿼리는 허용 파일(앱 `tokens.css`·`layout.css`, Worker `site.css`·생성물)에만 쓴다. 앱의 `x-large` 글자는 뷰포트를 바꾸지 않으므로 좁은 레이아웃 규칙은 `layout.css`에 `@media (max-width: 599px)` 블록과 `:root[data-text-scale="x-large"]` 접두 블록 **두 번** 쓰고 둘의 선언이 같아야 한다 | `A-FEAT-R1`(840 분기가 6곳) 해소. 확인: Windows 텍스트 크기 225%(CSS 약 320×231)에서 1.4.10 리플로우 검사 | `design-lint` DL13(허용 파일, 두 블록 동일), `design-gallery`(320 폭·x-large) |
| 최소 창 | 720×520(변경 없음) | tauri.conf.json | `tauri` |
| 520 높이 | 주소 입력줄은 툴바 아래 첫 요소. 카드 바닥 버튼 줄은 `position: sticky; bottom: 0`이라 카드가 길어도 늘 보인다(토큰 그대로 카드가 다 들어가는 조합은 제목 1줄·화질 3행뿐이다, `patterns.md` §15) | `A-FEAT-R1`·`R2` | `design-gallery` 720×520(최악 조합 고정 데이터에서 [받기] 뷰포트 안) |
| Worker 읽기 열 `--reading-max` | 680px [취향] | §3.3 | — |

---

## 9. 아이콘

| 항목 | 값 | 근거 | 강제 |
|---|---|---|---|
| 세트 | **Lucide**(ISC + Feather MIT) 한 세트. path만 `icons.ts`에 벤더링, 항목마다 `{ set: 'lucide', name, version }` 메타 | D31=A, g-icon(SF Symbols·Segoe Fluent Icons 글꼴은 쓸 수 없다, brief §2.7). 고지는 앱 정보·설치 폴더·`/licenses`에 즉시 | `design-icons`(메타 없는 항목 타입 오류, 고지 파일과 세트·버전 일치, `<svg` 직접 사용 금지, `SF Symbols`·`MDL2` 문자열 금지) |
| 크기 | `--icon-sm` 16(행·배지 옆·행 버튼), `--icon-md` 20(툴바·안내). **32는 없다**(빈 상태에 아이콘을 두지 않는다. HIG writing "빈 화면엔 다음 행동") | D32, judgment §2.4. 12는 만들지 않는다(Fluent 2 "12는 상호작용에 너무 작다") | `design-tokens` |
| 선 굵기 | `--icon-stroke: 1.5px`를 CSS `stroke-width: var(--icon-stroke)` + `vector-effect: non-scaling-stroke`(path마다)로 화면 px 고정(16·20 공통) **[잠정]**. SVG 속성 `stroke-width="1.5"` 리터럴은 쓰지 않는다(앱·Worker 모두 CSS) | HIG "옆 글자 굵기에 맞춘다"(`E-APPLE-31`). 13px 400 한글 줄기 ≈ 1.1px, 600은 WKWebView 1.24px(`E-ID-K28b`). `G-ICON-4` 범위 16px 1.2 / 20px 1.25~1.5의 위쪽(뒤집음: 한 값). 16px·DPR1 번짐이 알려진 한계(`G-ICON-5`). 확인: `icons-blur.mjs` 측정("16·20px 수평선 최대 농도 ≥ .5, 두께합 ≥ 1.0")을 `design-gallery`에 넣고, 실패하면 16px만 1.25로 내린다 | `design-icons` DI3(stroke가 CSS 토큰이고 `size/24` 비례가 아님), `design-lint` DL14 예외(`--icon-stroke` 정의) |
| 색 | `currentColor`만. fill 없음 | `G-A11Y-OS5` | `design-icons` |
| 광학 보정 | 에셋 좌표 안에서(`download`·`play`·`chevron-*`). CSS `translate` 금지 | HIG icons(`E-APPLE-31`), g-icon §8.3 | `design-lint` + 리뷰 `R5` |
| 글자 없는 아이콘 버튼 | 허용 목록(10개, 이 표가 유일한 원천): `x`(닫기) · `ellipsis`(더 보기) · `chevron-down` `chevron-up` `chevron-left` `chevron-right`(펼침·방향) · `eye` `eye-off`(값 보기 토글) · `arrow-left`(뒤로) · `settings`(툴바 톱니). 모두 `aria-label` + 툴팁 | NN/g icon usability, Lucide 접근성 문서(`G-ICON-6`) | `design-icons` DI7(IconButton `icon` prop 허용 목록) |

### 9.1 은유 표

서로 다른 동작은 서로 다른 모양이다(g-icon §3.2, B 후보 표와 같다). 같은 아이콘이 다른 동작에 쓰이면 `design-icons`가 실패한다(예외는 `copy` 둘뿐, 이유 등록).

| 동작·개념 | Lucide | 글자 | 비고 |
|---|---|---|---|
| 받기(다운로드) | `download` | [받기] | 앱 마크와 같은 모티프를 UI 안에서 쓰지 않는다(`J-F-A5`, D33) → 버튼에는 글자만, 아이콘은 앱 마크와 드롭 오버레이 라벨에만 |
| 일시정지 | `pause` | [일시정지] | 글자 버튼 + 아이콘 |
| 이어받기 | `play` | [이어받기] | 다시 시도와 모양을 나눈다 |
| 다시 시도 | `rotate-cw` | [다시 시도] | 실패 뒤 같은 동작 한 번 더 |
| 처음부터 다시 받기 | 없음 | [처음부터 다시 받기] | 드물고 무거운 동작. `rotate-ccw` 금지 |
| 작업 취소 | 없음(쓰면 `circle-x`) | [취소] 글자 **필수** | 데이터를 지울 수 있다. 닫기 `x`와 겸용 금지 |
| 닫기 | `x` | `aria-label` | 허용 목록 |
| 목록에서 지우기 | `trash-2` | [목록에서 지우기] | 파일을 지우지 않는다는 라벨 |
| 파일 열기 | `file-video` | [열기] | `play` 재사용 금지 |
| 폴더에서 보기 | `folder` | macOS [Finder에서 보기] / 그 외 [폴더에서 보기] | 아이콘은 OS 공통, 라벨만 분기(`platform.md` §20). Finder·탐색기 로고 금지. `G-HANDOFF-H1`(먼저 두기)은 D39가 뒤집음([열기] 다음) |
| 붙여넣기(클립보드 제안) | `clipboard-paste` | [붙여넣기] | — |
| 복사 | `copy` | [주소 복사] [정보 복사] | 같은 줄에 나란히 두지 않는다 |
| 오류 | `circle-x` `--danger-ink` | 상태 글자 | 경고와 모양이 다르다(색각) |
| 경고 | `triangle-alert` `--warning-ink` | 상태 글자 | — |
| 정보 | `info` `--fg-muted` | 안내 글자 | 중립 톤 |
| 완료 | `check` `--fg-muted` | "완료" | 성공색 없음(§2.1). 토스트는 `circle-check` |
| 설정 | `settings` | `aria-label` "설정" | NN/g 경계선 → D62 시험 대상. 못 찾으면 글자를 붙인다 |
| 로그인 | `log-in` | [로그인] | 사람 실루엣 금지 |
| 기기(관리 페이지) | `monitor` | "기기" | — |
| 외부 열기 | `external-link` | [치지직 열기] | — |
| 종류(VOD·클립·빠른 다시보기)·성인 | 없음 | 글자 배지, "19" | 아이콘 불필요 |
| 주소 재취득(자동 복구) | 없음 | "주소를 새로 받는 중"(`받다` 겹침 위험, `content.md` §16-5) | 사용자 동작이 아니다 |

---

## 10. 테마

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 기본 | OS를 따른다. `:root { color-scheme: light dark }` + `@media (prefers-color-scheme: dark)` | HIG "앱별 외관 설정 금지"(`E-APPLE-12`) | `design-tokens` |
| Linux만 선택 | 설정 › 보기 › 모양(시스템/밝게/어둡게, RadioGroup 3개) → `:root:where([data-theme="light"])`·`:root:where([data-theme="dark"])`가 `@media`를 이긴다(소스 순서). macOS·Windows에는 행이 없다 | `G-A11Y-OS10`(3 OS 선택)은 D7이 뒤집음. GTK3 다크 감지는 테마 이름 휴리스틱(`E-A11Y-A53`) | `frontend`(플랫폼별 행 노출 테스트) |
| 다크 정의 한 곳 | sys 다크 블록은 `@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) }`와 `:root:where([data-theme="dark"])` 두 selector에 **생성기가** 같은 내용을 쓴다. 손으로 두 번 쓰지 않는다. 모든 테마·상태 블록은 `:root:where(…)`로 특이도 (0,1,0)이고 소스 순서(라이트 → 다크 → 비활성 창 → reading → text-scale → 대비 증가 → coarse → reduce)가 결정한다 | brief §6.1-2, §2.5 특이도 | `design-tokens` DT10(두 블록 동일)·DT16(계산값) |
| Worker | OS만 따른다(JS 없음, D52). `<meta name="theme-color" media="(prefers-color-scheme: light)" content="#F3F3F3">` + dark `#1F1F1F`, `<meta name="color-scheme" content="light dark">` | B 후보 골격(judgment §2.2-6), brief §6.13-2 | `worker` gate(meta 존재 테스트) |
| 첫 페인트 | 창·웹뷰 `backgroundColor`를 테마별 `--bg` 값으로, 첫 CSS에 `color-scheme`과 배경. `visible:false` → 첫 그림 뒤 show | g-launch 3겹(brief §6.8-9) | `tauri` 테스트 |
| 비활성 창 | `:root:where([data-window-active="false"]) { --accent-soft: var(--surface-2) }`(다크 블록 뒤) | `E-APPLE-13` | `frontend`, `design-tokens` DT16 |
| 강조색 추종 | 하지 않는다(고정). WebKit `AccentColor`는 늘 파랑 | `E-DESK-R33` | `design-lint`(`AccentColor` 키워드 금지) |

---

## 11. 웹뷰 CSS 하한

하한은 **Safari 16.4 = Chrome 111 = WebKitGTK 2.40**, macOS `minimumSystemVersion` 13.3이다(D1=A. `G-ENGINE-R1`, `E-DESK-E25`). 기계 판독 원천은 `app/baseline.json`(`platform.md` §13)이고 이 절의 값과 같아야 한다. `build.cssTarget: ['chrome111', 'safari16.4']` + `css.transformer: 'lightningcss'`로 개발과 배포를 맞춘다(brief §6.1-4. 강제 `frontend`: vite 설정·baseline 일치 테스트).

쓸 수 있는 것(하한 안): `oklch`·`oklab`(설계용, 커밋은 hex), `color-mix()`(파생 색), `:has()`, `@layer`, 컨테이너 쿼리, `@property`, `<dialog>`, `inert`, 범위 미디어 문법, `prefers-color-scheme`·`prefers-contrast`·`prefers-reduced-motion`, `forced-colors`, `color-scheme`, `:focus-visible`, `:is`·`:where`, flex `gap`, `aspect-ratio`, `dvh`·`svh`, `subgrid`, `clamp`, `tabular-nums`, 개별 transform. CSS nesting은 Lightning CSS가 평탄화한다.

금지 목록(`design-lint`가 grep으로 막는다. 각 행의 Safari 버전이 근거):

| 기능 | 첫 완전 지원 | 대신 |
|---|---|---|
| `light-dark()` | 17.5 | 라이트·다크 두 블록(생성기) |
| `linear()` 이징 | 17.2 | `cubic-bezier` 둘(§7.1) |
| `text-wrap: balance` / `pretty` | 17.5 / 26 | 쓰지 않는다. 레이아웃이 기대지 않는 장식조차 두지 않는다(검사가 단순해진다) |
| `@starting-style` | 17.5 | 등장은 클래스 토글 + transition |
| View Transitions | 18 | 쓰지 않는다 |
| `scrollbar-gutter`, `scrollbar-width` | 18.2 | OS 스크롤바 + Windows `fluentOverlay`(D27). 여백 예약 없음 |
| `backdrop-filter` | 18(무접두) | 쓰지 않는다(§6.3) |
| `accent-color`, `field-sizing` | 26.2 | 컨트롤을 직접 그린다(brief §6.1-9) |
| `popover` | 17 | 메뉴는 직접 구현 + `inert` |
| 상대 색 문법 `rgb(from …)` | 18 | `color-mix()` |
| `@scope`, `anchor-name`, `interpolate-size`, `corner-shape` | 26.4 / 26 / 없음 / 없음 | 쓰지 않는다 |
| `prefers-reduced-transparency` | WebKit 미지원 | 반투명에 의미를 싣지 않는다 |
| `overscroll-behavior` | 16(부분) | 믿지 않는다(`E-DESK-E27`) |
| `ui-monospace` 단독 | Chromium 미지원 | 폴백 스택(§3.1) |
| 비접두 `user-select` | WebKit 미지원 | `-webkit-user-select` 병기 |
| `::-webkit-scrollbar` 꾸미기, `scrollbar-width: none` | — | 접근성·하한 문제. 금지(brief §6.1-5) |
| `!important`, `transition: all`, `outline: none`·`outline: 0`, `forced-color-adjust`, `cursor: pointer`(앱 셸), `{@html}` | — | 각 §의 규칙 |

---

## 12. 구현 중 변경(이 문서가 brief·후보 A와 다르게 정한 것)

1. **행간을 px 토큰으로** 둔다(brief §6.1-7은 "단위 없는 숫자"). 의도(`normal` 금지, 결정적 값)는 같고, px 토큰은 "문서 숫자 = 화면 숫자"와 생성기 검사에 더 맞는다. `normal`·비율 리터럴 금지는 유지한다.
2. **다크 `--danger-ink`를 `#FD736D` → `#FA8880`**으로 올렸다(§2.1). 모든 잉크가 네 바탕 전부에서 4.5:1을 넘긴다는 불변식 때문이다.
3. **스위치를 40×24 → 54×24**로 바꿨다. A의 40은 출처가 없고 AppKit regular 54×24는 실측 confirmed다(`E-APPLE-19`).
4. **`--fg-tertiary` → `--fg-disabled`**로 이름을 바꿨다. 이름이 유일한 허용 용도를 말한다(§1 규칙 5).
5. **터치 `--control-h-sm`을 32 → 40**으로 올렸다. `G-INPUT-IN4`(행 안 동작 40, Windows 7.5mm ≈ 40epx confirmed)를 따른다.
6. **z-index에 `--z-drop` 30**을 더하고 토스트 40·대화상자 50으로 밀었다. 층마다 주인 하나.
7. **간격 이름을 값으로**(`--space-8` = 8px) 했다. A는 번호(`--space-4` = 8px)였다.
8. **`text-wrap: balance`는 장식으로도 쓰지 않는다**(brief §6.1-1은 장식 허용). 검사를 단순하게 하기 위해서다.
9. **앱 글자 크기 설정의 단계를 ×1 / ×1.3 / ×2.0**으로 두었다(A는 ×1 / ×1.15 / ×1.3). ×2.0이 있어야 WCAG 1.4.4 200%를 설정으로 만족한다. [잠정]. 값은 §3.2의 유도 규칙으로 생성기가 만든다(편집에서 x-large body 32 → 34, display 42 → 44로 바뀌었다).
10. **`--danger-pressed`·`--on-danger`를 지웠다**(검토 P1-1). `--danger` 채움 버튼이 없어 쓰는 곳이 없었다. ref `red-47`·`red-50`도 함께 지웠다.
11. **`--surface-pressed`를 더했다**(검토 P1-15). 라이트에서 `--track` = `--surface-2`라 눌림이 hover와 같았다. 유령 버튼 글자는 `--accent-ink` → `--fg`(README D21).
12. **라디오 점을 `--accent` → `--accent-ink`**로. 비활성 창의 `--surface-2` 위에서 3:1 미달(다크 2.48)이었다.
13. **`:where()` selector**로 테마·상태 블록의 특이도를 (0,1,0)으로 맞췄다(§2.5·§10). 하한 안(Safari 14).
14. **`data-scale="reading"`을 `html`이 아니라 `main`에** 둔다(§3.3). 헤더·바닥글이 척도를 따라 커지지 않는다.
15. **`--z-sticky`의 주인은 입력줄 하나**다. 툴바는 스크롤 영역 밖이라 층이 없다(`platform.md` §5). 입력줄 `top: 0`.
16. **`--progress-tween`은 duration만**이고 이징 `linear`는 `ui.css` 글자 상수다(governance F3). `--motion-spin`·`--label-w`·`--pct-w`를 더했다(components·patterns 요청).
17. **`calc()` 정책**(§4)을 두었다. "calc() 없이"는 지웠다.
18. **단계 (a)의 옛 토큰 별칭 블록**(`/* legacy */` … `--fg-faint: var(--fg-disabled)` 등, governance §10 (a))은 단계 (c)까지 생성물 끝에 두고 DT3(미사용)·DT7(이름)에서 뺀다. 생성기가 블록을 통째로 건너뛴다.
19. **카드 머리 높이는 40**(패딩 8 + 닫기 24 + 8)이고 예외가 없다. 카드 바닥 버튼 줄은 sticky(§8).

---

## 13. 생성물 기대 모양(`tokens.css`)

`design/tokens/*.tokens.json`에서 생성기가 아래를 만든다. 이 블록이 `design-tokens` DT14의 비교 대상이다(이름 → 값 사전). 다크 블록 두 개는 생성기가 같은 내용을 두 selector에 쓴다(여기서는 한 번만 적었다). 블록 순서가 캐스케이드를 결정한다(§2.5·§10).

```css
:root {
  color-scheme: light dark;

  /* ref: 중립(OKLCH C=0) */
  --ref-gray-965: #F3F3F3; --ref-gray-930: #E8E8E8; --ref-gray-890: #DBDBDB; --ref-gray-720: #A4A4A4;
  --ref-gray-700: #9E9E9E; --ref-gray-620: #868686; --ref-gray-600: #808080; --ref-gray-540: #6F6F6F;
  --ref-gray-480: #5D5D5D; --ref-gray-400: #484848; --ref-gray-350: #3A3A3A; --ref-gray-320: #333333;
  --ref-gray-290: #2B2B2B; --ref-gray-240: #1F1F1F; --ref-gray-220: #1B1B1B; --ref-white: #FFFFFF;
  /* ref: 파랑 h 258 */
  --ref-blue-54: #0067DF; --ref-blue-48: #0056C5; --ref-blue-50: #085DC7; --ref-blue-57: #1E72E4;
  --ref-blue-74: #70ADFB; --ref-blue-95: #E2F0FF; --ref-blue-33: #233651;
  /* ref: 빨강 h 25~27 */
  --ref-red-53: #C51E21; --ref-red-52: #BE2323; --ref-red-56: #CC3430; --ref-red-75: #FA8880;
  --ref-red-95: #FFE7E4; --ref-red-33: #502824;
  /* ref: 호박 h 65~80 */
  --ref-amber-51: #945500; --ref-amber-78: #E8AA4E; --ref-amber-96: #FFF0D4; --ref-amber-33: #433215;
  /* ref: 알파 */
  --ref-black-a10: rgba(0, 0, 0, 0.10); --ref-black-a30: rgba(0, 0, 0, 0.30); --ref-black-a50: rgba(0, 0, 0, 0.50);
  --ref-white-a8: rgba(255, 255, 255, 0.08); --ref-white-a10: rgba(255, 255, 255, 0.10);

  /* sys: 색(라이트) */
  --bg: var(--ref-gray-965);        --surface: var(--ref-white);      --surface-2: var(--ref-gray-930);
  --surface-pressed: var(--ref-gray-890);
  --raised: var(--ref-white);       --track: var(--ref-gray-930);
  --fg: var(--ref-gray-220);        --fg-muted: var(--ref-gray-480);  --fg-disabled: var(--ref-gray-700);
  --separator: var(--ref-black-a10); --border-strong: var(--ref-gray-600);
  --accent: var(--ref-blue-54);     --accent-pressed: var(--ref-blue-48); --accent-ink: var(--ref-blue-50);
  --accent-soft: var(--ref-blue-95); --on-accent: var(--ref-white);
  --danger: var(--ref-red-53);      --danger-ink: var(--ref-red-52);  --danger-soft: var(--ref-red-95);
  --warning-ink: var(--ref-amber-51); --warning-soft: var(--ref-amber-96);
  --focus: var(--accent-ink);       --scrim: var(--ref-black-a30);
  --shadow-menu:   0 0 0 1px var(--ref-black-a8), 0 4px 12px rgba(0, 0, 0, 0.14);
  --shadow-toast:  0 0 0 1px var(--ref-black-a8), 0 6px 20px rgba(0, 0, 0, 0.16);
  --shadow-dialog: 0 0 0 1px var(--ref-black-a10), 0 16px 40px rgba(0, 0, 0, 0.22);

  /* 글꼴 */
  --font-sans: system-ui, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans CJK KR', 'Noto Sans KR',
               'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif;
  --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, 'Cascadia Mono', 'D2Coding', monospace;
  --text-caption: 12px; --leading-caption: 16px;
  --text-body: 13px;    --leading-body: 16px;
  --text-title: 15px;   --leading-title: 20px;
  --text-display: 17px; --leading-display: 22px;
  --leading-read: 20px;
  --weight-regular: 400; --weight-strong: 600;

  /* 간격 */
  --space-2: 2px; --space-4: 4px; --space-6: 6px; --space-8: 8px; --space-12: 12px;
  --space-16: 16px; --space-20: 20px; --space-24: 24px; --space-32: 32px; --space-40: 40px;
  --edge: var(--space-20); --gap-sibling: var(--space-8); --gap-label: var(--space-6);

  /* 반경 */
  --radius-badge: 4px; --radius-control: 6px; --radius-group: 10px; --radius-overlay: 12px; --radius-pill: 999px;

  /* 크기 */
  --control-h-sm: 24px; --control-h: 28px; --control-h-lg: 36px; --row-h: 36px; --toolbar-h: 44px; --hit-min: 24px;
  --icon-sm: 16px; --icon-md: 20px; --icon-stroke: 1.5px;
  --switch-w: 54px; --switch-h: 24px; --switch-knob: 20px; --radio-size: 16px;
  --progress-h: 6px; --badge-h: 18px; --label-w: 80px; --pct-w: 40px;

  /* 레이아웃 */
  --content-max: 800px; --reading-max: 680px; --dialog-w: 440px;

  /* 모션 */
  --motion-fast: 100ms; --motion-base: 200ms; --motion-slow: 300ms; --motion-spin: 800ms;
  --ease-out: cubic-bezier(0.2, 0, 0, 1); --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --progress-tween: 250ms;

  /* 층 */
  --z-sticky: 10; --z-menu: 20; --z-drop: 30; --z-toast: 40; --z-dialog: 50;
}

/* sys: 다크. 생성기가 같은 내용을
   @media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) {…} } 와
   :root:where([data-theme="dark"]) {…} 에 쓴다. :where()라 특이도는 (0,1,0) */
:root:where([data-theme="dark"]) {
  --bg: var(--ref-gray-240);        --surface: var(--ref-gray-290);   --surface-2: var(--ref-gray-350);
  --surface-pressed: var(--ref-gray-400);
  --raised: var(--ref-gray-320);    --track: var(--ref-gray-240);
  --fg: var(--ref-gray-930);        --fg-muted: var(--ref-gray-720);  --fg-disabled: var(--ref-gray-540);
  --separator: var(--ref-white-a10); --border-strong: var(--ref-gray-620);
  --accent: var(--ref-blue-57);     --accent-pressed: var(--ref-blue-50); --accent-ink: var(--ref-blue-74);
  --accent-soft: var(--ref-blue-33);
  --danger: var(--ref-red-56);      --danger-ink: var(--ref-red-75);  --danger-soft: var(--ref-red-33);
  --warning-ink: var(--ref-amber-78); --warning-soft: var(--ref-amber-33);
  --scrim: var(--ref-black-a50);
  --shadow-menu:   inset 0 0 0 1px var(--ref-white-a8), 0 4px 12px rgba(0, 0, 0, 0.40);
  --shadow-toast:  inset 0 0 0 1px var(--ref-white-a8), 0 6px 20px rgba(0, 0, 0, 0.45);
  --shadow-dialog: inset 0 0 0 1px var(--ref-white-a10), 0 16px 40px rgba(0, 0, 0, 0.55);
}
:root:where([data-theme="light"]) { color-scheme: light; }
:root:where([data-theme="dark"])  { color-scheme: dark; }

/* 비활성 창(macOS): 선택 면을 회색으로. 다크 블록 뒤에 온다 */
:root:where([data-window-active="false"]) { --accent-soft: var(--surface-2); }

/* Worker 읽기 척도(Worker 생성물에만). main에 붙는다 */
[data-scale="reading"] {
  --text-caption: 13px; --leading-caption: 18px;
  --text-body: 15px;    --leading-body: 22px;
  --text-title: 17px;   --leading-title: 24px;
  --text-display: 22px; --leading-display: 28px;
  --text-hero: 28px;    --leading-hero: 36px;
  --leading-read: 22px;
}
@media (max-width: 599px) {
  [data-scale="reading"] { --text-hero: 22px; --leading-hero: 28px; }
}

/* 앱 글자 크기 설정(앱 생성물에만). §3.2 유도 규칙으로 생성 */
:root:where([data-text-scale="large"]) {
  --text-caption: 16px; --leading-caption: 20px; --text-body: 17px; --leading-body: 22px;
  --text-title: 20px; --leading-title: 26px; --text-display: 22px; --leading-display: 28px; --leading-read: 26px;
}
:root:where([data-text-scale="x-large"]) {
  --text-caption: 24px; --leading-caption: 30px; --text-body: 26px; --leading-body: 34px;
  --text-title: 30px; --leading-title: 38px; --text-display: 34px; --leading-display: 44px; --leading-read: 40px;
}

/* 대비 증가. 다크 블록 뒤라 다크에서도 이긴다 */
@media (prefers-contrast: more) {
  :root:where(*) { --fg-muted: var(--fg); --separator: var(--fg); --border-strong: var(--fg); }
}

/* 터치(2-in-1). any-pointer만 본다 */
@media (any-pointer: coarse) {
  :root:where(*) { --control-h-sm: 40px; --control-h: 40px; --control-h-lg: 44px; --row-h: 44px; --hit-min: 40px; }
}

/* 움직임 줄이기: 이동·크기는 1ms, 눌림 피드백·불투명도·스피너 토큰은 남긴다(스피너는 ui.css가 animation: none) */
@media (prefers-reduced-motion: reduce) {
  :root:where(*) { --motion-base: 1ms; --motion-slow: 1ms; --progress-tween: 1ms; }
}
```

`--ref-black-a8: rgba(0, 0, 0, 0.08)`은 그림자 전용 ref이고 위 ref 알파 줄에 함께 생성된다(그림자 토큰이 리터럴 대신 ref를 참조하므로 `--ref-white-a8`도 쓰인다). `--text-hero`·`--leading-hero`는 reading 블록에서만 정의된다(앱에서는 미정의 토큰이므로 앱 컴포넌트가 쓰면 `design-tokens`가 막는다). 생성기는 reading 블록을 Worker 생성물에만, `data-text-scale` 블록을 앱 생성물에만 포함한다. 그 둘을 뺀 나머지는 두 생성물에서 바이트까지 같다. 단계 (a)의 `/* legacy */` 별칭 블록은 앱 생성물 끝에만 있고 검사에서 뺀다(§12-18).

---

## 14. 상수 표(CSS 토큰이 아닌 값)

JS 타이머·Rust 셸이 쓰는 값이다. 이름과 값의 단일 원천은 이 표이고, 코드의 위치는 열 "파일"이다. `design-tokens` DT15가 표와 두 파일을 대조한다(`scripts/design/check-tokens.mjs`가 `timing.ts`와 `crates/shell/src/consts.rs`의 `pub const`를 파싱). 표기 [제안]·[취향]·[잠정] 값은 ADR-0009에 묶였고 바꿀 때 상수 하나만 바뀐다.

| 이름 | 값 | 표기 | 파일 | 쓰는 곳 | 근거·확인 |
|---|---|---|---|---|---|
| `BREAKPOINT_NARROW` | 600 | [잠정] | 생성기 상수(`tokens.mjs`) | §8 분기(`max-width: 599px`) | Windows 텍스트 225% 리플로우(`platform.md` §21 M16) |
| `LOADER_DELAY_MS` / `LOADER_MIN_MS` | 300 / 400 | [제안] | `app/src/lib/timing.ts` | 로딩 표시 지연·최소 유지(`patterns.md` §2.2) | 디자인 시스템 수렴값(`E-DESK-L*`), 표준 아님. `G-LAUNCH-R4` |
| `TOAST_MS` | 6000 | [취향] | `timing.ts` | 정보 토스트 수명 = [되돌리기] 지연 삭제 창(README D37) | D62 V8 |
| `HIGHLIGHT_MS` | 1000 | [취향] | `timing.ts` | 새 항목 `--accent-soft` 강조(`patterns.md` §1.2) | app.md §8.10 |
| `COPIED_LABEL_MS` | 2000 | [취향] | `timing.ts` | "복사했어요" 라벨 전환 | D37 |
| `ETA_REFRESH_MS` | 1000 | [취향] | `timing.ts` | 속도·남은 시간 갱신 | D50 |
| `AUTH_CHECK_TIMEOUT_MS` | 40000 | [잠정] | `timing.ts` + Rust | 로그인 상태 확인 상한(`auth.checking.body`의 `{secs}`) | 현재 코드 값. `patterns.md` §13 |
| `PENDING_STUCK_REMAINING_SECS` | 510 | 기존 코드 | 지금 `app/src/lib/auth.ts`(DT15 대상 밖). 적용 단계 (a)에서 다른 §14 상수와 함께 `timing.ts`로 옮긴다 | 로그인 대기 화면의 stuck 안내·[다시 로그인]이 나오는 남은 시간(10분 기한에서 90초 지남, `patterns.md` §13) | `app.md` 구현 중 변경 65 (라)·66 (나), `worker.md` 88 (바) |
| `SHOW_DEADLINE_MS` | 1500 | [제안] | Rust | 첫 창 안전장치(`platform.md` §2.2) | `G-LAUNCH-R2`, 실측 뒤 조정 |
| `COLD_SHOW_BUDGET_MS` / `WARM_SHOW_BUDGET_MS` | 1000 / 400 | [제안] | ratchet(`ci/ratchet.json`) | 아이콘 클릭 → 창 보임(`platform.md` §14) | Nielsen 1초·Doherty. 관찰 뒤 승격 |
| `DOCK_PROGRESS_MIN_INTERVAL_MS` | 1000 | [취향] | Rust | Dock·작업 표시줄 호출 빈도(`platform.md` §8) | g-shell G13 |
| `NOTIFY_BATCH_MS` | 3000 | [취향] | Rust | OS 알림 묶음 창(`platform.md` §9) | 보고서 3초는 근거 없음(`X-DESK-N45`) → 취향으로 같은 값을 채택 |
| `NOTIFY_TITLE_MAX_GRAPHEMES` | 40 | [취향] | Rust + `timing.ts`(`clipGraphemes`) | OS 알림 본문·대화상자 제목·토스트 안 외부 문자열 절단(`content.md` §13) | README D38 |
| `NETWORK_PATIENCE_MS` / `RETRY_BACKOFF_MAX_MS` | 1800000 / 30000 | [잠정] | Rust(core) | 재시도 인내(`platform.md` §15) | `G-POWER-R8`, `platform.md` §21 M23 |
| `RECOVERY_SILENT_MS` / `RECOVERY_NOTICE_MS` | 60000 / 10000 | [취향] | Rust + `timing.ts` | 회복 알림 기준·표시(`platform.md` §15) | `G-POWER-R11` |
| `SLEEP_REASON_MAX` | 128 | 사실 | Rust | 전원 사유 문자열 길이 | Apple QA1340 |
| `METERED_CONFIRM_BYTES` | 1 GB | [취향] | Rust(v1.1) | 데이터 요금 연결 확인(D6) | Windows 비용 API 지침은 수치가 없다 |
| `CLIPBOARD_MAX_BYTES` | 4096 | 기존 코드 | Rust | 클립보드 제안 상한 | `chzzk_link` |
| `FAT32_FILE_LIMIT` | 4,294,967,296 | 사실 | Rust | FAT32 차단(`platform.md` §16.2) | 실측 `EFBIG`(`G-SAVE-R4`) |
| `LOW_SPACE_FACTOR` | 1.05 | [취향] | Rust | 여유 공간 경고 | `G-SAVE-R9` |
| `WINDOWS_PATH_MAX_UTF16` | 259 | 사실 | Rust | 경로 길이 차단 | `MAX_PATH` 260 − 널 |
| `FILENAME_MAX_BYTES` / `SIDECAR_MAX_BYTES` | 200 / 221 | 기존 코드 / 유도 | Rust(core `naming`) | 파일 이름 길이 불변식 | `naming.rs`, `G-SAVE-R13` |
| `COMPLETED_FOLD_AT` / `STALE_DAYS` / `RECENT_MAX` | 11 / 30 / 5 | [취향] | `timing.ts` + Rust | 완료 접힘·멈춘 지 30일·최근 영상 개수(D39) | `G-REPEAT-R2`·`G-REPEAT-R3`·`G-REPEAT-R9` |
| `NOTICE_TTL_H` / `NOTICE_CACHE_H` / `NOTICE_MAX_CHARS` / `CIRCUIT_FAILURES` | 72 / 24 / 80 / 3 | [잠정] | Worker + Rust | 서비스 공지(D41)·서킷(`patterns.md` §10.4) | `G-OUTAGE-R4`·`G-OUTAGE-R6`·`G-OUTAGE-R11`(측정 근거 없음) |

앱 아이콘 산출물 크기 집합(ico 11층·icns 10항목·Linux PNG 9종)은 `platform.md` §18.2가 소유한다(UI 아이콘이 아니다).
