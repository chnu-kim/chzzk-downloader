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
- **무료 한도 계산**(최악, 하루): 공격자 start 32행 × 144순환 × 쓰기 2 ≈ 9,200, [계속] ≤ 4,600, 거부 기록 ≤ 4,800, 정상 사용자 20명 refresh 3회 × 3행 + 로그인 < 300 → **≈ 19,000 < 100,000**. 요청 수(10만/일)는 쓰기 없이도 소진될 수 있어 Cloudflare WAF 요청 수 제한 규칙은 배포 때 사용자와 넣는다(Q4). 폴링은 2초 × 10분 = 최대 300요청/로그인, 쓰기 0.

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
| 음성 | `GET /admin`(CI 토큰) → 200이 아님(303), `GET /releases/latest.json`(토큰 없음) → 401, `GET /api/me`(CI 토큰) → 401 |

실패하면 exit 1 → `ci-loop:release`. Worker 되돌리기는 사람이 `wrangler rollback`(DO 선언 변경은 rollback으로 되돌아가지 않으므로 DO 선언을 바꾸는 PR은 따로 낸다). `VERIFY_VIA=worker`이면 verify는 **이미 배포된 Worker**로 읽으므로(deploy-worker가 verify 뒤) 키 계약은 버전 사이에 넓히기만 하고, 좁히는 변경은 Worker를 먼저 배포한다(cicd.md §5 "3단계 앞으로").

### 9.5 랜딩 UX (`/`, 스크립트 없음)

- 비로그인: "치지직 다운로더 — 허가된 채널만 받을 수 있어요." [치지직으로 로그인]. "앱을 이미 받았으면 앱 안에서 로그인해요."
- 허용: 최신 버전·게시 날짜, OS별 표(macOS `.dmg`(Apple Silicon 전용 안내), Windows `-setup.exe` 기본·`.msi`, Linux AppImage·`.deb`)에 크기(R2 head)·SHA-256 [복사 없음, 텍스트]. 설치 안내 접힘 패널(`<details>`): macOS Gatekeeper "그래도 열기"(macOS 15 이후 문구는 실기기 확인 **[확인 필요]**)와 `xattr -dr com.apple.quarantine`, Windows SmartScreen "추가 정보 → 실행", Linux `chmod +x`·`apt install ./…deb`. "앱을 연 뒤 이 페이지와 같은 치지직 계정으로 로그인해 주세요." 아래 "내 기기". 관리자면 [관리].
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

