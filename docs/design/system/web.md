# Worker 페이지 (web.md)

Cloudflare Worker가 서버에서 그리는 페이지(랜딩·로그인·결과·안내·관리·확인·읽기 페이지)의 규칙이다. 앱과 **같은 토큰**(`foundations.md`)과 같은 문구 규칙(`content.md`)을 쓰고, 이 문서는 웹에서만 생기는 것(문서 골격·CSP·휴대폰 진입·무스크립트 폼·표·파비콘·OG)을 정한다. 결정의 원천은 `README.md` D52·D53·D54(와 D34·D41·D51·D55)이고 이 문서는 그 값을 화면에 내리는 방법만 적는다. 결정 표와 어긋나면 결정 표가 맞다(README §3-3).

읽는 법:
- 토큰 이름과 수치는 `foundations.md`의 것만 쓴다. 여기 없는 값이 필요하면 지어내지 않고 §13 "foundations에 추가 요청"에 적었다.
- 규칙마다 (a) 근거와 (b) 강제 수단을 붙였다. 강제 수단은 `node scripts/ci/run.mjs <gate>`의 gate 이름(`worker`·`design-tokens`·`design-lint`·`design-copy`·`design-icons`·`design-gallery`·`design-shots`·`design-worker`·`scan`) 또는 리뷰 체크리스트 번호(`R1`·`R3`·`R7`·`R8`, README §4.2)다. 도움말 원천 검사(초안의 "gate `help`")는 `worker` gate 안의 단계 `help-check`다(governance §2.9 DX22). `worker` gate는 `scripts/ci/worker-config.mjs`(정적 검사. 배포 설정 모듈 `worker-deploy.mjs`를 import한다)·`worker/test/**`(vitest, Workers 런타임)·`pnpm build`(`wrangler deploy --dry-run`)와 그 번들의 `worker-config.mjs --dist` 검사로 이뤄지고 CI에서는 **worker 영역**(`changes` 작업의 `worker` 출력, `governance.md` §2.0) 작업이다. 이 문서가 "`worker` 테스트"라고 적은 것은 vitest에 더할 단언이고, "`worker-config`"라고 적은 것은 `worker-config.mjs`에 더할 정적 검사다.
- **[잠정]**은 확인되지 않은 값(확인 방법을 같은 줄에), **[취향]**은 출처 없는 선택이다.
- 예시 값(버전·날짜·크기·해시·채널 이름)은 전부 가짜다(`scan`).
- 근거는 `docs/research/design-system.md`의 ID로 인용한다(README 머리). a-worker §…처럼 ID가 없는 절은 약칭으로 남겼다. `worker.md`는 `docs/design/worker.md`(끝의 "구현 중 변경"이 본문보다 우선)다. 문구는 `content.md` §15.3의 키로 가리킨다.

---
## 1. 범위: 화면 목록

Worker가 그리는 페이지는 한 골격(`htmlPage`, worker.md §4 공통·구현 중 변경 27 (아))과 스타일시트 한 파일을 쓴다(`A-WORKER` §1). 화면은 아래가 전부다. 새 화면은 이 표에 행을 더하고 §12 결함 대조표의 "적용 뒤" 열을 채운 PR에서만 생긴다(`worker` 테스트: 경로 표 행렬 `routes.test.ts`가 경로를 고정한다, worker.md §4.5).

| 화면 | 경로 | 척도 | 인증 | 비고 |
|---|---|---|---|---|
| 랜딩(비로그인) | `GET /` | 읽기 | 없음 | 유일한 공개 진입점. OG 있음(§9) |
| 랜딩(허용 사용자) | `GET /` | 읽기 | 웹 세션 | 설치 파일 + 내 기기 + 로그아웃 |
| 로그인 확인 | `GET /auth/login/:handle` | 앱 | 없음 | **확인 코드 없음**(루프백, v0.3.0). `loginWarning` + [계속](§6.4). 흐름 결합 쿠키를 심는 자리라 이 단계는 남는다(`worker.md` 구현 중 변경 88 (가) "확인 페이지를 남기는 이유"). 이 페이지만 CSP `form-action`에 루프백 출처가 더해진다(§4) |
| 옛 앱 안내 | `GET`·`POST /auth/login/<예약 handle>` | 앱 | 없음 | 루프백 전 앱(v0.1.1 이하)이 여는 200 안내 페이지 `outdatedApp`(§6.2). DO를 부르지 않는다(`worker.md` 88 (가) "옛 앱 미끼"·89 (가)) |
| 로그인 결과 | `GET /auth/done` | 앱 | 없음 | 웹 흐름의 denied·cancelled·failed와 앱 흐름의 grant 없는 failed(§6.1). 웹 ok는 303 `/`, 앱 흐름의 결과는 앱 수신기가 그린다(§6.5) |
| 안내·오류 | 4xx·5xx | 앱 | — | 상태별 제목(§6). "안내" 하나로 뭉치지 않는다 |
| 관리 | `GET /admin` | 앱 | 관리자 | 표 5개와 폼(§7·§8) |
| 허가 빼기 확인 | `GET /admin/…/disallow`(신설) | 앱 | 관리자 | D54의 유일한 확인 페이지(§7.3) |
| 도움말·처리방침·라이선스 | `GET /help`·`/privacy`·`/licenses`(신설) | 읽기 | 없음 | §10. `/terms`는 두지 않는다(D60) |
| 공지 | `GET /notice` | — | 없음 | JSON이다. 페이지가 아니므로 이 문서의 대상이 아니다(D41, g-outage §4) |
| (대상 밖) 앱 수신 | `POST /auth/redeem`·`POST /auth/poll` | — | 없음 | JSON이다. `/auth/poll`은 수령하지 않는 404 비석이다(`worker.md` 88 (가)). 페이지가 아니다 |
| (대상 밖) 수신기 결과 | `http://127.0.0.1:<포트>/chzzk-downloader/login` | — | — | Worker가 아니라 **앱 셸**이 그리는 브라우저 페이지다. 규칙은 §6.5 |

"척도"는 §2의 `data-scale`이다. 인증·경로는 worker.md §4가 소유한다.

---

## 2. 토큰과 척도

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 토큰 원천 | 앱과 **같은 생성물**. `design/tokens/*.tokens.json` + `design/ui.css` → `scripts/design/tokens.mjs` → `worker/src/http/site-css.generated.ts`(토큰 + ui + 웹 CSS를 이어 붙인 문자열 상수 `SITE_CSS`·`SITE_CSS_HASH`). Worker 소스는 `app/`을 import하지 않는다(독립 pnpm 루트) | D3, foundations 머리말(토큰 구간은 reading·text-scale 블록을 뺀 나머지가 바이트까지 같다), `A-WORKER-0` A안 | `design-tokens` DT1 |
| 읽기 척도 범위 | `<main data-scale="reading">`은 **랜딩·`/help`·`/privacy`·`/licenses`**에만. 속성이 `main`에 있으므로 사이트 헤더·바닥글은 앱 척도(13)다. 로그인 확인·결과·안내·관리·확인 페이지는 앱 척도(13/16) | D11, foundations §3.3(문단을 읽는 화면만 15/22), judgment §2.3-6 | `worker` 테스트: 경로마다 `main[data-scale]` 유무를 단언(읽기 4경로만 있음) |
| 읽기 열 폭 | `main`의 `max-width: var(--reading-max)`(680) 가운데, 좌우 `var(--edge)`(20). 앱 척도 페이지는 `var(--content-max)`(800). 사이트 헤더 안쪽 `.col`도 그 페이지의 `main`과 같은 폭(읽기 페이지 680, UI 페이지 800) | foundations §8(`--reading-max` [취향]), D24, 정렬선 하나 | `design-lint` DL2(px 리터럴 금지), `design-gallery`(헤더·main 가장자리 x 동일) |
| 분기점 | 600 미만이 좁은 레이아웃. 미디어 쿼리는 생성기 상수 `BREAKPOINT_NARROW`(foundations §14)로 Worker 소스 `worker/src/http/site.css`와 생성물에만 쓴다 | foundations §8 분기점 [잠정] | `design-lint` DL13(폭 미디어 쿼리 허용 파일) |
| 글꼴 | `--font-sans`·`--font-mono` 두 토큰만. 글꼴 이름 리터럴·`@font-face`·`url(`·`@import` 없음 | 사용자 결정 2(시스템 글꼴), foundations §3.1, `A-WORKER` §6.2(웹폰트는 CSP `font-src`도 없다) | `worker-config`(`url(`·`@import` 금지, 기존 `site-css.test.ts` 규칙 승계), `design-tokens`(`@font-face` 0) |
| 줄바꿈 | `html { word-break: keep-all; overflow-wrap: anywhere }`, 해시·코드·채널 ID는 `word-break: break-all`, `lang="ko"` | foundations §3.5, `A-WORKER` §2.2("한국어가 글자 단위로 끊긴다" 결함) | `design-lint`(`break-word`·`justify` 금지) |
| 숫자 | 버전·시각·횟수·크기·해시 열은 `.num`(`font-variant-numeric: tabular-nums`) | foundations §3.4, `A-WORKER` §2.2(숫자 열이 흔들린다) | `design-lint`(`.num` 유틸 하나), `R1` |
| 커서·선택 | `body.web { cursor: auto; user-select: text }`, 링크·버튼·`summary`는 `pointer`. 앱의 `default` 규칙은 웹에 적용하지 않는다 | D25(웹은 링크·버튼 `pointer`), `E-DESK-N07` | `design-lint` DL8의 `cursor: pointer` 금지는 **앱 소스만** 대상이다(Worker 소스는 허용, governance §2.3) |
| 링크 | 색 `--accent-ink`, 밑줄 유지(`text-decoration: underline`, `text-underline-offset: var(--space-2)`), `:hover`는 밑줄 굵기 변화 없이 색 유지, `:focus-visible`은 D20 링. 헤더 이름 링크와 `a.btn`만 밑줄 없음 | foundations §2.3(`--accent-ink` = 웹 링크), WCAG 1.4.1(색만으로 링크를 구별하지 않는다), `A-WORKER` §3.2(헤더 링크가 본문 링크와 같은 모양) | `design-gallery`(axe link-in-text-block), `R1` |
| 포커스 | `:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px }` 전역 하나. UA 기본 링에 맡기지 않는다 | D20, `A-WORKER` §2.5(브라우저마다 다른 기본 링) | `design-lint`(`outline: none` 금지) |
| 모션 | 전환 없음. `summary` 펼침·flash 등장 모두 즉시 | D22(정지가 기본), P5. 웹에 자주 쓰는 상호작용이 없어 모션을 둘 이유가 없다 | `design-lint`(`ms` 리터럴 금지) + 생성물에 `transition` 선언 0개를 `worker` 테스트로 단언 |
| 다크 | OS만 따른다. `data-theme` 블록은 생성물에 포함되지만 JS가 없어 쓰이지 않는다 | D7(Worker는 OS만), D52 | `design-tokens`(두 블록 동일) |
| forced-colors·대비 증가 | 앱과 같은 블록이 생성물에 있다(foundations §2.5·§2.7). 웹 고유 요소(표 테두리·skip link·배지)는 `1px solid CanvasText`로 선을 되찾는다 | foundations §2.7, brief §2.5 | `design-worker`(forced·`prefers-contrast` 에뮬레이션, §14 요청 1) |

읽기 척도는 `main`에만 적용되므로 헤더·바닥글은 모든 페이지에서 13이다(초안의 "헤더도 15" [잠정]은 foundations §12-14로 닫혔다). 확인: README §6-13(읽기 척도 값)과 함께 1280·휴대폰 캡처를 `R1`로 남긴다.

---

## 3. 문서 골격 `htmlPage`

모든 페이지가 아래 한 골격을 쓴다(`A-WORKER` §4 "유지할 것 1"). 순서가 규칙이다.

```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F3F3F3">
  <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#1F1F1F">
  <title>{제목}</title>
  <link rel="stylesheet" href="/assets/site.{hash}.css">
  <link rel="icon" href="/assets/icon.{hash}.svg" type="image/svg+xml">
  <link rel="icon" href="/assets/favicon.{hash}.ico" sizes="32x32">
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.{hash}.png">
  <!-- 랜딩(/)에만: description, og:* (§9) -->
</head>
<body class="web">
  <a class="skip" href="#main">본문으로 건너가기</a>   <!-- skipLink -->
  <header class="site-header"><div class="col [col-reading]">   <!-- main과 같은 열 폭 -->
    <a class="site-name" href="/">치지직 다운로더</a>   <!-- 마크(D33)가 나오면 그 앞에 <img> 20px -->
    <span class="badge">비공식 도구</span>
    <nav aria-label="사이트">…</nav>   <!-- 앱 로그인 실패 계열 페이지(/auth/*)에는 [로그인] 없음 -->
  </div></header>
  <main id="main" class="col [col-reading]" [data-scale="reading"]>
    <!-- flash 알림 또는 오류 요약(둘 중 하나, §6.3) -->
    <h1>…</h1>
    …
  </main>
  <footer class="site-footer">
    <ul><li><a href="/help">도움말</a></li><li><a href="/privacy">개인정보 처리방침</a></li><li><a href="/licenses">오픈소스 라이선스</a></li></ul>
    <p>{비공식 고지 상수}</p>
    <p>{저작권 줄}</p>
  </footer>
</body>
</html>
```

