# 컴포넌트 (components.md)

`app/src/lib/components/ui/`의 기본 컴포넌트 전부와 Worker 페이지가 같은 모양으로 쓰는 CSS 클래스를 정의한다. 값은 모두 `foundations.md`의 토큰 이름으로만 적는다. 결정의 "무엇"은 `README.md` 결정 표(D21·D35·D36·D37)가 소유하고, 이 문서는 그것을 해부·API·상태·치수·접근성으로 내린다. 초안이 foundations에 요청한 값(`--motion-spin`·`calc()` 정책·forced 행·`<select>` 행간)은 편집에서 모두 foundations에 들어갔다(§6).

읽는 법:
- 근거는 `docs/research/design-system.md`의 ID로 인용한다(README 머리). 감사 코드는 `A-PRIM-<코드>`·`A-FEAT-<코드>`·`A-VIS-<번호>`다. refuted 값은 쓰지 않았다.
- 강제 수단은 `README.md` §4의 gate 이름(`design-lint`·`design-tokens·`design-icons`·`design-gallery`·`frontend`·`worker`·`design-copy`)과 검사 번호(`DL*`·`DS*`·`DP*`·`DT*`·`DI*`·`DC*`, governance §2), 리뷰 번호 `R1`~`R10`이다. 강제할 수 없는 규칙은 적지 않았다.
- **[잠정]**은 확인되지 않은 값(확인 방법을 같은 줄에), **[취향]**은 출처 없는 선택이다.
- 예시 문구·값은 모두 가짜다. 실제 문구는 `content.md`의 copy deck이 소유한다.

---

## 0. 범위와 구조

### 0.1 대상

| 묶음 | 컴포넌트 | Worker에서 |
|---|---|---|
| 동작 | Button, IconButton, Menu, Toolbar | Button만(`<a class="btn">`·`<button class="btn">`). Menu 없음(JS 없음, README D52). 사이트 헤더는 `web.md` §3 |
| 입력 | TextField, SecretField, Select, Switch, RadioGroup | TextField·Select·RadioGroup은 네이티브 요소 + 같은 클래스. SecretField·Switch 없음 |
| 펼침·겹침 | Disclosure, Dialog, ConfirmDialog, Toast, DropOverlay | Disclosure만(`<details>`). 대화상자는 확인 페이지(D54), 토스트는 flash Notice(web.md), 드롭 없음 |
| 알림 | Notice, ErrorAlert | Notice(`.notice`). ErrorAlert는 Notice 구조의 서버 렌더 |
| 틀 | Surface, SettingsRow, FieldRow, PageContainer, EmptyState | 전부(클래스). FieldRow는 Worker 폼 라벨이 위에 있어 쓰지 않는다(`web.md` §7.1) |
| 표시 | Badge, ProgressBar, Spinner, Skeleton, Kbd, Icon, AppMark | Badge·Kbd·Icon·AppMark. ProgressBar·Spinner·Skeleton 없음(Worker 페이지에는 진행 표시가 없다. ProgressBar의 `style:--p`는 CSSOM이라 CSP가 막는 Worker에서는 쓸 수 없고 쓸 곳도 없다) |

Banner·InlineAlert·ConflictNotice·JobItem 오류 블록·blocked 줄·ClipboardSuggestion·LoginView 자체 표현·인라인 상태 글·Toast의 9갈래(a-feat §2-1 N1~N9)는 **Notice 하나**(tone × variant)와 Toast(Notice variant `toast` + 타이머)로 합친다. Button의 `link`·`danger` variant, Badge의 상태 tone, Disclosure의 `variant` 레이아웃 뜻은 없어진다(§1).

### 0.2 CSS는 한 원천이다

기본 컴포넌트의 CSS는 `design/ui.css` **한 파일**이다. 생성기(`scripts/design/tokens.mjs`, foundations 머리글·governance §1)가 `tokens.css`와 함께 앱(`app/src/styles/ui.css`)과 Worker(`worker/src/http/site-css.generated.ts`의 ui 구간)에 같은 내용을 쓴다. `ui/*.svelte`는 마크업·상태·접근성만 맡고 `<style>` 블록을 두지 않는다. 기능 컴포넌트(`jobs/`·`receive/`·`settings/`)의 레이아웃 CSS만 `.svelte` 안에 둔다.

- 근거: 앱과 Worker가 "같은 제품"이려면 `.btn`·`.notice`가 한 정의여야 한다(brief §6.2-1, `A-WORKER` §0). Worker는 CSP로 인라인 style·JS가 없어 클래스만 쓸 수 있다(brief §2.2). 한 파일이면 `design-lint`의 리터럴 검사 대상이 한 곳이다(judgment §1.5 "A의 ui.css는 리터럴 0").
- 강제: `design-tokens DT1(`ui.css` 생성물 `--check`, 두 산출물 동일), `design-lint` DL1~DL5(`ui/*.svelte`에 `<style>` 0개, `ui.css`에 색·px·ms·z-index·font-size 리터럴 0개, 예외 `0`·`0px`·`1px`·`2px`·`50%`·`100%`와 foundations §4 `calc()` 정책).
- 클래스 이름: 컴포넌트 `.{이름}`, 외형 `.{이름}-{variant}`, 크기 `.{이름}-{size}`, 의미 `.tone-{tone}`, 상태는 HTML 속성(`[disabled]`·`[aria-pressed="true"]`·`[aria-invalid="true"]`·`[open]`)로만 그린다. 상태 클래스(`.is-open`)는 없다. 근거: 접근성 속성이 곧 스타일 훅이면 둘이 어긋날 수 없다(`A-PRIM-F2` "aria-disabled를 CSS만 알고 동작은 모른다" 해소). 강제: `design-lint` DL11(`ui.css` selector에 `.is-`·`.active`·`.open` 금지. 상태 selector는 `:active`·`:hover`·`[open]`·`[aria-expanded]` 같은 의사 클래스·속성만).

### 0.3 공통 상태 규칙(모든 컴포넌트)

| 상태 | 규칙 | 근거 | 강제 |
|---|---|---|---|
| hover | **유령 버튼·아이콘 버튼·메뉴 항목·최근 목록 행만** `--surface-2` 채움. 테두리 버튼·주 버튼·입력칸·스위치·라디오 행·설정 행은 hover 없음. hover는 배경만 바꾸고 테두리·글자색·크기·표시 여부를 바꾸지 않는다 | README D21, `E-DESK-R30`(Evil Martians: 스타일 버튼·표 행은 hover 없음, 유령·드롭다운 항목은 있음), `G-INPUT-IN1`·`G-INPUT-IN7`, `A-PRIM-T1`(hover가 invalid 테두리를 덮던 특이도 버그는 hover가 테두리를 안 건드리면 사라진다) | `design-lint`(`:hover` 규칙이 `display`·`visibility`·`opacity`·`border-color`·`color`·크기를 바꾸면 실패), `frontend`(ui.css 스냅샷: hover 허용 selector 4종만) |
| pressed(`:active`) | **모든 대화형 컨트롤**에 있고 hover와 다른 면이다. 채움 버튼 `--accent-pressed`, 테두리 버튼 `--surface-2`(hover가 없어 구별된다), 유령·아이콘 버튼·메뉴 항목·라디오 행·최근 목록 행 `--surface-pressed`, 위험 톤은 `--danger-soft`(hover는 `--surface-2`). 눌림 면 위 글자는 `--fg`, 아이콘은 `--fg-muted. 전환 `--motion-fast` | `E-APPLE-21`(커스텀 버튼엔 눌림 상태), `G-INPUT-IN7`, `A-PRIM-B3`(active가 secondary에만 있었다), foundations §12-11(라이트에서 눌림 = hover이던 결함) | `frontend`(컴포넌트별 `:active` 규칙 존재 스냅샷), `design-gallery`(hover ≠ pressed 계산값) |
| focus-visible | 전역 한 줄 `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }`. 컴포넌트는 포커스 스타일을 재정의하지 않는다. 입력칸도 같다(테두리색을 바꾸지 않는다). `[data-focus-container]:focus-visible { outline: none }`이 유일한 예외(화면 제목 `h1`·카드 제목·대화상자 컨테이너처럼 프로그램이 포커스를 옮기는 비대화형 요소에만 이 속성을 단다. `[tabindex="-1"]` 전체가 아니다: roving tabindex 행이 `-1`일 때 링이 사라지지 않게) | README D20, brief §6.7-1, `A-PRIM-F1`~`F7`(구현 1 + 재정의 5 + 끄기 5 → 1), `E-KO-25`(forced-colors에서 box-shadow는 사라지고 outline은 남는다) | `design-lint` DL8·DL9(`outline: none` 0개(예외 selector 하나), `:focus-visible`에 `box-shadow` 0개, 컴포넌트 CSS에 `:focus` selector 0개), `design-gallery`(forced-colors axe) |
| disabled | 전용 색 `--fg-disabled, 면 `--surface-2`(채움·입력) 또는 투명(유령), 테두리 `--separator`. `opacity`로 흐리지 않는다. 커서 `default`(앱은 모두 default). 사유가 있으면 `aria-disabled` + `aria-describedby`로 사유 요소를 잇고 포커스를 유지한다 | README D21, brief §6.5-4·§6.9-9`, `foundations.md §1` 규칙 5, `A-PRIM-SW1`(켜진 채 비활성이 활성처럼 보였다) | `design-lint`(`opacity`로 비활성 금지: `[disabled]` 규칙 안 `opacity` 0개), `frontend`(aria-disabled 요소는 클릭 무시 + 포커스 가능 테스트) |
| loading | Button만(§2.1). 폭을 유지하고 `aria-busy="true"` + `aria-disabled="true"`, 포커스 유지 | `A-PRIM-B4`(폭이 흔들리고 포커스를 잃었다) | `frontend` |
| invalid | 입력류만. `aria-invalid="true"` + 테두리 `--danger-ink` + **`aria-describedby`로 오류 문구 필수**(타입이 강제). 색 하나만으로 전하지 않는다 | brief §6.5-1, `A-PRIM-T2`, `E-KO-23`(오류 테두리 3:1은 foundations §2.4 통과) | `frontend`(svelte-check: `invalid: true`면 `aria-describedby: string` 필수) |
| readonly | 입력류만. 면 `--surface-2` + 1px `--border-strong`, 글자 `--fg`, 커서 `default`. 편집 가능한 칸(`--surface`)·비활성(`--separator` 테두리·`--fg-disabled)과 다르다 | `A-PRIM-T3`(읽기 전용이 비활성처럼 회색이었다), `web.md` §5.1-1(휴대폰 안내의 주소 칸을 비기술 사용자가 고치려 하지 않게) | `frontend` |

전환은 `background-color`·`color`·`transform`·`opacity`에만, 길이는 `--motion-*` 토큰만 쓴다(`transition: all` 금지, `design-lint`). 자주 쓰는 상호작용(hover·pressed)은 `--motion-fast`, 등장·퇴장은 `--motion-base`·`--motion-slow`(README D22).

---

## 1. prop 어휘 규칙

하나의 개념에 하나의 단어, 하나의 값 집합이다(gov §3.3). 강제는 전부 `frontend`(svelte-check 타입 + ui 단위 테스트)와 `design-lint`(prop 이름 grep)다.

| 축 | prop | 값 | 규칙 |
|---|---|---|---|
| 외형 | `variant` | 컴포넌트별 리터럴 유니온(Button `primary`·`secondary`·`ghost`, Notice `inline`·`banner`·`row`·`toast`, Surface `group`·`card`, Disclosure `section`·`inline`, EmptyState `inline`·`panel`·`page`, Skeleton `line`·`title`·`control`·`row`, PageContainer `content`·`reading`, Menu 트리거 `icon`·`text`) | 외형만. 의미·위험을 담지 않는다. `link`·`danger` variant는 없다(`A-PRIM-N1`). 유일한 원천은 `ui/vocab.ts`(governance DP1) |
| 의미 | `tone` | `neutral` · `info` · `warning` · `danger` | 색의 의미. 컴포넌트는 **부분집합**만 타입으로 허용한다(Button `neutral`·`danger`, Notice·Toast 넷, Menu 항목 `neutral`·`danger`). `success`는 없다(성공색 없음, README D10 [잠정]). `info`는 중립 면 + ⓘ(D10), 상태 어휘로만 남는다 |
| 크기 | `size` | `sm` · `md` · `lg` 문자열 | 기본값은 **`md`**로 통일(IconButton도). 숫자 금지. 아이콘 px 변환표는 §1.2 하나(`A-PRIM-N4`) |
| 종류 | `kind` | `vod` · `clip` · `rewind` · `adult` | Badge만. 도메인 종류이고 의미 색이 아니다(N3) |
| 진행 상태 | `state` | `active` · `paused` · `failed` · `waiting` | **ProgressBar만.** 진행 상태는 tone(의미)도 variant(외형)도 아니라 축을 따로 둔다. 다른 컴포넌트에 `state`를 두면 타입 오류 |
| 불리언 | `disabled` `open` `loading` `required` `readonly` `invalid` | HTML·ARIA 상태와 같은 뜻만 | 그 밖의 불리언 prop(`primary`·`small`·`danger`·`striped`·`mono`·`accentText`·`row`) 금지. `checked`는 쓰지 않는다(값은 `value`) |
| 값 | `value` + `onchange(value)` | TextField `string`, Select·RadioGroup `T extends string \| number`, Switch `boolean`, ProgressBar `number \| null`(0~100 정수, aria-valuenow와 같은 단위) | `value`는 `$bindable()` 하나, 변경 알림은 `onchange(value)` 하나. 인덱스(`selected`)·이벤트 객체 넘기기 금지(N7·N8). ProgressBar는 표시 전용이라 `onchange` 없음 |
| 콜백 | `onclose` · `onchange(value)` · `onclick` | 닫기는 `onclose` 하나(`ondismiss` 없음, N6). 동작 객체(`DialogAction`·`MenuItem`·`NoticeAction`)의 실행도 `onclick` | 이름은 소문자 `on` + 동사. Svelte 네이티브 이벤트는 `...rest`로 통과 |
| 접근 이름 | `label: string` **또는** `labelledby: string` 중 정확히 하나 | TextField·SecretField·Select·Switch·RadioGroup·ProgressBar·Menu·IconButton(label만) | 타입 `NameProps = { label: string; labelledby?: never } \| { labelledby: string; label?: never }`. 이름 없는 입력·진행 막대는 컴파일되지 않는다(`A-PRIM-N10`, `§7 X3` P0). `label`은 `aria-label`로만 쓰이는 보이지 않는 이름이고, 보이는 글자는 `title`(Dialog·Notice·EmptyState) 또는 `children`이다(N9) |
| 내용 | `children`, 구조가 있는 영역은 이름 붙은 snippet(`control`·`header`·`footer`) | 디자인이 박힌 곳(아이콘 크기·색, 버튼 종류·순서)은 snippet이 아니라 **데이터 prop**(`icon`, `actions`, `primary`) | gov §3.3 규칙 3(Primer ADR-004). 대화상자 버튼 순서·알림 동작 버튼 종류를 호출부가 바꿀 수 없다 |
| 항목 키 | 동작·메뉴·라디오 항목 객체는 `id: string` 필수 | `{#each … (item.id)}` | 라벨은 바뀌고 중복될 수 있다(N12) |
| 루트 참조 | `el` `$bindable` | 대화형 컴포넌트 전부 | 포커스 이동(`G-INTER-FC4`)에 필요하다(N15) |
| 통과 | `...rest`는 루트 요소의 HTML 속성(`id`·`name`·`data-*`·`aria-describedby`·네이티브 이벤트). `class`는 루트에만 | 모든 컴포넌트 | `class`는 바깥 여백(margin) 용도만. 색·크기 덮어쓰기는 `design-lint`가 `ui.css` 클래스의 `:global` 재정의를 막는다(gov §3.3 규칙 4, `A-FEAT-D3`) |
| id 생성 | Svelte 5 `$props.id()` 하나 | Dialog·Disclosure·Menu·SettingsRow·RadioGroup | 복붙 생성기 셋을 없앤다(N14). Svelte 5.20 미만이면 `ui/id.ts`의 `uid(prefix)` 하나 |
| 다형 요소 | 없다(`as` 금지) | Worker의 `<a class="btn">`는 CSS 클래스일 뿐 Svelte prop이 아니다 | gov §3.3 규칙 6 |

### 1.1 상태×변형 매트릭스 표기

모든 컴포넌트 표는 열이 같다: **rest · hover · pressed · focus-visible · disabled · loading · invalid**. 해당 없는 칸은 `—`, 전역 규칙과 같으면 `전역`. `/__gallery`가 같은 표를 렌더하고 `design-gallery`가 라이트·다크·720×520·960×700·reduce·contrast·forced·coarse·x-large에서 axe를 돈다(README §4.1).

### 1.2 크기 변환표(유일한 곳)

| `size` | 컨트롤 높이 | 가로 패딩 | 글자 | 안의 아이콘 | 쓰는 곳 |
|---|---|---|---|---|---|
| `sm` | `--control-h-sm` 24 | `--space-8` | `--text-body`/`--leading-body | `--icon-sm` 16 | 행 안 보조 버튼, 행 아이콘 버튼, 알림 안 동작 버튼 |
| `md`(기본) | `--control-h` 28 | `--space-12` | `--text-body`/`--leading-body | Button `--icon-sm` 16, IconButton `--icon-md` 20 | 입력칸·버튼·팝업·툴바 아이콘 버튼 |
| `lg` | `--control-h-lg` 36 | `--space-20` | `--text-title`/`--leading-title `--weight-strong` | 없음(타입이 막는다) | Worker 랜딩 CTA만 |

근거: `foundations.md §5.1`(AppKit regular 24·large 28·XL 36, `E-APPLE-19`), `foundations.md §9`(16은 행·행 버튼, 20은 툴바·안내), 상자−아이콘 차가 짝수(24−16, 28−20, 28−16). Button 안 아이콘이 md에서도 16인 이유: 옆 글자 13px의 굵기·크기에 맞춘다(`E-APPLE-31`). lg에 아이콘이 없는 이유: 랜딩 CTA의 `download` 모티프는 앱 마크가 독점한다(`foundations.md §9.1`). 터치(`any-pointer: coarse`)값은 `tokens.css` 한 곳이 재정의하므로 컴포넌트는 모른다(`gap-input-modality… IN-5`). 강제: `design-icons`(IconButton `size`→px 매핑이 이 표와 같은지), `design-lint`(컴포넌트 CSS 안 `@media (pointer·`(hover` 0개).

---

## 2. 컴포넌트

각 절은 해부 → API → 매트릭스 → 치수 → 접근성 → Do/Don't 순서다. Do/Don't는 "규칙 한 줄 + 권장/금지 코드"로 적고 Don't 코드는 `<!-- lint-ignore -->`로 린트에서 뺀다(gov §9).

### 2.1 Button

**해부**: `[아이콘 16]? [글자] [Kbd 힌트]?`를 가운데 정렬한 `<button>`. 글자는 `.btn-label`(`inline-flex; gap: var(--space-8)`)이 Kbd와 함께 감싼다(글자 뒤 8을 margin 꼼수 없이 표현, `A-PRIM-B9`). `type="button"` 기본.

**API**
``ts
type ButtonProps = HTMLButtonAttributes & {
  variant?: 'primary' | 'secondary' | 'ghost';   // 기본 secondary
  tone?: 'neutral' | 'danger';                   // 기본 neutral. primary+danger는 타입 오류
  size?: 'sm' | 'md' | 'lg';                     // 기본 md. lg는 icon 불가
  icon?: IconName;                               // 글자 앞 16px. children 없이 icon만은 타입 오류(→ IconButton)
  kbd?: string;                                  // 단축키 힌트. aria-hidden
  loading?: boolean;                             // aria-busy + aria-disabled, 폭 유지
  disabled?: boolean;                            // primary에는 없다(타입 오류). 대신 loading 또는 aria-disabled+사유
  children: Snippet;                             // 필수(접근 이름)
  el?: HTMLButtonElement | null;
};
``

**매트릭스**

| variant·tone | rest | hover | pressed | focus-visible | disabled / aria-disabled | loading |
|---|---|---|---|---|---|---|
| primary·neutral | 면 `--accent`, 테두리 1px `--accent`, 글자 `--on-accent` | 없음 | `--accent-pressed`(면·테두리) | 전역(offset 2 틈으로 바탕이 보여 링 대비는 바탕 기준, foundations §2.4) | `disabled` 불가. `aria-disabled`: 면 `--surface-2`, 테두리 `--surface-2`, 글자 `--fg-disabled | 글자 `visibility: hidden`, 가운데 Spinner sm `--on-accent` |
| secondary·neutral | 면 `--surface`, 1px `--border-strong`, 글자 `--fg` | 없음 | 면 `--surface-2` | 전역 | 면 `--surface`, 1px `--separator`, 글자 `--fg-disabled | Spinner `--fg-muted |
| secondary·danger | 같음, 글자 `--danger-ink` | 없음 | 면 `--danger-soft` | 전역 | 같음 | 같음 |
| ghost·neutral | 면 투명, 테두리 투명, 글자 `--fg`, 아이콘 `--fg-muted, 가로 패딩 `--space-6` | 면 `--surface-2` | 면 `--surface-pressed` | 전역 | 글자 `--fg-disabled, 면 투명(변형별로 명세해 `.btn[disabled]`가 `.btn-ghost`를 이기던 특이도 결함을 없앤다, `J-F-A1`) | Spinner `--fg-muted |
| ghost·danger | 글자 `--danger-ink` | 면 `--surface-2` | 면 `--danger-soft` | 전역 | 같음 | 같음 |

**치수**: §1.2. 높이는 `min-height`(글자 크기 설정 ×2.0에서 늘어난다, README D28), 반경 `--radius-control`, `min-width: var(--hit-min)`, 아이콘-글자 gap `--space-4`, 글자 `--weight-regular`(600은 lg만, `A-PRIM-B7`), `white-space: nowrap`(라벨 안에서는 줄바꿈하지 않고 버튼 묶음 `.actions { flex-wrap: wrap }`이 다음 줄로 넘긴다). **끝자리 보정**: 열·행·버튼 줄의 끝(오른쪽 끝 또는 왼쪽 끝)에 오는 유령 버튼은 `.btn-ghost.edge-end { margin-inline-end: calc(0px - var(--space-6)) }`(왼쪽 끝은 `.edge-start`)로 글자 가장자리를 정렬선에 맞춘다(foundations §4 `calc()` 정책). 호출부가 클래스를 준다.

**접근성**: 이름 = `children` 글자(아이콘·Kbd는 `aria-hidden`). `loading`이면 `aria-busy="true"`·`aria-disabled="true"`이고 컴포넌트 안에서 클릭을 막는다(호출부 가드 불필요, B5). `aria-disabled`이면 반드시 `aria-describedby`로 사유를 잇는다(brief §6.9-9, 타입 `{ 'aria-disabled': true; 'aria-describedby': string }`).

**규칙**
- 채움(`primary`)은 **포커스할 수 있는 층마다 하나**다([받기]·랜딩 CTA·대화상자의 오른쪽 버튼·로그인 화면의 주 버튼). 대화상자가 열려 뒤가 `inert`면 뒤의 [받기]는 셈에서 빠진다. 카드의 [불러오기]는 `secondary`, 행의 [이어받기]는 `ghost`(README P3, judgment §2.5, `A-FEAT-D11`). 강제: `design-gallery`(`inert`가 아닌 요소 중 `.btn-primary` ≤ 1), `frontend`.
- 되돌릴 수 없는 동작만 `tone="danger"`이고 `secondary`(대화상자) 또는 `ghost`(행·메뉴)다. 대기 항목의 [취소](`.part` 없음, 가역)는 `neutral`이다(README D54). 채움 빨강 버튼은 없다(`E-APPLE-21`, `foundations.md §2.3` `--danger` 쓰지 않는 곳).
- 다른 창을 여는 버튼은 라벨 끝에 `…`(U+2026)다([변경…] [로그아웃…], README D45. `design-copy`).
- Do: `<Button variant="secondary" tone="danger">취소하고 지우기</Button>` / Don't: `<Button variant="danger">`(의미와 외형을 한 축에, N1).
- Do: `<Button loading={busy}>불러오기</Button>` / Don't: `<Button disabled={busy}><Spinner/></Button>`(폭 흔들림·포커스 상실, B4).

Worker: `<a class="btn btn-primary btn-lg" href="…">macOS용 받기</a>`, `<button class="btn">`. 링크색·밑줄은 `.btn`이 덮는다(`J-F-A2`).

### 2.2 IconButton

**해부**: 아이콘 하나만 있는 정사각 `<button>`. 면 없음.

**API**
``ts
type IconButtonProps = HTMLButtonAttributes & {
  icon: 'x' | 'ellipsis' | 'chevron-down' | 'chevron-up' | 'chevron-left' | 'chevron-right'
      | 'eye' | 'eye-off' | 'arrow-left' | 'settings';   // 허용 목록(foundations §9)
  label: string;                                          // 필수. aria-label이자 title
  size?: 'sm' | 'md';                                     // 기본 md. lg 없음
  disabled?: boolean;
  el?: HTMLButtonElement | null;
};
``
`aria-pressed`(토글)·`aria-expanded`(메뉴 트리거)는 `...rest`로 받고 CSS가 읽는다.

**매트릭스**

| rest | hover | pressed | focus-visible | disabled | `aria-pressed="true"` / `aria-expanded="true"` |
|---|---|---|---|---|---|
| 면 투명, 아이콘 `--fg-muted | 면 `--surface-2` | 면 `--surface-pressed`, 아이콘 `--fg` | 전역 | 아이콘 `--fg-disabled | 면 `--surface-2`, 아이콘 `--fg`(열림·켬·현재 화면 상태가 보인다, `A-PRIM-I1`. 설정 화면의 툴바 [⚙]는 `aria-current="page"`로 이 모양이고 자리를 지킨다) |

**치수**: sm 24×24(아이콘 16), md 28×28(아이콘 20). 반경 `--radius-control`. 정사각은 `width = height`로 고정한다(SecretField의 22.9×24.5 결함, `A-VIS-07`). **끝자리 보정**: 열·행 끝에 오는 아이콘 버튼은 `.edge-end { margin-inline-end: calc(0px - var(--space-4)) }`(`.edge-start`도 같다)로 아이콘 상자 가장자리를 정렬선에 맞춘다(상자 28 − 아이콘 20 = 양쪽 4). 글리프 안쪽 여백(톱니 약 2px)은 보정하지 않는다 [잠정] — 확인: `design-gallery` 잉크 경계 측정(governance §2.6)에서 ±2px 넘게 어긋나면 `foundations.md` §9.1에 "시각 경계 상자" 열을 더한다.

**접근성**: `aria-label={label}`과 `title={label}`을 같은 값으로 준다. 이름과 같은 `title`은 접근 가능한 설명으로 중복 계산되지 않는다(accname 알고리즘: 이름과 같은 설명은 비운다). `title=` 허용 목록에 IconButton이 있다(`G-INPUT-IN2`). 글자 없는 아이콘 버튼은 foundations §9 허용 목록의 10개 모양만이다(`G-ICON-6`, NN/g). 강제: `design-icons` DI7(`icon` prop 리터럴이 허용 목록 밖이면 실패), `frontend`.

- Do: 행의 취소는 `<Button variant="ghost" tone="danger">취소</Button>` / Don't: `<IconButton icon="x" label="취소">`(닫기 `x`와 겸용 금지, `foundations.md §9.1`, `A-FEAT-G6`).

### 2.3 TextField

**해부**: `<input type="text">` 하나. 라벨·도움말·오류는 TextField 바깥의 SettingsRow·폼 행이 소유하고 `labelledby`·`aria-describedby`로 잇는다(`A-PRIM-T5`는 폼 행 패턴으로 `patterns.md`가 답한다).

**API**
``ts
type TextFieldProps = Omit<HTMLInputAttributes, 'type' | 'value'> & NameProps & {
  value: string;                       // $bindable
  onchange?: (value: string) => void;  // 조합(IME)이 끝난 값만. 타이핑 중 검증 금지
  readonly?: boolean; disabled?: boolean; required?: boolean;
  placeholder?: string;
  el?: HTMLInputElement | null;
} & ({ invalid: true; 'aria-describedby': string } | { invalid?: false });
``
컴포넌트가 고정하는 속성: `type="text"`, `autocomplete="off"`, `spellcheck="false"`, `autocorrect="off"`, `autocapitalize="off"`(g-ime §8 R10`; URL 타입은 스킴 없는 주소를 막는다). `onchange`는 `input` 이벤트에서 `e.isComposing || e.keyCode === 229`면 건너뛴다(R4). Enter는 바깥 `<form>` submit에 맡기고 keydown을 달지 않는다(R3).

**매트릭스**

| rest | hover | pressed | focus-visible | disabled | readonly | invalid |
|---|---|---|---|---|---|---|
| 면 `--surface`, 1px `--border-strong`, 글자 `--fg`, placeholder `--fg-muted`(`opacity: 1`) | 없음 | — | 전역(테두리색 불변) | 면 `--surface-2`, 테두리 `--separator`, 글자 `--fg-disabled, placeholder `--fg-disabled | 면 `--surface-2`, 1px `--border-strong`, 글자 `--fg`, 커서 `default`(§0.3) | 테두리 `--danger-ink`(라이트 6.08·다크 6.00 ≥ 3, foundations §2.4) + `aria-describedby` 오류 Notice |

hover가 없으므로 invalid를 덮을 규칙이 없다(T1 구조적 해소). 커서는 `text`(앱에서 `text`가 허용된 곳, README D25).

**치수**: 높이 `--control-h`(min-height), 패딩 `0 var(--space-8)`, 반경 `--radius-control`, 글자 body, `width: 100%`(폭은 부모가 정한다), `min-width: 0`. 선택 가능(`-webkit-user-select: text`).

**접근성**: `NameProps` 필수. `aria-invalid`·`aria-describedby`·`aria-required`는 prop과 1:1. 오류 문구는 입력칸 바로 아래 Notice `variant="row" tone="danger"`로 두고 제출·붙여넣기·드롭 때만 띄운다(brief §6.7-5).

- Do: `<TextField labelledby={labelId} bind:value invalid aria-describedby={errId} />` / Don't: `<TextField bind:value invalid />`(색만으로 오류, T2 — 타입 오류).

Worker: `<input class="field" type="text" …>`. 라벨은 `<label for>`.

### 2.4 SecretField

**해부**: `.field-wrap`(테두리·면을 가진 상자) 안에 테두리 없는 `<input>` + 오른쪽 IconButton sm(`eye`/`eye-off`). 숨김은 `type="password"`, 보임은 `type="text"`. 글꼴 `--font-mono`(쿠키 값).

**API**
``ts
type SecretFieldProps = NameProps & {
  value: string; onchange?: (value: string) => void;
  disabled?: boolean; readonly?: boolean;
  placeholder?: string; name?: string; 'aria-describedby'?: string;
  el?: HTMLInputElement | null;
} & ({ invalid: true; 'aria-describedby': string } | { invalid?: false });
``
TextField가 고정하는 속성을 모두 고정하고 `autocomplete="off"`를 유지한다(비밀번호 저장 제안 금지).

**매트릭스**: TextField와 같다. 포커스 링은 `.field-wrap:has(input:focus-visible)`에 그린다(상자 바깥 2px, 안의 토글은 자기 링). 토글 버튼은 IconButton 매트릭스 그대로.

**치수**: 상자 높이 `--control-h` 28, 토글 24(sm) → 위아래 2 = `--space-2` 안쪽 여백, 토글 반경 = 상자 6 − 2 = `--radius-badge` 4(동심, `foundations.md §6.1`). 입력 왼쪽 패딩 `--space-8`, 토글 오른쪽 여백 `--space-2`. 36 옆 28이 붙던 높이 어긋남(`A-PRIM-SF2`) 해소.

**접근성**: 토글은 `aria-pressed={shown}` + **고정 라벨** "값 보이기"(라벨을 바꾸지 않는다. 라벨 전환과 `aria-pressed`를 함께 쓰면 상태가 두 번 전달된다, SF1 P0, APG). 아이콘만 바뀐다. 입력이 `disabled`여도 값이 있으면 토글은 살아 있다(읽기만 하는 사용자, SF4). 강제: `frontend`(라벨 불변 + aria-pressed 토글 테스트).

### 2.5 Select

**해부**: 네이티브 `<select>` + 오른쪽에 겹친 `chevron-down` 16(장식). 팝업 목록은 OS가 그린다(P1 "OS의 일부").

**API**
``ts
type SelectProps<T extends string | number> = Omit<HTMLSelectAttributes, 'value'> & NameProps & {
  value: T; options: ReadonlyArray<{ value: T; label: string; disabled?: boolean }>;
  onchange?: (value: T) => void; disabled?: boolean; required?: boolean;
  el?: HTMLSelectElement | null;
} & ({ invalid: true; 'aria-describedby': string } | { invalid?: false });
``
`number` 전용이던 계약(`A-PRIM-S4`)을 제네릭으로 푼다.

**매트릭스**

| rest | hover | pressed | focus-visible | disabled | invalid |
|---|---|---|---|---|---|
| 면 `--surface`, 1px `--border-strong`, 글자 `--fg`, 화살표 `--fg-muted | 없음 | 면 `--surface-2` | 전역 | 면 `--surface-2`, 테두리 `--separator`, 글자·화살표 `--fg-disabled, 커서 `default`(S2) | 테두리 `--danger-ink` + describedby |

**치수**: 높이 `--control-h`, 패딩 `0 var(--space-32) 0 var(--space-8)`(오른쪽 32 = 화살표 16 + 양옆 여백), 화살표 `right: var(--space-8)`, 반경 `--radius-control`, 폭은 내용(`width: auto`, `min-width: var(--hit-min)`). 72px 고정(S3)은 없다. 글자 body, `line-height: var(--leading-body)`(브라우저 기본 `normal` 금지, S7).

Worker: `<select class="select">` + `.select-wrap`에 화살표.

### 2.6 Switch

**해부**: `<button role="switch" aria-checked>` 트랙 + `::after` 손잡이.

**API**
``ts
type SwitchProps = NameProps & {
  value: boolean; onchange?: (value: boolean) => void;
  disabled?: boolean; 'aria-describedby'?: string; el?: HTMLButtonElement | null;
};
``

**매트릭스**

| 상태 | 트랙 | 손잡이 |
|---|---|---|
| 꺼짐 | `--border-strong`(bg·surface 위 ≥ 3.56, foundations §2.4 경계) | `--surface` |
| 켜짐 | `--accent`(bg·surface 위 ≥ 3.09, 상태 표시 채움) | `--surface` |
| hover | 없음 | 없음 |
| pressed | 변화 없음 | `--surface-2` |
| focus-visible | 전역(알약을 따라간다) | — |
| disabled 꺼짐 | `--surface-2` + 1px `--separator` | `--fg-disabled, 왼쪽 |
| disabled 켜짐 | `--surface-2` + 1px `--separator` | `--fg-disabled, 오른쪽(위치가 켜짐을 말한다. `A-PRIM-SW1` 해소) |

**치수**: `--switch-w` 54 × `--switch-h` 24, 손잡이 `--switch-knob` 20, 안쪽 여백 2 = `--space-2`, 이동 거리 = `--switch-w` − `--switch-h` = 30(토큰 산술, §7-2), 반경 `--radius-pill`(알약 허용 둘 중 하나). 전환 `transform var(--motion-fast) var(--ease-out)`(reduce에서도 남는 피드백). 근거: AppKit regular 54×24 실측(`E-APPLE-19`), 높이 24로 WCAG 2.5.8 충족.

**접근성**: Space·Enter 토글(네이티브 button). `aria-checked`가 상태의 유일한 원천이고 CSS는 이 속성만 읽는다. 켬/끔 글자는 두지 않는다(HIG 스위치, `A-PRIM-X13` P2 보류). 설정 행에서는 `labelledby={labelId}`.

### 2.7 RadioGroup

**해부**: `<fieldset role="radiogroup">` 안에 행(`<label class="choice">`)마다 **네이티브** `<input type="radio" class="sr-only">` + 그린 점 `.radio` + 글자 + 오른쪽 보조(snippet). 네이티브라 Worker에서도 JS 없이 같다(`A-PRIM-R2`).

**API**
``ts
type RadioGroupProps<T extends string | number> = NameProps & {
  name: string;                                    // 네이티브 그룹 이름
  value: T; onchange?: (value: T) => void;
  options: ReadonlyArray<{ id: string; value: T; label: string; description?: string; disabled?: boolean }>;
  trailing?: Snippet<[option]>;                    // 행 오른쪽 보조 글자(예상 크기). 대화형 요소 금지
  disabled?: boolean;                              // 그룹 전체
};
``

**매트릭스(행)**

| 행 상태 | 면 | 점 | 글자 |
|---|---|---|---|
| rest | 투명 | 1px `--border-strong`, 면 `--surface` | `--fg`, 보조 `--fg-muted |
| 선택 | `--accent-soft`(비활성 창은 `--surface-2`, foundations §10) | 면·테두리 `--accent-ink`(surface·surface-2·accent-soft 어디서나 4.5:1, foundations §2.4), `box-shadow: inset 0 0 0 4px var(--surface)` 고리(허용된 유일한 box-shadow, foundations §6.4) | 같음 |
| hover | 없음 | — | — |
| pressed | `--surface-pressed` | — | — |
| focus-visible | `.choice:has(input:focus-visible)`에 전역 outline(행 전체, HIG "목록은 행 하이라이트") | — | — |
| disabled | 투명 | 테두리 `--separator`, 면 `--surface-2` | `--fg-disabled |

그룹 상자 테두리는 없다(카드 안에 바로 놓인다. 테두리 안 테두리 결함 `A-VIS-27` 해소).

**치수**: 행 높이 `--control-h` 28, 패딩 `0 var(--space-8)`, gap `--space-8`, 반경 `--radius-control`, 점 `--radio-size` 16(AppKit regular 라디오 16). 2~5개(`E-APPLE-25`, 넘으면 Select).

**접근성**: 네이티브 라디오 키보드(방향키 즉시 선택, Tab은 그룹 하나). `fieldset`에 `aria-labelledby` 또는 `aria-label`. `trailing`에 버튼·링크를 넣으면 label 안 대화형 자손이 생기므로 금지(`A-PRIM-R2`, 리뷰 `R1`). 화질 선택에서 꼬리표 "가장 좋은 화질"(`quality.best`, `--text-body` `--fg-muted)은 **늘 가장 높은 화질 행**에 붙고 기본 선택과 무관하다(기본 선택 규칙은 `patterns.md` §6.5). 행의 면은 FieldRow 값 열 x에서 시작한다(라벨 거터를 침범하지 않는다, `patterns.md` §6.2).

Worker: 같은 마크업(`<label class="choice"><input type="radio">…`).

### 2.8 Disclosure

**해부**: 앱·Worker 모두 `<details class="disclosure">` + `<summary>`. 마커는 숨기고 `chevron-right` 16을 **왼쪽**에 둔다(macOS 펼침 삼각형 자리, `A-PRIM-DS5`). 열리면 90° 회전(`--motion-fast`). 패널 높이 애니메이션은 없다(정지 기본, README P5. 명세에만 있던 전환 DS1을 폐기).

**API**
``ts
type DisclosureProps = {
  variant?: 'section' | 'inline';   // 기본 section
  title: string;                    // summary 글자
  heading?: 'h2' | 'h3';            // section에서 summary 안 제목 요소(기본 h2). 설정 "고급" 절의 제목이 된다
  open?: boolean;                   // $bindable, HTML open과 같음
  onchange?: (open: boolean) => void;
  children: Snippet;
};
``

**매트릭스(summary)**

| variant | rest | hover | pressed | focus-visible | open |
|---|---|---|---|---|---|
| section | 글자 `--fg` body 600, 화살표 `--fg-muted, 면 투명 | 없음 | `--surface-2` | 전역(반경 `--radius-group`) | 화살표 `rotate(90deg)` |
| inline | 글자 `--fg` body, 화살표 `--fg-muted, 패딩 `0`(삼각형 왼쪽 가장자리 = 본문 글자 x, 들여쓰기 없음), 높이 `--control-h-sm`, 면 투명 | 없음 | 글자 `--fg-muted`로 잠깐 | 전역 | 같음 |

**치수**: section summary `min-height: var(--row-h)` 36, 패딩 `var(--space-6) var(--space-12)`, gap `--space-6`; 패널 패딩 `0 var(--space-12) var(--space-12)`. inline 패널 `margin-top: var(--gap-label)`, 패딩 0(오류 Notice 본문과 같은 x에서 시작).

**접근성**: 네이티브 `details`가 `aria-expanded`를 처리한다. `summary` 안에 `<h2>`를 두면 설정 "고급" 절에도 제목 요소가 생긴다(`A-FEAT-D5`). `::-webkit-details-marker { display: none }`과 `list-style: none` 둘 다.

Worker: 같은 마크업. 랜딩 "다른 운영체제"·"파일 확인(선택)" 접힘(README D53).

### 2.9 Menu

**해부**: 트리거 + 떠 있는 패널 `<div role="menu">`(면 `--raised`, `--shadow-menu`, 반경 `--radius-overlay`, 패딩 `--space-6`) + 항목 `<button role="menuitem">`(아이콘 16 + 글자). 트리거는 둘 중 하나: `trigger="icon"`(IconButton `ellipsis`·`settings`) 또는 `trigger="text"`(유령 버튼 글자 + `chevron-down` 16, 툴바의 [채널이름 ▾] 계정 메뉴). 둘 다 `aria-haspopup="menu"` `aria-expanded`. 위험 항목은 맨 아래, 위에 1px `--separator`.

**API**
``ts
interface MenuItem { id: string; label: string; icon?: IconName; tone?: 'neutral' | 'danger'; disabled?: boolean; onclick: () => void; }
type MenuProps = { label: string; items: MenuItem[]; size?: 'sm' | 'md'; el?: HTMLButtonElement | null; }
  & ({ trigger?: 'icon'; icon?: 'ellipsis' | 'settings' } | { trigger: 'text'; text: string });   // text 트리거는 보이는 글자가 이름(label은 aria-label 보강)
``

**매트릭스(항목)**

| rest | hover | pressed | focus-visible | `aria-disabled="true"` | tone danger |
|---|---|---|---|---|---|
| 면 투명, 글자 `--fg`, 아이콘 `--fg-muted | `--surface-2` | `--surface-pressed` | 전역 outline + `--surface-2`(패딩 6 = 링 2 + offset 2 + 여유 2라 이웃을 덮지 않는다, `A-PRIM-M1`) | 글자·아이콘 `--fg-disabled, 포커스 가능, 실행 안 함(`A-PRIM-X4`: `disabled` 속성 금지) | 글자 `--danger-ink`, hover `--surface-2`, pressed `--danger-soft` |

**치수**: 항목 높이 `--control-h` 28, 패딩 `0 var(--space-12)`, gap `--space-8`, 반경 `--radius-control`(오버레이 12 − 패딩 6 = 6 동심). 패널은 트리거 아래 `--space-4` 띄워 오른쪽 정렬, 창 밖으로 나가면 위로 뒤집는다(JS 측정, M3). 등장 `opacity` + `translateY(var(--space-4)→0)` `--motion-base var(--ease-out)`, 퇴장 없음(즉시). `z-index: var(--z-menu)`(주인 1개).

**접근성**: APG 메뉴 버튼. Enter·Space·↓ 열고 첫 항목, ↑ 열고 마지막, Home/End, Esc 닫고 트리거로 복귀, Tab은 닫고 자연 이동, 바깥 클릭 닫기. 열린 동안 트리거 `aria-expanded="true"`(IconButton 매트릭스가 그린다). 항목이 1개뿐인 메뉴는 만들지 않고 글자 버튼으로 둔다(`A-VIS-33`, 리뷰 `R1`). [⋯] 메뉴의 "제목 전체 보기"는 행 아래 인라인 펼침이다(`patterns.md` §14.3).

### 2.10 Dialog

**해부**: `.scrim`(fixed, `--scrim`, `--z-dialog`, `display: grid; place-items: center`) 안에 `<div role="dialog" aria-modal="true" tabindex="-1" data-focus-container>`. 안은 `<h2>` 제목 → 본문(스크롤 영역) → 버튼 줄 `.actions`. 네이티브 `<dialog>`는 **[잠정]** 쓰지 않는다: `::backdrop`이 루트의 커스텀 프로퍼티(`--scrim`)를 상속하는지 Safari 16.4에서 확인하지 못했다. 확인 방법: WebKitGTK 2.40·macOS 13.3 실기에서 `dialog::backdrop { background: var(--scrim) }` 렌더 확인 뒤 ADR. 그때까지 열린 동안 형제 요소에 `inert`를 건다(`A-PRIM-D1`, foundations §11 하한 안). `<form method="dialog">`도 쓰지 않는다(암묵 제출은 텍스트 입력에서만 생기고 어느 버튼이 기본 버튼인지 DOM 순서에 끌려간다).

**API**
``ts
interface DialogAction { id: string; label: string; onclick: () => void; }
type DialogProps = {
  open: boolean; title: string;
  primary: DialogAction;                                  // 오른쪽 끝 · 채움 · Enter · 기본 포커스 · 안전한 쪽(아무것도 바꾸지 않는 결과)
  secondary?: DialogAction & { tone?: 'neutral' | 'danger' };   // 왼쪽 · 실행 쪽. danger면 버튼 줄 왼쪽 끝(margin-inline-end: auto), neutral이면 primary 옆
  onclose: () => void;                                    // Esc·[×] 없음·바깥 닫기 없음. 어떤 action도 부르지 않고 닫기만 한다. 결과는 primary와 같다
  children?: Snippet;                                     // 본문. 없으면 aria-describedby도 없다(A-PRIM-D2)
};
``
버튼 순서는 컴포넌트가 정한다: `[secondary] [primary]`. 호출부가 바꿀 수 없다. 버튼은 최대 2개다(HIG 최대 3이지만 7종 모두 2개, `E-APPLE-22`). 3개가 필요한 대화상자는 새 패턴이라 ADR이다.

**규칙(README D36, 사용자 결정 3)**: 오른쪽 끝 = 안전 = 채움 = Enter = 기본 포커스. **안전 = 그 대화상자를 연 뒤 아무것도 하지 않은 것과 같은 결과**다(현 상태 유지). 실행 쪽은 왼쪽이고, 되돌릴 수 없으면 `tone=danger`(빨간 글자 테두리, 왼쪽 끝으로 띄워 오클릭을 줄인다), 되돌릴 수 있으면 `neutral`(회색 테두리, 채움 옆). 대화상자 7종의 제목·라벨은 `content.md` §5.3 표가 소유한다(예: [취소하고 지우기] … [계속 받기], [업데이트하고 다시 시작] [나중에], [가져오기] [나중에], [로그아웃] [로그인 유지]). HIG "취소 leading"과 어긋나는 유일한 경우(취소 확인)는 안전한 쪽이 곧 취소라 trailing에 둔다(ADR-0005). 근거: `E-APPLE-22`(기본 trailing), `G-INTER-CF4`(NN/g 위험한 쪽을 기본으로 두지 않는다; 면 대신 글자로 뒤집음), `A-VIS-05`·`A-VIS-06`, `A-FEAT-J1`. 강제: `frontend`(Dialog 테스트: `inert` 아닌 층에 `.btn-primary` 1개·DOM 마지막·열리면 `document.activeElement === primary`·Enter(포커스가 primary일 때) → primary·Esc → `onclose`만·포커스가 버튼이 아닐 때 Enter는 아무것도 실행하지 않음·`secondary`가 `tone=danger`면 `margin-inline-end: auto`·7종 표(`content.md` §5.3)의 오른쪽 키가 각 호출부의 `primary`와 같음), 리뷰 `R6`.

**매트릭스**: 버튼은 §2.1. 상자: 면 `--raised`, `--shadow-dialog`(다크는 안쪽 1px 흰 선 포함), 반경 `--radius-overlay`. 제목 `--text-title`/`--leading-title 600 `--fg`, 본문 `--leading-read `--fg`. 등장: scrim `opacity 0→1` + 상자 `scale(.98)→1` `--motion-slow var(--ease-out)`; 퇴장 `--motion-base var(--ease-in)`; reduce는 토큰이 1ms로 줄인다(foundations §7.1).

**치수**: 폭 `--dialog-w 440, `max-width: calc(100% - 2 * var(--edge))`, `max-height: calc(100% - 2 * var(--edge))`(넘치면 본문만 스크롤, 제목·버튼 줄은 고정 — Windows 텍스트 225%의 CSS 231px 높이에서도 버튼이 보인다), 패딩 `--space-20`, 제목→본문 `--space-12`, 본문→버튼 `--space-20`, 버튼 gap `--gap-sibling`, 버튼 줄 `justify-content: flex-end; flex-wrap: wrap`(x-large에서 두 버튼이 한 줄에 안 들어가면 다음 줄, 라벨 안 줄바꿈은 없음). 제목 안 외부 문자열은 `clipGraphemes(NOTIFY_TITLE_MAX_GRAPHEMES)`로 자르고 원문은 본문 첫 줄에 둔다(`content.md` §13).

**접근성**: 열리면 **늘** `primary`에 프로그램 포커스(`:focus-visible` 휴리스틱에 맡겨 포인터로 열면 링이 안 보이고 키보드로 열면 보인다, `A-VIS-26`), Tab 가둠(`focus.ts` 하나), 닫으면 연 요소로 복귀, scrim 클릭으로 닫지 않는다(brief §6.7-2, `A-DRIFT-K15`), 모달 둘 겹침 금지(런타임 assert + `frontend`, 뒤에 온 요청은 대기열). Esc keydown은 `isComposing || keyCode === 229`면 무시(`G-IME-R4`). `aria-labelledby` 제목, `aria-describedby`는 본문이 있을 때만.

Worker: 없다. 되돌릴 수 없는 동작은 확인 페이지(README D54, web.md §7.3: 왼쪽 빨간 글자 폼 버튼, 오른쪽 링크. 웹에는 Enter 기본 버튼이 없어 채움이 없다).
### 2.11 ConfirmDialog

Dialog + `body: string`(해요체 1~2문장, 마침표 있음). 제목은 질문 한 문장이고 대상을 따옴표로 부른다("‘{제목}’ 받기를 취소할까요?"), 버튼은 결과 동사다(`G-INTER-CF2`·`G-INTER-CF3`, README D46). 되돌릴 수 있는 동작에는 쓰지 않고 즉시 실행 + 토스트 [되돌리기]로 처리한다(`patterns.md` §4 판단표: 완료 항목 지우기·설정·대기 취소는 확인 없음; `.part`가 있는 취소·덮어쓰기·창 닫기·업데이트 재시작·로그아웃·이전 설정 가져오기는 대화상자). 강제: `design-copy` DC5(제목 끝 `?`, 버튼 라벨에 "예/아니오/확인" 금지), `R6`.

``ts
type ConfirmDialogProps = Omit<DialogProps, 'children'> & { body: string };
``

### 2.12 Notice

9갈래 알림의 단일 프리미티브다.

**해부**: `[아이콘][제목?][본문][동작 버튼들?][닫기?]`. 아이콘은 tone이 정한다: `info` → `info` `--fg-muted, `warning` → `triangle-alert` `--warning-ink, `danger` → `circle-x` `--danger-ink`(경고와 모양이 다르다, `A-PRIM-A2`), `neutral` → 없음 또는 호출부가 준 `icon`(클립보드 제안 `clipboard-paste`, 완료 `circle-check`). 제목·본문 글자는 **늘 `--fg`**(제목만 600). 톤 색은 아이콘과 면에만 있다(A3·`A-FEAT-C8` 해소).

**API**
``ts
interface NoticeAction { id: string; label: string; onclick: () => void; }
type NoticeProps = {
  variant?: 'inline' | 'banner' | 'row' | 'toast';   // 기본 inline
  tone?: 'neutral' | 'info' | 'warning' | 'danger';   // 기본 info
  icon?: IconName;                                    // tone=neutral일 때만(타입)
  title?: string;                                     // 있으면 600 한 줄. 한 문장 안내는 title 없이 children만(C4)
  children: Snippet;                                  // 본문
  actions?: NoticeAction[];                           // ≤ 3, 전부 Button secondary sm(C6·C7 통일)
  onclose?: () => void;                               // inline·banner·toast(타입). 있으면 IconButton x sm. row에는 없다
};
``

**variant별 해부**

| variant | 면·테두리 | 아이콘 | 글자 행간 | 패딩 | 쓰는 곳 |
|---|---|---|---|---|---|
| `inline` | tone 면(`info`·`neutral` `--surface-2`, `warning` `--warning-soft, `danger` `--danger-soft`), 반경 `--radius-control` | `--icon-md` 20 | `--leading-read 20(아이콘 20과 첫 줄이 보정 없이 맞는다, `A-PRIM-A7`의 마법 숫자 제거) | `var(--space-8) var(--space-12)`(이 값이 원천. patterns·web은 가리키기만) | 카드 안 안내(충돌·"받다 만 파일"·내 영상 아님), 설정 절 경고, 불러오기 실패, 클립보드 제안([×] 있음) |
| `banner` | inline과 같다. 본문 열 안, h1 앞 한 장 | 20 | 20 | 같음 + 닫기 24 | 중단 안내·저장 실패·새 버전·서비스 공지(README D37·D41), Worker flash |
| `row` | 면 없음, 패딩 0 | `--icon-sm` 16 | `--leading-body 16 | 0 | 작업 행의 오류·막힘 줄, 입력칸 아래 오류 한 줄 |
| `toast` | `--raised`, `--shadow-toast`, 반경 `--radius-overlay` | 20 | 20 | `var(--space-8) var(--space-8) var(--space-8) var(--space-16)`(닫기 쪽 8) | Toast가 쓴다(§2.13) |

내부 gap `--space-8`, 동작 버튼은 전부 `Button secondary sm`이고 글자 뒤 같은 flex 줄에서 `flex: none`으로 오른쪽, 좁으면 `flex-wrap`으로 아래 줄(규칙 하나, `A-FEAT-C6`의 4종 → 1종). `row`에는 `actions`·`onclose`가 없다(행의 동작 열이 맡는다).

**role**: `inline`·`banner`·`toast`에서 `danger` → `role="alert"`, 그 밖 → `role="status"`(`E-KO-22`, brief §6.9-4, `A-FEAT-C2` ConflictNotice warn alert 위반 해소). `row`에는 role이 없다: 작업 행의 실패 줄은 앱 시작 때 수십 개가 한꺼번에 그려질 수 있고 새 실패는 라이브 루트 하나가 알린다(`patterns.md` §1.5). `banner`는 `<section aria-labelledby={titleId}>`로 감싸고 role은 **안쪽 글자 요소**에 둔다(GOV.UK 배너·JAWS). `aria-atomic="true"`. 강제: `frontend`(tone×variant→role 테스트), `design-lint` DS1(`role="alert"` 리터럴은 `Notice.svelte`에만).

**tone 사용 기준**(`A-FEAT-C3`): 되돌릴 수 없거나 막힌 것 = `danger`, 되돌릴 수 있는 주의 = `warning`, 알려 주기 = `info`, 제안·완료 = `neutral`. "확인하지 못함"은 `warning`, "내 영상이 아님"은 `danger`. 서비스 공지 block은 `warning`(사용자 잘못도 손실도 아니다, README D10). 강제: 리뷰 `R7`.

- Do: `<Notice tone="warning">같은 이름의 파일이 이미 있어요</Notice>` / Don't: `<Notice tone="warning" title="같은 이름의 파일이 이미 있어요" />`(한 문장을 600 제목으로, C4).

Worker: `<div class="notice tone-warning" role="status"><svg class="icon icon-md">…</svg><p>…</p></div>`. flash 메시지는 `banner`.

### 2.13 Toast

**해부**: Notice `variant="toast"` 하나를 Toaster가 본문 열 하단에 띄운다. **한 번에 하나 보이고 나머지는 대기열**(README D37). 정보·완료 토스트(`danger` 아님, `action` 없음)는 새 토스트가 오면 즉시 대체된다. `danger`이거나 `action`이 있는 토스트는 대체되지 않고 닫힐 때까지 남으며 뒤에 온 것은 FIFO로 기다린다 — 오류가 몰려도 하나도 잃지 않는다(`G-INTER-NT7`·`G-INTER-NT8` 뒤집음: 3개 동시 표시 대신 대기열).

**API**
``ts
interface ToastItem { id: string; tone: 'neutral' | 'info' | 'warning' | 'danger'; icon?: IconName; message: string; action?: NoticeAction; sticky?: boolean; }
type ToastProps = { item: ToastItem; onclose: () => void; };
``
지속: `danger` 또는 `sticky`면 닫을 때까지. 그 밖은 `TOAST_MS`(6초 [취향], foundations §14, ADR-0009) + hover·키보드 포커스 동안 정지, 떠나면 처음부터 다시(`G-INTER-NT5`·`G-INTER-NT6`, Carbon). [되돌리기] 토스트는 `action`이 있지만 `sticky`가 아니다: 6초 뒤 닫히고 지연 삭제는 토스트가 닫힐 때(타이머·[×]·대기열 교체 모두) 확정된다(`patterns.md` §4). 포커스를 가져가지 않는다. `action`의 동작은 다른 곳(행 버튼·메뉴)에서도 할 수 있어야 한다(`G-INTER-NT7`, 리뷰 `R7`). 복사 확인은 토스트가 아니라 버튼 라벨 전환 "복사했어요"다(D37). 메시지 안 외부 문자열은 `clipGraphemes`로 자른다(`content.md` §13).

**치수**: Toaster는 `position: fixed; bottom: var(--edge); left: 0; right: 0; z-index: var(--z-toast)`인 띠이고 그 안에 `.col`(PageContainer와 같은 클래스: `max-width: var(--content-max); margin: 0 auto; padding: 0 var(--edge)`)을 두어 토스트 폭이 **열 안쪽 폭**(`--content-max` − 2·`--edge`, 960 창에서 760, 720 창에서 680)이 된다(`A-VIS-32` 해소. `--content-max`의 사용처는 여전히 `.col`뿐이다, §2.18). `min-height: var(--row-h)`. 등장 `opacity 0→1` + `translateY(var(--space-8))→0` `--motion-base var(--ease-out)`, 퇴장 `opacity` `--motion-base var(--ease-in)`(foundations §7.1). 토스트가 떠 있는 동안 `.main`에 `padding-bottom·`scroll-padding-bottom: calc(var(--row-h) + 2 * var(--edge))`를 더해 마지막 행의 버튼이 가려지지 않는다(WCAG 2.4.11, `E-KO-19`; 시각 가림도 함께 푼다).

Worker: 없다. 결과는 PRG 뒤 flash `banner`(web.md).
### 2.14 ErrorAlert

`errorCopy()` 결과 하나를 받아 L0~L2를 그린다. 6곳의 title/body/detail 복사본(`A-FEAT-C5`)이 이것 하나로 모인다.

**해부**: Notice `tone="danger"`(variant `inline` 또는 `row`) 안에 ① L0 제목(600) + 본문 + `actions`(≤ 3, 결과 동사. 본문이 "문제 보고용 정보를 복사해"를 말하면 [문제 보고용 정보 복사]가 **여기** 있다 — 본문이 시키는 버튼이 접힌 곳에 있으면 안 된다, C6) ② L1 Disclosure `variant="inline"` "자세히": `오류 코드: {code}` 줄, 원문 메시지(`--font-mono` caption, 선택 가능 `<bdi>`) ③ L2 `helpId`가 있으면 ghost 링크 "도움말 보기: {주제}"(`G-HELP-E5`). 코드별 버튼은 `content.md` §15.2의 "버튼" 열이 원천이고 `frontend` 골든이 1:1로 비교한다.

**API**
``ts
type ErrorAlertProps = { error: ErrorCopy /* { title, body, actions: NoticeAction[], detail?: { code: string; raw?: string }, helpId?: string } */; variant?: 'inline' | 'row'; };
``
오류 코드·HTTP 번호는 제목·본문에 들어가지 않는다(`G-HELP-E3`, `design-copy` DC8). 원문은 `cleanDisplayText`를 거친다(brief §6.11). 위치는 그 오류를 일으킨 컨트롤 바로 아래다(`A-FEAT-F5`, 리뷰 `R7`). 강제: `frontend`(ErrorAlert 골든: `content.md` §15.2 버튼 열과 1:1), `design-lint`(`title/body/detail` 클래스를 ui 밖에서 선언 금지).

