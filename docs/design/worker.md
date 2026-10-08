# Cloudflare Worker 설계 (Phase 3, 확정안)

네 설계안(위협 모델 우선 / 운영 최소화 / 테스트·CI 우선 / 앱 UX·오프라인)을 "반드시 닫아야 할 구멍" 12개로 채점해 판정한 최종 설계다. 기준 문서는 `docs/ROADMAP.md`(사용자 결정 2026-10-06), `docs/research/chzzk-oauth.md` §8·§9, `docs/design/app.md` §8.9·§12, `docs/design/cicd.md` §5·§8, `release/latest.schema.json`, `release/expected-artifacts.json`, `crates/shell/src/ownership.rs`다. 참고한 웹 앱은 "기존 웹 앱"이라고만 부른다. 끝의 "구현 중 변경"이 본문보다 우선한다.

용어: **앱**은 Tauri 데스크톱 앱(Rust 셸), **랜딩**은 Worker가 내주는 HTML 페이지, **허용 채널**은 `ADMIN_CHANNEL_IDS ∪ allowlist`, **DO**는 Durable Object다. 표기 **[확인 필요]**는 구현 묶음의 첫 테스트로 고정할 미검증 사실이다.

## 0. 판정 요약

- **베이스는 운영 최소화 안**이다. DO 클래스 하나·인스턴스 하나, Worker secret 4개, 런타임 의존성 0개, 토큰은 서명 없는 불투명 난수 + SHA-256 해시 저장, 인증 요청마다 DO 조회 하나. 서명 키와 키 교체 절차가 없고, 허용목록 제외·세션 끊기가 다음 요청부터 바로 듣는다.
- 위협 모델 안에서 가져온 것: 공격자 표(A1~A11)와 **자격 × 경로 행렬**(CI 토큰은 릴리스 읽기 경로에서만 해석), 설정 가드(치지직 주소 덮어쓰기는 `PUBLIC_ORIGIN`이 루프백일 때만, 아니면 모든 경로 500), 흐름 결합 쿠키(앱·웹 콜백 모두 브라우저에 묶는다, A4), 앱 흐름의 **확인 코드 페이지**(공격자가 시작한 로그인을 눈에 보이게, A3), 랜딩의 "내 기기"(자기 세션 끊기), 거부 기록 dedupe·상한·이스케이프, 메모리 스로틀(IPv6 /64), updater 다운로드 URL **출처 대조**(A8), 404는 "R2에 없음"에만.
- 테스트·CI 우선 안에서 가져온 것: 모듈 경계(순수 `core/` / `store/` DO / `http/` 핸들러), 경로 표가 데이터이고 **행렬 테스트가 자동 생성**, 가짜 치지직은 순수 핸들러 하나를 msw와 node:http가 감싼다, `wrangler types` 생성물은 커밋하지 않는다(머리줄 32-hex 해시가 public-scan에 걸린다, 실측), vitest가 `.dev.vars`를 읽으므로 `miniflare.bindings`로 덮는다, refresh rotation 표, wrangler dev E2E는 **D14 관찰 작업**(`worker-e2e`), D10을 지키는 `worker-bundle` → `--no-bundle` 배포, `tests.worker` ratchet, `0.0.0` 요청으로 첫 릴리스에도 성립하는 deploy-worker 검사.
- 앱 UX·오프라인 안에서 가져온 것: 앱 셸 계약 전체(§11 — `AuthState::Checking`, `AuthReason`, `OfflineDto`, 낙관적 시작, 재시도 간격, 다운로드 계속·재개 규칙, 업데이트 설치 흐름, copy deck), 응답 유실 복구는 "후계가 아직 안 쓰였으면 후계를 폐기하고 새 쌍"(rid 없이), 유예 밖에서도 세션 파일을 지우지 않아 [다시 연결]로 복구, `session.json`의 `origin` 필드, `DIST_BASE_URL` 하나가 Worker 주소의 원천(저장소 변수로 옮김).
- 버린 것: DO 두 개 분리(위협 — 상한·스로틀로 충분, 사용자 수가 허용목록 크기), HMAC·JWS access 토큰과 `SESSION_KEYS`·kid 회전(위협·테스트·UX — 어차피 요청마다 DO 대조라 서명이 주는 것은 쓰레기 거르기뿐), CI 토큰 해시 저장(Worker env가 새면 client secret이 먼저 샌다), `/updates/{target}/{arch}/…` 경로(정적 `latest.json`을 그대로 주므로 OS·arch는 플러그인이 고른다), `v ≤ latest` 버전 범위 제한(실패 경로 하나 늘고 보안 경계가 아니다), semver 공유 벡터 생성기(xtask 벡터를 테스트 상수로 옮긴다), `/download/<kind>` 302, `previous`를 사용자에게 제공, 랜딩 JS(OS 자동 감지는 CSS·서버 렌더 표로 대신), 폴링 레코드에 IP 행 저장, Range 미지원(단일 범위는 순수 함수 하나라 넣는다).

### 채점 (구멍 12개, 5점 만점)

| # | 구멍 | 위협 | 최소 | 테스트 | UX | 이긴 안 → 접붙인 것 |
|---|---|---|---|---|---|---|
| 1 | 랜딩 다운로드 대 Worker 계약 | 4 | 5 | 5 | 4 | 최소·테스트: SHA256SUMS 항목이 목록. 위협·UX의 "404는 R2 null에만, 정책 밖은 403" |
| 2 | updater 경로·헤더·endpoint 주입 | 5 | 4 | 4 | 4 | 위협: 다운로드에도 헤더가 붙으니 셸이 `download_url` 출처 대조, `check()` 전 세션 판정. 최소의 `/update/{{current_version}}`. 테스트의 `0.0.0` 검사 |
| 3 | CI 토큰은 읽기 경로만 | 5 | 4 | 5 | 4 | 테스트: 경로 표에서 행렬 자동 생성. 위협: "다른 경로에서 CI 토큰은 쓰레기 Bearer와 같다"(별도 분기 없음). 최소: 소스 검사(`CI_VERIFY_TOKEN` 참조는 `config.ts`·`http/release-auth.ts`뿐) |
| 4 | 두 인증 방식·콜백 분기·CSRF | 5 | 3 | 4 | 4 | 위협: 흐름 결합 쿠키를 앱·웹 양쪽에, Origin + 폼 토큰 + Content-Type. 토큰은 HMAC 대신 **세션 행의 난수**(키 없음) |
| 5 | 토큰 수명·rotation·유예 | 4 | 3 | 5 | 5 | 테스트: rotation 표. UX: 응답 유실은 "후계 미사용이면 후계 폐기·재발급". 위협: 유예는 Worker 형식 응답이 아닌 실패에만 |
| 6 | `/auth/start` 남용 | 5 | 3 | 4 | 4 | 위협: 메모리 스로틀(IP, /64) → 전역 상한 → 그다음 쓰기, 폴링 간격은 메모리, 한도 계산표 |
| 7 | 오프라인 끝까지 | 4 | 4 | 5 | 4 | 테스트: 가짜 치지직 하나를 msw·node로 감싸기, `.dev.vars` 덮어쓰기, R2 씨앗 Node 생성기. 위협: 루프백 가드 |
| 8 | channelId 동일성 게이트 | 4 | 4 | 4 | 4 | 공통(미체크 단계·match/mismatch만 출력). 도구는 이미 있는 `worker/scripts/channel-id-check.mjs`(Worker 없이 Node만). 대안 B(`owner_channel_id` 열) |
| 9 | account_id·DO 선언 | 5 | 4 | 4 | 4 | 위협: `worker-config.mjs`가 wrangler.jsonc 불변식을 검사(account_id·routes 없음, exports만, 클래스 이름 고정, vars에 `PUBLIC_ORIGIN` 없음) |
| 10 | CI 편입 | 4 | 4 | 5 | 4 | 테스트: `worker` 필수 + `worker-e2e` 관찰, ratchet, D10 배포. 최소: 작업 하나(Linux), parity 체크리스트 |
| 11 | fixture 채널 ID | 4 | 5 | 3 | 3 | 최소: 허용된 4개(`…a1` 관리자·`…b2` 허용·`…c3` 거부·`…d4` 기타 — 처음엔 거부, [허용] 시나리오용)로 충분, public-scan은 손대지 않는다 |
| 12 | 비밀값 위생 | 5 | 4 | 5 | 4 | 위협·테스트: 허용 필드 로거, 카나리 테스트(응답·로그), `console.` 사용처 1곳, 콜백은 쿼리 없는 URL로 303 |
| | **합** | **54** | **47** | **53** | **48** | 기조는 최소(운영 비용), 경계는 위협·테스트 |

### 구멍별 결론 (한 줄씩)

1. 사용자에게 보이는 키 = `releases/<v>/SHA256SUMS`에 적힌 파일(`.dmg`·`.deb`·`.sig` 포함) + `SHA256SUMS`·`manifest.json`. CI 토큰은 문법에 맞는 `releases/**` 전부 + `latest.json`. 정책 밖 403, R2 null 404(cicd.md 구현 중 변경 80).
2. `GET /update/{{current_version}}` → `latest.json` 바이트 그대로 200 또는 204. endpoint는 앱이 런타임에 넣고 `tauri.conf.json`에 없다. 헤더가 다운로드에도 붙으므로 셸이 `Update.download_url` 출처를 Worker 출처와 대조한다.
3. `CI_VERIFY_TOKEN`은 `GET·HEAD /releases/**`·`GET /update/*`에서만 해석하고 소스 검사·행렬 테스트·배포 뒤 음성 검사로 고정한다.
4. 앱은 Bearer, 랜딩은 `__Host-cdl_s` 쿠키. 콜백 하나가 흐름 레코드의 `kind`로 가르고, 흐름 결합 쿠키 `__Host-cdl_f`가 두 흐름 모두를 시작한 브라우저에 묶는다. 관리 POST는 Lax 쿠키 + Origin 정확 일치 + 세션 폼 토큰 + form-urlencoded.
5. access 24h·refresh 30일 슬라이딩 rotation + 절대 상한 60일(`created_at + 60d`, 사용자 결정 Q1), 해시만 저장. 쓴 토큰이 60초 안에 다시 오고 후계가 미사용이면 후계 폐기·재발급, 그 밖의 재사용은 세션 폐기. 3일 유예는 네트워크·5xx·429·형식 없는 응답에만.
6. 메모리 스로틀(IP당 6회/10분) → 미만료 흐름 32개 상한(503) → 쓰기. 폴링 최소 간격 1.5초는 메모리. 10분 만료는 alarm이 멱등으로 정리.
7. `CHZZK_AUTHORIZE_URL`·`CHZZK_API_BASE`는 `PUBLIC_ORIGIN`이 루프백일 때만 덮어쓸 수 있다. 가짜 치지직 핸들러 하나(msw·node), `.dev.vars.example`만 커밋. 앱 주소는 빌드 env, 릴리스는 https만.
8. G-ID는 ROADMAP 미체크 단계. `channel-id-check.mjs`로 사용자 본인이 돌려 "같다/다르다"만 기록. 다르면 허용목록 `owner_channel_id` 열(대안 B), 앱 계약은 그대로.
9. `wrangler.jsonc`에 `account_id` 없음(env `CLOUDFLARE_ACCOUNT_ID`). DO는 `exports` 형식, 클래스 `AuthStore`·바인딩 `AUTH`, 첫 배포 뒤 바꾸지 않는다. `worker-config.mjs`가 검사.
10. gate `worker`(설치·불변식·types+tsc·vitest·dry-run) + 관찰 `worker-e2e`(wrangler dev), ci.yml 작업·`ci-ok` needs·guard·parity·pre-push·dependabot·advisories·typos·ratchet, `release.mjs worker` + `worker-bundle`(cicd.md 81~83).
11. 채널 ID 리터럴은 허용된 4개만, 토큰·id는 base64url 또는 런타임 생성.
12. 로거 하나·허용 필드, 쿼리·토큰·code·state·채널 id 금지, 카나리 테스트, invocation 로그 끔, 오류 본문은 `{code}`뿐.

---

## 1. 범위

- **이번 구현**: `worker/`(TypeScript, Cloudflare Workers, DO SQLite, R2 읽기), CI 편입(§13), `release.mjs worker`·release.yml `worker-bundle`·`deploy-worker` 채우기, 문서(이 파일, cicd.md 80~83, app.md 59, ROADMAP, CLAUDE.md).
- **설계만**(Phase 3b, §11): 앱 셸 `AuthService`·`SessionStore`·`OwnershipGate` 활성화·updater command, 프런트 로그인 화면·배너, 앱 E2E 확장.
- **하지 않음**: 실제 배포, 실제 로그인, Cloudflare·치지직 개발자 앱 설정 변경. 모두 사용자가 준비한 뒤 함께 한다(§15·§16 W9).
- **Worker가 진짜로 막는 것**은 설치 파일·업데이트 배포와 세션 발급이다. 본인 영상 제한과 허용목록의 앱 쪽 강제는 클라이언트 정책이다(ROADMAP "우회 불가능할 필요는 없음").

## 2. 결정 표

사용자 결정(2026-10-06)은 그대로 쓰고, 이 문서가 더한 선택은 근거를 적는다.

| 주제 | 결정 | 근거 |
|---|---|---|
| 허용목록 저장 | DO `AuthStore`의 SQLite 테이블 `allowlist` | 사용자 결정. 강한 일관성 → 제외가 다음 요청부터 |
| 허용목록 관리 | 랜딩 `/admin`. 관리자 = 요청마다 `ADMIN_CHANNEL_IDS`(secret)로 판정, 토큰·쿠키에 관리자 클레임 없음. 허용목록 편집·세션 끊기·거부된 시도에서 [허용]. 관리자는 허용목록에 없어도 늘 허용 | 사용자 결정 + 위협 안(저장소 조작으로 승격 불가, 잠김 방지) |
| Worker 연결 불가 시 앱 | 마지막 **성공한 갱신**(`verifiedAt`)부터 3일 안이면 저장 세션으로 사용(`signedIn{offline}`), 지나면 로그인 화면. 유예는 네트워크 계열(연결·DNS·TLS·시간 초과·5xx·429·Worker 형식이 아닌 응답)에만. 형식 있는 401·403은 즉시 차단. 진행 중 다운로드는 항상 계속 | 사용자 결정 + 위협 안("Worker 형식 응답만 판정") |
| 허용목록 재확인 | 앱 시작 + 24시간마다 refresh(= 대조 1회). 그 사이 Worker에 닿는 모든 요청도 DO 대조 | 사용자 결정 |
| 앱 세션 | access 24h, refresh 30일 슬라이딩 rotation, DO에 SHA-256만, 폐기 가능. **절대 상한 60일**(`session.created_at + 60d`. access·refresh 만료와 세션 `expires_at`은 이 값을 넘지 않는다. 지나면 refresh는 형식 있는 401 `session_expired` → 재로그인) | 사용자 결정(30일 슬라이딩 2026-10-06, 60일 상한은 Q1 답변 2026-10-06). 상한은 R7(치지직 앱 90일 미사용 삭제) 대책도 된다 |
| 업데이트 | 시작 때 세션 확인 성공 직후 한 번 자동 확인 → 배너, 설치는 사용자. 설정 > 정보에 수동 버튼 | 사용자 결정 |
| Worker 주소 | 저장소에 없음. 원천은 저장소 변수 `DIST_BASE_URL` 하나. 앱은 빌드 env `CHZZK_WORKER_BASE`, Worker는 배포 `--var PUBLIC_ORIGIN` | 사용자 결정(workers.dev 서브도메인 비공개) |
| DO 구성 | 클래스 `AuthStore` 하나, `idFromName("main")` 하나, `exports: {AuthStore: {type:"durable-object", storage:"sqlite"}}`(레거시 `migrations`와 섞지 않음) | 최소. dry-run·vitest 실측은 exports만. 무료 플랜은 SQLite DO만 |
| 토큰 형식 | 불투명 32바이트 난수 base64url + 종류 접두(`cda_`·`cdr_`·`cdw_`·`cdf_`). 서명·클레임 없음. 검증 = SHA-256 해시로 DO 조회 | 최소(서명 키·회전 절차 없음). hex가 아니라 public-scan과 충돌 없음 |
| 웹 세션 | 쿠키 `__Host-cdl_s`, 12시간 절대, 갱신 없음 | 관리 권한이 붙는 세션은 짧게(위협). 랜딩은 드물게 쓴다. **확정**(Q2 답변 2026-10-06) |
| 앱 흐름 피싱(A3) | `/auth/login/:handle`이 확인 코드·경고 페이지를 보이고 [계속]을 눌러야 치지직으로 간다. 랜딩 "내 기기"에서 자기 세션을 끊을 수 있다 | 위협. 운영 비용 0, 클릭 하나. **확정**(Q3 답변 2026-10-06) |
| 응답 유실 창 | 60초 | 위협(60)·최소/테스트(30)·UX(120)의 중간. 앱의 재시도는 1회. **확정**(Q7 답변 2026-10-06) |
| 치지직 토큰 | 저장하지 않는다. `users/me` 뒤 버린다. revoke도 부르지 않는다(같은 앱의 다른 기기 토큰까지 지운다) | 기존 웹 앱과 같다(chzzk-oauth.md §8) |
| 사용자 필드 | `channelId`만(폴백 없음). 없거나 `^[0-9a-f]{32}$`가 아니면 `failed(user_format)` | 폴백이 다른 식별자를 채널 ID로 오인하는 쪽이 더 위험(위협). 실제 필드는 G-ID 도구가 보여 준다 |
| R2 버킷 이름 | `wrangler.jsonc`에 커밋(`chzzk-downloader-dist`). `R2_BUCKET`은 secret에서 변수로 | 이 문서가 더한 선택(cicd.md 72 (카)를 바꾼다, 82 (다)). wrangler가 `bucket_name`을 요구하고, 계정 id 없이 버킷 이름만으로는 접근 경로가 없다. 대안(자리표시 + 배포 때 치환)은 코드만 늘린다. **확정**(Q5 답변 2026-10-06) |
| 라우터·HTML | 의존성 없이 경로 표 + `switch`, 서버 렌더 HTML, 스크립트 0개 | 공급망 표면이 우리 코드뿐. 행렬 테스트가 표를 열거 |
| Range | 단일 범위만 206/416, 다중·문법 오류는 200 전체 | 순수 함수 하나. R2 `Headers` 위임은 만족 불가에도 200 전체를 준다(실측) |

---

## 3. 아키텍처

```
                 ┌──────────────────── Cloudflare(workers.dev, 주소는 DIST_BASE_URL) ────────────────────┐
앱(Rust 셸) ─Bearer cda_─▶ /auth/start·poll  /auth/refresh·logout  /api/me  /update/:v  /releases/:v/:f │
브라우저 ──────────────▶ /auth/login/:handle ─[계속]─▶ 303 치지직 account-interlock                      │
          ◀────────────  /auth/callback?code&state (앱·웹 공용, 흐름 레코드 kind로 분기) → 303 /auth/done │
브라우저 ─cookie cdw_──▶ /  /auth/web/start  /auth/web/logout  /admin*  /releases/:v/:f                  │
CI verify ─CI token───▶ /releases/**  /update/:v  (읽기 전용, 그 밖은 쓰레기 Bearer와 같다)              │
                        Worker fetch ─RPC─▶ DO AuthStore(SQLite: flow·session·refresh·allowlist·denied) │
                                     └────▶ R2 DIST(releases/…)  직접 스트리밍, 리다이렉트 없음           │
                 └──────────────────────────────────────────────────────────────────────────────────────┘
```

- Worker는 상태가 없다. 상태 변경은 DO RPC 하나 = `transactionSync` 하나다. DO는 바깥 요청(치지직·R2)을 하지 않는다.
- 치지직 Open API 호출은 로그인 때 두 번뿐(토큰 교환, `users/me`). 갱신·허용목록 대조는 DO만 본다.

```
worker/
  package.json            type: module, private, packageManager pnpm@12.9.1(app과 같음), engines node ^22.12 || >=24
  pnpm-lock.yaml          독립 lockfile(app과 워크스페이스 아님: app은 vitest 5, 여기는 4.1.11)
  pnpm-workspace.yaml     빌드 스크립트 허용(workerd·esbuild), minimumReleaseAge 예외는 설치 실측 뒤 [확인 필요]
  wrangler.jsonc          name chzzk-downloader, main, compatibility_date 고정, exports(AuthStore), durable_objects AUTH, r2_buckets DIST,
                          vars(CHZZK_AUTHORIZE_URL·CHZZK_API_BASE 운영 기본값만), observability(invocation 로그 끔 [확인 필요]), workers_dev true, preview_urls false
  .dev.vars.example       자리표시 값만(§10). .dev.vars·worker-configuration.d.ts·dist/·.wrangler/는 .gitignore
  tsconfig.json           types: ["./worker-configuration.d.ts", "@cloudflare/workers-types", "@cloudflare/vitest-plugin/types"]
  vitest.config.ts        cloudflareTest({ wrangler: { configPath } , miniflare: { bindings: <모든 secret·var를 자리표시로 덮음> } })
  src/
    index.ts              export default { fetch } + export { AuthStore }
    routes.ts             경로 표(데이터): method·pattern·auth·handler
    config.ts             env 파싱·검증(순수). 실패하면 모든 경로 500 config_error
    core/                 순수 함수(cloudflare:* import 금지, 정적 테스트가 확인)
      token.ts            난수·b64url·SHA-256·접두 판별·상수 시간 비교
      cookies.ts          cookieSpec(origin): https면 __Host- + Secure, 루프백 http면 접두 없음
      range.ts            Range → {offset,length} | 416 | 무시
      keys.ts             /releases 경로 문법·보이는 키 판정·SHA256SUMS 파서
      semver.ts           parse·compare(xtask semver.rs 벡터를 테스트 상수로)
      chzzk.ts            토큰·users/me 응답 해석(content ?? json, 짧은 code만)
      updater.ts          (latest bytes, current) → 200 | 204
      html.ts             태그드 템플릿 html``(자동 이스케이프), raw()는 허용 목록, 페이지 템플릿
      log.ts              한 줄 JSON, 허용 필드만(타입으로 강제)
      usercode.ts         확인 코드(혼동 문자 뺀 32자 알파벳 8자, "K7QX-4MRA" 꼴)
    store/
      AuthStore.ts        DurableObject 클래스. RPC 메서드만, 로직은 아래에 위임
      schema.ts           마이그레이션 배열(meta.schema_version)
      flows.ts            start·continue·consume·finish·claim·sweep (sql, now 주입)
      sessions.ts         admit·activate·check·rotate·revoke
      allowlist.ts        allow·disallow·denied upsert·cap
    http/                 핸들러 (req, ctx) → Response. ctx = {config, auth(DO stub), r2, now, log}
      auth.ts releases.ts update.ts landing.ts admin.ts health.ts release-auth.ts(CI 토큰 해석 한 곳)
  test/
    fake-chzzk.mjs        가짜 치지직: (Request, state) → Response 하나(JSDoc 타입, Node·workerd 공용)
    network.ts            @msw/cloudflare setupNetwork + fake-chzzk 핸들러
    setup.ts              enable/reset/disable, console 수집(카나리)
    seed-release.mjs      합성 릴리스 생성기(가짜 바이트·SHA256SUMS·schema를 만족하는 manifest·latest)
    unit/  store/  http/  matrix.test.ts  hygiene.test.ts  xtask-keys.test.ts
  scripts/
    fake-chzzk-server.mjs node:http 래퍼(wrangler dev E2E·수동)
    e2e-dev.mjs           wrangler dev + 가짜 서버 + 시나리오 + 로그 카나리(§12.3)
    channel-id-check.mjs  G-ID 도구(이미 있음, §15)
```

규칙 셋: (1) `core/`는 `cloudflare:*`를 import하지 않는다(타입 import 제외). (2) `store/*.ts` 함수는 `SqlStorage`와 `now`를 인자로 받는다(시간은 늘 주입). (3) 핸들러는 `ctx.auth`(DO stub RPC)만 부른다. DO 메서드 안의 SQL 경로는 동기 함수만(await를 끼우지 않는다).

---

## 4. 엔드포인트

자격 종류: **없음**, **A**(앱 access `Authorization: Bearer cda_…`), **R**(본문 refresh `cdr_…`), **W**(웹 세션 쿠키 `__Host-cdl_s=cdw_…`), **W+admin**(W이고 채널 ∈ `ADMIN_CHANNEL_IDS`), **CI**(`Authorization: Bearer <CI_VERIFY_TOKEN>`), **F**(흐름 결합 쿠키 `__Host-cdl_f=cdf_…`). A·W·R은 모두 허용 채널이어야 한다(관리자는 늘 허용).

공통: 오류 본문은 JSON 경로에서 `{"code":"<소문자_밑줄>"}` 하나(입력 되풀이·원인 문자열 없음). 모든 응답 `Cache-Control: no-store`(R2 본문은 `private, no-store, no-transform`), `X-Content-Type-Options: nosniff`. HTML 응답은 `Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; form-action 'self' <CHZZK_AUTHORIZE_URL의 출처>; frame-ancestors 'none'; base-uri 'none'`(스크립트 0개. `form-action`에 치지직 출처를 넣는 것은 폼 전송 뒤 302 대상에도 `form-action`을 적용하는 브라우저가 있어서다), `Referrer-Policy: same-origin`(**`no-referrer`가 아니다**: Fetch 표준은 정책이 `no-referrer`인 문서에서 보내는 GET·HEAD가 아닌 요청에 `Origin: null`을 싣는다. 그러면 [계속]·웹 로그인·관리 POST가 전부 Origin 검사에 막힌다. `same-origin`이면 같은 출처 POST에 Origin이 그대로 실리고 치지직으로 가는 303에는 referrer가 나가지 않는다), `Cross-Origin-Opener-Policy: same-origin`. `no-referrer`는 콜백의 303 응답에만 쓴다(§14). 비밀값은 URL에 싣지 않는다(치지직이 정한 콜백 `code`·`state`만 예외, 콜백은 즉시 303으로 쿼리 없는 URL로 간다).

### 4.1 공개·로그인 흐름

| 경로 | 메서드 | 인증 | 요청 | 성공 | 오류 |
|---|---|---|---|---|---|
| `/health` | GET | 없음 | — | 200 `{"ok":true,"schema":<n>,"build":"<sha7>"}` | 503 `{"ok":false,"code":"config_error"}`(이름·값 없음. 배포 `--var`를 빠뜨리면 deploy-worker가 빨개진다) |
| `/` | GET | W 선택 | — | 200 HTML. 비로그인: 소개 + [치지직으로 로그인] 폼. 허용: 최신 버전·OS별 다운로드 표(SHA256SUMS에서)·미서명 해제 안내·내 기기. 관리자: [관리] 링크 | — |
| `/assets/site.css` | GET | 없음 | — | 200 CSS(소스에 문자열, 해시 이름, 불변 캐시) | 404 |
| `/auth/start` | POST | 없음 | JSON `{"pollVerifier":"<b64url SHA-256(pollSecret)>","client":"app/<버전> <os>"}` | 201 `{"loginId","loginUrl":"<PUBLIC_ORIGIN>/auth/login/<handle>","userCode":"K7QX-4MRA","expiresAt","pollIntervalMs":2000}` | 400 `bad_request`, 429 `rate_limited`(+`Retry-After`), 503 `busy`(상한) |
| `/auth/login/:handle` | GET | 없음 | handle(128bit b64url) | 200 HTML 확인 페이지: 큰 글씨 코드, "치지직 다운로더 앱에서 직접 시작한 로그인이 아니면 이 창을 닫으세요. 다른 사람이 보낸 링크라면 계속하지 마세요.", [계속] 폼 | 404 HTML(만료·모름 구분 없음) |
| `/auth/login/:handle` | POST | 없음 + Origin = `PUBLIC_ORIGIN` | form 빈 본문 | 303 → `CHZZK_AUTHORIZE_URL?clientId&redirectUri&state`(state 새로 발급), `Set-Cookie: __Host-cdl_f`(10분) | 403 `bad_origin`, 404, 409 `already_used` |
| `/auth/web/start` | POST | 없음 + Origin | form 빈 본문 | 303 → 치지직, `Set-Cookie: __Host-cdl_f` | 403, 429, 503 `busy` |
| `/auth/callback` | GET | F | 쿼리 `code`, `state` | 303 → `/auth/done?r=<ok|denied|cancelled|failed>`. **F 쿠키는 남긴다**(done 페이지가 읽고 지운다). 웹 흐름 허용이면 `Set-Cookie: __Host-cdl_s` + 303 `/`(이때는 F 삭제) | 늘 303 `/auth/done?r=failed`(상세 사유는 로그 이벤트로만) |
| `/auth/done` | GET | F 선택 | `r` | 200 HTML. F 쿠키가 있으면 `binder_hash`로 종결된 flow 행을 찾아(2분 안) 표시 내용을 채우고 **F 쿠키를 지운다**: ok "로그인했어요. 앱으로 돌아가세요"(앱 흐름은 확인 코드를 다시 보인다) / denied "허가 없는 채널이에요: {이름} · 채널 ID {id}" / cancelled / failed. 쿠키가 없거나 행이 없으면 `r`만으로 이름·ID 없는 일반 문구 | — |
| `/auth/poll` | POST | 없음(loginId + pollSecret) | JSON `{"loginId","pollSecret"}` | 200 `{"status":"pending"}` · `{"status":"ok", …토큰 묶음(§6.3)}`(1회, 행 삭제) · `{"status":"denied","channelName"}` · `{"status":"cancelled"}` · `{"status":"failed","code"}` | 404 `not_found`(모름·만료·verifier 불일치·이미 수령을 구분하지 않는다), 429 `too_soon`(1.5초 안, 쓰기 0) |
| `/auth/web/logout` | POST | W + Origin + 폼 토큰 | form | 303 `/`, 쿠키 삭제, 세션 revoked | 403 |

### 4.2 앱 세션

| 경로 | 메서드 | 인증 | 요청 | 성공 | 오류 |
|---|---|---|---|---|---|
| `/auth/refresh` | POST | R | JSON `{"refreshToken"}` | 200 토큰 묶음 | 400, 401 `session_expired`(모름·만료), 401 `session_revoked`(로그아웃·관리자·재사용 감지), 403 `not_allowed`(허용 제외. 세션도 폐기) |
| `/api/me` | GET | A | — | 200 `{"channelId","channelName","accessExpiresAt","serverTime"}`(`channelId`는 토큰 묶음과 같은 본인 판정용 값 = `owner_channel_id ?? 로그인 channelId`, §5) | 401 `invalid_token`(형식·모름·만료 → 앱은 refresh), 401 `session_revoked`, 403 `not_allowed` |
| `/auth/logout` | POST | A 또는 R | JSON `{"refreshToken"?}` | 204, 세션 revoked(이미 끝난 세션도 204) | 400 |

### 4.3 릴리스 읽기 (§9)

| 경로 | 메서드 | 인증 | 성공 | 오류 |
|---|---|---|---|---|
| `/update/:current` | GET | A 또는 CI | 200 `releases/latest.json` 바이트 그대로(`latest.version > current`) / 204(같거나 높음, 또는 latest.json 없음) | 400 `bad_version`, 401/403 |
| `/releases/latest.json` | GET·HEAD | CI만 | 200 바이트 그대로 | 403 `forbidden`(A·W), 404(R2 null) |
| `/releases/:v/:file` | GET·HEAD | A, W, CI | 200·206 스트리밍, 304 | 400 `bad_key`(문법), 403 `forbidden`(이 자격에 보이지 않는 키), 404(보이는 키인데 R2 null), 416 |

### 4.4 관리 (전부 W+admin. POST는 Origin + 폼 토큰 + `application/x-www-form-urlencoded`)

| 경로 | 메서드 | 요청 | 성공 | 오류 |
|---|---|---|---|---|
| `/admin` | GET | — | 200 HTML: 관리자 목록(읽기 전용)·허용목록·거부된 시도·활성 세션·감사 50줄 | 403 HTML(관리자 아님), 비로그인은 303 `/` |
| `/admin/allow` | POST | `channelId`(`^[0-9a-f]{32}$`), `note`(≤64자) | 303 `/admin`(같은 채널의 거부 기록 삭제) | 400 `bad_channel_id`, 403 |
| `/admin/disallow` | POST | `channelId` | 303, 그 채널 세션 전부 revoked('disallowed') | 400, 403, 409 `is_admin` |
| `/admin/sessions/:id/revoke` | POST | — | 303 | 404, 403 |
| `/admin/denied/:channelId/allow` | POST | — | 303(허용목록 추가 + 거부 행 삭제, 한 트랜잭션) | 404, 403 |
| `/admin/denied/:channelId/dismiss` | POST | — | 303 | 404, 403 |
| `/me/sessions/:id/revoke` | POST | W + Origin + 폼 토큰 | — | 303 `/`(자기 채널의 세션만, `revoked_why='user'`) | 404, 403 |

그 밖 경로는 404 `not_found`, 메서드가 다르면 405. `/auth/cancel`은 두지 않는다(앱이 폴링을 멈추면 10분 뒤 만료).

### 4.5 자격 × 경로 행렬 (테스트로 고정)

`routes.ts`가 표를 내보내고 `matrix.test.ts`가 **모든 경로 × 자격 8종**(없음 / A 정상 / A 폐기된 세션 / A 허용 제외 / W 일반 / W 관리자 / CI / 쓰레기 Bearer)을 요청해 표의 `auth` 값에서 기대 상태를 계산해 비교한다. 표에 경로를 더하고 기대를 안 정하면 테스트가 실패한다. 고정 단언: CI가 허용되는 경로 집합 = `{GET·HEAD /releases/**, GET /update/*}` 정확히. 핵심 칸:

| 경로 | 없음 | A | W | W+admin | CI |
|---|---|---|---|---|---|
| `/update/:v` | 401 | 200/204 | 401 | 401 | 200/204 |
| `/releases/latest.json` | 401 | 403 | 403 | 403 | 200 |
| `/releases/:v/:file`(보이는 키) | 401 | 200 | 200 | 200 | 200 |
| `/api/me`, `/auth/refresh`, `/auth/logout` | 401 | 200 | 401 | 401 | **401** |
| `/admin*`, `/me/*` | 303 `/` | 303 `/` | 403 | 200/303 | **303 `/`**(Bearer 무시, 쿠키만) |
| `/auth/start`·`poll`·`login/:h` | 동작 | 동작 | 동작 | 동작 | 동작(자격과 무관) |

CI 토큰은 `http/release-auth.ts`의 `releaseAuth()` 함수 하나에서만 읽고, 그 함수는 `http/releases.ts`·`http/update.ts`만 부른다. 비교는 제시된 토큰과 `CI_VERIFY_TOKEN` **둘을 SHA-256한 뒤 `timingSafeEqual`**(길이가 늘 같아 throw가 없다). 다른 경로에서 CI 토큰은 쓰레기 Bearer와 같다(별도 분기가 없으니 실수로 넓어지지 않는다). 소스 검사 테스트가 `CI_VERIFY_TOKEN` 문자열이 **`src/config.ts`·`src/http/release-auth.ts`** 두 파일 밖에 없음을 단언한다(§0 3행·§13 모두 이 두 파일이다).

---

## 5. Durable Object `AuthStore` 스키마

생성자에서 `blockConcurrencyWhile`로 `meta.schema_version`을 읽고 `schema.ts`의 배열(`[v1 SQL, …]`)을 그 번호부터 적용한다(되돌리지 않음). 테스트: 빈 DB → 최신, 각 중간 버전 → 최신의 `sqlite_master`가 같다. 시각은 epoch ms 정수, 해시는 SHA-256 hex(저장소 안에만, 로그·응답에 없다). 모든 쓰기는 `transactionSync` 안.

```sql
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);                  -- schema_version

CREATE TABLE flow (                                                      -- 로그인 흐름(앱·웹)
  id            TEXT PRIMARY KEY,                                        -- loginId(앱) / 내부 id(웹), 128bit b64url
  kind          TEXT NOT NULL CHECK (kind IN ('app','web')),
  handle_hash   TEXT UNIQUE,                                             -- 앱: SHA-256(handle), /auth/login/:handle
  state_hash    TEXT UNIQUE,                                             -- 치지직 state 해시. 앱은 [계속] 때, 웹은 start 때. 콜백이 소비하면 NULL
  binder_hash   TEXT,                                                    -- SHA-256(흐름 결합 쿠키)
  poll_verifier TEXT,                                                    -- 앱: b64url(SHA-256(pollSecret))
  user_code     TEXT,                                                    -- 앱: 확인 코드
  client        TEXT,                                                    -- "app/0.2.0 macos"(64자 자름, 표시용)
  status        TEXT NOT NULL CHECK (status IN ('started','redirected','exchanging','ok','denied','cancelled','failed')),
  session_id    TEXT,                                                    -- ok: 세션 id(토큰은 저장하지 않는다)
  channel_name  TEXT,                                                    -- denied 표시용(출력 때 이스케이프)
  channel_id    TEXT,                                                    -- denied 표시용(done 페이지가 본인에게 보인다, §8.3)
  fail_code     TEXT,                                                    -- failed: token|user|timeout|user_format|binder
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL                                         -- started·redirected: +10분, 종결 뒤: +2분
);
CREATE INDEX flow_expires ON flow(expires_at);

CREATE TABLE allowlist (
  channel_id       TEXT PRIMARY KEY CHECK (length(channel_id) = 32),
  channel_name     TEXT,                                                 -- 마지막으로 본 이름(표시용)
  owner_channel_id TEXT,                                                 -- §15 대안 B 자리. 기본 NULL(= channel_id)
  note             TEXT,
  added_by         TEXT NOT NULL,                                        -- 관리자 채널 id
  added_at         INTEGER NOT NULL
);

CREATE TABLE session (
  id            TEXT PRIMARY KEY,                                        -- 128bit b64url
  kind          TEXT NOT NULL CHECK (kind IN ('app','web')),
  channel_id    TEXT NOT NULL,
  channel_name  TEXT,
  status        TEXT NOT NULL CHECK (status IN ('unclaimed','active','revoked')),
  access_hash   TEXT UNIQUE,                                             -- app: 현재 access 해시, web: 쿠키 해시
  access_exp    INTEGER,                                                 -- app: +24h, web: +12h
  csrf          TEXT,                                                    -- web: 폼 토큰(난수 b64url). 비밀값: 로그·URL 금지, HTML hidden 필드에만
  client        TEXT,
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,                                        -- refresh·웹 로그인 때만 갱신(요청마다 쓰지 않는다)
  expires_at    INTEGER NOT NULL,                                        -- unclaimed: +2분, app: min(마지막 refresh +30일, created_at +60일), web: +12h
  revoked_at    INTEGER,
  revoked_why   TEXT CHECK (revoked_why IN ('logout','admin','disallowed','reuse','user'))
);
CREATE INDEX session_channel ON session(channel_id, status);
CREATE INDEX session_expires ON session(expires_at);

CREATE TABLE refresh (
  hash        TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES session(id),
  status      TEXT NOT NULL CHECK (status IN ('active','used')),
  child_hash  TEXT,                                                      -- 이 토큰으로 발급한 다음 토큰
  issued_at   INTEGER NOT NULL,
  used_at     INTEGER,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX refresh_session ON refresh(session_id);

CREATE TABLE denied (
  channel_id   TEXT PRIMARY KEY,
  channel_name TEXT,                                                     -- 공격자 제어 값. 128자 자름·제어 문자 제거, 출력 때 이스케이프
  first_at     INTEGER NOT NULL, last_at INTEGER NOT NULL, attempts INTEGER NOT NULL
);
CREATE INDEX denied_last ON denied(last_at);

CREATE TABLE audit (                                                     -- 500행 상한, 비밀값 없음
  id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL,
  actor TEXT NOT NULL, action TEXT NOT NULL, target TEXT                 -- allow|disallow|revoke_session|reuse_detected|refresh_recovered|dismiss
);
```

- **허용 판정** `isAllowed(channelId) = channelId ∈ ADMIN_CHANNEL_IDS ∪ allowlist`. 관리자는 늘 허용(잠김 방지). 관리자를 `disallow`할 수 없다(409). **관리자도 `allowlist` 행을 가질 수 있다**(이름·메모·`owner_channel_id` 자리를 위해. 행이 없어도 허용은 변하지 않고, 행이 있어도 [빼기]는 409). 본인 판정용 채널 ID는 `ownerId(channelId) = allowlist.owner_channel_id ?? channelId`이고 토큰 묶음(§6.3)·`/api/me`·`check()`의 `channelId`가 모두 이 값이다(관리자 본인이 본인 영상 검사의 주 사용자이므로 §15 대안 B가 관리자에게도 적용된다).
- **상한·스로틀**(쓰기 전에): 메모리 `Map<ipKey, 횟수>`(`ipKey = SHA-256(CF-Connecting-IP(IPv6는 /64) + 일 단위 소금)` 앞 16바이트) 10분 창 **`START_RATE_10M`회**(기본 6) → 429. 한도는 config 값이고 **dev 모드(§10.1)에서만** `.dev.vars`로 덮을 수 있다(운영은 늘 6). 헤더가 없으면 키는 상수 `"none"`(운영에서는 Cloudflare가 이 헤더를 늘 채우므로 생기지 않는다). vitest·wrangler dev는 한 IP(또는 없음)에서 6회를 금방 넘기므로 `.dev.vars.example`은 `START_RATE_10M=1000`으로 두고, 스로틀 자체의 429는 `store/flows.ts`의 순수 함수(`throttle(map, ipKey, limit, now)`)를 `runInDurableObject` 안에서 limit 6으로 직접 불러 고정한다(W3). 미처리 헤더는 테스트가 `CF-Connecting-IP`를 요청마다 바꿔 키 분리를 확인한다. 비만료 `flow` 행이 32개면 503 `busy`(메모리 카운터, 생성자에서 `SELECT count(*)`로 채움). 폴링 최소 간격 1.5초는 `Map<loginId, lastPollMs>`(행 쓰기 0). DO가 쫓겨나면 메모리가 비지만 상한 32행이 쓰기를 여전히 묶는다.
- **alarm**: 쓰기 뒤 `setAlarm(min(가장 이른 flow.expires_at, 가장 이른 unclaimed session, 다음 하루 청소))`. `setAlarm`이 기존 알람을 덮어쓰는지는 **[확인 필요]**(조사에서 미검증). W3의 첫 테스트를 "`setAlarm`을 두 번 부르면 `getAlarm()`이 둘째 값"으로 고정하고, 아니면 `getAlarm()`으로 읽어 더 이른 쪽만 설정한다. `alarm()`은 만료 flow 삭제, `expires_at` 지난 session·refresh 삭제, revoked 세션은 30일 뒤 삭제, `denied` 30일·200행, `audit` 500행 정리, 남은 행이 있으면 다음 알람. at-least-once라 멱등. `runDurableObjectAlarm`로 테스트.
- **거부 기록**: 같은 채널은 `last_at`이 1시간 넘게 지났을 때만 갱신(쓰기 절약), 200행 상한(오래된 `last_at`부터).
- **무료 한도 계산**(최악, 하루): 공격자 start 32행 × 144순환 × 쓰기 2 ≈ 9,200, [계속] ≤ 4,600, 거부 기록 ≤ 4,800, 정상 사용자 20명 refresh 3회 × 3행 + 로그인 < 300 → **≈ 19,000 < 100,000**. 요청 수(10만/일)는 쓰기 없이도 소진될 수 있다. WAF 요청 수 제한 규칙(Q4)은 zone이 없어 쓸 수 없고 그 위험은 받아들인다(구현 중 변경 11 (나)·(아)). 폴링은 2초 × 10분 = 최대 300요청/로그인, 쓰기 0.

### 5.1 RPC 목록

`startApp(verifier, client, now)` · `startWeb(now)` · `continueApp(handleHash, now)` → `{state, binder}` · `consume(stateHash, binderHash, now)` → `{id, kind} | null`(state_hash를 NULL로, status exchanging) · `finish(id, outcome, now)` · `claim(loginId, verifierHash, now)` → 토큰 묶음 또는 상태 · `admit(channelId, name, kind, client, now)` → `{sessionId}` 또는 denied · `activate(sessionId, now)` → 첫 access·refresh 발급(`unclaimed → active` 한 번만) · `check(accessHash, now)` → `{sessionId, channelId, ownerChannelId, isAdmin}` | 사유 · `rotate(refreshHash, now)` · `revoke(sessionId, why)` · `logout(accessHash | refreshHash)` · `webLogin(channelId, name, now)` → `{cookieToken, csrf}` · `webCheck(cookieHash, now)` · `adminView()` · `allow(id, note, by)` · `disallow(id, by)` · `dismissDenied(id)` · `mySessions(channelId)` · `revokeMine(channelId, sessionId)`.

### 5.2 refresh rotation (`rotate`, transactionSync 하나)

| 찾은 행 | 조건 | 결과 | 상태 변화 |
|---|---|---|---|
| 없음 | — | 401 `session_expired` | 없음 |
| 세션 revoked | — | 401 `session_revoked` | 없음 |
| 세션·토큰 만료(절대 상한 `now ≥ created_at + 60일` 포함) | — | 401 `session_expired` | 없음(alarm이 지움) |
| 채널이 허용 채널 아님 | — | 403 `not_allowed` | 세션 revoked('disallowed') |
| `active` | — | 200 새 묶음 | 이 행 `used`(used_at=now, child_hash=새), 자식 `active` 삽입(`cap(now+30일)`), 새 access(`cap(now+24h)`, `access_hash` 교체), 세션 `last_seen_at`·`expires_at=cap(now+30일)`. `cap(t) = min(t, created_at+60일)` |
| `used` | `now - used_at ≤ 60s` **이고** 자식이 `active`(한 번도 제시되지 않음) | 200 새 묶음 (응답 유실 복구) | 자식 삭제, 새 자식 삽입(만료는 `active` 행과 같이 `cap`), 이 행 `child_hash=새`(60초 안에 또 잃어도 같은 규칙), audit `refresh_recovered`(세션 id 앞 6자) — 60초 창 안에서 탈취자와 피해자가 번갈아 같은 부모를 내면 매번 복구로 끝나 `reuse_detected`가 남지 않으므로, 복구 자체를 기록하고 관리 화면 활성 세션에 복구 횟수를 보인다 |
| `used` | 60초 넘음, 또는 자식이 이미 `used` | 401 `session_revoked` | 세션 revoked('reuse'), 그 세션의 refresh 행 전부 삭제, audit `reuse_detected` |

- 동시 갱신은 앱 셸이 막는다(single-flight mutex, 앱 인스턴스 하나). 서버 유예는 "응답 유실 재시도" 한 가지뿐이다. 탈취자가 옛 토큰을 다시 내면 60초 안이라도 자식이 쓰인 뒤라 세션이 날아간다(피해자는 재로그인 1회, 그쪽으로 닫힌다).
- 앱은 새 묶음을 `session.json`에 원자적으로 쓴 **뒤에** 상태를 바꾼다. 서버 커밋 뒤 로컬 쓰기 전에 앱이 죽으면 60초 안의 재시작은 복구되고, 넘으면 재로그인 1회로 수용한다.
- **절대 상한 60일**(사용자 결정, Q1 답변 2026-10-06): 세션의 `created_at + 60일`을 넘는 만료는 발급하지 않는다(위 `cap`. access도 상한을 넘지 않으므로 60일이 지난 뒤 남은 access가 24시간 더 쓰이지 않는다). 상한이 지나면 refresh는 표의 "만료" 행대로 형식 있는 401 `session_expired`이고 앱은 재로그인한다(§11.3). `check()`도 `access_exp`로 같은 시점에 401 `invalid_token`이 된다. 테스트(W3): `created_at + 60일` 직전 rotate는 자식·access 만료가 상한으로 잘리고, 직후 rotate는 401 `session_expired`.

---

## 6. 토큰·쿠키

### 6.1 공통

- 난수는 `crypto.getRandomValues` 32바이트, base64url(패딩 없음). 비교는 해시끼리 또는 `crypto.subtle.timingSafeEqual`. 저장은 SHA-256(WebCrypto). CPU 10ms라 bcrypt류는 쓰지 않는다(256bit 난수라 필요 없다).
- 접두로 종류를 가른다: access `cda_`, refresh `cdr_`, 웹 세션 `cdw_`, 흐름 결합 `cdf_`. 다른 자리에 다른 접두가 오면 401 `invalid_token`(행렬 테스트에 포함). 토큰·id가 hex가 아니라 테스트 픽스처에 박아도 public-scan `hex-id`·`keyed-hex`에 걸리지 않는다(그래도 테스트는 런타임 생성이 기본).

| 토큰 | 형식 | 수명 | 저장(서버) | 운반·저장(클라이언트) |
|---|---|---|---|---|
| access(앱) | `cda_` + 32B | 24h(세션 절대 상한을 넘지 않음) | `session.access_hash`·`access_exp` | `Authorization: Bearer`, `session.json`(0600) |
| refresh(앱) | `cdr_` + 32B | 30일 슬라이딩(쓸 때마다 새 토큰), 세션 절대 상한 60일(`created_at + 60d`) | `refresh.hash` | POST 본문, `session.json` |
| 웹 세션 | `cdw_` + 32B | 12h 절대 | `session.access_hash` | 쿠키 `__Host-cdl_s` |
| 흐름 결합 | `cdf_` + 32B | 10분 | `flow.binder_hash` | 쿠키 `__Host-cdl_f` |
| loginId·handle | 16B b64url | 10분 | `flow.id`, `flow.handle_hash` | 앱 메모리 / 브라우저 URL(handle로는 폴링할 수 없다) |
| pollSecret | 32B b64url | 10분 | `flow.poll_verifier`(해시) | 앱 메모리(`Secret`)만 |
| state | 32B b64url | 10분 | `flow.state_hash` | 브라우저 URL(치지직 왕복) |
| CI 토큰 | 사용자가 만든 난수(b64url 권장) | 수동 교체 | Worker secret `CI_VERIFY_TOKEN`(원문) | GitHub 환경 `release` secret 같은 이름·같은 값 |

- access 검증 순서: 접두 → `check(SHA-256(token))`: 세션 `active`이고 **`kind='app'`**이고 `access_exp > now`이고 채널이 허용 채널. `webCheck`는 `kind='web'`을 SQL 조건에 넣는다(`access_hash`는 앱 access와 웹 쿠키가 함께 쓰는 UNIQUE 열이라 접두 검사와 이중 방어). 만료·모름은 401 `invalid_token`(앱은 refresh), revoked는 `session_revoked`, 허용 제외는 403 `not_allowed`(세션 revoked). 통과해도 `last_seen_at`은 쓰지 않는다(쓰기 절약, 슬라이딩은 refresh가 맡는다).
- 수락 테스트: "관리자가 세션을 끊은 직후 같은 access로 `/releases/...`가 401", "허용목록에서 뺀 직후 403 `not_allowed`"(지연 0).

### 6.2 쿠키

`cookieSpec(PUBLIC_ORIGIN)` 하나가 만든다: https면 `__Host-` 접두 + `Secure`, 루프백 http(dev)면 접두 없는 `cdl_s`·`cdl_f`에 `Secure` 없음. 공통 `HttpOnly; SameSite=Lax; Path=/`(콜백이 `/auth/callback`이라 Path를 좁히면 `__Host-`가 허용하지 않는다). `__Host-cdl_s` Max-Age 43200, `__Host-cdl_f` Max-Age 600. 삭제는 `Max-Age=0`.

### 6.3 토큰 묶음 (poll ok·refresh 성공 응답)

```json
{"status":"ok","accessToken":"cda_…","accessExpiresAt":"RFC3339","refreshToken":"cdr_…","refreshExpiresAt":"RFC3339",
 "channelId":"<본인 판정용 32 hex = owner_channel_id ?? 로그인 channelId>","channelName":"…","isAdmin":false,"serverTime":"RFC3339"}
```

`channelId`는 앱의 본인 영상 판정에 쓰는 값이다(§15). `serverTime`은 시계 차이 진단용이고 유예 판정에는 쓰지 않는다.

---

## 7. 로그인 시퀀스

### 7.1 앱 흐름

```
앱(Rust)                              Worker / DO                              브라우저                 치지직(또는 가짜)
pollSecret = rand32(메모리만), verifier = b64url(SHA-256)
POST /auth/start {pollVerifier, client} ─▶ 스로틀·상한 → startApp: loginId·handle·userCode, flow(started, +10m)
◀─ 201 {loginId, loginUrl=/auth/login/<handle>, userCode, expiresAt, pollIntervalMs}
화면 "브라우저에 코드 K7QX-4MRA가 보이는지 확인하세요", opener로 loginUrl ──────────▶ GET /auth/login/<handle>
                                       확인 페이지(코드·경고·[계속])
                                                                               POST [계속](Origin 검사)
                                       continueApp: state·binder 생성, flow(redirected, state_hash, binder_hash)
                                       303 → {AUTHORIZE_URL}?clientId&redirectUri&state, Set-Cookie cdl_f ─▶ 로그인·동의
                                       ◀──────────────────────── GET /auth/callback?code&state (cdl_f 동반)
                                       consume(H(state), H(binder)) 한 트랜잭션(일회용: state_hash NULL, exchanging)
                                         없음·불일치 → failed(binder) / code 없음 → cancelled
                                       POST {API_BASE}/auth/v1/token(10s) → GET /open/v1/users/me(10s) → 토큰 버림
                                       admit(channelId, name, kind=app): 허용 → session(unclaimed, +2m), flow(ok, session_id, +2m)
                                                                          거부 → denied upsert, flow(denied, channel_name, +2m)
                                       303 /auth/done?r=ok (cdl_f 유지) ──▶ GET /auth/done: binder로 flow 조회 → 코드 다시 표시, cdl_f 삭제
POST /auth/poll {loginId, pollSecret} 2초 간격 ─▶ claim: H(pollSecret) == verifier? 아니면 404
                                                  ok → activate(session) → 토큰 묶음, flow 행 삭제(1회 수령)
◀─ {status:"ok", …} → session.json(0600, atomic) → emit auth-changed
```

- 토큰은 콜백이 아니라 **첫 `ok` 폴링 때** 발급한다. 원문 토큰은 DO에 한순간도 저장되지 않는다(테스트: 콜백 뒤 모든 테이블 덤프에 토큰 원문이 없다).
- 브라우저 이력·URL에 남는 것은 handle과 state뿐이고 둘로는 폴링할 수 없다.
- 확인 코드는 앱 화면과 확인 페이지에 함께 보이고 사람이 눈으로 맞춘다(입력하지 않는다. 입력형은 폴링 탈취를 못 막고 마찰만 늘린다). 완료 페이지에도 코드를 다시 보인다.
- `ok` 응답을 앱이 잃으면 다음 poll은 404다. 앱은 자기 `expiresAt`과 비교해 지났으면 `Expired{LoginTimeout}`, 아니면 `Error{LoginLost}`로 가른다(§11.3).

### 7.2 웹 흐름

`GET /` → [치지직으로 로그인] 폼 → `POST /auth/web/start`(Origin) → `startWeb`: flow(kind=web, state_hash, binder_hash, +10m), `Set-Cookie: cdl_f`, 303 치지직 → `GET /auth/callback` → consume(state, binder) → 교환·`users/me` → `admit(kind=web)`: 허용 → `webLogin`: session(web, active, +12h, access_hash=쿠키 해시, csrf) → `Set-Cookie: cdl_s`, 303 `/`. 거부 → denied upsert, flow(denied, channel_name·channel_id 보관, +2분) → 303 `/auth/done?r=denied`(F 쿠키 유지. done 페이지가 `binder_hash`로 그 flow 행을 찾아 이름·ID를 보이고 F를 지운다. 콜백이 state를 이미 소비했으므로 남은 F 쿠키로는 아무것도 할 수 없다). 거부된 사람에게는 세션 쿠키를 주지 않는다. `flow`에 `channel_id` 열을 둔다(denied 표시용, §5).

- 로그인 CSRF(A4): 공격자가 자기 `code`·`state`를 피해자에게 열게 해도 피해자 브라우저의 `cdl_f` 해시가 그 흐름의 `binder_hash`와 다르다 → failed. 앱 흐름도 [계속]에서 같은 쿠키를 심으므로 규칙이 하나다.
- 콜백의 kind는 쿼리가 아니라 **흐름 레코드**가 정한다. 앱 흐름을 웹 세션으로 바꾸거나 그 반대는 불가능하다(테스트: 같은 콜백에 app 행·web 행을 주고 응답 모양이 다름).

### 7.3 치지직 호출 규칙 (기존 웹 앱 코드 이식, `core/chzzk.ts`)

- 토큰 교환 `POST {CHZZK_API_BASE}/auth/v1/token` JSON `{grantType:"authorization_code", clientId, clientSecret, code, state}`; 사용자 `GET {CHZZK_API_BASE}/open/v1/users/me` `Authorization: Bearer`. 둘 다 `AbortSignal.timeout(10_000)`. 응답은 `json.content ?? json`. `redirectUri = PUBLIC_ORIGIN + "/auth/callback"`(요청 Host에서 만들지 않는다. 치지직 등록 값과 바이트가 같아야 한다 — 테스트).
- 사용자 필드는 `channelId`만. 없거나 `^[0-9a-f]{32}$`가 아니면 `failed(user_format)`. `channelName`은 문자열이면 128자로 자르고 제어 문자를 지우며, 아니면 빈 값.
- 실패는 `{stage:'token'|'user', status, code?(^[\w.-]{1,50}$), timedOut}`만. 응답 본문·토큰은 어떤 오류·로그에도 담지 않는다. 성공 본문이 JSON이 아니면(프록시 HTML) status만 담은 실패.
- 치지직 토큰은 `users/me` 뒤 버린다. revoke는 부르지 않는다.

---

## 8. 허용목록·관리 화면

### 8.1 `/admin` (서버 렌더, 스크립트 0개)

1. **관리자**: `ADMIN_CHANNEL_IDS` 읽기 전용("secret에서만 바꿀 수 있어요").
2. **허용목록**: 이름·ID·메모·추가자·시각·활성 세션 수, [빼기]. 아래 "채널 ID로 추가"(`^[0-9a-f]{32}$`, 메모 선택. 이름은 그 채널이 처음 로그인할 때 채운다).
3. **거부된 시도**: 최근순 이름·ID·횟수·마지막 시각, **[허용]**(허용목록에 넣고 거부 행 삭제, 한 트랜잭션)·[지우기].
4. **활성 세션**: 채널·종류(앱/웹)·client·만든 시각·마지막 갱신·복구 횟수(`refresh_recovered`가 0이 아니면 표시), [끊기].
5. **감사 기록** 50줄.

- 모든 출력은 태그드 템플릿 `html\`…\``의 자동 이스케이프를 거친다. 원문 삽입은 `raw()`만이고 테스트가 `raw(` 사용처를 허용 목록과 대조한다. XSS 테스트: 채널 이름 `<script>alert(1)</script>"'&`로 로그인 거부 → `/admin`·`/auth/done` 응답에 `<script`가 없다.
- **CSRF 세 겹**: (1) `SameSite=Lax` 쿠키(교차 사이트 POST에 안 실린다), (2) `Origin`이 `PUBLIC_ORIGIN`과 정확히 같다(없거나 `null`이면 403; `Sec-Fetch-Site`가 있으면 `same-origin`이어야 한다. 이 검사가 실제 브라우저에서 통과하려면 HTML의 `Referrer-Policy`가 `same-origin`이어야 한다(§4 공통). W7 E2E에 "브라우저 규칙대로 Origin을 실은 POST가 통과, `Origin: null`은 403" 사례를 둔다), (3) hidden `csrf` = 세션 행의 `csrf` 난수(상수 시간 비교). 본문은 `application/x-www-form-urlencoded`만(아니면 415). 테스트: Origin 없음/다름/같음 × 토큰 없음/틀림/맞음 6사례, 비관리자 403.
- "허용 빼기"는 그 채널의 모든 세션을 revoked('disallowed')로 같은 트랜잭션에서 바꾼다 → 앱은 다음 Worker 접촉에서 403 `not_allowed`.
- 허용 채널이 로그인할 때마다 `allowlist.channel_name`을 갱신한다(표시용). Open API 채널 조회로 미리 채우는 것은 하지 않는다(바깥 호출 하나 = 실패 경로 하나).

### 8.2 내 기기 (허용 사용자, 랜딩 `/`)

내 채널의 활성 세션(앱·웹, client·만든 시각) 목록과 [끊기](`/me/sessions/:id/revoke`, CSRF 같음, `revoked_why='user'`). A3로 생긴 세션을 사용자가 알아채고 끊는 출구다.

### 8.3 부트스트랩

**부트스트랩 모드 = `ADMIN_CHANNEL_IDS`가 비어 있음(secret 없음)**. 이 모드에서는 허용 채널이 공집합이라 모든 로그인이 거부되고, `/admin*`은 403, `/health`는 200에 `"bootstrap":true`를 더한다(이름·값 없음). 첫 배포 뒤 사용자가 `/`에서 로그인하면 거부 화면(`/auth/done`, §4.1)이 **본인** 채널 이름과 ID를 보여 준다(본인에게 비밀이 아니다). 그 값을 `wrangler secret put ADMIN_CHANNEL_IDS`로 넣으면 운영 모드가 된다. 값이 있는데 형식이 틀리면 `config_error`(§10.1). ID는 저장소·대화에 옮기지 않는다. W1 config 가드 표에 "비어 있음 → 부트스트랩, 틀린 형식 → config_error"를 넣는다.

---

## 9. R2 게이트·updater·랜딩

### 9.1 키 문법과 보이는 키 (구멍 1·3)

R2 바인딩 `DIST`. Worker는 **읽기만** 한다(소스에 `DIST.put`·`DIST.delete`가 없음을 테스트가 확인). 경로 문법(정규식 하나, 안 맞으면 400 `bad_key`):

```
^/releases/latest\.json$
^/releases/(?<v>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/(?<f>[A-Za-z0-9._-]{1,128})$     ('..'·'/'·'%' 불가, 대소문자 정확 일치)
```

| 자격 | 보이는 키 | 근거 |
|---|---|---|
| CI | `releases/latest.json`과 문법에 맞는 `releases/<v>/<f>` 전부(R2에 있으면 200, 없으면 404) | xtask `Source::Worker`(`xtask/src/release.rs` 529~)는 `SHA256SUMS`·`manifest.json`·SHA256SUMS의 각 파일(`.sig` 포함)·`latest.json`을 GET하고 **404를 "없음" → 판정 실패 → 롤백**으로 읽는다. 그래서 404는 "문법이 맞고 R2가 null"일 때만 낸다. 자격 실패·정책 거부는 401·403(xtask exit 2, 되돌리지 않음). `previous`는 xtask가 S3로 읽어 Worker를 지나지 않지만 CI에는 보인다 |
| A·W | `releases/<v>/<f>` 중 `f`가 `releases/<v>/SHA256SUMS`의 항목(`.dmg`·`.deb`·`.sig` 모두 포함: xtask `put`이 표와 같을 때만 올린다)이거나 `SHA256SUMS`·`manifest.json`인 것. `previous`·`latest.json`은 403 | 랜딩이 `.dmg`·`.deb`를 줄 수 있다(cicd.md §5 "manifest의 키만"을 바꾼다, 구현 중 변경 80). 사용자에게는 존재 여부가 비밀이 아니라 403/404를 가른다 |

- `SHA256SUMS` 해석 결과는 isolate 메모리에 버전별 캐시(불변 객체, LRU 8개). **`/update/*`·`/releases/latest.json`은 캐시 없이 매번 R2를 읽는다**(롤백 직후 isolate마다 되돌린 매니페스트를 60초 동안 주지 않게). `latest.json`의 60초 캐시는 랜딩 `/`의 최신 버전 표시에만 쓴다.
- 계약 테스트 `xtask-keys.test.ts`: 합성 릴리스 2개(`seed-release.mjs`, `.sig` 포함)를 R2에 넣고 xtask verify가 요청하는 키 목록(테스트 안의 표, `release/expected-artifacts.json`에서 계산)을 CI 토큰으로 모두 GET → 200·바이트 동일. `.dmg`·`.deb`를 A·W로 200. 틀린 CI 토큰은 401(404가 아님).

### 9.2 응답 규칙 (`http/releases.ts`)

- **리다이렉트 없음**: `DIST.get` 결과를 `new Response(obj.body)`로 직접 스트리밍. presigned URL·302 금지(reqwest는 교차 호스트 리다이렉트에서 `Authorization`·Cookie 계열만 지우고 다른 헤더는 넘긴다). 테스트: 모든 `/releases` 응답이 3xx가 아님.
- 헤더: `Content-Length`(전체면 `obj.size`, 부분이면 범위 길이), `ETag: obj.httpEtag`, `Content-Type`(확장자 표: json·text/plain·octet-stream), `Content-Disposition: attachment; filename="<f>"`(ASCII 문법만 통과하므로 `filename*` 불필요. `.json`·`SHA256SUMS`는 inline), `Accept-Ranges: bytes`, `Cache-Control: private, no-store, no-transform`, `Content-Encoding` 없음(xtask가 바이트 그대로 받는다).
- Range: `core/range.ts`가 파싱. 단일 `bytes=a-b`·`a-`·`-n`만 인정하고 다중 범위·문법 오류는 무시하고 200 전체(RFC 9110 허용). 인정된 범위는 **`DIST.head(key)`로 `size`를 먼저 얻어**(없으면 404) 순수 함수 `resolveRange(spec, size) → {offset,length} | 416`으로 판정한다(`{offset,length}` 객체 형태는 범위를 벗어나면 throw하고, `Headers` 위임은 만족 불가에도 200 전체를 주므로 둘 다 416을 만들 수 없다 — 조사 사실). 만족 불가 → 416 + `Content-Range: bytes */<size>`. 아니면 `DIST.get(key, {range})` → 206, `Content-Range`는 `obj.range`·`obj.size`로. Range 요청은 Class B 연산 2회(head + get)이고 무료 한도 계산(§5)에 그대로 넣어도 여유가 있다(Range는 updater·브라우저 이어받기에만 쓰인다).
- 조건부: `If-None-Match`는 `onlyIf`로, body 없는 결과면 304(ETag 유지). `If-Range`는 무시. HEAD는 같은 판정에 본문 없음.
- 스트림 응답에 `Content-Length`가 실제 배포에서도 유지되는지는 첫 배포 체크리스트(§16 W9).

### 9.3 updater (`http/update.ts`, 구멍 2)

- 경로 `GET /update/{{current_version}}`. 앱이 런타임에 `app.updater_builder().endpoints(vec![format!("{base}/update/{{{{current_version}}}}")])?.header("Authorization", "Bearer <access>")?.build()?`로 넣는다. `tauri.conf.json`에는 endpoints를 커밋하지 않는다(pubkey만). 릴리스 빌드에서 http endpoint는 플러그인이 거부한다(`InsecureTransportProtocol`) — 이중 방어.
- 판정: `latest.json`을 R2에서 읽어(없으면 204) `version`과 `current`를 semver 비교(xtask `semver.rs`와 같은 우선순위, prerelease 포함. 벡터를 `semver.test.ts`에 옮기고 주석에 원천을 적는다). `latest > current` → 200 바이트 그대로(정적 `platforms` 형식, 플랫폼 키 6개는 `latest.schema.json` 그대로, Worker는 키를 해석하지 않는다). 아니면 204. `current`가 semver가 아니면 400(`+`는 플러그인이 퍼센트 인코딩 → 디코드).
- 플러그인 2.13.1 소스 사실: `header()`는 확인·다운로드 요청 모두에 붙는다(`updater.rs` 537·616·691·783·810), 204 = `Ok(None)`(624), 2xx 아닌 응답은 다음 endpoint로 넘어가 결국 `ReleaseNotFound`(644-647), `Update.download_url`은 공개 필드(752). 그래서 셸은 (가) `check()` 전에 세션 판정을 끝내고(`check()`는 401과 5xx를 구분 못 한다), (나) `download_url.origin()`이 `CHZZK_WORKER_BASE`와 다르면 받지 않고 `update_untrusted_url`로 끝낸다(토큰이 다른 호스트로 나가지 않는다). 매니페스트 `url`은 `DIST_BASE_URL` = Worker 출처라 정상이면 늘 같다.
- 매니페스트 `url`이 `${DIST_BASE_URL}/releases/<v>/<file>`이므로 `DIST_BASE_URL`은 **경로 없는 출처**여야 한다. sign-publish preflight에 이 검사를 더한다(cicd.md 82).
- `download()`는 전체를 메모리에 받는다(연구 사실). 범위 밖으로 받아들인다.

### 9.4 deploy-worker 검사 계약 (release.yml, `release.mjs worker`)

| 요청 | 기대 |
|---|---|
| (배포 전) `latest.json`의 `version` | 이번 태그보다 높으면 `superseded`: 배포·검사 없이 exit 0(태그마다 concurrency 그룹이 따로라 낮은 태그의 deploy-worker가 늦게 끝나 옛 Worker를 덮는 것을 막는다. cicd.md 81 (나)) |
| `GET {DIST_BASE_URL}/health` | 200, `ok:true`(30초 간격 최대 5분, 전파 지연) |
| `GET /update/0.0.0`(CI 토큰) | 200, 본문 = `latest.json`, `version == 이번 태그`. prev 대신 `0.0.0`을 써서 첫 릴리스에도 성립(§5의 "prev 버전 요청"을 바꾼다, cicd.md 81) |
| `GET /update/<이번 태그>`(CI 토큰) | 204 |
| `GET /releases/latest.json`(CI 토큰) | 200, 본문 = `latest.json`(구현 중 변경 36 (아)) |
| 음성 | `GET /admin`(CI 토큰) → 200이 아님(303), `GET /releases/latest.json`(토큰 없음) → 401, `GET /api/me`(CI 토큰) → 401, `GET /update/0.0.0`(틀린 Bearer) → 401(구현 중 변경 36 (아)) |

실패하면 exit 1 → `ci-loop:release`. Worker 되돌리기는 사람이 `wrangler rollback`(DO 선언 변경은 rollback으로 되돌아가지 않으므로 DO 선언을 바꾸는 PR은 따로 낸다). `VERIFY_VIA=worker`이면 verify는 **이미 배포된 Worker**로 읽으므로(deploy-worker가 verify 뒤) 키 계약은 버전 사이에 넓히기만 하고, 좁히는 변경은 Worker를 먼저 배포한다(cicd.md §5 "3단계 앞으로").

### 9.5 랜딩 UX (`/`, 스크립트 없음)

- 비로그인: "치지직 다운로더 — 허가된 채널만 받을 수 있어요." [치지직으로 로그인]. "앱을 이미 받았으면 앱 안에서 로그인해요."
- 허용: 최신 버전·게시 날짜, OS별 표(macOS `.dmg`(Apple Silicon 전용 안내), Windows `-setup.exe` 기본·`.msi`, Linux AppImage·`.deb`)에 SHA-256 [복사 없음, 텍스트](크기는 보이지 않는다: 요청당 R2 2회 상한, 구현 중 변경 38 (가)). 설치 안내 접힘 패널(`<details>`): macOS ~~Gatekeeper "그래도 열기"~~ → 응용 프로그램으로 옮긴 뒤 `xattr -dr com.apple.quarantine`(실기기는 손상 경고였다, 구현 중 변경 45), Windows SmartScreen "추가 정보 → 실행", Linux `chmod +x`·`apt install ./…deb`. "앱을 연 뒤 이 페이지와 같은 치지직 계정으로 로그인해 주세요." 아래 "내 기기". 관리자면 [관리].
- 거부(`/auth/done?r=denied`): "이 채널은 사용 허가가 없어요 · 채널: {이름} · 채널 ID {id} · 관리자에게 채널 이름을 알려 주세요." "다른 계정으로 로그인하려면 네이버에서 먼저 로그아웃해 주세요."
- 정적 문구는 `src/http/copy.ts` 한 곳(한국어, 해요체).

---

## 10. 설정·시크릿·변수

### 10.1 설정 가드 (`config.ts`, A11)

시작 때 `loadConfig(env)`가 검사하고 실패하면 **모든 경로가 500 `config_error`**(`/health`는 503)다. 응답에 이름·값 없음, 로그에 어긋난 키 이름만.

- `PUBLIC_ORIGIN` 필수. 요청 URL의 출처가 `PUBLIC_ORIGIN`과 다르면 `config_error`(`/health` 포함 → deploy-worker가 설정 어긋남을 잡는다). dev에서 `127.0.0.1:8787`로 들어오면 500인 것은 문서로 안내한다(`localhost:8787`만).
- **dev 모드 = `PUBLIC_ORIGIN`의 호스트가 루프백**(`localhost`·`127.0.0.1`·`[::1]`). 그때만 `CHZZK_AUTHORIZE_URL`·`CHZZK_API_BASE`가 http·다른 호스트일 수 있고 쿠키가 접두 없이 나간다. 아니면: 두 값이 없거나 정확히 `https://chzzk.naver.com/account-interlock`·`https://openapi.chzzk.naver.com`, `PUBLIC_ORIGIN`은 https, `CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CI_VERIFY_TOKEN` 비지 않음, `ADMIN_CHANNEL_IDS`는 **비어 있으면 부트스트랩 모드(§8.3)**, 있으면 쉼표 구분 `^[0-9a-f]{32}$`(하나라도 틀리면 config_error).
- 커밋된 `wrangler.jsonc` `vars`에는 `PUBLIC_ORIGIN`을 두지 않는다(배포 설정이 vars를 싣고 `--no-bundle` 배포가 그대로 쓰므로 dev 값이 들어가면 운영 Worker가 dev 모드로 뜬다). 운영 값은 deploy-worker의 `--var PUBLIC_ORIGIN:$DIST_BASE_URL --var BUILD_ID:<sha7>`, dev 값은 `.dev.vars`. `worker-config.mjs`가 이를 검사한다(§13). **[확인 필요, W1]**: (가) `deploy --dry-run --outdir dist`가 리디렉트 설정 `dist/wrangler.json`을 쓰는지(조사에서 확인된 산출물은 `index.js`와 바인딩 목록뿐). 안 쓰면 `release.mjs worker-bundle`이 원본 `wrangler.jsonc`에서 `main: "dist/index.js"`·`no_bundle: true`만 바꾼 `dist/wrangler.json`을 직접 만든다(JSONC 주석 제거 뒤 JSON.parse, 키 추가 둘). `worker-config.mjs`의 "dist vars에 `PUBLIC_ORIGIN` 없음" 검사는 이 파일을 본다. (나) `--var PUBLIC_ORIGIN:https://…`처럼 값에 `:`이 있을 때 첫 `:`에서만 나뉘는지. 아니면 `--var`를 쓰지 않고 `dist/wrangler.json`의 `vars`에 배포 때 두 값을 써 넣는다(같은 생성 단계).

### 10.2 `.dev.vars.example` (커밋하는 유일한 dev 설정)

```
PUBLIC_ORIGIN=http://localhost:8787
CHZZK_AUTHORIZE_URL=http://127.0.0.1:8788/account-interlock
CHZZK_API_BASE=http://127.0.0.1:8788
CHZZK_CLIENT_ID=dev-client-id
CHZZK_CLIENT_SECRET=dev-client-placeholder
ADMIN_CHANNEL_IDS=000000000000000000000000000000a1
CI_VERIFY_TOKEN=dev-ci-token
BUILD_ID=dev
START_RATE_10M=1000
```

- `START_RATE_10M`은 dev 모드에서만 읽는다(운영 `wrangler.jsonc` vars·`--var`에 있으면 `worker-config.mjs`가 실패). 실제 로그인(§15)과 수동 확인에서는 지워도 된다.

- `.dev.vars`는 `.gitignore`(`.dev.vars`·`.dev.vars.*`, 예외 `.dev.vars.example`). 로컬의 `worker/.dev.vars`는 1Password Environment `chzzk-local-dev`(로컬 테스트용 치지직 앱, 여러 서비스 공용)의 **마운트(FIFO, 고칠 수 없음)**이고 `CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CHZZK_REDIRECT_URI` 세 키만 있다(구현 중 변경 12 (나)(마). 운영 자격증명은 마운트하지 않는 `chzzk-downloader-worker-prod`). 그래서 dev 명령은 둘로 나누고 늘 `--env-file`을 명시한다(wrangler는 `--env-file`을 주면 기본 `.dev.vars`를 읽지 않는다 **[확인 필요, W1 첫 작업]**):
  - `pnpm dev`(가짜 치지직): `wrangler dev --port 8787 --env-file .dev.vars.example` + 가짜 서버. 실제 자격증명이 로컬에 있어도 읽지 않는다.
  - `pnpm dev:real`(실제 치지직 로그인): `wrangler dev --port 8787 --env-file .dev.vars --var PUBLIC_ORIGIN:http://localhost:8787`. `CHZZK_AUTHORIZE_URL`·`CHZZK_API_BASE`가 없으니 실제 주소를 쓰고, `ADMIN_CHANNEL_IDS`가 없으니 부트스트랩 모드(§8.3)다. 관리 화면까지 보려면 `--var ADMIN_CHANNEL_IDS:<본인 ID>`를 사용자가 직접 붙인다(값을 저장소·로그에 남기지 않는다).
  - 포트 8787·경로 `/auth/callback`은 등록된 개발용 리디렉션 `http://localhost:8787/auth/callback`과 같아야 해서 바꾸지 않는다(`worker-config.mjs`가 `package.json` dev 스크립트의 `--port 8787`을, 라우트 표 테스트가 콜백 경로를 고정한다).
- vitest는 `.dev.vars`를 읽으므로(실측) `vitest.config.ts`의 `miniflare.bindings`가 모든 키를 위 자리표시 값으로 덮고, 테스트 하나가 "각 바인딩 = 자리표시"를 단언한다(로컬에 실제 `.dev.vars`가 있어도 결과가 CI와 같고 실제 비밀이 테스트에 들어가지 않는다).

### 10.3 시크릿·변수 표 (cicd.md §8과 ROADMAP에 더한다)

| 위치 | 이름 | 종류 | 용도 |
|---|---|---|---|
| Worker secret(`wrangler secret put`, 사용자 수동, CI가 넣지 않는다) | `CHZZK_CLIENT_ID`, `CHZZK_CLIENT_SECRET` | secret | 치지직 앱 |
| | `ADMIN_CHANNEL_IDS` | secret | 관리자 채널(쉼표 구분 32 hex) |
| | `CI_VERIFY_TOKEN` | secret | GitHub 환경 `release`의 같은 이름과 같은 값 |
| Worker var(배포 `--var`) | `PUBLIC_ORIGIN`(= `DIST_BASE_URL`), `BUILD_ID`(sha7) | var | 출처·콜백·쿠키 모드, `/health` 표시 |
| Worker var(`wrangler.jsonc` 커밋) | `CHZZK_AUTHORIZE_URL`, `CHZZK_API_BASE` | var | 운영 기본값(공개 값). dev는 `.dev.vars`로 덮음 |
| 저장소 secret(환경 `release`에서 옮김) | `DIST_BASE_URL` | secret | 매니페스트 url 접두 = Worker 출처 = 앱 빌드 `CHZZK_WORKER_BASE`. 경로 없는 https 출처. Actions 로그 마스킹(구현 중 변경 1, cicd.md 84) |
| 저장소 변수 | `R2_BUCKET`(secret에서 옮김) | variable | 버킷 이름은 `wrangler.jsonc`에 커밋되므로 비밀이 아니다(cicd.md 82) |
| 환경 `release` | `CLOUDFLARE_API_TOKEN`(Workers 제품 범위 Editor(계정의 모든 Worker 배포·수정, 생성·삭제 불가, 구현 중 변경 44 (가)) + 기존 R2 버킷 권한(버킷 한정 객체 읽기·쓰기, 뗐는지는 미확인). R2 바인딩 배포에 R2 권한이 더 필요하지 않다: 구현 중 변경 35 (마), 실제 확인은 W9 첫 배포. secret 목록 읽기는 W9 런북 §2.6에서 확인), **`CLOUDFLARE_ACCOUNT_ID`** | secret | deploy-worker. `wrangler.jsonc`에 `account_id`를 두지 않는다 |
| 환경 `release` | `CI_VERIFY_TOKEN` | secret | verify(`VERIFY_VIA=worker`)와 deploy-worker 검사 |
| 환경 `release` | `VERIFY_VIA`(`s3`→`worker`) | variable | 전환 스위치(W9 런북 §5) |
| 저장소 변수 | `WORKER_DEPLOY_ENABLED`(`false`→`true`) | variable | deploy-worker의 작업 수준 `if:`가 환경 변수를 보지 못해 저장소 수준이다(구현 중 변경 36 (차), cicd.md 96 (아)). W9 런북 §5 |

---

## 11. 앱 셸 계약 (이번에는 설계만. app.md §12를 대체한다 — app.md 구현 중 변경 59)

### 11.1 빌드 설정·Worker 주소 (fail closed)

- `app/src-tauri/build.rs`가 빌드 env `CHZZK_WORKER_BASE`를 읽어 `cargo:rustc-env`로 넘기고 **`cargo:rerun-if-env-changed=CHZZK_WORKER_BASE`**를 찍는다(없으면 값이 바뀌어도 캐시된 빌드가 옛 주소를 품는다). 검사 규칙은 `build.rs` 안의 순수 함수(`worker_base_rule(profile, value) -> Result`)로 빼서 단위 테스트한다(`build.rs`는 `#[cfg(test)]`를 못 쓰므로 같은 파일을 `include!`하는 테스트 하나). cargo feature `auth`는 만들지 않는다: **"주소가 있으면 켜짐"** 하나다(`features.auth = CHZZK_WORKER_BASE.is_some()`).
  - 릴리스 프로필(`PROFILE=release`): 없거나 `https://`가 아니거나 경로·쿼리가 있으면 **컴파일 실패**(메시지에 이름만). 조용히 `features.auth=false`인 릴리스가 나가지 않게.
  - debug: 없으면 `features.auth=false`(지금과 같은 개발 경험), 있으면 https 또는 루프백 http.
  - `--features e2e`에서만 런타임 env `CHZZK_E2E_WORKER_BASE`(루프백 http)로 덮어쓴다. 코드는 `e2e.rs`에만(`release-hygiene`·`hygiene-seed`가 그대로 증명한다).
- CI가 넣는 값: 태그 빌드는 저장소 변수 `DIST_BASE_URL`, PR·리허설·push master의 릴리스 프로필 빌드(`bundle (linux)`·`bundle`·release.yml `build`)는 `https://worker.example.invalid`. **태그 모드의 `release.mjs build`만** `CHZZK_WORKER_BASE == DIST_BASE_URL`이고 `example.invalid`가 아님을 확인하고, **태그 모드의 `stage`만** 바이너리에 placeholder 호스트 문자열이 있으면 실패한다(리허설 빌드는 일부러 placeholder를 넣으므로 리허설 `stage`는 이 검사를 건너뛴다 — cicd.md 82, `release.test.mjs`의 모드 × placeholder 표). debug 빌드(`tauri-build`·`e2e-native`·`tauri-clippy`·`tauri` test)는 영향 없다. 로컬 non-debug `pnpm tauri build`도 값이 필요하다(CLAUDE.md 명령에 적는다).
- 앱 CSP는 그대로(`connect-src`에 Worker 없음). Worker 호출·opener·클립보드는 전부 Rust.

### 11.2 저장 (`SessionStore`, `{app_config_dir}/session.json`)

```json
{"v":1,"origin":"https://…","channelId":"…","channelName":"…","isAdmin":false,
 "accessToken":"cda_…","accessExpiresAt":"RFC3339","refreshToken":"cdr_…","refreshExpiresAt":"RFC3339","verifiedAt":"RFC3339"}
```

`refreshExpiresAt`은 토큰 묶음(§6.3)의 값 그대로이고 세션 절대 상한(60일)을 넘지 않는다. 오프라인 유예의 끝을 이 값으로 자른다(§11.3).

`atomic_write` + 0600(Unix), `CredentialStore`(네이버 쿠키)와 분리. 토큰은 `Secret<String>`, 파일 타입의 `Debug`는 손으로(`***`). `origin`이 현재 빌드의 `CHZZK_WORKER_BASE`와 다르면 파일을 무시하고 signedOut(다른 Worker에 토큰을 보내지 않는다). 깨진 파일은 없는 것으로 보고 로그에 "session.json 손상"만. OS 키체인은 쓰지 않는다(core.md 결정 15와 같은 이유).

### 11.3 `AuthService` 상태 머신 (`crates/shell/src/auth.rs`, Tauri 비의존, `WorkerApi`·`Clock` trait 주입)

```
시작 ─load─┬─ session.json 없음(또는 origin 다름) ─────────────▶ SignedOut
           ├─ 있음, now < verifiedAt + 72h ──▶ SignedIn(낙관) ─bg refresh─┐
           └─ 있음, 유예 밖 ────────────────▶ Checking ─refresh(10초)────┤
                                                                         ▼
refresh 결과:  200 → SignedIn{online}, session.json 교체, verifiedAt=now, (시작 때 1회) update_check
               401 invalid_token/session_expired → Expired{SessionExpired}, 파일 삭제
               401 session_revoked → Expired{Revoked|ReuseDetected}, 삭제
               403 not_allowed → Denied{RemovedFromAllowlist, channelName}, 삭제
               네트워크 계열* ─┬─ 유예 안 → SignedIn{offline{since, graceUntil}}, 파일 유지, 재시도 예약
                               └─ 유예 밖 → Expired{GraceExpired}, **파일 유지**([다시 연결]이 로그인 없이 복구)
SignedOut/Expired/Denied/Cancelled/Error ─auth_login─▶ Pending{userCode, expiresAt} ─poll─▶ SignedIn | Denied | Cancelled | Expired{LoginTimeout} | Error{Network|Server|LoginLost}
SignedIn ─auth_logout─▶ SignedOut (POST /auth/logout 실패 무시 → 삭제)
```

- *네트워크 계열 = 연결·DNS·TLS 오류, 10초 시간 초과, 5xx, 429, `busy`·`config_error`·`internal`, Worker 형식(`{code}` JSON)이 아닌 응답(캡티브 포털 HTML 등), **그리고 형식 있는 401·403이 아닌 그 밖 4xx**(400 등 — 세션에 대한 판정이 아니므로 유예 규칙을 그대로 따른다: 유예 안이면 `SignedIn{offline}`, 밖이면 `Expired{GraceExpired}`. `reason`은 `Server`로 구분해 로그·툴팁에만 쓴다). **형식 있는 401·403만 즉시 차단**한다. `classify_verify` 표에는 "그 밖 4xx" 행이 따로 있고 기대값은 네트워크 행과 같다. 로그인 폴링의 `429 too_soon`은 상태를 바꾸지 않고 다음 간격까지 기다린다(`Pending` 유지, `LoginLost`·`Error`로 가지 않는다).
- 판정은 Rust 순수 함수 `classify_verify(now, verified_at, refresh_expires_at, outcome) -> Next` 하나이고 표 주도 테스트다. 시계를 되돌려 `now < verifiedAt`이면 유예하지 않는다. 그림의 "유예 안"은 정확히 `now < min(verifiedAt + 72h, refreshExpiresAt)`이다: 세션 절대 상한(60일, §5.2)이 지난 세션은 Worker에 닿지 못해도 유예하지 않고 `Expired{SessionExpired}`(파일 삭제)로 간다. 상한이 Worker에 닿은 채로 오면 형식 있는 401 `session_expired`라 같은 결과다.
- 재확인: 다음 갱신 = `verifiedAt + 24h`(access 만료 60초 전). 셸이 10분마다 벽시계로 확인하고, 창 포커스·절전 복귀에도 확인한다(tokio 타이머는 절전 동안 멈출 수 있다). 유예 중 재시도 1·2·5·10·30분, 이후 30분마다 + 포커스 때. `graceUntil`이 지나면 다음 틱에 `Expired{GraceExpired}`.
- refresh는 `tokio::sync::Mutex` 하나로 직렬화(single-flight). 응답 유실은 같은 refresh로 **1회** 재시도(60초 창, §5.2).

### 11.4 DTO·command·이벤트

```rust
pub struct AuthStatusDto { pub state: AuthState, pub channel_id: Option<String>, pub channel_name: Option<String>,
    pub reason: Option<AuthReason>, pub pending: Option<PendingDto>, pub offline: Option<OfflineDto>, pub verified_at: Option<String> }
pub enum AuthState { Disabled, Checking, SignedOut, Pending, SignedIn, Denied, Expired, Cancelled, Error }   // Checking만 새로
pub enum AuthReason { LoginTimeout, SessionExpired, Revoked, RemovedFromAllowlist, ReuseDetected, GraceExpired, Network, Server, LoginLost }
pub struct PendingDto { pub user_code: String, pub expires_at: String }
pub struct OfflineDto { pub since: String, pub grace_until: String }
pub struct UpdateInfoDto { pub version: String, pub current: String, pub notes: Option<String>, pub pub_date: Option<String> }
pub enum UpdateProgressEvent { Started { total: Option<u64> }, Chunk { received: u64 }, Downloaded, Installing }
```

| command | 동작 |
|---|---|
| `auth_status` | 현재 상태 |
| `auth_login` | start → opener → 폴링 태스크(2초, `expiresAt`까지). 이미 pending이면 그대로 |
| `auth_reopen` | 같은 loginUrl 다시 열기(flow가 `started`면 유효) |
| `auth_copy_login_url` | loginUrl을 클립보드에(Rust `clipboard-manager` 쓰기 권한 추가. URL에는 handle뿐) |
| `auth_cancel` | 폴링 중지, pollSecret 버림 → SignedOut |
| `auth_retry` | 지금 갱신 시도(오프라인·Checking 실패·유예 만료 화면의 [다시 연결]) |
| `auth_logout` | 서버 logout(실패 무시) → 파일 삭제 → SignedOut. 다운로드는 계속 |
| `update_check(manual)` | `ensure_fresh_access()` → 세션 판정 유효일 때만 `check()` → `Option<UpdateInfoDto>`. 실패는 조용히 로그 |
| `update_install(on_progress, confirm_pause)` | §11.6 |

이벤트 `auth-changed`(DTO 전체), `update-available`(UpdateInfoDto), `update-progress`. 새 command마다 `command_names.rs`·`capabilities/default.json`·`lib.rs` invoke_handler·`api.ts`·가짜 백엔드 `app/e2e/mock/backend.ts`·`tests/ipc.rs`·Playwright spec을 함께 고친다. bindings는 `UPDATE_BINDINGS=1`로 다시 만든다.

### 11.5 OwnershipGate와 다운로드 규칙

| 상황 | 동작 |
|---|---|
| `resolve` | `SignedIn`(온라인·오프라인 유예)이면 `ResolvedDto.ownership`을 `own/notOwn/unknown`으로, 아니면 `unchecked` + `notLoggedIn` 문구 |
| `enqueue` | `OwnershipGate::check`: 로그인 아님 → `notLoggedIn`, 아니면 `verdict(is_own_content(meta, channel_id))`(None 거부, 이미 있는 함수). 최근 resolve 캐시 32개 |
| 진행 중·대기 중 작업 | 인증 상태가 바뀌어도(로그아웃·만료·거부) **그대로 끝까지**(코어는 앱 세션을 쓰지 않는다) |
| `resume_job` | `SignedIn`이고 `JobRecord.channel_id == channel_id`일 때만. 아니면 `notLoggedIn`/`notOwnContent`, `.part` 유지 |
| 재시작 후 자동 이어받기 | `SignedIn`이 된 뒤에 돈다(유예 안 낙관 상태 포함). 유예 밖·로그아웃이면 보류하고 B1 배너 문구를 "로그인하면 이어받을 수 있어요"로. 같은 채널 작업만 |
| 채널이 바뀜 | 다른 채널의 멈춘 작업에 "다른 채널로 로그인해 이어받을 수 없어요"(지우기만) |

이 게이트는 §15 G-ID가 녹색일 때만 켠다(별 커밋). 그 전에는 로그인·허용목록만 동작하고 게이트는 늘 허용이다.

### 11.6 업데이트

- 자동 확인: 시작 후 **첫 성공 갱신 직후 한 번**(오프라인이면 안 함) → `update-available` → 배너 B4 "새 버전 {version}이 있어요 [지금 업데이트] [나중에]". [나중에]는 이번 실행 동안만.
- 수동(설정 > 정보 [업데이트 확인]): 판정 먼저, 결과 "최신 버전이에요" / 배너 / "업데이트를 확인하지 못했어요" / 오프라인이면 "로그인 서버에 연결할 수 없어 확인하지 못했어요".
- 설치: (1) `ensure_fresh_access()` 후 **빌더를 새로 만들어** `check()`(배너를 띄운 지 오래돼도 신선한 토큰). (2) `download_url.origin()` 대조(§9.3). (3) `download()`(진행률). 받는 중 작업이 있으면 프런트가 D1식 확인 대화상자 → `confirm_pause=true`로 다시 호출. (4) 매니저 `quit` 경로(일시정지 → `interrupted`, `jobs.json` flush, 종료 한 번만 가드 공유) → `install(bytes)` → macOS·Linux `app.restart()`, Windows는 설치기가 끝낸다. (5) 재시작 후 자동 이어받기 규칙이 작업을 되살린다. 설치 실패(서명 불일치 등)는 작업을 재개하고 "업데이트하지 못했어요". Linux `.deb` 설치본의 updater 권한(pkexec)과 macOS quarantine 재질문은 **[실기기 확인 필요]**.

### 11.7 화면·copy deck 추가 (app.md §8.9·§9에 반영할 것, `app/src/lib/copy/ko.ts`)

S3 로그인(§8.9)에 `checking`(최대 10초 뒤 [다시 연결]·[다시 로그인]), `grace expired`, pending의 확인 코드·[로그인 주소 복사]·남은 시간 10분(§8.9의 "약 5분"을 바꾼다)을 더하고, 메인 헤더 AccountSlot 옆에 오프라인 배지, 목록 위 업데이트 배너 B4(B1이 있으면 B1이 위).

| 키 | 문구 |
|---|---|
| `auth.pending.code` | 브라우저에 이 코드가 보이는지 확인하세요: {code} |
| `auth.pending.body`(변경) | 로그인을 마치면 자동으로 넘어가요. 남은 시간 {mmss} |
| `auth.copyLoginUrl` / `auth.browserHelp` | 로그인 주소 복사 / 브라우저가 열리지 않나요? |
| `auth.checking` / `auth.reconnect` | 로그인 정보를 확인하는 중이에요… / 다시 연결 |
| `auth.offline.badge` / `auth.offline.tip` | 오프라인 · {until}까지 사용 가능 / 로그인 서버에 연결하지 못했어요. 다시 연결되면 자동으로 확인해요. |
| `auth.graceExpired.title` / `.body` | 로그인 서버에 3일 넘게 연결하지 못했어요 / 인터넷 연결을 확인한 뒤 다시 연결해 주세요. 받던 다운로드는 계속돼요. |
| `auth.revoked` | 관리자가 이 기기의 로그인을 끊었어요. 다시 로그인해 주세요. |
| `auth.sessionExpired`(새, `Expired{SessionExpired}`) | 로그인한 지 오래돼 다시 로그인해야 해요. (30일 동안 쓰지 않았거나 60일 상한이 지났을 때. 60일마다 누구나 보는 화면이라 오류처럼 쓰지 않는다. 기존 `banner.sessionExpired`는 메인 배너에 그대로 쓴다) |
| `auth.removed.title` / `.body` | 사용 허가가 취소됐어요 / 채널: {channelName}. 계속 쓰려면 관리자에게 문의해 주세요. |
| `auth.reuse` / `auth.lost` | 보안을 위해 다시 로그인해 주세요. / 로그인을 마무리하지 못했어요. 다시 로그인해 주세요. |
| `auth.otherAccount.help` | 다른 계정으로 로그인하려면 브라우저에서 네이버 로그아웃을 먼저 해 주세요. |
| `banner.resumeNeedsLogin` / `job.otherChannel` | 지난번에 받다가 멈춘 다운로드가 {n}개 있어요. 로그인하면 이어받을 수 있어요. / 다른 채널로 로그인해 이어받을 수 없어요 |
| `update.banner` / `.install` / `.later` | 새 버전 {version}이 있어요. / 지금 업데이트 / 나중에 |
| `update.downloading` / `.installing` / `.failed` / `.untrusted` | 업데이트 받는 중 {pct} / 설치하고 다시 시작해요… / 업데이트하지 못했어요. 잠시 뒤 다시 시도해 주세요. / 업데이트 주소를 확인할 수 없어 받지 않았어요. |
| `dialog.update.*` | 업데이트하고 다시 시작할까요? / 받는 중인 영상 {n}개가 일시정지되고, 다시 시작하면 이어받아요. / 업데이트하고 다시 시작 / 나중에 |
| `settings.about.checkUpdate` / `.upToDate` / `.checkFailed` / `.checkOffline` | 업데이트 확인 / 최신 버전이에요 / 업데이트를 확인하지 못했어요. 잠시 뒤 다시 시도해 주세요. / 로그인 서버에 연결할 수 없어 확인하지 못했어요. |
| `settings.account.*` | 계정 / 치지직 채널 {channelName} / 마지막 확인 {time} / 로그아웃 |

---

## 12. 오프라인 검증 (구멍 7)

### 12.1 가짜 치지직 (`worker/test/fake-chzzk.mjs`)

`createFakeChzzk(opts) → { handle(Request): Promise<Response>, state }` 순수 핸들러 하나. 등록 앱(clientId·secret·redirectUri **정확 일치**, 아니면 400 — 실제 규칙 흉내), 1회용 code 표, 합성 계정 4개(`…a1` 관리자, `…b2` 허용, `…c3` 거부 — 이름에 `<script>` 포함, `…d4` 기타: 처음엔 거부되고 관리 [허용] 시나리오에서 허용된다) + [취소](code 없이 돌려보냄). 스위치: `wrapped`(content 래퍼 유무), `expiresInType`(문자열/숫자), `authorize: approve|cancel`, `tokenFail: 401|429|500|html|timeout`, `userFail`, `userIdField: channelId|id`(폴백을 두지 않으므로 `id`면 failed가 나와야 한다), `codeReuse: reject`.

- vitest: `network.use(http.all(/^http:\/\/127\.0\.0\.1:8788\//, ({request}) => fake.handle(request)))`(`miniflare.bindings`가 두 base를 그 주소로 덮는다). 핸들러 없는 외부 요청은 "internal error"로 실패하므로 `afterEach`가 "처리 안 된 요청 0"을 단언(msw 미처리 요청 옵션 이름 **[확인 필요]**).
- wrangler dev: `scripts/fake-chzzk-server.mjs`가 같은 `handle`을 `node:http`로 감싼다(127.0.0.1:8788, Request/Response는 Node 22 전역). 인가 화면은 HTML 대신 바로 302(브라우저 없이 따라간다). 수동 확인은 `pnpm dev`(가짜 서버 + `wrangler dev --port 8787`) 뒤 `http://localhost:8787/`.

### 12.2 vitest (`@cloudflare/vitest-plugin` 1.3.6, vitest 4.1.11, wrangler 4.147.0 정확 고정)

- `cloudflareTest({ wrangler: { configPath } })`, `import { env, exports } from "cloudflare:workers"`, `runInDurableObject`·`runDurableObjectAlarm`(`cloudflare:test`). R2는 `r2_buckets` 선언만으로 로컬 시뮬레이션. 저장소 격리는 테스트 파일 단위. `runInDurableObject` 콜백 인자는 추론에 맡긴다(`any`면 TS2589).
- 시간: `store/*` 함수는 `now`를 인자로 받으므로 테스트가 직접 넘긴다. DO 안 `Date.now()`에 `vi.setSystemTime`이 적용되는지는 첫 묶음에서 확인 **[확인 필요]**(적용되지 않아도 설계가 `now` 주입이라 영향 없음).
- 카나리: `setup.ts`가 `console.*`를 감싸 모은 줄과 모든 응답 본문·헤더에 그 테스트의 code·state·sid·pollSecret·토큰·쿠키·채널 id가 없음을 단언(토큰 묶음·Set-Cookie·관리 화면의 채널 id처럼 있어야 하는 자리는 정확히 그 자리만 예외).

### 12.3 wrangler dev E2E (`scripts/e2e-dev.mjs`, gate `worker-e2e`, D14 관찰)

1. 임시 `--persist-to`, 가짜 서버 시작, `wrangler dev --port 8787 --ip 127.0.0.1 --env-file .dev.vars.example`(`WRANGLER_SEND_METRICS=false`, HOME 임시 폴더 — 자격증명 없음 보장. `--env-file`이 로컬 `.dev.vars`를 대신하는지 **[확인 필요]**, 아니면 `/health`에 dev 모드일 때만 넣는 설정 지문(자리표시 값 해시 앞 8자)을 단언).
2. R2 씨앗: `seed-release.mjs`가 만든 합성 릴리스 2개(`0.1.0`, `0.2.0`, latest = `0.2.0`, 플랫폼 6개, 가짜 바이트·일관된 SHA256SUMS·`.sig` 자리표시·schema를 만족하는 manifest)를 `wrangler r2 object put <bucket>/<key> --file … --local --persist-to …`(자격증명 없이 동작 실측). cargo·xtask가 필요 없다(관찰 작업에 Rust 툴체인을 들이지 않는다). vitest의 R2 씨앗도 같은 생성기.
3. 시나리오(쿠키 항아리 + 리다이렉트 수동 추적): 앱 로그인(start → 확인 페이지 코드 일치 → [계속] → 가짜 인가 b2 → 콜백 → poll ok) / 거부(c3, 이름 이스케이프) / 취소 / refresh rotation + 60초 복구 + 재사용 → revoked / `/update/0.1.0` 200·`/update/0.2.0` 204 / 다운로드 전체 sha256 = SHA256SUMS·Range 206·416 / 웹 로그인(a1) → `/admin/denied/c3/allow` → c3 재로그인 ok / 세션 끊기 → 401 / CI 토큰으로 `/admin` 303·`/api/me` 401 / xtask와 같은 규칙의 node 클라이언트(200=본문, 404=없음, 그 밖 infra)로 verify 순서의 키를 모두 GET해 404가 R2 null에서만.
4. **로그 카나리**: `wrangler dev`는 요청마다 `[wrangler:info] GET /auth/callback?code=…&state=… 303` 꼴 줄을 자체적으로 찍으므로 stdout 전체를 보면 `code`·`state`가 늘 걸린다. 그래서 `--log-level warn`으로 wrangler 자신의 요청 줄을 끄고, 카나리는 Worker가 내는 JSON 줄(`log.ts` 형식, stdout에서 `{"event":`로 시작하는 줄)에만 적용한다. `--log-level warn`이 요청 줄을 실제로 끄는지는 **W7 첫 [확인 필요]**(안 끄면 `[wrangler:` 접두 줄을 걸러서 같은 판정). 운영의 invocation 로그 끄기(§14)는 같은 이유다.
5. 프로세스·포트 정리(CI는 ubuntu만).

---

## 13. CI 편입 (구멍 9·10)

### 13.1 패키지

`worker/package.json` devDependencies(정확 버전): `wrangler 4.147.0`, `@cloudflare/vitest-plugin 1.3.6`(옛 `@cloudflare/vitest-pool-workers`는 0.22.0에서 멈춰 이름이 바뀌었다 — ROADMAP에 적는다), `vitest 4.1.11`(peer `^4.1.0`, 5.x 금지), `msw 3.0.2`, `@msw/cloudflare 0.2.0`, `typescript 7.0.2`, `@cloudflare/workers-types 5.20261006.1`. 런타임 의존성 0. scripts: `check` = `wrangler types --include-runtime=false --env-file .dev.vars.example && tsc --noEmit`(생성물은 커밋하지 않고 매번 만든다 — 그래서 `--check`를 쓰지 않는다), `test` = `vitest run`, `build` = `wrangler deploy --dry-run --outdir dist`, `dev`, `e2e` = `node scripts/e2e-dev.mjs`.

### 13.2 gate (`gates.mjs`)

```js
worker: {
  desc: 'worker/ 설치·wrangler.jsonc 불변식·wrangler types+tsc·vitest(workers, 가짜 치지직)·deploy --dry-run 번들·테스트 수 ratchet',
  needs: ['pnpm'],
  steps: [
    { cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'worker' },
    { cmd: ['node', S('worker-config.mjs')] },                  // wrangler.jsonc·dist 불변식(아래)
    { cmd: ['pnpm', 'check'], cwd: 'worker' },
    { cmd: ['node', S('measure.mjs'), 'tests-worker'] },        // vitest json reporter → tests.worker
    { cmd: ['pnpm', 'build'], cwd: 'worker' },
    { cmd: ['node', S('ratchet.mjs'), 'check', 'tests'] },
  ],
},
'worker-e2e': { desc: 'wrangler dev + 가짜 치지직으로 로그인·회전·updater·R2·관리 흐름과 로그 카나리(D14 관찰)', needs: ['pnpm'],
  steps: [{ cmd: ['pnpm', 'install', '--frozen-lockfile'], cwd: 'worker' }, { cmd: ['pnpm', 'e2e'], cwd: 'worker' }] },
'release-worker-bundle': { desc: '시크릿 없는 작업: worker dry-run 번들 + 배포용 wrangler 설치 묶음, sha256 출력', steps: [{ cmd: ['node', S('release.mjs'), 'worker-bundle'] }] },
```

- `scripts/ci/worker-config.mjs`(+ `.test.mjs`, `scripts-test`가 돈다): `wrangler.jsonc`에 `account_id`·`routes`·`route`·`zone_id`·`custom_domain` 없음, `workers_dev: true`, `preview_urls: false`, DO는 `exports`만(`migrations` 키 없음), 클래스 `AuthStore`·바인딩 `AUTH`(바꾸면 실패 — 의도적 변경은 상수와 함께), `r2_buckets` 바인딩 `DIST`, `vars`에 `PUBLIC_ORIGIN`·`START_RATE_10M`·비밀처럼 보이는 키(`SECRET|TOKEN|KEY`)·`BUILD_ID` 없음, invocation 로그 꺼짐(키 이름 **[확인 필요]**), `worker/package.json`·`worker/deploy/package.json`(W8부터)·`tools.json`의 `wrangler` 버전이 같음, `.dev.vars.example`의 키 집합 = `config.ts`가 읽는 키 집합이고 값이 자리표시(`dev-`·루프백)인지, dry-run 뒤에는 `dist/wrangler.json` vars에 `PUBLIC_ORIGIN`이 없고 번들 모듈 목록이 `src/` 파일뿐인지(esbuild metafile).
- `CODE_GATED_JOBS`에 `'worker'`, `OBSERVED_JOBS`에 `'worker-e2e': 'code'`.
- 훅: pre-push `when`에 `{ gate: 'worker', paths: [/^worker\//, /^scripts\/ci\/worker-config/, /^release\/(latest\.schema|expected-artifacts)\.json$/] }`. pre-commit에는 넣지 않는다(무겁다).
- ratchet: `measure.mjs` `MODES`에 `tests-worker`(vitest json reporter, `vitestCount` 재사용), `ratchet.mjs` `PENDING_ALLOWED`에 `tests.worker`로 시작해 첫 master 실행 뒤 `write --from-run`으로 채운다. 커버리지는 넣지 않는다(workers 풀은 istanbul만, Q6).
- `advisories`: `{ cmd: ['pnpm','audit','--audit-level','high'], cwd: 'worker' }` 한 줄.

### 13.3 `ci.yml`

- 작업 `worker`(이름 `worker`, 전 워크플로 유일, ubuntu-24.04 하나 — Worker는 workerd에서 돈다, timeout 15, `permissions: contents: read`, `needs: changes`, `if:`는 `CODE_IF` 글자 그대로): checkout(persist-credentials false) → `pnpm/action-setup`(기존 SHA, `package_json_file: worker/package.json`) → `setup-node`(24, cache pnpm, `cache-dependency-path: worker/pnpm-lock.yaml`) → `run: node scripts/ci/run.mjs worker`, 측정 artifact `ratchet-measurements-worker`. 새 `uses:`는 없다.
- 작업 `worker-e2e`(이름 `worker-e2e`) 같은 모양. `report`의 needs에는 있고 `ci-ok`에는 없다(관찰 시작은 첫 녹색 master 실행 날, ROADMAP에 기록).
- `ci-ok` needs에 `worker`, guard 식에 `needs.worker.result == 'skipped'`를 parity `ciOkGuard()`가 만드는 순서 그대로. parity selftest 씨앗 둘 추가(needs에서 뺌 / guard에서 뺌 → 실패).
- `changes`: `worker/`는 NON_CODE가 아니라 자동으로 code. 손댈 것 없음.
- `_typos.toml` extend-exclude에 `worker/pnpm-lock.yaml`. `.gitignore`에 `worker/dist/`, `worker/.wrangler/`, `worker/node_modules/`, `worker/worker-configuration.d.ts`(`.dev.vars`는 이미).
- `dependabot.yml`: npm `/worker`(주 1회, cooldown 7일, prefix `build`)와 W8부터 npm `/worker/deploy`(같은 설정, `_typos.toml`·`advisories`에도 함께). 그룹 `cloudflare` = `wrangler`·`@cloudflare/*`(플러그인이 wrangler를 정확 고정하므로 함께), `msw` = `msw`·`@msw/*`, `npm` minor+patch. ignore: `vitest` major(peer가 열릴 때까지), `@types/node` major.
- public-scan: 손대지 않는다. 채널 ID 리터럴은 허용된 4개만(역할 고정 §12.1). 다섯 번째가 정말 필요하면 `HEX_ID_ALLOWLIST`·`public-scan.test.mjs`·`testdata/README.md`를 한 커밋에서.
- CLAUDE.md 레이아웃 표·명령에 `worker/`·`worker` gate를 더한다.

### 13.4 release.yml·`release.mjs worker` (D10, 구멍 3·10, cicd.md 81)

```
gate ─ xtask ─ build×3 ─ smoke ─ stage ─ sign-publish ─ verify ─┐
                        worker-bundle(시크릿·환경 없음, 리허설에도) ─┴─ deploy-worker(환경 release, 태그 + WORKER_DEPLOY_ENABLED)
```

- **`worker-bundle`**: pnpm·node(캐시 없음) → `run.mjs release-worker-bundle` = `pnpm install --frozen-lockfile`(worker) + `pnpm build`(dry-run 번들 `dist/`) + 배포용 wrangler를 따로 설치(`worker/deploy/package.json`·`pnpm-lock.yaml`: 의존성 `wrangler 4.147.0` 하나, `--ignore-scripts`) → 결정적 tar(`dist/`·`wrangler.jsonc`·`deploy/`) → artifact `worker-bundle-<run_id>`(1일) + sha256 작업 출력.
- **`deploy-worker`**: `needs: [gate, verify, worker-bundle]`, env `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`·`CI_VERIFY_TOKEN`·`DIST_BASE_URL`(secret)과 superseded 가드용 R2 자격·`WORKER_BUNDLE_SHA256`(`RELEASE_VERSION`·`BUILD_ID`는 넣지 않는다: 버전은 워크스페이스 버전, `BUILD_ID`는 `GITHUB_SHA` 앞 7자, 구현 중 변경 36 (사)). `release.mjs worker`: (1) artifact sha256 = 출력(다르면 2), (2) 묶음 안의 wrangler로 `deploy --no-bundle -c dist/wrangler.json --var PUBLIC_ORIGIN:$DIST_BASE_URL --var BUILD_ID:<sha7>`(설치·컴파일 없음), (3) §9.4 검사(5xx·네트워크 4회 재시도, 판정 실패 1, 기반 시설 2). `--check-only --base <url>`는 배포 없이 (3)만(selftest·로컬). `pnpm dlx`는 쓰지 않는다(lockfile을 거치지 않는다, cicd.md §5 예시를 바꾼다).
- **[확인 필요]**(묶음 W8 첫 dry-run): (가) `--no-bundle` + `exports` 선언 + `--var`가 함께 배포되는지, (나) `--ignore-scripts`로 깐 wrangler가 deploy에 workerd를 요구하지 않는지(npm 변형은 실측됨, pnpm 변형 확인). 안 되면 `release.mjs`가 Workers 스크립트 업로드 API(multipart: 번들 + metadata.json의 바인딩·DO)를 node fetch로 직접 부른다(설치되는 코드 0).
- `release-selftest`에 사례 추가: `--check-only`를 로컬 가짜 Worker(작은 node:http 스텁)에 돌려 정상·204 틀림·200 틀림·음성 틀림 각각 exit 1.
- Worker secret은 CI가 넣지 않는다(사용자 `wrangler secret put` 4개). API 토큰은 계정의 Worker 배포·수정(Workers 제품 범위 Editor, 생성·삭제 불가)과 기존 R2 버킷 권한이다(구현 중 변경 44 (가), §17 R9).
- `worker/deploy/`의 lockfile도 관리 대상이다: `dependabot.yml` npm `/worker/deploy`(그룹 `cloudflare`), `advisories`에 `pnpm audit`(cwd `worker/deploy`), `_typos.toml`에 `worker/deploy/pnpm-lock.yaml`, `worker-config.mjs`가 두 lockfile의 `wrangler` 버전이 같고 `tools.json` `wrangler`와 같은지 검사한다.
- 시크릿 작업이 wrangler(전이 의존성 포함)를 실행하는 것은 D10의 글자("설치·컴파일 없음")는 지키지만 취지("시크릿 옆에서 서드파티 코드를 돌리지 않는다")에는 못 미친다. 그래도 API 직접 업로드를 기본으로 올리지 않은 이유: (1) `exports` 형식 DO의 업로드 API metadata 모양이 미확인이라 실패 경로가 하나 더 늘고, (2) 배포 토큰은 Worker 편집(계정 범위 Editor)과 R2 버킷 권한뿐이며, (3) 정말 위험한 자산(Worker secret)은 어느 경로든 번들 안의 코드가 읽는다(R3) — 번들은 `worker-bundle`이 만들고 거기엔 시크릿이 없다. 묶음 안 wrangler는 lockfile 고정 + `--ignore-scripts`라 설치 시점 실행 코드가 없다. W8 실측에서 (가)(나)가 안 되면 그때 API 경로로 간다.
- D10의 한계(위험 R3): 시크릿 작업의 배포 토큰은 지키지만 `worker-bundle`에 들어온 악성 dev 의존성이 번들에 코드를 끼우면 운영 Worker 안에서 secret을 읽는다. 줄이는 수단: 런타임 의존성 0, 정확 고정 + lockfile + cooldown 7일, `worker-config.mjs`의 번들 모듈 목록 검사.

---

## 14. 비밀값 위생·로그 (구멍 12)

- 로그는 `log(event, fields)` 하나. 한 줄 JSON, 허용 필드(타입으로 강제): `event, level, route(패턴, 실제 경로 아님), method, status, stage, timedOut, durationMs, flowKind, reason, sessionIdPrefix(앞 6자), chzzkCode`. **금지**: 쿼리스트링, 토큰·해시·쿠키, code·state·handle·loginId·pollSecret, 채널 id·이름(거부·허용 이벤트도 id 없이 — 관리 화면·audit 테이블이 그 역할), 외부 응답 본문, IP 원문. 이벤트 예: `auth.login.ok`, `auth.login.denied`, `auth.login.failed{stage}`, `auth.refresh.rejected{reason}`, `auth.refresh.reuse_detected`, `admin.allow`, `release.forbidden_key`, `config.error{key}`.
- `console.*` 직접 호출 금지(테스트: 소스의 `console.` 사용처가 `log.ts` 하나뿐).
- 예외가 라우터 밖으로 나가면 500 `internal`, 로그엔 `error.name`만(메시지에 URL이 들어 있을 수 있다).
- 콜백은 처리 뒤 즉시 쿼리 없는 URL로 303 + `Referrer-Policy: no-referrer`. `wrangler.jsonc` observability의 invocation 로그는 끈다(URL에 `code`·`state`가 실린다. 키 이름 **[확인 필요]**, 없으면 `observability.enabled: false`로 두고 직접 로그만).
- **Workers Logs는 Worker가 남긴 로그 줄마다 그 호출의 요청 URL 전체(`$workers.event.request.url`, 쿼리 포함)를 메타데이터로 붙인다**(invocation 로그를 꺼도 그렇다, W9 실측, 구현 중 변경 43). 그래서 로그 필드만 거르는 것으로는 부족하다: **URL(경로·쿼리)에 위의 금지 값이 실리는 경로**(`/auth/callback`의 code·state, `/auth/login/:handle`, 세션 id·채널 id가 경로에 든 `/me/sessions/:id/revoke`·`/admin/sessions/:id/revoke`·`/admin/denied/:channelId/*`)는 경로 표의 `quiet` 행이고, **그 Worker 호출 안에서는 로그 줄이 하나도 나가지 않는다**(`config.error`·`http.internal` 포함, 핸들러는 `ctx.log`만 쓰고 quiet 경로에서는 아무것도 하지 않는다). 그 경로의 이벤트는 경로가 부르는 DO RPC(`consume`·`finish`·`revoke`·`revokeMine`·`allowDenied`·`dismissDenied`)가 DO 쪽에서 남긴다(값 없음). 새 경로의 URL에 금지 값을 실으면 `quiet: true`를 붙인다.
- `hygiene.test.ts`: 카나리 값(code·state·client secret·토큰·채널 id·이름)을 넣고 모든 흐름·실패 경로를 돈 뒤 로그 수집기와 응답에 카나리가 없음을 단언(§12.2).
- 앱 셸: Worker 응답 본문을 오류에 담지 않는다(`code`만). reqwest 오류는 `redact_url`. `Authorization` 헤더를 로그에 남기지 않는다. `session.json` 경로는 로그에 남겨도 내용은 안 된다.

---

## 15. channelId 동일성 게이트 (구멍 8)

ROADMAP Phase 3에 **미체크 단계**로 둔다: `- [ ] G-ID: OAuth users/me channelId == VOD content.channel.channelId == 클립 content.ownerChannel.channelId (실제 로그인, 사용자가 직접)`. 이 단계가 체크되기 전에는 앱의 `OwnershipGate`를 켜지 않는다(본인 영상 검사가 전부 거부·전부 허용으로 틀어질 수 있다). 로그인·허용목록·업데이트는 그 전에도 릴리스에 켤 수 있다.

**절차**(사용자 본인이 로컬에서, 5분). 도구는 이미 있는 `worker/scripts/channel-id-check.mjs`(Node만, Worker 불필요, 포트 8787에 자기 콜백 서버를 띄우므로 `wrangler dev`를 먼저 끈다):

1. `worker/.dev.vars`를 1Password Environment `chzzk-local-dev`(로컬 테스트용 앱)로 마운트한다(값은 대화·로그에 내지 않는다, 구현 중 변경 12 (나)).
2. `node worker/scripts/channel-id-check.mjs <본인 VOD 주소> <본인 클립 주소>` → 터미널의 `http://localhost:8787/auth/login`을 브라우저로 열어 로그인한다(등록된 개발용 리디렉션과 같다).
3. 출력은 **형식 검사(32자리 소문자 hex인지)와 `같다`/`대소문자만 다르다`/`다르다`만**이다. ID·토큰·code·영상 번호는 출력하지 않고 디스크에 쓰지 않는다. 치지직 토큰은 폐기하지 않고 버린다(revoke는 같은 앱·사용자의 모든 토큰을 지운다, §2). VOD 하나와 클립 하나를 모두 받아야 돈다.
4. ROADMAP에 "G-ID: 일치(날짜)" 또는 "불일치(날짜, 종류)"만 적는다. 실제 값은 적지 않는다.

**다를 때의 대안**(작은 것부터):

- (가) 대소문자·구분자만 다르면: 비교 전 정규화 함수 하나를 코어 `ownership`에 두고 fixture 테스트를 더한다(코어 한 곳).
- (나) **값이 다르면(권장): `allowlist.owner_channel_id`**(자리는 이미 스키마에 있다). 관리 화면에서 관리자가 그 사람의 서비스 채널 ID(채널 페이지 주소에 들어 있다)를 넣고, 토큰 묶음·`/api/me`의 `channelId`가 이 값이 된다. 앱은 처음부터 "본인 판정용 channelId" 하나만 쓰므로 **앱을 고치지 않는다**. 관리자 본인에게도 적용된다(관리자도 `allowlist` 행을 가질 수 있다, §5). 관리 부담이 한 번 늘지만 추측이 없다.
- (다) Open API 채널 조회(`/open/v1/channels`)로 대응을 찾는 것은 그 API가 서비스 ID를 주는지 미확인이라 (나) 뒤에 둔다.
- 채널 이름 비교는 쓰지 않는다(바뀌고, A1이 마음대로 정한다). 클립은 `ownerChannel`만(제작자 `makerChannel` 제외, chzzk-oauth.md 열린 질문 5의 기본값).

---

## 16. 구현 묶음 (Worker + CI만. 묶음마다 Opus 구현 → 리뷰 2개 → 수정, stacked PR, PR마다 Codex 또는 서브에이전트 리뷰)

| # | 묶음 | 산출물 | 수락 기준(이 묶음에서 새로 녹색이어야 하는 것) |
|---|---|---|---|
| **W0** | 설계 문서 | 이 파일, cicd.md 80~83, app.md 59, ROADMAP(결정 표·Phase 3 체크리스트·G-ID 미체크·플러그인 이름 변경·외부 항목 "KV 또는 D1" → "Durable Object(SQLite)·R2"·시크릿 표), CLAUDE.md(레이아웃·명령), chzzk-oauth.md(sid 저장소 = DO), §17 사용자 답변 반영 — 모두 끝(2026-10-06) | `scan`, `typos`. 문서만이라 `changes.code=false` |
| **W1** | 골격 + CI | `worker/` 패키지·lock·workspace, `wrangler.jsonc`, `tsconfig`, `vitest.config.ts`(bindings 덮기), `config.ts`·`/health`·`routes.ts` 뼈대·`log.ts`, `.dev.vars.example`, `worker-config.mjs`(+test), gate `worker`, ci.yml 작업·`ci-ok`·guard, parity 씨앗, pre-push, dependabot, advisories, typos, gitignore, `$pending tests.worker` | `run.mjs worker`·`parity`·`scripts-test`·`ci-ok` 녹색. 테스트: health 200/503(부트스트랩 `bootstrap:true`), config 가드 표(루프백 덮어쓰기 허용·운영 http 거부·ADMIN 비어 있음 → 부트스트랩·ADMIN 형식 틀림 → config_error·출처 불일치·운영에서 `START_RATE_10M` 거부), 바인딩 = 자리표시, `console.` 사용처 1곳, `wrangler.jsonc`에 account_id를 넣은 씨앗은 실패. **[확인 필요] 첫 작업**: dry-run이 `dist/wrangler.json`을 쓰는지, `--var` 값의 `:` 분해(§10.1) |
| **W2** | 순수 core | `token`·`cookies`·`range`·`keys`·`semver`(xtask 벡터)·`chzzk`·`updater`·`html`·`usercode` | 표 주도 단위 테스트(모듈마다 음성 사례), `core/`에 `cloudflare:*` import 없음(정적 테스트), `raw(` 허용 목록 |
| **W3** | DO `AuthStore` | `schema.ts`·마이그레이션, `flows`(start·continue·consume·finish·claim·상한·스로틀·간격), `sessions`(§5.2 표 전 행·check·revoke), `allowlist`·`denied`, alarm | **첫 테스트: `setAlarm` 두 번 → `getAlarm()`이 둘째 값**(§5 [확인 필요]), `runInDurableObject` 표 테스트, `runDurableObjectAlarm` 멱등 청소, 마이그레이션 빈 DB → 최신, 상한 32·스로틀 429(순수 함수에 limit 6, `CF-Connecting-IP` 다른 값은 키 분리)·폴링 429에서 `rowsWritten` 0, 원문 토큰이 어떤 테이블에도 없음(덤프 검색), 관리자 `disallow` 409(행이 있어도), `check`·`webCheck`의 `kind` 조건(앱 access 해시를 웹 쿠키 자리에 → 거부), `refresh_recovered` audit, 절대 상한 60일 경계(직전 rotate는 만료가 상한으로 잘림, 직후 401 `session_expired`) |
| **W4** | OAuth 흐름 | `fake-chzzk.mjs`·`network.ts`, `/auth/*`(앱·웹 start·login 페이지·[계속]·callback·done·poll), `/api/me`, `/auth/refresh`·`logout`, 카나리 | 전 흐름(승인·취소·거부·token 실패 5종·user 실패·래퍼 유무·expiresIn 두 형·`id` 필드면 failed·code 재사용), binder 불일치 → failed, state 일회용, redirectUri 바이트 일치, 확인 코드 = 앱 코드, rotation + 60초 복구 + 재사용 → revoked, 허용 제외 → 403 + access 401, `hygiene.test.ts` |
| **W5** | R2·updater·CI 토큰 | `releases.ts`·`update.ts`·`releaseAuth`, `seed-release.mjs`, `xtask-keys.test.ts`, `matrix.test.ts`(이 시점 경로 전부) | 보이는 키 표(`.dmg`·`.deb`·`.sig` 200, `previous`·`latest.json` 사용자 403·CI 200, 문법 400, R2 null 404), Range 206·416·다중 무시·304, Content-Length·no-transform, 3xx 0건, `/update` 200/204/400, 틀린 CI 토큰 401, CI 토큰 × 전 경로, 소스 검사 |
| **W6** | 랜딩·관리 | `/`·`/admin*`·`/me/*`·`/auth/web/logout`·`site.css`·`copy.ts`, CSP, CSRF | CSRF 6사례 + Content-Type 415, XSS 이스케이프, 비관리자 403, [허용] → 즉시 로그인 성공, [빼기]·[끊기] → 지연 0으로 401/403, 내 기기는 자기 세션만, 행렬 완성 |
| **W7** | wrangler dev E2E | `fake-chzzk-server.mjs`, `e2e-dev.mjs`, gate `worker-e2e`, ci.yml 관찰 작업, `OBSERVED_JOBS` | **첫 [확인 필요]**: `--log-level warn`이 wrangler 요청 줄을 끄는지(§12.3 4). 로컬·CI 녹색, Worker JSON 로그 줄의 카나리 0건, 브라우저 규칙대로 Origin을 실은 POST 통과·`Origin: null` 403(§8.1), 관찰 시작일 ROADMAP 기록 |
| **W8** | 릴리스 연결 | `release.mjs worker`·`worker-bundle`·`--check-only`, `worker/deploy/`, release.yml `worker-bundle`·`deploy-worker` env, selftest 사례, cicd.md §8 표, `[확인 필요]` (가)(나) 실측 기록 | `release-selftest` 새 사례(정상·204 틀림·200 틀림·음성 틀림), `workflows` gate, 리허설 dispatch 녹색(`worker-bundle`까지, deploy-worker는 skipped) |
| **W9** | 배포 뒤(사용자와, 체크박스만) | 절차는 런북 `docs/runbook/w9-first-deploy.md`(구현 중 변경 42). 사전 준비(리디렉션 URL·`DIST_BASE_URL` 저장소 secret·`R2_BUCKET` 저장소 변수·환경 `release` secret·변수, G-ID §15)와 사전 확인(R2 목록 서명·GitHub 이름·리디렉션 일치)은 끝났다(2026-10-06~07). 남은 것: 수동 첫 배포(배포 → Worker secret 셋 → 로그인 → `ADMIN_CHANNEL_IDS`, exports DO 실배포 확인, `/health` build 일치), 배포 토큰의 `secret list`, code 묶임 실측(29·42 (다)), Workers Logs에 URL 없음, 실제 브라우저 관리 POST, `WORKER_DEPLOY_ENABLED`를 저장소 변수 `true`로, 첫 실제 릴리스 태그 `v0.1.0`(`VERIFY_VIA=s3`, 사용자 승인) → 승격 뒤 `--check-only`·Range·`Content-Length`·압축·로그 마스킹·Gatekeeper 실측 → Worker로 verify → `VERIFY_VIA=worker`, 며칠 뒤 무료 한도. WAF 규칙(Q4)은 쓰지 않는다(11 (나)). "태그 모드에서 worker 요구"(cicd.md 72 "반영하지 않은 것" (2))는 스위치가 아니라 코드 변경이다(42 (아)) | 실제 실행 |
| (Phase 3b) **A1~A5** | 앱 | A1 `SessionStore`·`classify_verify` 표·`WorkerApi` + reqwest 구현·`AuthService`(가짜 WorkerApi·Clock) / A2 command·DTO·bindings·`build.rs` 주소 규칙·`CHZZK_E2E_WORKER_BASE`·가짜 백엔드·ipc.rs / A3 프런트 LoginView·AccountSlot·오프라인 배지·업데이트 배너·대화상자·copy deck·Playwright / A4 updater command(출처 대조·설치 흐름) / A5 OwnershipGate·resume 규칙 활성(G-ID 녹색 뒤) + 네이티브 E2E(fixture 서버에 Worker 스텁 라우트) | 각각 Rust·vitest·Playwright. 상태 전이 표 전부, 72h 경계와 `refreshExpiresAt`(60일 상한)으로 잘린 유예, single-flight, 쓰기 실패, release-hygiene 확장 |

---

## 17. 위험·열린 질문

### 위험

- **R1 A3 사회공학**: 확인 코드·경고·내 기기로 줄이지만 피해자가 코드까지 맞다고 믿고 [계속]을 누르면 공격자가 세션을 받는다. 피해는 앱·설치 파일 사용(정책 수준)이고, 관리자는 세션 목록의 `client`·시각으로 찾아 끊는다.
- **R2 새 로그인 잠금이 싸다**: 비만료 흐름 32개 상한은 공격자가 10분마다 32번 start하면 정상 사용자의 새 로그인을 막는다(503). IP 스로틀(IPv6 /64)이 단일 호스트를 막고, 분산 공격은 막지 못한다(Q4 WAF는 쓸 수 없다, 구현 중 변경 11 (나)). 이미 로그인한 사용자는 영향이 없다(상한은 `flow`만 묶는다).
- **R3 D10은 배포 토큰을 지킬 뿐 번들을 지키지 않는다**(§13.4).
- **R4 단일 DO 처리량**: 사용자 수가 허용목록 크기라 수용. 커지면 세션을 채널별 DO로 나눈다(이름 체계 이전 필요).
- **R5 `exports` 선언 형식**은 2026-06 도입이라 실제 배포는 미실측. 첫 수동 배포에서 확인하고, 실패하면 아직 배포 전이라 레거시 `migrations [{tag:"v1", new_sqlite_classes:["AuthStore"]}]`로 바꿀 수 있다.
- **R6 미검증 묶음**: `setAlarm` 덮어쓰기(W3 첫 테스트), dry-run의 `dist/wrangler.json` 생성·`--var` 값의 `:`(W1), `--log-level warn`의 요청 줄(W7), wrangler dev가 `CF-Connecting-IP`를 덮는지(W7), invocation 로그 키 이름, `--no-bundle`+exports+`--var`, `--ignore-scripts` pnpm 변형, pnpm 12 빌드 허용 키·`minimumReleaseAge`, msw 미처리 요청 옵션, `vi.setSystemTime`과 DO, `--env-file`, 스트림 `Content-Length` 실배포. 모두 해당 묶음의 첫 작업에서 실측한다. Error 1027의 HTTP 상태는 실측하지 않는다(구현 중 변경 42 (라)).
- **R7 치지직 앱 90일 미사용 삭제**: 갱신은 치지직을 부르지 않으므로 슬라이딩 세션만으로는 스코프 사용량이 0일 수 있다. 대책은 Q1 답변의 **절대 상한 60일**이다: 앱을 계속 쓰는 사용자도 60일마다 치지직으로 다시 로그인하므로(토큰 교환·`users/me`) 90일 창 안에 사용이 생긴다. 다만 무엇을 "사용"으로 세는지(인가·토큰 발급·API 호출 중 무엇인지)는 여전히 **[확인 필요]**이고, 앱 사용자가 아무도 없으면 관리자의 주기적 랜딩 로그인이 남은 대책이다.
- **R8 updater가 전체를 메모리로 받는다**(수백 MB). 범위 밖.
- **R9 배포 토큰이 계정 범위다**(구현 중 변경 44 (가)): Worker 단위 범위를 토큰 편집이 지원하지 않아 Workers 제품 Editor를 계정 전체에 준다. 이 계정이 다른 Worker와 공유되면 토큰이 새는 순간 무관한 Worker도 덮어쓸 수 있다. 완화: 토큰은 환경 `release`에만 두고, 태그 push는 소유자만 하며, 주기적으로 교체하고, Cloudflare가 Worker 단위 범위를 지원하면 좁힌다. R2 권한을 뗐는지는 확인하지 않았다.

### 사용자 답변(2026-10-06)

W1 전에 한 묶음으로 물은 열린 질문(Q1~Q9)의 답이다. **확정**은 본문에 반영했고, **보류**는 적힌 시점에 정한다.

| # | 질문 | 답 | 상태 | 반영한 곳 |
|---|---|---|---|---|
| Q1 | refresh 절대 상한 | **60일**(`session.created_at + 60d`). 지나면 refresh는 형식 있는 401 `session_expired`(재로그인) | 확정 | §0 5, §2 "앱 세션", §5 `session.expires_at`, §5.2(`cap`), §6.1, §11.2 `refreshExpiresAt`, §11.3 유예 상한, §11.7 `auth.sessionExpired`, §16 W3·A1, R7, app.md 구현 중 변경 59 |
| Q2 | 웹 세션 12시간 절대 | 그대로(버린 대안: 7일 슬라이딩 + 관리 POST만 최근 12시간 로그인 요구) | 확정 | §2 "웹 세션" |
| Q3 | 확인 코드 페이지 + [계속] | 그대로(버린 대안: 페이지는 두고 [계속] 없이 자동 진행 + 경고. A3 가시성이 줄어든다) | 확정 | §2 "앱 흐름 피싱" |
| Q4 | Cloudflare WAF 요청 수 제한 규칙 | 쓰지 않는다(커스텀 도메인이 없어 zone이 없다, 비용 0 제약) | 확정(2026-10-06) | 구현 중 변경 11 (나) |
| Q5 | R2 버킷 이름 커밋 | 문서 기본값(`wrangler.jsonc`에 커밋, `R2_BUCKET`은 변수) | 확정 | §2 "R2 버킷 이름", cicd.md 82 (다) |
| Q6 | Worker 커버리지 ratchet | 문서 기본값(테스트 수만) | 확정 | §13.2 |
| Q7 | 응답 유실 창 60초 | 문서 기본값 | 확정 | §2 "응답 유실 창", §5.2 |
| Q8 | 앱 태그 없이 Worker만 고칠 때 | 문서 기본값(다음 앱 태그 또는 사람이 수동 `wrangler deploy`, 별 트리거 없음) | 확정 | 이 표 |
| Q9 | `DIST_BASE_URL`의 로그 노출 | **저장소 secret**(변수 아님). Actions 로그에서 마스킹된다 | 확정 | **cicd.md 구현 중 변경 84**(이 문서의 구현 중 변경 1) |

- **Q9의 범위**: 처음에는 본문 §0·§2 "Worker 주소"·§10.3 표·§11.1·§13.4·§16 W9의 "저장소 변수 `DIST_BASE_URL`"을 고치지 않고 cicd.md 84가 이기게 두었다. §10.3 표·§13.4·§16 W9는 W9 런북을 쓰면서 secret으로 고쳤고(구현 중 변경 42 (차)), 나머지 곳은 여전히 cicd.md 84가 이긴다. 환경 `release`의 secret이 아니라 **저장소** secret인 이유는 앱 릴리스 빌드(`build (os)`)가 환경 밖에서 `CHZZK_WORKER_BASE`로 그 값을 받아야 해서다(cicd.md 82 (가)의 "저장소로 옮김"은 그대로). 워크플로의 `vars.DIST_BASE_URL` → `secrets.DIST_BASE_URL` 교체는 W8에서 한다(바뀔 곳 목록은 cicd.md 84).

### 적대적 검토(2026-10-06)에서 반영하지 않은 것

- **API 직접 업로드를 deploy-worker 기본으로**(검토 10): §13.4에 이유를 적었다(exports DO의 업로드 metadata 미확인, 위험 자산은 번들 쪽, wrangler는 lockfile + `--ignore-scripts`). lockfile 관리 누락은 반영했다.
- ~~**`DIST_BASE_URL`을 secret으로**(검토 13)~~: 처음에는 변수로 두고 Q9로 물었고, **사용자 결정(2026-10-06)으로 반영했다**(저장소 secret, cicd.md 84).
- ~~**ROADMAP·CLAUDE.md 갱신**(검토 12)~~: W0의 남은 작업으로 두었다가 **W0에서 끝냈다**(2026-10-06).

---

## 구현 중 변경

구현하면서 위 본문과 달라졌거나 본문이 모호해 고른 내용이다. 번호는 적은 순서이고 고치지 않는다. 같은 주제를 뒤 항목이 다시 다루면 뒤 항목이 이긴다. 이 절이 본문보다 우선한다.

1. **`DIST_BASE_URL`은 저장소 secret이다(Q9 사용자 결정 2026-10-06, 로그 마스킹).** §0·§2 "Worker 주소"·§10.3 표·§11.1·§13.4·§16 W9의 "저장소 변수"를 바꾼다. 환경 `release`가 아니라 저장소 수준인 이유와 워크플로에서 바뀔 곳은 `docs/design/cicd.md` 구현 중 변경 84.
2. **W1 실측 (가): `wrangler deploy --dry-run --outdir dist`는 `dist/wrangler.json`을 쓰지 않는다**(wrangler 4.147.0, 2026-10-06, 임시 폴더의 최소 Worker). 산출물은 `index.js`·`index.js.map`·`README.md`뿐이고, `--metafile`을 붙이면 `dist/bundle-meta.json`(esbuild metafile, `inputs`에 번들된 모듈 목록)이 더해진다. 그래서 §10.1의 대안대로 **`dist/wrangler.json`은 W8 `release.mjs worker-bundle`이 원본 `wrangler.jsonc`에서 만든다**(`main`·`no_bundle`만 바꿈). W1의 `pnpm build`는 `wrangler deploy --dry-run --outdir dist --metafile`이고, `worker` gate는 빌드 뒤 `worker-config.mjs --dist`로 metafile 입력이 모두 `src/*.ts`인지(런타임 의존성 0, 위험 R3)와 `dist/index.js`를 본다. `dist/wrangler.json`의 금지 키·vars 검사는 그 파일이 있을 때만 돈다(W8부터). 원본 `wrangler.jsonc`의 vars 규칙은 gate 첫 단계(`pnpm install`보다 먼저, cicd.md 구현 중 변경 86) `worker-config.mjs`가 본다.
3. **W1 실측 (나): `--var KEY:VALUE`는 첫 `:`에서만 나뉜다.** wrangler 소스(`collectKeyValues`·`collectPlainTextVars`)가 `split(":")` 뒤 나머지를 `join(":")`으로 되붙이고, `wrangler dev --var PUBLIC_ORIGIN:https://example.test:8443/x --var BUILD_ID:abc1234`로 띄운 Worker가 env 값을 글자 그대로 받았다. `deploy --dry-run`의 바인딩 표는 `--var` 값을 `(hidden)`으로 가려 값 자체는 dev로만 확인했다. 그래서 §10.1·§13.4의 `--var PUBLIC_ORIGIN:$DIST_BASE_URL` 그대로 간다(dist vars에 써 넣는 대안은 쓰지 않는다).
4. **W1 실측 (다): `--env-file`을 주면 wrangler는 기본 `.dev.vars`를 열지 않는다.** 소스(`getVarsForDev`)는 env 파일 목록이 비었을 때만 설정 폴더의 `.dev.vars`를 읽는다. 임시 폴더에 가짜 값의 `.dev.vars`와 `.dev.vars.example`을 두고 `wrangler dev --env-file .dev.vars.example`을 띄우면 응답이 example 값이었고, `.dev.vars`를 **쓰는 쪽이 없는 FIFO**로 바꿔도 `--env-file`이 있으면 응답했다(파일을 열지 않음). `--env-file` 없이는 FIFO에서 막혔다. 같은 FIFO가 있는 상태에서 `wrangler types --include-runtime=false --env-file .dev.vars.example`과 `wrangler deploy --dry-run`도 끝까지 돌았다(출력 확인). `--env-file` 없는 `wrangler types`는 확인하지 않았다(쓰지 않는다). **단, `wrangler dev`의 이 확인은 기본 타입 파일 `worker-configuration.d.ts`가 없을 때만 맞다**: 그 파일이 있으면 dev가 env 파일 목록 없이 타입을 다시 만들어 보며 `.dev.vars`를 연다(구현 중 변경 9가 바로잡는다). 그래서 `pnpm dev`(`--env-file .dev.vars.example`)·`pnpm dev:real`(`--env-file .dev.vars --var PUBLIC_ORIGIN:http://localhost:8787`)·`pnpm check`(`wrangler types … --env-file .dev.vars.example`)는 모두 `--env-file`을 명시하고, `worker-config.mjs`가 "wrangler `dev`·`types`를 부르는 스크립트는 `--env-file`, 실제 비밀값 파일은 `dev:real`만, dev는 `--port 8787`"을 고정한다(스크립트 글자·`--config`는 구현 중 변경 9). §12.3 1의 "아니면 `/health`에 설정 지문" 대안은 필요 없다.
5. **W1 실측 (라): vitest는 그대로 두면 `.dev.vars`를 연다. `environment: "example"`로 막는다(§10.2 "vitest는 `.dev.vars`를 읽으므로 bindings로 덮는다"를 바꾼다).** `miniflare.bindings`가 `.dev.vars` 값을 이기는 것은 맞다(가짜 `.dev.vars`의 값이 덮은 값으로 바뀌었다). 하지만 `@cloudflare/vitest-plugin` 1.3.6은 `unstable_getMiniflareWorkerOptions`에 env 파일 목록을 넘기지 않아 **설정 폴더의 `.dev.vars`를 실제로 연다**: FIFO `.dev.vars` 옆에서 vitest가 막혔고 SIGTERM으로도 끝나지 않아 SIGKILL이 필요했다. 덮기만으로는 실제 비밀값이 테스트 프로세스에 들어오고(1Password가 잠겨 있으면 gate가 멈춘다), 로컬 pre-push 훅은 HEAD가 깨끗하면 이 폴더에서 바로 gate를 돈다(`snapshot.mjs`). 그래서 `vitest.config.ts`는 `cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc", environment: "example" }, miniflare: { bindings: <.dev.vars.example 파싱> } })`다: wrangler는 환경 이름이 있으면 `.dev.vars.<환경>`을 먼저 찾고 있으면 `.dev.vars`를 열지 않는다(wrangler 4.147.0 소스 `loadDotDevDotVars`: `env && tryLoad(path.env) || tryLoad(path)`). `wrangler.jsonc`에 `env` 절이 없어 최상위 설정(DO·R2·vars)이 그대로 쓰이고 "No environment found" 경고가 테스트 파일마다 찍힌다(받아들인다. `env` 절을 만들면 DO·R2·vars를 그 절에 다시 적어야 한다). 확인: 임시 폴더 사본에 FIFO `.dev.vars`를 두고 `pnpm check`·vitest(57개)·`pnpm build`가 모두 끝까지 돌았다. 고정: `vitest.config.ts`는 `.dev.vars.example`이 없으면 플러그인이 설정을 읽기 전에 던지고, `worker-config.mjs`가 `environment "example"`·바인딩 원천·`wrangler.jsonc`에 `env` 키 없음·`.dev.vars.example` 존재를 검사하고, `test/bindings.test.ts`가 "각 설정 바인딩 = `.dev.vars.example` 값"과 "문자열 바인딩 집합 = `CONFIG_KEYS`"를 단언한다. 이 vitest 단언은 결과를 고정할 뿐 로컬에서는 지킴이가 아니다: 실제 `.dev.vars`는 `CONFIG_KEYS` 안의 두 키뿐이라 `environment`를 빼서 그 파일이 열려도 덮기에 가려 통과한다. 지킴이는 `worker-config.mjs`의 `vitest.config.ts` 검사(주석을 지운 코드의 `wrangler` 객체 안, 구현 중 변경 9)와 CI 누출 씨앗(구현 중 변경 9 (라))이다. 한계: 이 동작은 wrangler 내부 순서에 기댄다. CI 씨앗이 순서가 바뀐 판올림을 잡지만(일반 파일이라 막히지 않고 키가 섞인다) FIFO에서 막히는지는 보지 않는다. wrangler·플러그인을 올리는 PR은 이 항목의 FIFO 확인(임시 사본, `timeout -s KILL`)을 다시 한다.
6. **W1 버전(npm 재확인 2026-10-06).** §13.1의 `wrangler 4.147.0`·`@cloudflare/vitest-plugin 1.3.6`·`vitest 4.1.11`·`typescript 7.0.2`는 그날의 최신(vitest는 V4 줄의 최신)이다. 바꾼 것: **`@cloudflare/workers-types`는 `5.20261005.1`**(§13.1의 `5.20261006.1`은 그날 나와 pnpm 12의 기본 `minimumReleaseAge`에 걸렸다. `minimumReleaseAgeExclude`를 두는 대신 하루 앞 버전을 쓴다. wrangler peer `^5.20261001.1`을 만족). **`msw`·`@msw/cloudflare`는 W4에서 더한다**(W1은 쓰지 않는다. dependabot 그룹 `msw`는 미리 둔다). pnpm 12의 설치 스크립트 허용 키는 **`allowBuilds`**(`esbuild`·`workerd` 둘, §3 [확인 필요] 해소)이고 `minimumReleaseAgeExclude`는 없다. TypeScript 7(`tsc` 네이티브)은 `lib: ["esnext"]`(플러그인 타입의 `Symbol.dispose`)와 `skipLibCheck: true`(vitest 의존성 `tinybench`의 d.ts가 workers-types의 `EventTarget`과 충돌)가 필요했다. `worker-configuration.d.ts`는 `tsconfig.json`의 `include`로 읽는다(§3의 `types` 대신).
7. **invocation 로그 키는 `observability.logs.invocation_logs: false`**(§13.2·§14 [확인 필요] 해소: wrangler 4.147.0 `config-schema.json`의 "Set to false to disable invocation logs"). `observability.enabled: true`는 둔다(`log.ts`의 JSON 줄). 실제 배포에서 꺼지는지는 W9. 같이 `wrangler.jsonc`에 `send_metrics: false`를 둔다(gate 단계 env `WRANGLER_SEND_METRICS=false`와 이중).
8. **W1 골격에서 고른 것.** (가) `/health`의 `schema`는 코드가 아는 최신 스키마 번호 `SCHEMA_VERSION = MIGRATIONS.length`(`src/store/schema.ts`, W1은 0)이고 DO를 읽지 않는다. `build`는 `BUILD_ID`, 없으면 `"unknown"`. (나) `BUILD_ID`는 선택이고 있으면 `^[0-9A-Za-z._-]{1,40}$`. dev 모드에서는 `CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CI_VERIFY_TOKEN`도 선택이다(`pnpm dev:real` 모양: 클라이언트 id·secret만 → 부트스트랩, 운영 치지직 주소). (다) `PUBLIC_ORIGIN`은 `new URL(v).origin`과 글자가 같아야 한다(끝 슬래시·경로·기본 포트·대문자 거부. `redirectUri = PUBLIC_ORIGIN + "/auth/callback"`이 등록 값과 바이트가 같아야 해서). 루프백은 `localhost`·`127.0.0.1`·`[::1]`이고 https 루프백도 dev 모드다. 빈 문자열은 없는 것과 같고, 문자열이 아닌 값은 config_error. `ADMIN_CHANNEL_IDS`는 쉼표 앞뒤 공백을 허용하고 중복을 하나로 본다. (라) 설정 오류 로그는 `config.error{key}`, 출처 불일치는 `reason: "origin_mismatch"`를 더한다. 로그 허용 필드에 `key`(설정 키 이름)와 `errorName`(잡지 못한 예외의 `error.name`)을 더한다. (마) 경로 표는 W1에서 정확한 경로 비교만 한다(`:param`은 W4). 모르는 경로 404 `not_found`, 메서드가 다르면 405 `method_not_allowed` + `Allow`. 핸들러 밖(설정·경로 판정)의 예외도 500 `internal`. `CALLBACK_PATH = "/auth/callback"`은 `config.ts` 상수이고 테스트가 dev `redirectUri`를 `http://localhost:8787/auth/callback`으로 고정한다. (바) `AuthStore`는 W1에서 빈 클래스다(exports 선언을 고정). (사) `pnpm dev`는 W1에서 `wrangler dev`뿐이다(가짜 치지직 서버는 W7). (아) "`console.` 사용처 1곳"·`CI_VERIFY_TOKEN` 파일·`core/`의 `cloudflare:*` import 금지 같은 소스 검사는 vitest가 아니라 `scripts/ci/worker-config.mjs`(Node)가 한다(workerd 안의 테스트는 호스트 소스 파일을 읽지 못한다). `worker-config.mjs`가 §13.2 목록에 더 보는 것은 cicd.md 구현 중 변경 85.
9. **리뷰 반영: 비밀값 파일을 여는 길 막기(W1, 2026-10-06).** (가) **`wrangler dev`는 기본 타입 파일이 있으면 `--env-file`을 주어도 `.dev.vars`를 연다.** wrangler 4.147.0 `resolveConfig` → `checkTypesDiff`가 `./worker-configuration.d.ts`가 있으면 `generateEnvTypes`로 타입을 다시 만들어 해시를 비교하는데, 이때 `getVarsForDev`에 env 파일 목록을 넘기지 않는다. 임시 사본(쓰는 쪽 없는 FIFO `.dev.vars`)에서 `pnpm check`가 그 파일을 만든 뒤 `pnpm dev`가 바인딩 표를 찍고 멈췄고, `fs.readFileSync` 추적이 `checkTypesDiff → loadDotDevDotVars`를 보였다. 구현 중 변경 4의 dev 확인은 그 파일이 없던 사본이었다. 그래서 **타입 출력을 `worker-env.d.ts`로 바꾼다**(`wrangler types worker-env.d.ts …`, `tsconfig.json` `include`, `.gitignore`). dev는 기본 이름만 보므로 이 확인을 건너뛰고, 같은 사본에서 `pnpm dev`가 `localhost:8787/health` 200·`127.0.0.1:8787` 503 `config_error`로 응답했다(추적에 `.dev.vars` 없음). 출력 경로는 **`types` 바로 뒤**여야 한다: `--env-file`은 여러 값을 받아 뒤따르는 위치 인자를 env 파일로 삼킨다(실측: 끝에 둔 경로가 무시되고 기본 이름으로 썼다). `worker-config.mjs`는 `worker/worker-configuration.d.ts`가 있으면 실패한다(로컬의 옛 생성물은 지운다). (나) **스크립트는 글자 그대로이고 wrangler는 늘 `--config wrangler.jsonc`.** `--config`가 없으면 wrangler가 `wrangler.json` → `wrangler.jsonc` → `wrangler.toml` 순으로 위로 찾고 `.wrangler/deploy/config.json` 리디렉트를 따른다(`findWranglerConfig`). 그래서 `check`는 `wrangler types worker-env.d.ts --config wrangler.jsonc --include-runtime=false --env-file .dev.vars.example && tsc --noEmit`, `build`는 `wrangler deploy --dry-run --config wrangler.jsonc --outdir dist --metafile`, `dev`·`dev:real`도 `--config wrangler.jsonc`를 더한다(같은 FIFO 사본에서 셋과 vitest 57개가 끝까지 돌았다). `worker-config.mjs`는 이 다섯 스크립트(`test`는 `vitest run`)를 글자로 고정하고, 그 밖의 스크립트에도 일반 규칙을 건다: 실제 비밀값 파일 이름과 `dev:real` 호출(`pnpm dev:real` 등)은 `dev:real` 밖에 없다, wrangler(경로·`@버전`·`.js`를 붙여도)는 `dev`·`types`·`deploy`만이고 `--config wrangler.jsonc` 하나·`--env` 금지·`dev`/`types`의 `--env-file` 값은 `.dev.vars.example`(dev:real만 `.dev.vars`), vitest는 `--config`·`--root` 금지, `--flag=값`은 `--flag 값`으로 본다. 또 `worker/`에 `wrangler.json`·`wrangler.toml`·`.wrangler/deploy/config.json`·`vitest.config.ts` 밖의 vite/vitest 설정이 있으면 실패한다(있는지만 본다). (다) **`vitest.config.ts` 검사는 주석을 지운 코드에서** `cloudflareTest({ wrangler: { … } })` 안의 `environment: "example"` 하나·`configPath`·펼침 없음과 `new URL("./.dev.vars.example")` → `miniflare.bindings`를 본다(주석 한 줄로 통과하던 구멍). (라) **CI 누출 씨앗.** worker gate가 CI(`CI=true`)에서만 `pnpm check` 전에 `worker/.dev.vars`를 `LEAK_SENTINEL=leak-sentinel` 한 줄로 O_EXCL 생성하고(무엇이든 이미 있으면 열지 않고 실패), vitest 뒤에 지우며 `worker-env.d.ts`에 `LEAK_SENTINEL`이 없는지 본다(`worker-config.mjs --sentinel plant|check`). vitest 쪽 누출은 `bindings.test.ts`의 "문자열 바인딩 집합 = `CONFIG_KEYS`"가 잡는다. 임시 사본에서 둘 다 실패하는 것을 확인했다: `environment`를 빼면 그 단언이 `LEAK_SENTINEL`로 실패, `--env-file` 없는 `wrangler types`는 `worker-env.d.ts`에 `LEAK_SENTINEL: string`. 로컬에서는 그 자리가 1Password FIFO라 두 단계가 아무것도 하지 않는다. (마) dev는 `http://localhost:8787`로만 연다: `127.0.0.1:8787`은 출처가 `PUBLIC_ORIGIN`과 달라 `config_error`다(§10.1, CLAUDE.md 명령에 적는다).
10. **Codex 적대적 리뷰 반영: exports DO 선언은 실배포 전까지 미검증이고, 대안 커밋을 미리 검증해 둔다(W1, 2026-10-06).** CI `worker` 작업의 `deploy --dry-run`과 vitest(miniflare)는 번들·로컬 바인딩만 보며 **Cloudflare가 이 선언으로 DO를 실제로 만드는지는 덮지 않는다**(R5). 실배포는 W1 범위 밖이라(계정·로그인 없음) 이렇게 둔다. (가) **대안 = 레거시 선언**: `wrangler.jsonc`에서 `exports` 블록을 `"migrations": [{ "tag": "v1", "new_sqlite_classes": ["AuthStore"] }]`로 바꾼다(`durable_objects.bindings`·클래스 `AuthStore`·바인딩 `AUTH`는 그대로). 임시 사본(wrangler 4.147.0, `.dev.vars` 없음)에서 이 설정으로 `pnpm build`(dry-run, 바인딩 표에 `env.AUTH (AuthStore) Durable Object`)와 vitest 57개가 모두 통과했다. 바꾸는 커밋은 `worker-config.mjs`의 `FORBIDDEN_KEYS`에서 `migrations`를 빼고 "`exports` 없음·`migrations`는 위 한 항목" 검사로 바꾸며, 이 항목에 결과를 적는다. (나) **언제 바꾸나**: W9 첫 수동 배포의 **첫 단계**가 exports 선언 그대로의 `wrangler deploy`이고, 배포가 거부되거나 배포 뒤 DO 바인딩이 동작하지 않으면(`/health`는 DO를 읽지 않으므로 W9 확인 요청으로 본다, 구현 중 변경 8 (가)) 그 자리에서 (가)로 바꿔 다시 배포한다. 첫 배포가 성공하기 전에는 아무것도 굳지 않으므로(클래스·바인딩 이름 고정은 첫 배포 뒤부터, §3) 이 전환에 데이터 이전은 없다. (다) 첫 배포가 exports로 성공하면 이후 레거시로 되돌리지 않는다(형식을 섞지 않는다, §3 DO 구성).
11. **비용 0 제약(사용자 결정 2026-10-06): Cloudflare 무료 범위에서만 운영한다.** 계정에 결제 수단이 있을 수 있어 "넘으면 청구"인 자원은 설계로 막는다. 근거는 Cloudflare 문서(2026-10 확인): Workers Free는 10만 요청/일을 넘으면 Error 1027로 실패하고, DO는 Free에서 SQLite만이며 한도(쓰기 10만 행/일·저장 5GB)를 넘으면 그 연산이 실패한다(둘 다 과금 없음). **R2만 무료 한도(Standard 저장 10GB-월, Class A 100만/월, Class B 1000만/월)를 넘으면 청구한다**(이그레스는 무료). 규칙: (가) **Workers Paid로 올리지 않는다.** Paid 전용 기능(키-값 DO, `limits.cpu_ms` 상향 등)을 쓰지 않는다. 새 Cloudflare 기능은 쓰기 전에 Free에서 되는지와 초과 시 실패/청구를 문서로 확인해 여기에 적는다. (나) **커스텀 도메인을 두지 않는다**(도메인 구입이 비용). 주소는 workers.dev. 그래서 zone이 없어 **WAF 요청 수 제한 규칙(Q4)은 쓸 수 없다**: Q4를 "쓰지 않음"으로 닫는다. 분산 요청이 10만/일을 소진하면 그날 Worker가 1027로 멈추는 가용성 위험은 받아들인다(비용은 없다). 단일 호스트는 §5의 IP 스로틀이 막는다. (다) **R2 버킷은 비공개.** r2.dev 공개 주소·버킷 커스텀 도메인을 켜지 않는다. 버킷에 닿는 것은 Worker 바인딩과 CI의 S3 토큰(버킷 한정)뿐이다. 인증 없는 S3 요청은 청구되지 않는다(R2 FAQ). (라) **Class B 상한**: Worker 요청 하나가 부르는 R2 연산(`get`·`head`·`list`)은 **2회 이하**다. 10만 요청/일 × 30일 × 2 = 600만/월 < 1000만. W5가 경로마다 R2 호출 수를 세는 테스트(가짜 R2 바인딩의 호출 계수)로 고정한다. `list`는 Worker 요청 경로에서 쓰지 않는다. (마) **저장 상한 = 릴리스 보존 개수.** 릴리스 한 벌은 약 130MB다(2026-10 ratchet 크기: AppImage 87MB·deb 10MB·dmg 7MB·msi 7MB·setup 5MB에 updater 산출물). W8 `release.mjs`가 승격(`promote`) 뒤 `releases/` 아래 버전을 **최신 5개 + `previous`가 가리키는 버전**만 남기고 지운다(DeleteObject는 무료). 상한은 약 0.8GB로 10GB의 1/10 아래이고, 판정·`rollback`이 쓰는 버전은 지우지 않는다(지울 목록은 `verify`의 결정표와 같은 순수 함수가 정하고 selftest가 고정). (바) **Class A**: 릴리스당 PUT은 수십 개(100MB 미만 객체는 한 번)라 100만/월에 한참 못 미친다. 리허설·PR은 가짜 S3를 쓰므로 R2를 건드리지 않는다. (사) 한도 계산은 §5 "무료 한도 계산"(DO 쓰기)과 함께 본다. 실제 사용량은 W9 뒤 대시보드에서 한 번 확인해 ROADMAP에 적는다. (아) **요청 수 소진(Q4를 닫은 대가)에 대한 대응**(Codex 적대적 리뷰 반영). Worker 안의 카운터(DO 전역 카운터 등)로는 막을 수 없다: 10만/일은 Worker **호출** 단위로 세므로 코드가 돌기 전에 이미 셈에 들어가고, 요청마다 DO를 부르면 DO 한도를 먼저 쓴다. 그래서 막기 대신 **피해를 가두고 절차를 둔다**: ① 앱은 Error 1027(Cloudflare가 내는 응답, 상태 코드는 R6 미검증)을 **네트워크 계열 실패로 분류**해 3일 오프라인 유예 안에 둔다(A1의 `classify_verify` 표에 행을 더하고 W9에서 실제 상태 코드로 고정). 그러면 하루 소진이 기존 사용자를 잠그지 않고, 진행 중 다운로드는 늘 계속된다(§11.3). 막히는 것은 새 로그인·업데이트 확인·랜딩뿐이다. ② 운영 절차: 한도는 00:00 UTC(한국 09:00)에 초기화된다. 소진이 반복되면 Workers 대시보드의 요청 그래프로 경로를 확인하고, 대응(경로 축소·주소 교체 = 새 Worker 이름과 `DIST_BASE_URL`·치지직 리디렉션 URL 교체)은 사용자와 정한다. 유료 전환(Workers Paid·도메인 구입)은 이 제약상 선택지가 아니다. ③ `/health`를 nightly가 부르지 않는다(요청 수를 쓰지 않게, 배포 직후 deploy-worker 검사만).
12. **치지직 자격증명을 운영용과 로컬 테스트용으로 나눈다(사용자 결정 2026-10-06, §10·§15를 바꾼다).** 운영 리디렉션 URL을 등록하면서 하나뿐인 치지직 앱에서 localhost 주소가 빠졌다. 그래서 (가) 지금 앱은 **운영 전용**이고 그 client id·secret은 1Password Environment `chzzk-downloader-worker-prod`(옛 이름 `chzzk-downloader-worker`)에 두며 **어디에도 마운트하지 않는다**. W9의 `wrangler secret put CHZZK_CLIENT_ID/SECRET`은 이 Environment에서 사용자가 넣는다. (나) 로컬 테스트용 치지직 앱을 따로 등록하고(리디렉션 `http://localhost:8787/auth/callback`) 그 id·secret을 **여러 서비스가 함께 쓰는** Environment `chzzk-local-dev`에 둔다. `worker/.dev.vars`는 이 Environment의 마운트다(키는 `CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CHZZK_REDIRECT_URI`, (마). 다른 서비스가 다른 키를 더하면 `pnpm dev:real`의 바인딩에 섞이니 이 Environment에는 정확히 이 세 키만 둔다). `pnpm dev:real`·G-ID 도구는 이 앱으로 돈다. 공용이라 포트 8787·경로 `/auth/callback`을 바꾸지 않고, secret을 바꾸면 쓰는 서비스가 모두 따라간다. (다) 옮기는 동안(로컬 앱 등록과 마운트 교체 전)은 `worker/.dev.vars`가 여전히 운영 Environment의 마운트다. 규칙(열지 않는다, 테스트·gate가 읽지 않는다)은 그대로이고, 교체 뒤 운영 값은 로컬 디스크에 마운트되지 않는다. §15 1단계의 "`chzzk-downloader-worker`로 마운트"는 `chzzk-local-dev`로 읽는다. (라) **공용 Environment가 다른 비밀을 섞지 않게**(Codex 적대적 리뷰 반영): `wrangler dev --env-file`은 파일 전체를 바인딩으로 싣는다. 그래서 ① `chzzk-local-dev`에는 치지직 테스트 앱의 키만 둔다((마)의 세 키. 다른 서비스도 같은 키만 쓰고, 서비스별 비밀은 각자 Environment에 둔다). ② **W4에서 강제한다**: dev 모드(`PUBLIC_ORIGIN`이 루프백)의 설정 검사가 `CONFIG_KEYS`·바인딩 표 밖의 문자열 바인딩을 보면 `config_error`로 멈추고 로그에는 **키 이름만** 남긴다(값은 찍지 않는다. 운영 모드는 `wrangler.jsonc`·secret으로만 들어오므로 검사하지 않는다). 테스트는 vitest에 남는 키를 하나 더한 설정 사례. 여과 래퍼(임시 env 파일에 필요한 키만 써서 넘기기)는 평문 비밀을 디스크에 남기므로 쓰지 않는다. (마) **`CHZZK_REDIRECT_URI`를 세 번째 키로 둔다**(사용자 결정 2026-10-06): 값은 로컬 테스트 앱에 등록한 `http://localhost:8787/auth/callback`이고 비밀이 아니다. 공용 Environment를 쓰는 다른 서비스가 그대로 읽고, 등록 값의 기록이 된다. Worker는 이 값을 쓰지 않고(`redirectUri`는 늘 `PUBLIC_ORIGIN + CALLBACK_PATH`) **dev 모드에서는 반드시 있어야 하고 그 값과 바이트가 같아야 한다**(없거나 다르면 `config_error{key}`로 멈춘다)(등록 값과 코드가 어긋난 것을 첫 요청에서 드러낸다). 운영 모드에서는 이 키가 없어야 한다(있으면 `config_error`, 운영 값은 `PUBLIC_ORIGIN`이 원천). 그래서 (라) ②의 "알려진 키"는 `CONFIG_KEYS` + `CHZZK_REDIRECT_URI`이고 `chzzk-local-dev`의 키는 이 셋이다. `.dev.vars.example`에도 같은 키(`http://localhost:8787/auth/callback`)를 더하는 것은 W4에서 검사와 함께 한다(W1의 `.dev.vars.example` = `CONFIG_KEYS` 검사도 같이 고친다).
13. **토큰 형식과 해시 입력 계약(W2, §6.1·§7.1의 모호함을 정한다. A1 앱도 이를 따른다).** (가) 형식은 정규식으로만 판정하고 디코드하지 않는다: access·refresh·웹·흐름 토큰은 각각 `^cda_`·`^cdr_`·`^cdw_`·`^cdf_` 뒤에 `[A-Za-z0-9_-]{43}$`이고 자리마다 그 접두 하나만 받는다(다른 종류의 접두는 형식 실패). loginId·handle·session id·웹 flow id는 `^[A-Za-z0-9_-]{22}$`(16B), state·pollSecret·csrf·pollVerifier는 `^[A-Za-z0-9_-]{43}$`이다. 길이를 정해 두어 긴 입력은 해시 전에 버린다. (나) 저장 해시는 **접두를 포함한 토큰 문자열 전체의 UTF-8 바이트**를 SHA-256한 소문자 hex다. (다) `pollVerifier = b64url(SHA-256(UTF-8(pollSecret 문자열)))`이다. 원시 32바이트가 아니라 전송되는 b64url 문자열을 해시한다. 앱(A1)도 같은 입력으로 만들고, `test/unit/token.test.ts`의 known-answer(0x5a 32바이트의 pollSecret → verifier)가 고정한다. (라) 비밀 비교(`CI_VERIFY_TOKEN`·csrf)는 두 값을 SHA-256한 뒤 `crypto.subtle.timingSafeEqual`이다. 실측으로 길이가 다르면 `TypeError`를 던져 해시가 필요하다. (마) b64url은 `Uint8Array.prototype.toBase64({alphabet:"base64url", omitPadding:true})`, hex는 `toHex()`다(workerd·TS 7 `esnext` 실측). (바) `Authorization`은 `^Bearer +(\S+)$`(scheme 대소문자 무시)다. 앞뒤 공백·값 두 개는 null.
14. **W2 core에서 고른 것.** (가) **실측**: workerd `fetch`에 `AbortSignal.timeout`이 걸리면 요청 단계와 본문 읽기 단계 모두 `DOMException` `name "TimeoutError"`로 실패하고, 연결 거부는 `Error`("Network connection lost.")다. 그래서 `timedOut`은 `instanceof`가 아니라 `name`으로 판정하고, 신호 하나로 요청과 본문 읽기를 함께 덮는다. (나) `chzzk.ts`: `expiresIn`은 읽지 않는다(토큰을 버린다). 오류 `code`는 **문자열·숫자일 때만** `String()` 뒤 `^[\w.-]{1,50}$`이면 싣는다(`null`·`true`·객체는 뺀다: `String(null)`이 모양을 통과하므로). 실패면 HTTP 상태와 무관하게 싣는다(200 래퍼의 `{code:401, content:null}`도 진단에 쓴다). HTTP 200이어도 `content ?? json`에 `accessToken`이 없으면 실패이고, `accessToken`은 헤더에 실을 수 있는 모양(`^[!-~]{1,8192}$`, 공백·제어 문자 없음)이어야 한다(아니면 토큰 단계 실패). `channelName`은 `\p{Cc}`와 bidi 제어(`U+200E`·`U+200F`·`U+202A–202E`·`U+2066–2069`)를 지운 뒤 코드 포인트 128자로 자른다(관리 화면에 보이는 공격자 제어 값, 이스케이프는 html이 한다). `apiBase` 끝 슬래시는 뗀다. 네트워크와 시간 제한 신호는 인자(`ChzzkDeps`)로 주입한다(core는 전역 네트워크 함수를 부르지 않는다). (다) **semver 벡터는 공유 데이터 파일 `xtask/testdata/semver-vectors.json` 하나다.** §0 "버린 것"의 생성기가 아니라 두 테스트(`xtask/src/semver.rs` `shared_vectors`, `worker/test/unit/semver.test.ts`)가 같은 파일을 읽고 역방향 비교도 본다. Worker는 xtask 동작을 그대로 따른다: BigInt u64, 숫자 prerelease의 앞자리 0 허용(`1.0.0-01` == `1.0.0-1`), u64를 넘는 prerelease 숫자는 영숫자 취급, `+` 거부. `scripts/ci/release.mjs` `cmpSemver`(Number 기반)는 이 표 밖이다(`-01`과 2^53 초과에서 다르다). 맞추는 일은 따로 한다. (라) **키 문법에 셋을 더한다**: 경로에 `..` 없음, file ≠ `.`, version은 semver 파서 통과(아니면 400 `bad_key`). `previous`·`latest.json`은 SHA256SUMS에 있어도 사용자에게 보이지 않는다. SHA256SUMS 해석은 xtask `parse_sums`와 같은 규칙(두 칸 구분, 소문자 hex 64, `/` 금지, 중복 금지, 끝 줄바꿈, CRLF 허용)이고, 틀리면 사용자에게는 META(`SHA256SUMS`·`manifest.json`)만 보인다(닫힌 쪽). 바이트는 UTF-8 fatal이고 **BOM을 떼지 않는다**(xtask `String::from_utf8`처럼 첫 줄이 틀려 null). `release/expected-artifacts.json`의 모든 산출물 이름(`chzzk-downloader_<v>_<name>`)과 updater `.sig`가 문법을 통과함을 `keys.test.ts`가 표에서 계산해 고정한다. (마) **Range**: 단위 이름은 대소문자를 가리지 않는다. 숫자 15자리 초과, 다중 범위, 공백, `b<a`는 무시한다(200 전체). size 0은 모든 범위가 416이다(RFC의 "길이 0이면 0이 아닌 suffix만 만족"을 따르지 않는다. 릴리스 파일은 비지 않는다). `resolveRange(spec, size)`는 크기만 받는 순수 함수라 W5가 `head` 없이 `get` 한 번의 `obj.size`로 판정할 수 있다(구현 중 변경 11 (라)의 2회 상한. §9.2의 "head 먼저"는 W5가 정한다). (바) 확인 코드 알파벳은 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`(0·1·I·O 제외 32자), 8바이트 각 `& 31`(편향 없음)이다. (사) **updater**: `current`를 R2보다 먼저 판정한다(퍼센트 디코드 실패·semver 아님 → 400, R2 0회). `latest.json`이 UTF-8(fatal, BOM 유지)·JSON 객체·`version` 문자열·semver 중 하나라도 틀리면 W5에서 500 `internal`(로그 `release.latest_invalid`)이다. 204로 숨기지 않는다: deploy-worker 검사와 앱 유예 규칙(5xx = 네트워크 계열)이 드러낸다. 갱신이면 받은 바이트 객체를 그대로 돌려준다. (아) **html**: `SafeHtml`은 비공개 필드 브랜드(`#html in v`, 같은 모양 객체·`Object.create(proto)`로 위조 불가 실측)이고 클래스는 내보내지 않으며, 생성자는 모듈 안의 symbol 열쇠를 요구한다(인스턴스의 `constructor`로 `new`를 불러도 `TypeError`). 남은 우회는 태그 없이 배열을 넘기는 호출(`html([…] as TemplateStringsArray)`)이고 `raw` 허용 목록에 보이지 않는다: W6에서 호출형 `html(`을 `src/core/html.ts` 밖에서 막는 정적 검사를 더한다. 값은 문자열과 유한 숫자는 이스케이프(`& < > " '`), `false`·`null`·`undefined`는 빈 문자열, 그 밖(`true`·객체·함수·bigint·symbol·NaN)은 `TypeError`다. 정적 조각은 cooked 문자열만 쓰고 없으면 던진다. 이스케이프 없는 삽입 함수는 문자열만 받는다. 페이지 골격 `page()`는 W6로 미룬다(CSS 해시·copy가 필요하다).
15. **core 순수성과 `raw` 정적 검사를 원문으로 한다(§3 규칙 (1)의 "타입 import 제외"를 바꾼다).** `scripts/ci/worker-config.mjs`는 `src/core/**`의 원문(주석 포함)에 다음이 없음을 본다: `cloudflare:`(타입 import 포함, core는 전역 타입만 쓴다), `../`가 든 문자열(바깥 모듈 import, `./../` 우회 포함), 전역 `fetch`(호출·별칭·`globalThis.fetch`. `deps.fetch(`와 속성 선언 `fetch:`는 된다), `Date.now`. `src/**` 전체에는 `Math.random`이 없다(난수는 `crypto.getRandomValues`). `src/**`의 `raw` 식별자 토큰 수(주석·문자열·`raw as`·`["raw"]` 포함)는 `RAW_ALLOWLIST`(파일별 정확한 수, 지금 `src/core/html.ts` 1 = 선언)와 같아야 하고 목록 밖 파일은 0이다. 그래서 `src/config.ts`의 매개변수 이름 `raw`를 `text`로 바꿨다(동작 같음). 줄 단위 검사가 놓치던 여러 줄·side-effect·동적·`export … from` import와 `raw` 별칭을 잡는다. 원문을 보는 이유: 주석 제거기(`stripJsComments`)가 정규식 리터럴을 몰라 따옴표가 든 리터럴(`html.ts`의 이스케이프 정규식)에서 뒤의 코드를 지울 수 있다(미탐). 대가로 core는 이 이름들을 주석에도 쓰지 않고, W6가 사용처를 더할 때 파일과 개수를 함께 올린다(사용처 변화가 늘 리뷰에 보인다). 씨앗은 `scripts/ci/worker-config.test.mjs`(cicd.md 구현 중 변경 87).
16. **W2 리뷰 반영(14 (나)·14 (마)·15를 바꾼다).** (가) **`channelName`에서 지우는 문자를 넓힌다(14 (나))**: `\p{Cc}`, soft hyphen `U+00AD`, ALM `U+061C`, ZWSP·ZWNJ `U+200B`·`U+200C`, LRM·RLM `U+200E`·`U+200F`, `U+202A–202E`, WJ와 보이지 않는 연산자 `U+2060–2064`, `U+2066–2069`, BOM `U+FEFF`. 거부 목록·부트스트랩 화면에서 `관리자`와 `관리자`+ZWSP가 구분되지 않던 값이다. ZWJ `U+200D`는 이모지 결합 순서에 쓰여 남긴다. 이 문자들은 소스에 **리터럴로 쓰지 않고 `\u` 이스케이프**로 쓴다(리터럴이면 GitHub·편집기에서 줄이 다시 배열되어 보여 리뷰로 범위를 확인할 수 없다, Trojan Source). `worker-config.mjs` `checkSources`가 `worker/`의 `src/`·`test/`·`scripts/`에서 ALM·LRM·RLM·`U+202A–202E`·`U+2066–2069` 리터럴을 막는다. 저장소의 `scripts/ci/public-scan.mjs` `ZERO_WIDTH`(master부터 있던 `U+200E`·`U+200F` 리터럴)는 범위 밖이다. (나) **core 순수성 검사가 놓치던 모양을 막는다(15의 "별칭" 범위를 실제로 잡는 것까지 넓힌다)**: `../`는 따옴표와 무관하게 core 원문 어디서도 안 된다(문자열 줄 연속 `"\⏎../x"` 우회, 주석 포함), 맨 `".."` 지정자는 `import`·`from` 뒤에서 막는다(`pathname.includes("..")`는 된다), 전역 `fetch`의 삼항 참 쪽(`? fetch :`)과 `globalThis`·`self` 구조 분해 별칭(`{ fetch: f } = globalThis`), 인자 없는 `new Date`(`new Date()`·`new Date;`, 주입된 시각을 바꾸는 `new Date(ms)`는 된다), `new` 없이 부른 `Date()`, `performance.now`. 남은 한계: 정적 정규식이라 계산된 속성 이름(`globalThis["fe" + "tch"]`)·`Reflect.construct(Date, [])` 같은 모양은 잡지 않는다(악의 있는 우회는 리뷰가 본다). (다) **Range의 R2 호출 수(14 (마)와 §9.2를 바꾼다)**: §9.2의 "`DIST.head(key)`로 size를 먼저"는 A·W 경로에서 보이는 키 판정용 `SHA256SUMS` `get`이 isolate 캐시에 없을 때 head + get과 합쳐 3회라 구현 중 변경 11 (라)의 "요청당 2회 이하"를 넘는다. **11 (라)가 이긴다**: W5는 Range 요청에서 `head`를 따로 부르지 않는 설계를 실측으로 고른다(후보: `core/range.ts`가 인정한 단일 범위만 **새 `Headers`에 `Range` 하나로 다시 만들어** `DIST.get(key, { range: <그 Headers> })` 한 번 부르고 `resolveRange(spec, obj.size)`로 판정한다. 파서가 무시하라고 한 요청(다중 범위·15자리 초과·공백·문법 오류)은 range 없이 200 전체다: 요청 헤더를 그대로 넘기면 R2가 `range.ts`가 거부한 범위를 적용해 부분 본문에 200을 붙이거나 판정과 어긋날 수 있다. 만족 불가면 본문을 취소하고 416 + `Content-Range: bytes */<size>`. 판정이 R2가 고른 범위 `obj.range`와 어긋나지 않는지도 본다). W5의 R2 호출 수 테스트에 **"A·W 자격 + Range + SUMS 캐시 미스"**(성공·416·404)를 명시적으로 넣는다. (라) 13 (가)의 토큰 정규식이 문자 집합 `cd[ardwf]`로 적혀 없는 접두 `cdd_`도 받는 모양이었다. 같은 PR에서 더한 항목이라 그 자리를 접두 넷으로 고쳤다(코드 `isToken`은 처음부터 종류마다 정확한 접두를 봤다). (마) 14 (다)의 "`release.mjs` `cmpSemver`를 맞추는 일은 따로 한다"를 **W8 체크리스트 항목**으로 고정한다(ROADMAP W8): W8 prune(보존 최신 5개 + previous)과 태그 gate가 이 함수로 정렬하므로, `release.test.mjs`가 같은 `xtask/testdata/semver-vectors.json`을 읽고 `cmpSemver`를 BigInt·u64 규칙(`1.0.0-01` == `1.0.0-1`, 2^53 초과 정확)으로 맞춘다. 지금은 `-01`과 2^53 초과에서 xtask와 다르다. (바) **semver 숫자 성분은 BigInt 전에 길이로 거른다(14 (다))**: `parseVersion`이 무제한 `^[0-9]+$` 뒤 `BigInt`를 만들어 요청 경로(`/releases/{v}/…`·`/update/{current}`)의 아주 긴 숫자로 CPU·메모리를 쓸 수 있었다. 앞자리 0을 뗀 길이가 20자리를 넘으면 거부하고, 20자리면 `"18446744073709551615"`와 사전순으로 비교한 뒤에만 `BigInt`를 만든다(core의 앞자리 0 거부는 그대로, prerelease 숫자 조각의 앞자리 0은 Rust `parse::<u64>`처럼 값으로 읽는다). 공유 벡터에 20자리 최댓값 통과·+1 거부·20자리 초과값·21자리 거부와 긴 앞자리 0 prerelease 비교를 더했다. (사) **`Date` 순수성 정규식이 주석을 공백으로 본다(15·16 (나))**: `new Date(/* … */)`·`new Date(// …⏎)`는 인자 없는 호출인데 괄호 안 첫 글자가 `/`라 통과했다. 토큰 사이·괄호 안의 블록·줄 주석을 공백으로 보는 `JS_GAP`을 두 `Date` 규칙에 넣고, 괄호 안 첫 비공백 글자가 `/`면 거부한다(되짚기로 주석 일부만 공백으로 보고 빠져나가지 못하게). 원문 검사는 그대로다(주석 제거기는 정규식 리터럴 때문에 미탐이 있다, 15).
17. **W3 실측(§5 [확인 필요]·R6 해소, wrangler 4.147.0·vitest-plugin 1.3.6, 2026-10-06).** (가) `setAlarm`은 기존 알람을 덮어쓴다(늦은 값 → 이른 값, 이른 값 → 늦은 값 모두 `getAlarm()`이 둘째 값). `alarm()` 실행 중의 `getAlarm()`은 `null`이고, `runDurableObjectAlarm`은 처음 `true`, 다시 부르면 `false`다. "읽어서 더 이른 쪽만 설정" 우회는 쓰지 않는다. `test/store/alarm.test.ts`의 첫 테스트가 고정한다. (나) `vi.setSystemTime`은 DO 안의 `Date.now()`(RPC·`runInDurableObject`·생성자·`runDurableObjectAlarm`의 `alarm()`)에 적용된다(같은 isolate). 그래서 `Clock` 주입은 두지 않는다. RPC는 Worker의 `now`를 받고, `alarm()`만 `Date.now()`를 쓴다(Worker `fetch`와 같은 경계). 알람 스케줄러는 실제 시각이라 과거 시각 알람은 테스트 중에 저절로 실행된다. 그래서 테스트 기준 시각은 `Date.UTC(2030,0,1)`이고 코드는 `setAlarm(max(now, Date.now()) + 지연)`이다. (다) `cursor.rowsWritten`은 INSERT 때 표와 모든 인덱스 항목(NULL UNIQUE 포함)을 센다: flow INSERT 5행, UPDATE는 인덱스 열을 바꾸면 2행·아니면 1행(같은 값도 1), `IS NOT` 가드로 걸러지면 0, DELETE는 1행당 1. `AUTOINCREMENT`는 INSERT마다 1행을 더 써서 `audit.id`는 일반 `INTEGER PRIMARY KEY`다. (라) 외래 키가 강제되므로(`PRAGMA foreign_keys`=1) 지울 때는 refresh가 session보다 먼저다. (마) `setAlarm` 뒤 `sqlite_master`에 `_cf_METADATA`가 보여 스키마 비교·덤프에서 `sqlite\_%`와 `\_cf\_%`를 뺀다. `cursor.one()`은 빈 결과에 던져 `Db.first`는 `toArray()[0] ?? null`이다. 한 `exec`의 여러 문장, `transactionSync` 안의 DDL과 그 되돌리기가 된다.
18. **RPC 모양(§5.1을 바꾼다).** 모든 RPC는 `async`이고 마지막 인자가 `now`다. 허용 판정이 필요한 RPC(`finish`·`claim`·`check`·`webCheck`·`rotate`·`disallow`)는 Worker가 `config.adminChannelIds`를 `admins`로 넘긴다(관리자는 요청마다 secret으로 판정, §2). DO는 들어오는 자격 원문을 받지 않고 Worker가 만든 SHA-256 hex(`isHexHash`가 아니면 SQL 전에 거부)만 받는다. 새 토큰은 DO가 트랜잭션 **전에** 발급·해시하고(`crypto.subtle`은 비동기라 `transactionSync` 안에 둘 수 없다) 원문은 반환만 한다. §5.1의 `admit`·`activate`·`webLogin`은 RPC가 아니라 `finish`·`claim` 안의 단계다(RPC 한 번 = 트랜잭션 하나). 더한 RPC는 `loginPage(handleHash)`(확인 페이지 코드), `doneView(binderHash)`(완료 페이지), `allowDenied(channelId, by)`(거부 기록에서 [허용])이고, §5.1에 이미 있던 `revokeMine(channelId, sessionId)`·`mySessions(channelId)`는 `now`만 더했다. 인자가 바뀐 것: `revoke(sessionId, why, actor, now)`는 `why`를 `'admin'|'logout'`으로 좁히고 감사 기록용 `actor`를 더했다(`'admin'`일 때만 `revoke_session` audit). `dismissDenied(channelId, by, now)`는 감사 기록용 `by`를, `disallow(channelId, by, admins, now)`는 `admins`를 더했다(`allow(channelId, note, by, now)`는 `now`만). `rotate` 결과에 `rate_limited`가 더해졌다(구현 중 변경 24). `startApp`·`startWeb`은 `ip`(`CF-Connecting-IP` 값 그대로)와 `limit`(`config.startRate10m`)을 받는다. `rotate` 결과의 `recovered`·`reuseDetected`는 W4 로그 이벤트용이다. 시각은 epoch ms로 돌려주고 RFC3339 변환은 W4가 한다.
19. **스로틀·상한·폴링 간격(§5 "상한·스로틀"을 정한다).** (가) IP 버킷은 core 순수 함수 `ipBucket`이다(IPv4 그대로, IPv6 앞 64비트, IPv4-mapped는 IPv4, 헤더 없음 `none`, 형식 오류 `bad`). 키는 `SHA-256(DO 메모리 난수 소금 | UTC 일 번호 | 버킷)` 앞 32 hex다. DO가 해시한다(Worker isolate마다 소금이 다르면 키가 갈라진다). 앱·웹 start가 한 맵을 같이 쓴다(IP당 10분 6회). 고정 창이고 거절 시 `retryAfterSec = ceil(창 끝 − now)`(1~600초로 자름), 맵은 4096키 상한이다. **`now`는 Worker가 요청마다 자기 시계로 정해 RPC 인자로 넘기므로 동시 요청은 이른 `now`가 늦게 도착한다.** 그래서 창은 `now − start ≥ 10분`일 때만 바뀌고, 창 시작보다 이른 `now`는 지금 창으로 센다(역행을 새 창으로 보면 병렬 요청 하나로 한 IP가 32슬롯을 모두 채운다, W3 리뷰 실측). 폴링 간격 게이트도 마지막 기록보다 이른 `now`를 `too_soon`으로 답하고 기록을 앞당기지 않는다. (나) 비만료 흐름 32개 상한은 메모리 카운터가 아니라 `SELECT count(*) FROM flow WHERE expires_at > ?`다(인덱스 범위라 읽기 ≤ 32행, 만료·삭제와 어긋날 수 없다). (다) **종결 시 flow 만료를 앞당기지 않는다**(`expires_at = max(expires_at, now + 2분)`). 아니면 콜백까지 마친 흐름이 2분 만에 슬롯을 비워 순환이 하루 144회에서 720회로 늘어난다. 앱 흐름이 허용되면 unclaimed 세션 만료는 그 flow 만료와 같다. (라) 폴링 간격 맵은 거절할 때 기록을 갱신하지 않고(1.4초 간격 클라이언트가 영원히 막히지 않게), `too_soon`은 SQL 전에 답한다. (마) 무료 한도 재계산(실측 행 수, 하루 최악): 공격자 흐름 하나가 start·[계속]·가짜 콜백·청소까지 12행 × 32슬롯 × 144순환 ≈ 55,300. 거부 기록 ≤ 4,800(실제 계정 필요). 정상 로그인 ≈ 25행/회, 회전 ≈ 8행/회(구현 중 변경 24의 인덱스 포함, 응답 유실 복구 10행) × 20명 < 1,000 → **약 61,000 < 100,000**. 흐름 한 순환 ≤ 12행(실측 start 5 + [계속] 2 + binder 실패 3 + 청소 1)과 회전 ≤ 8행·복구 ≤ 10행은 `test/store/flows.test.ts` "행 수 상한"이 묶는다(인덱스·열을 바꿔 늘면 테스트와 이 계산을 함께 고친다). 허용된 채널 하나가 회전을 남용하는 경우는 구현 중 변경 24. §5의 19,000은 인덱스 행을 세지 않은 값이었다. 읽기는 Worker 요청 10만 × start당 ≤ 33 ≈ 330만 < 500만행/일이다.
20. **세션 판정에서 정한 것(§5.2·§6.1을 정한다).** (가) `revoked_why = 'disallowed'`인 세션은 check·webCheck·rotate 어디서든 403 `not_allowed`로 답하고, 다른 사유는 401 `session_revoked`다(§5.2 "세션 revoked" 행과 §6.1·§8.1 "뺀 직후 403"을 함께 만족). (나) 재사용 감지는 refresh 행을 지우지 **않는다**. 세션이 revoked라 효력이 없고, 지우면 피해자 앱의 현재 토큰이 "없음 → `session_expired`"가 되어 `ReuseDetected`를 보일 수 없다. 행은 세션과 함께 revoke 30일 뒤 청소된다. (다) 자기 만료가 지난 used 토큰은 복구·감지 없이 `session_expired`(쓰기 0)다. (라) 복구 창은 부모의 **첫** 사용 시각부터 60초다(`used_at`은 복구로 바뀌지 않는다). (마) 복구 횟수는 `session.recovered` 열(+1)에 둔다. audit은 500행 상한이라 셀 수 없고, 복구 때 세션 행을 어차피 쓰므로 추가 쓰기가 없다. (바) 세션 `created_at`(60일 상한 기준)은 콜백에서 허용된 시각이다. (사) 부트스트랩(`admins` 빔)에서는 allowlist 행이 있어도 아무도 허용하지 않는다. (아) claim 전에 허용에서 빠진 앱 세션(unclaimed → revoked `disallowed`)은 claim에서 `gone`(`failed/session`)이 아니라 `denied`로 답한다(앱에 "허용되지 않음"을 보인다).
21. **스키마 v1 차이와 store 규칙(§5 SQL·§3 규칙 (2)(3)).** `session.recovered INTEGER NOT NULL DEFAULT 0`을 더했고, `audit.id`는 AUTOINCREMENT 없음, `audit.action`에 CHECK를 두었다. `flow.fail_code`에 `session`(ok였지만 세션이 사라짐·폐기)을 더했다. 웹 흐름은 start 때 바로 `redirected`이고 허용되면 flow 행을 그 자리에서 지운다. 앞선 스키마(DB 버전 > 코드)는 던지지 않고 로그 `store.schema_ahead`만 남긴다. `wrangler rollback`으로 옛 코드가 새 DB를 만나도 서비스가 돈다. 그 대가로 마이그레이션은 더하기만 한다. 정적 검사(`worker-config.mjs` `checkStorePurity`, cicd.md 89): `src/store/` 중 `AuthStore.ts` 밖은 `async`·`await`·`cloudflare:`·시각 함수를 원문(주석 포함)에 쓰지 않고, `sql.exec`는 `src/store/db.ts`(`Db`, 행 수 계량)에만, `transactionSync(async …)`는 금지다. 별칭 우회를 막는 토큰 금지(`.exec(`·`SqlStorage`·`.then(`·`storage.sql` 개수·`transactionSync` 위치)와 그 한계는 cicd.md 90.
22. **알람 정책(§5 "alarm"을 바꾼다).** 정확성은 알람에 기대지 않는다(모든 조회가 만료를 거른다). 그래서 "가장 이른 만료로 설정" 대신, 행을 쓴 RPC 뒤에 예약된 알람이 없으면(메모리 `alarmAt`, 생성자에서 `getAlarm()`으로 채움) `max(now, Date.now()) + 15분`으로 하나를 둔다. `alarm()`은 청소 뒤 flow·session·denied가 남아 있으면 1시간 뒤로 다시 예약한다. 청소 순서는 flow → (revoke 30일·만료 세션의) refresh → session → 만료 refresh → denied 30일 → denied 200행 → audit 500행이고, 모두 멱등이다. denied 상한은 INSERT 때도 적용한다(청소 사이에도 표 크기가 묶인다). 같은 채널의 거부 횟수는 1시간에 최대 1회만 센다(쓰기 절약의 대가로 근사값).
23. **W4가 이어받을 것.** 확인 페이지 GET은 `loginPage`가 null이면 404, `status ≠ started`인 POST는 `continueApp`의 `already_used` → 409다. 콜백은 `consume`(`not_found`·`binder` → `r=failed`) → code가 없으면 `finish(cancelled)`, 있으면 교환 → `finish(user|failed)`. `finish`의 `gone`도 `r=failed`다. poll의 `too_soon` → 429, `not_found` → 404다. `startApp`의 `rate_limited` → 429 + `Retry-After: retryAfterSec`, `busy` → 503이다. 해시는 `sha256Hex`(state·binder·handle·access·refresh·쿠키), pollVerifier는 `sha256B64url(pollSecret)`이다. RPC 진입은 `env.AUTH.get(env.AUTH.idFromName(AUTH_STORE_NAME))`다. `rotate`의 `rate_limited`(구현 중 변경 24) → 429 + `Retry-After: retryAfterSec`(앱은 §11.3대로 네트워크 계열로 본다). **채널 이름 둘**: `CheckResult`·`WebCheckResult`의 `channelId`는 로그인 채널(`session.channel_id`)이고 `ownerChannelId`가 따로 있다. 토큰 묶음(`TokenBundle.channelId`)과 `/api/me`의 `channelId`는 본인 판정용 `ownerChannelId`다. `revokeMine`·`mySessions`와 감사 `actor`에는 `CheckResult.channelId`(로그인 채널)를 넘긴다(`ownerChannelId`를 넘기면 owner가 다른 채널에서 자기 세션이 안 보이고 끊기가 조용히 false다). **완료 페이지와 claim의 경합(W4가 정한다)**: `claim`이 ok를 돌려줄 때 flow 행을 지운다(§7.1 1회 수령). 그런데 `doneView`는 같은 행을 `binder_hash`로 찾아 확인 코드를 다시 보인다(§4.1·§7.1). 앱은 2초마다 폴링하므로 콜백의 303과 브라우저의 `GET /auth/done` 사이에 claim이 끼면 완료 페이지는 코드 없는 일반 문구가 된다. 고칠 길 하나: claim(ok)에서 행을 지우지 않고 `poll_verifier`·`session_id`를 NULL로 바꿔 다시 수령을 막고, 행은 만료까지 `doneView`용으로 둔다(UPDATE 1~2행이라 19 (마)의 계산은 거의 같다). W4가 완료 페이지 문구와 함께 정하고 테스트로 묶는다.
24. **허용된 채널 하나가 회전으로 DO 쓰기 한도를 다 쓰지 못하게 한다(§5.2에 더한다, W3 리뷰).** 회전 1회는 8행(아래 인덱스 포함)이라 상한이 없으면 허용 사용자(악의·감염 PC) 하나 또는 refresh를 훔친 사람이 `/auth/refresh` 약 12,500번(요청 한도 10만의 13%)으로 그날의 DO 쓰기 10만 행을 다 쓰고, 로그인·관리·폐기가 모두 실패한다. 응답 유실 복구도 60초 창 안에서는 같은 부모로 몇 번이고 되풀이된다(복구마다 새 active 자식). (가) **채널별 고정 창**: DO 메모리의 `throttle` 맵(start와 같은 순수 함수, 키는 `session.channel_id`)으로 채널당 10분에 `ROTATE_RATE_10M = 10`번까지 회전·복구를 받는다. 넘으면 `{ ok: false, code: "rate_limited", retryAfterSec }`이고 아무것도 쓰지 않는다(Worker 429 + `Retry-After`). 앱은 시작 때와 24시간마다 한 번, 응답 유실에 1회 재시도하므로(§11.3) 기기 몇 대가 짧게 여러 번 재시작해도 남는다. 세션당 최소 간격(예: 60초)은 쓰지 않았다: 앱이 시작마다 refresh하므로 빠른 재시작이 429가 되고, 복구 되풀이는 막지 못한다. (나) 게이트는 만료·폐기·허용 판정 **뒤**, 쓰기가 생기는 성공 두 경로(active 회전·복구)의 쓰기 직전에만 센다. 허용에서 빠진 채널은 429가 아니라 403 `not_allowed`를 받고, **재사용 감지(폐기)는 막지 않는다**(보안 사건이고, 한 번 폐기되면 다음부터 revoked 행이라 쓰지 않는다). (다) 남는 위험: 남용 채널 하나는 하루 최대 10 × 144 × 10행(복구) ≈ 14,400행을 쓴다. 공격자 흐름(≈55,300)과 정상 사용을 더해도 10만 아래지만, **남용하는 허용 채널이 셋 이상이면 넘을 수 있다**(허용목록은 관리자가 고른 사람들이라 받아들인다. 관리 화면의 활성 세션·복구 횟수가 단서다). 상한에 걸린 요청이 응답 유실 재시도였다면 앱은 오프라인 유예로 1분 뒤 다시 시도하고, 그때는 60초 창 밖이라 재사용으로 폐기된다(채널이 이미 상한을 넘은 비정상 상황에서만이고, 탈취자는 원래 폐기를 일으킬 수 있다). 맵은 DO가 쫓겨나면 비워진다(한 번 더 몰아 쓸 수 있을 뿐이고, 계속 부르는 공격자는 DO를 살려 둔다). (라) **`refresh(expires_at)` 인덱스를 v1에 더했다**(배포 전이라 v1을 고친다. 마이그레이션 더하기만 규칙은 배포 뒤부터). 청소의 `DELETE FROM refresh WHERE expires_at <= ?`가 매시간 표 전체를 훑지 않게 한다(used 행은 30일 뒤에야 지워진다. 상한이 없으면 하루 1.4만 행 × 30일 ≈ 43만 행 × 24회 ≈ 하루 1,000만 읽기 > 500만이고, (가)의 상한 안에서도 남용 채널마다 10 × 144 × 30 ≈ 4.3만 행 × 24회 ≈ 100만 읽기다). 대가로 refresh INSERT마다 1행을 더 쓴다(회전 7 → 8행, 로그인 claim +1). 테스트: `test/store/sessions.test.ts` G1(상한·쓰기 0·다른 채널은 따로·창이 지나면 다시 열림)·G2(복구도 센다, 상한이 차도 60초 뒤 옛 부모는 재사용 폐기).
25. **복구 때 옛 자식 refresh를 지우는 규칙을 유지한다(§5.2 `used` 행, W3 적대적 리뷰 기각).** 지적: 60초 창 안에서 부모가 다시 오면 활성 자식을 지우고 access를 새 쌍으로 덮으므로, 첫 응답이 유실이 아니라 **지연**이었으면 앱이 첫 쌍을 저장한 뒤 다음 요청에서 `invalid_token`이 되고 첫 자식도 없어 재로그인으로 떨어진다는 것. 기각 근거: (가) **앱 계약(§11.3)에서 그 순서는 생기지 않는다.** refresh는 single-flight이고 같은 부모로 다시 보내는 때는 앞 요청이 네트워크 계열로 **실패**한 뒤뿐이다(10초 시간 초과·연결 오류). 실패한 요청은 클라이언트가 연결(HTTP/1.1)이나 스트림(HTTP/2 RST)을 끊으므로 그 응답은 뒤늦게 도착할 수 없고, 앱이 응답을 받았다면 저장하고 재시도하지 않는다(§5.2 "원자적으로 쓴 뒤에 상태를 바꾼다"). 서버 커밋 뒤 로컬 쓰기 전에 앱이 죽은 경우도 첫 쌍은 저장된 적이 없다. 즉 "첫 쌍을 저장한 뒤 재시도"는 앱 인스턴스가 둘(설계 밖)일 때만이고, 그때의 피해는 그 한쪽의 재로그인 1회다. (나) **제안한 대안은 모두 더 나쁘다.** 멱등 키·원래 응답 재반환은 토큰 원문을 서버에 두어야 한다(해시만 저장 규칙 §2·§5 위반). 옛 자식을 지우지 않고 둘 다 살리면 탈취자가 먼저 쓴 자식이 피해자의 복구 뒤에도 유효한 채 남아 §5.2의 "60초 안이라도 그쪽으로 닫힌다" 성질이 깨지고, 활성 자식이 둘이면 재사용 판정("자식이 `active`")도 둘을 좇아야 해서 행과 읽기가 는다(구현 중 변경 19 (마)·24의 행 수 상한). 이전 access 해시를 유예 동안 함께 받는 것도 세션 행에 열을 더하고 같은 두 계보 문제를 남긴다. (다) 대신 **지연된 쌍이 돌아와도 다른 쪽을 해치지 않음**을 테스트로 묶는다: `test/store/sessions.test.ts` R7b — 복구 뒤 첫 쌍의 access는 `invalid_token`, refresh는 행이 없어 `session_expired`(쓰기 0, **폐기 없음**), 세션은 `active`이고 재시도 쌍의 check·rotate는 그대로 된다. 첫 쌍을 든 쪽은 §11.3대로 재로그인 1회로 끝난다.
26. **W4 실측(wrangler 4.147.0·vitest-plugin 1.3.6, 2026-10-06, 임시 사본).** (가) 핸들러가 부른 전역 `fetch`를 테스트의 `vi.spyOn(globalThis, "fetch")`가 가로챈다(`exports.default.fetch` 경로와 `worker.fetch(req, env)` 직접 호출 모두). 스파이가 없으면 workerd는 `Error: Network connection lost.`다. 스파이가 미리 만든 Response 하나를 되돌려주면 다른 요청 맥락의 I/O 객체라 핸들러가 500이므로, 가짜 치지직은 호출마다 새 Response를 만든다. (나) `exports.default.fetch`는 기본으로 3xx를 따라간다. 흐름 테스트는 `redirect: "manual"`이고, `getSetCookie()`가 Set-Cookie를 배열로 준다. (다) `vi.useFakeTimers({toFake:["Date"]})`의 시각이 핸들러 `Date.now()`(`ctx.now`)에도 적용된다(17 (나)는 DO 안). (라) 테스트 요청의 `Origin`(`null` 포함)·`Cookie`·`Sec-Fetch-Site`·`CF-Connecting-IP`는 그대로 도착한다. (마) `Object.keys(env)`는 vitest에서 설정 키 + `AUTH`·`DIST` + `__VITEST_POOL_WORKERS_*` 4개(object)이고, `wrangler dev --env-file .dev.vars.example`에서는 문자열 바인딩이 설정 키뿐이다(wrangler가 끼워 넣는 문자열 없음). (바) **R6 해소**: wrangler dev는 클라이언트가 준 `CF-Connecting-IP`를 그대로 넘기고, 없으면 `127.0.0.1`이다(W7은 헤더로 IP를 나눌 수 있다). msw 미처리 요청 옵션은 msw를 쓰지 않아 해당 없다(27 (나)). (사) `test/x.mjs` + `test/x.d.mts`면 tsc 7이 선언으로 타입을 검사하고 vitest가 import한다. (아) 구현 중 추가 실측: DO 저장소는 테스트 파일마다 따로이고(다른 파일이 쓴 행이 보이지 않는다) 같은 파일의 테스트끼리는 공유한다. 그래서 http 테스트는 `useClock()`이 테스트마다 기준 시각을 한 시간씩 옮겨 흐름 상한(32)·폴링 간격·회전 상한이 새지 않게 하고, `viaEnv`의 `{...env, ...patch}`는 DO 바인딩을 그대로 옮겨 같은 DO를 부른다.
27. **W4 OAuth 흐름에서 정한 것(§4.1·§4.2·§7·§12.1·§10.2와 12 (라)(마)·23을 정한다).** (가) **23의 결정**: claim이 ok를 돌려줄 때 flow 행을 지우지 않고 `poll_verifier`·`session_id`를 NULL로 바꾼다(UPDATE 1행, 인덱스 열 아님). 다시 수령은 not_found이고, 행은 만료까지 남아 `doneView`가 확인 코드를 다시 보인다. activate가 실패한 경우(gone·not_allowed)는 그대로 지운다. 대가로 수령한 흐름이 만료(종결 뒤 최소 2분)까지 상한 32슬롯을 차지하고, 청소가 1행을 더 쓴다. 앱 로그인 한 번은 실측 27행이다(start 5 + [계속] 2 + consume 2 + finish 8 + claim 9 + 청소 1, `flows.test.ts` "행 수 상한", 19 (마)의 ≈25를 바꾼다. 합계 61,000은 거의 같다). (나) **가짜 치지직 연결은 msw가 아니라 `vi.spyOn(globalThis, "fetch")`다**(§12.1을 바꾼다, 26 (가)). devDependency·lockfile 변경이 없고 `minimumReleaseAge`도 걸리지 않는다. `test/network.ts`의 `installFakeChzzk`가 `127.0.0.1:8788` 밖의 요청을 기록하고, http 테스트마다 `afterEach`가 0건을 단언한다. 가짜는 `test/fake-chzzk.mjs`(순수 `handle`, W7 node:http 래퍼가 그대로 쓴다) + `.d.mts`. 시간 초과는 기다리지 않고 `DOMException TimeoutError`를 바로 던진다. dependabot의 `msw` 그룹은 맞는 패키지가 없어 남겨 둔다. (다) **`CHZZK_REDIRECT_URI`는 `CONFIG_KEYS`에 넣는다**(코드가 읽고 검증한다). dev 모드는 `DEV_REDIRECT_URI = "http://localhost:8787" + CALLBACK_PATH`와 바이트가 같아야 하고(없음·빈 값·다름 → `config_error{CHZZK_REDIRECT_URI}`), 운영 모드는 있으면 오류다. 상수를 `CALLBACK_PATH`로 만들어 코드의 콜백 경로가 바뀌면 등록 값과 어긋나 드러난다. `PUBLIC_ORIGIN + CALLBACK_PATH`와 같다는 조건은 두지 않는다(루프백 다른 출처의 dev 사례를 그대로 둔다). `.dev.vars.example`에 `CHZZK_REDIRECT_URI=http://localhost:8787/auth/callback`(§10.2에 더한다). (라) **dev 모드의 모르는 문자열 바인딩**(12 (라) ②): 출처 판정 바로 뒤에 `CONFIG_KEYS` 밖의 문자열 키가 있으면 이름 정렬의 첫 키로 `config_error`다. 이름이 `^[A-Za-z_][A-Za-z0-9_]{0,63}$`가 아니면 `(invalid_key_name)`이다. 값은 결과·로그에 없고, object 바인딩(DO·R2·vitest 내부)은 보지 않는다. `ConfigResult.key`는 `string`이다. (마) **경로 `:param`**: 조각 수가 같아야 하고 `:name`은 비지 않은 조각 하나다(디코드하지 않음, 값 검사는 핸들러). 405 `Allow`는 그 경로에 맞는 행들의 메서드다. (바) **자격이 없을 때**(§4.2와 §4.5를 함께): JSON이 아니거나 깨졌거나 객체가 아니면 400 `bad_request`, 토큰이 없거나 형식이 틀리면(다른 접두 포함) 401 `invalid_token`. logout은 형식이 맞는 자격이 하나라도 있으면 204(세션이 없어도), 없으면 401이다. poll의 형식 오류는 400, 맞는 형식의 모름·불일치는 404. (사) **허용 제외와 끊기**(16 W4 "허용 제외 → 403 + access 401"을 20 (가)로 읽는다): disallow는 me·refresh 모두 403 `not_allowed`, 관리자 [끊기]는 둘 다 401 `session_revoked`. (아) **HTML(W4 최소)**: `src/http/pages.ts`·`copy.ts`, `raw()` 없음. 확인 페이지 폼은 action 없는 `<form method="post">`라 handle이 본문에 나오지 않는다. `/auth/login/*`·`/auth/web/start`의 403·404·409·429·503은 HTML 안내 페이지이고 429는 `Retry-After`를 붙인다. 치지직으로 가는 303과 콜백 303은 `Referrer-Policy: no-referrer`. 스타일시트·`page()` 확장은 W6. GET 확인 페이지는 `status ≠ started`면 409. 콜백은 `code`가 없거나 빈 값이면 취소, `^[!-~]{1,1024}$` 밖이면 failed. 시각은 `toISOString()`. done은 F 쿠키가 있으면 형식과 무관하게 지운다. (자) **바깥 요청은 `src/http/auth.ts`의 `(url, init) => fetch(url, init)` 한 곳이다**(호출 때 전역을 찾아야 스파이가 보인다). `worker-config.mjs checkOutbound`가 고정한다(cicd.md 92). (차) **폴링 간격 기록은 틀린 pollSecret의 요청에도 남는다**(`pollGate`는 loginId만 보고 SQL 앞에서 돈다, 19). 그래서 틀린 secret으로 폴링한 직후의 올바른 폴링도 1.5초 안이면 429 `too_soon`이다(공격자가 loginId를 알아도 폴링 간격만 늘릴 뿐 secret이 없으면 읽을 수 없다). 테스트는 사이에 `advance`를 둔다. (카) **http 테스트의 한계**: "쓴 code를 다른 흐름에 다시 쓰면 failed" http 테스트는 가짜 치지직이 state 불일치를 먼저 보므로 code 재사용 거부 자체를 증명하지 않는다(재사용 거부는 `unit/fake-chzzk.test.ts`가 가짜 쪽에서, 실제 치지직의 동작은 G-ID·실서버 스모크 몫이다). Worker 쪽 보증은 "교환 실패 → failed(token)"이다.
28. **W4 리뷰 반영(27을 고친다).** (가) **27 (자)를 바꾼다**: `checkOutbound`는 `fetch(` 모양이 아니라 **낱말 `fetch`**를 센다(별칭·`bind`·`call`·축약형 속성 `{ fetch }`·`(0, fetch)`·`fetch?.(`·삼항 모두 1개). 빼는 것은 메서드 호출 `deps.fetch`와 같은 줄의 속성 키(`fetch:`·`fetch?:`)뿐이다. `globalThis`·`self`·`Reflect`·`Function`·`eval`·동적 `import(`·`WebSocket`·`cloudflare:sockets`는 `src/**` 어디에도 두지 않는다(주석 포함). 남는 한계와 씨앗은 cicd.md 93. (나) **27 (카)를 바꾼다**: 가짜 치지직에 `codeBinding` 스위치(기본 `state`: code는 발급 때의 state와 함께만 바뀐다, `none`: state를 보지 않는다)를 더했다. http 테스트는 `none`에서 흐름 1의 code를 흐름 2의 콜백에 싣고 `codeReuse` `allow` → ok, `reject` → `failed(token)`인 대조 쌍과 token 호출 2회를 단언한다. 그래서 Worker가 code를 그대로 교환에 넘기고 교환 실패를 `failed(token)`으로 닫는다는 것은 http에서 고정된다. 실제 치지직이 code를 state에 묶는지·재사용을 거부하는지는 그대로 실서버 몫이다. (다) **27 (차)를 바꾼다(그 설명은 틀렸다)**: 폴링 게이트 키가 loginId뿐이면 loginId를 아는 쪽이 1.5초마다 틀린 secret으로 폴링해 앱의 2초 간격 폴링을 늘 429로 만들고 만료까지 수령을 굶길 수 있었다(실제로 막던 것은 loginId가 앱 메모리에만 있다는 것, §6.1). **키를 `loginId + ":" + pollVerifier`로 바꾼다**(`pollGateKey`). 틀린 secret은 다른 키라 올바른 폴링에 영향이 없다. 읽기 예산은 같다: 무작위 loginId도 매번 새 키였으므로 공격자의 SQL 읽기 상한은 전과 같고, 맵은 그대로 4096개로 묶인다. (라) **27 (아)의 "done은 F 쿠키가 있으면 형식과 무관하게 지운다"를 구현에 맞춘다**: 이전 구현은 형식이 맞는 값 하나일 때만 지웠다. 이제 그 이름의 쿠키가 하나라도 있으면(형식 밖 값·빈 값·중복 포함, `hasCookieName`) 지운다. (마) **27 (가)를 바꾼다**: claim ok의 UPDATE가 `expires_at = min(expires_at, now + 2분)`도 한다(앞당기기만). 수령한 흐름이 start+10분까지 상한 32를 잡아 정상 로그인이 10분당 32회로 묶이던 것을 푼다. 19 (다)가 만료를 앞당기지 않는 이유(콜백까지만 하는 흐름의 순환)는 허용 채널의 실제 로그인이 끝난 claim ok에는 해당하지 않는다. 완료 페이지의 확인 코드 재표시는 2분 안이다(콜백 303 → done GET은 수 초). 대가로 `expires_at`(인덱스 열)을 바꿔 claim이 9 → 10행이고 앱 로그인 한 번은 실측 **28행**이다(27 (가)의 27행을 바꾼다. 합계 계산은 거의 같다). (바) **콜백 처리 중 예외**: consume 뒤 구간(code 검사·교환·finish)이 던지면 `finish(failed, user)`를 한 번 더 시도하고 303 `r=failed`다(이미 닫혔으면 `gone`이라 아무것도 바꾸지 않고, 이것도 실패하면 원래 예외 이름만 로그에). 이전에는 흐름이 `exchanging`에 남아 앱이 만료까지 pending만 봤다. 내부 오류 전용 실패 코드를 새로 만들지 않은 것은 앱 DTO가 바뀌어서다(`user`의 안내는 "다시 시도"와 같다). (사) **27 (바)를 바꾼다: 본문은 상한 4096바이트까지만 읽는다.** Content-Length가 상한을 넘거나 숫자가 아니면 읽지 않고 400, 길이를 모르는 스트림은 바이트를 세다 넘는 순간 `cancel()`이다. JSON이 아닌 Content-Type은 빈 본문인지만 본다(상한 0, logout의 빈 본문 허용은 그대로). 올바르지 않은 UTF-8은 400이다. 이전에는 `req.text()`로 전부 읽은 뒤 길이를 봤다. (아) 웹 start의 Origin 거절 로그는 `auth.start.rejected{flowKind: web, reason: bad_origin}`이다([계속]의 `auth.continue.rejected`와 구별). (자) **hygiene는 실패 경로도 돈다**(§14 "모든 흐름·실패 경로"): 콜백 `code_format`(1024자를 넘는 code 카나리)·콜백 내부 예외, [계속] 403·404·409, 웹 start 403·429, start 400·429, poll 400·404·429, me 401·403, refresh 400·401·429·403, logout 401. 그 로그 이벤트가 실제로 남았는지도 단언한다. (차) **인증 없는 DO 경로(검토 결과 코드는 바꾸지 않는다)**: `/auth/login/:handle` GET·POST, `/auth/done`(형식 맞는 F), `/auth/poll`, `/api/me`·`/auth/refresh`·`/auth/logout`(형식 맞는 토큰)은 형식 검사 뒤 DO RPC 하나를 부른다(IP 스로틀은 start 둘에만). 이 경로들은 Worker 요청 하나가 DO 요청 하나 이하라(콜백은 consume·finish로 둘, 예외 복구 때 셋이지만 state가 맞아야 한다) DO 쪽 요청 수가 Worker 요청 수보다 빨리 늘지 않고, 이 요청 수 소진은 11 (아)가 이미 받아들인 위험이다(WAF 요청 수 규칙은 11 (나)로 쓸 수 없다). W9 뒤 사용량 확인 때 이 경로들의 요청 수를 함께 본다.
29. **Codex 적대적 리뷰(W4) "PKCE 없이 code를 아무 흐름에나 받는다"는 코드로 막지 않고 W9 실측으로 넘긴다.** 치지직은 PKCE(`code_challenge`·`code_verifier`)를 받지 않는다(`docs/research/chzzk-oauth.md` §7). 그래서 Worker가 할 수 있는 로컬 증명은 이미 있는 것뿐이다: `state` 일회용, 시작한 브라우저의 F 쿠키 binder(27), 토큰 교환에 그 흐름의 `state`를 함께 보냄(§7.3). 남는 가정은 "치지직이 code를 발급한 `state`·한 번 사용에 묶는다"이고, 깨지면 피해자의 콜백 code를 가로챈 공격자가 자기 흐름으로 교환할 수 있다(가짜 치지직 `codeBinding: "none"`·`codeReuse: "allow"` 사례가 그 결과를 보인다). 가로채기 자체는 등록된 https 리디렉션과 Worker 콜백(code는 브라우저 주소창·Worker에만 지나감)으로 좁다. **W9에서 사용자와 로컬 테스트 앱(`pnpm dev:real`)으로 두 가지를 한 번 실측한다**: ① 흐름 A에서 받은 code를 흐름 B의 `state`로 교환 → 거부되는가, ② 같은 code 두 번째 교환 → 거부되는가. 결과는 "거부/수락"만 적는다. 수락이면 그때 대응(교환 전 code를 흐름에 묶는 다른 길, 또는 위험 수용)을 사용자와 정한다. 공개 CI에는 실서버 자격이 없으므로 이 확인을 CI gate로 두지 않는다.
30. **W5 실측(wrangler 4.147.0·vitest-plugin 1.3.6·miniflare R2, 2026-10-06, 임시 사본, §9.2·구현 중 변경 16 (다)의 [확인 필요]).** (가) `DIST.get(key, { range: Headers{Range} })`는 만족 가능한 단일 범위면 그 범위를 `obj.range = {offset,length}`로 주고, 만족 불가(시작 ≥ 크기)·`bytes=-0`·역순·다중 범위면 **던지지 않고 전체**(`{0,size}`)를 준다. 끝이 크기를 넘으면 자르고, suffix가 크기 이상이면 전체다. R2는 `BYTES=`·`bytes= 0-9`처럼 `core/range.ts`가 무시하는 모양도 받으므로 요청 헤더를 그대로 넘기지 않는다. 객체 형태 range(`{offset:2000}`·`{suffix:0}`)는 `10039 not satisfiable`을 던진다. (나) `onlyIf: Headers{If-None-Match}`는 형식이 틀린 값에서 던진다(`Invalid ETag`). (다) 없는 키의 `head`·`get`(range 유무와 무관)은 null이다. (라) `exports.default.fetch`와 `withCommonHeaders` 재포장을 지나도 GET 스트림의 `Content-Length`, HEAD null 본문의 명시 `Content-Length`, 206의 범위 길이가 유지된다. GET에 null 본문 + `Content-Length`를 주면 빈 본문에 거짓 길이가 그대로 나가므로 본문은 HEAD일 때만 비운다. (마) `exports.default.fetch` 경로와 테스트의 직접 import는 같은 모듈 인스턴스다(isolate 캐시를 테스트가 비울 수 있다). `worker.fetch(req, {...env, DIST: 평범한 객체})`로 R2 호출을 셀 수 있다. (바) 운영 R2에서 (가)의 만족 불가 동작, `obj.range`의 모양, 재포장 스트림의 `Content-Length`는 미실측이다(32).
31. **W5 R2 게이트·updater·CI 토큰에서 정한 것(§4.3·§4.5·§9.1~9.3, 구현 중 변경 14·16 (다)를 정한다).** (가) **판정 순서는 문법 → 자격 → 정책 → R2**다. 문법 오류(`bad_key`·`bad_version`)는 자격과 무관하게 400이고 DO·R2를 부르지 않는다(공개 정규식이라 숨길 것이 없고 쓰레기 요청이 DO 요청을 쓰지 않는다). URL이 먼저 정규화하는 점 조각(`..`·`%2e%2e`)은 정규화된 경로로 정책과 키를 함께 정하므로 우회가 아니다. (나) **`releaseAuth(req, ctx, allowWeb)`**(`src/http/release-auth.ts`): `Authorization`이 있으면 그것만 본다(쿠키 무시). Bearer 모양이 아니면 401 `invalid_token`. CI 토큰과 `safeEqual`(SHA-256 뒤 `timingSafeEqual`)을 **형식 검사보다 먼저** 하고(모든 Bearer가 같은 비교를 거친다), 아니면 `cda_`만 `check`로 간다. 헤더가 없을 때만 `/releases`에서 웹 쿠키(`cdw_` 형식일 때만 `webCheck`)를 본다. `/update`는 웹 불가(401). 거절 코드는 `/api/me`와 같고(`invalid_token`·`session_revoked` 401, `not_allowed` 403) 로그는 `release.auth.rejected{route, reason}`. `CI_VERIFY_TOKEN`이 빈 dev 설정에서는 CI 자격이 없다. (다) **Range(16 (다)의 결정)**: `core/range.ts`가 인정한 spec만 `rangeHeader(spec)`로 정규화한 `Range` 하나를 새 `Headers`에 담아 `get` 한 번. `resolveRange(spec, obj.size)`가 만족 불가면 본문을 취소하고 416 `range_not_satisfiable` + `Content-Range: bytes */size`. 만족이면 `normalizeR2Range(obj.range, size)`(`undefined`·`{suffix}`·`{offset}`·`{length}`을 `{offset,length}`로)와 대조해 다르면 500 `internal`(`release.range_mismatch`). 운영 R2가 범위 요청에서 `10039`·`not satisfiable` 오류를 던지면 416(크기를 모르므로 `Content-Range` 없음, 세 번째 R2 호출 없음, `release.range_error`). `head`는 부르지 않는다. (라) **조건부**: `If-None-Match`는 R2 `onlyIf`에 넘기지 않고 `core/conditional.ts` `ifNoneMatchHit`(약한 비교, `*`, 1024자 상한, 형식 오류 조각 무시)로 Worker가 비교한다(30 (나)). Range보다 먼저 보고 304에는 `ETag`·`Cache-Control`만 둔다(§9.2의 "`onlyIf`로"를 바꾼다). 릴리스 읽기의 3xx는 이 304뿐이다(리디렉션 0건: 테스트는 304를 뺀 3xx가 0건임을 단언한다). (마) **HEAD**는 `DIST.head` 한 번이고 Range를 무시한다(Range는 GET에만 정의된다). 모든 HEAD 응답은 본문이 없다. (바) **R2 호출 수(11 (라))**: CI = 파일 1회. A·W = `SHA256SUMS`(isolate `Lru` 8, 버전 키) + 파일, 캐시 적중이면 1회. 거절(400·401·403·`previous`·`latest.json`)은 0~1회. `/update` = 1회. R2에 없는 SUMS는 캐시하지 않고(업로드 중일 수 있다), 해석 실패와 64KiB 초과는 영구(객체가 불변)라 캐시해 META만 보인다. `test/http/r2-calls.test.ts`가 40행으로 고정한다. (사) **`/update`**: `latest.json`이 64KiB를 넘으면 해석하지 않고 500 `internal`(`release.latest_invalid`). 200 응답은 `Content-Type: application/json`·`Content-Length`·`Cache-Control: private, no-store, no-transform`. (아) **경로 표**: 패턴 끝 `/**`는 앞부분 뒤의 비지 않은 나머지와 맞는다(조각 수 무관). 행은 `GET /update/:current`(`auth: "update"` = A·CI), `GET·HEAD /releases/**`(`auth: "release"` = A·W·CI). `/releases/` 밑의 모든 경로가 handler에 와서 문법 400을 받는다. (자) **헤더 표**(`core/keys.ts`): `.json` → `application/json`·inline, `SHA256SUMS` → `text/plain; charset=utf-8`·inline, `previous`·`.sig` → `text/plain; charset=utf-8`·attachment, 그 밖 `application/octet-stream`·`attachment; filename="<f>"`. `ETag: httpEtag`, `Accept-Ranges: bytes`, `Content-Encoding` 없음. (차) **R2는 `src/http/r2.ts` 한 곳**(`Pick<R2Bucket,"get"|"head">`, 창구는 `get(key, spec|null)`·`head(key)`). 정적 검사(cicd.md 94): 낱말 `ciVerifyToken`은 config.ts·release-auth.ts, `releaseAuth`는 release-auth.ts·releases.ts·update.ts, R2 바인딩 이름은 r2.ts 1회. `src/**`에 `.put(`·`.list(`·멀티파트 없음, 릴리스 네 파일에 `.delete(`·`Location`·`redirect` 없음. §4.5의 "`CI_VERIFY_TOKEN` 문자열" 검사만으로는 설정 필드 `ciVerifyToken`을 어디서나 읽을 수 있었다. (카) **합성 릴리스는 `test/seed-release.mjs`**(§3 트리 그대로, node:* 없는 순수 모듈이라 vitest와 W7 Node가 함께 쓴다). 매니페스트는 스키마를 통과하고(테스트가 `latest.schema.json`의 패턴으로 확인) url 접두는 자리표시 `https://worker.example.test`, 서명은 합성 base64다(xtask 서명 검증은 통과하지 않는다. W7 node 클라이언트는 xtask와 같은 상태 규칙만 본다). (타) **행렬(§4.5)은 이 시점 경로 14쌍**이다. 표 키 = 경로 표, 자격 종류는 `never`로 끝나는 `switch`로 전수 처리한다. "CI 해석 경로 = `{GET·HEAD /releases/**, GET /update/:current}`"는 표에서 계산해 단언하고, 그 밖의 행에서 CI 상태 = 쓰레기 Bearer 상태다. W6이 `/admin*`·`/me/*`·`/`·`/auth/web/logout`을 더한다.
32. **W5에서 남긴 것(W6·W9).** (가) **W9 실배포 확인에 더한다**: ① 만족 불가 Range가 실제 R2에서도 전체를 주는지(던지면 31 (다)대로 416, `Content-Range` 없음), ② `obj.range`의 모양, ③ GET 200·206 스트림과 HEAD의 `Content-Length`가 `withCommonHeaders` 재포장 뒤에도 유지되는지(빠지면 `FixedLengthStream(size)`로 본문을 감싼다), ④ `no-transform`으로 Cloudflare가 `.json`·`text/plain`을 압축하지 않는지(`Content-Encoding` 없음). (나) **W6 랜딩의 파일 크기**: §9.5의 "크기(R2 head)"를 파일마다 하면 랜딩 요청 하나가 head 6회 + SUMS·latest 읽기로 11 (라)의 2회를 넘는다. W6은 크기를 빼거나, R2 호출 없이 얻을 수 있는 곳에서만 보이거나, 버전별 isolate 캐시 + 요청당 2회 상한 안에서 채우는 길을 정하고 r2-calls 표에 `/` 행을 더한다. (다) deploy-worker 음성 검사 중 `/admin`(CI 토큰 → 303)은 경로가 생기는 W6에서 `update.test.ts` "deploy-worker 검사 계약"에 더한다.
33. **W5 리뷰 반영(31·32에 더한다).** (가) **31 (다)를 고친다: `normalizeR2Range`는 길이를 객체 끝에서 자른다**(`max(0, min(length ?? size - offset, size - offset))`). 운영 R2가 끝이 크기를 넘는 요청(`bytes=0-99999`, 크기 1024)에 요청 길이를 그대로 `obj.range = {offset:0,length:100000}`로 돌려주면 이전에는 판정 `{0,1024}`와 달라 500이었다(miniflare는 잘라서 준다, 30 (가). 운영 모양은 32 (가) ②로 미실측). R2 본문은 객체 크기를 넘을 수 없으므로 자른 값이 실제로 나가는 바이트와 같고, offset이 다르거나 길이가 짧으면 여전히 500 `release.range_mismatch`다. `unit/range.test.ts`(자르기 세 행)와 `http/releases.test.ts` "Range 방어"(206·`Content-Range: bytes 0-1023/1024`)가 고정한다. 32 (가) ②의 W9 확인은 그대로다. (나) **31 (바)의 R2 호출 수 표를 43행으로 늘린다**: HEAD 조건부(CI `HEAD + If-None-Match` → 304, head 1)·A·W `HEAD + Range`(Range 무시, SUMS get 1 + head 1 → 200)·A·W `HEAD + If-None-Match` 캐시 미스(get 1 + head 1 → 304). 코드는 바뀌지 않았다. (다) **R2 쓰기·list 정적 검사를 낱말 수로 바꾼다**(31 (차)를 고친다, cicd.md 95): `.list?.(`·`["list"](`·구조 분해·`typeof v?.list`가 `.list(` 모양 검사를 피해 갔다. (라) **28 (차)의 W9 사용량 확인 목록에 `/update/:current`와 `/releases/**`(A·W 자격)를 더한다**: `releaseAuth`가 A·W 자격마다 DO 읽기 RPC(`check`·`webCheck`) 1회를 부르고(행 쓰기 없음) R2를 1~2회 부른다. `/update`는 설치된 앱이 기동할 때마다 치므로 Worker·DO 요청 수에서 가장 큰 몫이 될 수 있다. 비용은 0이지만(DO Free 초과는 과금이 아니라 실패, 11) 가용성 위험(11 (아))의 계산에 이 경로가 들어간다. 코드는 바꾸지 않는다.
34. **W5 대체 리뷰 반영(30 (가)·31·33을 고친다. 기존 항목 본문은 그대로 두고 이 항목이 이긴다).** (가) **30 (가)의 예시에서 `BYTES=`를 뺀다**: `core/range.ts`는 단위를 대소문자 무시로 받으므로 무시하는 모양이 아니다. R2가 받지만 range.ts가 무시하는 모양은 `bytes= 0-9`(공백) 같은 것이다. 그래서 요청 헤더를 그대로 넘기지 않는다는 결론은 같다(`rangeHeader` 주석도 "공백 같은 비표준 모양"으로 고쳤다). (나) **R2가 10039를 던지는 range 경로는 조건부(If-None-Match)를 보지 못하고 416이 된다**: 객체를 받지 못해 ETag를 비교할 수 없다. 코드는 그대로 두고 `releases.ts` 주석과 `r2-calls` 44행(R2 호출 2회 이하)으로 고정한다. (다) **`/releases`·`/releases/`는 경로 표 밖이라 404**다(`/releases/:v/:f`·`/releases/latest.json`만 표에 있다). (라) **`ifNoneMatchHit`의 전제**: ETag 원천은 R2 httpEtag(hex 또는 hex-N)라 따옴표 안에 쉼표가 없다. 틀리면 쉼표 분할이 어긋나 200 쪽(적중 안 함)으로 닫힌다. (마) `r2-calls` 표에 SHA256SUMS 캐시 규칙 시험 셋을 더했다(31 (바): 없음은 캐시하지 않음·해석 실패 캐시·64KiB 초과 META만 보임). `scripts/ci/worker-config.mjs`의 Location·redirect 검사는 부분 문자열이 아니라 낱말 경계로 센다(`allocation`은 통과).

35. **W8 실측: §13.4 [확인 필요] (가)(나)와 R6 일부(wrangler 4.147.0, pnpm 12.9.1, 2026-10-07, 임시 사본·로컬 API 스텁).**
(가) `deploy --no-bundle -c dist/wrangler.json --var PUBLIC_ORIGIN:… --var BUILD_ID:…`를 `CLOUDFLARE_API_BASE_URL`의 로컬 스텁에 배포했다. 업로드 metadata: `main_module:"index.js"`, `plain_text` 넷(운영 치지직 주소 둘, `PUBLIC_ORIGIN` 전체 값, `BUILD_ID`), `durable_object_namespace AUTH→AuthStore`, `r2_bucket DIST`, `exports.AuthStore{durable-object, sqlite}`, `keep_bindings[secret_text, secret_key]`(사용자가 `wrangler secret put`으로 넣은 Worker secret이 유지된다), `observability`(invocation_logs false). 업로드 파트는 `index.js` 하나다. Cloudflare가 실제로 받는지는 R5대로 W9 첫 배포에서 본다. (나) **`dist/wrangler.json`의 `main`은 설정 파일 위치 기준이라 `index.js`다**(§10.1·§13.4·구현 중 변경 2의 `dist/index.js`를 바꾼다: `dist/index.js`는 `The entry-point file … was not found`). `$schema`(경로가 틀려도)는 남겨도 dry-run·스텁 배포 모두 통과한다. (다) `pnpm install --frozen-lockfile --ignore-scripts`로 깐 wrangler로 배포·dry-run이 된다. `--no-optional`은 안 된다(시작할 때 `@cloudflare/workerd-<플랫폼>`을 요구한다). 그래서 **묶음은 OS·arch 전용**이다(macOS arm64 기준 tgz 약 59MB, `deploy/node_modules` 약 205MB). 묶음을 다른 폴더에 풀어도 pnpm의 상대 심볼릭 링크 덕분에 `node deploy/node_modules/wrangler/bin/wrangler.js deploy --dry-run …`이 통과한다. (라) `worker/deploy/`는 `packages` 없는 `worker/pnpm-workspace.yaml`에 묶이지 않는다(worker lockfile·`pnpm check`·vitest 677·`pnpm build` 그대로). (마) 배포 API 순서는 `workers/services/<이름>` → `…/secrets` → `workers/subdomain` → `…/deployments` → `…/settings` → `r2/buckets/<이름>` → `PUT workers/scripts/<이름>?excludeScript=true&bindings_inherit=strict`(multipart) → workers.dev 설정이다. R2 조회는 숨은 자원 자동 생성(`--x-provision`, 기본 켜짐) 판정이다: 설정에 바인딩이 이미 있으면 조회하지 않고, 403이면 건너뛰며, 코드 10006(없음)일 때만 버킷을 만들려 한다. 버킷은 있고 토큰에 생성 권한이 없으므로 **§10.3 [확인 필요] "R2 바인딩 배포에 R2 권한이 더 필요한가"는 필요 없다로 닫는다**(실제 확인은 W9). 숨은 플래그는 쓰지 않는다. (바) DO 코드 갱신 기본값은 `code_update_strategy {mode:"deferred", max_delay:300}`다. 배포 직후 DO가 옛 코드를 최대 5분 더 돌 수 있다. 스키마는 더하기만 하고 앞선 스키마를 받아들이므로(21) 그대로 둔다. 배포 뒤 검사 경로는 DO를 부르지 않는다. W9의 DO 수동 확인은 이 지연을 감안한다. (사) wrangler deploy도 작업 폴더의 `.env`·`.env.local`을 찾는다(`.env file not found … Continuing`). 그래서 배포는 묶음을 푼 빈 새 임시 폴더에서 한다. (아) wrangler를 올리는 PR은 (가)~(바)를 다시 본다(`x-provision`·DO deferred는 숨은 기본값이라 판올림으로 바뀔 수 있다).

36. **`release.mjs worker` 검사와 가드(§9.4·cicd.md 81 (나)를 정한다).**
(가) `/health`는 200·`ok:true`이고 **`build` = 이번 `BUILD_ID`**(`GITHUB_SHA` 앞 7자)일 때까지 30초 간격으로 최대 5분 기다린다(0초부터 300초까지 검사 11번). 옛 Worker도 200이라 배포 반영을 가르지 못하기 때문이다. 기한이 넘도록 옛 build면 판정 실패(1), 5xx·네트워크면 기반 시설(2)이고, 503 `config_error`는 기다리지 않고 실패(1)다. (나) `/update/0.0.0` 본문은 배포 모드에서 S3로 읽은 `latest.json`과 **바이트 동일**해야 하고, `--check-only`에서는 `version`만 본다. (다) 음성 `/admin`은 200(2xx)만 실패다. 로그인 303이든 아직 없는 경로의 404든 통과다. 토큰 없는 `/releases/latest.json`과 CI 토큰의 `/api/me`는 401이어야 한다. (라) health가 판정 실패(503 `config_error`, 200이 아님, `ok`가 true가 아님)이거나 기한을 넘기면 **나머지 검사 없이 바로 끝난다**(Worker가 이번 빌드로 떠 있지 않으면 나머지는 의미가 없다). health를 지난 뒤에는 판정 실패가 하나라도 있으면 1(남은 검사는 계속 돌아 로그에 모두 남긴다), 없고 5xx·429·네트워크가 4회(2·4·8초 간격) 뒤에도 남으면 2다. 요청은 늘 `redirect: manual`이고 오류는 `cause.code`만 찍는다(메시지에 호스트가 들어간다). 로그에 base·토큰을 싣지 않는다. (마) **superseded 가드는 `VERIFY_VIA`와 상관없이 S3로 `latest.json`을 읽고 `verifyPlan`을 그대로 쓴다**(cicd.md 81 (나)의 "`VERIFY_VIA`와 같은 경로"를 바꾼다). S3가 `latest.json`의 원천이라 Worker 상태와 무관하게 판정하기 위해서다. 이 가드가 고장 난 Worker의 복구 경로는 아니다: deploy-worker의 `if:`에 상태 함수가 없어 needs(verify 포함)가 모두 성공해야만 돌고, `VERIFY_VIA=worker`에서 Worker가 고장 나면 verify가 1·2로 끝나 deploy-worker는 건너뛰어진다. 그때는 `VERIFY_VIA=s3`로 바꿔 다시 돌리거나 사람이 묶음의 wrangler로 직접 배포한다(§9.4 마지막 문단). R2 자격은 배포 토큰과 같은 Cloudflare 토큰에서 나와 deploy-worker에 더해도 노출 범위가 늘지 않는다. `latest`가 이번 버전과 같을 때만 배포하고(`not-promoted`는 1), 더 높으면 배포 없이 0이다. (바) wrangler 하위 프로세스에는 **허용 목록 env만** 넘긴다(`PATH`, 빈 임시 `HOME`·`XDG_CONFIG_HOME`(win32는 `USERPROFILE`·`SystemRoot`), `CI`, `WRANGLER_SEND_METRICS=false`, 배포 때만 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`). `CI_VERIFY_TOKEN`·R2 자격·`DIST_BASE_URL`·`GITHUB_*`는 넘기지 않고 `PUBLIC_ORIGIN` 값은 `--var` 인자로만 간다. 명령줄·실패 메시지에 인자를 싣지 않는다. 시작 때 `::add-mask::`로 호스트와 workers.dev 계정 서브도메인 조각(`<이름>.<조각>.workers.dev`의 4자 이상 조각)을 가린다. (사) §13.4가 deploy-worker env로 적은 `RELEASE_VERSION`·`BUILD_ID`는 **넣지 않는다**: `RELEASE_VERSION`은 tag 모드 경계가 거부하는 dry 전용 덮어쓰기라 넣으면 `begin`이 2로 끝난다(버전은 워크스페이스 버전 = 태그), `BUILD_ID`는 `GITHUB_SHA`에서 만든다. (아) **W5 코드와 대조했다(rebase 뒤).** release.mjs의 다섯 검사(§9.4 표)는 W5 동작과 상태 코드가 모두 맞았다: `/health` 200 `{ok, schema, build}`(설정 오류는 503 `config_error`), `/update/0.0.0`(CI) 200 + R2의 `latest.json` 바이트 그대로(배포 모드의 바이트 비교가 성립), `/update/<태그>` 204, 토큰 없는 `/releases/latest.json` 401 `invalid_token`, CI 토큰의 `/api/me` 401(앱 토큰 형식이 아니다). `/admin`은 W5에는 경로가 없어 404이고 W6부터 303이다(둘 다 통과). 어긋난 것은 selftest의 가짜 Worker(`worker-stub.mjs`)뿐이라 W5 규칙으로 고쳤다: 오류 본문 `unauthorized` → `invalid_token`, `/update/:v`는 semver가 아니면(디코드 실패 포함, 전에는 가짜 Worker가 예외로 죽었다) 자격보다 먼저 400 `bad_version`, 204·200은 문자열 일치가 아니라 semver 비교(latest > current만 200). **§9.4 표에 두 검사를 더한다**: CI 토큰의 `/releases/latest.json` → 200 + `latest.json`(배포 모드는 바이트 동일, `--check-only`는 `version`), 틀린 Bearer(`not-a-token`)의 `/update/0.0.0` → 401(CI 토큰 비교가 실제로 도는지). 그래서 검사는 health + 일곱이다. **계약 표는 `worker/test/deploy-contract.mjs` 하나다**(node:* 없는 순수 모듈 + `.d.mts`): `worker/test/http/update.test.ts`가 진짜 Worker로 모든 행을, `scripts/ci/release.test.mjs`가 `WORKER_CHECKS`(id·경로·자격) = deploy 행, 가짜 Worker가 모든 행(대조 행: 400 `bad_version` 둘·토큰 없음 401·latest보다 높은 current 204·틀린 Bearer의 latest.json 401), 그 응답의 `judgeCheck` = pass를 본다. 가짜 Worker·release.mjs는 이 표를 import하지 않는다(pre-push 경로 집합을 늘리지 않는다). `wrangler dev`에 `--check-only`를 실제로 돌리는 확인은 하지 않았다(로컬 R2가 비어 `/update/0.0.0`이 204이고, 포트 8787을 다른 worktree가 쓴다). 그 실측은 W7 E2E(합성 릴리스 씨앗)와 W9 첫 배포 몫이다. W6이 `/admin` 303을 만들면 `update.test.ts`의 "3xx 0건" afterEach가 계약 행 `neg-admin`에서 걸리므로 그 단언에서 이 행을 빼거나 303만 허용한다(32 (다)). (자) **`--check-only`의 인자는 `--base <출처> --version <semver> [--build <id>]`다**(§13.4·cicd.md 81 (나)의 `--check-only --base <url>`에 `--version`을 더한다). `--version`은 필수다: `/update/0.0.0`의 `version` 비교와 `/update/<v>` 204 판정에 쓴다(배포 모드는 워크스페이스 버전). `--build`는 선택이고, 없으면 health는 `build` 값과 상관없이 200·`ok:true`면 통과한다(배포 모드는 늘 `GITHUB_SHA` 앞 7자로 기다린다). `--base`는 경로 없는 https 출처이거나 루프백 http여야 한다. (차) **`WORKER_DEPLOY_ENABLED`는 저장소 변수다**(위 시크릿·변수 표의 환경 `release` 행에서 옮긴다, cicd.md §8·cicd.md 구현 중 변경 96 (아)): deploy-worker의 작업 수준 `if:`는 환경에 들어가기 전에 평가돼 환경 변수가 보이지 않는다. `VERIFY_VIA`는 verify 단계에서 읽으므로 환경 `release`에 그대로 둔다. (카) **W8 대체 리뷰 반영: superseded 가드와 배포 사이 경합을 좁힌다.** 순서는 첫 superseded 가드(S3) → 묶음 sha256·플랫폼·설정 동일성 → secret 이름 확인(타) → **`wrangler deploy` 직전에 `latest.json`을 S3로 다시 읽어 같은 `verifyPlan`** → deploy → 배포 뒤 검사다. 다시 읽은 결과가 superseded면 배포 없이 notice + 0, not-promoted(낮아졌거나 사라짐)면 1, 읽지 못하면 2이고, 검사의 `/update/0.0.0` 바이트 비교는 다시 읽은 바이트로 한다. dry(selftest)도 다시 읽기까지 돈 뒤 멈춘다. 검사가 실패하면 한 번 더 읽어 superseded면 `::error::`에 "다른 태그 <v>가 승격됐다"를 싣는다(종료 코드는 검사 결과 그대로). deploy-worker 작업은 저장소 공용 concurrency 그룹 `worker-deploy`(`cancel-in-progress: false`)라 두 태그의 배포가 겹치지 않는다. **남는 경합**: ① 두 번째 읽기와 `wrangler deploy` 완료 사이(수십 초)에 다른 태그가 승격하면 낮은 Worker가 잠깐 남는다. 그 태그의 deploy-worker가 같은 그룹에서 뒤에 돌아 덮으므로 오래 남지 않는다. ② 그룹의 대기 자리는 하나라 세 번째 태그 실행이 대기 중인 실행을 취소한다. 높은 태그가 대기 중에 취소되고 낮은 태그가 돌면 낮은 쪽은 superseded로 배포하지 않아 Worker가 승격된 버전보다 낮게 남는다. 이때 report가 취소된 작업을 보는지는 GitHub 동작에 달려 있어(`!cancelled()`), 태그를 짧은 간격으로 셋 이상 밀지 않는 것을 운영 규칙으로 두고 그런 경우 사람이 deploy-worker를 다시 돌린다. 순서는 `workerDeploySteps`(가짜 의존성, `release.test.mjs`)와 selftest `(w-dry)`(두 번째 GET만 503, 가짜 S3 장애 주입 `skip`)가 고정한다. (타) **배포 전 Worker secret 이름 확인(자동 `wrangler rollback` 대신)**: 묶음의 wrangler로 `secret list --config dist/wrangler.json --format json`(같은 env 허용 목록, 자격 있음, stdout은 찍지 않는다. API는 이름·종류만 준다)을 돌려 **`CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CI_VERIFY_TOKEN`**이 모두 있는지 본다. 없으면 배포 없이 1이고 없는 이름만 찍는다. 이 셋은 운영 모드에서 없으면 `config_error`다(`src/config.ts`). **`ADMIN_CHANNEL_IDS`는 필수가 아니다**: 비면 부트스트랩 모드(§8.3)라 경고(`::warning::`)만 한다. 목록 실패·출력 형식 이상은 2(배포 없음, Worker가 아직 없으면 첫 배포는 W9에서 사람이 한다). 배포 뒤 `config_error`를 보고 `wrangler rollback`을 자동으로 돌리는 길은 쓰지 않는다: rollback도 같은 secret을 쓰는 옛 버전이라 secret 누락을 고치지 못하고, 자동 되돌리기는 §9.4대로 사람 몫이다. 출력 모양은 wrangler 4.147.0을 로컬 API 스텁(`CLOUDFLARE_API_BASE_URL`, 임시 사본)에 붙여 확인했다(줄 머리 `[`의 JSON 배열, `GET …/workers/scripts/<name>/secrets` 한 번). dry는 그 출력을 `WORKER_SECRET_LIST`로 받는다(dry 전용 덮어쓰기, tag 모드는 거부). **[확인 필요] W9**: 배포 전용 API 토큰(Workers Scripts 편집)이 secret 목록을 읽을 수 있는지. 못 읽으면 모든 배포가 2로 멈추므로 첫 태그 전에 그 토큰으로 `secret list`를 한 번 돌려 본다.

37. **Worker 묶음(§13.4를 바꾼다).**
`worker-bundle.tgz` = `dist/`(`index.js`, map, `bundle-meta.json`, `wrangler.json` = 원본에서 `main`·`no_bundle`만 바꾼 것, `worker-bundle.json` `{platform, arch, wrangler}`) + `deploy/`(package.json, lock, node_modules). §13.4의 "결정적 tar(`dist/`·`wrangler.jsonc`·`deploy/`)"를 바꾼다: **원본 `wrangler.jsonc`는 넣지 않는다**. deploy-worker가 checkout의 원본으로 `deployConfig` 동일성을 다시 보고(`isDeepStrictEqual`), `worker-config.mjs --dist`(`checkDist`)가 묶음 작업에서 같은 동일성을 강제한다. 결정적 tar가 아니다(같은 실행의 sha256 출력과 맞춘다). tar는 늘 `cwd` + 상대 경로로 부른다(Windows GNU tar가 `C:`를 원격 호스트로 해석하는 문제). worker-bundle과 deploy-worker는 같은 러너(ubuntu-24.04)이고, 묶음의 `platform`·`arch`·`wrangler`가 실행 환경·`tools.json`과 다르면 배포하지 않는다(2). worker-bundle은 끝에 묶음을 풀어 자격 없이 `deploy --dry-run`을 돈다(리허설마다 35 (다)를 다시 본다). wrangler는 `node deploy/node_modules/wrangler/bin/wrangler.js`로 부른다(`.bin` shim·셸을 쓰지 않는다). `worker/deploy/package.json`은 키 허용 목록(name·private·packageManager·dependencies)과 의존성 wrangler 하나(= `tools.json`)이고 두 lockfile의 wrangler 버전이 `tools.json`과 같아야 한다(`worker-config.mjs`).

38. **W6 랜딩·관리 화면에서 정한 것(§4.1·§4.4·§4.5·§8·§9.5, 32 (나)(다)를 정한다. 35~37은 병렬로 진행한 W8 브랜치의 번호다).** (가) **랜딩 파일 크기를 뺀다(32 (나)).** 비로그인·형식 밖 쿠키는 R2 0회·DO 0회다. 허용 사용자는 R2 2회 이하다: `latest.json`은 랜딩 전용 isolate 캐시(`LATEST_VIEW_CACHE`, `ctx.now` 기준 60초, `/update`와 공유하지 않음), SHA256SUMS는 `/releases`와 같은 `SUMS_CACHE`·`loadSums`(`export`만 붙였다)다. 표는 소스 상수 `LANDING_FILES`(dmg·setup.exe·msi·AppImage·deb) ∩ SUMS이고, `.app.tar.gz`·`.sig`는 넣지 않는다(`expected-artifacts.json`에서 `release`가 아닌 산출물과 같은지 `test/unit/landing.test.ts`가 본다). latest 없음은 "아직 올라온 버전이 없어요", 해석 실패·SUMS 없음·행 0은 "불러오지 못했어요"이고 페이지 상태는 늘 200이다(내 기기를 함께 보인다). R2 get이 던져도(바인딩 오류·일시 장애) 500이 아니라 같은 "불러오지 못했어요" 200이다: 내 기기·로그아웃이 같은 화면이라 허용 사용자가 세션을 끊을 길이 R2 장애에 묶이지 않는다. 던진 결과는 캐시하지 않는다. 로그는 `landing.release_unavailable{reason}`(`latest_invalid`·`sums`·`no_rows`·`r2`, `r2`는 `errorName`만). `r2-calls` 45~60행이 호출 수를 고정한다(앱 access·CI 토큰·형식 밖 쿠키·모르는 쿠키·폐기된 세션 쿠키도 R2 0회, R2가 던지는 경우 포함. latest.json이 없어도 "없음"을 60초 캐시한다: 첫 릴리스 직후 최대 60초 늦게 보인다). (나) **웹 POST 검사 순서**(`guardWebPost`): 부트스트랩(관리 경로만, 403) → Origin·Sec-Fetch-Site(403) → Content-Type `application/x-www-form-urlencoded`(415) → 본문 4096바이트·UTF-8(400) → 웹 세션(없거나 실패면 303 `/` + 쿠키 지움) → 관리자(403) → `csrf` 필드 하나·형식·`safeEqual`(403) → 동작. 1~4단계는 DO를 부르지 않는다. 오류 본문은 HTML 안내 페이지, 로그는 `web.post.rejected{route, reason}`(level warn)이다. GET `/admin`은 부트스트랩 403 → 세션 303 → 관리자 403 → 200이다(§8.3의 403을 세션 판정보다 먼저 둔다). 경로 값(`:id`·`:channelId`) 검사는 늘 가드 뒤라 세션이 없으면 값과 상관없이 303 `/`다. (다) **신원**: 웹 경로는 쿠키만 보고 `Authorization`은 무시한다(CI 토큰·앱 access = 없음). `mySessions`·`revokeMine`·감사 `actor`는 로그인 채널이다(23, `owner_channel_id`가 달라도 로그인 채널의 세션이 보인다). 지금 브라우저의 세션을 [끊기]하거나 로그아웃하면 쿠키를 지운다. (라) **DO 호출**: W6 경로는 요청당 RPC 2회 이하이고, 둘째는 `webCheck`가 성공한 허용 세션 뒤에만 일어난다(인증 없는 증폭 ≤ 1). `r2-calls`의 랜딩 행이 DO RPC 수도 센다(`env.AUTH` 계수 래퍼: 비로그인·Bearer·형식 밖 쿠키 0, 형식이 맞는 모르는·폐기된 쿠키 1, 허용 세션 2). 합성 RPC는 만들지 않았다. W9 사용량 확인 목록에 `/`·`/admin*`·`/me/*`를 더한다(28 (차)·33 (라)). (마) **스타일시트**: `GET /assets/site.<SHA-256 앞 16 hex>.css` 하나다(§4.1 표의 `/assets/site.css`를 이 경로로 바꾼다). 해시는 소스 상수이고 `test/unit/site-css.test.ts`가 다시 계산해 기대값을 알려 준다. `text/css; charset=utf-8`, `public, max-age=31536000, immutable`(no-store의 유일한 예외), 그 밖의 이름은 404 JSON이다. CSP는 그대로이고 HTML에 `<script`·`<style`·`style=`가 없다(정적 검사 39 + 행렬 실행 단언). (바) **표시**: 시각은 KST `YYYY-MM-DD HH:MM`이다. 랜딩의 게시 날짜도 `pub_date`를 KST 날짜로 바꿔 보인다(UTC 15시 이후 게시는 다음 날). 세션 id는 폼 action 경로에 나온다(자격이 아니다). csrf는 hidden 필드에만 있다. 관리자 채널 행에는 [빼기] 대신 "관리자"를 보인다. 메모는 store가 64자로 자른다(`note`가 둘 이상이면 400). `owner_channel_id` 편집 UI는 G-ID 결과 뒤로 미룬다. 모든 HTML 페이지가 한 골격(`htmlPage`: 머리글 링크 + 스타일시트)을 쓰고 안내 페이지에는 [처음으로] 링크가 붙는다. (사) **낱말 검사가 문구·CSS에도 걸린다**: CSS는 `list-style`·`*-self`·`html` 선택자를 쓰지 않고(`:root`), 문구에 `wrangler secret put`을 쓰지 않는다. 랜딩 캐시는 `Lru`를 써서 `DELETE_ALLOWLIST`·`RAW_ALLOWLIST`는 바뀌지 않았다. (아) **[확인 필요] W9 실기기**: macOS 15 Gatekeeper 문구, `xattr` 경로 `/Applications/치지직 다운로더.app`(productName). 브라우저가 실제 Origin을 싣는지(`Origin: null` → 403)는 W7 E2E가 본다. (자) 행렬은 24쌍이고 `Auth`에 `web_optional`·`web`·`admin`을 더했다. deploy-worker 계약 테스트에 `/admin`(CI 토큰) → 303 `/`를 더했다(32 (다)). 같은 파일의 테스트는 DO 저장소를 공유하므로 세션·허용목록을 세는 W6 테스트는 `resetStore()`(harness)로 비우고 시작한다. 행렬의 `GET /`는 상태와 함께 본문도 본다(웹 자격만 회원 화면, 그 밖의 자격은 로그인 폼, (다)). (차) **§4.5 표의 `/admin*`, `/me/*` 행에서 `/me/*`의 W(일반 웹) 칸은 403이 아니다**: 자기 세션 [끊기]는 303 `/`, 모르는(남의) id는 404다(§4.4·§8.2). 403은 `/admin*`에만 맞다. (카) **관리 POST의 경계(W3 store를 고친다)**: [추가]를 메모 없이 다시 보내면 있던 메모가 남는다(store `allow`의 upsert가 `note = COALESCE(excluded.note, allowlist.note)`. 메모를 지우는 UI는 없다). 허용목록에 없는 채널의 [빼기]는 store가 `not_found`를 돌려주고 아무것도 쓰지 않으며(감사·세션 폐기 없음) 화면은 404다. 세션은 허용일 때만 생기고 `check`·`webCheck`가 요청마다 허용을 다시 보므로 이 경우 끊을 세션이 남지 않는다. 관리자 채널(`ADMIN_CHANNEL_IDS`)을 [추가]하거나 거부 기록에서 [허용]하면 409(`관리자 채널은 허용목록에 넣지 않아요.`, 로그 `admin.rejected{reason:"is_admin"}`)이고 아무것도 쓰지 않는다: 허용목록 행이 생기면 secret에서 빼도 허용이 남고, 화면은 그 행에 [빼기] 대신 "관리자"만 보여 지울 길이 없다(§8.1 "관리자는 secret에서만"). 이 검사는 HTTP 층이고 store `allow`는 그대로다(테스트 준비가 관리자 행을 직접 만든다). §4.4 표의 오류 집합에 404(목록에 없는 채널 [빼기])와 409(관리자 채널 [추가])를 더한다.
39. **html 호출형·인라인 금지 정적 검사(14 (아)의 W6 약속).** `checkHtmlSources`는 모양 목록이 아니라 낱말 수로 본다(cicd.md 93·95의 fetch·put·list·delete와 같은 방식): `src/**`(`src/core/html.ts` 밖)의 원문(주석·문자열 포함)에서 낱말 `html`은 바로 뒤가 백틱인 태그드 템플릿, `core/html`의 이름 import 선언(`import { … } from "…/html"`), `<html`·`</html`·`doctype html`, `text/html`에만 있어야 한다(그 밖의 수 0). 그래서 호출형·`call/apply/bind`·값으로 넘김(인자·배열·삼항·화살표 반환·`export default`·구조 분해)·속성 접근(`H.html`·`H["html"]`)·재수출 경로가 모두 걸리고, 주석은 "HTML"로 쓴다. `html as` 별칭은 원문에서 따로 막는다. `src/**` 전체에서 `import * as`·`export *`(네임스페이스로 꺼내는 길)와 `<script`·`<style`·`style=` 속성(따옴표 없는 값 포함, 행렬 실행 단언 `\sstyle=`와 같은 범위)을 막는다. 한계: 이어 붙여 만든 속성 이름(`obj["ht" + "ml"]`)은 리뷰 범위다. cicd.md 99. **PR #33 리뷰 반영(가나다는 39 안의 하위 항목).** (가) 낱말 검사(fetch·put·list·delete·raw·html)는 유니코드 이스케이프 `\uXXXX`·`\u{…}`를 디코드한 텍스트로 센다(`fe\u0074ch` 우회). `html as` 별칭 검사는 `html /* … */ as`·`html // …\nas`처럼 주석이 끼어도 잡는다. (나) `src/core/html.ts`의 `new SafeHtml(`은 정확히 2개(html·raw)다. (다) 다크 모드 주 버튼 글자색은 `--on-accent` 토큰이다(라이트 `#fff` + accent를 `#007a45`로 어둡게 해 4.5:1 이상, 다크 `#141414`). `SITE_CSS_HASH`를 다시 계산했다. (라) 랜딩의 `loadDownloads`와 `mySessions`는 `Promise.all`로 병렬이다(호출 수는 그대로). (마) 관리 POST의 `channelId`가 둘 이상이면 `bad_body`(400, `요청을 읽지 못했어요.`), 없음·형식 틀림은 `bad_channel_id`다.

40. **W7 실측(§12.3 1·2·4, R6의 `--log-level`·씨앗·포트, wrangler 4.147.0, 2026-10-07, 임시 사본·쓰는 쪽 없는 FIFO 비밀값 파일).** (가) **`--log-level warn`은 쓰지 않는다(§12.3 4를 바꾼다).** `warn`이면 wrangler 요청 줄과 함께 Worker의 `{"event":…}` 줄도 모두 사라진다(`log.ts`가 level과 상관없이 `console.log`로 쓰고 wrangler는 이를 log 등급으로 거른다). 그 상태의 카나리 검사는 빈 출력을 보고 통과한다. `log` 등급에서는 요청 줄이 그대로 남는다. 기본 등급의 요청 줄은 `[wrangler:info] GET /auth/callback 303 See Other (2ms)`처럼 **경로만 찍히고 쿼리가 없다**(§12.3 4의 "`?code=…&state=…`가 찍힌다"는 이 버전에서 사실이 아니다). 다만 경로의 handle·세션 id·채널 id는 찍힌다. 시작 배너의 바인딩 표는 값을 `"(hidden)"`으로 가린다. 그래서 카나리는 줄을 셋으로 나눈다. Worker JSON 줄과 그 밖의 줄은 모든 카나리, wrangler 요청 줄은 비밀 종류(code·state·토큰·쿠키·csrf·pollSecret·client secret·CI 토큰·채널 이름·스로틀용 합성 IP)만 본다. 합성 IP는 §14의 "IP 원문" 금지 확인이다(요청 줄과 배너에는 클라이언트 IP가 찍히지 않는다. `127.0.0.1`은 배너의 `Ready on` 줄에 찍혀 카나리로 쓰지 않는다). 요청 줄에 `?`가 있으면 실패한다(wrangler를 올려 쿼리가 찍히기 시작하면 여기서 멈춘다). 검사가 아무것도 보지 않고 통과하지 않게 필요 이벤트 수를 단언하고(`REQUIRED_EVENTS` 이상, `config.error` 정확히 1·`http.internal` 0), 시작할 때 심은 카나리 한 줄을 검출기가 잡는지 본다. (나) **`--var`가 `--env-file`을 이긴다**(`--var START_RATE_10M:2`가 example의 1000을 덮었다). 그래서 E2E는 `START_RATE_10M:3`·`BUILD_ID:<논스>`와 치지직 주소 둘(가짜 서버 `FAKE_ORIGIN`)을 `--var`로 준다. `--var` 적용은 `/health.build` 논스(example 값은 `dev`)와 E14의 넷째 429(example 값은 1000)로 확인한다. 치지직 주소 둘은 `.dev.vars.example` 값과 바이트까지 같아 확인 대상이 아니다(인가 주소·CSP `form-action`의 가짜 출처 단언은 `--var`가 무시돼도 통과한다). (다) `CF-Connecting-IP`(26 (바)의 확인): IPv4는 IP별, IPv6은 /64별 버킷이고(`2001:db8::1`·`::2`·`::3`이 한 버킷, 다른 /64는 따로) 헤더가 없으면 127.0.0.1이다. (라) **8787 점유**: `127.0.0.1:8787`을 다른 프로세스가 쓰면 wrangler는 약 1.5초 뒤 `bind(): Address already in use`로 끝나지만 그 전에 `/health`가 그 프로세스의 200을 받았다. `[::1]:8787`이면 wrangler는 127.0.0.1에 정상으로 뜨고 `localhost` 요청은 그 프로세스로 갔다. 그래서 E2E는 (1) 127.0.0.1·::1의 8787과 127.0.0.1의 8788을 bind로 확인하고(`::1`이 없는 러너는 `EADDRNOTAVAIL`로 넘어간다), (2) `/health.build`가 이번 실행의 논스일 때만 준비로 보며, (3) 그 전에 wrangler가 끝나면 실패한다(종료 코드 2). inspector 포트(9229) 충돌은 wrangler가 스스로 피한다. (마) **로컬 R2 씨앗**: `wrangler r2 object put <버킷>/<키> --file … --local --persist-to <d>`는 자격증명 없이 된다(한 번에 0.7~3.8초, 29개 순서대로 약 21초). 같은 폴더를 동시에 쓰면 29개 중 8개가 `SQLITE_READONLY`로 실패해 **순서대로만** 넣는다. 묶음 put(`r2 bulk put`)은 숨은 명령이고 put 응답 상태를 보지 않아 쓰지 않는다(원격 R2 플래그·낱말 bulk·로그 등급 플래그는 `worker-config.mjs checkE2eSources`가 `worker/scripts`·`worker/test`의 원문에서 막는다). 같은 `--persist-to`의 `wrangler dev`가 씨앗을 본다. (바) `r2 object put --local`과 `wrangler dev --env-file .dev.vars.example --var …`는 쓰는 쪽 없는 FIFO 비밀값 파일이 있어도 막히지 않았다(열지 않는다, 구현 중 변경 4·9). 임시 `HOME`·`XDG_CONFIG_HOME`과 `--show-interactive-dev-session=false`로도 정상으로 떴다. (사) **W8 인계(36 (아)의 남은 확인)**: 씨앗(0.1.0·0.2.0, latest 0.2.0)을 넣은 wrangler dev에 `release.mjs worker --check-only --base http://localhost:8787 --version 0.2.0 --build <논스>`를 돌리면 health와 일곱 검사가 모두 pass(`/admin` 303)였고, `--version 0.1.0`이면 exit 1이었다. 배포 뒤 검사 계약이 실제 workerd의 Worker와 맞는다. E2E가 매번 두 경우를 다시 돈다(E16). (아) undici `fetch`는 `Origin`을 스스로 싣지 않는다. 그래서 "브라우저 규칙대로"는 흉내다: 폼이 있는 페이지의 `Referrer-Policy`로 Fetch 표준의 Origin 규칙을 계산해 보낸다(`no-referrer`면 `null`). **실제 브라우저가 Origin을 싣는지는 W9 수동 확인으로 남긴다**(Playwright를 worker에 들이지 않는다). (자) 첫 로컬 실행은 약 32초(씨앗 21초·시나리오 나머지 약 10초, 폴링 간격 대기 1.6초 × 6)이고 Worker JSON 줄 30·요청 줄 128·그 밖 19줄이 모두 카나리 0건이었다. (차) **외부 접속은 npm 업데이트 확인 하나다.** wrangler는 배너를 찍을 때 npm 레지스트리에 최신 버전을 묻는다(`update-check`, 3초 시간 제한, 실패해도 진행, 결과는 `TMPDIR`의 `update-check/`에 캐시, 배너가 `(update available …)`를 덧붙인다). 이것만 끄는 env는 없고 `WRANGLER_HIDE_BANNER`는 배너째 숨겨 E02의 버전 대조를 잃으므로 그대로 둔다. 치지직·Cloudflare가 아니고 과금도 없다. 배너 버전은 첫 `wrangler X.Y.Z`를 잡아 덧붙은 최신 버전에 흔들리지 않는다.

41. **W7 wrangler dev E2E에서 정한 것(§3·§12.1·§12.3·§13.2를 정한다).** (가) 파일: `worker/scripts/fake-chzzk-server.mjs`(node:http 래퍼 + 수동 CLI `node scripts/fake-chzzk-server.mjs [--account b2]`, 설계 §3·§12.1의 위치를 따른다), `worker/scripts/e2e-dev.mjs`(실행기), `worker/test/e2e-lib.mjs` + `.d.mts`(순수 함수, vitest `test/unit/e2e-lib.test.ts`가 함께 쓴다). node 전용 파일은 `scripts/`, workerd가 import하는 순수 모듈은 `test/`다. 스크립트 `e2e` = `node scripts/e2e-dev.mjs`(글자 고정, `EXPECTED_SCRIPTS`). `pnpm dev`의 글자는 바꾸지 않는다. (나) 래퍼는 `handle`이 던진 `TimeoutError`를 응답 없는 연결 끊기로 바꾼다(Worker에는 `timedOut:false`인 네트워크 실패로 보인다). 시간 초과 자체는 vitest가 맡는다. (다) **관리자 외의 채널은 처음에 허용목록이 비어 있다**(E2E는 새 DO에서 시작한다). 그래서 a1 웹 로그인 → `/admin/allow` b2(Origin 규칙 음성 다섯 가지 포함) → b2 앱 로그인 순서다. c3은 거부 → [허용] → 재로그인 → 관리자 [끊기]를 지난다. (라) 흐름 슬롯은 13개(32 상한 안)이고 start 한도는 `--var START_RATE_10M:3`이다. 시나리오마다 다른 TEST-NET IP를 쓰고, 스로틀은 IPv4(같은 IP 넷째 429·다른 IP 201)와 IPv6 /64(같은 /64 넷째 429·다른 /64 201)로 본다. UTC 자정 60초 안이면 기다린다(키에 일 번호). (마) 회전은 60초 안 복구(부모를 다시 냄, 자식은 미사용) → 자식 사용 → 부모 재사용 401 `session_revoked` → 지워진 옛 자식 401 `session_expired` → 마지막 access 401 `session_revoked`이다. 60초가 지난 분기는 vitest가 맡는다. (바) 실행기의 자식 env는 허용 목록(`PATH`, 임시 `HOME`·`XDG_CONFIG_HOME`, `WRANGLER_SEND_METRICS=false`, `CI=true`, 있으면 `TMPDIR`)이고 `CLOUDFLARE_*`를 넘기지 않는다. wrangler는 `detached` 프로세스 그룹으로 띄워 그룹째 끈다(Linux·macOS 전용). 원격 R2·로그 등급의 정적 글자 검사(cicd.md 100 (바))는 보조다: 별칭(`-r`)·env(`WRANGLER_LOG`)로 비켜 갈 수 있다. 실제 방어는 인자 배열 고정(`wranglerDevArgs` 단위 테스트, `-r` 없음 포함)·env 허용 목록(`childEnvFor`·`CHILD_ENV_KEYS` 단위 테스트)·필요 이벤트 수(빈 로그 통과 막기)다. (사) 종료 코드: 0 통과, 1 판정 실패, 2 환경(포트 점유·씨앗·기동·시간 초과, 그리고 E00 확인 뒤 8788을 다른 프로세스가 잡은 경우와 준비 뒤 wrangler가 도중에 끝나 요청이 네트워크 오류인 경우). 시작할 때 `target/ci/worker-e2e/`를 비운다(앞 실행의 `wrangler.log`가 새 `result.json` 옆에 남지 않게). `wrangler.log`는 스트림이 다 쓰인 뒤에 끝난 것으로 보고, `result.json`에 카나리 종류별 수(`canaryLabels`, 값 없음)를 남긴다. E17은 동적 카나리 종류(합성 IP·세션·흐름 쿠키·state·세션 id·csrf·pollSecret·pollVerifier·loginId·userCode·handle·access·refresh·치지직 code·토큰)가 모두 등록됐고 전체가 100개 이상인지 단언한다(실측 119개, 고정 카나리만으로 녹색이 되지 않게). 결과는 `target/ci/worker-e2e/{wrangler.log,result.json}`이다. 값은 모두 합성이고, 위반 메시지에는 카나리 값을 싣지 않는다. (아) CI(`CI=true`)에서는 worker gate처럼 실제 비밀값 파일 자리에 `LEAK_SENTINEL` 씨앗을 심는다. wrangler dev가 `--env-file`을 무시하고 그 파일을 읽으면 dev 설정 검사(27 (라))가 `config_error`를 내고 논스 준비 확인이 실패한다. 또 로그에 `Using secrets defined in .dev.vars.example` 줄과 `tools.json` 버전의 배너가 있어야 한다. (자) R2 키 정규식 `releases/<조각>[/<조각>]`는 조각 `..`을 통과시키므로 `wranglerR2PutArgs`가 `.`·`..` 조각을 따로 거른다(단위 테스트 4). (차) 리뷰 반영(PR #34). ① (사)의 전체 10분 제한은 씨앗(`seedR2` 29회)·`release.mjs --check-only`가 `spawnSync`로 이벤트 루프를 막으면 watchdog이 돌지 못해 비동기 `spawn`(`runChild`, 프로세스 그룹째 SIGKILL)으로 바꾸고, 호출마다 시간 제한을 min(개별 제한, 남은 전체 예산)으로 준다. watchdog·SIGINT·SIGTERM도 정상 종료와 같은 기록 함수(`writeResult`)로 `result.json`에 `exit: 2`와 `abort`(`timeout`·`SIGINT`·`SIGTERM`)를 쓰고 끝낸다(프로세스 종료 코드는 시간 초과 2, 신호 130). ② 실패 경로는 wrangler 로그 끝 80줄을 찍기 전에 `scanLogs`를 먼저 돌리고, 위반이 있으면 tail 대신 "n번째 줄(종류): 라벨"만 찍는다(카나리가 로그 끝에 있을 수 있다). `result.json`에 `violations`(위반 수)를 남긴다. ③ `checkE2eSources`의 낱말 bulk 금지는 `E2E_FILES`와 `scripts/`로 좁혔다(다른 vitest 파일의 "bulk revoke" 주석은 통과). 원격·로그 등급 플래그는 `test/` 전체에서 그대로 막는다. ④ 숫자 단언(SHA256SUMS 11·씨앗 29·링크 5)은 `release/expected-artifacts.json` 표에서 계산한 기대값(`verifyKeys`·`expectedArtifacts`·`E2E_VERSIONS`, 랜딩은 app-tar 제외)과 비교하고 실패 메시지에 기대값의 출처를 적는다.

42. **W9 런북과 사용자 결정(2026-10-07, §9.5·§10.2·§10.3·§13.4·§15·§16 W9·R2·R6·§17 Q9 메모를 고쳤다).** 절차는 `docs/runbook/w9-first-deploy.md`다.
(가) **수동 첫 배포 순서 = 배포 → Worker secret 셋(`CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET`·`CI_VERIFY_TOKEN`) → 브라우저 로그인 → `ADMIN_CHANNEL_IDS`.** 없는 Worker에 `secret put`을 하면 wrangler가 빈 Worker를 만들 수 있는데(미확인) 첫 배포는 exports DO 선언이 받아들여지는지 보는 자리라(R5, 10 (나)) 먼저 배포한다. secret이 없는 몇 분 동안의 `config_error`는 사용자가 없어 받아들인다. 관리자 채널 ID는 부트스트랩 로그인의 거부 화면에서야 보인다(§8.3). 수동 배포도 릴리스의 배포 토큰과 release.mjs와 같은 값(빈 임시 `HOME`, `CI=true`, 36 (바))으로 묶음을 푼 빈 폴더(35 (사))에서 하고(토큰은 셸 접두 대입으로 넘겨 `env`의 인자에 싣지 않는다. 그래서 완전한 `env -i` 허용 목록이 아니라 셸 env를 물려받고 `CLOUDFLARE_API_BASE_URL`·`WRANGLER_LOG`를 지운 뒤 남은 `CLOUDFLARE_*`·`WRANGLER_*`가 없는지 이름으로 확인한다), `secret put` 뒤 `/health`의 `build`가 배포한 sha7인지로 `--var`가 이어졌는지 본다.
(나) **확인 시점**: ① `release.mjs worker --check-only` 전체(health + 일곱)는 `latest.json`이 R2에 생긴 뒤(첫 실제 릴리스 승격 뒤)에만 녹색이 될 수 있다. 그 전 `/update/0.0.0`(CI 토큰)은 204이고 `/releases/latest.json`(CI 토큰)은 404다. 첫 배포 직후에는 음성 셋·틀린 Bearer·`/update/0.0.0` 204를 curl로 본다. 32 (가)의 운영 R2 확인과 cicd.md 84 (다)의 로그 마스킹 확인도 첫 릴리스 뒤다. ② 36 (타)의 [확인 필요](배포 토큰이 secret 목록을 읽는가)는 Worker가 있어야 볼 수 있어 사전 확인이 아니라 첫 배포 뒤 `WORKER_DEPLOY_ENABLED=true` 전에 본다.
(다) **code 묶임 실측(29)은 Worker가 아니라 전용 도구 `worker/scripts/code-binding-check.mjs`로 한다.** 29는 `pnpm dev:real`을 적었지만 Worker는 state를 한 번만 받으므로(일회용) 같은 code의 두 번째 콜백을 치지직에 보내기 전에 막는다: Worker를 거치면 ②(재사용)의 거부가 치지직 것인지 Worker 것인지 가를 수 없고, 다른 흐름의 state로 ①을 해 거부되면 원래 흐름으로 다시 교환해 볼 길도 없다. 도구는 로컬 테스트 앱(`chzzk-local-dev`, `worker/.dev.vars`, channel-id-check와 같은 포트 8787·콜백)으로 로그인해 받은 code를 ① 새 state ② (①이 수락이 아니면) 원래 state 순으로 교환하고, ①·②가 모두 거부면 **대조**를 한다: 두 번째 로그인을 받아 그 code를 그 로그인의 원래 state로 **먼저** 교환한다(①이 거부인데 ②도 실패하면 "실패한 ①이 code를 소모한 것"과 "자격·만료 문제"를 가를 수 없고, 치지직이 실패한 교환에서 code를 소모하면 다시 돌려도 같은 결과라 끝나지 않는다). 대조가 성공하면 결론은 "state에 묶인다(다른 state 거부) + 실패한 교환이 code를 소모할 수 있다", 대조도 실패하면 자격·만료 문제로 판정 불가이고 다시 돌리지 않고 ①·②·대조의 HTTP 상태와 오류 code 이름을 알린다. ③은 수락된 교환(① 또는 ②, 아니면 대조)과 같은 code·state로 한 번 더다. 단계별 거부/수락·성공/실패와 HTTP 상태·치지직 오류 code만 찍는다. **거부는 HTTP 4xx(408·429 제외) 또는 HTTP 2xx + 래퍼 code 4xx(408·429 제외)뿐**이고, 5xx·408·429·그 밖의 모양·연결 실패·시간 초과·상태를 받은 뒤 본문 읽기 실패는 거부로 세지 않는다(판정 불가, 앞의 둘은 다시 돌린다). 판정은 순수 모듈 `worker/test/code-binding-lib.mjs`(+`.d.mts`)이고 `test/unit/code-binding.test.ts`가 고정한다. 받은 토큰은 버리고 revoke하지 않는다: revoke는 같은 앱·사용자의 모든 토큰을 지우는데(chzzk-oauth.md §4) `chzzk-local-dev`는 여러 로컬 서비스가 함께 쓴다. `scripts/ci/worker-config.mjs` `DEV_VARS_READERS`에 channel-id-check와 같은 대우로 더했다(cicd.md 101). **결과는 운영 앱에도 성립한다고 본다**(같은 치지직 OAuth 서버, 가정).
(라) **Error 1027은 실측하지 않는다**(사용자 결정 2026-10-07: 계정을 다른 Worker들과 함께 써서 하루 요청 한도를 일부러 넘기지 않는다). 11 (아) ①의 "W9에서 실제 상태 코드로 고정"과 R6의 1027 항목을 바꾼다: 앱 A1 `classify_verify`는 **Worker의 형식 있는 401·403만 즉시 차단**하고(`Content-Type: application/json`, 본문 `{code}`의 code가 §11.3 그림의 `invalid_token`·`session_expired`·`session_revoked`·`not_allowed`), 그 밖의 4xx·5xx와 Cloudflare 오류 페이지(HTML, 1027·1020 등의 403·429·5xx 포함)는 모두 **네트워크 계열**(3일 유예)이다. §11.3의 기존 규칙("Worker 형식이 아닌 응답"·"그 밖 4xx")이 이미 그렇게 정하므로 표를 바꾸지 않고, A1의 `classify_verify` 표에 "Cloudflare HTML 403"·"Cloudflare HTML 429" 행을 네트워크 기대값으로 더한다.
(마) **태그 이름과 push**: 첫 실제 릴리스는 `v0.1.0`이고 `git push origin refs/tags/v0.1.0`처럼 태그 하나만 push한다. **`git push --tags`는 쓰지 않는다**: 로컬 클론에는 비공개 저장소에서 온 `v*` 태그가 있고, origin에 올라가면 release.yml `gate`의 단조 증가 검사(`tagProblems`)가 `v0.1.0`과 이후 0.1.x를 영영 거부한다. 같은 이유로 로컬 클론에서 tag 모드 `release.mjs gate`는 실패한다(CI 체크아웃에는 그 태그가 없다).
(바) **버전은 0.1.0을 유지한다**(사용자 결정 2026-10-07). 첫 실제 릴리스는 pre-release 접미사 없는 `v0.1.0`이라 버전 올리는 PR이 없고 MSI의 pre-release 식별자 제약을 피해 간다. 이후 수정은 0.1.x, **1.0.0은 Phase 3b(A1~A5) 완료와 W9 운영 안정 뒤 사용자 승인**이다. `v0.1.0` 앱은 **Worker 로그인이 없는 앱**이다(A1~A5 전. cicd.md 82 (나)의 태그 모드 `CHZZK_WORKER_BASE` 비교도 A2 몫). `tauri.conf.json`에 updater 주소(`plugins.updater.endpoints`)가 없어 스스로 업데이트하지 않으므로 0.1.0 → 0.1.x는 랜딩에서 받아 직접 설치한다.
(사) **경로별 사용량은 볼 방법이 없다**(28 (차)·33 (라)·38 (라)의 "W9 사용량 확인 때 이 경로들의 요청 수를 본다"를 고친다). invocation 로그를 껐고(7) Worker 로그는 `log()`의 일부 이벤트뿐이라 경로별 요청 수가 남지 않는다. W9 무료 한도 확인은 계정 합계와 이 Worker의 요청·DO·R2 수치로 짐작하고, 경로별로 볼 방법(무엇을 켤지, 11 (가)대로 Free 동작 확인 뒤)은 사용자가 정한다. **Workers Logs(observability)의 Free 범위**(11 (가) 규칙, Cloudflare 문서 2026-10-07 확인): 지금 표는 이벤트 20만/일·보존 3일이고, 2026-12-01부터 계정 공용 Observability 요금으로 바뀌어 Free는 수집 0.5GB/일·보존 7일, 넘으면 그날 수집을 멈추고 00:00 UTC에 재개한다(Free는 추가 수집을 살 수 없어 과금이 없다). 12월 전 Free에서 20만/일을 넘었을 때의 동작(버림·표본)은 문서에 없다 **[확인 필요]**. 다른 Worker와 한도를 함께 쓴다.
(아) **"태그 모드에서 `VERIFY_VIA=worker`를 요구"는 전환 스위치가 아니라 코드 변경이다**(§16 W9 행에서 스위치와 섞여 있던 것을 나눈다). W9는 환경 변수 `VERIFY_VIA=worker`까지이고, 태그 실행에서 `s3`를 거부하는 검사는 에이전트가 따로 PR로 더한다(W9 뒤).
(자) **실제 R2 변조 → rollback 시험은 W9에서 하지 않는다**(사용자 결정 2026-10-07): 버전이 0.1.0 하나라 `previous`가 없다. 변조·rollback 경로는 가짜 S3의 `release-selftest`가 덮는다. 두 번째 릴리스(0.1.1) 뒤 선택 확인으로 `rollback.yml`(`version=0.1.0`) → `--check-only` 확인 → `rollback.yml`(`version=0.1.1`)로 다시 올리기를 런북 §8에 둔다.
(차) **본문 정리**: §5 무료 한도 계산의 "WAF 규칙은 배포 때"(11 (나)로 닫힘), §9.5의 "크기(R2 head)"(38 (가)), §10.2·§15 1단계의 옛 Environment 이름 `chzzk-downloader-worker`와 "두 줄"(12), §10.3 표의 `DIST_BASE_URL`(저장소 secret, 1)·`WORKER_DEPLOY_ENABLED`(저장소 변수, 36 (차))·`CLOUDFLARE_API_TOKEN`의 R2 권한 [확인 필요](35 (마)), §13.4 deploy-worker env(36 (사)), §16 W9 행, R2·R6, §17 Q9 메모를 현재 결정에 맞게 고쳤다. 기존 "구현 중 변경" 항목의 본문은 고치지 않았다.
43. **Workers Logs의 요청 URL 메타데이터(W9 실측, 2026-10-07, §14·7을 고친다).** (가) **실측**: 첫 배포 뒤 Workers Logs를 observability API로 조회하니 `log()`가 남긴 줄마다 Cloudflare가 메타데이터 `$workers.event.request.url`에 그 Worker 호출의 요청 URL 전체를 붙였다. `observability.logs.invocation_logs: false`(7)여도 그렇다. 그래서 콜백 처리 중의 `auth.login.ok`·`auth.login.denied` 줄에 치지직 OAuth code·state가 남았다. 우리 필드·토큰·쿠키는 0건이었다. 7의 "invocation 로그를 끄면 URL이 남지 않는다"는 가정이 틀렸다(꺼지는 것은 호출 요약 줄뿐이다). 값은 이 저장소에 옮기지 않는다. (나) **결정: URL에 §14 금지 값이 실리는 경로는 그 Worker 호출에서 로그를 0줄 남긴다.** 경로 표(`routes.ts`)에 `quiet: true`를 두고 `isQuietPath`(메서드 무관, 설정 검사보다 먼저)가 맞으면 `config.error`·`http.internal`도 남기지 않으며, 핸들러에 주는 `Ctx.log`가 아무것도 하지 않는다. 핸들러는 `core/log`를 직접 부르지 않는다: `log`를 값으로 import하는 파일은 `routes.ts`·`store/AuthStore.ts`뿐이다(`worker-config.mjs` `LOG_IMPORTERS`, 나머지는 `import type`만). (다) **경로 표**(URL에 실리는 것 → 판단):

| 경로 | URL에 실리는 것 | Worker 로그 |
|---|---|---|
| `GET /auth/callback` | `code`·`state`(일회용 자격) | **0줄(quiet)**. 결과는 DO |
| `GET`·`POST /auth/login/:handle` | handle(확인 페이지 자격) | **0줄(quiet)** |
| `POST /me/sessions/:id/revoke`, `POST /admin/sessions/:id/revoke` | 세션 id 전체(자격은 아니지만 §14는 앞 6자만 허용) | **0줄(quiet)**. 성공은 DO |
| `POST /admin/denied/:channelId/{allow,dismiss}` | 채널 id(§14 금지) | **0줄(quiet)**. 성공은 DO |
| `/auth/done?r=` | 결과 낱말(ok·denied·cancelled·failed) | 남긴다(금지 값 아님) |
| `/update/:current` | 앱 버전 | 남긴다 |
| `/releases/**` | 공개 정규식 안의 릴리스 키 | 남긴다 |
| `/assets/:file` | 해시 이름 스타일시트 | 남긴다 |
| 나머지(`/health`·`/`·`/auth/start`·`/auth/web/start`·`/auth/poll`·`/auth/refresh`·`/auth/logout`·`/api/me`·`/auth/web/logout`·`/admin`·`/admin/allow`·`/admin/disallow`) | 없음(자격은 본문·헤더·쿠키) | 남긴다 |

표에 없는 경로(404)는 로그가 없다(설정 오류 때의 `config.error`는 경로 판정 전이라 남는다. 그 URL은 요청자 자신의 값이다). 공격자가 아무 URL에 붙인 쿼리는 그 사람 자신의 값이라 다루지 않는다(그런 요청도 우리 쪽 로그 줄을 만들 때만 URL이 남는다). `LOG_IMPORTERS` 검사는 공백 없는 import·지정자의 유니코드 이스케이프·`.js`·`.mjs` 같은 소스 확장자 지정자(`moduleResolution: bundler`라 `log.ts`로 풀린다)도 본다(cicd.md 102). (라) **옮긴 이벤트**: 콜백의 `auth.login.failed{state|binder}`는 `consume`이, `auth.login.ok{flowKind}`·`denied`·`cancelled`·`failed{reason, stage, status, timedOut, chzzkCode}`는 `finish`가 DO에서 남긴다. DO만 아는 결과(허용·거부, 흐름 유무)에 Worker만 아는 사유(흐름 종류·code 형식·치지직 실패 단계·예외 이름)는 `finish`의 다섯째 인자 `LoginLogHint`(§14 허용 필드만, `log.ts`가 키를 다시 거른다)로 넘긴다. 이벤트 표는 순수 함수 `src/store/login-log.ts`다. consume 뒤 예외는 정리 `finish(failed, user)`가 `{level: error, reason: internal, errorName}`으로 남긴다(전에는 Worker의 바깥 catch). `admin.revoke_session`·`me.revoke_session`·`admin.denied_allow`·`admin.denied_dismiss`는 `revoke(why=admin)`·`revokeMine`·`allowDenied`·`dismissDenied`가 성공했을 때 남긴다(route는 패턴 상수). (마) **버린 이벤트**(DO를 부르기 전이거나 남길 RPC가 없다): 콜백 `state_format`(→ (자)가 되살린다), `[계속]`의 `auth.continue.rejected{bad_origin}`, consume 전(또는 consume 자체)의 콜백 예외(→ (자)가 되살린다), quiet 경로의 `web.post.rejected`·`admin.rejected`·`me.rejected`, quiet 경로의 `config.error`·`http.internal`(설정 오류는 `/health`가 503으로 보이고 같은 오류가 다른 경로에서도 남는다. 5xx 수는 Workers 지표에 남는다). 로그만 나르는 RPC는 두지 않는다: 요청마다 DO 요청이 하나 늘고 인증 없는 경로에서 DO 요청을 부풀리는 길이 된다. (바) **[확인 필요] DO RPC 호출의 로그 줄에도 요청 URL이 붙는가.** DO 쪽 줄은 DO 호출(트리거가 RPC)이라 들어온 HTTP 요청 URL이 붙지 않는다고 본다. 운영에서만 확인할 수 있어 이 PR 머지·배포 뒤 로그인 몇 번 → observability API에서 `auth.login.*`·`admin.*` 줄의 `$workers.event.request.url`(과 그 밖의 URL 메타데이터)을 본다. **붙으면** 이 이벤트들을 버린다(DO 쪽 `log()` 호출을 지우고 `quiet` 경로의 이벤트는 0으로 둔다. 로그인 결과는 관리 화면·`audit`·흐름 행으로 본다). (사) **테스트**: `test/http/quiet.test.ts`가 env.AUTH를 감싸 RPC가 도는 동안의 줄을 DO 쪽으로 가르고(vitest에서는 DO도 같은 isolate라 console 스파이가 DO 줄도 본다), 콜백(승인·거부·취소·치지직 실패·state 형식·모르는 state·binder·code 형식·내부 예외·재사용)·확인 페이지 GET·POST(200·303·403·404·409)·내 기기·관리 id 경로(성공·404·409·csrf 403)·설정 오류·출처 어긋남·핸들러 예외·라우터 밖 예외에서 quiet 경로의 Worker 쪽 줄이 0이고 DO 쪽 이벤트가 남는 것을, quiet가 아닌 경로는 같은 실패를 남기는 것(대조)을 단언한다. `test/unit/login-log.test.ts`가 이벤트 표를 본다. hygiene·login-app·admin 테스트의 기대 이벤트를 맞췄다(internal에 flowKind, `auth.continue.rejected`·denied 경로의 `admin.rejected` 빠짐). W7 E2E(`wrangler dev`)는 DO 줄도 같은 stdout에 나와 `REQUIRED_EVENTS`를 바꾸지 않고 통과했다. (아) 런북 §3.2의 확인은 대시보드 Logs의 본문 검색만이 아니라 observability API(또는 대시보드의 줄 상세)에서 `$workers.event.request.url`까지 본다. (자) **DO가 남기지 못한 콜백 실패는 완료 페이지가 남긴다((마)의 둘을 되살린다, 대체 리뷰 반영).** consume 전·consume 자체의 예외는 로그 0 + 303이라 DO 장애가 로그에도 5xx 지표에도 보이지 않았다. 그래서 콜백은 Worker만 아는 실패 사유 **낱말**을 303 대상에 싣는다: `Location: /auth/done?r=failed&why=<낱말>`. 낱말은 허용 목록(`auth.ts` `DONE_WHY`) `state_format`(state 형식 밖, DO를 부르지 않는다, info)·`internal`(consume 전·consume 자체의 예외, 그리고 consume 뒤 예외에서 정리 `finish`마저 실패해 DO 이벤트가 없을 때, error)뿐이고 값은 싣지 않는다. quiet가 아닌 `/auth/done`이 `r=failed`이고 `why`가 허용 낱말일 때만 `auth.login.failed{level, reason: <낱말>}` 한 줄을 남긴다. 모르는 낱말·빈 값·`r`이 failed가 아닐 때는 무시한다(로그 없음). 완료 페이지의 표시 문구는 `r`만 보고 바뀌지 않는다. DO가 이미 남긴 실패(consume의 `state`·`binder`, finish의 사유, 정리 finish가 남긴 `internal`)에는 `why`를 붙이지 않는다(두 번 세지 않는다). `[계속]`의 `bad_origin`은 403 HTML 응답이라(303이 아니다) 실을 대상이 없어 버린 채로 둔다. **한계**: `/auth/done`은 인증 없는 GET이라 누구나 `?r=failed&why=internal`을 열어 error 줄을 만들 수 있다. 낱말이 고정이라 로그에 값이 실리지 않고, 인증 없는 경로의 요청 수 위험은 28 (차)·11 (아)와 같다. 이 이벤트 수는 실제 장애의 상한이 아니라 단서로 본다(실제 장애는 같은 시각의 DO 오류·5xx와 함께 본다). 테스트: `test/http/quiet.test.ts`(consume이 던지면 콜백 303 Location에 `why=internal`이고 콜백 쪽 줄 0, 그 done 요청에서 `auth.login.failed{reason: internal, level: error}` 한 줄, `state_format`은 info, 모르는 낱말·`r=ok`·why 없음은 0줄), `test/http/login-app.test.ts`(state 형식 밖 Location).

44. **W9 실측과 해소(2026-10-07, 10·29·32 (가)·36 (타)·43 (바)·R5의 [확인 필요]를 닫는다).** 값(주소·ID·토큰·버전 ID)은 옮기지 않고 결과 낱말과 실행 번호만 적는다. (가) **첫 배포 권한**: 배포 토큰에 처음에는 Workers 권한이 없었다(Worker 목록 0개, secret 403). Cloudflare 2026-09 권한 체계에서 없는 Worker를 만들려면 Workers 제품 Admin이 필요해 **첫 생성만 로컬 `wrangler login`**으로 했다. secret 넷도 토큰 권한을 고치기 전이라 같은 로컬 로그인으로 넣었다(로컬 로그인은 W9 전부터 있던 사용자 기기의 기존 상태, logout하지 않음). 그 뒤 토큰에 Workers 제품 범위 Editor(= 옛 Account·Workers Scripts·Edit)를 더하니 `secret list`와 같은 묶음 재배포, #38 수정본 재배포가 토큰으로 통과했다. **§10.3·§13.4의 토큰 범위 서술을 바꾼다: 배포 토큰은 Workers 제품 범위 Editor(계정의 모든 Worker 배포·수정, 생성·삭제 불가) + 기존 R2 버킷 권한**이다(R2 권한을 뗐는지는 확인하지 않았다). 위험은 §17 R9. Worker 단위 범위는 토큰 편집 화면이 `com.cloudflare.edge.worker.script` 리소스를 지원하지 않아 쓸 수 없었다(계정 범위로 둔다). 런북 §2.3의 "로컬 로그인으로 우회하지 않는다"는 이 사실에 맞게 고쳤다(생성만 Admin·로컬 로그인, 그 뒤는 토큰). 36 (타) 해소. (나) **exports DO 선언이 실배포에서 받아들여졌다**(`AuthStore` 생성). R5·구현 중 변경 10의 [확인 필요] 해소, `migrations` 대안은 필요 없다. (다) **운영 흐름**: secret 넷 등록 → 부트스트랩 → 관리자 로그인 → 운영 모드, `/admin` 열림, 수동 검사 §2.7 다섯 통과, 실제 브라우저 관리 POST([지우기]) 통과(Origin·38 (나)). (라) **code 묶임**(로컬 테스트 앱, 29): ① 거부(403) ② 성공 ③ 거부(403) → state 묶임·재사용 차단. 29 해소(코드 변경 없음). (마) **Workers Logs**: 43 (가)의 누출이 첫 배포에서 발견돼 PR #38(43)로 고쳤다. 재배포 뒤 본 줄은 `auth.login.ok`(트리거 `AuthStore.jsrpc`, 요청 URL 메타데이터 없음)와 `auth.web.logout`(quiet 아닌 경로, URL에 비밀 없음) 둘뿐이고 code·state·토큰 0건이다. §3.3의 [지우기](`admin.denied_dismiss`)는 #38 재배포 전이었으므로 `admin.*`·`me.*` DO 줄은 같은 jsrpc 트리거라 같다고 **가정**한다. 43 (바)는 이 범위로 해소하고, 다음 관리 동작 때 DO 줄에 URL이 없는지 한 번 더 본다(남은 W9). (바) **첫 실제 릴리스 `v0.1.0`**(실행 37551340797): gate~report 13개 모두 녹색, deploy-worker 포함. 승격 뒤 `--check-only` health+7 통과; Range 0-9·접미 206, 끝을 넘는 Range 206(크기로 잘림, 32 (가) ② 해소), 만족 불가 Range 416(운영 R2는 던진다, 32 (가) ① 해소), `Content-Length`는 GET·206·HEAD 모두 있음(③ 해소), 압축 없음(④ 해소), `/update` 200/204. Actions 로그의 마스킹 호스트 0건(cicd.md 84 (다) 해소). Worker 경유 `xtask release verify` 통과 → 환경 `release` `VERIFY_VIA=worker` 전환. (사) **GitHub**: `WORKER_DEPLOY_ENABLED`를 저장소 변수 `true`로 옮기고 환경 변수는 지웠다. (아) **남은 W9**: macOS Gatekeeper 실기기 문구(사용자), 무료 한도 사용량(며칠 뒤), 태그 모드 `VERIFY_VIA=worker` 강제 코드(에이전트, 42 (아)). 해소된 [확인 필요]: 10·29·32 (가) ①~④·36 (타)·43 (바)·R5.

45. **랜딩 macOS 설치 안내를 xattr로 바꾼다(§9.5·38 (아)의 [확인 필요]와 런북 §4 Gatekeeper 행을 닫는다, 2026-10-07).** (가) **실기기**: 공증하지 않은 `.dmg`의 앱을 처음 열면 macOS가 앱이 손상되어 열 수 없다는 경고를 낸다(사용자 실기기 확인). 이 경고에는 [그래도 열기] 길이 없어서 §9.5의 "그래도 열기" 안내는 통하지 않는다. 경고 원문은 옮기지 않고 뜻으로 적는다. (나) **안내**: ① `.dmg`의 앱을 응용 프로그램(Applications)으로 옮긴다 ② 터미널에서 `xattr -dr com.apple.quarantine "/Applications/<productName>.app"` ③ 다시 연다. [그래도 열기]·우클릭 안내는 뺐다(`copy.ts` `macDamaged`·`macMove`·`macTerminal`·`macXattr`·`macReopen`). 마크업은 `<p>`·`<pre><code>` 그대로라 `SITE_CSS_HASH`가 바뀌지 않는다. vitest가 순서·이스케이프된 명령·옛 문구 없음을 단언한다. (다) **앱 이름 원천**: `app/src-tauri/tauri.conf.json` `productName`. `worker-config.mjs` `checkLandingAppName`이 `macXattr`와 대조하고(파일이 없으면 실패, 셸 큰따옴표 안에서 뜻이 바뀌는 글자(큰따옴표·백틱·`$`·`\`·`!`) 거부. `!`는 대화형 zsh·bash의 history expansion), pre-push `worker` gate 경로에 `tauri.conf.json`을 더했다. 관리자 권한이 없는 macOS 계정에서 `/Applications` 쓰기가 막히는 경우(sudo 필요)는 안내하지 않는다(사용자가 본인 기기 관리자).

46. **42 (아) 해소: 태그 릴리스는 `VERIFY_VIA=worker`를 코드로 요구한다.** sign-publish의 preflight(업로드 전)가 `VERIFY_VIA`가 정확히 `worker`인지와 `CI_VERIFY_TOKEN`이 있는지를 보고, 아니면 업로드하지 않고 실패한다. verify도 xtask 전에 같은 검사를 한다(되돌리지 않음, 2). 리허설·stage(dry)는 바뀌지 않았다. 자세한 것은 cicd.md 구현 중 변경 104. preflight는 끝에 Worker 프로브(`${DIST_BASE_URL}/releases/latest.json`을 `CI_VERIFY_TOKEN`으로 GET 한 번, 200·404만 통과)도 해서 토큰 drift·Worker 장애를 업로드 전에 멈춘다(publish가 경계 뒤에 한 번 더, 릴리스당 Worker 요청 2개·R2 get 2회 이하). **Worker 장애 때 복구 길**: 환경 변수 `VERIFY_VIA`를 s3로 바꾸는 것은 길이 아니다(태그 실행은 preflight·verify에서 거부한다. 진행 중 태그 실행은 그 태그 커밋의 release.mjs를 쓰므로 PR로 고쳐도 이미 시작한 실행에는 닿지 않는다). 길은 셋이다. ① `rollback.yml`은 늘 S3로 `latest.json`을 바꾼다(Worker와 무관). ② 확인이 필요하면 로컬에서 R2_* 자격으로 `cargo xtask release verify --version <v> --pubkey release/updater.pub --base-url <DIST_BASE_URL>`를 `VERIFY_VIA` 없이(S3로 다시 받기) 돌린다. ③ 사용자 승인 아래 Worker를 수동 재배포하고(런북 §2.3) verify 작업을 다시 실행한다.

47. **Phase 3b A1 앱 셸에서 정한 것(§11.2·§11.3·§11.4를 정한다, 13의 앱 쪽).** (가) **위치·타입**: `crates/shell/src/auth/`(`token`·`clock`·`base`·`session`·`api`·`http`·`verify`·`service`). 상태·사유는 도메인 타입 `auth::{AuthPhase, AuthReason, AuthStatus}`이고 DTO(`AuthStatusDto`·bindings)는 A2가 옮긴다(A1에서 bindings가 바뀌면 프런트·가짜 백엔드가 끌려온다). Worker 출처는 `WorkerBase::parse` 하나가 정한다(https 또는 루프백 http, 경로·쿼리·조각·사용자 정보 없음, `origin().ascii_serialization()`). `HttpWorkerApi`·`SessionStore`가 같은 값을 받는다. (나) **토큰 계약(13)**을 `tests/auth_token.rs`가 Worker `test/unit/token.test.ts`와 같은 known-answer로 고정한다: 0x5a 32바이트의 pollSecret → verifier hex `bec0b6d6…b53d`, 접두 포함 해시(`cda_`+A×43 ≠ A×43), `cdr_`+b64url(0xff×32). (다) **Worker 형식**: `application/json`(대소문자 무시, 매개변수 허용) + 본문 64 KiB 이하 + JSON 객체 + `code` `^[a-z0-9_]{1,64}$`. 즉시 차단은 401 `invalid_token`·`session_expired`·`session_revoked`, 403 `not_allowed` 네 쌍뿐이고, 짝이 안 맞는 것·그 밖 Worker 오류(400·429 `rate_limited`·5xx)는 네트워크 계열 원인 `Server`, Worker 형식이 아니거나(42 (라)의 Cloudflare HTML 403·429 포함) 응답이 없으면 원인 `Network`다(`tests/auth_verify.rs` 표). 리디렉션은 따라가지 않는다(3xx → `Network`, 본문이 JSON `{code}`여도 같다). 기대 상태인데 JSON이 아니면 `Network`, JSON인데 계약 위반이면 `Server`. 요청 하나 10초 전체 상한. (라) **시작 판정에도 60일 상한**: 읽은 세션의 `now ≥ refreshExpiresAt`이면 네트워크 없이 `Expired{SessionExpired}` + 삭제, 유예 안이면 낙관 `SignedIn`, 그 밖(유예 밖·시계 역행)은 `Checking`(§11.3 그림의 "유예 밖 → Checking"은 상한 전만). (마) **origin 다름·깨짐·`v ≠ 1`·읽기 오류는 파일을 지우지 않는다**(다음 로그인이 덮는다).

48. **`session_revoked`의 원인을 앱이 알 수 없다(§11.3 `Expired{Revoked|ReuseDetected}`를 정한다).** Worker refresh는 로그아웃·관리자 [끊기]·사용자 [끊기]·재사용 감지 모두 401 `session_revoked` 하나로 답한다. 앱은 **첫 시도의 revoked → `Revoked`, 응답 유실 재시도에서 받은 revoked → `ReuseDetected`**로 정한다(재시도에서 revoked면 60초가 지났거나 자식이 쓰였다, §5.2 마지막 행). 그래서 `Revoked`는 "관리자가 끊었다"를 뜻하지 않는다: §11.7 `auth.revoked`("관리자가 이 기기의 로그인을 끊었어요")는 A3에서 원인을 단정하지 않는 문구로 바꾼다. Worker가 원인을 보내게 하는 것은 따로 정한다.

49. **응답 유실·쓰기 실패·경합(§5.2 "앱은 새 묶음을 원자적으로 쓴 뒤에 상태를 바꾼다"·§11.3 single-flight를 정한다).** (가) 응답 유실 재시도는 첫 결과가 응답 없음·Worker 형식이 아닌 응답·2xx 계약 위반일 때만, 같은 refresh 토큰, 같은 single-flight 잠금 안이다. Worker 형식 4xx와 2xx가 아닌 계약 위반에는 재시도하지 않는다(지금 코드에서 계약 위반은 기대 상태(200·201)일 때만 생기므로 늘 2xx다). **횟수·간격·Worker 형식 5xx는 53 (가)가 바꾼다**(즉시 1회 → 창 안 즉시·10초·30초). (나) **쓰기 실패**: refresh 성공·로그인 ok 뒤 `session.json` 쓰기가 실패해도 메모리의 새 묶음이 권위다(`SignedIn`, `dirty`, 다음 tick·refresh 전에 다시 쓴다). 옛 토큰으로 되돌아가지 않는다: 서버는 이미 회전했고 옛 부모를 60초 뒤 내면 재사용 감지로 끊긴다. 재시작 전에 끝내 쓰지 못하면 재로그인 1회. (다) `session.json` 쓰기·지우기는 상태 잠금 안에서만 하고, logout·로그인 ok는 세션 세대를 올려 늦게 끝난 refresh의 결과를 버린다. (라) **logout은 로컬 먼저**(파일 삭제·`SignedOut`) → 서버 `POST /auth/logout`(실패 무시)이다(§11.4 "서버 → 삭제"를 바꾼다. 앱이 바로 꺼져도 로컬 로그아웃은 끝나 있다). 진행 중 refresh를 기다리지 않는다: Worker `logout`은 refresh 행을 상태와 무관하게 해시로 찾으므로 이미 회전된 토큰으로도 세션이 끊긴다. (마) 응답 유실 재시도 대상에 **2xx의 계약 위반**을 넣는다(서버는 회전했는데 본문을 못 읽었다. 1분 백오프는 60초 창 밖이다). 재시도 때문에 `Checking`은 최대 약 40초(53 (가), 예전 약 20초)이고 §11.3·§11.7의 "10초"는 A3가 이 값으로 맞춘다.

50. **로그인 폴링(§7.1·§11.3·§11.4를 정한다).** (가) 기한은 로컬 **start 요청 직전 시각 + 10분**이고 서버 `expiresAt`은 형식만 본다(시계 차이와 무관, 로컬 기한 ≤ 서버 만료). `PendingDto.expiresAt`도 이 값이다. (나) 일시 오류(네트워크·5xx·그 밖 4xx)는 로그인을 끝내지 않고 기한까지 계속 폴링한다. 기한에 마지막 결과가 일시 오류면 `Error{Network|Server}`, 아니면 `Expired{LoginTimeout}`. 404는 기한 전 `Error{LoginLost}`, 뒤 `Expired{LoginTimeout}`. `429 too_soon`은 상태 유지. `failed{code}`는 `Error{Server}`. 로그인 `denied`는 `Denied`(사유 없음, 이름은 poll 값. `RemovedFromAllowlist`는 refresh 403 전용). 간격은 `pollIntervalMs`를 [2초, 30초]로 자른다. (다) **로그인은 `SignedIn`이 아니면 언제나 시작한다**(`Checking`·`Expired{GraceExpired}` 포함, 저장 세션 유지). 로그인 중 refresh가 성공하면 `SignedIn`으로 가고 로그인을 버린다. (라) **취소**: 저장 세션이 없으면 `SignedOut`, 있으면 유예 안 오프라인 기록이 있을 때 `SignedIn`(오프라인), 아니면 `Expired{GraceExpired}`(§11.4 "→ SignedOut"을 좁힌다: [다시 연결]을 잃지 않게). ok·취소가 아닌 로그인 종결도 저장 세션을 남긴다. start 요청 중에 refresh가 성공해 `SignedIn`이 되면 start가 성공했든 실패했든 `begin_login`은 `AlreadySignedIn`을 돌려주고 로그인·오류 화면으로 뒤집지 않는다. start 요청 중에 누른 취소·로그아웃은 시작 세대를 올리고, 늦게 온 start 결과는 성공·실패 모두 버린다(`BeginLogin::Discarded`, 상태는 그대로, A2는 확인 페이지를 열지 않는다).

51. **재확인 스케줄(§11.3을 정한다).** 다음 갱신 = `min(verifiedAt + 24h, accessExpiresAt − 60초)`, 하한 `verifiedAt + 5분`(53 (나)). 오프라인 k번째 연속 실패 뒤 1·2·5·10·30분, 이후 30분. 포커스·절전 복귀는 마지막 시도 60초 뒤부터 즉시. `graceUntil`이 지나면 다음 틱에 **한 번 시도한 뒤** 그 결과로 판정한다(그림의 "다음 틱에 `Expired{GraceExpired}`"를 바꾼다: 그 사이 연결이 돌아왔으면 로그인이 이어진다). 타이머 자체는 A2가 `next_wake()`까지 자고 `tick()`을 부른다. command 층 게이트 seam은 `AuthService::require_signed_in()`(기존 `AppError::not_logged_in`, 배선은 A2). 유예 끝은 `min(verifiedAt + 72h, refreshExpiresAt)`이라 상한이 먼저 오면 `next_wake()`도 그 시각이고, 그 틱의 시도가 실패하면 `Expired{SessionExpired}` + 삭제다. **실행 중 시계 되돌리기**: 지금이 `verifiedAt`이나 마지막 시도보다 이르면 `tick`은 예정 시각을 기다리지 않고 바로 갱신하고 `next_wake()`는 지금을 돌려준다(성공하면 `verifiedAt`이 새 시계로 바뀌고, 실패하면 §11.3대로 유예 밖이다). 게이트(`require_signed_in`)는 상태(`phase`)만 본다: 화면은 `SignedIn`인데 command만 막히는 어긋남을 만들지 않고, 그 틈은 타이머·포커스·복귀 틱이 닫는다.

52. **받아들인 위험과 깨진 파일(§1 "클라이언트 정책"·§11.2·D21을 정한다).** (가) `session.json`은 앱 자신이 검증하지 못한다(서명 없음). 사용자가 파일의 채널 ID·`verifiedAt`을 고치고 Worker 호스트를 막으면 유예 동안(그리고 `verifiedAt`을 다시 고칠 때마다) 그 채널로 `SignedIn`이 된다. 본인 영상 제한·허용목록의 앱 쪽 강제는 클라이언트 정책(§1)이라 받아들인 위험이다. 막으려면 Worker가 서명한 `{channelId, verifiedAt, refreshExpiresAt}`을 앱에 박은 공개 키로 검증해야 하고, 그것은 따로 정한다. (나) 시각이 RFC3339로 읽혀도 `verifiedAt + 72h`·`accessExpiresAt − 60초`가 time 범위(9999년)를 넘으면 깨진 파일(`Corrupt`)로 본다(시작 판정이 panic하지 않게). 오프셋을 UTC로 옮긴 값이 0..=9999년 밖이어도 같다(53 (마)). `grace`·`refresh_due_at`도 넘침에서 포화한다.

53. **A1 PR 리뷰 반영(2026-10-07, 49 (가)(마)·51·52 (나)를 고친다).** (가) **응답 유실 재시도 = 창 안 여러 번**: 예전 "즉시 1회"는 DO 커밋 뒤의 `500 internal`, 이중 유실 뒤 1분 백오프의 다음 시도가 Worker 복구 창(`sessions.ts` `RECOVERY_WINDOW_MS` 60초, 기준은 첫 회전의 `used_at`이고 복구가 이를 옮기지 않는다) 밖이라 재사용 감지로 세션이 끊겼다. 이제 첫 결과가 유실 후보(응답 없음·Worker 형식이 아닌 응답·2xx 계약 위반·**Worker 형식 5xx**)면 같은 토큰으로 첫 시도 시작부터 **즉시·10초·30초**에 다시 내고, 앞 요청이 늦게 끝났으면 기다리지 않고 바로 낸다. 마지막 송신은 **45초**까지(창 60초 − 요청 상한 10초 − 여유 5초, 첫 회전은 첫 송신 뒤라 서버의 `now − used_at`은 이 경과 + 요청 시간보다 작다). 경과는 벽시계와 단조 시계 중 큰 값이고(macOS 단조 시계는 절전 동안 멈춘다), 벽시계가 첫 시도보다 뒤로 갔으면 다시 내지 않는다. 자는 동안 창 끝을 넘겼거나 로그아웃·로그인 ok로 세션 세대가 바뀌었으면 멈춘다. 묶음 중 유실 후보가 아닌 결과(4xx 등)가 오면 거기서 판정한다. 묶음에 재시도가 하나라도 있었으면 그 뒤의 `session_revoked`는 `ReuseDetected`(48). `Checking`은 최대 약 40초(10초 시간 초과 네 번). 오프라인 기록의 `since`는 묶음 시작, 1분 백오프는 묶음 끝부터 센다. **받아들인 위험**: 묶음 중 429 `rate_limited`(복구 경로도 회전 상한을 거친다)나 45초를 넘는 유실이 이어지면 다음 시도가 창 밖이라 세션이 끊길 수 있다(재로그인 1회). (나) **갱신 하한 `MIN_REFRESH_GAP` 5분**: 로컬 시계가 서버보다 access 수명(`ACCESS_TTL_MS` 24시간) 넘게 빠르거나 60일 상한의 마지막 60초(서버가 `accessExpiresAt`을 상한으로 자른다)면 `accessExpiresAt − 60초`가 이미 지나 연속 회전 → Worker 429(`ROTATE_RATE_10M` 10회/10분)였다. 다음 갱신 = `max(51의 값, verifiedAt + 5분)`이고, `ensure_fresh_access`도 마지막 확인이 5분 안이면 회전하지 않고 가진 access를 준다. (다) **로그인 폴링 단일 비행**: poll 요청은 한 번에 하나다(비동기 잠금 + 폴링 세대). 겹친 poll에서 한 번뿐인 ok를 소비한 뒤 다른 요청의 404가 먼저 도착하면 `LoginLost`로 끝나고 ok가 버려졌다. 기다린 호출은 그 사이 poll이 끝났으면 다시 내지 않고 현재 상태를 돌려준다. (라) **재로그인은 옛 세션을 서버에서도 끝낸다**: 저장 세션을 둔 채(유예 지남·`Checking`·오프라인 중) 로그인이 ok면 옛 access·refresh로 `POST /auth/logout`을 한 번 보내고 결과는 무시한다(Worker `logout`은 refresh 행을 상태와 무관하게 해시로 찾으므로 이미 회전된 토큰으로도 끊긴다). (마) **시각 범위**: `parse_time`은 `checked_to_offset(UTC)` 뒤 0..=9999년만 받는다(`9999-12-31T23:30:00-01:00` → 10000년, `0000-01-01T00:30:00+01:00` → −1년은 panic 대신 `Corrupt`·계약 위반). `fmt_time`은 쓸 수 없는 값이면 panic하지 않고 `save`가 `serialize` 오류를 낸다. (바) **지우기 실패**: `SessionStore::clear`가 지우지 못하면(폴더 쓰기 금지 등) 그 자리에서 0바이트로 비운다. 빈 파일은 `Corrupt`라 재시작해도 낙관 `SignedIn`이 되지 않고 토큰도 디스크에 남지 않는다. 비우기까지 실패해야 `logout`이 Err다(그때는 재시작 뒤 낙관 `SignedIn`이 서버 확인에서 `Revoked`로 끝날 때까지 남는다, 받아들인 위험). (사) **상태 송신은 잠금 밖**: watch 송신을 상태 잠금 안에서 하면 구독자가 `borrow()`를 쥔 채 `status()`를 부를 때 교착한다. 잠금 안에서 순번과 상태를 정하고 잠금을 푼 뒤 보내며, 늦게 도착한 옛 순번은 버린다(새 상태를 덮지 않는다). (아) **poll ok 응답 유실 = 서버의 고아 세션**: ok는 한 번뿐이라 그 응답을 잃으면 앱은 일시 오류로 계속 폴링하다 404 → `Error{LoginLost}`가 되고, 서버에는 앱이 토큰을 모르는 세션이 refresh 만료(30일, 60일 상한)까지 남는다. 토큰을 아무도 모르므로 쓰일 수 없어 받아들인다(사용자는 다시 로그인). (자) **기각**: 첫 실패가 연결 단계였으면 재시도의 `session_revoked`를 `Revoked`로 보자는 제안은 받지 않았다. `Transport{timed_out:false}`에는 요청을 보낸 뒤의 본문 읽기 실패가 섞이고 Worker 형식이 아닌 응답(Cloudflare 오류 페이지)은 Worker가 돈 뒤에도 날 수 있어 "닿지 않았다"를 가리지 못하며, 두 사유는 처리(삭제·`Expired`)가 같고 문구도 원인을 단정하지 않는다(48).

54. **앱 command·DTO(§11.4를 정한다, Phase 3b A2).** (가) **command 이름은 §11.4 그대로**: `auth_status`·`auth_login`·`auth_reopen`·`auth_copy_login_url`·`auth_cancel`·`auth_retry`([다시 연결])·`auth_logout`, 이벤트 `auth-changed`(AuthStatusDto 전체, 상태가 바뀔 때마다와 처음 한 번, main 창에만. ipc 테스트가 첫 값 `signedOut`과 다른 창에 가지 않음을 본다). updater command(`update_check`·`update_install`)는 A4. (나) **시각은 유닉스 초 정수**다(`verifiedAt`·`pending.expiresAt`·`offline.since`·`offline.graceUntil`, TS `number`). §11.4의 `String`을 바꾼다: app.md §5 "숫자만 보낸다"·`JobDto.createdAt`과 같게 하고 남은 시간 계산을 프런트가 한다. (다) `AuthStatusDto`에 `isAdmin`은 넣지 않는다(앱 화면이 쓰지 않는다. 관리는 웹 `/admin`). `OfflineDto`에 원인은 넣지 않는다(`reason`이 `network`·`server`를 싣는다). (라) **로그인 시작**: `BeginLogin::Started`일 때만 확인 페이지를 브라우저로 열고 폴링 태스크를 띄운다. `AlreadyPending`은 다시 열지 않고(그것은 `auth_reopen`), `Discarded`(start 중 취소·로그아웃)·`Failed`·`AlreadySignedIn`은 열지 않는다. 브라우저를 열지 못하면 로그만 남기고 `Pending`을 유지한다(화면의 [로그인 주소 복사]가 길). 열기·복사는 Rust(opener·clipboard-manager)이고 테스트용 seam `AuthIo`를 거친다. (마) 로그인을 쓰지 않는 빌드에서 auth command는 오류가 아니라 `disabled` 상태(또는 `false`)를 돌려준다.

55. **AuthGate는 셸 command 층 한 곳이다(§11·사용자 기준 2 "IPC 우회 불가").** 앱의 invoke 처리기가 모든 app command를 처리기로 보내기 전에 `App::gate_command`를 부른다(인자 역직렬화 전, ACL 뒤). **기본은 거부**: 허용 목록(`crates/shell/src/gate.rs` `OPEN_COMMANDS`) 밖의 command는 `SignedIn`(온라인·오프라인 유예·낙관)이 아니면 `notLoggedIn`이다. 허용 목록은 12개: `app_info`·`auth_*` 일곱·`frontend_ready`(기동 스모크)·`quit`(로그인 화면 뒤에서도 받기가 계속되므로 D1 [닫기])·`list_jobs`·`subscribe_jobs`(로컬 읽기, 받기를 일으키지 않는다). 새 command는 목록에 넣지 않으면 자동으로 로그인 필요다. 로그인을 쓰지 않는 빌드(`App.auth == None`)는 모두 통과하고, 앱 상태가 없으면(시작 실패) 허용 목록만 통과한다. ipc 테스트가 목록 밖 command 전부를 `{}`로 불러 `notLoggedIn` JSON(command가 `Err(AppError)`를 돌려줄 때와 같은 값)을 본다. 앱 상태 없이 만든 mock 앱에서도 같은 거부를 보고(`gate_without_app_state_fails_closed`), `gate_without_app` 표를 셸 테스트가 고정한다. 가짜 백엔드가 같은 목록으로 같은 거부를 흉내 내고(`gate-sync.test.ts`), Playwright `auth.spec.ts`가 그 분기(로그인 전 거부·허용 목록 통과·로그인 뒤 통과)를 IPC로 직접 본다(화면 흐름은 A3).

56. **재확인 고리(§11.3 "10분마다 벽시계·창 포커스·절전 복귀", 51의 타이머를 정한다).** (가) 셸 `auth::driver::run_driver`가 `startup()` 한 번 뒤 `min(next_wake − now, 30초)`(하한 1초)를 자고 `tick`을 부른다. "10분마다"를 30초 심장박동으로 바꾼다(`tick`은 예정 전이면 네트워크 없이 끝난다). 상태가 바뀌면 자던 것을 깨워 다시 계산한다. (나) **절전 복귀**: Tauri 2.12 데스크톱에는 복귀 이벤트가 없다(`RunEvent::Resumed`는 이벤트 루프 재개, 창의 `Suspended`·`Resumed`는 모바일 전용, 소스 확인). 잔 시간보다 벽시계가 60초 넘게 더 갔으면 `Trigger::Resume`이다. 절전 복귀 배선은 driver 테스트가 고정한다(백오프 30분 중 벽시계만 5분 뛰면 `Timer`로는 갱신하지 않고 루프가 `Resume`으로 갱신한다). (다) 포커스는 main 창 `WindowEvent::Focused(true)` → `tick(Focus)`. (라) 시작 갱신은 setup이 띄운 태스크에서 한다(세션이 없으면 네트워크 없음 — 기동 스모크가 Worker에 닿지 않는다). (마) 첫 성공 뒤 업데이트 확인(`take_first_online`)은 A4가 이 고리에 붙인다.

57. **재시작 후 자동 이어받기는 로그인 뒤로 미룬다(§11.5 "SignedIn이 된 뒤에 돈다").** 로그인을 쓰는 빌드는 매니저를 자동 이어받기 없이 열고, 설정이 켜져 있으면 처음 `SignedIn`(낙관 포함)이 보일 때 한 번 `resume_interrupted`를 부른다. 그래서 0.1.0에서 올라온 사용자의 멈춘 작업이 로그인 전에 받기 시작하지 않는다. "같은 채널 작업만"과 B1 문구 "로그인하면 이어받을 수 있어요"는 A5·A3다(0.1.0 작업은 `channelId`가 없어 A5에서 거부될 수 있다). 앱은 이 신호를 `forward_status` 콜백에서 보는데, watch 채널은 마지막 값만 읽혀 중간 값이 합쳐지므로 곧바로 다른 상태로 바뀐 짧은 `SignedIn`은 놓칠 수 있다. 그때 자동 이어받기는 다음에 실제로 보인 `SignedIn`까지 미뤄진다(받아들임: 잃는 작업은 없고 늦어질 뿐이다, PR 리뷰).

58. **Worker 주소 규칙(§11.1을 정한다).** (가) 규칙은 의존성 없는 `app/src-tauri/build_rules.rs`(`worker_base_rule(profile, value)`)이고 build.rs와 `src/lib.rs` 테스트가 `include!`한다. (나) 받는 모양은 **정규 출처** `scheme://host[:port]`뿐(소문자, 끝 `/`·경로·쿼리·조각·사용자 정보 없음, 기본 포트 없음, IPv6는 `[::1]`만)이다. 호스트의 마지막 조각이 숫자(10진 또는 `0x` 16진)면 WHATWG URL이 IPv4로 읽어 해석에 실패하거나(`a.1`) 다른 출처로 정규화하므로(`127.1`·`0x7f.0.0.1`·`01.2.3.4` → 점 넷 10진) 그런 호스트는 **정규형 점 넷 10진 IPv4**(각 0~255, 앞자리 0 없음)만 받는다(PR 리뷰). 릴리스(https) 규칙은 `release.mjs distBaseProblems`(`v === new URL(v).origin`)가 받는 집합과 거의 같고 대체로 더 좁다(IPv6는 `[::1]`만, 비ASCII 없음). 예외는 잘못된 punycode 조각(`xn--a` 등)으로, Rust 규칙은 받고 URL 해석은 실패한다(IDN을 막지 않으려고 코드로 거르지 않는다). 태그 빌드는 cargo 전에 `distBaseProblems`가 `DIST_BASE_URL`을 보므로 닿지 않고, 손으로 준 `CHZZK_WORKER_BASE`만 (라)로 간다. debug의 루프백 http는 `distBaseProblems` 밖이다. 받은 값이 `WorkerBase::parse(v).origin() == v`인 것은 `lib.rs` 규칙 표의 받는 행에서 확인한다. 릴리스: 없음·빈 값·https 아님·모양 틀림 → 컴파일 실패(이름만 찍는다). debug: 없으면 꺼짐, 있으면 https 또는 루프백 http. (다) build.rs는 rustc에 **늘** `CHZZK_WORKER_BASE_BUILD`(없으면 빈 문자열)를 넘긴다. 셸에 같은 이름을 두어 규칙을 건너뛰는 길을 막는다(`cargo:rustc-env`가 바깥 env를 덮는다, 실측). (라) 런타임에 빌드 값이 `WorkerBase::parse`를 통과하지 못하면(숫자 끝 호스트는 규칙이 거부한다. 알려진 남은 경로는 (나)의 잘못된 punycode 조각을 손으로 준 경우뿐이다) 시작 실패 안내로 끝난다(조용히 꺼지지 않는다). (마) `--features e2e`에서 E2E가 켜지면(`CHZZK_E2E_API_BASE`+`CHZZK_E2E_DIR`) 빌드 주소는 쓰지 않고 `CHZZK_E2E_WORKER_BASE`(루프백 http)만 쓴다(없으면 로그인 꺼짐). 하나만 있으면 시작하지 않는 기존 규칙에 세 번째 env도 따른다(`CHZZK_E2E_WORKER_BASE`만 있으면 오류). 코드는 `e2e.rs`에만.

59. **`features.auth` = 로그인 서비스가 있다.** 원천은 58의 설정 하나다(릴리스는 늘 true). 기동 스모크 마커에 `auth`를 더해 **설치 스모크(릴리스 번들)가 `auth:true`를 요구**한다: 규칙이 실제 산출물에서 지켜졌다는 증거다(PR·master 번들은 자리표시 주소, 태그는 실제 주소). debug `smoke-bin`은 보지 않는다.

60. **받아들인 위험·순서.** (가) **A2만 있는 릴리스는 쓸 수 없다**(게이트는 켜졌는데 화면이 로그인을 모른다). A2 머지 뒤 A3 머지 전에는 태그를 만들지 않는다(ROADMAP). 약속만으로 두지 않고 **`release.mjs`의 `TAG_BLOCK`(`'phase3b-a3'`) 상수가 tag 모드 gate를 맨 앞에서 1로 막는다**(release.yml `gate` 작업, 리허설·stage·selftest는 막지 않는다, env로 끄는 길 없음, `release.test.mjs`가 고정). **A3 PR이 이 상수를 지운다**(PR 리뷰). (나) 태그 빌드 artifact(공개 저장소, 로그인한 누구나, 1일)에는 Worker 주소가 들어 있다. 주소는 배포 앱·매니페스트·랜딩에 원래 들어가는 값이고 cicd 84는 로그만 다룬다. (다) 로그인이 풀린 뒤(차단·유예 만료) 이미 돌고 있는 받기를 사용자가 멈출 길은 지금 앱 종료뿐이다(`pause_job`도 게이트 뒤다). 코드는 그대로 두고, **A3 화면 설계에서 `pause_job`을 허용 목록에 넣을지 정한다**(넣어도 `resume_job`은 막혀 있어 게이트 우회가 아니다, PR 리뷰).

61. **[다시 연결](`auth_retry`)은 온라인 `SignedIn`의 예정 전 갱신을 보내지 않는다(PR 리뷰).** `auth_retry`는 허용 목록이고 화면이 버튼을 어디에 둘지는 A3가 정하므로, 셸이 연타를 막는다: `AuthService::retry`는 `SignedIn`·오프라인 아님·시계 되돌림 아님·`refresh_due_at` 전이면 네트워크 없이 지금 상태를 돌려준다(토큰 회전·DO 쓰기를 늘리지 않는다, 비용 0). 오프라인·`Checking`·유예 만료 화면·예정이 지난 경우는 `next_retry_at`을 기다리지 않고 바로 갱신한다(사용자가 누른 것이다). 동시 호출은 기존 single-flight가 하나로 묶는다. `refresh()`는 내부·테스트용으로 남는다.

62. **앱 로그인 화면(§11.7을 정한다, Phase 3b A3).** (가) 프런트 게이트는 `AuthStatusDto.state` 하나로 판정한다(`disabled`·`signedIn`이 아니면 로그인 화면만, 첫 상태 전에는 본문을 그리지 않는다). 게이트는 뷰가 아니라 App의 분기라 단축키·Esc로 둘러 갈 수 없고, 잠긴 동안 단축키·배너(B1)·이전 설정 대화상자(D3)·[설정]을 끈다. 셸 command 게이트(55)가 권위다. (나) 상태·사유별 제목·설명·버튼은 순수 함수 `loginScreen`(`app/src/lib/auth.ts`) 표 하나다. 로그인 거부(poll `denied`, 사유 없음)와 허용목록 제외(`RemovedFromAllowlist`)를 문구로 나누고 둘 다 [다른 계정으로 로그인] + 네이버 로그아웃 안내를 보인다. (다) `auth.revoked`는 원인을 단정하지 않는다(48): "로그인이 끊겼어요 / 이 기기의 로그인이 더 이상 유효하지 않아요." `ReuseDetected`는 같은 제목 + "보안을 위해 다시 로그인해 주세요." (라) **Checking 화면**: §11.7의 "최대 10초 뒤 [다시 연결]·[다시 로그인]"을 바꾼다. 셸이 Checking을 약 40초 안에 끝내므로(49·53 (가)) 프런트 타이머가 없고, 스피너와 "최대 40초쯤 걸려요" 아래 [다시 로그인](링크형)을 처음부터 보인다(로그인은 Checking에서도 시작한다, 50 (다)). (마) 확인 코드는 문구("브라우저에 이 코드가 보이는지 확인하세요")와 따로 고정폭으로 크게 그린다(§11.7의 "…: {code}"를 바꾼다). 남은 시간은 `pending.expiresAt`(로컬 기한, 50 (가))으로 1초마다 계산한다. (바) 유예 만료 화면의 [다시 연결]은 주 버튼이고, 눌러도 같은 상태면 "아직 연결되지 않았어요"를 보인다. 온라인 [다시 연결]은 셸이 무시하므로(61) 계정 메뉴에서도 오프라인일 때만 보인다. (사) 업데이트 배너는 표시 전용 `UpdateBanner`와 copy만 두고 배선은 A4(§11.6)다. B3(`banner.sessionExpired`)와 설정의 계정 섹션(S2-a)은 만들지 않는다: 로그인이 풀리면 바로 로그인 화면이고, 채널·마지막 확인·로그아웃은 헤더 AccountSlot이 맡는다. (아) 로그인 화면은 받는 중 작업이 있으면 "계속 받아요. 멈추려면 앱을 닫으세요"를, 없고 중단된 작업이 있으면 `banner.resumeNeedsLogin`을 안내 한 줄로 보인다(버튼 없음). (자) 로그인 화면은 `authLogin`을 스스로 부르지 않는다(설치 스모크는 자리표시 Worker 주소로 `auth:true`다). (차) 앱 층 `Esc`는 로그인 화면에서도 `ui.escape`를 부르지만 처리기가 없고 뷰가 이미 홈이라 아무 일도 없다.

63. **`pause_job`은 허용 목록에 넣지 않는다(60 (다)를 닫는다).** 로그인 화면은 작업 목록을 그리지 않아 [일시정지]를 둘 자리가 없고, 멈추는 길은 창 닫기(D1 → `quit`: 일시정지·`jobs.json` flush, 로그인 뒤 이어받기)로 충분하다. 허용 목록은 12개 그대로(ipc 테스트의 게이트 뒤 17개도 그대로).

64. **로그인 설정 시작 실패 문구.** 시작 실패 중 빌드 Worker 주소 해석 실패(58 (라))와 로그인 클라이언트 생성 실패(`chzzk_shell::AUTH_CLIENT_FAILED`)는 "로그인 서버 설정을 읽지 못했어요. 설치 파일이 손상됐을 수 있어요. 앱을 내려받은 페이지에서 다시 받아 설치해 주세요."(`StartupFailure::AuthConfig`)로, 나머지는 기존 디스크·폴더 권한 문구로 나간다. 세션 파일 문제는 시작 실패가 아니다(47 (마)).

65. **태그 차단 해제·포커스 배선 테스트(60 (가)·56 (다)).** `release.mjs` `TAG_BLOCK`·`tagBlockProblem`과 그 테스트를 지웠다(A3 머지로 A2→A3 태그 금지가 끝난다. 태그 자체는 사용자 승인). 포커스 처리는 `on_window_focus(app, label, focused)`로 빼서 `on_run_event`가 부르고(`RunEvent::WindowEvent`는 `#[non_exhaustive]`라 테스트에서 만들 수 없다), ipc 테스트가 main 포커스 → `tick(Focus)` → refresh, 예정 전 세션·다른 창·로그인 꺼짐의 음성, `spawn_auth_tasks`의 시작 refresh → `auth-changed`(낙관 `signedIn` → `expired`/`revoked`)를 본다. 테스트 Worker는 Worker 형식 401이다(5xx·HTML은 유실 재시도 묶음을 탄다, 53 (가)). `on_run_event`의 `Focused` arm이 `on_window_focus`를 부르는지(한 줄 배선)는 테스트 밖이다.

66. **A3 리뷰 반영(로그인 화면 동작).** (가) 프런트 auth store의 진행 표시는 동작별이다(`login`·`reconnect`·`reopen`·`copy`·`cancel`·`logout`). 같은 동작만 겹치지 않게 막고 버튼도 그 동작만 끈다: [다시 연결](Checking, 최대 약 40초, 49)이나 로그아웃(서버 로그아웃 최대 10초)을 기다리는 동안에도 [다시 로그인]·[치지직으로 로그인]은 눌린다(62 (라)·50 (다)). 경합은 셸의 single-flight·세대 검사가 맡고, 프런트는 상태가 바뀐 횟수를 세어 동작 시작 뒤 이벤트·다른 응답이 있었으면 늦게 온 응답을 버린다(이벤트가 이긴다. 셸은 상태를 바꿀 때마다 `auth-changed`를 내므로 — `begin_login`·`refresh_inner`·취소·로그아웃 모두 `publish` — 버린 응답의 상태도 이벤트로 온다). (나) "아직 연결되지 않았어요"는 [다시 연결]이 바꾸지 못한 상태의 키를 기억해 지금 상태가 그 키일 때만 보인다. Checking은 지나가는 상태라 기억을 지우지 않는다(응답이 `auth-changed`보다 먼저 와도 안내가 남는다). 응답이 올 때 사용자가 이미 다른 상태(로그인 등)로 옮겼으면 기억하지 않는다. 계정 메뉴의 [다시 연결] 뒤에도 오프라인이면 같은 문구를 토스트로 알린다. (다) 원인을 단정하지 않는다(48과 같은 원칙): `auth.graceExpired`는 "로그인 서버에 한동안 연결하지 못했어요 / 연결 상태를 확인한 뒤 다시 연결해 주세요. 받던 다운로드는 계속돼요."(§11.7 표의 "3일 넘게"·"인터넷"을 바꾼다: 시계 되돌림도 유예 밖이고 서버 오류도 일시 오류다). 상태를 묻지 못했을 때(`error`, 사유 없음)는 `auth.unknown` "로그인 상태를 확인하지 못했어요 / 잠시 뒤 다시 로그인해 주세요."로 `network`·`server`와 나눈다. (라) 확인 코드는 보이지 않는 머리말 "확인 코드"와 한 문단이다(`<p>`에 붙인 `aria-label`은 ARIA상 쓸 수 없다). 전체 선택(`user-select: all`)은 코드 글자에만 둔다. (마) 로그인 화면의 "계속 받아요" 안내는 받는 중·대기 중 작업을 함께 센다(§11.5: 잠긴 동안에도 대기 작업은 차례로 시작된다). (바) **받아들인 제약**: 로그인 시도가 `Cancelled`가 아닌 종결(`Expired{LoginTimeout}`·`Error`·`Denied`)로 끝나면 저장 세션이 남아 있어도(D19·50 (라)) 화면에 [다시 연결]이 없다. DTO에 저장 세션 유무가 없어 프런트가 고를 수 없고, 세션이 없을 때 [다시 연결]을 보이면 "아직 연결되지 않았어요"가 오해를 부른다. [다시 로그인] 한 번이나 앱 재시작(시작 때 Checking)으로 복구된다. 셸에서 고치려면(DTO에 `canReconnect` 등) 뒤 단계에서 다룬다(ROADMAP "A4 인계"). (사) **세션 만료 문구는 원인을 단정하지 않는다**(48): 401 `invalid_token`과 `session_expired`가 둘 다 `Expired{SessionExpired}`로 오므로(셸 DTO는 그대로) `auth.sessionExpired`는 "로그인이 만료됐어요 / 다시 로그인해 주세요."다(§11.7 표의 "로그인한 지 오래돼…"를 바꾼다). (아) 사유 `server`는 Worker 형식 4xx(400·429 등)도 받으므로 서버 탓으로 단정하지 않는다: "로그인 요청을 처리하지 못했어요 / 잠시 뒤 다시 시도해 주세요." (자) `pending`인데 `pending`(코드·기한)이 없으면 그릴 것이 없어 버튼 없는 화면이 되므로, `loginScreen`이 `auth.unknown` 문구 + [다시 로그인]으로 돌린다. (차) 잠금이 풀리면(로그인 성공) 누르던 로그인 화면이 사라져 포커스가 body로 떨어지므로, App이 잠김 → 열림 전환에서 `tick()` 뒤 포커스가 body면 홈 입력줄(`ui.urlTarget`)로 옮긴다(뷰 전환과 같은 규칙, 처음부터 열린 시작은 옮기지 않는다).

A4-1. **updater command(§9.3·§11.4·§11.6을 정한다, Phase 3b A4).** (가) command는 셋이다. `update_check`(네트워크, 설정 > 정보 [업데이트 확인]), `update_install(confirmPause)`, `update_available`(자동 확인이 찾아 둔 값, 네트워크 없음). 셋째는 웹뷰가 `update-available`을 듣기 전에 끝난 자동 확인을 놓치지 않으려고 둔다(듣고 나서 묻기, `auth.start`와 같다). §11.4의 `update_check(manual)`은 인자 없는 `update_check`가 된다. 자동 확인은 command가 아니라 셸 안에서 돈다. (나) 결과 DTO는 `UpdateCheckDto`(`available{info}`·`upToDate`·`offline`·`failed`·`untrusted`)와 `UpdateInstallDto`(`needsConfirm{running}`·`upToDate`·`offline`·`failed`·`untrusted`·`busy`·`restarting`)다. §11.4의 `Option<UpdateInfoDto>`와 "실패는 조용히"를 바꾼다. 수동 확인은 오프라인과 실패를 다른 문구로 보여야 한다. `UpdateProgressEvent`의 `Chunk`는 누적 `received`와 `total`을 싣고, 정수 퍼센트가 오를 때만(크기를 모르면 1 MiB마다) 보낸다. `UpdateInfoDto.pubDate`는 유닉스 초다(54 (나)). (다) 셋 다 게이트 허용 목록 밖이다(55의 12개 그대로, 게이트 뒤 17 → 20). 모두 access 토큰이 필요하고 잠긴 화면에는 업데이트 UI가 없다. (라) 판단은 셸 `chzzk_shell::update`(Tauri 비의존: `UpdateSource`·`InstallHost` seam, `Updates` 캐시·동시 실행 가드, `ProgressThrottle`)에 있고, 플러그인 호출은 앱 `update_io.rs`에 있다. 플러그인을 등록했다는 표식 `UpdaterPlugin`이 없으면 확인하지 않는다(`updater_builder()`는 플러그인 상태가 없으면 패닉한다). (마) 확인은 `ensure_fresh_access()`가 토큰을 줄 때만 한다. 그 뒤 빌더를 새로 만들어 endpoint `{base}/update/{{current_version}}`과 `Authorization: Bearer`(민감 표시 `HeaderValue`), 확인 시간 제한 10초를 넣는다. 다운로드는 제한하지 않는다. 플러그인 2.13.1은 2xx가 아닌 응답을 `ReleaseNotFound`로 합치므로 401이든 5xx든 `failed`이고, 세션은 셸 판정만 바꾼다. 출처는 `WorkerBase::same_origin`(문자열, 기본 포트 생략)으로 대조하고 다르면 `untrusted`로 끝내며 받지 않는다. (바) 플러그인 오류는 Display(reqwest는 URL을 담는다) 대신 낱말(`release_not_found`·`network`·`signature`·`other`)만 로그에 남긴다.

A4-2. **설치 순서와 설치 실패(§11.6 (3)(4)를 정한다).** (가) 순서: 동시 실행 가드 → 받는 중 작업이 있고 `confirmPause=false`면 `needsConfirm`(네트워크 없음) → 세션 판정 → check → 출처 → download(서명 확인 포함) → quit 경로(`begin_quit`) → install → macOS·Linux `request_restart()`. 다운로드와 서명 확인이 quit보다 먼저라 그 실패에서는 받던 작업이 멈추지 않는다. (나) quit 뒤 `install()`이 실패하면 매니저의 `cancel_quit()`이 그 quit이 멈춘 작업만 다시 줄 세우고 스케줄러를 켠다. 앱은 `Quitting`을 되돌린다. 되돌리지 않으면 창 닫기가 영구히 조용히 막히고 대기 작업이 시작하지 않는다. 옛 버전으로 재시작하는 길은 고르지 않았다(실패가 반복되면 누를 때마다 다시 뜬다). (다) `request_restart()`는 `ExitRequested{code: Some}`이라 닫기 가드를 지나고 `Exit`에서 flush한다. (라) Windows `install()`은 설치기를 띄운 뒤 프로세스를 끝낸다(flush는 quit 경로가 이미 했다). (마) Linux `.deb`의 pkexec, macOS quarantine 재질문, 실제 R2의 `/releases` 다운로드는 **[실기기 확인 필요]**로 남긴다.

A4-3. **자동 확인(56 (마)를 닫는다).** `spawn_auth_tasks`의 상태 전달 콜백이 `App::take_auto_update_check`(온라인 SignedIn이고 `take_first_online()`)를 보고 확인을 한 번 띄운다. 찾으면 캐시하고 `update-available`을 main 창에 보낸다. 실패는 로그뿐이고 이 실행에서는 다시 확인하지 않는다(수동 확인은 된다). watch가 합친 값에서 SignedIn을 놓쳐도 `take_first_online`이 `Ready`로 남아 다음 SignedIn에서 돈다. 저장 세션이 없는 스모크는 시작 refresh가 없어 확인도 없다.

A4-4. **[다시 연결]을 저장 세션 유무로 보인다(66 (바)를 닫는다).** `AuthStatus.has_session`(메모리에 저장 세션이 있다)을 `AuthStatusDto.canReconnect`로 보낸다. `loginScreen`은 메시지 화면에서 `canReconnect`이면 [다시 연결](secondary)을 붙인다(유예 만료는 이미 있어 중복하지 않는다). 로그인 시간 초과·오류·거부·취소 뒤에도 저장 세션이 남아 있으면(D19) 로그인 없이 복구된다. `retry()`는 그 상태에서 refresh한다. 폐기·만료·제외는 세션을 지우므로 false다.

A4-5. **받아들인 위험.** (가) 플러그인의 `requireSignedVersion`(서명에 든 버전과 매니페스트 버전 대조)은 켜지 않았다. 우리 xtask 서명이 trusted comment에 버전을 넣는지 확인하지 않았고, 켰는데 버전이 없으면 모든 업데이트가 거부된다. 다운그레이드 재생은 Worker나 R2가 침해됐을 때만 생긴다. 다음 릴리스 작업에서 xtask 서명 형식을 확인한 뒤 켤지 정한다. (나) `download()`는 전체를 메모리에 받는다(§9.3, AppImage 약 86 MB). (다) 다운로드는 Worker 출처로만 간다. 리디렉션은 Worker가 0건이고(31 (라)) reqwest는 다른 호스트로 리디렉션할 때 `Authorization`을 뺀다.

A4-6. **로컬 확인 결과(CI 확인 대기).** macOS에서 앱 crate를 컴파일하고 ipc 테스트까지 돌렸다. `generate_context!(test = true)`는 `plugins.updater` 설정을 싣고, 실제 updater 플러그인을 mock 앱에 등록해 `update_check`의 200·204·401·출처 불일치와 자동 확인 이벤트가 통과했다. `header(HeaderName, HeaderValue)`는 그대로 컴파일된다. **Linux·Windows는 CI 확인 대기**다(플러그인이 플랫폼 키·설치기 종류를 OS마다 다르게 해석하고 `update_server`는 `target()` 키 하나만 준다). 실패하면 ipc 실플러그인 테스트 다섯(available·204·401·foreign·auto)을 테스트 안의 fake `UpdateSource` 판(`App::update_check(&fake)`, 같은 단언)으로 바꾼다. 기존 ipc 5초 기한은 PR #44 두 실행과 master 실행 37770685544의 `tauri (windows-latest)`가 모두 녹색이라 그대로 두고, 새 네트워크 테스트는 10초 기한이다.

A4-7. **배너 우선순위의 한 군데 예외.** 배너는 B2 > B1 > B4 하나만 보이지만(62 (사)), 업데이트를 받는 중·설치 중(`update.busy`)에는 B4 진행 문구가 가장 앞이다. 설치가 받던 작업을 멈추면 B1("중단된 다운로드")이 켜져 "설치하고 다시 시작해요…"를 가리기 때문이다.
