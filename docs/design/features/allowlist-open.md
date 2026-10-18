# 허용목록 자동 허가 + 하루 새 채널 상한: 명세(2026-10-18, 기준 origin/master `90404f9`)

**상태**: W1·W2·A1이 구현됐다(2026-10-18, 이 문서 끝 §10 "구현 중 변경"이 본문보다 우선한다). R(버전 PR·ROADMAP 결정 행·런북 마무리)과 태그·운영 배포는 사용자 승인 뒤다. 구현이 이 문서와 달라지면 worker.md 109·app.md 91의 "구현 중 변경"이 이긴다.
**표기**: `파일:줄`은 기준 커밋 `90404f9`에서 연 줄이다. **[확인]** 직접 연 줄이 받침 / **[가정]** 설계 판단 / **[잠정]** 출처 없는 수치(ADR-0009 묶음에 올린다). 예시 채널 이름·ID는 전부 가짜다(`…a1`·`…e5`는 테스트 상수 꼴).
**고르는 법**: §2.1은 지시서가 정한 것이고 §2.2는 **사용자가 고를 것**이다. §2.2의 각 행에는 선택지·차이·추천이 있다. 추천대로 고르면 §3 이하가 그대로 맞는다. 다른 선택지를 고르면 그 행의 "바뀌는 곳" 칸만 고친다.

---

## 0. 한 장 요약

| 항목 | 내용 |
|---|---|
| 한 줄 | 치지직으로 로그인한 사람은 **처음 로그인할 때 저절로 허용목록에 들어간다**. 단 새로 들어오는 채널은 **한국 시간 하루 20개**까지다. 넘으면 그날은 거부하고 거부 기록에 남긴다. 다음 날 다시 로그인하면 들어온다. **관리자가 차단한 채널은 자동으로 들어오지 않는다** |
| 바뀌지 않는 것 | 소유 게이트(본인·맡은 채널 영상만 받기, `ROADMAP.md:96` [확인])·세션·토큰 묶음·`/api/me`·R2 게이트·부트스트랩 모드 |
| 저장 | DO `AuthStore` 스키마 V4(더하기만): `blocked` 표 하나, `flow.deny_reason` 열 하나. 상한·오늘 센 수는 `meta` 행(DDL 없음) |
| 세는 곳 | 로그인 종결 `finish`(`flows.ts:197-222` [확인])의 거부 갈래 **안**, 같은 `transactionSync` 안에서 센다. DO는 한 트랜잭션씩 돌리므로 동시에 21명이 와도 20명만 들어간다 |
| 앱 ↔ Worker 계약 | `/auth/redeem`의 `denied` 응답에 선택 키 `reason`(`daily_limit`·`blocked`)을 **더하기만** 한다. 옛 앱은 모르는 키를 버리고 새 앱은 키가 없으면 지금 안내를 쓴다 → `feat`, `!` 아님(§4.5) |
| 관리 화면 | "자동 허가" 절(오늘 센 수·하루 상한 입력, 0이면 끔) · "허가한 채널" 표에 자동 표시 · **차단한 채널** 표 · "허가 빼기"가 **차단**이 된다(§2.2 B1·B2) |
| 문구 | 앱 거부 화면 셋(상한·차단·지금 안내) · 수신기 페이지 한 문장 · Worker 완료 페이지 셋 · 랜딩 `anonLead`·로그인 절 · `/privacy` 받는 정보·보관 기간 · `/help` 새 항목 하나 |
| 단계 | 문서(이 PR) → Worker 저장소 → Worker 화면·경로·E2E → 셸·앱 → 릴리스(§8) |

---

## 1. 목적과 범위

### 1.1 목적

지금은 관리자가 `/admin`에서 채널 ID를 허용목록에 넣어야 앱·랜딩·R2 다운로드를 쓸 수 있다(`ROADMAP.md:98` "배포 자체는 본인·지인만 … 앱 사용도 같은 허용목록으로 제한" [확인], worker.md §8.1). 경쟁력 평가에서 접근성이 가장 뒤처진 축으로 나왔고 허용목록 개방은 사용자 판단으로 남아 있었다(`ROADMAP.md:7` "코드 서명·라이선스·허용목록 개방은 … 사용자 판단으로 남긴다" [확인]). 사용자는 그중 허용목록 개방을 골랐다(2026-10-18). 이 문서는 그 결정을 가장 작은 변경으로 옮긴다.

### 1.2 하지 않는 것

- **소유 게이트를 넓히지 않는다.** 들어온 사람도 본인 채널과 맡은 채널의 영상만 받는다.
- 전체 사용자 수 상한·만료(오래 안 쓴 채널 정리)·본인 탈퇴 버튼을 두지 않는다. 지우는 길은 지금처럼 연락처(`copy.ts:114` [확인])다. 필요해지면 §9-6에서 다시 본다.
- 대기열(상한에 걸린 사람을 다음 날 자동으로 넣기)을 두지 않는다. 다음 날 **다시 로그인**해야 들어온다(지시서 "다음 날 다시 시도").
- 감사 표 CHECK를 바꾸지 않는다(§3.8).
- 부트스트랩 모드에서는 자동 허가를 하지 않는다(§3.5).

---

## 2. 결정 표

### 2.1 지시서가 정한 것(확정, 고를 것 없음)

| # | 결정 | 근거 |
|---|---|---|
| F1 | 치지직 로그인한 누구나 **처음 로그인 때** 허용목록에 자동으로 들어간다 | 사용자 결정(2026-10-18) |
| F2 | 하루 새 자동 허가는 **20명**까지. 넘으면 그날은 거부하고 **기존 거부 기록**(`denied` 표)에 남긴다. 다음 날 다시 시도 | 같음. 기록은 `recordDenied`(`allowlist.ts:39-47` [확인])를 그대로 쓴다 |
| F3 | 상한 값은 관리자가 `/admin`에서 바꾼다 | 같음 |
| F4 | 관리자가 차단한 채널은 자동 허가되지 않는다 | 같음 |
| F5 | 소유 게이트는 그대로 | 같음 |
| F6 | Worker core에는 `Date.now`·전역 `fetch`가 없다. 시각은 주입한다 | worker.md 구현 중 변경 15. store도 동기 함수 + `now` 인자다(`AuthStore.ts:3-4` [확인]) |
| F7 | 허용목록 저장은 DO `AuthStore`이고, 21명이 동시에 와도 DO 안에서 원자적으로 센다 | `AuthStore.ts:111-116` `write`가 `transactionSync` 하나 [확인] |

### 2.2 사용자가 고를 것

