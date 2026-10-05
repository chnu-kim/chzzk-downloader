# CI/CD 설계 (브랜치 `ci/pipeline`, 2026-10-05)

공개 저장소 `chnu-kim/chzzk-downloader`의 CI·CD·로컬 훅·닫힌 고리 설계다. 두 초안(assurance / pragmatic)과 조사 보고서를 비교하고 저장소에서 사실을 직접 확인해 하나로 합쳤다. 원칙은 셋이다.

1. **판정은 결정적이다.** 종료 코드, 골든 파일, 해시, JSON 스키마, 실제 빌드·실행만으로 판정한다. AI 추론, 사람 판단, 시간에 따라 흔들리는 검사는 PR 필수 체크에 넣지 않는다.
2. **CI가 최종 권위다.** 훅은 빠른 첫 관문이고 `--no-verify`로 우회된다. 훅과 CI는 **같은 진입점**(`scripts/ci/run.mjs <gate>`)을 부르므로 결과가 갈릴 수 없다.
3. **혼자 운영할 수 있어야 한다.** 무시하게 되는 검사(보고만 하는 검사, 가짜 실패가 잦은 검사)는 처음부터 넣지 않거나 ratchet으로 바꾼다.

항목 끝의 **[확인 필요]**는 구현할 때 실측해야 하는 사실이다. 그 밖의 사실은 2026-10-05에 저장소·API·문서에서 확인했다.

---

## 0. 확인한 사실과 그에 따른 결정

| 확인한 사실 | 결정 |
|---|---|
| `git rev-list --max-parents=0`이 origin/master와 `--remotes=private` 모두 **같은 루트 `c92f94b`**를 낸다. `merge-base origin/master private/master`는 `7f3db03`이고, private에만 있는 커밋은 133개다. | pragmatic 안의 "루트가 다르다" 규칙은 **성립하지 않는다**. pre-push 가드는 **집합 차(N ∩ P)** 규칙을 주 규칙으로 쓴다(§3). |
| `public-scan.mjs`는 `--all-history`·`--staged`·`--denylist`·`--hash`·`--hash-file`만 안다. `--all-history`는 `rev-list --all`이라 로컬(`refs/remotes/private/*` 존재)에서 돌리면 반드시 실패한다. | 새 모드 **`--rev-range <a>..<b>`**(blob·경로·메시지·작성자)와 **`--message-file <f>`**를 더한다. `--all-history`는 CI의 새 클론에서만 돈다. |
| `.githooks/pre-commit`(`--staged` 한 줄 shim)과 `core.hooksPath` 안내가 이미 있다. 루트에 `package.json`이 없다. lefthook은 `use_stdin`과 `{1}` 자리표를 지원하지만 버전을 고정할 자리가 없고 `core.hooksPath`와 겹친다. | **lefthook을 쓰지 않는다.** `.githooks/{pre-commit,commit-msg,pre-push}` 셸 shim이 `node scripts/ci/run.mjs hook <name> "$@"`를 `exec`한다. "lefthook 또는 동등한 것" 요구를 만족하고 stdin·인자가 그대로 전달된다. |
| 버전 원천이 다섯 곳이다(세 crate의 `version = "0.1.0"`, `tauri.conf.json`, `app/package.json`). `[workspace.package]`에 `version`이 없다. | `[workspace.package] version` + `version.workspace = true`로 셋으로 줄인다. `version-check`는 그래도 `cargo metadata --no-deps`의 모든 멤버를 본다. |
| origin에는 태그가 **없다**(private에는 `v0.2.0`, `v0.2.1`). | 첫 Tauri 릴리스 버전은 자유롭다. 단조 증가 검사는 origin 태그 기준이다. 옛 태그를 origin에 push하지 않는다(가드가 막는다). |
| `docs/research/stack.md` 결정 5: 업데이트는 **동적 Worker 엔드포인트(200/204)**. 결정 6: `tauri-action@v1` 빌드 전용. tauri-action v1은 GitHub Release와 GitHub URL `latest.json`을 전제로 한다. | 결정 5 유지, **결정 6 대체**: `pnpm tauri build`를 직접 부른다. R2에는 버전별 `manifest.json`(Tauri 정적 스키마)과 포인터 `releases/latest.json`을 둔다. 클라이언트는 받지 않고 **Worker가 읽는다**. |
| `tauri signer`에 `verify` 명령이 없다. updater plugin·`plugins.updater.pubkey`가 아직 없다. | 검증기는 저장소 안 Rust crate `xtask`(`minisign-verify`)로 둔다. 공개 키는 `release/updater.pub`에 커밋하고, updater plugin 도입 뒤 `tauri.conf.json`과 바이트 동일한지 검사한다. |
| 앱에 `--smoke` 진입점이 없다. single-instance plugin이 첫 플러그인이다(`lib.rs`). | `--smoke`를 더한다(§6). 스모크는 single-instance를 건너뛰고 임시 데이터 폴더를 쓴다. |
| `live.rs`는 `CHZZK_LIVE_HLS/DASH/CLIP` 환경 변수로 대상을 받는 `#[ignore]` 테스트 3개, `examples/dl.rs`는 `--lowest --limit-mb`를 지원한다. | nightly drift의 입력으로 그대로 쓴다. 대상은 **사용자 본인 영상**을 환경 `drift`의 secret으로 준다(공개 목록에서 자동으로 고르면 "본인 영상 전용" 정책과 어긋난다). |
| 현재 세 워크플로는 경로 필터를 쓴다. 경로 필터로 건너뛴 워크플로는 상태를 보고하지 않아 필수 체크가 영원히 Expected로 남는다. | **경로 필터 없는 단일 `ci.yml`** + `changes` 작업 + 집계 작업 **`ci-ok`** 하나만 필수 체크로 쓴다. |
| GitHub Actions 앱 id는 **15368**(`gh api /apps/github-actions`). 저장소 Actions 기본 토큰은 이미 `read`, PR 승인 금지. ruleset은 0개. | ruleset의 `required_status_checks.integration_id = 15368`. 저장소 설정은 `scripts/ci/repo-settings.json`으로 선언하고 drift를 nightly가 본다. |
| `ubuntu-22.04` 러너는 deprecated다. Tauri 문서는 glibc 하한을 위해 가장 오래된 배포판 빌드를 권한다. | 릴리스·master 번들의 Linux 빌드는 `ubuntu-24.04` 호스트 + `container: ubuntu:22.04@sha256:<digest>`로 하고 `glibc-floor` 게이트(최대 `GLIBC_2.35`)로 결과를 고정한다. 설치 스모크는 24.04 호스트에서 돌려 실제 호환도 본다. **[확인 필요]** 컨테이너 안 apt 목록·Node 설치. |
| 공개 저장소의 workflow artifact는 로그인한 누구나 받는다. 로그는 누구나 본다. | 사용자 결정대로 번들 artifact는 두되 **보관 1일**, 서명 전 파일만 거친다. drift·릴리스 로그는 허용 목록 필드만 찍는다. |

---

## 1. 결정 요약

