# 0020 서비스 공지: 사람이 올리는 R2 객체 하나, 읽기만 하는 `GET /notice`, 고장 나면 공지 없음

상태: 채택(잠정)   날짜: 2026-10-10   관련: D41, web §1·§15, worker.md 구현 중 변경 100, 적용 단계 (e)

## 맥락

치지직 API가 흔들리거나 받기가 일시적으로 막힐 때 앱이 "인터넷이 불안정해요"로만 말하면 사용자가 서비스 장애를 자기 탓으로 읽는다(g-outage). 서비스 쪽에서 한 줄을 알릴 길이 필요하다. 조건은 셋이다. 운영 비용 0(Workers Free, R2 읽기 호출은 요청당 상한이 있다, worker.md 38), Worker에 쓰기 경로를 두지 않는다(공격면과 감사 기록이 늘어난다), 공지 때문에 앱이나 Worker가 고장 나지 않는다. 앱이 이 공지를 읽는 일은 (f) 이후다. 이 단계(e)는 Worker 쪽 `GET /notice`만 만든다.

## 결정

`GET /notice`는 인증 없이 늘 `200 application/json` + `Cache-Control: no-store`로 답한다. 본문은 `{"schema":1,"notice":null}` 또는 `{"schema":1,"notice":{ id, level, kinds, text, expiresAt }}`이다. 원천은 R2 객체 `service/notice.json` **하나**이고(활성 공지는 한 개), `releases/` 밖이라 prune·delete-version이 지우지 않는다. 사람이 대시보드나 rclone으로 올리고 Worker에는 쓰기 경로가 없다. 규칙:

- 모양: `id` `^[a-z0-9-]{1,64}$`, `level` `info|warn|block`, `kinds` `("vod"|"clip")[]`(빈 배열 = 전체), `text` 1~80 코드포인트 평문, `expiresAt` RFC 3339.
- 실효 만료 = min(`expiresAt`, R2가 기록한 올린 시각 + 72시간). 올리는 사람이 만료를 잘못 적거나 잊어도 3일 안에 내려간다(`NOTICE_TTL_H = 72`, `NOTICE_MAX_CHARS = 80`은 foundations §14 상수이고 `design-tokens` DT15가 대조한다).
- 글 안전: `<`·`>`, 제어 문자·bidi 서식 문자, `://`·`www.`(링크 금지), 80자 초과는 통째로 거부한다.
- **fail-open**: 객체 없음, 해석 실패, 크기 초과(2048바이트), R2 예외는 모두 `notice: null`이다. 공지 장애가 서비스 장애가 되지 않는다. 로그는 warn `notice.invalid`·`notice.unavailable`이고 필드는 `reason`·`errorName`뿐이다.
- 비용: 판정을 isolate 안에 60초 캐시하고(칸 하나) 요청당 R2 get은 최대 1회다. 캐시된 공지도 실효 만료 시각이 지나면 내려간다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 장애를 사용자 탓으로 말하지 않으려면 원인을 가르는 서비스 쪽 사실이 필요하다 | E1 | `G-OUTAGE-R9`(진단 local·service·unknown), README D41 | 2026-10-10 |
| 공지는 사람이 게시하고, 모든 공지에 만료와 72시간 상한이 있으며, 활성은 한 개다 | E1 | `G-OUTAGE-R4`·`G-OUTAGE-R7`·`G-OUTAGE-R8`(72시간은 보고서 판단) | 2026-10-10 |
| 공지는 정해진 코드와 80자 이하 평문이고 HTML·링크가 없다 | E1 | `G-OUTAGE-R6`(80자는 보고서 판단), README D41(공개 저장소 규칙) | 2026-10-10 |
| 공지를 못 받거나 해석하지 못하면 아무것도 막지 않는다(fail-open) | E1 | `G-OUTAGE-R3` | 2026-10-10 |
| 이 모양(R2 객체 하나 + 읽기만 하는 JSON 경로)은 어느 사례에도 그대로 없어 설계로 정당화한다. 서버가 올린 시각에서 만료 상한을 다시 계산하는 것은 이 ADR의 선택이다 | E0 | README D41 "어느 사례에도 없어" | — |

최고 등급: E1 / 결정 영향: 중간 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: `worker/src/core/notice.ts`(순수 `parseNotice`)·`http/notice.ts`(처리기, 60초 캐시)·`core/keys.ts`(객체 키 상수)·`routes.ts`(`GET /notice`, 자격 none), foundations §14 상수 표(`check-tokens.mjs`가 Worker 쪽 사본을 대조), `web.md` §1, `worker.md` 구현 중 변경 100.
- gate: `worker`(vitest `test/unit/notice.test.ts`·`test/http/notice.test.ts`: 만료 min 규칙, 거부 글자, fail-open, 캐시 안 만료), `design-tokens` DT15.
- 앱이 이 JSON을 읽어 배너·종류 차단을 그리는 일은 (f) 이후이고 `app.md` 구현 중 변경 72가 계약을 적는다. 그때까지 `GET /notice`는 읽는 쪽이 없다.

### 재검증 조건

- 공지를 올리는 사람이 객체 하나로는 모자라다고 느끼는 때(동시에 둘 이상, 종류별 다른 글): 객체를 배열로 늘리는 새 ADR. 80자가 모자라는 때도 같다. 확인: 실제 운영에서 공지를 올려 본 기록(첫 장애 대응).
- R2 get 호출이 요청당 상한(worker.md 38)을 압박하는 관찰이 나오면 캐시 시간을 다시 본다. 확인: `r2-calls.test.ts`와 운영 로그의 R2 호출 수.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| Worker에 관리자용 쓰기 경로(`POST /admin/notice`)를 둔다 | 쓰기 경로·감사 기록·CSRF 면이 늘고, 공지가 필요한 순간은 관리 화면 자체가 불안정할 수 있다. 사람이 객체를 올리면 충분하다 |
| 공지를 앱에 번들하거나 GitHub에서 읽는다 | 앱 업데이트 없이 알릴 수 없다. 서드파티 의존이 생긴다 |
| 공지가 없으면 오류를 낸다(fail-closed) | 공지 장애가 모든 앱의 새 받기를 막을 수 있다. 공지는 알림이지 허가가 아니다 |
| 링크·마크업을 허용한다 | 피싱·XSS 표면이다. 자세한 안내는 앱 도움말로 연결한다 |
| 만료를 올린 사람 입력에만 맡긴다 | 잊은 공지가 계속 보인다. 서버 상한 72시간을 둔다 |
