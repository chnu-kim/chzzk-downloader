# 파일명 토큰 템플릿: 설계 초안

**상태(2026-10-18)**: **설계됨, 사용자 결정 필요**. 사용자 결정(2026-10-18)은 셋이다. 저장 파일명을 토큰 템플릿으로 정하고, 기본 템플릿의 결과는 지금 규칙과 바이트 단위로 같으며, 설정 화면에 입력칸·예시 값 미리보기·기본값으로 되돌리기를 둔다. 이 문서는 그 결정 안에서 고를 것을 §3 결정 표(T1~T8)로 정리한다. 각 행에는 선택지·추천·근거가 있다. 표의 추천은 **확정이 아니다**. 사용자가 고르면 이 머리와 표의 "상태" 열을 고친다. **구현(2026-10-18)**: 추천 안 그대로 구현했다(core.md 75, app.md 91). 사용자가 표를 확정하지 않았으므로 아래 "상태" 열은 그대로이고, 다르게 고르면 그 단계만 다시 고친다. 구현에서 명세와 달라진 곳은 core.md 75·app.md 91에 있다.

기준 트리는 `origin/master` `55e0733`(v0.10.1 뒤, ROADMAP "경쟁력 개선 착수"의 (사))이다. `파일:줄`은 그 트리에서 연 줄이다(`55e0733`은 `90404f9`에 문서·`LICENSE.md`만 더해 코드 줄은 같다). 표기는 `README.md`를 따른다: **[확인]** 직접 연 줄, **[가정]**, **[잠정]**(근거 없는 수치, ADR-0009 묶음). 예시 값(`채널이름`·`테스트채널`·`12345`)은 모두 가짜다.

구현할 때는 이 문서를 `docs/design/core.md`·`app.md`의 "구현 중 변경"에 번호를 붙여 옮긴다. 지금 마지막 번호는 core.md 74, app.md 90이다. 그래서 **core.md 75**, **app.md 91**부터 쓰되, 번호는 머지 순으로 맞춘다. 같은 때 병렬로 가는 (나) 허용목록·(라) 속도 제한도 같은 번호대를 쓰므로 먼저 머지한 쪽 뒤로 다시 매긴다. 디자인 시스템 결정이 필요하면(T6) D64·ADR-0026 다음 빈 번호를 쓴다.

---

## 1. 목표와 범위

### 1.1 목표
- 사용자는 설정에서 템플릿을 한 번 정한다(예: `{date}_{channel}_{title}`). 그 뒤 새로 불러오는 영상 카드의 **제안 이름**이 그 템플릿으로 만들어진다.
- 템플릿을 정하지 않은 사용자에게는 아무것도 바뀌지 않는다. 결과가 지금 `naming::default_filename`과 바이트까지 같다(T1).
- 토큰 값을 넣은 뒤에는 지금과 똑같은 OS별 정리를 거친다. 금지 문자, Windows 예약어, 끝의 `.`과 공백, 200바이트 상한이 모두 그대로다(`crates/core/src/naming.rs:135-213` [확인]).
- 설정 화면에는 입력칸, 예시 값으로 만든 미리보기, [기본값으로] 버튼이 있다.

