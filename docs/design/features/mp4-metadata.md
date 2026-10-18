# 경쟁력 개선 (바) mp4 메타데이터와 표지: 설계

**상태·확정 결정(2026-10-18)**: **M-1(코어 상자, core.md 75)·M-2(코어 배선, core.md 76)·M-3(셸·앱, app.md 91) 구현됨**, M-4(사용자 실측)만 남았다. 구현이 이 문서와 달라진 곳은 core.md 75·76 "구현 중 변경"이 우선한다(예: `Resolved.thumbnail_url`은 `Option<Url>`, `TagReport::Tagged`는 필드 없음, `ClientConfig.image_timeout`). 사용자 결정(2026-10-18, ROADMAP "경쟁력 개선 착수" (바)): 받은 mp4에 **제목·채널 이름·날짜·원본 주소**와 **썸네일 표지(`covr`)**를 넣는다. 설정에서 켜고 끌 수 있다. 기본값(켬)과 그 근거는 §9.1에 적었다. 나머지는 이 문서가 정한 설계 판단이다(**가정**·**[잠정]**·**[실측 필요]**는 표기대로).

**기준 트리는 `origin/master` `55e0733`이다.** 이 문서의 `파일:줄`은 모두 그 커밋에서 연 줄이다. 표기는 `README.md`의 규칙을 따른다. **[확인]**은 직접 연 줄, **가정**은 근거 문서가 없는 설계 판단, **[실측 필요]**는 실물·플레이어로만 정할 수 있는 것, **[잠정]**은 출처 없는 수치다(ADR-0009 묶음).

구현 PR은 `docs/design/core.md` "구현 중 변경" **75부터**, `app.md` **91부터** 번호를 붙여 옮긴다. 머지 순서가 바뀌면 다시 매긴다. 디자인 시스템 D 번호는 새로 받지 않는다. 바뀌는 것은 `content.md` 문구 전표와 설정 화면 행 하나뿐이다.

---

## 1. 목표와 범위

### 1.1 목표
- 받은 mp4를 macOS QuickTime·VLC·Windows 미디어 플레이어·파일 탐색기에서 열었을 때 제목·채널·날짜가 보이고, 표지 이미지가 썸네일로 보이게 한다.
- **받기 성공을 메타데이터에 걸지 않는다.** 썸네일을 받지 못하거나 태그 쓰기를 해석 단계에서 포기해도 받기는 `Completed`다(표지만 빠지거나 태그가 아예 없다).
- 데이터(`mdat`)를 옮기거나 다시 쓰지 않는다. 파일 전체 복사도 없다. 지금 마무리가 지키는 "복사 없이 제자리"(core.md 60, `docs/design/core.md:830`)를 그대로 지킨다.
- 지금의 이어받기(`.part`·sidecar)·재시도·취소·`Skip` 정책과 크래시 불변식을 깨지 않는다(§6.4).

### 1.2 하지 않는 것(1차)
- **클립 표지.** 클립 info 응답 모델(`ClipContent`, `crates/core/src/info.rs:425-431`)과 합성 fixture(`testdata/clip/clip_playinfo.json`)에 썸네일 필드가 없다. 실제 응답의 필드 이름은 확인하지 않았다. 그래서 클립은 글자 태그만 넣는다(M-meta-3 뒤 다시 본다). 클립은 날짜도 없다(`parse_clip_info`가 두 날짜를 `None`으로 둔다, `info.rs:457-458`). 그래서 `©day`도 빠진다.
- **생방송 표지.** `liveImageUrl`은 `{type}` 자리표시자가 든 틀이다(`testdata/live/live_detail.json`). 무엇으로 바꿔야 하는지 확인하지 않았고, 이미지는 방송 중에 바뀐다. 그래서 생방송은 글자 태그만 넣는다.
- 챕터·가사·장르·인코더(`©too`) 같은 다른 태그. 특히 `©too`에 앱 버전을 넣으면 릴리스마다 golden이 바뀐다(§13.5). 그래서 넣지 않는다.
- 이미 받은 파일에 나중에 태그 넣기(일괄 도구). 조각 구조 그대로 마무리된 파일(defrag 실패, §3)에 태그 넣기.
- 이미지 변환(WebP → JPEG 등)과 크기 줄이기. JPEG·PNG가 아니면 표지를 넣지 않는다.

## 2. 기존 결정과의 관계

**뒤집는 결정은 없다.** 넓혀 쓰는 것만 있다.

| 결정 | 처리 | 근거 |
|---|---|---|
| ROADMAP "ffmpeg 제거, 완전 무설치" | 유지한다. 상자를 직접 쓴다. 재인코딩·remux 도구는 없다 | `docs/ROADMAP.md`, range.md §1.1 |
| core.md 60 "복사 없이 제자리, 새 `moov`를 끝에 붙이고 옛 상자 종류만 `free`로" | **같은 방식을 PD에도 쓴다**(§6.2). HLS·생방송은 defrag가 만드는 새 `moov`에 `udta`를 함께 넣는다(§6.1) | `core.md:830`, `crates/core/src/download/defrag.rs:124-176` |
| core.md 60 한계 ④ "`moov`가 파일 끝에 있다(로컬 재생용)" | PD 결과도 메타데이터를 켜면 `moov`가 끝으로 간다(faststart를 잃는다). 같은 이유로 받아들인다 | `core.md:836` |
| core.md 61 M4 "바꾸기 전 실패는 경고만, 바꾸는 도중 실패는 `.part`로" | 태그 쓰기에도 같은 두 갈래를 쓴다(§6.2 `TagError`) | `crates/core/src/download/mod.rs:446-470` |
| core.md 71 "`Progressive`는 변환하지 않는다" | 유지한다. PD는 defrag를 타지 않고, 태그 쓰기(§6.2)만 탄다. `converts_on_finish`는 바꾸지 않는다 | `mod.rs:474-481` |
| 결정 8 "미디어에 쿠키 없음"(73·74에서 성인 HLS·PD 확인) | 썸네일 요청은 `cookies_on_media`와 상관없이 **늘** 쿠키를 보내지 않는다(§7) | `crates/core/src/http.rs:145-170`, `core.md:940-941` |
| core.md 55 "`Skipped`면 `.part`가 남고 `Overwrite`로 다시 부르면 곧바로 마무리" | 지킨다. PD는 태그 뒤 checkpoint하지 않아 progressive 416 이어받기와 충돌하지 않는다(§6.4) | `core.md:796`, `crates/core/src/download/progressive.rs:146-154` |

