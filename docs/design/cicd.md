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
| `scan-msg` | `public-scan.mjs --message-file $1`(원문 전체) + `commit-msg.mjs $1`(`^(feat|fix|docs|chore|refactor|test|ci|build|perf|style|revert)(\(.+\))?: .+` 정규식) | CM | exit |
| `subjects` | `commit-msg.mjs --stored`(HEAD에서 닿고 기준선 `0b66887`에서 안 닿는 커밋의 저장된 첫 줄) | PR·M | exit |
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
         └─ e2e-native (ubuntu; code==true, PR 포함 — 구현 중 변경 48)
ci-ok    needs: 위 전부, if: always()  →  run.mjs ci-ok (env NEEDS=${{ toJSON(needs) }})
report   needs: ci-ok, if: always() && push && master → master-failure 이슈 열기/닫기, nightly-stale, keep-alive
```

`ci-ok`는 `failure`·`cancelled`가 하나라도 있으면 실패한다. `skipped`는 `changes.outputs.code == 'false'`가 그 작업을 건너뛰게 한 경우와, PR에서의 `bundle`만 허용한다(`e2e-native`는 구현 중 변경 48부터 코드 PR에서도 돈다). `changes`는 `run.mjs changes`가 `git diff --name-only $BASE...$HEAD`로 `code`(crates·app·Cargo·testdata·scripts·.github), `release`(xtask·release·release.yml), `docs_only`를 낸다.

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
| pre-commit | <5초 | 항상 `scan-staged`. staged 경로에 따라 `fmt`(.rs), `typos`, `workflows`(.github), `versions`(버전 파일), `fixtures`, `parity`(.githooks·.gitattributes·.github·gates.mjs·tools.json). 컴파일·svelte-check 없음. 조건부 gate는 **인덱스**에서 돈다(작업 트리가 인덱스와 다르면 임시 worktree) |
| commit-msg | <1초 | `scan-msg`(공개 이력에 남는 메시지의 누출·형식) |
| pre-push | warm ≤3분 | 1 `push-guard` → 2 `scan-range` → 3 `rust`(crates 변경) → 4 `frontend`(app 변경) → 5 `scripts-test`(scripts·.githooks·.gitattributes 변경) → 6 `deny`(lock 변경). `CHZZK_HOOK_FAST=1`이면 3–6을 건너뛴다. **1·2는 끌 수 없다**. 3–6은 **push할 커밋**에서 돈다(HEAD가 아니거나 작업 트리가 더러우면 임시 worktree) |

### 3.3 `push-guard` 알고리즘(결정적)

git이 stdin으로 주는 `<local_ref> <local_sha> <remote_ref> <remote_sha>`를 읽는다. 원격 이름은 `$1`, URL은 `$2`다. (구현 중 변경 18·25가 이 절을 정리한 결과다.)

1. URL이 `chzzk-downloader-private`이거나 원격 이름이 `private`이면 통과한다(보관용). **"private에는 더 이상 push하지 않는다"**를 문서에 적는다.
2. `local_sha`가 0(삭제)이면 통과한다. master 삭제는 ruleset이 막는다.
3. `local_ref`가 `refs/remotes/private/*`면 거부한다(`git push origin private/master:x`). "`local_sha`가 private 끝과 같으면"은 4번이 같은 것을 잡고 오탐이 있어 뺐다(18 (가)).
4. **주 규칙**: `N = rev-list <local_sha> --not --remotes=<원격>`, `P = (rev-list --remotes=private --not --remotes=origin) ∪ (scripts/ci/private-commits.txt의 commit: 지문)`. `N ∩ P ≠ ∅`이면 거부하고 교집합 SHA(최대 20개)와 해결 힌트(`git rebase --onto origin/master <base>` 또는 cherry-pick)를 찍는다. 태그 push는 `^{commit}`으로 벗겨 같은 규칙을 적용한다. 지문은 저장소에 커밋돼 있으므로 private 원격이 없거나 fetch하지 않은 클론에서도 막는다.
5. `remote_ref`가 `refs/heads/*`도 `refs/tags/v*`도 아니면 거부한다.
6. `private` 원격이 설정돼 있는데 `refs/remotes/private/*`가 하나도 없으면 경고한다(지문만으로 검사한다). 30일 경과 경고는 결정적 원천이 없어 뺐다(18 (나)).
7. 로컬 `rev-list --remotes=private --not --remotes=origin`에 지문 목록에 없는 커밋이 있으면 거부하고 목록을 다시 만드는 명령을 찍는다(목록이 낡으면 CI가 그 커밋을 알아볼 수 없다).
8. 이어서 `scan-range`가 `<local_sha> --not --remotes=<원격>`의 blob·경로·메시지·작성자와 커밋 지문을 본다(17).

**CI의 짝**: `scan-history`(`--all-history`)가 공개 저장소의 모든 커밋 SHA를 같은 지문과 맞춘다(`private-commit` 규칙). 그래서 `--no-verify`로 가드를 우회해 비공개 커밋을 올려도, 그 내용이 denylist에 걸리지 않더라도 CI가 실패한다.

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
- **push-guard의 P 집합**은 로컬 `refs/remotes/private/*`와 커밋된 지문(`scripts/ci/private-commits.txt`)의 합집합이다. CI의 `scan-history`가 같은 지문으로 공개 이력 전체를 본다. 남는 한계: 비공개 커밋을 rebase·cherry-pick해 **새 SHA**로 만든 것은 지문이 모른다(내용은 `scan-history`의 규칙·denylist가 본다). private에 새 커밋이 생기면 7번 규칙이 목록 갱신 전까지 push를 막는다.
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
- 만들 것: `nightly.yml`(drift + `drift-classify.mjs`, advisories, ruleset-drift, toolchain, 핀 검증(온라인 zizmor·`pin-actions.mjs` 확인 모드, 구현 중 변경 13 (자)), fuzz 4 target + 합성 corpus + `nightly-<날짜>` 핀, weekly mutants shard + `mutants_missed` ratchet, Windows e2e-native), `drift` environment, `simulate` 입력.
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
13. **G1 리뷰 반영(7·8·10·12와 4·5의 규칙을 바꾼다).**
    (가) **ci-ok guard.** `ci-ok`의 첫 단계 `guard`는 저장소를 받기 전에 식(expression)만으로 판정하고 `exit 1`한다: `changes`·`lint`·`scripts-windows`가 success가 아니거나, needs에 failure·cancelled가 있거나, skipped가 있는데 `pull_request`이면서 `changes.code == 'false'`가 아닐 때. `run.mjs ci-ok`는 같은 규칙의 두 번째 판정이다. 그래서 PR이 `decideCiOk`·`classify`를 망가뜨려 그 테스트(`lint`)가 실패해도 `ci-ok`가 성공으로 보고되지 않는다. 한계: `pull_request` 실행은 PR의 `ci.yml`을 쓰므로 어떤 집계도 PR 코드에서 완전히 독립할 수는 없다. guard를 약하게 하려면 `ci.yml` diff가 보이게 남고, parity가 guard를 글자 그대로(`parity.mjs` `CI_OK_GUARD`) 요구하므로 그 diff는 `parity.mjs`도 함께 바꿔야 한다. 기준 커밋(`base.sha`)의 스크립트로 판정하는 방법은 master에 `run.mjs`가 아직 없어(첫 PR) 쓰지 않았다.
    (나) **건너뛰기는 PR에서만.** `CHANGES_BASE`는 `github.event.pull_request.base.sha`뿐이다. push·`workflow_dispatch`는 기준이 비어 늘 전부 돈다(7의 fail-safe). dispatch `base` 입력은 지웠다(12 (나)의 수락 확인은 끝났다). `decideCiOk`는 `EVENT`(`github.event_name`)를 받아 `pull_request`가 아니면 skipped를 하나도 허용하지 않는다. 그래서 master나 dispatch의 녹색 `ci-ok`는 그 커밋에서 rust·tauri가 실제로 돈 결과다. 빨간 코드 커밋 위의 문서 커밋도 전부 다시 돌아 빨간 상태를 가리지 못하고, 릴리스 gate(§5 `wait-ci-ok`)가 녹색 `ci-ok`만 보아도 빌드 안 된 SHA를 받지 않는다.
    (다) **문서 판정은 허용 목록.** 문서는 `docs/**`, 루트의 `*.md`, `.claude/**`, 루트의 `LICENSE*`뿐이다. `testdata/README.md`처럼 루트 밖의 `.md`는 코드다(`fixture_bytes.rs`가 읽는다).
    (라) **parity 강화.** `run.mjs` 줄의 인자는 셸 메타문자 없는 토큰뿐이다(`|| true`, `; exit 0` 거부). `continue-on-error`·`shell:`(단계·defaults)을 쓰지 않는다. `run.mjs` 단계의 `if:`는 없거나 `${{ !cancelled() }}`뿐이다. ci.yml 작업 수준 `if:`는 ci-ok의 `always()`와 `needs.changes.outputs.code == 'true'`뿐이고 후자를 단 작업 집합 = `CODE_GATED_JOBS`. `ci-ok.needs` = ci.yml의 다른 모든 작업(`CI_OK_EXEMPT` 제외, 지금 비어 있음. D14 관찰 중인 E2E는 여기에 이유와 함께 넣는다). `taiki-e/install-action`은 `fallback: none`(manifest에 없는 버전을 cargo-binstall로 받지 않고 실패한다). setup 허용 목록에 `exit 1`(guard)을 더했다.
    (마) **selftest는 진입점을 돈다.** 씨앗마다 임시 저장소에 `scripts/ci`·설정·실제 `ci.yml`을 복사하고 `node <tmp>/scripts/ci/run.mjs <gate>`를 돌린다. 도구가 아니라 `gates.mjs`의 gate 정의(인자 포함)를 검사한다(예: fmt에서 `--check`를 빼면 씨앗이 통과해 selftest가 실패한다, 실측). 씨앗으로 드러나지 않는 플래그(`--pedantic`, `--offline`, `--locked`, `-D warnings` 등)는 `run.test.mjs`가 gate 표를 직접 본다. 씨앗 38개: scan·scan-staged(서명 토큰), fmt, typos, workflows(`@v4`, `persist-credentials` 없음, `timeout-minutes` 없음, 모르는 키, 과한 권한, `run:`에 식 전개), parity(raw cargo, `|| true`, `continue-on-error`, `if: false`, `tool:` 버전, `fallback: none` 없음, ci-ok needs 누락, guard 변경, ci-ok 없음, 훅이 run.mjs를 거치지 않음), versions, ci-ok(push·dispatch의 skipped 포함).
    (바) **진입 검사 실측 버그.** 스크립트의 `if (fileURLToPath(import.meta.url) === process.argv[1])`는 심볼릭 링크 경로(macOS의 `/var` → `/private/var`)로 부르면 거짓이 되어 main을 돌리지 않고 **조용히 0으로 끝났다**(selftest를 진입점으로 바꾸자 씨앗 23개가 0을 냈다). 모든 `scripts/**/*.mjs`가 `realpathSync(process.argv[1])`로 비교한다. 재발 검사는 `scripts/ci/entry.test.mjs`다: 진입 스크립트 여섯 개가 모르는 인자에 2를 내는지(ubuntu·windows), 심볼릭 링크 경로로 불러도 그런지(Windows 제외) 본다. `gen-fixtures.mjs --check`는 성공 줄(`fixtures: N개 바이트 동일`)을 찍고 모르는 인자에 2를 낸다(로그로 main이 돌았는지 보인다).
    (사) **훅도 run.mjs로.** pre-commit은 `run.mjs scan-staged`(gate 추가)를 exec하고, parity의 hook-entry는 `run.mjs <gate>`만 허용한다(G2의 일부를 당겼다).
    (아) **install-tool.** `tools.json` actionlint `download`에 darwin-x64·linux-arm64·windows-x64(zip)를 더했다(릴리스 `checksums.txt` 값). `.zip`·`.tar.gz` 모두 `tar -xf`로 풀고 Windows는 `actionlint.exe`를 꺼낸다. 로컬은 `target/ci-tools/bin`에 깔고 PATH 줄을 출력하며, `which()`가 그 폴더도 찾으므로 `doctor`·`workflows` gate가 PATH 설정 없이 쓴다.
    (자) **미룬 것.** 핀 SHA가 upstream 저장소의 그 태그인지(impostor commit·ref confusion)는 네트워크가 필요해 PR gate에 두지 않는다(2). G5 nightly가 `zizmor --pedantic`(온라인, `GH_TOKEN` contents:read)과 `pin-actions.mjs`(확인 모드)를 돌리고 어긋나면 이슈를 연다.

### G2 (훅·비공개 이력 가드)

14. **훅 shim과 `run.mjs hook`.** `.githooks/{pre-commit,commit-msg,pre-push}`는 §3.2대로 `exec node "$(git rev-parse --show-toplevel)/scripts/ci/run.mjs" hook <이름> "$@"` 한 줄이다(13 (사)의 `run.mjs scan-staged`를 바꾼다). 무엇을 돌리는지는 `gates.mjs`의 `HOOKS` 표(`always` + 경로 조건 `when`)가 정한다. pre-commit의 조건: `.rs` → `fmt`, 아무 파일 → `typos`, `.github/`·`zizmor.yml` → `workflows`, 버전 파일 → `versions`, `testdata/`·`scripts/fixtures/` → `fixtures`. pre-push의 조건(push 범위 커밋이 건드린 경로): `crates/`·`testdata/`·`Cargo.*`·`rust-toolchain.toml` → `rust`, `app/`(src-tauri 제외) → `frontend`, `scripts/` → `scripts-test`, `Cargo.lock`·`deny.toml`·`Cargo.toml` → `deny`. `app/src-tauri/`만 바뀐 push는 로컬에서 `tauri`를 돌리지 않는다(무겁다. CI가 3 OS로 본다). 훅이 멈추면 첫 0이 아닌 코드에서 멈춘다. 파일은 인덱스 모드 `100755`이고 `.gitattributes`에 `.githooks/* text eol=lf`를 더했다(CRLF면 Git for Windows의 sh가 shebang을 잘못 읽는다).
15. **parity의 훅 규칙.** (가) `hook-entry`: `.githooks/`의 파일 집합 = `HOOKS` 키, 각 파일은 `#!/bin/sh`, 주석·`set -eu` 말고는 `run.mjs hook <자기 이름> "$@"` exec 한 줄, CR 없음, (git 저장소면) 인덱스 모드 `100755`. (나) `hook-gate`: §2의 "훅 gate ⊂ ci.yml gate"는 글자 그대로는 성립하지 않는다(`push-guard`·`scan-range`·`scan-msg`·`scan-staged`는 훅에서만 의미가 있다). 그래서 `gates.mjs`의 `HOOK_ONLY`가 짝을 적는다: `scan-staged` → `scan`, `scan-msg`·`scan-range`·`push-guard` → `scan-history`(CI의 새 클론에는 비공개 ref가 없으므로 공개 이력 전체가 메시지·작성자·blob을 본다). 규칙은 "훅이 부르는 gate는 ci.yml에 있거나, `HOOK_ONLY` 짝이 ci.yml에 있다"다. `push-guard`의 로직은 `scripts-test`(`push-guard.test.mjs`, ubuntu·windows)가 본다.
16. **`public-scan.mjs` 새 모드.** `scanText()`는 G1에서 이미 내보냈다(바꾸지 않았다). (가) `--rev-range <A..B | B>`: `--all-history`와 같은 함수(`scanRevs`)를 rev 인자만 바꿔 쓴다(blob·경로·커밋 메시지·작성자·커미터). 범위 안의 annotated 태그 객체(태그 push의 `local_sha`)는 메시지·태거·이름을 본다. `--not-remote <원격>`은 그 원격 추적 ref에서 닿는 것을 빼고, `--ref <이름>`은 push할 원격 ref 이름도 검사한다(공개 저장소에 그대로 남는다). 범위 문자열은 `-`로 시작하는 조각·빈 쪽·`...`을 거부한다(git 인자 주입 방지). (나) `--message-file <f>`: git 기본 cleanup처럼 `#` 줄과 `commit -v`의 scissors 줄 아래를 버린 본문만 본다. (다) 모드는 하나만 받는다. `git log`에 `--no-show-signature`를 붙였다(사용자 설정 `log.showSignature`가 출력 형식을 바꾸지 않게).
17. **`scan-range`의 범위는 `<local_sha> --not --remotes=<원격>`.** §2·§3.3 7번의 `<remote_sha|origin/master>..<local_sha>` 대신이다. `remote_sha`가 로컬에 없으면(다른 곳에서 push된 브랜치) `A..B`가 git 오류(2)로 push를 막고, 새 브랜치가 master가 아닌 공개 브랜치에서 갈라졌으면 이미 공개된 커밋까지 다시 본다. "공개 원격 추적 ref 어디에서도 닿지 않는 커밋"은 두 경우 모두 결정적이고 더 좁다. 원격이 설정된 이름이 아니면(URL로 push) `origin`을 쓴다. 범위가 비면(이미 공개된 커밋을 새 이름으로 push) 깨끗하다.
18. **`push-guard` 규칙 조정.** (가) 3번의 뒷부분("`local_sha`가 `refs/remotes/private/*` 끝과 같으면 거부")은 뺐다. 그 커밋이 비공개에만 있으면 4번이 같은 것을 잡고, 공개에도 있으면(비공개 브랜치 끝이 공개 커밋일 때) 오탐이다. 앞부분(`local_ref`가 `refs/remotes/private/*`)은 남겼다. (나) 6번의 "30일보다 오래됐으면 경고"는 뺐다. fetch 시각을 읽을 결정적 원천이 없고(끝 커밋 날짜는 fetch 시각이 아니다), private에는 더 이상 push하지 않아 추적 ref가 낡을 수 없다. 대신 `private` 원격이 설정돼 있는데 `refs/remotes/private/*`가 하나도 없으면 경고한다(P가 비어 4번이 아무것도 못 막는다). 경고는 종료 코드를 바꾸지 않는다. (다) 1번은 URL(`chzzk-downloader-private`)뿐 아니라 원격 이름 `private`도 본다. (라) 위반을 모두 모아 보고한다(3번과 4번이 함께 걸리면 교집합 SHA도 찍는다). P는 push 한 번에 한 번 계산한다. 태그가 커밋이 아닌 것을 가리키면 N은 비어 있다.
19. **stdin과 인자.** gate 표에 `stdin: true`(push-guard)를 더했다. `run.mjs hook pre-push`는 stdin을 한 번 읽어 `push-guard`에 `input`으로 주고, 같은 줄로 `scan-range` 범위와 push 경로를 계산한다(`push-guard.mjs`의 `scanRanges`·`pushedPaths`). `run.mjs push-guard <원격> <URL>`을 직접 부르면 stdin을 읽는다. `passArgs`는 마지막 단계가 아니라 모든 단계에 붙는다(`scan-msg`는 두 단계가 같은 파일을 받는다). `passArgs`가 없는 gate에 인자를 주면 2다(전에는 조용히 버렸다).
20. **`scan-msg`의 형식 절반은 `commit-msg.mjs`.** 정규식은 §2 그대로(`feat|fix|docs|chore|refactor|test|ci|build|perf|style|revert`, 선택 scope, `: ` 뒤 공백 아닌 글자). git 2.24부터 `git merge`도 commit-msg 훅을 부르고 `--fixup`·`--squash`·`revert`는 git이 제목을 만들므로 `Merge `, `Revert "`, `fixup! `·`squash! `·`amend! `로 시작하는 제목은 통과시킨다. 제목 형식은 로컬 관례이고 CI는 강제하지 않는다(PR 체크아웃의 merge 커밋 등). 누출 절반(`--message-file`)은 CI의 `scan-history`가 같은 메시지를 다시 본다.
21. **테스트 git 격리(`scripts/ci/test-git.mjs`).** 실측: 로컬 전역 설정의 커밋 서명(1Password SSH 에이전트)이 임시 저장소 커밋마다 60초 뒤 실패해 `public-scan.test.mjs`의 이력 테스트 둘이 실패했다. 임시 저장소를 만드는 테스트와 selftest는 `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<빈 파일>`(Windows에서 `/dev/null`은 같은 뜻이 아니다), 작성자·커미터 환경 변수, `init.defaultBranch=master`로 git을 부르고, 훅 안에서 불려도 바깥 저장소를 가리키지 않게 `GIT_DIR`·`GIT_INDEX_FILE` 등을 지운다. 전역 `core.hooksPath`도 따라오지 않는다.
22. **가드 테스트(`push-guard.test.mjs`, 9개).** 임시 bare 저장소 둘(가짜 origin과 `chzzk-downloader-private.git`, 같은 루트)과 작업 클론으로 §3.3의 7개 시나리오(새 브랜치, 삭제, 태그, `private/x:refs/heads/x`, 비공개 커밋 merge, 정상 공개 커밋, private 원격으로의 push → 0/0/0/1/1/0/0)를 돌린다. 더해서 교집합 SHA와 해결 문구 출력, 비공개 커밋 위의 태그 거부, `refs/heads/*`·`refs/tags/v*` 밖 거부, URL로 push, 여러 ref 중 하나 위반, 형식 오류 2, `scanRanges`·`pushedPaths`, 그리고 **실제 `git push`**(임시 hooksPath의 pre-push가 `push-guard.mjs`를 exec)로 git이 주는 stdin 형식에서 거부된 push가 원격에 닿지 않고 공개 브랜치는 닿는지 본다.
23. **수락 기준 대체: 로컬 `git push origin private/master:refs/heads/x`.** 실제 push는 하지 않았다. 가드에 버그가 있으면 비공개 커밋 128개가 공개 저장소에 올라가고(아직 ruleset도 없다), GitHub 캐시·fork 때문에 되돌릴 수 없다. 대신 이 클론에서 훅 shim을 git과 같은 인자·stdin으로 직접 불렀다: `.githooks/pre-push origin https://github.com/chnu-kim/chzzk-downloader.git` < `refs/remotes/private/master <private/master sha> refs/heads/x 0…0` → **exit 1**, 3번 규칙 위반과 교집합 SHA 128개 중 20개 + "외 108개"와 해결 문구를 찍었다. git → 훅 stdin 경로는 22의 임시 저장소 실제 push 테스트가 본다.
24. **selftest 씨앗(51개, G1의 38개에 13개를 더했다).** parity: 훅이 gate를 직접 부름(`run.mjs push-guard`), 훅 이름이 파일과 다름, 훅 gate의 CI 짝(`scan-history`)이 ci.yml에 없음(기존 "훅이 run.mjs를 거치지 않음"은 그대로). 훅 진입점(사본의 `run.mjs hook …`, 격리된 git): commit-msg(형식 맞음 0, 형식 틀림, 메시지의 실제 ID 모양), pre-commit(깨끗한 인덱스 0, 인덱스의 서명 토큰), pre-push(가짜 origin·private로 정상 공개 브랜치 0, 비공개 커밋 merge, `private/master:refs/heads/x`, 새 커밋 blob의 서명 토큰, private 원격으로 0). pre-push 씨앗은 `CHZZK_HOOK_FAST=1`로 조건부 gate를 끈다(끌 수 없는 `push-guard`·`scan-range`만 본다).
25. **G2 리뷰 반영(16 (나)·18·20·14·15를 바꾼다).**
    (가) **`--message-file`은 원문 전체.** 16 (나)의 "`#` 줄과 scissors 아래를 버림"은 git이 `cleanup=strip`일 때만 맞다. `git commit -m`·`-F`·`--cleanup=verbatim|whitespace`는 `#` 줄과 scissors 아래도 이력에 남긴다(실측: `-m 'fix: x' -m '# …'`가 `%B`에 남았다). 훅은 cleanup 모드를 알 수 없으므로 원문 전체를 본다(모든 모드의 상위 집합). 대가: `commit -v`로 누출을 지우는 커밋을 만들면 scissors 아래 diff의 지운 줄이 걸린다(`-v` 없이 커밋한다). `cleanMessage`는 지웠다. 재발 검사: `public-scan.test.mjs`(`#` 줄·scissors 아래·denylist), selftest 씨앗 "# 줄의 실제 ID".
    (나) **제목 형식은 CI도 강제(`subjects` gate, 20을 바꾼다).** 훅(`commit-msg.mjs <파일>`)은 편집기 기준으로 첫 비주석 줄을 제목으로 본다(`core.commentChar`, 없거나 `auto`면 `#`; `rebase -i` 템플릿이 `#` 줄로 시작하므로 첫 줄 그대로는 쓸 수 없다). 그래서 `-m '# x' -m 'fix: y'`(저장된 제목은 `# x`)는 훅을 지난다. CI의 `subjects`(`commit-msg.mjs --stored`, lint 작업)는 `HEAD --not 0b66887…`(규칙을 시작한 공개 master, `SUBJECT_BASELINE`)의 저장된 메시지 첫 줄을 그대로 본다. 기준선 이전 이력에는 규칙 이전 제목("Update .gitignore" 등)이 있다. 기준선이 없으면(얕은 클론) 2. 실패 로그에는 제목 원문 없이 SHA와 이유만 찍는다. merge·`Revert "`·`fixup!` 등 git이 만드는 제목은 통과(PR 체크아웃의 `Merge <sha> into <sha>` 포함). Dependabot 커밋은 `commit-message.prefix`(`ci`·`build`, `include: scope`)로 `ci(deps): …`·`build(deps): …`가 된다.
    (다) **비공개 커밋 지문(18·15를 바꾼다).** `scripts/ci/private-commits.txt`는 `git rev-list --remotes=private --not --remotes=origin`(fetch 직후 133개)의 `commit:<sha256(salt, "commit", sha)>` 줄을 정렬·중복 제거한 것이다(`public-scan.mjs --hash-commit`, 다시 만들면 바이트 동일: `cmp`로 확인). public-scan은 이 파일을 기본 denylist로 읽고, 이력·범위 검사에서 커밋 SHA가 맞으면 `private-commit`으로 실패한다(`commit:` 항목은 글자 n-gram을 켜지 않는다). 실측: 공개 저장소의 새 클론에서 `--all-history` 깨끗함(exit 0), 이 클론에서 `--rev-range private/master --not-remote origin`은 `private-commit` 128건으로 exit 1. push-guard는 P에 지문을 더하고(3.3 4번), 목록이 낡으면 거부한다(3.3 7번). 테스트·selftest는 임시 저장소의 지문 파일을 쓴다(`PUSH_GUARD_FINGERPRINTS`, 없는 경로면 2. selftest는 사본의 `private-commits.txt`를 바꾼다). `HOOK_ONLY`의 값은 배열이고 짝이 모두 ci.yml에 있어야 한다: `scan-staged` → `scan`, `scan-msg` → `scan-history`·`subjects`, `scan-range`·`push-guard` → `scan-history`. 블롭 지문은 두지 않았다: 작은 비공개 blob(빈 파일, 공용 설정)이 공개 이력에 정당하게 다시 나올 수 있다.
    (라) **조건부 gate는 커밋·push될 내용에서 돈다(14를 바꾼다, `scripts/ci/snapshot.mjs`).** 전에는 작업 트리에서 돌아 올리지 않은 변경·추적하지 않는 파일이 결과를 바꿨다(실측: 추적하지 않는 훅 파일 때문에 `scripts-test`가 1/76 실패). pre-commit: 작업 트리 = 인덱스(`git diff --quiet`, 무시되지 않는 새 파일 없음)면 제자리, 아니면 인덱스(`GIT_INDEX_FILE`을 따른다: `commit -a`·`commit <경로>`의 임시 인덱스)를 `write-tree`·`commit-tree --no-gpg-sign`으로 커밋 객체로 만들고(ref 없음) 임시 `git worktree add --detach`에서 돌린다. pre-push: push할 커밋마다(태그는 벗긴다, 같은 커밋은 한 번) 그 커밋 = HEAD이고 `git status --porcelain --untracked-files=all`이 비면 제자리, 아니면 그 커밋의 임시 worktree. 어느 쪽이든 **그 트리의 진입점** `node <트리>/scripts/ci/run.mjs <gate>`를 부른다(CI가 체크아웃한 커밋에서 하는 것과 같다). 임시 worktree에는 바깥 저장소의 install-tool 폴더를 PATH에 더하고 `CARGO_TARGET_DIR`을 바깥 `target/`으로 준다(없으면). `GIT_DIR`·`GIT_INDEX_FILE` 등은 지운다. worktree는 `finally`에서 지운다. 재발 검사: `snapshot.test.mjs`(가짜 진입점으로 인덱스 bad/작업 트리 good → 1, 그 반대 → 0, 새 파일, 임시 인덱스, 커밋 bad/작업 트리 good → 1, HEAD 아닌 커밋, worktree가 남지 않음), selftest 씨앗 "인덱스만 틀린 훅"(nonzero)·"작업 트리만 틀린 훅"(0). 실측(실제 git, 이 저장소): pre-push 훅 shim에 HEAD가 아닌 커밋 한 줄을 주면 "임시 worktree에서 돌린다: scripts-test"를 찍고 그 커밋의 `scripts-test`를 돌렸다(통과 커밋 0, 실패 테스트를 커밋한 쪽 1, 끝난 뒤 `git worktree list` 1줄·임시 폴더 0개). 스크래치 클론의 실제 `git commit`: 인덱스에만 틀린 훅 → 임시 worktree의 `parity` 실패로 거부, `commit -a`로 틀린 훅 → 제자리 `parity` 실패로 거부, `commit <다른 경로>`(git의 임시 인덱스)로 틀린 훅을 작업 트리에 둔 채 → 임시 worktree에서 통과.
    (마) **경로 조건.** pre-push `scripts-test`는 `.githooks/`·`.gitattributes`에도 돈다(parity.test의 100755 검사). pre-commit에 `parity`(빠르다)를 `.githooks/`·`.gitattributes`·`.github/`·`gates.mjs`·`tools.json`에 더했다. `app/src-tauri/`만 바뀐 push는 여전히 로컬 컴파일을 하지 않는다(14): `chzzk-app` 빌드는 `generate_context`가 `app/dist`를 포함해 frontend 빌드가 먼저 필요하므로 가볍지 않다. CI가 3 OS로 본다.
    (바) **merge 커밋의 경로.** `pushedPaths`의 `git log --name-only`는 merge 커밋의 경로를 내지 않아, 충돌 해결이나 merge 안에서만 고친 파일이 조건부 gate를 깨우지 못했다. `-m`(부모마다 비교, 넘치는 쪽이 안전)을 붙였다. 재발 검사: `push-guard.test.mjs`의 evil merge 시나리오(`-m`을 빼면 실패함을 확인했다).
    (사) **반영하지 않은 것.** 3.3의 "private 끝과 같으면 거부"·"30일 경고"는 18 (가)·(나)의 이유로 넣지 않고 본문을 18에 맞췄다. "private 원격이 있는데 ref가 없으면 실패"는 지문이 그 경우를 막으므로 경고로 남겼다.
    (아) **selftest 씨앗 55개**(24의 51개에 "# 줄의 실제 ID", "지문 목록 낡음", "인덱스만 틀린 훅", "작업 트리만 틀린 훅(0)"을 더했다).
    (자) **유지보수자 클론.** `node scripts/ci/run.mjs install-hooks`로 `core.hooksPath = .githooks`를 켰다. G2 커밋과 push가 실제 훅(pre-commit·commit-msg·pre-push의 `push-guard`·`scan-range`·`scripts-test`)을 거쳤다.
    (차) **수락 실행.** 678f3e6(G2 첫 커밋) 실행 37296642999, 3704269(리뷰 반영) 실행 37297700019 모두 `ci-ok` success. 37297700019에서 lint의 `scan-history`(지문 157개 중 commit: 133개로 공개 이력 깨끗함), `subjects`(16개 통과), `selftest`(55개), `scripts-test`(ubuntu 86개·windows 85개, push-guard 실제 push·지문·evil merge·snapshot 포함)가 녹색이다.

### G3 (스모크·ratchet·master 고리)

26. **앱 `--smoke`.** command `frontend_ready`(23번째, capabilities `allow-frontend-ready`)를 더했다. §6의 "프런트 `ready` invoke"를 이 이름으로 했다(`ready`는 뜻이 넓다). 프런트 `main.ts`가 mount 직후 `lib/ready.ts`로 한 번만 보낸다. Rust `src/smoke.rs`: `--smoke`면 single-instance를 붙이지 않고, 설정·데이터·로그를 `CHZZK_SMOKE_DIR`(없으면 `<temp>/chzzk-smoke-<pid>`)로 바꾸고, OS 비디오·다운로드 폴더와 옛 설정(legacy)을 보지 않는다. 신호가 오면 `CHZZK_SMOKE_OUT`에 `{"version","ready":true}`를 쓰고 exit 0(마커 쓰기 실패는 3), 60초 안에 없으면 감시 스레드가 `ready:false`를 쓰고 exit 2. 자세한 것은 app.md 구현 중 변경 56. 판정은 `scripts/ci/smoke.mjs`의 `checkMarker`(키가 정확히 `ready`·`version`, `ready === true`, `version` = `Cargo.toml [workspace.package] version`)와 종료 코드뿐이다. 바깥 시간 제한은 120초(SIGKILL)다.
27. **`smoke-bin`은 별도 gate.** §2는 `tauri` gate 안에 두었지만 로컬에서 `tauri` gate를 돌릴 때마다 창이 뜨지 않도록 `smoke-bin` gate(`smoke.mjs bin`)로 나누고 `tauri` 작업의 다음 단계로 둔다. Linux는 DISPLAY가 없으면 `xvfb-run -a`로 감싼다(`tauri` 작업 apt에 `xvfb xauth`). WebKitGTK 렌더러 환경 변수는 필요 없었다(실측: ubuntu-24.04 xvfb에서 1초 안에 마커).
28. **번들 작업 배치.** §2의 "bundle (3 OS) → smoke-install·size·glibc-floor·release-hygiene"를 셋으로 나눴다. (가) `bundle (linux)`: `ubuntu-24.04` 호스트 + `container: ubuntu:22.04@sha256:…`(index digest), root라 sudo 없는 `apt-get`(parity setup 허용 목록에 더함), `DEBIAN_FRONTEND=noninteractive`. 컨테이너에 rustup이 없어 `run.mjs install-rustup`이 `tools.json`의 `rustup-init` 1.29.1을 sha256 확인 후 `--default-toolchain none`으로 깔고, 툴체인은 늘 쓰던 `rustup toolchain install`이 `rust-toolchain.toml`에서 깐다. checkout 전에 `git`을 깐다. gate: `bundle` → `glibc-floor` → `release-hygiene` → `size`. (나) `smoke-install (linux)`: 24.04 호스트에서 artifact를 받아 deb(apt 설치 → `/usr/bin` 실행 파일 하나 → purge → `dpkg -s` 실패)와 AppImage(`APPIMAGE_EXTRACT_AND_RUN=1`)를 돌린다. (다) `bundle (macos-latest|windows-latest)` matrix: 같은 작업에서 `bundle` → `release-hygiene` → `size` → `smoke-install`. 세 작업 모두 `if: github.event_name != 'pull_request' && needs.changes.outputs.code == 'true'`(parity `MASTER_IF`, gates.mjs `MASTER_ONLY_JOBS`). §2의 "push master만"과 달리 `workflow_dispatch`에서도 돈다: master에 push할 수 없는 동안 이 경로를 확인할 유일한 방법이고, dispatch의 녹색 `ci-ok`도 "모든 작업이 실제로 돌았다"는 뜻을 지킨다(13 (나)).
29. **`bundle` gate와 기대 집합.** `release/expected-artifacts.json`이 OS별 `arch`, `--bundles`(Linux `appimage,deb`, macOS `app,dmg`, Windows `nsis,msi`), 허용 폴더, 산출물(종류·폴더·확장자·정식 이름·설치 방법·크기 키)을 정한다. gate는 `pnpm tauri build --ci --no-sign --bundles <표>` 뒤 `bundle.mjs collect`가 `target/release/bundle/<폴더>/`마다 확장자가 맞는 파일이 **정확히 하나**인지, 표 밖 폴더가 없는지, 러너 arch가 표와 같은지 보고 `target/ci/bundle/chzzk-downloader_<버전>_<이름>`으로 모은 뒤 `bundles.json`(종류·파일·바이트·sha256)을 쓴다. §2의 `xtask collect --expect`는 G6에서 이 표를 이어받는다(updater 산출물을 더한다). 실측: macOS는 `bundle/share`도 만들어 허용 폴더에 더했다. productName이 한글이라 정식 이름은 ASCII다.
30. **설치 스모크 실측.** (가) Linux AppImage는 GL 스택(libEGL·libGLESv2·mesa)을 번들하지 않고 사용자 시스템 것을 쓴다. 24.04 러너에는 없어 첫 실행이 `libEGL.so.1`, 다음이 `libGLESv2.so.2`로 exit 127이었다. 데스크톱 배포판에는 있는 것이라 스모크 호스트에 `libegl1 libgles2 libegl-mesa0 libgl1-mesa-dri`를 깔았다(앱 결함이 아니라 호스트 전제). deb는 apt가 의존성을 깔아 처음부터 통과했다. (나) Windows NSIS는 `%LOCALAPPDATA%\<productName>`에 깔리고(`chzzk-app.exe`) `setup.exe /S`·`uninstall.exe /S` 뒤 폴더가 사라지는 것을 60초까지 기다린다. (다) MSI의 설치 폴더는 `Program Files\<productName>`이 아니었다. 추측하지 않고 `msiexec /l*v` 로그(UTF-16LE)의 마지막 `Property(S): INSTALLDIR = …`를 읽는다(`msiInstallDir`). 종료 코드는 0과 3010(재부팅 필요)을 성공으로 본다. (라) 설치기·제거기 명령마다 300초 시간 제한을 두고 명령 줄을 먼저 찍으며, `smoke-install` 단계에 `timeout-minutes: 20`을 둔다. 실측: 한 실행에서 Windows `smoke-install`이 20분 넘게 멈췄고 실행을 취소하자 작업 로그가 사라져(BlobNotFound) 어디서 멈췄는지 알 수 없었다. 단계 시간 제한은 실패로 끝나 로그가 남는다.
31. **`glibc-floor`·`release-hygiene`.** `artifact-check.mjs glibc`가 `objdump -T`의 `GLIBC_x.y` 최댓값을 수로 비교해 2.35 이하인지 본다(실측 2.34). `hygiene`은 릴리스 바이너리 바이트에 E2E 환경 변수 접두사가 없는지와 `cargo tree -e features -p chzzk-app --target all`에 **이 워크스페이스 crate**(`chzzk-app|core|shell`)의 `feature "e2e"`가 없는지 본다(서드파티의 같은 이름 feature는 무관하다). `glibc-floor`는 Linux 작업에만 있다.
32. **ratchet.** (가) 측정은 `measure.mjs`(평평한 키 경로 JSON, `target/ci/measure/<종류>.json`), 판정·조이기·로그 검사는 `ratchet.mjs`(순수 함수 `judge`·`tighten`·`loosened`). gate: `coverage`(llvm-cov 줄 % + vitest v8 줄 %), `test-count`(`cargo llvm-cov … --no-report -- --list --format terse`의 `: test` 줄 수 + vitest json reporter의 `numTotalTests`), `size`(dist 파일별 gzip level 9 합, 릴리스 바이너리, 번들). `test-count`를 먼저 돌려 llvm-cov 계측 빌드를 `coverage`와 나눠 쓴다(따로 `cargo test --list`를 하면 계측 없는 빌드를 한 번 더 한다). §2의 "test-count PR"·"coverage PR(ubuntu)"은 `coverage` 작업 하나(`CODE_GATED_JOBS`)다. (나) vitest 커버리지 대상은 `vite.config.ts`에서 `src/**/*.{ts,svelte}`로 고정했다(테스트가 닿은 파일만 세면 분모가 흔들린다). bindings·테스트 도구·선언 파일은 뺐다. (다) 기준 0은 "안 잼"이라 통과하고 `::notice::`만 남긴다. ratchet.json에 없는 키가 측정에 나오면 실패한다. `mutants_missed`는 G5가 더한다. (라) artifact 이름은 §4.2의 `ratchet-measurements` 하나가 아니라 `ratchet-measurements-coverage`·`-size-linux`·`-size-<matrix os>`다(upload-artifact v4+는 작업 사이에 같은 이름을 못 쓴다). `ratchet.mjs write --from-run <id>`가 `ratchet-measurements-*`를 모두 받아 합친다(같은 키가 다른 값이면 오류). 측정 artifact는 7일, 번들 artifact는 1일 보관한다. (마) "내리기는 RATCHET_LOG.md에 키를 적은 줄"은 `ratchet-log` gate(`lint`)다: `RATCHET_BASE`(PR은 base sha, push는 `github.event.before`, dispatch는 비어 건너뜀) 대비 느슨해진 키(값 낮춤·크기 키움·0으로 되돌림·삭제·허용치 확대)마다 `git diff <base> -- ci/RATCHET_LOG.md`의 더한 줄에 그 키 경로가 글자 그대로 있어야 한다.
33. **`ci-ok`·parity 규칙 확장(8·13 (가)를 바꾼다).** guard: push·dispatch는 skipped가 하나라도 있으면 실패, pull_request는 `MASTER_ONLY_JOBS`의 skipped를 늘 허용하고 `CODE_GATED_JOBS`(이제 `coverage` 포함)의 skipped는 `changes.code == 'false'`일 때만 허용한다. 식의 마지막 줄은 parity `ciOkGuard()`가 `CODE_GATED_JOBS`에서 만든다(작업을 더하면 guard 글자도 바뀌어야 한다). `decideCiOk`도 같은 규칙이다. job-if 허용 식은 `CODE_IF`, `MASTER_IF`(이 작업은 needs에 `changes`가 있어야 한다), report의 `REPORT_IF` 셋이다. `CI_OK_EXEMPT = ['report']`(ci-ok 결과를 읽는 고리 작업이라 ci-ok 뒤에 돌고, parity가 `needs: ci-ok`를 요구한다). pin-check에 `image` 규칙을 더했다: `container:`·`image:`는 글자 그대로 `<이름>@sha256:<64 hex>`.
34. **`issue.mjs`와 `report` 작업.** (가) 본문은 허용 목록 필드(고리 이름, 상태, 실행 URL `https://github.com/<o>/<r>/actions/runs/<n>`, 40자리 SHA, 작업 이름 `^[A-Za-z0-9 ()._,/-]{1,80}$`, kind enum, 워크플로 파일 이름)만이고 자유 문자열은 받지 않는다. 게시 전 `scanText()`(저장소 denylist 포함)에 걸리면 게시하지 않고 실패한다. label `ci-loop:<이름>`은 처음 열 때 `gh label create --force`로 만든다. 같은 label이어도 본문이 마커로 시작하지 않는 이슈(사람이 연 것)는 건드리지 않는다. gh 실행기를 주입해 단위 테스트한다(`issue.test.mjs`: 생성 → 댓글 → 닫기 → 없음 → 다시 생성). (나) `report`(ubuntu, `needs: ci-ok`, `concurrency: ci-report`)는 `run.mjs report` 하나다: `master-failure`(ci-ok가 success가 아니면 실행의 작업 목록 API에서 failure·cancelled·timed_out 작업 이름을 모아 연다/댓글, success면 닫는다), keep-alive와 `nightly-stale`(대상은 `.github/workflows`에서 `schedule:`이 있는 파일. G5·G6가 더하면 따라온다. `disabled_inactivity`면 `gh workflow enable`, 마지막 master 성공(없으면 워크플로 생성 시각)이 72시간보다 오래면 연다. 기본 브랜치에 아직 없는 파일(404)은 건너뛴다. 지금은 예약 워크플로가 없어 늘 ok). 권한은 `contents: read`, `issues: write`, `actions: write`. (다) 조건 `REPORT_IF`: push master, 또는 `workflow_dispatch`이면서 입력 `loop_test`가 참일 때. 브랜치 dispatch가 실수로 master 이슈를 닫지 않도록 입력으로만 켠다. (라) dispatch 입력 `force_fail`: `changes`가 `code=false`를 내 무거운 작업을 건너뛰게 하고(push·dispatch의 skipped라 guard가 실패), `run.mjs ci-ok`도 `CI_FORCE_FAIL`이면 실패한다. 고리를 2분 안에 확인하는 용도다.
35. **G3 리뷰 반영(32·34를 바꾼다).** (가) **테스트 수는 실제로 도는 것만.** Rust는 `--list` − `--list --ignored`(`countActive`), vitest는 `numPassedTests`(skip·todo 제외). 전에는 `#[ignore]`·`it.skip`으로 끈 테스트도 세어 ratchet을 피했다. 재발 검사: `measure.test.mjs`(ignore 하나·skip/todo 하나면 수가 준다). (나) **`tests.app.<os>`.** chzzk-app 테스트 수는 webkit 의존이 있어 `coverage` 작업이 아니라 `tauri` 작업(3 OS) 끝의 `test-count-app` gate(`measure.mjs tests-app`, 같은 테스트 빌드의 `cargo test -p chzzk-app -- --list`)가 OS별 키로 잰다. artifact `ratchet-measurements-tests-app-<matrix os>`. chzzk-app 커버리지는 재지 않는다. (다) **기준 0은 `$pending`에서만.** `ratchet.json`의 `$pending`에 있는 키만 0(안 잼)으로 통과하고, 0인데 `$pending`에 없으면 `judge`가 실패한다. `ratchet.mjs lint`(`ratchet-log` gate의 첫 단계)는 0인 키가 모두 `$pending`에 있고, `$pending`이 `PENDING_ALLOWED`(지금 `tests.playwright`. G4·G5가 키를 더할 때 늘린다) 안이며 값이 0인지 본다. `tighten`은 채운 키를 `$pending`에서 뺀다. (라) **size 역방향 검사.** `ratchet check size`는 이 OS의 기준 키(`size.dist_gz`, `size.binary.<os>`, `size.bundle.<os>-*`)가 측정에 없으면 `missing`으로 실패한다. `ratchet.test.mjs`는 `size.bundle.*` 키 집합이 `release/expected-artifacts.json`에서 만든 집합과 같은지 본다(표에서 산출물을 지우면 키도 지워야 하고, 지우기는 느슨하게 하기라 RATCHET_LOG 줄이 필요하다). (마) **`write --from-run` 출처 검사.** `gh api repos/<origin>/actions/runs/<id>`로 event ∈ {push, workflow_dispatch}, head 저장소·저장소 = origin, conclusion success, 워크플로 `ci.yml`인지 본다(fork PR 실행이 PR 코드로 잰 값을 막는다). 브랜치는 묻지 않는다(master에 push하기 전에는 브랜치 dispatch가 유일한 출처다). `tighten`은 값이 유한·0 이상·커버리지 ≤ 100·tests/size 정수인지 본다. (바) **커버리지 기준은 0.1 단위로 내린다**(`coverageFloor`). 같은 커밋의 Rust 줄 커버리지가 실행마다 95.8/95.79로 흔들려(실행 37304299497·37304301415) 운 좋은 값이 기준이 되지 않게 한다. (사) **report는 머리 커밋만.** `master-failure`는 `GITHUB_SHA`가 `gh api repos/<r>/git/ref/heads/<GITHUB_REF의 브랜치>`의 머리일 때만 열고 닫는다(실행은 커밋 순서대로 끝나지 않는다: 느린 옛 커밋의 실행이 늦게 끝나 틀린 상태를 쓰던 것). 브랜치 dispatch(`loop_test`)는 그 브랜치의 머리와 비교한다. `concurrency`는 `ci-report-<sha>`로 커밋마다 둔다(한 그룹의 대기 작업은 하나뿐이라 공유하면 옛 커밋의 보고가 머리 커밋의 대기 보고를 취소했다). 재발 검사: `issue.test.mjs`(옛 커밋의 녹색은 닫지 않고, 옛 커밋의 빨강은 열지 않는다). report 자신이 실패하면 실행이 빨갛게 끝나 GitHub 알림이 가고, 다음 머리 커밋의 report가 상태를 다시 맞춘다(멱등). 매일 다시 맞추는 것은 G5 nightly가 한다. (아) **설치 스모크 시간 예산.** 명령별 제한을 240초로 줄이고 최악의 합 `installBudgetMs`(linux 20분, darwin 22분, windows 27분: Windows는 시간 제한마다 진단 두 개 포함)가 `smoke-install (linux)` 작업 제한(30분)과 `bundle`의 `smoke-install` 단계 제한(30분)보다 작은지 `smoke.test.mjs`가 ci.yml을 읽어 본다. Windows에서 시간 제한에 걸리면 `tasklist /v`로 남은 프로세스를 남기고 `taskkill /T /F /PID`를 해 본다(spawnSync는 직계 자식만 죽이므로 손주가 남을 수 있다. 목록이 원인 추적의 근거다). 30 (라)의 멈춤은 그 뒤 3번(37309780020, 37313687915 등)의 Windows 번들·설치 스모크에서 다시 나지 않았다(37313687915: `bundle (windows-latest)` 11분 20초). (자) **수락 실행.** `force_fail=true loop_test=true` 실행 37313500324가 이슈 #2(`ci-loop:master-failure`, 본문은 실행 URL·커밋·`ci-ok`뿐)를 열었고, `loop_test=true` 녹색 실행 37313687915(모든 작업 success, bundle 3 OS·smoke-install 포함)의 report가 #2에 복구 댓글을 달고 닫았다. 기준은 `ratchet.mjs write --from-run 37313687915`로 채웠다(coverage rust 95.7·frontend 91, tests rust 348·vitest 491·app 32×3, size 15개). 이제 `$pending`은 `tests.playwright` 하나다.