### 1.2 하지 않는 것
- **하위 폴더 만들기.** 템플릿에 `/`·`\`를 쓰면 저장할 때 거부한다(T5). 토큰 값에 든 `/`는 지금처럼 `_`가 된다(`naming.rs:142` [확인]).
- **구간 접미사 바꾸기.** ` (H.MM.SS~H.MM.SS)`는 계속 템플릿 결과 뒤에 붙는다(§4.5).
- **확장자 바꾸기.** `.mp4`는 코어가 정한다(`naming.rs:14-15` [확인]).
- **이미 만든 작업의 이름 다시 짓기.** 작업 경로는 만들 때 고정된다(§4.4).
- **화질 토큰.** 넣지 않는다(T2-④ 추천).
- **조건 구문·대소문자 변환·날짜 형식 지정자.** 토큰은 이름만 쓰고 인자는 없다.

## 2. 지금 동작(근거)

| 사실 | 근거 |
|---|---|
| 기본 이름은 `[YYMMDD] 채널 - 제목.mp4`이다. 클립은 `[클립] …`, 생방송은 `[생방송 YYMMDD-HHMM] …`이다 | `naming.rs:1-5`, `:52-78`, 테스트 `:549-565`·`:597-617` [확인] |
| 채널이 비면 ` - `를 뺀다. 날짜가 없으면 `[…] `를 뺀다. 제목이 비면 `_`를 쓴다 | `naming.rs:48-50`, `:73-76`, `:79`, `:89-90`, 테스트 `:567-595` [확인] |
| 길이를 줄일 때는 제목을 먼저 자르되 60바이트 밑으로는 자르지 않고, 그래도 넘으면 채널을 자른다 | `naming.rs:17-18`, `:81-88`, `:96-107` [확인] |
| 이름을 만드는 곳은 `ResolvedDto::new` 한 곳이고, 여기서 만든 이름은 카드의 제안 이름(`suggestedFileName`, `.mp4` 없음)이 된다 | `crates/shell/src/dto.rs:494-499`, 호출은 `crates/shell/src/services.rs:531-538` [확인]. 다른 `default_filename` 호출은 없다(`grep` 결과) |
| 이름 규칙에 쓰는 OS는 실행 중인 OS가 아니라 **저장 폴더가 놓인 볼륨**에 따라 정한다 | `services.rs:535-536`(core.md 57) [확인] |
| 카드는 제안 이름을 한 번만 칸에 넣는다. 사용자는 이름을 고칠 수 있고, [원래 이름으로]를 누르면 제안 이름으로 돌아간다 | `app/src/lib/components/receive/ResolveCard.svelte:71`·`:86`, `FilenameField.svelte:28-30` [확인] |
| 받기 요청에는 카드의 이름이 그대로 실리고, 작업이 최종 경로(`output`)를 저장한다 | `crates/shell/src/manager.rs:533-535`, `crates/shell/src/jobs.rs:59` [확인] |
| 구간 접미사는 `check_output` 한 곳에서 붙는다. 제목 쪽을 줄여 200바이트 안에 맞춘다 | `crates/shell/src/output.rs:46-52`, `naming.rs:250-268` [확인] |
| 번호 이름(` (2)`)은 이름 끝을 잘라 번호 자리를 만든다 | `output.rs:116-154` [확인] |
| 클립에는 날짜가 없다. `live_open_date`와 `publish_date`가 모두 `None`이다 | `crates/core/src/info.rs:450-462` [확인] |
| 옛 Go 설정에는 파일명 설정이 없었다. 이름 형식은 코드에 고정돼 있었다 | `crates/core/src/legacy.rs:46-66`(`GoSettings` 필드), `docs/spec/core-behavior.md:372-381` [확인] |
| 설정은 즉시 저장한다. 예외는 쿠키 [저장] 하나다. 입력 검증은 제출할 때만 하고, 타이핑 중이나 blur 때는 하지 않는다 | `docs/design/system/patterns.md:271`·`:357`·`:363`·`:814` [확인] |
| 설정 필드는 잘못된 값을 기본값으로 읽는다(`lenient_or_default`) | `crates/core/src/settings.rs:79-92`·`:171` [확인] |
| 패치에서 `null`은 "기본값으로"를 뜻한다(`Nullable::Clear`) | `dto.rs:440-460` [확인] |

## 3. 결정 표(사용자 결정 필요)

"상태" 열은 모두 **추천(미확정)**이다. 등급은 이렇게 읽는다. **확인**: 직접 연 줄이 추천을 받친다. **가정**: 근거 문서가 없다.

| # | 질문 | 선택지 | 추천 | 근거 | 등급 |
|---|---|---|---|---|---|
| **T1** | 기본값을 어떻게 나타내고 저장하나 | (가) 설정 `file_name_template: Option<String>`이다. `None`이면 지금의 `default_filename`을 **그대로** 부른다. 입력칸에는 기본 템플릿 문자열 `{prefix} {channel} - {title}`을 보인다. 이 문자열을 엔진으로 만든 결과가 `default_filename`과 같은지는 골든이 지킨다. 기본 문자열과 똑같은 값을 저장하면 `None`으로 바꾼다 / (나) `default_filename`을 지우고 기본도 엔진으로만 만든다 / (다) `None`이면 옛 규칙을 쓰고 기본 문자열은 보이지 않는다 | **(가)** | (가)는 바이트 동일을 구조로 보장한다. 기존 테스트(`naming.rs:549-701`)가 손대지 않은 함수에 그대로 돈다. 사용자가 기본 문자열을 직접 쳐도 결과가 같다(골든 §7.2). `None` 저장은 나중에 기본 규칙이 바뀌면 템플릿을 고치지 않은 사용자도 함께 따라가게 한다. (나)는 기존 함수를 다시 구현하는 위험이 있다. (다)에서는 사용자가 무엇을 고치는지 모른다 | 확인 |
| **T2** | 토큰 목록(사용자 결정: "naming.rs가 쓰는 정보로부터, 최소로") | 토큰마다 넣을지 뺄지를 고른다. ① `{title}` 제목 ② `{channel}` 채널 이름 ③ `{date}` `YYMMDD` ④ `{quality}` 화질 ⑤ `{no}` 영상 번호·클립 ID ⑥ `{kind}` 종류 ⑦ `{time}` `HHMM` ⑧ `{prefix}` 지금 머리 `[YYMMDD]`·`[클립]`·`[생방송 …]` | **넣는다: ①②③⑤⑧ / 뺀다: ④⑥⑦** | ①②③⑧은 `naming.rs:44-78`이 이미 쓰는 정보다. ⑧이 없으면 기본 템플릿이 종류별 머리를 다시 만들 수 없다(T1). ⑤는 `ContentMeta`에는 없지만 같은 자리에서 `ContentRef`로 바로 얻는다(`dto.rs:500-503`의 `r.content`, `model.rs:19-30`). 사용자가 예로 든 토큰이고 이름 겹침을 줄인다. ④는 이름을 만드는 시점(resolve, `dto.rs:494`)에 화질이 아직 정해지지 않았다. 카드가 이름을 한 번만 넣으므로(`ResolveCard.svelte:71`·`:86`) 화질을 바꿀 때마다 다시 만들어야 하고, 사용자가 고친 이름과 부딪힌다. ⑥은 영상 배지(빠른 다시보기/일반 VOD)가 재생 종류(`r.kind()`, `dto.rs:504`)에서 나오고, "클립"·"생방송"은 ⑧이 이미 담는다. ⑦은 지금 생방송 머리에만 쓰인다(`naming.rs:58-60`). ④⑥⑦은 나중에 더해도 옛 템플릿이 깨지지 않는다(새 토큰은 추가만 한다). 되돌린 옛 앱이 새 토큰이 든 템플릿을 읽으면 파싱에 실패하고, 관대한 읽기(§4.2)로 `None`(기본 이름)이 되어 해가 없다 | 확인(경로) · 가정(수요) |
| **T3** | 빈 토큰과 구분자 | (가) 값이 빈 토큰 **바로 뒤**의 리터럴이 구분 문자(공백 `-` `_` `.` `~` `,` `·`)로만 되어 있으면 함께 지운다. 빈 토큰 뒤에 다른 토큰이 없으면 바로 앞의 구분 문자 리터럴을 지운다 / (나) 지우지 않는다(`[] - 제목`이 남는다) / (다) 선택 구간 문법(`[ … ]` 안이 모두 비면 지운다)을 둔다 | **(가)** | (가)만으로 기본 템플릿이 지금 규칙을 다시 만든다. 날짜가 없는 영상은 `{prefix}` 뒤 공백이 빠진다(`naming.rs:73-76`). 채널이 비면 `{channel}` 뒤 ` - `가 빠진다(`:79`·`:90`). (다)는 `[`·`]`가 지금 이름에 리터럴로 쓰여(`:175` 괄호 유지) 탈출 문법이 필요해진다. (나)는 클립에 `{date}`를 쓰면 바로 `[] 채널`이 된다(`info.rs:457-458`) | 확인 |
| **T4** | 저장할 때 검증 | (가) OS와 무관한 규칙만 본다. 중괄호 짝, 모르는 토큰, 같은 토큰 두 번, `/`·`\`, `{title}` 필수, 템플릿 100바이트 이하 [잠정]. 그 밖의 OS별 문자(`:`·`?` 등)는 정리 단계가 바꾼다 / (나) Windows 금지 문자 전체(`\ : * ? " < > \|`)를 거부한다 / (다) 검증하지 않고 정리만 한다 | **(가)** | 실제 규칙 OS는 볼륨에 따라 정해져 저장할 때는 알 수 없다(`services.rs:536`). 정리가 OS별 문자를 이미 바꾼다(`naming.rs:143-144`). `{title}` 필수는 결과가 비지 않게 하는 가장 작은 규칙이다(제목은 비어도 `_`, `naming.rs:48-50`). 클립의 `{date}`처럼 비는 토큰만 쓴 템플릿을 막는다. 같은 토큰 두 번을 막는 이유는 길이 맞추기(T5)가 줄일 대상을 하나로 정해야 해서다. 100바이트 [잠정]은 가장 긴 고정 토큰(`{prefix}` 생방송 23바이트)을 더해도 제목 몫 60바이트(`naming.rs:18`)를 남기는 여유다. 근거 없는 수치라 ADR-0009 묶음에 등록한다 | 확인 · 잠정(100) |
| **T5** | 길이 맞추기 | (가) 엔진이 만들 때 맞춘다. `{title}`·`{channel}`만 줄일 수 있는 값으로 보고, 나머지(리터럴·`{prefix}`·`{date}`·`{no}`)의 길이를 뺀 몫을 `fit_channel_title`과 같은 규칙으로 나눈다(제목 먼저, 60바이트 바닥). `{channel}`이 없으면 제목만 줄인다 / (나) `output_path`의 끝 자르기에 맡긴다 | **(가)** | `output_path`는 이름 끝부터 자른다(`naming.rs:224-228`). (나)에서는 `{title} [{date}]` 같은 템플릿의 뒤쪽 날짜와 번호가 잘린다. (가)는 기존 함수(`:96-107`)를 그대로 다시 쓴다 | 확인 |
| **T6** | 설정에서 저장하는 방식 | (가) 쿠키처럼 [저장] 버튼을 둔다(예외를 하나 더한다). 검증 오류는 칸 바로 아래 inline으로 보인다 / (나) blur 때 저장하고 그때 검증한다 / (다) 타이핑할 때마다 즉시 저장하고, 잘못된 값은 저장하지 않는다 | **(가)** | 검증은 제출 때만 하고 blur 때는 하지 않는다(`patterns.md:357`). 그래서 (나)·(다)는 검증 규칙과 부딪힌다. 쿠키 [저장]이 이미 있는 예외다(`:271`·`:363`). 예외 목록 표(`:271`)와 §14.4 표(`:814`)에 한 줄을 더한다. 새 D 번호가 필요한지는 디자인 시스템 리뷰에서 정한다(예외를 더하는 것이라 D64 후보) | 확인 |
| **T7** | 미리보기와 검증을 어디서 하나 | (a) Rust command `preview_file_name_template(template)` 하나가 검증 결과와 예시 이름들을 **데이터로** 돌려준다. TS는 그리기만 한다 / (b) TS에 파서·렌더러·OS별 정리를 옮기고 Rust와 같은 골든을 읽는다(`design/format` 패턴, `crates/shell/tests/format_golden.rs:1-13`, `app/src/lib/format/format.test.ts:75`) | **(a)** | 정리 규칙(예약어·멱등·Windows 끝 `.`, `naming.rs:170-213`)은 fuzz와 전수 테스트로 굳힌 코드다(`:472-526`). TS로 옮기면 두 번째 구현이 생긴다. (a)는 볼륨 OS 규칙(`services.rs:536`)까지 실제 받기와 같다. 대가는 command 하나다. AuthGate는 기본 거부라 목록을 고칠 필요는 없다(`crates/shell/src/gate.rs:1-6`). 그 밖에 `api.ts` 래퍼, 가짜 백엔드 분기, 150ms 디바운스가 든다(구간 미리보기 선례 `patterns.md:403`). 골든은 (a)에서도 둔다. `design/naming/template.json`을 Rust 코어 테스트와 가짜 백엔드 테스트가 함께 읽는다(§7.2). (b)를 고르면 `format_golden.rs`가 모르는 `fn`에 panic하므로 새 `fn`을 양쪽에 더한다 | 확인 |
| **T8** | 클립·생방송 녹화·구간 받기에도 쓰나 | (가) 클립과 생방송에도 같은 템플릿을 쓴다(종류 차이는 `{prefix}`가 담는다). 구간 받기는 템플릿 결과 뒤에 지금 접미사를 그대로 붙인다 / (나) 종류별로 템플릿을 따로 둔다 / (다) VOD에만 쓴다 | **(가)** | 세 종류가 모두 같은 함수(`dto.rs:494`)를 지난다. 구간 접미사는 다른 층(`output.rs:48-51`)에서 붙고, 기호 형식은 확정된 R2다(`range.md` 머리). (나)는 입력칸이 셋이 된다(UX 기준 ① "복잡하면 안 된다"). 생방송에서 `{prefix}`를 빼면 같은 방송을 다시 녹화할 때 이름이 겹친다. 하지만 지금 번호 이름이 이 경우를 이미 처리한다(`output.rs:58-69`, 녹화 `.part`도 번호 이름을 받는다) | 확인 |