| 번호 | 결정 | 한 줄 근거 |
|---|---|---|
| D1 | 워크플로 세 개(`core.yml`·`app.yml`·`public-scan.yml`)를 `ci.yml` 하나로 합치고 경로 필터를 없앤다 | 필수 체크 `ci-ok`가 항상 보고돼야 한다. 공개 저장소 러너는 무료라 3 OS를 매 PR에 돌려도 된다 |
| D2 | 훅과 CI의 유일한 진입점은 `node scripts/ci/run.mjs <gate>`다. 워크플로 `run:`은 setup 단계를 빼면 이것만 부른다 | 훅과 CI 결과가 갈릴 수 없다. parity 테스트가 강제한다 |
| D3 | 훅은 `.githooks/` shim + `core.hooksPath`다(lefthook 아님) | 이미 있는 패턴, 버전 고정할 곳 없음, stdin·`$1` 전달이 자명 |
| D4 | pre-push 가드의 주 규칙은 집합 차 `N ∩ P ≠ ∅ → 거부`다 | 공개·비공개 이력이 루트를 공유해 루트 규칙은 무력하다 |
| D5 | 도구 버전은 `scripts/ci/tools.json`이 단일 원천이고, 로컬 도구가 없으면 "CI가 검사함" 경고로 통과, `CI=true`면 실패한다 | 로컬에 모든 도구를 요구하면 훅이 꺼진다. CI가 권위다 |
| D6 | PR 필수: lint·supply·rust 3 OS·tauri 3 OS(debug 빌드 + `--smoke`)·frontend·e2e-web·coverage. master 추가: bundle 3 OS + 설치 스모크 + 크기 ratchet + e2e-native(Linux) | 임계 경로를 15분 안에 두면서도 설치본 검증은 머지마다 한다 |
| D7 | 시간에 따라 흔들리는 검사(advisories, live drift, fuzz, mutants, Windows WebDriver)는 nightly/weekly로 보내고 이슈 고리로 닫는다 | 커밋과 무관하게 빨개지는 검사는 PR을 막으면 안 된다 |
| D8 | ratchet(`ci/ratchet.json`)은 저장소 안에 있고 내려가면 실패, 올리기는 사람이 커밋한다 | 회귀는 결정적으로 막고, 개선은 diff에 드러난다 |
| D9 | 릴리스 산출물은 GitHub Release에 올리지 않는다. R2 S3 API로 올리고 `releases/latest.json`을 **마지막에** 쓴다 | 배포는 Worker 허용 목록 뒤에 있다. wrangler `r2 object put`은 크기 상한·local 기본값 문제가 있다 |
| D10 | 서명 키는 빌드 작업에 주지 않는다. 빌드는 임시 키로, 서명·업로드는 `pnpm install`을 하지 않는 격리 작업에서 한다 | 서드파티 npm 스크립트가 돈 머신에 개인 키를 두지 않는다 |
| D11 | 릴리스 로직은 Rust crate `xtask`(워크스페이스 멤버, `publish = false`)다 | `Cargo.lock`으로 고정, `cargo deny`로 검사, 서명 검증은 어차피 Rust여야 한다 |
| D12 | 시크릿은 GitHub Environment `release`(태그 `v*`만)와 `drift`(master만)에만 둔다 | fork PR·브랜치에는 시크릿이 없다 |
| D13 | 보호는 ruleset 둘(master, tags `v*`)로 하고 JSON을 저장소에 둔다. 필수 체크는 `ci-ok` 하나 | 체크 이름이 바뀌어도 보호 설정은 안정적이다. 태그 ruleset이 없으면 재태깅으로 게이트를 우회할 수 있다 |
| D14 | 새 E2E 작업은 2주 관찰 뒤 `ci-ok`에 넣는다 | 결정적이라고 설계해도 환경 요인은 실측으로만 확인된다 |
| D15 | 빌드 provenance 증명(attest-build-provenance)은 미룬다 | 배포가 비공개 게이트 뒤라 공개 증명의 이득이 작다. seam만 둔다 |

---

## 2. 검증 매트릭스

위치 약어: **C** pre-commit · **CM** commit-msg · **P** pre-push · **PR** pull_request · **M** master push · **N** nightly · **W** weekly · **R** 릴리스 태그. 모든 행은 `node scripts/ci/run.mjs <gate>`다. "실제 명령"은 gate가 내부에서 실행하는 것이다.

| gate | 실제 명령 | 위치 | 오라클 |
|---|---|---|---|
| `scan-staged` | `public-scan.mjs --staged` (+`PUBLIC_SCAN_DENYLIST`) | C | exit |
| `scan-msg` | `public-scan.mjs --message-file $1` + `^(feat|fix|docs|chore|refactor|test|ci|build|perf|style|revert)(\(.+\))?: .+` 정규식 | CM | exit |
| `push-guard` | §3 알고리즘 | P | exit, 거부 SHA 목록 |
| `scan-range` | `public-scan.mjs --rev-range <remote_sha|origin/master>..<local_sha>` | P | exit |
| `scan` | `public-scan.mjs` + `--all-history`(`fetch-depth: 0`, 공개 저장소에서만) | PR·M·R | exit |
| `scripts-test` | `node --test scripts/**/*.test.mjs` | P(scripts 변경)·PR(ubuntu+windows) | exit |
| `fixtures` | `gen-fixtures.mjs --check` | C(testdata·scripts/fixtures staged)·PR | 바이트 동일 |
| `fmt` | `cargo fmt --all --check` | C(.rs staged)·PR | exit |
| `typos` | `typos`(`_typos.toml`, `testdata/`·denylist 제외) | C(staged 파일)·PR | exit |
| `workflows` | `actionlint`(shellcheck 포함) + `zizmor --pedantic .github/` + `pin-check`(모든 `uses:` 40-hex + `# vX.Y.Z`, 최상위 `permissions: {}`, `persist-credentials: false`, `timeout-minutes`) | C(.github staged, 도구 있을 때)·PR | exit(zizmor 11–14 = 실패) |
| `versions` | `cargo metadata --no-deps` 모든 멤버 = `tauri.conf.json` = `app/package.json`. R에서 `--tag`도 비교 | C(버전 파일 staged)·PR·R | exit |
| `pubkey` | `release/updater.pub` == `tauri.conf.json` `plugins.updater.pubkey`(updater 도입 뒤) | PR | 바이트 동일 |
| `parity` | `run.test.mjs`: 훅 gate ⊂ ci.yml gate, 워크플로 `run:`에 raw `cargo`/`pnpm`/`public-scan` 없음, `tools.json` == 워크플로 `tool:` 버전, `ci-ok` 이름은 ci.yml에만 | PR | exit |
| `selftest` | 씨앗 위반(가짜 토큰, 안 맞춘 .rs, `uses: …@v4`, 버전 불일치, 비공개 커밋 merge, 커버리지 −1pp, 크기 +5%)에 각 gate가 **0이 아닌** 코드를 내는지 | PR(ubuntu) | 기대 실패 표 |
| `deny` | `cargo deny check bans licenses sources` | P(lock 변경)·PR | exit |
| `advisories` | `cargo deny check advisories` + `pnpm audit --audit-level high` | N, PR(lock 변경 때만) | exit |
| `machete` | `cargo machete` | PR | exit |
| `msrv` | `cargo hack check --rust-version --workspace --locked`(1.90) | PR | exit |
| `rust` | `cargo clippy -p chzzk-core -p chzzk-shell --all-targets --locked -- -D warnings` + `cargo test -p chzzk-core -p chzzk-shell --locked` | P(crates 변경)·PR 3 OS·M 3 OS | exit, `testdata/` 골든 |
| `frontend` | `pnpm install --frozen-lockfile; pnpm check; pnpm test; pnpm build` | P(app 변경)·PR | exit |
| `tauri` | `cargo clippy -p chzzk-app …`, `cargo test -p chzzk-app --locked`, `pnpm tauri build --ci --debug --no-bundle`, `smoke-bin` | PR 3 OS | exit |
| `smoke-bin` | `target/debug/chzzk-app --smoke`(Linux는 `xvfb-run -a`): 60초 안 exit 0 | PR 3 OS | exit + 마커 JSON |
| `e2e-web` | Playwright 1.63 + `vite preview` + `mockIPC` (chromium, ubuntu) | PR | exit, trace artifact |
| `coverage` | `cargo llvm-cov -p chzzk-core -p chzzk-shell --locked --json --summary-only` + `vitest run --coverage` → `ratchet coverage` | PR(ubuntu) | ratchet(−0.1pp 실패) |
| `test-count` | `cargo test -- --list` 개수 + vitest 개수 ≥ ratchet | PR | ratchet |
| `bundle` | `pnpm tauri build --ci --no-sign --bundles <os별>`, `collect --expect release/expected-artifacts.json` | M 3 OS·R | 기대 파일 집합 |
| `smoke-install` | 설치본으로 `--smoke` 실행 후 제거(§6) | M 3 OS·R | exit + 마커 |
| `size` | dist gz, 릴리스 바이너리, 번들 크기 → `ratchet size` | M·R | ratchet(+3% 실패) |
| `glibc-floor` | `objdump -T` 최대 `GLIBC_x.y` ≤ 2.35 | M(Linux)·R | exit |
| `release-hygiene` | 릴리스 바이너리에 `CHZZK_E2E_` 문자열 없음, `cargo tree -e features -p chzzk-app`에 `e2e` 없음 | M·R | grep exit |
| `e2e-native` | tauri-driver 2.1 + WebdriverIO(Linux WebKitWebDriver + xvfb), `--features e2e` 빌드 + 로컬 fixture 서버 | M·N(Linux), W(Windows) | exit |
| `drift` | §4.3 | N | 일반화된 kind |
| `fuzz` | `cargo +nightly-<날짜> fuzz run <t> -- -max_total_time=300`(url·info·mpd·hls) | N(ubuntu) | exit, crash 파일 |
| `mutants` | `cargo mutants -p chzzk-core --shard k/4` → `mutants_missed` ratchet | W | ratchet |
| `ruleset-drift` | `gh api …/rulesets` ↔ `.github/rulesets/*.json`, `repo-settings.json` | N | JSON 동일 |
| `nightly-stale` | nightly 마지막 성공이 72h보다 오래됨 → 이슈; `disabled_inactivity`면 재활성화 | M | 시각 비교 |
| `release-selftest` | MinIO(digest 고정) 대상 §5.8 리허설 | PR(xtask·release 변경)·W | exit + 상태 단언 |

