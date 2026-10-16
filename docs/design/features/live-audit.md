# ⑤ 생방송 녹화(v0.7.0) 사후 점검

**상태·확정 결정(2026-10-16)**: 코드만 읽은 점검이고 고치는 PR(plan.md 트랙 ⑤ F1~F6)은 아직 없다. 사용자가 확정한 것: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자** · 결정 표 '유지' 26행(C4·C5·C6·C7·D1·D3~D8·R1~R4·B1~B3·U1~U5·L2·L4·L5) 추천대로 · **L6** 배포된 v0.7.0의 생방송 동작(관리자 예외, `/live/` 주소 붙여넣기)을 받아들인다 · **L7** 녹화 `.part`는 지금 경로 그대로 두고 최소 조치로 지킨다(모든 삭제 진입점의 sidecar 소유권 검사, '새 녹화 시작'과 '기존 녹화 저장'의 계약 구분, v0.7.0 파일 호환; 별도 `.rec.part` 체계는 후속) · **C1** 뒤집는 결정 ①(본인 영상 제한 → 로그인 채널 또는 맡긴 채널)·③(app.md §1.2 부분 뒤집기) 승인 · **L8** 끝난 이유 표시 · **L-D1** 맡은 채널의 생방송은 v1에서 닫는다 · **E1** ③ 조기 종료는 끈다 · **R5** 전체 빠른 다시보기 defrag는 실측 뒤 · **U2** 자막 기본 형식은 실측 뒤. UX 기준 ① "숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다". Codex 리뷰는 설계 단계에서 세 번 끝냈으므로 구현 PR에서는 중요한 PR만 돌린다. 조사 원자료·근거 확인 표·Codex 리뷰 원문은 저장소에 없다(공개 저장소 규칙). 이 문서는 Codex 3회차(M1~M6)의 정정을 반영했다: 삭제 진입점은 `resume` 한 곳이 아니고(M1, (1)), 멈춤 계약은 한 곳 수정으로 끝나지 않으며(M2, (7-a)), init만 남은 `.part`가 자동 재개를 통과하고(M3, (7-f)), defrag의 복원 보장은 과장이었다(M4, (2)).

- 기준 트리: 읽기 전용 작업 트리(origin/master `df454c3`, v0.7.0). 아래의 파일:줄은 모두 이 트리 기준이다.
- 점검 방법: 코드만 읽었다. 실행·실서버 요청·민감 파일 열람은 하지 않았다. 대어 본 위험의 출처는 옛 설계 옛 생방송 설계(구현되어 core.md 구현 중 변경 58~60과 ADR-0025가 대신한다)(§3.3~3.5·§8·§10·§14 K1~K11)와 Codex 1·2회차(N4, "EFBIG/223 부분 쓰기", "msn 재설정", "첫 폴링 시작 위치")다.
- 판정 규칙
  - **문제 있음**: 코드에서 그 경로가 실제로 이어지는 것을 줄 단위로 확인한 것만 이렇게 적었다.
  - **불명**: 서버 동작에 달렸거나 끝까지 따라가지 못한 것이다.
  - **의도와 다름**: 버그는 아니지만 옛 설계와 다르게 동작하는 것이다.
- 다음에 쓸 번호(이 트리의 마지막 번호 뒤): core.md 구현 중 변경 **61**, app.md **78**, ADR **0026**, D **64**.

## 0. 먼저 볼 것: 확정한 결정과 배포된 동작이 달랐다(L6으로 정리됨: 배포 동작을 받아들인다)

2026-10-16에 결정 표의 "유지" 26행을 추천대로 확정했다. 그 가운데 L2·L4는 배포된 v0.7.0과 반대다. 버그로 판정하지 않았다. 다른 세션이 ADR-0025·app.md 77에서 다시 결정한 것으로 보인다. 다만 확정 내용이 그대로 반영됐다고 읽으면 안 된다.

| 결정 | 확정한 내용(`decisions.md`) | 배포된 동작 | 근거 |
|---|---|---|---|
| L2 관리자 예외 | (A) 생방송에는 관리자 예외를 두지 않는다 | **관리자 예외가 있다.** 관리자는 남의 생방송도 녹화할 수 있다 | `crates/shell/src/ownership.rs:108-113`(`me.is_admin`이면 `AdminOverride`), app.md 77 "게이트는 그대로다 … (관리자 예외 포함)" |
| L4 진입점 | (A) 계정 Menu 항목, 방송 중일 때 홈 한 줄, 영상 카드 모양의 녹화 카드. 주소 붙여넣기(B)는 R3·R4를 뒤집으므로 택하지 않음 | **(B) `/live/{channelId}` 주소 붙여넣기.** R3(invalidUrl 문구)·R4(`ContentRef`)를 뒤집었다 | `crates/core/src/url.rs` diff(`["live", id] if is_channel_id(id)`), `model.rs` `ContentRef::Live`, app.md 77 "`invalidUrl` 본문에서 '라이브 주소는 받을 수 없어요'를 지웠다" |

