//! `Chzzk::collect_chat` 통합 테스트(기능 ④-3a, chat.md §3.2·§9.2). 네트워크는 wiremock뿐이다.
//!
//! 페이지 사슬은 합성 fixture 셋이다: 커서 0 → `page_first`(5개, 다음 15000) → 15000 → `page_boundary`
//! (15000의 되풀이 1 + 새 메시지 2, 다음 17000) → 17000 → `page_last_null`(1개, 다음 없음). 모두 8줄이다.

mod common;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use chzzk_core::chat::part::ChatPart;
use chzzk_core::chat::{
    CHAT_PAGE_INTERVAL_MS, ChatEnd, ChatOutcome, ChatProgress, ChatRequest, SubtitleFormat,
    chat_retry_policy,
};
use chzzk_core::naming::sibling_path;
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, DuplicatePolicy, Error, NaverCookies, RequestKind,
    RetryPolicy,
};
use common::fixture;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockBuilder, MockServer, Request, Respond, ResponseTemplate};

const VOD_NO: u64 = 9000002;
const CHATS: &str = "/service/v1/videos/9000002/chats";

// ---- 도구 ----

fn json(body: Vec<u8>) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_raw(body, "application/json")
}

fn page(name: &str) -> Vec<u8> {
    fixture(&format!("testdata/chat/{name}"))
}

/// 합성 페이지 한 장(메시지는 `(재생 위치, 작성자 번호)`).
fn inline_page(next: Option<u64>, msgs: &[(u64, u32)]) -> Vec<u8> {
    let chats: Vec<String> = msgs
        .iter()
        .map(|(o, u)| {
            format!(
                r#"{{"playerMessageTime":{o},"userIdHash":"user-hash-{u:02}","content":"합성 {u}","messageTime":{o},"messageTypeCode":1,"messageStatusType":"NORMAL"}}"#
            )
        })
        .collect();
    let next = next.map_or("null".to_string(), |n| n.to_string());
    format!(
        r#"{{"code":200,"message":null,"content":{{"nextPlayerMessageTime":{next},"previousVideoChats":[],"videoChats":[{}]}}}}"#,
        chats.join(",")
    )
    .into_bytes()
}

fn at(cursor: u64) -> MockBuilder {
    Mock::given(method("GET"))
        .and(path(CHATS))
        .and(query_param("playerMessageTime", cursor.to_string()))
        .and(query_param("previousVideoChatSize", "50"))
}

async fn mount_at(server: &MockServer, cursor: u64, resp: impl Respond + 'static) {
    at(cursor).respond_with(resp).mount(server).await;
}

/// 정상 사슬 셋.
async fn mount_chain(server: &MockServer) {
    mount_at(server, 0, json(page("page_first.json"))).await;
    mount_at(server, 15000, json(page("page_boundary.json"))).await;
    mount_at(server, 17000, json(page("page_last_null.json"))).await;
}

/// 재시도 대기만 1ms로 줄인다. 횟수(`max_attempts`)는 제품 값 그대로라 경계 테스트가 의미를 가진다.
fn config(server: &MockServer) -> ClientConfig {
    ClientConfig {
        chat_page_interval: Duration::from_millis(1),
        chat_retry: RetryPolicy {
            base: Duration::from_millis(1),
            cap: Duration::from_millis(4),
            ..chat_retry_policy()
        },
        ..common::config(server)
    }
}

fn chzzk(server: &MockServer) -> Chzzk {
    Chzzk::new(config(server)).unwrap()
}

struct Env {
    _dir: tempfile::TempDir,
    video: PathBuf,
}

impl Env {
    fn new() -> Env {
        let dir = tempfile::tempdir().unwrap();
        let video = dir.path().join("영상.mp4");
        Env { _dir: dir, video }
    }
    fn record(&self) -> PathBuf {
        sibling_path(&self.video, ".chat.jsonl")
    }
    fn ass(&self) -> PathBuf {
        sibling_path(&self.video, ".ass")
    }
    fn srt(&self) -> PathBuf {
        sibling_path(&self.video, ".srt")
    }
    fn req(&self, subtitle: SubtitleFormat) -> ChatRequest {
        ChatRequest {
            video_no: VOD_NO,
            output: self.video.clone(),
            subtitle,
            duration_ms: Some(60_000),
            restart: false,
            on_existing: DuplicatePolicy::Skip,
        }
    }
}