### 벽시계 시간(warm 캐시, 작업 병렬)

| 작업 | ubuntu | macOS | Windows | 비고 |
|---|---|---|---|---|
| `lint`(scan·fmt·typos·workflows·versions·parity·selftest·fixtures) | 2–3분 | — | (scripts-test만 1분) | 첫 신호 |
| `supply`(deny·machete·msrv) | 4–5분 | — | — | |
| `rust` | 6분 | 5분 | 8분 | |
| `frontend` | 2분 | — | — | |
| `e2e-web` | 3–4분 | — | — | 브라우저 캐시 |
| `coverage` | 7–8분 | — | — | |
| `tauri`(debug 빌드 + smoke-bin) | 9분 | 8분 | **12–14분** | PR 임계 경로 |
| `bundle`+`smoke-install`+`size`(M만) | 11분 | 9분 | 16–18분 | master 임계 경로 |
| `e2e-native` Linux(M) | 8–10분 | — | — | |
| `ci-ok` | <1분 | | | |

- PR 벽시계 약 **13–15분**(cold 캐시 +8–10분). 문서만 바뀐 PR은 `changes.code=false`라 lint만 약 2분.
- master push 약 **18–20분**. nightly 약 25분. 릴리스 약 30–40분.
- `Swatinem/rust-cache`는 `save-if: github.ref == 'refs/heads/master'`로 둬 PR이 캐시를 밀어내지 않게 한다. concurrency는 PR만 `cancel-in-progress: true`, master·nightly·release는 `false`(릴리스 게이트가 머지 커밋마다 `ci-ok`를 요구한다).

### `ci.yml` 구성(경로 필터 없음)

```
changes ─┬─ lint · supply · frontend · e2e-web · coverage                         (code==true)
         ├─ rust (3 OS) · tauri (3 OS)                                              (code==true)
         ├─ bundle (3 OS; push master만) → smoke-install·size·glibc-floor·release-hygiene
         └─ e2e-native (ubuntu; push master만)
ci-ok    needs: 위 전부, if: always()  →  run.mjs ci-ok (env NEEDS=${{ toJSON(needs) }})
report   needs: ci-ok, if: always() && push && master → master-failure 이슈 열기/닫기, nightly-stale, keep-alive
```

`ci-ok`는 `failure`·`cancelled`가 하나라도 있으면 실패한다. `skipped`는 `changes.outputs.code == 'false'`가 그 작업을 건너뛰게 한 경우와, PR에서의 `bundle`·`e2e-native`만 허용한다. `changes`는 `run.mjs changes`가 `git diff --name-only $BASE...$HEAD`로 `code`(crates·app·Cargo·testdata·scripts·.github), `release`(xtask·release·release.yml), `docs_only`를 낸다.

---

## 3. 진입점 스크립트와 훅

### 3.1 레이아웃

```
scripts/ci/
  run.mjs            # run.mjs <gate> [args] | run.mjs hook <pre-commit|commit-msg|pre-push> [...] | run.mjs changes | run.mjs ci-ok | run.mjs doctor | run.mjs install-hooks
  gates.mjs          # 표: {name, cmds:[[bin,...args]], needs:['cargo','pnpm','typos',...], area:'rust'|'app'|'scripts'|'any', hooks:[...]}
  tools.json         # typos-cli 1.50.3, actionlint 1.7.12, zizmor 1.30.1, cargo-deny 0.20.2, cargo-llvm-cov 0.9.1,
                     # cargo-hack 0.6.45, cargo-machete 0.9.2, cargo-mutants 27.1.0, tauri-driver 2.1.0, playwright 1.63.0, nightly 날짜
  public-scan.mjs    # + --rev-range, --message-file, export scanText()
  push-guard.mjs  version-check.mjs  pin-check.mjs  ratchet.mjs  issue.mjs  drift-classify.mjs  pin-actions.mjs  repo-settings.mjs
  *.test.mjs
  repo-settings.json
.githooks/{pre-commit,commit-msg,pre-push}
.github/{workflows/{ci,nightly,release,rollback}.yml, rulesets/{master,tags}.json, dependabot.yml}
ci/ratchet.json  ci/RATCHET_LOG.md  ci/e2e/Dockerfile(선택, 골든용)
xtask/             # cargo xtask release {collect,sign,verify-sig,put,sums,manifest,verify,rollback}
release/{updater.pub, expected-artifacts.json, latest.schema.json, tauri.release.json}
rust-toolchain.toml  # channel 1.96.1, components rustfmt·clippy·llvm-tools-preview
_typos.toml  zizmor.yml  deny.toml
```

- 언어는 Node(.mjs)다. Node 22+는 이미 필수이고 스캐너가 Node다. bash·ps1 로직을 두지 않으므로 OS 분기가 없다. 기존 `public-scan.sh/.ps1` 래퍼는 남긴다.
- `run.mjs`는 `spawnSync(bin, args, {stdio:'inherit', shell:false})`로 순서대로 실행하고 첫 0이 아닌 코드를 돌려준다. Windows에서 `pnpm`·`cargo` 같은 `.cmd` 래퍼는 `shell:false`로 못 띄우므로 `pnpm`은 `corepack` 경로 또는 `require.resolve('pnpm/bin/pnpm.cjs')`로 `node <cjs>`로, `cargo`·`rustup` 도구는 `.exe`를 직접 찾는다 **[확인 필요]**.
- 도구가 없을 때: 로컬(`CI` 미설정)은 "건너뜀: CI가 검사함" 경고와 0, `CI=true`면 2. 도구 버전이 `tools.json`과 다르면 로컬에서는 경고, CI에서는 실패(`doctor`가 표로 보여 준다).
- CI는 `taiki-e/install-action`의 `tool:` 입력에 `tools.json` 값을 그대로 쓴다. parity 테스트가 둘을 비교한다.

### 3.2 훅

설치: `node scripts/ci/run.mjs install-hooks` → `git config core.hooksPath .githooks`, Node 버전·`doctor` 확인. README·CLAUDE.md에 한 줄로 적는다.

```sh
#!/bin/sh
# .githooks/pre-push — Windows는 Git for Windows의 sh가 실행한다
exec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" hook pre-push "$@"
```

| 훅 | 예산 | 내용 |
|---|---|---|
| pre-commit | <5초 | 항상 `scan-staged`. staged 경로에 따라 `fmt`(.rs), `typos`, `workflows`(.github), `versions`(버전 파일), `fixtures`. 컴파일·svelte-check 없음 |
| commit-msg | <1초 | `scan-msg`(공개 이력에 남는 메시지의 누출·형식) |
| pre-push | warm ≤3분 | 1 `push-guard` → 2 `scan-range` → 3 `rust`(crates 변경) → 4 `frontend`(app 변경) → 5 `scripts-test`(scripts 변경) → 6 `deny`(lock 변경). `CHZZK_HOOK_FAST=1`이면 3–6을 건너뛴다. **1·2는 끌 수 없다** |

### 3.3 `push-guard` 알고리즘(결정적)

git이 stdin으로 주는 `<local_ref> <local_sha> <remote_ref> <remote_sha>`를 읽는다. 원격 이름은 `$1`, URL은 `$2`다.

1. URL이 `chzzk-downloader-private`(원격 `private`)이면 통과한다(보관용). 단 **"private에는 더 이상 push하지 않는다"**를 문서에 적는다(5번 규칙 오탐 방지).
2. `local_sha`가 0(삭제)이면 통과한다. master 삭제는 ruleset이 막는다.
3. `local_ref`가 `refs/remotes/private/*`이거나 `local_sha`가 어떤 `refs/remotes/private/*` 끝과 같으면 거부한다(`git push origin private/master:x` 같은 경우).
4. **주 규칙**: `N = rev-list <local_sha> --not --remotes=origin`, `P = rev-list --remotes=private --not --remotes=origin`. `N ∩ P ≠ ∅`이면 거부하고 교집합 SHA(최대 20개)와 해결 힌트(`git rebase --onto origin/master <base>` 또는 cherry-pick)를 찍는다. 태그 push는 `^{commit}`으로 벗겨 같은 규칙을 적용한다.
5. `remote_ref`가 `refs/heads/*`도 `refs/tags/v*`도 아니면 거부한다.
6. `refs/remotes/private/master`가 없거나 30일보다 오래됐으면 경고한다(P가 불완전할 수 있다). 없으면 통과시키되 경고한다 — CI의 `--all-history`가 두 번째 그물이다.
7. 이어서 `scan-range`가 `<remote_sha(0이면 origin/master)>..<local_sha>`의 blob·경로·메시지·작성자를 본다.