| # | 질문 | 선택지 | 차이 | 추천 | 추천을 안 고르면 바뀌는 곳 |
|---|---|---|---|---|---|
| **A1** | "하루"의 경계 | **가. 한국 시간(UTC+9 고정) 자정**<br>나. UTC 자정(한국 09:00) | 가: 사용자에게 "자정 지나 다시"라고 말할 수 있다. 관리 화면 시각도 이미 한국 시간이다(`copy.ts:216` "시각은 한국 시간이에요" [확인]). 나: Cloudflare 무료 한도 초기화(00:00 UTC, worker.md 구현 중 변경 11 (아) ②)·IP 스로틀 소금(`AuthStore.ts:107` UTC 일 번호 [확인])과 같은 경계다. 하지만 둘 다 사용자가 보지 않는 내부 경계라 맞출 이유가 약하다 | **가**. 한국은 서머타임이 없어 `+9h` 고정 오프셋으로 충분하다(`Intl` 안 씀) | §3.2 `kstDay` → `utcDay`, 문구 "한국 시간 자정" → "오전 9시" |
| **A2** | 배포 직후 기본 상한 | **가. 20**(meta에 값이 없으면 20)<br>나. 0으로 배포하고 관리자가 `/admin`에서 20으로 켠다 | 가: 태그 배포 순간 열린다. `/privacy`·`/help`·랜딩 문구가 같은 배포에 들어가므로(§8 W2) 고지 없이 열리는 시간은 없다. 나: 열리는 시각을 관리자가 고른다. 대신 처음 한 번 관리 화면을 열어야 한다 | **가**(지시서 "20명까지"). 되돌리기는 언제든 상한 0 | §4.2 기본값 상수 하나, 런북 한 줄 |
| **A3** | 상한의 최대값 | **가. 0~100 [잠정]**<br>나. 0~1000 | DO 쓰기 무료 한도 계산(§4.7)에서 사용자 수는 상한 × 날짜로 는다. 100이면 1년 뒤에도 계산 안이다. 1000이면 몇 달 안에 다시 계산해야 한다 | **가** | `AUTO_ALLOW_CAP_MAX` 하나 |
| **B1** | 차단을 무엇으로 두나 | **가. 별도 `blocked` 표, "허가 빼기"가 차단을 겸한다**<br>나. 허가 빼기와 차단을 두 동작으로<br>다. `allowlist`에 상태 열 | 자동 허가가 있으면 차단 없는 "빼기"는 의미가 없다. 뺀 채널이 다음 로그인에 바로 다시 들어오기 때문이다. 가: 동작 하나에 표 하나를 더한다. `admission`(`allowlist.ts:27-31` [확인])은 그대로다. 나: 버튼·경로·문구가 하나씩 는다. 다: `FROM allowlist`를 읽는 판정·위임·청소 쿼리(`allowlist.ts:29`, `sweep.ts`의 위임 쿼리, `delegation.ts`) 전부에 조건이 붙는다. V3로 되돌리면 옛 코드가 상태 열을 몰라 차단 행을 허가로 본다 | **가** | §3.3·§4.1·§4.4·§5.3 관리 문구 |
| **B2** | 관리 화면 라벨 | **가. "허가 빼기" → "차단"**(확인 페이지·감사 기록 라벨 포함)<br>나. "허가 빼기" 그대로 + 확인 페이지에 한 문장 | 가: 동작의 새 의미가 라벨에 보인다. `design/copy/terms.json`의 "허가 빼기" 항목(`terms.json:868` [확인])을 바꾸고 `design-copy` gate를 다시 맞춘다. 나: 바뀌는 곳이 적다. 대신 "뺐는데 왜 다시 못 들어오나"를 확인 페이지에서만 알 수 있다 | **가** | §5.3 관리 문구 행 |
| **B3** | 거부된 시도 행에서도 차단하나 | **가. 한다**(허가 안 된 채널도 차단 행만 남긴다)<br>나. 허가한 채널에서만 | 상한에 걸린 낯선 채널은 내일 저절로 들어온다. 가: 관리자가 미리 막는다. 나: 들어온 뒤에야 막을 수 있다. 가는 `disallow`가 허용목록에 없는 채널에서 `not_found` 대신 차단 행을 쓰게 바꾼다(`allowlist.ts:93` [확인]) | **가** | §3.3 (나), E2E E05b의 `d4` 기대(§6.4) |
| **C1** | 거부 이유를 앱에 알리나 | **가. 알린다**: redeem `denied`에 `reason`을 더한다<br>나. 문구 하나로 둘 다 덮는다 | 다음 행동이 다르다. 상한은 "자정 지나 다시"이고 차단은 "관리자에게"다. 가: 더하기만이라 옛 앱은 그대로 돈다(§4.5). 나: 계약은 그대로지만 문구가 길고 흐려진다("오늘 자리가 없거나 막힌 채널이에요…") | **가** | §4.5·§5.1 키 넷 → 하나 |
| **C2** | 수신기(브라우저) 페이지도 나누나 | **가. 나누지 않는다**: 문장 하나를 중립으로 바꾼다<br>나. 이유별 세 문장 | 수신기는 결과를 앱으로 돌려보내는 자리이고 자세한 안내는 앱 화면이 한다(`loopback.rs:86` "앱에서 안내를 확인해 주세요" [확인]). 가는 `ReceiverPage` enum을 그대로 둔다 | **가** | §5.2 |

---

## 3. 설계

### 3.1 로그인 종결의 판정 순서(`finish`, `flows.ts:196-222`)

지금은 `admission`이 거부하면 바로 거부 갈래로 간다(`flows.ts:197-221` [확인]). 그 사이에 **자동 허가 판정** `autoAdmit`을 하나 넣는다. 같은 트랜잭션 안이다.

```
adm = admission(db, channelId, admins)           // 바뀌지 않음
if !adm.allowed:
    a = autoAdmit(db, channelId, name, admins, now)   // 새 순수 함수(store/allowlist.ts)
    if a.ok: adm = admission(db, channelId, admins)   // 방금 넣은 행으로 다시 판정 → allowed
    else:    denyReason = a.reason                     // "daily_limit" | "blocked" | null
if !adm.allowed: (지금 거부 갈래 그대로) + flow.deny_reason = denyReason
else:            (지금 허용 갈래 그대로)
```

`autoAdmit`의 판정 순서(앞에서 걸리면 끝):

| 순서 | 조건 | 결과 | 쓰는 행 |
|---|---|---|---|
| 1 | `admins.length === 0`(부트스트랩) | 거부, 이유 없음 | 없음 |
| 2 | `blocked`에 행이 있다 | 거부, `blocked` | 없음(거부 기록은 지금 갈래가 쓴다) |
| 3 | 상한 `cap === 0` | 거부, 이유 없음(관리자만 허가하는 지금 방식) | 없음 |
| 4 | 오늘(§3.2) 센 수 `>= cap` | 거부, `daily_limit` | 없음 |
| 5 | 그 밖 | **허가** | `allowlist` 행 INSERT(`added_by = 'auto'`, `channel_name = name`, `owner_channel_id = NULL`, `note = NULL`, `added_at = now`), 오늘 센 수 +1, 청구 초대 완성(§3.6), 그 채널의 `denied` 행 삭제 |

- **센 수는 실제로 행을 넣을 때만 오른다.** 같은 채널의 흐름 둘이 겹쳐도 둘째는 `admission`이 이미 허가로 보므로 `autoAdmit`까지 오지 않는다. 관리자·이미 허가된 채널도 세지 않는다.
- 거부 갈래(상한·차단·이유 없음)는 지금처럼 `recordDenied`로 거부 기록을 남긴다(`flows.ts:199` [확인]). 지시서 F2의 "기존 거부 기록"이다.
- `admission`·`check`·`webCheck`·`rotate`는 바꾸지 않는다. 자동 허가는 **로그인 종결에서만** 일어난다. 세션 확인 경로(`sessions.ts:146-149` [확인])에서 허가를 새로 만들지 않는다.
- 이름은 지금처럼 `clip(outcome.channelName, NAME_MAX)`(`flows.ts:196` [확인])를 거친 값이다.

### 3.2 하루 세기(원자성·경계)

- 날짜 키: `kstDay(now) = Math.floor((now + 9 * 3_600_000) / 86_400_000)`(순수 함수, `store/allowlist.ts`). §2.2 A1 가.
- 저장: `meta`의 `auto_allow_day`(그날 키)·`auto_allow_count`(그날 센 수). 읽은 날 키가 오늘과 다르면 센 수를 0으로 본다(게으른 초기화, 알람 없음).
- **원자성**: `finish` RPC는 비동기 준비(`mint` 등, `AuthStore.ts:220-224` [확인]) 뒤 `this.write(now, () => finish(...))` 하나로 들어간다(`AuthStore.ts:225` [확인]). `transactionSync` 안의 함수는 동기라서 그 사이에 다른 RPC가 끼어들 수 없다. 21개의 `finish`가 동시에 와도 DO가 하나씩 돌리고, 각자 센 수를 읽고 +1한다. 그래서 정확히 20개만 허가된다. 테스트로 고정한다(§6.1 S3).
- **시각**: `now`는 Worker가 요청마다 한 번 정한 `Date.now()`다(`routes.ts:202` [확인]). store는 시계를 읽지 않는다(F6). 그래서 경계 테스트는 `now`만 바꿔서 한다.
- 시계가 뒤로 가는 경우(다른 isolate가 몇 ms 앞선 `now`를 낸 직후 뒤선 `now`가 옴): 날 키가 작아지면 "오늘과 다름"으로 보고 0부터 세면 경계에서 상한을 두 번 쓸 수 있다. 그래서 **저장된 날 키보다 작은 키는 저장된 키와 같은 날로 본다**(`day = max(저장 키, kstDay(now))`). 하루에 한 번 경계에서만 생기는 일이다.

### 3.3 차단(§2.2 B1 가·B2 가·B3 가)