| 요소 | 규칙 | 근거 | 강제 |
|---|---|---|---|
| `theme-color` | 라이트 `#F3F3F3` = `--bg`, 다크 `#1F1F1F` = `--bg`. 값은 생성기가 토큰에서 넣는다(손으로 적지 않는다) | foundations §10 Worker 행, B 후보 골격(judgment §2.2-6), brief §6.13-2 | `worker` 테스트(meta 둘 존재 + 값이 생성물 `--bg`와 같음), `design-tokens`(문서 패리티) |
| `color-scheme` meta | CSS가 로드되기 전 첫 페인트의 폼 컨트롤·스크롤바 색을 OS에 맞춘다 | `A-WORKER` §3.6(첫 페인트 흰 번쩍임), g-launch 3겹(brief §6.8-9) | `worker` 테스트 |
| `<title>` | 랜딩 `siteTitle`("치지직 다운로더 — 비공식 다시보기·클립 다운로더", D34). 그 밖은 `{화면} · 치지직 다운로더`(현행 유지). 오류·검증 실패 페이지는 **`errorTitlePrefix` "오류: "** 접두. 같은 경로의 제목은 로그인 여부에 따라 바뀌지 않는다 | D34, `G-WEB-R19`·`G-WEB-R24`(GOV.UK "Error:" 접두, `E-KO-B4`), `A-COPY` §1(같은 URL의 h1·title이 상태마다 다름) | `worker` 테스트(상태 코드 ≥ 400이면 title이 `오류: `로 시작, `/`의 title은 세션 유무와 무관) |
| skip link | `body`의 첫 요소, 글자 `skipLink`(`content.md` §10). 평소 화면 밖, `:focus`에서 `--edge` 위치에 `--surface` 면 + `1px solid var(--border-strong)` + `--radius-control` | brief §6.13-2, B 후보 `.skip`, WCAG 2.4.1 | `worker` 테스트(첫 `<a>`의 `href="#main"`과 `id="main"` 존재), `R8` |
| 헤더 | 높이 `--toolbar-h`(44), 아래 `1px solid var(--separator)`, 안쪽은 `main`과 같은 `.col`(읽기 페이지 680·UI 페이지 800). 왼콽 **이름만**(13, `--weight-strong`, 색 `--fg`, 밑줄 없음, `href="/"`). 마크(D33)가 나오면 이름 앞 `--icon-md`(20) `<img>`. 이름 옆 배지 "비공식 도구"(§3.1). 오른쪽 `<nav aria-label="사이트">`: 비로그인은 [도움말] · [로그인], 로그인은 [도움말] · [관리](관리자만) · 채널 이름(링크 아님). `/auth/*` 결과·오류 페이지에는 [로그인]을 두지 않는다(갈 곳은 본문 아래 링크 하나다: 앱 흐름이면 앱으로, 웹 흐름이면 "처음으로"의 랜딩 로그인으로 가므로 헤더에 웹 로그인 길을 하나 더 열지 않는다, `G-WEB-R24`, 검토 U-31) | D26·D34(마크 전까지 이름만, Worker 헤더에만 배지), judgment §2.3-7, `A-WORKER-3.6`(내비게이션이 화면마다 다름)·`3.2`(헤더 링크 모양) | `worker` 테스트(모든 페이지에 같은 헤더 마크업, 관리 링크는 관리자만, `/auth/*`에 로그인 링크 없음) |
| `<main id="main">` | 하나. 첫 요소는 flash 또는 오류 요약(있을 때), 그다음 `<h1>` 하나 | `G-WEB-R25`, GOV.UK 알림 배너·오류 요약(`E-KO-B4`) | `worker` 테스트(h1 정확히 1개, `main` 첫 자식 규칙) |
| 헤딩 위계 | h1 `--text-display`(17 → 읽기 22) 600, h2 `--text-title`(15 → 17) 600, h3 `--text-body` 600. h3를 UA 기본으로 두지 않는다. 읽기 척도의 랜딩 h1만 `--text-hero`(28, 600 미만 22) | foundations §3.2·§3.3, `A-WORKER-3.x`(h3가 h2보다 크다), D13(700 없음) | `design-lint` DL5(font-size·font-weight 리터럴 금지), `worker` 테스트(생성물에 `h1,h2,h3` 규칙 존재) |
| 바닥글 | 링크 셋(도움말·처리방침·라이선스) → 비공식 고지 상수 → 저작권 줄. 글자 `--text-caption`, 색 `--fg-muted`, 위 `1px solid var(--separator)`, 위아래 `--space-32` | D34(고지 4곳 중 "랜딩 바닥글"), g-legal §4(바닥글 관례), `G-ID-R1` | `worker` 테스트(모든 페이지 바닥글에 고지 상수 포함), `design-copy`(두 deck의 고지 문자열 동일) |
| 저작권 줄 | 앱 라이선스 결정(D58) 전까지 `copyright` 상수("© {year} {owner}. 모든 권리 보유.", `content.md` §11) | D58, `G-LEGAL-D1` | `design-copy` DC6(문자열 상수 하나) |
| 셀렉터 | 요소 이름 전역 규칙은 `html`·`body`·`h1~h3`·`p`·`a`·`code`·`pre`·`table`·`th`·`td`·`ol`·`ul`·`details`·`summary`·`input`·`button`·`label`에만. 그 밖은 클래스(`.site-header`·`.btn`·`.field`·`.notice`·`.scroll`…) | `A-WORKER` §3.6(`header{}` 전역 규칙이 카드 안 `<header>`에 번진다), 클래스 체계 부재 | `design-lint`(허용 요소 셀렉터 목록) |

### 3.1 배지 "비공식 도구"

헤더의 "비공식 도구"는 Badge 컴포넌트(`components.md`)와 같은 모양이다: `--surface-2` 면, `--fg-muted` 12px 600(`--text-caption`), 높이 `--badge-h`(18), 가로 패딩 `--space-6`, 반경 **`--radius-badge`(4)**. C 후보가 pill이라 불렀지만 알약 반경은 스위치·진행 막대에만 쓴다(D18, `E-APPLE-20`). 색이 없는 이유: 고지는 경고도 위험도 아니다(D10 정보 톤 = 중립). 읽기 척도 페이지에서는 `--text-caption`이 13이 되고 높이는 `min-height`라 따라 늘어난다.

근거: D34(Worker 헤더에만), judgment §2.3-7, C2(비공식임이 첫 화면에). 강제: `worker` 테스트(모든 페이지 헤더에 배지 문자열), `design-copy`(문자열 상수).

---

## 4. CSP 안의 구현

CSP는 그대로다(worker.md, `A-WORKER` §6.1): `default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' <치지직 인가 출처>; frame-ancestors 'none'; base-uri 'none'`. 예외는 로그인 확인 페이지 하나로, `form-action`에 `http://127.0.0.1:*`이 더 붙는다([계속] POST → 치지직 → 콜백 → 루프백 303 사슬에도 `form-action`이 적용되는 브라우저가 있다, `worker.md` 구현 중 변경 88 (가), `pages.ts` `htmlHeaders({ loopbackFormAction })`). 이 시스템은 그 예외를 넓히지 않는다. JS는 계속 없다(D52).

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 스타일시트 | **한 파일** `/assets/site.{hash}.css` = 토큰 생성물 + `design/ui.css` + 웹 전용 CSS `worker/src/http/site.css`를 생성기가 이어 붙인 문자열 상수(`worker/src/http/site-css.generated.ts`). 압축은 생성기 | `A-WORKER` §6.2(외부 CSS 한 파일이 가장 싸고 CSP 그대로)·§6.4 A안·§8(한 줄 압축이 읽기 어렵다), judgment §1.4(A 재촬영 기록 7) | `design-tokens` DT1(`--check`: 생성물 ≠ 원천이면 실패), `worker-config`(`<link rel="stylesheet">` 1개) |
| 해시 | 경로의 16 hex는 생성기가 계산해 상수에 쓴다. 손으로 갱신하지 않는다 | `A-WORKER` §6.3(지금은 테스트가 수동 갱신을 안내), 기존 `site-css.test.ts` | `worker` 테스트(해시 = SHA-256 앞 16 hex, 기존 테스트 유지) |
| 금지 | `<style>`, `style=`(SVG 안 포함), `<script`, `url(`, `@import`, `data:`, 외부 출처. 모두 소스 문자열 수준에서 막는다 | `A-WORKER` §6.2, worker.md 구현 중 변경 39(`checkHtmlSources`), g-web §7.2 | `worker-config`(기존 검사 유지 + `url(`·`@import`를 생성물에도 적용) |
| 에셋 표 | `GET /assets/:file`은 **표**(`ASSETS: { [이름]: { body, contentType, hash } }`)를 조회한다. 항목: `site.css`, `icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og.png`. 모두 `Cache-Control: public, max-age=31536000, immutable`(no-store의 유일한 예외 범위를 worker.md에 갱신) | `A-WORKER` §6.3(핸들러 일반화), `G-ID-R10`, `G-WEB-R13`·`G-WEB-R16`(OG 이미지 주소는 해시 경로) | `worker` 테스트(표의 모든 항목이 200·올바른 `Content-Type`·immutable, 표 밖 이름은 404), `worker-config`(에셋 바이너리는 `worker/assets/` 아래 체크인된 파일에서 생성기가 base64 상수로 만든다: 소스에 `data:` 없음) |
| 바이너리 에셋의 원천 | `worker/assets/{icon.svg, favicon.ico, apple-touch-icon.png, og.png}`를 체크인하고, 생성기가 `assets.generated.ts`로 만든다. 파일은 `app/src-tauri/icons/` 원본과 같은 과제(D33)에서 나온다 | `G-ID-R6`(전경·배경 분리 원본에서 생성), D33 | `design-icons`(원본 ↔ 생성물 `--check`), `scan`(이미지에 채널명·캡처 없음은 사람이 본다: `R1`) |
| 아이콘 | Lucide path를 `icons.ts`와 같은 원천에서 생성한 `worker/src/http/icons.generated.ts`. 그리는 함수는 `src/http/icon.ts`의 `icon(name)` 하나: `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor">` + path마다 `vector-effect="non-scaling-stroke"`(상속되지 않는 속성이라 루트에 달면 효과가 없다). 굵기는 CSS `.icon path { stroke-width: var(--icon-stroke) }`(ui.css, 앱과 같다). 숨은 스프라이트(`<svg style="position:absolute">`)는 쓰지 않는다 | D31·D32, foundations §9, `J-F-A3`, `A-WORKER` §7.1-3 | `design-icons` DI3·DI1(세트·버전 메타 일치, 앱·Worker 원천 동일, stroke CSS), `worker-config`(`<svg`는 `icon.ts`에만, `style=` 0) |
| 표현 속성 | SVG의 `fill`·`stroke`는 속성으로 쓴다(CSP 스타일 규칙 대상이 아니다). 색은 `currentColor`만, `stroke-width` 속성 리터럴은 없다 | `A-WORKER` §6.2, foundations §9 색 행 | `design-icons` DI3 |
| 폼 | `method="post"` + hidden `csrf` + `application/x-www-form-urlencoded`. 동작은 폼과 링크뿐 | worker.md §8.1 CSRF 세 겹, D52 | `worker` 테스트(기존 Origin × 토큰 6사례) |

---

## 5. 랜딩 구조

랜딩은 소영(Mac·설치 장벽, users §1.3)의 첫 화면이다. 순서가 규칙이고, 아래 번호가 DOM 순서다. B 후보의 골격(brief §6.13-2를 유일하게 다 지킴, judgment §2.2-6)에 g-web·g-install의 규칙을 얹었다.

### 5.1 순서