### 2.15 EmptyState

**해부**: 아이콘 없음(32 아이콘은 없다. HIG writing "빈 화면엔 다음 행동", `foundations.md §9`). 제목 + 본문 + 단계 `<ol>` + 동작 버튼 하나(선택). 가운데 정렬. `<ol>`의 번호는 `::marker` 대신 `counter`로 그린 원형 배지(지름 `--badge-h` 18, 면 `--surface-2`, 글자 `--text-caption` 600 `--fg`) **[취향]**이고 항목은 가로 나열(좁은 레이아웃에서 세로). 첫 실행(`steps` 있음)과 목록을 비운 뒤(`steps` 없음, 본문 한 줄 `list.cleared`)는 다른 문구다(`patterns.md` §2.4).

**API**
``ts
type EmptyStateProps = {
  variant?: 'inline' | 'panel' | 'page';
  title?: string;                 // inline에는 없다(타입)
  children: Snippet;              // 본문 한두 문장
  steps?: string[];               // 번호는 <ol>이 붙인다. 문자열에 ① ② 금지(design-copy)
  action?: NoticeAction;          // Button secondary md. primary 금지(채움은 창에 하나)
};
``

| variant | 제목 | 본문 | 패딩 | 쓰는 곳 |
|---|---|---|---|---|
| `inline` | — | `--text-body` `--fg-muted 한 줄(12px 단독 금지, brief §6.4-3; `fg-faint 힌트 결함 `A-FEAT-S2`) | `var(--space-6) 0` | 최근 목록 비었을 때 |
| `panel` | `--text-display`/`--leading-display 600 `--fg` | `--leading-read `--fg-muted | `var(--space-32) var(--edge)` | 그룹 상자 안(다운로드 목록 비었을 때, 3단계 안내 judgment §2.3-3) |
| `page` | 같음 | 같음 | 열 세로 가운데 | 로그인 첫 화면(패턴은 `patterns.md`) |

높이는 내용대로다. "남는 높이를 다 쓰되 최소 160"(`A-FEAT-S1`·`A-FEAT-F4`)은 부모 flex가 정하고 EmptyState는 모른다. 스켈레톤과 동시에 보이지 않는다(brief §6.9-5, `frontend`). 제목 요소는 `<h2>`(`<p>`·`<h2>` 혼용 E5 해소).

### 2.16 Surface

**해부**: 만질 수 있는 흰 면 하나. `--surface` + 1px `--separator` + `--radius-group`(시스템 설정의 그룹 상자, README D19·foundations §6.3). 8곳의 테두리+면 박스(`A-FEAT-D1`)가 이것이다.

**API**
``ts
type SurfaceProps = HTMLAttributes<HTMLElement> & {
  variant?: 'group' | 'card';     // group: 패딩 0, 자식 행이 패딩·구분선을 가진다 / card: 패딩 --space-16
  header?: Snippet; footer?: Snippet;   // card만. 아래·위 1px --separator
  children: Snippet;
};
``
header 패딩 `var(--space-8) var(--space-8) var(--space-8) var(--space-16)`(오른쪽 닫기 IconButton 자리), footer 패딩 `var(--space-12) var(--space-16)` 버튼 오른쪽 정렬 gap `--gap-sibling`. group 안 행 사이는 `.row + .row { border-top: 1px solid var(--separator) }`. 그림자 없음(떠 있지 않다). 스켈레톤 카드는 같은 Surface 안에 Skeleton을 놓아 높이가 결과와 같다(`A-VIS-19`, `patterns.md`).

forced-colors: `1px solid CanvasText`.

### 2.17 SettingsRow

**해부**: Surface `group` 안의 한 행. `[라벨 + 도움말] [현재 값?] [컨트롤]`.

**API**
``ts
type SettingsRowProps = {
  label: string; help?: string; value?: string;     // value: 읽기만 하는 현재 값(경로·버전)
  control?: Snippet<[{ labelId: string; helpId?: string }]>;   // Switch·Select·Button이 labelledby·describedby를 받는다
};
``

**치수·색**: `min-height: var(--row-h)` 36, 패딩 `var(--space-6) var(--space-12)`, gap `--gap-sibling`, 라벨 `--fg` body, 도움말 `--text-caption`/`--leading-caption `--fg-muted 라벨 아래 `--space-4`, 값 `--fg-muted body(`.ellipsis`, 경로는 가운데 말줄임 JS), 컨트롤 `flex: none`. **라벨 = `--fg`, 값·도움말 = `--fg-muted`**로 고정한다(`A-FEAT-E2` 역할 반전 해소. 카드 폼 FieldRow §2.26도 같다). 좁은 폭: 라벨 `flex: 1 1 50%`, 컨트롤 `flex: none`, `flex-wrap: wrap`으로 자연 줄바꿈한다. 폭 미디어 쿼리를 컴포넌트가 갖지 않는다(`design-lint`, foundations §8).