(가) **표**: `blocked(channel_id PK, channel_name, blocked_by, blocked_at)`. 차단 행은 **자동 허가만 막는다**. 허가 판정 `admission`은 허용목록 행만 본다(지금 그대로). 그래서 허가 행과 차단 행이 함께 있으면 허가가 이긴다. 이 규칙 덕분에 V3로 되돌린 동안 옛 코드가 `allow`로 다시 허가한 채널(차단 행은 남음)이 V4로 돌아와서도 허가로 남는다(§4.6).

(나) **차단** = 지금 `disallow`(`allowlist.ts:90-100` [확인])에 차단 행 쓰기를 더한다. 같은 트랜잭션이다.

| 상태 | 지금 | 바뀐 뒤 |
|---|---|---|
| 형식이 틀린 ID | `bad_channel_id` | 같음 |
| 관리자 채널 | `is_admin` 409, 쓰기 없음 | 같음(관리자는 차단할 수 없다) |
| 허용목록에 있음 | 행 삭제 + 세션 revoked(`disallowed`) + 위임·초대 삭제 + 감사 `disallow` | 같음 + `blocked` UPSERT(이름은 지운 허가 행의 이름, 없으면 거부 기록의 이름) |
| 허용목록에 없고 차단도 없음 | `not_found`, 쓰기 없음 | **차단 행만 쓴다** + 감사 `disallow`(B3 가). 세션은 이미 쓸 수 없다(`allowlist.ts:88` 주석 [확인]) |
| 허용목록에 없고 이미 차단 | `not_found` | `not_found`(이미 처리됨, 감사 없음) |

(다) **차단 풀기** = 지금의 허가 동작 셋(`allow`·`allowDenied`, 관리 화면의 "채널 ID로 추가"·거부된 시도 [허가]·새 "차단한 채널" 표의 [허가])이 **차단 행을 함께 지운다**. 차단을 푸는 별도 동작은 두지 않는다. 풀면 바로 허가이고 관리자가 넣은 허가라 하루 상한에 세지 않는다.

(라) 이미 세션이 있는 채널을 차단하면 그 세션은 다음 확인에서 403 `not_allowed`가 된다(`sessions.ts:146-149` [확인]). 앱은 지금의 `RemovedFromAllowlist` 화면을 그대로 보인다(`service.rs:784-791` [확인], 앱 `auth.ts:119-121` [확인]). **새 앱 경로는 없다.** 그 사람이 [다시 시도]로 로그인하면 그때 `blocked` 거부 화면(§5.1)을 본다.

(마) 청소: 차단 행은 지우지 않는다(차단하는 동안 남아야 한다). 행 수는 관리자가 누른 횟수만큼이라 상한을 두지 않는다 [가정].

### 3.4 상한 설정

- `meta.auto_allow_cap`: 정수 문자열 `^(0|[1-9][0-9]{0,2})$`이고 `0 ≤ cap ≤ AUTO_ALLOW_CAP_MAX`(100, §2.2 A3). **값이 없으면 20**(`AUTO_ALLOW_DEFAULT_CAP`, §2.2 A2 가). **형식이 틀리면 0**(fail closed)이고 `store.auto_allow_cap_invalid` 경고 로그를 남긴다.
- 바꾼 사람·시각: `meta.auto_allow_cap_by`(관리자 채널 ID)·`meta.auto_allow_cap_at`(epoch ms). 관리 화면 "자동 허가" 절에 보인다. 감사 표에는 남기지 않는다(§3.8).
- 상한을 오늘 센 수보다 낮추면 오늘은 더 받지 않는다. 높이면 그 자리에서 더 받는다. 0이면 자동 허가를 끄고 지금처럼 관리자만 허가한다(되돌리기 스위치).

### 3.5 부트스트랩 모드·`dev:real`

- 부트스트랩(`ADMIN_CHANNEL_IDS`가 빔)은 지금처럼 **아무도 허가하지 않는다**(`allowlist.ts:30` `admins.length > 0 && …` [확인], worker.md §8.3). 자동 허가도 하지 않는다(§3.1 순서 1). 이유: 부트스트랩은 운영자가 자기 채널 ID를 알아내는 단계다(worker.md:431). 관리자가 없는 동안 낯선 채널이 먼저 들어오면 막을 사람이 없다.
- 그래서 `pnpm dev:real`(부트스트랩, worker.md:520 [확인])의 기대 결과는 **거부 그대로**다. 바뀌는 것은 수신기 페이지의 문장 하나다(§5.2). `ROADMAP.md:269`의 "수신기 '허가되지 않은 채널' 페이지"를 새 문장으로 고친다. `dev:real`에 `--var ADMIN_CHANNEL_IDS:…`를 주면 운영 모드가 되고, 그때는 관리자가 아닌 계정이 자동 허가된다(기본 상한 20). 이 점을 같은 줄에 덧붙인다.
- 거부 이유가 없으므로(순서 1) 앱·완료 페이지는 지금 안내("관리자에게 채널 이름을 알려 주세요")를 그대로 쓴다. 부트스트랩에서 운영자가 해야 할 일과 맞다.

### 3.6 편집자 위임과의 관계

- 위임 문서의 **가+**(편집자도 관리자가 따로 허가한다, `delegation.md:22` [확인])는 "자동 허가가 안 될 때"로 좁아진다. 초대 주소로 로그인한 편집자도 다른 사람처럼 자동 허가되고, 웹 흐름이면 같은 `finish` 안에서 바로 초대를 수락한다(`flows.ts:231-235` [확인]). 상한·차단에 걸리면 지금처럼 초대를 청구하고 기다린다(`flows.ts:211-213` [확인]).
- **청구 초대 완성**: 관리자 [허가]는 거부 기록을 지우기 **전에** `tracedClaims`를 읽고, 허가 뒤 `completeClaimed`로 청구 초대를 위임으로 바꾼다(`AuthStore.ts:329-333` [확인]). 자동 허가도 허가이므로 **같은 순서**를 지킨다: `tracedClaims` → 행 INSERT → `completeClaimed` → `denied` 삭제. 이 순서를 어기면 어제 상한에 걸려 청구한 편집자가 오늘 자동 허가돼도 위임이 생기지 않는다(청구 흔적은 거부 기록 `first_at`으로 이어진다, `delegation.ts:73` `CLAIM_TRACED` [확인]). `autoAdmit`은 `finish`가 받은 `admins`(문자열 배열 검증을 거친 값)를 넘긴다.
- 위임 행의 `editor_allowed_at`·`owner_allowed_at`은 허가 행의 `added_at`을 쓴다(schema.ts V3 주석 [확인]). 자동 허가 행도 `added_at = now`라 규칙이 같다. 차단(허가 행 삭제)은 지금 `disallow`처럼 위임·초대를 지운다.

### 3.7 관리 화면(`/admin`, `admin-view.ts:153-166` 표 다섯 → 여섯 + 설정 절)

| 순서 | 절 | 바뀌는 것 |
|---|---|---|
| 1 | 관리자 | 없음 |
| 2 | **자동 허가**(새 절) | 한 줄 "오늘 자동 허가 {n} / {cap}" + 한국 시간 안내 + 상한 입력(`<input type="number" min="0" max="100">`, 라벨) + [저장] 폼(CSRF 세 겹은 다른 관리 POST와 같다). 0이면 "자동 허가를 끄고 관리자만 허가해요" 안내. 마지막으로 바꾼 관리자·시각 |
| 3 | 허가한 채널 | `addedBy`가 `'auto'`이면 "자동 허가"로 보인다(지금은 `admin-view.ts:57`이 `addedBy`를 그대로 찍는다 [확인]). **최근 200행만** 보이고 위에 "전체 {total}개"를 적는다(§4.7). 행 버튼 "허가 빼기…" → "차단…" |
| 4 | 거부된 시도 | 행에 차단된 채널이면 "차단함" 꼬리표(Badge가 아니라 글자, 위임 꼬리표 `copy.ts:160`과 같은 방식). 버튼 [허가]·[차단…]·[지우기] |
| 5 | **차단한 채널**(새 표) | 이름·ID·차단한 관리자·시각, [허가]. 최근 200행 + 전체 수 |
| 6 | 활성 로그인 | 없음 |
| 7 | 감사 기록 | 동작 라벨 `disallow` "허가 빼기" → "차단"(B2 가) |

