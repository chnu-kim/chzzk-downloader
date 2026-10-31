# 앱 CLI 모드: 설계 명세

**상태·확정 결정(2026-10-18)**: **구현됨(CLI-1~6, 2026-10-18, app.md 구현 중 변경 101~106, cicd.md 118·119).** 명세와 달라진 곳은 그 번호들에 적었다: 멈춘 작업(`paused`)이 활성이라 같은 명령은 `duplicateOutput`이 되어 `resume_job`으로 이어받는다(§9.2 가정이 틀렸다), `main`이 `run()` 앞에서 갈린다(§3.1), 문구 키 `cli.login.waiting`의 `{interrupt}`·`cli.exists.label`(§11), `info`·`status`의 종료 코드(받을 수 없는 판정 4·로그인 필요 3), 사용자 결정 O3 (b)의 Windows 콘솔 실행 파일. **오디오 #168이 구현 중에 머지되어 CLI-6(`--audio`)도 했다.** 아래 본문은 설계 시점의 글이다(구현 중 변경이 우선). 사용자 결정(ROADMAP "경쟁력 개선 착수" (다), `docs/ROADMAP.md:9`): 사용자용 CLI는 **앱 실행 파일의 CLI 모드**다. 같은 설치물, 같은 로그인 세션, 소유 게이트가 켜진 채로 돈다. `crates/core/examples/dl.rs`는 게이트가 없어서 배포하지 않는다. 같은 줄의 순서는 "(바) → (마) → (다)"다. 그래서 CLI는 일곱 개선 가운데 마지막이고, `--audio`는 오디오만 받기((마), PR #168)가 머지된 뒤에 연다(§8). 인증·게이트를 건드리므로 구현 PR에 Codex 리뷰를 붙인다(같은 줄). §15의 열린 결정 O1~O11은 **2026-10-18 사용자가 모두 정했다.** 추천과 다르게 고른 것은 둘이다: **O2 (b) CLI `login` 명령**(§5.3)과 **O3 (b) 처음부터 Windows 콘솔용 실행 파일**(§7.1, §13, 단계 CLI-5가 필수가 된다). 본문은 결정에 맞춰 고쳤다.