## 4. 설계

### 4.1 코어(`crates/core/src/naming.rs`)

새 공개 항목:
- `pub struct FileNameTemplate`: 파싱된 조각 목록(`Literal(String)` | `Token(Token)`). 이 값은 `parse` 결과로만 만들 수 있다.
- `pub enum Token { Title, Channel, Date, No, Prefix }`: 이름은 `title`·`channel`·`date`·`no`·`prefix`다(T2).
- `pub const DEFAULT_TEMPLATE: &str = "{prefix} {channel} - {title}";`
- `pub fn parse_template(s: &str) -> Result<FileNameTemplate, TemplateError>`
- `pub enum TemplateError { UnbalancedBrace, UnknownToken(String), DuplicateToken(Token), PathSeparator, MissingTitle, TooLong }`: 오류는 하나만 돌려준다. 순서는 짝 → 모르는 토큰 → 중복 → 경로 구분자 → 제목 → 길이다.
- `pub fn render_filename(t: &FileNameTemplate, meta: &ContentMeta, content: &ContentRef, p: Platform) -> String`: 결과는 `sanitize_filename`을 거친 `….mp4`이고 200바이트 이하다(`default_filename`과 같은 계약).

`default_filename`은 **그대로 둔다**(T1).

토큰 값(정리 전):

