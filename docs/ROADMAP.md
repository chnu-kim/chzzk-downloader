# ROADMAP

여러 세션·며칠에 걸친 재구축 작업의 **단일 진행 기록**이다. 컨텍스트가 요약돼도 이 파일이 남으므로, 단계를 넘길 때마다 "현재 위치"와 체크리스트를 갱신한다.

## 현재 위치

- **완료**: Phase 0(#11), Phase 1 Rust 코어(#12, 3 OS CI 녹색), Go 삭제(#13), Phase 2 Tauri 앱(#14, macOS 실제 실행 확인). PR은 #11→#12→#13→#14로 쌓여 있고 아직 머지 전이다. #13은 #14와 함께 머지한다.
- **Phase 4 CI/CD 구현 중**(`docs/design/cicd.md`, 브랜치 `ci/pipeline`, 공개 저장소 PR #1). G1(단일 진입점 `scripts/ci/run.mjs`·`ci.yml`·공급망 기본)과 G2(훅·비공개 이력 가드, `node scripts/ci/run.mjs install-hooks`)를 올렸다. 다음은 G3(스모크·ratchet·master 고리). 훅·CI 명령은 CLAUDE.md "명령".
- **다음**: Phase 3+4 (Worker: 로그인·허용목록·랜딩·R2 배포 게이트·업데이트). 설계·오프라인 구현은 가능하지만 **끝까지 확인하려면 사용자의 외부 준비가 필요**하다(아래 "사용자가 준비해야 할 외부 항목").
- **Phase 3의 핵심 미확인 사실**: OAuth `users/me`의 `channelId`가 VOD `content.channel.channelId`·클립 `ownerChannel.channelId`와 같은 값인지. 실제 로그인으로만 확인할 수 있으므로 별도 단계로 둔다.
- **남은 확인(사용자)**: 성인 VOD PD 미디어 요청에 쿠키가 필요한지(`examples/dl.rs` + `CHZZK_NID_AUT`/`CHZZK_NID_SES`), Windows·Linux 실제 실행(app.md 수동 테스트 목록), macOS Dock 종료·로그아웃 때 D1 생략 수용 여부.
- 단계별 상세 기록은 아래 체크리스트와 `docs/design/{core,app}.md`의 "구현 중 변경"에 있다.

## 확정된 결정 (2026-10-05, 사용자 인터뷰)

| 주제 | 결정 | 근거·메모 |
|---|---|---|
| 하네스 범위 | 이 프로젝트만. 최소로 초기화하고 반복 마찰이 생길 때만 늘린다 | 글로벌 `~/.claude`는 건드리지 않음 |
| GUI | **Tauri v2 + Svelte 5 + TS** | |
| 백엔드 | **Go → Rust 전면 이식** | Go 테스트·`testdata`를 행동 명세로 삼는다. Rust가 이식된 테스트를 통과하는 PR에서 Go 삭제 |
| ffmpeg | **제거**. 빠른 다시보기(HLS)도 세그먼트를 직접 받아 이어 붙임 | 완전 무설치. 필요해지면 선택적 remux를 나중에 |
| 크로스 플랫폼 | Windows / macOS / Linux | |
| 인증 | **전용 Cloudflare Worker**가 치지직 OAuth 코드→토큰 교환을 대행 (client secret은 Worker에만) | 구현 참고: 같은 OAuth를 이미 쓰는 비공개 웹 앱의 구현(`docs/research/chzzk-oauth.md` §8) |
| 본인 영상 제한 | **정책·명분 수준**. 클라이언트에서 로그인 채널 ID == VOD/클립 채널 ID 검사 | 우회 불가능할 필요는 없음 |
| 네이버 쿠키 | `NID_AUT`/`NID_SES` 기반 접근은 **고급 설정으로 유지** | 연령 제한·구독자 전용 VOD용. Open API 토큰으로는 재생 URL을 못 받음 |
| 배포 | ~~repo private 유지~~ → **2026-10-05 공개 저장소로 전환**(`chnu-kim/chzzk-downloader`, 절차는 `docs/public-release.md`). 배포 자체는 본인·지인만. Worker가 **로그인 랜딩 페이지 + 허용목록(채널 ID) + R2 다운로드 게이트** | 앱 사용도 같은 허용목록으로 제한. 업데이트 매니페스트·산출물도 인증 필요 |
| 코드 서명 | **미서명 배포** (Apple Developer 계정 없음) | 랜딩 페이지에 Gatekeeper/SmartScreen 해제 안내. Tauri updater 서명 키는 별개로 필요 |
| 진행 방식 | **자율 진행**, 단계별 stacked PR | 각 PR 후 Codex 리뷰를 원문 전달. 반영·머지는 사용자가 결정 |

## 사전 조사로 확정된 사실 (2026-10-05)

- 빠른 다시보기 HLS는 **fMP4**(init + `styp/moof/mdat` 세그먼트, 2초), 암호화·byte-range·discontinuity 없음, 상대 URI(경로 안 토큰 서명), 헤더 불필요. **서명 토큰이 약 17시간 뒤 만료**되므로 긴 VOD는 403 시 info→master→media 재조회 후 같은 sequence부터 이어받아야 한다.
- **암호화(AES) VOD는 지원하지 않으며 명확한 오류로 거부한다**(사용자 확정, 2026-10-05). 판별은 `encryptionType` → MPD `ContentProtection` → playlist `EXT-X-KEY` 순이다(`docs/design/core.md` §11).
- 현 Go 코드의 VOD 화질 선택은 깨져 있다(ID에서 숫자만 뽑아 해상도 비교). Rust에서는 Representation ID 정확 일치로 바꾼다. 버그 목록은 `docs/spec/core-behavior.md` §9.
- OAuth: PKCE 없음 → Worker 대행 확정. 리디렉트 URI의 loopback 허용 여부는 문서에 없음 → **Worker 콜백 + 일회용 sid 폴링**으로 설계. 일회용 sid 저장소는 KV가 아닌 D1/Durable Object(KV는 최종 일관성).
- 본인 영상 판정: VOD는 `content.channel.channelId`, 클립은 `ownerChannel.channelId`(제작자 `makerChannel` 아님). OAuth `users/me`의 `channelId`와 같은 식별자인지는 Phase 3에서 실측.
- Tauri 2.12 계열, Svelte 템플릿은 SvelteKit+adapter-static(SPA). 진행률은 Channel API. 버전 근거는 `docs/research/stack.md`.

## 단계

### Phase 0 — 하네스 재구축
- [x] 결정 사항 기록 (이 파일)
- [x] `CLAUDE.md`를 현재 코드 기준으로 최소 재작성
- [x] `.claude/settings.json`(커밋) 신설, `settings.local.json` 초기화
- [x] `.gitignore` 정리 (런타임 데이터·VM·산출물)

### Phase 1 — Rust 코어 이식

설계는 `docs/design/core.md`(확정안). 아래 번호는 그 문서 §10의 구현 단계다.

- [x] 사전 조사: 라이브 리와인드 HLS 구조 확인 (조사 기록은 비공개, fixture는 합성 `testdata/hls/`)
- [x] 설계 판정 (`docs/design/core.md`) + 일반 VOD DASH 구조 확인 (합성 fixture `testdata/vod/`)
- [x] §10-1 workspace 골격 + 3 OS CI 설정 (`cargo test -p chzzk-core`)
- [x] §10-1 남은 항목: 3 OS CI 녹색 확인 (2026-10-05)
- [x] §10-2~4 순수 함수: progress 포맷, naming, url
- [x] §10-5~7 순수 파서: info/`classify`(inKey 분기 통합, AES seam), mpd, hls
- [x] §10-8 http + `resolve` (wiremock)
- [x] §10-9~13 다운로드 엔진: part/retry → progressive → segmented(순차 → 동시·403 재조회) → 진행률
- [x] §10-14 settings / credentials / legacy import
- [x] §10-15 실서버 스모크(`examples/dl.rs`, `tests/live.rs`) + 문서 정정(§12) + CLAUDE.md 갱신
- [ ] §10-15 남은 항목: 성인 PD 쿠키 실측(로그인 쿠키가 있어야 해서 미실측)
- [x] §10-16 Go 코드 삭제, `internal/api/testdata` → `testdata/clip/` (브랜치 `chore/remove-go`)

### Phase 2 — GUI (Tauri + Svelte)

설계는 `docs/design/app.md`(확정안). 아래 번호는 그 문서 §15의 구현 단계다. 1~10은 Tauri 없이 `crates/shell`만으로 진행하고(PR A), 11~19가 앱과 화면이다(PR B). 결정 요약은 app.md §0, 사용자가 답할 질문은 §16.

- [x] 설계 판정 (`docs/design/app.md`): 순수 Vite+Svelte 5, `crates/shell`(Tauri 비의존) + `app/src-tauri`, 구독 하나 Channel, jobs.json, 상태 8개
- [x] §15-1 골격: `app/`(Vite+Svelte) + `app/src-tauri` + workspace 멤버. 확인 항목(frontendDist 없이 컴파일, tokio Handle, TLS provider, 권한 식별자, log 경로, CSP)을 app.md "구현 중 변경"에 기록
- [x] §15-2~3 `crates/shell` 오류 DTO(`AppError`, `ErrorKind` 전체 매핑)와 나머지 DTO, ts-rs bindings
- [x] §15-4 `Backend` trait + 가짜 Backend, Send 컴파일 검사
- [x] §15-5~6 `JobStore`(jobs.json) + 시작 때 reconcile
- [x] §15-7~8 `DownloadManager`: 큐(동시 작업 수 설정 1~3)·sink·중복 → pause/resume/remove/quit/restart, `check_output`, `partial_bytes`, 재시작 후 자동 이어받기
- [x] §15-9 `SettingsService`: 경로 폴백, 쿠키 토글 클라이언트 교체, 첫 실행 legacy 후보, 비밀 누출 테스트
- [x] §15-10 `app.yml`의 `shell` 작업, CLAUDE.md 게이트 갱신 (푸시 전이라 3 OS 녹색은 PR A에서 확인)
- [x] §15-11 command 배선: commands·ChannelSink·setup·AppManifest·capabilities·CSP, 창 닫기 이벤트, 완료 OS 알림, 클립보드 링크 command, 리뷰 반영(종료 한 번만·닫기 가드·진행 Channel 검사, app.md 구현 중 변경 38). 런타임 CSP·`resolve` 수동 확인은 §15-14 통과 조건, setup 실패 안내는 §15-17로 이월
- [x] §15-12~13 프런트 기반(`api.ts`, `applyEvent`, copy deck, `errorCopy`, format golden) + UI 기본 요소 — 시각 설계·토큰은 완료(`docs/design/ui-visual.md`, `app/src/styles/tokens.css`)
- [x] §15-14 받기 화면: UrlBar → ResolveCard(화질·폴더·파일 이름·충돌 안내) → enqueue, 드래그 앤 드롭·클립보드 제안. 웹뷰 수동 확인(CSP·실제 resolve)은 통과 조건째 §15-17 스모크로 옮김(app.md §15 표, 구현 중 변경 44)
- [x] §15-15 작업 목록 화면: JobsStore 재구독, 상태별 버튼, B1 배너, D2 (app.md 구현 중 변경 45)
- [x] §15-16 설정 화면: 폴더, 동시 다운로드 수, 연결 수, 자동 이어받기, 쿠키(값 미복원), 이전 버전 가져오기(D3), 정보, B2 (app.md 구현 중 변경 46)
- [x] §15-17 창 닫기(D1 ↔ `quit`), `request_user_attention`·완료/실패 OS 알림, 시작 실패 안내, 접근성 점검 (app.md 구현 중 변경 47)
- [ ] §15-17 남은 항목: 3 OS 수동 스모크(macOS는 최종 리뷰에서 클립 받기·일시정지·D1·B1·클립보드 제안·설정 화면까지 확인, app.md 구현 중 변경 52와 47 표. 남은 것: 빠른 다시보기·일반 VOD 받기, 텍스트 드롭·붙여넣기, OS 알림, 720px, Windows·Linux 전부)
- [x] §15-18 `app.yml`의 `frontend`·`tauri` 작업 작성 (app.md 구현 중 변경 49, Linux 패키지 이름·데이터 폴더 잠금은 51)
- [ ] §15-18 남은 항목: GitHub에서 3 OS 녹색 + 번들(Windows MSI ko-KR, Linux deb·rpm·AppImage). PR B 또는 `workflow_dispatch`로 한 번 돌린 뒤 체크
- [x] §15-19 문서: ROADMAP·CLAUDE.md·app.md "구현 중 변경" 정리 (구현 중 변경 50)
- Phase 3 자리는 Phase 2에서 미리 둔다(app.md §12): `features.auth=false`, `OwnershipGate` 항상 허용, `ResolvedDto.ownership`, `JobRecord.channelId`, `auth_status` command, AccountSlot·AuthGate·OwnershipNotice 빈 슬롯

### Phase 3 — Worker (인증·랜딩·배포 게이트)
- [ ] 사전 확인: 치지직 OAuth 엔드포인트·토큰 형태·`users/me`의 channelId (chzzk MCP + 기존 웹 앱 코드), loopback redirect 허용 여부, VOD 응답 채널 ID와 OAuth channelId가 같은 식별자인지
- [ ] 데스크톱 로그인 플로우 (redirect가 Worker로 오면 일회용 id 폴링)
- [ ] 허용목록, 앱 세션 토큰
- [ ] 랜딩 페이지 (로그인 → 허용된 사람만 OS별 다운로드)
- [ ] R2 산출물 + Tauri updater 매니페스트를 인증 뒤에서 제공
- [ ] 앱: 로그인 화면, 본인 채널 검사

### Phase 4 — CI/CD (설계: `docs/design/cicd.md`)

설계 판정은 2026-10-05에 끝났다(`docs/design/cicd.md`). 원칙: 결정적 판정만(종료 코드·골든·해시·스키마·실제 빌드/실행), 훅과 CI는 같은 진입점 `scripts/ci/run.mjs`, CI가 최종 권위. 아래 그룹 번호는 그 문서 §10이다. 수락 기준은 실제 Actions 실행으로 확인한다.

- [x] 설계 판정 (`docs/design/cicd.md`): 단일 `ci.yml` + `ci-ok` 집계, `.githooks` shim 훅, 집합 차 push-guard, R2 S3 API 배포와 `latest.json` 마지막 쓰기, 검증 실패 시 자동 롤백, ruleset 둘
- [x] G1 진입점·단일 CI·공급망 기본: `run.mjs`/`gates.mjs`/`tools.json`, 버전 원천 통합, `ci.yml`(기존 세 워크플로 삭제), SHA 핀·zizmor·actionlint·dependabot. PR #1에서 `ci-ok` success(실행 37283860770, zizmor·actionlint 0, selftest 29개), 씨앗(`@v4`+fmt 위반)에 `ci-ok` failure(37284980199). 차이는 cicd.md "구현 중 변경" 1~13. 리뷰 반영(13): ci-ok 식 guard, push·dispatch는 건너뛰기 없음, 문서 판정 허용 목록, parity 강화, 진입점 selftest(씨앗 38개)
- [ ] G2 훅과 비공개 이력 가드: `public-scan --rev-range/--message-file`, `push-guard`(집합 차, 임시 저장소 테스트), `.githooks/{pre-commit,commit-msg,pre-push}` → `run.mjs hook`, parity 훅 규칙·selftest 씨앗. 구현 완료, Actions 확인 중. 차이는 cicd.md "구현 중 변경" 14~24
- [ ] G3 스모크·ratchet·master 고리: 앱 `--smoke`, PR 3 OS 스모크, master 번들 설치 스모크, `ci/ratchet.json`, master 실패 이슈·스케줄 keep-alive
- [ ] G4 E2E: Playwright(mockIPC) PR, tauri-driver Linux(master·nightly)·Windows(weekly), cargo feature `e2e`, 2주 관찰 뒤 `ci-ok` 편입
- [ ] G5 Nightly·weekly 고리: 실서버 drift(본인 영상 secret, 일반화된 kind만 출력, 2회 연속 실패 시 이슈), advisories, ruleset drift, fuzz, mutants ratchet, 핀 SHA 온라인 검증(zizmor 온라인·`pin-actions.mjs`, 어긋나면 이슈)
- [ ] G6 CD: `xtask release`, `release/updater.pub`, `release.yml`(gate → build → smoke → sign-publish → verify/rollback → Worker seam), `rollback.yml`, MinIO 리허설
- [ ] G7 보호: `.github/rulesets/{master,tags}.json`을 `gh api`로 적용(사용자 승인), 저장소 설정 선언, drift 검사
- [ ] Worker 배포 작업은 G6의 `deploy-worker` seam을 Phase 3에서 채운다

사용자가 더해야 할 시크릿·변수의 정확한 이름은 `docs/design/cicd.md` §8.

## 사용자가 준비해야 할 외부 항목

자격증명 없이도 `wrangler dev`와 테스트로 개발은 진행한다. 실제 배포는 아래가 갖춰진 뒤 사용자와 함께 한다.

- [ ] 치지직 개발자 앱 등록 (client id / secret, Redirect URI = Worker 콜백 URL)
- [ ] Cloudflare: Worker, R2 버킷, KV 또는 D1, (선택) 커스텀 도메인
- [ ] GitHub Environment `release`·`drift`의 시크릿·변수 (정확한 이름은 `docs/design/cicd.md` §8): Tauri updater 서명 키쌍(`pnpm tauri signer generate --ci`), R2 S3 토큰, 본인 영상 drift 대상, Phase 3에 Cloudflare API 토큰

## 하네스 변경 이력

하네스(규칙·skill·agent·hook)를 늘릴 때 이유를 한 줄로 남긴다.

- 2026-10-05: 초기화. CLAUDE.md + settings.json만 둔다.
- 2026-10-05: CLAUDE.md를 Rust 코어 기준으로 재작성(레이아웃, 검증 게이트 fmt·clippy·test, 실서버 스모크 실행법). Go는 레거시로 표시.
- 2026-10-05: 공개 저장소 준비. fixture를 합성으로 바꾸고(`scripts/fixtures/gen-fixtures.mjs`), 누출 검사기 `scripts/ci/public-scan.mjs`와 CI `public-scan.yml`을 더했다. 이력 정리 절차는 `docs/public-release.md`.
- 2026-10-05: CI/CD 설계(`docs/design/cicd.md`). 훅·CI 단일 진입점 `scripts/ci/run.mjs`, 집계 체크 `ci-ok` 하나, 결정적 판정만. 새 E2E 작업은 2주 관찰 뒤 필수로 올린다.
- 2026-10-05: G1. CLAUDE.md의 검증 게이트를 `node scripts/ci/run.mjs <gate>`로 바꾸고 훅 설치 명령(`run.mjs install-hooks`)을 적었다. `core.yml`·`app.yml`·`public-scan.yml`은 `ci.yml`로 합쳤다.
- 2026-10-05: G2. 훅 세 개를 `run.mjs hook <이름>`으로 바꾸고 pre-push에 비공개 이력 가드(`push-guard.mjs`)를 넣었다. "private에는 push하지 않는다"를 CLAUDE.md·public-release.md에 적었다.
