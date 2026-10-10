# 0024 연결 대기: 상태가 아니라 phase, 30분 인내, 잠든 시간은 세지 않는다

상태: 채택(잠정)   날짜: 2026-10-10   관련: D40, D39, platform §15.2·§22 33~35, core.md 구현 중 변경 56

## 맥락

코어는 네트워크 단절을 빠른 재시도 5회(상한 8초)로 끝내서 Wi-Fi 전환·VPN·덮개 개폐 직후 `failed{network}`가 됐다. 사용자는 걸어 두고 자리를 뜨는데 돌아오면 실패가 쌓여 있다. 인터넷이 없는 것은 오류가 아니라 기다림이다(brief §6.9-7). 화면에서는 이 기다림을 빨강·실패 문구 없이 보여야 하고(README D40) 오래 멈춘 작업을 "멈춘 지 30일"로 알려야 한다(D39). 코드는 `crates/core/src/download/`(`retry.rs`·`progressive.rs`·`segmented.rs`)와 셸 `manager.rs`다.

## 결정

연결 대기는 **작업 상태가 아니라 `running` 안의 phase `WaitingNetwork`**(TS `waitingNetwork`)다. 상태 머신은 바꾸지 않는다.

- **인내**: 빠른 재시도(5회, 상한 8초)는 조용히 그대로다. 그것을 다 쓴 연결 계열 실패(`Error::Network`: 연결 실패·timeout·reset·조기 EOF)만 인내 모드로 넘어가 phase를 `WaitingNetwork`로 알리고 `min(base·2^k, patience_cap)` ±25%를 기다려 다시 시도한다. 5xx·408·429·길이 불일치는 현행 5회로 끝난다.
- **예산**: `NETWORK_PATIENCE_MS` 30분, `RETRY_BACKOFF_MAX_MS` 30초(둘 다 [잠정], `retry.rs`. 확인: platform §21 M23). 소비 = Σ(요청한 대기 시간) + Σ min(시도 한 번에 걸린 시간, `patience_cap`)이라 **잠든 시간은 세지 않는다**. 소비 ≥ 예산이면 마지막 오류로 끝나고 `.part`는 남는다. 바이트가 늘면(진전) 시계와 phase를 되돌린다.
- **범위**: 작업 안의 `Job::resolve`(처음·재조회)와 다운로드 루프. **홈 카드의 대화형 `resolve` command는 인내가 없다**(사용자가 30분을 기다리면 안 된다). 취소는 대기 중에도 즉시 먹는다.
- **알림**: 인내를 다 써야만 네트워크 실패가 `failed`가 되므로 OS 알림 `notify.stalled`는 `failed` + `ErrorCode::Network`일 때다.
- **멈춘 지 30일**: 새 필드 `stoppedAt`(paused·interrupted·failed로 바뀐 시각)을 쓴다. `finished_at`은 완료·건너뜀 전용이라 재사용하지 않는다. 옛 레코드는 null이라 줄이 없다. 화면은 `partialBytes > 0`이고 `STALE_DAYS` 이상일 때만 `job.stale.body`를 보인다.
- **잠자기 방지**: 연결 대기 중인 running 작업도 보호를 잡는다(ADR 없이 platform §22 33). 깨어남·연결 복구 OS 신호는 Tauri에 없어 쓰지 않는다.

## 근거

| 주장 | 등급 | 출처 | 표본·날짜 |
|---|---|---|---|
| 서버가 거절하지 않은 실패는 기다리며 재시도하는 것이 옳다. 대기는 오류가 아니다 | E1 | `G-POWER-R8`, brief §6.9-7, README D40 | 2026-10-10 |
| OS마다 `Instant`가 잠자기를 세는지 달라 잠든 시간에 의존하는 시계는 쓰지 않는다. 시도 시간을 `patience_cap`으로 자르면 덮개를 닫은 노트북도 30초만 센다 | E1 | `G-POWER-R13`, g-power §3 | 2026-10-10 |
| 상태 머신을 바꾸지 않고 phase로 두면 `reresolving` 선례처럼 UI 분기만 늘고 영속 레코드·이어받기 규칙이 그대로다 | E1 | app.md §8.11 `reresolving` 선례, platform §15.2 | 2026-10-10 |
| 30분·30초·±25%·"진전이 시계를 되돌린다"는 어느 사례에도 그대로 없고 설계로 정당화한다 | E0 | `G-POWER-R8`은 방향만 준다. 값은 [잠정]이며 확인: platform §21 M23 | — |

최고 등급: E1 / 결정 영향: 큼 / 판정: 채택(잠정)

## 결과

- 바뀌는 곳: `crates/core/src/download/retry.rs`(`Patience` 장부, 상수, `RetryPolicy.patience`·`patience_cap`), `progressive.rs`·`segmented.rs`·`Job::resolve`, `crates/shell/src/dto.rs`(`PhaseTs::WaitingNetwork`, `JobDto.stoppedAt`), `manager.rs`(`stopped_at`, `stage_of`는 WaitingNetwork를 Download로 센다), 프런트 행 표(patterns §3.2)·회복 줄(`RECOVERY_SILENT_MS` 이상 머문 뒤에만 `RECOVERY_NOTICE_MS` 동안), core.md 56, platform §22 33~35.
- 기본 클라이언트는 연결 실패에서 30분을 기다리므로 테스트 클라이언트는 `RetryPolicy::none()`(patience 0)을 준다.
- gate: `rust`(`crates/core/tests/patience.rs`: 예산을 1초대로 줄인 단절 뒤 완료, 초과는 `Err(Network)`, 5xx는 5회로 끝, 403 뒤 재조회 중 단절도 복구, phase 방출 순서, 진전이 시계를 되돌림, 대기 중 취소, 순수 `Patience`는 실제 상수 29분 통과·31분 실패), `frontend`(회복·멈춤 표).

### 재검증 조건

- 실기 M23에서 31분 단절이 실패하지 않거나, 잠든 노트북이 깨어난 뒤 이어지지 않으면 예산 계산을 다시 본다. 확인: platform §21 M23(Wi-Fi 끄기 5초/30초/2분/10분/31분, 31분 넘게 잠재운 뒤 10초 늦게 붙기).
- 30분이 너무 길거나 짧다는 사용자 관찰이 있으면 값을 바꾼다(코드 상수 하나). 확인: 첫 실사용 기록과 D62 관찰.
- Tauri가 전원 이벤트를 주게 되면 깨어남 신호로 예산을 처음부터 세는 방식을 다시 비교한다.

## 대안과 버린 이유

| 대안 | 버린 이유 |
|---|---|
| 새 작업 상태 `waitingNetwork`를 만든다 | 상태 머신·`jobs.json`·이어받기 규칙·셸 DTO 전반이 바뀐다. phase는 `running`의 표시일 뿐이다 |
| 빠른 5회부터 연결 대기로 표시한다 | 일시적 끊김마다 UI가 깜박인다. 조용히 5회를 쓰고 그 뒤만 알린다 |
| 벽시계 30분으로 센다 | 덮개를 닫은 시간이 예산을 먹어 깨어나자마자 실패한다 |
| 깨어남·연결 복구 OS 신호로 예산을 되돌린다 | Tauri에 전원 이벤트가 없다. 있어도 힌트일 뿐 시도 하나가 몇 시간으로 재어지는 문제는 남는다 |
| 대화형 `resolve`도 30분 기다린다 | 사용자가 [불러오기]를 누르고 30분 기다리게 된다 |
| 멈춘 시각에 `finished_at`을 쓴다 | 완료·건너뜀 정렬에 쓰이는 필드라 의미가 섞인다 |