Worker 관리 페이지도 같은 클래스(`.row`·`.row-label`·`.row-help`·`.row-value`·`.row-control`).

### 2.18 PageContainer

**해부**: 본문 열 하나. `max-width: var(--content-max)`(reading은 `--reading-max), `margin: 0 auto`, 패딩 `var(--space-16) var(--edge) var(--space-32)`. 툴바 안쪽·배너·토스트·대화상자가 같은 열 기준이다(README D24, `A-FEAT-A1`~`A-FEAT-A6`).

``ts
type PageContainerProps = { variant?: 'content' | 'reading'; children: Snippet; };
``
`reading`은 Worker 읽기 페이지(랜딩·help·privacy·licenses)만. 폭 토큰은 이 둘과 `--dialog-w`(대화상자·로그인 패널)뿐이고 설정 640·토스트 360 같은 별도 폭은 없다(한 열, brief §3.1(3)). Toaster(§2.13)·툴바(§2.28)·Worker 사이트 헤더도 같은 `.col`을 쓴다. 강제: `design-tokens`(`--content-max`·`--reading-max 사용처가 `.col`뿐), `design-gallery`(720·960 스냅, 정렬선 x).

### 2.19 Badge

**해부**: 글자 배지. `--surface-2` 면, **`--fg`** `--text-caption`/`--leading-caption 600(12px 보조색 단독 정보 금지, foundations §3.2), `min-height: var(--badge-h)` 18(flex 가운데, 큰 글자에서 늘어난다), 패딩 `0 var(--space-6)`, 반경 `--radius-badge`, `white-space: nowrap`. 색이 아니라 글자로 종류를 말한다(README D10, `A-VIS-31`). 작업 행에서는 제목 **뒤**에 놓여 제목 시작 x가 행마다 같다(`patterns.md` §3.2).

``ts
type BadgeProps = { kind: 'vod' | 'clip' | 'rewind' | 'adult' };
``
글자는 `kind`→copy deck(`content.md`: 일반 VOD / 클립 / 빠른 다시보기 / 19). `adult`는 보이는 글자 "19"에 `role="img" aria-label="{성인 인증 문구}"`를 붙인다(`title`만으로는 읽히지 않는다, `A-PRIM-BG2`). 나머지는 보이는 글자가 곧 이름이라 role 없음. `title` 설명은 두지 않는다(IN-2).

### 2.20 ProgressBar

**앱 전용**이다(Worker 페이지에는 진행 표시가 없다). **해부**: 트랙 `<div role="progressbar">` + 채움 `.fill`. 채움은 `width: 100%; transform-origin: left; transform: scaleX(var(--p))`, `--p`는 컴포넌트가 Svelte `style:--p={value / 100}` **디렉티브**(CSSOM 설정, CSP `style-src 'self'`에 걸리지 않는다. 속성 문자열 `style="--p: …"`는 CSP가 막으므로 쓰지 않는다)로 쓰는 **유일하게 허용된 컴포넌트 커스텀 프로퍼티**(foundations 머리글, `design-lint` DL7·DS2). 막대는 `--surface` 위에만 놓는다(다크 `--bg` 위에서는 트랙 `--track`이 보이지 않는다, foundations §2.3).

**API**
``ts
type ProgressBarProps = NameProps & {
  value: number | null;            // 0~100 정수(내림). null = 총량 모름
  state?: 'active' | 'paused' | 'failed' | 'waiting';   // 기본 active
  valuetext: string;               // 완결 문장. content.md §10의 a11y.progress가 만든다
};
``

| state | 채움 | 비고 |
|---|---|---|
| `active` | `--accent` | 전환 `transform var(--progress-tween) linear`(이징 `linear`는 `ui.css` 글자 상수, foundations §7.1). 값이 **줄면** 전환 없이 즉시(`transition: none` 토글, README D23) |
| `paused` | `--border-strong`(track 위 3.22 / 4.53) | 일시정지(앱 종료로 멈춘 것도 같다) |
| `failed` | `--danger`(track 위 4.79 / 3.22) | 실패. 테두리·면을 더 붉히지 않는다(`A-VIS-20` 5겹 → 막대·아이콘·글자 3겹) |
| `waiting` | `--accent` 줄무늬: `repeating-linear-gradient(-45deg, var(--accent) 0 var(--space-4), transparent var(--space-4) var(--space-8))`, 정지 | 연결 대기·주소 재취득(README D40). 퍼센트 유지, 빨강 없음. 이 값이 원천이고 `patterns.md`는 가리키기만 |
| `value: null` | 트랙 전체에 같은 줄무늬, 정지 | 총량 모름. "정지가 기본"이라 이동 애니메이션은 없다(P5). 진행 중임은 상태 글자가 말한다 |

**치수**: 높이 `--progress-h` 6 [취향], 반경 `--radius-pill`, 트랙 `--track`, `overflow: hidden`, `flex: 1`. `prefers-contrast: more`: `border: 1px solid var(--fg)`(box-sizing으로 높이 유지, foundations §2.5). reduce: `--progress-tween` 1ms(토큰). 막대를 `display: none`으로 숨기지 않는다(`A-PRIM-P3`). forced-colors 매핑(실패 `CanvasText`, 일시정지 `GrayText` [잠정])은 foundations §2.7·§3.

**접근성**: `aria-valuemin="0" aria-valuemax="100" aria-valuenow={value}`(null이면 생략) `aria-valuetext`. 이름 필수(`A-PRIM-P1` P0). 퍼센트 글자는 막대 바깥 `--pct-w` 칸이 `.num`으로 늘 보인다(C5, `patterns.md` §3.2).
### 2.21 Spinner

**해부**: `<svg aria-hidden="true">` 원 호(3/4) `stroke: currentColor; stroke-width: var(--icon-stroke)` + `vector-effect: non-scaling-stroke, 회전 `var(--motion-spin) linear infinite`(유일한 `@keyframes`, foundations §7.1). reduce: `@media (prefers-reduced-motion: reduce) { .spinner { animation: none } }`로 회전을 멈추고 정지 호가 남는다(정보 유지, brief §6.6-4).

