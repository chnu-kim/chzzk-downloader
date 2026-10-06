# W9 런북: Worker 첫 배포와 첫 실제 릴리스

Phase 3 W9(`docs/design/worker.md` §16)를 사용자가 순서대로 따라 하는 절차다. 단계마다 근거(설계 문서 §·"구현 중 변경" 번호)를 붙였다. 판단이 갈리는 곳은 **멈추고 에이전트에 결과만 알린다**.

- 이 문서는 공개 저장소에 있다. 실제 Worker 주소·계정 ID·서브도메인·채널 ID·토큰은 여기와 ROADMAP·이슈·PR 어디에도 적지 않는다. 아래 `<Worker 주소>`는 자리표시다(값은 저장소 secret `DIST_BASE_URL`과 같다).
- 결과는 ROADMAP Phase 3의 W9 줄에 **"거부/수락·있음/없음·통과/실패"와 날짜만** 적는다(§7).
- Worker 이름은 `chzzk-downloader`, R2 바인딩은 `DIST`, DO 바인딩은 `AUTH`(클래스 `AuthStore`)다(`worker/wrangler.jsonc`).

## 0. 비밀값 다루는 법

- **별도 터미널**(macOS 터미널·iTerm 등)에서 한다. Claude Code의 `!` 명령으로는 `read`가 입력을 받지 못한다.
- 비밀값은 1Password에서 복사해 `read -rs`로 셸 변수에만 넣는다. 화면·셸 기록·명령줄 인자에 남지 않는다. 터미널을 닫으면 사라진다.

  ```sh
  printf 'CLOUDFLARE_API_TOKEN: '; read -rs CF_TOKEN; echo
  ```

- 명령줄 인자로 넘기지 않는다(`ps`에 보인다). Worker secret은 `printf '%s' "$값" | … secret put`으로 표준 입력에 넣고(`printf`는 셸 내장이라 프로세스 목록에 없다), HTTP 헤더는 `curl -H @-`로 표준 입력에서 읽힌다.
- 값이 어디 들었는지:

  | 1Password | 키 | 쓰는 곳 |
  |---|---|---|
  | Environment `chzzk-downloader-release` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | 배포·`secret put`·`secret list`(릴리스 deploy-worker가 쓰는 그 토큰) |
  | | `CI_VERIFY_TOKEN` | Worker secret과 배포 뒤 검사(GitHub 환경 `release`의 같은 이름과 같은 값) |
  | | `DIST_BASE_URL` | `<Worker 주소>`(경로 없는 https 출처) |
  | | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | 로컬 `cargo xtask release …`. **`R2_ACCOUNT_ID` 키는 없다**: R2 계정 = Cloudflare 계정이라 `CLOUDFLARE_ACCOUNT_ID` 값을 `R2_ACCOUNT_ID`에 넣는다 |
  | Environment `chzzk-downloader-worker-prod`(마운트 없음) | `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET` | 운영 Worker secret(worker.md 구현 중 변경 12 (가)) |
  | Environment `chzzk-local-dev`(→ `worker/.dev.vars` 마운트) | 로컬 테스트 앱 셋 | code 묶임 실측 도구(§3.1)가 직접 읽는다 |

- 로그인하는 동안 `wrangler tail`과 대시보드의 **실시간 로그(Live)** 를 켜지 않는다. 그 화면은 요청 URL을 보여 주고, 콜백 URL에는 `code`·`state`가 실린다(worker.md §14).

## 1. 사전 확인 — 모두 완료(2026-10-07)

