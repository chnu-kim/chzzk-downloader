# 0008 시각 회귀 기준 OS는 Linux 하나

상태: 채택(잠정)   날짜: 2026-10-09   관련: D61, D14(cicd.md), governance §2.7, foundations §3.1

## 맥락

시각 회귀(Playwright `toHaveScreenshot`)가 지금 없다(brief §3.5 "스크린샷 회귀" 빈칸). 앱은 **시스템 글꼴만** 쓰므로(사용자 결정 2) 같은 화면이 macOS(SF·Apple SD Gothic Neo), Windows(Segoe UI·맑은 고딕), Linux(fontconfig·Noto Sans CJK)에서 글자 폭·안티앨리어싱이 모두 다르게 그려진다. 세 OS의 기준선을 모두 두면 노이즈가 셋이 되고, 기준선 갱신도 세 번이다. 또 Playwright의 `deviceScaleFactor` 에뮬레이션은 테두리 픽셀 스냅을 건너뛰어 실제 배율과 다른 그림을 낸다(g-scale §1.2 실측: 에뮬레이션 1.25에서 1px 선이 2행 `[0.25, 1]`로 번지고, `--force-device-scale-factor=1.25`에서는 1행 `[1]`).

CI 작업의 OS 구성(`ci.yml`): `e2e-web`은 ubuntu-24.04 하나, `tauri`·`rust`는 3 OS. 새 E2E 성격의 작업은 D14(2주 관찰 뒤 `ci-ok`)를 거친다.

## 결정

1. 스냅샷 기준선은 **Linux(ubuntu-24.04 러너) 한 곳**에서만 만들고 비교한다. 다른 OS에서는 `design-shots` gate가 돌지 않는다(`platforms: ['linux']`). 로컬(macOS·Windows)에서 `--update-snapshots`를 거부한다.
2. 배율은 Chromium 실행 인자 **`--force-device-scale-factor=1`과 `=2`** 두 프로젝트로 낸다. `use.deviceScaleFactor`는 쓰지 않는다. 테스트 시작에서 `devicePixelRatio`를 단언한다.
3. 대상은 갤러리 섹션(컴포넌트 매트릭스·네 화면·아이콘 시트) × 라이트·다크·forced-colors × 720·960. 앱 흐름 spec은 스냅샷을 찍지 않는다(흐름은 `e2e-web`·`e2e-native`가 본다).
4. 러너에 `fonts-noto-cjk`를 설치해 한글 글꼴을 고정한다. 러너 이미지 drift로 글꼴이 바뀌면 기준선이 깨지는 것을 **받아들이고** 관찰 작업으로 지켜본다(D14).
5. 허용 오차 `maxDiffPixels`는 0에서 시작하고 `ci/ratchet.json` `shots.max_diff_pixels`로 둔다. 늘리면 `RATCHET_LOG.md` 줄이 필수다.
6. 기준선 PNG는 저장소에 커밋한다(`app/e2e/__shots__/`, `-text`). 갱신은 CI 실행의 artifact에서만 받는다(`scripts/design/shots.mjs --accept <run id>`).

## 근거