## 3. 출력 종류별 정책

`finish`(`mod.rs:484-548`)는 세 엔진이 모두 지나는 한 곳이다. `progressive::run`이 `progressive.rs:90`, `segmented::run`이 `segmented.rs:312`, `live::run`이 `live.rs:452`, 끊긴 생방송 마무리가 `mod.rs:394`에서 부른다 **[확인]**. 그래서 태그 쓰기는 `finish` 안 한 곳에 둔다.

| 출력 | 지금 마무리 | 메타데이터 | 표지 |
|---|---|---|---|
| 일반 VOD(PD mp4) `Progressive` | 변환 없음. 결과는 `[ftyp, moov, free, mdat]`(core.md 74 실측) | **§6.2 끝에 붙이기**: 새 `moov`(옛 `moov` + 새 `udta`)를 끝에 붙이고 옛 `moov` 종류를 `free`로 바꾼다 | 있음(info `thumbnailImageUrl`) |
| 클립(PD mp4) `Progressive` | 같음 | 같음. `©day` 없음 | **없음**(§1.2) |
| 빠른 다시보기 전체·구간 `LiveRewindHls` | defrag로 일반 mp4(core.md 64·71) | **§6.1 defrag의 새 `moov`에 `udta`를 넣는다**(덧붙이기는 한 번뿐) | 있음 |
| 생방송 녹화 `Live`(정상 마무리·[녹화 마치기]) | defrag | §6.1과 같음 | **없음**(§1.2) |
| 생방송 끊긴 `.part` 마무리(`mod.rs:385-398`, resolve 전) | defrag | **넣지 않는다**: resolve 전이라 제목·채널을 모른다. 정보 없이 원본 주소 하나만 넣는 반쪽 태그도 만들지 않는다 | 없음 |
| defrag가 `Unchanged`로 조각 구조 그대로 마무리 | 조각 구조 | **넣지 않는다**: 조각 파일은 `moov`가 `moof` 앞에 있어야 해서 끝에 붙이기를 쓸 수 없다 | 없음 |
| defrag가 `AlreadyFlat`(앞선 실행이 이미 바꿨다) | 그대로 | **다시 넣지 않는다**: 앞선 변환이 넣은 `udta`가 이미 새 `moov`에 있다. 그 실행이 끈 상태였으면 태그 없이 끝난다(받아들임) | 같음 |

## 4. 태그 내용

모든 값은 `resolve` 결과(`Resolved`)와 `ContentRef`, 요청 구간에서만 만든다. **벽시계·앱 버전·실행마다 달라지는 값은 넣지 않는다.** 그래야 같은 입력이 같은 바이트가 되어 golden 검사가 된다(§13.5).

| 원자 | 값 | 출처 | 비고 |
|---|---|---|---|
| `©nam` | 제목. 구간 받기는 제목 뒤에 `naming::range_suffix`(` (H.MM.SS~H.MM.SS)`)를 붙인다 | `ContentMeta.title`(`model.rs:46`), `naming.rs:242-248` | 파일 이름과 같은 접미사라 재생기에서도 일부만 받은 파일임이 보인다 |
| `©ART` | 채널 이름 | `ContentMeta.channel_name`(`model.rs:47`) | 비면 원자를 넣지 않는다 |
| `©day` | `YYYY-MM-DD`(KST 날짜 그대로) | VOD: `live_open_date` → 없으면 `publish_date`. 파일 이름의 날짜 순서와 같다(`naming.rs:66-72`). 생방송: `live_open_date`. 클립: 없음 | `naming::parse_live_date`(`naming.rs:273`)를 통과한 값만 쓴다. 시각·시간대를 붙일지는 M-meta-1 결과로 정한다 **[실측 필요]** |
| `©cmt` | 원본 공개 주소(§4.1) | `ContentRef` | 탐색기·VLC의 "설명" 칸에 보일 것으로 **가정**(M-meta-1) |
| `covr` | 표지 JPEG(type 13) 또는 PNG(type 14) | §7 | VOD·빠른 다시보기만 |

- 글자는 UTF-8(`data` type 1, locale 0)이다. 앞뒤 공백을 지운 뒤 비면 그 원자를 넣지 않는다. 원자 하나는 1 KiB에서 UTF-8 경계로 자른다 **[잠정]** 근거 없음, ADR-0009 묶음(실물 제목은 그보다 훨씬 짧다고 **가정**. 상한은 메모리·상자 크기 보호용이다).
- 다섯 원자가 모두 없으면(`udta`가 빈다) 태그를 쓰지 않는다.

### 4.1 원본 주소
- **`ContentRef`로만 만든다**: `Video` → `https://chzzk.naver.com/video/{video_no}`, `Clip` → `https://chzzk.naver.com/clips/{clip_id}`, `Live` → `https://chzzk.naver.com/live/{channel_id}`. 함수 하나(`url::public_page_url(&ContentRef) -> String`, 새 함수)로 둔다.
- 사용자가 붙여 넣은 문자열(`JobRecord.url`)은 쓰지 않는다. `parse_content_url`은 `m.` 호스트·`embed/clip`·쿼리·조각(`#`)을 받아 준다(`crates/core/src/url.rs:12-21`, 테스트 `:108-125`·`:141-150`). 그래서 붙여 넣은 그대로 두면 서명 쿼리나 추적 쿼리가 파일에 들어갈 수 있다.
- 서명 주소(`PdRep.url`, master playlist)는 태그를 만드는 쪽에서 아예 받지 않는다. 그 주소들은 `Source` 안에 있고 태그 입력 구조체(§8)에는 들어가지 않는다.

## 5. 상자 구조

```
moov
├─ (원래 자식들: mvhd, trak…, 기존 udta는 뺀다)
└─ udta
   └─ meta            (full box, version 0, flags 0)
      ├─ hdlr         (pre_defined 0, handler_type 'mdir', reserved 'appl' 0 0, name "\0")
      └─ ilst
         ├─ ©nam ─ data (type 1, locale 0, UTF-8)
         ├─ ©ART ─ data
         ├─ ©day ─ data
         ├─ ©cmt ─ data
         └─ covr ─ data (type 13 JPEG | 14 PNG)
```