``ts
type SpinnerProps = { size?: 'sm' | 'md' };   // 16 / 20
``
Spinner는 **장식**이다. `role`·`label`이 없고 뜻은 옆 글자(`resolve.loading` "영상 정보를 불러오는 중")나 Button `loading`의 `aria-busy`가 전한다(`A-PRIM-SP1`: 글자 없는 `role=status`는 읽히지 않는다). 같은 사건에 스피너를 둘 두지 않는다(버튼 `loading` 안의 스피너가 있으면 옆 줄에는 글자만, `patterns.md` §14.2). 띄우는 시점은 `LOADER_DELAY_MS`·`LOADER_MIN_MS`(foundations §14, `patterns.md` §2.2)이고 컴포넌트는 모른다. 강제: `design-lint` DS1(Spinner에 `role`·`aria-label` 속성 0개), 리뷰 `R1`(Spinner 옆에 글자가 있는지), `frontend`(지연 훅 가짜 타이머).
### 2.22 Skeleton

**해부**: 결과와 같은 자리를 차지하는 회색 막대. **반짝임 없음**(정지 기본 P5, WCAG 2.2.2 자동 갱신 5초 예외 없음 `E-KO-24`). 면 `--surface-2`, `aria-hidden`.

``ts
type SkeletonProps = { variant: 'line' | 'title' | 'control' | 'row'; width?: 'full' | 'half' };
``