테스트(`push-guard.test.mjs`, ubuntu·windows): 임시 bare 저장소 둘(가짜 origin·private, **같은 루트**를 공유)로 새 브랜치, 삭제, 태그, `private/x:refs/heads/x`, 비공개 커밋 merge, 정상 공개 커밋, private 원격으로의 push → 기대 코드 0/0/0/1/1/0/0.

---

## 4. 닫힌 고리

### 4.1 자동 이슈(`issue.mjs`)

- `issue.mjs sync --loop <name> --status fail|ok --run-url … --sha … --os … --jobs … --kinds <enum,…>`
- 본문은 **허용 목록 필드만**으로 만든다. 자유 문자열 인자는 없다. kind는 고정 enum(`build`, `test`, `http_4xx`, `http_5xx`, `auth`, `target_gone`, `schema_mismatch`, `timeout`, `media_invalid`, `panic`, `no_target`, `unknown`)이다.
- 게시 전에 스캐너의 `scanText()`를 본문에 적용해 걸리면 게시하지 않고 실패한다. 단위 테스트가 가짜 토큰이 든 본문의 거부를 확인한다.
- 멱등: label `ci-loop:<name>` + 숨은 마커 `<!-- ci-loop:<name> -->`. fail: 열린 이슈 없으면 생성, 있으면 댓글. ok: 열린 이슈가 있으면 복구 댓글 후 닫음.
- `GITHUB_TOKEN`이 만든 이벤트는 워크플로를 트리거하지 않는다. `workflow_run`·`pull_request_target`은 쓰지 않는다.

| loop | 출처 | 권한 |
|---|---|---|
| `master-failure` | `ci.yml` `report`(push master, `ci-ok` 결과) | `issues: write`, `actions: write`(keep-alive) |
| `nightly-stale` | `ci.yml` `report` | 위와 같음 |
| `drift`, `advisories`, `fuzz`, `mutants`, `ruleset-drift`, `toolchain` | `nightly.yml` | `issues: write`, `actions: read` |
| `release` | `release.yml` `report`(실패·리허설 실패) | `issues: write` |

### 4.2 Ratchet(`ci/ratchet.json`)

```json
{ "coverage_lines": { "rust": 0.0, "frontend": 0.0, "tolerance_pp": 0.1 },
  "tests": { "rust": 0, "vitest": 0, "playwright": 0 },
  "size": { "dist_gz": 0, "binary": { "linux": 0, "darwin": 0, "windows": 0 },
            "bundle": { "linux-AppImage": 0, "linux-deb": 0, "darwin-dmg": 0, "windows-setup": 0, "windows-msi": 0 }, "tolerance_pct": 3 },
  "mutants_missed": { "chzzk-core": 0 } }
```

- 판정은 순수 함수다(fixture JSON으로 테스트). 커버리지·테스트 수는 `현재 < floor − tolerance`면 실패. 크기는 `현재 > floor × (1 + tolerance)`면 실패. `mutants_missed`는 증가하면 실패.
- 값은 CI 러너에서만 잰다(ubuntu 커버리지, OS별 크기). CI는 측정값을 `ratchet-measurements` artifact와 job summary에 남기고 "floor를 X로 올릴 수 있음"을 표시한다.
- 올리기: `run.mjs ratchet --write --from-run <id>`(`gh run download`)로 CI 값만 반영한다. 내리기: 같은 PR이 `ci/RATCHET_LOG.md`에 키 이름을 적은 줄을 더해야 한다(`ratchet.mjs`가 diff에서 확인). CI는 커밋하지 않는다.
- 초기값 0은 "아직 안 잼"이다. G3에서 첫 CI 값으로 채운 뒤부터 효력이 생긴다.

### 4.3 Nightly drift(`nightly.yml`, cron `17 18 * * *` = KST 03:17)

- 작업 `drift`는 `environment: drift`(배포 브랜치 master만). secret `CHZZK_LIVE_HLS`·`CHZZK_LIVE_DASH`·`CHZZK_LIVE_CLIP`은 사용자 본인 영상이다. 빠른 다시보기(HLS)는 만료되므로 `target_gone`이면 "secret 교체 필요" 고정 문구를 이슈에 붙인다.
- `run.mjs drift`:
  1. `cargo test -p chzzk-core --test live --locked -- --ignored`(`--nocapture` 없음, `RUST_LOG` 해제, `RUST_BACKTRACE=0`)
  2. `cargo run -p chzzk-core --example dl --locked -- <url> --lowest --limit-mb 2 --out $RUNNER_TEMP/d`
  3. 두 출력은 **`$RUNNER_TEMP/drift.log`로만** 간다. echo하지 않고 artifact로 올리지 않는다(secret 마스킹은 id만 가리고 서버가 돌려준 제목·채널 이름은 못 가린다).
  4. `drift-classify.mjs`가 로그를 읽어 `{test, pass|fail, kind}` JSON만 찍는다. kind는 `chzzk_core::Error` 변종 이름에 대한 고정 정규식으로 고른다. 분류기는 합성 로그 fixture로 테스트한다.
  5. 로그 파일을 지운다.
- 이슈는 **두 번 연속 실패**(`gh run list --workflow nightly.yml --branch master --limit 2`)일 때만 연다. 성공 한 번에 닫는다. `no_target`이 3회 연속이어도 연다.
- `selftest`가 drift 작업 로그를 fixture 제목 문자열로 grep해 0건임을 확인한다(`simulate` 입력으로 합성 실패를 만들 때).

### 4.4 그 밖의 고리

- **master 실패**: `report`가 `ci-ok` 실패 때 `master-failure` 이슈를 바로 연다(실패 작업 이름·OS 포함). 다음 녹색에 닫는다.
- **스케줄 생존**: 공개 저장소는 60일 활동이 없으면 스케줄을 끈다. `report`가 `gh api …/actions/workflows/nightly.yml --jq .state`가 `disabled_inactivity`면 `gh workflow enable`을 실행하고, 마지막 성공이 72h보다 오래됐으면 `nightly-stale` 이슈를 연다. master 활동이 60일 없으면 이 고리도 멈춘다(§9).
- **설정 drift**: nightly `ruleset-drift`가 `gh api repos/{o}/{r}/rulesets`·`/rules/branches/master`와 저장소 설정을 `.github/rulesets/*.json`·`scripts/ci/repo-settings.json`과 비교한다. 공개 저장소의 읽기 엔드포인트라 `GITHUB_TOKEN`으로 될 것이다 **[확인 필요]**. 403이면 fine-grained PAT `RULESET_READ_TOKEN`(환경 `audit`)로 바꾼다.
- **툴체인**: weekly `toolchain`이 `rust-toolchain.toml`과 최신 stable을 비교해 이슈를 연다(Dependabot이 못 보는 파일).
- **누출**: 트리·`--all-history`는 PR·master·R마다, `--rev-range`는 pre-push마다, `--staged`는 pre-commit마다, `--message-file`은 commit-msg마다.
- **배포 뒤 검증·롤백**: §5.6–5.7.

---

## 5. CD 파이프라인(`release.yml`)

트리거: `push: tags: ['v*']`(실제), `workflow_dispatch`(`mode=rehearsal`)와 `schedule` 매주 월 KST 04:23(리허설. 태그가 드물어 리허설이 없으면 경로가 썩는다). `concurrency: release`, `cancel-in-progress: false`. 캐시 없음. 최상위 `permissions: {}`. 모든 작업 `timeout-minutes`.

1. **`gate`**(ubuntu-24.04, `contents: read`, `checks: read`)
   - `run.mjs versions --tag "$GITHUB_REF_NAME"`(ref 이름은 `env:`로).
   - semver이고 origin의 모든 `v*` 태그보다 크다(`git tag --sort=v:refname`).
   - `git merge-base --is-ancestor "$GITHUB_SHA" origin/master`.
   - `run.mjs wait-ci-ok --sha --timeout 1800`: check-runs에서 `name == "ci-ok" && app.slug == "github-actions" && conclusion == "success"`를 30초 간격으로 기다린다. 태그가 master CI보다 먼저 올 수 있어서 기다린다. 실패·시간 초과면 거부한다.
   - `scan --all-history`.
   - 리허설은 태그·CI 대기를 건너뛰고 버전은 파일에서 읽는다.