기준 트리는 처음엔 `origin/master` `26ca67d`(v0.10.1 뒤, 속도 제한 #165 머지)였다. 결정을 반영하면서 #164(허용목록)·#166(파일 이름 템플릿)·#167(mp4 메타데이터)이 머지된 `61fc2df`를 합쳤다. 이 판에서 새로 단 `파일:줄`(로그인·번들·스모크)은 `61fc2df`에서 연 줄이다. 나머지는 `26ca67d`의 줄이고, 구현 PR이 줄을 다시 확인한다. 표기는 `features/README.md`를 따른다. **[확인]**은 직접 연 줄이 받침이고, **[확인: 문서]**는 설계 문서 인용, **[확인: 상류]**는 Tauri 상류 소스(태그 `tauri-cli-v2.12.1`, 앱의 `@tauri-apps/cli` 2.12.1·`tauri-build` 2.7.1과 같은 판)에서 연 줄, **[가정]**은 근거 없는 설계 판단, **[실측 필요]**는 실기기로만 정할 수 있는 것이다. 근거 없는 수치에는 **[잠정]**을 붙인다(ADR-0009 묶음). 예시 주소·번호는 모두 가짜다.

이 명세는 코드를 바꾸지 않는다. 구현 PR은 `docs/design/app.md` "구현 중 변경"에 번호를 붙여 적는다(CI·번들을 바꾸는 CLI-3·CLI-5는 `docs/design/cicd.md`에도). 지금 마지막 번호는 app.md 98, core.md 83, cicd.md 117이다. 그 사이 다른 PR이 먼저 머지되면 그 뒤를 잇는다.

---

## 0. 한 장 요약

| 항목 | 결정(2026-10-18 사용자 결정 반영) | 근거 |
|---|---|---|
| 진입 | macOS·Linux는 같은 바이너리 `chzzk-app`, Windows는 같은 crate의 콘솔 실행 파일 `chzzk-cli.exe`(아래 "Windows 콘솔"). `argv[1]`이 정해진 하위 명령 다섯(`download`·`info`·`status`·`login`·`help`) 가운데 하나면 **`tauri::Builder`를 만들기 전에** CLI로 갈라진다. 그 밖의 인자(`--smoke`, 인자 없음)는 지금과 같이 GUI다 | single-instance 플러그인이 `argv`를 버리고 창에 포커스만 준다 `app/src-tauri/src/lib.rs:681-683` [확인] |
| 몸통 위치 | 명령 해석·흐름은 `crates/shell/src/cli/`(Tauri 비의존). 앱 crate는 argv 갈림, 콘솔 붙이기, 런타임, 경로만 맡는다 | `rust` gate가 webkit 없이 3 OS에서 테스트한다(CLAUDE.md "레이아웃") |
| 게이트 | `App::gate_command` → `App::resolve` → `App::check_output` → `App::enqueue`. GUI와 **같은 함수**를 부르고, `classify`나 매니저를 직접 부르지 않는다 | 소유 판정은 `services::enqueue_checked` 안의 `admit_checked`에 있다 `crates/shell/src/services.rs:616-640` [확인] |
| 단일 작성자(O1 (a)·O4 (a)) | CLI도 `<data>/app.lock`을 쥔다(`help` 말고 모든 명령). 못 쥐면(GUI가 떠 있으면) 받지 않고 종료 코드 5로 끝난다. CLI가 도는 중에 GUI를 열면 "명령줄에서 받는 중" 대화상자 | 잠금 `lib.rs:434-455` [확인]. 앱 인스턴스 둘은 refresh 설계 밖이다 worker.md 구현 중 변경 25 (가) `docs/design/worker.md:868` [확인: 문서] |
| 로그인(O2 (b)) | **`login` 명령**: 앱과 같은 루프백 로그인(`App::auth_login`의 수신기·`/auth/start`)을 쓰고 브라우저는 이미 있는 `tauri_plugin_opener::open_url`(AppHandle 없는 자유 함수)로 연다. 세션 파일은 GUI와 같은 `session.json`. 기다림은 서비스의 로그인 기한(10분)을 그대로 쓰고 Ctrl+C면 취소. **로그아웃 명령은 두지 않는다**(§5.4). 그 밖의 명령은 로그인이 없으면 "`login`으로 로그인해 주세요"와 코드 3. 갱신은 `AuthService::retry`(예정 전이면 네트워크 없음) | `crates/shell/src/app.rs:548-563` [확인], `tauri-plugin-opener` 2.7.0 `src/lib.rs:38`·`src/open.rs:33` [확인]. `crates/shell/src/auth/service.rs:593-610` [확인]. 회전 상한 10분 10번, worker.md 24 `docs/design/worker.md:867` [확인: 문서] |
| 업데이트 | CLI는 업데이트를 확인하지 않는다. Windows 콘솔 실행 파일은 GUI의 업데이트(설치기 재실행)가 함께 바꾼다 | 가장 작은 범위. GUI가 로그인 직후 한 번 확인한다 `crates/shell/src/app.rs:740` [확인]. §10 |
| 인자 파서(O5 (a)) | 손으로 짠 파서. 새 의존성 없음 | `Cargo.lock`에 clap·lexopt가 없다 [확인]. `dl.rs:48`도 손 파서다 |
| Windows 콘솔(O3 (b)) | **처음부터 콘솔 서브시스템 실행 파일 `chzzk-cli.exe`를 더한다.** `chzzk-app` crate의 둘째 `[[bin]]`(`required-features = ["console-cli"]`)이고, 새 `tauri.windows.conf.json`의 `build.features`로 Windows 빌드에서만 켠다. Tauri 번들러가 주 실행 파일이 아닌 bin을 NSIS·MSI 설치 폴더에 함께 넣는다. `chzzk-app.exe`에 CLI 하위 명령을 주면 GUI를 띄우지 않고 "`chzzk-cli.exe`를 써 주세요" 한 줄과 코드 2로 끝난다(둘 다 CLI-5) | `main.rs:2` `windows_subsystem = "windows"` [확인]. 상류 `get_binaries`·NSIS·WiX 템플릿 [확인: 상류], §7.1 |
| Ctrl+C | 첫 번째는 일시정지(`.part`를 남기고 `paused`로 저장. 생방송 주소는 받지 않으므로 해당 없고, 셸 `pause`는 생방송을 거부한다: app.md 127), 두 번째는 바로 끝낸다(`interrupted`). 다음 `download`나 GUI가 이어받는다. `login` 기다림 중이면 로그인을 취소한다 | `DownloadManager::pause` `crates/shell/src/manager.rs:674-701`, `quit` `:1385-1389` [확인] |
| 종료 코드 | 0 완료·이미 있음·로그인함 / 1 받기·로그인 실패 / 2 사용법 / 3 로그인 필요·로그인 거부·시간 초과 / 4 받을 수 없는 영상 / 5 앱이 열려 있음 / 130 Ctrl+C로 멈춤 | §9.3 |
| 범위 밖(v1) | 생방송 녹화(O8), 채팅 함께 받기, 로그아웃 명령, 화면 없는 기기의 로그인(O2 (c)), 작업 목록 관리, JSON 출력(O6), PATH 등록(O7) | §1.2 |
| 배포물 | `expected-artifacts.json`의 설치기 산출물·updater 키는 그대로다. Windows 설치기 안에 `chzzk-cli.exe`가 하나 늘어 설치 스모크·release-hygiene·크기 ratchet(새 키 `size.binary.windows-cli`)이 바뀐다 | `release/expected-artifacts.json` [확인], §13 |

## 1. 목표와 범위

### 1.1 목표
- 터미널과 스크립트에서 GUI 없이 받는다: `chzzk-app download <주소>`. 받는 규칙(화질 기본값, 파일 이름, 이어받기, 속도 상한, 저장 폴더)은 GUI와 같은 설정을 쓰고, 인자로 그 실행만 덮는다.
- **소유 게이트를 우회하는 길을 만들지 않는다.** 로그인 채널의 영상, 맡은 채널의 영상, 관리자 허용만 받는다. 그 밖은 GUI와 같은 오류 코드로 거부한다.
- GUI와 상태를 나눠 쓰되 서로 망가뜨리지 않는다. `jobs.json`·`settings.json`·`session.json`을 쓰는 프로세스는 늘 하나다.

### 1.2 하지 않는 것(v1)
- **생방송 녹화**(`/live/` 주소): 녹화는 일시정지가 없고 멈추면 받은 만큼 마무리한다(`manager.rs:683-687` [확인]). 그래서 Ctrl+C의 뜻이 VOD와 달라진다(§9.2). 또 맡은 채널 생방송은 v1에서 닫혀 있다(L-D1, `ownership.rs:51-53` [확인]). v1의 CLI는 생방송 주소를 사용법 오류(코드 2)로 거부하고 "생방송은 앱에서 녹화해 주세요"를 출력한다(O8 (a), 사용자 결정).
- **채팅 함께 받기**: 기능 ④는 보류다(`docs/ROADMAP.md:10`).
- **로그아웃 명령**: §5.4. 로그인은 `login`으로 하고(§5.3), 로그아웃은 GUI에서 한다.
- **화면 없는 기기의 로그인**(O2 (c)): 루프백 수신기는 `127.0.0.1`에만 열리므로 브라우저가 같은 기기에 있어야 한다. "다른 기기에서 로그인"은 Worker 계약 변경이라 범위 밖이다.
- **작업 목록 관리**(목록·지우기·이어받기 명령): 같은 주소로 `download`를 다시 부르면 `.part`를 이어받는다(§9.2). 따로 명령을 두지 않는다.
- **JSON 출력, 설치기의 PATH 등록**: O6 (a) 경로 한 줄만, O7 (a) 도움말 안내만(사용자 결정).
- **업데이트 확인·설치**: §10.
- `dl.rs`의 공개 배포. 사용자 결정이다. `dl.rs`는 지금처럼 개발자 스모크 도구로만 남는다(`crates/core/examples/dl.rs`).

## 2. 기존 결정과의 관계

**뒤집는 결정은 없다.** 넓혀 쓰는 것만 있다.

| 결정 | 처리 | 근거 |
|---|---|---|
| AuthGate: invoke 처리기 앞, 기본 거부 | CLI는 invoke를 거치지 않으므로 하위 명령마다 대응 command 이름으로 `App::gate_command`를 **명시적으로** 부른다(§4.1). 허용 목록은 바꾸지 않는다 | `lib.rs:163-180`, `crates/shell/src/gate.rs:19-33`, `app.rs:411-417` [확인] |
| 본인 영상 게이트(A5)·위임(①)·관리자 override | 그대로 쓴다. CLI는 `App::enqueue`로만 작업을 만든다 | `ownership.rs:51-71`, `services.rs:616-656` [확인] |
| 데이터 폴더 잠금(app.md 구현 중 변경 51 (다)) | **넓혀 쓴다.** 잠금을 쥐는 쪽에 CLI 프로세스를 더한다 | `lib.rs:425-455` [확인] |
| refresh 회전 single-flight, 인스턴스 하나 | 지킨다. 잠금 덕에 CLI가 도는 동안 GUI는 세션을 쓰지 않는다 | worker.md 25 (가) [확인: 문서] |
| 첫 로그인 뒤 자동 이어받기·업데이트 확인(D8·D15) | CLI는 부르지 않는다(`spawn_auth_tasks`·`on_auth_status`·`take_delegated_resume`·`take_auto_update_check`). `login`으로 로그인해도 같다. 다음에 GUI를 열면 GUI가 자기 첫 로그인 확인에서 한다 | `lib.rs:183-215`, `app.rs:422-456`·`:740` [확인] |
| 로그인은 GUI 로그인 화면에서(D12·D13) | **넓혀 쓴다.** 같은 `AuthService::begin_login`·`run_login_wait`를 CLI `login`이 부른다. Worker 계약(`/auth/start`·콜백·`/auth/redeem`)은 그대로다 | `service.rs:850`·`:1103` [확인], §5.3 |
| Windows 설치 폴더의 앱 exe 하나(cicd.md 구현 중 변경 30 (나), `smoke.mjs:391`의 `exeIn`) | **넓힌다.** 설치 폴더에 `chzzk-cli.exe`가 더해진다. 설치기 파일·updater 산출물은 그대로다. 스모크는 이름으로 고른다(§13) | `docs/design/cicd.md:469` [확인: 문서], `scripts/ci/smoke.mjs:391` [확인], §7.1 |
| 릴리스 바이너리의 E2E 위생(cicd.md 구현 중 변경 31) | **넓힌다.** `release-hygiene`이 `chzzk-cli.exe`도 본다 | `scripts/ci/artifact-check.mjs:68` 기본 파일이 `chzzk-app`뿐 [확인] |
| copy deck 단일 원천(content.md) | CLI 문구는 웹뷰 밖이라 deck을 읽을 수 없다. 알림 문구와 같은 방식으로 Rust 상수를 두고 ko.ts와 대조 테스트한다 | `app/src-tauri/src/notify_copy.rs:1-3` [확인] |
| `dl.rs`는 개발자 도구 | 그대로 둔다. 사용자 문서는 `dl.rs`를 언급하지 않는다 | ROADMAP:9 (다) |

## 3. 진입과 명령 표면

### 3.1 갈림 위치
- `main.rs`는 `chzzk_app_lib::run()` 하나만 부른다(`main.rs:5` [확인]). `run()`의 **맨 앞**, `show::mark_start()`와 `SmokeConfig::from_env()`보다 먼저 `cli::wants_cli(std::env::args_os())`를 본다(`lib.rs:668-671` [확인]). 참이면 `cli_main()`을 부르고 Tauri는 만들지 않는다. **종료 순서**: 모든 끝(성공·실패·Ctrl+C)에서 `manager.flush()`를 부르고, `App`·로그 guard·런타임을 drop한 뒤에 종료 코드를 낸다(`main`이 `std::process::ExitCode`를 돌려주거나, drop 뒤 `std::process::exit`). `std::process::exit`는 `Drop`을 건너뛴다. `jobs.json`은 쓰기 스레드가 **가장 최근 제출만** 나중에 쓰므로(`crates/shell/src/writer.rs:7-12` [확인]) flush 없이 끝내면 `completed`가 디스크에 없을 수 있다. 그러면 다음 GUI 시작이 그 작업을 `interrupted`로 본다.
- 이렇게 하면 single-instance 플러그인(`lib.rs:681`)도, 창도, webview도 만들어지지 않는다. Linux에서는 `DISPLAY`·`WAYLAND_DISPLAY` 없이 돈다(§14 스모크로 단정한다).
- **갈림 규칙**: `argv[1]`이 정확히 `download`·`info`·`status`·`login`·`help` 가운데 하나일 때만 CLI다. 앱을 띄우는 지금의 인자는 이 집합과 겹치지 않는다.
- **Windows**: 갈림 함수 `wants_cli`는 3 OS가 같다. 갈린 뒤 하는 일만 실행 파일마다 다르다.
  - `chzzk-cli.exe`(콘솔 서브시스템, §7.1)는 `wants_cli`가 거짓이어도(인자 없음 포함) GUI를 만들지 않는다. 인자가 없거나 모르는 명령이면 `help` 출력과 코드 2다. 이 실행 파일의 `main`은 `chzzk_app_lib::cli_main()`만 부른다.
  - `chzzk-app.exe`(GUI 서브시스템)에 CLI 하위 명령이 오면 CLI를 돌리지 않는다(이 안내는 `chzzk-cli.exe`와 함께 CLI-5에서 넣는다. CLI-2~CLI-5 사이의 Windows `chzzk-app.exe`는 갈림을 `cfg(not(windows))`로 막아 지금처럼 인자를 무시하고 GUI를 띄운다. 그 사이에 버전이 나가도 없는 파일을 가리키지 않는다). `AttachConsole(ATTACH_PARENT_PROCESS)`로 부모 콘솔이 있으면 "명령줄에서는 같은 폴더의 `chzzk-cli.exe`를 써 주세요." 한 줄을 쓰고 코드 2로 끝난다(부모 콘솔이 없으면 쓰지 않고 끝난다). cmd가 GUI 프로세스를 기다리지 않는 문제(§7.1)를 받기 경로에서 아예 없애려는 것이다. 의존성은 이미 있는 `windows` 0.62.2에 feature `Win32_System_Console` 하나다(`app/src-tauri/Cargo.toml:58` [확인]).
  - `--smoke`: `wants_smoke`가 인자 전체를 `.any()`로 본다(`smoke.rs:36-42` [확인]). `download --smoke`처럼 섞인 경우는 CLI로 가고 `--smoke`는 모르는 인자(코드 2)다.
  - updater 재시작: `request_restart()`(`update_io.rs:203-205` [확인])는 현재 프로세스 인자로 다시 띄운다 [가정]. GUI 프로세스의 인자는 CLI 집합에 들지 않으므로 GUI로 다시 뜬다.
  - Linux `.desktop` `Exec={{exec}}`(`app/src-tauri/linux/main.desktop:6` [확인]): 번들러가 실행 파일 경로만 넣는다 [가정: 인자 없음은 산출물에서 확인, §14].
  - macOS LaunchServices가 붙이는 `-psn_…` 같은 인자는 `-`로 시작하므로 하위 명령 이름과 겹치지 않는다.
- 하위 명령 이름은 앞으로 **더하기만** 한다. 같은 이름을 GUI 인자로 쓰지 않는다(갈림 테스트가 고정한다, §14).

### 3.2 명령(v1, 가장 작은 범위)

```text
chzzk-app download <주소> [<주소> …] [--quality <라벨>] [--out <폴더>] [--range <시작>-<끝>]
                                      [--rate <속도>] [--overwrite] [--audio]
chzzk-app info <주소>
chzzk-app status
chzzk-app login
chzzk-app help [<명령>]
```

Windows에서는 `chzzk-app` 자리에 `chzzk-cli`가 온다(§7.1). 아래 표의 명령·깃발은 같다.

| 명령 | 하는 일 | 부르는 셸 함수 | 게이트 command 이름 |
|---|---|---|---|
| `download` | 주소마다 차례로 resolve → 화질 → 이름 검사 → enqueue → 끝날 때까지 진행률 → 다음 주소. 동시에 받지 않는다(설정의 동시 작업 수와 무관) | `App::resolve`·`App::check_output`·`App::enqueue`·`DownloadManager::subscribe`·`pause` | `resolve`, `check_output`, `enqueue` |
| `info` | 제목·채널·종류·화질 목록·판정(받을 수 있음/없음)을 출력한다. 받지 않는다 | `App::resolve` | `resolve` |
| `status` | 로그인 상태(로그인됨·채널 이름, 로그인 필요, 로그인을 쓰지 않는 빌드)와 앱 버전 | `App::auth_status`·`App::info` | `auth_status`(허용 목록) |
| `login` | 브라우저를 열어 앱과 같은 루프백 로그인을 하고 끝날 때까지 기다린다(§5.3). 이미 로그인되어 있으면 그대로 끝난다 | `App::auth_retry`·새 `App::auth_login_wait`(§5.3)·`App::auth_cancel` | `auth_retry`·`auth_login`·`auth_cancel`(셋 다 허용 목록) |
| `help` | 사용법. 네트워크·데이터 폴더를 열지 않는다 | 없음 | 없음 |

- 주소를 여러 개 받는 까닭: 한 프로세스가 refresh 한 번으로 여러 영상을 받게 하려는 것이다. 스크립트가 영상마다 프로세스를 띄우면 회전 상한(§5.2)에 닿을 수 있다.
- 여러 주소 가운데 하나가 실패해도 다음 주소를 계속 받는다. 종료 코드는 §9.3의 "가장 나쁜 것"이다.
- `--version`·`-h` 같은 전역 깃발은 두지 않는다. `help`와 `status`가 그 일을 한다(갈림 규칙을 하위 명령 이름 하나로 유지하려는 것이다).

### 3.3 인자 파서
- **결정(O5 (a)): 손으로 짠 파서**(`crates/shell/src/cli/args.rs`). 하위 명령 다섯, 깃발 일곱이라 표 하나로 충분하다. 새 crate가 없어서 `deny.toml`의 라이선스·소스 검사, `supply` 작업, 크기 ratchet이 바뀌지 않는다.
- 규칙: `--깃발 값`과 `--깃발=값`을 둘 다 받는다. 같은 깃발이 두 번이면 코드 2다. `--` 뒤는 모두 주소로 본다. 인자는 `OsString`으로 받고 UTF-8이 아니면 코드 2다.
- 고르지 않은 대안(§15 O5): `lexopt`(MIT, 의존성 없음)는 새 crate 하나다. `clap`은 크기와 의존성 트리가 늘어 맞지 않는다.

## 4. 게이트: AuthGate와 소유 판정

### 4.1 AuthGate(로그인 게이트)
- 지금 AuthGate는 Tauri invoke 처리기 안에서만 돈다. `handler()`가 command마다 `App::gate_command(cmd)`를 부르고, 실패하면 처리기에 닿지 않는다(`lib.rs:163-180` [확인]). CLI 경로는 invoke를 거치지 않으므로 **이 검사가 저절로 일어나지 않는다.**
- CLI는 하위 명령이 부르는 셸 함수마다 GUI command 이름으로 `app.gate_command(name)?`를 먼저 부른다(§3.2 표의 마지막 열). 이름은 `app/src-tauri/src/command_names.rs`의 상수를 쓰지 않고 셸 쪽 상수 표 `cli::GATED`에 둔다(앱 crate를 거꾸로 참조하지 않게). 대조 테스트가 두 표의 이름이 실제 command 목록에 있는지 본다.
- `gate_command`는 로그인을 쓰지 않는 빌드면 늘 통과하고, 허용 목록 command면 통과하고, 그 밖은 `require_signed_in`이다(`app.rs:411-417` [확인]). 그래서 `download`는 로그인이 없으면 네트워크 전에 `notLoggedIn`(코드 3)으로 끝난다.
- **로그인을 쓰지 않는 빌드**(Worker 주소 없이 만든 debug)는 GUI와 같이 게이트가 꺼진다. 릴리스 빌드는 주소가 없으면 컴파일되지 않는다(`build.rs`, CLAUDE.md "레이아웃"). 배포물에서 게이트가 꺼지는 길은 없다.

### 4.2 소유 판정
- 작업은 **`App::enqueue`로만** 만든다. 이 함수가 `services::enqueue_checked`를 부르고, 그 안에서 주소·컨텐츠 일치 → `OwnershipGate::admit_checked`(최근 resolve 캐시, 없으면 다시 resolve, 맡은 채널이면 판정 직전 `/api/me` 확인) → 매니저 순으로 간다(`app.rs:329-334`, `services.rs:629-640` [확인]). 판정 표는 `classify` 하나다: Own > Delegated > AdminOverride > NotOwn/Unknown(`ownership.rs:51-63` [확인]).
- CLI는 `classify`를 직접 부르지 않는다. 직접 부르면 채널 조회·캐시·판정 직전 확인(`App::recheck`, `app.rs:343-349`)·fail closed 경로(`ownership_unknown`)를 다시 짜야 하고 둘이 어긋날 수 있다.
- CLI는 `DownloadManager::enqueue`나 코어 `download`를 직접 부르지 않는다. 셸 `cli` 모듈은 `&App`만 받는다(`manager`는 `pub`이지만 `subscribe`·`pause`·`quit`·`set_rate_limits`만 쓴다). 리뷰 체크리스트에 "cli 모듈에서 `manager.enqueue`·`chzzk_core::download` 호출 없음"을 넣고, 테스트로도 막는다(§14 T-G5).
- `info`는 `App::resolve`가 붙이는 판정(`ResolvedDto`의 `ownership`)을 그대로 출력한다(`services.rs:504-540` [확인]). `info`가 "받을 수 있음"이라 해도 `download`는 enqueue 순간에 다시 판정한다(GUI와 같다).

### 4.3 거부 테스트 계획(요지, 전체는 §14)
| ID | 상황 | 기대 |
|---|---|---|
| T-G1 | 로그인 채널 A, 남의 채널 C의 영상 | `notOwnContent`, 종료 코드 4, `jobs.json`에 작업 없음, `.part` 없음 |
| T-G2 | 로그인 없음(session.json 없음) | `notLoggedIn`, 코드 3, resolve 요청 0회(가짜 Backend 호출 수로 단정) |
| T-G3 | 맡은 채널 D의 영상 | 받음(코드 0), 기록의 `channelId` = D |
| T-G4 | 관리자, 채널 모름 | 받음(`AdminOverride`), 생방송은 v1 거부(코드 2) |
| T-G5 | 게이트 호출을 빼는 변형 | T-G1·T-G2가 **실패해야 한다**(TDD 메모: 구현을 깨서 테스트가 잡는지 확인) |
| T-G6 | 채널 ID가 없는 컨텐츠 | `ownershipUnknown`, 코드 4 |

## 5. 단일 작성자, 로그인, 세션

### 5.1 데이터 폴더 잠금
- CLI는 `help`를 뺀 모든 명령에서(`login`·`status` 포함) `App::open_with_auth`를 부르기 **전에** `acquire_instance_lock(<data>)`를 부른다(GUI와 같은 함수와 순서, `lib.rs:575-595` [확인]). `login`은 `session.json`을 쓰고 `status`도 `retry()`로 refresh할 수 있어서다. 이 함수는 앱 crate에 있으므로 CLI 갈림도 앱 crate에서 잠금을 쥔 뒤 셸 `cli::run`에 `App`을 넘긴다.
  - `Acquired`: 프로세스가 끝날 때까지 쥔다.
  - `HeldElsewhere`: GUI(또는 다른 CLI)가 떠 있다. 받지 않고 "앱이 열려 있어요. 앱을 닫은 뒤 다시 실행해 주세요."와 코드 5로 끝난다.
  - `Unavailable`: GUI는 잠금 없이 계속한다(`lib.rs:590-592`). CLI는 **계속하지 않는다**(코드 1). 잠금 없이 돌면 아래 세 파일을 함께 쓸 수 있다.
- 이 잠금 하나가 세 위험을 함께 막는다.
  1. **refresh 회전 경합**: GUI와 CLI가 같은 `session.json`으로 동시에 refresh하면, 한쪽이 회전한 뒤 다른 쪽이 옛 refresh를 낸다. 60초 안이면 복구가 상대의 자식을 지우고, 60초 밖이면 재사용 감지로 세션이 폐기된다(worker.md §5.2 `used` 행 `docs/design/worker.md:317-318` [확인: 문서]). 결과는 둘 다 로그아웃이다. worker.md 25 (가)는 "앱 인스턴스가 둘(설계 밖)"이라고 적었다. 잠금이 그 전제를 CLI까지 넓혀 지킨다.
  2. **`jobs.json`**: 두 매니저가 번갈아 덮어쓰면 한쪽 작업이 사라진다(`lib.rs:430-433` 주석 [확인]).
  3. **`settings.json`**: `enqueue_checked`가 마지막 화질과 최근 영상을 저장한다(`services.rs:647-651` [확인]).
- 프로세스 사이 파일 잠금이나 Worker 쪽 변경(세션 분리) 같은 다른 방법은 §15 O1 (c)였고 고르지 않았다.

### 5.2 로그인 상태와 갱신
- `App::open_with_auth`는 세션 파일만 읽고 네트워크를 쓰지 않는다. 유예 안이면 `SignedIn`(낙관), 밖이면 `Checking`, 60일 상한이 지났으면 `Expired`다(`service.rs:439-459`, `verify.rs:115-130` [확인]).
- CLI는 열자마자 `AuthService::retry()`를 한 번 부른다. 온라인 `SignedIn`이고 갱신 예정 전이면 **네트워크 없이** 지금 상태를 돌려주고, `Checking`이나 예정이 지났으면 refresh한다(`service.rs:593-610` [확인], app.md 구현 중 변경 61).
- `startup()`은 쓰지 않는다. `startup()`은 세션이 있으면 늘 refresh한다(`service.rs:574-584` [확인]). 스크립트가 CLI를 짧게 여러 번 부르면 채널당 10분 10번 회전 상한에 닿아 429가 된다(worker.md 24 (가) [확인: 문서]). `retry()`는 예정 전이면 회전하지 않으므로 이 문제가 없다.
- `run_driver`(타이머·절전 복귀 갱신)는 띄우지 않는다(`driver.rs:44-61` [확인]). 받는 도중 access가 만료돼도 게이트 판정은 enqueue 순간에 끝났고, 다운로드 자체는 Worker 토큰을 쓰지 않는다(치지직 재생 경로는 앱 내부 경로다, range.md §1.2) [확인: 문서].
- **주소마다 세션을 다시 본다**(리뷰 반영, app.md 구현 중 변경 107 (다)): 갱신이 시작 때 한 번뿐이면 주소 여럿의 긴 배치가 72시간 유예를 넘겨도 메모리의 `SignedIn`이 남아 다음 주소를 받는다. 그래서 `download`는 주소마다 resolve 앞에서 `App::auth_tick()`(GUI driver의 타이머와 같은 판정 `AuthService::tick(Trigger::Timer)`)을 부른다. 온라인이면 갱신 예정이 지났을 때만, 오프라인이면 재시도 시각이나 유예 끝이 지났을 때만 refresh하므로 짧은 배치의 회전 수는 그대로다. 유예가 끝났으면 만료로 바뀌어 다음 주소의 게이트가 코드 3으로 막는다.
- **관리자 확인**(리뷰 반영, 구현 중 변경 107 (가)): 관리자 예외는 이번 실행에서 서버가 준 묶음(refresh·로그인)으로 확인한 `isAdmin`만 쓴다(worker.md 102). GUI는 시작 때 refresh하므로 확인돼 있지만 CLI는 예정 전이면 refresh하지 않아, GUI에서 방금 로그인한 관리자가 CLI로 남의 영상을 받으면 거부됐다. `/api/me`는 관리자 여부를 주지 않는다. 그래서 판정이 남의 영상·채널 모름이고 디스크 세션이 관리자인데 아직 확인하지 않았으면(`Signer::admin_pending`) 판정 직전 확인(`App::recheck`)이 `AuthService::confirm_admin()`으로 refresh 한 번을 하고 다시 판정한다. 내 영상·맡은 채널에는 refresh하지 않는다(회전 상한). 서버가 관리자가 아니라고 하면 코드 4, refresh가 429·네트워크 실패면 확인하지 못한 채 코드 4다(디스크 값을 믿지 않는다).
- **갱신 중 Ctrl+C**(리뷰 반영, 구현 중 변경 107 (나)): 작업 전 기다림의 Ctrl+C(`cli::interruptible`)는 그 안에서 refresh(토큰 회전)가 진행 중이면 future를 버리지 않는다. 서버가 회전을 커밋한 뒤 응답 처리를 버리면 새 토큰이 저장되지 않고, 60초 복구 창 뒤 옛 토큰을 보내 재사용 감지로 GUI와 함께 쓰는 세션이 끊긴다(worker `store/sessions.ts`). 그래서 "로그인 정보를 저장하는 중이에요. 끝나면 멈춰요."를 쓰고 refresh가 결과를 저장할 때까지(요청 상한 10초·응답 유실 재시도 창 45초 안) 기다린 뒤 130으로 끝난다. 더 누른 Ctrl+C도 이 기다림을 끊지 않는다(SIGTERM도 같다). 그 사이 `enqueue`·`resume_job`이 끝나 작업이 생겼으면 첫 Ctrl+C처럼 일시정지한다.
- **자동 이어받기를 CLI에서 늘 끈다.** `App::open_with_auth`는 매니저를 `auto_resume: s.auto_resume_interrupted && auth.is_none()`로 연다(`app.rs:167-175` [확인]). 로그인을 쓰지 않는 빌드(debug, 테스트의 `AuthSetup::Disabled`)에서는 `DownloadManager::open`이 열자마자 `interrupted`를 모두 다시 줄 세운다. 그래서 `on_auth_status`를 부르지 않는 것만으로는 막히지 않는다. CLI-1에서 `App` 여는 옵션(예: `OpenOptions { auto_resume: false }`)을 더해 CLI는 로그인 여부와 무관하게 끈다.
- 맡은 채널 영상의 판정 직전 확인(`check_delegations(false)`, 5분 간격)은 프로세스마다 처음이라 매번 `/api/me`를 부른다(`service.rs:1450` [확인]). `/api/me`는 읽기라 회전 상한과 관계가 없다 [확인: 문서 worker.md 24 (나) "쓰기가 생기는 성공 두 경로"만 센다].

### 5.3 `login` 명령(O2 (b), 사용자 결정)
처음 추천은 "CLI에서 로그인하지 않음"이었다. 사용자는 (b)를 골랐다. 앱의 루프백 로그인을 **그대로 재사용**하고, 새 Worker 계약·새 수신기·새 의존성은 없다.

**재사용하는 것** [확인]
- 수신기와 시작: `AuthService::begin_login`(`crates/shell/src/auth/service.rs:850`)이 `127.0.0.1` 수신기를 먼저 열고(`bind_receiver`, Fetch bad port 피하기·`BIND_ATTEMPTS` 5) 그 포트로 `/auth/start`를 부른다. 수신기 상수(`READ_TIMEOUT` 5초, `REPLY_WAIT` 15초, `MAX_LIFETIME` 11분)는 `crates/shell/src/auth/loopback.rs:26-44`에 있고 CLI가 바꾸지 않는다.
- 기다림과 교환: `AuthService::run_login_wait`(`service.rs:1103`)가 수신기의 grant를 받아 `/auth/redeem`으로 바꾸고 세션을 `session.json`에 쓴다. 로그인 기한은 `LOGIN_TTL` 10분과 서버 `expires_at` 가운데 이른 쪽이다(`service.rs:916`, `crates/shell/src/auth/verify.rs:15`).
- 결과 페이지: 브라우저 쪽 성공·거부 페이지는 수신기가 이미 그린다(GUI와 같다). CLI는 따로 페이지를 만들지 않는다.

**셸에 더하는 것**: `App::auth_login`(`app.rs:548-563`)은 기다림을 `runtime.spawn`으로 띄우고 바로 돌아온다. GUI는 상태 이벤트로 결과를 받지만 CLI는 결과를 기다려야 한다. 그래서 `App::auth_login_wait(open) -> AuthStatusDto`를 더한다. 이 함수는 `begin_login`이 `Started`면 `open(로그인 주소)`을 부른 뒤 같은 태스크에서 `run_login_wait().await`의 끝 상태를 돌려준다. GUI 쪽 부작용(`on_auth_status`, 자동 이어받기, 업데이트 확인)은 앱 crate의 `spawn_auth_tasks`에 있으므로(`lib.rs:183-215` [확인]) 이 함수는 그것들을 부르지 않는다. 기존 `auth_login`은 바꾸지 않는다.

**브라우저 열기**: 이미 의존성인 `tauri-plugin-opener` 2.7.0의 자유 함수 `tauri_plugin_opener::open_url(url, None::<&str>)`을 쓴다. 이 함수는 `AppHandle` 없이 부른다(`src/lib.rs:38`의 `pub use open::{open_path, open_url}`, `src/open.rs:33` [확인]). 그래서 Tauri 앱을 만들지 않는 CLI 경로에서도 GUI(`auth_io.rs`의 `PluginAuthIo`가 `opener().open_url`)와 같은 OS 열기 코드를 탄다. 새 crate가 없고 `open`/`xdg-open`/`start`를 직접 띄우는 코드도 쓰지 않는다. 셸은 지금처럼 `open: impl FnOnce(&str) -> bool` seam만 받고, 앱 crate의 CLI 갈림이 이 함수를 넘긴다. 셸 테스트는 기록용 closure를 넘긴다.

**흐름**(모두 `app.lock`을 쥔 뒤, §5.1)
1. `App::open_with_auth` → `auth_retry()`. 저장 세션이 `Checking`이거나 갱신 예정이 지났으면 여기서 refresh한다.
2. 상태가 `SignedIn`(온라인·오프라인 유예 포함)이면 "이미 로그인되어 있어요: {채널 이름}"과 코드 0으로 끝난다. 브라우저를 열지 않는다.
3. 아니면 `auth_login_wait(open_url)`. 시작에 실패하면(수신기를 못 엶·`/auth/start` 실패, `BeginLogin::Failed`) 이유 한 줄과 코드 1이다.
4. 브라우저를 열지 못하면(`open`이 false) `auth_cancel()`을 부르고 "브라우저를 열지 못했어요. 기본 브라우저를 확인한 뒤 다시 실행해 주세요."와 코드 1이다. **로그인 주소를 터미널에 찍지 않는다**(§12). GUI의 [주소 복사](`auth_copy_login_url`)에 해당하는 것은 CLI에 없다.
5. 열었으면 stderr에 "브라우저에서 로그인해 주세요. 끝나면 여기로 돌아와요. 그만두려면 Ctrl+C를 눌러 주세요."를 쓰고 기다린다. 남은 시간은 따로 출력하지 않는다(GUI도 기한을 보이지 않는다).
6. 끝 상태에 따라 출력과 종료 코드를 낸다(아래 표).

**대기 시간과 취소**: CLI용 새 시간 상수는 없다. 기다림은 서비스의 로그인 기한(10분)이 끝내고, 수신기는 `MAX_LIFETIME`(11분)에 스스로 닫힌다. Ctrl+C는 `tokio::select!`로 기다림과 겨룬다. Ctrl+C가 먼저면 `auth_cancel()`(로그인을 지우고 수신기를 닫는다. 저장 세션이 없으면 `SignedOut`, `service.rs:1225-1245` [확인])을 부르고 "로그인을 그만뒀어요."와 코드 130이다. 브라우저 탭은 CLI가 닫지 못한다. 그 탭에서 늦게 끝낸 로그인은 수신기가 닫혀 있어 세션이 생기지 않는다(GUI 취소와 같다).

**끝 상태 → 출력·종료 코드**(`AuthPhase`·`AuthReason`, `crates/shell/src/auth/status.rs:5-51` [확인])

| 끝 상태 | 출력(stderr) | 코드 |
|---|---|---|
| `SignedIn` | "로그인했어요: {채널 이름}" | 0 |
| `Denied` + `DailyLimit` | GUI의 `auth.dailyLimit.title` 한 줄(본문의 [다시 시도] 안내는 CLI에 맞지 않아 "다음 날 다시 `login`을 실행해 주세요."로 바꾼 새 키) | 3 |
| `Denied` + `Blocked`·이유 없음 | GUI의 `auth.denied.title` 한 줄 + "허가를 받은 뒤 다시 `login`을 실행해 주세요."(새 키) | 3 |
| `Expired` + `LoginTimeout`(기한 안에 일시 오류가 없었을 때, `finish_timeout` `service.rs:978-990` [확인]) | "로그인 시간이 지났어요. 다시 실행해 주세요." | 3 |
| `Error` + `Network`·`Server`·`LoginLost`·`Receiver`(기한 직전 일시 오류로 끝난 시간 초과 포함) | 이유 한 줄(GUI 오류 문구와 같은 뜻의 Rust 상수) | 1 |
| Ctrl+C로 그만둠(위 "대기 시간과 취소") | "로그인을 그만뒀어요." | 130 |

- 문구는 새 copy 키이거나 이미 있는 GUI 키를 Rust 상수로 옮긴 것이다(§11). 위 표의 따옴표는 초안이고 구현 PR에서 content.md 문구 전표와 함께 확정한다.
- 거부(`Denied`)를 3으로 둔 까닭: "로그인되지 않았다"는 뜻이 다른 명령의 3과 같다. 새 코드를 만들지 않는다.
- 다른 명령의 로그인 없음 출력은 "로그인이 필요해요. `login`으로 로그인한 뒤 다시 실행해 주세요."와 코드 3이다. `Expired`·`Denied`면 같은 문구에 이유 한 줄을 붙인다.
- 게이트: `login`이 부르는 셋(`auth_retry`·`auth_login`·`auth_cancel`)은 모두 `OPEN_COMMANDS`에 있다(`crates/shell/src/gate.rs:19-33` [확인]). CLI도 일관성을 위해 `gate_command`를 부르지만 늘 통과한다.
- 로그인을 쓰지 않는 빌드(Worker 주소 없음)면 `auth_login`처럼 `disabled`를 돌려준다. "이 빌드는 로그인을 쓰지 않아요."와 코드 0이다.

### 5.4 로그아웃 명령은 두지 않는다(가장 작은 선택)
사용자는 로그인만 정했다. 로그아웃을 대칭으로 둘지는 이 명세가 정한다. **두지 않는다.**
- 세션 파일은 GUI와 같다. 그래서 GUI 설정의 [로그아웃] 한 번이면 CLI도 로그아웃된다. CLI만 있는 기기는 없다(`login`도 같은 기기의 브라우저가 있어야 한다, §1.2).
- 로그아웃은 로컬 세션을 지우고 서버 폐기를 부르며, 세션 파일을 지우지 못한 경우를 오류로 낸다(`service.rs:1249-1281`, `app.rs:598-606` [확인]). CLI에 두면 문구·종료 코드·테스트가 늘어난다. 이 기능에서 얻는 것은 없다.
- 다시 여는 조건: 화면 없는 기기의 로그인(O2 (c))을 열 때, 또는 스크립트에서 로그아웃해야 하는 수요가 생길 때. `auth_logout`은 이미 `OPEN_COMMANDS`에 있어 게이트 변경 없이 더할 수 있다.

## 6. GUI가 떠 있을 때, CLI가 도는 중에 GUI를 열 때

### 6.1 GUI가 이미 떠 있을 때 CLI 실행
- CLI는 single-instance 플러그인을 거치지 않는다(§3.1). 따라서 "기존 창에 포커스"가 일어나지 않고, §5.1의 잠금에서 `HeldElsewhere` → 코드 5로 끝난다.
- 다른 길(§15 O4 (b)·(c), 고르지 않음. 사용자 결정은 (a) 거부와 코드 5): 떠 있는 GUI에 주소를 넘겨 GUI가 받게 하는 방법. single-instance 콜백이 `argv`를 받으므로(`lib.rs:681`의 `_argv`) 기술적으로 된다. 하지만 GUI 쪽에 웹뷰 밖에서 오는 enqueue 경로와 CLI가 진행을 기다리는 IPC가 따로 필요해 v1 범위를 넘는다.

### 6.2 CLI가 받는 중에 GUI를 열 때
- 지금 GUI는 single-instance 확인을 통과한 뒤(CLI는 그 소켓이나 뮤텍스를 만들지 않으므로 통과한다) setup에서 잠금을 못 쥐면 **창을 숨기고 조용히 끝난다**(`lib.rs:579-588` [확인]). 이 동작은 macOS에서 거의 동시에 뜬 GUI 두 개의 경합을 위해 만든 것이다. 사용자 눈에는 "앱 아이콘을 눌렀는데 아무것도 안 뜬다"가 된다.
- **결정(O1 (a))**: CLI는 같은 폴더의 `cli.lock`을 **먼저** 배타로 쥐고 그다음 `app.lock`을 쥔다(같은 `File::try_lock`). `app.lock`을 못 쥐면 `cli.lock`을 바로 놓는다. 순서가 반대면 CLI가 `app.lock`만 쥔 틈에 뜬 GUI가 `cli.lock`이 비어 있다고 보고 조용히 끝난다. GUI는 `HeldElsewhere`일 때만 `cli.lock`을 `try_lock`해 본다. 우연히 쥐게 되면 바로 놓는다.
  - **놓는 순서는 잡는 순서의 반대**(`app.lock` 먼저, `cli.lock` 나중, `CliLocks`의 필드 순서). 반대로 놓으면 그 사이에 뜬 GUI가 `app.lock` 잡힘 + `cli.lock` 빔을 보고 조용히 끝난다(구현 후 리뷰 반영). 그리고 GUI는 `cli.lock`이 비어 있으면 `app.lock`을 **한 번 더** 시도한다(`acquire_gui_lock`): 첫 시도 뒤 CLI가 끝났다면 `app.lock`은 이미 풀려 있으므로 이 시도는 쥔다.
  - 잠겨 있으면(CLI가 쥐고 있으면) 시작 실패 안내와 같은 대화상자(`startup_failed`, `lib.rs:393-409`)로 "명령줄에서 받는 중이에요. 끝난 뒤 다시 열어 주세요."를 보이고 끝난다.
  - 잠겨 있지 않으면 지금처럼 조용히 끝난다(GUI 둘의 경합).
  - 잠금 파일에 내용을 적어 구분하지 않는 까닭: Windows의 `LockFileEx` 배타 잠금은 다른 프로세스의 읽기도 막는다 [가정: `File::try_lock`의 Windows 구현이 전체 범위를 잠근다, 구현 PR에서 확인].
- 이 대화상자 문구는 새 copy 키다(§11). 대화상자 없이 지금처럼 조용히 끝내는 안(O1 (b))은 고르지 않았다.
- `login`도 같다. CLI가 로그인을 기다리는 동안(최대 10분) GUI를 열면 같은 대화상자가 뜬다. 문구는 사용자가 고른 "명령줄에서 받는 중이에요"를 그대로 둔다. 로그인 대기에도 맞는지는 CLI-4에서 문구 전표를 확정할 때 다시 본다(§11 `cli.busy.body`).

## 7. OS별

### 7.1 Windows: 콘솔 실행 파일 `chzzk-cli.exe`(O3 (b), 사용자 결정)
- 릴리스 빌드의 `chzzk-app.exe`는 `windows_subsystem = "windows"`다(`main.rs:2` [확인]). 콘솔이 없어 `println!`이 아무 데도 가지 않는다. 처음 추천은 같은 exe에서 `AttachConsole`로 시작해 실측(M-CLI-1)으로 정하는 것이었다. 하지만 cmd.exe는 GUI 서브시스템 프로세스를 기다리지 않는다. 그래서 프롬프트가 먼저 돌아와 출력과 섞이고, `%ERRORLEVEL%`이 CLI의 종료 코드가 아니게 된다. 사용자는 **처음부터 콘솔 서브시스템 실행 파일을 더하는 안**을 골랐다.
- **이름**: `chzzk-cli.exe`. 설치 폴더에서 `chzzk-app.exe` 옆에 놓인다. `.com` 트릭(같은 이름 `chzzk-app.com`)은 쓰지 않는다. Tauri의 `externalBin` 경로 규칙은 Windows에서 `-<triple>.exe`를 붙이고(`tauri-utils` 2.10.1 `src/resources.rs:46-61` [확인]), 아래의 `[[bin]]` 방식도 `.exe`만 만든다.

**만드는 방법: 같은 crate의 둘째 `[[bin]]` + feature로 Windows만**
- `app/src-tauri/Cargo.toml`에 다음을 더한다.
  - `[[bin]] name = "chzzk-cli"`, `path = "src/bin/chzzk-cli.rs"`, `required-features = ["console-cli"]`.
  - 빈 feature `console-cli = []`.
  - `[package] default-run = "chzzk-app"`. bin이 둘이면 `cargo run`과 `tauri dev`가 어느 쪽인지 정해야 한다.
  - `chzzk-cli.rs`에는 `windows_subsystem` 속성이 없다(기본이 콘솔). `main`은 `chzzk_app_lib::cli_main()`의 종료 코드를 돌려준다. 몸통(인자·게이트·잠금·경로·로그·Ctrl+C)은 macOS·Linux의 `chzzk-app` 갈림과 **같은 함수**다.
- 새 파일 `app/src-tauri/tauri.windows.conf.json`에 `{"build": {"features": ["console-cli"]}}`를 둔다. Tauri CLI는 이 파일을 Windows에서만 병합한다. 지금 있는 `tauri.linux.conf.json`과 같은 방식이다(`app/src-tauri/tauri.linux.conf.json` [확인]). 그래서 Windows의 `pnpm tauri build`(bundle·release·`tauri-build` gate·e2e 빌드)에서만 이 bin이 만들어진다.
- 번들러가 이 bin을 싣는 근거 [확인: 상류]:
  - `crates/tauri-cli/src/build.rs:275-276`: config의 `build.features`를 빌드 옵션의 features에 더한다. 그래서 아래 판정과 cargo 빌드가 같은 feature 집합을 본다.
  - `crates/tauri-cli/src/interface/rust/desktop.rs:242`·`:263-267`: cargo는 `--bin` 없이 `build --features …`로 불린다. 그래서 `required-features`가 채워진 bin은 따로 빌드 단계 없이 함께 만들어진다.
  - `crates/tauri-cli/src/interface/rust.rs:928-951` `get_binaries`: `required_features_enabled`가 거짓인 bin은 건너뛴다. 나머지는 모두 `BundleBinary`가 되고, 이름이 패키지 이름 `chzzk-app`인 것만 main이다.
  - `crates/tauri-bundler/src/bundle/windows/nsis/mod.rs:860-889` `generate_binaries_data`: main이 아닌 bin을 설치 목록에 넣는다. `installer.nsi:659-661`이 `$INSTDIR`에 복사하고, `:794-796`이 제거 때 지운다.
  - `msi/main.wxs:160-164`: 같은 목록을 WiX `Component`로 설치한다.
  - macOS·Linux는 feature가 꺼져 있어 `get_binaries`가 건너뛴다. 그래서 `.app`·deb·AppImage에는 들어가지 않는다.
- **`externalBin`(사이드카)·`resources`를 쓰지 않는 까닭** [확인]:
  - `tauri-build` 2.7.1은 `chzzk-app` 자신의 `build.rs`에서 `externalBin`을 대상 폴더로 복사한다(`src/lib.rs:736-738`, `copy_binaries` `:140-165`). 그러니 파일이 `chzzk-cli-x86_64-pc-windows-msvc.exe` 이름으로 **컴파일 전에** 있어야 한다. 그 파일을 같은 crate가 만들면 순환이다.
  - 또 사이드카 이름이 패키지 이름과 같으면 거부한다(`:155-160`).
  - 순환을 피하려면 crate를 따로 두고 모든 Windows 빌드 gate와 `release.mjs`의 빌드 단계에 "먼저 빌드해 복사" 단계를 넣어야 한다. `[[bin]]`은 이 단계가 필요 없다. `resources`도 같은 `build.rs` 복사를 지나므로 같은 문제다.
- **따로 crate를 두지 않는 까닭**: Tauri 비의존 crate로 만들면 잠금(`acquire_instance_lock`)·경로·로그(`logging.rs`)·E2E 격리(`e2e.rs`)를 셸로 옮겨야 한다. 이것들은 지금 앱 crate에 있다(`lib.rs:435-467` [확인]). `[[bin]]`은 같은 rlib을 링크하므로 옮길 것이 없다.
  - 대가는 크기다. 콘솔 exe는 `chzzk_app_lib`을 링크하지만 `cli_main`에서 닿지 않는 Tauri 코드는 링커가 버린다고 본다 [가정]. 실제 크기는 CLI-5에서 새 ratchet 키 `size.binary.windows-cli`로 잰다. 크기가 GUI exe와 비슷하게 나오면(버려지지 않으면) 그때 따로 crate 안으로 바꾸고 app.md 구현 중 변경에 적는다.
- **cargo 직접 실행 gate**: `tauri-clippy`·`tauri`(Windows)는 `cargo … -p chzzk-app`이라 `tauri.windows.conf.json`을 읽지 않는다. Windows 행에 `--features console-cli`를 더해 이 bin도 clippy·테스트한다(`gates.mjs`). macOS·Linux에서는 이 feature를 켜도 bin이 만들어지기만 하고 번들에는 들어가지 않는다. 그래서 gate는 Windows에서만 켠다.
- **`chzzk-app.exe`에 CLI 하위 명령이 오면** §3.1처럼 안내 한 줄과 코드 2다. 받기를 GUI 서브시스템에서 돌리지 않는다.
- **한글 출력**: Rust `std`의 stdout은 콘솔 핸들이면 UTF-16 `WriteConsoleW`로 바꿔 쓴다. 그래서 코드 페이지(949)와 무관하게 한글이 보인다. 콘솔 서브시스템이라 핸들은 처음부터 콘솔이다 [가정: M-CLI-1에서 확인]. 파이프·파일로 돌려지면 UTF-8 바이트를 그대로 쓴다. 문서에 "PowerShell 5에서 파이프로 받으면 `[Console]::OutputEncoding`을 UTF-8로"를 한 줄 둔다 [실측 필요].
- **Ctrl+C**: 콘솔 프로세스라 tokio `signal::ctrl_c()`(Windows는 `SetConsoleCtrlHandler`)가 그대로 받는다. GUI 서브시스템 + `AttachConsole`일 때의 "cmd와 CLI가 Ctrl+C를 함께 받는다" 문제가 없다.
- 종료 코드: `main`이 `std::process::ExitCode`를 돌려준다. 0~255 밖은 쓰지 않는다(130 포함).
- **설치 경로**: NSIS는 `%LOCALAPPDATA%\VOD 클립 다운로더\chzzk-cli.exe`다(GUI exe와 같은 폴더, cicd.md 구현 중 변경 30 (나) `docs/design/cicd.md:469` [확인: 문서]). MSI는 `INSTALLDIR`이 다르므로(같은 절 (다), `smoke.mjs:413-428` [확인]) 도움말은 "설치한 폴더의 `chzzk-cli.exe`"로 쓰고 NSIS 경로를 예로 든다. PATH에는 넣지 않는다(O7 (a)).
- **시작 메뉴·바로 가기**: 설치기는 main 실행 파일만 바로 가기를 만든다. `chzzk-cli.exe`에는 바로 가기가 생기지 않는다(템플릿의 바로 가기는 `MAINBINARYNAME` 하나다, `installer.nsi:949-976` [확인: 상류]).
- **설치기의 실행 중 확인**: NSIS는 main 실행 파일이 떠 있는지만 본다(`installer.nsi:646` `CheckIfAppIsRunning "$INSTDIR\${MAINBINARYNAME}.exe"` [확인: 상류]). `chzzk-cli.exe`가 떠 있으면 확인 없이 파일 덮어쓰기에서 막힐 수 있다. §10의 잠금 순서가 이 경우를 대부분 막는다.

### 7.2 macOS
- 실행 파일은 `.app` 번들 안에 있다: `/Applications/VOD 클립 다운로더.app/Contents/MacOS/<CFBundleExecutable>`. 설치 스모크는 이름을 `Info.plist`에서 읽는다(`scripts/ci/smoke.mjs:14`·`:360` [확인]). 이름이 `chzzk-app`인지는 산출물로 확인한다 [실측 필요, CLI-4에서 smoke 로그로].
- 터미널에서 이 바이너리를 직접 실행하면 `NSApplication`을 만들지 않으므로(§3.1, Tauri 빌더 전 갈림) Dock 아이콘이 뜨지 않는다 [가정, M-CLI-2].
- quarantine: 처음 GUI로 한 번 연 설치본은 Gatekeeper 확인이 끝났다. GUI를 한 번도 열지 않은 채 터미널에서 실행하면 막힐 수 있다 [가정]. 도움말은 "앱을 한 번 연 뒤"를 첫 단계로 둔다. 로그인은 그 뒤 앱에서 하거나 `login`으로 한다.
- PATH: 설치기가 등록하지 않는다(dmg는 끌어다 놓기라 그럴 수 없다). 도움말에 `alias`나 `~/bin` 심볼릭 링크 한 줄을 둔다. 공백·한글 경로라 따옴표가 필요하다.

### 7.3 Linux
- deb: `/usr/bin/chzzk-app`(app.md 구현 중 변경 76 `docs/design/app.md:1386` [확인: 문서]). PATH에 이미 있다.
- AppImage: `./<파일>.AppImage download <주소>`. AppRun이 인자를 넘긴다 [가정: smoke-install AppImage 단계에서 `status`로 확인]. libfuse2 전제는 GUI와 같다(web.md §7).
- 화면 없이 돈다(§3.1). SSH 세션이나 서버에서 쓸 수 있다. 다만 `login`은 같은 기기에서 브라우저를 열어야 끝난다(루프백 `127.0.0.1`, §5.3). 세션 파일은 기기마다 따로다. 그래서 "화면 없는 서버에서 CLI만"은 v1에서 되지 않는다(O2 (c)는 범위 밖). 화면 없는 기기에서 `login`을 부르면 브라우저 열기가 실패해 코드 1이다(`xdg-open`이 없거나 실패).
- rpm은 지금 산출물이 아니다(`expected-artifacts.json` linux bundles = appimage·deb [확인]).

### 7.4 경로(Tauri 없이 같은 폴더)
- GUI는 `app.path()`로 config·data·log·video·download·home을 얻는다(`lib.rs:537-560` [확인]). CLI는 Tauri 앱을 만들지 않으므로 같은 값을 `dirs`(이미 `Cargo.lock`의 `dirs` 7.0.0, Tauri가 쓰는 것 [확인: lock])와 identifier `io.github.chnu-kim.chzzk-downloader`로 만든다. macOS 로그 폴더는 `~/Library/Logs/<identifier>`로 따로다(CLAUDE.md "주의사항").
  - `dirs`를 앱 crate의 직접 의존성으로 올리는 것은 새 crate가 아니다. 다만 버전은 Tauri가 쓰는 것과 같아야 한다(lock 하나).
- **대조 테스트**: 앱 crate의 `tests/`에서 mock 런타임(`tauri` dev-dep `features = ["test"]`, `Cargo.toml:41` [확인])의 `app.path()` 값과 `cli_paths()` 값이 같은지 3 OS에서 본다(`tauri` gate). 다르면 CLI가 다른 세션·다른 `jobs.json`을 보게 되므로 이 테스트가 이 기능의 기둥 하나다.
- 스모크·E2E 격리: `--features e2e` 빌드에서 `CHZZK_E2E_API_BASE`·`CHZZK_E2E_DIR`이 있으면 CLI도 그 경로·클라이언트·Worker 주소를 쓴다. 코드는 `e2e.rs`에만 둔다(`release-hygiene`, CLAUDE.md). `lib.rs`의 `e2e_override()`(`lib.rs:458-467` [확인])를 `cli_main`에서도 부른다. feature는 crate 단위라 Windows `chzzk-cli.exe`도 같은 격리를 쓴다.
- **격리 폴더 `CHZZK_SMOKE_DIR`**: CLI는 `--smoke` 없이 이 환경 변수만 있어도 그 폴더를 데이터·설정·세션 폴더로 쓴다(GUI는 `--smoke`가 있어야 본다). 설치 스모크가 릴리스 빌드의 `chzzk-cli.exe status`를 격리해서 돌리는 데 필요해서 막지 않았다. 대가: 데이터 폴더가 달라 `app.lock`이 GUI와 겹치지 않으므로 GUI와 동시에 돌 수 있다. 사용자가 `session.json`을 그 폴더에 복사하면 두 프로세스가 같은 refresh 토큰을 회전시켜 재사용 감지로 세션이 끊길 수 있다(§5.1 위험 1). 게이트 우회는 아니다(세션 저장소가 따로고 로그인 게이트는 그대로). 사용자가 일부러 세션 파일을 옮겨야만 생기므로 이 환경 변수는 문서에 적지 않는다(도움말에도 없다).
- 로그: GUI와 같은 `logging::init(log_dir)`. 첫 줄에 `mode = "cli"`를 남긴다. **잠금을 쥔 뒤에** 로그를 시작한다. 코드 5로 끝나는 CLI가 떠 있는 GUI의 로그 파일에 덧붙이지 않게 하려는 것이다(GUI는 잠금 전에 로그를 연다, `lib.rs:529-536`, 잠금은 `:575` [확인]).

## 8. 설정과 인자 덮어쓰기

원칙: **설정을 그대로 읽고, 인자는 이 실행에서만 덮으며, 설정 파일에 쓰지 않는다.** 예외는 `enqueue_checked`가 원래 하는 저장(마지막 화질, 최근 영상)뿐이다. GUI와 같은 함수를 부르므로 이것도 같이 일어난다. 이 부작용은 도움말에 적는다(§11).

| 인자 | 설정에서 오는 기본값 | 덮는 방법 | 근거 |
|---|---|---|---|
| `--quality <라벨>` | `Resolved::default_quality(last_quality_label)`(GUI 카드와 같다) | 라벨 정확 일치(`1080p` 등, 대소문자 무시). 없으면 코드 2와 함께 가능한 라벨을 출력한다. 받는 중 바뀌면 코어의 `PlaybackChanged`가 그대로 난다 | `crates/core/src/model.rs:202-215`, `services.rs` resolve DTO `default_quality_index` [확인] |
| `--out <폴더>` | 설정 폴더, 없으면 기본 폴더(`job_defaults().download_folder`) | 상대 경로는 현재 폴더 기준 절대 경로로 바꾼 뒤 `EnqueueRequest.folder`로 넘긴다. 검사는 매니저의 `resolve_folder`·`check_folder_segments`가 한다 | `app.rs:244-270`, `manager.rs:566`·`:1580` [확인] |
| 파일 이름 | `ResolvedDto.suggested_file_name` → `check_output`이 정리한 `file_name` | 이름 인자는 v1에 두지 않는다. #166(토큰 템플릿)이 머지되어 설정 템플릿이 있으면 `render_filename`, 없으면 `default_filename`이 `suggested_file_name`을 만든다. 그래서 CLI는 바꿀 것이 없다 | `crates/shell/src/dto.rs:525-530`(`61fc2df`) [확인] |
| 메타데이터·표지 넣기 | 설정 `embed_metadata`(기본 켬, #167). 매니저가 작업에 고정한다 | 인자 없음. GUI와 같이 설정을 따른다 | `crates/shell/src/manager.rs:115`(`61fc2df`) [확인], mp4-metadata.md |
| 이미 있는 파일 | 건너뛴다(`onExisting: skip`, 코어가 `skipped`로 끝냄). "이미 있어요"와 코드 0 | `--overwrite`면 `overwrite` | `receive.ts:222-257`의 규칙을 그대로 옮긴다(번호 이름은 고르지 않는다) |
| 같은 작업의 `.part` | 이어받는다(`restart: false`) | 처음부터 받는 인자는 v1에 없다. 지우고 다시 받으려면 `.part`를 지운다 | `receive.ts:247`, `dto.rs:648-659` [확인] |
| 다른 화질의 `.part` | 코어가 sidecar 불일치로 지우고 새로 받는다(GUI의 `partialOther` 안내와 같다). CLI는 안내 한 줄을 출력한다 | — | `receive.ts:232-234` [확인] |
| 받다 만 녹화 `.part` | `freeFileName`으로 받는다(녹화를 지우지 않는다) | — | `dto.rs:656-658` [확인] |
| `--range <시작>-<끝>` | 없음(전체) | 시각은 셸 `format::parse_clock`(TS `parseClock`과 골든 공유)으로 읽는다. `<끝>`을 비우면 끝까지다. 빠른 다시보기가 아니면 매니저 `validated_range`가 `invalidInput`(코드 2) | `crates/shell/src/format.rs:311` [확인], `crates/shell/tests/format_golden.rs:80` [확인], `manager.rs:559` [확인] |
| `--rate <속도>` | 설정 `job_rate_limit`·`total_rate_limit` | **이 프로세스의 매니저에만** `set_rate_limits(total, Some(rate))`. `update_settings`를 부르지 않는다(부르면 저장된다). 최소 1MB/s 미만은 최소로 올린다(설정과 같은 `normalize_rate_limit`). 값은 바이트/초 정수에 `k`·`m` 접미사(1000 진법)를 붙일 수 있다 [잠정] | `manager.rs:537-541` [확인], rate-limit.md §3, core.md 구현 중 변경 76 |
| `--audio` | 오디오만 받기 설정(기능 (마), PR #168, 2026-10-18 기준 미머지) | **#168 머지 전에는 깃발이 없다**(모르는 인자, 코드 2). 머지되면 (마) 명세가 정한 요청 필드를 그대로 켠다. CLI-6 단계(§16) | ROADMAP:9 순서 "(마) → (다)" |
| 동시 작업 수 | 무관(CLI는 하나씩 받는다) | — | §3.2 |
| 세그먼트 동시 수·쿠키 | 설정 그대로(`job_defaults`, `SettingsService::client_fn`) | 인자 없음 | `services.rs:217-246` [확인] |

## 9. 진행률, 취소, 종료 코드

### 9.1 진행률 출력
- 매니저에 `EventSink`를 하나 등록해(`manager.rs:522`, `events.rs:13-15` [확인]) 이 실행의 `JobId` 이벤트만 본다.
- 출력 채널: **진행률·안내는 stderr, 결과(완성 파일의 절대 경로 한 줄)는 stdout.** 스크립트가 `$(chzzk-app download …)`로 경로만 받을 수 있게 한다.
- TTY 판정은 `std::io::IsTerminal`(std, 의존성 없음)로 한다.
  - TTY: 한 줄을 `\r`로 고쳐 쓴다. 내용은 `받는 중 · 42% · 1.2GB / 2.9GB · 12.3MB/s`. 숫자는 셸 `format::format_percent`·`format_progress_size`·`format_speed`가 만든다(content.md W5 "숫자는 함수가 만든다", `format.rs:152-190` [확인]). 진법은 OS 기준(`size_base_of`)이다.
  - 비TTY: 같은 내용을 **10%마다 또는 30초마다** 한 줄씩 [잠정, ADR-0009]. 로그 파일이 부풀지 않게 하려는 것이다.
- 상태 전환(연결 대기·403 재조회·마무리 중 defrag)은 줄을 바꿔 한 번씩 출력한다. 문구는 GUI 작업 행 문구 키를 Rust 상수로 옮긴 것이다(§11).
- 서명 주소나 토큰은 출력하지 않는다(§12).

### 9.2 취소(Ctrl+C)와 이어받기
- tokio `signal` feature로 `ctrl_c()`를 기다린다. 앱 crate의 tokio feature에 `signal`을 더한다(`Cargo.toml:34` [확인]). 필요한 `signal-hook-registry`는 이미 lock에 있다(`Cargo.lock:4278` [확인]). 새 crate가 아니다.
- **첫 Ctrl+C**: `manager.pause(id)`를 부른다. `running` → `pausing` → `paused`이고 `.part`가 남는다(`manager.rs:674-701` [확인]). 그다음 `paused` 상태 이벤트를 기다리고 `manager.flush()`를 부른 뒤 "멈췄어요. 같은 명령을 다시 실행하면 이어받아요."와 코드 130으로 끝난다.
  - `paused`로 남기는 까닭: GUI의 자동 이어받기는 `interrupted`만 대상이다(`app.rs:422-447` [확인]). 사용자가 멈춘 것을 GUI가 열리자마자 다시 받기 시작하면 안 된다.
- **두 번째 Ctrl+C**(멈추는 중): `manager.quit(짧은 기한)`. 끝나지 않은 작업은 `interrupted`로 저장된다(`manager.rs:1385-1388` [확인]). 코드 130이다. 코어의 `committed_len` 불변식 덕에 다음에 이어받는다(core.md §5.1).
- **그 밖의 종료 신호**(구현 후 리뷰 반영): SIGINT(Windows는 `CTRL_C`·`CTRL_BREAK`)만 한 번으로 센다. 사람이 한 번 더 누를 수 없는 종료 요청, 곧 unix SIGTERM·SIGHUP(`timeout`·`kill`·ssh 끊김·터미널 닫기)과 Windows `CTRL_CLOSE`(콘솔 창 닫기)는 **두 번 누른 것과 같다**: 바로 `quit`해 작업을 `interrupted`로 저장하고 `jobs.json`을 flush한 뒤 코드 130으로 끝난다. 받지 않으면 `running`이 남은 채 프로세스가 끝나 다음 실행의 reconcile에 맡겨진다. 다음 실행이 이어받는 것은 같다.
- **다시 실행**: 같은 주소·화질·폴더로 `download`하면 `check_output`이 같은 작업의 `.part`(`same_job`)를 보고 `restart: false`로 이어받는다(§8 표). `jobs.json`에는 옛 `paused` 기록과 새 기록이 둘 다 남는다. 같은 출력의 **활성** 작업만 `duplicateOutput`이고(`manager.rs:571-573` [확인]) `paused`는 활성이 아니다 [가정: `active_with_output`이 paused를 활성으로 보지 않는다. CLI-2에서 테스트로 확인]. 옛 기록은 GUI 목록에 "받다 만"으로 보인다. 이것이 거슬리면 CLI가 새 작업을 만들기 전에 같은 출력의 `paused` 기록을 `resume_job`으로 다시 쓰는 안이 있다. 이 안은 게이트(`App::resume_job`, `app.rs:356-371`)를 지나므로 안전하지만 v1은 단순한 쪽(새 기록)을 고른다(O9 (a), 사용자 결정).
- **잠자기 방지(O10 (b), 사용자 결정)**: GUI와 같은 `chzzk_shell::power::SystemGuard`(`lib.rs:637-642` [확인])를 같은 전이 함수 `PowerKeeper::update(설정 keepAwake, 실행 중 작업 수)`(`crates/shell/src/power.rs:205-260` [확인])로 쥐고 놓는다. GUI는 1Hz 상태 집계에서 부르고, CLI는 작업 상태 이벤트마다 부른다. 그래서 설정에서 잠자기 방지를 끈 사용자는 CLI에서도 꺼져 있다. 격리 실행(스모크·E2E)은 GUI와 같이 `NoopGuard`다. 셸에 이미 있는 것이라 의존성 변화가 없다.
- 창 닫기 가드(D1)·Dock 진행은 CLI에 없다(창이 없다).

### 9.3 종료 코드

| 코드 | 뜻 | 오류 코드(`ErrorCode`, `crates/shell/src/error.rs:37-72` [확인]) |
|---|---|---|
| 0 | 모두 받았다(이미 있어서 건너뛴 것 포함). `info`·`status`·`help` 성공. `login`으로 로그인했거나 이미 로그인되어 있다 | — |
| 1 | 받기 실패(네트워크·디스크·파서·서버 등). 잠금 파일을 열지 못함. `login`의 시작 실패·브라우저 열기 실패·일시 오류로 끝남(§5.3) | 그 밖 전부 |
| 2 | 사용법 오류: 모르는 명령·깃발, 잘못된 주소, 없는 화질, 생방송 주소(v1), 구간을 쓸 수 없는 영상. Windows `chzzk-app.exe`에 CLI 하위 명령을 줌(§3.1) | `InvalidUrl`, `InvalidInput`, `QualityNotFound`, `RangeOutOfBounds` |
| 3 | 로그인이 필요하다. `login`이 거부(`Denied`)나 시간 초과로 끝났다 | `NotLoggedIn` |
| 4 | 이 계정으로 받을 수 없는 영상 | `NotOwnContent`, `OwnershipUnknown` |
| 5 | 앱(또는 다른 CLI)이 열려 있다 | (잠금 `HeldElsewhere`) |
| 130 | Ctrl+C로 멈췄다(`.part`는 남는다). `login` 기다림을 Ctrl+C로 그만뒀다 | `Cancelled` |

- 주소가 여럿이면 가장 나쁜 코드를 낸다. 순서는 130 > 5 > 3 > 4 > 1 > 2 > 0이다 [가정: 사람이 먼저 손대야 하는 것부터]. 다만 3·5는 첫 주소 전에 나므로 그 자리에서 끝난다.
- `--smoke`의 종료 코드 2(시간 초과)·3(마커 실패)과 숫자가 겹친다(`smoke.rs:30-34` [확인]). 두 모드는 같은 실행에서 함께 일어나지 않는다(§3.1 갈림). 그래서 겹쳐도 되고, 두 표에 서로를 가리키는 주석을 단다.

## 10. 업데이트
- CLI 실행은 업데이트를 확인하지 않는다. GUI는 로그인 확인 직후 한 번 확인한다(`app.rs:740-745` [확인]). CLI만 쓰는 사용자는 GUI를 열 때 업데이트된다. `status`는 지금 버전만 출력한다.
- 업데이트 **내려받기·설치 준비** 동안에는 GUI가 `app.lock`을 쥐고 있어 CLI가 시작하지 못한다(코드 5). 반대로 CLI가 도는 동안 GUI는 열리지 않으므로 바이너리를 바꾸는 일이 생기지 않는다. **Windows는 설치기가 도는 동안이 다르다**: 플러그인이 설치기를 띄우고 `std::process::exit(0)`로 GUI를 끝내므로(`update_io.rs` 머리 주석) 그 뒤 설치기가 도는 내내 `app.lock`이 풀려 있다.
- **Windows `chzzk-cli.exe`도 함께 바뀐다.** Windows updater 키는 설치기 자체를 가리킨다(`windows-x86_64`·`-nsis` → `-setup.exe`, `-msi` → `.msi`, `release/expected-artifacts.json` [확인]). 업데이트는 그 설치기를 다시 돌리고, 설치기는 main이 아닌 bin을 설치 목록에 넣으므로(§7.1 [확인: 상류]) 두 exe가 같은 버전으로 바뀐다. 따로 받는 매니페스트·서명은 없다. 실제로 바뀌는지는 [가정]이고, CLI-5의 `smoke-install`이 설치본 `chzzk-cli.exe status`로 버전 줄을 확인하고 사용자 실측 M-CLI-5가 업데이트 한 번으로 확인한다.
- 남는 틈(Windows, **설치기가 도는 동안 전체**): 그 사이에 시작한 `chzzk-cli.exe download`(예: 예약 작업)는 잠금을 정상으로 쥐고 exe를 연 채 오래 돌 수 있다. NSIS의 실행 중 확인은 main exe만 본다(§7.1). 그러면 덮어쓰기가 실패하거나 GUI와 CLI의 버전이 섞일 수 있다. `help`·잠금을 못 쥔 CLI(끝나기까지 몇 밀리초)도 같은 틈이다. 업데이트는 사용자가 GUI에서 직접 누르는 것이라 설치기가 도는 몇 초에 맞춰 CLI가 시작되는 일은 드물다고 보고 v1은 막지 않는다 [가정]. 걸리면 설치기가 다시 시도·실패를 띄우고 사용자가 다시 업데이트하면 된다(§17). 막으려면 NSIS 훅(`installerHooks`의 PREINSTALL)에서 `chzzk-cli.exe` 실행 여부를 확인하는 방법이 있다. 설치기 템플릿을 건드리는 일이라 이번에는 하지 않았고, 사용자 실측 M-CLI-5에 "설치 중 CLI 실행"을 더해 실제로 어떻게 되는지 먼저 본다.

## 11. 문구·도움말
- **CLI 문구의 원천**: 웹뷰 밖 Rust라 `ko.ts`를 읽을 수 없다. 알림처럼 `crates/shell/src/cli/copy.rs`에 상수로 두고, `ko.ts`에 같은 키(`cli.*`)를 두어 대조 테스트한다(`notify_copy.rs` 방식, content.md §14). 그러면 `design-copy`의 금지어·용어집 검사가 CLI 문구에도 걸린다.
- 용어(content.md §4 용어집): 주소(링크·URL 아님), 로그인(세션·인증 아님), 받기·다운로드, "받다 만", 해요체, "잠시 뒤".
- 문구 전표 초안(구현 PR에서 content.md 문구 전표 행과 함께 확정한다):

| 키 | 초안 |
|---|---|
| `cli.loginNeeded.body` | 로그인이 필요해요. `login`으로 로그인한 뒤 다시 실행해 주세요. |
| `cli.login.waiting` | 브라우저에서 로그인해 주세요. 끝나면 여기로 돌아와요. 그만두려면 Ctrl+C를 눌러 주세요. |
| `cli.login.done` | 로그인했어요: {name} |
| `cli.login.already` | 이미 로그인되어 있어요: {name} |
| `cli.login.cancelled` | 로그인을 그만뒀어요. |
| `cli.login.timeout` | 로그인 시간이 지났어요. 다시 실행해 주세요. |
| `cli.login.openFailed` | 브라우저를 열지 못했어요. 기본 브라우저를 확인한 뒤 다시 실행해 주세요. |
| `cli.login.deniedNext` | 허가를 받은 뒤 다시 `login`을 실행해 주세요. (`auth.denied.title` 다음 줄) |
| `cli.login.dailyLimitNext` | 다음 날 다시 `login`을 실행해 주세요. (`auth.dailyLimit.title` 다음 줄) |
| `cli.login.disabled` | 이 빌드는 로그인을 쓰지 않아요. |
| `cli.useConsoleExe` (Windows `chzzk-app.exe`) | 명령줄에서는 같은 폴더의 chzzk-cli.exe를 써 주세요. |
| `cli.appOpen.body` | 앱이 열려 있어요. 앱을 닫은 뒤 다시 실행해 주세요. |
| `cli.busy.body` (GUI 대화상자) | 명령줄에서 받는 중이에요. 끝난 뒤 다시 열어 주세요. (O1 (a)의 사용자 결정 문구. `login` 대기 중에도 같은 대화상자가 뜬다. 그때 "받는 중"이 맞는지는 CLI-4가 content.md 문구 전표를 확정할 때 다시 본다, §6.2) |
| `cli.paused.body` | 멈췄어요. 같은 명령을 다시 실행하면 이어받아요. |
| `cli.exists.body` | 이미 있어요: {path} |
| `cli.liveUnsupported.body` | 생방송은 앱에서 녹화해 주세요. |
| `cli.notOwn.body` | `errors.ts` `notOwnContent`의 L0 본문을 그대로 쓴다(새 키 아님) |

- `help` 출력: 명령·깃발 표와 종료 코드 표다. 이것도 상수다.
- **웹 도움말**: `help/cli.md`를 새로 두고 `help/ids.json`에 `cli`를 더한다(D51 "앵커 id는 추가만"). 생성 모듈 `worker/src/http/help.generated.ts`는 `scripts/design/worker-gen.mjs`로 다시 만들고 `design-icons`(`--check`)가 확인한다. 내용은 다음과 같다.
  - (1) 로그인: 앱에서 하거나 `login`(같은 기기의 브라우저가 열린다)
  - (2) OS별 실행 파일 위치(§7, Windows는 `chzzk-cli.exe`)와 PATH 한 줄
  - (3) 명령 예시(가짜 주소)
  - (4) 종료 코드 표
  - (5) "앱이 열려 있으면 실행되지 않아요"
  - (6) Windows: `chzzk-app.exe`가 아니라 `chzzk-cli.exe`를 쓴다. PowerShell 5 파이프 인코딩 한 줄(M-CLI-1 결과에 따라)
  - (7) 받은 기록이 앱 목록에 남고 마지막 화질이 바뀐다는 점
- 시각 결정(D 번호)이나 ADR은 없다. GUI 화면을 바꾸지 않는다. 바꾸는 것은 §6.2의 대화상자 문구 하나뿐이다.
- 새 수치 상수: 종료 코드 표와 진행률 간격(10%·30초)만 `docs/design/system/foundations.md` §14 상수 표에 등록하고, 근거 없는 진행률 간격은 ADR-0009 묶음에 더한다(CLI-1). `login`은 서비스의 기존 상수(`LOGIN_TTL`, 수신기 상수)만 쓰므로 새 상수가 없다.

## 12. 비밀값
- CLI는 로그인 주소·토큰·쿠키·서명 미디어 주소를 출력하지 않는다. `login`도 같다: 로그인 주소(`LoginUrl`, `expose()`로만 꺼낸다)는 `open` seam에만 넘기고 터미널·로그에 쓰지 않는다. 브라우저를 열지 못해도 주소를 찍지 않는다(§5.3). 루프백 grant·state·verifier는 서비스 안에서만 다룬다(지금과 같다). 오류는 `AppError.message`(이미 `redact_url`을 거친 셸 오류)만 출력한다. `Debug` 형식(`{:?}`)으로 출력하지 않는다.
- `info`는 제목·채널 이름·화질 라벨·판정만 출력하고 채널 ID는 출력하지 않는다. 채널 ID는 로그 금지 필드라 같은 결을 따른다(worker.md 로그 규칙 `docs/design/worker.md:752`).
- 쿠키 인자는 두지 않는다. 쿠키는 GUI 설정의 자격증명 저장소에서만 온다.

## 13. 배포물·크기·실측

O3 (b)로 Windows 배포물이 바뀐다. 아래는 CLI-5가 바꾸는 것과 바꾸지 않는 것의 전부다.

| 대상 | 영향 | 근거 |
|---|---|---|
| `release/expected-artifacts.json` 산출물 | **그대로**. 설치기 파일(`-setup.exe`·`.msi`)과 updater 키 셋은 같다. 새 번들 폴더도 없다(`[[bin]]`은 `bundle/` 아래에 폴더를 만들지 않는다) | `release/expected-artifacts.json` windows 절 [확인], `bundle.mjs:36` 모르는 폴더 검사 [확인] |
| `expected-artifacts.json` 표 모양 | windows 절에 `"consoleExe": "chzzk-cli.exe"` 한 키를 더한다. 스모크와 hygiene이 이 이름을 한 곳에서 읽는다. `$comment`에 뜻을 적는다. 이 표를 읽는 코드는 모두 필요한 키만 골라 읽고 OS 절의 키 집합을 고정하지 않는다: `xtask/src/manifest.rs:52-89`(`serde_json::Value`에서 `artifacts`만), `scripts/ci/bundle.mjs:35`·`:78`(`artifacts`·`extraDirs`·`arch`), `release.mjs:503`·`:1004`(`artifacts`), `smoke.test.mjs:152`(최상위 OS 키만 비교), Worker `landing.ts`·`seed-release.mjs`(산출물 이름). 그래서 키를 더해도 이들은 바뀌지 않는다 | 각 줄 [확인] |
| `smoke-install` (`smoke.mjs` nsis·msi) | **깨진다 → 고친다.** 지금 `exeIn(dir)`은 설치 폴더에서 `uninstall.exe` 말고 `.exe`가 정확히 하나라고 본다. 둘째 exe가 생기면 NSIS·MSI 스모크가 둘 다 실패한다. CLI-5는 (1) 앱 exe를 이름으로 고르고 (2) `consoleExe`가 있는지 보고 (3) 그것으로 `status`를 돌려 코드 3을 단정하고 (4) 제거 뒤 폴더가 사라지는지(지금 검사) 본다 | `scripts/ci/smoke.mjs:391`·`:402`·`:430` [확인] |
| `release-hygiene` | 기본 대상이 `chzzk-app[.exe]` 하나다. Windows에서 `chzzk-cli.exe`도 E2E 표식이 없는지 본다. `cargo tree` feature 검사는 crate 단위라 그대로다 | `scripts/ci/artifact-check.mjs:68` [확인], cicd.md 구현 중 변경 31 |
| size ratchet | 새 키 `size.binary.windows-cli`(`measure.mjs`가 `target/release/chzzk-cli.exe`를 잰다). `size.bundle.windows-setup`·`windows-msi`는 콘솔 exe만큼 커진다. 이 두 키를 느슨하게 하는 줄을 `ci/RATCHET_LOG.md`에 적는다. `size.binary.windows`(GUI exe)는 `Win32_System_Console` 안내 경로만큼만 는다 | `scripts/ci/measure.mjs:165-167` [확인], `ci/ratchet.json` size [확인] |
| `release-selftest` | **코드는 바뀌지 않는다.** 합성 산출물은 `synthBundles`가 표의 `artifacts`만 보고 만든다(`scripts/ci/release.mjs:1004`). 산출물 목록이 그대로이고 설치기 안의 파일은 보지 않으며 `consoleExe`는 읽지 않는다. 다만 `expected-artifacts.json`이 이 gate의 경로 목록에 있어(`RELEASE_SELFTEST_FILES`, `release.test.mjs:367`) CLI-5 PR에서 gate가 저절로 돈다. 녹색이면 끝이다. 같은 이유로 Worker gate도 돈다(`run.test.mjs:306`) | 각 줄 [확인] |
| `release.mjs`(stage·build) | 바뀌지 않는다. `pnpm tauri build`는 `--bin` 없이 `cargo build --features <config+인자> --release`를 부른다. 그래서 feature가 켜진 Windows에서는 두 exe가 함께 만들어진다. 서명은 설치기 단위(minisign)라 exe 수와 무관하다. 코드 서명은 하지 않는다(ROADMAP "경쟁력 개선 착수") | 상류 `crates/tauri-cli/src/interface/rust/desktop.rs:242`·`:263-267` [확인: 상류], `scripts/ci/release.mjs:523-548` [확인] |
| `e2e-native (windows)` | CLI 받기·거부를 `chzzk-cli.exe`로 돈다(e2e 빌드는 `--features e2e`와 config의 `console-cli`가 합쳐진다) | 상류 `crates/tauri-cli/src/build.rs:275-276`이 인자 `--features`에 config `build.features`를 더한다 [확인: 상류] |
| macOS·Linux 번들 | 바뀌지 않는다(feature가 꺼져 bin이 없다). 크기는 CLI 코드만큼 는다 | §7.1 |

- 크기 예상: 콘솔 exe는 링커가 Tauri 코드를 얼마나 버리는지에 달렸다 [잠정: 수 MB]. 버전 PR에 Windows·macOS 번들 크기를 함께 적는다(메모리 "버전 규칙").
- 첫 CLI 릴리스: CLI-2가 macOS·Linux에 CLI를 싣지만, Windows에서는 CLI-5가 들어가기 전까지 CLI가 없다(`chzzk-app.exe`는 지금처럼 인자를 무시한다). 그래서 **CLI를 알리는 첫 버전은 CLI-5가 머지된 뒤**에 낸다(§16).
- 사용자 실측(출력은 판정만, 결과는 ROADMAP에 범주로):

| ID | 무엇 | 누가 | 판정 |
|---|---|---|---|
| M-CLI-1 | Windows 10/11(`win10/` VM) cmd·PowerShell 대화형에서 `chzzk-cli.exe`: 프롬프트가 끝날 때까지 기다림, `%ERRORLEVEL%`·`$LASTEXITCODE`가 종료 코드, 한글 출력, Ctrl+C 첫 번째가 일시정지. `chzzk-app.exe download`가 안내 한 줄과 코드 2 | 사용자(또는 VM에서 에이전트) | 된다/안 된다 |
| M-CLI-2 | macOS 설치본에서 터미널 `status`·`download`·`login`: Dock 아이콘 없음, quarantine, 브라우저가 열림 | 사용자 | 된다/안 된다 |
| M-CLI-3 | 실제 계정으로 `login` → 본인 영상 받기 + 남의 영상 거부(코드 4). 그 뒤 GUI를 열면 로그인되어 있음(세션 공유) | 사용자 | 일치/불일치 |
| M-CLI-4 | GUI를 연 채로 CLI(코드 5), CLI가 받는 중·`login` 대기 중에 GUI 열기(대화상자) | 사용자 | 된다/안 된다 |
| M-CLI-5 | Windows에서 앞 버전 설치본을 GUI 업데이트로 올린 뒤 `chzzk-cli.exe status`의 버전이 새 버전. 그리고 업데이트 설치기가 도는 동안 `chzzk-cli.exe download`를 실행해 두었을 때(§10 남는 틈): 설치가 끝나는가, 두 exe의 버전이 같은가 | 사용자 | 된다/안 된다 |

## 14. 테스트 계획(TDD: 실패 테스트 먼저)

### 14.1 셸 단위·통합(`crates/shell`, `rust` gate 3 OS)
- `cli::args`: 하위 명령·깃발 표 골든. 중복 깃발, `--x=값`, `--` 뒤 주소, UTF-8 아님, 생방송 주소, `--range` 시각(`parse_clock` 골든 재사용), `--rate` 접미사·최소값.
- `cli::run`을 가짜 Backend(`crates/shell/tests/common/fake.rs`)와 가짜 `WorkerApi`로 돌리는 `tests/cli.rs`:
  - §4.3 T-G1~T-G6. T-G5는 구현 PR에서 게이트 호출을 일부러 빼 실패를 확인하고 되돌린다.
  - 이어받기: 첫 실행을 Ctrl+C 신호(주입한 취소 future)로 멈추면 상태가 `paused`이고 `.part`가 있으며 코드 130이다. 둘째 실행이 같은 `.part`를 이어받는다(가짜 Backend의 시작 오프셋으로 단정).
  - 이미 있음 → 코드 0·`skipped`. `--overwrite` → 덮어씀.
  - `--rate`가 매니저에는 반영되고(`rate_limits()`) 설정 파일에는 쓰이지 않는다.
  - 갱신: 유예 안 `SignedIn`이면 refresh 0회, `Checking`이면 1회(가짜 `WorkerApi` 호출 수). `startup` 변형이면 0회 단정이 실패한다.
  - 자동 이어받기 없음: `jobs.json`에 다른 `interrupted` 작업이 있어도 CLI 실행 뒤 그 작업은 그대로다. `AuthSetup::Disabled`와 `Enabled` 두 경우 모두 본다.
  - 끝난 기록: `cli::run`이 돌아온 직후 `jobs.json`을 다시 읽으면 상태가 `completed`(Ctrl+C면 `paused`)다. flush를 빼는 변형이면 실패한다.
  - 여러 주소: 둘째가 실패해도 셋째를 받고 코드는 가장 나쁜 것.
  - 출력 분리: stdout은 경로 한 줄, stderr에 진행률(주입한 writer 둘).
  - 잠자기 방지: 가짜 `SleepGuard`로 받는 동안 얻고 끝나면 놓는다. 설정 keepAwake가 꺼져 있으면 얻지 않는다.
- `login`(`tests/cli_login.rs`, 기존 `tests/app_auth.rs`·`auth_service.rs`의 가짜 `WorkerApi`·`GrantSource` seam을 쓴다):
  - 이미 `SignedIn`(유예 안) → `open`이 불리지 않고 코드 0, `/auth/start` 0회.
  - 정상: `open`이 한 번 불리고 가짜 grant를 넣으면 `session.json`이 생기고 코드 0. 그 뒤 같은 데이터 폴더로 연 `App`(GUI 경로와 같은 `open_with_auth`)이 `SignedIn`을 본다(세션 공유).
  - `open`이 false → `auth_cancel`이 불리고 코드 1, 출력에 로그인 주소가 없다(출력 writer를 가짜 로그인 주소의 표식 문자열로 검사, `auth_secrets.rs` 방식).
  - 기한 초과(주입 시계) → 코드 3. 거부(`denied`, `reason` 있음·없음) → 코드 3과 이유 줄. 시작 실패(수신기 bind 실패·`/auth/start` 5xx) → 코드 1.
  - Ctrl+C(주입한 취소 future) → 코드 130, 수신기가 닫히고 그 뒤 들어온 grant는 세션을 만들지 않는다.
  - 부작용 없음: 로그인 성공 뒤에도 `interrupted` 작업이 그대로이고 업데이트 확인 호출이 0회다.
- `cli::copy` ↔ `ko.ts` 대조 테스트(`notify_copy.rs` 방식).

### 14.2 앱 crate(`tauri`·`tauri-clippy` gate 3 OS)
- 갈림: `wants_cli(["download", …])`·`["login"]` 참, `["--smoke"]`·`[]`·`["-psn_0_1"]` 거짓, `["download", "--smoke"]`는 CLI.
- Windows(`cfg(windows)` 테스트, CLI-5): GUI exe 경로의 CLI 하위 명령이 코드 2이고 `cli_main`을 부르지 않는다. CLI-2~CLI-5 사이에는 Windows에서 `wants_cli`가 GUI 갈림에 쓰이지 않음을 본다. `chzzk-cli` bin은 `--features console-cli`로 clippy·빌드된다(§7.1 gate 행).
- 경로 대조: `cli_paths()` == mock 런타임 `app.path()`(config·data·log·video·download·home).
- 잠금: `app.lock`을 다른 핸들로 쥔 채 CLI를 돌리면 코드 5이고 `jobs.json`을 열지 않는다. `cli.lock` 판정 함수(GUI 쪽 §6.2) 표 테스트.

### 14.3 네이티브·스모크
- `smoke-bin`(debug 바이너리): `chzzk-app help`가 0, `chzzk-app status`가 3(로그인 없는 임시 데이터 폴더, `CHZZK_SMOKE_DIR`과 같은 격리 환경 변수를 CLI에도 둔다). Linux는 **`DISPLAY`·`WAYLAND_DISPLAY`를 지운 채** 돌려 Tauri를 만들지 않음을 단정한다. Windows는 `target/debug/chzzk-cli.exe`로 같은 두 단정을 하고, `chzzk-app.exe help`가 2임을 본다(CLI-5). `login`은 브라우저를 여는 명령이라 스모크에서 돌리지 않는다.
- `smoke-install`(설치본, 3 OS): 설치된 실행 파일로 `status` → 3. deb `/usr/bin/chzzk-app`, AppImage, macOS `.app` 안 `CFBundleExecutable`. Windows는 NSIS·MSI 설치 폴더의 `chzzk-cli.exe`(§13 표의 `smoke.mjs` 고침). 대화형 cmd·PowerShell 동작은 M-CLI-1이다.
- `e2e-native`(Linux·Windows, `--features e2e`): 기존 fixture 서버와 가짜 Worker로 `download <fixture 주소>` → 코드 0과 파일 sha256, 남의 채널 fixture → 코드 4. Windows는 `chzzk-cli.exe`로 돈다. `login`은 E2E에 넣지 않는다(브라우저가 필요하다. 흐름은 §14.1 셸 테스트와 M-CLI-3이 본다). 가짜 백엔드 `app/e2e/mock/backend.ts`는 바뀌지 않는다(command·DTO 변경 없음).
- 웹 E2E(Playwright)는 영향이 없다. §6.2의 대화상자를 넣으면 Rust 대화상자라 웹 E2E 밖이다.

## 15. 결정(2026-10-18 사용자 결정, 처음엔 "열린 결정")

열한 개 모두 정했다. "추천과 같음" 열이 "아니오"인 둘(O2·O3)은 본문을 그 결정에 맞춰 고쳤다(§5.3·§7.1·§13·§16).

| ID | 질문 | 선택지 | 결정 | 추천과 같음 | 근거·반영 |
|---|---|---|---|---|---|
| O1 | GUI와 CLI가 동시에 뜨는 경우 | (a) 잠금 하나로 **한쪽만**: CLI는 코드 5, GUI는 "명령줄에서 받는 중" 대화상자 (b) (a)와 같되 GUI는 지금처럼 조용히 끝남 (c) 세션·작업 파일을 프로세스 사이 잠금으로 나눠 쓰기(동시 실행 허용) | **(a)** | 예 | §5.1·§6.2. 대화상자 문구는 결정대로 "명령줄에서 받는 중". `login` 대기에도 같은 대화상자가 뜨며, 문구는 CLI-4에서 다시 본다(§11) |
| O2 | CLI에서 로그인 | (a) 하지 않음, "앱에서 로그인" (b) `login` 명령: 브라우저를 열고 루프백으로 받기 (c) (b) + 화면 없는 서버용 "다른 기기에서 로그인" | **(b)** | **아니오**(추천 (a)) | §5.3. 앱의 `begin_login`·`run_login_wait`·수신기를 그대로 쓰고 셸에 `auth_login_wait`만 더한다. 브라우저는 `tauri_plugin_opener::open_url`. 세션 저장소 공유. 로그아웃 명령은 두지 않는다(§5.4). (c)는 범위 밖 |
| O3 | Windows 콘솔 | (a) 같은 exe + `AttachConsole` (b) 콘솔 실행 파일 하나 더(`chzzk-cli.exe` 또는 `.com`) (c) (a)로 시작하고 M-CLI-1이 안 되면 (b) | **(b)** | **아니오**(추천 (c)) | §7.1·§13. 같은 crate의 둘째 `[[bin]]` `chzzk-cli`(`required-features`) + `tauri.windows.conf.json`. CLI-5가 필수 단계가 된다 |
| O4 | GUI가 떠 있을 때 CLI가 GUI에 받기를 넘기기 | (a) 넘기지 않음(코드 5) (b) single-instance `argv`로 GUI 목록에 넣고 CLI는 바로 끝남 (c) (b) + CLI가 진행을 기다림(IPC) | **(a)** | 예 | §6.1 |
| O5 | 인자 파서 | (a) 손 파서 (b) `lexopt` (c) `clap` | **(a)** | 예 | §3.3 |
| O6 | 기계가 읽는 출력 | (a) 경로 한 줄(stdout)만 (b) `--json`(줄마다 JSON 이벤트) | **(a)** | 예 | §9.1. 더하기만 하면 되므로 뒤에 열어도 깨지지 않는다 |
| O7 | PATH 등록 | (a) 도움말 안내만 (b) Windows 설치기가 PATH에 더함, deb는 이미 됨 | **(a)** | 예 | §7, §11 도움말 |
| O8 | 생방송 녹화 | (a) v1 제외(코드 2) (b) Ctrl+C = [녹화 마치기](받은 만큼 마무리) | **(a)** | 예 | §1.2 |
| O9 | 다시 실행할 때 옛 `paused` 기록 | (a) 새 기록을 만들고 옛 기록은 남김 (b) 같은 출력의 `paused` 기록을 `resume_job`으로 다시 씀 | **(a)** | 예 | §9.2. 목록이 지저분해지면 (b)로 바꾼다(게이트를 지나므로 안전) |
| O10 | 받는 동안 잠자기 방지 | (a) 없음 (b) GUI와 같은 `power::SystemGuard` | **(b)** | 예 | §9.2. 설정 keepAwake를 따른다 |
| O11 | 설정 저장 부작용(마지막 화질·최근 영상) | (a) GUI와 같이 저장 (b) CLI는 저장하지 않음 | **(a)** | 예 | §8. 도움말에 적는다 |

## 16. 구현 단계(stacked PR)와 gate

모든 PR은 브랜치 단계마다 커밋하고, 커밋 전에 `node scripts/ci/run.mjs scan`과 건드린 gate를 통과시킨다. 인증·게이트·로그인을 건드리는 CLI-1·CLI-2와 배포물을 바꾸는 CLI-5에 Codex 리뷰를 붙인다(ROADMAP:9, 메모리 "Codex 리뷰 범위": 인증·릴리스). **순서는 CLI-1 → CLI-2 → CLI-5 → CLI-3 → CLI-4 → (CLI-6)**다. CLI-3의 Windows 스모크·E2E가 `chzzk-cli.exe`를 써서 CLI-5가 먼저다. 번호는 처음 명세의 것을 그대로 둔다.

| 단계 | 내용 | 필수 | 커밋 타입 | gate |
|---|---|---|---|---|
| CLI-0 | 이 명세와 사용자 결정 반영 | 예 | `docs:` | `scan`, `scripts-test` |
| CLI-1 | 셸 `cli` 모듈: 인자 파서(하위 명령 다섯), `run(&App, args, io)`, 게이트 순서, 종료 코드 표, 진행률 writer, 잠자기 방지 연결, `cli::copy` 상수 + ko.ts 키 + 대조 테스트, `App` 여는 옵션의 자동 이어받기 끔(§5.2). **`login`**: `App::auth_login_wait`(§5.3), 끝 상태 → 출력·코드 표, Ctrl+C 취소. `tests/cli.rs`·`tests/cli_login.rs`(§14.1). 새 상수(종료 코드 표, 진행률 간격 10%·30초)를 `docs/design/system/foundations.md` §14 상수 표에 등록하고 진행률 간격 [잠정]을 ADR-0009 묶음에 더한다. 앱에서는 아직 부르지 않는다 | 예 | `feat:` | `fmt`, `rust`, `frontend`(ko.ts), `design-tokens`(spec-check·design-copy), `coverage`·`test-count` |
| CLI-2 | 앱 crate: `cli_main`(macOS·Linux는 `chzzk-app` 갈림에서 부른다), `wants_cli`, `cli_paths`(+ mock 런타임 대조), 잠금·`cli.lock`, tokio `signal`, Ctrl+C 두 단계, `e2e.rs` 격리 환경, 로그 `mode`, `login`의 `open` seam에 `tauri_plugin_opener::open_url`. GUI `HeldElsewhere` 대화상자(O1 (a)). Windows `chzzk-app.exe`의 CLI 갈림은 `cfg(not(windows))`로 막아 둔다(CLI-5가 연다) | 예 | `feat:` | `tauri-clippy`, `tauri`, `tauri-build`, `smoke-bin`(help·status, Linux 화면 없음), `versions`, `supply`(feature 변화 확인) |
| CLI-5 | **(필수, O3 (b))** Windows 콘솔 실행 파일: `[[bin]] chzzk-cli`(`required-features = ["console-cli"]`, `default-run`), `src/bin/chzzk-cli.rs`, `tauri.windows.conf.json`(`build.features`), Windows `chzzk-app.exe`의 CLI 하위 명령 안내(`AttachConsole`, feature `Win32_System_Console`, 코드 2, `cfg(not(windows))` 막음을 푼다), Windows `tauri-clippy`·`tauri` 행에 `--features console-cli`, `expected-artifacts.json` `consoleExe`, `smoke.mjs`(exe를 이름으로 고르고 `chzzk-cli.exe status` → 3), `artifact-check.mjs` hygiene 대상 추가, `measure.mjs` `size.binary.windows-cli` + `ci/ratchet.json`·`RATCHET_LOG.md`(windows-setup·msi), smoke-bin Windows 단정. cicd.md 구현 중 변경 | 예 | `feat:` | `tauri-clippy`·`tauri`·`tauri-build`(Windows), `smoke-bin`, `bundle (windows)`·`smoke-install`(PR에서 dispatch 또는 master), `release-hygiene`, `release-selftest`(바뀌지 않음 확인), `size`, `scripts-test`, `ratchet-log` |
| CLI-3 | 네이티브 E2E·설치 스모크: `e2e-native.mjs`에 CLI 받기·거부(Linux `chzzk-app`, Windows `chzzk-cli.exe`), `smoke.mjs`에 설치본 `status` → 3(macOS·Linux. Windows는 CLI-5에서). size ratchet 확인 | 예 | `test:`/`ci:` | `e2e-native`(Linux·Windows), `scripts-test`, `bundle`·`smoke-install`(master·dispatch), `size` |
| CLI-4 | 도움말 `help/cli.md`·`ids.json`·생성 모듈, content.md 문구 전표(`login`·`useConsoleExe` 포함), app.md 구현 중 변경, ROADMAP. M-CLI-1~5 요청 | 예 | `docs:` | `design-icons`(worker-gen `--check`), `worker`, `design-worker`(관찰), `scan` |
| CLI-6 | `--audio`: (마)의 요청 필드를 켜고 테스트. **오디오 PR #168이 머지된 뒤에만** 연다. 2026-10-18 기준 #168은 미머지라 CLI 첫 릴리스에는 넣지 않는다 | #168에 달림 | `feat:` | `rust`, `tauri`, `e2e-native` |

- 릴리스: CLI를 싣는 첫 버전은 **CLI-5까지 머지된 뒤**에 낸다(Windows 사용자가 쓸 수 있는 CLI가 CLI-5에서 생긴다, §13). `feat`라 minor다(`docs/versioning.md`). 사용자 데이터·Worker 계약을 깨지 않으므로 `!`는 붙이지 않는다(`jobs.json`·`settings.json`·`session.json` 형식 변화 없음, Worker 엔드포인트 변화 없음). 버전 PR에 Windows·macOS 번들 크기를 함께 적는다.

## 17. 위험

| 위험 | 영향 | 대응 |
|---|---|---|
| 경로가 Tauri와 한 글자라도 다름 | CLI가 다른 `session.json`·`jobs.json`을 봐서 로그인 없음으로 보이거나 작업이 따로 쌓인다 | §7.4 대조 테스트(3 OS) |
| 누군가 cli 모듈에서 매니저를 직접 부름 | 소유 게이트 우회 | §4.2 리뷰 항목 + T-G5 |
| Windows cmd에서 출력이 섞이고 종료 코드가 사라짐 | 스크립트가 실패를 모른다 | O3 (b) 콘솔 실행 파일로 처음부터 피한다. `chzzk-app.exe`는 받지 않고 안내만 한다(§3.1). M-CLI-1로 확인 |
| 콘솔 exe가 Tauri 코드를 끌고 와 커짐 | Windows 설치기 크기 증가 | `size.binary.windows-cli` ratchet. 크면 따로 crate로 옮긴다(§7.1) |
| 설치 스모크가 exe 둘을 못 다룸 | CLI-5 PR의 `smoke-install` 실패 | §13 표: 이름으로 고른다 |
| 업데이트 중 `chzzk-cli.exe`가 떠 있음 | 설치기의 파일 덮어쓰기 실패 | 내려받는 동안은 잠금이 막는다. Windows 설치기가 도는 동안은 `app.lock`이 풀려 막지 못한다(§10). M-CLI-5로 확인하고 필요하면 NSIS PREINSTALL 훅 |
| `login`이 로그인 주소를 터미널·로그에 남김 | 로그인 흐름 탈취 | 주소는 `open` seam에만, 테스트로 출력 검사(§12·§14.1) |
| `login`이 GUI 첫 로그인 부작용(자동 이어받기·업데이트 확인)을 일으킴 | 사용자가 멈춘 작업이 다시 시작 | `auth_login_wait`는 앱 crate의 `spawn_auth_tasks`를 거치지 않는다. 테스트(§14.1) |
| `retry()` 대신 `startup()`을 씀 | 스크립트 반복에서 429 → 오프라인 유예 → 최악의 경우 재사용 폐기(worker.md 24 (다)) | §14.1 갱신 횟수 테스트 |
| `paused`를 `interrupted`로 남김 | GUI가 열리자마자 사용자가 멈춘 것을 다시 받는다 | §9.2, 테스트 |
| CLI가 도는 중 GUI를 열면 반응 없음 | "앱이 고장났다" | O1 (a) 대화상자 |