### G4 (E2E)

36. **D14 관찰 작업(`gates.mjs` `OBSERVED_JOBS`).** §6 끝의 "2주 관찰 뒤 `ci-ok`에 넣는다"를 표로 했다: `{ 'e2e-web': 'code', 'e2e-native': 'master' }`(값은 작업 if 종류). 13 (라)가 적은 "`CI_OK_EXEMPT`에 이유와 함께 넣는다"는 쓸 수 없었다: parity가 `CI_OK_EXEMPT` 작업에 `needs: ci-ok`를 요구하는데(ci-ok 뒤에 도는 report용 규칙) E2E는 ci-ok 뒤에 돌면 안 된다. 그리고 관찰 작업을 `CODE_GATED_JOBS`에 넣으면 ci-ok guard 식이 `needs.e2e-web.result`를 읽게 되는데 actionlint는 그 작업이 ci-ok의 `needs`에 없으면 거부한다. 그래서 (가) `CODE_GATED_JOBS`·`MASTER_ONLY_JOBS`·guard·`decideCiOk`는 그대로 두고, (나) parity의 job-if 비교만 "CODE_IF를 단 작업 = `CODE_GATED_JOBS` + 관찰 code 작업", "MASTER_IF를 단 작업 = `MASTER_ONLY_JOBS` + 관찰 master 작업"으로 넓히고, (다) 새 규칙 `observed`: 관찰 작업은 ci.yml에 있고, ci-ok `needs`에 없고(있으면 기존 ci-ok 규칙이 "있으면 안 되는 작업"으로 잡는다), `needs`에 ci-ok가 없고, **report의 `needs`에 있다**. (라) "관찰 기간의 실패는 `master-failure` 이슈로만 본다"를 실제로 하려고 report가 `NEEDS`(`toJSON(needs)`)를 받고 `issue.mjs masterStatus`가 ci-ok가 success여도 관찰 작업이 failure·cancelled면 `fail`로 본다(skipped는 실패가 아니다: `force_fail` dispatch). 이것이 없으면 master의 빨간 E2E가 조용히 묻히고 다음 녹색 ci-ok가 이슈를 닫는다. 재발 검사: `issue.test.mjs`(masterStatus 표, "ci-ok 녹색 + 관찰 작업 실패면 열고 다음 녹색에 닫는다"), `parity.test.mjs`·selftest 씨앗 둘(관찰 작업을 report needs에서 뺌, 관찰 중인 `e2e-web`을 ci-ok needs에 넣음), `run.test.mjs`(관찰 작업은 두 목록과 겹치지 않는다). **편입**(2주 뒤): `OBSERVED_JOBS`에서 빼고 `CODE_GATED_JOBS`/`MASTER_ONLY_JOBS`로 옮긴 뒤 ci.yml ci-ok의 `needs`와 guard 마지막 줄(parity `ciOkGuard()`가 만든다)을 고치는 한 변경이다. 날짜로 실패하는 검사는 두지 않았다(원칙 1). 관찰 시작일과 편입 예정일은 ROADMAP Phase 4에 적는다.