함께 보면 좋은 차이(결정 표에는 행이 없고, 옛 설계와 다른 점): 파일 나누기·구멍 뒤 새 파트·[이어 녹화]가 없다. 스트림이 다시 시작되면 녹화를 마친다(§3). `LiveWatch`·`recordings.json`도 없고, 작업은 기존 `jobs.json`·`.part`(`{output}.part`) 체계를 그대로 쓴다.

**확정(2026-10-16, L6 (가))**: 배포 동작을 정식 결정으로 받아들인다. 결정 표 L2·L4는 "뒤집음(ADR-0025·app.md 77)"이고, 홈 「내 방송」 한 줄은 ⑤(나) 후속이다. 이 결정은 ⑤ fix(F1~F6)의 선행 조건이 아니다(F2는 `ownership.rs`를 고치지 않는다). (나) 확정대로 되돌리는 안(관리자 예외 제거 + 진입점 (A))은 택하지 않았다.

---

## 항목별 판정

### (1) N4 경로 충돌: 같은 최종 이름의 VOD가 녹화 `.part`를 지우거나 섞는가

**정정(Codex 3회차 M1·M5, 2026-10-16).** 아래 초안의 "`resume`의 sidecar 불일치 삭제" 한 곳만이 삭제 경로가 아니다. `DownloadManager`의 작업 삭제는 sidecar 소유권을 확인하지 않고 출력 경로의 `.part`를 `discard_partial`로 지운다(`manager.rs:707`·`:748`, `part.rs:473`). 다른 **활성** 작업이 있을 때만 보호하므로 실패한 녹화는 보호받지 못한다. "처음부터"도 코어 진입 전에 같은 삭제 함수를 부른다(`manager.rs:1200`). 재현(코드 경로 기반): 실패한 VOD 기록 B를 남긴다 → 같은 출력 경로로 녹화 A를 시작해 실패시킨다 → B를 목록에서 삭제한다 → A의 녹화 `.part`까지 지워진다. 그래서 "최소 조치"는 모든 삭제 진입점의 소유권 검사를 포함해야 하고, `.rec.part`를 미루는 선택은 가능하지만 "N4 완전 해결"이라 부르면 안 된다. 또 비교할 새 요청의 방송 ID는 현재 요청·작업·sidecar에 없고(`DownloadRequest`, `Sidecar`), 옛 파일 마무리는 resolve보다 먼저 일어난다(`mod.rs:313`). 그래서 `same_job`에 `live_id`를 넣는 단순 비교로는 계약이 정해지지 않는다. 계약은 둘로 가른다. '기존 녹화 저장'(목록 [이어받기]·재개)은 sidecar가 주인이라 새 요청의 방송 ID를 비교하지 않고 받은 만큼 마무리한다. '새 녹화 시작'(카드 [받기])은 같은 경로에 같은 채널의 녹화 `.part`가 있으면 옛 파일을 완료로 처리하지도 지우지도 않고 번호 이름으로 새 경로를 쓴다. 방송 ID는 resolve 결과(`Source::Live`, `model.rs:126`)에서 얻어 새 녹화가 시작될 때 sidecar에 `Option`으로 기록한다. v0.7.0이 만든 sidecar에는 ID가 없으므로 비교는 '모름'이고 같은 방송으로 단정하지 않는다. 같은 채널의 다른 방송과 "섞임"은 정확히는 새 방송 바이트가 이어 붙는 것이 아니라 **옛 녹화를 새 요청의 완료로 처리하는 것**이다(`mod.rs:313`).

**판정: 문제 있음.** 활성 작업끼리는 막혀 있다. `failed`·`skipped`로 끝나 `.part`가 남은 녹화는 보호받지 못한다.

막혀 있는 경로:
- 활성 작업끼리는 겹치지 않는다. `active_with_output`(`manager.rs:251-258`)은 `holds_output`(`manager.rs:153-155`)인 작업만 본다. `JobStatus::is_active`(`dto.rs:644-652`)가 queued·running·pausing·paused·interrupted를 막으므로 `duplicateOutput`이 난다.
- 녹화가 실행 중이면 `.part`가 배타 잠금 상태다(`part.rs:140-155`). 다른 작업은 지우지 못하고 `FileLocked`가 난다.
- 기본 이름도 겹치지 않는다. VOD는 `[YYMMDD]`, 녹화는 `[생방송 YYMMDD-HHMM]`이다(`naming.rs` diff, 테스트 `live_filename_has_start_time`).

뚫린 경로:
- `is_active`에 `Failed`·`Skipped`가 없다(`dto.rs:644-652`).
- 녹화 엔진은 `.part`를 만든 직후 `job.keep_partial = true`로 둔다(`live.rs:212`). 그래서 어떤 오류로 끝나도 `.part`가 남는다(`mod.rs:301-302`). 예: 세그먼트 연속 5xx(`MAX_FLAKY`, `live.rs:341-343`), 중간의 `Unsupported`(테스트 `unsupported_midway_keeps_part_and_next_run_finalizes`), 디스크 부족·EFBIG.
- 받는 동안 같은 이름의 파일이 생기면 마무리가 `Skipped`로 끝나고 `.part`가 남는다(`mod.rs:398-400`).