| variant | 높이 | 반경 |
|---|---|---|
| `line` | `--leading-body 16 | `--radius-badge` |
| `title` | `--leading-title 20 | `--radius-badge` |
| `control` | `--control-h` 28 | `--radius-control` |
| `row` | `--row-h` 36 | `--radius-control` |

폭은 `100%`/`50%`(lint 허용 비율 둘). 숫자 높이·문자열 폭 prop(SK1)은 없다. 컨테이너에 `aria-busy="true"`. 로딩 규칙(첫 로드 스켈레톤·동작 대기 Spinner·배너 진행은 글, 1초 미만 표시 없음)은 `patterns.md`.

### 2.23 Kbd

**해부**: `<kbd>` `min-height: var(--badge-h)` 18, 패딩 `0 var(--space-4)`, `--text-caption`/`--leading-caption`(12, 11px 결함 K1 해소) 400, 면 `--surface-2`, 글자 `--fg-muted, 반경 `--radius-badge`, `--font-sans`(⌘·↩ 기호). 채움 버튼 안에서는 면 투명 + 1px `--on-accent` 테두리 + `--on-accent` 글자. 버튼 안 힌트는 `aria-hidden`(Button이 감싼다), 도움말 본문의 Kbd는 그대로 읽힌다. 표기(⌘/Ctrl)는 `platform.md`.

### 2.24 Icon

**해부**: `<svg viewBox="0 0 24 24" aria-hidden="true">` + 벤더링 path(`icons.ts`, `{ set: 'lucide', name, version }`). `fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round`, 모든 path에 `vector-effect: non-scaling-stroke 속성, 굵기는 `ui.css`의 `.icon path { stroke-width: var(--icon-stroke) }`(화면 1.5px 고정 [잠정], foundations §9. SVG 속성 `stroke-width` 리터럴은 앱·Worker 모두 쓰지 않는다 — Worker `icon()`도 같은 CSS를 쓴다, `web.md` §4).