2. **`build (os)`**(`ubuntu-24.04` + `container: ubuntu:22.04@sha256:…`, `macos-latest`(arm64), `windows-latest`; `contents: read`, **시크릿 없음**)
   - `pnpm tauri signer generate --ci -w $RUNNER_TEMP/eph.key`로 **임시 키**를 만든다(`createUpdaterArtifacts`는 키 없이 빌드가 실패한다 **[확인 필요]**).
   - `pnpm tauri build --ci --config release/tauri.release.json`(`bundle.createUpdaterArtifacts: true`). `--bundles`: Linux `appimage,deb`, macOS `app,dmg`, Windows `nsis,msi`.
   - `cargo xtask release collect --os --version`: 정식 이름으로 바꾸고(`productName`이 한글이라 R2 키에 못 쓴다) `release/expected-artifacts.json`과 **정확히 같은 집합**인지 확인한 뒤 `<os>.meta.json`(`{file,size,sha256}`)을 쓴다. 임시 `.sig`는 버린다.
     - `chzzk-downloader_<v>_linux-x86_64.AppImage`, `…_linux-x86_64.deb`
     - `…_darwin-aarch64.app.tar.gz`, `…_darwin-aarch64.dmg`
     - `…_windows-x86_64-setup.exe`, `…_windows-x86_64.msi`
   - `glibc-floor`(Linux), `release-hygiene`, `size`, `smoke-install`(§6; Linux는 컨테이너 밖 24.04 호스트 작업 `smoke (linux)`로 분리).
   - artifact `release-<v>-<os>` **보관 1일**(사용자 결정: 짧은 보관 artifact).
   - darwin-x86_64(`macos-15-intel`)는 처음엔 빼고 매트릭스 한 줄로 더한다.
3. **`sign-publish`**(ubuntu-24.04, `environment: release`, needs build·smoke, `pnpm install` 없음)
   - preflight: `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `vars.R2_ACCOUNT_ID`, `vars.R2_BUCKET`, `vars.DIST_BASE_URL` 중 빈 것이 있으면 `[ -n ]`로 이름만 찍고 **`::error::릴리스 시크릿 없음: <이름들>. 빌드·수집·설치 스모크까지는 통과, 업로드하지 않음`** 뒤 exit 1. 리허설도 여기서 멈춘다.
   - `cargo xtask release sign`: `minisign` crate로 updater 산출물 4개(AppImage, app.tar.gz, setup.exe, msi)에 서명한다(Tauri CLI와 같은 crate·키 형식 **[확인 필요]**; 안 되면 `pnpm dlx @tauri-apps/cli@2.12.1 signer sign`으로 대체).
   - `cargo xtask release verify-sig --pubkey release/updater.pub`: 모든 `.sig` 검증 + **1바이트 변조 사본은 반드시 실패**하는 음성 자체 검사.
   - `cargo xtask release put releases/<v>/ …`: R2 S3 API(`https://<account>.r2.cloudflarestorage.com`, region `auto`, `x-amz-checksum-sha256`)로 올린다. `If-None-Match: *`로 덮어쓰기를 막고, 이미 있는 객체가 같은 sha256이면 성공으로 본다(재실행 안전). wrangler `r2 object put`은 쓰지 않는다.
   - `xtask release sums` → `releases/<v>/SHA256SUMS`.
   - `xtask release manifest` → `releases/<v>/manifest.json`: Tauri 정적 스키마(`version`, `pub_date` = 태그 커밋의 committer 시각, `platforms.{linux-x86_64,darwin-aarch64,windows-x86_64}.{url,signature}`; `signature`는 `.sig` **내용**, `url`은 `${DIST_BASE_URL}/releases/<v>/<file>`). `release/latest.schema.json`으로 검증한다.
   - 현재 `releases/latest.json`을 읽어 `prev` 버전(없으면 none)을 기록하고 단조 증가를 확인한다.
   - **마지막에** `releases/latest.json` = 이번 `manifest.json`을 `If-Match: <etag>`(없으면 `If-None-Match: *`)로 쓴다(CAS).
4. **`verify`**(ubuntu-24.04, `environment: release`, needs sign-publish)
   - `cargo xtask release verify --manifest releases/latest.json`: `vars.VERIFY_VIA`가 `worker`면 `${DIST_BASE_URL}` + `CI_VERIFY_TOKEN`으로, 아니면 S3 GET으로 **모든 객체를 다시 받아** sha256을 `SHA256SUMS`와 대조하고, 플랫폼마다 minisign을 **커밋된 `release/updater.pub`**로 검증하고, 버전이 태그와 같은지, 스키마가 맞는지 본다.
   - 실패하면 `xtask release rollback --to <prev>`: `releases/<prev>/manifest.json`을 `latest.json`으로 CAS 복사(첫 릴리스면 삭제), 되돌린 상태를 다시 verify, exit 1(→ `release` 이슈). 실패한 버전의 객체는 진단용으로 남긴다.
5. **`deploy-worker`**(Phase 3 seam): `needs: verify`, `if: vars.WORKER_DEPLOY_ENABLED == 'true'`, `environment: release`. `pnpm --dir worker dlx wrangler@4.147.0 deploy`(secret `CLOUDFLARE_API_TOKEN`), 배포 뒤 `/health` 200, updater 엔드포인트가 prev 버전 요청에 200+새 버전, 새 버전 요청에 204를 돌려주는지. **Worker 계약**: `releases/latest.json`과 `releases/<v>/manifest.json`에 있는 키만 제공하며, 스키마 버전이 바뀌면 Worker 배포가 3단계 앞으로 간다.
6. **`report`**: `if: failure()` → `release` 이슈.
7. **`rollback.yml`**(workflow_dispatch, `environment: release`, 입력 `version`): 그 버전 객체를 verify → `latest.json` CAS 교체 → 다시 verify.

R2 배치:

```
releases/<v>/<정식 파일명>[.sig]   불변(If-None-Match: *)
releases/<v>/SHA256SUMS
releases/<v>/manifest.json         버전별(롤백 원본)
releases/latest.json               유일한 가변 객체, 항상 마지막에, CAS로 쓴다
```

8. **리허설·`release-selftest`**: 리허설 dispatch는 3 OS build·collect·smoke-install까지 돌고 preflight에서 멈춘다. `release-selftest`(PR의 `changes.release` 또는 weekly)는 MinIO service container(digest 고정)를 띄워 합성 산출물로 (a) 빈 버킷 happy path, (b) 두 번째 버전과 CAS, (c) 객체 하나 변조 → verify 실패 → rollback → `latest.json`이 prev와 **바이트 동일**, (d) 재실행 멱등, (e) 시크릿 없음 → 정확한 preflight 메시지를 단언한다. 첫 단계로 MinIO가 `If-None-Match: *`·`If-Match`를 지키는지 확인하고(중복 PUT이 412) **[확인 필요]**, 아니면 Node로 만든 작은 S3 가짜 서버로 바꾼다.

---

## 6. 스모크와 E2E