- 자동 허가 표시 문자열 `'auto'`는 채널 ID 정규식 `^[0-9a-f]{32}$`(`allowlist.ts:9` [확인])와 겹치지 않는다. 관리자 ID와 헷갈리지 않는다.
- 확인 페이지 `GET /admin/:channelId/disallow`는 이름을 "차단 확인"으로 바꾸고, 허용목록에 없어도 차단 행이 없으면 200으로 연다(B3 가). 이미 차단됐고 허가도 없으면 지금처럼 303 `/admin` + "이미 처리됐어요"다(`admin.ts:133` [확인]).

### 3.8 감사·로그

- 감사 표의 `action` CHECK는 여섯 값으로 묶여 있다(`schema.ts:29` [확인]). 마이그레이션은 더하기만이다(`schema.ts:3-4` [확인]). 그래서 새 동작 이름을 넣지 않는다.
  - **자동 허가는 감사 행을 쓰지 않는다.** 하루 20행이 쌓이면 `AUDIT_CAP` 500(`allowlist.ts:15` [확인])이 관리자 기록을 몇 주 만에 밀어내고, `/privacy`의 "관리자가 허가를 바꾼 기록"(`copy.ts:109` [확인])도 틀린 말이 된다. 흔적은 허가 행의 `added_by = 'auto'`와 `added_at`이다. 그래서 `autoAdmit`은 `allow()`(감사를 쓴다, `allowlist.ts:66` [확인])를 부르지 않고 INSERT를 직접 한다.
  - 차단은 `disallow`, 차단 풀기는 `allow`로 남긴다(지금 동작 이름 그대로).
  - 상한 변경은 `meta`의 by·at만 남긴다(§3.4).
- 로그: `finishEvent`의 `auth.login.denied`(`login-log.ts:31-32` [확인])에 `reason: "daily_limit" | "blocked"`를 싣는다(이유가 없으면 지금처럼 싣지 않는다). 자동 허가는 `auth.login.ok`에 `reason: "auto_allowed"`. `reason`은 허용된 로그 키다(`log.ts:41` [확인]). 콜백은 quiet 경로라 이 이벤트는 DO가 남긴다(`AuthStore.ts:229` [확인]). 상한 저장은 `admin.auto_allow_cap`(값 없음, 경로 `/admin/auto-allow`는 URL에 ID가 없어 quiet가 아니다).

---

## 4. 데이터·계약

### 4.1 DO 스키마 V4(더하기만, `schema.ts:62` 배열에 하나)

```sql
CREATE TABLE blocked (channel_id TEXT PRIMARY KEY CHECK (length(channel_id) = 32), channel_name TEXT,
  blocked_by TEXT NOT NULL, blocked_at INTEGER NOT NULL);
CREATE INDEX blocked_at ON blocked(blocked_at);
ALTER TABLE flow ADD COLUMN deny_reason TEXT
```

- `flow.deny_reason`: 거부된 흐름의 이유(`daily_limit`·`blocked`·NULL). redeem·완료 페이지가 읽는다. CHECK는 두지 않는다(`ALTER TABLE ADD COLUMN`에 CHECK를 두면 옛 행 검사 규칙이 복잡해진다 [가정]). 쓰는 곳이 `finish` 하나라 값은 코드가 정한다.
- `/health`의 `schema`는 4가 된다(`schema.ts:63` [확인]). 배포 뒤 검사의 가짜 Worker는 `schema:1`을 고정으로 내고 값을 비교하지 않는다(`worker-stub.mjs:64` [확인]).

### 4.2 meta 키(DDL 없음)

| 키 | 값 | 없을 때 | 형식이 틀릴 때 |
|---|---|---|---|
| `auto_allow_cap` | `0`~`100` | 20 | 0(fail closed) + 경고 로그 |
| `auto_allow_cap_by` | 관리자 채널 ID | 화면에 "기본값" | 화면에 "기본값" |
| `auto_allow_cap_at` | epoch ms | 없음 | 없음 |
| `auto_allow_day` | `kstDay` 정수 | 0 | 0 |
| `auto_allow_count` | 정수 ≥ 0 | 0 | **cap**(그날은 더 받지 않는다, fail closed) |

### 4.3 RPC(`AuthStore`, 모두 `write()` 트랜잭션 하나, `now` 주입)

| RPC | 바뀌는 것 |
|---|---|
| `finish` | 시그니처 그대로. 안에서 `autoAdmit`(§3.1). 반환 모양 그대로(`FinishResult`, `types.ts:56-71` [확인]) |
| `redeem` | `RedeemResult`의 `denied`에 `reason?: "daily_limit" \| "blocked"`(`types.ts:87` [확인]에 선택 필드). `flow.deny_reason`에서 읽는다. `activate`가 `not_allowed`인 경합(`flows.ts:302` [확인])은 그 순간 `blocked` 행이 있으면 `blocked`, 없으면 이유 없음 |
| `doneView` | `DoneView`에 `denyReason: "daily_limit" \| "blocked" \| null`(`types.ts:76-83` [확인]). Worker는 `?? null`로 옛 DO 응답을 받는다(지금 `inviteOwnerName`과 같은 규칙, `pages.ts:65-66` [확인]) |
| `adminView` | `AdminView`에 `autoAllow: { cap, today, capBy, capAt }`·`blocked: […]`(최근 200)·`allowlistTotal`·`blockedTotal`. `allowlist`에 `LIMIT 200`(§4.7) |
| `disallow` | §3.3 (나) 표. `DisallowResult` 모양 그대로 |
| `allow`·`allowDenied` | 차단 행도 지운다(§3.3 (다)). 모양 그대로 |
| **`setAutoAllowCap(cap, by, now)`**(새) | `cap`이 정수 0~100이 아니거나 `by`가 채널 ID 형식이 아니면 `{ ok: false, code: "bad_request" }`, 아니면 meta 세 키를 쓰고 `{ ok: true }` |

### 4.4 Worker 경로

| 경로 | 자격 | quiet | 처리 |
|---|---|---|---|
| `POST /admin/auto-allow`(새) | admin | 아니오 | 본문 `csrf`·`cap`(form). 부트스트랩 403 → 세션 없음 303 → 비관리자 403 → `guardWebPost` → `cap` 형식 400(오류 요약, 입력값 채움) → RPC → 303 `/admin` + flash `autoAllowSaved` |
| `POST /admin/disallow` | admin | 아니오 | 의미가 차단으로 바뀐다(§3.3). 경로 이름은 그대로 둔다(경로 표·행렬·E2E 이름을 바꾸는 비용에 비해 얻는 것이 없다 [가정]) |
| `GET /admin/:channelId/disallow` | admin | 예 | §3.7 끝 |
| `/auth/redeem` | none | 아니오 | `denied`면 `{status:"denied", channelName, reason?}`(`auth.ts:350` [확인]에 키 하나) |
| `/auth/done` | flow | 아니오 | `doneParts`의 `denied` 갈래가 `denyReason`으로 문구를 고른다(`pages.ts:59-78` [확인]) |

경로 표 `routes.ts`(ROUTES 한 행), 행렬 `test/matrix.test.ts`, worker.md §4.4·§4.5 표에 한 행씩 더한다.

### 4.5 앱 ↔ Worker 계약과 커밋 타입

- 바뀌는 응답은 `/auth/redeem` 200 `denied` 하나이고 **선택 키 `reason`을 더하기만** 한다. 토큰 묶음·`/api/me`·refresh·`/update`·`/releases/**`는 그대로다.
- **옛 앱 + 새 Worker**: 셸의 `parse_redeem`은 `denied`에서 `channelName`만 읽고 다른 키는 보지 않는다(`api.rs:359-372` [확인]). 지금 안내("허가가 없어요")를 그대로 보인다. 상한에 걸린 사람에게는 덜 정확하지만 로그인 자체는 지금과 같이 돈다.
- **새 앱 + 옛 Worker**(같은 태그에서 앱이 먼저 닿는 구간, `delegation.md` §8.7): `reason`이 없으면 지금 안내다.
- 모르는 `reason` 값(뒤에 더할 값)은 셸이 "이유 없음"으로 본다.
- `versioning.md:27-33`의 세 기준(사용자 데이터·앱 ↔ Worker 계약·업데이트 경로) 어디에도 들지 않는다. 이미 배포된 앱의 요청을 Worker가 거부하는 일이 없다. 그래서 **`feat`이고 `!`이 아니다**. 사용자에게 보이는 기능이다(누구나 로그인하면 쓸 수 있다). DO 스키마 V4는 더하기만이고, `session.json`·`settings.json`은 바뀌지 않는다.