| # | 확인 | 결과 |
|---|---|---|
| 1-1 | `cargo xtask release list-keys --prefix releases/`(R2_* env, 읽기만): 실제 R2에서 경로 방식 목록 서명이 통과하는지(cicd.md 구현 중 변경 97 (바)) | **완료(2026-10-07)**: 서명 통과, exit 0, 키 0개(버킷 비어 있음) |
| 1-2 | GitHub 이름(값은 보지 않는다): 저장소 secret `DIST_BASE_URL`, 저장소 변수 `R2_BUCKET`, 환경 `release` secret `CI_VERIFY_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`·`CLOUDFLARE_API_TOKEN`·`R2_ACCESS_KEY_ID`·`R2_ACCOUNT_ID`·`R2_SECRET_ACCESS_KEY`·`TAURI_SIGNING_PRIVATE_KEY`(`_PASSWORD`), 환경 변수 `VERIFY_VIA=s3`·`WORKER_DEPLOY_ENABLED=false`(worker.md §10.3, cicd.md 84·96) | **완료(2026-10-07)**: 모두 있음 |
| 1-3 | 치지직 운영 앱의 리디렉션 URL = `<Worker 주소>/auth/callback`(바이트 일치, worker.md §7.3) | **완료(2026-10-07)**: 일치 |

1-1을 다시 돌릴 때(§5-6 뒤 등)는 저장소 루트에서:

```sh
printf 'R2_ACCESS_KEY_ID: '; read -rs R2_ACCESS_KEY_ID; echo
printf 'R2_SECRET_ACCESS_KEY: '; read -rs R2_SECRET_ACCESS_KEY; echo
printf 'R2_BUCKET: '; read -rs R2_BUCKET; echo
printf 'R2_ACCOUNT_ID(= CLOUDFLARE_ACCOUNT_ID 값): '; read -rs R2_ACCOUNT_ID; echo
R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" R2_BUCKET="$R2_BUCKET" R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
  cargo xtask release list-keys --prefix releases/
```

배포 토큰이 Worker secret 목록을 읽을 수 있는지(worker.md 구현 중 변경 36 (타)의 [확인 필요])는 Worker가 있어야 볼 수 있어 §2.6으로 옮겼다(구현 중 변경 42 (나)).

## 2. 첫 수동 배포

**순서: 배포 → secret 셋 → 로그인 → `ADMIN_CHANNEL_IDS`.** 이유(worker.md 구현 중 변경 42 (가)):

- 배포가 먼저다. 없는 Worker에 `secret put`을 하면 wrangler가 빈 Worker를 새로 만들 수 있는데 그 동작은 확인하지 않았고, 첫 배포는 exports DO 선언이 실제로 받아들여지는지 보는 자리다(R5, 구현 중 변경 10 (나)). 빈 Worker가 먼저 생기면 그 판단이 흐려진다.
- secret 셋(`CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CI_VERIFY_TOKEN`)이 없으면 운영 모드는 모든 경로가 `config_error`다(§10.1). 배포와 secret 사이 몇 분 동안 Worker가 500/503을 내는 것은 사용자가 없어 괜찮다.
- `ADMIN_CHANNEL_IDS`는 비어 있으면 부트스트랩 모드(§8.3)이고, 본인 채널 ID는 부트스트랩 로그인의 거부 화면에서야 보인다.

### 2.1 묶음 만들기

메인 트리(`master` 최신, 작업 트리 깨끗함)의 저장소 루트에서. 묶음은 OS·arch 전용이라(구현 중 변경 35 (다)) 만든 기계에서 그대로 배포한다.

```sh
git switch master && git pull --ff-only
node scripts/ci/run.mjs release-worker-bundle   # → target/ci/worker-bundle/worker-bundle.tgz, 끝에 자격 없는 deploy --dry-run까지 돈다
SHA7=$(git rev-parse --short=7 HEAD)            # /health의 build로 보인다
D=$(mktemp -d) && mkdir -p "$D/home" && tar -xzf target/ci/worker-bundle/worker-bundle.tgz -C "$D"
```

배포는 묶음을 푼 **빈 새 임시 폴더** `$D`에서 한다: wrangler는 작업 폴더의 `.env`·`.env.local`을 찾는다(구현 중 변경 35 (사)).