fn with_suffix(p: &Path, s: &str) -> PathBuf {
    let mut o = p.as_os_str().to_owned();
    o.push(s);
    PathBuf::from(o)
}

fn part_of(p: &Path) -> PathBuf {
    with_suffix(p, ".part")
}

fn sidecar_of(p: &Path) -> PathBuf {
    with_suffix(p, ".part.json")
}

fn lines(p: &Path) -> Vec<String> {
    std::fs::read_to_string(p)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

fn sidecar_cursor(record: &Path) -> u64 {
    let v: serde_json::Value =
        serde_json::from_slice(&std::fs::read(sidecar_of(record)).unwrap()).unwrap();
    v["cursorMs"].as_u64().unwrap()
}

async fn cursors(server: &MockServer) -> Vec<String> {
    server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|r| {
            r.url
                .query_pairs()
                .find(|(k, _)| k == "playerMessageTime")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default()
        })
        .collect()
}

fn no_progress() -> impl Fn(ChatProgress) + Send + Sync {
    |_| {}
}

async fn run(chzzk: &Chzzk, req: ChatRequest) -> Result<ChatOutcome, Error> {
    chzzk
        .collect_chat(req, CancellationToken::new(), &no_progress())
        .await
}

fn is_http(e: &Error, want: u16) -> bool {
    matches!(e, Error::HttpStatus { status, kind: RequestKind::Api } if *status == want)
}

/// 요청을 받은 시각을 적는 응답.
struct Stamp {
    body: Vec<u8>,
    at: Arc<Mutex<Vec<Instant>>>,
}

impl Respond for Stamp {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        self.at.lock().unwrap().push(Instant::now());
        json(self.body.clone())
    }
}

/// 응답하기 직전에 파일을 만든다(받는 동안 같은 이름 파일이 생기는 경쟁).
struct CreateThenRespond {
    body: Vec<u8>,
    file: PathBuf,
    bytes: &'static [u8],
}

impl Respond for CreateThenRespond {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        if !self.file.exists() {
            std::fs::write(&self.file, self.bytes).unwrap();
        }
        json(self.body.clone())
    }
}

// ---- 정상 ----

#[tokio::test]
async fn three_pages_complete_with_subtitle() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    let seen = Arc::new(Mutex::new(Vec::new()));
    let seen2 = seen.clone();
    let out = chzzk(&server)
        .collect_chat(
            e.req(SubtitleFormat::Ass),
            CancellationToken::new(),
            &move |p: ChatProgress| seen2.lock().unwrap().push(p),
        )
        .await
        .unwrap();
    assert_eq!(
        out,
        ChatOutcome::Completed {
            messages: 8,
            last_offset_ms: Some(20000),
            end: ChatEnd::NoCursor,
            subtitle_failed: false,
        }
    );
    assert_eq!(cursors(&server).await, ["0", "15000", "17000"]);
    let rec = lines(&e.record());
    assert_eq!(rec.len(), 8);
    // 경계 되풀이는 한 번만 들어간다(user-hash-05는 15000에 하나)
    // 줄마다 JSON 객체 하나
    let objs: Vec<serde_json::Value> = rec
        .iter()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert!(objs.iter().all(serde_json::Value::is_object));
    assert_eq!(
        objs.iter()
            .filter(|o| o["userIdHash"] == "user-hash-05" && o["playerMessageTime"] == 15000)
            .count(),
        1
    );
    let ass = std::fs::read_to_string(e.ass()).unwrap();
    assert!(ass.starts_with("[Script Info]"), "{ass}");
    assert!(ass.contains("Dialogue:"));
    // 임시 파일은 남지 않는다
    for p in [
        part_of(&e.record()),
        sidecar_of(&e.record()),
        part_of(&e.ass()),
    ] {
        assert!(!p.exists(), "{}", p.display());
    }
    assert!(!e.srt().exists());
    // 진행률: 페이지마다, 메시지 수는 누적, 길이를 싣는다
    let seen = seen.lock().unwrap();
    assert_eq!(seen.last().unwrap().messages, 8);
    assert!(seen.iter().all(|p| p.duration_ms == Some(60_000)));
    assert!(seen.windows(2).all(|w| w[0].messages <= w[1].messages));
    assert!(seen.iter().any(|p| p.cursor_ms == 15000 && p.messages == 5));
}

