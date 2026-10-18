# 속도 제한(전체 합계 + 작업마다): 설계 초안

**상태(2026-10-18)**: **RL-1 코어(core.md 75)·RL-2 셸(core.md 76·app.md 92)·RL-3 앱(app.md 93) 구현됨. 갤러리 기준선(design-shots)과 실측 M-RL-1·M-RL-2는 남았다.** 아래 "구현 중 변경"이 본문보다 우선한다. 이 문서의 나머지 본문은 설계 시점 그대로다.

(설계 시점 상태: **설계됨(designed), 구현 전.** 문서만 있는 단계다. 기준 트리는 `origin/master` `55e0733`(v0.10.1 뒤)이고, 이 문서의 `파일:줄`은 모두 그 트리에서 연 줄이다(코드는 `90404f9`와 같다). 표기는 `README.md`의 규칙을 따른다. **[확인]**은 직접 연 줄, **[가정]**은 근거 문서가 없는 설계 판단, **[실측 필요]**는 실물로만 정할 수 있는 것, **[잠정]**은 출처 없는 수치다(ADR-0009 묶음, `docs/design/system/adr/0009-unsourced-numbers.md`).)

**사용자 결정과 고를 것**: 사용자는 "속도 제한 **전체 합계 + 작업마다**(최소값, 생방송 녹화는 놓친 조각을 만들 수 있어 따로 정한다)"를 골랐다(`docs/ROADMAP.md:8` "경쟁력 개선 착수" (라), 2026-10-18). 그래서 §2의 R0·R1과 "최소값을 둔다"는 **확정**이다. 그 밖의 행(기본 끔, 받는 중 바로 적용, 생방송 처리, 작업마다 값의 모양, 최소값의 크기, UI·저장 단위)은 작업 지시의 기준선을 **고를 수 있게 정리한 추천**이다. 행마다 다른 선택지와 차이를 함께 적었다. 사용자가 다른 칸을 고르면 이 문서의 해당 절을 고친 뒤 구현한다.

**이미 뒤집힌 결정**: `docs/ROADMAP.md:9`(경쟁력 평가)은 "사용자용 CLI·**속도 제한**·오디오 전용 받기·자동 녹화는 … 이슈로 만들지 않는다"고 적었다. 사용자가 같은 날 `:8`에서 뒤집었다(§2 R0).

구현 PR은 `docs/design/core.md`·`app.md`의 "구현 중 변경"에 번호를 붙여 적는다. 지금 마지막 번호는 core.md **74**(`docs/design/core.md:941`), app.md **91**이다. 그래서 core.md는 **75부터**, app.md는 **91부터**다. 다른 worktree가 같은 번호를 먼저 쓸 수 있으므로 **번호는 머지 순서로 맞춘다**. 디자인 시스템 D 번호·ADR은 새로 받지 않는다(§6.4).

---

## 1. 목표와 범위

### 1.1 목표
- 앱이 쓰는 내려받기 대역폭에 **두 가지 상한**을 둔다.
  1. **전체 합계 상한 X**: 동시에 받는 모든 작업의 미디어 바이트를 합쳐 초당 X를 넘지 않는다.
  2. **작업마다 상한 Y**: 작업 하나가 초당 Y를 넘지 않는다.
- 둘 다 **기본은 끔**이다. 끈 상태의 동작과 성능은 지금과 같아야 한다.
- 받는 중에 설정을 바꾸면 **곧바로 적용**한다. 상한을 켜거나 끄는 것, 값을 올리거나 내리는 것 모두 다음 본문 조각부터 반영한다. 작업을 다시 시작할 필요가 없다.
- **너무 낮은 값은 고를 수 없다.** 최소값은 실패 경로 둘(서명 만료 재조회 상한, HTTP 읽기 idle timeout)에서 계산한다(§4).
- 진행률의 속도와 ETA는 상한이 걸린 실제 속도를 보여 준다(§5.5).

### 1.2 하지 않는 것
- **생방송 녹화는 제한하지 않는다**(§2 결정 R3, §3.5). 받는 속도가 스트림 비트레이트보다 낮으면 서버 playlist 창이 지나가 버려 구멍(`gaps`)이 생긴다.
- 작업마다 다른 값을 고르는 UI는 두지 않는다. 작업마다 상한은 설정의 **값 하나**를 모든 작업에 똑같이 쓴다(§2 결정 R4).
- 올리기(업로드) 제한, 시간대별 일정(예: 밤에만 풀기), 네트워크 종류별 값은 만들지 않는다.
- 채팅 받기(`collect_chat`), 앱 업데이트 받기(`crates/shell/src/update.rs:367`), API·playlist·init 요청은 제한하지 않는다(§3.4).
- 작업을 더 늦게 시작해 대역폭을 맞추는 큐 정책은 바꾸지 않는다. 동시 작업 수(`max_parallel_downloads`)는 그대로 별개의 설정이다.

## 2. 결정 표(추천 · 다른 선택지 · 차이)