### 2.2 자격과 wrangler 함수

로컬 `wrangler login`이 아니라 **릴리스의 배포 토큰**으로 한다. 그래야 deploy-worker가 태그에서 쓸 토큰의 권한(배포·secret 목록)을 태그 전에 확인한다. 값은 release.mjs와 같다(구현 중 변경 36 (바)): 빈 임시 `HOME`이라 로컬 로그인 상태를 쓰지 않는다. 토큰은 셸 접두 대입으로 넘겨 어떤 프로세스의 인자에도 싣지 않는다(`env -i … CLOUDFLARE_API_TOKEN=…`처럼 쓰면 `env`의 인자로 `ps`에 보인다).

```sh
printf 'CLOUDFLARE_API_TOKEN: '; read -rs CF_TOKEN; echo
printf 'CLOUDFLARE_ACCOUNT_ID: '; read -rs CF_ACCOUNT; echo
printf 'DIST_BASE_URL(<Worker 주소>): '; read -rs BASE; echo
w() { (cd "$D" && HOME="$D/home" XDG_CONFIG_HOME="$D/home/.config" CI=true WRANGLER_SEND_METRICS=false \
  CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT" \
  env -u CLOUDFLARE_API_BASE_URL -u WRANGLER_LOG node deploy/node_modules/wrangler/bin/wrangler.js "$@"); }
env | cut -d= -f1 | grep -E '^(CLOUDFLARE|WRANGLER|CF)_'   # 아무것도 안 나와야 한다(이름만 찍는다). 나오면 새 터미널에서 한다
```

`CI=true`라 wrangler는 묻지 않고, `secret put`은 값을 표준 입력에서 읽는다. 36 (바) 허용 목록과 다른 점: 완전한 `env -i`가 아니라 셸의 나머지 env를 물려받고 `CLOUDFLARE_API_BASE_URL`·`WRANGLER_LOG`만 지운다(위 확인 줄이 나머지 `CLOUDFLARE_*`·`WRANGLER_*`가 없음을 본다).

### 2.3 배포

```sh
w deploy --no-bundle --config dist/wrangler.json --var "PUBLIC_ORIGIN:$BASE" --var "BUILD_ID:$SHA7"
```

릴리스 deploy-worker와 같은 인자다(`release.mjs wranglerDeployArgs`, §13.4). 볼 것:

- 바인딩 표에 `env.AUTH (AuthStore)` Durable Object와 `env.DIST (chzzk-downloader-dist)` R2 Bucket이 있다. 대시보드의 Durable Objects에 `AuthStore`가 SQLite 저장소로 보인다.
- wrangler가 찍은 workers.dev 주소가 `$BASE`와 같은지 **이 터미널에서 눈으로만** 본다(복사해 다른 곳에 붙이지 않는다).
- `curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/health"` → `503`(secret이 없어 `config_error`, 정상).

**배포가 거부되거나** 바인딩 표에 DO가 없으면 멈춘다: 에이전트가 구현 중 변경 10 (가)의 레거시 선언(`migrations` `new_sqlite_classes`)으로 바꾸는 PR을 내고(`worker-config.mjs` `FORBIDDEN_KEYS`도), 머지 뒤 §2.1부터 다시 한다. 첫 배포가 성공하기 전이라 데이터 이전은 없다(10 (나)). 토큰 권한 오류(403·`Authentication error`)면 토큰 권한을 고친다(로컬 `wrangler login`으로 우회하지 않는다: 태그의 deploy-worker가 같은 토큰을 쓴다).

### 2.4 secret 셋