- 순수 함수 `mp4meta::build_udta(&Tags, Option<&Cover>) -> Option<Vec<u8>>`(새 모듈 `crates/core/src/mp4meta.rs`)가 `udta` 상자 전체를 만든다. 원자 순서는 위 표 순서로 고정한다.
- **배치는 ffmpeg 참조 파일과 대조해 확정한다.** `ffmpeg -i in.mp4 -c copy -metadata title=… -metadata artist=… -metadata date=… -metadata comment=…`에 표지(attached pic)를 붙여 만든 파일의 `udta` 트리(상자 종류·순서·`meta` full box 여부·`hdlr` 바이트·`data` type)를 1단계 PR에서 확인한다. 이 절의 그림은 그 대조 전의 기대 모양이다 **가정**. 대조 결과가 다르면 ffmpeg 쪽을 따르고 core.md "구현 중 변경"에 적는다.
- 기존 `udta`(PD 원본에 인코더 태그 등이 있을 수 있다)는 **통째로 빼고** 새 것으로 바꾼다 **가정**: 원본 `udta`의 내용은 재생에 쓰이지 않는다. 섞어 쓰면 원자가 겹칠 때의 규칙이 필요하다. `trak` 안의 `udta`와 `moov` 바로 아래의 `meta`(있다면)는 건드리지 않는다.
- 크기: 글자는 수 KB, 표지는 상한 2 MiB(§7)다. 새 `moov`는 defrag의 메타 상자 상한(64 MiB, `defrag.rs:40`) 안이어야 한다. 넘으면 태그를 쓰지 않는다(`Unchanged`).

## 6. 쓰기 경로

### 6.1 빠른 다시보기·생방송: defrag의 새 `moov`에 넣는다
- `defragment_in(file)`(`defrag.rs:124`)에 `udta: Option<&[u8]>` 인자를 더한다. `build_moov`(`defrag.rs:991-1066`, 호출 `:902`)는 마지막 `trak` 뒤에 그 바이트를 자식으로 붙인다. 공개 `defragment(&mut File)`(`:119`, `examples/defrag.rs`가 쓴다)는 `None`으로 부른다.
- 덧붙이는 `moov`는 그대로 하나다. 2단계(끝에 붙이고 sync)·3단계(종류 패치)·크래시 복구(`free`의 첫 자식이 `mfhd`/`mvhd`+`mvex`, `defrag.rs:868-887`)·`DefragError` 두 갈래는 **바뀌지 않는다**. 다시 변환할 때도 같은 `udta`를 넘기므로 같은 결과다. 표지 받기가 이번에만 실패하면 표지만 다를 수 있는데, 받아들인다.
- 이 경로를 고른 이유는 셋이다. 하나, defrag가 이미 새 `moov`를 메모리에서 만든다. 둘, 따로 태그를 쓰면 `moov`를 한 번 더 붙이게 되어 죽은 공간(긴 녹화면 샘플 표 수 MB)과 fsync가 한 번씩 더 생긴다. 셋, 크래시 복구 규칙이 하나로 남는다.

### 6.2 일반 VOD·클립(PD): 끝에 붙이기

**선택지 비교**

| 안 | 방법 | 장점 | 단점 | 판정 |
|---|---|---|---|---|
| (a) 끝에 붙이기 | 옛 `moov` 본문을 읽어 `udta`를 바꾼 새 `moov`를 파일 끝에 붙이고, 옛 `moov`의 4바이트 종류만 `free`로 바꾼다 | `mdat`이 움직이지 않으니 **`stco`/`co64`를 고칠 일이 없다**. defrag와 같은 순서·같은 복구 규칙이다. 쓰는 양은 `moov` 크기(수 MB)다 | faststart를 잃는다(로컬 재생은 영향 없음, core.md 60 한계 ④). 옛 `moov` 크기만큼 죽은 공간이 남는다 | **채택** |
| (b) `free` 안에 맞추기 | `moov` 뒤 `free`의 자리를 써서 `moov`를 키운다 | faststart를 지키고 죽은 공간이 없다 | `committed_len` 안쪽의 두 곳(`moov` 크기 칸과 `free` 머리)을 한꺼번에 바꿔야 해서 크래시 중간 상태를 알아볼 수 없고 `resume`도 되돌리지 못한다((a)의 4바이트 패치는 중간 상태를 "첫 자식 `mvhd`인 `free`"로 알아본다). 실물 `free` 크기를 모르고, 표지(수백 KB)가 들어갈 만큼 크다는 근거도 없다 **[실측 필요]** | 기각. 크래시 안전을 지키려면 쓰기 순서가 여러 단계로 복잡해진다 |
| (c) 새 파일로 복사 | `ftyp`+새 `moov`+`mdat`을 새 파일에 쓰고 `stco`/`co64`를 밀린 만큼 고친 뒤 rename | faststart, 죽은 공간 없음 | 디스크를 두 배 쓰고 GB 단위 복사 시간이 든다. `stco` 값이 4 GiB를 넘으면 `co64`로 바꿔야 해서 표 다시 쓰기가 생긴다 | 기각 |

**(a)의 단계**: `mp4meta::retag_in<F: DefragFile>(file, udta) -> Result<TagReport, TagError>`이다. 파일 조작 trait는 defrag의 것(`defrag.rs:78-95`)을 쓴다.
1. **훑기**: 최상위 상자 머리만 seek로 읽는다(largesize `size == 1` 지원). `moov` 본문만 읽는다(상한 64 MiB). 다음이면 파일을 바꾸지 않고 `Unchanged`다.
   - 최상위 `moov`가 없다. 단 아래 복구 규칙은 예외다.
   - `moov`가 둘 이상이다.
   - `moov`에 `mvex`가 있다(조각 구조).
   - 마지막 상자 크기가 0(파일 끝까지)이다. 붙인 `moov`를 삼키기 때문이다(core.md 60 검증 반영과 같은 규칙).
   - 상자가 파일 끝을 넘는다.
