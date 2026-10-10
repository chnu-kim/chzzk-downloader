# 치지직 다운로더 — 시각 설계 (ui-visual.md, 호환 스텁)

**이 문서는 `docs/design/system/`(디자인 시스템 「무색」)이 대체했다.** 시각·문구 규칙의 원천은 그 폴더다(우선순위는 `system/README.md` §3). 옛 내용은 git 이력의 커밋 `3b9ea8d` 이전(`git show 3b9ea8d^:docs/design/ui-visual.md`)에 있다. 옛 본문은 여기에 옮기지 않는다. 값이 다른 곳이 많아서 그대로 읽으면 틀린다(예: 루트 14px·rem 토큰은 16px·px 토큰으로 바뀌었다, `system/adr/0002-root-16px-and-px-tokens.md`).

이 파일은 코드 주석의 `ui-visual §n` 인용이 가리킬 자리를 남기려는 **임시 스텁**이다. 인용을 `docs/design/system/` 절로 고치는 적용 단계 (b)·(c)(`system/governance.md` §10)에서 이 파일을 지운다.

## 옛 절 → 대체 문서

| 옛 절 | 대체하는 system/ 문서·절 |
|---|---|
| §0 방향 | `README.md` §1 원칙, `foundations.md` §2.1 설계 원칙, `patterns.md` §0 |
| §1 색 (§1.1 토큰 표·§1.2 대비·§1.3 색 규칙) | `foundations.md` §2 (§2.3 sys 색 토큰, §2.4 대비 계산값, §2.1 설계 원칙) |
| §2 글자 (글꼴 스택·크기·굵기) | `foundations.md` §3 |
| §3 간격·모서리·높이 | `foundations.md` §4 간격, §5 크기, §6 반경·선·면 |
| §4 움직임 | `foundations.md` §7.1 |
| §5 아이콘 | `foundations.md` §9, `components.md` §2.24 Icon |
| §6.1~§6.3 홈(빈 상태·최근 목록·불러오는 중·영상 카드) | `patterns.md` §14.2 홈의 세 모습, §2.4 빈 상태, §6.5 영상 카드의 폼 |
| §6.4 UrlBar 상태 | `patterns.md` §6 폼과 검증, §7 붙여넣기·드롭·클립보드 제안, `components.md` §2.3 TextField |
| §6.5 JobItem 상태별 | `patterns.md` §2 상태 6종, §3 진행 표시, §10.3 작업 행의 실패, §14.3 작업 목록 |
| §6.6 배너 (B1·B2) | `patterns.md` §1.4 배너, `components.md` §2.12 Notice |
| §6.7 대화상자 (D1~D3) | `patterns.md` §5 대화상자, `components.md` §2.10 Dialog |
| §6.8 설정 | `patterns.md` §14.4 설정, `components.md` §2.17 SettingsRow |
| §6.9 토스트 | `patterns.md` §1.3 토스트, `components.md` §2.13 Toast |
| §7 컴포넌트 스펙 | `components.md` §2 컴포넌트 |
| §8 반응 규칙 (720 ↔ 960+) | `patterns.md` §15 720과 960의 반응, `foundations.md` §8 레이아웃 |
| §9 app.md와의 조정 | `foundations.md` §12 구현 중 변경, `foundations.md` §10 테마(`data-theme`), `governance.md` §1(토큰 파일 위치) |

## 강제는 언제부터인가

`system/`의 강제 gate(`design-tokens`·`design-lint`·`design-copy`·`design-icons`·`design-gallery`·`design-shots`)는 적용 PR (a)부터 켜진다(`governance.md` §10). 그 전까지 이 규칙들은 자동으로 강제되지 않고, PR 템플릿의 리뷰 체크리스트 `R1`~`R10`(`governance.md` §3)으로만 지킨다.