| ID | 결정 | 추천(기준선) | 다른 선택지 | 차이와 추천 이유 |
|---|---|---|---|---|
| R0 | ROADMAP:9의 "속도 제한은 이슈로 만들지 않는다" | **확정: 뒤집혔다**(`ROADMAP.md:8` (라)) | — | 사용자 결정. 수요 근거가 여전히 없다는 점은 §9 위험에 남긴다 |
| R1 | 상한의 종류 | **확정: 둘 다**(전체 합계 X + 작업마다 Y, `ROADMAP.md:8` (라)) | (가) 전체 합계만 (나) 작업마다만 | 합계만 있으면 한 작업이 합계를 다 먹을 수 있고, 작업마다만 있으면 동시 작업 수(1~3, `crates/shell/src/manager.rs:72-74`)에 따라 총량이 세 배까지 흔들린다. 둘을 함께 걸면 둘 중 낮은 쪽이 먹는다. 구현 비용 차이는 bucket 하나다(§3.2) |
| R2 | 기본값 | **둘 다 끔** | (가) 합계만 기본 켬 | 지금 사용자의 속도를 바꾸지 않는다. 옛 `settings.json`은 키가 없어 끔으로 읽힌다(§5.1) |
| R3 | 생방송 녹화(사용자가 "따로 정한다"고 남김) | **제한에서 뺀다**(합계에도 세지 않는다) | (가) 제한한다 (나) 합계에만 센다 | 녹화는 실시간이라 받는 속도가 비트레이트 아래로 내려가면 playlist 창이 지나가 조각을 영영 잃는다(`crates/core/src/download/live.rs:7`·`:257-260`의 `gaps`). VOD는 늦게 받아도 잃는 것이 없다. (나)는 녹화가 합계를 차지해 VOD만 느려지는 간접 효과가 있어 설명이 어렵다. 녹화는 이미 VOD와 다른 lane이다(`manager.rs:6-7`, `MAX_LIVE` `:70`) |
| R4 | 작업마다 상한의 값 | **설정의 기본값 하나**를 모든 작업에 쓴다. 작업에 저장하지 않는다 | (가) 작업마다 값을 따로 저장하고 작업 행에서 바꾼다 | (가)는 `JobRecord`·jobs.json·작업 행 UI·가짜 백엔드가 모두 늘어난다. 설정 하나면 jobs.json이 바뀌지 않고(`JOBS_VERSION` 그대로, `crates/shell/src/jobs.rs:29`) 화면은 설정 한 줄이다. 받는 중 바로 적용(R5)과도 맞는다 |
| R5 | 받는 중 설정을 바꾸면 | **곧바로 적용**(다음 본문 조각부터, 기다리던 조각도 다시 계산) | (가) 새로 시작하는 작업부터 | 기존 `segment_concurrency`는 작업을 넣을 때 고정된다(`manager.rs:106-107`·`:563`). 속도 제한은 그와 달리 공유 값을 읽게 한다(§3.3). 설정 화면이 "즉시 저장" 방식이라(`app/src/lib/views/SettingsView.svelte:4-5`) 바로 반영되는 쪽이 화면 약속과 맞는다 |
| R6 | 최소값의 크기(최소값을 두는 것은 확정) | **1MB/s = 1,000,000바이트/초** | (가) 2MB/s (나) 0.5MB/s | §4: 작업 셋이 합계 X를 나누면 재조회 예산 하한이 X ≥ 1.0MB/s(여유 1배, S는 [잠정]), idle timeout 하한이 0.67MB/s다. 1MB/s는 두 하한을 넘는 가장 작은 둥근 값이다. (가) 2MB/s는 공유 경우 여유가 2배지만 느린 회선 사용자가 고를 칸이 줄어든다. (나)는 공유 경우 재조회 예산을 넘을 수 있다. 1000·1024 진법 모두에서 표시 "1.0MB/s" 이상이다 |
| R7 | 값 고르는 방법 | **Select 프리셋**: 제한 없음 · 1 · 2 · 5 · 10 · 20 · 50 · 100 (× OS 진법의 MB) | (가) 숫자 입력 칸 | 숫자 입력 컴포넌트가 없다(`app/src/lib/components/ui/`에 `TextField`·`Select`·`Switch`뿐). governance §5는 기존 컴포넌트로 되는 것을 새로 만들지 않는다. 프리셋은 최소값을 구조로 지킨다. 같은 줄의 `동시에 받는 영상 수`·`한 번에 받는 조각 수`도 Select다(`SettingsView.svelte:92-121`) |
| R8 | 저장 단위 | **바이트/초 정수**(`Option<u64>`) | (가) "MB/s" 정수 | 표시 진법이 OS마다 다르다(Windows 1024, macOS·Linux 1000, `docs/design/system/content.md:260`·`:263`). 바이트로 저장하면 코어가 OS를 몰라도 된다. 프리셋은 화면이 OS 진법으로 곱해 만든다 |

## 3. 설계

### 3.1 한 장 그림

```
SettingsService.update_and_apply ──set──▶ RateKnob(total) ─┐        (shell, 같은 ops 잠금)
                                  └─set──▶ RateKnob(job)  ─┼─┐
DownloadManager ── 공유 Throttle 하나(total knob) ──────────┘ │
  start(job): Live가 아니면 req.throttle = { job: Throttle::new(job knob) [작업마다 새 bucket],
                                              shared: 공유 Throttle 복제 }
                                                              ▼
chzzk_core::download ── progressive: 본문 조각마다 consume(n) (job → shared 순)
                     └─ segmented: 세그먼트 본문 조각마다 consume(n) (read_capped 변형)
                     └─ live: fetch에 None. 제한 없음
```

### 3.2 코어 타입(`crates/core/src/download/throttle.rs`, 신설)

코어는 Tauri를 모른다. 이 모듈은 tokio `time`·`sync`만 쓴다(`crates/core/Cargo.toml:22`에 이미 있다).

```rust
/// 상한 값(바이트/초, 0 = 끔). 같은 knob을 따르는 bucket 모두가 다음 consume에서 새 값을 읽는다.
#[derive(Clone, Default)]
pub struct RateKnob(Arc<KnobInner>);          // AtomicU64 + tokio::sync::Notify
impl RateKnob {
    pub fn new(bps: Option<NonZeroU64>) -> Self;
    /// 값을 바꾸고 기다리는 consume을 깨운다(바뀐 값으로 다시 계산한다).
    pub fn set(&self, bps: Option<NonZeroU64>);
    pub fn get(&self) -> Option<NonZeroU64>;
}

/// 토큰 버킷 하나(빚 방식). 복제하면 같은 bucket이다.
#[derive(Clone)]
pub struct Throttle { knob: RateKnob, bucket: Arc<Mutex<Bucket>> }
impl Throttle {
    pub fn new(knob: RateKnob) -> Self;
    /// 방금 받은 n바이트를 치르고, 빚이 있으면 갚을 때까지 기다린다. 끔이면 곧바로 돌아온다.
    /// 취소는 부르는 쪽이 future를 drop해서 한다(빚은 남는다: 받은 바이트는 실제로 쓴 대역폭이다).
    pub async fn consume(&self, n: u64);
}
impl fmt::Debug for Throttle { /* 지금 knob 값만 */ }

/// 엔진이 받는 묶음. 둘 다 None이면 지금과 같다.
#[derive(Clone, Debug, Default)]
pub struct Throttles { pub job: Option<Throttle>, pub shared: Option<Throttle> }
impl Throttles {
    /// 작업 bucket을 먼저, 공유 bucket을 나중에 치른다.
    pub async fn consume(&self, n: u64);
}

/// 순수 상태 기계(시각을 인자로 받는다. `Meter::observe`와 같은 방식, `crates/core/src/progress.rs:115`)
pub(crate) struct Bucket { rate: u64, tokens: f64, last: Instant }
impl Bucket {
    /// 시각 now까지 채우고 n을 빼서, 빚을 갚는 데 필요한 대기 시간을 돌려준다.
    pub(crate) fn take(&mut self, rate: Option<NonZeroU64>, n: u64, now: Instant) -> Duration;
}
```