#[tokio::test]
async fn srt_and_none_formats() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    run(&chzzk(&server), e.req(SubtitleFormat::Srt))
        .await
        .unwrap();
    assert!(e.srt().exists());
    assert!(!e.ass().exists());
    assert!(std::fs::read_to_string(e.srt()).unwrap().contains(" --> "));

    let e2 = Env::new();
    let out = run(&chzzk(&server), e2.req(SubtitleFormat::None))
        .await
        .unwrap();
    assert!(matches!(out, ChatOutcome::Completed { messages: 8, .. }));
    assert!(e2.record().exists());
    assert!(!e2.ass().exists() && !e2.srt().exists());
}

#[tokio::test]
async fn creates_missing_parent_dir() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("새 폴더").join("영상.mp4");
    let req = ChatRequest {
        output: video.clone(),
        ..Env::new().req(SubtitleFormat::None)
    };
    run(&chzzk(&server), req).await.unwrap();
    assert!(sibling_path(&video, ".chat.jsonl").exists());
}

#[tokio::test]
async fn cursor_not_advancing_keeps_last_page() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_first.json"))).await;
    // 다음 커서가 지금 커서와 같다. 이 페이지의 새 메시지는 기록하고 끝낸다
    mount_at(
        &server,
        15000,
        json(inline_page(Some(15000), &[(16000, 21)])),
    )
    .await;
    let e = Env::new();
    let out = run(&chzzk(&server), e.req(SubtitleFormat::None))
        .await
        .unwrap();
    assert_eq!(
        out,
        ChatOutcome::Completed {
            messages: 6,
            last_offset_ms: Some(16000),
            end: ChatEnd::CursorNotAdvancing,
            subtitle_failed: false,
        }
    );
    assert_eq!(lines(&e.record()).len(), 6);
}

// ---- 400 음성 테스트 (가)(나)(다) ----

/// (가) 첫 페이지 400은 오류다. `Completed`가 아니고 최종 파일도 없다. 재시도하지 않는다.
#[tokio::test]
async fn first_page_400_is_error() {
    let server = MockServer::start().await;
    mount_at(&server, 0, ResponseTemplate::new(400)).await;
    let e = Env::new();
    let err = run(&chzzk(&server), e.req(SubtitleFormat::Ass))
        .await
        .unwrap_err();
    assert!(is_http(&err, 400), "{err:?}");
    assert_eq!(cursors(&server).await, ["0"]);
    assert!(!e.record().exists());
    assert!(!e.ass().exists());
    // 이어받을 자리는 남는다
    assert!(sidecar_of(&e.record()).exists());
}

/// (나) 둘째 페이지 400도 오류다. 첫 페이지 줄은 `.part`에 남고, 다시 부르면 그 커서부터 이어받는다.
#[tokio::test]
async fn second_page_400_keeps_partial_and_resumes() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_first.json"))).await;
    mount_at(&server, 15000, ResponseTemplate::new(400)).await;
    let e = Env::new();
    let c = chzzk(&server);
    let err = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap_err();
    assert!(is_http(&err, 400), "{err:?}");
    assert!(!e.record().exists());
    assert_eq!(lines(&part_of(&e.record())).len(), 5);
    assert_eq!(sidecar_cursor(&e.record()), 15000);

    server.reset().await;
    mount_chain(&server).await;
    let out = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap();
    assert!(
        matches!(
            out,
            ChatOutcome::Completed {
                messages: 8,
                end: ChatEnd::NoCursor,
                ..
            }
        ),
        "{out:?}"
    );
    // 처음부터 다시 긁지 않는다
    assert_eq!(cursors(&server).await, ["15000", "17000"]);
    let rec = lines(&e.record());
    assert_eq!(rec.len(), 8);
    let mut uniq = rec.clone();
    uniq.sort();
    uniq.dedup();
    assert_eq!(uniq.len(), 8, "중복 줄");
}