37. **`e2e-web`(웹 E2E).** §6대로 Playwright 1.63.0(`@playwright/test`)·`axe-core` 4.13.0(둘 다 정확한 버전, `app/package.json` devDependencies)·chromium 하나다. (가) **실제 프로덕션 dist.** gate가 `pnpm build` 뒤 `vite preview --strictPort`(Playwright `webServer`)로 띄운다. 가짜 백엔드는 앱 번들에 넣지 않고 Playwright `globalSetup`이 `vite build`(lib, IIFE)로 `target/e2e-web/mock/mock.js` 하나로 묶어 `page.addInitScript`로 앱보다 먼저 싣는다. 두 사본의 `@tauri-apps/api`는 `window.__TAURI_INTERNALS__`에서 만난다. 시나리오(`resolve` 표·스냅샷 작업·설정)는 그 앞의 init script가 `window.__E2E_SCENARIO__`로 넘긴다. (나) **가짜 백엔드**(`app/e2e/mock/backend.ts`): `mockIPC(…, {shouldMockEvents: true})`로 23개 command를 모두 받고(모르는 command는 `internal` 오류라 테스트가 `console.error`로 실패한다), `subscribe_jobs`의 Channel에는 `runCallback(id, {index, message})`로 보낸다(Channel이 index 순서로 재정렬하므로 실제 IPC와 같은 경로를 탄다. §6의 "callback id를 잡아 흉내 낸다"). 진행은 코어 `Progress` 모양을 따른다(빠른 다시보기는 조각·미디어 초, progressive는 바이트. 처음에 바이트만 넣었더니 HLS 진행 막대가 `aria-valuenow` 없는 indeterminate였다). 시간·타이머를 쓰지 않는다: 진행·완료·실패와 `close-requested`는 테스트가 `window.__e2e`로 하나씩 일으키고, 생성·완료 시각은 고정 값에서 센다. 앱이 부른 command는 인자까지 `calls`에 남는다. (다) **spec 7개**: `flow`(URL → 카드 → 720p → `enqueue` 인자 전체 → 진행 25% → 일시정지·이어받기 → 완료 알림 → 완료 지우기; 받는 중 취소 → D2 → `remove_job`), `errors`(copy deck의 오류 카드 전부: 28개 `ErrorCode` × 불러오기 InlineAlert·목록 항목의 제목·본문·동작 버튼, 기대값은 앱과 같은 `errorCopy`·`actionLabel`이 만든다. 표 내용 자체는 vitest가 본다; [다시 시도] → 같은 주소 재요청 → 카드), `settings`(즉시 저장 패치 세 개, 쿠키 두 값 필요 → 저장 → 입력 비움, 뒤로 → 입력줄 포커스; 닫기 가드 [계속 받기]는 `quit` 없음, [닫기]는 `quit` 한 번). (라) **판정**: 종료 코드. 각 화면에서 axe(`wcag2a·2aa·21a·21aa·22aa`) 위반 0, 모든 테스트에서 `pageerror`·`console.error` 0. axe는 `document.getAnimations()`가 모두 끝난 뒤에 돈다(열리는 중인 전환의 중간 색을 재지 않게). (마) **결정성**: `workers: 1`, `retries: 0`, `forbidOnly`, `ko-KR`·`Asia/Seoul`·light·`reducedMotion: reduce`, 창 크기 960×700(tauri.conf.json). 산출물은 모두 `target/e2e-web/`(보고서 JSON, `results/`의 trace·스크린샷은 실패할 때만). (바) **CI**: ubuntu-24.04, `CODE_IF`(PR에서도 돈다), 브라우저는 gate 안의 `pnpm exec playwright install chromium`이 받는다(parity가 raw `run:`을 막는다. `--with-deps` 없이 ubuntu-24.04 러너에서 돌았다, 실측). 실패하면 artifact `e2e-web-trace`(7일). (사) **ratchet `tests.playwright`**: `measure.mjs tests-playwright`가 보고서의 `stats.expected`(통과 수)를 재고, `unexpected`·`flaky`가 있으면 측정 실패다. artifact `ratchet-measurements-tests-playwright`로 `write --from-run`이 읽는다. (아) `pnpm check`에 `tsc -p tsconfig.e2e.json`(spec·mock·config)을 더했다. spec은 `app/e2e/*.spec.ts`라 vitest(`src/**/*.test.ts`)와 커버리지 대상에 들어가지 않는다.