- **빚 방식을 쓰는 이유**: reqwest는 조각 크기를 미리 알려 주지 않는다(`resp.chunk()`). 그래서 받은 뒤에 치르고, 남은 빚만큼 다음 읽기를 늦춘다. 기다리는 동안 다른 스트림이 치르면 빚이 더 깊어져 뒤에 온 쪽이 더 오래 기다린다. 그 결과 대략 도착 순서대로 공평하다. **[가정]** 엄격한 공평성은 요구하지 않는다.
- **채우기 상한(burst)**: `capacity = rate × 0.25초`다. **[잠정] 근거 없음, ADR-0009 묶음 등록.** 작게 두는 이유는 §5.5(속도 창이 상한을 빨리 따라간다)다.
- **빚 상한**: `tokens ≥ -(rate × THROTTLE_MAX_WAIT)`, `THROTTLE_MAX_WAIT = 15초`. 계산상 한 번의 대기가 이보다 길면 남는 빚을 버린다. 작업·공유 bucket을 모두 거치는 `Throttles::consume` 한 번의 **전체** 대기도 이 길이로 묶는다(bucket마다 따로 재면 한 조각이 최대 30초 = `read_timeout`까지 기다린다, 구현 중 변경 7). 최소값(§4)이 지켜지면 닿지 않는 방어선이다. 이 값은 `read_timeout` 30초(`crates/core/src/client.rs:74`)의 절반이다.
- **값 바뀜**: `take`는 매번 knob 값을 읽는다. 값이 바뀌었으면 지금 시각까지는 옛 값으로 채우고 새 값으로 바꾼다. 꺼지면 빚을 0으로 지우고 곧바로 돌려준다. 기다리는 `consume`은 `select!{ sleep, knob.notified() }`로 깨어나 다시 계산한다(R5).
- **순서**: 작업 bucket을 먼저 치른다. 공유 bucket을 먼저 치르면, 작업 상한에 걸려 기다리는 동안 이미 가져간 공유 몫을 아무도 쓰지 못한다.

`DownloadRequest`(`crates/core/src/download/mod.rs:64-87`)에 필드 하나를 더한다.

```rust
/// 속도 제한(rate-limit.md). 기본(Default)은 제한 없음. 생방송(`Live`)은 이 값을 무시한다.
pub throttle: Throttles,
```

`DownloadRequest`는 `Clone, Debug`를 derive하므로(`mod.rs:64`) `Throttles`도 둘 다 갖춘다. 이 필드는 `owner()`(`mod.rs:90-98`)와 sidecar에 들어가지 않는다. 런타임 값이다.

### 3.3 셸(`crates/shell`)

- `DownloadManager`가 `RateKnob` 둘(`total`, `job`)과 **공유 `Throttle` 하나**(total knob)를 갖는다. `ManagerConfig`(`manager.rs:77-88`)에 처음 값 둘을 더한다.
- `start`(`manager.rs:1623`)에서 요청을 만들 때 생방송 갈래와 같은 자리에 붙인다(`:1650-1652`가 `live_stop`을 붙이는 곳이다).
  ```rust
  let mut req = job.rec.to_request();
  req.live_stop = job.live_stop.clone();
  if !job.is_live() {
      req.throttle = Throttles { job: Some(Throttle::new(self.job_knob.clone())), shared: Some(self.shared.clone()) };
  }
  ```
  작업 bucket은 **실행마다 새로** 만든다. 일시정지 뒤 이어받기는 새 bucket으로 시작한다. 공유 bucket은 매니저가 사는 동안 하나다.
  `JobRecord::to_request`(`crates/shell/src/jobs.rs:125-137`)는 `throttle: Throttles::default()`를 넣는다. jobs.json에는 아무것도 쓰지 않는다.
- knob은 꺼진 상태로도 늘 붙인다. 그래야 받는 중에 켜도 다음 조각부터 걸린다(R5).
- `DownloadManager::set_rate_limits(total: Option<u64>, job: Option<u64>)`를 더한다. knob 둘을 `set`하고 끝난다. 상태 잠금을 잡지 않는다(knob은 원자값이다).
- `SettingsService::update_and_apply`(`crates/shell/src/services.rs:337-348`)가 `set_max_parallel` 바로 옆에서, 같은 `ops` 잠금 안에서 `set_rate_limits`를 부른다. 그래서 "매니저 값 = 마지막으로 저장된 값"이 그대로 성립한다(`:337-338`의 주석).
- 앱 시작 때 매니저를 만드는 곳(`ManagerConfig`를 채우는 곳)은 저장된 설정 값을 넘긴다.

### 3.4 엔진 seam(빠짐없이)

| 위치 | 바꿀 것 | 이유 |
|---|---|---|
| `download/progressive.rs:192-215` 본문 루프 | `p.write(&chunk)` 뒤에 `job.cancellable(job.req.throttle.consume(len)).await.map_err(Failure::Fatal)?` | 조각을 받은 뒤 치르고 다음 `resp.chunk()`를 늦춘다. 취소는 기존 `cancellable`(`mod.rs:224-231`)이 곧바로 `Cancelled`로 끝낸다 |
| `download/segmented.rs:252`의 `fetch(chzzk, policy, &u, Body::Segment)` | `fetch`에 `throttle: Option<&Throttles>` 인자를 더하고 세그먼트만 `Some(&job.req.throttle)` | 세그먼트 본문은 `buffered(concurrency)` 안에서 메모리로 다 읽힌다(`read_body` → `client.rs:251-267`). 그래서 쓰기 루프(`p.write`)에서 늦추면 네트워크는 늦춰지지 않는다. 읽기 루프 안에서 치러야 한다 |
| `download/segmented.rs:486-491` `read_body`, `client.rs:251` `read_capped` | 조각마다 치르는 변형 `read_capped_throttled(resp, max, throttle)`. `read_capped`는 API용으로 그대로 둔다 | API·playlist 응답은 제한하지 않는다(작고, 늦추면 재조회가 느려질 뿐이다) |
| `download/segmented.rs:375-386` init·playlist `fetch_cancellable` | `None` | init은 1KB 남짓이다(`segmented.rs:46-47`) |
| `download/live.rs:35`·`:155`·`:282`·`:520`·`:540` | 모두 `None` | 생방송은 제한하지 않는다(R3). 셸이 붙이지 않는 것에 더해 엔진도 무시해 이중으로 막는다 |
| `Chzzk::download` 맨 앞(`mod.rs:333-352`) | 바꾸지 않는다 | 검증·`.part` 소유와 무관하다 |