``ts
type IconProps = { name: IconName; size?: 'sm' | 'md' };   // 16 / 20. 32·12 없음
``
Icon은 늘 장식이다. `label` prop이 없고 뜻은 인접 글자가 전한다(상태 줄 "⊗ 저장 공간이 부족해요"). 은유는 `foundations.md §9.1` 표만 쓴다(같은 아이콘 ≠ 다른 동작). 광학 보정은 에셋 좌표 안이고 CSS `translate`는 금지. 강제: `design-icons` DI1~DI7(메타·허용 모양·`currentColor`·stroke CSS 고정·은유 유일성·앱·Worker 원천 동일), `design-gallery`(DPR1 번짐 측정), `design-lint` DS5(`<svg` 직접 사용 0개, `.svelte` 안은 `<Icon>`만).

### 2.25 AppMark(앱 마크 자리)

툴바 왼쪽 `[마크 20×20][이름 "치지직 다운로더" 13/600]`의 마크 자리다. D33 결과물이 나오기 전까지 `AppMark`는 **빈 요소를 그리지 않고 없다**(이름만, README D26·사용자 결정 2). 나오면 `<svg aria-hidden="true" class="mark">` 20×20, 색은 자기 색(플레이트 `--accent` 하나), 이름과 gap `--space-8`. 마크의 모티프(아래 화살표)는 UI 아이콘으로 쓰지 않는다(`foundations.md §9.1`, `A-VIS-23`). Worker 헤더도 같은 자리에 같은 마크 + 이름 + 배지 "비공식 도구"(Badge 모양, 반경 4, `web.md` §3.1). 강제: `design-icons`(`mark.ts` 하나, 앱·Worker 동일 해시), `R2`.