| 토큰 | 값 | 비는 경우 | 근거 |
|---|---|---|---|
| `{title}` | `trim_piece(clean_component(title))`, 비면 `_` | 비지 않는다 | `naming.rs:47-50` |
| `{channel}` | `clean_component(channel_name)` | 채널 이름이 없을 때 | `:44` |
| `{date}` | `YYMMDD`. 영상은 `live_open_date`, 없으면 `publish_date`. 생방송은 `live_open_date`. 클립은 없음 | 날짜를 못 읽을 때, 클립 | `:56`, `:67-72`, `info.rs:457-458` |
| `{no}` | `Video{video_no}`는 그 수, `Clip{clip_id}`는 그 ID. `Live`는 없음(방송 번호는 사용자에게 보이는 값이 아니다) | 생방송 | `model.rs:19-30` |
| `{prefix}` | 지금 머리에서 끝 공백을 뺀 것: `[YYMMDD]` / `[클립]` / `[생방송 YYMMDD-HHMM]` / `[생방송 YYMMDD]` / `[생방송]` | 날짜 없는 영상 | `:52-78` |

만드는 순서:
1. 토큰 값을 구한다.
2. T3 규칙으로 빈 토큰 옆의 구분 문자 리터럴을 지운다.
3. 리터럴은 `normalize_chars`를 거친다(제어 문자 제거·공백 정리).
4. T5 규칙으로 `{title}`·`{channel}`을 줄인다. 몫은 `MAX_FILENAME_BYTES - ".mp4" - (나머지 조각 길이)`이다.
5. 줄인 뒤 채널이 비면 2를 다시 적용한다(길이는 줄기만 한다, `naming.rs:89-90`과 같다). 제목이 비면 `_`로 채우고 그 1바이트를 채널에서 뺀다(`:84-88`과 같다).
6. `sanitize_filename(조립 + ".mp4", p)`.

`{title}`이 하나뿐이고 한 번만 나오므로(T4) 5의 규칙이 `default_filename`과 같은 모양이 된다. 기본 템플릿을 이 순서로 만든 결과가 `default_filename`과 같은지는 §7.2가 확인한다.

### 4.2 설정(`crates/core/src/settings.rs`)