취소·일시정지·재시도와의 관계:
- **취소·일시정지**: progressive는 `job.cancellable`이 대기를 끊는다. segmented는 바깥 `job.cancellable(segs.next())`(`segmented.rs:254`)가 `Cancelled`로 끝나면서 `buffered` 스트림을 drop한다. 그러면 안에서 기다리던 `consume` future도 drop된다. 둘 다 대기 시간과 무관하게 곧바로 끝난다. `.part`는 지금처럼 checkpoint 뒤 남는다(`Cancelled`는 `is_resumable`, `crates/core/src/error.rs:193-196`).
- **재시도**: 실패한 시도에서 받은 바이트도 실제로 쓴 대역폭이라 치른다(빚은 되돌리지 않는다). 재시도 backoff(`segmented.rs:458`)와 연결 대기(`mod.rs:242-262`)는 제한 대기와 따로다.
- **재조회(403)**: stream을 drop할 때(`segmented.rs:259`) 기다리던 consume도 함께 사라진다. 재조회 API 요청은 제한하지 않는다.
- **연결 대기 phase**: 제한 대기는 `WaitingNetwork`가 아니다. phase를 바꾸지 않는다(사용자에게 "연결을 기다리는 중"으로 보이면 안 된다).

### 3.5 생방송을 빼는 이유(R3의 근거 자세히)

- 녹화 엔진은 playlist를 계속 다시 읽고 새 세그먼트를 받는다. 창이 다음 세그먼트 번호를 지나가 버리면 놓친 수를 `gaps`로 세고 계속한다(`live.rs:7`·`:257-260`). 받기가 비트레이트보다 느리면 이 구멍이 계속 생긴다. 녹화 결과가 빠짐없는 영상이라는 약속(D63, `docs/design/system/README.md:212`)이 깨진다.
- VOD·클립·빠른 다시보기는 늦게 받아도 잃는 것이 없다. 서명 만료는 재조회로 풀린다(§4.1).
- 녹화는 이미 동시 작업 수와 따로 세는 lane이다(`manager.rs:6-7`). 합계에서도 빼야 같은 규칙이 된다.
- 설정 도움말에 "생방송 녹화는 제한하지 않아요"를 적는다(§6.2). 숨은 예외가 되지 않게 하기 위해서다.

## 4. 최소값 계산(R6)

실패 경로 두 개에서 하한을 각각 구하고 큰 쪽을 쓴다.

### 4.1 하한 (a): 서명 만료와 재조회 상한

- 서명 주소는 만료된다. 빠른 다시보기(HLS)는 **약 17시간**(`docs/ROADMAP.md:140`), 일반 VOD(PD)는 **약 8시간**(`docs/design/core.md:462`)이다. **[확인: 문서]**
- 만료되면 403 → 재조회 → 같은 위치부터 이어받는다. 작업당 재조회 상한은 **8회**다(`crates/core/src/download/mod.rs:46-47` `MAX_REFRESHES`, `:313-325`). 넘으면 `RefreshExhausted`로 끝난다.
- 이 상한은 `download()` 호출 한 번마다 0부터 센다(`mod.rs:365`의 `refreshes: 0`). 그래서 예산은 **끊김 없이 이어진 한 실행** 기준이다. 처음 주소 1회 + 재조회 8회 = 만료 창 9개다.
  - PD: 9 × 8시간 = **72시간**(259,200초)
  - HLS: 9 × 17시간 = **153시간**
- 가장 큰 영상 크기 S는 **[잠정] 근거 없음**이다. 1080p 약 8Mbps(≈1,000,000바이트/초) × 24시간 = 약 86.4GB로 둔다(ADR-0009 묶음).
- 하한: R ≥ S / (9 × T). 더 빡빡한 쪽은 PD다.
  - PD: 86.4GB / 259,200초 ≈ **0.33MB/s**
  - HLS: 86.4GB / 550,800초 ≈ 0.16MB/s
- 작업마다 상한 Y에는 이 값이 그대로 걸린다: Y ≥ 0.33MB/s.
- 합계 X는 생방송이 아닌 동시 작업 n개(최대 3, `crates/core/src/settings.rs:37`)가 나눠 쓴다. 한 작업의 몫은 X/n이다. 그래서 X ≥ 3 × 0.33 = **1.0MB/s**다. 이것이 X에 걸리는 하한 중 가장 크다.

### 4.2 하한 (b): HTTP 읽기 idle timeout

- reqwest 0.13.5의 `ReadTimeoutBody`(reqwest 0.13.5 `src/async_impl/body.rs:336-361`)는 마지막 조각이 들어온 시각 + `read_timeout`에 타이머를 맞춘다. 그 뒤 다음 `poll`에서 타이머가 지났으면 `TimedOut`이다. 제한 대기가 `read_timeout` **30초**(`client.rs:74`)보다 길면, 데이터가 와 있어도 가짜 네트워크 오류가 난다. 엔진은 이것을 연결 실패로 보고 재시도와 연결 대기를 탄다.
- 한 번의 대기는 "그 bucket에 쌓인 빚 / 속도"다. 빚은 기다리는 스트림 수 × 조각 크기 상한까지 쌓인다.
  - 조각 크기 상한: hyper 1.8.1 h1 읽기 버퍼 상한 `DEFAULT_MAX_BUFFER_SIZE = 8192 + 4096 × 100 = 417,792바이트`(hyper 1.8.1 `src/proto/h1/io.rs:23`). h2면 DATA 프레임이라 더 작다. **[가정]** CDN이 h1이든 h2든 이 값이 상한이다.
  - 공유 bucket의 스트림 수 상한: 생방송이 아닌 동시 작업 3(`settings::MAX_PARALLEL_DOWNLOADS`, `crates/core/src/settings.rs:37`) × 동시 세그먼트 8(`MAX_CONCURRENCY`, `mod.rs:52-53`) = **24**
  - 작업 bucket의 스트림 수 상한: **8**
- 한 스트림의 최악 대기 = 작업 bucket 대기 + 공유 bucket 대기 = 8 × 417,792 / Y + 24 × 417,792 / X ≈ 3.34MB / Y + 10.03MB / X.
- 여유 2배(대기 ≤ 15초 = `THROTTLE_MAX_WAIT`)를 두면, X만 켰을 때 X ≥ 10.03MB / 15초 ≈ **0.67MB/s**다. Y만 켰을 때는 Y ≥ 3.34MB / 15초 ≈ 0.22MB/s다.

### 4.3 결론

| 상한 | (a) 재조회 예산 | (b) idle timeout(여유 2배) | 큰 쪽 |
|---|---|---|---|
| 합계 X(작업 셋이 나눔) | 1.0MB/s | 0.67MB/s | **(a) 1.0MB/s** |
| 작업마다 Y | 0.33MB/s | 0.22MB/s | (a) 0.33MB/s |