/// (다) `Completed { messages: 0 }`은 첫 페이지가 2xx이고 비었을 때만 나온다.
#[tokio::test]
async fn empty_first_page_is_completed_zero() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_empty.json"))).await;
    let e = Env::new();
    let out = run(&chzzk(&server), e.req(SubtitleFormat::Ass))
        .await
        .unwrap();
    assert_eq!(
        out,
        ChatOutcome::Completed {
            messages: 0,
            last_offset_ms: None,
            end: ChatEnd::EmptyPage,
            subtitle_failed: false,
        }
    );
    assert_eq!(std::fs::read(e.record()).unwrap(), b"");
    // 빈 기록에도 헤더만 있는 자막이 생긴다
    assert!(
        std::fs::read_to_string(e.ass())
            .unwrap()
            .starts_with("[Script Info]")
    );
}

/// 이어받은 뒤 빈 페이지로 끝나면 수는 0이 아니라 이전까지의 수다.
#[tokio::test]
async fn empty_page_after_messages_counts_previous() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_first.json"))).await;
    mount_at(&server, 15000, json(page("page_empty.json"))).await;
    let e = Env::new();
    let out = run(&chzzk(&server), e.req(SubtitleFormat::None))
        .await
        .unwrap();
    assert!(
        matches!(
            out,
            ChatOutcome::Completed {
                messages: 5,
                end: ChatEnd::EmptyPage,
                last_offset_ms: Some(15000),
                ..
            }
        ),
        "{out:?}"
    );
}

/// 응답 모양이 틀리면 `Parse`이고 `.part`는 남는다.
#[tokio::test]
async fn bad_shape_is_parse_error() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_first.json"))).await;
    mount_at(&server, 15000, json(page("page_bad_shape.json"))).await;
    let e = Env::new();
    let err = run(&chzzk(&server), e.req(SubtitleFormat::None))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Parse { what: "chat", .. }), "{err:?}");
    assert_eq!(cursors(&server).await, ["0", "15000"]);
    assert_eq!(lines(&part_of(&e.record())).len(), 5);
}

// ---- 재시도 ----

async fn mount_fail_then_last(server: &MockServer, status: u16, times: u64) {
    at(0)
        .respond_with(ResponseTemplate::new(status))
        .up_to_n_times(times)
        .with_priority(1)
        .mount(server)
        .await;
    mount_at(server, 0, json(page("page_last_null.json"))).await;
}

/// 재시도 경계(chat.md §3.2-5): 429 세 번 뒤 네 번째 성공은 `Completed`.
#[tokio::test]
async fn three_429_then_success() {
    let server = MockServer::start().await;
    mount_fail_then_last(&server, 429, 3).await;
    let e = Env::new();
    let out = run(&chzzk(&server), e.req(SubtitleFormat::None))
        .await
        .unwrap();
    assert!(matches!(out, ChatOutcome::Completed { messages: 1, .. }));
    assert_eq!(cursors(&server).await.len(), 4);
}

/// 429 네 번이면 `HttpStatus{429}`(시도 4회에서 멈춘다).
#[tokio::test]
async fn four_429_is_error() {
    let server = MockServer::start().await;
    mount_fail_then_last(&server, 429, 4).await;
    let e = Env::new();
    let err = run(&chzzk(&server), e.req(SubtitleFormat::None))
        .await
        .unwrap_err();
    assert!(is_http(&err, 429), "{err:?}");
    assert_eq!(cursors(&server).await.len(), 4);
    assert!(!e.record().exists());
}

#[tokio::test]
async fn server_errors_are_retried() {
    for status in [500u16, 503, 408] {
        let server = MockServer::start().await;
        mount_fail_then_last(&server, status, 2).await;
        let e = Env::new();
        let out = run(&chzzk(&server), e.req(SubtitleFormat::None))
            .await
            .unwrap();
        assert!(matches!(out, ChatOutcome::Completed { .. }), "{status}");
        assert_eq!(cursors(&server).await.len(), 3, "{status}");
    }
}

#[tokio::test]
async fn auth_is_fatal_without_retry() {
    for status in [401u16, 403] {
        let server = MockServer::start().await;
        mount_at(&server, 0, ResponseTemplate::new(status)).await;
        let e = Env::new();
        let err = run(&chzzk(&server), e.req(SubtitleFormat::None))
            .await
            .unwrap_err();
        assert!(
            matches!(err, Error::AuthRequired { status: s } if s == status),
            "{err:?}"
        );
        assert_eq!(cursors(&server).await.len(), 1);
    }
}

// ---- 요청 규칙 ----