2. **새 `moov`**: 옛 `moov`의 자식을 순서대로 복사하되 `udta`는 빼고, 끝에 새 `udta`를 붙인다. **`stco`/`co64`·`stsz` 등 다른 바이트는 손대지 않는다**(바이트 그대로 복사). 옛 `moov`의 마지막 자식이 이미 새 `udta`와 바이트가 같으면 아무것도 하지 않고 `AlreadyTagged`다.
3. **붙이기**: 끝에 새 `moov`를 쓰고 `sync`. 실패하면 `truncate_to(원래 길이)` + `sync`로 되돌린다. 되돌리기에 성공하면 `Unchanged`, 실패하면 `Modified`다.
4. **패치**: 옛 `moov`의 종류 자리(`off + 4`)에 `free`를 쓰고 `sync`. 실패하면 `Modified`다.

**크래시 복구**: 최상위 `moov`가 없고 최상위 `free`/`skip` 중 **첫 자식이 `mvhd`이고 자식에 `mvex`가 없는 것이 정확히 하나**면, 그것을 4단계까지 마친 옛 `moov`로 본다. 그 본문으로 2~3단계를 다시 한다. 4단계는 이미 `free`라서 쓰지 않는다. 둘 이상이면 `Unchanged`다(모르는 구조). PD에는 defrag의 init `moov`(`mvex` 있음)가 없으므로 그 규칙과 겹치지 않는다. 같은 판정 함수(`free`의 첫 자식 보기)를 defrag와 나눠 쓴다.

**메타데이터를 끈 실행의 복구**: 앞선 실행이 켠 채로 4단계 뒤에 죽고 이번 실행이 끈 상태면, 끝에 붙인 `moov`는 잘렸고 옛 `moov`는 `free`다. 그대로 마무리하면 `moov` 없는 파일이 된다. 그래서 `finish`는 PD에서 **설정과 상관없이** 복구 판정을 먼저 한다. 꺼져 있으면 그 `free`의 종류를 `moov`로 되돌리기만 한다(4바이트 쓰기 + `sync`, `mp4meta::repair_in`). 옛 바이트가 그대로라서 원본 PD 파일과 같아진다.

**보고와 판정**

```rust
pub(crate) enum TagReport { Tagged { cover: bool }, AlreadyTagged, Repaired, NotApplicable }
pub(crate) enum TagError { Unchanged(Error), Modified(Error) }   // DefragError와 같은 뜻
```

`finish`의 판정은 `defrag_verdict`(`mod.rs:449-470`)와 같은 모양의 `tag_verdict`다. `Tagged`·`AlreadyTagged`·`Repaired`·`NotApplicable`·`Unchanged`면 마무리를 이어 간다(`Unchanged`는 `tracing::warn!`). `Modified`·핸들 오류면 `drop_uncommitted_tail` 뒤 `.part`로 두고 `Err`를 낸다(`Io`라 이어받을 수 있다). **PD는 태그 뒤 checkpoint하지 않는다**(§6.4).

### 6.3 `finish` 순서(바뀐 뒤)

```
finish:
  phase(Finalizing); checkpoint                                   // 지금 그대로(mod.rs:488-497)
  tags = job.tags (embed_metadata && resolve가 있었을 때만, §8)
  cover = tags에 thumbnail_url이 있으면 fetch_cover(취소 가능, §7)   // 파일을 바꾸기 전, 비동기
  udta = build_udta(tags, cover)
  if converts_on_finish(kind):                                    // HLS·생방송
      defragment_in(f, udta) → defrag_verdict → Converted면 checkpoint   // 지금 그대로 + udta 인자
  else:                                                           // PD
      retag_in(f, udta) 또는 (udta 없음) repair_in(f) → tag_verdict  // checkpoint 없음
  finalize(on_existing)                                           // 지금 그대로(rename_with_retry·noclobber)
```

- 최종 이름으로 옮기는 rename은 지금의 `finalize`(`part.rs:549-612`, Windows 잠금 재시도 `fsutil::rename_with_retry`·`rename_noclobber_with_retry`, `fsutil.rs:112`·`:126`)를 그대로 쓴다. 태그는 `.part` 위에서 쓰고, 완성된 `.part`만 한 번의 rename으로 최종 파일이 된다. 그래서 **임시 사본도 새 rename도 없다.** 태그 쓰기 도중 실패하거나 죽어도 최종 파일은 생기지 않는다. `.part`는 다음 실행이 committed_len으로 자른 뒤 다시 마무리한다.
- 표지 받기는 파일 작업 **앞**에 둔다. 받는 도중 취소되면 파일은 바뀌지 않은 채 `Cancelled`로 끝난다.

### 6.4 이어받기·재시도·취소와의 관계

| 상황 | 동작 | 근거 |
|---|---|---|
| 받기 도중 실패·취소 | 지금 그대로(`.part` 남김). 태그는 마무리에서만 쓰므로 영향이 없다 | `mod.rs:371-379` |
| 표지 받는 동안 취소 | `Cancelled`(이어받기 가능). 파일은 바뀌지 않았다. 다음 실행은 progressive가 416 → 곧바로 `finish`, segmented는 `next_index == last` → `finish` | `progressive.rs:146-154` |
| 표지 받기 실패(네트워크·404·형식·크기·시간 초과) | 재시도 없이 표지만 빼고 계속한다(`tracing::warn!`) | §7 |
| PD: 4단계 뒤·rename 전 크래시 | `resume`이 committed_len(= 원래 PD 크기)으로 잘라 새 `moov`가 사라진다. 다음 `finish`가 복구 규칙(§6.2)으로 다시 붙인다(끈 상태면 되돌린다) | `part.rs:329-337` |
| PD: `Skip`인데 받는 동안 같은 이름 파일이 생김(`TargetExists`) | `.part`에 덧붙인 `moov`는 커밋되지 않았다. `Overwrite`로 다시 부르면 위 크래시와 같은 길로 마무리된다(전체를 다시 받지 않는다) | `mod.rs:537-547`, core.md 55 |
| PD에서 checkpoint하지 않는 이유 | checkpoint하면 `committed_len > total_len`이 된다. 다음 실행의 `Range: bytes={committed}-`가 416을 받고, `total == offset` 검사(`progressive.rs:148`)에 걸려 `SourceChanged`로 지운 뒤 처음부터 받는다. core.md 55를 거스른다 | `progressive.rs:146-154` |
| HLS·생방송: 변환(+`udta`) 뒤 크래시·`TargetExists` | 지금 그대로다. 변환 뒤 checkpoint(`mod.rs:518-525`)가 있으므로 다음 실행은 `AlreadyFlat` → 그대로 마무리한다 | core.md 71 (4) |
| 재조회(403) | 태그 입력은 첫 `resolve` 결과로 정한다. 재조회 결과로 바꾸지 않는다 | `mod.rs:273-327` |
| 소유 판정·sidecar | 메타데이터 켬·끔은 `PartOwner`(`part.rs:34-43`)에 넣지 않는다. 설정을 바꿔도 남은 `.part`는 그대로 이어받는다 | — |
| 진행 표시 | 표지 받기·태그 쓰기 동안 `Finalizing` 그대로다. 새 phase는 없다 | `mod.rs:488` |