- `UserSettings.file_name_template: Option<String>`. `#[serde(deserialize_with = "template_or_none")]`과 구조체의 `default`를 쓴다. 키가 없으면 `None`이다. 파싱에 실패한 값(손으로 고친 값)이나 문자열이 아닌 값도 `None`으로 읽는다(`lenient_or_default`와 같은 결, `settings.rs:171`). 그래서 **옛 설정 파일이 그대로 읽히고 `!` 변경이 아니다.** 옛 앱이 새 설정 파일을 읽을 때는 모르는 키를 무시한다. `deny_unknown_fields`가 없기 때문이다(`settings.rs:48-50` [확인]).
- `schema_version`은 올리지 않는다(필드 추가만 한다).
- 옛 Go 설정 가져오기에는 옮길 값이 없다. 가져온 설정의 이 필드는 `None`이다(`legacy.rs:178-185`가 `..UserSettings::default()`로 만들므로 손댈 곳이 없다 [확인]).

### 4.3 셸(`crates/shell`)

- `ResolvedDto::new`에 `template: Option<&FileNameTemplate>`를 더한다. `None`이면 `default_filename`, 있으면 `render_filename`이다(`dto.rs:494`). `services.rs:531`이 저장된 값을 파싱해 넘긴다. 저장할 때 이미 검증했으므로 파싱 실패는 `None`과 같다.
- `SettingsDto.file_name_template: Option<String>`(`dto.rs:345`)와 `SettingsPatch.file_name_template: Nullable<String>`. `null`이면 `None`으로 돌린다(기본값으로). 문자열이면 `parse_template`을 다시 돌려 실패 시 `invalidInput`을 낸다. 화면이 먼저 막으므로 이것은 가드다. `DEFAULT_TEMPLATE`과 같은 문자열이면 `None`으로 저장한다(T1). `services.rs:252-258` 문서 주석에 한 줄을 더한다.
- 새 command `preview_file_name_template(template: String) -> FileNameTemplatePreview`(T7 (a)). 반환은 `{ ok: true, names: [{ kind, name }] } | { ok: false, error: TemplateErrorDto }`이고, 오류는 `AppError`가 아니라 데이터다(입력 중 상태라 오류 배너가 아니다). 예시 값은 §5.3의 가짜 메타 셋(영상·클립·생방송)이다. 규칙 OS는 `volume::platform_for_dir(effective_download_folder)`다. 로그인 뒤 command이고 `gate.rs` 목록은 고치지 않는다.
- `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`.

### 4.4 이미 만든 작업(`jobs.json`)

템플릿은 **카드의 제안 이름만** 바꾼다. 받기 요청은 카드에 있던 이름을 싣는다. 작업은 그 이름으로 계산한 `output`을 만들 때 저장하고(`manager.rs:533-535`, `jobs.rs:59`), 그 뒤로 이어받기·자동 이어받기·`.part`·sidecar는 모두 저장된 `output`을 쓴다(`jobs.rs:7` 이어받기 동일성 키에 `output`이 있다). 그래서 템플릿을 바꿔도 진행 중이거나 대기 중인 작업의 `.part`는 고아가 되지 않는다. `JOBS_VERSION`과 sidecar 형식도 바뀌지 않는다. 이미 열려 있는 카드는 resolve 때 받은 제안 이름을 그대로 둔다(다시 불러오면 새 템플릿을 쓴다).

### 4.5 카드별 파일 이름 수정과 구간 접미사

- 카드의 파일 이름 칸(`FilenameField.svelte`)은 바꾸지 않는다. 템플릿 결과가 `suggested`가 되고, 사용자가 고친 이름이 이긴다. [원래 이름으로]는 템플릿 결과로 돌아간다(`FilenameField.svelte:28-30`). 문구 `filename.reset`("원래 이름으로")은 그대로 둔다. "원래"는 "이 카드의 처음 제안"을 뜻하고, 템플릿이 정한 이름도 여기에 든다.
- 구간 받기는 템플릿 결과에 ` (H.MM.SS~H.MM.SS)`를 붙인다(`output.rs:48-51`). `range_stem`이 이름 쪽을 줄이므로(`naming.rs:255-268`) 접미사는 잘리지 않는다. 다만 이것은 이름 **끝**을 자르는 것이라 템플릿에서 `{title}` 뒤에 있는 토큰(예: `{no}`)이 먼저 잘릴 수 있다(§9 위험).

## 5. 앱(`app/`)

### 5.1 와이어프레임(설정 › 받기, T6 (가))

```
│  받기                                                                      │
│  ┌────────────────────────────────────────────────────────────────────┐    │
│  │ 동시에 받는 영상 수                                       [ 2 ▾ ]   │    │
│  │ …                                                                   │    │
│  │────────────────────────────────────────────────────────────────────│    │
│  │ 파일 이름 규칙                                                       │    │ settings.fileNameTemplate
│  │ [ {prefix} {channel} - {title}                         ]  [저장]     │    │ TextField + secondary sm(저장된 값과 다를 때만 그린다)
│  │ 쓸 수 있는 말: {title} {channel} {date} {no} {prefix}                 │    │ settings.fileNameTemplate.help caption muted
│  │ 예: [261018] 채널이름 - 저녁 방송.mp4                                  │    │ settings.fileNameTemplate.preview caption muted, 영상 예시 한 줄
│  │ [기본값으로]                                                          │    │ ghost sm, 기본이 아닐 때만(사유 없는 비활성 금지, patterns §6.4)
│  └────────────────────────────────────────────────────────────────────┘    │
```

