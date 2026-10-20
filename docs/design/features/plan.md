# 차별 기능 5종 실행 계획 (3차 전면 개정, 확정 결정 반영)

작성 2026-10-16(3차). **기준 origin/master `df454c3`(v0.7.0)**, 트리 읽기 전용 작업 트리(읽기만. `git rev-parse --short HEAD` = `df454c3` [확인]). 2차 기준 `bff221d`와의 사이에 다른 세션이 **생방송 녹화**를 넣어 v0.7.0으로 배포했다(`git log bff221d..df454c3` [확인]: `33168e9` 코어·셸 → `e1bf077` 유실 방지 → `f7deda4` defrag → `fde5d08` 오류 분기 테스트 → `ec7b30b` 화면 → PR #104·#105 → `ad5a755` 0.7.0 → `b27915a` ROADMAP). 그래서 ⑤ 트랙은 **"배포됨 + 사후 점검에서 나온 것을 고치는 fix PR"**로 바꿨다.

입력: 개정된 설계 넷 `delegation.md`(① 3차) · `range.md`(② 4차) · `backup.md`(③ 3차) · `chat.md`(④ 4차), ⑤ 사후 점검 `live-audit.md`, Codex 2회차 적대적 리뷰(N1~N9), 사용자 확정(아래), 2차 계획·결정 표(이전 판). 사용자 결정·실측 목록은 **`decisions.md`**에만 둔다. 이 문서는 행동 기술만 담는다(엔드포인트·응답 원문은 원자료에만).

표기: **[확인]** 이번 개정에서 `df454c3`에서 직접 연 줄이 받친다 / **[확인: 문서]** 개정된 설계 문서가 `df454c3`에서 연 줄을 인용(이번에 다시 열지 않음) / **[가정]** / **[실측 필요]** / **[잠정]** 출처 없는 수치(ADR-0009 묶음).

**보류(2026-10-18, 사용자 결정, decisions.md §1.3 H1·H2)**: 기능 ③(내 채널 새 영상·모아 받기)과 기능 ④(채팅 함께 저장)를 보류한다. ③은 ③-1 도구만 만들었고 그대로 둔다(다시 시작하면 남은 M-③부터). ④는 ④-1~④-4 코드를 유지하고 ④-3b·④-5·U2·M-④는 하지 않는다(다시 시작하면 M-④부터). 아래 트랙 ③·④ 표, 릴리스 ③(가)·③(나)·④ 행, 의존 그래프의 ③·④ 줄은 **보류 중인 계획**이다.

**상태·확정 결정(2026-10-16)**: 설계 상태이고 구현은 이 계획의 PR 표 순서로 시작한다(`docs/ROADMAP.md` Phase 5). 사용자가 확정한 것: Q1 실제 사용자 = 본인 + 지인 스트리머 + **그들의 편집자** · 결정 표 '유지' 26행(C4·C5·C6·C7·D1·D3~D8·R1~R4·B1~B3·U1~U5·L2·L4·L5) 추천대로 · **L6** 배포된 v0.7.0의 생방송 동작(관리자 예외, `/live/` 주소 붙여넣기)을 받아들인다 · **L7** 녹화 `.part`는 지금 경로 그대로 두고 최소 조치로 지킨다(모든 삭제 진입점의 sidecar 소유권 검사, '새 녹화 시작'과 '기존 녹화 저장'의 계약 구분, v0.7.0 파일 호환; 별도 `.rec.part` 체계는 후속) · **C1** 뒤집는 결정 ①(본인 영상 제한 → 로그인 채널 또는 맡긴 채널)·③(app.md §1.2 부분 뒤집기) 승인 · **L8** 끝난 이유 표시 · **L-D1** 맡은 채널의 생방송은 v1에서 닫는다 · **E1** ③ 조기 종료는 끈다 · **R5** 전체 빠른 다시보기 defrag는 실측 뒤 · **U2** 자막 기본 형식은 실측 뒤. UX 기준 ① "숨겨지거나 복잡하면 안 되고, 튀어 촌스러워도 안 된다". Codex 리뷰는 설계 단계에서 세 번 끝냈으므로 구현 PR에서는 중요한 PR만 돌린다. 조사 원자료·근거 확인 표·Codex 리뷰 원문은 저장소에 없다(공개 저장소 규칙). 이 문서가 위 결정과 다르면 결정 쪽이 우선한다.

---

## 0. 2차 계획에서 지운·바꾼 지시

| # | 2차 지시(지움·바꿈) | 사실(근거) | 지금 계획 |
|---|---|---|---|
| 1 | 트랙 ⑤ 여섯 PR(⑤-1 live-probe → 실측 게이트 G1~G5 → ⑤-2 docs → ⑤-3 파서 → ⑤-4 엔진 → ⑤-5 `RecordingManager`·`LiveWatch`·`recordings.json` → ⑤-6 화면) | 전부 **v0.7.0으로 배포됐다**: core.md 구현 중 변경 58~60(`core.md:805`·`:817`·`:829` [확인]), app.md 77(`app.md:1386` [확인]), ADR-0025(`adr/0025-live-recording.md` [확인]), D63(`README.md:212` [확인]), URL `live/{channelId}`·`download/{live,defrag}.rs`·별도 lane `MAX_LIVE`·`stop_job`(app.md 77). `LiveWatch`·`recordings.json`·`RecordingManager`는 없고 기존 `DownloadManager`·`jobs.json`·`{output}.part`를 그대로 쓴다(`live-audit.md` §0). 실기 확인도 끝났다(`ROADMAP.md:7` "배포 뒤 사용자가 앱에서 생방송 녹화가 정상 동작함을 확인" [확인]) | ⑤는 **사후 점검 결과를 고치는 fix PR 묶음**(§4 트랙 ⑤). 방송 상태 감시·자동 녹화(옛 ⑤ O-3·`LiveWatch`)는 **⑤(나) 후속**으로 ③(나) 뒤에 따로 연다 |
| 2 | 실측 게이트 G1~G5·N8("G5 진행 조건이 반대") | 배포로 G1~G4는 사실이 됐고(아래 decisions.md §2 M-⑤ 행 정리) G5(종료 신호)는 `endlist`·DISCONTINUITY 처리가 코드에 있다(`live-audit.md` (3)) | N8은 **소멸**(게이트 자체가 없어졌다). 종료 뒤 "다시보기가 생기는 시간"은 ③ 몫 실측으로 옮긴다(decisions.md M-③-8) |
| 3 | "②-1 → ⑤-3 sidecar 형식(`SidecarKind`·`content: Option`)", "③-3 → ⑤-5 `available_bytes` 재사용", 접점 표의 ⑤-3·⑤-4·⑤-5 행 | 생방송은 그 리팩터 없이 sidecar **v1·`kind = Live`**로 출시됐다(`range.md` 3차 개정 ② 행, `live.rs:201-209` [확인: 문서]). `ContentRef::Live { channel_id }`가 sidecar에 든다(`live-audit.md` (1)) | 두 의존을 **지운다**. ②-1은 "생방송 sidecar 호환 단위 테스트"를 자기 범위에 둔다(`range.md` §10 3차). ⑤-F2가 `same_job`·`resume`·삭제 진입점의 소유권 검사를 먼저 바꾸고 ②-1이 그 위에 얹는다: **⑤-F2 → ②-1은 기능 선행 조건 하나**다(§3·§5-A). L6은 ⑤-F2의 선행 조건이 아니다(F2는 `ownership.rs`를 고치지 않는다) |
| 4 | "①-4 → ⑤ O-6(맡은 채널 녹화 대상)" | v0.7.0 생방송은 VOD와 **같은 `OwnershipGate`**를 지난다(`ownership.rs:100-148` [확인], app.md 77 "게이트는 그대로다 … 관리자 예외 포함" [확인], ADR-0025 결정 다섯째 줄 [확인]) → `Delegated`를 판정에 넣으면 맡은 채널 생방송이 **저절로 열린다** | ①-4가 `verdict_in`에 `ContentRef::Live` 예외를 **세 곳**(`on_resolved`·`admit`·자동 이어받기 필터)에 둔다(`delegation.md` §9.1 3차). 여는 조건은 새 사용자 결정 **L-D1**(decisions.md) |
| 5 | ADR "0025 = ①", app.md "77 = ①-6", core.md "58 이후", 버전 "0.6.3 → 최소 0.7.0" | `adr/0025-live-recording.md`·`app.md:1386` 77·`core.md:829` 60·`Cargo.toml:9` `0.7.0` [확인] | **ADR 0026+ · D64+ · core.md 61+ · app.md 78+ · worker.md 105+**(§1). 다음 `feat` 릴리스는 **최소 0.8.0** |
| 6 | "④-2에 `chat::subtitle` 골든·`naming::sibling_path`", M-④-8·9를 ④-1 `--write-ass`로 | N5: 도구가 다음 PR의 렌더러를 필요로 했다. `chat.md` §10.1이 **가**(렌더러·`sibling_path`를 ④-1로, 도구 인자 `--write-ass`·`--write-srt`)를 골랐다 | ④-1 범위에 `chat::subtitle`·`sibling_path`·`--write-*` 둘, ④-2는 `chat::part`만(§4 트랙 ④) |
| 7 | "DTO 직렬 ②-2 → ④-4", "②-3 → ④-5", 릴리스 "②+④ 묶음(④-5가 ②-3 뒤라 함께 끝난다)" | N6: ②는 실측 불일치면 deferred(`range.md:530`·`:552` [확인: 문서])인데 ④가 거기 묶여 있었다. `chat.md` §12.1이 "둘 다 진행할 때의 머지 순서"와 "④의 선행 조건"을 갈랐다 | §5를 두 표로 나눴다: **기능 선행 조건**(트랙 안)과 **둘 다 진행하면 머지 순서**(트랙 사이). ④는 ②가 deferred·미정이어도 간다. 릴리스는 각각(§6) |
| 8 | M-③-1 "최신순 정렬 보장"으로 조기 종료를 켠다 | N7: 두 번 관찰은 보장이 아니다. `backup.md` §3.1 3차: 늘 마지막 페이지·`MAX_LIST_PAGES`까지 훑고 기준점으로 거른다. 조기 종료는 **열린 결정 E1**(추천 A 켜지 않음) | ③-2는 필드·페이지 방식만 확정한다. M-③-1 출력은 "관찰 표본에서 내림차순/아님/판정 불가 + 표본 수"(decisions.md) |
| 9 | ① 막힌 카드 버튼 [다시 확인], T-D62 UT9 문구, ⑤ [지금 확인] | N9: `content.md:142-143` 허용 목록(굳은 한자어·부사+동작)에 "확인"·"다시 확인"이 없다. `delegation.md` 3차: 기존 **[다시 불러오기]**(`action.reresolve`, 동작은 `me` 뒤 같은 주소 resolve)로. ⑤ [지금 확인]은 배포되지 않았다(배포 설계에 그 버튼 없음) | ①-5 범위·UT9 문구 고침. N9 **닫힘**(등록 안 함, ③ B2와 같은 판단) |
| 10 | ① D2 세부 "(b-1) `delegated_suspect` 메모리만 / (b-2) `session.json`에도" | N1·N2 반영으로 `delegated_suspect` 깃발이 **없어졌다**: `403 not_allowed`·`401 session_revoked`는 refresh 거부와 같은 상태 전이(Denied·Expired)로 바로, `401 invalid_token`만 refresh로 재확인, `me`도 `refresh_lock`을 잡아 적용 순서 = 서버 순서(`delegation.md` §9.4 3차, `session.ts:61-69`·`service.rs:502`·`:550-551` [확인: 문서]) | D2 (b)만 남기고 세부 선택지를 지운다(decisions.md). ①-4 완료 조건에 N2 시간선 테스트("잠금을 빼면 실패") 추가 |
| 11 | ① 롤백 호환 = "위임 행의 허가 시각"만 | N3: 미청구 초대가 V2 롤백 뒤 재허가에 붙을 수 있었다. `delegation.md` §8.1 3차 `inviteValid` = 미만료 ∧ (주인 관리자 ∨ `added_at` = `invite.owner_allowed_at`)를 열기·수락·청구·자동 완성·꼬리표 모두가 쓴다 | ①-2 완료 조건에 미청구·청구·청구 전·음성 대조·재SELECT 금지 다섯 테스트(§4) |
| 12 | 2차 §0 표 1~19 중 위에 없는 것 | 그대로 유효하다(Worker 먼저 릴리스·`TerminalObserver`·각자 상수·`check_output` 인자·72h·지연 회수·모아 받기 `skip`·`inline danger` 등). 줄 번호만 `df454c3`로 옮겨졌다(각 설계 문서 3차 개정 "줄 번호 갱신") | 되풀이하지 않는다 |

모델 배분에 **F(fable)** 를 두는 것은 이번 과제 지시(명세 확실 S / 추론 O / 중요 판단·UX F)를 따른다. 메모리 "3b부터 Opus·Sonnet만"보다 과제 지시가 우선한다(2차 §0 각주 유지).

### Codex 3회차(2026-10-16) 반영

| 지적 | 처리 | 자리 |
|---|---|---|
| M1 높음: L7 최소 조치 뒤에도 다른 작업의 삭제가 녹화를 지운다 | "삭제는 `resume` 한 곳"이라는 근거와 "N4 완전 해결"이라는 말을 **철회**. 모든 삭제 진입점(`resume`·작업 삭제·`discard_partial`·"처음부터")이 sidecar 소유권을 먼저 본다 | ⑤-F2 ①·⑧, `live-audit.md` (1) |
| M2 높음: ⑤-F1 한 곳으로 멈춤 계약이 완성되지 않는다 | F1 범위를 `live.rs:360` + 다음 playlist 읽기 + 첫 resolve 셋으로 넓히고 "받은 조각 있으면 마무리 / 없으면 `NothingRecorded`" 계약을 시험 | ⑤-F1, `live-audit.md` (7-a) |
| M3 중간: init만 남은 녹화가 재시작 뒤 다른 방송을 자동 녹화 | 자동 이어받기는 마무리할 미디어 조각이 있는 `.part`만 | ⑤-F2 ⑥, `live-audit.md` (7-f) |
| M4 중간: defrag "원래 길이로 복원" 보장 과장 | 보장 문장을 철회. 변경 전 검증 실패와 변경 도중 I/O 실패를 구분, 후자는 `.part`로 보존 | ⑤-F4, `live-audit.md` (2), `range.md` §3.5 |
| M5 중간: `same_job`에 `live_id`만으로는 계약이 안 정해진다 | '새 녹화 시작'과 '기존 녹화 저장'을 가르고, 방송 ID는 resolve 결과에서 sidecar에 `Option`으로 기록, v0.7.0 sidecar(ID 없음)는 '모름'으로 호환 | ⑤-F2 ②·③ |
| M6 낮음: rebase 뒤 남은 사실·의존 설명 | ① `M-⑤-8` 삭제 이유 정정(checkpoint는 정상 수신 중에도 16조각·5초마다) ② ⑤-F2 → ②-1을 **기능 선행 조건 하나**로(§5-A) ③ L6 → ⑤-F2 의존 근거 삭제(F2는 `ownership.rs`를 안 고친다) ④ `chat.md` §12.1의 M-②-2를 "②-1의 `dl --range`"로, M-②-6 실패도 보류 조건으로 | `decisions.md`, §3·§5, `chat.md` §12.1 |
| 결정 L-D1 수정 | "회수 상한이 깨진다"는 근거가 신규 작업 차단 지연과 진행 중 작업 지속을 섞었다. 닫는 이유를 "C4 범위 유지"와 "녹화 중 회수 정책 필요"로 나눠 적음. 자동 이어받기 필터에 컨텐츠 종류도 전달 | `decisions.md` L-D1, ①-4 |
| 결정 L8 유지(보완) | 끝난 이유를 DTO뿐 아니라 저장 기록에도 남긴다 | ⑤-F3 |

---

## 1. 번호 원천·버전(`df454c3`에서 다시 확인)

| 항목 | 지금 | 다음 | 근거 |
|---|---|---|---|
| ADR | 마지막 `0025`(생방송 녹화) | **0026 = ①**(`delegation.md` §17 PR 1). 0027 이후는 **머지 순**: ③ Checkbox, ③ 수치 묶음, ④ 수치 묶음, ⑤ fix에서 ADR이 필요하면(끝난 이유 표시·[다시 녹화]는 ADR-0025의 재검증 조건·보강이라 새 ADR [가정]) | `docs/design/system/adr/` 목록 [확인] |
| README D | D63(생방송 녹화) | **D64 이후, 머지 순**. ①·②·③·④는 새 D를 만들지 않는다(③ Checkbox는 `components.md` §2.29 + ADR) | `README.md:212` [확인] |
| `worker.md` 구현 중 변경 | 104 | **105 = ①**(`seeOther` 세 곳 + `FlashKind` 여섯 한 항목). `worker/`·`worker.md`는 `bff221d..df454c3`에서 바뀌지 않았다 | `worker.md:1188` [확인], `delegation.md` 3차 "번호 재조정" |
| `app.md` 구현 중 변경 | 77(생방송) | **78 이후, 머지 순**(①-1·②-5·③-6·④-6·⑤-F6 각각) | `app.md:1386` [확인] |
| `core.md` 구현 중 변경 | 60(defrag) | **61 이후, 머지 순**(②-5·④-6·⑤-F6 "첫 목록 전체를 받는다"·⑤-F2 sidecar `live_id`) | `core.md:829` [확인] |
| 배너 번호 | B1·B2·B4·B5(B3 없음) | ③ **B6**. ⑤ fix는 배너를 더하지 않는다 | `patterns.md:63`(`backup.md` 인용 [확인: 문서]) |
| `patterns.md` §17 | 33 | ④-5 **§17-34**(D7 이름 규칙) | `chat.md` §12 3차 [확인: 문서] |
| 셸 `ErrorCode` 1:1 표 | 22(`notLive`·`nothingRecorded`가 늘었다) | ② `rangeOutOfBounds` 23번째, ⑤-F2 `partialRecording`, ⑤-F4 `fileTooLarge`(이름 [가정]) — **머지 순** | `crates/shell/src/error.rs:34`(`range.md` 3차 ⑤ 행 [확인: 문서]) |
| 버전 | `0.7.0`(`Cargo.toml:9` [확인]). HEAD 기준 `release.mjs next-version` = "커밋 1개, patch → 최소 0.7.1"(이번 실행 [확인]) | 사용자에게 보이는 PR은 `feat` → MINOR(`versioning.md:19` [확인]) → 첫 `feat` 릴리스는 **최소 0.8.0**. ⑤ fix만 먼저 내면 `fix` → **0.7.1**. `!`는 없다(`versioning.md` §3 셋에 안 듦). **단, 별도 임시 파일 체계(`.rec.part`)는 L7이 미룬 후속이고, 하게 되면 `jobs.json`·`.part` 호환을 따져 `!` 검토 대상**(`live-audit.md` 고칠 순서 3-4). `!`을 운영 승인 우회에 쓰지 않는다 | 번호는 릴리스마다 `next-version`이 정한다(§6) |

---

## 2. 완전성 비평(개정 뒤 남은 구멍)

Codex 2회차 N1~N9는 각 설계가 3차·4차 개정에서 처리했다(N1·N2·N3·N9 → ① 3차, N5·N6 → ④ 3차·4차 + 이 문서 §5·§6, N7 → ③ 3차 + decisions.md M-③-1, N4·N8 → `live-audit.md` + 이 문서 §0-2·트랙 ⑤). 여기에는 **개정 뒤에도 남은 것**과 **설계 사이의 접점**만 적는다.

### ① 편집자 위임(`delegation.md` 3차)
| 남은 것 | 종류 | 처리 자리 |
|---|---|---|
| L-D1 맡은 채널 생방송을 여는 조건(A 닫고 O-4 뒤 / B 지금 / C 녹화 중 5분 확인) | **확정 (A) 닫음**(2026-10-16). 닫는 이유 둘: C4 범위 유지, 녹화 중 회수 정책이 아직 없음 | `decisions.md` L-D1 |
| `/api/me` 세션별 상한(§18-12) | 운영 로그 뒤 | ①-4 릴리스 뒤 관찰 |
| 허가 시각을 세대 식별자로 쓸 때 같은 ms·시계 역행(Codex "근거 없는 의심") | [가정]으로 §8.1에 적음 | — |
| "마지막 확인 {time}" 조각 ↔ [다시 불러오기] 낱말 차이(§18-14) | [가정] | UT9 |
| 릴리스 1 버전 올림 PR 3½ | C2 (가)일 때 필수 | §6 |
| [잠정] 상수: Worker 여섯(`store/delegation.ts`, 회수 행 보존 30일 포함) + 셸 `DELEGATION_RECHECK_MIN_GAP_MS` 5분 | ADR-0009 묶음, §18-2 인터뷰 | ①-1 ADR-0026 |
| D62 UT8·UT9 기준선 회차에 측정 대상 없음 | 시험 설계 | C6 확정 (가) |

### ② 구간만 받기(`range.md` 4차)
| 남은 것 | 종류 | 처리 자리 |
|---|---|---|
| 실측 M-②-2(세 시각 장면 대응)·M-②-3(키프레임)·M-②-6(defrag한 구간 파일 재생). **2·6이 ②-3 머지 조건**, 하나라도 실패면 ② deferred(보정 상수 없음) | **2·6 통과**(2026-10-18, 세 시각 일치·구간 파일 재생 된다). 3은 부분 관찰(세 구간 첫 프레임 키프레임, 도구 미작성), 결과는 ROADMAP "기능 ② 사용자 실측" | ②-0 도구(3번) · ②-1 `dl --range`(2·6번) |
| 전체 빠른 다시보기에도 defrag를 적용할지(이 기능 밖 새 결정, M-②-6 "전체 받기 파일" 관찰이 재료) | **확정: 실측 뒤**(2026-10-16). 적용하면 ⑤-F4의 defrag 실패 계약을 같이 쓴다. **적용(2026-10-18)**: 관찰 "안 된다" → `fix/defrag-full-hls`(core.md 71), 실패 계약은 같은 `finish` 분기로 그대로 | `decisions.md` R5 |
| M-②-6 마무리 시간·메모리 관찰(기준 "10초" [잠정]) → `Finalizing` 하위 표시·변환 중 취소 | [실측 필요](2026-10-18 실측에서 아직 안 봄) | ②-3 범위 판단 |
| `truncated` 필드 이름 · `patterns.md:398`·`:713` 키 이름 `filename.willSave` ≠ 실제 `willSaveAs` · `design-shots`에 `conflict.partialOther` 장면 유무 | 리뷰·확인 | ②-2 리뷰, ②-3 |
| 같은 경로의 생방송 `.part`가 VOD·구간 받기로 지워지는 위험(N4와 같은 구조) | ⑤ 몫 | ⑤-F2가 먼저(§5-A), ②-1은 그 위에서 `same_job`을 바꾼다 |
| 칸 폭 `ch`·moov 크기 상한 | [잠정] | ②-3 ADR-0009 행 |

### ③ 내 채널 새 영상·모아 받기(`backup.md` 3차)
| 남은 것 | 종류 | 처리 자리 |
|---|---|---|
| 결정 E1 조기 종료(A 켜지 않음·B 안전장치와 함께·C 없이) | **확정 (A) 끔**(2026-10-16) | `decisions.md` E1 |
| 질문 6-2 합산 부하(목록 + resolve 30건 + ④ 채팅; ⑤(나) 상태 조회가 생기면 그것도) | [실측 필요] | ③(나)·④ 중 늦게 머지되는 쪽 전 |
| `backup_enqueue`·`backup_exclude`가 `ContentRefTs::Live`를 `invalidInput`으로 거부, 원장 관찰자는 `Live` 작업을 쓰지 않음, `recent_kind` `Option` | 3차에서 설계에 반영됨(`services.rs:594-598`·`manager.rs:1109-1153` [확인: 문서]) | ③-3·③-4 테스트 |
| `backup.error.rateLimited` 분리 · 시작 지연 10분 묶음 · 크기 어림 골든 위치 · Linux `statvfs`/Windows `GetDiskFreeSpaceExW` 의존성 | 구현 판단 | ③-6·③-7·③-3 |
| B1~B3는 확정 | — | ③-6 |

### ④ 채팅 함께 받기(`chat.md` 4차)
| 남은 것 | 종류 | 처리 자리 |
|---|---|---|
| 실측 M-④-1~9(도구 ④-1, `--write-ass`·`--write-srt` 포함). M-④-1 "안 된다"면 ④ 가치를 ROADMAP에서 재판단 | [실측 필요] | ④-1 |
| **U2 자막 기본 형식**: 실측 M-④-8·9 뒤 사용자가 정한다. **U2 전에는 ④-5를 머지하지 않는다**(`chat.md` §12) | 사용자 결정(확정된 절차) | `decisions.md` U2 |
| mpv·VLC가 빠른 다시보기 mp4(조각 구조 그대로, 변환은 생방송에만 `download/mod.rs:6`·`:372` [확인: 문서]. core.md 71부터는 전체 받기도 일반 mp4다)의 길이·탐색을 바르게 다루는가 | [실측 필요] | M-④-8과 함께 |
| 생방송 카드 안내(`card.live.body`)에 "채팅은 다시보기가 생기면" 한 줄을 더할지(R12, ADR-0025 영역) | [가정] | ⑤-F6 docs 때 F가 판단 |
| `conflict_names` 순서·"형식 바꾸기"가 카드에서 튀지 않는지·`dialog.removeChat` 문구·채팅 수치 ADR·`examples/` 번들 제외(B22) | [가정]·리뷰 | ④-5 `design-shots`·R1, ④-1 |
| ④-1 얇은 루프와 ④-3a `collect_chat`이 같은 `walk::next_step`을 쓴다 | [가정] | ④-3a 리뷰 |

### ⑤ 생방송 녹화(배포됨, `live-audit.md`)
| 남은 것 | 종류 | 처리 자리 |
|---|---|---|
| **L2·L4 확정과 배포 동작이 달랐다**(관리자 예외 있음 `ownership.rs:108-113` [확인]; 진입점은 `/live/` 주소 붙여넣기 `app.md:1386` 77 [확인]) | **확정 L6 (가)**: 배포 동작을 받아들인다(2026-10-16). 옛 L2·L4는 뒤집힘 | `decisions.md` L6 |
| (7-a) 세그먼트 403 뒤 `refresh`(`live.rs:360` [확인])만 `until_stop!` 밖 → [녹화 마치기]·앱 닫기가 최대 30분 듣지 않음. **같은 약점이 둘 더 있다(Codex 3회차 M2)**: 정상 폴링의 다음 playlist 읽기(`live.rs:380`)와 엔진 진입 전 첫 resolve(`mod.rs:214`·`:325`)도 `cancel`만 보는 공통 도우미(`segmented.rs:370`)를 거쳐 `live_stop`을 기다리지 않는다 | **문제 있음** | ⑤-F1 |
| (1)·(7-b) `failed`·`skipped`로 끝난 녹화 `.part`를 같은 이름의 VOD·같은 방송 재녹화가 지운다(`part.rs:200-207` [확인] sidecar 불일치 삭제, `is_active`에 `Failed`·`Skipped` 없음 `dto.rs:644-652` [확인]). **삭제 진입점은 `resume` 한 곳이 아니다**: 작업 삭제(`manager.rs:707`·`:748`)와 "처음부터"(`manager.rs:1200`)도 sidecar 소유권을 안 보고 `discard_partial`(`part.rs:473`)을 부른다(Codex 3회차 M1). 카드 문구 "다른 화질로…"가 거짓 · "처음부터"에 D7 없음 · `same_job`이 `live_id`를 안 봄 | **문제 있음** | ⑤-F2(최소 조치: 모든 삭제 진입점 소유권 검사 + 계약 구분) · 별도 임시 파일 체계 `.rec.part`는 후속(L7) |
| (3)(a)·(7-e) msn 역행 3회 재시작이면 "완료"로 끝나고 이유가 안 보인다(방송은 계속) | **문제 있음**(① "숨겨지면 안 된다") | ⑤-F3 |
| (2) EFBIG·Windows 223 매핑 없음(`io`로 뭉뚱그림), 쓰기 실패 주입 테스트 없음. 반쪽 fragment가 남는 경로는 **없다** | 의도와 다름 | ⑤-F4 |
| 자동 이어받기 필터 `partial_bytes > 0`(`manager.rs:617`)이 **init만 남은 `.part`**도 통과시킨다 → 앱을 다시 켰을 때 같은 채널의 **다른 방송**을 옛 작업 이름으로 새로 녹화한다(코어는 `written <= init_len`이면 지우고 resolve, `mod.rs:316`; Codex 3회차 M3) | **문제 있음**(보호 목적의 예외) | ⑤-F2 ⑥ |
| defrag의 "실패해도 원래 길이로 복원" 보장이 모든 I/O 실패에 성립하지 않는다: 복원은 moov 덧붙이기 실패에만 있고 그 복원 실패도 무시하며, 종류 패치 단계 실패에는 복원이 없다. 호출자는 그 오류도 경고만 남기고 최종 파일로 옮긴다(`defrag.rs:90-101`, `mod.rs:386`; Codex 3회차 M4). 실제 재생 불능 여부는 **불명** | 문서가 보장을 과장 | ⑤-F4 ⑤ · ②·R5도 같은 계약 |
| (5) 생방송 전용 누출 테스트 없음(새는 경로는 못 찾음) · (6) LL 태그 `warn!`이 폴링마다 찍힐 수 있음 | [잠정]·[실측 필요] | ⑤-F5 |
| (4) 첫 목록 전체(약 40초 앞)를 받는다 — 문구는 약속하지 않음 | 의도와 다름, 해 작음 | ⑤-F6 core.md 61에 적음 |
| (3)(b)(c)·(7-c)·(7-d)·4 GiB 근처 마무리 | [실측 필요] | `decisions.md` M-⑤-A~D |
| 방송 상태 감시·자동 녹화(옛 O-3)·맡은 채널(L-D1)·녹화 중 허가 제외(O-4) | 후속 ⑤(나) | ③(나) 뒤 별도 설계 |

### 설계 사이 접점(의미)
| 접점 | 결정 | 근거 |
|---|---|---|
| ② 구간 × ④ 채팅 | 둘 다 있으면 `range.is_some()`이면 카드 채팅 행을 **숨긴다**. **뒤에 머지되는 쪽이 건다**(먼저 머지되는 쪽은 상대를 모른다) | `patterns.md:390`, `chat.md` §12.1 |
| ② 구간 × ⑤ 생방송 | 생방송에 구간을 주면 거부(셸 `invalidInput`, 코어 `RangeNotHls`를 `Chzzk::download` 맨 처음·`resume` 앞에서). 카드는 `tone === 'rewind'`만 줄을 그린다 | `range.md` §3.6 3차, `mod.rs:274-280` [확인: 문서] |
| ④ 채팅 × ⑤ 생방송 | 생방송 작업은 `chat = None` 고정 + `enqueue`의 `save_chat: true` 거부(클립·생방송). 녹화본 채팅은 다시보기 카드에서 | `chat.md` §4.4·§4.6 3차 |
| ③ 목록·원장 × ⑤ 생방송 | ③은 `Live`를 목록에 만들지 않고 원장에 쓰지 않으며 command는 거부한다. 생방송은 별도 lane이라 모아 받기 30건과 슬롯을 다투지 않는다(`manager.rs:976-983` [확인: 문서]) | `backup.md` 3차 "생방송 서술" 표 |
| ① 맡은 채널 × ③ 목록 × ⑤ 녹화 | v1 본인만. ①-4 뒤 ③-8 "대상 고르기". 생방송은 ①-4가 명시적으로 닫고 L-D1이 연다 | `backup.md` §4.7, `delegation.md` §9.1 |
| ② 구간 × ③ 모아 받기 | 모아 받기는 구간 없음(전체만). 충돌 없음 | `backup.md` §4.2 [가정] |
| ②+④ 카드 높이(720×520) | 예산 506(`patterns.md:830` [확인])이라 한 줄만 더해도 넘친다. **뒤에 머지되는 쪽의 `design-shots`에서 잰다**: ④가 뒤면 두 행 합산, ④가 먼저거나 ② deferred면 채팅 행 단독 | C7 확정, `chat.md` §12.1 |
| ③ 자동 받기 × ⑤(나) 자동 녹화 × app.md §0 "재시작 후 자동 재개 안 함" | 둘 다 기본 꺼짐 옵션. ⑤(나)는 ③(나) 뒤 | `settings.rs:128` [확인: 문서] |
| ① 관리자 꼬리표 × ③ "관리자도 남의 목록 범위 밖" × ⑤ 관리자 예외 **있음**(배포) | 충돌 없음. `AdminOverride`는 주소 붙여넣기 판정(VOD·생방송)에만, 목록에는 없다 | `worker.md` 102, `ownership.rs:108-113` [확인], L6 |
| 같은 비공식 호스트(③ 목록·④ 채팅·⑤(나) 상태·기존 info·live-detail) | v1 각자 상수(C5 확정). 합산은 질문 6-2 | 2차 §0-4 |

---

## 3. 코드 접점(같은 파일·타입을 여럿이 바꾼다)

| 접점 | 바꾸는 PR | 규칙 |
|---|---|---|
| `EnqueueRequest`·`JobDto`·`check_output` 인자(`dto.rs:583`·`:659`, `manager.rs:425`, `app.rs:223`, `commands.rs`, `api.ts`) + bindings + `app/e2e/mock/backend.ts` + `tests/common/fake.rs` | ②-2(`range`) · ④-4(`save_chat`·`chat`·`conflict_names`) · ⑤-F2(`OutputCheck.partialRecording`) · ⑤-F3(`JobDto` 끝난 이유) | **더하기만**. 둘 다 진행하면 ②-2 → ④-4 순(§5 B표). 뒤에 머지되는 쪽이 rebase 뒤 `UPDATE_BINDINGS=1` 재생성. ③-4는 새 타입만이라 병렬 |
| `crates/core/src/download/part.rs` `Sidecar::same_job`·`PartFile::resume`·`discard_partial` | ②-1(`range` 비교 + `resume` 인자) · ⑤-F2(소유권 검사 + `live_id` 기록·비교 + 남의 `Live` sidecar는 지우지 않고 오류) | **같은 함수 둘**. **⑤-F2 → ②-1은 기능 선행 조건**(§5-A)이다: ⑤-F2가 소유권·`live_id` 계약을 정한 위에서 ②-1이 `range` 비교를 얹는다. 둘 다 "생방송 `.part`가 살아남는다" 단언을 둔다 |
| `crates/shell/src/manager.rs` 삭제 진입점(`remove`·`discard_on_start`·`discard_partial` 호출)·자동 이어받기 필터(`:610`~`:621`) | ⑤-F2(소유권 검사, 마무리할 조각이 있는 `.part`만 자동 재개) · ①-4(L-D1 (A): 필터에 **컨텐츠 종류**도 넘겨 맡은 채널 생방송을 뺀다. 지금 필터는 채널 ID만 받는다) | 같은 필터를 둘이 고친다. 머지 순서: ⑤-F2 먼저 |
| `crates/core/src/download/mod.rs` `finish`의 defrag 호출·실패 정책 | ⑤-F4(변경 도중 I/O 실패는 `.part` 보존) · ②-1(`range.is_some()` 조건) · R5(관찰 뒤 확대, 적용됨: `converts_on_finish`, core.md 71) | 같은 호출부. 계약은 ⑤-F4가 정한다. ⑤-F4가 늦으면 ②-1은 현재 정책(경고만)으로 가고 F4가 구간 결과에도 적용된다(§5-B) |
| `crates/shell/src/output.rs` `check_output`·`PartialInfo` · `ConflictNotice.svelte`·`ko.ts` `conflict.*` | ②-2(`range` 비교·`partialOther` 뜻) · ②-3(R4 문구) · ⑤-F2(`partialRecording` 안내, 번호 이름 기본, "처음부터" D7) · ④-4(채팅 충돌) | 더하기만. R4 새 문구("조건이 다른 받다 만 파일…")와 ⑤-F2 녹화 문구는 **다른 키**(녹화는 다시 받을 수 없어 중립 문구를 쓰면 안 된다, `live-audit.md` (1)-4) |
| `crates/shell/src/ownership.rs` `verdict`·`on_resolved`·`admit` | ①-4(`Delegated` + `ContentRef::Live` 예외 세 곳) | ③·④는 호출만. L6은 (가)로 확정돼(배포 동작 유지) 이 파일에서 ⑤ fix가 할 일이 없다 |
| `ErrorKind`/`ErrorCode` 1:1 표(`crates/shell/src/error.rs:34`)·`errors.ts` 전수 매핑·`content.md` §15.2·가짜 백엔드 | ②-1(`rangeOutOfBounds`) · ⑤-F2(`partialRecording`) · ⑤-F4(`fileTooLarge` [가정]) · ①-5(`ErrorContext.delegatedLive`) | 직렬(머지 순). 각 PR이 `frontend` gate를 지난다 |
| `DownloadOutcome::Completed`(`download/mod.rs:82-89`)·`JobDto`·행 문구 | ⑤-F3(끝난 이유 `ended`/`restarted`/`stopped`/`notLive`) · ④-4(`JobEvent::Chat`) | ⑤-F3은 `JobEvent` 변형을 더하지 않는다(`JobDto` 필드만). ④-4는 변형을 더해 `jobs.apply.ts:88` `never` 검사가 깨지므로 `frontend` gate 완료 조건 |
| `crates/core/src/download/live.rs`·`mod.rs` 첫 resolve | ⑤-F1(`:360`·`:380` `until_stop!`, 첫 resolve 멈춤) · ⑤-F3(역행 종료 이유) · ⑤-F5(LL 태그 경고) · ⑤-F6(첫 목록 주석) | 한 트랙 안 stacked |
| `crates/core/src/fsutil.rs` `map_io_error` | ⑤-F4(EFBIG 27·Windows 223) · ③-3(`volume::available_bytes`는 다른 모듈) | 충돌 없음 |
| `UserSettings`·`SettingsDto`·`SettingsPatch` | ③-4(`backup_*` 4키) · ④-4(`save_chat`·`chat_subtitle`) | 더하기만. 스키마 버전 2 유지 |
| `Features` DTO(`dto.rs:257-260` 지금 `auth` 하나 [확인]) | ③-4(`backup`) | 더하기만. 가짜 백엔드 리터럴이 깨지므로 `frontend` gate. ⑤는 플래그가 없다(배포됨) |
| `ResolveCard.svelte` | ②-3(Disclosure 행) · ④-5(채팅 행 + "형식 바꾸기") · ⑤-F2(생방송 `.part` 안내) | 뒤에 머지되는 쪽이 720×520 합산 측정 |
| 홈 열(patterns §14·§15) | ③-6("내 채널" 섹션) · ③-7 배너 B6 | ⑤(나) 「내 방송」 조건부 섹션은 후속 |
| `DownloadManager` `finish`·`clearable()`·`subscribe` | ③-3(`TerminalObserver`, `Live` 제외) · ④-4(`ChatQueue::push`, `clearable()` 채팅 조건) · ⑤-F3(끝 이유 전달) | 셋 다 `finish` 끝 상태 분기. 뒤에 머지되는 쪽이 앞의 훅 옆에 둔다. 관찰자는 잠금 안에서 채널에 넣기만 |
| `segmented.rs`·`hls.rs` | ②-1(`select_range`·`HlsState.range`, `run` 안에서만) | 생방송은 `parse_live_media`·`download/live.rs` 별도라 겹치지 않는다(`segmented.rs:37`·`:279-286` [확인: 문서]) |
| `naming.rs` | ②-2(`range_suffix` + 제목 쪽 자르기 helper) · ④-1(`sibling_path`, N5로 ④-2에서 옮김) | 순수 함수. 생방송 이름 `[생방송 YYMMDD-HHMM]`은 배포됨 |
| `fuzz/`(`scripts/ci/fuzz.mjs:28` 4 target [확인]) | 없음 | ②-4 삭제, ⑤ 배포 때 target 수 그대로. `fuzz-lock` gate만 |
| `consts.rs` + foundations §14(DT15) + ADR-0009 | ①-4 · ②-3 · ③-4 · ④(코어 `chat/mod.rs`) | ⑤ fix는 새 상수 없음(`BACK_CONFIRM`·`MAX_FLAKY`는 배포됨) |
| `scripts/ci/e2e-fixture-server.mjs` | ①-4 · ④-5 | 더하기만 |
| `command_names.rs`·`commands.rs`·`generate_handler!`·`capabilities/default.json`·`tests/ipc.rs`; `gate.rs`는 기본 거부라 고치지 않음 | ①-4(5) · ③-4(7) · ④-4(3) | 더하기만. ⑤ fix는 command를 더하지 않는다([다시 녹화]는 기존 enqueue 재사용 [가정]) |
| `AuthService`(`auth/service.rs`) | ①-4(`me` + `refresh_lock`·세대·깃발 둘) | ⑤가 `session_epoch`를 쓰지 않게 됐으므로(배포 설계에 `LiveWatch` 없음) ①-4 혼자 |
| `tests/secrets.rs` | ⑤-F5(생방송 fixture 경로) · ④-2/④-3(채팅 R4 누출 테스트) | 더하기만 |

---

## 4. PR 표(트랙별 stacked, 기능별 브랜치)

표기: `[P]` 다른 트랙과 병렬 / `→` 앞 PR 머지 뒤 / `⏸` 사용자 실측·결정 대기 / 모델 **S** sonnet(명세 확실·기계적) · **O** opus(추론·설계 세부·1차 리뷰) · **F** fable(중요 판단·UX·적대적 리뷰). 모든 PR은 "구현 → 리뷰 → 수정" 틀이다. 리뷰는 **중요한 PR만 Codex**로 한다(설계 단계에서 Codex 3회를 이미 거쳤다, 2026-10-16 사용자 결정. 중요한 PR = 사용자 데이터 삭제·보호 계약 ⑤-F2, 인증·권한·Worker 저장소 ①-2·①-3·①-4, 릴리스 직전 통합 [가정: PR마다 메인 루프가 정한다]). 나머지는 O 일반 리뷰와 CI gate로 갈음하고, Codex를 못 쓸 때의 대체는 O 일반 + F 적대 서브에이전트다. 모든 PR은 worktree로 분리한다. 커밋 타입은 각 설계 문서의 PR 표를 따른다(사용자에게 보이는 PR만 `feat`).

### 트랙 ⑤ 생방송 녹화 — 배포됨(v0.7.0) + 사후 점검 fix(`live-audit.md` 고칠 순서)
| 브랜치 | PR | 모델 | 의존 | 완료 조건 |
|---|---|---|---|---|
| ✔ | 사용자 결정 **L6**(배포 동작 수용)·**L7**(최소 조치, 범위 확대)·**L8**(끝난 이유 표시) | — | — | 2026-10-16 확정, `decisions.md` 맨 위 표 |
| `fix/live-stop-refresh` `[P]` | ⑤-F1 `fix:` **멈춤 계약 완성**(Codex 3회차 M2): ① `live.rs:360`의 `refresh`를 `until_stop!`으로 감싸고 `None => break` ② 정상 폴링의 다음 playlist 읽기(`live.rs:380`)와 엔진에 들어가기 전 첫 resolve(`mod.rs:214`·`:325`)도 `live_stop`을 기다린다(공통 도우미 `segmented.rs:370`은 `cancel`만 본다). 계약: 받은 조각이 있으면 마무리해 `Completed`, 없으면 `NothingRecorded`. 테스트 셋(각각 빨강 먼저): "세그먼트 403 → master 연결 실패 중 멈춤 → `Completed`" · "조각 하나 수신 → 다음 playlist 응답 지연 중 멈춤 → `Completed`" · "첫 resolve 지연 중 멈춤(받은 조각 없음) → `NothingRecorded`" | O(세 곳·계약 둘; 한 줄 수정이 아니다) | 없음 | `rust`, 기존 `stop_while_waiting_out_a_segment_outage_finalizes` 유지 |
| `fix/live-part-protect` | ⑤-F2 `fix:` **녹화 `.part` 보호**(L7 (가), Codex 3회차 M1·M3·M5). ① **모든 삭제 진입점이 sidecar 소유권을 먼저 본다**: `PartFile::resume`의 불일치 삭제 · `DownloadManager`의 작업 삭제(`remove`: 활성 작업만 보호하는 `active_with_output` 뒤에 `discard_partial`, `manager.rs:707`·`:748`) · `discard_partial` 자체(`part.rs:473`) · 코어 진입 전에 부르는 "처음부터"(`discard_on_start`, `manager.rs:1200`). 남의 `kind = Live` sidecar가 붙은 `.part`는 지우지 않고 새 오류(`partialRecording`)를 낸다 ② **계약 둘을 가른다**: "기존 녹화 저장"(목록의 [이어받기]·재개: sidecar가 주인이므로 새 요청의 방송 ID를 비교하지 않고 받은 만큼 마무리) / "새 녹화 시작"(카드 [받기]: 같은 경로에 같은 채널의 녹화 `.part`가 있으면 옛 파일을 완료로 처리하지도 지우지도 않고 번호 이름으로 새 경로를 쓴다). 방송 ID(`Source::Live`의 `live_id`는 resolve 결과에만 있고 `DownloadRequest`에는 없다)는 새 녹화가 시작될 때 sidecar에 `Option`으로 기록한다 ③ **v0.7.0 호환**: `live_id`가 없는 기존 sidecar는 그대로 읽히고 비교 결과는 "모름"이라 "같은 방송"으로 단정하지 않는다. sidecar 버전은 올리지 않는다(`#[serde(default)]` 추가 필드 [가정], 구현이 확인) ④ `check_output`이 녹화 `.part`를 따로 알림(`OutputCheck.partialRecording`) ⑤ 카드: `.part`가 있으면 번호 이름 기본(`free_name`이 `.part`도 피함 `output.rs:84` [확인: 문서]) + 옛 `.part`는 "목록에서 [이어받기]로 저장" 안내, "처음부터"는 생방송에서 숨기거나 D7 확인 ⑥ **자동 이어받기는 마무리할 미디어 조각이 실제로 있는 `.part`만**(init만 남은 것·sidecar 없는 것은 제외, `partial_bytes > 0` 필터 `manager.rs:617` 교체) ⑦ `ErrorCode`·`errors.ts`·`content.md` §15.2·bindings·가짜 백엔드 ⑧ 테스트(각각 빨강 먼저): 실패한 VOD 기록 B를 남기고 같은 출력 경로로 녹화 A를 시작·실패시킨 뒤 **B를 목록에서 삭제해도 A의 `.part` 생존** · "처음부터" 경로 · `resume`에서 보호 오류가 난 VOD 작업을 삭제해도 녹화 보존 · 같은 최종 이름을 직접 지정한 VOD + `failed` 녹화 → 생존 · 새 녹화 시작이 옛 파일을 완료로 처리하지 않음 · `live_id` 없는 v0.7.0 sidecar 읽기 · init만 남은 `.part`와 sidecar 없는 `.part`는 자동 재개 안 함. **"N4 완전 해결"이라 부르지 않는다**(`.rec.part`는 후속) | O 구현(코어·셸·앱 세 층, 삭제 진입점 전수), **F 리뷰**(문구가 "다시 받을 수 없다"를 숨기지 않는지, ① 기준) | L7 확정 | `rust`·`tauri`·`frontend`·`design-copy`·`e2e-web`. **②-1·①-4보다 먼저 머지**(§3, §5-A) |
| `feat/live-end-reason` | ⑤-F3 `feat:` `DownloadOutcome::Completed`에 끝난 이유(`ended`/`restarted`/`stopped`/`notLive`) → `JobDto` → 행 문구. 재시작으로 끝났고 방송이 아직 중이면 "방송이 다시 시작되어 녹화를 마쳤어요 · [다시 녹화]"(초안). 끝난 이유와 구멍 수를 `JobDto`뿐 아니라 저장 기록(`jobs.json`의 `JobRecord`)에도 남겨 앱을 다시 켠 뒤에도 보인다((7-e), L8 · Codex 3회차; 필드는 `#[serde(default)]`로 옛 `jobs.json` 호환 [가정]). 세 번 연속 역행 → 종료 테스트 추가 | O 구현, **F 리뷰**(문구·버튼이 ADR-0025 용어 안인지, [다시 녹화]가 새 동사인지 → 새 ADR 0027+ [가정]) | L8 확정 · ⑤-F2 | `rust`·`tauri`·`frontend`·`design-copy`·`design-shots`. bindings 재생성 |
| `fix/live-efbig` `[P]` | ⑤-F4 `fix:` `map_io_error`에 EFBIG(Unix 27)·`ERROR_FILE_TOO_LARGE`(223) 갈래(값은 `libc` 상수·Microsoft System Error Codes 문서로 확인, 지금은 [가정]) + 사용자에게 보이는 코드 + 쓰기 실패 주입 seam + "부분 쓰기 → 다음 실행 마무리가 마지막 온전한 조각에서 끝남" 테스트 + **defrag 실패 계약**(Codex 3회차 M4): 변경 전 검증 실패(원본 그대로, 경고)와 변경 도중 I/O 실패(moov 덧붙이기 절단 실패·종류 패치 도중 실패)를 구분하고, 후자는 복구·검증이 성공하기 전까지 `.part`로 보존해 최종 파일로 옮기지 않는다. 주입 테스트로 두 갈래를 각각 고정. ②·R5가 같은 계약을 쓴다 | O(주입 seam 자리) → 구현 S | 없음 | `rust`(3 OS CI), `frontend`(`errors.ts`) |
| `test/live-secrets` `[P]` | ⑤-F5 `test:`+`fix:` `tests/secrets.rs`에 생방송 fixture(`testdata/live/live_detail.json`) resolve → 녹화 → 오류 경로 로그·`AppError`에 `hdnts`·`hdntl=`·`hmac` 없음 · LL 태그(`PART`·`PRELOAD-HINT`·`SERVER-CONTROL`)는 생방송 파서에서 조용히 무시하거나 녹화당 한 번만 경고 | S | 없음 | `rust`·`scan` |
| `docs/live-audit-done` | ⑤-F6 `docs:` core.md 61("첫 목록 전체를 받는다(약 40초 앞)", sidecar `live_id`·소유권 검사, 끝난 이유, defrag 실패 계약)·app.md 78·ROADMAP(알려진 한계 갱신)·`/help` "누르기 조금 전부터 들어가요" 한 줄(선택) | S | ⑤-F1~F5 | `scan`·`worker`(help 생성물) |
| ⏸ | 실측 M-⑤-A(재조회 뒤 msn 이어짐)·B(일시 404 빈도)·C(구멍 뒤 싱크)·D(4 GiB 근처 마무리) | 사람(본인 방송 중) | ⑤-F3 뒤가 좋다(끝난 이유가 보여야 A 판정이 쉽다) | 결과 범주만 ROADMAP. A "안 이어짐"이면 재조회를 새 세대로(옛 설계 §3.4-1) 별도 fix |
| — | ⑤(나) 후속: 방송 상태 감시(`LiveWatch`)·홈 「내 방송」 한 줄·자동 녹화(O-3)·맡은 채널(L-D1)·녹화 중 허가 제외(O-4) | 별도 설계 | ③(나) 뒤 | 이 계획 밖 |

### 트랙 ① 편집자 위임(Worker → 셸 → 앱, `delegation.md` §17 3차)
| 브랜치 | PR | 모델 | 의존 | 완료 조건 |
|---|---|---|---|---|
| `docs/delegation-design` | ①-1 `docs:` worker.md 105·app.md 78·content 용어집(행 추가 + "되돌리기" 자리)·patterns §1.2·§4·§14.4·web.md 표기 정정·foundations §14 상수·**ADR-0026** + ADR-0009 행·governance UT8·UT9(문구 [다시 불러오기])·ROADMAP 행(취소선 + 날짜)·runbook 롤백 범위 "V3 직전까지"·content §15.2 `notOwnContent`(맡은 채널 생방송) 행 | 구현 O, 리뷰 **F**(뒤집는 결정 문장·고지 DC6·용어) | D1~D8 확정 + L-D1 확정 (A) | `design-copy` 패리티·`adr.test`·`spec-check` |
| `feat/delegation-worker-store` | ①-2 `feat:` DO V3(`delegation`·`invite` 표 + `flow.invite_hash`, 허가 시각 열, `invite.owner_allowed_at`)·`inviteValid` 판정식 한 곳·RPC·`token.ts` `invite` 접두·`/api/me`·묶음 `delegatedChannels`·sweep | O(트랜잭션·`inviteValid`·V2 롤백 호환) | ①-1 | store 단위 + **V2 SQL 직접 실행 롤백 호환(보통 행·대안 B 행) + N3 다섯 테스트(미청구·청구·청구 전·음성 대조·재SELECT 금지)** + 묶음·`/api/me` 모양 + RPC 수 표. 이 PR만 배포돼도 옛 앱 무영향 |
| `feat/delegation-worker-web` | ①-3 `feat:` 경로 10행·`seeOther` 세 곳·`FlashKind` 여섯·콜백 분기·관리 꼬리표·`copy.ts`·`/privacy`·help `editors`·worker-e2e(a1·b2·c3)·design-worker 기준선 | O 구현, **F 리뷰**(로그인 = 수락의 놀람·초대 페이지 요소 수, ① 기준) | ①-2 | 행렬(자격 8종)·상태표 h1·quiet·GET 불변·멱등·R8 기록 |
| `chore/bump-0.x` | ①-3½ `chore: 버전 올림` | S | ①-3 | `versions` gate. **C2 (가)일 때만**. 번호는 `next-version`(지금 0.7.0이면 0.8.0) |
| — | **릴리스 A(Worker 전용)** ①-2·①-3·①-3½ | F go/no-go | 운영 배포 승인(사용자), DO V3 마이그레이션 | §6 |
| `feat/delegation-shell` | ①-4 `feat:` `Signer.delegated`·`Ownership::Delegated`·`verdict_in(…, content)`에 **`ContentRef::Live` 예외 세 곳**·`WorkerApi` 4(`me`·쓰기 3, 같은 오류 분류·잠금·`invalid_token` 뒤 1회 재시도)·`me_outcome`(not_allowed·session_revoked → 기존 전이, invalid_token → refresh)·`me`의 `refresh_lock`·`last_me_at`·깃발 둘(자동 이어받기에서 Live 제외: 필터가 채널 ID만 받으므로 **컨텐츠 종류도 넘긴다**, `manager.rs:610`)·command 5·`consts`·bindings·가짜 API·네이티브 픽스처 | O(판정 표·single-flight·세대·잠금) | ①-2(①-3 없이도 가능) · L6 확정됨(가)(같은 `ownership.rs`: 배포 동작이 그대로라 선행 PR 없음) · ⑤-F2 머지(같은 자동 이어받기 필터) | `rust`·`tauri`, 셸 테스트 §14: 세대 "먼저 쓴다"·N1 전이 (가)(나)(다)·**N2 가짜 서버 시간선(메모리·`session.json` 둘 다 회수 유지, 잠금을 빼면 실패)**·생방송 예외 세 곳·시작 이어받기 지연 |
| `feat/delegation-app` | ①-5 `feat:` 설정 편집자·맡은 채널 행(지연 회수 토스트)·`OwnershipNotice` 수정(행·caption·**[다시 불러오기]** 늘 동작, `ActionId recheck`)·맡은 채널 생방송 갈래(`ErrorContext.delegatedLive`, [닫기]만)·메타 조각·`cleanDisplayText`+`<bdi>`·`errors.ts`·`ko.ts`·help·e2e mock·spec·갤러리 | O 구현, **F 리뷰**(UX 기준 ① 최종, UT8·UT9 대본) | ①-4 | `frontend`·`e2e-web`·`design-*`, R1 네 장 |
| `docs/delegation-done` | ①-6 `docs:` ROADMAP + (분할이면) 버전 올림 | S | ①-5 | **릴리스 B(앱)** |

### 트랙 ② 구간만 받기(`range.md` §11 4차)
| 브랜치 | PR | 모델 | 의존 | 완료 조건 |
|---|---|---|---|---|
| `chore/range-check` `[P]` | ②-0 `chore:` `examples/range_check.rs`(오프라인 판정 하나: 조각 첫 샘플이 동기 샘플인가, M-②-3) + 판정 lib 단위 테스트 + non-sync 음성 fixture | S | 없음 | `rust`·`scan`·fixtures `--check` |
| ⏸ | 사용자 실측 M-②-3 | 사람 | ②-0 | "안 된다"면 ② deferred |
| `feat/range-core` `[P]` | ②-1 `feat:` `TimeRange`(end `Option`)·`hls::select_range`·`HlsState.range`/`HlsRange`·sidecar v1/v2·`same_job` 셋(+ `resume` 인자)·segmented §3.4 표·`finish` defrag 조건 `range.is_some()`·`Unsupported::RangeNotHls`(`Chzzk::download` 맨 처음)·`rangeOutOfBounds`(23번째)·`DownloadRequest` 리터럴 `range: None` 목록(테스트 셋 + `dl.rs:229` 포함)·fixture·`assert_flat_mp4` 이동·wiremock·**생방송 sidecar 호환 단위 테스트**·`examples/dl.rs --range`(M-②-2·6용, 보조 "EXTINF 누적 = info 길이") | O(엔진 8곳·재개 불변식) | R1 확정. **⑤-F2 뒤**(§3 `same_job`). 실측 전에도 진행 가능 | `rust`·`coverage` |
| ⏸ | 사용자 실측 M-②-2(세 시각)·M-②-6(재생 + 전체 받기 관찰 + 마무리 시간·메모리) | 사람 | ②-1 `dl --range` | 2·6 둘 다 통과해야 ②-3. **2026-10-18 구간 파일 판정 통과**(macOS QuickTime. 전체 받기·마무리 시간·메모리·Windows 미디어 플레이어 관찰은 남음) |
| `feat/range-shell` | ②-2 `feat:` DTO `range`·`check_output` 인자·`JobRecord.range`·`partial_bytes` 비교·재검증 둘(생방송 포함)·`range_suffix` + 제목 쪽 자르기·`truncated` 뜻·`error_map.rs`·bindings·가짜 Backend | S(명세 확정) | ②-1 | `rust`·`tauri`, "접미사 한 번" 테스트 |
| ~~②-4~~ | **없앴다**(range.md 3차). defrag가 그 일을 한다 | — | — | — |
| `feat/range-app` | ②-3 `feat:` 카드 Disclosure·`parseClock` 골든·`checkKey`·`effectiveRange`·조용한 미리보기·1줄 조각·copy(`conflict.partialOther` R4)·`errors.ts`·`content.md` §6.5 기호 행·§15·`patterns.md:398`·`:399`·`:713`·e2e·갤러리·(④-5가 먼저 머지돼 있으면) 구간 켜짐 → 채팅 행 숨김 | S(와이어·copy 확정) · 리뷰 F(줄 하나가 튀지 않는지) | ②-2 · R2~R4 확정 · **M-②-2 셋 "일치" · M-②-6 "된다"** | `frontend`·`e2e-web`·`design-copy`·`design-shots` |
| `docs/range-done` | ②-5 `docs:` core.md 61+·app.md 78+·ROADMAP·`/help`(선택). **끝**(2026-10-18, 따로 브랜치를 두지 않고 v0.10.0 버전 PR `release/v0.10.0`에 넣었다. core.md 64.8·app.md 89, `/help`는 더하지 않음) | S | ②-3 | `scan` |

### 트랙 ④ 채팅 함께 받기(`chat.md` §12 4차) — **보류(2026-10-18)**: ④-1~④-4는 머지돼 코드를 유지하고, ④-3b·④-5·④-6·U2·M-④는 하지 않는다
| 브랜치 | PR | 모델 | 의존 | 완료 조건 |
|---|---|---|---|---|
| `chore/chat-probe` `[P]` | ④-1 `chore:` 채팅 fixture 생성기·`chat::page`·`walk`·`retry`(400은 오류, 음성 테스트)·공개 seam `fetch_chat_page`·채팅 `RetryPolicy`·`chat::probe`·**`chat::subtitle`(`render_ass`·`render_srt` + 골든)·`naming::sibling_path`**(N5)·`examples/vod_chat_check.rs`(**`--write-ass`·`--write-srt`**, 둘을 한 번에 쓰지 않고 기존 파일을 덮지 않음) | O(serde 이름·fixture 설계) → 구현 S | 없음 | `rust`·`scan`·`--check`, `examples/` 번들 제외 확인(B22) |
| ⏸ | 사용자 실측 M-④-1~9 | 사람 | ④-1 | §11 표로 확정. **U2 결정 입력** |
| `refactor/chat-core-part` `[P]` | ④-2 `refactor:` `chat::part`(`DuplicatePolicy` 마무리·경쟁 테스트)만 | S | 없음(④-1 머지 전에도 가능) | `rust` |
| `feat/chat-collect-core` | ④-3a `refactor:` `Chzzk::collect_chat`(④-1의 fetch·walk·subtitle + ④-2의 part)·`ChatRequest`·`ChatOutcome`·`ChatProgress`·wiremock 통합 테스트(400 음성 (가)(나)(다)·429 경계·취소·재개·경쟁). **실측 Q3·Q8에 기대는 것은 넣지 않는다**(사용자 승인 2026-10-17: ④-3을 실측 없는 부분 먼저로 나눈다) | O | ④-1·④-2(실측 불필요) | `rust`·`coverage` |
| `refactor/chat-core-measured` | ④-3b `refactor:` 실측 뒤 얇게: (Q3 "있다"면) `VideoContent.chat_enabled`·`ContentMeta.chat`(리터럴 셋·셸 DTO 미러 갱신), (Q8 A면) `ChatEnd::PastEnd` 양성 테스트(④-3a의 조건 밖 400 음성 테스트는 그대로). Q3·Q8이 B면 문서만 고친다(사용자 승인 2026-10-17) | O | ④-3a · 실측 M-④-3·M-④-4 | `rust` |
| `refactor/chat-shell` | ④-4 `refactor:` `ChatQueue`·`ChatState`·`JobEvent::Chat`·`on_auth_status` 채팅 이어받기·`clearable()`·`check_output` 충돌·`conflict_names`·생방송·클립 `save_chat` 거부·command 3·설정 두 키·DTO + bindings·가짜 Backend + **프런트 `jobs.apply.ts` `Chat` 분기·vitest·가짜 백엔드 타입** | O(생명주기 표 13행·정리 규칙) | ④-3 · (②-2가 머지돼 있으면 그 뒤, 아니면 **기다리지 않는다**) | `rust`·`tauri`·`tauri-clippy`·**`frontend`** |
| `feat/chat-app` | ④-5 `feat:` 카드 채팅 행 + "형식 바꾸기"·행 조각·[⋯] 항목·D7 변형·D2 변형·`isClearable`·`removeRoute`·접힘 규칙·설정 두 행·copy·content §4·§5.3·§15.1·`terms.json` `opensWindow`·patterns 표 행 + §17-34·채팅 수치 ADR·갤러리·e2e·네이티브 fixture·(②-3이 먼저 머지돼 있으면) 구간 켜짐 → 채팅 행 숨김 + 두 행 합산 높이 | O 구현, **F 리뷰**(카드 두 요소가 튀지 않는지, U2 반영) | ④-4 · **U2 확정**(실측 뒤) · U1·U3·U4·U5 확정 · (②-3이 머지돼 있으면 그 뒤, 아니면 기다리지 않는다) | `frontend`·`design-copy`·`design-tokens`·`e2e-web`·`design-shots`·`e2e-native` |
| `docs/chat-done` | ④-6 `docs:` core.md·app.md 번호·ROADMAP·CLAUDE.md 모듈 목록 `chat` | S | ④-5 | `scan` |

### 트랙 ③ 내 채널 새 영상·모아 받기(`backup.md` §12 3차) — **보류(2026-10-18)**: ③-1 도구만 머지됐고 ③-2~③-8은 하지 않는다
| 브랜치 | PR | 모델 | 의존 | 완료 조건 |
|---|---|---|---|---|
| `chore/listing-check` `[P]` | ③-1 `chore:` `worker/scripts/listing-check.mjs` + `test/listing-check-lib.mjs`(정렬은 "관찰 표본에서 내림차순/아님/판정 불가 + 표본 수"만, N7). `.dev.vars` 안 읽음 | S | 없음 | `scripts-test`·`scan` |
| ⏸ | 사용자 실측 M-③-1~7(4는 개발 빌드), 6-2는 ④ 경로가 생긴 뒤 | 사람 | ③-1 | 결과 범주만 ROADMAP |
| `feat/listing-core` `[P]` | ③-2 `feat:` `listing` 파서·`list_channel_*`·`url::content_url`(왕복 셋, `Live` 포함; 목록은 `Live`를 만들지 않음)·fixture·페이지 상한·반복 감지·채널 불일치 버림·크기 상한·401/403·**정렬이 깨진 합성 응답에서도 새 영상을 놓치지 않는 회귀 테스트** | S(실측으로 필드·페이지 방식 확정 뒤. 정렬은 확정하지 않는다) | ③-1 결과 · E1 확정(A면 변경 없음) | `rust`·`scan` |
| `feat/backup-ledger` | ③-3 `feat:` `BackupLedger`(원자적 쓰기·`.bad`·기준점 두 모양)·매니저 **`TerminalObserver`**(`Live` 작업은 쓰지 않음)·`volume::available_bytes`·`LOW_SPACE_FACTOR` 규칙 함수 + 크기 어림 골든 | S(원장 형식) + O(의존성 선택·관찰자 자리) | ③-2 | `rust`·**`supply`**·cargo-deny 검토 |
| `feat/backup-service` `[P]` | ③-4 `feat:` `BackupService`(check는 늘 끝까지·enqueue_selected 한 건씩·exclude·baseline·clear)·`record_recent`(`recent_kind` `Option`)·**`onExisting: skip` + 경쟁 테스트 두 층**·`ContentRefTs::Live` 거부·`dto.rs:597` 주석 정정·계정 바뀜 결과 버림·command 7·DTO·`Features.backup`·bindings·가짜 백엔드 | O(한 건씩·취소·상한·관찰자 대응표) | ③-3. ②-2·④-4와 **병렬**(새 타입만) | `rust`·`tauri`·`frontend` |
| `feat/ds-checkbox` `[P]` | ③-5 `feat:` Checkbox ADR(0027+)·`components.md` §2.29·`ui.css`·갤러리·테스트·수치 묶음 ADR·foundations §14 행·용어집 행·`lowSpace`·`backup.truncated`("일부만 불러왔어요", "최근"이라 하지 않음)·patterns §1.2·§1.4(B6)·§2.3·§8·§14.1·§14.2 | O(ADR 근거 등급·forced-colors) · F 리뷰(governance §5 정규 절차) | 없음 | `design-*`·`frontend` |
| `feat/backup-app` | ③-6 `feat:` "내 채널" 뷰(네 번째)·홈 섹션 [새 영상 찾기]·설정 행 셋·copy·e2e-web·app.md §1.2 부분 뒤집기(78+) | O 구현, **F 리뷰**(네 번째 뷰·진입점 하나가 튀지 않는가) | ③-4·③-5 · B1~B3 확정 | `frontend`·`e2e-web`·`design-*` |
| — | **릴리스 ③(가)** | | | §6 |
| `feat/backup-scheduler` | ③-7 `feat:` `BackupScheduler`(하한·백오프·목록 서킷 `LIST_CIRCUIT_FAILURES`·잠자기 복귀)·배너 B6·자동 받기 옵션 | O | ③-6을 **실제로 쓴 뒤** · M-③-6·6-2 결과 | `rust`·`frontend`·`design-shots` |
| `feat/backup-delegated` | ③-8 `feat:` 맡은 채널 대상 고르기(뷰 머리 글자 Menu, 0개면 불변)·D62 과업 | O · F 리뷰 | **①-4** 머지 뒤 · C4 확정 | `frontend`·`e2e-web` |

---

### 트랙 (추가) 받기 전 미리보기(`preview.md` §11) — 구현 완료(2026-10-20), 실측 대기
다섯 기능 밖의 추가 명세다. 번호는 core.md 86·87, app.md 108~114, D64, ADR-0027을 썼다(위 §1의 "다음" 번호 가운데 D64·ADR 0027이 여기로 갔으므로 이후 새 D는 D65, 새 ADR은 0028부터다).

| 브랜치 | PR | 의존 | 완료 조건 |
|---|---|---|---|
| `feat/preview-pv1`~`pv7` | PV-1 코어 PD 중계 · PV-2 셸 세션 · PV-3 Tauri 배선 · PV-4 프런트 PD 재생기 · PV-5 코어·셸 HLS · PV-6L hls.js 고지 · PV-6 hls.js · PV-7 구간 찍기 | stacked(PV-5는 PV-2 위, PV-6L은 PV-6 앞) | `rust`·`tauri*`·`frontend`·`design-*`·`e2e-web`·`scan` 녹색. **PV-7은 M-PV-5 통과가 머지 조건** |
| `feat/preview-pv8` | PV-8 `chore:` 문서 마감(D64·ADR-0027 확정 표기, `features/README.md`, 이 표, ROADMAP, 명세 §16 구현 결과) | PV-7 | `scan`. `tests.playwright` 기준은 CI 녹색 실행 뒤 사람이 올린다 |
| ⏸ | 실측 M-PV-1~7(`preview.md` §13) | 사람(본인 영상, 3 OS) | 결과 범주만 ROADMAP. 불통과 처리는 명세 §13·Q10 |

### 트랙 (추가) 미리보기 구간 편집 UX(`preview-ux.md` §11) — 구현 완료(2026-10-21), 실측 대기
번호는 app.md 115~119, D65, ADR-0028을 썼다(이후 새 D는 D66, 새 ADR은 0029부터다). core.md는 바뀌지 않았다.

| 브랜치 | PR | 의존 | 완료 조건 |
|---|---|---|---|
| `feat/preview-ux-range-model`~`-nudge` | PVU-1 순수 모델 · PVU-2 구간 막대 · PVU-3 편집 배치 · PVU-4 키보드 · PVU-5 양방향·미세 조정·길이 | 직렬 stacked(PVU-1은 PV-7·8 머지 뒤 master에서) | `frontend`·`design-*`·`e2e-web`·`scan` 녹색 |
| `feat/preview-ux-range-docs` | PVU-6 `chore:` 문서 마감(§16, `features/README.md`, 이 표, ROADMAP, 디자인 README 열린 항목 16) | PVU-5 | `scan`, `design-*`. `tests.vitest`·`tests.playwright` 기준은 CI 녹색 실행 뒤 사람이 올린다 |
| ⏸ | 실측 M-PVU-1~7(`preview-ux.md` §13) | 사람(본인 빠른 다시보기, 3 OS) | 결과 범주만 ROADMAP |

## 5. 의존 그래프(N6: "기능 선행 조건"과 "둘 다 진행하면 머지 순서"를 가른다)

### A. 기능 선행 조건(이것이 없으면 그 PR을 **시작·머지할 수 없다**)

| 앞 | 뒤 | 이유 |
|---|---|---|
| ①-4 | ③-8 | `Signer.delegated` 집합(`backup.md` §4.7) |
| ~~L6 확정~~ ✔ | ①-4 | 확정됨(가). `ownership.rs` 생방송 관리자 예외는 배포 그대로라 ①-4가 같은 함수에서 이를 전제로 한다. **⑤-F2는 이 결정에 묶이지 않는다**(F2는 `ownership.rs`를 고치지 않는다, Codex 3회차 M6) |
| ~~L7 (가) 확정~~ ✔ | ⑤-F2 | 확정됨. 범위: 모든 삭제 진입점 소유권 검사 + 계약 구분 + v0.7.0 호환(M1·M5) |
| ⑤-F2 | ②-1 | **필수 선행 조건 하나**(PR 표와 같은 방향): ⑤-F2가 `part.rs`의 소유권·`live_id` 계약을 정한 위에서 ②-1이 `same_job`에 `range`를 얹는다 |
| ~~L8 확정~~ ✔ | ⑤-F3 | 확정됨. 끝난 이유 표시 범위(저장 기록 포함) |
| M-②-3 "된다" | ②-1 이후 전체(deferred 여부) | 키프레임 |
| M-②-2 셋 "일치" ∧ M-②-6 "된다" | ②-3 | 장면 대응·재생 |
| M-④-1~9 → U2 확정 | ④-5 | 기본 형식이 도움말 키·라디오 순서를 정한다(`chat.md` §12) |
| ④-1·④-2 | ④-3a | 실측 없이 시작·머지한다(사용자 승인 2026-10-17). ④-4는 ④-3a에만 기댄다 |
| ④-3a ∧ M-④-3·M-④-4(Q3·Q8) | ④-3b | 채팅 사용 여부 필드와 `PastEnd`는 실측 결과로만 정한다. ④-5의 카드 비활성 경로(Q3)가 이것에 기대므로 ④-5 앞 |
| ③-6을 실제로 씀 ∧ M-③-6 | ③-7 | 스케줄러 수치 |
| 트랙 안 stacked 순서 | 각 PR 표 | — |

### B. 둘 다 진행하면 머지 순서(한쪽이 보류·미정이면 **다른 쪽은 기다리지 않는다**)

| 앞 | 뒤 | 겹치는 것 | 한쪽이 없을 때 |
|---|---|---|---|
| ⑤-F4 | ②-1 | `finish`의 defrag 호출·실패 정책(§3) | ⑤-F4가 없으면 ②-1은 현재 정책(경고만)으로 간다. F4가 나중에 구간 결과에도 같은 계약을 적용 |
| ②-2 | ④-4 | `EnqueueRequest`·`JobDto`·`check_output` 인자 + bindings | ② deferred·미정이면 ④-4는 현재 master 위에서 그대로(`chat.md` §12.1) |
| ②-3 | ④-5 | `ResolveCard` 두 행 + 720×520 합산(C7) | ② 없으면 채팅 행 **단독**으로 잰다. 상호 숨김 규칙은 **뒤에 머지되는 쪽이 건다** |
| ③-3 ↔ ④-4 ↔ ⑤-F3 | — | `DownloadManager::finish` 끝 상태 분기 | 뒤에 머지되는 쪽이 앞의 훅 옆에 둔다(머지 충돌만) |
| ②-1 ↔ ⑤-F2 ↔ ⑤-F4 ↔ ①-5 | — | `ErrorKind`/`ErrorCode` 1:1 표·`errors.ts` | 머지 순으로 번호 |

```
⑤ : ✔L6·L7·L8(확정) → ⑤-F1 ∥ ⑤-F4 ∥ ⑤-F5 ∥ (⑤-F2 → ⑤-F3) → ⑤-F6 ⇒ [릴리스 ⑤ fix, 0.7.1 또는 다음 feat에 합류] → ⏸M-⑤-A~D
① : ①-1 → ①-2 → ①-3 → ①-3½ ⇒ [릴리스 A(Worker)] → ①-4(⑤-F2 뒤) → ①-5 → ①-6 ⇒ [릴리스 B]
② : ②-0 ⏸M-②-3 → ②-1(**⑤-F2 뒤**, §5-A) → ⏸M-②-2·6(`dl --range`) ∥ ②-2 → ②-3 → ②-5
④ : ④-1 ⏸M-④-1~9 ──→ ④-3b(Q3·Q8, ④-3a 뒤) ─→ ⏸U2 ─┐   (②-2 있으면 그 뒤)  (②-3 있으면 그 뒤)
     ④-2 ──→ ④-3a ──→ ④-4 ────────────────────────────┴→ ④-5 ───────────→ ④-6
③ : ③-1 ⏸M-③-1~7·E1 → ③-2 → ③-3 → ③-4 → ③-6 ⇒ [릴리스 ③(가)] → ③-7 ⇒ [릴리스 ③(나)]
                             ③-5 ─────┘                ③-8(①-4 뒤)
⑤(나) 후속: ③(나) 뒤 별도 설계(LiveWatch·자동 녹화·L-D1·O-4)
```

- **어느 트랙도 다른 트랙 전체를 기다리지 않는다.** 가장 긴 트랙은 ③(실측 → 8 PR, (가)를 실제로 쓴 뒤 (나))이다. ⑤ fix는 L6·L7·L8이 확정됐으므로 바로 시작할 수 있고 가장 먼저 끝나기 쉽다.
- **사용자 실측은 한 세션에 몰아서** 돌린다: ②-0 M-②-3 · ③-1 M-③-1~7 · ④-1 M-④-1~9(자막 파일은 ④-1 도구가 만든다, N5) · ① M-①-1·§18-11. 도구 PR(②-0·③-1·④-1)은 전부 `[P]`라 먼저 묶어 머지한다. ⑤ 실측 A~D(본인 방송 중)는 ⑤-F3 뒤가 좋다. M-②-2·6은 ②-1 뒤 `dl --range`로 따로. 결과는 범주·된다/안 된다만 ROADMAP에.
- **③·④ 보류(2026-10-18)**: 위 그래프의 ③·④ 줄은 멈췄다(③ 줄은 ③-1 뒤, ④ 줄은 ④-4 뒤). U2·E1·C5 재검토는 다시 시작할 때까지 대기다.
- 남은 사용자 결정은 처음 필요한 PR 앞에서 받는다: C2는 릴리스 A 앞, U2는 ④-5 앞(실측 뒤, ④ 보류로 대기), R5는 M-②-6 관찰 뒤. C3·D2는 수정 반영 뒤 확인 요청 상태라 처음 필요한 PR 앞에서 확인을 받는다. C6(①-5 뒤 시험)·C7(②-3·④-5 중 뒤 것의 카드 높이 측정)은 확정이고 시점만 남았다. **L6·L7·L8·L-D1·E1·C1은 2026-10-16에 확정됐다.**

---

## 6. 릴리스 지점

규칙: 릴리스 번호는 미리 박지 않고 태그 직전 `node scripts/ci/release.mjs next-version`이 정한다(`docs/versioning.md` §2 [확인]). 지금 HEAD는 "patch → 최소 0.7.1"이고, 사용자에게 보이는 `feat`가 하나라도 들면 MINOR → **0.8.0부터**(`versioning.md:19` [확인]). `!`는 없다(§1; 후속 `.rec.part`만 검토 대상). 태그 gate가 "버전 = 태그, 단조 증가"를 보므로(`release.yml:50-79` [확인: 문서]) 릴리스마다 버전 올림 커밋이 그 릴리스 안에 있어야 한다(`versions` gate). 운영 배포(태그 push)는 사용자 승인이다.

| 지점 | 담는 것 | 번호(어림) | 비고 |
|---|---|---|---|
| **릴리스 ⑤ fix** | ⑤-F1·F2·F4·F5·F6(`fix`·`test`·`docs`) + ⑤-F3(`feat`) | F3 없이 먼저 내면 **0.7.1**, F3까지면 **0.8.0** | 가장 먼저 준비된다. 다른 `feat` 릴리스에 합류해도 된다(계약 없음). F가 go/no-go |
| **릴리스 A** | ①-2·①-3·①-3½(**Worker 전용**) | 그때 `next-version`(`feat` → MINOR) | C2 (가)일 때. `deploy-worker`가 앱 매니페스트보다 **뒤**에 도는 순서(`release.yml:398`·`:480` `needs:` [확인])에서 "앱이 먼저 닿는 창"을 없애는 가장 작은 방법. DO V3(두 번째 마이그레이션) 승인 |
| **릴리스 B** | ①-4·①-5·①-6 | 그다음 MINOR | C2 (나)면 A·B를 하나로 묶고 창(길이 M-①-4 [실측 필요])을 받아들인다 |
| **릴리스 ②** | ②-1~③·②-5 | MINOR | M-②-2·3·6 통과 뒤. ④와 **각각**(N6). 같은 시기에 둘 다 준비되면 한 릴리스로 묶어도 된다. **v0.10.0**(2026-10-18 버전 PR): M-②-2·6 통과, M-②-3은 부분 관찰(세 구간 첫 프레임 키프레임, 도구 미작성)인 채로 담는다(app.md 구현 중 변경 89) |
| **릴리스 ④** | ④-1~⑥ | MINOR | **보류(2026-10-18)**: ④-5·U2를 하지 않아 내지 않는다. U2 확정 뒤였고 ② deferred·미정이어도 내는 계획이었다 |
| **릴리스 ③(가)** | ③-2~⑥ | MINOR | **보류(2026-10-18)**: 내지 않는다. 수동 [새 영상 찾기]였다 |
| **릴리스 ③(나)** | ③-7(+ ③-8이 ①-4 뒤 준비됐으면 함께) | MINOR | **보류(2026-10-18)**: (가)가 없어 내지 않는다 |

순서는 **준비되는 순서**다. 한 릴리스에 두 트랙을 묶어도 된다(`!`이 없고 서로 계약이 없다). 어느 릴리스가 0.8.0이 될지는 그때 `next-version`이 정한다.

---

## 7. 모델 배분(요약)

- **S(sonnet, 명세 확실·기계적)**: ⑤-F5·⑤-F6, 실측 도구(②-0·③-1, ④-1 구현), 순수 파서·fixture(③-2 실측 뒤, ④-2), DTO·bindings 더하기(②-2), 와이어·copy가 확정된 화면(②-3), 버전 올림·docs 마무리(①-3½·①-6·②-5·④-6).
- **O(opus, 추론·설계 세부)**: ⑤-F1(세 곳·계약 둘)·⑤-F2(세 층 경로 추적·삭제 진입점 전수)·⑤-F3(끝 이유 상태 전달)·⑤-F4 주입 seam 자리, 엔진·상태 기계·생명주기 표(②-1·④-3·④-4·③-4), 판정 규칙·세대·잠금(①-4), DO 트랜잭션·`inviteValid`·롤백 호환(①-2), 초대·완료 페이지(①-3), 네 번째 뷰(③-6), 스케줄러(③-7), ADR 작성(①-1·③-5), ④-1 fixture 설계, 모든 PR의 1차 리뷰.
- **F(fable, 중요 판단·UX)**: 사용자 결정 표 준비(L6·L7·L8·L-D1·E1, 모두 확정됨), ⑤-F2·⑤-F3 리뷰(다시 받을 수 없음을 숨기지 않는 문구·[다시 녹화]가 ADR-0025 용어 안인지), 뒤집는 결정 문장·고지 DC6(①-1 리뷰), UX 기준 ①의 최종 판정(①-3·①-5·②-3·③-6·④-5 리뷰), 새 컴포넌트 ADR 리뷰(③-5), D62 시험 설계(C6), 카드 높이 판단(C7), 릴리스 go/no-go(⑤ fix·A~③(나)).
- Codex 리뷰는 중요한 PR만(§4 머리). Codex를 못 쓰면 서브에이전트 리뷰 2종(O 일반 + F 적대)으로 대신한다(글로벌 지침·메모리).

---

## 8. 사용자 결정·실측

전부 **`decisions.md`**(맨 위 확정 표 + 결정 표 C·D·R·B·U·L·E + 실측 표)에 있다. 이 문서의 PR 표는 그 표의 번호(C2·L6·L7·L8·L-D1·E1·U2·R5·M-⑤-A …)로만 가리킨다.