| # | 블록 | 내용 | 조건 | 근거 |
|---|---|---|---|---|
| 1 | 휴대폰 안내 | Notice(중립, 아이콘 `monitor`): `mobileBlock`(제목·본문), 읽기 전용 입력 칸(`readonly`, `components.md` §0.3: 면 `--surface-2`, 값 = 이 페이지 주소, 라벨 "이 페이지 주소"), 한 줄 `mobileHint`(카카오톡 ‘나와의 채팅’에 붙여넣어 컴퓨터에서 열어도 된다) | `entryContext.kind === "phone"`일 때만. 그 아래 내용은 **그대로 이어진다**(숨기지 않는다) | `G-WEB-R1`~`G-WEB-R4`(UA `Mobi` 또는 `Sec-CH-UA-Mobile: ?1`만, 순서와 강조만 바꾼다, QR·공유 버튼 없음), brief §6.13-5 |
| 2 | 히어로 | `<h1>` = `siteName`("치지직 다운로더", hero 척도) + lead `landingLead`(`--leading-read`, "본인 채널의 영상만"·"허가받은 채널만") | 항상 | C8(사전 고지), D34 title, `content.md` §4(h1은 앱 이름) |
| 3 | 비공식 고지 | Notice(중립, 아이콘 `info`): `NOTICE_SHORT`. **스크롤 없이** 보인다(히어로 바로 아래, 1280×800과 390×844에서) | 항상 | D34(히어로 바로 아래), C2, `G-ID-R1` |
| 4 | CTA | **유일한 채움 버튼** `.btn.btn-primary.btn-lg`(높이 `--control-h-lg` 36, 글자 `--text-title` 600). 비로그인: [치지직으로 로그인](`form action="/auth/web/start"`), 바로 위에 로그인 전 고지 네 줄(§5.3)과 `loginForFiles`("로그인하면 내 컴퓨터용 설치 파일이 보여요."). 허가 사용자: [{내 OS}용 받기] 링크 버튼 + meta 줄(`.num`, `--fg-muted`): "버전 {0.1.2} · {2026. 10. 3.} · {최소 OS} 이상". macOS면 다음 줄에 **늘** `appleSiliconOnly`. 좁은 레이아웃에서 버튼은 전폭 | 항상 | D53(36, 유일한 채움), P3, `G-WEB-R5`·`G-WEB-R6`·`G-WEB-R26`(최소 OS 한 줄, `Accept-CH` 안 씀), `G-INSTALL-R12`(`v` 없음), D42("macOS용 받기"), 검토 U-11 |
| 5 | 경고 예고 | 한 줄 "처음 열 때 경고가 나올 수 있어요. 앱이 문제라는 뜻이 아니에요." | 허용 사용자 | `G-INSTALL-R1`, brief D53 근거 |
| 6 | 다른 운영체제 | `<details>` "다른 운영체제": `<table>`에 `<caption>설치 파일(버전 {0.1.2})</caption>`, `th scope="col"`(운영체제·파일·최소 버전), 행머리 `th scope="row"`. 파일명은 `.num`이 아닌 `code`. 감지 실패(`unknown`·`bot`)면 4번의 큰 버튼을 만들지 않고 이 표를 `<details open>`으로 펼친다 | 허용 사용자 | D53, brief §6.13-2(caption·scope), `G-WEB-R2`·`G-WEB-R5`(틀려도 모든 행이 한 번의 탭 안에), `A-WORKER` §3.3(scope·caption 없음) |
| 7 | 설치하기 `<h2 id="install">` | 감지한 OS 절은 `<details open>`, 다른 OS 절은 `<details>`(닫힘). 감지 실패면 셋 모두 `open`. 각 절은 `<ol>` 단계(한 단계 한 동작, macOS 3단계 이하). **macOS**: `macDamaged` 문단 → ① `macMove` ② `macOpenAnyway`(처음 열 때 경고가 나오면 **시스템 설정 › 개인정보 보호 및 보안 › 그래도 열기**) [잠정, §14-1] ③ `macTerminal`(그 단추가 없으면 터미널에 아래 한 줄) — `<pre><code class="selectable">xattr -dr com.apple.quarantine "/Applications/치지직 다운로더.app"</code></pre>` + `macXattrNote`(두 문장: 표시만 지운다 / 다른 명령은 사기). **Windows**: `winSac`(경고 Notice `--warning-soft`, 단계 **앞**: 스마트 앱 컨트롤을 끄면 되돌릴 수 없으니 관리자에게 먼저 묻기) → ① `winSmartScreen`(‘PC 보호’ 창 → ‘추가 정보’ › ‘실행’). **Linux**: AppImage는 `libfuse2`(24.04는 `libfuse2t64`) + 실행 권한 한 줄, `.deb`는 `apt install ./…`("관리자 권한이 필요할 수 있어요") | 항상(비로그인에서도 읽을 수 있다) | D53·D55("그래도 열기" 경로 먼저 + xattr 폴백), D52(복사 버튼 대신 선택 가능한 코드 + 사기 경고), `G-INSTALL-R2`~`G-INSTALL-R8`, `G-PRIVACY-R2`, `G-HELP-H5`(앵커 id는 `<details>` 밖 = h2에만), 검토 U-37(비가역 경고는 행동 앞), 앱 이름은 `productName`(worker-config `checkLandingAppName`) |
| 8 | 파일 확인(선택) | `<details>` "파일 확인(선택)": 한 문장 + `<table>`(`caption`, `th scope`, 열: 파일·SHA-256 `code.selectable`). 해시는 주 표에서 **여기로 이동**한다 | 허용 사용자 | `G-WEB-R27`, g-install §4-7, D53. worker.md §9.5 "SHA-256 텍스트" 변경 → §14 |
| 9 | 처음 열면 로그인해요 `<h2 id="login">` | 한 문단: 앱에서 [치지직으로 로그인]을 누르면 브라우저가 열린다 / 받는 것은 채널 이름과 채널 ID / 네이버 비밀번호는 받지 않는다 / 허가되지 않으면 이유와 다음 할 일을 앱이 알려 준다 / `loginTwice`("이 페이지에서 로그인했어도 앱을 처음 열 때 한 번 더 로그인해요.") | 항상 | C7, B 후보 절, `G-PRIVACY-R9`·`G-PRIVACY-R17`, 검토 U-11 |
| 10 | 막히면 `<h2 id="help">` | 한 문단: `/help` 링크 + `content.md` §11 "문제가 있을 때" 상수 + 연락 수단 `landing.contact`(자리표시, 출시 전 사람이 채운다) | 항상 | B 후보 절, `G-INSTALL-R14`(문의 경로), `G-PRIVACY-R16`, D51, 검토 U-07 |
| 11 | 내 기기 `<h2>` | 표(§7) + 설명 "모르는 기기가 있으면 끊어 주세요." + [끊기] | 허용 사용자 | worker.md §8.2 |
| 12 | 로그아웃 | 테두리 버튼 하나 | 허용 사용자 | §7.2 의미 표 |

강제: `worker` 테스트 `views.test.ts`·`landing.test.ts` 확장 — (a) phone이면 1번이 로그인 폼보다 앞이고 설치 파일 행은 모두 있다(g-web V2), (b) mac이면 macOS 행이 맨 위이고 "Apple Silicon" 문구가 UA와 무관하게 있다, (c) unknown·bot이면 큰 버튼이 없고 표가 `open`이다, (d) 채움 버튼(`.btn-primary`)은 응답당 정확히 1개, (e) 고지 상수가 `<h1>` 뒤 첫 Notice에 있다, (f) `/?openExternalBrowser=1`과 `/`의 본문이 같다(`G-WEB-R11`), (g) `Accept-CH`가 어떤 응답에도 없다(R6), (h) 본문에 `/\bv\d+\.\d+/`가 없다(g-install 검증 4), (i) 단계 `<li>`에 `1.`·`2.`가 문자열로 박혀 있지 않다(`design-copy`). 키보드만으로 완주한 기록은 `R8`.

### 5.2 현재 코드와 다른 결정

- **h1은 로그인 여부와 무관**하게 같은 문장이다. 현재 비로그인 h1은 사이트 이름, 로그인 h1은 "다운로드"다(`landing-view.ts` `anonymousBody`·`memberBody`, a-copy §1 "같은 URL의 h1이 상태에 따라 달라진다"). "다운로드"는 앱에서 받은 영상 목록을 뜻하므로 랜딩 제목으로 쓰지 않는다(D42·D43).
- **설치 안내는 로그인 전에도 보인다.** 지금은 허용 사용자만 본다(`downloadsBody`). 파일 링크만 인증 뒤에 둔다(`/releases` 자격은 worker.md §4.3). 소영의 "수상한 앱" 불안(users §1.3)은 받기 전에 설치 과정을 읽을 수 있어야 줄어든다. 근거 등급은 E1(설계 판단)이고 D62 과업 "랜딩 → 설치"에서 확인한다.
- **크기는 보이지 않는다**(요청당 R2 2회 상한, worker.md 구현 중 변경 38 (가)). 목업의 "24.1MB"는 쓰지 않는다. 표의 열은 운영체제·파일·최소 버전이다.
- **macOS "그래도 열기"** 단계는 D53·D55가 정한 것이지만 worker.md 구현 중 변경 45의 실기기(2026-10-07)는 "손상 경고에 [그래도 열기] 길이 없다"고 적었다. 두 기록이 어긋난다 → §14-1. 이 문서는 결정 표(D55 "그래도 열기 우선·xattr 폴백")를 따르고 **[잠정]**으로 둔다. 확인: README §6-11(ad-hoc 서명 실기). ad-hoc 서명이 들어가면 ②가 통하고, 안 들어가면 ②를 지우고 ③만 남긴다. 실기 전까지 참조 목업·갤러리 고정 데이터는 ②를 "그 단추가 없으면" 조건문으로 그린다(사실처럼 보이지 않게, 검토 U-11).

### 5.3 로그인 전 고지(비로그인 CTA 위)

[치지직으로 로그인] 바로 위에 `landing.consent.*` 네 줄(`--leading-read`, 색 `--fg` — 신뢰 판단 글자라 muted가 아니다; 앱 로그인 화면 `auth.consent`도 같다): 받는 것(채널 이름·채널 ID) / 쓰는 곳(허가 확인·내 기기 표시) / 받지 않는 것(네이버 비밀번호) / **끊는 길**(로그인한 기기는 ‘내 기기’에서 끊을 수 있다) + "[개인정보 처리방침]" 링크 + `loginForFiles`. 문장은 `content.md` §11·§15.3이 소유한다.

근거: `G-PRIVACY-R17`(로그인 버튼이 있는 모든 화면), 개인정보 보호법 제15조 제2항 네 가지, C7(왜·무엇·어디까지·어떻게 끊나, 검토 U-04). 강제: `worker` 테스트(로그인 폼이 있는 응답에 `/privacy` 링크와 네 항목 문장이 있다), `design-copy` DC6.

---
## 6. 상태 표현: 로그인 결과·안내·오류·알림

웹에는 토스트·대화상자가 없다. 상태는 **Notice 한 가지**(components.md의 Notice, tone × 형태 중 `inline`·`banner`)와 제목·아이콘·문구로 전한다. 색만으로 전하지 않는다(P2, foundations §2.7: forced-colors에서 색이 사라진다).

### 6.1 로그인 결과 `/auth/done`

현재 모든 상태가 같은 `<h1>로그인 결과</h1>` + 문단이다(`A-WORKER` §3.5). 상태마다 제목·아이콘·톤이 다르다. 루프백(v0.3.0) 뒤 앱 흐름은 ok·denied·cancelled·failed 모두 브라우저를 앱 수신기로 보내므로(`worker.md` 구현 중 변경 88 (마)), 이 페이지에 오는 것은 **웹 흐름**(랜딩 로그인)의 denied·cancelled·failed와 앱 흐름의 **grant 없는 failed**(흐름 결합 쿠키 불일치·state 형식 밖·배포 전 옛 흐름 등, 88 (나) 콜백 표)뿐이다. 앱 흐름의 루프백 303은 F 쿠키를 지우므로(`auth.ts` `toLoopback`) F로 앱 흐름의 denied·cancelled·ok를 다시 찾는 길도 없다. 그래서 denied·cancelled 문구는 "앱에서"를 말하지 않는다. 흐름 종류는 F 쿠키로 찾은 `doneView.kind`이고, 없으면 앱 흐름 쪽 문구를 쓴다(앱 사용자가 다수다).

| 상태 | `<title>` | `<h1>` | 아이콘(색) | 본문 | 다음 행동 |
|---|---|---|---|---|---|
| ok | 로그인했어요 · 치지직 다운로더 | `doneOk.title` | `circle-check` `--fg-muted` | 없음(어느 흐름인지 말하지 않는다) | 링크 하나: "처음으로". 콜백은 ok로 이 페이지에 보내지 않는다: 웹 ok는 303 `/`(F 삭제)에 flash "로그인했어요"(§6.3), 앱 ok는 앱 수신기 페이지(§6.5)다. 이 행은 `/auth/done?r=ok`를 손으로 연 경우뿐이다 |
| denied(웹 흐름) | 이 채널은 사용 허가가 없어요 · … | `doneDenied.title` | `circle-x` `--danger-ink`(막힘 = danger, `components.md` §2.12 tone 기준. 앱의 거부 화면과 같은 은유) | Notice(중립): "채널: {이름} · 채널 ID: {id}"(본인에게 비밀이 아니다, worker.md §8.3) → `doneDenied.body` → `doneDenied.next`("허가를 받은 뒤 다시 로그인해 주세요.") | 링크 하나: "처음으로"(랜딩에 로그인 폼이 있다). 이 페이지에 폼을 두지 않는다 |
| cancelled(웹 흐름) | 로그인을 취소했어요 · … | `doneCancelled.title` | `info` `--fg-muted` | `doneCancelled.body`("처음 화면에서 다시 로그인할 수 있어요.") | 링크 하나 |
| failed | 오류: 로그인하지 못했어요 · … | `doneFailed.title` | `circle-x` `--danger-ink` | 앱 흐름이거나 흐름을 모르면 `doneFailed.body`("앱에서 다시 시도해 주세요."), 웹 흐름이면 `doneFailed.webBody`("처음 화면에서 다시 로그인해 주세요.") + `inApp === "kakao"`일 때만 `inAppHint` 한 단락(앱 안 화면에서는 끊길 수 있으니 기본 브라우저에서 열기) | 링크 하나 |

근거: D10(성공색 없음 → 완료는 `check` 계열 + 글자), foundations §9.1 은유 표(오류 `circle-x` ≠ 경고 `triangle-alert`), C8(거부 화면에 원인·본인 채널 정보·다음 행동, 검토 U-12), `G-WEB-R9`(인앱에서도 막지 않고 실패 뒤에만 보충)·`G-WEB-R24`(링크는 갈 곳 하나), `A-COPY` §1(`채널: 이름 · 채널 ID: id` 콜론 대칭). 고지는 붙이지 않는다(`G-ID-R3`). 강제: `worker` 테스트(상태별 h1·아이콘 이름·title 접두, 인앱 보충 단락은 `failed` × `kakao`에만, `/auth/*` 헤더에 로그인 링크 없음), `design-icons` DI4(은유 유일성), `design-copy` DC8.

