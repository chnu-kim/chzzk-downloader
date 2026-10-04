# 기술 스택 조사 (2026-10-05 기준)

Phase 1~4가 오래된 기억에 의존하지 않도록, 2026-10-05에 레지스트리 API(crates.io, npm, GitHub Releases)와 공식 문서를 직접 조회해 정리했다. 버전은 조회 시점의 최신 안정(stable) 값이다. 실제 `Cargo.toml`/`package.json`을 쓸 때는 다시 한 번 `cargo add` / `pnpm add`로 확인한다.

조사 방법과 한계:
- Context7 MCP는 OAuth 인증이 필요해 사용하지 못했다. 대신 공식 문서(WebFetch), Cloudflare 문서 검색 MCP, 레지스트리 API로 대체했다.
- 문서 본문을 요약기로 한 번 거친 항목은 "요약 기반"이라고 표시했다. 구현 직전에 원문 확인이 필요하다.
- 직접 빌드/실행해 검증한 것은 없다. 전부 문서·메타데이터 기반이다.

---

## 0. 먼저 알아야 할 변경점 (기억과 다른 것)

| 항목 | 예전 기억 | 지금(2026-10) | 근거 |
|---|---|---|---|
| Tauri | v2 | v2 안정 **2.12.1**. v3는 `3.0.0-alpha.4`가 있으나 알파다. **v2에 머문다** | https://github.com/tauri-apps/tauri/releases |
| tauri-action | `@v0` | 현재 **`@v1`** (v1.0.0, 2026-06-29). v1/불안정 v2(alpha~rc) 지원 중단 | https://github.com/tauri-apps/tauri-action/releases |
| `create-tauri-app` svelte-ts 템플릿 | 순수 Vite+Svelte | **SvelteKit + adapter-static(SPA)** 템플릿이다 | https://github.com/tauri-apps/create-tauri-app/tree/dev/templates/template-svelte-ts |
| `@cloudflare/vitest-pool-workers` | 표준 | **`@cloudflare/vitest-plugin`으로 개명**(2026-08-19). 설정 API는 `cloudflareTest()` 플러그인 | https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/ |
| Vitest | - | npm 최신은 5.0.3이지만 Workers 플러그인 peer는 **`vitest ^4.1.0`**. Worker 쪽은 vitest 4로 고정해야 한다 | npm `@cloudflare/vitest-plugin` peerDependencies |
| `shell` 플러그인으로 URL 열기 | 사용 | **`opener` 플러그인**을 쓴다 | https://v2.tauri.app/plugin/opener/ |
| reqwest | 0.12 | **0.13.x**(0.13.5) | crates.io |
| `wrangler r2 object put` | 로컬에 쓰는지 불명확 | CI에서는 **`--remote`를 명시**하고, 파일 상한이 **315 MB**다 | https://developers.cloudflare.com/r2/objects/upload-objects/ , https://developers.cloudflare.com/workers/wrangler/commands/r2/ |

---

## 1. Tauri v2

### 1.1 버전 (crates.io / npm 조회, 2026-10-05)

| 패키지 | 버전 |
|---|---|
| `tauri` (crate) | 2.12.1 (rust_version 1.90) |
| `tauri-build` | 2.7.1 |
| `@tauri-apps/cli`, `@tauri-apps/api` | 2.12.1 |
| `create-tauri-app` | 4.7.4 |
| `tauri-plugin-updater` / `@tauri-apps/plugin-updater` | 2.13.1 |
| `tauri-plugin-dialog` / `@tauri-apps/plugin-dialog` | 2.8.1 |
| `tauri-plugin-opener` / `@tauri-apps/plugin-opener` | 2.7.0 |
| `tauri-plugin-store` / `@tauri-apps/plugin-store` | 2.5.0 |
| `tauri-plugin-single-instance` (Rust 전용, JS 패키지 없음) | 2.5.2 |
| `tauri-plugin-deep-link` | 2.6.1 |
| `tauri-plugin-fs` | 2.6.0 |

Rust 최소 버전은 `tauri` 2.12.1 메타데이터상 **1.90**이다. 로컬 `cargo`는 1.96.1이라 충족한다. CI에서는 `dtolnay/rust-toolchain@stable`을 쓰면 된다.

### 1.2 프로젝트 생성 (pnpm)

공식: https://v2.tauri.app/start/create-project/ , https://github.com/tauri-apps/create-tauri-app

```bash
pnpm create tauri-app my-app --template svelte-ts
```

- 템플릿 이름은 `svelte`, `svelte-ts`다(README의 템플릿 목록).
- 비대화형 플래그가 README에 더 있는지는 확인하지 못했다. 이름만 넘겨도 나머지 질문(식별자, 매니저 등)은 프롬프트로 나올 수 있다. 스크립트화가 필요하면 `pnpm create tauri-app --help`로 확인한다.
- **주의**: `svelte-ts` 템플릿의 실제 내용(`package.json.lte`, `svelte.config.js`, `src/routes/+layout.ts`)은 **SvelteKit + `@sveltejs/adapter-static`(fallback `index.html`) + `export const ssr = false`**다. devDependencies는 `@sveltejs/kit ^2.65`, `svelte ^5.56`, `vite ^8.0`, `@sveltejs/vite-plugin-svelte ^7.1`, `typescript ~6.0.3`이다. 스크립트는 `vite dev`/`vite build`/`svelte-check`.
- SvelteKit 없이 순수 Vite+Svelte를 원하면 대안: `pnpm create vite . --template svelte-ts` 후 기존 프로젝트에 `pnpm add -D @tauri-apps/cli && pnpm tauri init`. 이 경로의 세부는 검증하지 않았다(아래 열린 질문 1).
- npm 최신 `typescript`는 7.0.2지만 템플릿은 `~6.0.3`으로 고정한다. 따라가는 게 안전하다.