- 두 상한에 같은 최소를 쓴다(값 하나가 설명하기 쉽다). 둘 중 큰 하한 1.0MB/s를 넘는 가장 작은 둥근 값으로 **최소 1MB/s = 1,000,000바이트/초**를 둔다(`MIN_RATE_LIMIT_BPS`, 코어 `settings`에 상수).
- 검산(idle timeout): X = Y = 1MB/s면 최악 대기 ≈ 3.34 + 10.03 = 13.4초로 30초 안이다(여유 2.2배).
- 검산(재조회 예산): 한 작업이 혼자 1MB/s를 쓰면 한 실행 72시간 동안 259GB로 S(86.4GB)의 3배다. **작업 셋이 합계 1MB/s를 나누면 한 작업이 72시간 동안 받는 양이 86.4GB로 S와 같다. 여유가 1배다.** S가 [잠정]이라 이 경우는 빠듯하다. 넘으면 `RefreshExhausted`로 멈추고, 사용자가 [이어받기]를 누르면 재조회 수가 0부터 다시 세어 이어 받는다(`.part`는 남는다, `crates/core/src/error.rs:193`). 데이터를 잃지 않으므로 받아들인다. 여유를 2배로 두려면 R6의 (가) 2MB/s를 고른다.
- 1MB/s는 1000 진법 기준이다. Windows(1024 진법)의 프리셋 "1.0MB/s"는 1,048,576바이트/초라 최소보다 크다. 그래서 두 진법 모두 프리셋 맨 아래가 최소 이상이다.
- 손으로 고친 `settings.json`처럼 최소보다 작은 값은 읽을 때 최소로 올린다(§5.1). 프리셋에 없는 값도 그대로 쓴다.

## 5. 데이터·계약

### 5.1 설정(`crates/core/src/settings.rs`)

`UserSettings`(`settings.rs:47-93`)는 구조체 단위 `#[serde(default)]`다(`:49`). 필드 둘을 더한다.

```rust
/// 전체 합계 속도 상한(바이트/초). None = 끔(기본). 최소보다 작은 값은 최소로, 0·음수·숫자 아님은 끔으로 읽는다.
#[serde(deserialize_with = "rate_limit_or_off")]
pub total_rate_limit: Option<u64>,
/// 작업마다 속도 상한(바이트/초). 규칙은 위와 같다.
#[serde(deserialize_with = "rate_limit_or_off")]
pub job_rate_limit: Option<u64>,
```

- 옛 설정 파일은 키가 없어 끔으로 읽힌다. `SCHEMA_VERSION`(`settings.rs:28`)은 올리지 않는다. 그래서 `feat:`이고 `feat!:`이 아니다.
- 관대한 읽기는 `parallel_or_default`(`settings.rs:251-261`)와 같은 방식이다. 테스트는 그 함수의 테스트 옆에 둔다.
- 새 버전에서 쓴 설정을 옛 앱이 읽으면 모르는 키라 무시된다. **[확인]** `UserSettings`에 `deny_unknown_fields`가 없다(`settings.rs:48-49`). 업데이트 경로를 깨지 않는다. 다만 옛 앱이 설정을 다시 쓰면 두 키가 사라져 상한이 꺼진다(되돌린 뒤의 동작으로 받아들인다).

### 5.2 DTO·command(`crates/shell/src/dto.rs`)

- `SettingsDto`(`dto.rs:345-373`)에 `total_rate_limit: Option<u64>`·`job_rate_limit: Option<u64>`를 더한다. ts-rs는 `u64`를 `number`로 낸다(`app/src/lib/bindings/ProgressDto.ts`의 `speedBps: number | null`과 같다).
- `SettingsPatch`(`dto.rs:402-437`)에 둘을 `Nullable<u64>`로 더한다(`dto.rs:444` 정의, `download_folder`가 쓰는 3상태): 키 없음 = 그대로, `null` = 끔, 수 = 그 값. `update_locked`(`services.rs:265-331`)는 `MIN_RATE_LIMIT_BPS`보다 작은 수를 최소로 올린다(`segment_concurrency` 자르기 `:304-305`와 같은 방식). 0은 끔이다.
- 새 command는 없다. 기존 `update_settings`를 쓴다. 그래서 AuthGate 허용 목록(`crates/shell/src/gate.rs`)은 바뀌지 않는다.
- DTO를 바꾸므로 `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 `app/src/lib/bindings/SettingsDto.ts`·`SettingsPatch.ts`를 다시 만든다.

### 5.3 jobs.json·sidecar·Worker

- jobs.json은 바뀌지 않는다(R4). `JobRecord`에 필드가 없다.
- `.part` sidecar는 바뀌지 않는다. 같은 작업을 다른 상한으로 이어받아도 소유(`PartOwner`)가 같다.
- Worker는 관계없다.

### 5.4 진행률 이벤트

- `Progress`·`ProgressDto`는 바뀌지 않는다. 제한 대기 중에도 phase는 `Downloading`이다(§3.4).

### 5.5 속도·ETA

- `Meter`는 최근 5초 창의 바이트 증가로 속도를 재고, 그것으로 ETA를 낸다(`crates/core/src/progress.rs:79-97`·`:150-170`). 상한이 걸리면 창 안의 실제 증가가 상한 근처로 내려간다. 그래서 속도와 ETA가 **따로 고치지 않아도** 상한을 따라간다.
- 값을 바꾼 직후에는 창 길이(5초)만큼 늦게 따라간다. 이것은 받아들인다. **[가정]** 사용자가 설정 화면에서 돌아와 작업 목록을 볼 때쯤이면 창이 이미 새 값을 반영한다.
- burst를 작게 둔 이유가 이것이다(§3.2). burst가 크면 상한을 켠 직후 몇 초 동안 상한보다 빠르게 보이고, ETA가 너무 낙관적이 된다.
- 새 ETA 경로("상한으로 나누기")는 만들지 않는다. 합계 상한을 작업 여럿이 나눠 쓰면 한 작업의 몫은 상한보다 작다. 그래서 상한으로 나누면 오히려 틀린다.

## 6. 앱(`app/`)

### 6.1 설정 › 받기

`SettingsView.svelte`의 받기 섹션(`:90-151`, 제목 `card.download`)에서 `한 번에 받는 조각 수` 줄(`:107-121`) 뒤에 두 줄을 더한다. 둘 다 기존 `SettingsRow` + `Select` 조합이다. 새 컴포넌트·배너·대화상자는 없다.

```
받기
  동시에 받는 영상 수                       [ 2      ▾]
  한 번에 받는 조각 수                       [ 4      ▾]
  모든 영상을 합한 최대 속도                 [ 제한 없음 ▾]
    여러 영상을 함께 받을 때 합쳐서 이 속도를 넘지 않아요. 생방송 녹화는 제한하지 않아요.
  영상 하나의 최대 속도                     [ 제한 없음 ▾]
    영상마다 이 속도를 넘지 않아요. 받는 중인 영상에도 바로 적용돼요.
  앱을 열면 받다 만 영상을 자동으로 이어받기    [스위치]
  받는 동안 컴퓨터가 잠들지 않게 하기          [스위치]