## 7. 썸네일 받기

- **요청 종류 `RequestKind::Image`를 새로 만든다**(`http.rs:18-25`). 헤더는 UA·Referer·`Accept: image/jpeg, image/png`이고, **Cookie는 `cookies_on_media`와 상관없이 늘 넣지 않는다**. `media_get`(`client.rs:235-243`)은 스위치가 켜지면 쿠키를 보내므로 쓰지 않는다. `Accept`를 좁히는 것은 이미지 CDN이 WebP를 협상해 줄 수 있어서다 **가정**.
- 주소는 `https`만 받는다. userinfo가 있거나 `{`·`}`(틀 자리표시자)가 남은 주소는 받지 않는다. 호스트는 제한하지 않는다 **가정**. 실제 CDN 호스트 목록을 저장소에 두지 않고, 응답 크기·형식 검사로 충분하다고 본다. 테스트·E2E만 `ClientConfig.allow_loopback_http_images`(기본 false)로 `http://127.0.0.1`·`[::1]`을 허용한다. 이동(redirect)은 표지 전용 클라이언트가 **요청 전에** 같은 조건으로 거른다(어기면 따라가지 않는다, core.md 77).
- 본문은 `read_capped`(`client.rs:251-268`)로 **2 MiB까지만** 읽는다 **[잠정]** 근거 없음, ADR-0009 묶음. 실물 썸네일은 수백 KB라고 **가정**한다.
- 전체 시간 상한은 **15초**다 **[잠정]**(`tokio::time::timeout`). `build_client`에는 전체 timeout이 없어(`http.rs:174`) 연결 10초 + 읽기 idle 30초 그대로면 마무리가 40초 넘게 늘어질 수 있다. 재시도는 하지 않는다. 최선 노력이고, 연결 대기(인내 모드, core.md 56)도 타지 않는다.
- **형식은 앞 바이트로만 정한다**: `FF D8 FF`면 JPEG(type 13), `89 50 4E 47 0D 0A 1A 0A`면 PNG(type 14), 그 밖은 버린다. `Content-Type`은 믿지 않는다. 디코드는 하지 않는다.
- 상태 코드가 2xx가 아니면 버린다. 401/403도 `AuthRequired`가 아니라 표지 없음이다.
- 로그에는 `http::redact_url`(`http.rs:192`)을 거친 주소만 남긴다. 쿼리가 서명일 수 있다고 본다.
- 썸네일 주소의 출처는 VOD·빠른 다시보기 info의 `thumbnailImageUrl`이다(`testdata/vod/video_info.json`·`testdata/hls/video_info.json`에 있다). `VideoContent`(`info.rs:23-36`)에 `thumbnail_image_url: Option<String>`을 더한다. 빈 문자열은 없는 것으로 본다(`non_empty`, `info.rs:155`).

## 8. 운반: 무엇이 `finish`까지 가는가

지금 `run`은 `resolved.source`로 엔진을 고르면서 `Resolved.meta`를 버린다(`mod.rs:420-430`). `finish`는 `job.req`만 본다(`mod.rs:484`). 그래서 다음을 더한다.

- `DownloadRequest.embed_metadata: bool`(`mod.rs:65-86`). 셸이 설정에서 정한다. 코어 기본값은 없다(구조체 리터럴이라 모든 생성자가 값을 준다: `crates/shell/src/jobs.rs:126`, `crates/core/examples/dl.rs:367`, 테스트). 기존 테스트는 `false`로 두어 지금 golden(`testdata/hls/full2_flat.mp4`)을 그대로 쓴다.
- `Resolved.thumbnail_url: Option<String>`(`model.rs:172-176`). `client.rs:187`에서 VOD일 때만 채운다. **`ContentMeta`에는 넣지 않는다**: `ContentMeta`는 셸이 `..` 없이 구조 분해하고(`crates/shell/src/dto.rs:10`), 파일 이름·소유 판정 테스트가 리터럴로 만든다. `ResolvedDto`(`dto.rs:469-`)는 이 필드를 옮기지 않는다(화면에 쓰지 않는다).
- `Job.tags: Option<TagInput>`(`mod.rs:209-` `Job`). `run`이 `resolve` 직후(`mod.rs:419` 앞) `embed_metadata`가 켜져 있으면 `TagInput { meta: ContentMeta, content: ContentRef, range: Option<TimeRange>, thumbnail_url }`을 채운다. 끊긴 생방송 마무리(`mod.rs:385-398`)는 resolve 전이라 `None`이다(§3). `TagInput`에는 서명 주소가 없다. `ContentMeta`가 `Debug`를 derive해도 비밀값이 없다.

## 9. 설정

### 9.1 기본값: 켬