### 1.3 Cargo workspace 레이아웃 (Rust 코어를 별도 crate로)

공식 문서 요약: `src-tauri/`는 최상위 디렉터리일 수도, 더 큰 Rust 워크스페이스의 일부일 수도 있다(https://v2.tauri.app/start/project-structure/ — 요약 기반). 워크스페이스 멤버로 두는 구성의 세부 설정은 공식 문서에서 확인하지 못했으므로 아래는 **권장안**이며, Phase 2 초반에 `pnpm tauri build`로 실제 확인해야 한다.

```
chzzk-downloader/
  Cargo.toml                 # [workspace] members = ["crates/core", "app/src-tauri"]  (resolver = "3")
  crates/
    core/                    # Tauri 의존 없음: api / mpd / hls / download / settings / utils
  app/                       # ROADMAP의 `app/`
    package.json             # pnpm, SvelteKit SPA
    svelte.config.js
    src/                     # 프론트엔드
    src-tauri/               # 워크스페이스 멤버. crates/core를 path 의존
      Cargo.toml
      tauri.conf.json
      build.rs
      capabilities/default.json
      icons/
      src/lib.rs  src/main.rs
  worker/                    # Cloudflare Worker (별도 pnpm 패키지)
```

- 빌드 산출물은 **워크스페이스 루트의 `target/`**으로 간다(Cargo 기본 동작). 그래서 CI의 Rust 캐시 설정은 `workspaces: ". -> target"`로 잡는다(공식 예제의 `./src-tauri -> target`은 비워크스페이스용이다).
- `tauri-action`은 `projectPath`로 Tauri 프로젝트를 가리키고, 산출물 경로는 출력 `artifactPaths`로 받는다(https://github.com/tauri-apps/tauri-action). 프런트 락파일 탐지는 v1에서 워크스페이스를 위해 상위 디렉터리까지 올라가도록 개선됐다.
- `tauri.conf.json`의 `build.frontendDist`, `build.beforeDevCommand`, `build.beforeBuildCommand`는 `app/` 기준으로 상대 경로를 맞춘다. SvelteKit adapter-static의 출력 폴더는 `build/`이므로 `frontendDist: "../build"`가 된다(템플릿이 이미 이렇게 생성해 줄 것이다. 확인 필요).
- 코어 crate는 Tauri와 무관하게 `cargo test -p chzzk-core`로 테스트되어야 한다(ROADMAP 요구). package 이름은 내장 `core` crate와 겹치지 않게 `chzzk-core`다(설계 결정 1).

### 1.4 플러그인

공통: `pnpm tauri add <name>`이 Rust 의존성 추가, `lib.rs` 등록, JS 패키지 추가, capability 반영을 한 번에 해 준다(각 플러그인 문서). 수동일 때는 아래 등록 코드를 쓴다.

#### updater (https://v2.tauri.app/plugin/updater/ — 요약 기반)

`tauri.conf.json`:

```json
{
  "bundle": { "createUpdaterArtifacts": true },
  "plugins": {
    "updater": {
      "pubkey": "<.pub 파일의 내용 (경로 아님)>",
      "endpoints": ["https://<worker-domain>/updates/{{target}}/{{arch}}/{{current_version}}"],
      "windows": { "installMode": "passive" }
    }
  }
}
```

- 엔드포인트 URL 변수: `{{current_version}}`, `{{target}}`, `{{arch}}`. 비 HTTPS는 `dangerousInsecureTransportProtocol`이 있어야 한다(로컬 `wrangler dev` 테스트에서만).
- `installMode`: `passive`(기본), `basicUi`, `quiet`.
- 서명은 필수이며 끌 수 없다. 키 생성: `pnpm tauri signer generate -w ~/.tauri/chzzk-downloader.key`. 빌드 시 환경 변수 **`TAURI_SIGNING_PRIVATE_KEY`**(경로 또는 내용), **`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`**를 설정한다. `.env` 파일은 먹지 않는다. CI에서는 GitHub Secrets로 주입.
- 생성물: 플랫폼별 번들과 `.sig` 파일(AppImage `.AppImage.sig`, macOS `.app.tar.gz.sig`, Windows `-setup.exe.sig` / `.msi.sig`). v2에서 `createUpdaterArtifacts: true`면 번들 자체를 업데이트 아티팩트로 쓴다(v1의 `.zip`/`.tar.gz` 래핑은 `"v1Compatible"`).
- **정적 JSON(`latest.json`) 형식** (필수 키: `version`, `platforms.<target>.url`, `platforms.<target>.signature`):

```json
{
  "version": "1.0.0",
  "notes": "업데이트 노트",
  "pub_date": "2026-10-05T00:00:00Z",
  "platforms": {
    "linux-x86_64":   { "signature": "<.sig 파일 내용>", "url": "https://..." },
    "windows-x86_64": { "signature": "...", "url": "https://..." },
    "darwin-aarch64": { "signature": "...", "url": "https://..." },
    "darwin-x86_64":  { "signature": "...", "url": "https://..." }
  }
}
```

  `signature`는 `.sig` 파일의 **내용**이어야 하며 경로/URL은 안 된다. 플랫폼 키 탐색은 `{os}-{arch}-{bundle}`(예: `windows-x86_64-nsis`)을 먼저, 없으면 `{os}-{arch}`로 폴백한다(UpdaterBuilder 소스 요약).
- **동적 서버 응답**: 업데이트가 있으면 200 + `{ version, pub_date, url, signature, notes }`, 없으면 **204 No Content**. 우리는 Worker가 `{{target}}/{{arch}}/{{current_version}}`를 받아 직접 비교하므로 이 방식이 `latest.json` 정적 방식보다 맞다. 인증 실패는 401/403.
- **요청별 헤더(인증)**: JS `check({ timeout: 30000, headers: { Authorization: 'Bearer <token>' } })`. Rust 쪽은 `app.updater_builder().header(key, value)`가 있고 "업데이트 확인 **및 다운로드** 요청"에 모두 붙는다(UpdaterBuilder: `header`, `headers`, `timeout`, `endpoints`, `proxy`, `target`, `version_comparator`, `installer_args`, `on_before_exit`). 따라서 R2 게이트 Worker가 다운로드 URL에서도 같은 Bearer를 검사하면 된다. (Rust/JS 두 경로의 정확한 시그니처는 구현 시 docs.rs로 재확인.)
- 다운로드 진행률: `update.downloadAndInstall((event) => ...)`에서 `Progress` 이벤트의 `chunkLength`.
- capability: `updater:default` 또는 세분화 `updater:allow-check`, `updater:allow-download`, `updater:allow-install`, `updater:allow-download-and-install`.
- macOS 유니버설 빌드를 쓰면 업데이터 타깃이 `macos-universal`이어야 한다는 문서 구절이 있다. 우리는 **aarch64 + x86_64 분리 빌드**를 권장하므로(아래 3절) 해당 없음.

#### dialog (https://v2.tauri.app/plugin/dialog/ — 요약 기반)

- Rust: `.plugin(tauri_plugin_dialog::init())`, JS: `import { open } from '@tauri-apps/plugin-dialog'`; 폴더 선택은 `open({ directory: true })` (옵션 이름 `directory`는 일반 지식이며 요약본에 코드 스니펫이 없었다. 구현 시 타입 정의로 확인).
- 기본 권한 `dialog:default`에 `allow-open`, `allow-save`, `allow-message` 포함. 폴더 선택은 데스크톱 지원(모바일은 불가).
- 주의: 선택한 폴더에 코어가 쓰려면 Rust 쪽에서 직접 `std::fs`로 쓰므로 `fs` 플러그인 스코프는 필요 없다(코어는 Tauri 플러그인을 거치지 않는다).

#### opener (로그인용 브라우저 열기) (https://v2.tauri.app/plugin/opener/)

```ts
import { openUrl } from '@tauri-apps/plugin-opener';
await openUrl('https://<worker-domain>/auth/start?...');
```

- Rust: `.plugin(tauri_plugin_opener::init())`.
- 기본 권한 세트의 `allow-default-urls`가 `http://`, `https://`, `mailto:`, `tel:`을 허용한다. 범위를 좁히려면 capability에서 `opener:allow-open-url`에 `allow: [{ "url": "https://<worker-domain>/*" }]`.
- 로그인 플로우가 "Worker가 일회용 id를 발급 → 앱이 폴링"이므로 **deep-link는 불필요**하다(ROADMAP Phase 3). deep-link는 데스크톱에서 커스텀 스킴만 문서화돼 있고 `http://localhost` 루프백은 다루지 않으며, Windows/Linux는 설치된 앱에서만 동작, macOS는 런타임 등록이 불가하고 번들된 앱에서만 테스트된다(https://v2.tauri.app/plugin/deep-linking/ — 요약 기반). 미서명 배포와도 궁합이 나쁘다.

#### 설정 저장: store vs 직접 구현

- `tauri-plugin-store` 2.5.0: JS에서 `load('store.json', { autoSave: false })` → `set/get/save`, `LazyStore`, 자동 저장 디바운스 100ms. Rust에서는 `app.store("store.json")?` (https://v2.tauri.app/plugin/store/ — 요약 기반). 권한 `store:default`.
- **권장**: 설정(`UserSettings`, 최근 VOD, 쿠키)은 **코어 crate의 `settings` 모듈이 serde JSON으로 직접 읽고 쓴다**. 이유는 (1) 코어를 Tauri 없이 테스트하고 Go의 `settings.json` 스키마·`UpdateUserSettings(func)` 패턴을 그대로 이식하기 위해서, (2) 앱 설정 디렉터리는 `app.path().app_config_dir()`를 셸이 코어에 주입하면 되기 때문이다. UI 전용 가벼운 값(창 크기 등)만 store를 써도 되지만 처음에는 불필요.
- `fs` 플러그인(2.6.0)은 프론트엔드가 파일을 직접 만질 때만 필요하다. 지금 설계에서는 불필요.

#### single-instance (https://v2.tauri.app/plugin/single-instance/ — 요약 기반)

- Rust 전용. **반드시 첫 번째로 등록**해야 한다.
- 의존성: `cargo add tauri-plugin-single-instance --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'`.

```rust
#[cfg(desktop)]
app.handle().plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    let _ = app.get_webview_window("main").map(|w| w.set_focus());
}));
```

  (문서의 `.setup()` 안 등록 예제에 포커스 예제를 합친 형태. 문서의 Builder 체인 `.plugin(...)` 예도 있다.)
- 필요한가: 같은 VOD를 두 인스턴스가 동시에 받고 `settings.json`을 서로 덮어쓰는 문제를 막으므로 **넣는 것을 권장**한다. Linux는 DBus를 쓰며 Snap/Flatpak은 별도 권한이 필요하지만 우리는 AppImage/deb 위주라 영향 없다.

#### Capabilities / permissions 파일 형식 (https://v2.tauri.app/security/capabilities/ — 요약 기반)

- 위치: `src-tauri/capabilities/*.json` (또는 `.toml`). 이 폴더의 모든 파일이 **기본 활성화**된다. `identifier`는 파일명과 맞춘다.
- 필드: 필수 `identifier`, `windows`(창 라벨 배열, `["*"]` 가능), `permissions`. 선택 `platforms`(`linux`/`macOS`/`windows`/`iOS`/`android`), `remote`(`{"urls": [...]}`), `description`, `$schema`(`../gen/schemas/desktop-schema.json`).
- 권한 이름: 플러그인은 `<plugin>:<action>`(`dialog:default`, `updater:default`), 코어는 `core:<category>:<action>`(`core:window:allow-set-title`).

예시(우리 앱 초안, 구현 시 검증 필요):

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:default",
    "opener:default",
    "updater:default"
  ]
}
```

  `#[tauri::command]`로 만든 앱 자체 커맨드는 기본적으로 모든 창에서 호출 가능하다(앱 커맨드 권한을 따로 제한하려면 `build.rs`의 `AppManifest`로 정의). 이 부분은 문서를 직접 확인하지 못했다.

### 1.5 Rust → Svelte 진행률 전달: Channel vs emit

공식 (https://v2.tauri.app/develop/calling-frontend/ — 요약 기반):
- **이벤트(`emit`/`listen`)**: 소량 데이터, 다중 소비자/생산자 패턴용. 타입 지원이 약하고 페이로드는 항상 JSON 문자열이며, 이벤트 시스템이 JS를 직접 평가(eval)하므로 큰 데이터·고빈도에 부적합하다.
- **Channel**: "빠르고 **순서가 보장되는** 데이터"용. 다운로드 진행률, 서브프로세스 출력, WebSocket 메시지가 공식 사용 사례로 명시된다.

**권장: 다운로드 진행률은 Channel.** 한 번의 `invoke` 호출에 Channel을 인자로 넘기고, 다운로드 태스크가 그 Channel로 보낸다.

```rust
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum DownloadEvent {
    Started { total_bytes: Option<u64> },
    Progress { downloaded: u64, total: Option<u64>, speed_bps: u64 },
    Finished { path: String },
    Failed { message: String },
}

#[tauri::command]
async fn download(url: String, on_event: tauri::ipc::Channel<DownloadEvent>) -> Result<(), String> {
    on_event.send(DownloadEvent::Started { total_bytes: None }).map_err(|e| e.to_string())?;
    // ...
    Ok(())
}
```

```ts
import { invoke, Channel } from '@tauri-apps/api/core';
const onEvent = new Channel<DownloadEvent>();
onEvent.onmessage = (m) => { /* 상태 갱신 */ };
await invoke('download', { url, onEvent });
```

운영 팁(공식 문서 밖의 설계 판단):
- 코어 crate는 Tauri를 모르므로 `trait ProgressSink` 같은 콜백/`tokio::sync::mpsc`로 진행 상황을 내보내고, 셸이 이를 Channel로 브리지한다. 이렇게 하면 코어 테스트에서 Channel 없이 검증된다.
- 세그먼트 단위로 이벤트를 쏘지 말고 **100~250ms 간격으로 스로틀**한다(UI 렌더링 비용 절감).
- 취소는 `tokio_util::sync::CancellationToken`(또는 `AbortHandle`)을 `State`에 보관하고 별도 `cancel_download` 커맨드로 처리한다.
- 앱 전역 알림(업데이트 가능, 로그인 상태 변경 등) 같은 저빈도 이벤트는 `emit`이 적합하다.

---

## 2. Rust 코어 crate

crates.io 조회(2026-10-05):

| crate | 버전 | 메모 |
|---|---|---|
| `reqwest` | **0.13.5** (2026-09-08) | 기능 플래그에 `rustls`, `stream`, `json`, `gzip`, `brotli`, `deflate`, `zstd`, `cookies`, `http2`가 있다. 0.13에서 TLS 기본이 rustls 계열로 바뀌었는지는 확인하지 못했다. `default-features = false, features = ["rustls", "stream", "json"]`처럼 **명시 지정**을 권장. **`gzip`은 넣지 않는다**: 자동 압축 해제는 `Content-Length`와 Range offset을 깨뜨린다(설계 결정 7) |
| `tokio` | 1.53.2 (2026-10-03) | `features = ["rt-multi-thread", "macros", "fs", "io-util", "sync", "time"]` |
| `quick-xml` | 0.42.0 | 기능: `serialize`(serde), `async-tokio`, `encoding` |
| `roxmltree` | 0.21.1 (2025-10-12) | 읽기 전용 DOM, 의존성 없음 |
| `m3u8-rs` | 6.0.1 (2026-07-30) | nom 기반 파서(기본 기능 `parser`) |
| `hls_m3u8` | 0.7.0 (2026-05-06) | 대안 |
| `serde` | 1.0.229 | `derive` |
| `futures-util` | 0.3.34 | `StreamExt`로 `bytes_stream()` 소비 |
| `bytes` | 1.12.1 | |
| `thiserror` | 2.0.21 | 코어 에러 타입 |
| `tracing` | 0.1.44 | 로그 |

선택 권고:
- **MPD(DASH) 파싱: `roxmltree` 우선.** Go 코드가 MPD의 Representation(품질)만 뽑는 수준이고, 입력은 작은 XML 한 개다. DOM 순회(`descendants()`, `attribute()`)가 가장 단순하고 테스트 fixture 비교가 쉽다. `quick-xml`의 serde 매핑은 MPD처럼 네임스페이스·선택 요소가 많은 스키마에서 구조체가 지저분해지기 쉽다. 성능은 무관.
- **HLS: `m3u8-rs`로 시작하되, 라이브 리와인드 실물 플레이리스트 확보(Phase 1 사전 조사) 결과를 보고 결정.** 알아야 할 점은 `EXT-X-MAP`(fMP4), `EXT-X-KEY`, 서명 쿼리가 붙은 세그먼트 URI다. `m3u8-rs`가 이 태그들을 구조체로 노출하지만, 치지직 전용 확장 태그가 있으면 손 파싱이 낫다. 우리가 필요한 것은 사실상 "미디어 플레이리스트의 세그먼트 URI 목록 + MAP + KEY" 정도라서 **줄 단위 직접 파싱도 합리적**이다(50~100줄). 판단은 실물 확보 이후.
- HTTP 다운로드: `reqwest::Client`를 앱 수명 동안 하나로 공유, 세그먼트는 `bytes_stream()`으로 디스크에 스트리밍 기록, 동시성은 `tokio::sync::Semaphore` 또는 `futures::stream::buffered(n)`로 제한(순서 보장이 필요하니 `buffered`가 `buffer_unordered`보다 적합). 재시도와 이어받기(`Range`)는 코어에서 구현.

### TS → MP4 리먹스 crate (ffmpeg 없이)

ROADMAP 결정은 "ffmpeg 제거, 세그먼트를 직접 받아 이어 붙임, 필요하면 선택적 remux는 나중에"이다. 조사 결과:

| crate | 상태 | 비고 |
|---|---|---|
| `ts-to-mp4` 0.1.0 | 2026-01-14, 다운로드 112, 저장소 별 1 | **라이선스 AGPL-3.0**. 비공개 배포라도 라이선스 부담이 커 **제외 권장** |
| `hls-transmux` 0.5.0 | 2026-10-04 갱신, 다운로드 423, MIT | HLS 플레이리스트(HTTP)를 받아 TS/fMP4 세그먼트를 단일 MP4로 변환. 신생이고 사용자가 적다. 평가 가치는 있으나 의존 전에 샘플 VOD로 검증 필요 |
| `mpeg2ts-reader` 0.18.2 | 안정적, 다운로드 11만 | TS 파서만. 먹서(muxer)는 따로 필요 |
| `mp4` 0.14.0 | 2023-08 이후 정체 | 대중적이나 갱신 없음 |
| `mp4-atom` 0.16.1, `shiguredo_mp4` 2026.5.0, `muxide` 0.2.5 | 활발 | MP4 박스 읽기/쓰기·먹싱 재료 |

결론: **지금은 리먹스 crate에 의존하지 않는다.** 이유는 (1) 라이브 리와인드 세그먼트가 이미 fMP4(`EXT-X-MAP`)라면 단순 연결(init + 세그먼트)로 재생 가능한 fMP4가 되고, (2) DASH VOD도 Go 코드가 이미 순수 HTTP로 처리해 왔으며(커밋 fa21e56), (3) TS 세그먼트라면 `.ts`로 이어 붙여 저장하는 것만으로 대부분의 플레이어가 재생한다. 선택적 "MP4로 변환"이 필요해지면 후보 1순위는 `hls-transmux`(MIT)이며 `ts-to-mp4`(AGPL)는 피한다. 이 판단은 Phase 1의 실물 플레이리스트 조사 결과에 의존한다.

---

## 3. GitHub Actions

### 3.1 액션 버전 (GitHub Releases 조회, 2026-10-05)

| 액션 | 최신 |
|---|---|
| `tauri-apps/tauri-action` | **v1** (v1.0.0, 2026-06-29) |
| `actions/checkout` | v7 (v7.0.1) |
| `actions/setup-node` | v7 (v7.0.0). Tauri 공식 예제는 v6을 쓰고 있어 문서가 뒤처짐 |
| `pnpm/action-setup` | v6 (v6.1.0) |
| `Swatinem/rust-cache` | v2 (v2.9.2) |
| `dtolnay/rust-toolchain` | `@stable` 브랜치 참조 (태그 v1은 2022년) |
| `cloudflare/wrangler-action` | v4 (v4.1.3, 2026-09-24). Hono 문서 예시는 v3로 뒤처짐 |

tauri-action v1 변경(CHANGELOG): Tauri v1 및 불안정 v2 지원 중단, `.app.tar.gz(.sig)` 파일명에 버전 포함, `latest.json`의 URL이 GitHub API URL 기반, `includeRelease`/`includeDebug` 제거. (https://github.com/tauri-apps/tauri-action/releases)

### 3.2 매트릭스와 의존성

공식 예제(https://v2.tauri.app/distribute/pipelines/github/ , https://github.com/tauri-apps/tauri-action/blob/dev/examples/test-build-only.yml):

- macOS: `macos-latest`(Apple Silicon)에서 `--target aarch64-apple-darwin`과 `--target x86_64-apple-darwin`을 **별도 매트릭스 행**으로 빌드(두 타깃을 `dtolnay/rust-toolchain`의 `targets`로 설치). 유니버설(`--target universal-apple-darwin`)은 선택이지만 업데이터 타깃 키가 달라지므로 분리 빌드가 단순하다.
- Linux: `ubuntu-22.04`(공식 예제 기준). arm64 러너 `ubuntu-22.04-arm`도 최신 예제에 포함됐으나 우리는 불필요.
- Windows: `windows-latest`. MSVC와 WebView2는 러너에 있다.
- Ubuntu apt 의존성(CI 예제): `libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils`. 공식 prerequisites 문서(개발 환경)는 `libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev`로 약간 다르다. **기준은 두 목록의 합집합**으로 시작해 빌드가 통과하는 최소로 줄인다(`libappindicator3-dev` vs `libayatana-appindicator3-dev` 차이는 트레이 기능을 쓰지 않으면 무관할 수 있으나 미검증).

### 3.3 워크플로 초안 (private repo, GitHub Release 없이 R2 업로드)

핵심 사실: `tagName`, `releaseName`, `releaseId`를 **모두 생략하면 tauri-action은 빌드만 하고 업로드하지 않는다**(README, test-build-only 예제 주석). 출력 `artifactPaths`로 산출물 경로를 받는다. 따라서 공개 Release를 만들지 않고도 같은 액션으로 서명된 번들과 `.sig`를 만들 수 있다. 다만 **이 모드에서 `latest.json`이 만들어지는지는 문서에 없다**(`uploadUpdaterJson`은 릴리스 업로드의 일부). 우리는 어차피 동적 엔드포인트(Worker가 `{{target}}/{{arch}}/{{version}}`로 응답)를 쓰므로 `latest.json`이 필요 없고, 대신 **빌드 후 `.sig` 내용과 R2 객체 키를 담은 per-platform 메타데이터 JSON을 CI가 직접 생성해 R2에 올리는 방식**을 권장한다.

```yaml
name: release
on:
  push:
    tags: ['v*']

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { platform: macos-latest,   args: '--target aarch64-apple-darwin' }
          - { platform: macos-latest,   args: '--target x86_64-apple-darwin' }
          - { platform: ubuntu-22.04,   args: '' }
          - { platform: windows-latest, args: '' }
    runs-on: ${{ matrix.platform }}
    steps:
      - uses: actions/checkout@v7
      - name: install apt deps (linux)
        if: startsWith(matrix.platform, 'ubuntu')
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf xdg-utils
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version: lts/*, cache: pnpm }
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ startsWith(matrix.platform, 'macos') && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: '. -> target'
      - run: pnpm install --frozen-lockfile
        working-directory: app
      - id: tauri
        uses: tauri-apps/tauri-action@v1
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          projectPath: app
          args: ${{ matrix.args }}
      # artifactPaths(JSON 배열)에서 설치 파일과 .sig를 골라
      # actions/upload-artifact로 올린다. 이후 별도 job이 모아서 R2로 업로드.
```

R2 업로드 단계:
- 방법 A: `pnpm wrangler r2 object put <bucket>/<key> --file <path> --remote` — **상한 315 MB, 한 번에 객체 1개**(https://developers.cloudflare.com/r2/objects/upload-objects/). Tauri 번들은 대개 수십~100MB대라 가능하지만 여유가 크지 않다. 인증은 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` 환경 변수(R2 권한이 있는 토큰).
- 방법 B: R2 S3 호환 API + `rclone`/`aws s3 cp`(멀티파트로 큰 파일 가능). 별도 R2 API 토큰(Access Key)이 필요. 315 MB를 넘기면 이쪽.
- 업로드 순서: 모든 플랫폼 번들과 `.sig`를 올린 뒤 **마지막에** 버전 메타데이터(예: `releases/latest.json` 또는 KV의 "latest version" 키)를 갱신해 부분 릴리스 노출을 막는다.

PR용 빌드 검증은 같은 매트릭스에서 업로드·서명 없이 `tauri-action`만 돌린다. 서명 키가 없는 PR(포크 아님, private repo이므로 큰 문제 없음)에서 `createUpdaterArtifacts: true`는 키가 없으면 빌드 실패하므로, PR 빌드는 `--config`로 오버라이드하거나 더미 키를 쓰는 방법을 구현 시 확인해야 한다(미검증).

미서명 배포 주의: macOS는 미서명/미공증 앱이 Gatekeeper에 막히고, Windows는 SmartScreen 경고가 뜬다(ROADMAP 결정대로 랜딩 페이지에서 안내). Tauri updater 서명(minisign)은 코드 서명과 별개이며 필수다.

---

## 4. Cloudflare Workers

### 4.1 버전·권장 구성

| 항목 | 값 |
|---|---|
| `wrangler` | **4.147.0** (v4 계열; v4는 2025-03-13에 출시, v3는 2026 Q1까지 버그 수정). Node **>= 22** 필요 |
| `hono` | 4.13.13 |
| `@cloudflare/vitest-plugin` | **1.3.6** (구 `@cloudflare/vitest-pool-workers`) |
| `vitest` | **^4.1.0 으로 고정** (플러그인 peer. npm 최신 5.0.3은 쓰지 않는다) |
| `compatibility_date` | 작성 시점의 오늘 날짜(예: `2026-10-05`) + `compatibility_flags: ["nodejs_compat"]` (Cloudflare 모범 사례 문서 권고) |

출처: https://developers.cloudflare.com/changelog/post/2025-03-13-wrangler-v4/ , https://developers.cloudflare.com/changelog/post/2026-02-15-workers-best-practices/

모범 사례 요약(위 changelog): 바인딩 타입은 `wrangler types`로 생성(손으로 `Env`를 쓰지 않는다), 큰 본문은 **스트리밍**(버퍼링 금지, 메모리 128MB 제한), 바인딩 우선(REST API 대신), Workers Logs 활성화, 전역 가변 상태 금지, 보안 토큰은 Web Crypto 사용.

### 4.2 R2 비공개 객체를 Worker로 스트리밍 (인증 후)

공식 패턴(https://developers.cloudflare.com/r2/api/workers/workers-api-usage/): `env.BUCKET.get(key, { onlyIf: request.headers, range: request.headers })`로 조건부·Range 요청을 그대로 지원하고, `object.writeHttpMetadata(headers)` + `etag`를 헤더에 싣고 `new Response(object.body, { headers })`로 **본문 스트림을 그대로 반환**한다. 사전 조건이 실패하면 `get()`이 `body` 없는 `R2Object`를 반환하므로 그 경우 304/412 처리가 필요하다(해당 문서의 예제가 이를 다룬다. 정확한 상태코드 분기는 구현 시 해당 문서를 따른다).

```ts
// Hono 사용 예 (초안)
app.get('/dl/:key{.+}', requireSession, async (c) => {
  const key = c.req.param('key');
  const obj = await c.env.RELEASES.get(key, { onlyIf: c.req.raw.headers, range: c.req.raw.headers });
  if (!obj) return c.notFound();
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('etag', obj.httpEtag);
  headers.set('cache-control', 'private, no-store'); // 인증 뒤 콘텐츠는 공유 캐시 금지
  return new Response('body' in obj ? obj.body : null, {
    status: 'body' in obj ? (c.req.header('range') ? 206 : 200) : 304,
    headers,
  });
});
```

- 인증 검사(세션 토큰 → 허용목록 확인)는 라우트 앞 미들웨어에서 한다. Tauri updater는 `Authorization: Bearer`를 헤더로 보내므로 같은 미들웨어가 쿠키(랜딩 페이지 브라우저)와 Bearer(앱) 둘 다 받게 한다.
- 대안으로 S3 presigned URL이 있으나 **R2 커스텀 도메인과는 쓸 수 없고** 베어러 토큰처럼 취급해야 한다(https://developers.cloudflare.com/r2/api/s3/presigned-urls/). Worker 바인딩 경유가 인증 일원화에 낫다.
- 위 상태코드/206 분기는 설명용 초안이다. 실제로는 `obj.range`가 있는지로 206 여부를 판단해야 정확하다.

### 4.3 KV vs D1 (허용목록 + 세션)

저장소 선택 근거(https://developers.cloudflare.com/workers/platform/storage-options/ , https://developers.cloudflare.com/kv/api/write-key-value-pairs/):
- KV는 최종 일관성이다. 쓰기는 같은 지역에서는 즉시 보이지만 **다른 지역에는 최대 60초**(또는 `cacheTtl`; 최소 30초로 인하됨, 2026-01-30) 걸릴 수 있다. 같은 키에 초당 1회를 넘는 쓰기는 429. TTL(만료) 지원, 읽기 많은 설정·세션 저장에 적합하다고 문서가 명시.
- D1은 SQLite 기반 관계형, 읽기 복제 지원.
- 무료 요금제 KV: 읽기 10만/일, 쓰기 1,000/일(https://developers.cloudflare.com/workers/platform/pricing/). 규모가 본인+지인이라 충분.

**권장**:
- **허용목록(채널 ID 몇 개)**: KV 하나의 키(`allowlist` JSON 배열) 또는 채널당 키. 변경은 사람이 가끔 `wrangler kv key put`으로 한다. 전파 지연 60초는 허용 가능하다. (또는 Worker 시크릿/환경 변수 `ALLOWED_CHANNEL_IDS`로 시작해 재배포로 갱신하는 방법도 가장 단순하다.)
- **세션 토큰**: KV + `expirationTtl`. 만료가 자동이라 편하다. 다만 **로그인 플로우의 일회용 id 폴링(앱이 id로 결과를 가져가는 단계)은 쓰기 직후 다른 지역에서 읽을 수 있어야 하는데 KV는 보장하지 않는다.** 앱의 폴링 요청과 OAuth 콜백이 같은 지역 PoP에 닿는 경우가 많지만 보장은 없다. 일회용 id(소비형)는 **Durable Object**(강한 일관성, SQLite 내장) 또는 D1이 더 안전하다. 사용자 수가 극소수이므로 DO 하나(싱글턴 "login-broker")로 일회용 id 발급·소비를 직렬화하는 구성이 깔끔하다. 이 항목은 Phase 3 사전 확인에서 결정한다(열린 질문 3).
- D1을 쓰면 스키마·마이그레이션 관리가 늘어난다. 이 규모에서 D1의 이점은 크지 않다.

### 4.4 정적 자산(랜딩 페이지)과 Worker의 결합

(https://developers.cloudflare.com/workers/static-assets/ , https://developers.cloudflare.com/workers/static-assets/binding/)

- `wrangler.jsonc`의 `assets: { "directory": "./public", "binding": "ASSETS" }`. 기본 동작은 요청이 정적 파일과 일치하면 **Worker를 호출하지 않고** 파일을 제공하고, 일치하지 않으면 Worker가 처리한다. Worker에서 `env.ASSETS.fetch(request)`로 정적 자산에 위임할 수도 있다.
- **인증 뒤에 둬야 하는 경로**는 `run_worker_first`로 지정한다. `true`(전체) 또는 패턴 배열(`["/api/*", "/auth/*", "/dl/*", "/updates/*", "!/assets/*"]`, 최대 100개, `!`로 예외). 랜딩 HTML 자체(로그인 버튼 페이지)는 공개해도 되므로 정적 서빙, 다운로드 링크/업데이트는 Worker 경유로 나눈다. 로그인 후 "허용된 사람에게만 OS별 다운로드 링크를 보여 주는" 페이지는 서버 쪽에서 판단해야 하므로 `/`는 Worker가 먼저 받아 `env.ASSETS.fetch`로 정적 shell을 내려주고 클라이언트가 `/api/me`를 호출하는 식으로 단순화할 수 있다.
- SPA가 아니라 단일 정적 페이지이므로 `not_found_handling`은 기본값(또는 `404-page`)으로 두고 SPA 모드(`single-page-application`)는 쓰지 않는다.
- 배포는 Pages가 아니라 **Workers + static assets**를 쓴다(한 개의 Worker로 API, R2 게이트, 랜딩을 모두 처리).

### 4.5 Hono vs 순수 fetch 핸들러

권장: **Hono**. 이유는 라우트가 10개 안팎이고(`/auth/start`, `/auth/callback`, `/auth/poll`, `/api/me`, `/dl/*`, `/updates/*`, 관리용), 쿠키/Bearer 인증 미들웨어와 `Hono<{ Bindings }>` 타입 바인딩이 실익이 있으며, 테스트에서 `app.request()`로 Worker 런타임 없이도 라우팅 단위 테스트가 가능하다(https://hono.dev/docs/getting-started/cloudflare-workers). 의존성 한 개 추가 비용은 작다. 순수 `fetch` 핸들러도 가능하나 경로 분기·미들웨어 코드를 직접 쓰게 된다.

참고: Hono 문서의 테스트·CI 예시는 구버전 패키지명(`@cloudflare/vitest-pool-workers`, `wrangler-action@v3`)을 아직 쓰고 있다.

### 4.6 테스트: @cloudflare/vitest-plugin

(https://developers.cloudflare.com/workers/testing/vitest-integration/ , https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/ , https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/)

```ts
// vitest.config.ts
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
```

```bash
pnpm add -D vitest@^4.1.0 @cloudflare/vitest-plugin
```

- 테스트는 Miniflare 위에서 workerd 안에 실행되고, KV/R2/DO 바인딩을 로컬 스토리지로 격리해 쓴다(테스트 파일별 격리).
- 옛 이름 `@cloudflare/vitest-pool-workers`와 `defineWorkersConfig`/`defineWorkersProject`는 제거 대상이다. 인터넷 예제를 복붙할 때 주의. 마이그레이션: `npx @cloudflare/codemods vitest:pool-workers-to-vitest-plugin`.
- 플러그인은 `nodejs_compat` 플래그를 테스트에서만 자동으로 켠다. 운영 `wrangler.jsonc`에도 같은 플래그가 있어야 테스트와 실제 동작이 어긋나지 않는다.
- 외부 요청 목킹(치지직 OAuth 호출)은 `@msw/cloudflare` 통합이 공식 안내된다(https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/).
- 디버깅: `vitest --inspect --no-file-parallelism`.

---

## 5. 후속 Phase에 주는 시사점 (요약)

1. Tauri는 **v2.12.x**에 고정하고 v3 알파는 건드리지 않는다.
2. 프런트엔드는 템플릿 기본이 **SvelteKit SPA**다. 단순함을 우선하면 순수 Vite+Svelte로 직접 구성할 수 있으나, 템플릿을 그대로 쓰는 편이 업데이트 추적과 문서 정합성이 좋다.
3. 진행률은 **Channel**, 저빈도 알림만 `emit`. 코어는 Tauri 비의존 콜백으로 진행 상황을 내보낸다.
4. 설정은 코어의 serde JSON 모듈로 직접 처리하고 store 플러그인은 쓰지 않는다. 필요한 플러그인은 `updater`, `dialog`, `opener`, `single-instance`뿐이다(`deep-link`, `fs`, `store`는 불필요).
5. 업데이트는 **동적 엔드포인트**(Worker가 204/200 응답) + 요청 헤더 Bearer 인증. `latest.json`을 R2에 두는 방식은 쓰지 않아도 된다.
6. CI는 `tauri-action@v1`을 **릴리스 입력 없이** 빌드 전용으로 쓰고, 산출물을 모아 R2로 올린다. 서명 키 환경 변수는 `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`.
7. Worker는 **Hono + wrangler 4 + KV(허용목록·세션) + R2 바인딩 스트리밍 + static assets(`run_worker_first` 패턴)**. 일회용 로그인 id만은 일관성 때문에 DO 또는 D1을 검토.
8. Worker 테스트는 `vitest@^4.1` + `@cloudflare/vitest-plugin`.
9. 리먹스 crate는 현재 도입하지 않는다. 필요 시 `hls-transmux`(MIT)를 평가하고 `ts-to-mp4`(AGPL)는 피한다.

## 6. 열린 질문 / 미검증 항목

1. **프런트 프레임워크 형태**: 템플릿 그대로 SvelteKit SPA로 갈지, 순수 Vite+Svelte로 갈지. (현재 권고: 템플릿 그대로.)
2. **Cargo 워크스페이스 + `src-tauri`가 `app/` 아래 멤버**인 구성의 빌드·`tauri-action` 동작은 공식 문서에서 직접 확인하지 못했다. Phase 2 첫 PR에서 로컬 `pnpm tauri build`와 CI 빌드로 검증한다. (`build.rs`의 `tauri_build`, `tauri.conf.json` 경로, 산출물 위치.)
3. **로그인 일회용 id 저장소**: KV의 최종 일관성 때문에 DO/D1 필요 여부. Phase 3 사전 확인에서 결정.
4. **`tauri-action`이 릴리스 입력 없이 도는 모드에서 `.sig`와 `artifactPaths`에 무엇이 들어오는지**(특히 Windows의 NSIS 번들, macOS `.app.tar.gz`) 실측이 필요하다.
5. **PR 빌드에서 `createUpdaterArtifacts: true`와 서명 키 없음** 조합의 동작.
6. **Linux 배포 형식**: AppImage vs deb. 업데이터는 AppImage 번들을 대상으로 한다. 사용자가 AppImage 사용 가능한 환경인지 확인.
7. reqwest 0.13의 기본 TLS 백엔드와 최소 `features` 조합은 `cargo add` 후 `cargo tree`로 확인.
8. dialog 폴더 선택 옵션 이름, Rust `updater_builder().header()` 시그니처, 앱 자체 커맨드의 capability 요구 여부는 구현 시 docs.rs / 타입 정의로 재확인.
9. Context7 MCP가 인증 대기 상태였다. 사용자가 원하면 인증 후 주요 라이브러리 문서를 다시 대조할 수 있다.