- `.dev.vars`는 `.gitignore`(`.dev.vars`·`.dev.vars.*`, 예외 `.dev.vars.example`). 로컬의 `worker/.dev.vars`는 1Password Environment `chzzk-downloader-worker`의 **마운트(FIFO, 고칠 수 없음)**이고 `CHZZK_CLIENT_ID`·`CHZZK_CLIENT_SECRET` 두 줄만 있다. 그래서 dev 명령은 둘로 나누고 늘 `--env-file`을 명시한다(wrangler는 `--env-file`을 주면 기본 `.dev.vars`를 읽지 않는다 **[확인 필요, W1 첫 작업]**):
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
| 저장소 변수(환경 `release`에서 옮김) | `DIST_BASE_URL` | variable | 매니페스트 url 접두 = Worker 출처 = 앱 빌드 `CHZZK_WORKER_BASE`. 경로 없는 https 출처 |
| 저장소 변수 | `R2_BUCKET`(secret에서 옮김) | variable | 버킷 이름은 `wrangler.jsonc`에 커밋되므로 비밀이 아니다(cicd.md 82) |
| 환경 `release` | `CLOUDFLARE_API_TOKEN`(Workers Scripts 편집, 계정 하나. R2 바인딩 배포에 R2 권한이 더 필요한지 **[확인 필요]**), **`CLOUDFLARE_ACCOUNT_ID`**(새 secret) | secret | deploy-worker. `wrangler.jsonc`에 `account_id`를 두지 않는다 |
| 환경 `release` | `CI_VERIFY_TOKEN` | secret | verify(`VERIFY_VIA=worker`)와 deploy-worker 검사 |
| 환경 `release` | `VERIFY_VIA`(`s3`→`worker`), `WORKER_DEPLOY_ENABLED`(`false`→`true`) | variable | 전환 스위치(§16 W9 순서) |

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
- **`deploy-worker`**: `needs: [gate, verify, worker-bundle]`, env `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`·`CI_VERIFY_TOKEN`(secret)·`DIST_BASE_URL`·`RELEASE_VERSION`·`BUILD_ID`. `release.mjs worker`: (1) artifact sha256 = 출력(다르면 2), (2) 묶음 안의 wrangler로 `deploy --no-bundle -c dist/wrangler.json --var PUBLIC_ORIGIN:$DIST_BASE_URL --var BUILD_ID:<sha7>`(설치·컴파일 없음), (3) §9.4 검사(5xx·네트워크 4회 재시도, 판정 실패 1, 기반 시설 2). `--check-only --base <url>`는 배포 없이 (3)만(selftest·로컬). `pnpm dlx`는 쓰지 않는다(lockfile을 거치지 않는다, cicd.md §5 예시를 바꾼다).
- **[확인 필요]**(묶음 W8 첫 dry-run): (가) `--no-bundle` + `exports` 선언 + `--var`가 함께 배포되는지, (나) `--ignore-scripts`로 깐 wrangler가 deploy에 workerd를 요구하지 않는지(npm 변형은 실측됨, pnpm 변형 확인). 안 되면 `release.mjs`가 Workers 스크립트 업로드 API(multipart: 번들 + metadata.json의 바인딩·DO)를 node fetch로 직접 부른다(설치되는 코드 0).
- `release-selftest`에 사례 추가: `--check-only`를 로컬 가짜 Worker(작은 node:http 스텁)에 돌려 정상·204 틀림·200 틀림·음성 틀림 각각 exit 1.
- Worker secret은 CI가 넣지 않는다(사용자 `wrangler secret put` 4개). API 토큰 권한은 그 Worker 스크립트 배포만.
- `worker/deploy/`의 lockfile도 관리 대상이다: `dependabot.yml` npm `/worker/deploy`(그룹 `cloudflare`), `advisories`에 `pnpm audit`(cwd `worker/deploy`), `_typos.toml`에 `worker/deploy/pnpm-lock.yaml`, `worker-config.mjs`가 두 lockfile의 `wrangler` 버전이 같고 `tools.json` `wrangler`와 같은지 검사한다.
- 시크릿 작업이 wrangler(전이 의존성 포함)를 실행하는 것은 D10의 글자("설치·컴파일 없음")는 지키지만 취지("시크릿 옆에서 서드파티 코드를 돌리지 않는다")에는 못 미친다. 그래도 API 직접 업로드를 기본으로 올리지 않은 이유: (1) `exports` 형식 DO의 업로드 API metadata 모양이 미확인이라 실패 경로가 하나 더 늘고, (2) 배포 토큰은 그 Worker 스크립트 편집 권한뿐이며, (3) 정말 위험한 자산(Worker secret)은 어느 경로든 번들 안의 코드가 읽는다(R3) — 번들은 `worker-bundle`이 만들고 거기엔 시크릿이 없다. 묶음 안 wrangler는 lockfile 고정 + `--ignore-scripts`라 설치 시점 실행 코드가 없다. W8 실측에서 (가)(나)가 안 되면 그때 API 경로로 간다.
- D10의 한계(위험 R3): 시크릿 작업의 배포 토큰은 지키지만 `worker-bundle`에 들어온 악성 dev 의존성이 번들에 코드를 끼우면 운영 Worker 안에서 secret을 읽는다. 줄이는 수단: 런타임 의존성 0, 정확 고정 + lockfile + cooldown 7일, `worker-config.mjs`의 번들 모듈 목록 검사.

---

## 14. 비밀값 위생·로그 (구멍 12)

