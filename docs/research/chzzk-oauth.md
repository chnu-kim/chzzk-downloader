# 치지직 OAuth 조사 (Phase 3 사전 확인)

조사일: 2026-10-05. 근거 우선순위는 (a) 같은 OAuth를 이미 쓰는 비공개 웹 앱의 구현(이하 "기존 웹 앱"), (b) chzzk MCP, (c) 공식 문서(`https://chzzk.gitbook.io/chzzk/llms-full.txt` 전문)다. 각 항목에 근거를 표기했다. "확인 불가"는 어느 출처에도 없다는 뜻이다.

## 1. 요약

- 인가 URL은 `https://chzzk.naver.com/account-interlock`, 토큰 API는 `https://openapi.chzzk.naver.com`이다. 파라미터 이름은 camelCase(`clientId`, `redirectUri`)다.
- PKCE는 없다. 토큰 교환은 `clientSecret`이 필수라 데스크톱 앱이 직접 교환할 수 없다. Worker 대행이 맞다.
- **Redirect URI는 앱 등록 시 입력한 값과 정확히 일치해야 한다.** loopback 임의 포트와 커스텀 스킴 허용 여부는 확인 불가다. 문서 예시가 `http://localhost:8080/api/path`이긴 하나 규칙 문서는 아니다. 설계는 "HTTPS Worker 콜백 하나만 등록"으로 가정해 이 불확실성을 피한다.
- OAuth `channelId`와 서비스 API(영상 정보·클립 play-info)의 `channelId`는 같은 32자리 hex 형식이다. 단 **OAuth `users/me` 값과의 직접 대조는 실제 로그인이 필요해 미실시**다(10절).
- 클립은 `ownerChannel`(스트리머)과 `makerChannel`(클립 만든 사람)이 다르다. "본인 영상" 검사 기준을 정해야 한다.

## 2. 인가 요청

근거: 공식 문서(인증 코드 요청), MCP `GET /account-interlock`, 기존 웹 앱의 인가 URL 생성.

```
GET https://chzzk.naver.com/account-interlock
    ?clientId={CLIENT_ID}
    &redirectUri={등록된 로그인 리디렉션 URL}
    &state={임의 문자열}
```

| 파라미터 | 필수 | 비고 |
|---|---|---|
| `clientId` | O | 개발자 센터 발급 |
| `redirectUri` | O | 등록한 로그인 리디렉션 URL과 일치해야 함 |
| `state` | O | CSRF 방지. 토큰 교환 때 같은 값을 다시 보내야 함 |

- `scope` 파라미터는 없다. 스코프는 개발자 센터에서 앱에 신청하는 방식이다. 인가 요청에 스코프를 싣는 방법은 문서에 없다.
- 콜백: `redirectUri?code={code}&state={state}` (GET 리다이렉트).
- 취소/오류 시 콜백 형태는 문서에 없다. 기존 웹 앱은 `code`가 없으면 취소로 간주한다.
- code의 유효 시간, 일회성 여부: 확인 불가(통상 일회성이라고 가정하고 즉시 교환한다).

## 3. 토큰 발급

근거: 공식 문서, MCP `POST /auth/v1/token`, 기존 웹 앱의 토큰 교환.

```
POST https://openapi.chzzk.naver.com/auth/v1/token
Content-Type: application/json

{ "grantType": "authorization_code",
  "clientId": "...", "clientSecret": "...",
  "code": "...", "state": "..." }
```

- 본문은 **JSON**이다(form-urlencoded 아님). 필드는 camelCase(`grantType`).
- 응답 공통 래퍼: `{ "code": 200, "message": null, "content": { ... } }`. 기존 웹 앱은 `json.content ?? json`으로 래퍼 유무 양쪽을 처리한다. 래퍼가 실제로 오는지 샘플 응답을 직접 받아 확인한 적은 없다(자격증명 없음). 양쪽 모두 처리하도록 구현한다.
- `content` 필드:

| 필드 | 타입 | 비고 |
|---|---|---|
| `accessToken` | string | |
| `refreshToken` | string | |
| `tokenType` | string | `Bearer` 고정 |
| `expiresIn` | 문서: String `"86400"` / MCP: int | 타입이 출처마다 다르다. `Number()`로 정규화(MCP 생성 코드도 `Number(expiresIn)`) |
| `scope` | string | 발급 응답 표에는 없고 **갱신 응답 표에만** 있다(예: `채널 조회`). 코드 생성기는 공백 구분 문자열로 취급 |

- 수명: access token 1일(86400초), refresh token 30일.
- 실패: `{ "code": <int>, "message": "..." }`. HTTP 401 `INVALID_CLIENT`, `INVALID_TOKEN` 등(7절).

## 4. 갱신, 폐기

- **갱신**: 공식 문서상 같은 `POST /auth/v1/token`에 `grantType: "refresh_token"`을 쓴다. (MCP 목록의 `/auth/v1/token#refresh`는 구분용 표기이고 실제 경로가 아니다.)

```
{ "grantType": "refresh_token", "refreshToken": "...",
  "clientId": "...", "clientSecret": "..." }
```
  응답은 `accessToken, refreshToken, tokenType, expiresIn, scope`. **refresh token은 일회용**이라 갱신 때마다 새 값으로 교체해야 한다. 이 응답이 refresh token을 새로 주는지가 곧 rotation이며, 같은 토큰을 두 번 쓰면 실패한다고 보고 설계한다(동시 갱신 경합 주의).
- **폐기**: `POST /auth/v1/token/revoke`, 본문 `clientId, clientSecret, token, tokenTypeHint?`(`access_token`(기본) | `refresh_token`). 문서: "요청한 Token과 동일한 인증 과정을 거친 모든 Token이 제거"된다(`clientId`와 user가 같은 토큰 전부). 즉 같은 앱의 다른 기기 로그인도 같이 끊길 수 있다. 응답은 MCP 생성 코드 기준 `code === 200`을 성공으로 본다.

## 5. 사용자 식별 (`users/me`)

근거: 공식 문서 User 절, MCP `GET /open/v1/users/me`, 기존 웹 앱의 사용자 조회.

```
GET https://openapi.chzzk.naver.com/open/v1/users/me
Authorization: Bearer {accessToken}
Content-Type: application/json
```

- 공백 포함 `Bearer ` 접두사 필수(문서 경고).
- 응답 `content`: `channelId`(string), `channelName`(string). 문서 예시 `909501f048b44cf0d5c1d28XXXXXXXX`(32자). 프로필 이미지는 이 엔드포인트에 없다.
- 문서: "치지직의 모든 유저는 채널을 소유합니다. 채널ID는 채널의 고유 식별자이며 유저의 고유 식별자로 사용할 수 있습니다."
- 필요한 스코프: **`유저 정보 조회`** 하나면 된다. 본인 식별 용도로는 이 외에 필요한 것이 없다. 앱 신청 때 이것만 요청한다(최소 권한).
- 기존 웹 앱은 `id ?? channelId`, `nickname ?? channelName` 폴백을 둔다. 실제 필드는 `channelId/channelName`이다.

## 6. Redirect URI 등록 규칙

- 공식 문서의 유일한 규칙: "요청 redirectUri는 애플리케이션 등록 시 입력한 로그인 리디렉션 URL과 일치해야 합니다."
- 인가 요청 파라미터 예시값이 `http://localhost:8080/api/path`다. 즉 localhost 등록이 가능해 보이는 정황은 있으나 **규칙으로 명시된 것은 아니다.**
- 확인 불가 항목:
  - loopback(`127.0.0.1`, `[::1]`)을 허용하는지
  - 포트가 임의 값(RFC 8252 방식)인지, 정확히 일치해야 하는지(문서 문구상 완전 일치로 읽힘 -> 임의 포트는 어렵다고 가정)
  - 커스텀 URL 스킴(`myapp://`) 허용 여부
  - 등록 가능한 URL 개수, 와일드카드, `http` 허용(localhost 외)