| 기준 | 판단 |
|---|---|
| 사용자 결정의 목적 | 재생기·탐색기에서 영상을 알아보게 하는 기능이다. 꺼진 기본값이면 대부분이 모르고 지나간다(README P3: 기본 흐름에 단계를 더하지 않는다) |
| 실패 비용 | 받기 성공에 걸지 않는다(§1.1). 실패하면 태그나 표지만 빠진다 |
| 비용 | HLS·생방송은 이미 만드는 새 `moov`에 수 KB~2 MiB가 더해질 뿐이다(§6.1). PD는 `moov` 크기(수 MB)를 한 번 더 쓰고, 그만큼 죽은 공간이 남으며, faststart를 잃는다. 요청은 이미지 하나다 |
| 원본 보존 | 빠른 다시보기·생방송 결과는 이미 defrag로 다시 쓴 파일이라 "서버 바이트 그대로"가 아니다. 바이트 그대로가 의미 있는 것은 PD뿐이고, 그런 사람은 끄면 된다 |
| 개인 정보 | 파일 이름에 이미 채널·제목·날짜가 있다(`naming.rs:42-90`). **새로 따라가는 것은 원본 주소(영상 번호·클립 ID·생방송 채널 ID)와 표지다.** 파일을 남에게 줄 때 함께 간다. 도움말 문구에 "원본 주소도 들어가요"를 적어 알린다(§9.3) |
| 선례 | `keep_awake`가 기본 켬이고, 없는 키·모르는 값을 켬으로 읽는다(`settings.rs:84-86`·`:143`·`:192-200`) |

### 9.2 저장과 전달
- `UserSettings.embed_metadata: bool`(`crates/core/src/settings.rs:50-93`). `#[serde(deserialize_with = "bool_or_true")]`라서 없는 키·불리언 아닌 값은 켬이다. `Default`도 `true`다.
- **작업에 고정한다**: `JobDefaults.embed_metadata`(`crates/shell/src/manager.rs:102-110`) → `JobRecord.embed_metadata`(`jobs.rs:61-62`의 `concurrency`와 같은 규칙, "추가 당시 설정"). 옛 `jobs.json` 기록에는 이 키가 없다. serde 기본값은 `true`로 두어 설정 기본값과 맞춘다. `to_request`(`jobs.rs:125-137`)가 `DownloadRequest.embed_metadata`로 옮긴다.
- `SettingsDto.embed_metadata`·`SettingsPatch.embed_metadata: Option<bool>`(`dto.rs:345-` 근처 `keep_awake`와 나란히)를 더하고 `services.rs`의 읽기·패치(`:319-320`·`:562` 근처)에 한 줄씩 더한다. `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 bindings를 다시 만든다. 가짜 백엔드 `app/e2e/mock/backend.ts:208` 근처에 `embedMetadata: true`를 더한다.

### 9.3 화면·문구
- 설정 화면 「받기」 절(`app/src/lib/views/SettingsView.svelte:90-151`, `card.download`)의 잠자기 방지 행 뒤에 `SettingsRow` + `Switch` 한 행을 둔다(새 컴포넌트 없음). 갤러리 설정 장면의 스냅샷 기준선이 바뀐다(`design-shots`).
- copy deck 초안(`app/src/lib/copy/ko.ts`, `content.md` 문구 전표에 같이 올린다. `design-copy` gate가 규칙을 본다):
  - `settings.embedMetadata`: `받은 영상에 제목과 표지 넣기`
  - `settings.embedMetadata.help`: `파일 목록과 영상 보는 앱에서 제목·채널·날짜·표지가 보여요. 원본 주소도 함께 들어가요.`
- 작업 행·카드에는 아무것도 더하지 않는다. 표지가 빠졌다는 표시도 없다(로그에만 남긴다).

## 10. 오류·로그
- **새 오류 종류는 없다.** 태그 실패의 두 갈래는 기존 오류(`Io`·`DiskFull`·`FileTooLarge`·`Parse`)로 나간다. `Modified`만 `Err`이고 이어받을 수 있다(core.md 61 M4와 같다). 셸 `AppError`·`errors.ts`도 바뀌지 않는다.
- 로그(`tracing`): 표지 받기 실패 `warn`(이유 범주와 가린 주소), 태그 결과 `info`(`TagReport`), `Unchanged` `warn`. 제목·채널 이름은 로그에 남기지 않는다(파일 이름에 이미 있지만, 로그 파일을 남에게 줄 때 덜 새게 한다).

## 11. 비밀값 규칙
- 썸네일 요청에 쿠키를 보내지 않는다(§7). `http::headers` 표(`http.rs:138-144`)에 `Image` 행을 더하고, 기존 테스트 `headers_by_kind`(`http.rs:501-`)에 "`cookies_on_media = true`여도 `Image`는 Cookie 없음"을 더한다.
- 태그에 들어가는 주소는 §4.1의 공개 페이지 주소뿐이다. 서명 토큰(`hdnts`·`hdntl`·PD 쿼리)은 태그 입력 구조체에 들어올 길이 없다. 테스트로 고정한다(§13.3).
- 썸네일 주소는 `redact_url`을 거쳐서만 로그에 남긴다.

## 12. OS별 분기
- 파일 조작은 defrag와 같은 `DefragFile` trait(`set_len`·`sync_data`·seek 쓰기)뿐이라 OS 분기가 없다. 최종 rename의 Windows 잠금 재시도는 기존 `finalize`가 맡는다(core.md 37·38·55).
- Windows 탐색기가 어느 원자를 어느 열에 보여 주는지(`©cmt` vs `desc`, `©day` 형식)는 실기로만 안다(M-meta-1).

## 13. 테스트 계획(TDD)

### 13.1 합성 fixture(`scripts/fixtures/gen-fixtures.mjs`, `--check`)
- `testdata/vod/pd_faststart.mp4`: `[ftyp, moov{mvhd, trak{tkhd, mdia{mdhd, hdlr, minf{vmhd, dinf, stbl{stsd, stts, stsc, stsz, stco}}}}}, free(8), mdat]`. `stco`는 `mdat` 본문을 가리킨다. 지금은 PD mp4 fixture가 없다(`testdata/vod/`에는 info·MPD뿐).
- `testdata/vod/pd_udta.mp4`: 위에 기존 `udta`(`©too` 하나)가 든 것(교체 확인용).
- `testdata/vod/pd_co64.mp4`: `stco` 대신 `co64`를 쓴 것. 값은 작다(바이트 그대로 복사 확인용).
- `testdata/synthetic/thumb.jpg`(유효한 1×1 JPEG), `thumb.png`(1×1 PNG, node `zlib`으로 생성), `thumb.webp`(RIFF…WEBP 머리, 거부 확인용).
- `testdata/clip/clip_playinfo.json`은 바꾸지 않는다(클립 표지는 1차 밖).
- 테스트·E2E가 썸네일을 루프백으로 받도록 `img.example.invalid`를 미디어 호스트 치환 목록에 더한다(`crates/core/tests/common/mod.rs:17-33`의 `MEDIA_HOSTS`, `scripts/ci/e2e-fixture-server.mjs:28`). 지금은 목록에 없어서 `.invalid` DNS 조회가 일어난다.

### 13.2 검사기(`crates/core/tests/support/mp4.rs`)
지금은 최상위 상자만 본다(`mp4.rs:26-`). 다음을 더한다. std만 쓴다(`examples/dl.rs`·`tests/live.rs`가 `#[path]`로 함께 쓴다).
- `child_boxes(body) -> Vec<(String, Range)>`, 경로 탐색 `find_path(b, &["moov","udta","meta","ilst"])`. `meta`는 full box(4바이트 건너뜀)다.
- `ilst_items(b) -> Vec<(String, u32 /*type*/, Vec<u8>)>`.
- `top_moov_count`, 그리고 `free` 안의 옛 `moov` 알아보기(첫 자식 `mvhd`).