### 4.6 되돌리기(wrangler rollback으로 V3 코드 + V4 DB)

- 마이그레이션이 더하기만이라 옛 코드는 `blocked` 표·`deny_reason` 열·meta 키를 모른 채 돈다(`schema.ts:3-4` "DB 버전이 코드보다 앞서면 던지지 않는다" [확인]).
- 자동 허가 행은 보통 허가 행이라 옛 코드에서도 허가다. 차단된 채널은 허가 행이 없으니 옛 코드에서도 거부다(자동 허가가 없으므로).
- 되돌린 동안 옛 `allow`가 차단 채널을 허가하면 차단 행이 남는다. V4로 돌아와도 허가가 이긴다(§3.3 (가)). 관리자가 의도한 대로다.
- 되돌린 동안 옛 `disallow`로 뺀 채널은 차단 행이 없어 V4로 돌아온 뒤 자동 허가될 수 있다. 런북 한 줄로 알린다: "되돌린 동안 뺀 채널은 돌아온 뒤 다시 차단해 주세요."

### 4.7 호출 수·무료 한도

- **요청당 DO·R2 횟수는 바뀌지 않는다.** 자동 허가는 이미 있는 `finish` RPC 한 번 안에서 일어난다. 새 경로 `POST /admin/auto-allow`는 다른 관리 POST처럼 웹 세션 확인 + RPC 하나(DO 2회, R2 0회)다. 랜딩의 비로그인 DO 0·R2 0(worker.md 구현 중 변경 38 (가))을 지키려고 **랜딩에는 상한 숫자를 보이지 않는다**(§5.3). `test/http/r2-calls.test.ts`의 R2 계수 표는 그대로다.
- **관리 화면 읽기**: 지금 `adminView`는 허가 행 전부를 행마다 세션 수 하위 쿼리와 함께 읽는다(`allowlist.ts:114-117` [확인], LIMIT 없음). 개방하면 행이 끝없이 늘어난다. 그래서 허가·차단 표는 **최근 200행**(`added_at DESC`·`blocked_at DESC`)과 전체 수(`count(*)`)만 읽는다. 거부 기록은 이미 200행이다(`allowlist.ts:118` [확인]).
- **DO 쓰기(10만 행/일)**: worker.md §5의 계산(`worker.md:301` [확인])은 "정상 사용자 20명 refresh 3회 × 3행"을 가정했다. 개방 뒤에는 사용자 수가 하루 최대 상한만큼 는다. 활성 사용자 한 명은 하루 약 9행을 쓴다(같은 가정). 공격자 몫 약 19,000행을 빼면 약 8,900명까지 계산 안이다. 상한 20이면 매일 다 차도 약 445일 걸린다. 상한 100이면 약 89일 걸린다(§2.2 A3). 자동 허가 한 건은 허가 행·meta 두 행·거부 기록 삭제로 4행 안팎이라 무시할 만하다. worker.md 구현 중 변경에 이 계산을 다시 적고, 허가 행이 5,000을 넘으면 다시 본다(§9-1).
- **요청 수(10만/일)**: 사용자가 늘면 랜딩·`/update`·refresh 요청이 는다. 소진 대응은 worker.md 구현 중 변경 11 (아) 그대로다(앱은 1027을 네트워크 실패로 보고 72h 유예 안에 둔다).
- **R2 Class B**: 요청당 2회 상한(11 (라))이 그대로라 요청 수 한도 안에서 묶인다. 저장은 바뀌지 않는다.
- **거부 기록 200행**(`allowlist.ts:12` [확인]): 상한에 걸린 사람이 많으면 오래된 기록이 빨리 밀린다. 관리 화면에서 볼 수 있는 기간이 짧아질 뿐 판정에는 쓰지 않는다.

---

## 5. 문구(초안. 값의 원천은 `docs/design/system/content.md` §15이고 구현 PR이 그 표를 먼저 고친다)

규칙: 해요체, 요청은 "해 주세요", 제목·라벨은 마침표 없음, 본문은 있음, 따옴표 ‘ ’(`copy.ts:3` [확인]).

### 5.1 앱 `app/src/lib/copy/ko.ts`(+ `content.md` §15.1)

| 키 | 지금 | 바뀐 뒤 |
|---|---|---|
| `auth.intro` | 허가받은 채널만 쓸 수 있어요. 치지직 계정으로 로그인해 주세요.(`ko.ts:298` [확인]) | **치지직 계정으로 로그인하면 쓸 수 있어요. 받을 수 있는 영상은 내 채널과 맡은 채널의 영상이에요.** |
| `auth.denied.*` | (`ko.ts:317-319` [확인]) | 그대로. 이유가 없을 때(부트스트랩·상한 0·옛 Worker)만 쓴다 |
| (새) `auth.dailyLimit.title` | — | **오늘은 새로 시작할 수 없어요** |
| (새) `auth.dailyLimit.body` | — | **새로 쓰는 채널은 하루에 받는 수가 정해져 있어요. 한국 시간 자정이 지난 뒤 [다시 시도]를 눌러 주세요.** |
| (새) `auth.dailyLimit.editorHint` | — | **초대 주소를 열었다면 다음에 로그인할 때 편집자가 돼요.** |
| (새) `auth.blocked.title` | — | **사용이 막힌 채널이에요** |
| (새) `auth.blocked.body` | — | **관리자가 이 채널의 사용을 막았어요. 다른 채널로 로그인하거나 관리자에게 채널 이름을 알려 주세요.** |
| `account.scope` | 허가받은 채널이에요(`ko.ts:344` [확인]) | 그대로(로그인한 채널은 허용목록에 있다) |

- 화면 배선(`app/src/lib/auth.ts:116-122` [확인]): `denied`에서 `reason`이 `dailyLimit`이면 상한 화면, `blocked`면 차단 화면, `removedFromAllowlist`는 지금 그대로, 그 밖은 지금 `auth.denied`. 버튼은 셋 다 [다시 시도](주 버튼)이고 채널 행·다른 계정 안내는 지금과 같다.
- 셸: `AuthReason`에 `DailyLimit`·`Blocked`(`status.rs:26-47` [확인]), `AuthReasonDto` 같은 둘(`dto.rs:1222` [확인]) → `UPDATE_BINDINGS=1`. `RedeemResponse::Denied`에 `reason: Option<DenyReason>`(`api.rs:194` [확인]), `Final::Denied(name, reason)`(`service.rs:1062-1067` [확인])가 `i.reason`을 채운다.

### 5.2 수신기 페이지(`crates/shell/src/auth/loopback.rs:86`, `content.md` §15.4 행)

| 지금(코드) | 지금(`content.md:677`의 표 값) | 바뀐 뒤(둘 다) |
|---|---|---|
| 이 채널은 사용 허가가 없어요. 앱에서 안내를 확인해 주세요. | 허가되지 않은 채널이에요. 앱에서 안내를 확인해 주세요. | **이 채널로는 지금 쓸 수 없어요. 앱에서 이유와 다음에 할 일을 확인해 주세요.** |

코드와 표가 이미 어긋나 있다([확인]). 이번에 둘을 같은 값으로 맞춘다. `ROADMAP.md:269`가 인용하는 페이지 이름도 이 문장으로 바꾼다.

### 5.3 Worker `worker/src/http/copy.ts`(+ `content.md` §15.3)

