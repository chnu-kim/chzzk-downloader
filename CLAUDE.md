# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

네이버 치지직(Chzzk) VOD·클립 다운로더다. Go CLI를 **Rust 코어(`crates/core`) + Tauri GUI**로 재구축하는 중이다. 진행 기록과 결정은 `docs/ROADMAP.md`, 코어 설계의 기준은 `docs/design/core.md`(설계와 다르게 구현한 것은 그 문서 끝 "구현 중 변경"), 옛 Go 동작 명세는 `docs/spec/core-behavior.md`다.

## 레이아웃

| 경로 | 내용 |
|---|---|
| `Cargo.toml` | Rust workspace(`resolver = "3"`, edition 2024, MSRV 1.90). 멤버는 지금 `crates/core`뿐 |
| `crates/core/` | **`chzzk-core`**(lib `chzzk_core`). Tauri 비의존 코어: URL 해석, info/MPD/HLS 파서, `resolve`, 다운로드 엔진(`.part` 이어받기), 파일명, 설정·자격증명·레거시 가져오기 |
| `crates/core/tests/` | wiremock·raw TCP 통합 테스트(오프라인). `live.rs`는 실서버 `#[ignore]` 스모크, `support/mp4.rs`는 MP4 상자 검사기 |
| `crates/core/examples/dl.rs` | 실서버 수동 스모크 CLI |
| `testdata/{hls,vod,synthetic}/`, `internal/api/testdata/` | fixture. 바이트 그대로 체크아웃한다(`.gitattributes`의 `-text`) |
| `cmd/`, `internal/`, `go.mod` | **옛 Go CLI(레거시)**. Phase 1 §10-16(별도 PR)에서 삭제하고 `internal/api/testdata`는 `testdata/clip/`으로 옮긴다. 그 전까지 수정하지 않는다 |
| `.github/workflows/core.yml` | 3 OS(ubuntu-22.04, macOS, Windows) fmt·clippy·test |

`crates/core/src` 모듈: `url`(parse_content_url) · `info`(`classify`: **inKey 분기는 이 한 곳**, `encryptionType` → `inKey` → `liveRewindPlaybackJson` 순) · `mpd` · `hls` · `http`(요청 종류별 헤더, `Secret`, `redact_url`) · `client`(`Chzzk::resolve`) · `download/`(`part`·`retry`·`progressive`·`segmented`) · `progress`(`Meter`) · `naming` · `fsutil` · `settings` · `credentials` · `legacy` · `ownership` · `error`.

## 명령

```bash
cargo fmt --all                                         # 포맷 적용

# 검증 게이트: 커밋 전에 셋 다 통과해야 한다(.github/workflows/core.yml과 같은 명령)
cargo fmt --all --check
cargo clippy -p chzzk-core --all-targets --locked -- -D warnings
cargo test -p chzzk-core --locked

cargo test -p chzzk-core --test segmented <이름>      # 통합 테스트 하나
cargo test -p chzzk-core --lib naming::                # 단위 테스트 모듈 하나

# 실서버 스모크(네트워크 사용). 대상은 https://api.chzzk.naver.com/service/v1/videos?sortType=LATEST 에서 고른다
cargo run -p chzzk-core --example dl -- https://chzzk.naver.com/video/<no> --list
cargo run -p chzzk-core --example dl -- <주소> --lowest --limit-mb 5 --out <임시 폴더>
CHZZK_LIVE_HLS=<빠른 다시보기 no> CHZZK_LIVE_DASH=<일반 VOD no> CHZZK_LIVE_CLIP=<clipId> \
  cargo test -p chzzk-core --test live -- --ignored --nocapture
```

- 일반 테스트는 모두 오프라인이다(127.0.0.1 mock). 실서버는 `#[ignore]` 테스트와 `examples/dl.rs`로만 접속한다.
- `live_hls_partial`은 최저 화질로 4 MiB 넘게 받을 수 있는 빠른 다시보기를 골라야 한다(그 전에 끝나면 실패). `live_dash_partial`은 짧은 VOD면 끝까지 받고 완성 파일을 검사한다.
- 레거시 Go: `go build -o main ./cmd/chzzk-downloader`, `go test ./...`(삭제 전까지만).

## 작업 규칙

- 브랜치에서 설계 §10 단계마다 커밋한다. 메시지는 Conventional Commit `type: 한국어 요약`. 단계별 stacked PR이고, PR을 만든 뒤 글로벌 지침의 Codex 리뷰를 따른다.
- **단계(체크박스)를 끝낼 때마다 `docs/ROADMAP.md`의 "현재 위치"와 체크리스트를 갱신한다**(세션이 요약돼도 이 파일이 남는다).
- **Go 코드가 행동 명세다.** Rust가 이식된 Go 테스트·fixture를 통과하는 PR(§10-16)에서만 Go를 삭제한다.
- 코드 주석은 한국어, 식별자는 영어(설계 문서의 이름을 따른다).
- 설계가 틀렸거나 모호하면 가장 작은 타당한 선택을 하고 `docs/design/core.md`의 "구현 중 변경"에 번호를 붙여 적는다.
- 행동을 바꾸면 해당 테스트를 함께 추가한다. 파서·선택 규칙은 실물 fixture로 고정한다.

## 주의사항

- **비밀값**: 네이버 쿠키(`NID_AUT`/`NID_SES`)와 서명 토큰(`hdnts`, `hdntl`, PD 쿼리)은 `Debug`·`Display`·오류·로그 어디에도 나오면 안 된다. URL은 `http::redact_url`, 쿠키는 `Secret`을 거친다. 서명 값을 품는 새 타입은 `Debug`를 손으로 구현한다.
- **쿠키는 API·MPD 요청에만**, 사용자가 켰을 때만(`ClientConfig.cookies`) 보낸다. 미디어 CDN에는 보내지 않는다(성인 PD는 미실측, `cookies_on_media` 스위치).
- **OS별 분기**: 파일명 규칙은 `naming::Platform` 인자로 받아 한 호스트에서 세 OS를 테스트한다. Windows는 rename 일시 잠금 재시도, 디스크 부족 코드(112·39), 예약어가 다르다. macOS/Linux에서 개발해도 Windows 동작을 깨지 않게 양쪽을 고려한다.
- 설정·자격증명 위치는 셸이 주입한다(`SettingsStore::open(config_dir)`, `CredentialStore::new(config_dir)`). 코어는 실행 파일 폴더를 쓰지 않는다.
- 루트 `settings.json`과 `dependent/`는 **실제 사용자 데이터**(옛 Go 런타임 파일, 평문 쿠키 포함)다. 읽거나 고치지 않는다. 테스트용 Go 형식 JSON은 테스트 안에서 만든다.
- `compose.yml`과 `win10/`은 `dockurr/windows`로 Windows 환경을 띄워 Windows 빌드·테스트를 하기 위한 것이다. 코드와 무관하며 건드리지 않는다.
- AES 암호화 VOD는 기본값으로 거부한다(`Error::EncryptedVod`). 지원 여부는 사용자 결정(설계 §11).