재현:
1. 녹화가 `failed{diskFull}`로 끝났다. `.part`에 몇 시간 분량이 남아 있다.
2. 사용자가 VOD 카드의 파일 이름 칸을 그 녹화와 같은 이름으로 고친다. 파일 이름은 사용자가 고칠 수 있다(`ResolveCard.svelte` `fileName`).
3. `check_output` 결과는 `partial.same_job = false`다. `Sidecar.content`가 `Video`와 `Live`로 서로 다르다(`output.rs:103-120`, `part.rs:62-67`).
4. 카드에 중립 안내 `conflict.partialOther` "다른 화질로 받다 만 파일이 있어요. 지우고 처음부터 받아요."가 뜬다(`ConflictNotice.svelte:62-63`, `ko.ts:81`). 다시 받을 수 없는 녹화인데 "다른 화질"이라고 말한다. D7 확인도 없다.
5. [받기]를 누르면 `PartFile::resume`이 sidecar 불일치로 `.part`와 sidecar를 지운다(`part.rs:200-207`).

"섞임"도 한 갈래 있다. `same_job`은 `ContentRef::Live { channel_id }`만 비교하고 `live_id`는 보지 않는다(`part.rs:62-67`, `model.rs` diff). 같은 채널의 다른 방송이 같은 이름을 쓰면 새 요청이 옛 방송의 `.part`를 마무리하고 `Completed`로 끝난다(`mod.rs:313-320`). 시작 시각이 없을 때의 대체 이름 `[생방송] {채널} - {제목}.mp4`가 그런 경우다(`naming.rs` diff). 서버가 `liveOpenDate`를 빠뜨리는 일이 실제로 있는지는 [불명].

반대 방향(녹화가 실패한 VOD의 `.part`를 지운다)도 같은 경로다. 다만 VOD는 다시 받을 수 있으므로 피해가 작다.

고칠 방향(초안. 위 정정이 우선한다):
- 녹화 임시 파일을 VOD의 `{output}.part`와 다른 이름 체계에 둔다. 예: `{output}.rec.part`. N4 제안과 같다. 이렇게 하면 `resume`의 sidecar 불일치 삭제가 녹화 파일에 닿지 않는다.
- 그 전에 할 수 있는 최소 조치(L7 확정 범위):
  - 모든 삭제 진입점(`resume`·작업 삭제·`discard_partial`·"처음부터")이 `kind == Live`인 남의 sidecar를 만나면 지우지 않고 오류를 낸다(새 오류, 예: `partialRecording`).
  - `check_output`은 녹화 `.part`를 따로 알린다(`partialRecording`). 카드는 [받기]를 막거나 번호 이름을 기본으로 제안한다.
  - 새 녹화 시작/기존 녹화 저장 계약을 가르고 `live_id`는 sidecar에 `Option`으로 기록한다(위 정정).
- 테스트: 같은 최종 이름을 직접 지정한 VOD와, `failed` 상태 녹화의 `.part`가 함께 있을 때 `.part`가 살아남는지 본다(N4 제안). 추가: 실패한 VOD 기록을 목록에서 삭제해도 같은 경로 녹화 `.part`가 살아남는지, `resume`에서 보호 오류가 난 VOD 작업을 삭제해도 녹화가 보존되는지.

### (2) 파일 크기 초과·디스크 부족 때 반쯤 쓴 fragment가 완성 파일에 남는가

**판정: 그런 경로는 찾지 못했다(문제 없음). 다만 크기 상한에서 기능이 빠져 있다(의도와 다름). 상한 근처의 변환은 불명.**

남지 않는 이유(경로를 끝까지 따라감):
1. 쓰기 오류는 `p.write(&bytes)?`(`live.rs:291`)에서 곧바로 `run`을 빠져나간다. 같은 실행 안에서 `finish`로 가는 갈래는 없다. `Err(_) if stopped`(`live.rs:311`)는 fetch 오류에만 해당한다.
2. `PartFile::write`는 `write_all`이 성공했을 때만 `written`을 늘린다(`part.rs:288-293`).
3. `BufWriter::write_all`의 동작은 둘 중 하나다. 버퍼 안에 다 넣는 경우는 실패하지 않는다. 버퍼보다 커서 파일에 바로 쓰는 경우는 일부만 쓰일 수 있지만, 그 바이트는 `written` 밖에 있다. 따라서 버퍼에는 늘 `written`에 들어간 온전한 조각만 있다.
4. `download()`는 실패 뒤 `cleanup(keep=true)`(`mod.rs:301-302, 342-348`)에서 checkpoint를 부른다. 이때 `committed_len = written`이다(`part.rs:300-329`). 파일 끝에 붙은 부분 바이트는 `committed_len` 밖에 남는다.
5. 다음 실행(사용자의 [이어받기]·[다시 시도], 또는 `.part`가 있는 `interrupted`의 자동 이어받기 `manager.rs:620`)은 `PartFile::resume`으로 연다. 이때 `committed_len`까지 자른다(`part.rs:209-217`). 그 뒤 `mod.rs:313-320`이 `finish`를 부른다.
6. `finish`는 checkpoint(`mod.rs:365`)를 하고, `defrag`가 이어서 동작한다(`mod.rs:372-390`). defrag가 실패하면 원래 길이로 되돌린다는 것은 core.md 60의 서술이었으나 **모든 실패에 성립하지는 않는다**(Codex 3회차 M4, `defrag.rs:90-101`): 복원 시도는 moov 덧붙이기 실패에만 있고 그 복원 실패도 무시하며, 종류 패치 단계에서 실패하면 복원 없이 이미 바뀐 파일을 돌려준다. 호출자는 그 오류도 경고만 남기고 최종 파일로 옮긴다(`mod.rs:386`). 실제 재생 불능 여부는 불명이다.