```

- 프리셋: `[1, 2, 5, 10, 20, 50, 100].map(n => n × base²)`, `base = sizeBaseOf(os)`(`app/src/lib/format/bytes.ts:29`). 라벨은 `formatSpeed(bps, base)`(`bytes.ts:134`)가 만든다. 맨 앞은 `settings.rateLimit.off`("제한 없음", 값 0)다. 바꾸면 0은 `null` 패치, 그 밖은 바이트 값 패치를 보낸다.
- 저장된 값이 프리셋에 없으면(손으로 고친 설정, 다른 OS에서 옮긴 설정) 그 값을 `formatSpeed` 라벨로 한 칸 더해 보여 준다. 조용히 다른 값으로 보이면 안 된다.
- `Select`는 `T extends string | number` 제네릭이다(`docs/design/system/components.md:224-230`). 값은 number다.

### 6.2 copy deck 초안(`app/src/lib/copy/ko.ts`, `settings.segments.help` 뒤)

| 키 | 문구(초안) |
|---|---|
| `settings.totalRate` | 모든 영상을 합한 최대 속도 |
| `settings.totalRate.help` | 여러 영상을 함께 받을 때 합쳐서 이 속도를 넘지 않아요. 생방송 녹화는 제한하지 않아요. |
| `settings.jobRate` | 영상 하나의 최대 속도 |
| `settings.jobRate.help` | 영상마다 이 속도를 넘지 않아요. 받는 중인 영상에도 바로 적용돼요. |
| `settings.rateLimit.off` | 제한 없음 |

- 숫자·단위는 deck에 쓰지 않는다(`content.md:24` W5, `:38`). 프리셋 라벨은 모두 `formatSpeed`가 만든다. `design-copy`가 숫자+단위 리터럴을 거른다.
- 해요체, 도움말은 본문이라 마침표, 라벨은 마침표 없음(기존 `settings.parallel`·`.help`와 같은 꼴, `ko.ts:241-245`).
- "받기 속도"보다 "최대 속도"를 쓴다. 라벨만 읽어도 상한이라는 뜻이 드러나기 때문이다. **[가정]** 용어집(`content.md` §4)에 새 용어로 올리지 않는다. 일반 낱말이다.
- 접근성: 옵션 글자 "5.0MB/s"는 스크린리더가 단위를 읽는 방식이 엔진마다 다르다. 낭독 형식(`formatSpokenSpeed`, `bytes.ts:158`)을 옵션에 따로 줄 수 있는지는 구현 PR에서 `Select` 계약을 보고 정한다. 못 주면 그대로 둔다(같은 섹션의 숫자 Select도 숫자만 있다).

### 6.3 가짜 백엔드·E2E

- `app/e2e/mock/backend.ts:202-203`의 기본 설정에 `totalRateLimit: null`·`jobRateLimit: null`을 더한다. `update_settings` 흉내가 두 키를 받아 저장하게 한다(Nullable 규칙: `null` = 끔).
- Playwright: 설정 화면에서 두 Select가 보이고, 고르면 패치가 나가며, "제한 없음"으로 되돌리면 `null`을 보내는 spec 하나(기존 설정 spec에 더한다). axe가 통과해야 한다.
- 갤러리 스냅샷(`design-shots`)의 설정 화면 기준선이 바뀐다. 기준선은 CI artifact로 받는다(`node scripts/design/shots.mjs --accept <run id>`).
- 네이티브 E2E는 바꾸지 않는다. 제한은 끈 상태가 기본이라 흐름이 같다.

### 6.4 디자인 시스템 영향

- 새 D 번호·ADR 없음. 기존 `SettingsRow`·`Select`의 조합이다(governance §5).
- `content.md` 문구 전표(§15.1)에 §6.2의 다섯 키를 더한다. `patterns.md`의 설정 화면 와이어프레임에 두 줄을 더한다.
- [잠정] 수치 둘(burst 0.25초, S = 86.4GB)을 ADR-0009 묶음 표에 올린다.

## 7. 오류

- 새 오류 kind는 없다. 최소값은 구조(프리셋)와 읽기 규칙(최소로 올림)으로 지키므로 사용자가 볼 오류가 없다.
- 남는 실패는 기존 kind로 난다. 매우 느린 연결에서 상한까지 겹치면 `network`(read timeout)가 날 수 있다. 이것은 §4.2의 여유 밖이다(§9 위험).

## 8. 비밀값·OS별 분기

- 비밀값: 새로 다루는 값이 없다. `Throttle`의 `Debug`는 knob 값만 찍는다.
- OS별: 저장은 바이트라 같다. 표시·프리셋만 OS 진법을 따른다(§6.1). Windows의 "1.0MB/s"는 1,048,576바이트/초이고 macOS·Linux는 1,000,000이다. 같은 `settings.json`을 다른 OS로 옮기면 값은 그대로이고 라벨만 다르게 보인다(예: 1,048,576 → macOS 덧칸 "1.05MB/s". 프리셋 "1.0MB/s"와 라벨이 겹치면 유효숫자 3자리로 구별한다, 구현 중 변경 7). 프리셋에 없으면 §6.1의 덧칸으로 보인다.

## 9. 위험

| 위험 | 영향 | 줄이는 법 |
|---|---|---|
| 수요 근거가 없다(ROADMAP:9) | 쓰지 않는 기능이 설정 화면에 두 줄을 더한다 | 기본 끔. 두 줄은 받기 섹션 안에 두고 새 섹션·배너를 만들지 않는다 |
| CDN이 느린 연결을 서버 쪽에서 끊는다 **[실측 필요]** | PD 한 GET이 1MB/s로 수 시간 열려 있다. 서버가 너무 느린 클라이언트를 끊으면 재시도가 잦아진다 | progressive는 이미 `Range`로 이어받고 재시도한다(`progressive.rs:7`, 연결 대기 core.md 56). 실측: 1MB/s 작업 상한으로 긴 PD 하나를 끝까지 받고 재시도 수만 범주로 적는다(§12) |
| hyper 조각 상한이 바뀐다 | §4.2의 계산이 틀어진다 | 의존성을 올릴 때 `DEFAULT_MAX_BUFFER_SIZE`를 다시 본다(dependabot 검토 표에 한 줄). `THROTTLE_MAX_WAIT`이 최후 방어선이다 |
| 공유 bucket 잠금 경합 | 24개 스트림이 조각마다 `Mutex`를 잡는다 | 잠금 안에서는 산술만 한다(대기는 잠금 밖). 꺼진 상태는 knob 원자값만 읽고 잠금을 잡지 않는다 |
| 값 바꿈과 대기 경합 | 깨우기를 놓치면 옛 값으로 최대 15초 기다린다 | 기다리는 쪽은 knob을 읽기 **전에** `Notified` future를 만들고 `enable()`한다. 그래야 읽기와 등록 사이의 `notify_waiters`를 놓치지 않는다. 깨어나면 다시 계산한다. 테스트(§10.2 4번)로 고정 |
| 받는 중 끔 → 켬 반복 | burst만큼 순간 초과 | 0.25초 분량이라 무시한다 |

## 10. 테스트 계획(TDD: 실패 테스트 먼저)

### 10.1 순수 상태 기계(`throttle.rs` 단위, 시각을 인자로)
1. 끔이면 `take`가 늘 0을 돌려준다(빚이 쌓이지 않는다).
2. 속도 r, burst 소진 뒤 n바이트 → 대기 n/r.
3. 여러 번 연속 `take` → 대기가 누적 빚 / r로 늘어난다(공유 bucket의 도착 순서 공평성).
4. 시간이 지나면 채워지되 capacity를 넘지 않는다.
5. 값을 바꾸면 바꾼 시각까지는 옛 값으로 채워진다. 끄면 빚이 0이 된다.
6. 빚 상한: 계산 대기가 `THROTTLE_MAX_WAIT`을 넘지 않는다.
7. 긴 구간 평균: 가상의 1시간 동안 무작위 크기 조각을 `take`대로 흘리면 평균 속도가 r의 ±1% 안이다.

### 10.2 async 래퍼(`#[tokio::test(start_paused = true)]`, 네트워크 없음)

