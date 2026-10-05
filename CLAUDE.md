# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

네이버 치지직(Chzzk) VOD·클립 다운로더다. Go CLI를 **Rust 코어(`crates/core`) + Tauri GUI**로 재구축하는 중이다. 진행 기록과 결정은 `docs/ROADMAP.md`, 코어 설계의 기준은 `docs/design/core.md`, 앱(셸·GUI) 설계의 기준은 `docs/design/app.md`(화면의 시각 규칙은 `docs/design/ui-visual.md`)다. 두 설계 문서 모두 끝의 "구현 중 변경"이 본문보다 우선한다(app.md는 그 절 머리의 "읽는 법" 표부터 본다). 옛 Go 동작 기록은 `docs/spec/core-behavior.md`다.

## 레이아웃

| 경로 | 내용 |
|---|---|
| `Cargo.toml` | Rust workspace(`resolver = "3"`, edition 2024, MSRV 1.90). 멤버는 `crates/core`·`crates/shell`·`app/src-tauri`. 버전은 `[workspace.package] version` 하나이고 `tauri.conf.json`·`app/package.json`과 같아야 한다(`versions` gate) |
| `crates/core/` | **`chzzk-core`**(lib `chzzk_core`). Tauri 비의존 코어: URL 해석, info/MPD/HLS 파서, `resolve`, 다운로드 엔진(`.part` 이어받기), 파일명, 설정·자격증명·레거시 가져오기 |
| `crates/core/tests/` | wiremock·raw TCP 통합 테스트(오프라인). `live.rs`는 실서버 `#[ignore]` 스모크, `support/mp4.rs`는 MP4 상자 검사기 |
| `crates/core/examples/dl.rs` | 실서버 수동 스모크 CLI |
| `testdata/{hls,vod,clip,synthetic}/` | 합성 fixture(`testdata/README.md`, 생성기 `scripts/fixtures/gen-fixtures.mjs`). 바이트 그대로 체크아웃한다(`.gitattributes`의 `-text`) |
| `scripts/ci/` | CI 스크립트(아래 `run.mjs`)와 공개 누출 검사기 `public-scan.mjs`(+`public-denylist.txt` blob 해시 목록, `public-scan.test.mjs`). `--all-history`로 이력 전체, `--staged`로 인덱스, `--rev-range`로 push 범위, `--message-file`로 커밋 메시지를 검사한다. 비공개 이력 가드 `push-guard.mjs`와 비공개 커밋 지문 `private-commits.txt`(CI `scan-history`도 본다). 훅의 조건부 gate는 `snapshot.mjs`로 커밋·push될 내용에서 돈다. 비공개 denylist는 `--denylist`로 넘긴다 |
| `crates/shell/` | **`chzzk-shell`**(Tauri 비의존 앱 셸). DTO·오류 DTO(ts-rs bindings), `Backend` trait, `DownloadManager`(큐·상태 머신·`jobs.json`), `SettingsService`, `App`(command 몸통). 테스트는 `tests/`(가짜 Backend `tests/common/fake.rs`) |
| `app/` | Vite + Svelte 5 + TS 프런트(`pnpm`, `packageManager`로 버전 고정). `src/lib/api.ts`(command 래퍼), `src/lib/bindings/`(생성물, 손대지 않는다), `src/lib/copy/`(copy deck), `src/lib/components/`·`views/`, vitest는 `*.test.ts` |
| `app/src-tauri/` | **`chzzk-app`**(lib `chzzk_app_lib`, bin `chzzk-app`). Tauri Builder·플러그인·command 배선·`ChannelSink`·로그·창 닫기 가드, `capabilities/default.json`, `tests/ipc.rs`(mock 런타임 IPC) |
| `scripts/ci/run.mjs` | **훅과 CI의 단일 진입점** `node scripts/ci/run.mjs <gate>`. gate 표는 `gates.mjs`, 도구 버전은 `tools.json`, 설계는 `docs/design/cicd.md`(끝의 "구현 중 변경"이 본문보다 우선) |
| `.github/workflows/ci.yml` | 경로 필터 없는 단일 CI: `changes`(문서만 바뀌면 무거운 작업 건너뜀) · `lint` · `scripts (windows)` · `supply` · `rust`(3 OS) · `frontend` · `tauri`(3 OS, debug 빌드 + `smoke-bin`) · `coverage`(커버리지·테스트 수 ratchet) · `e2e-web`(Playwright) · `e2e-native (linux)`(코드 PR·push·dispatch, 두 E2E는 D14 관찰 중이라 `ci-ok` 밖) · `bundle (linux)`(ubuntu 22.04 컨테이너)·`smoke-install (linux)`·`bundle (macOS·Windows)` · 집계 `ci-ok`(필수 체크는 이것 하나) · `report`(master 실패 이슈 열기·닫기, 예약 워크플로 keep-alive). 모든 `uses:`는 커밋 SHA 고정(`scripts/ci/pin-actions.mjs`) |
| `.github/workflows/nightly.yml` | 예약 고리. 매일: 네이티브 E2E Linux, 실서버 `drift`(환경 `drift`의 본인 영상 secret, kind만 출력, 2회 연속 실패에 이슈, `no_target`은 3회), `advisories`, `pins`(핀 SHA·zizmor 온라인), `ruleset-drift`(환경 `audit`의 `RULESET_READ_TOKEN`), `fuzz`(4 target, 고정 nightly). 매주: Windows 네이티브 E2E(코드 PR에서도), `toolchain`, `mutants`(shard 4개 → `mutants_missed` ratchet). 작업마다 `ci-loop:<작업 id>` 이슈(`run.mjs report-loop`, 건너뛴 작업도 마지막 성공이 오래되면 연다), `drift-log` 작업이 drift 작업 로그를 `drift-log-check`로 다시 본다(`ci-loop:drift-log`), 앞 실행의 report 자신의 실패는 `ci-loop:nightly-report`. dispatch 입력 `only`·`weekly`·`simulate`(drift 합성 출력)·`loop_test`. master가 아닌 브랜치의 dispatch는 `ci-loop-test:`에만 쓴다. PR 경로 필터는 `paths-ignore` = `gates.mjs NON_CODE_GLOBS`뿐(parity `pr-paths`) |
| `fuzz/` | cargo-fuzz 대상(`url`·`info`·`mpd`·`hls`). 루트와 따로인 워크스페이스(자기 `Cargo.lock`, 루트 `exclude`), 고정 nightly(`tools.json` `rust-nightly`)로만 빌드. seed는 실행 때 `testdata/`에서 복사(`scripts/ci/fuzz.mjs`) |
| `ci/ratchet.json`, `ci/RATCHET_LOG.md`, `release/expected-artifacts.json` | 커버리지·테스트 수·크기·살아남은 mutant ratchet 기준(나빠지면 CI 실패, 느슨하게 하면 로그에 키와 이유), OS별 번들 기대 집합 |
| `scripts/ci/repo-settings.json` | 저장소 설정 선언(nightly `ruleset-drift`가 실제 값과 비교). ruleset 선언은 `.github/rulesets/`(G7) |
| `rust-toolchain.toml`, `deny.toml`, `_typos.toml`, `zizmor.yml`, `.github/dependabot.yml` | 툴체인 고정(1.96.1, MSRV는 `rust-version` 1.90), cargo-deny, typos, zizmor, Dependabot 설정 |