| 키 | 지금 | 바뀐 뒤 |
|---|---|---|
| `anonLead` | 허가받은 채널만 쓸 수 있어요.(`copy.ts:44`) | **치지직으로 로그인하면 쓸 수 있어요.** |
| `loginSectionBody` 끝 문장 | 허가되지 않은 채널이면 이유와 다음에 할 일을 앱이 알려 줘요.(`copy.ts:179`) | **로그인할 수 없으면 이유와 다음에 할 일을 앱이 알려 줘요.** |
| (새) `doneDenied.dailyLimit` | — | 제목 **오늘은 새로 시작할 수 없어요** / 본문 **새로 쓰는 채널은 하루에 받는 수가 정해져 있어요. 한국 시간 자정이 지난 뒤 다시 로그인해 주세요.** |
| (새) `doneDenied.blocked` | — | 제목 **사용이 막힌 채널이에요** / 본문 **관리자가 이 채널의 사용을 막았어요. 다른 계정으로 로그인하려면 네이버에서 먼저 로그아웃해 주세요.** |
| `doneDenied.*` | (`copy.ts:26-33`) | 그대로(이유 없을 때). 초대 줄(`invite`·`cancelHint`)은 셋 모두에서 지금처럼 붙는다 |
| `privacy.collect.body` | (`copy.ts:89`) | 지금 두 문장 + **처음 로그인하면 채널 이름과 채널 ID를 사용 허가 목록에 저장해요.** |
| `privacy.keep`(새 함수 둘) | — | `allowed` **사용 허가 목록의 채널 이름과 채널 ID는 허가가 빠질 때까지 남아요.** / `blocked` **관리자가 막은 채널의 이름과 채널 ID는 막는 동안 남아요.** |
| `privacy.keep.audit` | (`copy.ts:109`) | 그대로(자동 허가는 감사에 남기지 않으므로 여전히 참이다, §3.8) |
| `notice.unofficial` 끝 문장 | (`copy.ts:70`) | 그대로(범위 고지는 소유 게이트이고 바뀌지 않는다) |
| 관리: `disallow` | 허가 빼기…(`copy.ts:235`) | **차단…** |
| 관리: `confirmDisallow` | (`copy.ts:237-241`) | 제목 **이 채널을 차단할까요?** / 본문 **‘{name}’ 채널을 차단하면 로그인한 앱과 브라우저 {n}개가 다음에 서버에 연결할 때 끊겨요. 차단한 채널은 자동으로 허가되지 않아요. 다시 허가해도 끊긴 기기는 새로 로그인해야 해요.** / 돌아가기 그대로 |
| 관리: `audit.disallow` | 허가 빼기(`copy.ts:263`) | **차단** |
| 관리(새) | — | `autoTitle` **자동 허가** / `autoToday(n, cap)` **오늘 자동 허가 {n} / {cap}** / `autoDayNote` **날짜는 한국 시간 자정에 바뀌어요.** / `autoCapLabel` **하루 상한(0~{max})** / `autoOff` **0이면 자동 허가를 끄고 관리자만 허가해요.** / `save` **저장** / `autoAddedBy` **자동 허가** / `autoCapBy(who, at)` **마지막으로 바꾼 관리자 {who} · {at}** / `blockedTitle` **차단한 채널** / `blockedEmpty` **차단한 채널이 없어요.** / `colBlockedBy` **차단한 관리자** / `colBlockedAt` **차단한 시각** / `blockedTag` **차단함** / `listTotal(n)` **전체 {n}개 중 최근 200개** / flash `autoAllowSaved` **저장했어요.** / 오류 `badCap(max)` **하루 상한은 0부터 {max}까지의 정수예요.** |

### 5.4 도움말(`help/`)

- 새 항목 `help/login-denied.md`("로그인이 거부될 때"), `help/ids.json`의 `ids` 끝에 `login-denied`(D51 "앵커 id는 추가만" — `ids.json` 지금 여덟 [확인]). 내용: ① 오늘 새 채널 자리가 다 찼다는 안내면 한국 시간 자정 뒤 다시 로그인 ② 사용이 막힌 채널이면 다른 채널로 로그인하거나 관리자에게 연락(GitHub 이슈, 민감 정보 금지) ③ 초대 주소를 열었다면 들어오는 날 편집자가 된다 ④ 문제 보고 상수(`copy.ts:182`).
- `help/editors.md:16`: "사용 허가가 없는 채널이면 관리자가 허가할 때 편집자가 돼요. 허가를 받은 뒤 앱의 로그인 화면에서 [다시 시도]를 눌러 주세요." → **"오늘 새 채널 자리가 다 찼다면 다음 날 다시 로그인할 때 편집자가 돼요. 그 뒤 앱의 로그인 화면에서 [다시 시도]를 눌러 주세요."**
- 생성물 `worker/src/http/help.generated.ts`는 `scripts/design/worker-gen.mjs`로 다시 만든다(`design-icons` gate가 `--check`).

### 5.5 용어(`design/copy/terms.json`, `content.md` §4)

"차단"(관리자가 자동 허가를 막는 동작, 금지 변형 "블록"·"밴"), "자동 허가", "하루 상한"을 더한다. "허가 빼기" 항목(`terms.json:868` [확인])은 "차단"으로 바꾼다(B2 가). `design-copy` gate가 패리티를 본다.

---

## 6. 테스트 계획(TDD: 실패 테스트 먼저, 보강 테스트는 구현을 깨서 잡는지 확인)

### 6.1 store(`worker/test/store/auto-allow.test.ts` 새 파일, `runInDurableObject`·`freshStub`)

| # | 사례 | 기대 |
|---|---|---|
| S1 | 새 채널, 상한 기본 | 앱 흐름 ok, 허가 행 `added_by='auto'`, 센 수 1, 그 채널 거부 기록 없음, 감사 행 **0** |
| S2 | 20명 허가 뒤 21번째 | 21번째 redeem `{status:"denied", reason:"daily_limit"}`, 거부 기록 1행, 허가 행 20 |
| S3 | **21명 동시**: `Promise.all`로 서로 다른 채널 21개의 `finish` | 허가 정확히 20, 거부(`daily_limit`) 정확히 1, `auto_allow_count = 20` |
| S4 | 같은 채널 흐름 둘이 겹침 | 둘 다 ok, 센 수 1 |
| S5 | 경계: `now = Date.UTC(…, 14, 59, 59, 999)`(KST 23:59:59.999)에 상한까지 채우고 `+1ms`(KST 00:00) | 경계 뒤 첫 사람은 허가, 센 수 1 |
| S6 | UTC 자정(KST 09:00)을 지남 | 초기화되지 **않는다** |
| S7 | 시계 역행: 저장 날 키보다 작은 `now` | 같은 날로 센다(0부터 다시 세지 않는다) |
| S8 | 차단된 채널 | `reason:"blocked"`, 센 수 그대로 |
| S9 | 관리자·이미 허가된 채널 | 세지 않음 |
| S10 | 부트스트랩(`admins=[]`) | 거부, 이유 없음, 허가 행 없음 |
| S11 | 상한 0 / meta 형식 틀림(`"abc"`, `"-1"`, `"101"`) | 거부, 이유 없음 / 0으로 봄 + 경고 로그 |
| S12 | 상한을 오늘 수보다 낮춤·높임 | 즉시 반영 |
| S13 | 어제 상한에 걸려 초대를 청구한 편집자가 오늘 자동 허가(앱 흐름) | 위임이 생긴다(`completeClaimed`), 순서를 바꾸면(거부 기록 먼저 삭제) 이 테스트가 실패하는지 확인 |
| S14 | 초대 웹 흐름 + 자동 허가 | `invite: "accepted"` |
| S15 | `disallow`: 허가 행 있음 / 없음 / 이미 차단 / 관리자 | §3.3 (나) 표 그대로, 차단 뒤 로그인 `blocked` |
| S16 | `allow`·`allowDenied`로 차단 풀기 | 차단 행 삭제, 허가, 센 수 그대로 |
| S17 | 허가 행 + 차단 행이 함께 있음(되돌리기 흔적) | 허가 |
| S18 | `setAutoAllowCap` 검증(소수·음수·101·문자열·관리자 ID 형식 아님) | `bad_request`, meta 그대로 |
| S19 | `doneView`의 `denyReason`, `adminView`의 `autoAllow`·`blocked`·`LIMIT 200`·전체 수 | 값 일치, 201번째 행은 보이지 않음 |
| S20 | 스키마 V3 → V4 마이그레이션(`schema.test.ts`) | 기존 행 보존, `/health` schema 4, V5 DB(앞섬)에서도 돈다 |
| S21 | `finishEvent` | 거부 이유·자동 허가 `reason` 값, 채널 값 없음(`log.test.ts`·`login-log.test.ts`) |