빠진 기능:
- EFBIG·Windows 223을 따로 다루는 코드가 없다. `crates/core/src`에서 `EFBIG`·`FileTooLarge`·`223`을 grep하면 0건이다. `map_io_error`(`fsutil.rs:223-234`)는 디스크 부족만 `DiskFull`로 바꾸고 나머지는 `Io`로 둔다.
- 옛 설계 §3.5-4·§8은 "되감기 → 마무리 → 새 파트로 계속"이었다. 배포된 동작은 FAT32 4 GiB에서 녹화가 `failed{io}`로 끝나는 것이다. 사용자가 [이어받기]를 눌러야 받은 만큼이 마무리되고, 그 뒤 방송 구간은 녹화되지 않는다. core.md 59 알려진 한계 ⑥이 이것을 인정한다.
- 디스크 부족(28·Windows 112·39)은 `DiskFull`로 바뀌고(`fsutil.rs` 테스트 `map_io_error_storage_full`) 같은 흐름을 탄다.
- 쓰기 오류를 주입하는 테스트는 없다. `tests/recording.rs`의 테스트 이름 50여 개에 디스크·쓰기 실패가 없다. 옛 설계 §12.3의 "오류 주입 네 경우"가 빠졌다.

불명:
- 4 GiB 상한 바로 아래에서 마무리하면 defrag가 끝에 붙이는 `moov`도 EFBIG가 날 수 있다. 그러면 되돌린 뒤 조각 구조 그대로 마무리된다(`mod.rs:386-388`). QuickTime에서 탐색이 안 되는 파일이 된다(core.md 60 첫 문단). 실기 확인이 필요하다.

고칠 방향:
- defrag 실패 계약(M4): 변경 전 검증 실패(원본 그대로, 경고)와 변경 도중 I/O 실패를 구분하고, 후자는 복구·검증이 성공하기 전까지 `.part`로 보존해 최종 파일로 옮기지 않는다. 주입 테스트로 두 갈래를 고정한다. 전체 빠른 다시보기 defrag(R5)와 ②의 구간 결과도 이 계약을 쓴다.
- `map_io_error`에 EFBIG(Unix 27)·`ERROR_FILE_TOO_LARGE`(223) 갈래를 둔다. 값은 `libc` 상수와 Microsoft System Error Codes 문서로 확인한다(옛 설계 §8에서 [가정]). 이 갈래에 사용자에게 보이는 오류 코드를 준다. 지금은 `io`로 뭉뚱그려 이유가 숨겨진다(① 기준).
- 실패 주입 seam을 두고 "부분 쓰기 → 다음 실행 마무리 결과가 마지막 온전한 조각에서 끝남" 테스트를 더한다.
- 새 파트로 이어 가는 기능은 별도 결정이다. 다음 core.md 61 후보다.

### (3) msn 감소·재설정 때 조각을 버리는가

**판정: 셋으로 나뉜다.**

**(a) msn이 크게 줄어든 재시작: 문제 있음(조각이 섞이지는 않는다).**
- 경로:
  - `went_back = last + 1 < next`(`live.rs:231`)가 연달아 `BACK_CONFIRM = 3`번(`live.rs:81, 232, 238`)이면 `break`한다. 그다음 `finish`가 `Completed`로 끝낸다(`live.rs:422`).
  - 그 세 번의 폴링 동안 새 스트림 조각은 `s.msn >= next` 필터(`live.rs:254`)에 걸려 하나도 받지 않는다.
  - `DISCONTINUITY`·두 번째 `MAP`은 파서가 `ended = true`로 바꾸고 그 앞까지만 담는다(`hls.rs` `parse_media_inner`, 테스트 `live_media_restart_ends`). init 파일 이름이 바뀐 경우(`live.rs:233-238`)도 같다.