- 따라서 임의 포트 loopback이나 커스텀 스킴에 의존하는 설계는 위험하다. **개발자 센터에서 실제로 등록해 보기 전에는 확정할 수 없다**(사용자 준비 항목).
- 앱 ID/이름에 `chzzk`, `치지직`, `naver`, `네이버`를 쓸 수 없다. 최근 90일간 스코프 사용량이 0이면 앱이 삭제된다(로그인 사용이 0이면 해당될 수 있으니 주의).

## 7. PKCE, 호출 제한, 오류

- **PKCE: 지원하지 않는다고 봐야 한다.** 문서·MCP 어디에도 `code_challenge`/`code_verifier`가 없다(확인 불가이나 스펙에 파라미터가 없음). 대신 토큰 교환에 `clientSecret`과 `state`가 필수다.
- **호출 제한**: 수치 없음. HTTP 429 `TOO_MANY_REQUESTS`("Quota 제한 초과")만 명시. 앱 단위 quota로 보이나 한도는 확인 불가. 로그인 빈도가 낮아 문제될 가능성은 낮다. 허용목록 체크는 Worker에서 `users/me`를 매번 부르지 말고 앱 세션 토큰에 채널 ID를 넣어 호출을 줄인다.
- 오류 표: 400 파라미터 오류 / 401 `UNAUTHORIZED`·`INVALID_CLIENT`·`INVALID_TOKEN`(만료·삭제·없음) / 403 `FORBIDDEN` / 404 `NOT_FOUND` / 429 / 500.

## 8. 기존 웹 앱의 구현 (재사용 판단)

근거: 기존 웹 앱의 OAuth 클라이언트, 로그인·콜백·로그아웃·사용자 조회 라우트, 세션 코드와 인증 문서.

| 항목 | 기존 웹 앱 방식 | 데스크톱(Worker) 재사용 |
|---|---|---|
| state/CSRF | `crypto.randomUUID()`를 httpOnly 쿠키(`__Host-oauth_state`, SameSite=Lax, 10분)에 저장, 콜백에서 쿼리 `state`와 비교. 불일치·누락은 실패 처리, `code`만 없고 state가 맞으면 취소로 간주 | 쿠키 대신 **Durable Object(`LoginBroker`)에 state -> 세션 id 매핑**(10분 만료)으로 바꾼다. KV는 최종 일관성이라 일회용 소비를 보장하지 못한다. 데스크톱이 시작한 요청과 브라우저 콜백이 같은 쿠키 항아리를 쓰지 않을 수 있어서다. 일회용 소비 후 삭제는 유지 |
| 오픈 리다이렉트 | `next` 경로 검증(`sanitizeNextPath`) | 불필요. 랜딩 페이지 로그인에만 필요 |
| 토큰 교환 | JSON POST, 10초 타임아웃, `content ?? json` 폴백, 오류 본문은 버리고 `code`만 로깅 | 그대로 이식(Worker의 `fetch` + `AbortSignal.timeout`). 오류 본문 비로깅 원칙 유지 |
| CHZZK 토큰 보관 | **저장하지 않는다.** `users/me` 조회에만 쓰고 버림 | 동일하게 버린다. 앱은 CHZZK 토큰이 필요 없다(채널 ID만 필요). 갱신·폐기 구현도 불필요. 필요하면 로그인 직후 `revoke`로 정리 가능하나, 그 동작은 같은 앱의 모든 토큰을 지우니 샘플 앱 동시 사용 시 주의 |
| 세션 | HS256 JWT 15분(httpOnly 쿠키) + 불투명 refresh token(UUID, SHA-256 해시를 D1에 저장, 30일, 절대 90일) | 쿠키가 아닌 **Bearer 헤더**로 쓰는 앱 세션 토큰으로 변환. `chzzkUserId` -> `channelId` 클레임 |
| refresh rotation | family_id 체인, 사용 시 USED 전환, 재사용 감지 시 family 폐기, 30초 동시요청 grace, `db.batch` 원자성 | 사용자 수가 소수(허용목록)라 복잡도 대비 효용이 낮다. 최소안: 앱 세션 JWT(예: 30일) + 허용목록을 매 요청 대조해 폐기 가능하게 한다. rotation이 필요하면 D1/KV 대신 Durable Object로 원자성을 확보 |
| 사용자 DB | `users(chzzk_user_id UNIQUE)` upsert | 허용목록 KV/D1 한 줄 조회로 충분 |