```sh
printf 'CHZZK_CLIENT_ID(운영, worker-prod): '; read -rs V; echo; printf '%s' "$V" | w secret put CHZZK_CLIENT_ID --config dist/wrangler.json
printf 'CHZZK_CLIENT_SECRET(운영, worker-prod): '; read -rs V; echo; printf '%s' "$V" | w secret put CHZZK_CLIENT_SECRET --config dist/wrangler.json
printf 'CI_VERIFY_TOKEN(release): '; read -rs CI_TOKEN; echo; printf '%s' "$CI_TOKEN" | w secret put CI_VERIFY_TOKEN --config dist/wrangler.json
unset V
curl -sS "$BASE/health"; echo
```

- 기대: `{"ok":true,"schema":<n>,"build":"<SHA7>","bootstrap":true}`. `build`가 이번 `$SHA7`이면 `secret put`이 만든 새 버전이 `--var`(`PUBLIC_ORIGIN`·`BUILD_ID`)를 이어받았다는 뜻이다.
- `build`가 `unknown`이거나 503이면 §2.3의 `w deploy …`를 한 번 더 돈다(배포는 사용자가 넣은 secret을 유지한다, 구현 중 변경 35 (가) `keep_bindings`). 그래도 503이면 멈춘다.

### 2.5 로그인과 `ADMIN_CHANNEL_IDS`

1. 브라우저(일반 창)로 `<Worker 주소>/`를 열고 [치지직으로 로그인] → 운영 앱으로 로그인한다. 부트스트랩 모드라 **거부 화면**이 나오고 거기 본인 채널 ID(32자리 소문자 hex)가 보인다(§8.3·§9.5). 이 로그인 자체가 DO(흐름 시작·소비·거부 기록)를 지나므로 500이면 DO가 동작하지 않는 것이다 → §2.3의 "배포가 거부되거나"와 같이 멈춘다. (재배포 직후라면 DO 코드 갱신이 최대 5분 늦을 수 있다, 구현 중 변경 35 (바).)
2. 그 ID를 넣는다(여러 명이면 쉼표, 공백 없음):

   ```sh
   printf 'ADMIN_CHANNEL_IDS: '; read -rs V; echo; printf '%s' "$V" | w secret put ADMIN_CHANNEL_IDS --config dist/wrangler.json; unset V
   curl -sS "$BASE/health"; echo     # bootstrap 없이 {"ok":true,…,"build":"<SHA7>"}
   ```

   형식이 틀리면 `/health`가 503 `config_error`다(§10.1) → 값을 고쳐 다시 넣는다.
3. 다시 로그인하면 랜딩에 [관리]가 보이고 `/admin`이 열린다.

### 2.6 배포 토큰의 secret 목록

```sh
w secret list --config dist/wrangler.json --format json
```

이름 넷(`ADMIN_CHANNEL_IDS`·`CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CI_VERIFY_TOKEN`)이 보여야 한다(API는 이름·종류만 준다). **실패하면** deploy-worker가 매 태그마다 2로 멈추므로(구현 중 변경 36 (타)) §5의 `WORKER_DEPLOY_ENABLED=true` 전에 토큰 권한을 고치고 다시 본다.

### 2.7 첫 릴리스 전 수동 검사

R2가 비어 있어 `release.mjs worker --check-only` 전체(health + 일곱)는 아직 녹색이 될 수 없다: `/update/0.0.0`(CI 토큰)이 200 + `latest.json`이 아니라 204이고 `/releases/latest.json`(CI 토큰)은 404다(구현 중 변경 42 (나)). 전체 검사는 §5-5에서 한다. 지금은 나머지를 손으로 본다(출력은 상태 코드뿐이다):

```sh
st() { curl -sS -o /dev/null -w '%{http_code}\n' "$@"; }
auth() { printf 'Authorization: Bearer %s\n' "$1"; }
st "$BASE/admin"                                                  # 303(세션 없음 → /)
st "$BASE/releases/latest.json"                                   # 401(토큰 없음)
auth "$CI_TOKEN"     | st -H @- "$BASE/api/me"                    # 401(CI 토큰은 앱 토큰이 아니다)
auth not-a-token     | st -H @- "$BASE/update/0.0.0"              # 401(CI 토큰 비교가 돈다)
auth "$CI_TOKEN"     | st -H @- "$BASE/update/0.0.0"              # 204(R2에 latest.json이 아직 없다)
```