- 결과: 같은 방송(`liveId` 같음)이 이어져도 녹화는 "완료"로 끝난다. `DownloadOutcome::Completed`(`mod.rs:82-89`)에는 끝난 이유가 없다. 행과 알림은 정상 완료와 똑같이 보인다. 방송자가 인코더를 다시 연결하는 흔한 상황이라면 사용자는 그 뒤가 녹화되지 않은 것을 모른다(① "숨겨지면 안 된다").
- 테스트: 세 번 연속 역행 → 종료를 고정하는 테스트가 없다. 있는 것은 반대쪽 `single_stale_playlist_is_not_a_restart`(`recording.rs:919`)와 `discontinuity_ends_recording`(`recording.rs:620`)이다.
- 고칠 방향(가장 작은 것, L8 (가) 확정): 끝난 이유(`ended`/`restarted`/`stopped`/`notLive`)를 `Completed`에 싣고 저장 기록(`jobs.json`)에도 남겨 앱을 다시 켠 뒤에도 보이게 한다. 재시작으로 끝났고 방송이 아직 중이면 행에 "방송이 다시 시작되어 녹화를 마쳤어요 · [다시 녹화]"를 띄운다. 큰 것: 옛 설계 §3.4·§3.5처럼 새 파일로 이어 녹화한다. → ⑤-F3에서 고쳤다(core.md 65·app.md 82). 구현은 "방송이 아직 중이면" 조건을 뺐고(app.md 82 3항) `notLive`는 `ended`로 합쳤다(core.md 65 2항).

**(b) msn이 조금만 줄어든 재시작: 불명.**
- 경로: `last + 1 >= next`면 `went_back`이 거짓이다. 필터가 `next` 이상인 새 스트림 조각을 그대로 받는다.
- init 파일 이름이 같고 DISCONTINUITY가 없으면 새 스트림 조각이 옛 init 뒤에 붙는다. init 내용(SPS/PPS)은 비교하지 않는다(core.md 59 한계 ③).
- 서버가 이렇게 하는지는 [실측 필요](M-⑤-6 "재조회 뒤 msn").

**(c) 재조회 뒤에도 msn 기준을 그대로 쓴다: 불명(규격과는 다름).**
- 경로: 403·유휴 재조회(`refresh`, `live.rs:444-473`)는 `feed.media_url`만 바꾸고 `st.next_msn`은 유지한다.
- RFC 8216 §4.3.3.2는 서로 다른 Media Playlist에서 같은 msn이 같은 내용이라고 가정하지 말라고 한다. 옛 설계 §3.4-1·10은 그래서 재조회 뒤를 늘 새 세대로 보았다.
- 배포 동작은 이어 붙이는 쪽이고, 테스트 `expired_then_resolve_again_and_continue`(`recording.rs:514`)와 `init_path_change_with_same_file_is_not_a_restart`(`recording.rs:938`)가 이를 고정한다.
- 실물에서 같은 서명 갱신이면 msn이 이어질 가능성이 높다. 다만 확인 기록이 없다. core.md 58은 playlist 모양만 적었다. 재조회 결과가 다른 엣지·다른 msn 기준이면 (a)나 (b)로 이어진다.
- 고칠 방향: M-⑤-6을 실측한다. 재조회 직후 첫 목록에서 `next_msn - 1` 번호의 조각이 목록 안에 있는지만 확인한다. 가능하면 조각 크기나 `tfdt`가 이어지는지도 본다. 이어지지 않으면 (a)와 같은 끝 이유를 낸다.

### (4) 첫 폴링에서 과거 윈도 전체를 받는가

**판정: 그렇다. 의도와 다르지만 해는 작다.**
- 근거:
  - 첫 목록에서 `(None, first) => st.next_msn = first`(`live.rs:247`)다. 목록 맨 앞부터 받는다.
  - 실측한 창은 2초 조각 약 20개, 약 40초다(core.md 58 "실측한 playlist 모양"). 누르기 약 40초 전부터 들어가고, 시작할 때 20개를 동시 4개(`DEFAULT_CONCURRENCY`, `mod.rs:50`)로 한꺼번에 받는다.
- 옛 설계 §3.4-2는 끝에서 `3 × TD`(약 6초)를 의도했다. 근거는 RFC 8216 §6.3.3이다. 배포 동작도 규격 위반은 아니다. §6.3.3은 끝에 너무 가까이 시작하지 말라는 것이다.
- 문구: `card.live.body` "받기를 누르면 녹화가 시작돼요. 방송이 끝나거나 녹화 마치기를 누를 때까지 받아요."(`ko.ts:54`)는 "지금부터"를 약속하지 않는다. /help(`worker/src/http/help.generated.ts`)에도 그런 문구가 없다. 사용자를 속이는 문구는 없다.
- 고칠 방향: 행동은 그대로 두어도 된다. 받기 전 40초가 오히려 이득일 수 있다[가정]. core.md 61에 "첫 목록 전체를 받는다(약 40초 앞부터)"를 적어 설계와 맞춘다. 원하면 /help에 "누르기 조금 전부터 들어가요" 한 줄을 넣는다. 테스트는 이미 사실상 고정되어 있다(`endlist_finishes_without_gaps` 등이 0번부터 받는다).

### (5) 서명 토큰·주소가 로그·sidecar·오류에 새는가