| 층 | 도구 | 위치 | 결정성 |
|---|---|---|---|
| 단위·컴포넌트 | cargo test, vitest+jsdom(기존) | PR | 완전 |
| 앱 기동 `--smoke` | 실제 바이너리·webview를 임시 데이터 폴더로 띄우고(single-instance 생략) 프런트 `ready` invoke(dist 로드·CSP 통과 증명)를 받으면 `{version, ready:true}`를 `CHZZK_SMOKE_OUT`에 쓰고 exit 0. 60초 초과면 exit 2. 네트워크 없음. Rust 단위 테스트(시간 초과 로직)와 vitest(`ready`를 정확히 한 번 보냄) | PR 3 OS(debug), M·R(설치본) | exit + 마커 |
| 설치 스모크 | Linux: `apt-get install ./*.deb` → `xvfb-run -a chzzk-downloader --smoke` → remove; AppImage는 `--appimage-extract-and-run` **[확인 필요]**. macOS: `hdiutil attach -nobrowse -readonly` → `.app` 복사 → `xattr -dr com.apple.quarantine` → `Contents/MacOS/<bin> --smoke` → detach; `.app.tar.gz` 안 `.app`과 해시 비교. Windows: NSIS `setup.exe /S` → `%LOCALAPPDATA%`에서 `--smoke` → `uninstall.exe /S` → 폴더 없음; MSI `msiexec /i … /qn /norestart /l*v` exit 0 → `--smoke` → `/x /qn` **[확인 필요]** | M 3 OS·R | exit |
| 웹 E2E | Playwright 1.63, `vite preview`, `@tauri-apps/api/mocks`의 `mockIPC(…, {shouldMockEvents:true})`. `subscribe_jobs` Channel은 callback id를 잡아 흉내 낸다. fixture는 `app/src/test/fixtures.ts`. chromium 하나. 흐름: URL → ResolveCard → enqueue → 진행 → pause/resume → 완료, copy deck의 오류 카드 전부, 설정, 닫기 가드. `axe-core`(고정) 위반 0 | PR(ubuntu) | 결정적. 시각 골든은 처음엔 **안 넣는다**(한글 폰트). 넣는다면 `ci/e2e/Dockerfile`(playwright 이미지 digest + `fonts-noto-cjk`)로만 |
| 네이티브 E2E | tauri-driver 2.1 + WebdriverIO. 앱은 `--features e2e`로 빌드해 `CHZZK_E2E_API_BASE`가 `testdata/`를 서빙하는 로컬 Node fixture 서버를 가리킨다. `release-hygiene`가 릴리스 바이너리에 이 feature가 없음을 증명한다 | M·N(Linux: WebKitWebDriver + xvfb), W(Windows: msedgedriver는 러너 Edge 버전을 따라 재현 불가) | Linux 결정적. macOS는 드라이버 없음·wdio embedded plugin은 비용 대비 가치 낮아 하지 않음 |

D14에 따라 `e2e-web`·`e2e-native`는 2주 관찰 뒤 `ci-ok`에 넣는다. 관찰 기간 동안의 실패는 `master-failure` 이슈로만 본다.

---

## 7. 공급망 강화

- 모든 `uses:`는 `owner/repo@<40-hex> # vX.Y.Z`. SHA는 `scripts/ci/pin-actions.mjs`가 `gh api repos/O/R/git/ref/tags/<tag>`(annotated는 `^{}`)로 다시 해석한다. 조사 보고서의 SHA는 참고용이다. `dtolnay/rust-toolchain`은 branch commit으로 고정하고 버전은 `toolchain:` 입력(`rust-toolchain.toml`에서 읽음)으로 준다.
- 서드파티 action은 `actions/*`, `pnpm/action-setup`, `Swatinem/rust-cache`(릴리스에는 없음), `taiki-e/install-action`, `dtolnay/rust-toolchain`뿐이다. actionlint·zizmor·typos·cargo-*·wrangler는 바이너리/`pnpm dlx`로 받는다. `tauri-action`·`wrangler-action`은 쓰지 않는다.
- 권한: 최상위 `permissions: {}`, 작업마다 `contents: read` + 필요한 것만(§4.1 표, `gate`의 `checks: read`). 모든 checkout `persist-credentials: false`. `pull_request_target`·`workflow_run` 없음. `${{ github.event.* }}`·`github.ref_name`은 `env:`로만 전달. 모든 작업 `timeout-minutes`.
- `zizmor --pedantic`(exit 11–14 실패, `--no-exit-codes` 금지), `zizmor.yml` ignore는 줄마다 이유. actionlint는 shellcheck와 함께.
- Dependabot: `github-actions`(/), `cargo`(/), `npm`(/app), (골든 컨테이너를 넣으면 `docker`(/ci/e2e)). **weekly**, minor+patch 그룹, `cooldown: {default-days: 7}`, `open-pull-requests-limit: 3`. 자동 머지 없음(한 달 뒤 소음을 보고 정한다).
- Rust: `deny.toml`(`sources` crates.io만, `licenses` 허용 목록, `bans` wildcards deny), `--locked` 전부, `CARGO_INCREMENTAL=0`, `AWS_LC_SYS_PREBUILT_NASM=1`, checkout 전 `core.autocrlf false`. `rust-toolchain.toml`로 로컬·CI 툴체인 동일.
- pnpm: `--frozen-lockfile`, `pnpm-workspace.yaml`의 `minimumReleaseAge`(이미 exclude 목록이 있다)와 `onlyBuiltDependencies` 허용 목록 **[확인 필요]**.
- 릴리스 격리: 캐시 없음, 개인 키는 `sign-publish`에만, `environment: release`는 `v*` 태그만.
- 저장소 설정(`repo-settings.mjs --apply|--check`, JSON 커밋): Actions 기본 토큰 read(이미 그렇다), PR 승인 금지(이미), fork PR 실행은 "모든 외부 기여자 승인 필요", secret scanning + push protection 켬.
- Ruleset(`.github/rulesets/`), **`ci.yml`이 master에서 `ci-ok`를 한 번 보고한 뒤** `gh api --method POST repos/chnu-kim/chzzk-downloader/rulesets --input`으로 적용:
  - `master.json`: `~DEFAULT_BRANCH`, `required_status_checks: [{context: "ci-ok", integration_id: 15368}]`, `strict_required_status_checks_policy: true`, `non_fast_forward`, `deletion`, `bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "always"}]`(Admin = 5 **[확인 필요]**, 적용 뒤 읽어서 확인).
  - `tags.json`: `refs/tags/v*`, `deletion`·`non_fast_forward`·`update`. 재태깅으로 게이트를 우회하는 것을 막는다.
  - PR 리뷰 필수는 두지 않는다(혼자라 본인 PR을 승인할 수 없다).

---

## 8. 사용자가 더해야 할 시크릿·변수(정확한 이름)

| 위치 | 이름 | 종류 | 용도 |
|---|---|---|---|
| Environment `release` (deployment branch: tags `v*`) | `TAURI_SIGNING_PRIVATE_KEY` | secret | `pnpm tauri signer generate --ci -w` 결과의 개인 키 내용 |
| | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secret | 그 키의 비밀번호 |
| | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | secret | 버킷 하나로 한정한 R2 S3 API 토큰(Object Read & Write) |
| | `R2_ACCOUNT_ID`, `R2_BUCKET`, `DIST_BASE_URL` | variable | S3 엔드포인트·버킷·매니페스트 URL 접두 |
| | `VERIFY_VIA`(`s3`\|`worker`), `WORKER_DEPLOY_ENABLED`(`false`) | variable | Phase 3 전환 스위치 |
| | `CLOUDFLARE_API_TOKEN`, `CI_VERIFY_TOKEN` | secret(Phase 3) | Worker 배포, Worker 경유 검증 |
| Environment `drift` (branch: master) | `CHZZK_LIVE_HLS`, `CHZZK_LIVE_DASH`, `CHZZK_LIVE_CLIP` | secret | 사용자 본인 영상의 videoNo·clipId |
| Environment `audit`(선택) | `RULESET_READ_TOKEN` | secret | `GITHUB_TOKEN`으로 ruleset 읽기가 403일 때만 |
| 저장소 | `release/updater.pub` | 커밋 파일 | 공개 키(비밀 아님) |

fork PR과 일반 브랜치에는 어느 것도 주어지지 않는다.

---

## 9. 알려진 한계와 CI가 고리를 닫는 방법

- **훅은 우회된다**(`--no-verify`, `LEFTHOOK` 상관없음). CI의 `scan --all-history`와 `ci-ok`가 권위다.
- **ruleset이 없거나 꺼진 동안**: (1) master 실패는 `report`가 즉시 이슈로 연다. (2) 릴리스 `gate`는 태그 커밋이 master의 조상이고 그 커밋에 `github-actions`가 만든 녹색 `ci-ok`가 있어야만 통과한다. 그래서 빨간 커밋이나 master 밖 커밋은 태그를 붙여도 배포되지 않는다. (3) nightly `ruleset-drift`가 ruleset 부재·변경을 이슈로 연다.
- **태그 ruleset 없이는** 태그를 옮겨 다른 커밋을 같은 버전으로 다시 배포할 수 있다. `put`의 `If-None-Match: *`와 "다른 sha256이면 실패" 규칙이 두 번째 그물이다.
- **스케줄 자동 비활성화(60일)**: `report`가 master push마다 되살리지만, master 활동 자체가 60일 없으면 멈춘다. 월 1회 `workflow_dispatch`를 달력에 둔다.
- **공개 artifact**: 보관 1일 artifact는 로그인한 누구나 받는다. 서명 전 파일만 거치고 R2 객체는 거치지 않는다. 더 줄이려면 D10을 포기하고 build 작업에서 바로 올려야 한다(사용자 결정).
- **drift 대상 만료**: HLS 빠른 다시보기는 만료된다. `target_gone`은 이슈에 "secret 교체 필요"로 표시되며 사람이 바꿔야 한다.
- **Windows WebDriver**·**advisories**·**fuzz 시간**·**실서버**는 재현 불가라 PR을 막지 않는다.
- **push-guard의 P 집합**은 로컬 `refs/remotes/private/*` 최신성에 의존한다. 경고만 하고 CI 이력 검사가 받친다.
- **MSRV 검사**는 `cargo hack --rust-version`으로 crate별 `rust-version`을 쓰므로 `rust-toolchain.toml`과 별개다. MSRV 툴체인은 `dtolnay/rust-toolchain`에 `1.90`을 준다.