### 13.3 단위
- `mp4meta::build_udta`: 원자 순서·`data` type·locale·`hdlr` 바이트(1단계 ffmpeg 대조 뒤 바이트 golden), 빈 값 생략, 1 KiB 자르기(UTF-8 경계), 모두 비면 `None`.
- `url::public_page_url`: 세 종류의 모양. `ContentRef`만 받으므로 쿼리가 들어갈 길이 없음을 시그니처로 보이고, 서명 주소 문자열이 결과에 없음을 확인한다(`http::assert_clean`과 같은 방식).
- `©day`: `live_open_date` 우선, `publish_date` 대체, 잘못된 날짜는 생략(`parse_live_date` 표 재사용).
- 표지 판정: JPEG·PNG·WebP·빈 본문·2 MiB + 1바이트.
- `retag_in`(바이트 위 `SliceSrc`와 쓰기 실패를 주입하는 가짜 파일, defrag 테스트와 같은 도구):
  - 정상: `[ftyp, free, free, mdat, moov]`, 새 `moov`의 `udta` 외 바이트가 옛 `moov`와 같다.
  - 기존 `udta` 교체, `AlreadyTagged`, 크기 0인 끝 상자 거부, `moov` 둘 거부, `mvex` 거부, 64 MiB 초과 거부.
  - 3단계 실패 → 되돌림(`Unchanged`)과 되돌림 실패(`Modified`), 4단계 실패(`Modified`).
  - 크래시 복구: 옛 `moov`만 `free`인 바이트 → 다시 붙임. 같은 `free` 후보 둘 → `Unchanged`. `repair_in`이 원본과 바이트가 같은 파일을 돌려준다.
- **큰 파일(co64·largesize) 경로**: 희소 가짜 파일(`DefragFile` 구현, 쓴 구간만 `BTreeMap`에 들고 길이는 5 GiB로 보이게)을 쓴다. 상자는 `ftyp`, `moov`(`co64` 값이 4 GiB 넘음), `free`, largesize(`size == 1`) `mdat`(4 GiB 넘게)다. 확인: 새 `moov`가 5 GiB 위치에 붙는다. `co64` 항목이 바이트 그대로다. 옛 `moov`가 `free`가 된다. 검사기가 largesize를 따라간다. 실제 디스크에 큰 파일을 만들지 않는다(Windows NTFS `set_len`이 희소 파일을 보장하지 않는다). `mdat`이 움직이지 않으니 `stco` → `co64` 승격 같은 표 다시 쓰기는 없다. 그것을 이 테스트로 고정한다.
- defrag: `build_moov`에 `udta`를 주면 마지막 자식으로 붙는다. `None`이면 지금 결과와 바이트가 같다(기존 테스트가 그대로 녹색).
- `headers_by_kind`에 `Image` 행(§11).

### 13.4 통합(wiremock, 오프라인)
- `tests/progressive.rs`:
  - `pd_metadata_moov_at_end`: 상자 순서, `ilst` 다섯 원자, `mdat` 본문이 원본과 같음, 썸네일 요청에 Cookie 없음(쿠키 설정 + `cookies_on_media = true`).
  - `pd_metadata_off_is_byte_identical`: 끄면 원본과 바이트가 같다.
  - 표지 실패 표(404·WebP·2 MiB 초과·시간 초과·`{type}` 주소·http 주소) → `Completed`, `covr`만 없음.
  - `pd_tagged_then_skipped_resumes_without_refetch`: `Skip` + 받는 동안 생긴 같은 이름 파일 → `.part` 남음 → `Overwrite`로 다시 부름 → 미디어 GET은 416 한 번뿐, 결과는 태그된 파일이다(segmented의 `full_converted_then_skipped_resumes_without_refetch`와 짝).
  - `pd_crash_after_patch_recovers`: 옛 `moov`를 `free`로 바꾼 `.part` + committed_len = 전체 sidecar를 손으로 만든다. 켠 실행이면 태그되고, 끈 실행이면 원본과 바이트가 같아진다(`repair_in`).
  - 표지 받는 동안 취소 → `Cancelled`, `.part`가 바뀌지 않음.
- `tests/segmented.rs`: 전체·구간 결과의 마지막 `moov`에 `udta`가 있다(구간은 `©nam`에 접미사). 변환 뒤 `Skipped` → 다시 받기 없이 마무리(기존 테스트에 켠 판을 더한다).
- `tests/recording.rs`: 생방송 정상 마무리에 `covr` 없는 태그. 끊긴 `.part` 마무리에는 태그가 없다.
- `tests/live_secrets.rs`류: 썸네일 주소에 서명 같은 쿼리를 넣은 fixture에서 로그·오류·태그에 쿼리가 없다.