## 3. 실서버 확인 ① — 배포 직후

### 3.1 치지직 code 묶임(worker.md 구현 중 변경 29·42 (다))

로컬 테스트 앱(`chzzk-local-dev`)으로 한다. 운영 앱과 같은 치지직 OAuth 서버이므로 결과를 운영에도 그대로 본다(가정, 42 (다)). Worker(`pnpm dev:real`)를 거치지 않는 이유: Worker는 state를 한 번만 받아 같은 code의 두 번째 콜백을 치지직에 보내기 전에 막으므로, 거부가 치지직 때문인지 Worker 때문인지 가를 수 없다(42 (다)).

포트 8787을 쓰는 것(`wrangler dev`·`pnpm dev`·`pnpm dev:real`, 다른 worktree 포함)을 끄고 메인 트리 루트에서:

```sh
node worker/scripts/code-binding-check.mjs
```

터미널에 나온 `http://localhost:8787/auth/login`을 브라우저로 열어 로그인한다. 도구가 받은 code 하나로 ① 새 state로 교환 ② (①이 수락이 아니면) 원래 state로 교환하고, **①·② 모두 거부면 대조**를 한다: 터미널이 한 번 더 로그인하라고 하면 같은 주소로 다시 로그인한다. 도구는 그 새 code를 그 로그인의 원래 state로 **먼저** 교환한다. 끝으로 ③ (앞 교환 중 하나가 수락이면) 수락된 교환과 같은 code를 재교환한다. 단계별 거부/수락·성공/실패와 결론만 찍는다(ID·토큰·code·state 없음, HTTP 상태와 치지직 오류 code 이름은 찍는다). 받은 치지직 토큰은 쓰지 않고 버리며 revoke하지 않는다(공용 테스트 앱이라 다른 서비스 로그인까지 끊긴다).

- 기대: ① 거부 ② 성공 ③ 거부.
- ① 수락 또는 ③ 수락이면 그 사실만 알리고, 대응(교환 전 code를 흐름에 묶는 다른 길, 또는 위험 수용)은 사용자와 정한다(29).
- ① 거부 ② 실패 대조 성공이면 결론은 "묶인다(다른 state 거부) + 실패한 교환이 code를 소모할 수 있다"이다. 그대로 적는다.
- ① 거부 ② 실패 **대조도 실패**면 자격·만료 문제로 판정 불가다. **다시 돌리지 않고** ①·②·대조 줄의 HTTP 상태와 오류 code 이름을 에이전트에 알린다.
- 그 밖의 "판정 불가"(연결 실패·본문 끊김·5xx·408·429, 두 번째 로그인 실패)는 거부로 세지 않은 것이다. 429면 잠시 뒤, 나머지는 바로 처음부터 다시 돌린다.

### 3.2 Workers Logs에 URL이 없다

로그인을 몇 번 한 뒤 대시보드 Workers & Pages → `chzzk-downloader` → Logs(저장된 로그, 실시간 아님)에서 `code=`·`state=`·`/auth/callback?`을 찾는다 → **없음**이어야 한다. invocation 로그는 꺼져 있고(`observability.logs.invocation_logs: false`, 구현 중 변경 7) Worker 로그는 `log()`의 허용 필드만이다(§14). 있으면 멈추고 알린다(설정 수정 PR).

### 3.3 실제 브라우저의 관리 POST

`/admin`의 "거부된 시도"에서 §2.5 부트스트랩 때 남은 본인 행을 [지우기] → 관리 화면으로 돌아오고(303) 행이 사라지면 통과다. 안내 페이지(403)가 나오면 브라우저가 Origin·Sec-Fetch-Site를 기대와 다르게 실은 것이다(구현 중 변경 38 (나)) → 멈추고 알린다.