---

## 10. 구현 그룹(순서대로, 수락 기준은 실제 Actions 실행 결과)

**G1 — 진입점과 단일 CI, 공급망 기본**
- 만들 것: `run.mjs`·`gates.mjs`·`tools.json`·`rust-toolchain.toml`; `[workspace.package] version` 통합과 `version-check`; `ci.yml`(changes, lint[scan·fixtures·fmt·typos·workflows·versions·parity·selftest·scripts-test], supply[deny·machete·msrv], rust 3 OS, frontend, tauri 3 OS(스모크 제외), ci-ok); 기존 세 워크플로 삭제; 모든 `uses:` SHA 핀(`pin-actions.mjs`·`pin-check`), `zizmor.yml`, `_typos.toml`, `deny.toml`, `dependabot.yml`; CLAUDE.md·app.md §14 갱신(구현 중 변경 번호 부여).
- 수락: PR에서 `ci-ok` success, 로그에 zizmor·actionlint exit 0. `selftest` 로그에 씨앗 위반마다 0이 아닌 코드. 문서만 바꾼 PR은 무거운 작업 skipped + `ci-ok` success. 버리는 브랜치에 `uses: …@v4` 한 줄과 fmt 위반을 넣으면 `ci-ok` failure.

**G2 — 훅과 비공개 이력 가드**
- 만들 것: `public-scan.mjs --rev-range`·`--message-file`·`scanText()` 내보내기(테스트 포함); `push-guard.mjs`와 임시 저장소 테스트; `.githooks/{pre-commit,commit-msg,pre-push}`·`install-hooks`; parity 테스트 확장; `docs/public-release.md`·CLAUDE.md 갱신("private에 push하지 않는다").
- 수락: `scripts-test`가 ubuntu·windows에서 녹색(가드 시나리오 7개, 기대 코드 0/0/0/1/1/0/0). 로컬에서 `git push origin private/master:refs/heads/x`가 exit 1이고 교집합 SHA를 찍는다. 씨앗 parity drift에 `selftest` 실패.

**G3 — 스모크, ratchet, master 고리**
- 만들 것: 앱 `--smoke`(Rust·vitest 테스트); PR `smoke-bin` 3 OS; master `bundle`·`smoke-install`·`size`·`glibc-floor`(컨테이너 22.04)·`release-hygiene`; `coverage`·`test-count`와 `ci/ratchet.json` 초기값; `issue.mjs`와 `report`(master-failure, nightly-stale, keep-alive); master 번들 artifact 보관 1일.
- 수락: PR `tauri (3 OS)` 스모크 exit 0과 마커 JSON. master `bundle (3 OS)` 녹색, `ratchet-measurements` artifact 존재. ratchet·issue 본문 단위 테스트 녹색(본문이 스캐너 통과). `workflow_dispatch force_fail=true`로 `ci-loop:master-failure` 이슈가 열리고 다음 녹색에 닫힌다. 씨앗 −1pp·+5%에 `selftest` 실패.

**G4 — E2E**
- 만들 것: Playwright `e2e-web`(mockIPC·axe), cargo feature `e2e`와 fixture 서버, `e2e-native` Linux(master·nightly)·Windows(weekly), app.md §13 "e2e 하지 않음" 대체 기록(구현 중 변경), 2주 관찰 규칙을 ROADMAP 하네스 이력에 기록.
- 수락: `e2e-web` PR 녹색, 씨앗 UI 회귀(버튼 제거)에 실패 + trace artifact. master `e2e-native (linux)` 녹색. `release-hygiene`가 `--features e2e` 씨앗 빌드에 실패. 2주 뒤 두 작업을 `ci-ok` needs에 넣는 PR이 녹색.

**G5 — Nightly·weekly 고리**
- 만들 것: `nightly.yml`(drift + `drift-classify.mjs`, advisories, ruleset-drift, toolchain, fuzz 4 target + 합성 corpus + `nightly-<날짜>` 핀, weekly mutants shard + `mutants_missed` ratchet, Windows e2e-native), `drift` environment, `simulate` 입력.
- 수락: dispatch로 nightly 녹색, drift 로그에 kind·테스트 이름 외 문자열 없음(`public-scan`으로 로그 확인). `simulate: target_gone` 2회로 `ci-loop:drift` 이슈가 열리고 정상 1회에 닫힌다. 분류기 fixture 테스트 녹색.

**G6 — CD**
- 만들 것: `xtask` crate(`collect`,`sign`,`verify-sig`,`put`,`sums`,`manifest`,`verify`,`rollback` + 변조 음성 테스트), `release/{updater.pub, expected-artifacts.json, latest.schema.json, tauri.release.json}`(updater plugin 도입과 `pubkey` gate 포함), `release.yml`(gate·build·smoke·sign-publish·verify·deploy-worker seam·report), `rollback.yml`, `release-selftest`(MinIO), Environment `release`.
- 수락: 리허설 dispatch에서 3 OS build·collect·smoke-install 녹색 후 `sign-publish`가 정확한 "릴리스 시크릿 없음: …" 메시지로 실패. `release-selftest` (a)–(e) 녹색(변조 → rollback → `latest.json` 바이트 동일). 버전 불일치 입력에 `gate` 실패. 시크릿·R2 준비 뒤 첫 실제 태그에서 `verify` 녹색, `latest.json`의 버전이 태그와 같음.

**G7 — 보호와 설정 drift**
- 만들 것: `.github/rulesets/{master,tags}.json`, `repo-settings.json`과 `repo-settings.mjs`, `gh api`로 적용(사용자 승인), nightly `ruleset-drift` 활성화, ROADMAP Phase 4·CLAUDE.md 최종 갱신.
- 수락: `gh api repos/chnu-kim/chzzk-downloader/rulesets` 읽기 결과가 저장소 JSON과 같다(`ruleset-drift` 녹색). `gh api …/rules/branches/master`에 `required_status_checks(ci-ok)`·`non_fast_forward`·`deletion`이 보인다. 빨간 `ci-ok`가 있는 PR의 merge 버튼이 막힌다. 태그 `v*` 삭제·이동 시도가 거부된다.

사용자가 정할 것: darwin-x86_64 포함 시점(기본 제외), artifact 1일 보관 유지 여부(§9), provenance 증명(기본 미룸).

---

## 구현 중 변경

구현하면서 위 본문과 달라졌거나 본문이 모호해 고른 내용이다. 번호는 적은 순서이고 고치지 않는다. 같은 주제를 뒤 항목이 다시 다루면 뒤 항목이 이긴다. 이 절이 본문보다 우선한다.

### G1 (진입점·단일 CI·공급망 기본)