`crates/core/src` 모듈: `url`(parse_content_url) · `info`(`classify`: **inKey 분기는 이 한 곳**, `encryptionType` → `inKey` → `liveRewindPlaybackJson` 순) · `mpd` · `hls` · `http`(요청 종류별 헤더, `Secret`, `redact_url`) · `client`(`Chzzk::resolve`) · `download/`(`part`·`retry`·`progressive`·`segmented`) · `progress`(`Meter`) · `naming` · `fsutil` · `settings` · `credentials` · `legacy` · `ownership` · `error`.

## 명령

```bash
cargo fmt --all                                         # 포맷 적용

# 검증 게이트: CI(ci.yml)와 같은 명령이다. 커밋 전에 건드린 쪽을 통과시킨다
node scripts/ci/run.mjs list                 # gate 목록
node scripts/ci/run.mjs fmt                  # cargo fmt --all --check
node scripts/ci/run.mjs rust                 # chzzk-core·chzzk-shell clippy -D warnings + test
node scripts/ci/run.mjs tauri                # chzzk-app clippy + test + debug 빌드(app/ pnpm install 포함)
node scripts/ci/run.mjs frontend             # app/: pnpm install --frozen-lockfile, check, test, build
node scripts/ci/run.mjs scan                 # 공개 누출 검사(추적 파일)
node scripts/ci/run.mjs scripts-test         # scripts/**/*.test.mjs
node scripts/ci/run.mjs workflows            # .github/를 바꿨을 때: pin-check + actionlint + zizmor
node scripts/ci/run.mjs versions             # 버전 원천 일치(Cargo 멤버·tauri.conf.json·app/package.json)
node scripts/ci/run.mjs smoke-bin            # tauri gate의 debug 빌드를 --smoke로 띄워 마커 확인(창이 잠깐 뜬다)
node scripts/ci/run.mjs coverage             # llvm-cov + vitest 커버리지 → ci/ratchet.json 비교(test-count는 테스트 수)
node scripts/ci/run.mjs e2e-web              # app/: build → Playwright chromium 설치(처음 한 번) → 웹 E2E(mockIPC·axe) → 통과 수 ratchet
                                             #   하나만: (app/에서) pnpm exec playwright test flow --headed. 실패 trace는 target/e2e-web/results/
node scripts/ci/run.mjs e2e-native           # Linux·Windows만(macOS는 건너뜀): --features e2e 앱 + tauri-driver로 받기 흐름 하나.
                                             #   먼저 run.mjs install-tool tauri-driver, Linux는 apt webkit2gtk-driver xvfb
node scripts/ci/ratchet.mjs write --from-run <run id>   # CI 측정값으로 ratchet 기준을 조인다(올리기만, ci.yml·nightly.yml 실행)

# 예약(nightly.yml) gate. 로컬에서도 돈다(네트워크·도구 필요)
node scripts/ci/run.mjs advisories           # cargo deny check advisories + pnpm audit --audit-level high
node scripts/ci/run.mjs pins                 # 핀 SHA가 태그와 같은지(gh) + zizmor 온라인(GH_TOKEN)
node scripts/ci/run.mjs toolchain            # rust-toolchain.toml이 최신 stable인지(낮으면 1)
node scripts/ci/run.mjs ruleset-drift        # 저장소 설정·ruleset ↔ repo-settings.json·.github/rulesets/(소유자 gh 로그인 필요)
FUZZ_SECONDS=20 node scripts/ci/run.mjs fuzz # cargo-fuzz 4 target(먼저 run.mjs install-tool cargo-fuzz, nightly는 gate가 깐다)
node scripts/ci/run.mjs fuzz-lock            # (PR lint) fuzz/Cargo.lock 최신·루트와 같은 버전 + fuzz target cargo check. lock 고치기: cp Cargo.lock fuzz/Cargo.lock && (cd fuzz && cargo metadata --format-version 1 >/dev/null)
DRIFT_SIMULATE=target_gone node scripts/ci/run.mjs drift   # drift 경로를 합성 출력으로. 실서버는 CHZZK_LIVE_HLS·_DASH·_CLIP(본인 영상)
gh workflow run nightly.yml --ref <브랜치> -f only=drift -f simulate=target_gone -f loop_test=true   # 고리 확인(ci-loop-test:)
node scripts/ci/run.mjs doctor               # 로컬 도구 유무·버전(tools.json). 없는 도구의 gate는 로컬에서 건너뛰고 CI가 본다
node scripts/ci/run.mjs install-hooks        # 훅 켜기(core.hooksPath=.githooks). 클론마다 한 번. pre-commit·commit-msg·pre-push가
                                             #   run.mjs hook <이름>으로 gates.mjs HOOKS를 돈다(pre-push의 push-guard·scan-range는 끌 수 없다.
                                             #   CHZZK_HOOK_FAST=1이면 빌드·테스트만 건너뛴다)

UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings   # DTO를 바꾼 뒤 app/src/lib/bindings 다시 만들기

# 앱 실행·빌드 (app/에서)
pnpm tauri dev                                   # 개발 실행(Vite devUrl)
pnpm tauri build --debug --no-bundle             # dist를 넣은 debug 바이너리 → target/debug/chzzk-app
CHZZK_SMOKE_OUT=/tmp/m.json ../target/debug/chzzk-app --smoke   # 기동 스모크: 임시 데이터 폴더, 프런트 신호 뒤 exit 0(60초 넘으면 2)
pnpm tauri build --debug --no-bundle --features e2e   # E2E 빌드: CHZZK_E2E_API_BASE(루프백 http)·CHZZK_E2E_DIR(절대 경로) 둘 다 있으면
                                                       #   node ../scripts/ci/e2e-fixture-server.mjs가 띄운 testdata 서버에 붙는다. 릴리스엔 없다

cargo test -p chzzk-core --test segmented <이름>      # 통합 테스트 하나
cargo test -p chzzk-core --lib naming::                # 단위 테스트 모듈 하나

# 실서버 스모크(네트워크 사용). 대상은 https://api.chzzk.naver.com/service/v1/videos?sortType=LATEST 에서 고른다
cargo run -p chzzk-core --example dl -- https://chzzk.naver.com/video/<no> --list
cargo run -p chzzk-core --example dl -- <주소> --lowest --limit-mb 5 --out <임시 폴더>
CHZZK_LIVE_HLS=<빠른 다시보기 no> CHZZK_LIVE_DASH=<일반 VOD no> CHZZK_LIVE_CLIP=<clipId> \
  cargo test -p chzzk-core --test live -- --ignored --nocapture
```