| # | 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|---|
| 1 | Playwright 문서: 기준 스크린샷은 만든 환경과 같은 환경에서 비교해야 한다. 파일명에 브라우저·플랫폼이 붙는 것이 그 때문 | E0 | https://playwright.dev/docs/test-snapshots | gov §8.3 |
| 2 | `deviceScaleFactor` 에뮬레이션은 테두리 스냅을 건너뛴다. `--force-device-scale-factor`가 실제 배율 경로다 | E1(실측, Chromium 헤드리스. Windows 실기 아님 → [추론]) | g-scale §1.2 표(`hl.mjs`·`hl2.mjs`), 규칙 11 | 실측 2026-10-09 |
| 3 | 시스템 글꼴은 OS마다 다르다. macOS `system-ui` = SF(실측), Windows는 Segoe UI/맑은 고딕 [미확인], Linux는 fontconfig | E0/[미확인] | foundations §3.1 표, `E-APPLE-05`·`E-APPLE-07`, `E-DESK-E32` | — |
| 4 | 1px 선은 125~175% 모든 배율에서 선명하고 1.5px은 뒤집힌다 → 스냅샷으로 봐야 할 것은 "선 굵기 회귀"보다 "레이아웃·색·간격 회귀"이고 이는 DPR 1·2로 충분하다 | E1 | g-scale §2.2 실측 | — |
| 5 | 기존 `e2e-web` 작업이 ubuntu-24.04 하나이고 D14 관찰 중이다. 같은 자리·같은 규칙이 가장 단순하다 | E1 | `ci.yml`, `gates.mjs OBSERVED_JOBS`, cicd.md 구현 중 변경 36 | — |
| 6 | 3 OS 스냅샷은 노이즈가 셋이 된다 | E1 | gov §8.3 시사점 | — |
| 7 | 러너의 한글 글꼴 유무·버전 | [잠정] | — | 확인: 첫 실행에서 `fc-list :lang=ko` 출력을 로그에 남긴다. drift가 나면 `master-failure` 이슈 |

최고 등급: E1 / 결정 영향: 작음(검사 수단) / 판정: 채택(잠정)

## 결과

- governance §2.7(`design-shots` 명세), ci.yml 새 작업 `design-shots`, `OBSERVED_JOBS 'design-shots': 'code'`, `report` needs, parity `observed` 규칙.
- `ci/ratchet.json`에 `shots.max_diff_pixels`(방향: 작을수록 좋다). `ratchet.mjs`에 키 처리 추가.
- macOS·Windows의 시각은 스냅샷이 아니라 **리뷰 `R1`(네 장)·`R4`(Windows 실기)**가 본다. 이 분담을 `R1` 통과 기준에 적었다(governance §3).
- Windows 125%·150% 배율의 선 번짐은 스냅샷 대상이 아니다. `design-lint` L2·L14(1·2px만)와 g-scale 실측 규칙이 정적으로 막는다.

### 재검증 조건

- 관찰 14일 동안 러너 글꼴 drift로 실패가 한 번이라도 나면: (가) 글꼴을 apt 버전 고정으로 올리거나, (나) 글자 영역을 `mask`로 가린 스냅샷으로 바꾸는 ADR. 편입(`CODE_GATED_JOBS`)은 그 뒤.
- `R1` 스크린샷에서 macOS·Windows 전용 회귀가 두 번 이상 Linux 스냅샷을 통과한 채 리뷰에서 잡히면 그 OS의 스냅샷 추가를 다시 본다(비용: 러너 분당 과금 macOS 10배).

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 3 OS 기준선 | 노이즈 3배, 갱신 3배, macOS 러너 비용. 글꼴이 OS마다 달라 "같은 회귀"가 세 번 다르게 보인다 |
| Windows 기준선(주 사용자 OS) | Windows 러너는 네이티브 E2E가 75분까지 걸리는 등 느리고(cicd.md 구현 중 변경 107), `e2e-web`과 자리가 갈라진다. Windows 글꼴 렌더(맑은 고딕) 자체가 [미확인] 항목이라 기준선으로 삼기 이르다 |
| 웹 글꼴을 번들해 OS 차이를 없앰 | 사용자 결정 2(시스템 글꼴, 번들 금지)에 반한다 |
| `deviceScaleFactor` 에뮬레이션으로 1.25·1.5·2 | 테두리 스냅을 건너뛰어 실제 창과 다른 그림(근거 2). 배율 검사는 정적 규칙(1·2px만)으로 대신한다 |
| 스냅샷 없이 axe·DOM 검사만(`design-gallery`) | 간격·정렬·색 회귀는 DOM 검사로 잡히지 않는다(`A-VIS-02`~`A-VIS-04`가 그런 결함이었다) |