**판정: 새는 경로는 찾지 못했다(문제 없음). 생방송 전용 누출 테스트는 없다([잠정]).**
- 근거:
  - `Source::Live`의 `Debug`가 `DebugUrl`(`redact_url`)을 쓴다(`model.rs` diff, `impl fmt::Debug for Source`). `MediaPlaylist`·`Segment`·`Variant`의 `Debug`도 손으로 썼다(`hls.rs:48-75`).
  - `LiveSnapshot`은 `derive(Debug)`지만 안쪽 `MediaPlaylist`의 손 구현을 탄다.
  - `Feed`(`live.rs:46-49`)는 `Debug`가 없다.
  - `live.rs`에는 `tracing` 호출이 없다. 엔진이 부르는 로그는 `segmented.rs:397`의 `error = %e`(`Error`의 Display)와 `mod.rs:376`의 `DefragReport`다.
  - `Error::HttpStatus`에는 주소가 없다(`error.rs:25`). `reqwest` 오류는 `without_url()`로 바꾼다(`error.rs:128`).
  - `live-detail` 해석은 원문 URL을 오류에 넣지 않는다. 주석 "원문 URL에는 서명 토큰이 있으므로 오류에 넣지 않는다"(`info.rs` diff)가 있고, `url::ParseError`는 입력을 되읊지 않는다.
  - 생방송 경로 토큰은 `hdntl`이다(core.md 58 "서명은 master 쿼리(`hdnts`)와 variant 경로(`hdntl`)"). 따라서 기존 `redact_url`(`http.rs:192-220`, 테스트 `redact_url_rules`)이 덮는다. 옛 설계 §10의 "접두가 다르면 갈래 추가"는 필요 없게 됐다.
  - sidecar에는 `ContentRef::Live { channel_id }`·화질·길이만 있고 주소가 없다(`part.rs:31-45`). 작업 주소는 `chzzk.naver.com/live/{channelId}`로 토큰이 없다. 채널 ID가 들어가는 점은 옛 설계와 다를 뿐이고 누출이 아니다. 사용자 본인 디스크다.
- [잠정]:
  - `serde_json` 오류 문구(`info.rs` diff의 `detail: e.to_string()`)는 타입이 틀린 스칼라 값을 되읊는다. URL을 담는 `path`는 문자열 필드라 그럴 가능성은 낮다. 응답 모양이 바뀌어 URL 문자열이 숫자 필드로 들어가면 오류에 실릴 수 있다. VOD 해석과 같은 기존 방식이다.
  - 셸 `tests/secrets.rs`와 `http.rs`는 `bff221d..df454c3`에서 바뀌지 않았다. 생방송 resolve·녹화 로그에 대한 누출 테스트는 더해지지 않았다.
- 고칠 방향: `tests/secrets.rs`에 생방송 fixture(`testdata/live/live_detail.json`)로 resolve → 녹화 → 오류 경로의 로그·`AppError`에 `hdnts`·`hdntl=exp`·`hmac`이 없는지 보는 테스트를 하나 더한다.

### (6) LLHLS 항목을 고르는가

**판정: 고르지 않는다(문제 없음).**
- 근거:
  - `parse_live_media`(info)는 `mediaId == "HLS"`이면서 `protocol == "HLS"`인 것만 고른다(`info.rs` diff, `find(|m| m.media_id… == Some("HLS") && …)`). 순서에 기대지 않는다.
  - fixture `testdata/live/live_detail_llhls_first.json`과 테스트 `live_detail_picks_hls_by_media_id`가 이를 고정한다.
  - 저지연 항목만 있으면 `Unsupported::NoHlsMedia`로 거부한다.
  - 목록 파서는 `PART`·`PRELOAD-HINT`를 무시하고 전체 조각만 쓴다(`hls.rs:309-311` 주석, 기존 테스트 `hls.rs:666`).
- [실측 필요]: 일반 HLS 목록에 `EXT-X-PART`·`PRELOAD-HINT`·`SERVER-CONTROL`이 섞여 오면 "모르는 HLS 태그" `warn!`(`hls.rs:316`)이 폴링(1초)마다 태그 수만큼 찍힌다. 몇 시간 녹화에서 로그가 커진다. core.md 58의 실측 모양에는 이 태그 이야기가 없다.
  - 고칠 방향: 생방송 파서에서는 LL 태그를 조용히 무시한다. 또는 녹화 한 건에 한 번만 경고한다.

### (7) 그 밖에 옛 설계가 다룬 위험

**(7-a) [녹화 마치기]가 듣지 않는 구간: 문제 있음.**
- 경로:
  - 세그먼트가 403이면 `expired = true`가 되고(`live.rs:320-323`) `refresh(job, &mut feed, &tracks).await?`(`live.rs:360`)를 부른다. 이것만 `until_stop!`으로 감싸지 않았다. 나머지 재조회 호출(`live.rs:165, 176, 368, 399`)은 모두 감쌌다.
  - `refresh` → `Job::reresolve` → `Job::resolve`는 연결 실패에서 `self.sleep`(cancel만 본다, `mod.rs:169-171, 227`)과 `wait_for_network`(최대 `NETWORK_PATIENCE_MS = 1_800_000` = 30분, `retry.rs:15`)으로 기다린다. `variant_url`(`live.rs:483-499`)도 같다.