핵심: 기존 웹 앱의 CSRF 방식은 **같은 브라우저에서 시작·종료**하는 웹 앱 전제다. 데스크톱 흐름은 시작(앱)과 종료(시스템 브라우저)가 다르므로 state를 서버 저장소에 둔다.

## 9. 권장 데스크톱 플로우

Redirect 규칙이 불확실하므로 **Worker 콜백(HTTPS 고정 URL 하나)을 등록하고, 앱은 일회용 id로 폴링**하는 방식을 기본으로 한다. 임의 포트 loopback이나 딥링크는 등록 규칙이 확인되기 전까지 채택하지 않는다.

### 시퀀스

```
앱(Tauri)            Worker                        시스템 브라우저          치지직
 |  POST /auth/start    |                              |                    |
 |--------------------->| sid=랜덤 128bit, state=랜덤    |                    |
 |                      | DO: state -> {sid}, 만료 10m  |                    |
 |                      | DO: sid  -> {status:pending}  |                    |
 |<---------------------| {sid, loginUrl}               |                    |
 | 시스템 브라우저로 loginUrl 열기 (open::that)            |                    |
 |-------------------------------------------------->  GET loginUrl         |
 |                      |<-----------------------------|  (Worker /auth/login?state=)
 |                      | 302 account-interlock?clientId&redirectUri(Worker)&state
 |                      |------------------------------------------------->  |
 |                      |                               사용자 로그인/동의      |
 |                      |<------------------------- 302 /auth/callback?code&state
 |                      | DO에서 state 조회·삭제를 한 트랜잭션으로 (CSRF, 일회용) |
 |                      | POST /auth/v1/token (code, state, secret) --------->|
 |                      | GET /open/v1/users/me --------------------------->  |
 |                      | channelId 허용목록 검사                              |
 |                      | 앱 세션 토큰 발급, DO: sid -> {status:ok, token}, 만료 2m |
 |                      |----------------------------->  "로그인 완료, 앱으로 돌아가세요" 페이지
 |  GET /auth/poll?sid  |                              |                    |
 |--------------------->| (2초 간격, 최대 약 5분)                              |
 |<---------------------| {pending} ... {ok, token, channelId, channelName}     |
 |                      | 같은 트랜잭션에서 읽고 삭제 (1회 수령)                 |
 | 토큰을 앱 데이터 디렉토리의 credentials.json(0600)에 저장 (docs/design/core.md §1-15) |
```

### 설계 메모

> 설계 확정은 `docs/design/worker.md`다(아래 메모의 `LoginBroker`·sid 저장소 = DO `AuthStore` 하나, 리디렉션은 치지직 앱에 등록된 `/auth/callback`). 이 절은 조사 당시 기록으로 남긴다.

- **저장소는 강한 일관성이 필수다.** state·sid 발급과 소비는 싱글턴 Durable Object(`LoginBroker`, SQLite 스토리지) 하나가 직렬화한다. 소비는 "조회 → 상태 확인 → 삭제"를 `transactionSync` 안에서 처리해, 동시·중복 콜백이나 폴링이 같은 토큰을 두 번 받지 못하게 한다. 만료는 레코드의 `expiresAt` 비교와 DO alarm 정리로 처리한다. KV는 이 흐름에 쓰지 않는다(허용목록처럼 비밀이 아니고 60초 전파 지연이 허용되는 데이터에만 쓸 수 있다).