### 6.2 안내·오류 페이지(4xx·5xx)

`noticePage`의 제목 "안내" 하나를 **상태별 제목**으로 바꾼다. 형식: `<title>오류: {h1} · 치지직 다운로더</title>`, `<h1>`에 무슨 일인지, 본문에 다음에 할 일, 링크는 **갈 곳 하나**(오류가 난 화면). 상태 코드·`bad request`·`not_found` 같은 말은 화면에 없다.

| 상황 | h1(키) | 본문·링크 |
|---|---|---|
| 로그인 주소 만료·잘못됨(404) | `linkGone.title`(로그인 주소가 만료됐어요) | `linkGone.body`("앱에서 다시 로그인해 주세요.") |
| 이미 사용한 주소(409) | `linkUsed.title`(이미 사용한 로그인 주소예요) | 같은 본문 |
| csrf·Origin 불일치(403) | `badRequest.title`(요청을 확인할 수 없어요) | `badRequest.body`("페이지를 새로 연 뒤 다시 시도해 주세요.") + 링크 "{원래 화면} 새로 열기"(`/` 또는 `/admin`) |
| 관리자 아님(403) | `adminOnly.title`(관리자만 볼 수 있어요) | 링크 "처음으로" |
| 요청 잦음(429)·바쁨(503) | `rateLimited.title`(요청이 너무 많아요) / `busy.title`(지금은 로그인 요청이 많아요) | `retryLater.body`("잠시 뒤 다시 시도해 주세요.") + 링크 |
| 형식 오류(400·415) | `badFormat.title`(요청 형식이 맞지 않아요) | 링크 |
| 옛 앱(200, 예약 handle) | `outdatedApp.title`(앱을 업데이트해야 해요) | `outdatedApp.body`("이 사이트 첫 화면에서 새 버전을 받아 설치해 주세요.") + 링크 "처음으로". 상태 코드가 200이라 `<title>` 접두 "오류: "는 붙지 않는다. 아이콘은 4xx와 같은 `triangle-alert` `--warning-ink`(사용자가 할 일이 있고 되돌릴 수 있다) |
| 검증 오류 | §6.3 오류 요약(같은 페이지 400) | — |

아이콘: 4xx는 `triangle-alert` `--warning-ink`(사용자 잘못이 아니거나 되돌릴 수 있다), 5xx는 `circle-x` `--danger-ink`. 빨간 글씨만으로 경고하지 않는다(GOV.UK problem pages, `G-WEB-R24`). 문구는 `content.md` §15.3("링크"가 아니라 "주소", "잠시 뒤").

근거: `G-WEB-R24`·g-web G6·g-web G7, `A-WORKER` §3.5·§4 나쁜 점 5, D51(L0 제목+본문+동작). 강제: `worker` 테스트(≥400 응답마다 h1 ≠ "안내", title 접두, 링크 정확히 1개), `design-copy`(제목·본문에 코드·HTTP 번호 금지).

### 6.3 flash 알림과 오류 요약(무스크립트 폼)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| PRG | 상태를 바꾸는 POST가 성공하면 `303`으로 GET 페이지로. 성공을 POST 본문에 그리지 않는다 | `G-WEB-R17`, brief §6.13-3 | `worker` 테스트(성공 POST 모두 303) |
| flash | 일회용 `__Host-cdl_flash`(60초, `HttpOnly`, `SameSite=Lax`, `Path=/`). GET이 읽고 같은 응답에서 지운다. 값은 고정된 알림 종류 코드 + 표시용 값만(비밀값 없음) | `G-WEB-R18`·`G-WEB-R23`, Django 메시지(F43) | `worker` 테스트(303 뒤 GET 한 번만 알림, 두 번째 GET엔 없음, 쿠키 값에 토큰 없음 `hygiene.test.ts`) |
| flash 모양 | Notice `banner`: `--surface-2` 면(정보) 또는 `--warning-soft`(세션 만료·이미 처리됨), 아이콘 + 한 문장, `<main>` 첫 자식, `<h1>` 바로 앞, 폭 = 열 폭, 한 화면에 하나, 자동으로 사라지지 않음, 닫기 버튼 없음(JS 없음. 다음 이동에서 사라진다) | D37(배너는 h1 앞 한 장), `G-WEB-R25`, GOV.UK 알림 배너(`E-KO-B4`) | `worker` 테스트(`main`의 첫 자식이 `.notice` 또는 `h1`), `R7` |
| 오류 요약 | 검증 실패는 **같은 페이지를 400**으로 다시 그리고 입력값을 채워 둔다. `<main>` 첫 자식에 Notice(`--danger-soft`, `circle-x`): 제목 "확인해 주세요" + 필드로 가는 링크 목록(`href="#field-id"`), 필드 옆에 같은 문구, 필드에 `aria-invalid="true"` + `aria-describedby`, `<title>` 앞 "오류: ". 자동 포커스 이동이 없으므로 읽는 순서에서 먼저 나오게 한다 | `G-WEB-R19`·g-web G4(GOV.UK 오류 요약·validation, `E-KO-B4`), C6(입력값을 지우지 않는다) | `worker` 테스트(400 본문에 입력값 그대로(이스케이프), 요약이 `main` 첫 자식, 링크 `href`가 입력 `id`와 일치, `title` 접두) |
| 둘의 공존 | 같은 화면에 flash와 오류 요약이 함께 나오지 않는다(오류가 있으면 성공은 없다) | `G-WEB-R25` | `worker` 테스트 |
| 멱등 | 삭제·끊기 계열은 이미 처리된 대상이면 오류가 아니라 `303` + flash `alreadyDone`("이미 처리됐어요."). `404`는 형식이 틀린 경로에만 | `G-WEB-R20`·g-web G2, GOV.UK 버튼(서버 중복 방어) | `worker` 테스트(같은 삭제 POST 두 번 모두 303) |
| 세션 만료 POST | `303 /` + flash(경고 톤) `sessionGone`("로그인이 만료됐어요. 다시 로그인한 뒤 같은 동작을 해 주세요."). 폼 값은 보존하지 않는다 | `G-WEB-R23`·g-web G1 | `worker` 테스트 |

flash와 `seeOther` "쿼리 없는 두 곳" 계약의 보완은 worker.md 구현 중 변경이 필요하다(§14).

### 6.4 로그인 확인 페이지(확인 코드 없음)

`<h1>치지직 다운로더 로그인</h1>`(`loginTitle`) → 경고 Notice(`--warning-soft` + `triangle-alert`, `loginWarning` 세 문장: 앱에서 직접 시작한 로그인이 아니면 창을 닫아 달라는 것, 다른 사람이 보낸 주소라면 계속하지 않기, **로그인 뒤 주소창에 나오는 주소를 다른 사람에게 보내지 않기**(루프백 주소창 grant + 사회공학 잔여 위험, `worker.md` 88 (라))) → [계속](이 페이지의 유일한 채움 버튼, `A-WORKER-3.1` "가장 중요한 동작이 primary가 아니다" 해소). 확인 코드 블록·`letter-spacing`·`.code` 글자 크기는 **없다**(루프백 전환으로 코드 대조가 사라졌다, `patterns.md` §13·§17-6; 초안 §13-1의 큰 숫자 토큰 요청도 함께 사라졌다). 휴대폰·인앱에서도 [계속]은 동작하고 새 차단을 더하지 않는다(`G-WEB-R12`). 단계 자체는 남는다(§1). CSP `form-action` 예외는 §4.

강제: `worker` 테스트(채움 버튼 1개, 경고 Notice 존재, 코드 요소 없음, 경고 세 문장 — 지금 `login-app.test.ts`가 세 문장과 코드 문구 없음을 본다), `design-copy`.

### 6.5 앱 수신기 결과 페이지(Worker 밖)

앱 흐름 로그인의 마지막 화면은 Worker가 아니라 앱 셸의 1회용 수신기(`crates/shell/src/auth/loopback.rs`)가 `127.0.0.1`에서 그리는 페이지다(`app.md` 구현 중 변경 65 (가)·66 (라)). 출처가 달라 Worker 스타일시트·에셋을 쓸 수 없고(`'self'`가 루프백이다), 응답은 외부 리소스·스크립트 없이 인라인 `<style>` 한 블록과 `data:` 아이콘이다(CSP `style-src 'unsafe-inline'; img-src data:; form-action 'none'`). 이 시스템의 규칙 중 여기에 적용하는 것:

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 문구 | `ReceiverPage` 상수 여섯과 `PAGE_REJECTED`. 값은 `content.md` §15.4. 바깥 값(채널 이름)을 넣지 않는다. 결과 첫 문장은 §6.1의 Worker 제목과 같다 | `content.md` §2 두 deck 공통 상수, `app.md` 66 (라) | `rust`(`crates/shell/tests/auth_loopback.rs`의 문구 표가 여섯 값을 고정한다. 문구를 바꾸면 같이 고친다), `R3` |
| 색 | 지금 `#fff`/`#111`(다크 `#111`/`#eee`) 리터럴이다. 적용 단계 (f)에서 foundations `--bg`·`--fg`의 라이트·다크 hex로 바꾼다(생성기가 Rust 상수를 쓸지, 셸 테스트가 foundations 값과 대조할지는 그 PR이 정한다) **[잠정]** | foundations §2(한 원천), D7(OS 다크만 따름) | `rust`(값 대조, (f)에서) |
| 글꼴·크기 | `system-ui, sans-serif`, 18px, 가운데 한 문단. 앱·Worker의 `--font-sans` 스택과 다르지만 브라우저 탭에서 잠깐 보는 한 줄이라 토큰 척도를 강제하지 않는다 [취향] | — | — |
| 범위 | 이 페이지에는 헤더·바닥글·고지·버튼이 없다(앱으로 돌아가라는 한 문장뿐). Worker 골격(§3)과 `design-worker`의 정적 HTML 목록에 넣지 않는다 | `worker.md` 88 (마)(외부 참조 없음 테스트) | — |

---
## 7. 버튼·폼·위험도

### 7.1 컨트롤

| 요소 | 클래스 | 치수·색 | 근거 | 강제 |
|---|---|---|---|---|
| 채움 버튼 | `.btn.btn-primary` | 높이 `--control-h`(28, 랜딩 CTA만 `.btn-lg` 36), 가로 패딩 `--space-12`, `--accent` 면 + `--on-accent` 글자, 눌림 `--accent-pressed`, 반경 `--radius-control`. **페이지당 하나** | D16·D35·P3, components.md Button | `worker` 테스트(응답당 `.btn-primary` ≤ 1), `design-lint` |
| 테두리 버튼 | `.btn.btn-secondary` | `--surface` 면 + `1px solid var(--border-strong)` + `--fg` 글자, 눌림 `--surface-2`. hover 없음 | D19(의미 경계 3:1), D21(테두리 버튼 hover 없음), `A-WORKER` §2.6(현재 1.35:1) | `design-tokens`(경계 쌍), `design-lint` |
| 위험 테두리 버튼 | `.btn.btn-secondary.tone-danger` | 글자·테두리 `--danger-ink`, 눌림 `--danger-soft`. 채움 위험 버튼은 없다 | D36(파괴 = 빨간 글자 테두리), foundations §2.3(`--danger` 채움 버튼 금지) | `design-lint` |
| 글자 버튼 | `.btn.btn-ghost` | 글자 `--fg`(앱과 같다, README D21), hover `--surface-2`, 눌림 `--surface-pressed` | D21, `components.md` §2.1 | — |
| 링크 버튼 | `a.btn` | 버튼과 같은 모양, 밑줄 없음, `cursor: pointer` | A 후보 결함 2(CTA에 링크 밑줄이 덮어씌워짐) | `design-gallery` |
| 입력 | `.field` | 높이 `--control-h`, `--surface` 면 + `1px solid var(--border-strong)`, `--radius-control`, 폭 100%, 라벨은 **위**에 `<label for>`(블록, `--gap-label` 6 아래), 보조 설명은 라벨 아래 `--text-caption`. 채널 ID 입력은 `--font-mono`. 읽기 전용(`readonly`)은 `--surface-2` 면(`components.md` §0.3). 오류 `aria-invalid="true"` → 테두리 `--danger-ink` + 옆 문구 | foundations §2.3(흰 면 = 만질 수 있는 것), `A-WORKER-3.x`(인라인 라벨 + 100% 입력이 밀린다, mono 아님), `G-WEB-R19` | `worker` 테스트(모든 `<input>`에 짝 `<label for>`), `design-gallery`(axe label) |
| 인라인 폼 모음 | `.actions` | `display: flex; gap: var(--gap-sibling); flex-wrap: wrap` | `A-WORKER` §3.1(버튼 간격을 공백 문자에 맡긴다) | `design-lint` |
| `<details>` | `.disclosure` | `--surface` 면 + `1px solid var(--separator)` + `--radius-group`(10), `summary`는 `min-height: var(--row-h)`(36), `--weight-strong`, chevron 아이콘 `chevron-right`(열리면 CSS로 `chevron-down`은 만들지 않고 `rotate(90deg)`: 아이콘은 정지 글자 요소가 아니다) | D18·foundations §6.3, components.md Disclosure | `design-lint`(`transform`은 아이콘에만 허용) |
| 비활성 | — | 쓰지 않는다. 폼은 서버가 거른다 | GOV.UK 버튼(비활성 버튼은 대비가 낮고 혼란), `G-WEB-R22` | `worker` 테스트(`disabled` 속성 0개) |

