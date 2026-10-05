# CLAUDE.md

네이버 치지직(Chzzk) VOD·클립 다운로더. 현재는 Go CLI이며, **Tauri v2 + Svelte 5 + TS 데스크톱 앱(Rust 코어)으로 전면 재구축 중**이다. ffmpeg 없이 세그먼트를 직접 받아 이어 붙이고, 인증·배포는 Cloudflare Worker가 맡는다. 확정된 결정·단계·체크리스트는 [`docs/ROADMAP.md`](docs/ROADMAP.md)가 단일 기록이다. **단계(체크박스)를 끝낼 때마다 ROADMAP의 "현재 위치"와 체크리스트를 갱신한다** (세션이 요약돼도 이 파일이 남는다).

## 레이아웃

현재 (Phase 1에서 삭제 예정):
- `cmd/chzzk-downloader/` 대화형 메인 루프
- `internal/{api,downloader,config,utils,setup}` 로직. 테스트와 `internal/api/testdata`가 있다.

유지:
- `docs/spec/core-behavior.md` Go→Rust 이식용 행동 명세(golden 값), `docs/research/` 조사 기록
- `testdata/hls/` 라이브 리와인드 HLS 실물 fixture (오프라인 파싱 전용, URL 서명은 2026-10-05 만료)

목표:
- `crates/core/` Rust 코어 (Tauri 의존 없음): api / mpd / hls / download / settings / utils
- `app/` Tauri 셸 + Svelte UI
- `worker/` Cloudflare Worker (OAuth 대행, 허용목록, R2 다운로드 게이트)

## 명령 (오늘 동작하는 것)

```bash
go build -o main ./cmd/chzzk-downloader   # 빌드 (산출물 ./main, gitignore 대상)
go test ./...                             # 단일: go test ./internal/<pkg> -run <Name> -v
go vet ./...
```

## 검증 게이트

변경한 영역별로 PR 전에 통과시킨다. 현재는 Go만 있다: `go vet ./... && go test ./...`.
Rust(`crates/core`), `app/`, `worker/`의 검증 명령은 **그 영역을 도입하는 Phase에서 이 섹션에 추가**한다.

## 규칙

- **루트 `settings.json`은 실제 사용자 데이터**다. 절대 커밋하지 않는다 (`dependent/`, `win10/`, `compose.yml`도 로컬 전용).
- **Windows/macOS/Linux 모두 동작**해야 한다. `runtime.GOOS` 분기(바이너리 확장자, User-Agent)를 깨지 않는다.
- **Go 코드가 행동 명세**다. Rust가 이식된 Go 테스트·fixture를 통과하는 PR에서만 Go를 삭제한다.
- 커밋은 Conventional Commits, `type: 한국어 요약` (예: `feat: 클립 다운로드 지원`). 단계별 stacked PR, PR 생성 후 글로벌 지침의 Codex 리뷰를 따른다.
- 문서는 한국어, 식별자는 영어.

## 참고 (이식 시 필요한 최소 사실)

- VOD info 응답에 `inKey`가 **없으면** 빠른 다시보기(HLS, `liveRewindPlaybackJson`), **있으면** 일반 VOD(vodplay API의 DASH MPD). 이 분기는 `internal/api/vod.go`의 `GetVODQualities`/`GetVODUrl` 두 곳에 중복돼 있다. 클립은 `clip.go`(순수 HTTP).
- 설정은 실행 파일 디렉토리의 `settings.json`(`UserSettings`, 최근 VOD 5개 포함), 네이버 쿠키 `NID_AUT`/`NID_SES`는 `dependent/cookie.json`. 기준은 `internal/config/config.go`.
- HLS 경로만 아직 ffmpeg를 쓴다 (PATH 또는 `dependent/ffmpeg/bin/`). DASH·클립은 ffmpeg 불필요.