- `chzzk-app`(app/src-tauri)은 `app/dist` 없이도 `cargo` 직접 실행으로 컴파일된다(app.md 구현 중 변경 6). Linux에서는 webkit2gtk 4.1 등 개발 패키지가 필요하다(목록은 `ci.yml`의 `tauri` 작업). 그래서 `rust` gate는 `-p chzzk-core -p chzzk-shell`만 돌고, `chzzk-app`은 apt를 설치하는 `tauri` 작업이 본다. `pnpm tauri build`는 `beforeBuildCommand`로 `dist`를 먼저 만든다.
- CI 워크플로의 `run:`은 setup(autocrlf·rustup·apt)을 빼면 `node scripts/ci/run.mjs …`만 부른다(`parity` gate가 강제). 검사를 더하거나 바꿀 때는 `gates.mjs`를 고치고, 새 도구는 `tools.json`에 버전을 적는다. 워크플로에 `uses:`를 더하면 `node scripts/ci/pin-actions.mjs --write`로 SHA를 고정한다.
- 앱의 macOS 설정·데이터는 `~/Library/Application Support/io.github.chnu-kim.chzzk-downloader`, 로그는 `~/Library/Logs/io.github.chnu-kim.chzzk-downloader`다.
- 일반 테스트는 모두 오프라인이다(127.0.0.1 mock). 실서버는 `#[ignore]` 테스트와 `examples/dl.rs`로만 접속한다.
- E2E는 두 층이다(cicd.md §6, 구현 중 변경 36~): `app/e2e/`의 Playwright(PR, 가짜 백엔드 `app/e2e/mock/backend.ts`)와 네이티브(`scripts/ci/e2e-native.mjs`, 코드 PR·master·nightly Linux, 코드 PR·weekly Windows). `--features e2e`의 clippy·`e2e::` 테스트는 `tauri` gate(3 OS)가 돌리고 테스트 수는 `tests.app_e2e.<os>` ratchet(0개면 실패). 예약 실패는 작업마다 `ci-loop:e2e-native-<os>` 이슈. command·DTO·화면 문구를 바꾸면 가짜 백엔드와 spec도 같이 고친다. 두 작업은 D14 관찰 중이라 `ci-ok`에 없고(`gates.mjs` `OBSERVED_JOBS`) master 실패는 `master-failure` 이슈로 온다. `--features e2e` 코드는 `app/src-tauri/src/e2e.rs`에만 둔다(`release-hygiene`·`hygiene-seed`가 확인한다).
- `live_hls_partial`은 최저 화질로 4 MiB 넘게 받을 수 있는 빠른 다시보기를 골라야 한다(그 전에 끝나면 실패). `live_dash_partial`은 짧은 VOD면 끝까지 받고 완성 파일을 검사한다.