- 로그는 `log(event, fields)` 하나. 한 줄 JSON, 허용 필드(타입으로 강제): `event, level, route(패턴, 실제 경로 아님), method, status, stage, timedOut, durationMs, flowKind, reason, sessionIdPrefix(앞 6자), chzzkCode`. **금지**: 쿼리스트링, 토큰·해시·쿠키, code·state·handle·loginId·pollSecret, 채널 id·이름(거부·허용 이벤트도 id 없이 — 관리 화면·audit 테이블이 그 역할), 외부 응답 본문, IP 원문. 이벤트 예: `auth.login.ok`, `auth.login.denied`, `auth.login.failed{stage}`, `auth.refresh.rejected{reason}`, `auth.refresh.reuse_detected`, `admin.allow`, `release.forbidden_key`, `config.error{key}`.
- `console.*` 직접 호출 금지(테스트: 소스의 `console.` 사용처가 `log.ts` 하나뿐).
- 예외가 라우터 밖으로 나가면 500 `internal`, 로그엔 `error.name`만(메시지에 URL이 들어 있을 수 있다).
- 콜백은 처리 뒤 즉시 쿼리 없는 URL로 303 + `Referrer-Policy: no-referrer`. `wrangler.jsonc` observability의 invocation 로그는 끈다(URL에 `code`·`state`가 실린다. 키 이름 **[확인 필요]**, 없으면 `observability.enabled: false`로 두고 직접 로그만).
- `hygiene.test.ts`: 카나리 값(code·state·client secret·토큰·채널 id·이름)을 넣고 모든 흐름·실패 경로를 돈 뒤 로그 수집기와 응답에 카나리가 없음을 단언(§12.2).
- 앱 셸: Worker 응답 본문을 오류에 담지 않는다(`code`만). reqwest 오류는 `redact_url`. `Authorization` 헤더를 로그에 남기지 않는다. `session.json` 경로는 로그에 남겨도 내용은 안 된다.

---

## 15. channelId 동일성 게이트 (구멍 8)

ROADMAP Phase 3에 **미체크 단계**로 둔다: `- [ ] G-ID: OAuth users/me channelId == VOD content.channel.channelId == 클립 content.ownerChannel.channelId (실제 로그인, 사용자가 직접)`. 이 단계가 체크되기 전에는 앱의 `OwnershipGate`를 켜지 않는다(본인 영상 검사가 전부 거부·전부 허용으로 틀어질 수 있다). 로그인·허용목록·업데이트는 그 전에도 릴리스에 켤 수 있다.

**절차**(사용자 본인이 로컬에서, 5분). 도구는 이미 있는 `worker/scripts/channel-id-check.mjs`(Node만, Worker 불필요, 포트 8787에 자기 콜백 서버를 띄우므로 `wrangler dev`를 먼저 끈다):

1. `worker/.dev.vars`를 1Password Environment `chzzk-downloader-worker`로 마운트한다(값은 대화·로그에 내지 않는다).
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
| **W9** | 배포 뒤(사용자와, 체크박스만) | Worker secret 4개 `wrangler secret put`, 수동 첫 배포(`--var PUBLIC_ORIGIN`), `/health` 200, `Content-Length` 실측, exports DO 실배포 확인, production 리디렉션 URL 등록, `DIST_BASE_URL`·`R2_BUCKET` 저장소 변수·`CLOUDFLARE_ACCOUNT_ID` secret, WAF 요청 수 규칙(Q4), `WORKER_DEPLOY_ENABLED=true` → 첫 실제 릴리스는 `VERIFY_VIA=s3` → Worker가 떠 있음을 확인한 뒤 `VERIFY_VIA=worker`와 태그 모드에서 worker 요구(cicd.md 72 "반영하지 않은 것" (2)), G-ID(§15) | 실제 실행 |
| (Phase 3b) **A1~A5** | 앱 | A1 `SessionStore`·`classify_verify` 표·`WorkerApi` + reqwest 구현·`AuthService`(가짜 WorkerApi·Clock) / A2 command·DTO·bindings·`build.rs` 주소 규칙·`CHZZK_E2E_WORKER_BASE`·가짜 백엔드·ipc.rs / A3 프런트 LoginView·AccountSlot·오프라인 배지·업데이트 배너·대화상자·copy deck·Playwright / A4 updater command(출처 대조·설치 흐름) / A5 OwnershipGate·resume 규칙 활성(G-ID 녹색 뒤) + 네이티브 E2E(fixture 서버에 Worker 스텁 라우트) | 각각 Rust·vitest·Playwright. 상태 전이 표 전부, 72h 경계와 `refreshExpiresAt`(60일 상한)으로 잘린 유예, single-flight, 쓰기 실패, release-hygiene 확장 |