38. **axe가 앱 결함 둘을 찾았다**(첫 로컬 실행). 입력줄 예시 글자가 3:1 토큰이었고, 설정 화면의 전역 `.label` 규칙이 강조 버튼 글자를 본문색으로 바꿔 대비 2.77이었다. 앱을 고쳤다(app.md 구현 중 변경 58). vitest(jsdom)는 계산된 색을 보지 않아 이 층에서만 잡힌다.

39. **cargo feature `e2e`(`app/src-tauri/src/e2e.rs`).** 환경 변수 `CHZZK_E2E_API_BASE`·`CHZZK_E2E_DIR`이 **둘 다** 있을 때만 켜진다(하나만 있으면 setup 오류로 시작하지 않는다: 반쯤 켜진 E2E가 실서버나 사용자 폴더를 쓰지 않게). API 주소는 루프백(`127.0.0.1`·`localhost`·`[::1]`)의 http만 받는다(E2E 빌드가 퍼져도 외부로 요청하지 않는다). 폴더는 절대 경로이고 그 아래 `config`·`data`·`logs`, 기본 저장 폴더 `data/downloads`(OS 폴더를 주지 않는다)를 쓴다. single-instance와 옛 설정 찾기는 스모크처럼 끈다. 클라이언트는 `App::open_with`(코어 `Endpoints` 두 개를 그 주소로)라 코어·셸은 바꾸지 않았다. `url`은 이 feature에서만 켜는 optional 의존성이다. E2E 글자(`CHZZK_E2E_`)는 `e2e.rs`에만 있어 보통 빌드에는 한 바이트도 없다. 테스트 5개(둘 다 없음·빈 값 → 끔, 하나만 → 오류, 루프백 http만, 상대 경로 거부, 경로·엔드포인트)는 `--features e2e`일 때만 컴파일되므로 `e2e-native` gate가 `cargo clippy -p chzzk-app --features e2e --all-targets`와 `cargo test … --features e2e --lib -- e2e::`를 돌린다.