#[tokio::test]
async fn cookie_only_when_enabled() {
    for cookies in [false, true] {
        let server = MockServer::start().await;
        mount_chain(&server).await;
        let cfg = ClientConfig {
            cookies: cookies.then(|| NaverCookies::new("a-fake", "s-fake")),
            ..config(&server)
        };
        let e = Env::new();
        run(&Chzzk::new(cfg).unwrap(), e.req(SubtitleFormat::None))
            .await
            .unwrap();
        for r in server.received_requests().await.unwrap() {
            assert_eq!(r.headers.get("cookie").is_some(), cookies);
        }
    }
}

/// 요청 사이 간격은 기본 `CHAT_PAGE_INTERVAL_MS` 이상이다(실제 시계, 아래쪽 경계만 본다).
#[tokio::test]
async fn requests_are_spaced_by_interval() {
    let defaults = ClientConfig::default();
    assert_eq!(
        defaults.chat_page_interval,
        Duration::from_millis(CHAT_PAGE_INTERVAL_MS)
    );
    assert_eq!(defaults.chat_retry, chat_retry_policy());

    let server = MockServer::start().await;
    let stamps = Arc::new(Mutex::new(Vec::new()));
    for (c, name) in [
        (0, "page_first.json"),
        (15000, "page_boundary.json"),
        (17000, "page_last_null.json"),
    ] {
        mount_at(
            &server,
            c,
            Stamp {
                body: page(name),
                at: stamps.clone(),
            },
        )
        .await;
    }
    let cfg = ClientConfig {
        chat_page_interval: defaults.chat_page_interval,
        ..config(&server)
    };
    let e = Env::new();
    run(&Chzzk::new(cfg).unwrap(), e.req(SubtitleFormat::None))
        .await
        .unwrap();
    let stamps = stamps.lock().unwrap();
    assert_eq!(stamps.len(), 3);
    for w in stamps.windows(2) {
        let gap = w[1] - w[0];
        assert!(
            gap >= Duration::from_millis(CHAT_PAGE_INTERVAL_MS),
            "{gap:?}"
        );
    }
}

/// 재시도 요청도 간격을 지킨다.
#[tokio::test]
async fn retries_are_spaced_by_interval() {
    let server = MockServer::start().await;
    mount_fail_then_last(&server, 429, 1).await;
    let cfg = ClientConfig {
        chat_page_interval: Duration::from_millis(200),
        ..config(&server)
    };
    let started = Instant::now();
    run(
        &Chzzk::new(cfg).unwrap(),
        Env::new().req(SubtitleFormat::None),
    )
    .await
    .unwrap();
    assert!(started.elapsed() >= Duration::from_millis(200));
}

// ---- 취소·재개 ----

/// 요청 중에 취소되면 곧바로 `Cancelled`이고, 받은 페이지는 `.part`에 남아 이어받는다.
#[tokio::test]
async fn cancel_mid_request_keeps_partial_and_resumes() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_first.json"))).await;
    mount_at(
        &server,
        15000,
        json(page("page_boundary.json")).set_delay(Duration::from_secs(30)),
    )
    .await;
    let e = Env::new();
    let c = chzzk(&server);
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    let started = Instant::now();
    let err = c
        .collect_chat(
            e.req(SubtitleFormat::Ass),
            cancel,
            &move |p: ChatProgress| {
                if p.messages >= 5 {
                    // 둘째 요청이 걸린 뒤 취소한다
                    let t = trigger.clone();
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        t.cancel();
                    });
                }
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled), "{err:?}");
    assert!(started.elapsed() < Duration::from_secs(10));
    assert!(!e.record().exists());
    assert_eq!(lines(&part_of(&e.record())).len(), 5);
    assert_eq!(sidecar_cursor(&e.record()), 15000);

    server.reset().await;
    mount_chain(&server).await;
    let out = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap();
    assert!(matches!(out, ChatOutcome::Completed { messages: 8, .. }));
    assert_eq!(cursors(&server).await, ["15000", "17000"]);
}

/// 이미 취소된 토큰이면 요청하지 않는다.
#[tokio::test]
async fn cancelled_before_start_sends_nothing() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    let cancel = CancellationToken::new();
    cancel.cancel();
    let err = chzzk(&server)
        .collect_chat(e.req(SubtitleFormat::None), cancel, &no_progress())
        .await
        .unwrap_err();
    assert!(matches!(err, Error::Cancelled));
    assert!(cursors(&server).await.is_empty());
}