터치 값(`any-pointer: coarse` 40/44)은 생성물의 토큰 블록이 알아서 올린다(foundations §5.1). 컴포넌트 CSS에 `@media (pointer…)`를 쓰지 않는다(`design-lint`).

### 7.2 버튼 의미 표(현재 동작 전수)

| 동작 | 위치 | variant·tone | 확인 단계 | 이유 |
|---|---|---|---|---|
| 치지직으로 로그인 | 랜딩(비로그인) | primary | — | 그 페이지의 다음 단계 |
| {OS}용 받기 | 랜딩(허용) | primary(링크 버튼, lg) | — | 유일한 채움 |
| 계속 | 로그인 확인 | primary | — | `A-WORKER` §3.1 결함 해소 |
| 로그아웃 | 랜딩 | secondary | 없음 | 되돌리기 쉽다(다시 로그인) |
| 끊기(내 기기·관리자 세션) | 표 행 | secondary(neutral) | 없음 + flash | `G-WEB-R21` (가). 끊긴 기기는 다시 로그인한다 |
| 추가 | 관리 › 허가한 채널 | primary | 없음 + flash | 관리 페이지의 다음 단계. 페이지당 채움 하나 |
| 허가(거부된 시도) | 표 행 | secondary | 없음 + flash | (가) |
| 지우기(거부 기록) | 표 행 | secondary(neutral) | 없음 + flash | 비파괴. 지금 `danger`인 것은 과용(`A-WORKER` §3.1, D54) |
| 허가 빼기…(허가한 채널) | 표 행 | secondary(neutral) **링크 버튼** → 확인 페이지 | **확인 페이지 한 번** | (나). 모든 세션이 끊기고 되돌릴 수 없다. 라벨 끝 말줄임(창을 연다, `content.md` §5.2) |
| 허가 빼기(확인 페이지 최종) | 확인 페이지 | secondary **tone=danger** | — | 최종 단계에서만 위험 표시(GOV.UK warning button) |

`tone=danger`는 "되돌릴 수 없는 것"에만 쓴다(D54, `G-WEB-R22`). 근거: `A-WORKER-3.1`(의미 규칙 없음: 끊기·빼기·지우기는 danger, 로그아웃은 일반), D35·D36. 강제: `worker` 테스트(`.tone-danger`는 `/admin/…/disallow` 확인 페이지 응답에만 있다), `design-copy` DC1(라벨 어휘: 끊기·빼기·지우기·허가·추가는 `content.md` 용어집. "허용"은 금지어).

### 7.3 확인 페이지(허가 빼기)

`GET /admin/<channelId>/disallow`(상태 변경·감사 기록 없음) → `<h1>` `confirmDisallow.title`("이 채널의 허가를 뺄까요?") → 요약 목록(`<dl>`: 이름 · 채널 ID(`.num` mono) · 활성 세션 수) → `confirmDisallow.body` → `.actions`: **왼쪽 [허가 빼기]**(`audit.disallow`, `btn-secondary tone-danger`, 폼 하나) · **오른쪽 링크** `confirmDisallow.back`("허가한 채널 목록으로", `/admin`). 폼 요소는 최종 버튼의 폼 하나뿐이다. 채움 버튼은 없다.

배치는 D36(파괴 동작은 왼쪽 빨간 글자, 안전한 쪽은 오른쪽)을 따르되 웹 페이지라 Enter 기본 버튼 개념이 없으므로 오른쬭은 링크다(`patterns.md` §14.5도 이렇게 적는다). 근거: D54, `G-WEB-R21`(나)·`G-WEB-R22`(MoJ confirm-an-action, WCAG 3.3.4 G168), D36. 강제: `worker` 테스트(GET은 DO 상태를 바꾸지 않는다, 폼 1개, `.tone-danger` 1개, 돌아가기는 `<a>`), `R6`(대화상자·확인 흐름 체크리스트: 웹 확인 페이지도 D36 표로 대조한다).

---
## 8. 표(관리·내 기기·설치 파일)

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 구조 | 모든 `<table>`에 `<caption>`(보이는 글자, `--text-caption` `--fg-muted`, 왼쪽 정렬), `<thead>` `th scope="col"`, 행머리 `th scope="row"`. 빈 `<th>`를 두지 않는다: 동작 열 머리는 "동작"(`.sr-only`로 시각 숨김 가능) | brief §6.13-2, `A-WORKER` §3.3(scope·caption 없음, 이름 없는 열 머리) | `worker` 테스트(모든 `<th>`에 `scope`, 비어 있지 않음, `<table>`마다 `<caption>`) |
| 셀 | 상하 `--space-6`, 좌우 `--space-8`, 아래 `1px solid var(--separator)`, `vertical-align: top`. 머리 글자 `--fg-muted` `--weight-strong` | foundations §4, `A-WORKER` §2.3(0.4rem = 6.4px 어긋남) | `design-lint`(px 리터럴) |
| 숫자·시각 열 | `.num` + 오른쪽 정렬(횟수·세션 수·복구). 시각은 D49 형식을 앱과 **같은 format 함수**(골든 JSON 공유)로. 열 머리에서 "(KST)"를 빼고 `<caption>`에 `tableTimeNote`("시각은 한국 시간이에요.")를 한 번 | D49(Worker 관리 화면도 같은 함수), `A-WORKER-3.x`(열 이름이 길어진다), `A-COPY` §1(시각 형식 셋) | `worker` 테스트(`format.test.ts` 골든), `design-copy` DC4(숫자·단위 직접 문자열 금지) |
| 가로 스크롤 | `<div class="scroll" tabindex="0" role="region" aria-labelledby="{caption id}">`로 감싼다. 키보드로 스크롤할 수 있어야 한다 | `A-WORKER` §3.3(가로 스크롤 영역에 포커스를 줄 수 없다), WCAG 2.1.1 | `worker` 테스트(`.scroll`에 `tabindex="0"`·`role`·이름), `R8` |
| 열 수 | 5열을 목표로 한다. 보조 정보(채널 ID·기기 정보)는 첫 열의 둘째 줄 `--text-caption` `--fg-muted` `.num`로 합친다(현재 `sessionRow`의 방식). 7열 허가 채널 표는 메모·추가한 관리자를 둘째 줄로 내린다 **[잠정]** | `A-WORKER` §4 나쁜 점 4(열 수·폭·정렬 제각각, 동작 열이 스크롤 끝) | 리뷰 `R1`(390 폭 스크린샷). 확인: 관리자가 휴대폰에서 [빼기]에 닿는지(g-web C-9) |
| 동작 열 | 마지막 열. 버튼은 `.btn-secondary` 24(`--control-h-sm`)가 아니라 **28**(`--control-h`): 표 행 높이가 28 + 상하 6 = 40으로 터치 바닥(40)에 맞는다 | foundations §5.1(터치 40), g-web J9(손가락 오누름) | `design-gallery`(대상 크기) |
| 빈 상태 | 표 대신 한 문장 `<p>`(기존 `allowEmpty` 등). 아이콘·일러스트 없음 | foundations §9(빈 상태에 아이콘을 두지 않는다) | `worker` 테스트(기존 "빈 화면은 빈 문구 네 개") |
| 줄무늬·hover | 없다 | D21(작업 행 hover 없음), P4 | `design-lint` |
| 600 미만 | 가로 스크롤 유지(표를 블록으로 쌓지 않는다). 첫 열 `min-width`는 토큰 조합으로 적지 않고 `th`·`td`의 `white-space: nowrap`만 | 단순함. 쌓기는 `::before { content: attr() }`가 필요해 검사가 어렵다 | — |

---

## 9. 휴대폰·인앱·봇·OG·파비콘

### 9.1 진입 맥락 판정

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 판정 함수 | `core/entry.ts`의 순수 함수 `entryContext(headers) → { kind: bot\|phone\|desktop\|unknown, os: mac\|windows\|linux\|other\|null, inApp: kakao\|null }` 하나. UA 크기 상한, 예외 없음 | `G-WEB-R1`·g-web V1 | `worker` 테스트(합성 UA 표 13사례. UA 문자열은 테스트 파일에 형식만 맞춰 만든다) |
| 봇 먼저 | `kakaotalk-scrap`·`Discordbot`·`facebookexternalhit`는 `bot`(인앱 아님, 표지 없음). 인앱 토큰은 `KAKAOTALK`만 코드에 둔다(네이버 앱·디스코드·인스타그램은 실기 캡처 전까지 넣지 않는다) | `G-WEB-R8`(F1~F3, F14) | `worker` 테스트(V1), `worker-config`(`kakaotalk://`·`openExternal` 문자열 금지) |
| 휴대폰 | `Sec-CH-UA-Mobile: ?1` 또는 UA `Mobi`만. OS 토큰으로 가르지 않는다(Android 태블릿은 desktop) | `G-WEB-R1`(MDN F20·F21) | V1 |
| 감지의 효과 | **순서와 강조만** 바꾼다. 행·버튼을 숨기거나 막지 않는다 | `G-WEB-R2`·`G-WEB-R5` | V2 |
| 인앱 로그인 | 막지 않는다. `failed`에만 보충 단락(§6.1) | `G-WEB-R9`·`G-WEB-R10` | V6 |
| 캐시 | UA에 따라 다른 HTML은 `Cache-Control: no-store` 유지. `Accept-CH` 안 보냄 | `G-WEB-R6`·`G-WEB-R7` | `worker` 테스트 |
| 쿼리 | `/`는 모르는 쿼리를 무시하고 같은 응답(`?openExternalBrowser=1` 포함) | `G-WEB-R10`·`G-WEB-R11` | V2 |

### 9.2 Open Graph(랜딩만)

| 태그 | 값 | 근거 |
|---|---|---|
| `og:title` | 치지직 다운로더 — 비공식 VOD·클립 다운로더 | D34 |
| `og:type` | `website` | ogp.me 필수 4속성(g-web F55, `E-ID-I41`) |
| `og:url` | `PUBLIC_ORIGIN + "/"` 정식 주소 하나 | `G-WEB-R13`(카카오: `og:url`이 다르면 그 주소를 다시 스크랩) |
| `og:description` · `description` | 부제 한두 문장 + 비공식 고지 포함. 로그인 여부·채널·버전과 무관한 **고정** 문구 | `G-WEB-R14`·`G-WEB-R28`, `G-ID-R10` |
| `og:image` + `og:image:alt` + `width`·`height` | `/assets/og.{hash}.png` **1200×630 PNG**. 글자(제품 이름·부제·"비공식 도구")만, `--bg` 바탕, 로고·캡처·채널명 없음. 핵심 요소는 2:1(카카오 800×400 크롭)과 1.91:1 어느 쪽에서도 잘리지 않는 중앙 안전 영역에 | `G-ID-R10`·§5, `G-WEB-R13` 크기 충돌 표기·`G-WEB-R16`(주소는 해시 경로) |
| 다른 경로 | `/auth/*`·`/admin`·`/me/*`는 OG 없음 + `X-Robots-Tag: noindex`. GET은 크롤러가 불러도 상태를 바꾸지 않는다 | `G-WEB-R15`, `A-WORKER` §3.6(noindex 결정 필요) |

강제: `worker` 테스트(V3: `/`에 태그 전부, `og:image` 경로가 200 `image/png`, 다른 경로에 `og:` 0개와 noindex; V5: 봇 UA로 `/auth/login/:handle`·`/auth/done`·`/` 두 번씩 호출 뒤 DO 덤프 불변). 카카오 공유 디버거 확인은 사람(g-web C-7).

### 9.3 파비콘·아이콘 에셋

