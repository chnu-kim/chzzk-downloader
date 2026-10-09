# 0009 출처 없는 수치 묶음(제안값)

상태: 채택(잠정)   날짜: 2026-10-10   관련: README §6-7, foundations §5.2·§6.4·§7.1·§8·§14, D37, D38, D39, D41, platform.md §2.3·§9·§14·§15

## 맥락

시스템의 수치 대부분은 OS 실측·HIG·WCAG에서 왔지만(foundations 각 절의 근거 열), 출처가 없는 값이 남는다. 후보 A가 고른 치수, 보고서가 "측정 근거 없음"이라고 스스로 적은 제안값, 편집에서 새로 둔 값이다. README §7.1 조건 5는 [잠정]·[취향] 값을 ADR에 올리라고 한다. 이 ADR 한 장이 그 값들을 **제안값**으로 등록하고 각 값의 확인 방법을 적는다. 값은 토큰·상수 하나씩이라 바꿔도 체계가 깨지지 않는다(README §6-7). 값의 원천은 foundations(§13 토큰, §14 상수)이고 이 문서는 이름만 든다.

## 결정

아래 값을 제안값으로 쓴다. 바꿀 때는 이 ADR을 고치지 않고 새 ADR을 쓴다.

| 이름 | 값 | 표기 | 어디서 | 확인 방법 |
|---|---|---|---|---|
| `TOAST_MS`(토스트 수명 = 되돌리기 창) | 6초 | [취향] | D37 | D62 V8 "토스트를 다 읽는가" |
| `NOTIFY_TITLE_MAX_GRAPHEMES` | 40 | [취향] | D38, content §13 | D62 UT4·UT5 알림 관찰 |
| `NOTIFY_BATCH_MS` | 3초 | [취향] | platform §9 | 보고서의 3초는 근거 없음(`X-DESK-N45`)이라 같은 값을 취향으로 채택. platform §21 M10 |
| `--progress-h` | 6px | [취향] | foundations §5.2 | D62 "진행을 읽는가"(`Q26`) |
| `--toolbar-h` | 44px | [취향] | foundations §5.1 | D62 V6(톱니를 찾는가)·`R1` 스크린샷 |
| `--dialog-w | 440px | [취향] | foundations §5.2 | 720·x-large 스냅(`design-gallery`) |
| `--reading-max | 680px | [취향] | foundations §3.3 | 1280·휴대폰 캡처(`R1`) |
| `--label-w` / `--pct-w` | 80px / 40px | [취향] | foundations §5.2 | 갤러리 고정 데이터(긴 라벨·"100%")에서 흔들림 없음 |
| `--motion-spin` | 800ms | [취향] | foundations §7.1 | reduce 스냅에서 정지 호 |
| `--surface-pressed` | #DBDBDB / #484848 | [취향] | foundations §2.3 | DT16 hover ≠ pressed, `R1` |
| `--shadow-*` 수치 | foundations §6.4 | [취향] | foundations §6.4 | `R1` 다크·라이트 |
| `BREAKPOINT_NARROW` | 600 | [잠정] | foundations §8 | Windows 텍스트 225% 리플로우(platform §21 M16) |
| 글자 크기 설정 배율 | ×1.3 / ×2.0 | [잠정] | foundations §3.2 | x-large 720×520 리플로우, D62 V4 |
| 읽기 척도 caption·title·display·hero | 13/18 · 17/24 · 22/28 · 28/36 | [잠정] | foundations §3.3 | 1280·휴대폰 캡처(README §6-13) |
| `LOADER_DELAY_MS` / `LOADER_MIN_MS` | 300 / 400 | [제안] | foundations §14, `G-LAUNCH-R4` | 실측 뒤 조정(platform §14) |
| `SHOW_DEADLINE_MS` | 1500 | [제안] | `G-LAUNCH-R2` | platform §21 M2 |
| `COLD_SHOW_BUDGET_MS` / `WARM_SHOW_BUDGET_MS` | 1000 / 400 | [제안] | platform §14 | `smoke-bin` 마커 관찰 뒤 ratchet 승격 |
| `DOCK_PROGRESS_MIN_INTERVAL_MS` | 1000 | [취향] | platform §8 | — |
| `NETWORK_PATIENCE_MS` / `RETRY_BACKOFF_MAX_MS` | 30분 / 30초 | [잠정] | `G-POWER-R8` | platform §21 M23 |
| `RECOVERY_SILENT_MS` / `RECOVERY_NOTICE_MS` | 60초 / 10초 | [취향] | `G-POWER-R11` | D62 UT5 |
| `METERED_CONFIRM_BYTES` | 1GB | [취향] | D6(v1.1) | — |
| `LOW_SPACE_FACTOR` | 1.05 | [취향] | `G-SAVE-R9` | — |
| `COMPLETED_FOLD_AT` / `STALE_DAYS` / `RECENT_MAX` | 11 / 30 / 5 | [취향] | D39, `G-REPEAT-R2`·`G-REPEAT-R3`·`G-REPEAT-R9` | D62 UT7 |
| `NOTICE_TTL_H` / `NOTICE_CACHE_H` / `NOTICE_MAX_CHARS` / `CIRCUIT_FAILURES` | 72 / 24 / 80 / 3 | [잠정] | D41, `G-OUTAGE-R4`·`G-OUTAGE-R6`·`G-OUTAGE-R11` | 운영 기록(ROADMAP) |
| 전체 화면 상태 복원 안 함 | — | [취향] | platform §2.3 | 방송 노출 위험(brief §1.4). 불만이 보고되면 재검토 |
| `HIGHLIGHT_MS` / `COPIED_LABEL_MS` / `ETA_REFRESH_MS` | 1초 / 2초 / 1초 | [취향] | patterns §1.2, D50 | D62 관찰 |

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 토스트 6초: Carbon은 "위급 메시지에 시간 제한 금지"만 정하고 길이는 정하지 않는다 | E0 | `E-KO-31` | — |
| 로딩 300/400ms는 디자인 시스템 수렴값이지 표준이 아니다 | E1 | `E-DESK-L*`(Learning Equality·Stripe), `X-DESK-L20`(Epic React 300/350은 쓰지 않는다) | — |
| 알림 20자·24자·3초는 보고서 선택값 | E1 | `X-DESK-N45` | — |
| 공지 72h·80자·서킷 3건은 측정 근거 없음 | E1 | `G-OUTAGE-R4`·`G-OUTAGE-R6`·`G-OUTAGE-R11`(보고서 자인) | — |
| 네트워크 인내 30분·30초는 보고서 제안 | E1 | `G-POWER-R8` | — |
| AppKit 막대 실제 두께는 재지 않았다 | E1 | `J-F-B8`(B의 4px은 가늘다) | 2026-10-09 |
| 후보 A의 44·440·680·80·40은 출처 없음 | E1 | `J-A`, judgment §1.4 | — |