/// `restart`는 받다 만 `.part`를 버리고 처음부터 받는다.
#[tokio::test]
async fn restart_starts_over() {
    let server = MockServer::start().await;
    mount_at(&server, 0, json(page("page_first.json"))).await;
    mount_at(&server, 15000, ResponseTemplate::new(400)).await;
    let e = Env::new();
    let c = chzzk(&server);
    run(&c, e.req(SubtitleFormat::None)).await.unwrap_err();

    server.reset().await;
    mount_chain(&server).await;
    let req = ChatRequest {
        restart: true,
        ..e.req(SubtitleFormat::None)
    };
    let out = run(&c, req).await.unwrap();
    assert!(matches!(out, ChatOutcome::Completed { messages: 8, .. }));
    assert_eq!(cursors(&server).await, ["0", "15000", "17000"]);
    assert_eq!(lines(&e.record()).len(), 8);
}

// ---- 경쟁·덮어쓰기 ----

/// 받는 동안 같은 이름의 기록이 생기면 `Skip`은 덮어쓰지 않는다. 자막은 옮겨지고 기록의 `.part`·sidecar는
/// 남는다. 그 뒤 `Overwrite`로 다시 부르면 요청 없이 곧바로 마무리한다.
#[tokio::test]
async fn record_created_during_collect_is_kept_then_overwrite_finalizes() {
    let server = MockServer::start().await;
    let e = Env::new();
    mount_at(&server, 0, json(page("page_first.json"))).await;
    mount_at(&server, 15000, json(page("page_boundary.json"))).await;
    mount_at(
        &server,
        17000,
        CreateThenRespond {
            body: page("page_last_null.json"),
            file: e.record(),
            bytes: b"user record",
        },
    )
    .await;
    let c = chzzk(&server);
    let out = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap();
    assert_eq!(
        out,
        ChatOutcome::TargetExists {
            path: e.record().clone()
        }
    );
    assert_eq!(std::fs::read(e.record()).unwrap(), b"user record");
    assert!(part_of(&e.record()).exists());
    assert!(sidecar_of(&e.record()).exists());
    // 자막은 막히지 않아 최종 이름에 있다
    assert!(e.ass().exists());
    let ass_before = std::fs::read(e.ass()).unwrap();

    // Skip으로 다시 불러도 덮어쓰지 않고 요청도 없다
    server.reset().await;
    let out = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap();
    assert!(matches!(out, ChatOutcome::TargetExists { .. }));
    assert_eq!(std::fs::read(e.record()).unwrap(), b"user record");
    assert!(cursors(&server).await.is_empty());

    // 동의(Overwrite) 뒤에는 요청 없이 마무리한다
    let req = ChatRequest {
        on_existing: DuplicatePolicy::Overwrite,
        ..e.req(SubtitleFormat::Ass)
    };
    let out = run(&c, req).await.unwrap();
    assert!(
        matches!(
            out,
            ChatOutcome::Completed {
                messages: 8,
                end: ChatEnd::NoCursor,
                ..
            }
        ),
        "{out:?}"
    );
    assert!(cursors(&server).await.is_empty());
    assert_eq!(lines(&e.record()).len(), 8);
    assert_eq!(std::fs::read(e.ass()).unwrap(), ass_before);
    for p in [
        part_of(&e.record()),
        sidecar_of(&e.record()),
        part_of(&e.ass()),
    ] {
        assert!(!p.exists(), "{}", p.display());
    }
}

