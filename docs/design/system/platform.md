# 셸과 OS 통합 (platform.md)

디자인 시스템 「무색」의 앱 셸 규칙이다. 웹뷰가 "웹 페이지"가 아니라 "OS의 일부"로 보이게 하는 것(README P1), 그리고 OS가 **규정하는** 값만 OS별로 분기하는 것(D2)이 이 문서의 두 축이다. 대상은 Tauri 2 + Svelte 5 앱(`app/`)이고, Worker 페이지는 §19·§20의 이름 표기와 아이콘 자산만 공유한다(그 밖의 웹 규칙은 `web.md`).

이 문서가 소유하는 결정: **D2 D7 D25 D26 D27 D28 D29 D30 D33(규격) D34(표기 위치) D38(OS 알림 형식) D40 D47(OS 분기) D55 D56**. 토큰 이름과 수치는 `foundations.md`의 것만 쓴다. 셸(Rust)·JS 타이머가 쓰는 시간·크기 상수는 `foundations.md` §14 표가 이름·값을 소유하고(ADR-0009) 이 문서는 이름만 쓴다. OS 알림 문자열은 `content.md` §14가 소유한다.

읽는 법:
- 규칙마다 **근거**와 **강제** 열이 있다. 강제는 `node scripts/ci/run.mjs <gate>`의 gate 이름(README §4.1) 또는 PR 체크리스트 번호 `R*`(README §4.2)다. 실기에서만 보이는 동작은 자동 gate가 보는 **대리 지표**(설정 값·순수 함수·마커)를 강제로 두고, 사람이 보는 항목은 §21에 따로 모았다. §21은 규칙이 아니라 [잠정] 항목의 확인 방법이다.
- **[잠정]**은 확인되지 않은 값(확인 방법을 같은 줄에 적었다), **[취향]**은 출처 없는 선택이다. 보고서가 refuted로 판정한 값은 쓰지 않았다(v-desk §3, v-apple "쓰지 말 것").
- 근거는 `docs/research/design-system.md`의 ID로 인용한다(README 머리). `g-shell`의 번호는 `G-SHELL-H*`(hard)와 `G-SHELL-NS*`(native-feel)로 나뉜다. ID가 없는 절(g-shell §4.2 등)은 약칭으로 남겼다.
- 예시 값(경로·제목·크기·시각)은 전부 가짜다(`scan`).

---

## 1. 원칙(이 문서 범위)

| # | 원칙 | 근거 | 강제 |
|---|---|---|---|
| S1 | **OS가 그리는 것은 OS에 맡긴다.** 타이틀바·스크롤바·커서·메뉴·알림·진행 표시(Dock·작업 표시줄)는 OS 구성요소를 쓰고 흉내 내지 않는다 | README P1. HIG "커스텀 창 UI 금지"(`E-APPLE-15`), Microsoft "클릭 가능한 요소에도 화살표"(v-desk §2.2), 1Password 8 베타의 "네이티브 메뉴와 웹 메뉴가 섞이면 들킨다" 불만(g-shell §3.3) | `tauri`, `design-lint` |
| S2 | **웹 흔적은 끈다.** 컨텍스트 메뉴·새로고침·찾기·인쇄·줌·글자 끌기 선택·손가락 커서는 릴리스 빌드에서 동작하지 않는다. 단 **입력칸의 편집 기능은 어떤 경우에도 끄지 않는다** | g-shell §1-2·3. 비기술자의 "우클릭 붙여넣기"가 가장 가까운 편집 수단이다(users §1.3 현우·소영) | `e2e-web`, `tauri`, `design-lint` |
| S3 | **OS가 규정하는 값만 분기한다.** 바이트 진법, 메뉴 용어, 단축키 표기, 경로 표기, "Finder에서 보기" 라벨, 테마 선택 행, 스크롤바 스타일. 버튼 순서·크기·색은 분기하지 않는다 | D2. 분기는 `naming::Platform`처럼 인자로 받아 한 호스트에서 세 OS를 테스트한다(CLAUDE.md "OS별 분기") | `design-copy`(OS 문자열은 §20 표에만, `R3`), `rust`·`frontend` 골든 |
| S4 | **셸은 사용자가 보는 문자열의 원천이 아니다.** 알림·메뉴·사유 문자열도 copy deck(`app/src/lib/copy/ko.ts`와 Rust의 같은 문구)에서 온다. OS에만 보이는 문자열(메뉴, 전원 사유, 알림)은 §20 표가 유일한 위치다 | README R3, a-copy(문구 두 곳 불일치) | `design-copy`, `rust`(문구 일치 테스트) |
| S5 | **보조 신호는 겹겹이, 유일한 경로는 없다.** OS 알림·Dock 진행·주의 요청은 목록 상태를 보조한다. 어느 하나가 OS에서 뜨지 않아도(서명 없는 macOS 알림, Linux libunity 없음) 사용자가 상태를 놓치지 않는다 | `G-SHELL-NS25`, D38 "서명 없는 macOS에서 알림이 뜨는지 [미확인]" | `frontend`(행 상태가 1차), `tauri` |

---

## 2. 창과 첫 프레임(D30)

### 2.1 창 설정(`app/src-tauri/tauri.conf.json`)