### 2.26 FieldRow

**해부**: 영상 카드의 "라벨 · 값/컨트롤 · 동작" 행. `[라벨 열 --label-w] [값 또는 컨트롤 1fr] [동작]?`의 grid. SettingsRow(§2.17)와 다른 점은 라벨이 고정 폭 **왼쪽 열**이라는 것뿐이고 색 규칙은 같다(라벨 `--fg` body, 값 `--fg-muted body, 도움말 caption `--fg-muted).

``ts
type FieldRowProps = { label: string; help?: string; value?: string; control?: Snippet<[{ labelId: string; helpId?: string }]>; actions?: Snippet; };
``

**치수**: 라벨 열 `--label-w` 80, 라벨↔컨트롤 `--gap-label` 6, 행 사이 `--space-12`, 동작은 오른쪽 끝(`--gap-sibling`, 끝자리 유령 버튼은 `.edge-end`). 컨트롤·라디오 행의 면은 값 열 x에서 시작한다(`patterns.md` §6.2). 좁은 레이아웃(`layout.css`의 두 블록, foundations §8)에서는 1열: 라벨이 컨트롤 위로. 근거: `A-FEAT-E2`(화면마다 반대였던 색 역할), `E-APPLE-11`(label 1차 잉크, 값 secondary). 강제: `frontend`(FieldRow 하나만 사용, 라벨·값 색 클래스), `design-gallery`(x-large·320 폭에서 1열).

Worker: 없다(폼 라벨은 위, `web.md` §7.1).

### 2.27 DropOverlay

**해부**: `--z-drop` 층의 창 전체 요소. 면은 투명(반투명 덮개 없음, `A-FEAT-S4`), 창 안쪽 `--edge` 자리에 `2px dashed var(--accent-ink)` 테두리, 가운데 라벨(`--raised` + `--shadow-toast`, 패딩 `var(--space-12) var(--space-20)`, `download` 20 + body 13 600 `drop.hint`). 드래그 중 `text/uri-list`·`text/plain`이 있을 때만 뜨고 `drop`·`dragleave`에서 사라진다(`platform.md` §17.3). forced-colors: `2px dashed CanvasText`. 전환 없음. 강제: `design-lint`(오버레이에 `backdrop-filter`·`color-mix(… transparent)` 금지), `design-gallery`, `e2e-web`(`DataTransfer` 합성).

### 2.28 Toolbar

**해부**: 네이티브 타이틀바 아래 `--toolbar-h` 44 띠(`--bg`, 아래 1px `--separator`). 스크롤 영역 `.main` **밖**이라 층이 없다. 안쪽은 PageContainer와 같은 `.col`이라 왼쪽 글자 x·오른쪽 아이콘 상자 x가 열 안쪽 x와 같다(README D24). 왼쪽: `AppMark`? + 앱 이름(body 13 600 `--fg`) 또는 설정 화면의 [←](IconButton md, `.edge-start`) + 화면 제목(display 17 600, [←]와 `--gap-sibling`). 오른쪽: 계정 Menu(`trigger="text"`: `‘{channelName}’` ▾, 글자 `--fg`) + [⚙](IconButton md `settings`, `.edge-end`; 설정 화면에서는 `aria-current="page"`로 남아 자리가 흔들리지 않는다, `A-FEAT-A3`·`A6`). 로그인 화면에서는 오른쪽이 비어 있다. 강제: `frontend`(화면별 구성 표), `design-gallery`(툴바 첫·끝 요소 상자 x = 열 안쪽 x ± 2px).

---

## 3. forced-colors · 대비 증가 · 움직임 줄이기 종합표

`foundations.md §2.7`의 매핑을 컴포넌트별로 내린 것이다. 표에 없는 컴포넌트를 더하면 §2.7과 이 표에 행을 더한다(`R9`). 강제: `design-gallery`(`forcedColors: 'active'`·`prefers-contrast: more`·`reduce` 에뮬레이션 axe + 스냅).

| 컴포넌트 | forced-colors | contrast: more | reduce |
|---|---|---|---|
| Button primary | 면 `Highlight`, 글자 `HighlightText`, 1px `CanvasText` 테두리 | 토큰이 처리 | 눌림 전환 유지 |
| Button secondary·ghost, IconButton, Select, TextField, SecretField | `1px solid CanvasText`, 글자 `ButtonText`/`CanvasText`, 비활성 `GrayText`. IconButton도 테두리가 있다(옆 버튼과 같은 모양) | `--border-strong`→`--fg` | — |
| Switch | 켜짐 트랙 `Highlight` + 손잡이 `Canvas`, 꺼짐 트랙 `Canvas` + 1px `CanvasText` + 손잡이 `CanvasText` | — | 손잡이 이동 `--motion-fast` 유지(피드백) |
| RadioGroup | 선택 행 `outline: 1px solid Highlight`, 점 `CanvasText` 테두리, 선택 점 `CanvasText` | `--separator`→`--fg` | — |
| Disclosure·Menu·Dialog·Toast·Surface | 그룹·행 `1px solid CanvasText`, 떠 있는 것(`Menu`·`Dialog`·`Toast`) `2px solid CanvasText`(그림자는 사라진다) | — | 등장·퇴장 1ms(토큰) |
| Notice | `1px solid CanvasText`, 아이콘 `currentColor` = `CanvasText`. 톤은 아이콘 모양(ⓘ·⚠·⊗)이 전한다 | 면 유지, 글자 `--fg` | — |
| ProgressBar | 트랙 `1px solid CanvasText`, 채움 `Highlight`, `paused` 채움 `GrayText` + 오른쪽 `2px solid CanvasText` [잠정], `failed` 채움 `CanvasText`(+ 행의 ⊗), `waiting`·null 줄무늬는 `1px dashed CanvasText` 테두리로 대체(gradient none) | `1px solid var(--fg)` 테두리 | `--progress-tween` 1ms |
| Badge·Kbd·FieldRow 라벨 | `1px solid CanvasText`(배지·kbd), 라벨은 `CanvasText` | — | — |
| Spinner·Icon·DropOverlay | `currentColor`, 오버레이 `2px dashed CanvasText` | — | Spinner `animation: none`, 호 유지 |
| Skeleton·Toolbar | `1px solid GrayText`(비활성 자리표시), 툴바 아래 `1px solid CanvasText` | — | 애니메이션이 없다 |
| 포커스 링 | UA가 outline을 시스템 색으로 그린다 | — | — |

---

## 4. Worker 클래스 표

한 `ui.css`의 클래스를 서버 렌더 마크업에 그대로 쓴다. JS·인라인 style 없음(`worker` gate: CSP, 인라인 `style` 0개, `<style>` 0개).

| 컴포넌트 | 마크업 |
|---|---|
| Button | `<a class="btn btn-primary btn-lg">` `<button class="btn">` `<button class="btn btn-secondary tone-danger">` |
| TextField | `<input class="field">` + `<label for>`; 오류는 `aria-invalid` + `aria-describedby` → `.notice.notice-row.tone-danger` |
| Select | `<span class="select-wrap"><select class="select">…</select></span>` |
| RadioGroup | `<fieldset class="radiogroup"><label class="choice"><input type="radio" class="sr-only">…` |
| Disclosure | `<details class="disclosure"><summary>…</summary>…</details>` |
| Notice | `<div class="notice notice-inline tone-info" role="status">`, banner는 `<section aria-labelledby>` 안. 진행 표시(ProgressBar)는 없다 |
| EmptyState | `.empty.empty-panel` |
| Surface·SettingsRow | `.surface.surface-group > .row` |
| PageContainer | `.col`, 읽기 페이지 `.col.col-reading` + `html[data-scale="reading"]` |
| Badge·Kbd·Icon·AppMark | `.badge`, `<kbd class="kbd">`, `icon(name)`이 만드는 `<svg class="icon icon-md">`(path마다 `vector-effect`, 굵기는 CSS. 스프라이트·인라인 `style` 금지, `J-F-A3`), `.mark` |

---

## 5. 감사 결함 대조표

코드는 `docs/research/design-system.md` §4의 `A-PRIM-<코드>`·`A-FEAT-<코드>`다(§4에 없는 코드는 적용 PR이 코드에서 찾는다, 그 문서 §8.4). "해소"는 이 명세가 닫는 것, "→ 문서"는 다른 문서가 닫는 것, "보류"는 근거 부족으로 남긴 것.

### 5.1 audit-primitives