40. **`hygiene-seed`와 `release-hygiene`의 구멍.** §10 G4 수락 기준 "`release-hygiene`가 `--features e2e` 씨앗 빌드에 실패"를 한 번 확인하고 끝내지 않고 gate로 남겼다: `e2e-native` 작업이 만든 e2e debug 바이너리에 `artifact-check.mjs hygiene-seed`가 hygiene의 두 검사를 거꾸로 돌려 **둘 다 걸려야** 통과한다(바이트에 `CHZZK_E2E_` 있음, `cargo tree --features e2e`에 e2e feature 줄 있음). 처음 돌리자 두 번째가 실패했다: `cargo tree -e features -p chzzk-app`(정방향)은 의존성(chzzk-core·shell)의 feature만 보이고 **루트 crate 자신의 feature는 보이지 않는다**. 그래서 31의 hygiene은 `default = ["e2e"]` 같은 실수를 잡지 못했다. `-i chzzk-app`(역방향, `chzzk-app feature "e2e" (command-line)`가 보인다)을 더해 둘을 이어 본다. hygiene과 씨앗이 같은 함수(`cargoTreeFeatures`·`e2eFeatureLines`·`E2E_MARK`)를 쓰므로 검사를 바꾸면 씨앗이 바로 알려 준다.

41. **fixture 서버(`scripts/ci/e2e-fixture-server.mjs`).** `testdata/hls/`(빠른 다시보기 합성 영상 하나)만 서빙한다: `/service/v2/videos/9000001` → info(미디어 호스트 `*.example.invalid`를 서버 주소로, 이중 인코딩 JSON 안도 단순 치환), `…/vod_playlist.m3u8` → master, `…/vod_chunklist.m3u8` → media의 앞 두 조각 + `#EXT-X-ENDLIST`(fixture 조각 파일이 seg0·seg1뿐이다), `…p_0_0_0.m4s` → init, `…p_seg0|1.m4v` → 조각. 그 밖은 404. 어느 화질을 골라도 같은 media·조각이 나간다. 기대 결과는 init‖seg0‖seg1(코어 `fixture_concat_box_order`와 같은 기대값)이고 sha256은 서버가 fixture에서 계산한다(`expectedOutput()`). HLS 하나로 info → master → media → init → 조각 → 이어 붙이기 → 마무리 rename까지 한 흐름이 다 지나간다. 테스트: `e2e-fixture-server.test.mjs`(실제 HTTP로 한 바퀴, 기대 sha256이 받은 바이트와 같음, 범위 밖 조각·다른 영상 404).