## 작업 규칙

- 브랜치에서 설계 단계마다 커밋한다(코어는 core.md §10, 앱은 app.md §15). 메시지는 Conventional Commit `type: 한국어 요약`. 단계별 stacked PR이고, PR을 만든 뒤 글로벌 지침의 Codex 리뷰를 따른다.
- **단계(체크박스)를 끝낼 때마다 `docs/ROADMAP.md`의 "현재 위치"와 체크리스트를 갱신한다**(세션이 요약돼도 이 파일이 남는다).
- 옛 Go 코드는 삭제됐다(§10-16). 행동 기록은 `docs/spec/core-behavior.md`다.
- 코드 주석은 한국어, 식별자는 영어(설계 문서의 이름을 따른다).
- 설계가 틀렸거나 모호하면 가장 작은 타당한 선택을 하고 해당 설계 문서(`core.md` 또는 `app.md`)의 "구현 중 변경"에 번호를 붙여 적는다.
- UI 문구는 한국어이고 app.md §9 copy deck(`app/src/lib/copy/ko.ts`)을 따른다. DTO를 바꾸면 `UPDATE_BINDINGS=1`로 bindings를 다시 만든다.
- 행동을 바꾸면 해당 테스트를 함께 추가한다. 파서·선택 규칙은 `testdata/`의 합성 fixture로 고정한다. fixture는 `scripts/fixtures/gen-fixtures.mjs`를 고쳐 다시 만든다(`--check`로 확인).
- **공개 저장소 규칙**: 실제 채널 이름·ID, 영상 번호·클립 ID, 서명 토큰·inKey, 비공개 내부 동작 조사 내용을 코드·테스트·문서·커밋 메시지에 넣지 않는다. 시각·길이 같은 준식별자도 실제 값을 옮기지 않는다. 커밋 전에 `node scripts/ci/run.mjs scan`(CI `ci.yml`의 `lint`, 이력 전체는 `scan-history`)이 통과해야 한다. 커밋 이메일은 GitHub noreply 주소를 쓴다. **비공개 저장소(`private` 원격)에는 push하지 않는다**(보관용). 로컬의 `refs/remotes/private/*`는 지우지 않는다: pre-push 가드(`push-guard.mjs`)가 이것으로 비공개에만 있는 커밋이 공개 push 범위에 섞였는지 본다. 자세한 규칙은 `docs/public-release.md` "이후 규칙".