### 3.4 Error 1027은 실측하지 않는다

Cloudflare 계정을 다른 Worker들과 함께 쓰므로 하루 요청 한도를 일부러 넘기지 않는다(사용자 결정 2026-10-07). 앱은 상태 코드를 몰라도 되게 분류한다(구현 중 변경 42 (라)).

## 4. 실서버 확인 ② — 첫 릴리스 `v0.1.0` 승격 뒤

§5-4가 끝난 뒤(R2에 `releases/0.1.0/`과 `latest.json`이 있다). 같은 터미널(`$BASE`·`$CI_TOKEN`·`st`·`auth`).

| 확인 | 명령(예: 작은 텍스트 파일 `SHA256SUMS`) | 기대 | 근거 |
|---|---|---|---|
| 일반 Range | `auth "$CI_TOKEN" \| curl -sS -D - -o /dev/null -H @- -H 'Range: bytes=0-9' "$BASE/releases/0.1.0/SHA256SUMS"` | 206, `Content-Range: bytes 0-9/<크기>`, `Content-Length: 10` | 31·32 (가) |
| 접미 Range | 같은 명령, `Range: bytes=-10` | 206, 끝 10바이트의 `Content-Range` | 31 |
| 끝이 크기를 넘는 Range | `Range: bytes=0-99999999` | 206, `Content-Range: bytes 0-<크기-1>/<크기>`. 500 `range_mismatch`면 실패 | 32 (가) ②·33 (가) |
| 만족 불가 Range | `Range: bytes=99999999-` | 416(`Content-Range` 없음) 또는 200 전체. 어느 쪽인지 적는다 | 32 (가) ① |
| Content-Length | Range 없이 GET, 그리고 `curl -I`(HEAD) | GET 200·206·HEAD 모두 `Content-Length` 있음. 없으면 `FixedLengthStream` 수정 PR | 32 (가) ③ |
| 압축 없음 | `-H 'Accept-Encoding: gzip, br'`로 `SHA256SUMS`와 `/releases/latest.json` | `Content-Encoding` 없음(`no-transform`) | 32 (가) ④ |
| Actions 로그 마스킹 | `H=${BASE#https://}; gh run view <릴리스 실행 id> --log \| grep -cF "$H"` | `0` | cicd.md 84 (다) |
| macOS Gatekeeper | 실기기에 `.dmg` 설치 → 처음 열 때 문구, `xattr -dr com.apple.quarantine "/Applications/치지직 다운로더.app"` | 랜딩 설치 안내(`worker/src/http/copy.ts`)와 같음. 다르면 문구만 알린다 | 38 (아), §9.5 |

실제 R2를 변조해 rollback을 시험하는 것은 W9에서 하지 않는다: 버전이 0.1.0 하나라 `previous`가 없다. 변조 → rollback 경로는 가짜 S3의 `release-selftest`가 덮는다(구현 중 변경 42 (자)). 두 번째 릴리스 뒤의 선택 확인은 §8.

## 5. GitHub 전환과 첫 릴리스

버전은 **0.1.0 그대로**다(사용자 결정 2026-10-07, 구현 중 변경 42 (바)). 첫 실제 릴리스는 pre-release 접미사 없는 태그 `v0.1.0`이고 버전 올리는 PR은 없다(MSI는 pre-release 식별자에 제약이 있어 피해 간다). 이후 수정은 0.1.x, 1.0.0은 Phase 3b(A1~A5)와 W9 운영 안정 뒤 사용자 승인이다.