| ID | 결함 | 처리 |
|---|---|---|
| §1 rest 통과 | Select·Switch·SecretField가 HTML 속성을 못 받음 | 해소 §1(`...rest` 루트 통과 전 컴포넌트) |
| §1 테스트 6/20 | 단위 테스트 부족 | → `governance.md`(`frontend` 컴포넌트별 테스트 목록) |
| N1 variant/tone/kind 혼재 | | 해소 §1 |
| N2 info/accent 이름 혼재 | | 해소 §1(tone 넷, `accent`는 토큰 이름일 뿐) |
| N3 tone 집합 상이·Badge 종류+상태 | | 해소 §1·§2.12·§2.19(`kind`) |
| N4 size 기본값 반대·숫자/문자 | | 해소 §1.2(기본 `md`, 변환표 하나) |
| N5 크기 축 없음·Skeleton 숫자 | | 해소 §2.22 |
| N6 `ondismiss` | | 해소 §1(`onclose`) |
| N7 value/checked/selected/open·ProgressBar 단위 | | 해소 §1(`value` 통일, 0~100) |
| N8 onchange 시그니처 | | 해소 §1(`onchange(value)`) |
| N9 label/labelledby/title | | 해소 §1(`NameProps`) |
| N10 이름 미강제 | P0 | 해소 §1(타입) |
| N11 bindable 이중 채널 | | 해소 §1(`value` bindable + `onchange` 알림 하나씩, 의미 분리) |
| N12 라벨 키 | | 해소 §1(`id` 필수) |
| N13 `autofocus` 이름 충돌 | | 해소 §2.10(`primary`가 포커스, prop 없음) |
| N14 id 생성기 셋 | | 해소 §1(`$props.id()`) |
| N15 `el` | | 해소 §1 |
| B1 link+sm 특이도 | P0 | 해소 §2.1(`link` 폐지, ghost는 size별 명세) |
| B2 link 높이 가변 | | 해소 §2.1(ghost도 고정 높이) |
| B3 active secondary만 | | 해소 §0.3 |
| B4 loading 없음 | | 해소 §2.1 |
| B5 aria-disabled 차단 호출부 | | 해소 §2.1 |
| B6 간격 리터럴 | | 해소 §1.2·§2.1(토큰) |
| B7 굵기 500 | | 해소 §2.1(400, lg만 600) |
| B8 아이콘만 Button | | 해소 §2.1(타입 오류) |
| B9 kbd margin 꼼수 | | 해소 §2.1(`.btn-label` gap 8) |
| T1 invalid가 hover에 덮임 | P0 | 해소 §0.3·§2.3(입력칸 hover 없음) |
| T2 invalid 색만 | | 해소 §0.3(describedby 필수) |
| T3 readonly = disabled 모양 | | 해소 §0.3 |
| T4 포커스 규칙 중복·`:focus` 테두리 | | 해소 §0.3(전역 한 줄) |
| T5 라벨·도움말·오류 묶음 없음 | | → `patterns.md`(폼 행) + §2.17 |
| T6 mono가 글자 크기 변경 | | 해소 §2.3(`mono` 없음, SecretField만 mono) |
| T7 value 기본값 | | 해소 §2.3(`value` 필수 string) |
| T8 placeholder 색 | | 해소 §2.3(`--fg-muted 4.5:1, 라벨은 별도 요소 HIG `E-APPLE-27`) |
| S1~S7 Select | | 해소 §2.5 |
| SF1 토글 이중 상태 | P0 | 해소 §2.4 |
| SF2 높이 어긋남 | | 해소 §2.4 |
| SF3 label→aria-label만 | | 해소 §1(`NameProps`) |
| SF4 비활성에서 토글 | | 해소 §2.4 |
| I1~I4 IconButton | | 해소 §2.2(I3 크기 근거: §1.2) |
| SW1 disabled+checked | P0 | 해소 §2.6 |
| SW2~SW6 | | 해소 §2.6·§1 |
| R1 disabled 없음 | | 해소 §2.7 |
| R2 네이티브 아님·대화형 자손 | | 해소 §2.7 |
| R3 포커스·선택 겹침 | | 해소 §2.7(outline은 행, 그룹 테두리 없음) |
| R4 selected 인덱스 | | 해소 §1 |
| R5·R6·R7 | | 해소 §2.7(R7 방향키 즉시 선택은 네이티브 관례로 명시) |
| BG1~BG3 | | 해소 §2.19 |
| A1~A10 알림 | | 해소 §2.12·§2.13(A10 폭: 토스트는 열 폭, 대화상자 `--dialog-w, 메뉴 내용 폭) |
| D1 inert·트랩 | | 해소 §2.10(`inert`) + `focus.ts` 선택자 보강 → `governance.md` 테스트 |
| D2 describedby 항상 | | 해소 §2.10 |
| D3 패딩 비대칭 | | 해소 §2.10(20 균일) |
| D4 h2 고정 | | 유지(대화상자는 늘 h1 아래, `patterns.md` 헤딩 구조) |
| D5 버튼 순서 | | 해소 §2.10(`[secondary][primary]`, danger는 왼쪽 끝) |
| D6 outline:none 복붙 | | 해소 §0.3(`[tabindex="-1"]` 한 줄) |
| M1~M6 Menu | | 해소 §2.9 |
| DS1 애니메이션 명세 불일치 | | 해소 §2.8(전환 없음으로 명세 수정) |
| DS2~DS5 | | 해소 §2.8 |
| P1~P6 ProgressBar | | 해소 §2.20(P2 striped→`state`, P3 reduce display:none 폐기, P4 애니메이션 없음·`--progress-tween`) |
| SP1·SP2 | | 해소 §2.21 |
| SK1·SK2 | | 해소 §2.22(반짝임 폐기) |
| K1·K2 | | 해소 §2.23 |
| IC1·IC2 | | 해소 §2.24(`focusable="false"`는 두지 않는다) |
| F1 forced-colors 링 소멸 | P0 | 해소 §0.3 |
| F2~F7 | | 해소 §0.3 |
| X1~X14 | | X1·X2·X3·X4·X5·X6·X7·X8·X9·X10·X11·X12 해소(각 절). X13 보류(HIG 스위치 글자 없음, D62에서 켜짐 식별 관찰). X14 해소 §3 |

### 5.2 audit-features

| ID | 결함 | 처리 |
|---|---|---|
| A1~A7 정렬선·헤더 | | 해소 §2.18·§2.28(열 하나, 툴바 `.col`, [⚙] 자리 유지). A2 특이도 버그는 폭 쿼리 금지로 구조 소멸 |
| B1~B5 수직 리듬·광학 보정 | | → `patterns.md`(부모 `gap` 소유). B5 보정 꼼수는 §2.1 ghost 패딩 6·§2.2 정사각으로 규칙화 |
| 1-3 폭 상수 | | 해소 §2.18(열 둘 + `--dialog-w)·§2.26(`--label-w`) |
| C1 InlineAlert info 미사용·ConflictNotice 직접 구현 | | 해소 §2.12 |
| C2 warn에 role=alert | P0 | 해소 §2.12 |
| C3 톤 기준 | | 해소 §2.12 |
| C4 한 문장을 600 제목으로 | | 해소 §2.12 |
| C5 오류 3단 6곳 복사 | | 해소 §2.14 |
| C6·C7 동작 버튼 위치·종류 4종 | | 해소 §2.12 |
| C8 info 아이콘 색 | | 해소 §2.12 |
| C9 성공 글자색만 | | 해소 §2.12(`neutral` + `circle-check` + 글자) |
| C10 Banner warning 없음 | | 해소 §2.12 |
| C11 토스트 대상 표 없음 | | → `patterns.md`(알림 위계 표) |
| D1 테두리+면 8곳 | | 해소 §2.16 |
| D2 EmptyState 없음 | | 해소 §2.15 |
| D3 `:global` 공급 | | 해소 §0.2·§2.17 |
| D4 설정 행 3번 복사 | | 해소 §2.17 |
| D5 Disclosure 제목 요소 없음·8px 어긋남 | | 해소 §2.8(summary 안 h2, 패딩 12 = 행과 같음) |
| D6 라디오 두 종류 | | 해소 §2.7(ConflictNotice 선택지도 RadioGroup) |
| D7 라벨 요소 혼용 | | 해소 §2.17(`labelId`) |
| D8 suffix 입력 | | → `patterns.md`(파일 이름 행) |
| D9·D10 하드코딩 크기·Spinner 크기 기준 | | 해소 §1.2·§2.21 |
| D11 primary 둘 | | 해소 §2.1 |
| D12 아이콘 유무 혼재 | | → `patterns.md`(행 버튼 표, 은유 표는 foundations §9.1) |
| E1~E9 글자 위계 | | E2·E5 해소 §2.17·§2.15. 나머지 → `foundations.md §3.2`(척도)·`patterns.md` |
| F1 로딩 5종 | | → `patterns.md`(§2.21·§2.22가 수단을 준다) |
| F2 설정 가짜 기본값 | | → `patterns.md`(Skeleton `control`) |
| F3 빈 상태 규칙 | | 해소 §2.15 |
| F4 빈 상태 높이 | | → `patterns.md` |
| F5 오류 위치 | | 해소 §2.14 규칙 + `R7` |
| F6 오류 동작 유무 | | → `content.md`(errorCopy actions) |
| F7 비활성 표현 혼재 | | 해소 §0.3 |
| G1 `drop` 과적 | | 해소 §2.25 + foundations §9.1 |
| G2 알림 아이콘 16/20 | | 해소 §2.12(variant가 정한다) |
| G3 아이콘 색 역할 | | 해소 §2.12 |
| G4 상태 아이콘 일부만 | | → `patterns.md`(행 상태 어휘, 아이콘 슬롯 고정) |
| G5 크기 규칙표 | | 해소 §1.2 |
| G6 `x` 겸용 | | 해소 §2.2 |
| G7 계정 메뉴 아이콘 | | 해소 §2.9(`trigger="text"`)·§2.28 |
| R1~R9 반응 | | → `patterns.md`·`foundations.md §8`(분기 600 하나). R4·R5 해소 §2.17·§2.12(wrap) |
| H1 미정의 토큰 | | → `design-tokens`(미정의 0) |
| H2·H3 리터럴 | | 해소 §0.2(ui.css 리터럴 0) + `patterns.md` |
| H4 keyframes 중복 | | 해소 §2.9·§2.13(모션은 토큰 + 두 전환만, keyframes는 Spinner 하나) |
| S1~S18 명세 차이 | | S3·S4·S5·S6·S7·S8·S12·S15 해소(각 절, S4는 §2.27). S2·S9·S10·S13·S14·S16·S17 → `patterns.md`. S18 범위 밖 |
| §10 1~7 명세 모순 | | 1·5 → `foundations.md §3.2`(라벨 층 = caption 600 그룹 머리). 2 해소(`fg-disabled 비활성 전용). 3 해소 §2.2. 4 해소(2px 반단계 격자, foundations §4). 6 → `patterns.md`. 7 해소 §2.10 |
| J1 버튼 순서 | | 해소 §2.10 |
| J2 취소 계열 라벨 4종 | | → `content.md`(대화상자 라벨 표) |
| J3 파괴 판단 | | 해소 §2.11(되돌릴 수 없는 것만 `destructive`) |

---

## 6. 편집에서 닫은 것(2026-10-10)

초안이 §6·§7에 남긴 충돌·요청은 모두 처리됐다. 남은 [잠정]은 §2.10(네이티브 `<dialog>`)·§2.2(글리프 안쪽 여백)·§3(일시정지 `GrayText`)뿐이고 각각 확인 방법을 같은 줄에 적었다.

| 초안 항목 | 처리 |
|---|---|
| `tone`에 `info` 있음 | README D35가 넷으로 확정 |
| `checked` 미사용, ProgressBar `state` 축 | D35에 반영 |
| `design/ui.css` 파이프라인 | foundations 머리·governance §1 |
| FieldRow 라벨 `--fg` | §2.26 신설, patterns §6.2와 같음 |
| Skeleton 반짝임·Disclosure 전환 폐기 | `ui-visual.md` 삭제로 상대 문장이 없다 |
| `--motion-spin`·`calc()` 정책·forced 행·`<select>` 행간 | foundations §7.1·§4·§2.7·§3.2 |
| 로그아웃 확인 없음(초안 §2.11) | README D36·content §5.3대로 대화상자 있음으로 통일 |
| 유령 버튼 글자 `--accent-ink` | `--fg`로(README D21) |