1. **툴체인 설치는 `dtolnay/rust-toolchain` 대신 `rustup toolchain install`.** 인자 없는 `rustup toolchain install`이 `rust-toolchain.toml`(channel·components·profile)을 그대로 읽으므로 버전 원천이 하나로 남고 서드파티 action이 하나 준다(§7 목록에서 뺀다). MSRV 툴체인(1.90)은 워크플로에 적지 않고 `msrv` gate가 `Cargo.toml`의 `rust-version`을 읽어 `rustup toolchain install <msrv> --profile minimal`로 깐다. 실측: `cargo hack check --rust-version --workspace --locked`가 1.90으로 세 crate 모두 통과한다(로컬 macOS·CI ubuntu).
2. **zizmor는 PR gate에서 `--offline`.** 온라인 audit(`known-vulnerable-actions`, `impostor-commit`, `ref-confusion` 등)은 커밋과 무관하게 결과가 바뀌어 원칙 1(결정적 판정)에 어긋난다. PR·master는 `zizmor --offline --pedantic --config zizmor.yml .`이고, 온라인 audit은 G5 nightly로 보낸다. 대상은 저장소 루트(`.`)이며 `.github/workflows/*.yml`과 `.github/dependabot.yml`을 본다. 현재 지적 0건이라 `zizmor.yml`의 규칙 끄기는 비어 있다.
3. **actionlint는 `taiki-e/install-action`이 아니라 `run.mjs install-tool actionlint`.** install-action v2.87.24가 actionlint 1.7.12를 몰라 cargo-binstall로 넘어가 실패했다(첫 실행 실측). `tools.json`의 `download`에 릴리스 파일 URL과 sha256(릴리스 `checksums.txt` 값, 로컬에서 다시 계산해 확인)을 적고, `install-tool`이 받아 해시가 같을 때만 `$RUNNER_TEMP/ci-tools/bin`에 풀고 `GITHUB_PATH`에 더한다. typos·zizmor·cargo-deny·cargo-machete·cargo-hack은 install-action `tool:`이고 parity가 `tools.json`과 비교한다. `tools.json`에는 G1 도구만 두고 뒤 그룹이 자기 도구를 더한다.
4. **`parity`는 별도 스크립트 `parity.mjs`.** §2 표의 `run.test.mjs` 대신 `parity.mjs`(검사)와 `parity.test.mjs`(파서·저장소 검사)로 나눴다. `run.test.mjs`는 진입점의 순수 함수(`classify`, `decideCiOk`)를 본다. 규칙: `run:` 명령 줄은 `node scripts/ci/run.mjs <gate|하위 명령>`이거나 setup 허용 목록(`git config --global core.autocrlf false`, `rustup toolchain install`, `sudo apt-get update`, `sudo apt-get install -y --no-install-recommends <패키지>`)뿐, 넘긴 이름은 gate나 하위 명령, `tool:` 버전은 `tools.json`, `ci-ok` 작업은 `ci.yml`에만 하나, `.githooks/*`는 `scripts/ci` 진입점만 `exec`. "훅 gate ⊂ ci.yml gate"는 훅을 run.mjs로 옮기는 G2에서 더한다. YAML 라이브러리가 없어(루트 `package.json` 없음) 줄 단위로 읽고, 파서가 비어 통과하지 않도록 `parity.test.mjs`가 ci.yml에서 주요 gate 호출을 실제로 찾는지 확인한다.
5. **`pin-check`는 `workflows` gate 안의 `pin-check.mjs`.** 규칙: 원격 `uses:`는 `owner/repo[/path]@<40 hex> # <주석>`(docker는 `@sha256:` digest), 최상위 `permissions: {}`, checkout마다 `persist-credentials: false`, 작업마다 `timeout-minutes`, `pull_request_target`·`workflow_run` 없음. 주석은 태그가 아니어도 된다(브랜치 고정 action 대비). `pin-actions.mjs`는 네트워크(`gh api`)를 쓰므로 gate가 아니라 사람이 돌린다(`--write`로 고정, 인자 없이 확인).
6. **`ci.yml` 작업 구성.** (가) `lint`(ubuntu)는 `changes`와 무관하게 늘 돈다(문서 변경에도 누출·오타 검사가 필요하다). 각 단계는 `if: !cancelled()`로 앞 gate가 실패해도 나머지 결과를 남긴다. (나) §2의 "scripts-test PR(ubuntu+windows)"는 `scripts (windows)` 작업(`scan`·`fixtures`·`scripts-test`)으로 했다. 옛 `public-scan.yml`의 Windows 행을 대신한다. (다) `tauri`는 `rust`·`frontend`를 기다리지 않는다(옛 `app.yml`은 기다렸다). 임계 경로가 짧아지고, 실패해도 `ci-ok`가 모은다. (라) 러너는 `ubuntu-24.04`. (마) `supply`는 `msrv`가 `chzzk-app`까지 check하므로 webkit apt 패키지를 깐다. (바) 옛 `app.yml`의 master 서명 없는 번들 업로드는 G3 `bundle`까지 없다. (사) `timeout-minutes`: changes·ci-ok 5, frontend·scripts 15, lint 20, supply 40, rust 45, tauri 60(PR은 `save-if: master`라 매번 cold 캐시다).
7. **`changes`는 fail-safe.** 기준 커밋이 없거나 0이거나(`workflow_dispatch`, 새 브랜치 push) `git diff`가 실패하면 모든 작업을 돌린다. 코드 판정은 "문서 패턴(`docs/**`, `*.md`, `.claude/**`, `LICENSE*`)에 맞지 않는 파일이 하나라도 있으면 code"다. 모르는 경로는 코드로 본다. `workflow_dispatch`에 `base` 입력을 두어 문서만 바뀐 경로를 PR 없이 확인할 수 있게 했다(수락 기준 "문서만 바꾼 PR"의 대체, 12).
8. **`ci-ok` 판정.** `changes`는 success여야 한다. 다른 작업은 success, 또는 `changes.code == 'false'`일 때 `supply`·`rust`·`frontend`·`tauri`의 skipped만 허용한다(`gates.mjs` `CODE_GATED_JOBS`). `lint`·`scripts (windows)`의 skipped, failure, cancelled(시간 초과 포함)는 실패다.
9. **gate 실행 규칙.** `scan-history`는 `ciOnly`(로컬은 건너뜀). 로컬 클론에는 `refs/remotes/private/*`가 있어 `--all-history`가 반드시 걸린다. 도구가 없으면 로컬은 경고 후 0, `CI=true`면 2. 버전이 `tools.json`과 다르면 로컬은 경고, CI는 2. Windows의 `.cmd`/`.bat` 래퍼(pnpm)는 `shell:false`로 띄울 수 없어(CVE-2024-27980 이후 EINVAL) 그때만 `shell:true`로 띄운다. 인자는 `gates.mjs`의 고정 값뿐이다. `node`는 `process.execPath`로 띄운다. `frontend`·`tauri` gate의 `pnpm install --frozen-lockfile`은 setup이 아니라 gate의 첫 단계다(훅과 CI가 같다).
10. **`selftest` 씨앗(29개).** scan(서명 토큰), fmt(안 맞춘 .rs, `rustfmt --check --edition 2024`), typos, pin-check(`@v4`·`persist-credentials` 없음·`timeout-minutes` 없음), actionlint(모르는 키), zizmor(`${{ github.event.head_commit.message }}` 주입), parity(raw `cargo`, `tool:` 버전 불일치, `ci-ok` 없음), versions(tauri.conf.json·package.json·태그 불일치), ci-ok(failure·cancelled·코드 변경인데 skipped·lint skipped). 각 씨앗은 깨끗한 짝이 0을 내는지도 본다(검사기가 망가져 무엇이든 실패하는 경우를 가린다). 씨앗 문자열은 실행 중에 조립해 `scan`에 걸리지 않는다.
11. **공급망 설정 실측.** `cargo machete`가 `chzzk-app`의 쓰지 않는 `serde`를 찾아 뺐다(`Cargo.lock` 갱신). `deny.toml` 라이선스 허용 목록은 실제 트리에서 뽑았다: MIT, Apache-2.0, Apache-2.0 WITH LLVM-exception, BSD-3-Clause, BSL-1.0, CDLA-Permissive-2.0, ISC, MPL-2.0, Unicode-3.0, Zlib. 워크스페이스 crate는 라이선스 필드가 없어 `[licenses.private] ignore = true`(모두 `publish = false`), path 의존성은 `allow-wildcard-paths = true`. `cargo deny`는 `--locked`로 돈다.
12. **수락 기준 대체.** `ci/pipeline` 말고는 push할 수 없어 "버리는 브랜치"를 쓰지 못한다. (가) 음성 확인: `ci/pipeline`에 `uses: …@v4` 한 줄과 fmt 위반을 넣은 커밋을 push해 `ci-ok` failure를 확인하고 되돌리는 커밋을 push한다. (나) 문서만 바뀐 경로: `workflow_dispatch`에 `base`로 문서 커밋의 부모를 주어 무거운 작업 skipped + `ci-ok` success를 확인한다. 결과: (가) 실행 37284980199에서 `fmt`·`workflows`(pin-check)·`scripts-test`(lint와 `scripts (windows)`)가 실패해 `ci-ok` failure였고 되돌린 커밋으로 녹색이 됐다. (나)는 이 문서 커밋을 기준으로 dispatch한다. 첫 실행에서 `workflow_dispatch`는 기본 브랜치에 워크플로가 없어도 PR 브랜치(`--ref ci/pipeline`)로 돌았다.
