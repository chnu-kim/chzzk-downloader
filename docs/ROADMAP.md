# ROADMAP

여러 세션·며칠에 걸친 재구축 작업의 **단일 진행 기록**이다. 컨텍스트가 요약돼도 이 파일이 남으므로, 단계를 넘길 때마다 "현재 위치"와 체크리스트를 갱신한다.

## 현재 위치

- 현재: Phase 1 코어(`crates/core`, 설계 §10-1~15) 구현 완료, 브랜치 `feat/rust-core`. 3 OS CI 녹색(PR #12, Windows 잠금 테스트 수정 후), 실서버 스모크(빠른 다시보기 HLS·DASH VOD·클립) 통과(2026-10-05, 설계 "구현 중 변경" 45). 14~15단계 리뷰 수정(옛 형식 settings.json 보존, 이어받기 ETA 등, 구현 중 변경 47~51) 반영
- 남은 것: 성인 PD에 미디어 쿠키가 필요한지 실측(로그인 쿠키 필요, `examples/dl.rs`의 `CHZZK_NID_AUT`·`CHZZK_NID_SES`로 사용자가 직접)
- 다음: §10-16 Go 코드 삭제(별도 PR) → Phase 2 Tauri 셸

## 확정된 결정 (2026-10-05, 사용자 인터뷰)

| 주제 | 결정 | 근거·메모 |
|---|---|---|
| 하네스 범위 | 이 프로젝트만. 최소로 초기화하고 반복 마찰이 생길 때만 늘린다 | 글로벌 `~/.claude`는 건드리지 않음 |
| GUI | **Tauri v2 + Svelte 5 + TS** | |
| 백엔드 | **Go → Rust 전면 이식** | Go 테스트·`testdata`를 행동 명세로 삼는다. Rust가 이식된 테스트를 통과하는 PR에서 Go 삭제 |
| ffmpeg | **제거**. 빠른 다시보기(HLS)도 세그먼트를 직접 받아 이어 붙임 | 완전 무설치. 필요해지면 선택적 remux를 나중에 |
| 크로스 플랫폼 | Windows / macOS / Linux | |
| 인증 | **전용 Cloudflare Worker**가 치지직 OAuth 코드→토큰 교환을 대행 (client secret은 Worker에만) | 구현 참고: `../기존 웹 앱` (`src/lib/chzzk.ts`, `src/app/api/auth/*`, `docs/AUTH.md`) |
| 본인 영상 제한 | **정책·명분 수준**. 클라이언트에서 로그인 채널 ID == VOD/클립 채널 ID 검사 | 우회 불가능할 필요는 없음 |
| 네이버 쿠키 | `NID_AUT`/`NID_SES` 기반 접근은 **고급 설정으로 유지** | 연령 제한·구독자 전용 VOD용. Open API 토큰으로는 재생 URL을 못 받음 |
| 배포 | **repo private 유지**, 본인·지인만. Worker가 **로그인 랜딩 페이지 + 허용목록(채널 ID) + R2 다운로드 게이트** | 앱 사용도 같은 허용목록으로 제한. 업데이트 매니페스트·산출물도 인증 필요 |
| 코드 서명 | **미서명 배포** (Apple Developer 계정 없음) | 랜딩 페이지에 Gatekeeper/SmartScreen 해제 안내. Tauri updater 서명 키는 별개로 필요 |
| 진행 방식 | **자율 진행**, 단계별 stacked PR | 각 PR 후 Codex 리뷰를 원문 전달. 반영·머지는 사용자가 결정 |

## 사전 조사로 확정된 사실 (2026-10-05)

- 빠른 다시보기 HLS는 **fMP4**(init + `styp/moof/mdat` 세그먼트, 2초), 암호화·byte-range·discontinuity 없음, 상대 URI(경로 안 토큰 서명), 헤더 불필요. **서명 토큰이 약 17시간 뒤 만료**되므로 긴 VOD는 403 시 info→master→media 재조회 후 같은 sequence부터 이어받아야 한다.
- 일반 VOD 중 `encryptionType: "AES"`인 것은 PD_* progressive URL이 없다(AES에도 `inKey`는 있으므로 `encryptionType`을 먼저 본다). **명확한 오류로 거부(사용자 확정, 2026-10-05)**. 제3자 중계권 콘텐츠의 접근 통제 키 우회 위험 때문. 사실은 `docs/design/core.md` §11.
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

- [x] 사전 조사: 라이브 리와인드 HLS 실물 fixture 확보 (`testdata/hls/`, 결과 `docs/research/hls-live-rewind.md`)
- [x] 설계 판정 (`docs/design/core.md`) + 일반 VOD DASH fixture 확보 (`testdata/vod/`)
- [x] §10-1 workspace 골격 + 3 OS CI 설정 (`cargo test -p chzzk-core`)
- [x] §10-1 남은 항목: 3 OS CI 녹색 확인 (2026-10-05)
- [x] §10-2~4 순수 함수: progress 포맷, naming, url
- [x] §10-5~7 순수 파서: info/`classify`(inKey 분기 통합, AES seam), mpd, hls
- [x] §10-8 http + `resolve` (wiremock)
- [x] §10-9~13 다운로드 엔진: part/retry → progressive → segmented(순차 → 동시·403 재조회) → 진행률
- [x] §10-14 settings / credentials / legacy import
- [x] §10-15 실서버 스모크(`examples/dl.rs`, `tests/live.rs`) + 문서 정정(§12) + CLAUDE.md 갱신
- [ ] §10-15 남은 항목: 성인 PD 쿠키 실측(로그인 쿠키가 있어야 해서 미실측)
- [ ] §10-16 (별도 PR) Go 코드 삭제, `internal/api/testdata` → `testdata/clip/`

### Phase 2 — GUI (Tauri + Svelte)
- [ ] `app/` Tauri 셸: 코어를 command/event로 노출
- [ ] 화면: URL 입력 → 품질 선택 → 저장 경로 → 진행률, 최근 VOD, 설정(다운로드 폴더, 네이버 쿠키)

### Phase 3 — Worker (인증·랜딩·배포 게이트)
- [ ] 사전 확인: 치지직 OAuth 엔드포인트·토큰 형태·`users/me`의 channelId (chzzk MCP + 기존 웹 앱 코드), loopback redirect 허용 여부, VOD 응답 채널 ID와 OAuth channelId가 같은 식별자인지
- [ ] 데스크톱 로그인 플로우 (redirect가 Worker로 오면 일회용 id 폴링)
- [ ] 허용목록, 앱 세션 토큰
- [ ] 랜딩 페이지 (로그인 → 허용된 사람만 OS별 다운로드)
- [ ] R2 산출물 + Tauri updater 매니페스트를 인증 뒤에서 제공
- [ ] 앱: 로그인 화면, 본인 채널 검사

### Phase 4 — 릴리스 파이프라인
- [ ] 태그 push → Win/macOS/Linux 빌드 → R2 업로드 → 매니페스트 갱신
- [ ] Worker 배포 워크플로

## 사용자가 준비해야 할 외부 항목

자격증명 없이도 `wrangler dev`와 테스트로 개발은 진행한다. 실제 배포는 아래가 갖춰진 뒤 사용자와 함께 한다.

- [ ] 치지직 개발자 앱 등록 (client id / secret, Redirect URI = Worker 콜백 URL)
- [ ] Cloudflare: Worker, R2 버킷, KV 또는 D1, (선택) 커스텀 도메인
- [ ] GitHub Secrets: Cloudflare API 토큰, R2 자격, Tauri updater 서명 키쌍 (`pnpm tauri signer generate`)

## 하네스 변경 이력

하네스(규칙·skill·agent·hook)를 늘릴 때 이유를 한 줄로 남긴다.

- 2026-10-05: 초기화. CLAUDE.md + settings.json만 둔다.
- 2026-10-05: CLAUDE.md를 Rust 코어 기준으로 재작성(레이아웃, 검증 게이트 fmt·clippy·test, 실서버 스모크 실행법). Go는 레거시로 표시.