### 13.5 golden·E2E
- 기존 `testdata/hls/full2_flat.mp4`는 끈 결과의 golden으로 남는다(코어 `fixture_concat_box_order`는 `embed_metadata: false`).
- 네이티브 E2E는 앱 기본값(켬)으로 받으므로 결과가 바뀐다. 본인 영상과 맡은 채널 영상은 `©ART`·`©cmt`가 달라 한 golden으로 비교할 수 없다(`scripts/ci/e2e-native.mjs:147-165`가 두 `.mp4`를 한 golden에 비교한다). 그래서 golden을 둘로 나눈다: `testdata/hls/full2_tagged_own.mp4`·`full2_tagged_delegated.mp4`. 코어 테스트가 `UPDATE_FLAT_GOLDEN=1`로 만든다(같은 info 변형 규칙: 영상 번호·채널 ID·채널 이름). `judge`는 파일 이름의 채널로 golden을 고른다. fixture 서버는 `/thumb/\d+.jpg`에 `thumb.jpg`를 서빙하고, 요청 기록에서 그 요청에 Cookie가 없음을 판정에 더한다. 앱의 `--features e2e` 설정(`app/src-tauri/src/e2e.rs`)이 `allow_loopback_http_images`를 켠다.
- 태그는 info에서만 만들고 벽시계·버전을 넣지 않으므로 golden은 릴리스마다 바뀌지 않는다(§4).
- 웹 E2E·vitest: 설정 토글(기본 켬, 끄면 `embedMetadata: false` 패치), 가짜 백엔드 기본값. `design-shots` 기준선 갱신(설정 장면).

## 14. 구현 단계(stacked PR, 모두 `feat`이고 마지막에 minor)

| 단계 | 내용 | 끝나는 조건 |
|---|---|---|
| M-1 코어 상자 | `mp4meta`(`build_udta`·`retag_in`·`repair_in`, `free` 판정 공유), defrag `udta` 인자, `url::public_page_url`, fixture(§13.1), 검사기 확장(§13.2), 단위 테스트(§13.3, co64 희소 파일 포함). ffmpeg 참조 대조로 §5 배치 확정. 아직 배선하지 않는다 | `rust`·`fixtures --check`·`scan` 녹색. core.md 75 |
| M-2 코어 배선 | `VideoContent.thumbnail_image_url`, `Resolved.thumbnail_url`, `RequestKind::Image`·표지 받기(§7), `DownloadRequest.embed_metadata`, `Job.tags`, `finish` 순서(§6.3)·PD 복구, 통합 테스트(§13.4), `examples/dl.rs --no-meta`(기본 켬) | 통합 테스트 녹색, 기존 golden 그대로. core.md 76 |
| M-3 셸·앱 | `UserSettings.embed_metadata`(`bool_or_true`), `JobDefaults`·`JobRecord`(serde 기본 true), DTO·patch·bindings, 가짜 백엔드, `ko.ts`·`content.md`, 설정 행, vitest·웹 E2E, 네이티브 E2E golden 둘·fixture 서버(§13.5), shots 기준선 | `frontend`·`tauri`·`e2e-web`·`design-*` 녹색, 네이티브 E2E 녹색. app.md 91 |
| M-4 실측·기록 | 사용자 실측(§16), 결과를 범주만 ROADMAP에. 필요하면 `©day` 형식·`desc` 추가를 고친다 | M-meta-1·2 판정 |

M-1·M-2는 사용자 데이터(받은 파일 구조)를 바꾸므로 "중요한 PR"로 보고 Codex 리뷰를 붙인다(`codex-review-scope`). M-3은 일반 리뷰다.

## 15. 위험

| 위험 | 대응 |
|---|---|
| ilst 배치가 플레이어마다 다르게 읽힘 | M-1 ffmpeg 참조 대조, M-meta-1 실기 셋 |
| PD faststart 상실로 네트워크 재생(NAS·DLNA)의 시작이 느려짐 | 받아들인다(로컬 재생 기준, core.md 60 한계 ④). 문제가 되면 끈다. (b)는 크래시 안전 설계가 따로 필요하다 |
| PD 죽은 공간(옛 `moov` 크기) | 수 MB/수 GB로 1% 미만이라고 **가정**. M-meta-2에서 크기 범주만 본다 |
| 크래시 복구가 엉뚱한 `free`를 `moov`로 봄 | "최상위 `moov` 없음 + 첫 자식 `mvhd` + `mvex` 없음 + 정확히 하나" 조건, 둘이면 포기(`Unchanged`) |
| 꺼진 상태로 되돌린 실행에서 `moov` 없는 파일 | PD는 설정과 상관없이 `repair_in`을 먼저 한다(§6.2) |
| 표지 받기가 마무리를 늦춤 | 15초 상한, 재시도 없음, 취소 가능 |
| 썸네일 주소가 내부 주소를 가리킴 | `https`만 받는다. 쿠키를 보내지 않는다. 2 MiB 상한. 형식은 앞 바이트로 판정 |
| 앱 되돌리기(옛 버전) | 옛 앱은 `embedMetadata` 키를 무시한다. 옛 앱이 §6.2 크래시 중간 상태의 `.part`를 만나면 `moov` 없는 파일로 마무리할 수 있다(창이 짧은 드문 경우라 받아들인다) |

## 16. 사용자 실측 목록(출력은 판정만)

| ID | 무엇을 | 누가 | 출력 |
|---|---|---|---|
| M-meta-1 | M-2 빌드로 받은 VOD 하나·빠른 다시보기 하나를 macOS QuickTime·VLC·Windows 미디어 플레이어(+탐색기 속성)에서 열어 제목·채널·날짜·주소·표지가 보이는지 | 사용자(본인 영상) | 원자별 보임/안 보임 표. `©cmt`가 Windows에서 안 보이면 `desc`를 더하는 안을 정한다 |
| M-meta-2 | PD 하나를 켠 채로 받아 재생·탐색이 되는지, 끈 채로 받은 것과 크기 차이 범주 | 사용자 | 된다/안 된다, 차이 1% 미만/이상 |
| M-meta-3 | 본인 클립 info에 썸네일 필드가 있는지(`examples/dl.rs --list`가 "썸네일 있음/없음"만 찍게 M-2에서 더한다) | 사용자 | 있음/없음. 있으면 클립 표지를 뒤 PR로 연다 |

결과는 범주만 `docs/ROADMAP.md`에 적는다(공개 저장소 규칙: 영상 번호·채널 이름을 적지 않는다).

## 17. 남은 결정
- `©day`에 시각·시간대를 붙일지(M-meta-1 뒤).
- 클립·생방송 표지(M-meta-3, `{type}` 값 확인 뒤).
- (b) `free` 안에 맞추기를 크래시 안전하게 설계할 가치가 있는지. 실물 `free` 크기 범주를 본 뒤 정한다. 1차는 하지 않는다.