최고 등급: E1 / 결정 영향: 작음(값 하나씩 바뀐다) / 판정: 채택(잠정)

## 결과

- foundations §13(토큰)·§14(상수)가 값을 든다. `design-tokens DT14·DT15가 문서와 코드의 일치를 본다.
- 각 값 옆 [취향]·[잠정]·[제안] 표기는 유지한다. 확인되면 표기를 지우고 이 ADR을 `폐기(→ 새 번호)`로 바꾼다.
- README §6-7은 이 표를 가리킨다.

### 재검증 조건

- D62 1회차 뒤: V4(글자 크기)·V6(툴바)·V8(토스트)·UT5(회복 알림)·UT7(접힘·최근 개수) 관찰 결과로 해당 값을 다시 본다.
- Windows·Linux 실기(platform §21 M2·M10·M16·M23) 결과.
- 운영 3개월 뒤 공지·서킷 값(ROADMAP 릴리스 항목).

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 값마다 ADR 한 장 | 근거 등급이 모두 E1 이하라 내용이 같고 장수만 늘어난다 |
| 보고서 제안값을 쓰지 않고 측정 뒤 정하기 | 측정 수단(사용자 시험)이 적용 뒤에야 가능하다. 제안값으로 시작하고 바꾸는 것이 README §6의 방식 |
| 상수를 CSS 토큰으로 두기 | JS 타이머·Rust가 쓰는 값이라 CSS에 두면 `design-tokens`의 ms 토큰 집합이 흐려진다(patterns §17-3) |