/// 검사 뒤 같은 이름의 자막이 생겼으면 `Skip`은 그 자막을 지키고 기록도 옮기지 않는다.
/// `restart`(처음부터)도 덮어쓰기 동의가 아니다.
#[tokio::test]
async fn existing_subtitle_is_never_overwritten_by_skip() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    std::fs::write(e.ass(), b"user subtitle").unwrap();
    let c = chzzk(&server);
    for restart in [false, true] {
        let req = ChatRequest {
            restart,
            ..e.req(SubtitleFormat::Ass)
        };
        let out = run(&c, req).await.unwrap();
        assert_eq!(
            out,
            ChatOutcome::TargetExists { path: e.ass() },
            "{restart}"
        );
        assert_eq!(std::fs::read(e.ass()).unwrap(), b"user subtitle");
        assert!(!e.record().exists());
        assert!(part_of(&e.record()).exists());
    }
    // restart는 처음부터 다시 받았다(첫 실행 셋 + restart 셋)
    assert_eq!(
        cursors(&server).await,
        ["0", "15000", "17000", "0", "15000", "17000"]
    );

    // Overwrite면 덮어쓴다
    let req = ChatRequest {
        on_existing: DuplicatePolicy::Overwrite,
        ..e.req(SubtitleFormat::Ass)
    };
    let out = run(&c, req).await.unwrap();
    assert!(matches!(out, ChatOutcome::Completed { .. }));
    assert_ne!(std::fs::read(e.ass()).unwrap(), b"user subtitle");
    assert_eq!(lines(&e.record()).len(), 8);
}

/// 같은 출력의 채팅을 다른 작업이 받는 중이면 `FileLocked`이고, 요청하지 않으며 그 `.part`를 건드리지 않는다.
#[tokio::test]
async fn concurrent_collect_on_same_output_is_locked() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    let holder = ChatPart::open(&e.record(), VOD_NO, false).unwrap();
    let sidecar_before = std::fs::read(sidecar_of(&e.record())).unwrap();
    let err = run(&chzzk(&server), e.req(SubtitleFormat::None))
        .await
        .unwrap_err();
    assert!(matches!(err, Error::FileLocked { .. }), "{err:?}");
    assert!(cursors(&server).await.is_empty());
    assert_eq!(holder.lines(), 0);
    drop(holder);
    assert_eq!(
        std::fs::read(sidecar_of(&e.record())).unwrap(),
        sidecar_before
    );
}

/// 셸이 기대는 계약(core.md 67.4): 첫 진행 콜백은 `.part`를 열고(`restart`면 비우고) 난 뒤에만 온다.
/// `restart`인데 다른 작업이 잠가 `FileLocked`면 진행 콜백이 한 번도 없고 남의 `.part`는 그대로다.
#[tokio::test]
async fn locked_restart_reports_no_progress_and_keeps_part() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    let holder = ChatPart::open(&e.record(), VOD_NO, false).unwrap();
    let part = chzzk_core::download::part::part_path(&e.record());
    let before = std::fs::read(&part).unwrap();
    let calls = Arc::new(AtomicU64::new(0));
    let calls2 = calls.clone();
    let err = chzzk(&server)
        .collect_chat(
            ChatRequest {
                restart: true,
                ..e.req(SubtitleFormat::None)
            },
            CancellationToken::new(),
            &move |_| {
                calls2.fetch_add(1, Ordering::Relaxed);
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(err, Error::FileLocked { .. }), "{err:?}");
    assert_eq!(calls.load(Ordering::Relaxed), 0, "열기 전에는 진행이 없다");
    assert_eq!(std::fs::read(&part).unwrap(), before);
    drop(holder);
}

/// 다른 영상의 sidecar는 이어받지 않는다(처음부터).
#[tokio::test]
async fn other_video_sidecar_is_not_resumed() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    drop(ChatPart::open(&e.record(), VOD_NO + 1, false).unwrap());
    let calls = Arc::new(AtomicU64::new(0));
    let calls2 = calls.clone();
    let out = chzzk(&server)
        .collect_chat(
            e.req(SubtitleFormat::None),
            CancellationToken::new(),
            &move |_| {
                calls2.fetch_add(1, Ordering::Relaxed);
            },
        )
        .await
        .unwrap();
    assert!(matches!(out, ChatOutcome::Completed { messages: 8, .. }));
    assert_eq!(cursors(&server).await, ["0", "15000", "17000"]);
    assert!(calls.load(Ordering::Relaxed) >= 3);
}

/// 자막을 만들지 못해도 기록은 완성으로 옮기고 `subtitle_failed`로 알린다.
#[tokio::test]
async fn subtitle_failure_still_completes_record() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    // 자막 임시 파일 자리에 폴더가 있어 쓰기가 실패한다
    std::fs::create_dir(part_of(&e.ass())).unwrap();
    let out = run(&chzzk(&server), e.req(SubtitleFormat::Ass))
        .await
        .unwrap();
    assert!(
        matches!(
            out,
            ChatOutcome::Completed {
                messages: 8,
                subtitle_failed: true,
                ..
            }
        ),
        "{out:?}"
    );
    assert_eq!(lines(&e.record()).len(), 8);
    assert!(!e.ass().exists());
    assert!(!sidecar_of(&e.record()).exists());
}