core dev-dependency tokio에 `test-util`이 없다(`crates/core/Cargo.toml:28`). 구현 PR이 더한다. shell은 이미 있다(`crates/shell/Cargo.toml:42`).

1. `consume`이 계산한 시각에 정확히 끝난다(`tokio::time::Instant`로 확인).
2. 두 bucket(작업 → 공유) 순서: 작업 상한이 낮으면 공유 bucket 빚이 쌓이지 않는다.
3. **대기 중 취소**: `select!{ consume, token.cancelled() }`에서 취소하면 시계를 더 진행하지 않아도 곧바로 끝난다.
4. **대기 중 값 바꿈**: 1MB/s로 10초 대기 중에 끔 → 곧바로 끝난다. 10MB/s로 올림 → 남은 빚 / 10MB/s 뒤에 끝난다.

**주의**: paused 시계와 실제 소켓(wiremock)을 섞지 않는다. 런타임이 I/O를 기다리며 쉬는 동안 시계가 자동으로 넘어가 reqwest의 read timeout이 가짜로 터진다.

### 10.3 엔진 통합(wiremock, 실제 시계, 작은 값)

코어 `Throttle`은 최소값을 강제하지 않는다(최소는 설정 정책이다). 그래서 테스트는 200KB/s 같은 작은 값으로 1~2초 안에 끝낸다.
1. progressive: 300KB 본문, 작업 상한 200KB/s → 걸린 시간 ≥ 1.0초 근처(아래 한계만 단정, 위는 넉넉히).
2. segmented: 세그먼트 6개 × 50KB, 동시 4, 작업 상한 200KB/s → ≥ 1.25초 근처. 세그먼트 본문 읽기에서 늦춰짐을 확인한다(쓰기 루프가 아니다).
3. 공유 상한: 두 요청이 같은 공유 `Throttle`을 쓰면 합쳐서 상한 근처다.
4. 생방송: `Throttles`를 붙여도 녹화 엔진은 늦춰지지 않는다(기존 live 테스트 fixture로).
5. 대기 중 취소: 낮은 상한으로 받는 중 `cancel` → 100ms 안에 `Cancelled`, `.part`가 남고 같은 요청으로 이어받으면 이어진다.
6. 끔(기본 `Throttles::default()`)은 기존 테스트가 모두 그대로 통과한다(회귀).

### 10.4 셸(`crates/shell/tests/`, 가짜 Backend)
1. 생방송이 아닌 작업의 `DownloadRequest.throttle`에 작업·공유 bucket이 둘 다 있고, 생방송은 둘 다 `None`이다(가짜 Backend가 받은 요청을 기록한다).
2. 두 작업의 공유 bucket이 같은 것이다(`Arc::ptr_eq` 노출 helper는 `#[cfg(test)]`). 작업 bucket은 서로 다르다.
3. `update_and_apply`로 값을 바꾸면 매니저 knob이 바뀐다. `null` 패치 = 끔, 최소보다 작은 값 = 최소.
4. 설정 읽기: 키 없음 = 끔, 0·음수·문자열 = 끔, 최소 미만 = 최소, 큰 값 그대로.
5. bindings 재생성 검사.

### 10.5 프런트(vitest)
1. 프리셋이 OS 진법을 따른다(macOS 5 → 5,000,000, Windows 5 → 5,242,880).
2. 라벨이 `formatSpeed` 결과와 같다.
3. "제한 없음" 선택 → `null` 패치. 프리셋에 없는 저장값은 덧칸으로 보인다.

### 10.6 ETA
- `Meter` 단위 테스트(시각 인자): 5초 창 동안 일정한 r로 늘면 속도 ≈ r, ETA ≈ 남은 / r. 값을 바꾼 뒤 5초 안에 새 값으로 수렴한다. 지금 `Meter` 테스트 방식(`progress.rs:307` 이하)을 그대로 쓴다. `Meter`는 바꾸지 않는다.

## 11. 단계(stacked PR)