### 6.2 HTTP·화면(vitest)

- `POST /admin/auto-allow`: CSRF 6사례(Origin 없음·다름·같음 × 토큰 없음·틀림·맞음, worker.md §8.1), 비관리자 403, 부트스트랩 403, `application/x-www-form-urlencoded`가 아니면 415, `cap` 오류 400 + 오류 요약 + 입력값 채움, 성공 303 + flash.
- `/auth/redeem` JSON: `reason` 있음·없음(`login-app.test.ts`). `/auth/done`: 이유별 제목·본문, 초대 줄 결합(`login-web.test.ts`, `unit/pages.test.ts`).
- 관리 화면: 자동 허가 절·"자동 허가" 표시·차단 표·꼬리표·"전체 n개"(`unit/admin-view.test.ts`), XSS: 차단 행 이름 `<script>…`(`admin-xss.test.ts`).
- 경로 행렬(`matrix.test.ts`)·경로 표(`routes.test.ts`)에 새 행, `quiet.test.ts`의 확인 페이지 기대, `hygiene.test.ts`의 `raw(` 허용 목록은 늘리지 않는다.
- 랜딩·읽기 페이지(`landing.test.ts`·`reading.test.ts`): 새 `anonLead`·`/privacy` 문장·`/help#login-denied`.

### 6.3 기존 테스트를 옮기는 법(기본 상한 20이 기대를 뒤집는다)

모르는 채널이 거부된다고 기대하는 테스트는 기본값에서 **자동 허가**로 바뀐다. 거부를 기대하는 파일(지금 `denied`를 쓰는 곳 [확인]): `store/allowlist.test.ts`·`flows.test.ts`·`delegation.test.ts`·`alarm.test.ts`·`sessions.test.ts`, `http/admin.test.ts`·`admin-xss.test.ts`·`invite.test.ts`·`login-app.test.ts`·`login-web.test.ts`·`quiet.test.ts`·`web-hygiene.test.ts`, `matrix.test.ts`.

- 도우미 하나를 `test/store/helpers.ts`에 둔다: `closeAutoAllow(stub, now)` = `setAutoAllowCap(0, A1, now)`. 거부를 전제로 한 `describe`의 `beforeEach`가 부른다. HTTP 하네스(`test/http/harness.ts`)도 같은 도우미를 쓴다.
- **가+ 경로**(거부 → 초대 청구 → 관리자 [허가] → 위임 완성, `flows.ts:210-219`)는 상한 0으로 그대로 지난다. 여기에 **상한 1 + 미리 한 명 허가**로 `daily_limit` 거부에서 청구하는 사례와 **차단** 거부에서 청구하는 사례를 하나씩 더한다(청구는 거부 이유와 상관없이 같아야 한다).
- 자동 허가 자체는 §6.1이 기본 상한으로 본다. 도우미를 쓰지 않는 기존 허용 사례(`b2`)는 관리자가 넣은 허가라 그대로다.

### 6.4 worker-e2e(`worker/scripts/e2e-dev.mjs`, 가짜 치지직)

- 가짜 계정 `e5`(`"e5".padStart(32,"0")`, 이름 "합성새채널E5")를 `worker/test/fake-chzzk.mjs:9-14`·`testdata/README.md`(a1 관리자·b2 허용·c3 거부·d4 기타 → c3 "상한 0·차단으로 거부"·e5 "새 채널")·`fake-chzzk-server.mjs`의 `--account` 안내에 더한다.
- **E05(관리자 로그인) 첫 동작**으로 `POST /admin/auto-allow cap=0`을 한다. 그 뒤의 기존 시나리오(E09 c3 거부·E09b 초대 거부·E10 허가)는 지금 기대 그대로다.
- E05b(확인 페이지): `d4`(허가에도 차단에도 없음)는 이제 200 확인 페이지다(B3 가). 303 `alreadyDone` 사례는 "이미 차단된 채널"로 옮긴다.
- 새 시나리오(끝에 둔다, 상태를 바꾸므로): **E20-auto** 상한 1로 저장 → `d4` 앱 로그인 ok(`isAdmin:false`) → `/admin`에 "자동 허가" 표시 → `e5` 앱 로그인 `{status:"denied", reason:"daily_limit"}`, 거부 기록에 `e5` → **E21-block** `d4` 차단(확인 페이지 → POST) → `d4`의 access로 `/api/me` 403 `not_allowed` → `d4` 다시 로그인 `reason:"blocked"`, 완료 페이지(웹 흐름) 차단 문구 → **E22-unblock** 차단 표 [허가] → `d4` 로그인 ok, 센 수 그대로. 마지막에 상한 0으로 되돌린다.
- 날짜 경계는 wrangler dev에서 시계를 바꿀 수 없어 vitest(§6.1 S5~S7)만 본다.
- 로그 카나리아(E17): 새 이벤트의 `reason` 값에 채널 ID가 실리지 않는다.

### 6.5 셸·앱

- 셸(`crates/shell/tests/auth_http.rs`·`auth_loopback.rs`·`auth_service.rs`): `parse_redeem`의 `reason` 셋(있음 둘·모르는 값·없음), `Final::Denied` → `AuthStatus.reason`, 수신기 문장(§5.2), 다시 로그인 시작 때 `reason`이 지워짐.
- 앱 vitest(`app/src/lib/auth.test.ts`·`components/app/auth.test.ts`): 거부 이유 넷의 화면(제목·본문·버튼·힌트).
- 가짜 백엔드 `app/e2e/mock/backend.ts`에 거부 이유 두 상태, `app/e2e/auth.spec.ts`·`login.spec.ts` 사례, 갤러리 `app/e2e/screens-data.ts`에 두 화면 → `design-shots` 기준선은 Linux CI artifact를 `shots.mjs --accept`로 받는다.
- 바인딩: `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`(`AuthReason.ts`).

### 6.6 gate

`node scripts/ci/run.mjs worker` · `worker-e2e` · `design-tokens`(design-copy·design-icons 포함) · `frontend` · `rust` · `tauri` · `e2e-web` · `scan`. Worker 화면을 바꾸므로 `design-worker` 기준선도 다시 받는다.

---

## 7. 기록할 곳

- worker.md "구현 중 변경"에 **다음 번호**(지금 108 다음, 머지 직전 origin/master로 다시 확인): V4·`autoAdmit` 판정 순서·KST·원자성·차단 의미·감사 정책·`adminView` LIMIT·무료 한도 재계산(§4.7)·되돌리기 규칙(§4.6). §5 무료 한도 계산과 §8.1·§8.3 본문에는 "구현 중 변경 N으로 바뀜" 표시만 단다.
- app.md "구현 중 변경"에 다음 번호(지금 90 다음): 거부 이유 두 화면·`AuthReason` 두 값.
- `delegation.md` §0 "허용목록 관계" 행 아래에 정정 문단 한 줄(가+는 자동 허가가 안 될 때로 좁아진다, §3.6).
- `ROADMAP.md:98` 결정 행의 취소선 갱신("배포 자체는 본인·지인만" → 자동 허가 + 하루 상한)은 **구현이 머지될 때** 한다(이 문서 PR에서는 하지 않는다). `ROADMAP.md:269` 수신기 페이지 이름도 그때 고친다.
- `docs/runbook/w9-first-deploy.md`: 되돌리기 주의(§4.6) 한 줄, 상한 0 = 되돌리기 스위치.

---

## 8. 단계(stacked PR, 인증·DO를 건드리므로 Codex 리뷰 대상)