- 재현:
  1. 녹화 중 서명이 만료되어 세그먼트가 403이 난다.
  2. 바로 그때 네트워크가 끊긴다.
  3. 사용자가 [녹화 마치기]를 누른다. `stop_job`은 `live_stop`을 취소한다(`manager.rs:173-176`).
  4. 엔진은 이를 보지 못하고 최대 30분 기다린다.
  5. 끝내 연결이 안 되면 `Network` 오류로 `failed`가 된다. `Completed`가 아니다. `.part`는 남는다.
- 앱 닫기도 생방송은 `live_stop`으로 마무리하므로(app.md 77 "`quit`도 생방송은 마무리한다") 같은 구간에 걸린다. 그러면 quit 기한 뒤 detach된다(`manager.rs` `detached`).
- core.md 59 "재조회 모두 `live_stop`을 함께 기다린다(`until_stop!`)"와 어긋난다. 테스트 `stop_while_waiting_out_a_segment_outage_finalizes`(`recording.rs:1465`)는 세그먼트 연결 실패 경로(`live.rs:324-336`)만 본다.
- 고칠 방향: `live.rs:360`을 `until_stop!(stop, refresh(…))`로 감싸고 `None => break`로 둔다. 테스트는 "세그먼트 403 → master 연결 실패 중 멈춤 → `Completed`"다.
- **정정(Codex 3회차 M2): 이 한 곳만으로 멈춤 계약이 완성되지 않는다.** 정상 폴링의 다음 playlist 읽기(`live.rs:380`)는 직접 await하고, 그 요청은 `cancel`만 보는 공통 도우미를 거친다(`segmented.rs:370`). 엔진에 들어가기 전 첫 resolve도 같은 구조다(`mod.rs:214`·`:325`). 재현(코드 경로 기반): 조각 하나 수신 → 다음 playlist 응답을 지연 → [녹화 마치기] → 응답·재시도가 끝날 때까지 마무리되지 않는다. 고칠 범위는 세 곳(`:360` refresh · 다음 playlist 읽기 · 첫 resolve)이고, 계약은 "받은 조각이 있으면 마무리해 `Completed`, 없으면 `NothingRecorded`"이다. 둘을 각각 시험한다. 또 `live-detail` 해석 오류는 `Job::resolve`에서 즉시 반환되므로(`mod.rs:221`) 아래 K1 서술은 playlist 해석 오류에만 해당한다.

**(7-b) 같은 방송을 다시 녹화하면 새로 녹화하지 않고 옛 `.part`만 마무리한다. "처음부터"는 확인 없이 녹화를 지운다: 문제 있음.**
- 재현:
  1. 녹화가 `failed`로 끝났다. 방송은 계속된다.
  2. 사용자가 같은 `/live/` 주소를 다시 붙여넣는다.
  3. 기본 이름이 같다. 시작 시각 기준이기 때문이다(`naming.rs` diff, core.md 59 한계 ①).
  4. `check_output`은 최종 파일이 없으므로 번호 이름을 제안하지 않는다(`output.rs:40-45`). `partial.same_job = true`다.
  5. 카드에 `conflict.partial.body` "{size}까지 받았어요. 이어받으면 받던 곳부터 이어가요."(`ko.ts:79`, `ConflictNotice.svelte:44-58`)가 뜬다. 생방송에서는 틀린 약속이다.
  6. [받기]를 누르면 코어가 `mod.rs:313-320`에서 곧바로 `finish`한다. 결과는 `Completed`이고 새 녹화는 시작되지 않는다. 방송 중인데 녹화가 되지 않는다.
- 같은 안내의 [처음부터 다시 받기]를 고르면 `restart = true`(`receive.ts:153`)가 된다. 그러면 `discard_on_start`(`manager.rs:948-951`) → `discard_partial`(`manager.rs:1200-1207`)로 다시 받을 수 없는 녹화가 지워진다. D7 확인이 없다. 확인은 완성 파일 덮어쓰기(`wantsOverwrite`)에만 있다.
- 작업 행의 [취소]에는 생방송 전용 확인이 있다(`ko.ts:190` `dialog.cancel.live.body`). 카드 쪽에만 빠졌다.
- 고칠 방향:
  - 생방송 카드는 `.part`가 있으면 기본으로 번호 이름(` (2)`)을 쓰고 새로 녹화한다. `free_name`이 `.part`도 피하므로(`output.rs:84`) 쓸 수 있다.
  - 옛 `.part`는 "받다 만 녹화가 있어요 · 목록에서 [이어받기]로 저장"으로 안내만 한다.
  - "처음부터"는 생방송에서 숨기거나 D7 확인을 단다.
  - 문구는 content.md에 새 키로 둔다.

**(7-c) 일시 404를 구멍으로 확정한다: 불명.**
- `Failure::Fatal(HttpStatus{404|410})`이면 곧바로 `gaps += 1`이 되고 넘어간다(`live.rs:313-319`). 최신 조각이 엣지에 아직 없을 때도 그렇다. core.md 59 한계 ②가 인정한다. 실서버 빈도는 [실측 필요].