42. **`e2e-native` 실행기(`scripts/ci/e2e-native.mjs`).** (가) **WebdriverIO 대신 최소 W3C WebDriver 클라이언트**(Node `fetch`, 명령 여덟 개: 세션 생성·삭제, 요소 찾기, 클릭, 글자 입력, 스크립트 실행, 스크린샷, `/status`). §2·§6의 WebdriverIO는 쓰지 않는다: 쓰는 명령이 이것뿐이고 WebdriverIO는 의존성 트리가 크며(공급망·lockfile·`minimumReleaseAge`) 버전 고정할 곳이 하나 더 생긴다. (나) **흐름**: 입력줄(`#url-input`)에 `https://chzzk.naver.com/video/9000001`(합성 fixture 번호) → [불러오기] → 카드의 [다운로드]가 눌릴 수 있을 때(check_output 뒤) 클릭 → 목록 항목이 "완료"(실패 클래스면 바로 실패). 화면 글자는 기다림의 신호로만 쓰고 **판정은 파일**이다: `data/downloads`에 `.mp4` 정확히 하나, `.part`·`.part.json` 없음, sha256·크기가 기대값과 같음, 서버 요청이 모두 200이고 info·master·media·init·seg0·seg1을 모두 받음. 결과는 `target/ci/e2e-native/result.json`. 실패하면 같은 폴더에 스크린샷·페이지 HTML·드라이버 로그·앱 로그를 남기고 artifact `e2e-native-<os>`(7일)로 올린다(합성 fixture뿐이라 공개해도 된다). (다) **tauri-driver 2.1.0**: taiki-e/install-action manifest에 없고 릴리스 바이너리도 없어 `run.mjs install-tool tauri-driver`가 `cargo install --locked --version 2.1.0 --root <ci-tools>`로 깐다(`tools.json`의 `cargoInstall`). `--version` 플래그가 없어 `probeTool`은 있는지만 본다(버전은 설치 명령이 고정한다). (라) **gate `platforms`**: `e2e-native`는 `['linux', 'win32']`이다. 다른 OS에서 로컬은 경고하고 건너뛰고(0) CI는 2다(`run.test.mjs`). macOS에는 WebDriver가 없다(§6). (마) Linux는 DISPLAY가 없으면 `xvfb-run -a`로 tauri-driver를 감싼다(드라이버 → WebKitWebDriver → 앱이 같은 X 서버를 쓴다). WebKitWebDriver는 apt `webkit2gtk-driver`. Windows는 러너 이미지의 `EDGEWEBDRIVER` 폴더의 `msedgedriver.exe`를 `--native-driver`로 준다. 그 버전이 러너의 WebView2 런타임과 맞아야 한다 **[확인 필요: 첫 weekly·PR 실행에서 본다]**. (바) 포트는 4444·4445로 고정한다(러너는 비어 있다). 앱에 주는 환경 변수는 tauri-driver 프로세스의 환경으로 넘긴다(드라이버가 앱을 띄울 때 물려받는다).

