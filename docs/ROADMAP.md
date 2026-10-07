# ROADMAP

여러 세션·며칠에 걸친 재구축 작업의 **단일 진행 기록**이다. 컨텍스트가 요약돼도 이 파일이 남으므로, 단계를 넘길 때마다 "현재 위치"와 체크리스트를 갱신한다.

## 현재 위치

- **저장소**: 개발은 public `chnu-kim/chzzk-downloader`(remote `origin`)에서 한다. `chnu-kim/chzzk-downloader-private`(remote `private`)는 공개 전 원본 이력·연구 문서·실물 fixture·비공개 원문 목록(`public-release/`)의 보관소이며 **그쪽 ref를 origin에 push하지 않는다**(pre-push 가드가 막는다). 공개 절차는 `docs/public-release.md`.
- **완료(2026-10-06 기준, 모두 master에 머지)**: Phase 0 하네스, Phase 1 Rust 코어, Go 삭제, Phase 2 Tauri 앱(macOS 실제 실행 확인), Phase 4 CI/CD(public PR #1: 단일 진입점·`ci.yml`/`ci-ok`·훅·비공개 이력 가드·스모크·ratchet·E2E·nightly/weekly 고리·CD `release.yml`/`xtask`·ruleset master/tags·저장소 설정 적용(2026-10-06 사용자 `repo-settings --apply --yes`, `--check` 드리프트 0)), CI 단축·Rust 1.99(#12), Windows 네이티브 E2E를 PR마다 관찰(#14).
- **Phase 3 설계 완료(2026-10-06)**: `docs/design/worker.md`(Worker·DO `AuthStore`·R2 게이트·updater·앱 셸 계약, 열린 질문은 §17 "사용자 답변"으로 닫음). 코드 쪽 변경 기록은 cicd.md 80~84, app.md 59.
- **Phase 3 W1 완료(2026-10-06, #20 머지, ratchet `tests.worker`=57 #21)**: `worker/` 골격과 gate `worker`·ci.yml `worker` 작업(`ci-ok` 필수). 이어서 문서 PR #23~#26(비용 0 제약·머지 위임·리디렉션·자격증명 분리).
- **Phase 3 W2 완료(2026-10-06, #28 머지)**: `worker/src/core/` 순수 모듈 아홉(vitest 441개, ratchet `tests.worker`는 master 측정으로 올린다), 결정은 worker.md 구현 중 변경 13~16·cicd.md 87·88.
- **Phase 3 W3 완료(2026-10-06, #29 머지)**: `worker/src/store/` DO `AuthStore`(SQLite 스키마 v1·흐름·세션 회전·허용목록·청소 알람, vitest 545개). 결정은 worker.md 구현 중 변경 17~24·cicd.md 89·90.
- **Phase 3 W4 완료(2026-10-06, #30 머지)**: OAuth 흐름(`worker/src/http/` 앱·웹 start·확인 페이지·콜백·done·poll·refresh·logout·`/api/me`, 가짜 치지직 `test/fake-chzzk.mjs`, hygiene 카나리, dev 모드 `CHZZK_REDIRECT_URI` 고정과 모르는 문자열 바인딩 거부, vitest 677개). 결정은 worker.md 구현 중 변경 26~28·cicd.md 92·93. 남은 확인: 실제 치지직의 code 재사용 거부는 실서버 몫, `pnpm dev:real`에서 모르는 키 검사가 실제 마운트를 통과하는지는 사용자가 직접.
- **Phase 3 W5 완료(2026-10-07, #31 머지)**: R2 게이트 `/releases/**`(보이는 키 표·Range 206·416·304·헤더·3xx 0건)·`/update/:current`·`releaseAuth`(앱 access·웹 쿠키·CI 토큰), 요청당 R2 2회 이하·list 0회를 호출 계수 표 43행으로 고정, 합성 릴리스 `test/seed-release.mjs`, xtask 키 일치, 자격 × 경로 행렬. 결정은 worker.md 구현 중 변경 30~34·cicd.md 94·95. 남은 확인(W9): 운영 R2의 만족 불가 Range·`obj.range` 모양·재포장 `Content-Length`·`no-transform`(32 (가)).
- **Phase 3 W8 완료(2026-10-07, #32 머지)**: 릴리스 연결(`worker-bundle`·`deploy-worker`·`release.mjs worker` 배포 뒤 검사·R2 보존 상한 prune·`secrets.DIST_BASE_URL`·`vars.R2_BUCKET`). W5(#31) 뒤로 rebase했고 배포 뒤 검사를 W5 코드와 대조해 계약 표 `worker/test/deploy-contract.mjs` 하나로 Worker·release.mjs·가짜 Worker를 함께 고정했다(검사 health + 일곱). 결정은 worker.md 구현 중 변경 35~37·cicd.md 96~98.
- **Phase 3 W6 완료(2026-10-07, #33 머지, W8 #32 뒤로 rebase)**: 랜딩 `/`(스크립트 0개, 로그인 상태별 화면·설치 파일 표·Gatekeeper/SmartScreen 해제 안내, R2는 `latest.json`·SHA256SUMS get 2회 이하·list 0, R2가 던져도 200)·내 기기 `/me/sessions/:id/revoke`·웹 로그아웃·관리 화면 `/admin*`(허용목록·거부 기록·세션·감사, [허용]·[빼기]·[끊기])·해시 이름 스타일시트, 웹 POST 가드(부트스트랩 → Origin → Content-Type 415 → 본문 → 세션 → 관리자 → csrf), 행렬 24쌍·R2 호출 수 표 60행(DO RPC 수 포함), html 호출형·인라인 낱말 수 정적 검사. 결정은 worker.md 구현 중 변경 38·39, cicd.md 99(35~37·96~98은 W8). 남은 확인(W9): 실기기 Gatekeeper 문구·`xattr` 경로, 실제 브라우저의 Origin(W7 E2E는 브라우저 규칙을 흉내 냈다, worker.md 구현 중 변경 40 (아)).
- **Phase 3 W7 완료(2026-10-07, #34 머지, `worker-e2e` D14 관찰 시작 2026-10-07: 머지 뒤 첫 master 실행 37536330936 녹색, 편입 판단은 2026-10-21 이후)**: wrangler dev E2E(`worker/scripts/e2e-dev.mjs`·가짜 치지직 `worker/scripts/fake-chzzk-server.mjs`·순수 함수 `worker/test/e2e-lib.mjs`, gate `worker-e2e`, ci.yml `worker-e2e` 작업은 D14 관찰로 `ci-ok` 밖). 실제 HTTP로 웹·앱 로그인·회전·랜딩·관리 POST(Origin 규칙, `Origin: null` 403)·`/releases`·`/update`·스로틀 키(IPv4·IPv6 /64)·`release.mjs worker --check-only`(W8 인계 확인)를 보내고 Worker JSON 로그 줄의 카나리(합성 IP 포함) 0건을 본다. `--log-level warn`은 Worker 이벤트 줄까지 지워 쓰지 않는다. 결정은 worker.md 구현 중 변경 40·41, cicd.md 100. 관찰 시작 2026-10-07(실행 37536330936), 2026-10-21 이후 `CODE_GATED_JOBS` 편입 판단. Phase 3 Worker 묶음(W1~W8)의 마지막이다.
- **W9 대부분 완료(2026-10-07)**: 수동 첫 배포(첫 생성만 로컬 `wrangler login`, 이후 토큰 통과)·exports DO 선언 실배포 수락·secret 넷·부트스트랩 → 관리자 로그인 → 운영 모드·수동 검사 §2.7 다섯 통과·code 묶임(① 거부 ② 성공 ③ 거부)·실제 브라우저 관리 POST 통과·Workers Logs URL 누출 발견 → #38 수정 → 재배포 뒤 DO 줄에 URL 메타데이터 없음. 첫 실제 릴리스 `v0.1.0`(실행 37551340797) gate~report 13개 모두 녹색(deploy-worker 포함), 승격 뒤 `--check-only` health+7 통과·Range 0-9·접미 206·끝 넘는 Range 206·만족 불가 Range 416·`Content-Length` 있음·압축 없음·`/update` 200/204·Actions 로그 마스킹 호스트 0건·Worker 경유 `xtask release verify` 통과 → 환경 `release` `VERIFY_VIA=worker`. GitHub `WORKER_DEPLOY_ENABLED`는 저장소 변수 `true`(환경 변수 삭제). 결정·실측은 worker.md 구현 중 변경 44, 절차·단계별 결과는 런북.
- **M1 완료(<날짜>, #<PR> 머지)**: 랜딩 macOS 설치 안내를 실기기 결과(손상 경고)에 맞춰 응용 프로그램 이동 + xattr로 바꿨다. 앱 이름은 tauri.conf.json productName이고 worker-config가 고정한다(worker.md 구현 중 변경 M1-1). 태그 릴리스는 sign-publish preflight에서 VERIFY_VIA=worker·CI_VERIFY_TOKEN을 요구하고, verify가 방어로 한 번 더 본다(worker.md M1-2, cicd.md M1-3).
- **다음**: **W9 남은 하나**(무료 한도 사용량(며칠 뒤)). 이어서 **Phase 3b A1~A5**(앱 Worker 로그인·updater·소유권 게이트). 1.0.0은 Phase 3b와 W9 운영 안정 뒤 사용자 승인. 랜딩 안내 변경의 운영 반영은 다음 Worker 재배포(태그 릴리스의 deploy-worker 또는 사용자 승인 수동 배포) 때다.
- **W9 사전 확인 완료(2026-10-07)**: 실제 R2 `cargo xtask release list-keys --prefix releases/` 서명 통과(exit 0, 키 0개), GitHub secret·변수 이름 모두 있음, 치지직 운영 앱 리디렉션 = `DIST_BASE_URL` + `/auth/callback` 일치(사용자 확인). 1Password `chzzk-downloader-release`에는 `R2_ACCOUNT_ID` 키가 없고 같은 값인 `CLOUDFLARE_ACCOUNT_ID`를 쓴다(런북 §0).
- **G-ID 일치(2026-10-06)**: OAuth `users/me`의 `channelId`가 VOD `content.channel.channelId`·클립 `ownerChannel.channelId`와 같은 값이다(사용자가 본인 계정·본인 업로드 VOD·클립으로 직접 확인, 셋 다 32자리 소문자 hex). 앱 `OwnershipGate`는 A5에서 켤 수 있다(대안 B `owner_channel_id`는 필요 없음).
- **관찰 중**: `e2e-native (linux)`·`e2e-native (windows)`는 2026-10-06(master 첫 실행 37411321875 녹색)부터 14일 관찰 → 2026-10-20 이후 `ci-ok` 편입 판단(cicd.md 36·79). `worker-e2e`는 2026-10-07(master 첫 실행 37536330936 녹색)부터 → 2026-10-21 이후 편입 판단(cicd.md 100 (나)). 관찰 날짜는 실행 `createdAt`의 KST 날짜로 센다. Actions 캐시가 10.99GB로 한도(10GB)를 조금 넘음 — 계속 넘으면 캐시 키 정리.
- **W9 사전 준비 끝(2026-10-06), W9가 배포 가능한 상태는 아니다**: 남은 것은 W9 당일 사용자와 하는 Worker secret 4개(`CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`은 `chzzk-downloader-worker-prod`, `ADMIN_CHANNEL_IDS`는 첫 배포 뒤 로그인으로, `CI_VERIFY_TOKEN`은 1Password `chzzk-downloader-release`)와 첫 수동 배포다. 끝난 사전 준비: Cloudflare R2 버킷(비공개)·토큰 하나(Workers Scripts Edit + 이 버킷 한정 Bucket Item Read/Write, 다른 버킷 403 실측), GitHub 저장소 secret `DIST_BASE_URL`·변수 `R2_BUCKET`, 환경 `release` secret `CI_VERIFY_TOKEN`·`R2_ACCOUNT_ID`·`CLOUDFLARE_ACCOUNT_ID`·`CLOUDFLARE_API_TOKEN`·`R2_ACCESS_KEY_ID`(토큰 id)·`R2_SECRET_ACCESS_KEY`(토큰 값의 SHA-256. 계정 API 토큰을 R2 S3 자격으로 쓸 때 Cloudflare가 정한 secret access key 형식이고, 다른 버킷 403 실측이 이 값으로 서명해 확인했다)과 변수 `VERIFY_VIA=s3`·`WORKER_DEPLOY_ENABLED=false`, 치지직 운영 리디렉션 URL, 로컬 테스트용 치지직 앱 + 1Password `chzzk-local-dev`(→ `worker/.dev.vars` 마운트, 운영 Environment는 마운트 없음), 로컬 `wrangler login`. 원본 기록은 1Password `chzzk-downloader-release`. 환경 `drift`는 `CHZZK_LIVE_DASH`·`CHZZK_LIVE_CLIP`만(라이브 다시보기 `CHZZK_LIVE_HLS`는 사용자가 방송한 뒤, 그때까지 drift `no_target` 이슈는 정상). 릴리스·배포를 막지 않지만 비어 있는 것: `audit`의 `RULESET_READ_TOKEN`(nightly `ruleset-drift`만 실패), `drift`의 `CHZZK_LIVE_HLS`(nightly `drift`의 HLS 항목만 `no_target`).
- **남은 확인(사용자)**: 성인 VOD PD 미디어 요청에 쿠키가 필요한지(`examples/dl.rs` + `CHZZK_NID_AUT`/`CHZZK_NID_SES`), Windows·Linux 실제 실행(app.md 수동 테스트 목록), macOS Dock 종료·로그아웃 때 D1 생략 수용 여부.
- 단계별 상세 기록은 아래 체크리스트와 `docs/design/{core,app,cicd}.md`의 "구현 중 변경"에 있다.

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

### Phase 3 결정 (2026-10-06, 사용자 결정. 상세는 `docs/design/worker.md` §2·§17)

| 주제 | 결정 | 근거·메모 |
|---|---|---|
| 허용목록 | Durable Object(`AuthStore`, SQLite)에 저장, 랜딩 `/admin` 관리 화면에서 편집. 관리자는 Worker secret `ADMIN_CHANNEL_IDS` | 강한 일관성 → 제외가 다음 요청부터 |
| Worker 연결 불가 시 앱 | 마지막 성공 갱신부터 **3일 오프라인 유예**. 유예는 네트워크 계열 실패에만, Worker의 형식 있는 401·403은 즉시 차단 | 진행 중 다운로드는 늘 계속 |
| 허용목록 재확인 | 앱 시작 + **24시간마다** | 그 사이 Worker에 닿는 요청도 DO 대조 |
| 앱 세션 | refresh **30일 슬라이딩** rotation + **절대 상한 60일** | 60일 뒤 재로그인. 치지직 앱 90일 미사용 삭제(R7) 대책도 된다 |
| 업데이트 | **시작 때 자동 확인**(세션 확인 성공 직후 한 번) → 배너, 설치는 사용자 | |
| Worker 주소 | workers.dev, 주소는 저장소에 두지 않고 **저장소 secret `DIST_BASE_URL`** 하나가 원천 | Actions 로그 마스킹(cicd.md 84) |
| 웹 세션 | 랜딩 쿠키 **12시간 절대** | 관리 권한이 붙는 세션은 짧게 |
| 앱 로그인 피싱 대비 | **확인 코드 페이지** + [계속] | 공격자가 시작한 로그인을 눈에 보이게 |
| 비용 | **Cloudflare 무료 범위만, 금전 비용 0**(2026-10-06). Workers Free 유지, 커스텀 도메인 없음(workers.dev) | 결제 수단이 등록돼 있어 R2 초과분은 청구된다 → 보존 상한·비공개 버킷·요청당 R2 호출 상한(worker.md 구현 중 변경 11) |
| PR 머지 | **에이전트에 전부 위임**(2026-10-06). `ci-ok` 녹색 + Codex 리뷰 2종 뒤 머지 | 릴리스 태그·실배포·Cloudflare 리소스 생성은 따로 승인 |
| Error 1027 분류 | **실측하지 않는다**(2026-10-07, 공용 계정). 앱 `classify_verify`는 Worker의 형식 있는 401·403만 즉시 차단, 그 밖의 4xx·5xx와 Cloudflare 오류 페이지는 네트워크 계열(3일 유예) | worker.md 구현 중 변경 42 (라) |
| 버전 줄 | **0.1.0 유지**(2026-10-07). 첫 실제 릴리스는 태그 `v0.1.0`(접미사 없음, 버전 PR 없음), 이후 0.1.x, 1.0.0은 Phase 3b(A1~A5)·W9 운영 안정 뒤 사용자 승인. `v0.1.0` 앱은 Worker 로그인·자동 업데이트가 없어 0.1.x는 랜딩에서 직접 설치 | 42 (바). MSI pre-release 식별자 제약을 피함 |
| 실제 R2 rollback 시험 | **W9에서 하지 않는다**(2026-10-07, previous 없음). 0.1.1 뒤 선택으로 `rollback.yml` 0.1.0 → 확인 → 0.1.1 | 42 (자). 변조 경로는 가짜 S3 `release-selftest` |

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

설계는 `docs/design/worker.md`(확정안). 아래는 그 문서 §16의 묶음이다(묶음마다 stacked PR).

- [x] 사전 확인: 치지직 OAuth 엔드포인트·토큰 형태·`users/me` 응답(`docs/research/chzzk-oauth.md`), 개발용 리디렉션 `http://localhost:8787/auth/callback` 등록(2026-10-06). loopback 임의 포트는 쓰지 않는다(Worker 콜백 + 폴링)
- [x] **G-ID**: **일치(2026-10-06)**, 실제 값은 적지 않는다. OAuth `users/me` channelId == VOD `content.channel.channelId` == 클립 `content.ownerChannel.channelId`(실제 로그인, 사용자가 직접). `node worker/scripts/channel-id-check.mjs <본인 VOD> <본인 클립>`, 결과는 "같다/다르다"만 적는다(실제 값 금지). **체크 전에는 앱 `OwnershipGate`를 켜지 않는다**(worker.md §15, 다르면 대안 B `owner_channel_id`)
- [x] W0 설계 문서: `worker.md`, cicd.md 80~84, app.md 59, ROADMAP·CLAUDE.md·chzzk-oauth.md, §17 사용자 답변 반영. 참고: vitest 풀 패키지는 `@cloudflare/vitest-pool-workers`(0.22.0에서 멈춤)가 아니라 이름이 바뀐 `@cloudflare/vitest-plugin`을 쓴다
- [x] W1 골격 + CI: `worker/` 패키지·`wrangler.jsonc`·config 가드·`/health`, gate `worker`·ci.yml 작업·`ci-ok`. 실측 결과·고른 것은 worker.md 구현 중 변경 2~8, cicd.md 85. 로컬 `run.mjs worker`(vitest 57개)·`parity`·`scripts-test`·`scan`·`typos`·`workflows`·`versions`·`selftest`·`release-selftest`·`ratchet-log` 녹색, PR `ci-ok` 확인 대기
- [x] W1 뒤: 첫 master 실행 37434910274로 `tests.worker` = 57을 채웠다(#21)
- [x] W2 순수 core(token·cookies·range·keys·semver·chzzk·updater·html·usercode): 표 주도 단위 테스트(vitest 441개), semver는 xtask와 공유 벡터 `xtask/testdata/semver-vectors.json`, core 순수성·`raw` 허용 목록·bidi 리터럴 정적 검사(`worker-config.mjs`). 고른 것·리뷰 반영은 worker.md 구현 중 변경 13~16, cicd.md 87·88. #28 머지
- [x] W3 DO `AuthStore`(스키마·flow·session·rotation·허용목록·alarm): `setAlarm` 덮어쓰기·`vi.setSystemTime` 실측(17), RPC 모양(18), 스로틀·상한 32·폴링 간격과 now 역행 규칙·무료 한도 재계산(19), §5.2 표 전 행·60일 상한(20), 스키마·store 정적 검사(21, cicd.md 89·90), 멱등 청소 알람(22), W4 인계(23), 채널별 회전 상한·`refresh(expires_at)` 인덱스(24). vitest 545개. #29 머지
- [x] W4 OAuth 흐름(가짜 치지직, 앱·웹 로그인, refresh·logout, 카나리, dev 모드 모르는 문자열 바인딩 → config_error — worker.md 구현 중 변경 12 (라)): W4 실측(26), 23의 결정(claim은 행을 남기고 verifier만 비움)·가짜 치지직은 fetch 스파이·`CHZZK_REDIRECT_URI` dev 고정·모르는 문자열 바인딩·경로 `:param`·자격 없음 규칙(27), 리뷰 반영(바깥 요청 낱말 검사·code 재사용 대조 쌍·폴링 게이트 키·done의 F 지우기·수령 흐름 2분 만료·콜백 예외 종결·본문 상한 읽기·hygiene 실패 경로, 28, cicd.md 92·93). vitest 677개. #30 머지. 남은 확인: 실제 치지직의 code 재사용 거부(실서버 몫), `pnpm dev:real`의 모르는 키 검사(사용자가 직접)
- [x] W5 R2·updater·CI 토큰(보이는 키 표, Range, 자격 × 경로 행렬. R2 호출 수 테스트에 "A·W + Range + SUMS 캐시 미스"를 넣고 Range는 `head` 없이 2회 이하 — worker.md 구현 중 변경 16 (다)): miniflare R2 실측(30), 판정 순서·`releaseAuth`(CI 토큰 상수 시간 비교)·Range는 정규화 헤더로 `get` 한 번·조건부는 Worker 비교·R2 호출 수 표·`/update`·경로 표·헤더 표·R2 창구 `r2.ts`·합성 릴리스·행렬 14쌍(31, cicd.md 94), W6·W9 인계(32), 리뷰 반영(`normalizeR2Range` 길이 자르기·호출 수 표 43행·R2 쓰기·list 낱말 수 검사·`/update` 사용량 확인, 33, cicd.md 95). W5 대체 리뷰(34). #31 머지
- [x] W6 랜딩·관리 화면(CSRF·XSS, 내 기기): 랜딩·내 기기·웹 로그아웃·관리 화면·스타일시트·웹 POST 가드·신원·DO 호출·표시와 리뷰 반영(R2가 던져도 200, Bearer는 랜딩에서 무시, 빈 메모는 있던 메모 유지, 목록에 없는 채널 [빼기] 404, 관리자 채널 [추가] 409, `pub_date`는 KST 날짜, §4.5 `/me/*` W 칸 정정, worker.md 구현 중 변경 38), html 낱말 수 정적 검사(39, cicd.md 99). CSRF 9조합 × 3경로 + 415, XSS(이름·메모의 HTML·bidi), 비관리자 403, [허용] 즉시 로그인, [빼기]·[끊기] 지연 0, 행렬 24쌍, R2 호출 수 표 60행. #33 머지(W8 #32 뒤로 rebase)
- [x] W7 wrangler dev E2E(gate `worker-e2e`, D14 관찰): 가짜 치지직 서버·wrangler dev(`--env-file .dev.vars.example` + `--var`, 임시 로컬 R2 씨앗)에 시나리오 E00~E17, `--log-level warn` 기각과 요청 줄 쿼리 없음·`--var` 우선·8787 점유·씨앗 순서 실측(worker.md 구현 중 변경 40), 파일·흐름 순서·종료 코드·자식 env 허용 목록·리뷰 반영(합성 IP 카나리·동적 카나리 종류 단언·종료 코드 2 분류·로그 flush, 41), gate·관찰 작업(cicd.md 100). 관찰 시작 2026-10-07(실행 37536330936), 편입 판단 2026-10-21 이후
- [x] W8 릴리스 연결(`release.mjs worker`·`worker-bundle`·`deploy-worker`, `vars.DIST_BASE_URL` → `secrets.`, R2 릴리스 보존 상한 prune — worker.md 구현 중 변경 11. prune 전에 `release.mjs` `cmpSemver`를 공유 `semver-vectors.json`을 읽는 `release.test.mjs`와 BigInt·u64 규칙으로 맞춘다 — 구현 중 변경 16 (마)): §13.4 실측(`dist/wrangler.json` `main`은 `index.js`, 묶음은 OS·arch 전용, worker.md 구현 중 변경 35)·배포 뒤 검사와 가드(health build 일치 대기·`--check-only --base --version [--build]`·superseded는 S3로, 36)·묶음(원본 `wrangler.jsonc` 빼고 동일성 재확인, 37)·release.yml `worker-bundle`·`prune`·`R2_BUCKET`은 저장소 변수·`WORKER_DEPLOY_ENABLED`는 저장소 변수(cicd.md 구현 중 변경 96)·prune은 latest 이하 최신 5개 + previous, latest보다 높은 폴더는 남김(97)·`cmpSemver` = xtask 규칙(98)·W5 코드 대조(가짜 Worker 오류 코드·400 순서·semver 비교를 맞추고, CI 토큰 `latest.json` 200·틀린 Bearer 401 검사를 더하고, 계약 표 `worker/test/deploy-contract.mjs`를 Worker vitest·release.test.mjs가 함께 읽는다, worker.md 36 (아)). release-selftest 109개, worker vitest 944개. #32 머지. 실제 `wrangler dev`의 `--check-only`는 W7 E2E E16에서 확인했다(worker.md 구현 중 변경 40 (사)). 남은 확인: 리허설 dispatch, `rust (windows-latest)`의 release-selftest. W9로 넘김: 환경 `release`의 `WORKER_DEPLOY_ENABLED`를 저장소 변수로 옮김, 태그 전 `cargo xtask release list-keys --prefix releases/`(R2_* env, 읽기만)
- [ ] W9 배포 뒤(**대부분 완료 2026-10-07**, 남은 하나 때문에 [ ] 유지: 무료 한도 사용량(며칠 뒤, 계정 합계와 이 Worker 몫, 42 (사)). macOS Gatekeeper 문구는 M1로 닫힘(손상 경고 → xattr 안내, worker.md 구현 중 변경 M1-1). 절차 `docs/runbook/w9-first-deploy.md`, 결정·실측 worker.md 구현 중 변경 42·44): 사전 확인 셋 완료. 수동 첫 배포 통과(exports DO 수락 → R5·10 해소, secret 넷, 부트스트랩 → 관리자 로그인 → 운영 모드, `/admin` 열림, §2.7 다섯 통과, 배포 토큰 `secret list` 통과). code 묶임: ① 거부 ② 성공 ③ 거부(29 해소). 관리 POST 통과(실제 브라우저 Origin). Workers Logs: 첫 배포에서 URL 누출 발견 → #38(43) 수정 → 재배포 뒤 본 줄(`auth.login.ok`·`auth.web.logout`)에 URL 메타데이터 없음, `admin.*`·`me.*` DO 줄은 같은 jsrpc 트리거라 같다고 가정(43 (바)는 이 범위로 해소, 다음 관리 동작 때 한 번 더 확인). `v0.1.0`(실행 37551340797) 13개 녹색, `--check-only` health+7 통과, Range 206·206(끝 넘음)·416·`Content-Length` 있음·압축 없음(32 (가) ①~④ 해소), 마스킹 0(cicd.md 84 (다) 해소), Worker verify 통과 → `VERIFY_VIA=worker`. `WORKER_DEPLOY_ENABLED` 저장소 변수 `true`. 1027은 실측하지 않는다(42 (라)). 태그 모드 `VERIFY_VIA=worker` 강제 코드는 M1로 끝(cicd.md M1-3). 남은 확인: 재배포 뒤 관리 동작의 DO 줄 URL 없음
- [ ] Phase 3b A1~A5 앱: `SessionStore`·`AuthService` / command·DTO·`build.rs` 주소 규칙 / 로그인 화면·배너·copy deck / updater command / `OwnershipGate` 활성(G-ID 뒤)

### Phase 4 — CI/CD (설계: `docs/design/cicd.md`)

설계 판정은 2026-10-05에 끝났다(`docs/design/cicd.md`). 원칙: 결정적 판정만(종료 코드·골든·해시·스키마·실제 빌드/실행), 훅과 CI는 같은 진입점 `scripts/ci/run.mjs`, CI가 최종 권위. 아래 그룹 번호는 그 문서 §10이다. 수락 기준은 실제 Actions 실행으로 확인한다.

- [x] 설계 판정 (`docs/design/cicd.md`): 단일 `ci.yml` + `ci-ok` 집계, `.githooks` shim 훅, 집합 차 push-guard, R2 S3 API 배포와 `latest.json` 마지막 쓰기, 검증 실패 시 자동 롤백, ruleset 둘
- [x] G1 진입점·단일 CI·공급망 기본: `run.mjs`/`gates.mjs`/`tools.json`, 버전 원천 통합, `ci.yml`(기존 세 워크플로 삭제), SHA 핀·zizmor·actionlint·dependabot. PR #1에서 `ci-ok` success(실행 37283860770, zizmor·actionlint 0, selftest 29개), 씨앗(`@v4`+fmt 위반)에 `ci-ok` failure(37284980199). 차이는 cicd.md "구현 중 변경" 1~13. 리뷰 반영(13): ci-ok 식 guard, push·dispatch는 건너뛰기 없음, 문서 판정 허용 목록, parity 강화, 진입점 selftest(씨앗 38개)
- [x] G2 훅과 비공개 이력 가드: `public-scan --rev-range/--message-file`, `push-guard`(집합 차, 임시 저장소 테스트), `.githooks/{pre-commit,commit-msg,pre-push}` → `run.mjs hook`, parity 훅 규칙·selftest 씨앗, 리뷰 반영(메시지 원문 검사·`subjects` gate·비공개 커밋 지문·훅 gate를 커밋 내용에서 실행). 실행 37297700019 녹색(ubuntu·windows). 차이는 cicd.md "구현 중 변경" 14~25
- [x] G3 스모크·ratchet·master 고리: 앱 `--smoke`, PR 3 OS 스모크, master 번들 설치 스모크, `ci/ratchet.json`, master 실패 이슈·스케줄 keep-alive. 고리 확인 37313500324(이슈 #2 열림)·37313687915(녹색, #2 닫힘, ratchet 기준). 차이는 cicd.md "구현 중 변경" 26~35
- [x] G4 E2E 구현: Playwright 웹 E2E(`app/e2e/`, 프로덕션 dist + mockIPC 가짜 백엔드 + axe, PR), cargo feature `e2e`와 fixture 서버, 네이티브 E2E(tauri-driver, 코드 PR·master·nightly Linux, 코드 PR·weekly Windows, `nightly.yml`의 작업별 고리 `ci-loop:e2e-native-linux`·`-windows`), `hygiene-seed`, ratchet `tests.playwright` 7. 차이는 cicd.md "구현 중 변경" 36~48(수락 실행은 47, 2차 리뷰 48)
- [x] G4 Windows 네이티브 E2E: wry의 WebView2 인자가 msedgedriver의 디버깅 포트를 덮어쓰던 것을 E2E 빌드에서 합쳐 고쳤다(cicd.md 구현 중 변경 47). 고리 `ci-loop:e2e-native-windows` 열기(#3)·닫기를 실제 실행으로 확인
- [ ] G4 편입: 두 작업은 D14 관찰 중(`gates.mjs` `OBSERVED_JOBS`, `ci-ok` 밖, master 실패는 `master-failure` 이슈). 관찰 시작은 master에 머지된 뒤 첫 master·예약 실행 날(브랜치의 첫 녹색은 2026-10-05), 편입은 **그 14일 뒤 이후**에 관찰 기간의 실패가 환경 요인이 아니었으면 `OBSERVED_JOBS`에서 빼고 `ci-ok` needs·guard에 넣는 PR(cicd.md 구현 중 변경 36 "편입")
- [x] G5 Nightly·weekly 고리(`nightly.yml`): 실서버 drift(환경 `drift`, 출력은 kind만, 2회 연속 실패 시 이슈·`no_target` 3회, `simulate` 입력, `drift-log` 작업의 로그 위생 검사), advisories, pins(핀 SHA·zizmor 온라인), ruleset-drift(`repo-settings.json`, 환경 `audit`), toolchain(매주), fuzz 4 target(`fuzz/`, 고정 nightly), mutants shard 4개 + ratchet `mutants_missed`(매주, 765개 중 100개 살아남음, shard당 30~34분). 고리 확인: 37340094385(1회, 아무것도 안 함) → 37340384932(2회, `ci-loop-test:drift` #4 열림) → 37341022990(ok, #4 닫힘), 세 실행 로그의 canary 0건. 차이는 cicd.md "구현 중 변경" 49~63
- [ ] G5 뒤 사용자 할 일: 환경 `drift`에 본인 영상 secret 셋(없으면 `no_target` 3회 연속에 이슈), 환경 `audit`에 `RULESET_READ_TOKEN`(Administration 읽기 fine-grained PAT, `GITHUB_TOKEN`은 403), ~~`rust-toolchain.toml`을 최신 stable로 올릴지~~(1.99.0으로 올렸다, cicd.md 76). `mutants_missed` 기준은 100으로 채웠다(37342266385). 줄이면 weekly 실행 번호로 `ratchet.mjs write --from-run <id>`(그 실행의 `nightly mutants` 작업이 녹색이면 된다)
- [x] G6 CD: `xtask`(collect·sign·verify-sig·sums·manifest·put·promote·verify·rollback, 변조 음성 테스트, SigV4 직접 서명), `release/{updater.pub,expected-artifacts.json,latest.schema.json,tauri.release.json}`, updater plugin 등록·`pubkey` gate·누출 규칙 `signing-key`, `release.yml`(gate → build 3 OS → smoke → sign-publish → verify/rollback → deploy-worker seam → report), `rollback.yml`, 환경 `release`(태그 `v*`·master). MinIO 이미지를 받을 수 없어 Node 가짜 S3로 `release-selftest`(41개, `rust` 작업 3 OS). 차이는 cicd.md "구현 중 변경" 64~72(수락 실행 71: 리허설 37378960529, 버전 불일치 37379000360·고리 #7 열림→37380543379 닫힘). 리뷰 반영 72: 리허설은 stage(받은 3 OS 산출물로 가짜 S3 publish·verify)에서 녹색, 시크릿 작업은 컴파일하지 않음(xtask 작업 + sha256), verify는 늘 돌고 결정표·5xx 재시도, PR에서 Linux 릴리스 빌드, `release/tauri.release.json` 허용 목록
- [ ] G6 뒤 사용자 할 일: 환경 `release`에 시크릿·변수(cicd.md §8). 서명 키는 이 작업에서 로컬 `~/.tauri/chzzk-downloader-updater.key`(+`.password`)로 만들었고 공개 키만 커밋했다(백업할 것. 바꾸려면 첫 릴리스 전에 `release/updater.pub`·`tauri.conf.json`을 함께). R2 버킷·S3 토큰·`DIST_BASE_URL`은 Phase 3. 그 뒤 첫 실제 태그(버린 pre-release 버전)에서 `verify` 녹색과 `latest.json` 버전 = 태그, 변조 → rollback을 실제 R2에서 확인한다
- [x] G7 보호: 선언·도구(5dcfb5c), ruleset `master`(id 24547748) 적용(cicd.md 75), 나머지 7건(Actions 허용 목록·SHA 핀 강제·fork 승인·환경 관리자 우회·ruleset `tags`)은 2026-10-06 사용자가 `node scripts/ci/repo-settings.mjs --apply --yes`로 적용했고 `--check`가 드리프트 0(설정 11종·ruleset 2개)이다. 적용 직후의 거짓 drift(태그 update 규칙 기본값 parameters)는 52eb2af로 고쳤다. nightly `ruleset-drift`는 환경 `audit`의 `RULESET_READ_TOKEN`이 등록되면 녹색이 된다
- [ ] 비공개 denylist 고리(nightly `private-scan`, 환경 `audit`의 secret `PRIVATE_DENYLIST`, cicd.md 77): 브랜치에서 `no_secret` 실패·시험 이슈를 확인했다. secret이 있는 녹색은 머지 뒤 `gh workflow run nightly.yml --ref master -f only=private-scan`으로 확인한다
- [ ] worker-e2e 편입(cicd.md 100 (나)): 2026-10-21 이후 관찰 기간 실패가 환경 요인이 아니었으면 `OBSERVED_JOBS` → `CODE_GATED_JOBS`(`ci-ok` needs·guard)
- [ ] G4 편입(Windows 네이티브 E2E, cicd.md 79): 사용자 결정(2026-10-06, 선택지 C)으로 ci.yml `e2e-native (windows)`가 코드 PR마다 돈다(`OBSERVED_JOBS` `e2e-native-windows`, `ci-ok` 밖, master 실패는 `master-failure` 이슈, nightly 매주 실행과 캐시 공유). 관찰 시작은 **머지 뒤 첫 master 실행 날**(머지하면 날짜를 적는다), 편입 판정은 그 14일 뒤 이후에 Linux와 따로 한다(D7을 관찰 결과로 다시 본다)
- [x] CI 벽시계 단축(cicd.md 78): `tauri` gate를 `tauri-clippy`·`tauri`·`tauri-build`로 나눠 clippy를 따로 작업으로, dev 디버그 정보 `line-tables-only`, e2e-native 캐시 공유, nightly의 PR 트리거 제거. cold PR 10.2~11.8분 → 8.1분
- [ ] Worker 배포 작업은 G6의 `deploy-worker` seam을 Phase 3에서 채운다

사용자가 더해야 할 시크릿·변수의 정확한 이름은 `docs/design/cicd.md` §8.

## 사용자가 준비해야 할 외부 항목

자격증명 없이도 `wrangler dev`와 테스트로 개발은 진행한다. 실제 배포는 아래가 갖춰진 뒤 사용자와 함께 한다.

- [x] 치지직 개발자 앱 등록 (2026-10-06): 처음에는 개발용 `http://localhost:8787/auth/callback`(wrangler dev 기본 포트)을 등록했다. **지금 등록된 값은 아래 production 항목이다**(localhost는 빠졌다). 자격증명: 이 앱(운영)은 1Password Environment `chzzk-downloader-worker-prod`(마운트하지 않음). 로컬 테스트는 별도 치지직 앱(리디렉션 localhost)과 공용 Environment `chzzk-local-dev`(→ `worker/.dev.vars` 마운트)로 나눈다(2026-10-06, worker.md 구현 중 변경 12). 값을 대화·로그·저장소에 내지 않는다
- [x] production 리디렉션 URL(2026-10-06): 운영 주소 `https://<Worker 주소>/auth/callback`을 등록했고 **개발용 localhost 주소는 교체돼 빠졌다**(치지직 앱에 하나만 등록된 상태). 실제 치지직 로그인이 필요한 로컬 작업(`pnpm dev:real`, G-ID 도구)은 운영 앱을 고치지 않고 **로컬 테스트용 별도 앱**(`chzzk-local-dev`, 위 항목·worker.md 구현 중 변경 12)으로 한다. W2~W8은 가짜 치지직이라 영향 없음. 주소 값은 공개 저장소에 두지 않는다. **원천과 확인 방법**: 운영 출처는 1Password Environment `chzzk-downloader-release`의 `DIST_BASE_URL`(읽을 수 있는 기록, 저장소 secret `DIST_BASE_URL`과 같은 값)이고, 치지직에 등록된 값은 정확히 그 값 + `/auth/callback`이어야 한다. `DIST_BASE_URL`·Worker 이름·서브도메인을 바꾸면 세 곳(1Password, 저장소 secret, 치지직 앱)을 함께 바꾼다. 원래 메모: 콜백 경로는 **`/auth/callback`으로 고정**(Worker는 이 경로와 로컬 포트 8787을 지킨다). 호스트는 Cloudflare 계정·Worker 이름(권장 `chzzk-downloader`) 또는 커스텀 도메인이 정해지면 `https://<호스트>/auth/callback`을 치지직 앱에 추가한다(URL을 하나만 받으면 교체). 그 출처 `https://<호스트>`는 Worker `PUBLIC_ORIGIN`(= 저장소 secret `DIST_BASE_URL`)과 바이트까지 같아야 한다(Worker가 `redirectUri`를 `PUBLIC_ORIGIN + /auth/callback`으로 만든다)
- [ ] Cloudflare (**사전 준비 끝, W9 당일 남음**: Worker secret 4개 `wrangler secret put`과 첫 배포): (2026-10-06 R2 버킷 `chzzk-downloader-dist` 생성, Standard, r2.dev 공개 꺼짐. 기존 계정을 다른 Worker들과 함께 쓰므로 무료 한도는 계정 합계다) Worker(Durable Object(SQLite)·R2 바인딩), R2 버킷, (선택) 커스텀 도메인. Worker secret 4개(`CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`ADMIN_CHANNEL_IDS`·`CI_VERIFY_TOKEN`)는 사용자가 `wrangler secret put`으로 넣는다. 전체 시크릿·변수 표는 `docs/design/worker.md` §10.3(`DIST_BASE_URL`은 저장소 secret, cicd.md 84)
- [x] (2026-10-06, 위 "현재 위치"의 W9 외부 준비) GitHub Environment `release`·`drift`의 시크릿·변수 (정확한 이름은 `docs/design/cicd.md` §8. 단 `DIST_BASE_URL`은 환경이 아니라 **저장소 secret**, cicd.md 84): Tauri updater 서명 키(로컬 `~/.tauri/chzzk-downloader-updater.key`·`.password`, 공개 키는 `release/updater.pub`), R2 S3 토큰, 본인 영상 drift 대상, Phase 3에 Cloudflare API 토큰. 환경 `release`는 만들어 두었다(배포 정책 태그 `v*`·master)

## 하네스 변경 이력

하네스(규칙·skill·agent·hook)를 늘릴 때 이유를 한 줄로 남긴다.

- 2026-10-05: 초기화. CLAUDE.md + settings.json만 둔다.
- 2026-10-05: CLAUDE.md를 Rust 코어 기준으로 재작성(레이아웃, 검증 게이트 fmt·clippy·test, 실서버 스모크 실행법). Go는 레거시로 표시.
- 2026-10-05: 공개 저장소 준비. fixture를 합성으로 바꾸고(`scripts/fixtures/gen-fixtures.mjs`), 누출 검사기 `scripts/ci/public-scan.mjs`와 CI `public-scan.yml`을 더했다. 이력 정리 절차는 `docs/public-release.md`.
- 2026-10-05: CI/CD 설계(`docs/design/cicd.md`). 훅·CI 단일 진입점 `scripts/ci/run.mjs`, 집계 체크 `ci-ok` 하나, 결정적 판정만. 새 E2E 작업은 2주 관찰 뒤 필수로 올린다.
- 2026-10-05: G1. CLAUDE.md의 검증 게이트를 `node scripts/ci/run.mjs <gate>`로 바꾸고 훅 설치 명령(`run.mjs install-hooks`)을 적었다. `core.yml`·`app.yml`·`public-scan.yml`은 `ci.yml`로 합쳤다.
- 2026-10-05: G2. 훅 세 개를 `run.mjs hook <이름>`으로 바꾸고 pre-push에 비공개 이력 가드(`push-guard.mjs`)를 넣었다. "private에는 push하지 않는다"를 CLAUDE.md·public-release.md에 적었다.
- 2026-10-05: G2 리뷰 반영. 커밋 메시지는 원문 전체를 검사하고, 저장된 제목은 CI `subjects`가 본다. 비공개에만 있는 커밋 133개의 지문(`scripts/ci/private-commits.txt`)을 CI `scan-history`와 push-guard가 함께 쓴다. 훅의 조건부 gate는 작업 트리가 아니라 커밋·push될 내용(임시 worktree)에서 돈다.
- 2026-10-06: G5. nightly·weekly 고리(drift·advisories·pins·ruleset-drift·fuzz·toolchain·mutants)를 더하고 CLAUDE.md "명령"에 예약 gate와 고리 확인 dispatch를 적었다. 고리는 작업마다 이슈를 열고, 연속 실패 문턱과 고정 할 일 문구를 둔다.
- 2026-10-05: G4. E2E 두 층(웹 Playwright PR, 네이티브 tauri-driver master·nightly·weekly)을 더했다. 새 E2E 작업은 2주 관찰 규칙(D14)대로 `OBSERVED_JOBS`로 시작해 `ci-ok`를 막지 않고, master 실패는 이슈로 온다. CLAUDE.md에 `e2e-web`·`e2e-native` gate와 E2E 빌드 명령을 적었다.
- 2026-10-06: CI 속도·툴체인(브랜치 `ci/speedup`). Rust 1.99.0, CLAUDE.md 명령의 `tauri` gate가 셋(`tauri-clippy`·`tauri`·`tauri-build`)으로 나뉘었고, nightly에 비공개 denylist 고리 `private-scan`을 더했다.
- 2026-10-06: Windows 네이티브 E2E를 코드 PR마다(브랜치 `ci/windows-e2e-pr`, cicd.md 79). ci.yml에 관찰 작업 `e2e-native (windows)`를 더하고 CLAUDE.md의 ci.yml·nightly.yml 설명을 고쳤다.
- 2026-10-06: Phase 3 설계(`docs/design/worker.md`, 브랜치 `phase3/worker-design`). `worker/` 디렉터리(지금은 G-ID 도구 `scripts/channel-id-check.mjs`뿐)를 CLAUDE.md 레이아웃·명령에 적었다. `worker/.dev.vars`는 1Password Environment 마운트(FIFO)이고 `.gitignore`(`.dev.vars.example`만 커밋).
- 2026-10-06: Phase 3 W1(브랜치 `phase3/w1-skeleton`). CLAUDE.md 레이아웃의 `worker/` 행과 명령(`run.mjs worker`, `pnpm dev`·`pnpm dev:real`의 `--env-file` 규칙)을 고쳤다. vitest가 `worker/.dev.vars`(FIFO)를 열지 않게 하는 `environment: "example"`과 그 검사(`worker-config.mjs`)를 더했다.