| 항목 | 값 | 근거 | 강제 |
|---|---|---|---|
| `decorations` | 기본(true). 커스텀 타이틀바 없음 | D26 → §3 | `tauri`(`tauri-conf.test.ts`) |
| 크기 | 기본 960×700, `minWidth` 720 · `minHeight` 520(논리 px, 변경 없음) | foundations §8. 720에서 본문 열 `--content-max` 800이 꽉 차고 960에서 좌우 80 | `tauri` |
| `visible` | **`false`**. 첫 그림 뒤 Rust가 `show()` | D30. 흰 번쩍임 원인은 웹뷰 기본 배경이 흰색이기 때문(WebKit 215479, Tauri #1564, WebView2 `DefaultBackgroundColor`, g-launch §1.1). HIG launching "전환 때 번쩍임 금지"(g-launch §2.1) | `tauri` |
| `backgroundColor` | 라이트 `#F3F3F3`(= `--bg`), 다크 `#1F1F1F`(= `--bg`). 설정 파일 값은 라이트이고 **Rust `setup`이 `window.theme()`을 읽어 다크면 `set_background_color`로 바꾼 뒤 show** | g-launch §1.4(설정 값은 정적 하나라 테마별로는 런타임 지정). Windows는 alpha 무시(v-desk §2.4) | `tauri`(설정 값 = foundations `--bg` 라이트 hex, Rust 테마 분기 단위 테스트) |
| Linux 앱 안 테마(D7) | 설정에 `theme: light|dark`가 저장돼 있으면 `theme()` 대신 그 값으로 배경을 정한다 | GTK3 다크 감지가 테마 이름 휴리스틱(g-a11y §2.1)이라 `theme()`도 틀릴 수 있다 | `tauri`(분기 테스트) |
| `allowLinkPreview` | **`false`** | `G-SHELL-H12`(macOS 링크 길게 누르기 미리보기, 비용 0) | `tauri` |
| `dragDropEnabled` | `false` 유지 | app.md 구현 중 변경 5, g-ime §5.1(Windows에서 HTML5 DnD에 필수) | `tauri`(기존) |
| `zoomHotkeysEnabled` | **`false` 명시**(기본값과 같지만 적는다) | D28 → §4.5 | `tauri` |
| `scrollBarStyle`(Windows) | `fluentOverlay` | D27 → §5 | `tauri` |
| `bundle.macOS.minimumSystemVersion` | **`13.3`** | D1. Safari 16.4를 OS 기본 WebKit이 보장하는 첫 macOS(g-engine §1.1, v-desk §2.1). 현재 미설정 = Tauri 기본 10.13(결함) | `tauri`, `versions`류 일치 검사(→ §13) |
| `theme` 키 | 쓰지 않는다 | 창 테마 강제가 아니라 OS 추종이 규칙(D7). `backgroundColor`만 런타임으로 맞춘다 | `tauri`(키 없음) |
| devtools | 릴리스에 `devtools` feature 없음(현재 양호) | `G-SHELL-H13` | `tauri`(`Cargo.toml` features) |

### 2.2 첫 프레임 순서(콜드 스타트)

1. 창을 `visible:false`로 만든다. 프로세스 시작 `Instant`를 기록한다.
2. Rust `setup`: 설정·`jobs.json`만 읽는다(원격 호출·업데이트 확인·로그인 확인 없음). 테마를 읽어 창 배경을 `--bg`로 맞춘다.
3. `index.html`: `<meta name="color-scheme" content="light dark">`와 **첫 `<link rel="stylesheet">`(= `tokens.css` + 배경 한 줄)**이 `<head>`에 있어 JS 번들 전에 바탕이 칠해진다. 앱 CSP가 `style-src 'self'`라 인라인 `<style>`은 쓸 수 없다(brief §2.2) → 외부 첫 CSS로 푼다. [잠정] 확인: 3 OS 라이트·다크 6조합의 첫 프레임 캡처(§21 M1).
4. 프런트 mount → 저장된 작업 목록 첫 렌더 → `frontend_ready`(이미 있는 command). 이 신호에서 Rust가 `show()`(+ focus). window-state 플러그인이 복원을 끝낸 뒤다.
5. **안전장치**: `SHOW_DEADLINE_MS`(1500ms [제안], foundations §14) 안에 신호가 없으면 그대로 show한다. 숨긴 창이 영원히 안 뜨는 사고를 막는다.
6. show 뒤: 업데이트 확인·로그인 상태·채널 확인은 비동기. §14 예산을 따른다.

| 규칙 | 근거 | 강제 |
|---|---|---|
| 사용자는 흰 창을 보지 않는다. 창은 첫 화면이 그려진 뒤 나타나고 첫 프레임부터 `--bg`다 | `G-LAUNCH-R1`, 3겹(brief §6.8-9) | `tauri`(`visible:false`·배경값), `frontend`(`index.html`에 `color-scheme` meta와 첫 stylesheet 링크 존재) |
| 안전장치 뒤에는 반드시 창이 뜬다 | `G-LAUNCH-R2` | `tauri`(타임아웃 단위 테스트), `smoke-bin`(신호 억제 변형은 §21 M2) |
| 첫 화면은 저장된 마지막 상태(`jobs.json`)로 그린다. 네트워크·로그인 확인이 첫 그림을 막지 않는다 | `G-LAUNCH-R3`, HIG launching "이전 상태 복원"(v-desk §2.3), `jobs.json` 이미 있음 | `e2e-web`(백엔드 지연 주입 뒤 목록 먼저 렌더) |
| 시작 실패(`App::open` 실패)는 기존 dialog 경로(app.md 구현 중 변경 47 "시작 실패 안내")를 유지한다. 이 문구는 Rust에만 있다 | 웹뷰가 뜨기 전이다 | `tauri`(기존) |

### 2.3 창 상태 복원

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 플러그인 | `tauri-plugin-window-state`(권한 `window-state:default`), 창 위치·크기 복원. `visible:false`와 함께 쓴다 | D30. HIG launching(이전 상태 복원), 플러그인은 창 생성 뒤 복원하므로 숨김 시작이 아니면 깜빡인다(`E-DESK-R40`, §2.4) | `tauri`(플러그인 등록·권한) |
| 복원 범위 | 위치·크기·최대화. 전체 화면 상태는 복원하지 않는다[취향] | 방송 중 실수로 전체 화면이 복원되면 화면 노출 위험(brief §1.4). 출처 없음 → ADR-0009 | `tauri`(플래그 테스트) |
| 화면 밖 복원 | 플러그인 기본 동작(보이는 화면 안으로)을 믿는다 [잠정]. 확인: 외장 모니터를 뺀 뒤 실행(§21 M3) | — | — |
| 두 번째 실행 | single-instance가 기존 창 show + unminimize + focus(현행) | app.md §11 | `tauri`(기존) |

---

## 3. 타이틀바·툴바·창 제목(D26)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 타이틀바 | **네이티브.** `titleBarStyle`·`hiddenTitle`·`data-tauri-drag-region`을 쓰지 않는다 | HIG "커스텀 창 UI 금지"(`E-APPLE-15`), 커스텀 타이틀바는 macOS 창 동작 일부를 잃는다(Tauri 문서, `G-SHELL-H10`), Windows Snap Layout 보존(v-desk §2.2 타이틀바 규칙). desktop 보고서의 Overlay 권고는 judgment §2.4가 A(네이티브)로 판정 | `tauri`(키 없음), `design-lint`(`data-tauri-drag-region` 0개) |
| 창 제목 | `치지직 다운로더`. 부제·"비공식"·버전을 붙이지 않는다. 작업 수·퍼센트를 제목에 넣지 않는다 | g-id §2(창 제목은 짧게, 고지는 정보 화면), 제목 진행 표시는 브라우저 탭 관습이고 OS에는 Dock·작업 표시줄이 있다(§8) | `tauri`(`title` 고정) |
| 툴바 | `components.md` §2.28 Toolbar: 높이 `--toolbar-h`(44px [취향], ADR-0009), 스크롤 영역 밖. 왼쪽 [마크(`--icon-md` 20) + "치지직 다운로더"(`--text-body` 13px, `--weight-strong` 600)], 오른쪽 [계정 ▾]·[설정]. 마크는 D33 결과물이 나오기 전까지 **이름만**. 설정 화면에서도 [설정] 자리를 비우지 않는다(`aria-current="page"`) | 사용자 결정 2(README §3-5). 이름을 그리는 이유: Linux 일부 창 관리자·전체 화면에서 타이틀바가 숨으면 앱 이름이 어디에도 없다(`J-Q2`). HIG 툴바 "앱 이름 금지"(`E-APPLE-25`)는 **창 제목이 있는 전제**라 Linux 사례에는 맞지 않는다고 판단했다 → README P1 예외로 ADR-0001 §결정에 기록, D62 과업 V5 | `frontend`(툴바 이름 렌더·화면별 구성), `design-gallery` |
| 툴바 안쪽 정렬 | 본문 열(`--content-max`)과 같은 기준선 | foundations §8 "열 기준" | `R1` |
| 비활성 창 | macOS에서 창이 비활성이면 `html[data-window-active="false"]`. 토큰 재정의는 foundations §10 한 줄뿐(`--accent-soft` → `--surface-2`, selector `:root:where(…)`) | HIG 비활성 창 선택 회색(`E-APPLE-13`) | `frontend`(속성 토글), `tauri`(Focused 이벤트 → 속성) |
| 창 그림자·투명·vibrancy | 쓰지 않는다. `transparent`·`windowEffects`·window-vibrancy 금지 | `transparent`는 macOS private API, vibrancy는 Linux 미지원(v-desk §2.4), 콘텐츠 층에 Liquid Glass 금지(`E-APPLE-15`) | `tauri`(키 없음), `deny`/`machete`(크레이트 없음) |

---

## 4. 웹 흔적 지우기

### 4.1 커서(D25)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 컨트롤 | `button, [role=button], summary, label[for], select, [role=switch], [role=radio], [role=menuitem], [role=tab] { cursor: default }`를 `app.css` **한 곳**에 둔다. 컴포넌트는 `cursor`를 선언하지 않는다 | HIG pointing-devices: 화살표 = 인터페이스 요소 표준, 손가락 = URL 링크(`E-DESK-N07`, §2.3). Microsoft: 클릭 가능한 요소에 항상 화살표, 손가락 금지, 커서를 호버 피드백으로 쓰지 않는다(v-desk §2.2). Raycast 선례(v-desk §2.6). 현재 8개 컴포넌트가 `cursor: pointer`(g-shell §2, G3) | `design-lint`(앱 CSS `cursor: pointer` 금지, 컴포넌트 `cursor` 선언 금지) |
| 비활성 | `default`. `not-allowed`를 쓰지 않는다 | HIG의 "허용 안 됨" 포인터는 끌어놓기 전용(`G-SHELL-H5`) | `design-lint`(`not-allowed` 0개) |
| 글자 | 입력칸·`.selectable`만 `text` | HIG I빔 = 텍스트 선택·삽입 | `design-lint` |
| 진짜 URL | 외부 주소로 이동하는 요소만 `pointer`. v1 앱 화면에는 그런 요소가 없다(외부 열기는 버튼 + Rust 고정 주소 표, brief §6.14-8) | HIG 손가락 = URL 링크 | `design-lint`(허용 목록 비어 있음) |
| Worker | 웹 관습대로 링크·버튼 `pointer` | 랜딩은 브라우저 안이다(D25) | `web.md` 소관 |

### 4.2 글자 선택(`user-select`)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 기본 | `body { user-select: none; -webkit-user-select: none }`(현행 유지). `-webkit-` 접두 병기 | WebKit은 비접두 `user-select` 미지원(v-desk §2.1, foundations §11) | `design-lint`(`app.css`에 둘 다), `frontend` |
| 선택 가능 | `.selectable { user-select: text; -webkit-user-select: text; cursor: text }`를 **직접** 단다(WebKit은 상속처럼 동작해 부모 `none` 안의 자식에 직접 선언이 필요하다). 대상: 오류 상세 한 줄·오류 코드, 저장 경로·파일명, 입력한 주소, 해시·버전(정보 화면). 확인 코드 화면은 없다(루프백, `patterns.md` §13) | `G-SHELL-H4`(비기술자가 오류 문구·경로를 복사해 붙이는 장면이 가장 흔한 막힘), HIG 레이블 "오류·경로는 복사 가능하게"(g-save F2) | `design-lint`(`user-select` 선언은 `app.css`의 두 규칙만), `frontend`(위 요소에 `.selectable` 존재) |
| 선택 불가 | 버튼·메뉴·탭·헤더·배지·토스트·진행 숫자·**작업 제목**(행 전체가 클릭 대상). 제목은 2줄까지 보이고 [⋯] › "제목 전체 보기"로 펼친다(`patterns.md` §14.3). 복사는 [주소 복사] | `G-SHELL-H4` 표 | `frontend` |
| 보안 | `none`은 보안 수단이 아니다(`Selection`에 포함될 수 있다, MDN). 비밀은 화면에 내지 않는다 | `G-SHELL-H4` | `rust`(비밀 누출 테스트, 기존) |

### 4.3 컨텍스트 메뉴

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 기본 | `window`의 `contextmenu` **캡처** 리스너가 `preventDefault()`. 예외 selector: `input, textarea, [contenteditable]:not([contenteditable="false"]), [data-native-menu]`. 터치 길게 누르기·펜 배럴 버튼도 같은 이벤트로 온다 | `G-SHELL-H1`·`G-SHELL-NS1`, `G-INPUT-IN8`. 웹뷰 기본 메뉴에는 새로고침·뒤로·검사가 섞인다(wry 기본 true, g-shell §3.2). 입력칸은 남긴다: 우클릭·길게 누르기 붙여넣기가 비기술자의 경로 | `e2e-web`(`body` contextmenu `defaultPrevented === true`, `input`은 `false`) |
| Windows | `SetAreDefaultContextMenusEnabled(false)`를 **쓰지 않는다**(입력칸 메뉴까지 지운다). JS만 | `G-SHELL-H1` | `tauri`(해당 호출 없음 grep) |
| `[data-native-menu]` | 오류 상세·경로·해시 같은 `.selectable` 요소에 함께 단다(터치 길게 누르기로 복사할 수 있게) [잠정] 확인: Windows 터치에서 길게 누르기 메뉴가 열리는지(§21 M6) | g-input §6.2 | `frontend`(`.selectable`과 `[data-native-menu]` 동시 존재) |
| 앱 자체 컨텍스트 메뉴 | 만들지 않는다. 행 동작은 보이는 버튼과 [⋯] 메뉴다. 컨텍스트 메뉴는 어떤 기능의 유일한 경로도 될 수 없다 | HIG Dock 메뉴 취지 "다른 곳에도 있어야 한다"(`G-SHELL-H1`), `G-INPUT-IN1` | `design-lint`(`contextmenu` 리스너는 `guards.ts` 하나) |
| macOS 실제 차단 | WKWebView 본문에서 `preventDefault`가 메뉴를 막는지 [잠정] 확인: §21 M4. 막지 못하면 `NSView.willOpenMenu` 서브클래싱(후속, ADR) | g-shell §9.2-1 | — |

### 4.4 브라우저 단축키

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 막는 키(Windows·Linux) | `F5`, `Ctrl+R`, `Ctrl+Shift+R`, `Ctrl+F`, `F3`, `Ctrl+P`, `F12`, `Ctrl+Shift+I/C/J`, `Ctrl+U`, `Alt+←/→`. **편집 대상 안에서는 `Alt+←/→`·`Ctrl+F/P/U`를 막지 않는다** | `G-SHELL-H2` 표. WebView2 `AreBrowserAcceleratorKeysEnabled` 기본 TRUE라 지금은 F5 한 번에 화면이 초기화된다(v-desk §2.2) | `e2e-web`(키마다 `defaultPrevented`, 입력칸 안 음성 검사) |
| 막는 키(macOS) | `Cmd+R`, `Cmd+Shift+R`, `Cmd+P`, `Cmd+F`, `Cmd+[`, `Cmd+]`, `Cmd+Option+I/J/U`(방어용, 메뉴 항목이 없어 동작도 없다). **`Alt`·`Ctrl` 조합은 절대 막지 않는다**(Cocoa 텍스트 편집·커서 키) | `G-SHELL-H2` | `e2e-web`(`altKey+ArrowLeft`, `ctrlKey+f/p`가 입력칸에서 `defaultPrevented === false`) |
| 늘 통과 | `Cmd/Ctrl+C·V·X·A·Z·Shift+Z`, Tab·Shift+Tab, Esc, Home/End/PageUp/PageDown, 앱 단축키(`Mod+L`·`Mod+,`·`Mod+Enter`) | WebView2는 편집 키를 설정과 무관하게 처리(v-desk §2.2) | `e2e-web` |
| Windows 보강 | `with_webview`에서 `SetAreBrowserAcceleratorKeysEnabled(false)` + `SetIsGeneralAutofillEnabled(false)`(쿠키 입력칸 자동완성 방지). 한 번의 `with_webview`에 묶는다. Tauri 2.12.1은 이 둘을 설정으로 열지 않는다 | g-shell G1, H9. `IsGeneralAutofillEnabled` 기본 TRUE(v-desk §2.2) | `tauri`(Windows cfg 코드 존재 테스트), 실제 효과는 `e2e-native (windows)`(F5 뒤 상태 유지) |
| 개발 빌드 | `cfg(debug_assertions)`에서는 풀어 둔다 | `G-SHELL-H2` | `tauri` |
| 메뉴 | macOS 보기 메뉴에 "새로고침"을 두지 않는다 | `G-SHELL-H2` | `tauri`(메뉴 항목 텍스트 테스트) |

### 4.5 줌·핀치·스와이프(D28)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 웹뷰 줌 | 끈다. `zoomHotkeysEnabled: false`(Windows `IsZoomControlEnabled`·`IsPinchZoomEnabled` 둘 다 false, macOS·Linux는 폴리필 미주입). `core:webview:allow-set-webview-zoom` 권한을 주지 않는다 | D28. Ctrl+±는 실수로 켜져 레이아웃이 깨진다(`G-SHELL-H3`). 접근성 수단은 §11 글자 크기 설정이 맡는다(WCAG 1.4.4 200%, `E-APPLE-08`). `G-A11Y-OS12`(켬)는 D28에서 기각 | `tauri`(설정·권한 없음) |
| macOS 핀치·스와이프 | `allowsMagnification=false`·`allowsBackForwardNavigationGestures=false` 기본 유지. 핸들러를 달지 않는다 | g-input §7.1 실측, HIG "시스템 제스처 재정의 금지"(g-input §7.2) | `design-lint`(`gesturestart`·`wheel`·`webkitmouseforce*` 리스너 금지, 확장 요청 §22) |
| Windows 정밀 터치패드 핀치 | `wheel`(`ctrlKey`)로 온다. `IsZoomControlEnabled=false`가 막는지 [잠정] 확인: §21 M5. 막히지 않으면 `guards.ts`에 `ctrlKey` wheel `preventDefault`(passive:false) 한 줄 | g-input §6.4 | — |
| Linux 핀치 | GTK가 처리해 막을 수 없다. 허용으로 둔다 | `G-SHELL-H3`(Tauri 공식 해법 없음) | §21 M5 기록 |
| 스와이프 뒤로 | 끔(wry 기본 false). SPA라 이력도 없다 | `G-SHELL-H7`, g-input §7.3 | `tauri` |

### 4.6 끌기·링크·개발자 도구

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| `<img>`·`<a>` | 모두 `draggable="false"`(v1 앱 화면에는 둘 다 0개) | `G-SHELL-H6` | `design-lint`(`<img`·`<a ` 요소에 속성 필수) |
| 드롭 | 창 어디에 떨어뜨려도 웹뷰는 이동하지 않는다(`GlobalShortcuts`의 `dropEffect='none'` 가드 유지). 주소 드롭 규칙은 §17 | `G-SHELL-H6`, `G-IME-R8`·`G-IME-R9` | `e2e-web`(파일 드롭 → 이동 없음) |
| 링크 미리보기 | `allowLinkPreview: false` | §2.1 | `tauri` |
| 개발자 도구 | 릴리스에 없음 | §2.1 | `tauri` |

---

## 5. 스크롤(D27)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 스크롤바 | OS 기본. `::-webkit-scrollbar`·`scrollbar-width: none`·`scrollbar-color`를 쓰지 않는다 | D27. `scrollbar-width`는 Safari 18.2(하한 밖, foundations §11), 스크롤 가능한데 스크롤바가 없으면 접근성 해(MDN, `G-SHELL-H8`) | `design-lint` |
| Windows | `scrollBarStyle: "fluentOverlay"`(WebView2 125.0.2535.41 이상, 낮으면 무시) | `E-DESK-R24`, §2.4 | `tauri` |
| 여백 예약 | `scrollbar-gutter`를 쓰지 않는다(18.2). 상시 표시 스크롤바(Windows 클래식·Linux 일부)가 생겨도 열 좌우 여백(`--edge` 20)이 흡수한다 | D27, foundations §11. `G-SHELL-H8`의 `scrollbar-gutter: stable` 권고는 하한 밖이라 기각(§22 충돌 1) | `design-lint`(`scrollbar-gutter` 0개), `design-gallery`(스크롤바 있음/없음 레이아웃 비교) |
| 스크롤 영역 | `html, body { height: 100%; overflow: hidden }`. 스크롤은 안쪽 `.main` 하나에서만. 툴바는 `.main` 밖(층 없음), 주소 입력줄은 `.main` 안 `position: sticky; top: 0`(`--z-sticky`) | `G-SHELL-H7`(짧은 문서에서도 트랙패드 고무줄이 걸리는 WebKit 버그 215709 계열), `patterns.md` §14.1 | `design-lint`(`app.css` 규칙 존재), `frontend` |
| `overscroll-behavior` | `.main { overscroll-behavior: contain }`(안쪽 탄성 유지 + 전파 차단). `html, body`에 `none`을 **적되 믿지 않는다**: 구조(위 행)가 1차 방어다 [잠정] 확인: §21 M7 | `overscroll-behavior`는 Safari 16에서 partial(스크롤할 내용 없는 컨테이너에 효과 없음, v-desk §2.1·§3 refuted). 1Password 8 베타 "탄성 없음이 거슬린다" 불만(`G-SHELL-H7`) → 안쪽 탄성은 살린다 | `design-lint`(`.main`에 `contain`) |
| 관성·시스템 제스처 | 스크롤·관성·힘 클릭·세 손가락 탭을 JS로 가로채지 않는다. 메뉴는 `pointerdown`으로만 닫는다(관성 스크롤에 닫히지 않게) | g-input §7.2·IN-10, HIG 제스처 원칙 | `design-lint`(위 리스너 금지, 확장 요청 §22) |
| 포커스 가려짐 | `.main { scroll-padding-top: calc(var(--control-h) + var(--space-8)) }`(sticky 입력줄 높이. 툴바는 스크롤 영역 밖). 토스트가 떠 있는 동안 `scroll-padding-bottom`·`padding-bottom`(`components.md` §2.13) | WCAG 2.4.11(brief §6.7-3), `patterns.md` F-7 | `design-gallery`(axe·가려짐 검사) |

---

## 6. 키보드 단축키와 표기

앱 단축키의 **동작**은 app.md §10 표가 소유한다(Mod+L·Mod+V·Enter·Mod+Enter·Esc·Mod+,·목록 키). 이 절은 OS 매핑과 표기 규칙만 정한다.

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| `Mod` | macOS `Cmd`(⌘), Windows·Linux `Ctrl` | app.md §10, HIG 표준 단축키(v-desk §2.3) | `frontend`(플랫폼 인자 골든) |
| 표기(macOS) | 기호만, 더하기 없음: `⌘V` `⌘↩` `⌘,` `⇧⌘Z` `⌃⌘F`. 수식 순서 ⌃ ⌥ ⇧ ⌘ | HIG keyboards 표준 표기(v-desk §2.3 "⌘Q, ⌘W, ⌘M, ⌘H, ⌥⌘H, ⌘,, ⌘Z, ⇧⌘Z, ⌘?, ⌃⌘F") | `frontend`(`formatShortcut` 골든) |
| 표기(Windows·Linux) | 이름 + `+`: `Ctrl+V` `Ctrl+Enter` `Ctrl+,` `Ctrl+Shift+Z` [잠정] 확인: Microsoft 스타일 가이드 원문(이번 조사에서 열람 없음) | Windows 관례(판단). 틀리면 `formatShortcut` 한 곳만 바뀐다 | `frontend` 골든 |
| 위치 | 단축키 표기는 **보조 힌트**다. `<kbd>`(`--text-caption` 12px, `--radius-badge`)로 버튼 라벨 옆이나 힌트 문장 안에 두고 `aria-hidden`으로 감싼다(버튼 이름이 "받기"로 남게) | brief §6.7-7, app.md 구현 중 변경 44(라) | `frontend`(접근 이름 테스트) |
| 힌트 문장 | `url.pasteHint` "{paste}로 붙여넣으면 바로 불러와요"의 `{paste}`를 §20 표의 표기(`⌘V` / `Ctrl+V`)로 채운다. 쿠키 안내의 `{devtools}`도 같다(`⌥⌘I` / `F12`) | judgment §2.2-2, `content.md` §15.1 | `design-copy` DC9(OS 문자열은 분기 객체에만) |
| macOS 메뉴 가속키 | 메뉴에 `⌘,`가 있으면 AppKit이 먼저 소비해 웹뷰 `keydown`이 오지 않는다 → 설정은 `on_menu_event` → 프런트 이벤트 경로. Windows·Linux는 `keydown`. 두 경로가 동시에 오지 않는다 [잠정] 확인: §21 M8 | g-shell §4.3 | `tauri`(IPC: 메뉴 이벤트 → `menu-settings`) |
| IME 중 키 | 모든 창·문서 수준 `keydown`은 첫 줄에서 `isImeKey(e)`를 본다(§17) | `G-IME-R4` | `frontend`, `design-lint`(확장 요청) |

---

## 7. macOS 메뉴 막대

Windows·Linux에는 메뉴 막대를 **두지 않는다**. Tauri는 macOS에서만 기본 메뉴를 붙이고(g-shell §4.5), 복사·붙여넣기는 WebView2가 메뉴 없이 처리하며, 항목 하나짜리 막대는 Windows 앱답지 않다. 메뉴에만 있는 기능은 없다(`G-SHELL-NS15`·`G-SHELL-NS16`).

### 7.1 구조와 한국어 이름

이름은 **Apple 한국어 시스템 문자열**이다(이 Mac의 AppKit `MenuCommands.loctable`·`Menus.loctable`·TextEdit `Edit.loctable`에서 읽음, g-shell §4.2). 앱 본문 copy deck("창"·"잘라내기")과 다르더라도 메뉴 막대만 Apple 용어를 따른다(메뉴는 시스템 UI로 인식된다). muda 기본 문구는 영어라 모든 `PredefinedMenuItem`에 한국어를 넘겨야 한다(muda-0.20.0 `predefined.rs`, g-shell §4.2).

| 메뉴 | 항목(단축키) | 비고 |
|---|---|---|
| 치지직 다운로더 | 치지직 다운로더에 관하여 / — / 설정…(⌘,) / — / 서비스 / — / 치지직 다운로더 가리기(⌘H) / 기타 가리기(⌥⌘H) / 모두 보기 / — / 치지직 다운로더 종료(⌘Q) | About은 첫 항목·구분선으로 단독, 버전 번호 없음(HIG, v-desk §2.3). "설정…"은 말줄임 U+2026(D45). 종료는 보통 `MenuItem`(id `quit`) → `request_quit`(app.md 구현 중 변경 52) |
| 파일 | 윈도우 닫기(⌘W) | HIG: 닫기는 파일 메뉴에(윈도우 메뉴가 아니다) |
| 편집 | 실행 취소(⌘Z) / 실행 복귀(⇧⌘Z) / — / 오려두기(⌘X) / 복사하기(⌘C) / 붙여넣기(⌘V) / 전체 선택(⌘A) | predefined 그대로. WKWebView가 responder chain으로 받는다. **지우지 않는다**(입력칸 밖 `paste` 이벤트가 메뉴 가속키에 의존, `G-IME-R11`) |
| 보기 | 전체 화면 시작 / 전체 화면 종료(⌃⌘F) | 제목 자동 전환 여부 [잠정] 확인: §21 M8. 안 되면 `on_window_event`로 바꾼다. "새로고침" 없음 |
| 윈도우 | 최소화(⌘M) / 확대/축소 / — / 모두 앞으로 가져오기 | "Maximize"·중복 닫기 제거. 창이 하나여도 둔다(HIG) |
| 도움말 | 치지직 다운로더 도움말(랜딩 `/help` 열기) | 최대 3개. 화면 안에도 같은 길이 있는 항목만(설정 › 정보의 도움말 링크). 로그 폴더 열기·정보 복사는 설정 화면에 있으므로 메뉴에 더하지 않는다[취향] |

| 규칙 | 근거 | 강제 |
|---|---|---|
| 메뉴 텍스트에 영어 단어가 남지 않는다("Quit"·"File"·"Toggle Full Screen" 0개). 현재 `lib.rs` 89~165행은 영어 하드코딩(g-shell G2) | `G-SHELL-NS13` | `tauri`(mock 런타임에서 `build_menu` 항목 텍스트 전수: 라틴 단어 0, "새로고침/Reload" 없음, `settings` id 존재) |
| `⌘Q`는 `request_quit`로 D1 가드를 거친다. Dock "종료"·AppleScript·로그아웃은 가드를 지나칠 수 있고 그래도 데이터는 flush + reconcile로 안전하다. **약속은 이 범위로만 쓴다** | tao 0.37.1은 `applicationShouldTerminate:`를 구현하지 않는다(v-desk §2.4, app.md 구현 중 변경 52). objc 런타임 덧붙이기는 후속 ADR | `tauri`(기존 `quit_menu_is_guarded_while_a_job_runs`) |
| 메뉴 항목은 숨기지 않고 비활성으로 둔다 | HIG the-menu-bar(v-desk §2.3) | `tauri` |

---

## 8. Dock·작업 표시줄 진행(D29)

app.md 52행 "작업 표시줄 진행률은 없다"를 바꾸는 결정이다(app.md "구현 중 변경"에 번호를 받는다, §22). 근거: 창을 내려두고 받는 사용자(현우, users §1.3)에게 가장 값싼 진행 신호이고, Transmission 선례(users §4), "OS의 일부라면 OS의 진행 자리를 쓴다"(P1).

### 8.1 플랫폼 사실(v-desk §2.2·§2.4, g-shell §5.1)

| | macOS | Windows | Linux |
|---|---|---|---|
| API | `Window::set_progress_bar` → Dock 타일 `NSProgressIndicator`, 앱 전체 | `ITaskbarList3` `SetProgressState/Value` | libunity `dlopen`, 없으면 효과 없음 |
| 상태 색 | Normal 파랑, Paused 노랑, Error 빨강 | NORMAL / PAUSED(노랑, "재개 가능·오류 아님") / ERROR(빨강) | 색 구분 없음(모두 Normal) |
| 고대비 | — | 진행 정보가 표시되지 않는다(접근성 보호) | — |
| 배지 | `badgeLabel` | 없음(오버레이 아이콘 에셋 필요) | libunity 카운트 |

### 8.2 집계 규칙(순수 함수 `progress_of(&[JobDto], focused, last) -> Option<(Status, u8)>`)

| 상황 | status | progress | 비고 |
|---|---|---|---|
| 받는 작업 없음, 대기 없음 | `None` | — | 매번 명시적으로 지운다(Windows는 값만 보내면 지워지지 않는다) |
| 하나 이상 받는 중, 전체 크기를 안다 | `Normal` | 받은 바이트 합 ÷ 전체 합 × 100, 정수 내림 | **배치**(대기열이 비었다가 채워진 시점부터 다시 비기까지) 안에서 줄지 않는다. 새 작업이 더해져 분모가 커져도 흡수 |
| 받는 중이지만 일부 전체 크기를 모름 | `Normal`(알려진 작업만으로 계산) | 같음 | `Indeterminate`는 macOS·Linux에서 0% 파랑 막대로 보인다 → 쓰지 않는다 |
| 받는 작업 없고 일시정지·중단만 남음 | `Paused` | 마지막 값 유지 | MS 정의와 일치. 연결 대기(§15)는 `running`이므로 `Normal` 유지 |
| 배치 끝, 실패 1개 이상, 창에 포커스 없음 | `Error` | 마지막 값 | 창이 앞으로 오면 `None`(확인 간주) |
| 배치 끝, 모두 성공 | `None` | — | 완료는 알림·주의 요청이 알린다 |
| 받는 중 일부 실패 | `Normal` 유지 | — | 일시적 실패로 전체를 빨갛게 하지 않는다 |

| 규칙 | 근거 | 강제 |
|---|---|---|
| 호출은 정수 퍼센트가 바뀔 때만, 최대 **초당 1회**(`DOCK_PROGRESS_MIN_INTERVAL_MS`, foundations §14 [취향]). 상태 잠금을 쥔 채 부르지 않고 알림 태스크처럼 별도 태스크에서 | tao Windows는 호출마다 `CoCreateInstance(...).unwrap()`(g-shell G13), app.md 교착 경고 | `rust`(집계 단위 테스트: 단조성·우선순위·배치 경계·크기 모름), `tauri`(호출 빈도 테스트) |
| 고대비(Windows)에서 진행이 숨겨지는 것을 앱이 문제 삼지 않는다 | MS 문서 | §21 M13 |
| 배지는 v1에서 끈다 | 세 OS에서 같은 의미를 줄 수 없고 "확인 안 한 완료" 개념이 없다(g-shell §5.3) | `tauri`(`set_badge_*` 호출 0개) |
| macOS Dock 진행 중 아이콘 변형(다크·틴트) 회귀 [잠정] 확인: §21 M9 | tao가 Dock 타일을 `applicationIconImage`로 교체(g-shell G14) | — |

---

## 9. OS 알림(D38)

### 9.1 플랫폼 사실(g-shell §6.1, v-desk §2.4)

- 데스크톱 알림 플러그인은 권한을 묻지 않고 늘 Granted를 돌려준다. 그룹·액션 옵션은 무시된다. 클릭 콜백이 없다(OS 기본 = 앱 활성화). 실패는 조용히 버려진다.
- macOS는 deprecated `NSUserNotification` 경로다. **서명 없는 현재 배포에서 실제로 뜨는지 [미확인]**(README §6-11). Windows는 설치본만 제 이름·아이콘(개발 실행은 PowerShell 이름). Linux는 알림 헤더가 실행 파일 이름 `chzzk-app`이 될 수 있다.

### 9.2 형식

문자열은 `content.md` §14 표(`notify.*`·`power.reason`)가 유일한 원천이다. 이 절은 형식 규칙만 적는다.

| 규칙 | 근거 | 강제 |
|---|---|---|
| 제목은 한 문장, 끝 구두점 없음, 앱 이름 없음(OS가 붙인다. 현재 `sink.rs` 15행 `NOTIFY_TITLE` = 앱 이름, 결함 g-shell G5). 본문은 정리된 영상 제목(`cleanDisplayText` + `clipGraphemes(NOTIFY_TITLE_MAX_GRAPHEMES)`) | HIG: 제목에 앱 이름 금지·끝 구두점 없음·본문은 완전한 문장(`E-DESK-N34`). Windows는 헤더에 앱 이름이 이미 있다(`G-SHELL-NS21`) | `rust`(`format_batch` 속성 테스트: 제목에 "치지직 다운로더" 없음, 본문 ≤ 40자소) |
| 알림은 창에 포커스가 없을 때만. 포커스가 있으면 행 상태(홈) 또는 토스트(다른 화면). 세부는 `patterns.md` §1.1 규칙 1 | HIG "앞에 있을 때는 조용한 갱신"(`E-DESK-N34`), 현행 `should_notify` | `tauri`(기존 테스트) |
| **금지 내용**: 채널 이름·경로·URL·쿠키·토큰·원문 오류 문구·원인 문장. 영상 제목만 허용(사용자가 직접 고른 항목). Linux는 `<>&` 이스케이프 | 방송 중 화면 노출(brief §1.4), `G-UGT-R*`, HIG "민감 정보 금지" | `rust`(본문에 `/`·`\`·`http`·`NID_` 패턴 없음 속성 테스트) |
| 묶음: 첫 완료·실패 이벤트 뒤 `NOTIFY_BATCH_MS`(foundations §14 [취향]) 동안 모아 완료 묶음·실패 묶음 **각각 한 건**. `request_user_attention`도 묶음당 한 번 | 플러그인이 그룹을 무시하므로 앱이 한다(`G-SHELL-NS22`. 보고서의 3초·24자는 근거 없음 `X-DESK-N45`, 값은 ADR-0009) | `rust`(`tokio::time::pause`로 병합 테스트) |
| 소리·시간 민감 수준은 지정하지 않는다 | HIG managing-notifications: 다운로드 완료는 능동 수준 | `tauri`(옵션 없음) |
| 클릭하면 앱 창이 앞으로 온다. 특정 작업으로 이동은 약속하지 않는다 | 플러그인 데스크톱 클릭 콜백 없음 | §21 M11 |
| 알림이 안 떠도 사용자가 상태를 놓치지 않는다(S5). 권한 창이 생기는 경로(`UNUserNotificationCenter`)로 바꾸면 **앱 시작 때가 아니라 처음 [받기]를 누를 때** 요청한다 [잠정] | `G-SHELL-NS25`(Apple 원문 미확보) | `tauri`(요청 시점 테스트, 경로 변경 시) |
| Linux 헤더 `chzzk-app`은 (a) 허용을 기본으로 두고 실측에서 거슬리면 (b) `notify-rust` 직접 의존으로 `appname("치지직 다운로더")` [잠정] 확인: §21 M12 | `G-SHELL-NS23` | — |
| 알림 끄기 설정은 v1에 없다(app.md 확정). 방송 노출 위험이 현실이면 "알림에 영상 제목 표시" 토글을 후속 검토 | `G-SHELL-NS24` | `R10`(D62 관찰 항목) |

---

## 10. 테마·고대비·OS 접근성 설정

### 10.1 테마(D7)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 기본 | OS 추종. `:root { color-scheme: light dark }` + `@media (prefers-color-scheme: dark)`(foundations §10) | HIG "앱별 외관 설정 금지"(`E-APPLE-12`) | `design-tokens` |
| Linux만 선택 | 설정 › 보기 › 모양(시스템/밝게/어둡게) → `:root[data-theme]`. macOS·Windows에는 이 행이 **없다** | GTK3 빌드의 `prefers-color-scheme`은 `gtk-application-prefer-dark-theme` 또는 테마 이름 `-dark` 휴리스틱(g-a11y §2.1 [소스]), Yaak 등 Tauri 앱의 같은 보고 | `frontend`(플랫폼별 행 노출 골든) |
| 첫 프레임 배경 | §2.1(Linux 선택값 우선) | — | `tauri` |
| 전달 신뢰도 | macOS·Windows(`PreferredColorScheme` AUTO)는 OS 추종이 문서로 확인됨. Linux는 [미확인] → §21 M14 기록 | g-a11y §2.1 | — |

### 10.2 forced-colors(Windows 대비 테마)

`forced-colors: active`는 **Windows WebView2에서만** 켜진다. WebKit(macOS·Linux)은 상수 `none`이다(g-a11y §2.1 [소스], brief §2.5). 토큰·컴포넌트별 시스템 색 매핑은 foundations §2.7이 소유한다. 이 문서의 규칙은 셸 측면만이다.

| 규칙 | 근거 | 강제 |
|---|---|---|
| 포커스는 `outline`이므로 자동으로 살아 있다(D20). `box-shadow` 링은 사라진다(현재 코드가 그렇다, P0 F1) | `E-KO-B6` 실측, g-a11y §3.3 | `design-lint`, `design-gallery`(forced 에뮬레이션 axe) |
| `GrayText`는 비활성 전용. 보조 글자는 `CanvasText` | Microsoft 금지 목록(g-a11y §3.2) | `design-lint`(forced 블록 grep) |
| `forced-color-adjust: none` 금지 | `G-A11Y-OS3`(텍스트 backplate까지 끈다) | `design-lint` |
| Windows 대비 테마 4종(Aquatic·Desert·Dusk·Night sky)에서 사람이 한 번 본다 | 에뮬레이션은 팔레트가 하나 | §21 M15 |
| 작업 표시줄 진행이 숨겨진다 | §8 | — |

### 10.3 대비 증가·동작 줄이기·투명도·색 반전

| 설정 | 전달 | 우리 규칙 | 근거 | 강제 |
|---|---|---|---|---|
| macOS "대비 증가", GNOME 고대비 | `prefers-contrast: more`(WKWebView `accessibilityDisplayShouldIncreaseContrast`, GTK3는 테마 이름 `HighContrast`) | foundations §2.5 블록(`--fg-muted`·`--separator`·`--border-strong` → `--fg`) | g-a11y §2.1·R-OS-7 | `design-tokens`, `design-gallery` |
| `prefers-contrast: less`·`custom` | macOS·GTK3에서 오지 않음, Windows 매핑 [미확인] | 쓰지 않는다 | g-a11y §2.2 | `design-lint`(`less`·`custom` 0개) |
| 동작 줄이기 | 세 엔진 모두 전달. macOS는 실행 중 변경도 반영(수정됨), GTK3는 `gtk-enable-animations` | foundations §7.1 reduce 블록. 정보(진행 막대·스피너)는 숨기지 않는다(현재 ProgressBar `display:none` 버그) | g-a11y §2.1, brief §6.6-4 | `design-tokens`, `design-gallery` |
| 투명도 줄이기 | **WebKit 미지원**(bug 175497 NEW). Windows만 Chromium 118 | 반투명·블러에 의미나 가독성을 싣지 않는다(이미 `backdrop-filter` 금지, foundations §6.3) | `E-APPLE-14`, `G-A11Y-OS8` | `design-lint` |
| 색 반전(macOS) | `inverted-colors` macOS만 | 규칙을 두지 않는다(WebKit이 이미지 반전 보정) | g-a11y §2.2 | — |

---

## 11. 텍스트 크기·확대(D28)

| OS 설정 | 웹뷰 반영 | 우리 규칙 | 근거 | 강제 |
|---|---|---|---|---|
| 앱 안 글자 크기 | `:root[data-text-scale="large"|"x-large"]`가 글자·행간 토큰만 재정의(×1.3 / ×2.0, foundations §3.2 [잠정]). 컨트롤은 `min-height`라 따라 늘어난다 | 설정 › 보기 › 글자 크기(기본/크게/아주 크게). 웹뷰 줌 대신 이것이 WCAG 1.4.4 수단 | D28, macOS에 Dynamic Type 없음(`E-APPLE-08`), g-input(크기 토큰은 글자와 분리) | `design-tokens`, `design-gallery`(x-large 720×520 리플로우) |
| Windows 설정 › 텍스트 크기(최대 225%) | WebView2 래스터 배율 = DPI × 텍스트 배율. **CSS 뷰포트가 줄어든다**(폭·높이 모두). Tauri `LogicalSize`는 이를 반영하지 않는다(#5437 계획 없음) | 최소 창 720×520이 225%에서 CSS 약 **320×231** [추정]. 그 안에서 가로 스크롤 없이 모든 기능이 되게 한다(WCAG 1.4.10). 좁은 레이아웃은 `layout.css`의 두 블록(`max-width: 599px` + `x-large`, foundations §8)이 덮고 대화상자는 `max-height` + 본문 스크롤(`components.md` §2.10) | `G-A11Y-OS13`·`OS14`, foundations §8 | `design-gallery`(320×231 리플로우), §21 M16(실기 100·150·225%) |
| Windows 디스플레이 배율 | `devicePixelRatio` | 선 1·2px, outline 포커스(foundations §6.2). 스냅샷은 `--force-device-scale-factor` | g-scale §2 실측 | `design-shots`(DPR 1·2) |
| macOS | 시스템 "큰 텍스트" 설정이 없다 | 앱 안 설정이 유일한 수단 | g-a11y §4.1 | — |
| GNOME 큰 글자(`text-scaling-factor`) | WebKitGTK가 `gtk-xft-dpi`를 읽지만 CSS `px`에 미치는 영향 [미확인] | 루트 16px 고정(D4)을 유지하고 실기로 본다 | g-a11y §4.4 | §21 M17 |
| 레이아웃 | 모든 OS | 글자를 고정 `px` 높이에 가두지 않는다(`min-height`만) | `G-A11Y-OS11`, `G-INPUT-IN5` | `design-lint`(컨트롤 `height` 리터럴 금지) |

---

## 12. 스크린리더

### 12.1 엔진별 알려진 상태(g-a11y §5.1)

| 조합 | 사실 | 우리 규칙 |
|---|---|---|
| VoiceOver + WKWebView | 모달을 열면 VO 포커스가 여는 버튼에 남고 VO+← 로 뒤 내용에 닿는 회귀(Safari 18.4~26, 2026-05 수정, 어느 빌드에 들어갔는지 [미확인]) | 대화상자가 열리면 **배경에 `inert`**(하한 안, Safari 15.5)를 건다. `aria-modal`만 믿지 않는다 |
| Narrator·NVDA·JAWS + WebView2 | Chromium 138부터 UIA 기본. WebView2 런타임 적용 여부 [미확인]. 2022 WinUI 호스팅에서 NVDA·JAWS 미읽힘 보고(Win32 호스팅과 조건이 다름) | 실기 확인(§21 M18) |
| Orca + WebKitGTK | AT-SPI 구현. `AtspiCollection` 부재로 구조 탐색이 안 되던 문제는 2022-06 trunk에서 수정(2.36 보고) | 하한 2.40은 수정 포함으로 추정 [추정] |
| 센스리더(한국 PC 스크린리더 85.2%, 2020 n=331) | WebView2 호환 [미확인] | 제조사 문의 또는 실기(§21 M18) |
| 한국어 TTS | `GB`·`%`·`7.8`을 어떻게 읽는지 1차 출처 없음 | 보조기술용 문장은 **단위를 한글로 풀어 쓴다**(아래) |

### 12.2 규칙

| 규칙 | 근거 | 강제 |
|---|---|---|
| `progressbar`는 live region이 아니다. 진행 틱을 `aria-live`로 말하지 않는다. 상태 전이(시작·완료·실패·연결 대기 진입)와 25% 단위만 `polite` 한 영역에서 한 번 알린다 | W3C ARIA25(g-a11y §5.2), 현행 `announce.svelte.ts` 결정, brief §6.9-4 | `frontend`(틱마다 호출 안 됨) |
| 진행 막대는 이름(`aria-label`)과 `aria-valuetext`(완결 문장)를 항상 가진다. 총량을 모르면 `aria-valuenow` 생략 | 일부 스크린리더는 `valuetext`가 있으면 숫자를 읽지 않는다(g-a11y §5.2) | `frontend`(필수 prop 타입), `design-gallery`(axe `aria-progressbar-name`) |
| 보조기술용 문장의 단위는 한글: `58퍼센트`, `7.8기가바이트`. 골든 문장은 `content.md` §10 `a11y.progress`("{percent}퍼센트 받았어요. {remaining}") 하나 | 한국어 TTS 단위 읽기 사례(`G-A11Y-OS16`) | `frontend`(골든), `design-copy` |
| 대화상자: `role=dialog` + 배경 `inert` + 닫으면 여는 요소로 포커스 복귀. `<dialog>`+`showModal()` 전환은 `components.md`가 정한다 | `G-A11Y-OS15` | `frontend`(`inert` 상태 테스트), `design-gallery`(axe) |
| roving tabindex 위젯은 포커스 모드로 전환되는 role(`radiogroup`·`listbox`·`toolbar`)을 가진다 | NVDA·JAWS 브라우즈 모드가 방향키를 가로챈다(g-a11y §5.4 [추정]) | `frontend`(role 테스트) |
| 세 엔진에서 따로 확인한다. 한 엔진의 합격은 다른 엔진의 합격이 아니다 | `G-A11Y-OS16` | §21 M18(7단계 시나리오) |

---

## 13. 웹뷰 엔진 하한(D1)

값은 foundations §11이 소유한다(Safari 16.4 = Chrome 111 = WebKitGTK 2.40, macOS 13.3). 이 절은 셸이 하는 일이다.

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 한 곳의 원천 | `app/baseline.json` `{ safari: "16.4", chrome: "111", webkitgtk: "2.40", macos: "13.3" }`(이 문서가 소유, foundations §11은 같은 값을 적는다). `vite.config.ts`의 `build.cssTarget`·`css.lightningcss.targets`와 `tauri.conf.json`의 `minimumSystemVersion`이 이 값과 같아야 한다 | `G-ENGINE-R1`. 현재 `build.target: 'es2022'`가 cssTarget을 chrome94로 풀어 `oklch`가 hex+`lab()` 두 줄이 된다(`E-DESK-E25`) | `frontend`(일치 테스트), `tauri`, `scripts-test`(`spec-check.mjs`가 foundations §11과 대조) |
| 런타임 프로브 | 앱이 뜬 뒤 `CSS.supports` 묶음(`color-mix(in srgb, …)`, `selector(:has(a))`, `oklch(…)`, `(container-type: inline-size)`, `inert in HTMLElement.prototype`)을 `--smoke` 마커 JSON에 `probe` 키로 넣는다. 하나라도 false면 `smoke-bin` 실패 | g-engine E5. `smoke-bin`은 3 OS에서 돈다(CLAUDE.md `tauri` 작업). 마커 키 집합이 고정이라 `MARKER_KEYS`·검사기·테스트를 함께 바꾼다 | `smoke-bin`(3 OS), `scripts-test` |
| 미달 알림 | 같은 프로브가 사용자 기기에서 false면 시작 때 한국어로 "이 컴퓨터의 웹 구성요소가 오래됐어요"와 고치는 법(macOS 업데이트 / WebView2 갱신 / `apt upgrade`)을 보인다. 앱을 막지는 않는다 | `G-ENGINE-R10`. 미갱신 Ubuntu 22.04(2.36.0)가 여기 해당(지원 밖) | `frontend`(프로브 false 주입 → 안내 렌더), `design-copy`(문구) |
| Linux 22.04 실행 환경 | CI에 `ubuntu:22.04` 컨테이너 `xvfb-run --smoke`를 더해 2.50.4에서 프로브가 도는지 본다 [제안] | g-engine E6(지금은 24.04 호스트만 렌더) | `smoke-install`(확장 요청 §22) |
| Linux 그래픽 환경변수 | `WEBKIT_DISABLE_DMABUF_RENDERER` 등 4종을 코드에서 **무조건 설정하지 않는다**. 증상이 확인된 사용자에게 도움말로 안내한다 | Tauri 문서 "정상 사용자의 빠른 경로를 끈다"(g-launch §3.3, v-desk §2.4) | `release-hygiene`(소스에 `WEBKIT_DISABLE_`·`__NV_DISABLE_` 설정 0개, 확장 요청 §22) |

---

## 14. 체감 성능 예산

출처가 있는 한계는 Nielsen 0.1·1·10초, RAIL 100ms·50ms·16ms다(v-desk §2.6). 데스크톱 공식 "시작 시간 ms 목표"는 없고 Apple 400ms는 iOS 한정이다. 그래서 아래 **[제안]** 값은 실측 뒤 조정한다(g-launch §2.3).

| 상황 | 목표 | 근거 | 강제 |
|---|---|---|---|
| 클릭·키에 대한 시각 반응(눌림·포커스·낙관적 상태) | 100ms 이내, 가능하면 한 프레임(16ms). `--motion-fast` 100ms가 눌림 전환 | RAIL 100ms, Nielsen 0.1초 | `frontend`(눌림 상태 즉시 반영) |
| 메인 스레드 작업 한 덩어리 | 50ms 이하 | web.dev 긴 작업 | `e2e-web`(200행 주입, `PerformanceObserver` longtask 기록, 관찰) |
| 아이콘 클릭 → 창 보임 | `COLD_SHOW_BUDGET_MS` 1000, `WARM_SHOW_BUDGET_MS` 400 [제안](foundations §14) | Nielsen 1초, Doherty 400ms(역사적 휴리스틱) | `smoke-bin` 마커 `t_show_ms`·`t_ready_ms` → `ci/ratchet.json`(관찰 뒤 승격, D14 패턴) |
| 창 보임 → 첫 의미 있는 그림 | 0ms 추가(이미 그려져 있음) | §2.2 | `tauri` |
| 로딩 표시 | 작업 시작 뒤 `LOADER_DELAY_MS`(300 [제안]) 전에는 보이지 않고, 한 번 뜨면 `LOADER_MIN_MS`(400 [제안]) 이상 유지(foundations §14). 공용 훅 하나 | 디자인 시스템 수렴값 200~300/400(`E-DESK-L*`. Epic React를 300/350으로 인용하지 않는다, `X-DESK-L20`) | `frontend`(가짜 타이머 vitest), `design-lint` DX(로딩 표시 컴포넌트는 훅 경유) |
| 1초 넘는 일 | 반드시 무엇을 하는지 보인다. 10초 넘으면 퍼센트·남은 시간·취소 | Nielsen | `R7`(새 장기 command는 화면 매핑 표에) |
| 진행 이벤트 | 코어 `PROGRESS_INTERVAL` 250ms(기존), 화면은 프레임당 1회(`requestAnimationFrame` 병합). 막대는 `transform: scaleX` + `--progress-tween`(250ms linear) | Tauri 이벤트는 고처리량용이 아니고 Channel이 맞다(v-desk §2.4), web.dev transform 1% 드롭 | `rust`(`Meter` 테스트 기존), `frontend`(1000건/초 폭주 → 렌더 ≤ 프레임당 1), `design-lint`(막대는 transform·opacity만) |
| 낙관적 갱신 | 받기 시작·일시정지·취소는 즉시 상태를 바꾸고 코어 이벤트가 이긴다. 거부되면 1초 안에 되돌리고 이유를 말한다 [제안] | Nielsen 1초, g-launch §5 | `frontend`(롤백 테스트) |
| 목록 | 완료 11개 넘으면 접기(D39)로 DOM을 제한한다. 행 100개 넘으면 가상화 또는 접기 | Lighthouse 800노드 경고(v-desk §2.6), 행 15~25노드 추정 | `e2e-web`(200행 longtask) |
| 측정 정의 | T0 프로세스 시작, T1 show, T2 첫 의미 있는 그림, T3 입력 가능. Release 빌드, 콜드·웜, 중앙값·p95 | Microsoft 시작 성능 지침(g-launch §4.1) | `smoke-bin` 마커 |
| 글자 요소의 `transform` | 정지 상태 글자 요소에 `transform`·`will-change: transform`을 두지 않고 전환이 끝나면 제거 | Windows ClearType이 회색조로 튄다(g-scale §3.1), 스냅 안 됨(foundations §6.2) | `design-lint` |

---

## 15. 전원·네트워크(D40)

### 15.1 사실(g-power §1·§2)

- 현재 코어는 네트워크 단절을 재시도 5회·대기 합 약 7.5초로 끝낸다(`retry.rs`). 연결 timeout 10초 × 5면 1분 안팎. Wi-Fi 전환·VPN·덮개 개폐 직후 `failed{network}`가 된다(R-5). `resolve`·`reresolve`에는 재시도가 없다(R-6). 앱에 잠자기 방지·전원 이벤트가 없다(R-9).
- macOS `kIOPMAssertPreventUserIdleSystemSleep`은 유휴 잠자기만 막고 덮개·배터리 부족에는 "여전히 잠잔다". `PreventSystemSleep`은 헤더가 deprecated·미지원으로 적었다. Windows `SetThreadExecutionState`는 사용자 잠자기를 막을 수 없고 최신 대기 배터리에서 PowerRequest는 절전 시간 초과 5분 뒤 끝난다. Linux는 systemd `idle` 억제 잠금.

### 15.2 규칙

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 재시도 인내 | 서버가 거절하지 않은 실패(연결·timeout·reset·조기 EOF)는 **진전 없는 시간 `NETWORK_PATIENCE_MS`**(30분 [잠정])까지 기다리며 재시도, 대기 간격 상한 `RETRY_BACKOFF_MAX_MS`(30초 [잠정])(foundations §14). 5xx·429는 현행 5회. `resolve`·`reresolve`·시작 조회도 같은 예산. 깨어남·연결 복구 신호를 받으면 예산을 처음부터 센다(잠든 시간을 세는 시계에 의존하지 않는다) | `G-POWER-R8`·`G-POWER-R13`(`Instant`가 잠자기를 세는지 OS마다 다름). 잠자기 방지보다 이것이 먼저다 | `rust`(wiremock + `tokio::time::pause`: 29분 단절 뒤 완료, 31분은 `Err(Network)`, 5xx 5회, 403 뒤 `reresolve` 중 단절도 복구) |
| 연결 대기 상태 | 상태 머신은 바꾸지 않는다. `running`의 `phase = WaitingNetwork`. 막대 줄무늬(`components.md` §2.20 `waiting`), 퍼센트 유지, 속도·남은 시간 숨김, 빨강·실패 문구 없음. 문구 `job.status.waitingNetwork` + `job.waitingNetwork.body`(`content.md` §15.1) | D40, brief §6.9-7(대기는 오류가 아님), `reresolving` 선례(app.md §8.11) | `rust`(phase 방출 순서), `frontend`, `design-copy`(대기 조각에 해요체·오류 어조 금지어 없음) |
| 잠자기 방지 범위 | **유휴 잠자기만.** 화면 끄기 요청(`PreventUserIdleDisplaySleep`·`ES_DISPLAY_REQUIRED`·display 억제)과 강제 잠자기 요청(`PreventSystemSleep`·`ES_AWAYMODE_REQUIRED`·`handle-lid-switch`·`sleep` 잠금·`pmset disablesleep`)을 만들지 않는다 | Apple 헤더·QA1340, Microsoft "덮개·전원 버튼 기대를 존중", Transmission 선례(g-power §5) | `release-hygiene`(금지 심볼 grep, `keepawake` 빌더에 `display(false)`·`sleep(false)` 명시, 확장 요청 §22) |
| 시점 | `running`(또는 `pausing`)이고 연결 대기 상한을 넘기지 않은 작업이 있을 때만 잡고, 그 밖(대기·일시정지·실패·완료·종료)에서 해제. 0↔1 전이에서만 호출 | Transmission "활성이고 멈추지 않은 전송만"(g-power §5) | `rust`(가짜 `SleepGuard` 생명주기 테스트) |
| 기본값·설정 | 기본 **켬**. 설정 토글 `settings.keepAwake` + `settings.keepAwake.help`(`content.md` §15.1). 배터리 하한 자동 해제는 v1.1 | 사용자는 걸어 두고 자리를 뜬다(현우). 명사 "잠자기/절전"을 피하고 동사형으로 세 OS를 덮는다(`G-POWER-R15`) | `frontend`(설정 행), `design-copy`(명사 금지어) |
| 표시 | 보호를 **실제로 얻었을 때만** 목록 그룹 헤더 옆 한 줄 "받는 동안 잠들지 않아요". 못 얻으면 숨기고 로그만. 보호 실패는 다운로드를 멈추지 않는다 | `G-POWER-R15` | `rust`(획득 `Err` → 작업 정상 완료·표시 false) |
| OS 사유 문자열 | `power.reason`(`content.md` §14: "치지직 영상 {n}개 받는 중"). macOS `SLEEP_REASON_MAX` 128자. 비어 있거나 코드명이면 안 된다 | QA1340(사유는 사용자에게 보이는 설명), `powercfg /requests`·`gnome-session-inhibit --list` | `rust`(길이·치환 테스트) |
| App Nap(macOS) | `running` 작업이 있는 동안 끈다(`NSProcessInfo` 사용자 시작 활동, 잠자기는 허용 수준). 설정으로 노출하지 않는다 | Apple 에너지 가이드(g-power §2.1). 효과는 §21 M19 | `rust`(가짜) |
| 구현 위치 | 코어에 OS 의존 없음. `crates/shell::power`(`SleepGuard` trait, `keepawake` 0.6.1 구현, 전용 스레드 소유), `app/src-tauri` 전원·네트워크 이벤트(깨어남·연결 복구 → 재시도 앞당김 힌트) | `G-POWER-R13`, `ES_CONTINUOUS` 스레드 귀속 위험(g-power §4) | `release-hygiene`(OS 전원 심볼 위치 제한) |
| 복구 신호 | 힌트로만. 신호가 있다고 성공으로 보지 않고, 없다고 시도를 멈추지 않는다 | 캡티브 포털·VPN 경로(g-power §3) | `rust` |
| 알림 | `RECOVERY_SILENT_MS`(1분 [취향]) 안에 회복한 단절은 알리지 않는다. 그 이상이면 행 본문 줄 `job.recovered.body`를 `RECOVERY_NOTICE_MS`(10초 [취향]) 동안. OS 알림은 완료와 `notify.stalled`(상한 초과)만 | `G-POWER-R11`, §9 | `frontend`, `rust` |
| 데이터 요금 연결 | v1.1: `METERED_CONFIRM_BYTES`(1GB [취향]) 넘는 작업 추가 때 D6 한 번 확인, 막지 않음. v1은 감지 없음 | Windows 비용 API 지침 "사용자 시작 동작은 정상 진행"(`G-POWER-R3`) | ADR(후속) |
| 종료·패닉 | 보호가 남지 않는다(drop 해제) | `G-POWER-R14` | `rust`(quit 경로 테스트), §21 M19(`kill -9` 뒤 `pmset -g assertions`) |

---

## 16. 저장 위치와 파일 시스템

### 16.1 기본 폴더

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 기본 | **영상 폴더/치지직**: macOS `~/Movies/치지직`, Windows `%USERPROFILE%\Videos\치지직`, Linux `$XDG_VIDEOS_DIR/치지직`. 영상 폴더가 없을 때만 다운로드 폴더. 둘 다 없으면 홈 아래 `치지직`(홈이 없으면 오류) | macOS TCC 보호 폴더는 Desktop·Documents·Downloads(외장·네트워크 포함)이고 Movies는 아니다(g-save C3). OneDrive KFM 대상에 Videos·Downloads 없음(A3). 서명 없는 빌드는 업데이트마다 TCC를 다시 물을 수 있다(C6·C10). app.md §16 답변 3과 일치 | `rust`(`default_download_folder` 표 테스트: 영상 O / 영상 X·다운로드 O / 둘 다 X) |
| 앱 데이터 폴더 | 저장 폴더로 쓰지 않는다. 현재 `services.rs` 78~91행의 `{data}/downloads` 폴백은 결함(X8: Linux에서 `~/.local/share/...` 숨은 폴더) | "다운로드됐다는데 파일이 없다" | `rust` |
| 클라우드 폴더 | Windows: 후보가 `OneDrive`·`OneDriveConsumer`·`OneDriveCommercial` 환경 변수 하위면 기본값으로 쓰되 첫 받기 전 경고(아래). macOS: `isUbiquitousItemKey`로 확인, 확인 안 되면 안내 없음 | `G-SAVE-R3`·`G-SAVE-R17`, OneDrive는 `.tmp`만 동기화 제외(A7) → `.part`가 올라갈 수 있다 | `rust`(가짜 env 판정 테스트) |

### 16.2 폴더 검증(`VolumeProbe`, 고른 직후와 시작 직전 같은 검사)

| 검사 | 결과 | 근거 | 강제 |
|---|---|---|---|
| 존재·쓰기 가능(임시 파일 생성·삭제) | 불가 → `block` | `G-SAVE-R4`·g-save R5 | `rust`(표 테스트) |
| 읽기 전용 볼륨(Windows 19, `EROFS`) | `block`(`readOnlyVolume`) | B13 | `rust` |
| 파일 시스템 이름 | macOS `statfs.f_fstypename`(`msdos`·`exfat`), Linux `statfs.f_type`(MSDOS 0x4d44·EXFAT 0x2011BAB0, FUSE면 마운트 목록), Windows `GetVolumeInformationW`. 못 읽으면 "알 수 없음", 막지 않음 | B4·B6·B7·B8, SMB는 못 읽는다 | `rust`(trait 가짜) |
| FAT32 × 받을 크기 ≥ 4GiB(`FAT32_FILE_LIMIT` 4,294,967,296) | **`block`**(`fileTooLargeForVolume`). 크기를 전혀 모르면 `warn` | 실측: 정확히 4GiB에서 `EFBIG`(B2). 끝 무렵 실패하면 수 GB가 쓸모없어진다 | `rust`(경계값 4GiB−1 통과·4GiB 차단) |
| 여유 공간 | 필요량 = (어림 크기 − `.part` 크기) × `LOW_SPACE_FACTOR`(1.05 [취향]) > 여유 → `warn`(`lowSpace`, "약"). macOS는 `volumeAvailableCapacityForImportantUsage` 우선, 없으면 `f_bavail` | B14(Apple "저장 전 용량 확인"), 값은 어림 | `rust` |
| 클라우드 동기화 | `warn`(`cloudFolder`), [그래도 사용]은 그 폴더에 한해 기억 | `G-SAVE-R17` | `rust`·`frontend` |
| 전체 경로 길이(Windows) | 폴더 + 이름 + `.part.json` UTF-16 단위 > 259면 제목 조각을 줄이고(채널 우선 유지, 제목 최소 60바이트 기존 규칙), 그래도 넘으면 `block`(`pathTooLong`) | 탐색기·재생기·OneDrive는 260 제한을 받는다(D1·D3·A8). Rust 쓰기는 `\\?\`로 성공해도(D4) 사용자 도구가 못 연다 | `rust`(속성 테스트) |

`block`은 **쓸 수 없는 폴더와 FAT32 4GiB** 둘뿐이다. 그 밖은 `warn`이고 계속할 수 있다(파일 시스템 이름·여유 공간은 네트워크·가상 볼륨에서 틀릴 수 있다, g-save R5). 오류 문구 8종(`fileTooLargeForVolume`·`lowSpace`·`diskFull`·`pathTooLong`·`volumeGone`·`readOnlyVolume`·`cloudFolder`·TCC 안내)은 `content.md`가 소유한다.

### 16.3 파일 이름·정규화

| 규칙 | 근거 | 강제 |
|---|---|---|
| `naming::Platform`은 **실행 OS가 아니라 저장될 볼륨**으로 정한다. FAT32·exFAT·NTFS·SMB/CIFS·알 수 없음 → Windows 규칙(`\ : * ? " < > |` → `_`, 끝 점·공백 제거, 예약어). ext4·APFS 같은 Unix 파일 시스템만 Unix 규칙 | macOS가 FAT32·exFAT에 Windows가 못 읽는 이름을 그대로 만든다(g-save §2 실측). 현재 `Platform::current()`(X3) | `rust`(볼륨 종류 → Platform 표, macOS 호스트에서 FAT32 입력 테스트) |
| 앱이 만드는 이름 조각(채널·제목)은 **NFC**로 정규화한다. 사용자가 고른 폴더 경로·기존 파일 경로는 바이트 그대로 | ext4·NTFS에서 NFC/NFD는 다른 이름(E6). NFD 폴더 경로를 NFC로 바꾸면 없는 폴더를 가리킨다(R9) | `rust`(NFD 입력 → NFC, 멱등, 경로 불변) + `deny`(정규화 크레이트) |
| 길이 불변식: 최종 이름 ≤ `FILENAME_MAX_BYTES` 200(기존), 보조 파일 `이름.part.json.XXXXXX.tmp` ≤ 221바이트 | B9·B11, eCryptfs 143자는 지원 밖 | `rust`(속성 테스트), `fuzz`(naming target 후보) |
| `remove_stale_temps`는 NFD로 나열된 이름도 찾는다 | macOS FAT32·exFAT는 `listdir`가 NFD(E4), 현재 바이트 비교(X5). 이 함수가 `read_dir`하는 폴더가 TCC 보호 폴더면 동의 창을 일으킨다(C2·C3) | `rust`(가짜 `read_dir` NFD 주입) |
| `io` 오류를 원인별로 나눈다: `EACCES`/5, `EROFS`/19, `ENOENT`·`EIO`/21·3(`volumeGone`), `ENAMETOOLONG`/206, `EFBIG`/223, `ENOSPC`/39·112 | Chromium 분류 선례(B12), 현재 모두 "권한 확인"(X12) | `rust`(매핑 표 테스트, 기존 `is_disk_full` 옆) |

### 16.4 경로 표시

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 긴 경로 | **가운데 말줄임**: 맨 앞 요소(드라이브 또는 `~`)와 마지막 두 요소는 항상 보이고 가운데를 `…`로. 요소 단위로 자르고 요소 안은 끝 말줄임. 예 `~/…/Movies/치지직`, `D:\…\Videos\치지직`. CSS로 못 하므로 컴포넌트가 글자 수·폭으로 만든다(`formatPathForDisplay`, `content.md` format 절) | HIG 경로 컨트롤 "첫·끝 항목 사이를 숨긴다"(F1), Windows `PathCompactPathEx`(F6), CSS `text-overflow`는 가운데가 없다(F7). 현재 `FolderField`는 끝 말줄임 원문(X9) | `frontend`(표 테스트: 홈 안/밖 × OS × 길이) |
| `~` | macOS·Linux 홈 안 경로에만. Windows는 `C:\Users\<이름>\…`을 줄이고 `~`를 쓰지 않는다 [잠정] 확인: Windows 탐색기·GNOME Files 관례 1차 출처(F8·F9 미확인) | `NSString.abbreviatingWithTildeInPath`(F4) | `frontend` 골든 |
| 구분자 | OS 구분자 그대로(`/`·`\`) | — | `frontend` |
| 표시 ≠ 복사 | 복사·[폴더에서 보기]·로그는 **원문**. 줄인 경로에는 `aria-label`로 원문을 주고 키보드로 전체 경로에 닿게 한다([복사] 버튼 또는 포커스 시 노출) | `G-SAVE-R12`·`G-SAVE-R15`, HIG 레이블(F2) | `frontend`(표시 ≠ 복사, `aria-label` 원문) |
| 완료 표시 | 파일 이름과 폴더를 따로 보이고 완료 문구에 저장 위치 마지막 요소를 넣는다("`치지직` 폴더에 저장했어요", 문구 `content.md`) | `G-SAVE-R16` | `frontend` |
| 완료 동작 라벨 | macOS `Finder에서 보기`, Windows·Linux `폴더에서 보기`(`action.openFolder`, §20 표에만). 아이콘은 `folder` 공통(foundations §9.1) | D39, `G-HANDOFF-H1`(순서는 D39) | `design-copy` DC9 |

### 16.5 TCC·외장 디스크(macOS)

| 규칙 | 근거 | 강제 |
|---|---|---|
| 서명되지 않은 릴리스 동안, 사용자가 다운로드·문서·데스크탑·외장·네트워크 볼륨을 고르면 선택 직후 안내한다: "macOS가 이 앱의 폴더 접근을 허용할지 물을 수 있어요. 앱을 업데이트한 뒤에 다시 물을 수도 있어요."(문구 `content.md`). 서명 신원이 생기면 안내를 끈다 | TCC는 DR을 기록하고 ad hoc·무서명 코드는 버전마다 cdhash가 달라 같은 앱으로 보지 않을 수 있다(TN3127, g-save C6·C7·C9·C10). 재현은 [미확인](§21 M20) | `release-hygiene`("서명 신원 없음 ↔ 안내 켜짐" 일치) |
| `Info.plist`에 `NSDownloadsFolderUsageDescription`·`NSDocumentsFolderUsageDescription`·`NSDesktopFolderUsageDescription`·`NSRemovableVolumesUsageDescription`·`NSNetworkVolumesUsageDescription` 한국어 사유를 둔다 [잠정] 확인: Tauri `bundle.macOS.infoPlist` 경로로 들어가는지 | Apple 문서(선택이지만 권장, C2). 현재 없음(X13) | `bundle`(macOS 산출물 plist 키 검사) |
| 외장 디스크가 사라졌거나(`ENOENT`·`EIO`·Windows 21·3) 읽기 전용이면 `volumeGone`·`readOnlyVolume`으로 따로 낸다. `.part`는 남긴다 | `G-SAVE-R19`. `/Volumes/<없는 이름>`은 일반 사용자가 만들 수 없어 부팅 디스크에 폴더가 생기지 않는다(§2 실측) | `rust` |

---

## 17. IME·클립보드·끌어다 놓기

### 17.1 IME

| 규칙 | 근거 | 강제 |
|---|---|---|
| `isImeKey(e) = e.isComposing || e.keyCode === 229`. 창·문서 수준 `keydown`(Esc·Mod+Enter·방향키)과 입력칸 커스텀 `keydown`은 첫 줄에서 이것이 참이면 반환한다. `isComposing`만 쓰지 않는다 | WebKit(macOS 26)은 확정 Enter에서 `compositionend` 뒤 `keydown`이 `isComposing=false`·`keyCode=229`로 오는 옛 순서를 배포한다(WebKit 317127·324380, g-ime §2.2). MDN도 둘 다 보라고 한다. 현재 `GlobalShortcuts`·`JobList`는 `isComposing`만, `ResolveCard` Mod+Enter는 검사 없음(g-ime §1) | `frontend`(옛 순서 합성 테스트: Esc가 `ui.escape()`를 부르지 않고 Mod+Enter가 `download()`를 부르지 않음), `design-lint`(`keydown` 핸들러 파일은 `isImeKey` import 필수, 확장 요청 §22) |
| 텍스트 입력의 Enter는 `<form>` 제출에 맡긴다. 입력칸에 Enter `keydown` 처리를 달지 않는다 | 암묵 제출은 `keypress`로 판단하고 IME가 가로챈 키는 `keypress`가 없다(g-ime §2.2). `UrlBar`는 이미 그렇다 | `design-lint`(`<input` 요소의 `onkeydown`에 `Enter` 금지) |
| 조합 중에는 값을 읽거나 덮어쓰거나 `select()`하지 않는다. `compositionend` 뒤에 한다. 제출 시 DOM `el.value`를 읽는다 | 조합 중 프로그램 값 변경은 WebKit이 조합을 취소한다(g-ime §2.3) | `frontend`(조합 중 오류 미표시·`select()` 미호출) |
| 한글을 실제로 치는 칸(파일 이름)은 Enter에 동작을 달지 않고 Mod+Enter도 위 규칙을 따른다 | 확정 전 이름으로 받기가 시작되면 안 된다 | `frontend` |
| 타이머 방식(`compositionend` 뒤 N ms 무시)을 쓰지 않는다 | 오탐·미탐 모두 있다(g-ime §2.3) | `design-lint`(`compositionend` + `setTimeout` 패턴 금지) |
| 입력칸 속성: `autocomplete="off" spellcheck="false" autocorrect="off" autocapitalize="off"`, URL 칸은 `type="text"`(`url` 금지), `inputmode="url"`은 둔다 | MDN(autocapitalize는 물리 키보드 무관, autocorrect는 Baseline 2026), `type=url`은 스킴 없는 주소를 막는다(g-ime §7) | `frontend`(`TextField` 렌더 속성 4개) |
| 알려진 엔진 결함: Windows 중국어 TSF가 채워진 칸 첫 포커스에서 멈춤(tauri#15436), Linux IBus/fcitx 조합창 위치(tauri#11412). 한국어에서 재현되는지 [미확인] | g-ime §2.2 | §21 M21 |

### 17.2 클립보드(D56)

| 규칙 | 근거 | 강제 |
|---|---|---|
| 자동 읽기(클립보드 제안)는 **macOS 15.4 이상에서 `NSPasteboard.general.accessBehavior == alwaysAllow`일 때만**(15.4 미만은 읽는다). `ask`·`default`·`alwaysDeny`면 제안을 켜지 않고 붙여넣기 경로를 쓴다. Windows·Linux는 유지 | SDK 헤더: 일반 pasteboard 기본은 프로그램 접근 때 "묻는다". 우리 읽기는 창 포커스마다라 사용자 입력이 아니다(g-ime §4.1). 26.x 기본 시행은 [미확인]이지만 설계가 들어 있다 | `rust`(`accessBehavior` 질의 trait 가짜: `ask`·`default`·`alwaysDeny` → `None`), `tauri`(IPC) |
| 읽기는 Rust command 안에서만, 웹뷰에 클립보드 글을 보내지 않는다. 4096바이트 초과는 포기(기존). 주소가 아니면 아무 UI도 띄우지 않는다. 읽기는 blur 뒤 첫 focus에서만, `dismissed` 집합으로 되풀이하지 않는다 | `G-IME-R6`·`G-IME-R7`, 현행 설계 | `frontend`(capabilities에 플러그인 권한 0개, 기존 `csp.test.ts`) |
| JS에 클립보드 플러그인 권한을 주지 않는다. 쓰기는 사용자 제스처 안에서만. 붙여넣기는 `paste` 이벤트의 `clipboardData`만 쓰고 `navigator.clipboard.readText()`를 부르지 않는다 | WKWebView는 제스처 밖 읽기를 즉시 거부(WebKit 블로그) | `design-lint`(`readText(` 0개), `frontend` |
| macOS 편집 메뉴를 지우지 않는다(입력칸 밖 Mod+V의 `paste` 이벤트가 메뉴 가속키에 의존) | wry 문서(g-ime §3) | `tauri`(§7 메뉴 테스트) |
| Windows 클립보드 기록(Win+V)·클라우드 제외 형식은 선택 과제(플러그인 미노출) | g-ime §4.2 | — |
| Wayland: 읽기는 키보드 포커스가 있을 때만 오고 비어 올 수 있다. 실패는 조용히 `null` | g-ime §4.3 | `rust` |

### 17.3 주소 추출과 드롭

| 규칙 | 근거 | 강제 |
|---|---|---|
| 붙여넣기·입력칸 밖 Mod+V·클립보드 제안·드롭·직접 입력은 **하나의 추출기**(Rust `extract_chzzk_link`)를 거친다. 판정은 `parse_content_url`. TS는 같은 골든 JSON(`testdata/synthetic/url-extract.json`)으로 검증되는 미러 | 지금은 세 경로가 다른 규칙(붙여넣기는 통째, 제안·드롭은 공백 분리, BOM 처리 불일치, g-ime §6.2) | `rust`·`frontend`(골든 공유), `fixtures`(생성기 `--check`) |
| 추출기는 앞뒤 글·줄바꿈·전각 공백·제로폭 문자·감싼 괄호·따옴표·끝 구두점·붙은 조사를 견딘다. `www.`·`/live/`·전각 숫자는 코어가 거부하므로 추출기도 받지 않는다 | 한국어 문장의 특성(g-ime §6.2 표) | 골든 |
| 검증은 제출·붙여넣기·드롭에서 한 번. 타이핑 중·blur에는 하지 않는다. 오류는 입력칸 가까이 `role="alert"` | NN/g 폼 오류 지침(g-ime §6.4) | `frontend` |
| 드롭: 드래그 중에는 내용을 읽을 수 없으므로(보호 모드) 종류(`text/uri-list`·`text/plain`, `Files` 없음)로 면을 띄우고 `drop`에서 두 형식을 합쳐 추출. 창 안에서 시작한 끌기는 받지 않는다. 파일·알 수 없는 드롭은 받지 않되 창 이동을 막는다 | MDN 드래그 데이터 저장소, app.md 구현 중 변경 42·44(가) | `e2e-web`(`DataTransfer` 합성 3경우) |
| 드롭은 가속기다. 붙여넣기·클립보드 제안·최근 목록이 늘 있다. 안내 문구는 "끌어다 놓기"만 말하지 않는다 | `G-INPUT-IN9` | `e2e-web`(붙여넣기만으로 완주), `design-copy` |
| `dragDropEnabled: false` 유지. Tauri·wry를 올릴 때 3 OS 드롭 항목을 다시 한다 | `G-IME-R9`, Tauri #14373(기본값 변경 논의 중) | `tauri`, §21 M22 |

---

## 18. 앱 마크와 앱 아이콘(D33)

D33은 별도 과제(ADR)다. 이 절은 그 과제의 **규격**이다. 결과물의 전경 레이어가 툴바 마크(`--icon-md` 20)가 된다. 그 전까지 툴바는 이름만이다(§3).

### 18.1 조건(README D33 + g-id)

| 조건 | 근거 | 강제 |
|---|---|---|
| 치지직 로고·사선 키 비주얼·LIVE 링과 다른 고유 모티프. 치지직·NAVER 색(`#03C75A` 포함, C1 범위)과 다름. 플레이트는 D5 파랑 하나 | NAVER 브랜드 가이드 "자기 아이콘에 사용 금지·제휴 오인 금지"(g-id §1.1), C1 | `design-tokens`(에셋 색 C1 스캔), `R2` |
| 글자(`<text>`) 없음. SF Symbols·Segoe 글리프 path를 따라 그리지 않는다 | Windows 아이콘 지침 "타이포그래피 금지", SF Symbols 약관(brief §2.7) | `design-icons`(SVG `<text>` 0개, 세트 이름 문자열 금지) |
| 16px에서 선 2px 이상, 흑백에서 식별, 라이트(`#F3F3F3`)·다크(`#1F1F1F`) 바탕 위 플레이트 대비 ≥ 3:1, 글리프 대 플레이트 ≥ 4.5:1 | Windows "절반 이상 3:1", 현재 아이콘은 다크 작업 표시줄 2.98(경계, g-id §4.2) | `design-icons`(축소 렌더 대비·알파 계산) |
| 다운로드 화살표 모티프는 범용 기호라 구별성이 낮다. 구별은 색·플레이트 비율·이름과의 동반 노출로. 앱 UI 안에서 같은 모티프를 쓰지 않는다 | g-id §6.1, foundations §9.1("받기" 아이콘은 앱 마크가 독점) | `design-icons`(은유 표) |
| 5초 시험: 비기술자 포함 5명에게 16·32px을 보여 "무슨 앱 같아요?" | NN/g 아이콘 시험 변형(g-id §6.2) | `R10`(D62 항목) |

### 18.2 원본과 산출물

원본은 **플레이트 없는 전경**(`icon-fg.svg`, 투명)과 **전면 사각 배경**(`icon-bg`, 1024 풀블리드, 모서리 마스크 없음) 둘로 나눈다. 마스크·모서리는 OS나 도구가 씌운다. 현재 `icon-source.svg`는 `rx=200` 플레이트를 이미 칠한 풀 플레이트라 macOS 26 "squircle jail"(가장자리 알파 ≤ 252인 아이콘을 회색 판 위에 축소) 조건에 걸릴 수 있다(g-id §4.1 [2차]).

| OS | 산출물 | 규격 | 근거 | 강제 |
|---|---|---|---|---|
| macOS 26+ | `.icon`(Icon Composer) → `actool`로 `Assets.car` + `CFBundleIconName`. Default·Dark·Mono 지정, Mono는 한 요소 흰색·나머지 회색 | 1024 캔버스, 배경 1 + 전경 1, 글자는 윤곽선, 정적 그림자 없음 | WWDC25 220·361(g-id §4.1). `tauri icon`은 `.icon` 미지원(#14207) → 컴파일 결과를 저장소에 커밋(CI `actool` 불안정 보고) [잠정] 확인: 번들러가 `Assets.car`를 받는지 | `bundle`(`Info.plist` `CFBundleIconName`·`Assets.car` 존재) |
| macOS 구형 | `icon.icns` 10항목(16·16@2x·32·32@2x·128·128@2x·256·256@2x·512·512@2x), 둥근 사각 합성 | Tauri `icns.json`과 같다(현재 충족) | g-id §4.1 | `bundle`(`iconutil` 항목 수) |
| Windows | `icon.ico` 층 **16·20·24·30·32·36·40·48·64·96·256**, 32를 첫 층. 16·24·32는 별도로 다듬는다. 투명 배경 | Microsoft: 정확한 크기가 없으면 다음 큰 것을 줄인다 → 중간 크기가 있어야 100%·125%·150%에서 선명. 현재 6층(16·24·32·48·64·256) | g-id §4.2 | `bundle`(ico 헤더 층 집합) |
| Windows | 다크 작업 표시줄 변형 | 플레이트 명도를 소폭 올린 변형 검토 [잠정] 확인: 다크 `#1F1F1F` 위 3:1 실측 | 현재 2.98(g-id §4.2) | `design-icons`(대비 계산) |
| Linux | `hicolor/{16,22,24,32,48,64,128,256,512}x…/apps/*.png` + `scalable/apps/*.svg`. 48은 필수 | freedesktop 아이콘 테마 스펙("최소 48 hicolor"), 현재 16·22·24·48 없음·SVG 미설치 | g-id §4.3 | `bundle`(`.deb` `dpkg -c` hicolor 경로) |
| Linux | `.desktop` | `Name=chzzk-downloader`, `Name[ko]=치지직 다운로더` [잠정] 확인: Desktop Entry 스펙 로케일 키 원문 | 지금은 ASCII만(app.md 구현 중 변경 51(가)) | `bundle` |
| Worker | 웹 아이콘 | `favicon.ico`(32), `icon.svg`(`prefers-color-scheme` 변형), `apple-touch-icon.png`(180, 불투명 [미확인]), `og:image` 1200×630 + `og:image:alt`(로고·캡처·채널명 없음) | g-id §5. 현재 Worker에 셋 다 없음 | `worker`(미로그인 `/` 응답 link·og 태그, 자산 200·content-type·크기) → 배치는 `web.md` |
| 공통 | 생성 | 스크립트 하나가 `icon-fg`·`icon-bg`에서 전부 만들고 `--check`로 산출물 = 원본 확인 | `gen-fixtures.mjs --check` 패턴 | `design-icons`(`icons:check`) |

---

## 19. 이름과 비공식 표기의 위치(D34)

이름은 `치지직 다운로더`(한글 표시 이름), `chzzk-downloader`(ASCII 파일·패키지·URL)이고 둘은 `productName`과 `scripts/ci/bundle.mjs` 한 곳에서 파생한다. 고지 **문구**는 상수 하나(`unofficialNotice`, 앱 `ko.ts`와 Worker `copy.ts` 동일)이고 `content.md`가 소유한다. 이 표는 **어느 OS 접점에 무엇이 보이는가**만 정한다.

| 접점 | 표기 | 고지 | 근거 | 강제 |
|---|---|---|---|---|
| 창 제목 | `치지직 다운로더` | 없음 | 짧게, 항상 보임(g-id §2) | `tauri` |
| 툴바(앱 안) | 마크 + `치지직 다운로더`(마크 전까지 이름만) | 없음(Worker 헤더 배지 "비공식 도구"는 Worker만) | judgment §2.3-7 | `frontend` |
| macOS 앱 메뉴·About | `치지직 다운로더에 관하여` 등 §7 표. About 창은 쓰지 않고 설정 › 정보로 보낸다[취향] | 정보 화면이 고지 위치 | macOS About은 Windows·Linux에 없다(brief §6.14-4) | `tauri` |
| Dock·작업 표시줄·시작 메뉴·설치 폴더 | `치지직 다운로더`(Linux는 `.desktop` `Name[ko]`, §18.2) | 없음 | g-id §2 | `bundle` |
| OS 알림 발신자 | OS가 번들·AUMID에서 읽는 `치지직 다운로더`(Linux [잠정] §9) | 제목·본문에 "비공식"을 넣지 않는다 | g-id §2 | `rust` |
| 설치 파일 | `chzzk-downloader_<버전>_<플랫폼>.<확장>` | 릴리스 노트 한 줄(`content.md`) | bundle.mjs 주석(한글 정규화 회피) | `bundle` |
| 번들 식별자 | `io.github.chnu-kim.chzzk-downloader`(개명해도 유지) | — | 바꾸면 데이터 폴더·updater가 끊긴다 | `tauri` |
| 설정 › 정보 | 앱 이름 · 버전 `0.1.2`(v 없음) · [정보 복사] · **비공식 고지** · 처리방침 · 오픈소스 라이선스 · 저작권 줄 | 있음(4곳 중 하나) | D34, brief §6.14-4(필수 7요소), `G-INSTALL-R12` | `frontend`(7요소), `design-copy` |
| 로그인 첫 화면 | `NOTICE_SHORT` 한 줄(정적, 닫을 수 없음) | 있음 | C2·C7(users §6), README §6-12 | `frontend`, `design-gallery` |
| 랜딩 히어로 아래·바닥글 | `web.md` | 있음(2곳) | D34 | `worker` |
| 오류 화면·알림 | 고지를 붙이지 않는다 | 없음 | 법적 고지가 섞이면 읽기 어렵다(g-id §3) | `design-copy` |
| 금지어 | "공식"·"인증"·"파트너"·"제공"을 이름·설명·알림에 쓰지 않는다 | — | `G-ID-R2` | `design-copy` |

개명 트리거(약관 금지·네이버 이의·공개 스토어·KIPRIS 등록 확인)와 그때의 B안은 `governance.md`가 적는다(README D34). 상표 조항·KIPRIS는 **[미확인]**(README §6-9, 사용자가 직접).

---

## 20. OS별 분기 표(D2·D47)

OS별로 **달라지는 모든 것**은 이 표에 있다. 여기 없는 것은 분기하지 않는다. 문자열 분기는 `platform` 인자를 받는 함수 하나(`rust`·`frontend` 골든 JSON 공유)로 하고, 컴포넌트가 `navigator.platform`을 직접 읽지 않는다(`design-lint`).

| 항목 | macOS | Windows | Linux | 근거 | 강제 |
|---|---|---|---|---|---|
| 바이트 진법 | 1000 | **1024** [미확인: 탐색기 실측 → README §6-10] | 1000 | D47. 각 OS 사용자가 Finder·탐색기에서 보는 값과 맞춘다 | `rust`·`frontend` 골든 |
| 단위 라벨 | KB·MB·GB(KiB 금지), MB/s | 같음 | 같음 | D47 | `design-copy` |
| 완료 동작 라벨 | `Finder에서 보기` | `폴더에서 보기` | `폴더에서 보기` | D39, `G-HANDOFF-H1` | `design-copy`(이 표에만) |
| 경로 표기 | `~/…/Movies/치지직`, `/` | `D:\…\Videos\치지직`, `\`, `~` 없음 [잠정] | `~/…/비디오/치지직`, `/` | §16.4 | `frontend` 골든 |
| 기본 저장 폴더 | `~/Movies/치지직` | `%USERPROFILE%\Videos\치지직` | `$XDG_VIDEOS_DIR/치지직` | §16.1 | `rust` |
| 설정·자격증명 폴더(정보 화면 표시) | `~/Library/Application Support/io.github.chnu-kim.chzzk-downloader` | `%APPDATA%\io.github.chnu-kim.chzzk-downloader` [잠정] | `~/.local/share/io.github.chnu-kim.chzzk-downloader` [잠정] | CLAUDE.md(macOS 실측), 그 외는 Tauri `PathResolver` 규칙(`G-INSTALL-R9`) | `rust`(경로 함수 골든 3 OS) |
| 로그 폴더 | `~/Library/Logs/io.github.chnu-kim.chzzk-downloader` | `%LOCALAPPDATA%\…\logs` [잠정] | `~/.local/share/…/logs` [잠정] | app.md 구현 중 변경 10(macOS 실측) | `rust` |
| `Mod` 키·표기, `{paste}` | ⌘, 기호 표기(`⌘V`) | Ctrl, `Ctrl+V` | Ctrl, `Ctrl+V` | §6 | `frontend` 골든 |
| `{devtools}`(쿠키 안내) | `⌥⌘I` | `F12` | `F12` | `content.md` §15.1 `settings.cookie.howto.step2` | `frontend` 골든, `design-copy` DC9 |
| 메뉴 막대 | 있음, Apple 한국어 용어(§7) | 없음 | 없음 | §7 | `tauri` |
| 메뉴 용어 vs 본문 용어 | 메뉴만 "윈도우"·"오려두기" | — | — | §7.1 | `tauri`, `design-copy`(본문에 "윈도우" 금지) |
| 종료 가드 범위 | ⌘Q·메뉴 종료만 D1. Dock 종료·로그아웃은 데이터만 안전 | 창 닫기 = D1 | 창 닫기 = D1 | §7 | `tauri` |
| 테마 선택 행 | 없음 | 없음 | 있음(시스템/밝게/어둡게) | D7 | `frontend` |
| 스크롤바 | OS(오버레이·상시는 시스템 설정) | `fluentOverlay` | OS | D27 | `tauri` |
| 고대비 경로 | `prefers-contrast: more` | `forced-colors: active` + `prefers-contrast` | `prefers-contrast: more`(GTK 테마 이름) | §10 | `design-gallery` |
| 글자 크기 OS 설정 | 없음 → 앱 설정만 | 텍스트 크기 225% → 320px 리플로우 | `text-scaling-factor` [미확인] | §11 | `design-gallery` |
| 진행 표시 | Dock, 색 3종 | 작업 표시줄, 색 3종, 고대비 숨김 | libunity 있을 때만, 색 없음 | §8 | `rust`(집계는 공통) |
| 알림 | `NSUserNotification` 경로, 서명 없는 빌드 [미확인] | 설치본만 제 이름 | 헤더 `chzzk-app` 가능 | §9 | §21 |
| 클립보드 제안 | `accessBehavior == alwaysAllow`일 때만 | 켬 | 켬(Wayland는 비어 올 수 있음) | D56 | `rust` |
| 잠자기 방지 | `PreventUserIdleSystemSleep` + App Nap 해제 | `SetThreadExecutionState`(사유 없음, 2단계 `PowerCreateRequest`) | systemd `idle` 억제(Flatpak은 포털) | §15 | `release-hygiene` |
| 전원 사유 표시 위치 | 활성 상태 보기 › 에너지 | `powercfg /requests` | `gnome-session-inhibit --list` | §15 | — |
| 파일 이름 규칙 | **볼륨 기준**(실행 OS 아님) | 볼륨 기준 | 볼륨 기준 | §16.3 | `rust` |
| 설치 경고 안내 | 손상 경고 → "그래도 열기" 우선, xattr 폴백 | SmartScreen, SAC 안내 문단 | AppImage 실행 권한 + libfuse2 | D53·D55(`web.md`) | `worker` |
| 글꼴 | SF + Apple SD Gothic Neo | Segoe UI 또는 맑은 고딕 [미확인] | fontconfig + Noto Sans CJK KR [미확인] | foundations §3.1 | `R4` |
| 앱 이름 ASCII 덮어쓰기 | — | — | `productName` `chzzk-downloader`(`tauri.linux.conf.json`) | deb 패키지명 제약 | `bundle` |

---

## 21. 사람이 3 OS에서 확인하는 것([잠정] 항목의 확인 방법)

네이티브 E2E는 macOS를 지원하지 않고(app.md 구현 중 변경 57) 알림·메뉴·Dock·클립보드 권한은 어느 E2E도 못 본다. 아래는 릴리스 후보마다 돈다. 결과는 `docs/ROADMAP.md`에 OS 버전·날짜와 함께 적고, 기대와 다르면 이 문서의 해당 행을 고치지 말고 "구현 중 변경"에 번호를 붙인다(CLAUDE.md 작업 규칙). 실기 영상은 본인 영상, 번호는 기록하지 않는다.

| # | 확인 | macOS | Windows | Linux | 관련 |
|---|---|---|---|---|---|
| M1 | 첫 프레임이 라이트·다크 모두 `--bg`(흰 번쩍임 없음). 화면 녹화 첫 프레임 캡처 | ○ | ○ | ○ | §2.2 |
| M2 | `frontend_ready` 신호를 억제한 빌드에서 1.5초 뒤 창이 뜬다 | ○ | ○ | ○ | §2.2 |
| M3 | 외장 모니터를 뺀 뒤 실행해도 창이 보이는 화면 안에 복원된다 | ○ | ○ | — | §2.3 |
| M4 | 본문 우클릭 → 메뉴 없음, 입력칸 우클릭 → 붙여넣기 있음. macOS·Linux 기본 메뉴 항목 목록 기록 | ○ | ○ | ○ | §4.3 |
| M5 | 핀치·Ctrl+휠·정밀 터치패드 핀치가 크기를 바꾸지 않음(Linux는 미해결 가능) | ○ | ○ | △ | §4.5 |
| M6 | 터치: 오류 문구 길게 누르기로 복사 메뉴가 열리고, 버튼 길게 누르기는 메뉴 없음 | — | ○(2-in-1) | — | §4.3 |
| M7 | 목록 끝에서 탄성이 있고 툴바가 같이 움직이지 않음. 짧은 목록에서도 전체가 튀지 않음 | ○ | — | — | §5 |
| M8 | 메뉴 전부 한국어, `⌘,`가 설정을 한 번만 열고, 전체 화면 항목 제목이 시작/종료로 바뀜 | ○ | — | — | §6·§7 |
| M9 | Dock·작업 표시줄 진행이 퍼센트대로 차고 일시정지 노랑·실패 뒤 빨강. Dock 아이콘 다크·틴트 변형 회귀 없음 | ○ | ○ | △ | §8 |
| M10 | 설치본에서 완료 알림 제목에 앱 이름이 없고 3건이 한 알림으로 묶임. Windows 헤더가 `치지직 다운로더`와 앱 아이콘 | ○ | ○(NSIS·MSI) | ○ | §9 |
| M11 | 알림 클릭이 앱을 앞으로 가져옴 | ○ | ○ | ○ | §9 |
| M12 | Linux 알림 헤더가 `chzzk-app`인지 | — | — | ○ | §9 |
| M13 | 대비 테마에서 작업 표시줄 진행이 숨겨져도 앱이 문제 삼지 않음 | — | ○ | — | §8 |
| M14 | GNOME 어두운 외관이 `prefers-color-scheme`에 반영되는지 기록(안 되면 앱 안 선택으로 해결됨을 확인) | — | — | ○ | §10.1 |
| M15 | 대비 테마 4종(Aquatic·Desert·Dusk·Night sky): 진행 막대(일시정지 `GrayText`·실패 `CanvasText` 채움이 읽히는지)·포커스 링·배지·대화상자 경계·아이콘 | — | ○ | — | §10.2, foundations §2.7 |
| M16 | 텍스트 크기 100·150·225% + 배율 100·125·150%: 최소 창에서 가로 스크롤 없음 | — | ○ | — | §11 |
| M17 | GNOME 큰 글자 1.0 vs 1.25에서 `getComputedStyle(html).fontSize`와 레이아웃 | — | — | ○ | §11 |
| M18 | 스크린리더 7단계 시나리오(g-a11y §7.4): VoiceOver / Narrator·NVDA(센스리더 가능하면) / Orca. 한국어 음성으로 `58퍼센트`·`7.8기가바이트`·`2분 18초 남음` 소리 기록 | ○ | ○ | ○ | §12 |
| M19 | `pmset -g assertions`에 사유 `치지직 영상 받는 중 (1개)`, 활성 상태 보기 "잠자기 방지" 예, 일시정지·완료·`kill -9` 뒤 사라짐. App Nap 열 비교. `powercfg /requests`, `systemd-inhibit --list` | ○ | ○ | ○ | §15 |
| M20 | 서명 없는 v(n) 설치 → 다운로드 폴더 허용 → v(n+1) 덮어쓰기 → 같은 폴더로 받기. 권한 창이 다시 뜨면 §16.5 안내를 항상 켠다(`tccutil reset SystemPolicyDownloadsFolder io.github.chnu-kim.chzzk-downloader`로 초기화) | ○ | — | — | §16.5 |
| M21 | IME: URL 칸 한글 조합 중 Enter(제출 1회·마지막 글자 보존), Esc(조합만 취소), 파일 이름 칸 조합 중 Mod+Enter(받기 시작 안 함). g-ime §9.3 프로브로 이벤트 순서 기록 | ○(2벌식) | ○(MS IME) | ○(IBus·fcitx5, Wayland·X11) | §17.1 |
| M22 | 드롭: Chrome·Edge·Safari·Firefox·웨일에서 링크 끌기(`dataTransfer.types` 기록), 탭·주소창·북마크 끌기, `.webloc`/`.url` 파일 드롭 무시 | ○ | ○ | ○ | §17.3 |
| M23 | Wi-Fi 끄기 5초/30초/2분/10분/31분: 모두 자동 이어짐, 31분은 실패. 31분 넘게 잠재운 뒤 Wi-Fi가 10초 늦게 붙어도 이어짐 | ○ | ○ | ○ | §15 |
| M24 | FAT32 USB에 4GiB 영상 시작 시 사전 차단, `? : "` 포함 제목이 Windows에서 열림, exFAT에서 강제 종료 뒤 임시 파일 정리 | ○ | ○ | — | §16 |
| M25 | 배율 행렬: Windows 100·125·150%, macOS 2x, Ubuntu 100%에서 1px 선·포커스 링·아이콘 | ○ | ○ | ○ | foundations §6.2, g-scale §6 |

---

## 22. 구현 중 변경(이 문서가 brief·보고서·기존 설계와 다르게 정한 것)과 반영 결과

| # | 항목 | 내용 | 반영 |
|---|---|---|---|
| 1 | `scrollbar-gutter: stable` | `G-SHELL-H8`은 `.main`에 권했지만 Safari 18.2라 하한 밖(foundations §11). D27대로 여백 예약을 하지 않는다 | 기각(이 문서) |
| 2 | `overscroll-behavior: none` | `G-SHELL-NS7`은 `html, body` `none`으로 고무줄을 막는다고 했지만 `X-DESK-E27`(partial 구현)이라 사실로 쓰지 않는다. 구조(`overflow: hidden`)가 1차 방어, `none`은 보조 | 이 문서 §5 |
| 3 | 줌 | `G-A11Y-OS12`(켬)와 `G-SHELL-H3`(끔)가 충돌한다. D28(끔 + 앱 안 글자 크기) | README D28 |
| 4 | 작업 표시줄 진행 | app.md 52행 "작업 표시줄 진행률은 없다"를 D29가 뒤집는다 | app.md 구현 중 변경 67 (마) |
| 5 | 알림 제목·본문 | app.md 구현 중 변경 37·47(제목 = 앱 이름, 본문 "'{title}' 다운로드를 마쳤어요")을 D38 형식으로. `sink.rs` 15~25행 | app.md 67 (바), `content.md` §14 |
| 6 | 알림 묶음 창·절단 길이 | `G-SHELL-NS21`·`G-SHELL-NS22`의 3초·24자는 근거 없음(`X-DESK-N45`). `NOTIFY_TITLE_MAX_GRAPHEMES` 40·`NOTIFY_BATCH_MS` 3000 [취향] | foundations §14, ADR-0009 |
| 7 | 기본 저장 폴더 | `services.rs` 78~91행의 `{data}/downloads` 폴백을 홈 아래 `치지직`으로. app.md §16 답변 3("영상 → 다운로드")은 유지되고 마지막 폴백만 바뀐다 | app.md 67 (사), core.md(`naming::Platform` 볼륨 기준)는 적용 PR (f)에서 |
| 8 | 완료 동작 라벨 | "[파일 열기][폴더 열기]"를 D39 "[열기] [Finder에서 보기]/[폴더에서 보기]"로. `G-HANDOFF-H1`은 반대 순서를 권했지만 README D39가 이긴다 | `patterns.md` §3.2, `content.md` §4 |
| 9 | 창 상태 복원 범위 | 전체 화면은 복원하지 않는다[취향]. D30 본문에는 없는 세부 | ADR-0009 |
| 10 | 도움말 메뉴 항목 | `G-SHELL-NS16`의 "로그 폴더 열기·문제 신고 복사" 후보는 설정 화면에 이미 있어 메뉴에 더하지 않는다. 도움말 항목은 랜딩 `/help` 하나 | 이 문서 §7 |
| 11 | 툴바 앱 이름 vs HIG | HIG 툴바 "앱 이름 금지"(`E-APPLE-25`)와 사용자 결정 2가 충돌한다. Linux 타이틀바 숨김 사례와 D62 V5로 정당화했고 README P1 예외다 | ADR-0001 §결정(사용자 결정 2) |
| 12 | `design-lint` 확장 | `data-tauri-drag-region` 0개 · `not-allowed` 0개 · `user-select`·`cursor` 선언 위치 제한 · `<img>`·`<a>` `draggable="false"` 필수 · `wheel`·`gesturestart`·`webkitmouseforce*`·`contextmenu`(guards.ts 외) 리스너 금지 · `matchMedia('(pointer`·`maxTouchPoints`·`navigator.platform` 금지 · `keydown` 핸들러 파일의 `isImeKey` import · `<input>`의 Enter keydown 금지 · `compositionend`+`setTimeout` 금지 · `readText(` 0개 · `prefers-contrast: less|custom` 0개 · 컨트롤 `height` 리터럴 금지 · 로딩 표시는 공용 훅 경유 | governance §2.9 DX1~DX13 |
| 13 | `release-hygiene` 확장 | 전원 금지 심볼(`PreventSystemSleep`·`ES_AWAYMODE_REQUIRED`·`ES_DISPLAY_REQUIRED`·`PreventUserIdleDisplaySleep`·`handle-lid-switch`·`disablesleep`), OS 전원 심볼 위치 제한(`crates/shell/src/power*`·`app/src-tauri/src/power*`), `WEBKIT_DISABLE_*`·`__NV_DISABLE_*` 무조건 설정 금지, "서명 신원 없음 ↔ TCC 안내 켜짐" 일치 | governance §2.9 DX14~DX17 |
| 14 | `tauri` gate 확장 | `backgroundColor` = `--bg` 라이트 hex · `allowLinkPreview:false` · `minimumSystemVersion 13.3` · `theme`·`titleBarStyle`·`transparent` 키 없음 · `Cargo.toml` devtools feature 없음 · 메뉴 전수 한국어 · Windows `with_webview` 호출 존재 · `set_badge_*` 0개 · Dock 호출 빈도 · 알림 옵션 없음 · 권한 `allow-set-webview-zoom` 없음 · 안전장치 타임아웃 | governance §2.8·§2.9 DX18 |
| 15 | `smoke-bin` 마커 키 | `probe`(엔진 프로브)·`t_show_ms`·`t_ready_ms`를 더한다. 키 집합이 고정이라 `MARKER_KEYS`·`smoke.mjs`·테스트를 함께 바꾼다 | governance §2.9 DX19(cicd.md 구현 중 변경은 적용 PR (f)) |
| 16 | `smoke-install` 확장 | `ubuntu:22.04` 컨테이너에서 `xvfb-run --smoke`(WebKitGTK 2.50.4 렌더) | governance §2.9 DX20 |
| 17 | `bundle` gate 확장 | 아이콘 산출물 검사(ico 층 집합, icns 항목 수, `.deb` hicolor 경로·`Name[ko]`, macOS `CFBundleIconName`·`Assets.car`, `Info.plist` `NS*UsageDescription`) | governance §2.9 DX21 |
| 18 | 설정·로그 경로 표 | §20의 경로를 `worker-config.mjs`가 아니라 `rust` 경로 함수 골든(3 OS)으로 대조한다(범주가 맞다) | 이 문서 §20 |
| 19 | IME 키 판정 | app.md §10 단축키 표의 모든 `keydown`에 `isImeKey`를 전제로 한다(brief §6.7-4와 같음) | app.md 67 (아) |
| 20 | 클립보드 제안 | app.md 구현 중 변경 37·44(나)의 "창 포커스마다 읽기"에 macOS `accessBehavior` 조건이 붙는다(D56) | app.md 67 (자) |
| 21 | 로그인 핸드오프 | 127.0.0.1 루프백 리디렉션(v0.3.0)은 `worker.md`(구현 중 변경 88·92)와 `app.md`(65·66)가 소유한다. OS별 수신기 바인딩·Windows 방화벽 창 여부·브라우저별 수신기 결과 페이지는 그쪽의 태그 뒤 실기 확인 항목(worker.md 88 (아) ③④)이다. 이 문서는 다루지 않고, 결과 페이지의 모양만 `web.md` §6.5가 적는다 | 없음 |
| 22 | 셸 상수 | 초안 §23의 상수 16개는 foundations §14 표로 옮겼다(값·표기 그대로, `NOTIFY_BATCH_MS`는 3000 [취향]으로 정했다). `app/baseline.json`은 이 문서 §13이 소유하고 앱 아이콘 산출물 크기 집합은 §18.2가 소유한다 | foundations §14 |