| # | 브랜치(예) | 내용 | 커밋 타입 | gate |
|---|---|---|---|---|
| 0 | `feat/allowlist-open`(이 PR) | 이 명세 + ROADMAP 현재 위치 한 줄 | `docs` | scan |
| W1 | `feat/allowlist-open-store` | 스키마 V4, `autoAdmit`·`kstDay`·차단·`setAutoAllowCap`·`adminView` LIMIT, `redeem`·`doneView`·`finishEvent` 이유, §6.1 + §6.3 옮기기. HTTP 응답은 아직 그대로 | `feat` | worker |
| W2 | `feat/allowlist-open-web` | `POST /admin/auto-allow`·관리 화면 절·차단 라벨, `/auth/redeem` `reason`, 완료 페이지, 랜딩·`/privacy`·`/help`(+생성물), `content.md` §15.3·terms.json, §6.2·§6.4, worker.md 구현 중 변경 | `feat` | worker · worker-e2e · design-tokens · design-worker(기준선) · scan |
| A1 | `feat/allowlist-open-app` | 셸 `reason`·`AuthReason`·수신기 문장, 앱 화면·ko.ts·content.md §15.1·§15.4, bindings, 가짜 백엔드·E2E·갤러리, app.md 구현 중 변경 | `feat` | rust · tauri · frontend · e2e-web · design-tokens · scan |
| R | `release/v0.11.0` | ROADMAP 결정 행·`:269`·런북, 버전 PR(`feat`이라 minor, `release.mjs next-version`으로 확인). 태그·운영 배포는 사용자 승인 뒤 | `chore` | versions · 전체 |

- W1만 머지된 master를 태그하지 않는다. 그 상태는 자동 허가가 켜져 있는데 `/privacy`가 아직 옛 문구다. W2·A1까지 한 태그에 담는다.
- 같은 태그에서는 앱 산출물이 Worker보다 먼저 닿는다(`delegation.md` §8.7). 새 앱 + 옛 Worker 구간은 `reason`이 없어 지금 안내를 보인다(§4.5).
- 배포 뒤 확인(사용자, 운영): 관리자 로그인 → `/admin` 자동 허가 절이 "0 / 20"인지 → 다른 계정 하나로 로그인해 자동 허가되는지 → 그 채널 차단 → 거부 문구. 결과는 범주만 ROADMAP에 적는다.

---

## 9. 위험

1. **사용자 수 증가가 무료 한도를 먹는다**(§4.7). 상한이 하루 증가를 묶는다. 허가 행 5,000을 넘으면 DO 쓰기·요청 수를 대시보드에서 다시 본다. 대응은 상한 낮추기 → 0.
2. **같은 사람이 계정을 여럿 만든다.** 하루 상한이 피해를 묶는다. 각 계정은 자기 채널 영상만 받으므로(소유 게이트) 남의 영상을 받는 길은 열리지 않는다. 상한을 다 써서 정상 사용자가 그날 못 들어오는 것은 받아들인다. 대응은 차단 + 상한 조정이다.
3. **관리 화면이 긴 목록을 다 보여 주지 못한다.** 최근 200행만 보인다. 오래된 채널을 찾아 차단하려면 채널 ID로 확인 페이지 `GET /admin/:channelId/disallow`를 연다(B3 가로 허가에 없어도 열린다). 검색 UI는 두지 않는다.
4. **모르는 사람의 채널 ID를 기한 없이 저장한다.** `/privacy`에 적고(§5.3) 지우는 길은 연락처다. 관리자는 차단하거나 거부 기록을 지울 수 있지만, 허가 행을 차단 없이 지우는 동작은 없다(B1 가의 대가). 요청을 받으면 차단 행이 남는다는 점을 함께 알린다. 차단 행도 지우는 방법이 필요해지면 그때 "기록 지우기" 동작을 더한다.
5. **배포 순간 열린다**(§2.2 A2 가). 되돌리기는 `/admin`에서 상한 0이고 재배포가 필요 없다.
6. **본인 탈퇴·오래된 채널 정리가 없다**(§1.2). 요청이 오거나 위험 1의 재계산에서 문제가 되면 `added_by='auto'` 행 중 마지막 세션이 N일 전인 행을 정리하는 청소를 검토한다.
7. **새 사용자가 상한을 처음 만나는 곳은 웹 완료 페이지다.** 설치 파일은 허가된 웹 세션에만 보인다(`copy.ts:59` "로그인하면 내 컴퓨터용 설치 파일이 보여요" [확인]). 그래서 처음 오는 사람은 대개 랜딩에서 웹 로그인을 하고, 상한에 걸리면 `doneDenied.dailyLimit`(§5.3)을 본다. 앱 거부 화면(§5.1)은 설치 파일을 다른 사람에게 받았거나 차단된 사람이 만난다. 옛 앱으로 상한에 걸리면 "허가가 없어요"를 본다(§4.5) [가정: 드문 경우].

---

## 10. 구현 중 변경(본문보다 우선, worker.md 109·app.md 91)

1. **§2.2 선택은 추천대로 구현했다**: A1 가(한국 시간 자정)·A2 가(기본 20)·A3 가(0~100)·B1 가·B2 가·B3 가·C1 가·C2 가. 사용자가 다른 선택지를 고르면 §2.2 표의 "바꾸는 곳" 칸만 고친다: A1 `kstDay`(`store/allowlist.ts`), A2 `AUTO_ALLOW_DEFAULT_CAP`·A3 `AUTO_ALLOW_CAP_MAX`(`core/auto-allow.ts`), B2 `copy.ts` `disallow`·`confirmDisallow`·`audit.disallow`(+ `content.md` §15.3, `terms.json`), C1 redeem `reason`(`flows.ts`·`auth.ts`·`api.rs`), C2 `loopback.rs` 문장.
2. **§3.1 "admins는 검증을 거친 값"은 사실이 아니었다**: `AuthStore.finish`는 `admins`를 검증 없이 넘긴다. `flows.finish`가 문자열 배열이 아니면 자동 허가를 하지 않는다(fail closed, S10b).
3. **§3.8 로그의 이유는 `FinishResult`에 싣지 않는다**: 내부 `FinishSettled.logReason`·`capInvalid`로 나르고 AuthStore가 떼어 낸다(RPC 응답 모양 그대로). `finishEvent`는 네 번째 인자 `reason`을 받는다.
4. **§3.7·§4.3 확인 페이지는 새 RPC `disallowTarget(channelId, now)`를 쓴다**: `adminView`가 200행으로 줄어 그 밖의 오래된 채널이 `alreadyDone`이 되는 모순(§9-3)을 피한다. 요청당 DO 호출 수는 그대로(2회).
5. **§4.3 `AdminView`**: 거부 행에 `blocked`(꼬리표), 최상위에 `autoAllow`·`blocked`·`allowlistTotal`·`blockedTotal`. 렌더러는 새 필드가 없는 옛 DO 응답에도 던지지 않는다.
6. **§5.3 문구**: `autoCapLabel`은 "하루 상한(최대 {max})"(DC9가 `~`를 막는다), `autoAddedBy`는 `autoTitle`과 값이 같아 합쳤다(DC11), `listTotal(n, max)`는 200을 상수로 받는다, `privacy.keep.allowed`·`blocked`는 문자열이다, 상한 [저장]은 보조 버튼, 이미 차단된 거부 행에는 [차단…]을 두지 않는다, flash `autoAllowSaved`는 아이콘을 따로 고르지 않는다(DI4: `circle-check`는 로그인 완료 뜻 하나).
7. **§5.4 도움말**: `help/login-denied.md`와 짝으로 앱 셸에 `HelpId::LoginDenied`(9번째)를 더했다(`ids.json` 집합 일치 테스트).
8. **§6.3 테스트 도우미**: store는 `closedStub()`/`closeAutoAllow(stub)`, HTTP는 `closeAutoAllow()`와 `resetStore()`(`meta`의 `auto_allow_*`도 비운다). 한 파일의 HTTP 테스트가 같은 DO를 쓰므로 오늘 센 수가 다음 테스트로 새지 않게 한다.
9. **§6.4 worker-e2e**: E05 첫 동작이 상한 0, E05b `d4`는 200(미리 막기), E20~E22(E13이 관리자 웹 세션을 로그아웃하므로 E20이 새로 로그인한다). `admin.auto_allow_cap`이 필수 이벤트다. 가짜 계정 `e5`는 `worker/test/fake-chzzk.mjs`·`fake-chzzk-server.mjs`에 있다(`testdata/README.md`는 영상 fixture 문서라 계정 표가 없어 고치지 않았다).
10. **하지 않은 것**: §8 R(버전 PR, ROADMAP 결정 행 취소선·`:269` 문장). `design-shots`·`design-worker` 기준선(Linux CI에서만 만든다)과 앱 `e2e-web` 실행은 로컬에서 하지 않았다.