43. **`nightly.yml`을 G4에서 만든다(G5가 더한다).** 작업은 `e2e-native (linux)`(매일 `17 18 * * *` = KST 03:17)와 `e2e-native (windows)`(매주 `47 18 * * 0` = 월 KST 03:47, 또는 dispatch 입력 `windows`)다. 고리: `report` 작업이 `run.mjs report-loop`(`issue.mjs reportLoop`, env `LOOP=e2e-native`·`NEEDS`)로 needs 중 failure·cancelled가 있으면 `ci-loop:e2e-native` 이슈를 열고(본문은 실패한 작업 id·실행 URL·커밋뿐) 녹색이면 닫는다. 예약 실행과 `loop_test` dispatch에서만 보고한다. 네이티브 E2E는 결정적으로 설계했으므로 drift(§4.3)와 달리 한 번 실패에 연다. 34의 `nightly-stale`이 이제 이 파일을 본다. **PR 경로 트리거를 더했다**(§2에 없음): `nightly.yml`·`e2e-native.mjs`·`e2e-fixture-server.mjs`·`e2e.rs`를 고치는 PR에서 두 작업이 돈다(보고는 하지 않는다). Windows 경로는 weekly에만 돌아 고친 것을 머지 전에 확인할 길이 없기 때문이다. 실측: master에 없는 워크플로도 `gh workflow run nightly.yml --ref ci/pipeline`으로 dispatch된다(실행 37320210050). PR 경로 필터는 마지막 push가 아니라 PR 전체 diff로 판정한다(이 PR에서는 push마다 돌았다).

44. **Windows 네이티브 E2E는 미해결이다 [확인 필요].** 첫 실행(37320692512, 37322667145)에서 tauri-driver → msedgedriver 세션 생성이 `session not created: DevToolsActivePort file doesn't exist`로 실패했다. 앱은 떴다(앱 로그의 "앱 시작", 세션 요청 24초 뒤. debug 빌드라 느리다)이고 오류는 세션 요청 63초 뒤(msedgedriver의 60초 기다림)다. 버전 불일치는 아니었다: 실행기가 레지스트리 EdgeUpdate Clients에서 이름이 "Microsoft Edge WebView2 Runtime"인 키의 `pv`를 읽어 러너 `EDGEWEBDRIVER`의 msedgedriver `--version`과 비교하는데(다르면 그 버전을 `msedgedriver.microsoft.com`에서 받는다. 해시는 버전이 러너마다 바뀌어 미리 고정할 수 없어 받은 sha256을 로그에 남긴다) 둘 다 153.0.4234.48로 같았다. 남은 가설: wry가 WebView2 환경을 `data_directory`·`AdditionalBrowserArguments`로 직접 만드는 것과 msedgedriver가 환경 변수로 넘기는 디버깅 포트·사용자 데이터 폴더의 관계, 러너 세션의 WebView2 시작 시간. 그래서 (가) Windows 작업은 PR 경로 트리거에서 뺐다(43을 바꾼다. Linux만 PR에서 돈다), (나) weekly·dispatch(`windows=true`)에서는 그대로 돌아 실패가 `ci-loop:e2e-native` 이슈로 남는다(고리가 미해결을 추적한다), (다) 고치는 동안 `gh workflow run nightly.yml -f windows=true`로 확인한다. Windows 설치본의 기동은 G3의 `smoke-install`(NSIS·MSI, `--smoke`)이 매 master에서 본다.

45. **e2e-native 실행기 실측 수정(42를 고친다).** (가) W3C 요소 키 상수를 잘못 적었다(`element-6066-11e4-a52e-4f735466cecf`가 맞다). 응답에서 키를 못 찾으면 조용히 거짓이 되어 "60초 안에 되지 않았다"로만 보였다(37320210050). 이제 `elementId`가 W3C 키·옛 `ELEMENT` 키를 받고, 둘 다 없으면 응답 JSON을 보이며 예외를 던진다(다음 실행 37322667145가 이 메시지로 오타를 드러냈다). 재발 검사: `e2e-native.test.mjs`. (나) 44의 WebView2·msedgedriver 버전 확인. 레지스트리의 앱 GUID를 적으면 `public-scan`의 hex-id 규칙에 걸려(pre-commit이 막았다) 이름으로 찾는다.

46. **수락 실행.** (가) **`e2e-web` PR 녹색**: PR 실행 37320198825·37324417472, dispatch 37320205221. (나) **씨앗 UI 회귀**: 23929c7이 `JobList`의 [완료 항목 지우기]를 빼자 PR 실행 37320692350에서 `e2e-web`이 실패했고(`flow.spec.ts` '…끝까지 받는다'가 그 버튼을 기다리다 시간 초과, 6개 통과) artifact `e2e-web-trace`(약 0.9 MB)가 올라왔다. vitest(`jobs.test.ts`)도 같은 회귀로 `frontend`가 실패했다. 5ac20ca가 되돌렸다(트리가 0477b17과 같다). 씨앗 push는 pre-push의 `frontend`를 넘기려고 `CHZZK_HOOK_FAST=1`을 썼다(push-guard·scan-range는 돌았다). (다) **`e2e-native (linux)` 녹색**: nightly PR 실행 37324417414와 ci.yml dispatch 37324424781(모든 작업 success, `ci-ok` success). 결과 파일 `[260102] 테스트채널 - 테스트 다시보기.mp4` 10328 B, sha256이 init‖seg0‖seg1과 같고 fixture 서버 요청 7개 모두 200. (라) **`hygiene-seed`**: 모든 Linux·Windows 실행에서 녹색(e2e 빌드에 표식 있음, `cargo tree -i`에 e2e 있음). 40의 구멍(정방향 트리는 루트 feature를 못 본다)을 이 씨앗이 찾았다. (마) **ratchet**: `ratchet.mjs write --from-run 37324424781`로 `tests.playwright` 0 → 7(크기 기준 넷도 조였다). `$pending`이 비었고 `PENDING_ALLOWED`도 비웠다(G5의 mutants가 다시 더한다). selftest 씨앗은 76개(관찰 작업 둘, playwright 기준 −1 하나를 더하고 `$pending` 씨앗을 바꿨다). (바) **하지 않은 것**: §10 수락 기준의 "2주 뒤 두 작업을 `ci-ok` needs에 넣는 PR이 녹색"은 2026-10-19 이후다(ROADMAP Phase 4 "G4 편입"). nightly 예약 실행·`ci-loop:e2e-native` 이슈 열기·닫기는 master에 머지된 뒤 첫 예약 실행에서 확인한다(dispatch는 브랜치에서도 된다: 37320210050).