- 행은 "받기" 구역의 마지막이다. 자리는 `SettingsView.svelte:90-151` 안이고 `keepAwake` 뒤다. 컴포넌트는 `components/settings/FileNameTemplateRow.svelte` 하나를 새로 만들고, 기존 `SettingsRow`·`TextField`·`Button`만 조합한다(새 ui 컴포넌트는 없다, governance §5).
- 미리보기는 입력이 바뀐 뒤 150ms 디바운스로 command를 부른다. 결과가 `ok: false`면 미리보기 줄을 비운다. **오류는 보이지 않는다**(타이핑 중 오류 없음, `patterns.md:357`). 예시는 영상 한 줄만 보인다. 클립·생방송 예시는 `Disclosure`로 펼치지 않는다(최소). 대신 command가 셋을 돌려주므로 E2E와 단위 테스트가 셋을 모두 본다.
- [저장]을 누르면 미리보기 command의 마지막 결과가 아니라 **새로 부른** 결과로 검증한다. `ok: false`면 칸 아래에 inline danger(`Notice form=inline tone=danger`, `role="alert"`), `aria-invalid`, 포커스를 준다(`patterns.md:358`). `ok: true`면 `settings.patch({ fileNameTemplate })`를 보낸다. 저장 실패는 B2다(`:814`).
- [저장]은 칸 값이 저장된 값과 다를 때만 그린다. [기본값으로]도 같은 규칙이다(사유 없는 비활성은 두지 않는다, `patterns.md` §6.4, `FilenameField.svelte:27-28` 선례).
- [기본값으로]는 `settings.patch({ fileNameTemplate: null })`이고 확인 대화상자가 없다(가역, `patterns.md:271`).
- 입력칸에는 IME가 있으므로 Enter에 동작을 달지 않는다(`FilenameField.svelte:3`과 같은 이유).

### 5.2 copy deck 초안(`app/src/lib/copy/ko.ts`, content.md §15.1에 등록)

| 키 | 문구(초안) |
|---|---|
| `settings.fileNameTemplate` | **파일 이름 규칙** |
| `settings.fileNameTemplate.help` | **쓸 수 있는 말: {title} 제목 · {channel} 채널 · {date} 날짜 · {no} 영상 번호 · {prefix} 날짜나 종류 머리** |
| `settings.fileNameTemplate.preview` | **예: {name}** |
| `settings.fileNameTemplate.save` | **저장** |
| `settings.fileNameTemplate.reset` | **기본값으로** |
| `settings.fileNameTemplate.error.brace` | **중괄호 { } 짝이 맞지 않아요.** |
| `settings.fileNameTemplate.error.unknown` | **{token}은 쓸 수 없는 말이에요.** |
| `settings.fileNameTemplate.error.duplicate` | **{token}은 한 번만 쓸 수 있어요.** |
| `settings.fileNameTemplate.error.separator` | **/ 와 \\ 는 쓸 수 없어요. 폴더는 만들지 않아요.** |
| `settings.fileNameTemplate.error.title` | **{title}이 들어가야 해요.** |
| `settings.fileNameTemplate.error.tooLong` | **규칙이 너무 길어요. {max}바이트 안으로 줄여 주세요.** (`max`는 셸 DTO가 코어 `MAX_TEMPLATE_BYTES`를 준다, app.md 92) |

- 문구는 `design-copy` 규칙(어미·마침표·금지어)을 통과해야 한다. "저장"은 영상에는 쓰지 않는 말이지만(content.md §4), 여기서는 설정에 쓰므로 쿠키 [저장]과 같다. 바이트라는 말은 [잠정]이다. 사용자에게 낯설면 글자 수로 바꾸는 것을 F(카피)가 정한다.
- `{token}` 자리 치환은 `ko.ts`의 `t()` 인자 규칙을 따른다. 문구 안의 `{title}` 같은 리터럴 중괄호는 `t()`가 치환하지 않게 해야 한다. 구현 때 `t()`의 탈출 규칙을 확인하고, 없으면 인자로 넘긴다(`{example}`).

### 5.3 예시 값(가짜)

| 종류 | 메타 | 기본 템플릿 결과 |
|---|---|---|
| 영상 | 채널 `채널이름`, 제목 `저녁 방송`, `live_open_date` `2026-10-18 21:00:00`, `Video{12345}` | `[261018] 채널이름 - 저녁 방송` |
| 클립 | 채널 `채널이름`, 제목 `웃긴 장면`, 날짜 없음, `Clip{abcDEF123}` | `[클립] 채널이름 - 웃긴 장면` |
| 생방송 | 채널 `채널이름`, 제목 `오늘 방송`, `live_open_date` `2026-10-18 20:30:00`, `Live{…}` | `[생방송 261018-2030] 채널이름 - 오늘 방송` |

예시 메타는 셸 상수(`crates/shell/src/consts.rs` 또는 `naming_preview.rs`) 한 곳에 두고, 날짜는 고정한다(오늘 날짜를 쓰지 않는다. 골든이 날마다 바뀌면 안 된다).

### 5.4 가짜 백엔드·E2E

- `app/e2e/mock/backend.ts`: `preview_file_name_template`은 골든 `design/naming/template.json`의 `preview` 케이스를 표로 읽어 답한다. 표에 없는 입력은 **실패한다**(기본 결과로 대신 답하면 E2E가 잘못된 값으로 오류 흐름을 시험해도 통과한다, app.md 92). 불러온 영상의 제안 이름은 같은 파일의 `cases` 중 규칙·영상 메타가 같은 linux 행에서 찾는다. `update_settings`의 `fileNameTemplate`는 패치를 그대로 반영한다(`backend.ts:332`).
- Playwright `app/e2e/`: 설정 › 받기에서 ① 기본 문자열이 보이고 [기본값으로]가 없다 ② `{date}_{title}`을 치면 미리보기가 바뀐다 ③ `{foo}`로 [저장]하면 inline 오류가 뜨고 `aria-invalid`가 된다 ④ 올바른 값을 저장하면 [기본값으로]가 나타나고, 누르면 사라진다 ⑤ 저장 뒤 영상을 불러오면 카드 제안 이름이 새 규칙을 따른다. axe는 이 행에도 돈다.
- 네이티브 E2E는 바꾸지 않는다(기본값 경로이고 결과가 같다).