// ---- 중단된 자막 이동 ----

/// 기록 이름이 막혀 `TargetExists`로 끝나게 한다(자막은 옮겨지고 sidecar에 `end`가 남는다).
async fn run_until_record_blocked(server: &MockServer, e: &Env) {
    mount_at(server, 0, json(page("page_first.json"))).await;
    mount_at(server, 15000, json(page("page_boundary.json"))).await;
    mount_at(
        server,
        17000,
        CreateThenRespond {
            body: page("page_last_null.json"),
            file: e.record(),
            bytes: b"user record",
        },
    )
    .await;
    let out = run(&chzzk(server), e.req(SubtitleFormat::Ass))
        .await
        .unwrap();
    assert_eq!(out, ChatOutcome::TargetExists { path: e.record() });
}

/// 자막 rename 뒤·sidecar `moved` 갱신 전에 프로세스가 멈춘 상태: 최종 자막은 있고 임시 파일은 없고,
/// sidecar에는 `moved` 대신 이동 의도(`moving`)만 남았다. `Skip` 재시도가 자기 자막에 막히지 않고 끝난다.
#[tokio::test]
async fn interrupted_subtitle_move_resumes_and_completes_with_skip() {
    let server = MockServer::start().await;
    let e = Env::new();
    run_until_record_blocked(&server, &e).await;
    let ass = std::fs::read(e.ass()).unwrap();
    // 중단 상태를 만든다: 옮긴 자막이 `moved`에 아직 적히지 않았다
    let sc = sidecar_of(&e.record());
    let mut v: serde_json::Value = serde_json::from_slice(&std::fs::read(&sc).unwrap()).unwrap();
    let key = v["moved"].as_array().unwrap()[0].clone();
    assert_eq!(key, "영상.ass");
    v["moved"] = serde_json::json!([]);
    v["moving"] = serde_json::json!([key]);
    std::fs::write(&sc, serde_json::to_vec(&v).unwrap()).unwrap();
    assert!(!part_of(&e.ass()).exists());
    std::fs::remove_file(e.record()).unwrap();

    server.reset().await;
    let out = run(&chzzk(&server), e.req(SubtitleFormat::Ass))
        .await
        .unwrap();
    assert!(
        matches!(
            out,
            ChatOutcome::Completed {
                messages: 8,
                subtitle_failed: false,
                ..
            }
        ),
        "{out:?}"
    );
    assert!(cursors(&server).await.is_empty());
    assert_eq!(std::fs::read(e.ass()).unwrap(), ass);
    assert_eq!(lines(&e.record()).len(), 8);
    for p in [part_of(&e.record()), sc, part_of(&e.ass())] {
        assert!(!p.exists(), "{}", p.display());
    }
}

/// 이동 의도 기록이 없으면 최종 자막은 사용자 것이다. 임시 파일이 없어도 우리 자막으로 치지 않고,
/// 자막을 다시 만들어 `Skip`이 막는다(사용자 자막·기록 이름 그대로).
#[tokio::test]
async fn unrelated_existing_subtitle_without_intent_is_kept() {
    let server = MockServer::start().await;
    mount_chain(&server).await;
    let e = Env::new();
    std::fs::write(e.ass(), b"user subtitle").unwrap();
    let c = chzzk(&server);
    let out = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap();
    assert_eq!(out, ChatOutcome::TargetExists { path: e.ass() });
    // 임시 파일이 사라져 "최종 자막 있음·임시 파일 없음"이 된다
    std::fs::remove_file(part_of(&e.ass())).unwrap();

    let out = run(&c, e.req(SubtitleFormat::Ass)).await.unwrap();
    assert_eq!(out, ChatOutcome::TargetExists { path: e.ass() });
    assert_eq!(std::fs::read(e.ass()).unwrap(), b"user subtitle");
    assert!(!e.record().exists());
    assert!(part_of(&e.record()).exists() && sidecar_of(&e.record()).exists());
    // 끝까지 받은 뒤라 다시 요청하지 않았다
    assert_eq!(cursors(&server).await, ["0", "15000", "17000"]);
}