47. **G4 리뷰·실측 반영(43·44·46을 바꾼다).** (가) **고리는 작업마다.** 43의 `ci-loop:e2e-native` 하나는 깜빡였다: 월요일 Windows 실패가 연 이슈를 화요일(Windows는 건너뜀, Linux 녹색) 실행이 닫았다. 이제 고리 이름 = nightly 작업 id(`ci-loop:e2e-native-linux`·`ci-loop:e2e-native-windows`, `issue.mjs NEEDS_LOOPS`)이고 `reportLoop`가 needs의 작업마다 failure·cancelled → 열기·댓글, success → 닫기, **skipped → 손대지 않음**이다. `LOOP` 환경 변수는 없앴다. 재발 검사: `issue.test.mjs`(Windows 실패 → 다음 날 Windows 건너뜀·Linux 녹색 → Windows 이슈는 열려 있음 → Windows 녹색에 닫힘). **실제 실행으로 확인**: dispatch(`windows=true loop_test=true`) 37326687163이 Windows 실패로 이슈 #3(`ci-loop:e2e-native-windows`, 본문은 실행 URL·커밋·작업 id뿐)을 열고 Linux는 `ok → none`, 고친 뒤의 같은 dispatch 37328558124가 둘 다 녹색이라 #3을 닫았다. (나) **Windows 원인과 수정(44를 바꾼다).** 세션을 기다리는 동안 실행기가 `msedgewebview2.exe`·`chzzk-app.exe`·`msedgedriver.exe`의 명령줄을 남기게 했다(30초 뒤, `Get-CimInstance Win32_Process`). WebView2 프로세스에 msedgedriver의 `--user-data-dir`(임시 scoped_dir)은 닿았지만 **`--remote-debugging-port`가 없었고** 인자는 wry 기본값(`--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`, `--autoplay-policy=…`)뿐이었다: wry가 WebView2 환경을 `AdditionalBrowserArguments`로 직접 만들어 msedgedriver가 넣은 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`가 쓰이지 않았다. 고침: E2E 빌드에서 E2E가 켜졌고(두 환경 변수) Windows이면 `lib.rs context()`가 그 환경 변수 값을 wry 기본값 뒤에 붙여 창 설정(`app.windows[].additional_browser_args`)에 준다(`e2e::webview2_args`, 단위 테스트 있음. 보통 빌드는 설정을 바꾸지 않는다). 37328558124에서 Windows가 처음 녹색이었다(결과 파일 sha256이 Linux와 같다). 버전 확인(45 (나))과 명령줄 진단은 남긴다. 44의 (가)는 되돌려 Windows도 nightly PR 경로 트리거에서 돈다. (다) **관찰 시작일**: 브랜치의 녹색이 아니라 master에 머지된 뒤 첫 master·예약 실행 날부터 14일이다(D14는 반복되는 실제 환경 실행으로 drift를 보려는 것이라 머지가 늦어지면 날짜도 늦춘다. ROADMAP). (라) 이 항목의 실행: ci.yml dispatch 37328564333·PR 37328557391(d598c82), nightly PR 37328556940. 최종 머리 커밋의 실행 번호는 PR #1에 남는다.
48. **G4 2차 리뷰 반영(36·39·43·45·47을 바꾼다).** 리뷰 지적 10개를 실제 코드·실행으로 확인했고 9개를 고쳤다. (가) **머지 전 네이티브 신호.** `e2e-native`(Linux)는 `OBSERVED_JOBS`에서 `'master'` → `'code'`이고 ci.yml 작업 if가 `CODE_IF`다: 코드가 바뀐 PR마다 돈다(관찰 중이라 `ci-ok`를 막지는 않지만, 편입하면 `CODE_GATED_JOBS`로 옮겨 PR 필수가 된다. 예전대로면 편입해도 master에서만 돌아 PR이 네이티브 E2E를 깨고 녹색으로 머지됐다). e2e feature 코드의 clippy(`--features e2e --all-targets`)와 `e2e::` 단위 테스트는 `e2e-native` gate에서 `tauri` gate로 옮겼다(3 OS, 코드 PR): Windows 전용 `#[cfg]` 블록(`lib.rs context()`)이 모든 코드 PR에서 컴파일된다. (나) **nightly PR 경로.** 손으로 나열한 `paths:`(4개)는 `lib.rs`·`Cargo.lock`·`crates/**`·`app/src/**`·`testdata/hls/**`·실행기가 import하는 스크립트를 빠뜨렸다. 이제 `paths-ignore`가 `gates.mjs NON_CODE_GLOBS`(= ci.yml `changes`가 코드가 아니라고 보는 경로, 정규식 `NON_CODE`와 같은 경로를 고르는지는 `run.test.mjs`)이고, parity 규칙 `pr-paths`가 `paths:`를 거부하고 `paths-ignore`가 그 목록과 같은지 본다. Windows는 코드 PR마다 돌고(참고 신호, `ci-ok` 밖), Linux nightly 작업은 PR에서 돌지 않는다(ci.yml이 돌린다). (다) **cron 글자.** parity 규칙 `schedule`: `github.event.schedule == '<x>'`의 글자는 그 파일의 `- cron:` 중 하나여야 한다(cron만 고치면 Windows가 영원히 건너뛴다). (라) **고리 이름공간.** `reportLoop`는 머리 커밋을 보지 않았고 브랜치 `loop_test` dispatch의 녹색이 진짜 이슈를 닫았다(실측: 37328558124가 #3을 닫음). `report()`의 master-failure도 머리 커밋만 보고 브랜치는 보지 않았다. 이제 둘 다 `GITHUB_REF`가 `refs/heads/master`가 아니면 **시험 이름공간**(label·마커·제목 `ci-loop-test:<고리>`)에만 쓴다: 브랜치에서도 고리를 실제 실행으로 확인할 수 있고 진짜 이슈는 건드리지 않는다. 브랜치가 아닌 ref는 입력 오류(2). (마) **조용히 꺼진 주간 작업.** `NEEDS_LOOPS`가 작업마다 표시 이름과 `staleHours`(Linux 72, Windows 192)를 갖고, report-loop가 **건너뛴** 작업의 마지막 성공(그 브랜치의 nightly.yml 완료 실행 최근 30개에서 그 이름의 작업이 success인 첫 `completed_at`, 없으면 워크플로 생성 시각)이 한계보다 오래면 `fail`(kind `stale`)로 연다. 예약 누락·조건식 어긋남·대기 실행 교체를 잡는다. 예약 실행의 concurrency 그룹은 cron마다 따로다(`…-${{ github.event.schedule || 'manual' }}`: 같은 그룹의 대기 실행은 하나라 매일 실행이 매주 실행을 밀어낼 수 있었다). (바) **msedgedriver 받기를 없앴다.** 45 (나)·44의 "버전이 다르면 그 버전의 드라이버를 Microsoft에서 받는다"는 해시를 고정할 수 없는 실행 파일을 코드 PR에서 실행하는 길이었고 한 번도 돈 적이 없다(모든 실행에서 두 버전이 153.0.4234.48로 같았다). 이제 `pickWindowsDriver`가 러너 이미지의 드라이버만 쓰고 버전이 다르면 두 버전을 적고 실패한다. 37320692512의 원인은 버전 차이가 아니라 wry 인자 덮어쓰기(47 (나))였다(주석을 고쳤다). (사) **e2e 테스트 0개 통과.** `cargo test -- e2e::`는 필터가 아무것도 고르지 않아도 0으로 끝난다. `measure.mjs tests-app`이 `--features e2e --lib`의 `e2e::` 테스트 수를 따로 세어 0이면 실패하고, ratchet 키 `tests.app_e2e.<os>`가 줄어들면 실패한다(`write --from-run 37334258200`으로 0 → 6, 3 OS. `coverage_lines.rust`도 95.8로 조였다). **실행으로 확인**(이 항목의 첫 커밋): PR ci 37334254859(`e2e-native (linux)`가 PR에서 처음 돌아 녹색, `tauri` 3 OS에서 e2e clippy·테스트 녹색, `ci-ok` success), nightly PR 37334254852(Linux는 skipped, Windows 녹색), ci dispatch 37334258200(모두 success), 브랜치 nightly dispatch(`windows=true loop_test=true`) 37334263681: report-loop가 `ci/pipeline는 master가 아니다 — 시험 이름공간`을 찍고 `ci-loop-test:e2e-native-linux`·`-windows`에만 `ok → none`, 진짜 `ci-loop:` 이슈는 건드리지 않았다. (아) **체크 이름 중복.** nightly 작업 이름을 `nightly e2e-native (linux|windows)`·`nightly report`로 바꿨고 parity 규칙 `job-name`이 워크플로를 통틀어 표시 이름이 겹치면 거부한다(처음 돌리자 `report`도 겹쳐 있었다). (자) **하지 않은 것: 관찰 기한 검사.** "편입 기한이 지났는데 `OBSERVED_JOBS`가 남아 있으면 실패"는 같은 커밋이 날짜에 따라 빨개지는 검사라 원칙 1(결정적)에 어긋나고, 관찰 시작일은 머지 뒤에야 정해진다(47 (다)). 관찰 중 머지를 막지 않는 것은 D14 그대로다. 머지 전 경로의 빈틈은 (가)가 닫는다. 재발 검사: `issue.test.mjs`(브랜치 실행은 `ci-loop:` label을 한 번도 쓰지 않고 진짜 이슈를 그대로 둔다, 건너뛴 Windows의 stale 열기·유예·404·녹색에 닫기, `NEEDS_LOOPS` 이름 = nightly.yml `name:`), `parity.test.mjs`·selftest 씨앗 셋(겹치는 이름, cron만 바꿈, `paths:` 나열), `run.test.mjs`(glob과 정규식이 같은 경로), `e2e-native.test.mjs`(`pickWindowsDriver`). selftest 씨앗은 80개다.