## 6. 오류 종류

새 `AppError` 종류는 없다. 템플릿 오류는 미리보기 command가 데이터로 돌려주고, `update_settings`의 가드는 기존 `invalidInput`을 쓴다(`dto.rs` 오류 종류 표, `app/src/lib/copy/errors.ts:121`·`:531`).

## 7. 테스트 계획(TDD)

### 7.1 코어 단위(`naming.rs` tests)
- `parse_template`: 오류 종류마다 실패 테스트를 먼저 쓴다. `"{title"`·`"title}"`·`"{}"`·`"{{title}}"`(짝), `"{foo}"`·`"{Title}"`(대소문자 구분, 모르는 토큰), `"{title}{title}"`, `"{date}/{title}"`·`"a\\{title}"`, `"{date}"`, 101바이트.
- 세 OS(`ALL`) 모두에서: 템플릿 리터럴의 `:`·`?`·`*`가 OS별로 바뀐다. Windows에서는 예약어(`"CON {title}"`에 빈 제목 → `CON _`가 아닌지 등, 실제 결과를 손으로 계산해 고정), 끝 `.`·공백, 결과가 `sanitize_filename`에 대해 멱등이다.
- T3: 클립의 `{date} {title}` → `제목`. 채널이 빈 `{channel} - {title}` → `제목`. `{title} - {channel}` + 빈 채널 → `제목`.
- T5: `{title} [{date}] {no}` + 300바이트 제목 → 200바이트 이하이고, 끝이 `[240102] 12345.mp4`다(날짜와 번호가 남는다).
- 엔진을 깨서 테스트가 잡는지 확인한다. 예를 들어 T3 규칙을 끄면 `default_equivalence`가 실패해야 한다.

### 7.2 골든(`design/naming/template.json`)
- `$comment`: 손으로 계산한 기대값. Rust(`crates/core/tests/naming_golden.rs`)와 가짜 백엔드 테스트(`app/e2e/mock/*.test.ts` 또는 `app/src/lib/...test.ts`)가 같은 파일을 읽는다(`design/format/date.json:2` 선례).
- 케이스 형식: `{ "name", "template", "meta", "content", "platform", "out" | "error" }`. `preview` 묶음은 §5.3 예시 셋의 출력이다.
- **`default_equivalence`**: Rust 테스트가 `naming.rs`의 기존 테스트 입력 전부에 대해 `render_filename(parse(DEFAULT_TEMPLATE)) == default_filename`인지 본다. 대상은 fixture 셋(`:549-565`), fallback(`:567-595`), 생방송(`:597-617`), 길이(`:619-653`), 예산 경계(`:655-688`), Windows 끝 `.`(`:690-701`)이다. 세 OS 모두이고, 여기에 작은 알파벳 전수(`:507-526` 방식)로 채널·제목·날짜 조합을 더한다. 이 테스트가 T1 (가)의 "기본 문자열을 직접 쳐도 같다"를 보장한다.

### 7.3 셸
- `dto_json.rs`: 템플릿 `None`이면 `suggestedFileName`이 지금 기대값과 같다(`crates/shell/tests/dto_json.rs:410`이 손대지 않고 통과한다). 템플릿이 있으면 그 결과다.
- 설정: 옛 설정 JSON(키 없음)·`null`·숫자·잘못된 템플릿 문자열이 모두 `None`으로 읽힌다. 패치 `null` → `None`, 기본 문자열 → `None`, 잘못된 값 → `invalidInput`이고 저장된 값은 그대로다.
- 작업: 템플릿을 바꾼 뒤 대기 중인 작업과 `jobs.json`을 다시 읽은 작업의 `output`이 그대로다(경로를 다시 계산하지 않는다는 회귀 테스트).
- `preview_file_name_template`: FAT 볼륨을 흉내 낼 수 있으면 Windows 규칙이 적용되는지 본다(`volume` seam이 있으면). 없으면 `Platform`을 인자로 받는 내부 함수로 테스트한다.

### 7.4 앱
- vitest: `FileNameTemplateRow` 상태(기본/바뀜/오류/저장 중), [기본값으로]가 보이는 조건, 디바운스.
- `design-copy`: 새 키의 어미·마침표 규칙.
- Playwright: §5.4.

## 8. 단계(stacked PR)

| 단계 | 커밋 타입 | 내용 | gate |
|---|---|---|---|
| N-1 코어 | `refactor` | `naming.rs` `FileNameTemplate`·`parse_template`·`render_filename`·`DEFAULT_TEMPLATE`, 골든 `design/naming/template.json` + `crates/core/tests/naming_golden.rs`(`default_equivalence` 포함). `UserSettings.file_name_template`(관대한 읽기). core.md 75 | `fmt`·`rust`·`scan` |
| N-2 셸 | `refactor` | `ResolvedDto::new` 템플릿 인자, `SettingsDto`·`SettingsPatch` 필드, `preview_file_name_template` command(앱 배선 `app/src-tauri` 포함), bindings 재생성, 가짜 백엔드 분기. app.md 91 | `rust`·`tauri-clippy`·`tauri`·`frontend` |
| N-3 앱 | `feat` | `FileNameTemplateRow`, copy deck(content.md §15.1·patterns §14.4·T6 예외 행), Playwright, ROADMAP 체크 | `frontend`·`design-tokens`(design-copy 포함)·`e2e-web` |

