# 0017 최근 영상 목록: 같은 이름의 회차를 구별하는 둘째 줄과 영속

상태: 채택(잠정)   날짜: 2026-10-10   관련: D39, patterns §14.1, 적용 단계 (c)

## 맥락

앱은 이미 `recentVods`(주소·제목·시각)를 `settings.json`에 두고 홈에서 [다시 열기]로 쓴다. 그런데 스트리머의 다시보기는 같은 제목으로 올라오는 일이 잦아(회차 번호만 다른 정기 방송) 행이 구별되지 않았다. 종류(VOD·빠른 다시보기·클립)와 올린 날짜를 둘째 줄로 보이면 구별되지만, 이 값은 열기 전에는 알 수 없고 한 번 resolve한 뒤의 메타에만 있다. 그래서 받기 요청이 만들어지는 때에 영속해야 한다.

## 결정

최근 영상 행에 둘째 줄(caption, `--fg-muted`)을 둔다: `recent.meta` "{kind} · {date}". 값은 `RecentVod.kind`(`vod|rewind|clip`)와 `RecentVod.date`(API 문자열 그대로, 화면은 `formatKstDate`)로 `settings.json`에 함께 저장한다. 기록 시점은 enqueue다(`record_enqueued(url, title, label, kind, date)`): 종류는 `recent_kind(content, playback)`(클립 > HLS = rewind > vod)로, 날짜는 `EnqueueRequest.contentDate`(`meta.liveOpenDate ?? meta.publishDate`)로 정한다. `kind`가 없으면(옛 항목) 둘째 줄이 없고, `date`가 없으면 종류 글자만 보인다. 모르는 `kind` 값은 None으로 읽고 None은 직렬화하지 않아 스키마 버전은 2 그대로다. 최대 `RECENT_MAX` 5개, 카드가 열렸거나 불러오는 중이면 목록을 숨긴다(patterns §17-10).

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 같은 제목의 회차는 제목만으로 구별되지 않는다 | E1 | `G-REPEAT-R6`(반복 과업은 기억된 값으로 채운다), README D39 | 2026-10-10 |
| 올린 날짜는 사실이다. 보관 기한은 추정하지 않는다 | E1 | `G-REPEAT-R7` | 2026-10-10 |

최고 등급: E1 / 결정 영향: 작음 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: 코어 `settings.rs`(`RecentVod`), 셸 `dto.rs`(`RecentVodDto`·`EnqueueRequest`)·`services.rs`, 프런트 `RecentList.svelte`·`receive.ts`, bindings 재생성. content §15.1 `recent.meta`.
- gate: `rust`(왕복·모르는 kind·옛 가져오기 None), `frontend`(둘째 줄 세 경우).

### 재검증 조건

- 둘째 줄이 있어도 행을 구별하지 못한다는 관찰(같은 날 같은 종류의 같은 제목). 그러면 제목 끝 일부나 길이를 더하는 새 ADR을 쓴다.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 목록을 열 때마다 영상 정보를 다시 조회한다 | 행마다 네트워크 호출이 생기고 로그인·오프라인에서 깨진다 |
| 제목만 보이고 [다시 열기]로 확인한다 | 한 번 눌러야 구별된다(3회 조작 상한을 쓴다) |
| 설정 스키마 버전을 올린다 | 추가 필드만이라 옛 파일을 그대로 읽는다. 올리면 백업 마이그레이션이 생긴다 |