| # | 할 일 | 근거 |
|---|---|---|
| 5-1 | `gh variable set WORKER_DEPLOY_ENABLED --body false`(저장소 변수) → `gh variable delete WORKER_DEPLOY_ENABLED --env release`. deploy-worker의 작업 수준 `if:`는 환경 변수를 보지 못한다. `VERIFY_VIA`는 환경 `release`에 그대로 둔다 | 36 (차), cicd.md 96 (아) |
| 5-2 | §2.6이 통과했으면 `gh variable set WORKER_DEPLOY_ENABLED --body true`. 첫 태그의 deploy-worker가 손으로 올린 Worker를 같은 묶음 방식으로 다시 배포하고 health + 일곱을 본다 | §13.4, 36 |
| 5-3 | 태그 전 확인: 태그할 커밋이 `origin/master`에 있고 그 커밋의 master `ci-ok`가 녹색, 버전 파일이 0.1.0(`node scripts/ci/run.mjs versions`), `git ls-remote --tags origin 'refs/tags/v*'`가 비어 있다(origin에 `v*` 태그가 하나라도 있으면 멈추고 알린다: 0.1.0보다 큰 태그가 있으면 `gate`의 단조 증가 검사가 거부한다) | release.yml `gate`, 42 (마) |
| 5-4 | **사용자 승인 뒤** `git fetch origin && git tag v0.1.0 <그 커밋> && git push origin refs/tags/v0.1.0`. **`git push --tags`는 쓰지 않는다**: 이 클론에는 비공개 저장소에서 온 `v*` 태그가 있다(`git tag -l`). 그것이 origin에 올라가면 `gate`의 단조 증가 검사가 `v0.1.0`과 이후 0.1.x를 영영 거부한다. 같은 이유로 이 클론에서 tag 모드 `release.mjs gate`를 로컬로 돌리면 실패한다(CI 체크아웃에는 그 태그가 없다) | 42 (마) |
| 5-5 | 흐름: gate → xtask → build×3 → smoke → stage → sign-publish(R2, `latest.json`은 마지막) → verify(`VERIFY_VIA=s3`) → prune → deploy-worker(secret 이름 → superseded 가드 → 재배포 → health의 build 일치 + 일곱). 녹색 뒤 로컬에서 `CI_VERIFY_TOKEN="$CI_TOKEN" node scripts/ci/release.mjs worker --check-only --base "$BASE" --version 0.1.0 --build <태그 커밋 앞 7자>` → exit 0, §4 표, §1의 list-keys 재실행(`releases/0.1.0/…` 키) | §9.4, 36 (자) |
| 5-6 | Worker로 다시 받아 확인: `VERIFY_VIA=worker CI_VERIFY_TOKEN="$CI_TOKEN" cargo xtask release verify --version 0.1.0 --pubkey release/updater.pub --base-url "$BASE"` → exit 0. GitHub의 verify 작업을 다시 돌리지 않는다(판정 실패면 `latest.json`을 되돌린다) | cicd.md §5 4(verify 실패 → rollback) |
| 5-7 | `gh variable set VERIFY_VIA --env release --body worker`. 다음 릴리스부터 verify가 Worker로 읽는다. "태그 모드에서 `VERIFY_VIA=worker`를 요구"는 스위치가 아니라 **코드 변경**이라 에이전트가 따로 PR로 한다 | 42 (아) |

`v0.1.0` 앱은 **Worker 로그인이 없는 앱**이다(Phase 3b A1~A5 전, cicd.md 구현 중 변경 82 (나)의 태그 모드 `CHZZK_WORKER_BASE` 비교도 A2 몫). 앱에 updater 주소(`plugins.updater.endpoints`)가 없어 **스스로 업데이트하지 않는다**: 0.1.0 → 0.1.x는 랜딩(로그인·허용된 사용자)에서 받아 직접 설치한다(구현 중 변경 42 (바)).

실패하면: `sign-publish` 전 실패는 R2에 아무것도 없다. verify 판정 실패는 `latest.json`이 자동으로 되돌아간다. deploy-worker 실패(1·2)는 R2 릴리스와 무관하다 — 묶음의 wrangler로 §2.3을 손으로 하거나 원인을 고쳐 다시 돌린다. Worker 되돌리기는 사람이 `w rollback`(DO 선언 변경은 되돌아가지 않는다, §9.4). 태그를 짧은 간격으로 셋 이상 밀지 않는다(36 (카)).