N-1·N-2는 사용자에게 보이는 변화가 없다(설정 행이 없어 템플릿이 늘 `None`). 그래서 `refactor`로 적고, 기능을 여는 N-3만 `feat`로 적는다(`docs/versioning.md`: 올림 자리는 사용자에게 보이는 기능이 정한다). 최종 판단은 구현 때 `release.mjs next-version`으로 확인한다.

## 9. 위험

| 위험 | 대응 |
|---|---|
| 기본 문자열을 엔진으로 만든 결과가 어떤 입력에서 `default_filename`과 다르다 | `None`일 때는 엔진을 타지 않는다(T1 (가)). 다른 결과는 "사용자가 기본 문자열을 직접 친 경우"에만 나오고, `default_equivalence`(§7.2)가 이것을 잡는다. 저장할 때 기본 문자열을 `None`으로 바꾸므로 실제로는 직접 친 값도 엔진을 타지 않는다 |
| 번호 이름(` (2)`)과 구간 접미사는 이름 **끝**을 잘라 자리를 만든다(`output.rs:131-138`, `naming.rs:262-263`). `{title}`이 앞에 있지 않으면 뒤쪽 토큰이 잘린다 | 이름이 200바이트에 가까울 때만 일어난다(T5가 이미 제목을 줄여 둔다). v1은 받아들이고 도움말에 쓰지 않는다 [가정: 드물다]. 다시 열 조건: 사용자 보고 |
| 볼륨 OS와 미리보기 OS가 다르다(예: macOS에서 exFAT 외장 디스크) | (a) 미리보기 command가 저장 폴더 볼륨 기준이라 같다. 다만 카드에서 폴더를 바꾸면(`FolderField`) 실제 OS가 미리보기와 다를 수 있다. 카드의 "저장될 이름" 안내(`filename.willSaveAs`)가 이 경우를 보여 준다(`ResolveCard.svelte:316`) |
| 생방송에서 `{prefix}`를 빼 같은 방송의 녹화 이름이 겹친다 | 번호 이름이 처리한다(`output.rs:58-69`). 녹화 `.part`도 번호 이름을 받는다(L7) |
| `{no}` 값(영상 번호)이 파일 이름에 남는다 | 사용자가 고른 토큰이고 공개 저장소 규칙과는 무관하다(사용자 자기 파일이다). 문서·테스트에는 가짜 번호만 쓴다 |
| 화면에 보인 이름과 실제 저장 이름이 다르다(`sanitize`가 마지막 `.` 앞 공백을 지운다. 셸은 `.mp4`를 뗀 이름을 받을 때 다시 정리한다) | 해결함(core.md 76). 코어가 `suggested_stem` → `output_path` 왕복을 이름이 안 변할 때까지 돌려 그 결과만 돌려준다. 기본 규칙(`default_filename`)에 전부터 있던 같은 문제도 함께 고쳤고, 저장되는 이름은 바뀌지 않는다(T1 유지) |
| **알려진 한계**: 빈 토큰을 감싼 리터럴 괄호는 남는다. `[{date}] {title}`은 클립에서 `[] 웃긴 장면.mp4`, `{title} [{no}]`는 생방송에서 `오늘 방송 [].mp4`가 된다(T3은 구분 문자만으로 된 리터럴만 지운다, 골든 preview가 이 결과를 고정한다). 설정 화면은 영상 예시 한 줄만 보여 사용자가 미리 알기 어렵다. 같은 규칙이 OS마다 다르게 정리되기도 한다(`{date}: {title}`은 Windows·macOS에서 `:`가 `_`가 되어 구분 문자로 지워지고, Linux에서는 `: 웃긴 장면`으로 남는다) | v1은 받아들인다(app.md 92 ④). 고르는 길: (a) 클립·생방송 예시를 보조 줄이나 `Disclosure`로 보인다(command가 이미 셋을 돌려준다), (b) T3를 넓혀 빈 토큰을 감싼 `[]`·`()`도 지운다(기본 규칙 동등성에는 영향 없음, 골든 갱신), (c) 지금대로. 다시 열 조건: 사용자 보고 또는 T3 재선택 |
| 옛 앱으로 되돌아갈 때(롤백) | 옛 앱은 모르는 키를 무시하므로(`deny_unknown_fields` 없음) 기본 이름으로 돌아간다. 다시 올리면 저장된 템플릿이 그대로 읽힌다. `!`가 아니다 |

## 10. 사용자 실측

없다. 오프라인 테스트로 모두 정해진다. 머지 뒤 실기 확인 한 번만 한다. 설정에서 템플릿을 바꾼 뒤 영상 하나를 불러와 제안 이름을 보고, 받은 파일 이름이 Finder·탐색기에서 미리보기와 같은지 본다. 클립·생방송에서 규칙 때문에 `[]` 같은 빈 괄호가 남는 규칙(§9 알려진 한계)도 한 번 써 보고 받아들일 만한지 정한다.