---

## 17. 위험·열린 질문

### 위험

- **R1 A3 사회공학**: 확인 코드·경고·내 기기로 줄이지만 피해자가 코드까지 맞다고 믿고 [계속]을 누르면 공격자가 세션을 받는다. 피해는 앱·설치 파일 사용(정책 수준)이고, 관리자는 세션 목록의 `client`·시각으로 찾아 끊는다.
- **R2 새 로그인 잠금이 싸다**: 비만료 흐름 32개 상한은 공격자가 10분마다 32번 start하면 정상 사용자의 새 로그인을 막는다(503). IP 스로틀(IPv6 /64)이 단일 호스트를 막고, 분산 공격은 Q4(WAF)로. 이미 로그인한 사용자는 영향이 없다(상한은 `flow`만 묶는다).
- **R3 D10은 배포 토큰을 지킬 뿐 번들을 지키지 않는다**(§13.4).
- **R4 단일 DO 처리량**: 사용자 수가 허용목록 크기라 수용. 커지면 세션을 채널별 DO로 나눈다(이름 체계 이전 필요).
- **R5 `exports` 선언 형식**은 2026-06 도입이라 실제 배포는 미실측. 첫 수동 배포에서 확인하고, 실패하면 아직 배포 전이라 레거시 `migrations [{tag:"v1", new_sqlite_classes:["AuthStore"]}]`로 바꿀 수 있다.
- **R6 미검증 묶음**: `setAlarm` 덮어쓰기(W3 첫 테스트), dry-run의 `dist/wrangler.json` 생성·`--var` 값의 `:`(W1), `--log-level warn`의 요청 줄(W7), wrangler dev가 `CF-Connecting-IP`를 덮는지(W7), invocation 로그 키 이름, `--no-bundle`+exports+`--var`, `--ignore-scripts` pnpm 변형, pnpm 12 빌드 허용 키·`minimumReleaseAge`, msw 미처리 요청 옵션, `vi.setSystemTime`과 DO, `--env-file`, 스트림 `Content-Length` 실배포, Error 1027의 HTTP 상태(앱은 401·403이 아닌 4xx를 Error로 보므로 유예 표를 W9 뒤 고친다). 모두 해당 묶음의 첫 작업에서 실측한다.
- **R7 치지직 앱 90일 미사용 삭제**: 갱신은 치지직을 부르지 않으므로 슬라이딩 세션만으로는 스코프 사용량이 0일 수 있다. 대책은 Q1 답변의 **절대 상한 60일**이다: 앱을 계속 쓰는 사용자도 60일마다 치지직으로 다시 로그인하므로(토큰 교환·`users/me`) 90일 창 안에 사용이 생긴다. 다만 무엇을 "사용"으로 세는지(인가·토큰 발급·API 호출 중 무엇인지)는 여전히 **[확인 필요]**이고, 앱 사용자가 아무도 없으면 관리자의 주기적 랜딩 로그인이 남은 대책이다.
- **R8 updater가 전체를 메모리로 받는다**(수백 MB). 범위 밖.

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

- **Q9의 범위**: 본문 §0·§2 "Worker 주소"·§10.3 표·§11.1·§13.4·§16 W9의 "저장소 변수 `DIST_BASE_URL`"은 고치지 않았고 cicd.md 84가 이긴다. 환경 `release`의 secret이 아니라 **저장소** secret인 이유는 앱 릴리스 빌드(`build (os)`)가 환경 밖에서 `CHZZK_WORKER_BASE`로 그 값을 받아야 해서다(cicd.md 82 (가)의 "저장소로 옮김"은 그대로). 워크플로의 `vars.DIST_BASE_URL` → `secrets.DIST_BASE_URL` 교체는 W8에서 한다(바뀔 곳 목록은 cicd.md 84).

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