| 에셋 | 크기·형식 | 비고 | 근거 |
|---|---|---|---|
| `icon.svg` | 벡터. `<style>` 없이 `prefers-color-scheme`에 반응하려면 `<svg>` 안 `<style>`이 필요하므로 **반응하지 않는다**(한 벌) | 플레이트 = D5 파랑 `--accent`(#0067DF) 단색 | g-id §5(evil martians 6파일), D33 조건(플레이트 = D5 파랑 하나) |
| `favicon.ico` | 32×32(+16) | `/favicon.ico` 직접 요청에도 200이 나게 경로 표에 별칭을 둔다 | g-id §5, `A-WORKER` §3.6(`/favicon.ico` 404 잡음) |
| `apple-touch-icon.png` | 180×180 불투명 | 투명이면 검은 배경이 붙는다는 것은 **[미확인]**(g-id §5) → 불투명으로 만든다 | g-id §5 |
| `og.png` | 1200×630 | §9.2 | — |

**마크(D33)가 나오기 전**의 임시 글리프: D5 파랑 둥근 사각 플레이트 + 흰 Lucide `download`(현재 앱 아이콘 모티프와 연속, UI 안에서는 쓰지 않으므로 파비콘이 그 모티프의 유일한 자리) **[잠정]**. D33 결과물이 나오면 교체하고 ADR에 적는다. 16px에서 선 2px 이상·흑백 식별은 D33 조건 그대로 `design-icons`의 아이콘 검사(`G-ID-R8` 제안 `icon-check`)가 본다. 원본은 `app/src-tauri/icons/`의 전경·배경 분리 원본과 한 곳이다(`G-ID-R6`).

강제: `worker` 테스트(`<link rel="icon">` 둘 + `apple-touch-icon`, 각 경로 200과 `Content-Type`·크기 헤더 파싱: `G-ID-R10`), `design-icons`.

---

## 10. 읽기 페이지 `/help`·`/privacy`·`/licenses`

| 규칙 | 값 | 근거 | 강제 |
|---|---|---|---|
| 척도·열 | `data-scale="reading"`, `main.reading { max-width: var(--reading-max) }`, 문단 `--leading-read`(22) | foundations §3.3·§8 | `worker` 테스트(`data-scale`) |
| 인증 | 셋 다 `auth: "none"`, 스크립트 없이 동작. 다운로드 링크·해시는 `/help`에 두지 않는다 | `G-HELP-H4`·§2.3-7(허가 없는 사용자가 "왜 안 되나"를 읽는 곳), D51 | `worker` 테스트(경로 행렬에 세 행) |
| 원천 | `/help`는 `help/<id>.md` 한 원천의 생성물(앱 번들 짧은 판과 같은 입력). `/licenses`는 `THIRD-PARTY` 생성물. `/privacy`의 기간 숫자는 `retention.ts` 상수에서 | D51, `G-HELP-H1`, `G-LEGAL-R1`, `G-PRIVACY-R20` | `worker`(단계 `help-check`: 생성 뒤 `git diff --exit-code`, governance DX22), `worker` 테스트(`/privacy` 숫자 = 상수, `/licenses` 200·비어 있지 않음·해시 일치) |
| 앵커 | `<h2 id>`만 앵커 대상. `<details>` 안에 `id`를 두지 않는다. id는 추가만(`help/ids.json`, `retired` 자리표시 절) | `G-HELP-H5`(닫힌 `details` 안 앵커 이동은 **[미확인]**) | `worker` `help-check`(`details` 안 `id` 검출), `worker` 테스트(모든 id가 응답에 있음) |
| 맨 위 한 줄 | `/help` 첫 문단 "화면이 앱과 다르면 앱을 업데이트해 주세요." | g-help §2.3-5(웹이 앱보다 새로울 수 있다) | `design-copy` |
| 문체 | 제목은 증상(마침표 없음), 절차는 `<ol>` 한 단계 한 문장, 메뉴 경로 `›` 굵게 + `aria-hidden` 기호와 읽기용 span, 단추 이름 굵게, "클릭" 금지, OS별 실제 폴더 경로 금지, "그래도 안 되면" 절로 끝 | `G-HELP-D1`~g-help D8, D44·D45 | `worker` `help-check` + `design-copy` DC11(도움말 원천) |
| 이미지 | 글과 도식 기본. 시스템 창 이미지는 OS 버전 캡션 + `alt`, 채널명·영상 번호 없음 | `G-HELP-S1`, D51 | `worker` `help-check`(manifest 필수 필드), `scan` |
| `/privacy` | g-privacy §3.4 초안 12절을 `content.md`가 다듬는다. `{운영자}`·`{연락처}`는 출시 전 사람이 채운다(저장소에 실제 값 없음) | g-privacy §3.4, 개인정보 보호법 제30조 | `scan` |
| `/licenses` | 세트·버전 메타가 `icons.ts`와 같다(Lucide ISC + Feather MIT 단락 즉시) | D31(현재 고지 0개는 위반), `G-LEGAL-R1` | `design-icons`(고지 파일과 세트·버전 일치) |

---

## 11. 레이아웃 요약(토큰 조합)

| 자리 | 값 |
|---|---|
| `body` | `background: var(--bg); color: var(--fg); font: var(--weight-regular) var(--text-body)/var(--leading-body) var(--font-sans)` |
| `.site-header` | 높이 `--toolbar-h`, 아래 `1px solid var(--separator)`, 안쪽 `.col`은 `main`과 같은 열(읽기 680 / UI 800), 좌우 `--edge` |
| `main` | 앱 척도 `max-width: var(--content-max)`, 읽기 `var(--reading-max)`; 좌우 `--edge`; 위 `--space-24`, 아래 `--space-32` |
| 히어로 위 | `--space-40` |
| 절 사이(`h2` 위) | `--space-40`(읽기) / `--space-24`(앱 척도) |
| `h2` 아래 | `--space-12` |
| 문단 사이 | `--space-12` |
| Notice | `components.md` §2.12 표(면·반경·패딩 `var(--space-8) var(--space-12)`·아이콘 20)가 원천. 톤 면 `--surface-2`(정보) · `--warning-soft` · `--danger-soft` |
| 코드 블록 `pre` | `--surface-2` 면, `--radius-control`, 안쪽 `--space-12`, `--font-mono` `--text-caption`, `white-space: pre; overflow-x: auto`(글자 단위로 끊지 않는다 — 390 폭에서 `/Appli cations`처럼 보이던 결함, 검토 U-34), `user-select: text` |
| 바닥글 | 위 `1px solid var(--separator)`, 위아래 `--space-32`, `--text-caption` `--fg-muted` |
| 좁은 레이아웃(600 미만) | `main` 좌우 `--edge` 유지, CTA 전폭, `h1` hero → 22/28(생성물 블록), 표는 가로 스크롤(§8) |

근거: foundations §4·§8, A 후보 `.site` 구조. 강제: `design-lint`(px 리터럴 금지 → 위 표의 값은 모두 토큰), `design-worker`(1280·390 폭 axe + 리플로우 320).

---

## 12. 결함 대조표(a-worker)

a-worker의 결함을 이 문서의 규칙과 대조했다. "적용 뒤" 열은 적용 단계 (e)가 채웠다(테스트 이름과 gate).

| # | 결함(a-worker 위치) | 파일:줄 | 이 문서 | 적용 뒤 |
|---|---|---|---|---|
| 1 | 강조색 초록 `#007a45`(C1 위반), 앱과 다른 브랜드색 | `site-css.ts:6~7` | §2 토큰 원천(D5 파랑, 생성물 공유) | `site-css.ts` 삭제, 생성물 `site-css.generated.ts`(토큰 + ui + `site.css`): `assets.test.ts` "웹 절이 토큰·ui 뒤에 붙는다", `design-tokens` DT1 |
| 2 | 토큰 이름·값 전부 앱과 다름(`--muted`·`--line`·`--warn`·`--box`) | `site-css.ts:6` | §2(같은 생성물) | 같은 생성물. `allow.json` DT2 넷 삭제(11 → 5), `design-lint`·`design-tokens`가 허용 항목 없이 통과 |
| 3 | 컨트롤 경계 대비 1.35 / 1.50:1 | `site-css.ts:24·27` | §7.1(`--border-strong` ≥ 3:1) | `design-worker` gallery 대비 검사(axe `color-contrast`·비텍스트 대비 위반 0, 라이트·다크·contrast more·forced) |
| 4 | 글꼴 스택 불일치, `-apple-system`, Noto 없음 | `site-css.ts:9` | §2 글꼴(`--font-sans`) | `worker-config`(`url(`·`@import` 금지), `design-tokens`(`@font-face` 0), `assets.test.ts` 웹 절 검사 |
| 5 | 본문 16px/1.6, h2 1.15rem, h3 UA 기본(h3 > h2) | `site-css.ts:9·12~13`, `landing-view.ts:46`, `admin-view.ts:33` | §2 척도, §3 헤딩 위계 | `landing-view.test.ts` "모양 공통: h1은 하나, siteName에 hero 클래스", `pages.test.ts` "htmlPage 골격"(헤딩 위계), gallery 320 리플로우 |
| 6 | `.code` `letter-spacing:.1em`, 2rem | `site-css.ts:16` | §6.4. 루프백(v0.3.0)이 확인 코드 표시를 지워 이 규칙은 쓰는 곳이 없다 → 적용 PR (e)가 생성물로 바꿀 때 지운다 | `site.css`에 `.code` 규칙 없음. `pages.test.ts` "loginConfirmPage: … 코드 요소 없음" |
| 7 | `word-break` 없음(한국어 글자 단위 끊김), `tabular-nums` 없음 | `site-css.ts` 전체 | §2 줄바꿈·숫자 | `design-lint`(`break-word`·`justify` 금지), gallery 가로 스크롤 없음, `.num` 표 셀(`landing-view.test.ts` "표: … 시각은 D49 형식(.num)") |
| 8 | rem 패딩이 4px 격자에 어긋남(6.4·5.6·14.4px), 버튼·입력 높이 비고정 | `site-css.ts:19·24·27` | §7.1(`--control-h`), §8 셀 | `design-lint` DL2(px 리터럴 0), gallery 대상 크기 ≥ `--hit-min` |
| 9 | 반경 6px 일률, 바탕과 같은 색의 버튼·입력 | `site-css.ts:22~28` | §7.1(`--surface` 면), §11 | `design-lint`, `design-worker` gallery(면 색 대비) |
| 10 | hover·active·focus-visible·disabled 규칙 없음, UA 포커스 링 | `site-css.ts` | §2 포커스, §7.1 눌림 | gallery forced-colors 포커스 링(`outline-style` ≠ none), `design-lint`(`outline: none` 금지) |
| 11 | 버튼 의미 규칙 없음(`danger` 과용, [계속]이 primary 아님) | `landing-view.ts:17·55`, `admin-view.ts:24·37·49`, `pages.ts:49` | §7.2 의미 표 | `landing-view.test.ts` "§5.1 (d) 채움 버튼"·"tone-danger 버튼은 없다", `admin-view.test.ts` "버튼 의미"·"renderDisallowConfirm … .tone-danger 1개", `pages.test.ts` "ui 부품: postButton", gallery `.btn-primary` ≤ 1 |
| 12 | 버튼 간격을 공백 문자에 맡김, `form.inline` | `admin-view.ts:37`, `site-css.ts:23` | §7.1 `.actions` | `pages.test.ts` "postButton: 폼 하나, 기본은 .btn"(`form.inline` 삭제, `.actions`) |
| 13 | 헤더 사이트명이 본문 링크와 같은 모양, 내비게이션 없음, 로그아웃이 본문 맨 아래 | `pages.ts:35`, `landing-view.ts:61~62` | §3 헤더 | `pages.test.ts` "nav: anon은 [도움말][로그인 /#start] …", `landing-view.test.ts` "관리 링크는 본문이 아니라 헤더 nav가 맡는다"·"내 기기와 로그아웃(11·12번)" |
| 14 | 표에 `scope`·`caption` 없음, 빈 `<th>`, 가로 스크롤에 포커스 불가 | `landing-view.ts:57`, `admin-view.ts:32·44·56`, `site-css.ts:17` | §8 | `pages.test.ts` "dataTable: caption(id)·th scope=col·동작 열 머리는 숨김 글자·스크롤 영역", `admin-view.test.ts` "표 다섯", `landing-view.test.ts` "다른 운영체제 표와 파일 확인", gallery axe |
| 15 | 시각 열 "(KST)" 반복, 형식 `YYYY-MM-DD HH:MM` | `copy.ts` col*, `format.ts` | §8 숫자·시각 열(D49) | `format.test.ts` "D49 골든(앱과 공유)", 표 caption `tableTimeNote`(`landing-view.test.ts` "표: caption에 tableTimeNote …") |
| 16 | 인라인 라벨 + 100% 입력, 오류 스타일 없음, 채널 ID가 mono 아님 | `admin-view.ts:33` | §7.1 입력, §6.3 오류 요약 | `admin-view.test.ts` "추가 폼: 라벨이 입력 위 … 채널 ID는 mono"·"400 검증 오류"(`aria-invalid`·`aria-describedby`·오류 요약) |
| 17 | 로그인 결과 4상태가 같은 모양, 안내 6종이 모두 "안내" | `pages.ts:39~41·55~75` | §6.1·§6.2 | `pages.test.ts` "donePage"(상태별 제목·아이콘 `circle-x`)·"noticePage"(4xx `triangle-alert`, 5xx `circle-x`) |
| 18 | `color-scheme`·`theme-color` meta 없음 | `pages.ts:35` | §3 골격 | `pages.test.ts` "THEME_COLOR"(= `--bg` 라이트·다크)·"htmlPage 골격 공통 단언" |
| 19 | 파비콘·OG·description·robots 없음, `/favicon.ico` 404 | `pages.ts:35`, `routes.ts:137` | §9.2·§9.3 | `pages.test.ts` "OG: og 옵션이 있을 때만 …", `assets.test.ts` "faviconAlias"·"바이너리 에셋 모양", `web-hygiene.test.ts` "랜딩만 색인되고 OG가 있다" |
| 20 | skip link·`nav`·`footer` 없음 | `pages.ts:35` | §3 | `pages.test.ts` "htmlPage 골격 공통 단언"(skip link·nav·footer), gallery(skip link 대상 크기) |
| 21 | 요소 전역 셀렉터(`header{}`), 클래스 체계 없음 | `site-css.ts:11` | §3 셀렉터 | `site.css`가 클래스 체계(`.site-header`·`.site-nav`·`.scroll` …)로 쓰고 요소 전역 셀렉터는 `body.web` 한정. `design-lint` |
| 22 | 다크 수동 전환 없음 | `site-css.ts:7` | §2 다크(의도: OS만, D7) — 결함 아님으로 닫음 | 닫힘(의도, D7): 변경 없음. `design-tokens`가 두 블록 동일을 본다 |
| 23 | 다크 `pre` 바탕 대비 낮음(`#222` / `#141414`) | `site-css.ts:7·22` | §11 코드 블록(`--surface-2` L .35 / bg .24) | `design-tokens`(`--surface-2`·`--bg` 대비), gallery 다크 axe, 스냅샷 `main-dark`(기준선은 머지 뒤 CI artifact) |
| 24 | `/assets` 핸들러가 파일 하나만 | `site-css.ts:37~43` | §4 에셋 표 | `assets.test.ts` "assetPath"·"asset (GET /assets/:file)"·"바이너리 에셋 모양"·"faviconAlias"(표 조회, 표 밖 404) |
| 25 | 해시 수동 갱신 | `site-css.ts:33`, `site-css.test.ts:9` | §4 해시(생성기) | `assets.test.ts` "SITE_CSS 해시 상수 = SHA-256 앞 16 hex", `tokens.mjs --check`(생성기), `worker-gen --check assets` |
| 26 | 낡은 주석 "골격은 W6에서" | `core/html.ts:8` | 적용 PR에서 지운다 | **미적용**: `worker/src/core/html.ts:8`의 주석은 (e) 묶음 F의 소유 밖이라 그대로다. 한 줄 삭제가 남았다(오케스트레이터 보고) |
| 27 | 복사 버튼 없는 xattr 명령 | `landing-view.ts:46` | §5.1-7(D52: 선택 가능한 코드 + 사기 경고) | `landing-view.test.ts` "설치하기(§5.1 7번) macOS: macDamaged → ol(…) → xattr 코드 → macXattrNote" |
| 28 | `Worker secret ADMIN_CHANNEL_IDS` 기술 용어 노출 | `copy.ts:67` | `content.md`(관리자 전용 문구라 P2. "관리자는 서버 설정에서만 바꿀 수 있어요") | `copy.ts` `adminsNote`("서버 설정"), `design-copy` DC1(용어집) |
| 29 | 랜딩 h1이 로그인 여부에 따라 다름("다운로드") | `landing-view.ts:22·62` | §5.2 | `landing-view.test.ts` "모양 공통: h1은 하나 … 로그인 여부와 무관" |
| 30 | SHA-256이 주 표의 열 | `landing-view.ts:43` | §5.1-8 | `landing-view.test.ts` "SHA-256은 주 표가 아니라 파일 확인 접힘(닫힘)에 있고 …" |

g-web §4.2 G1~G7(세션 없는 POST 무안내, 재삭제 404, 성공 피드백 없음, 검증 오류 별도 페이지, 파괴 동작 무확인, csrf 안내에 링크 없음, 오류 title 미구분)은 모두 §6.2·§6.3·§7.3이 덮는다.

---

## 13. 편집에서 닫은 것(2026-10-10)

초안 §13(foundations 요청 4건)과 §14(충돌 10건) 중 시스템 안에서 닫은 것:

| 초안 항목 | 처리 |
|---|---|
| 큰 숫자 글자 토큰 | 확인 코드 화면이 사라져 필요 없다(§6.4) |
| 헤더가 읽기 척도를 따라 커짐 | `data-scale`을 `main`에 두어 해소(foundations §12-14) |
| 읽기 전용 입력 면 | `components.md` §0.3 readonly(`--surface-2` + `--border-strong`) |
| `[data-window-active]` 블록이 Worker 생성물에 남는 것 | 토큰이 아니라 selector라 DT3(이름 기준)에 걸리지 않는다. 생성기가 Worker 생성물에서 이 블록을 빼지 않는다(공통 구간 유지) |
| "pill" 낱말 | README D34·content §11을 "배지"로 |
| `design-lint`의 `cursor: pointer` 금지는 앱만 | governance §2.3 DL8 |
| Worker 정적 HTML의 갤러리·스냅샷 | `design-worker`(worker 영역 작업, governance §2.6b·§2.0 영역 공백의 결정 (나), 렌더 문자열을 `setContent`) |
| 로그인 확인 페이지 존속 | 루프백(v0.3.0)이 확인 코드만 빼고 단계를 남겼다(`worker.md` 88 (가)). §1·§6.4를 그 판으로 고쳤고 [잠정]을 닫았다 |
| `A-WORKER` §7.1-5 JS 허용 여부 | D52로 닫혔다 |

## 14. `worker.md`에 반영할 것(적용 단계 (e)가 번호를 받아 닫았다)

이 시스템 문서는 `worker.md` 본문을 고치지 않는다. (e)가 아래를 `worker.md` "구현 중 변경" 99에 적었다(번호는 "닫는 방법" 열).

| # | 어긋남 | 이 문서의 선택 | 닫는 방법 |
|---|---|---|---|
| 1 | **macOS "그래도 열기" 단계**: README D53·D55·`J-R*`은 "그래도 열기 경로 먼저 + xattr 폴백", worker.md 구현 중 변경 45(실기기 2026-10-07)는 "손상 경고에 [그래도 열기] 길이 없다" | 결정 표를 따라 ②에 두되 [잠정]. "그 단추가 없으면"으로 ③에 이어지게 써서 어느 쪽이 맞아도 사용자가 막히지 않는다 | **닫힘(구현은 [잠정] 그대로)**: `worker.md` 구현 중 변경 99 ①. 실기 확인은 README §6-11(ad-hoc 서명)이고 결과를 `platform.md`와 이 문서 §5.1-7에 반영하고 ADR |
| 2 | **SHA-256 위치**: worker.md §9.5는 "OS별 표에 SHA-256 텍스트", 이 문서는 "파일 확인(선택)" 접힘 | 접힘(D53·`G-WEB-R27`·`G-INSTALL-R7`) | **닫힘**: `worker.md` 구현 중 변경 99 ② |
| 3 | **`seeOther` 계약**: worker.md "위치는 쿼리 없는 두 곳"에 flash 쿠키가 없다 | flash 쿠키로 보완(§6.3) | **닫힘**: `worker.md` 구현 중 변경 99 ③ |
| 4 | **허가 빼기 확인 페이지 경로**(`GET /admin/<id>/disallow`)와 삭제류 멱등 정책·`X-Robots-Tag`·`entryContext`·에셋 표 | 모두 신설(§7.3·§6.3·§9) | **닫힘**: `worker.md` 구현 중 변경 99 ④(`/notice`는 100, 읽기 페이지는 101) |
| 5 | **설치 안내를 로그인 전에 보인다**(§5.2): worker.md §9.5는 허가 사용자에게만 | 안내 텍스트는 공개, 파일 링크만 인증 뒤 | **닫힘**: `worker.md` 구현 중 변경 99 ⑤. E1 근거라 D62 UT5로 확인 |
| 6 | **로그인 확인 페이지**의 확인 코드 제거(루프백) | §6.4 | **닫힘**: `worker.md` 구현 중 변경 88 (가)·89(L1, v0.3.0). 1~5번은 위 99가 적었다 |

---

## 15. 구현 중 변경(이 문서가 후보·감사와 다르게 정한 것)

1. **"pill"을 배지(반경 4)로.** C 후보의 알약 모양을 D18에 맞춰 바꿨다(§3.1). README D34·content §11도 같은 낱말이다.
2. **A 후보의 `body.app`/`body.web` 중 `.web`만 남겼다.** 앱은 Svelte 컴포넌트가 커서·선택을 정하므로 Worker 생성물에만 `.web` 규칙이 있다(§2).
3. **A·B·C 목업의 파일 크기 표기(24.1MB 등)를 뺐다.** worker.md 38 (가)의 R2 호출 상한 때문이다(§5.2).
4. **다른 OS 설치 절을 `<details>`(닫힘)로.** `G-INSTALL-R3`을 따랐고, `G-HELP-H5`(앵커는 접힘 밖)와 맞추기 위해 `id`는 `h2`에만 둔다(§5.1-7). 감지 실패면 모두 `open`.
5. **확인 페이지의 버튼 순서를 D36(파괴 왼쪽)으로.** `G-WEB-R21`은 순서를 정하지 않았다(§7.3).
6. **표 동작 열 버튼을 24가 아니라 28로.** 행 높이 40으로 터치 바닥에 맞추기 위해서다(§8).
7. **휴대폰 안내의 주소 칸을 `readonly` 입력으로.** `G-WEB-R3` 그대로이고, 복사 버튼(JS)은 없다. 면 색은 `components.md` §0.3.
8. **거부 페이지 아이콘을 `circle-x`(danger)로.** 초안의 `triangle-alert`(경고)는 앱 거부 화면(⊗)과 다른 은유였다(검토 U-12). 다음 행동 문장(`doneDenied.next`)을 더했다.
9. **헤더 nav에서 `/auth/*` 페이지의 [로그인]을 뺐다**(검토 U-31).
10. **Windows SAC 경고를 단계 앞의 경고 Notice로**(검토 U-37). **로그인 전 고지에 끊는 길과 `loginForFiles`·`loginTwice`를 더했다**(검토 U-04·U-11).
11. **코드 블록은 `white-space: pre` + 가로 스크롤**(검토 U-34).
12. **루프백(v0.3.0) 뒤 결과 페이지를 웹 흐름 기준으로 다시 썼다.** 앱 흐름의 ok("앱으로 돌아가 주세요") 행을 지웠고, denied·cancelled 문구에서 "앱에서"를 뺐으며, failed는 `doneView.kind`로 두 문구를 고른다(§6.1). 옛 앱 안내(`outdatedApp`)·확인 페이지 CSP 예외·앱 수신기 페이지(§6.5)를 더했다(`worker.md` 구현 중 변경 88·89, `app.md` 65·66).
13. **(e)로 넘기는 것: `site.css`의 링크 색 규칙은 `a:not(.btn)`으로 한정한다.** `ui.css`의 `.btn { color }`가 `body.web a`(특이도 0,1,2)보다 약해서, 한정하지 않으면 버튼 글자가 링크색으로 덮인다(적용 단계 (a)의 `design/ui.css` 구현에서 발견).
14. **해소(적용 단계 (d)): 이 문서가 적은 `adminOnly.title`·`badFormat.title`·`retryLater.body`·`landing.contact`를 `content.md` §15.3 표에 더했다.** 값은 §6.2 표 그대로이고 `landing.contact`는 자리표시("문의 연락처는 출시 전에 채워요.")다. DC10 허용 항목은 사라졌다.
15. **Worker 문구 개정(적용 단계 (d))이 (e) 전에 마크업에 닿은 곳은 셋뿐이다.** ① `noticePage(config, status, title, body | null)`: h1이 상태별 제목이 되고 본문은 없을 수 있다(4xx·5xx `<title>`에 `errorTitlePrefix`). 명세가 제목을 정하지 않은 `notFound`·`isAdmin`·`bootstrapAdmin`·`adminNoAllow`·`badBody`는 현재 문장을 제목과 본문으로 가르기만 했다(`content.md` §15.3). ② macOS 설치 단계 셋은 `<ol><li>`(번호가 문자열에서 빠졌다). ③ 시각 열이 있는 표에 `<caption>`(`tableTimeNote`)을 한 줄 더했다(열 제목에서 "(KST)"를 뺀 대신. §8의 caption 모양 CSS는 (e)). 랜딩 `<title>`이 `siteTitle`이면 `htmlPage`는 " · 앱 이름" 꼬리를 붙이지 않는다. 나머지 새 키(`landing.consent.*`·`skipLink`·`confirmDisallow.*` 등)는 (e)가 화면을 만들 때 참조한다.
16. **`design-worker`는 페이지를 `setContent`가 아니라 순수 렌더 함수 + `page.route`로 연다**(governance §2.6b를 바꾼다). spec이 각 `render*` 함수를 합성 데이터로 불러 `Response`를 만들고, 본문과 헤더(CSP 포함)를 가짜 출처 `https://worker.test`로 내보낸다. 실제 CSP가 걸리므로 인라인 `style`·`<script` 회귀가 콘솔의 CSP 위반으로 잡힌다. 렌더 함수가 있는 모듈은 라우터·저장소 클래스·`cloudflare:`를 값으로 import하지 않는다. `worker.md` 구현 중 변경 98, governance §12 (e).
17. **`.btn-secondary`는 `.btn`으로 읽는다.** `design/ui.css`에 `.btn-secondary`가 없다. 보조(테두리) 버튼은 `.btn` 하나, 채움은 `.btn.btn-primary`(페이지당 ≤ 1), 위험은 `.btn.tone-danger`(확인 페이지 최종 버튼에만), 랜딩 큰 버튼은 `.btn.btn-primary.btn-lg`다. 이 문서 본문의 `.btn-secondary`는 모두 이 뜻이다. 표 안 버튼([끊기]·[지우기]·[허가])은 위험 표시 없이 `.btn`이고 `postButton`의 위험 옵션은 `tone: "danger"`다(§7.2).
18. **`og:title`은 `siteTitle`(content §11)이다.** §9.2 표의 "VOD" 낱말은 content §11이 나중에 "다시보기·클립"으로 정했다(`siteTitle` = "치지직 다운로더 — 비공식 다시보기·클립 다운로더"). `og:description`은 `ogDescription`, `og:image:alt`는 `siteTitle`이다. `og:`는 랜딩에만 있고 다른 경로에는 0개다(`pages.test.ts` "OG"). 랜딩 `<title>`이 `siteTitle`이면 꼬리(" · 앱 이름")가 없다.
19. **헤더 [로그인]은 폼이 아니라 `/#start` 링크다.** 비로그인 랜딩의 CTA 블록을 `<div id="start">`로 감쌌고 헤더 링크가 거기로 간다. `/auth/*` 페이지에는 로그인 링크가 없다(§15-9). 로그인한 사람의 본문에는 [관리] 링크가 없고 헤더 nav가 맡는다(허가 사용자의 랜딩에는 e2e 계약대로 `href="/admin"`이 헤더에 있다).
20. **관리 동작의 성공 flash는 두지 않는다.** content.md에 문구가 없고 표의 변화가 결과를 보인다(§6.3). flash 종류는 `loggedIn`(웹 로그인 성공, `303 /`)·`alreadyDone`(이미 처리된 대상의 멱등 303)·`sessionGone`(세션 없는 웹 POST, `303 /`) 셋이고 그 밖에는 만들지 않는다. 오류 요약이 있는 화면에는 flash가 오지 않는다(`renderAdmin`이 오류가 있으면 flash를 무시한다).
21. **앱 아이콘(청록 `#0f766e`)과 웹 파비콘·`apple-touch-icon`·OG 글리프(D5 파랑 `#0067DF`)가 어긋난다.** §9.3의 임시 글리프([잠정], 파랑 둥근 사각 + 흰 Lucide `download`)를 그대로 만들었고 앱 아이콘(`app/src-tauri/icons/icon-source.svg`)은 이 단계에서 바꾸지 않았다. 앱 마크(D33)는 (f) 몫이고 정해지면 둘을 함께 맞춘다. 확인: D33 결정. 래스터 에셋은 `worker/scripts/render-assets.mjs`로 한 번 찍어 체크인했고 CI에서 다시 만들지 않는다(글꼴로 바이트가 흔들린다).
22. **help id는 "추가만"을 `retired` 배열과 리뷰로 지킨다.** `help/ids.json`의 `ids`에서 id를 지우거나 순서를 바꾸지 않는다(앵커 링크가 깨진다). 안 쓰는 id는 `retired`로 옮기되 `ids`에도 남긴다. 기계 검사는 "모든 md가 `ids`에 있다"와 "`ids`의 id는 md가 있거나 `retired`에 있다"까지다. `worker-gen --write help`는 새 md의 id를 `ids` 끝에 덧붙일 뿐 지우지 않는다.
23. **`/favicon.ico`의 Cache-Control은 `public, max-age=86400`이다.** 해시 없는 주소라 immutable이 아니다. 해시 주소 `/assets/<이름>.<해시>.<확장자>`는 `public, max-age=31536000, immutable`이다. 표 밖 이름은 404(`not_found`)다.
24. **최소 OS 표시값은 `core/landing.ts`의 최소 OS 표(코드 상수)다**: macOS 13.3, Windows 10, Ubuntu 22.04. 원천은 platform.md D1·baseline이고 [잠정]이다. 확인: (f)의 `app/baseline.json`·`minimumSystemVersion` 실측. 랜딩 meta 줄과 "다른 운영체제" 표의 최소 버전 열이 같은 값을 쓴다.
25. **허가 채널 표는 다섯 열이고 둘째 줄을 쓴다**[잠정]: 이름 · 메모 · 시각 · 활성 · 동작. 채널 ID는 이름 아래 `.meta` > `.mono.num`(채널 ID 셀 글자는 `>{id}<`로 감싸 e2e 정규식을 지킨다), "추가한 관리자"는 `colAddedBy` 글자와 함께 메모 칸 둘째 줄이다(열 머리가 사라지는 자리에서 글자로 이름을 붙인다). 세션 표는 여섯 열 + 동작 그대로다(줄이는 [잠정]은 허가 채널 표만이다). 확인: 1280·390 캡처(`R1`)와 D62 관리자 과업.
26. **`/privacy` 본문은 초안이고 사람이 확인해야 한다.** 코드로 확인한 사실만 적었다(받는 항목, 쓰는 곳, 웹·앱 로그인 유지 시간, 끊은 뒤 보존, 거부 시도·감사 기록 상한, 로그인 진행 정보 시간, IP를 그대로 저장하지 않음, 쿠키는 쓰지만 광고용이 아님, Cloudflare 해외 저장 가능성). 숫자는 저장소 상수(`WEB_TTL_MS`·`REFRESH_TTL_MS`·`SESSION_MAX_MS`·`REVOKED_KEEP_MS`·`DENIED_KEEP_MS`·`DENIED_CAP`·`AUDIT_CAP`·`FLOW_TTL_MS`)를 함수 값에 넘기고 vitest가 "화면 숫자 = 상수"를 본다. 법적 문안 검토, 실제 관리자·연락처(`landing.contact`와 `privacy.placeholder.*`는 자리표시)는 출시 전에 사람이 정한다(content §19-24).
27. **관리 화면(묶음 D)에서 고른 것.** ① 관리자 목록은 한 열 표(caption = `adminsNote`, 머리 = `channelIdLabel`)다("표 다섯"). ② 숫자 열은 셀 안 `span.num`만 쓰고 오른쪽 정렬(`td.num`)은 쓰지 않는다(`dataTable` 머리에 클래스를 줄 수 없어 머리와 어긋나는 정렬을 피했다). ③ `renderAdmin`의 `errors`는 `errorSummary`와 같은 `{fieldId, message}[]`이고 필드 옆 문구는 `fieldId === "allow-channel-id"`에서 꺼낸다. 오류가 있으면 flash를 무시한다. ④ 400 재그리기는 채널 ID·메모를 각각 64자로 잘라 채우고 메모가 둘 이상이면 비운다(본문이 4096자까지 올 수 있다). ⑤ 409 화면(관리자 채널 허가 빼기)에 `nav`와 `back`(`reloadAdmin` → `/admin`)을 붙였다. ⑥ 관리 화면의 "처음으로" 링크는 지웠다(헤더 사이트 이름이 `/`로 간다). ⑦ 확인 페이지 GET의 로그는 모두 `ctx.log`(quiet라 무음)뿐이고 새 이벤트는 없다(상태 불변, 새 DO RPC 없음).
28. **골격·부품(묶음 B)에서 고른 것.** ① skip link는 `calc(0px - 100vw)`로 화면 밖에 두고 포커스를 받으면 `--edge` 위치에 나온다(`--z-sticky`는 입력줄 한 파일만 쓰도록 DT13이 못박았다. 화면 밖이라도 상자 크기가 있어 대상 크기 검사에 걸리지 않는다). ② D49 골든은 vitest가 `import.meta.glob("../../../design/format/*.json")`로 앱과 같은 파일을 읽는다(workerd에서 `readFileSync`가 안 된다). 함수는 `formatDate`·`formatDateTime`·`kstWall`·`kst`·`kstDate`다. ③ 새 문구 키 `siteNav`·`reloadAdmin`·`inAppHint`는 content §15.3·§19-21에 있다(`inAppHint` 문구는 지었다). ④ 랜딩 호출부는 `scale: "reading"`·`index`·`og`를 켠다. ⑤ 설치 파일 목록을 못 불러온 경고는 warning 알림이다. ⑥ `htmlPage`의 `<title>`은 오류 접두를 `htmlPage`만 붙인다(`noticePage`·`donePage`는 직접 붙이지 않는다: "오류: 오류: " 방지). ⑦ 알림 id는 기본값이 겹치면 axe의 중복 id 위반이므로 쓰는 곳마다 따로 준다(§15-29 ②).
29. **랜딩(묶음 C)에서 고른 것.** ① 해시 표의 파일 셀은 `<a href="/releases/…"><code>`이고 해시는 `code.selectable`이 아니라 `<code>{64hex}</code>`다(e2e 정규식이 한 행에 둘을 요구한다. 웹은 `body.web`이 이미 선택 가능이다). ② 알림 id는 `mobile`·`unofficial`·`win-sac`·`release-unavailable`로 나눴고 단위 테스트가 id 유일성을 본다. ③ 내 기기 표 caption은 "내 기기. 시각은 한국 시간이에요."(`devicesTitle` + `tableTimeNote`)로 영역의 접근 가능한 이름이 되게 했다. ④ 뷰가 `YYYY-MM-DD`를 `formatDate`(D49)로 바꾼다(`core/landing`의 `pubDate` 형식은 그대로). ⑤ 버전을 모르면(비로그인·목록 없음) Linux 명령에 `savedFile`("파일이름") 자리표시를 쓴다. 이 값은 `chmod +x`·`sudo apt install ./`에 들어가므로 공백이 없다. ⑥ "막히면" 절은 두 문단이다: 도움말 링크 한 줄, 그 뒤 `reportHelp` + `landing.contact`(링크 앞뒤에 조각 문구를 만들지 않는다, DC11). ⑦ `filesCaption`은 "설치 파일(버전 {v})"로 붙여 쓴다(이 문서의 옛 표기 "설치 파일 (버전 …)"의 공백을 뺐다. content §15.3). ⑧ 의무 어미: `fileCheckLead`는 "…SHA-256 값과 비교할 수 있어요."다(DC2가 "보세요"를 막는다).
30. **읽기 페이지·갤러리(묶음 G)에서 고른 것.** ① `/help`는 절을 `<section>` 없이 `h2 id` + 블록을 평평하게 두고(기존 `.page > h2` 간격 규칙을 그대로 쓴다) 차례는 `nav[aria-label] > ul`, 단계 목록은 `ol.steps`다. ② 읽기 페이지의 헤더 nav는 세션을 읽어 정한다(`readWebSession`: 형식 밖 쿠키는 DO를 부르지 않고, 쿠키를 지우지 않는다). ③ 갤러리 환경 행렬은 다섯으로 줄였다(forced는 라이트만, contrast + reduced motion은 라이트·다크 둘). 160개 안팎으로 시간을 줄이면서 계약의 모든 환경을 한 번씩 덮는다. ④ 갤러리 서버는 에셋을 실제 `asset()` 표 그대로 부르고(디코드를 따로 하지 않는다) 문서 요청은 `ORIGIN/`에서만 응답하고 나머지는 404다. ⑤ 대상 크기 예외는 `a`가 `p` 안에 있을 때(WCAG 2.5.8 "문단 안 링크")다.
31. **`site.css` 변경 세 건과 `<pre tabindex="0">`(묶음 G가 갤러리로 찾아 묶음 B의 규칙을 고쳤다).** ① `.scroll { position: relative }`(가로 스크롤 영역 안의 포커스 링 기준). ② `.site-nav a`에 최소 너비(대상 크기). ③ 문단 밖에 혼자 놓인 링크의 대상 크기. 코드 블록 `pre`는 가로로 스크롤될 수 있으므로 `tabindex="0"`을 둔다(키보드로 스크롤).
32. **진입 판정·flash 쿠키·에셋의 세부(묶음 A).** 판정 순서는 길이 상한(UA 512) → 봇 → 휴대폰 → 데스크톱 → unknown이고, OS 토큰은 Android·CrOS·iPhone이 먼저 `other`로 걸러진 뒤에 Windows·Mac·Linux를 본다(Android가 "Linux"를, iPhone이 "like Mac OS X"를 품는다). 인앱 토큰은 `KAKAOTALK` 하나다. flash 쿠키 `readFlash`는 이름의 쿠키가 요청에 있기만 하면(모르는 값·중복 포함) 지우는 줄을 주고 `kind`는 종류 코드일 때만 준다. 생성 모듈 문법·svg 줄끝 정규화·help md 부분집합은 `worker.md` 구현 중 변경 101이다. 아이콘 16px 층은 64 단위 SVG를 그대로 줄였고, `apple-touch-icon`은 모서리 둥글림 없이 파랑 전면 위에 글리프를 올렸으며, OG는 가운데 1000×500 안에 이름·부제·"비공식 도구"(테두리 상자)를 둔다(2:1 크롭에서도 남는다). `.gitattributes`에 `worker/assets/**`는 두지 않았다(svg는 LF로 맞춰 해시하므로 `--check`가 같다).
33. **§12 결함 26(낡은 주석 "골격은 W6에서")은 이 단계에서 지우지 못했다.** `worker/src/core/html.ts`가 문서 단계의 소유 밖이라 그대로다. 한 줄 삭제가 남았다.
34. **시각 대조(검증 담당)가 고친 것.** ① 읽기 척도 본문: body가 `--text-body`를 13으로 먼저 계산해 상속하므로 `.page[data-scale="reading"]`가 글자 크기·행간을 다시 선언한다(15/22, 헤더·바닥글은 13). ② 표: `th`는 `nowrap`, `td`·`th`는 `overflow-wrap: normal`이라 한글을 글자 단위로 끊지 않고 좁으면 `.scroll`이 스크롤한다. 숫자 열 `td.num`도 `nowrap`. ③ 폼: `section > h3` 위 24, `form` 안 자식 사이 12. ④ 599px 이하의 `pre`는 `pre-wrap` + `overflow-wrap: anywhere`(복사 글자는 같다). ⑤ `/admin*`의 404(`notFound`)는 비로그인 nav([로그인] 포함)로 낸다(§15-9는 `/auth/*`만 뺀다). 고치지 않은 것: forced-colors의 `.btn-primary` 글자(`Highlight`/`HighlightText`는 foundations §2.7대로이고 macOS headless의 반투명 `Highlight` 인공물일 수 있어 Linux CI 기준선에서 확인한다), 경고 Notice 굵기(CSS에 굵기 규칙이 없다, 재현되지 않으면 닫는다), `dataTable`의 `role=region`은 `aria-labelledby`(caption)로 이미 이름이 있다. §8의 `YYYY-MM-DD HH:MM`은 `format.ts`(D49)의 `2025. 12. 31. 오후 11:00`이 맞다.