## 6. 무료 한도 확인(첫 릴리스 며칠 뒤)

비용 0 제약(worker.md 구현 중 변경 11)대로 계정 **합계**와 **이 Worker 몫**을 대시보드에서 한 번 본다. 이 계정은 다른 Worker들과 함께 쓴다.

| 자원 | Free 한도 | 넘으면 | 볼 곳 |
|---|---|---|---|
| Workers 요청 | 10만/일(00:00 UTC 초기화) | Error 1027(과금 없음) | Workers & Pages 개요(계정), Worker Metrics(이 Worker) |
| DO `AuthStore` | 요청 10만/일, 읽기 500만 행/일, 쓰기 10만 행/일, 저장 5GB(Cloudflare 문서 2026-10-07 확인) | 그 종류의 연산이 오류로 실패(과금 없음) | Durable Objects 화면(요청 수·읽기/쓰기 행·저장) |
| R2 | Class A 100만/월, Class B 1000만/월, 저장 10GB-월 | **청구** | R2 → 버킷 Metrics |
| Workers Logs | 이벤트 20만/일, 보존 3일. 2026-12-01부터 계정 Observability 0.5GB/일 수집 | 2026-12-01부터는 수집을 멈추고 00:00 UTC에 재개(Free는 추가 수집을 살 수 없어 과금 없음). 그 전 Free 초과 동작은 문서에 없다 **[확인 필요]** | Workers Logs·Observability 사용량 |

경로별 요청 수(`/update/:current`·`/auth/*`·`/`·`/admin*`·`/me/*`, 구현 중 변경 28 (차)·33 (라)·38 (라))는 **볼 방법이 없다**: invocation 로그를 꺼 요청마다 남는 줄이 없고 Worker 로그는 일부 이벤트뿐이다. 합계와 Worker 수로 짐작하고, 경로별로 볼 방법(무엇을 켤지)은 사용자가 정한다(구현 중 변경 42 (사)).

## 7. 결과 기록

ROADMAP Phase 3 W9 줄과 "현재 위치"에 **날짜와 결과 낱말만** 적는다. 예:

- `수동 첫 배포 통과(날짜): exports DO 그대로, secret 넷, 배포 토큰 secret list 통과`
- `code 묶임(날짜): ① 거부 ② 성공 ③ 거부`(대조를 돌렸으면 `① 거부 ② 실패 대조 성공 ③ 거부`처럼 대조를 넣는다)
- `Workers Logs URL 없음 / 관리 POST 통과 / Range 416(또는 200) / Content-Length 있음 / 압축 없음 / 마스킹 0`
- `v0.1.0 승격(날짜), --check-only 통과, Worker verify 통과, VERIFY_VIA=worker`
- `무료 한도(날짜): 각 자원 한도의 몇 % 이하`(정확한 요청 수·주소는 적지 않는다)

실패·불일치는 종류만 적고 에이전트가 수정 PR을 낸다(DO 선언 대안, `FixedLengthStream`, `copy.ts`, 토큰 권한 등).

## 8. (선택) 두 번째 릴리스 0.1.1 뒤 rollback 확인

`previous`가 생긴 뒤에 한 번: `gh workflow run rollback.yml -f version=0.1.0` → `--check-only --version 0.1.0`(§5-5 명령)이 통과하는지 → `gh workflow run rollback.yml -f version=0.1.1`로 다시 올리고 `--version 0.1.1`로 확인한다. rollback은 `latest.json`만 바꾸고 Worker는 그대로다. prune은 latest 이하 최신 5개 + previous를 남기므로 0.1.0은 그때도 있다(cicd.md 97).