## 주의사항

- **비밀값**: 네이버 쿠키(`NID_AUT`/`NID_SES`)와 서명 토큰(`hdnts`, `hdntl`, PD 쿼리)은 `Debug`·`Display`·오류·로그 어디에도 나오면 안 된다. URL은 `http::redact_url`, 쿠키는 `Secret`을 거친다. 서명 값을 품는 새 타입은 `Debug`를 손으로 구현한다.
- **쿠키는 API·MPD 요청에만**, 사용자가 켰을 때만(`ClientConfig.cookies`) 보낸다. 미디어 CDN에는 보내지 않는다(성인 PD는 미실측, `cookies_on_media` 스위치).
- **OS별 분기**: 파일명 규칙은 `naming::Platform` 인자로 받아 한 호스트에서 세 OS를 테스트한다. Windows는 rename 일시 잠금 재시도, 디스크 부족 코드(112·39), 예약어가 다르다. macOS/Linux에서 개발해도 Windows 동작을 깨지 않게 양쪽을 고려한다.
- 설정·자격증명 위치는 셸이 주입한다(`SettingsStore::open(config_dir)`, `CredentialStore::new(config_dir)`). 코어는 실행 파일 폴더를 쓰지 않는다.
- 루트 `settings.json`과 `dependent/`는 **실제 사용자 데이터**(옛 Go 런타임 파일, 평문 쿠키 포함)다. 읽거나 고치지 않는다. 테스트용 Go 형식 JSON은 테스트 안에서 만든다.
- `compose.yml`과 `win10/`은 `dockurr/windows`로 Windows 환경을 띄워 Windows 빌드·테스트를 하기 위한 것이다. 코드와 무관하며 건드리지 않는다.
- 암호화(AES) VOD는 지원하지 않으며 명확한 오류로 거부한다(`Error::EncryptedVod`, 설계 §11).