| 단계 | 내용 | 커밋 타입 | 구현 중 변경 | gate |
|---|---|---|---|---|
| RL-0 | 이 문서 + ROADMAP 한 줄 + features/README 행 | `docs:` | — | scan |
| RL-1 코어 | `download/throttle.rs`(Bucket·Throttle·RateKnob·Throttles), `DownloadRequest.throttle`, progressive·segmented seam, `read_capped_throttled`, live는 None, `MIN_RATE_LIMIT_BPS`·`THROTTLE_MAX_WAIT` 상수, tokio `test-util` dev-dep. §10.1~10.3·10.6 | `feat:` | core.md 75 | fmt·rust·coverage |
| RL-2 셸 | `UserSettings` 두 필드 + 관대한 읽기, `SettingsDto`·`SettingsPatch`(Nullable), `update_locked` 최소 올림, `DownloadManager` knob·공유 bucket·`set_rate_limits`, `start`에서 붙이기(생방송 제외), `update_and_apply`, bindings. §10.4 | `feat:` | core.md 76(설정 필드)·app.md 92 | rust·tauri-clippy·tauri |
| RL-3 앱 | 설정 › 받기 두 줄(Select 프리셋), copy deck 다섯 키, `content.md`·`patterns.md` 전표, 가짜 백엔드·Playwright spec, 갤러리 기준선. §10.5 | `feat:` | app.md 93 | frontend·design-tokens·e2e-web·design-shots |

- RL-2와 RL-3을 한 PR로 합쳐도 된다(DTO와 화면이 함께 바뀐다). 나누면 RL-2 머지 시점에 화면 없는 설정 키가 잠깐 있다. 기본 끔이라 사용자 동작은 같다.
- 중요한 PR 기준(데이터·계약·인증·DO·릴리스)으로 보면 RL-2가 설정 파일 형식을 더하므로 Codex 리뷰 대상이다. RL-1·RL-3은 Claude 리뷰로 충분하다.
- 릴리스: `feat`이므로 다음 minor(0.11.0).

## 12. 사용자 실측(출력은 범주만)

| ID | 무엇 | 왜 | 누가 |
|---|---|---|---|
| M-RL-1 | 작업 상한 1MB/s로 긴 일반 VOD 하나를 끝까지 받기 | CDN이 느린 연결을 끊는지(§9). 결과는 "끝까지 받음/재시도 n회 범주" | 사용자(본인 영상) |
| M-RL-2 | 합계 2MB/s, 작업 셋 동시 → 화면 속도 합이 상한 근처인지, 녹화 하나를 함께 돌려 `gaps`가 0인지 | 합계 규칙과 생방송 제외 확인 | 사용자 |

## 13. 열린 항목

- 받는 중 작업 행에 "속도 제한 중" 표시를 둘지. 이번에는 두지 않는다(속도 숫자가 이미 보인다). 사용자 시험에서 헷갈림이 보이면 다시 연다.
- 프리셋 단계(1·2·5·10·20·50·100)는 **[잠정]**이다. 쓰는 사람의 회선 분포 근거가 없다.

---

## 구현 중 변경

1. **(RL-1, 2026-10-18) 대기는 호출마다 마감 시각을 갖는다**(§3.2 "값 바뀜"보다 우선). 명세는 깨어난 `consume`이 "다시 계산"한다고만 적었다. bucket 전체 빚으로 다시 계산하면 뒤에 온 호출이 쌓은 빚만큼 앞 호출이 따라 늦어져(24개 스트림이 서로 밀린다) "대략 도착 순서대로 공평"(§3.2)이 깨진다. 그래서 각 호출은 `take` 때 받은 대기로 마감을 정하고, 마감에서 깨면 그대로 끝낸다. 값이 바뀌었을 때만 자기 앞의 남은 바이트(`남은 시간 × 옛 속도`)를 새 속도로 나눠 마감을 새로 구하고, bucket도 `take(새 값, 0, now)`로 새 속도로 넘긴다. 구현 `crates/core/src/download/throttle.rs`, core.md 75.
2. **(RL-1) 꺼진 상태는 잠금 없이 곧바로 돌아온다**(§9 "공유 bucket 잠금 경합"을 구현한 모양). 꺼진 동안 bucket은 갱신되지 않는다. 다시 켜지면 첫 `take`가 옛 빚을 시간 경과로 갚고 이어 간다. 꺼짐을 기다리던 호출이 먼저 본 경우에는 그 호출이 `take(None, 0, now)`로 빚을 0으로 지워 두므로, 다시 켜진 bucket은 burst가 가득 찬 채 시작한다.
3. **(RL-1) `Throttles::is_unlimited()`와 `Throttle::same_bucket()`·`rate()`를 공개로 더했다.** 셸 테스트(§10.4 2번)가 공유 bucket 동일성을 integration 테스트에서 봐야 해서 `#[cfg(test)]` helper 대신 쓴다.
4. **(RL-2) `DownloadManager::rate_limits()` getter를 더했다**(§3.3은 `set_rate_limits`만 적었다). 셸 테스트가 매니저가 가진 값을 직접 확인하고, 설정과 매니저가 어긋났는지 점검할 때 쓴다. 최소값 올림(`normalize_rate_limit`)은 설정 읽기·패치 저장 두 곳이 같은 함수를 쓰고, 매니저는 최소를 모르는 채 받은 값을 그대로 쓴다(0만 끔으로 본다).
5. **(RL-2) 설정 파일에 끈 상태는 `null`로 적는다**(`skip_serializing_if` 없음). `last_url` 등 다른 `Option` 필드와 같은 모양이고, 설정 JSON을 통째로 비교하는 golden이 없어 깨지는 것이 없다.
6. **(RL-3) 프리셋·덧칸 로직은 `app/src/lib/rateLimit.ts`에 순수 함수로 뒀다**(`rateLimitOptions`·`rateLimitToStored`·`rateLimitFromStored`). §10.5의 vitest 세 가지를 컴포넌트 없이도 단위로 확인하기 위해서다. 낭독용 단위는 `Select` 옵션에 `label`만 있어 주지 못했다(§6.2가 허용한 "못 주면 그대로").
7. **(리뷰 반영, 2026-10-18) 호출 전체 대기 상한과 덧칸 라벨.** ① `THROTTLE_MAX_WAIT`는 bucket 하나가 아니라 `Throttles::consume` 한 번의 전체 대기에 건다(§3.2·§9 "빚 상한"보다 우선). 두 bucket에 같은 마감 상한(`cap`)을 주고, 받는 중 값을 낮춰 다시 계산한 마감도 `cap`으로 자른다(core.md 77). ② 덧칸 라벨(§6.1)이 프리셋 라벨과 같아지면(1000 진법의 1,048,576이 둘 다 "1.0MB/s") 덧칸만 `formatFileSize` 표기(`1.05MB/s`)로 구별한다(app.md 94). 숫자·단위는 `bytes.ts`만 만든다는 규칙(content.md W5)은 그대로다. ③ 읽기 제한 증거 테스트를 원시 TCP 서버 기반으로 바꿨다(core.md 77).