- `sid`는 폴링 비밀이다. 128bit 이상 랜덤, 유출 시 토큰 탈취가 가능하므로 `start`를 호출한 앱만 알도록 하고(브라우저 URL에는 `state`만 싣는다), poll 응답은 1회 수령 후 삭제한다. 앱에서 `sid`와 별도로 **poll secret**(앱이 만든 랜덤 값의 해시를 start에서 저장)을 쓰면 더 안전하다. PKCE와 같은 발상이다.
- 허용목록 불일치면 `status:denied`로 종결하고 토큰을 발급하지 않는다.
- 폴링 레이트 제한: Worker에서 sid당 최소 간격 강제.
- 만료·취소(`code` 없음): `status:cancelled`.
- 앱 세션 토큰 갱신/폐기: `POST /auth/refresh`(Bearer). CHZZK 토큰은 쓰지 않으므로 CHZZK refresh 호출은 없다.

### 딥링크/loopback 대안과 비교

| 방식 | 장점 | 단점/리스크 |
|---|---|---|
| **Worker 콜백 + 폴링 (권장)** | 등록 URL이 HTTPS 하나로 고정, 플랫폼 차이 없음, 규칙 확인 불필요 | 폴링 필요, 서버 상태(Durable Object) 필요 |
| 딥링크(`chzzkdl://`) | 즉시 복귀 | 커스텀 스킴 등록 허용 여부 확인 불가. Linux AppImage·미서명 macOS에서 스킴 등록 불안정 |
| loopback 임의 포트 | 서버 불필요 | 임의 포트 일치 규칙 확인 불가. 방화벽·보안 소프트웨어 영향 |

가능하면 개발자 센터에 앱을 등록할 때 loopback·커스텀 스킴이 입력 가능한지만이라도 실제로 시험해 이 문서에 반영한다.

## 10. 채널 ID 동일성 (OAuth vs 서비스 API)

공개 채널 하나로 확인했다(2026-10-05).

- 코어가 읽는 두 경로, 영상 정보의 `content.channel.channelId`와 클립 play-info의 `content.ownerChannel.channelId`는 같은 채널에 대해 같은 값을 준다. 형식은 32자리 소문자 hex다.
- 공식 Open API 문서의 `users/me`·`lives` 예시 `channelId`도 32자리 hex다. 형식은 같지만 **공식 API 응답과 직접 대조하지는 못했다**(Client-Id/Secret이나 사용자 토큰이 필요한데 이 조사에는 자격증명이 없었다).
- 검증 방법(자격증명이 생기면 5분): 본인 계정으로 로그인해 `users/me`의 `channelId`와, 본인이 올린 VOD의 영상 정보 `content.channel.channelId`를 비교한다. 이 비교를 Phase 3 첫 작업으로 넣는다. 일치하지 않으면 앱 쪽 "본인 영상" 검사 설계를 다시 한다.
- 추가 주의:
  - 클립 `play-info`에는 `ownerChannel`(스트리머)과 `makerChannel`(클립 제작자, 별개 ID)이 모두 있다. **"본인 영상" 검사는 `ownerChannel.channelId` 기준**으로 하되, 제작자 기준 허용 여부는 정책 결정이 필요하다.
  - ID 비교는 소문자 hex 문자열 정확 일치로 한다(`ownership::is_own_content`).

## 11. 열린 질문

1. 개발자 센터에서 로그인 리디렉션 URL에 loopback(임의 포트)·커스텀 스킴·`http`가 입력 가능한가? (등록 시험 필요) → 개발용 `http://localhost:8787/auth/callback` 등록됨(2026-10-06). 앱 흐름은 Worker 콜백 + 폴링이라 loopback·커스텀 스킴이 필요 없다(`docs/design/worker.md`)
2. 앱 스코프 `유저 정보 조회`만 신청해도 인가 요청이 통과하는가? 신청·승인 소요는?
3. Open API `users/me` channelId == 서비스 API channelId 직접 대조(10절).
4. 토큰 응답이 `content` 래퍼로 오는가(문서의 응답 표는 래퍼 없이 필드만 보여 주지만 공통 응답 구조는 래퍼를 명시).
5. 클립 "본인" 정의: 소유 채널만 / 제작자 포함?
6. 90일 미사용 앱 삭제 정책 때문에 앱을 유지하려면 주기적 로그인 호출이 필요한가(허용목록 사용자가 쓰면 충족).