**(7-d) 구멍 뒤 오디오·비디오 싱크: 불명(인정된 한계).**
- defrag는 `tfdt` 구멍을 당겨 붙인다. 구멍이 있으면 그 길이만큼 싱크가 어긋날 수 있다(core.md 60 한계 ①). 옛 설계는 구멍마다 파일을 나눠 이를 피했다. 실기 확인이 필요하다.

**(7-e) 끝난 기록에서 구멍 수·끝난 이유가 사라진다: 의도와 다름.**
- core.md 59 한계 ⑤가 인정한다. (3)(a)와 함께 고치면 좋다. 옛 설계 §1.1-3 "숨기지 않는다"와 다르다. → ⑤-F3에서 고쳤다(core.md 65·app.md 82).

**(7-f) 위험 표의 나머지(옛 설계 §14)**

| # | 판정 | 근거 |
|---|---|---|
| K1 | 대응 일부 | 해석은 `info::parse_live_detail` 한 곳에 있다. 서킷은 없다. playlist 모양 불일치는 `Parse`이고 `MAX_FLAKY` 뒤 오류로 끝난다. `live-detail` 해석 오류는 `Job::resolve`에서 즉시 반환된다(`mod.rs:221`, Codex 3회차) |
| K3 | 대응됨 | 403 → 재조회. 새 조각마다 `job.refreshes = 0`(`live.rs:299`), 유휴 재조회는 `refresh_free`(`live.rs:562-571`) |
| K6 | 대응 일부 | 사전 여유 검사가 없다(core.md 59 ⑥). 전원 유지는 이번 점검 범위 밖([불명]) |
| K7 | 대응됨 | `MAX_LIVE` 별도 lane(`manager.rs:976-990`, 테스트 `live_runs_in_its_own_lane`·`vod_is_not_blocked_by_running_live`) |
| 자동 이어받기 | **대응 일부(예외 있음, Codex 3회차 M3)** | `.part` 없는 생방송은 자동으로 다시 시작하지 않는다(`manager.rs:617-621`, 테스트 `auto_resume_skips_live_without_partial`). 그러나 필터 `partial_bytes > 0`은 **init만 남은 `.part`**도 통과시킨다(init 직후 checkpoint `live.rs:213`). 코어는 `written <= init_len`이면 지우고 resolve하므로(`mod.rs:316`) 앱을 다시 켰을 때 같은 채널의 다른 방송을 옛 작업 이름·시각으로 새로 녹화한다. 자동 재개는 마무리할 미디어 조각이 실제로 있는 경우만 허용해야 한다(init만 있는 경우와 sidecar 없는 경우를 함께 시험) |
| 강제 종료 뒤 마무리 | 대응됨 | `interrupted_real_recording_is_converted_when_finalized`(`recording.rs:1111`), defrag 크래시 중간 상태 테스트(core.md 60 ②) |

---

## 고칠 순서 제안

다음 core.md 61·app.md 78에 적을 후보다.

1. (0) L2·L4: L6 (가)로 확정됨(배포 동작 수용). 코드 변경 없음.
2. (7-a) 멈춤 계약: `live.rs:360` + 다음 playlist 읽기 + 첫 resolve를 `until_stop!`으로 감싼다. 테스트 셋(한 줄 수정이 아니다, M2).
3. (1)·(7-b) 녹화 `.part` 보호와 카드 문구. 작은 순서로 하면 다음과 같다.
   1. 모든 삭제 진입점(`resume`·작업 삭제·`discard_partial`·"처음부터")이 남의 Live sidecar를 지우지 않는다(M1).
   2. 새 녹화 시작/기존 녹화 저장 계약을 가르고 `live_id`를 sidecar에 `Option`으로 기록한다(M5). 자동 이어받기는 마무리할 조각이 있을 때만(M3).
   3. 생방송 카드는 `.part`가 있으면 번호 이름을 기본으로 하고 "처음부터"에 D7을 단다.
   4. 그다음(후속, L7이 미룸) 별도 임시 이름 체계(N4)를 도입한다. 이는 `.part` 경로를 바꾸는 일이라 사용자 데이터 호환을 따져야 한다. 버전은 `type!` 검토가 필요하다(`docs/versioning.md`).
4. (3)(a)·(7-e) 끝난 이유를 `Completed`에 싣고 행에 보인다. 재시작이면 [다시 녹화]를 띄운다. DTO가 바뀌므로 bindings를 다시 만든다.
5. (2) EFBIG·223 매핑, 사용자에게 보이는 코드, 쓰기 실패 주입 테스트, defrag 변경 도중 실패 시 `.part` 보존 계약(M4).
6. (5) 생방송 누출 테스트. (6) LL 태그 경고 줄이기.
7. 실측: M-⑤-6(재조회 뒤 msn), 일시 404 빈도, 구멍 뒤 싱크, 4 GiB 근처 마무리.
