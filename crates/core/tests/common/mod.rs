//! 통합 테스트 공용 도구(설계 §8).
//!
//! 테스트 crate마다 쓰는 함수가 달라 사용하지 않는 함수가 생긴다.
#![allow(dead_code)]

use std::time::Duration;

use chzzk_core::{ClientConfig, Endpoints, RetryPolicy};
use url::Url;
use wiremock::MockServer;

/// 저장소 루트 기준 상대 경로의 fixture를 읽는다.
pub fn fixture(rel: &str) -> Vec<u8> {
    let path = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

/// 합성 fixture의 미디어 호스트.
pub const MEDIA_HOSTS: [&str; 3] = [
    "hls.example.invalid",
    "clip.example.invalid",
    "vod.example.invalid",
];

/// fixture 안의 `https://{미디어 호스트}`를 mock 주소(`http://127.0.0.1:port`)로 바꾼다.
/// 이중 인코딩 JSON 안에서도 단순 치환으로 된다.
pub fn rewrite_hosts(body: &[u8], mock_uri: &str) -> Vec<u8> {
    let mut s = String::from_utf8(body.to_vec()).expect("UTF-8 fixture");
    for host in MEDIA_HOSTS {
        s = s.replace(&format!("https://{host}"), mock_uri);
    }
    s.into_bytes()
}

/// mock 서버를 API·vodplay 엔드포인트로 쓰는 설정. 진행률 간격은 0이다.
pub fn config(server: &MockServer) -> ClientConfig {
    let base = Url::parse(&server.uri()).unwrap();
    ClientConfig {
        endpoints: Endpoints {
            chzzk_api: base.clone(),
            vodplay_api: base,
        },
        // 재시도 테스트가 빨리 끝나도록 대기를 1ms로 줄인다.
        retry: RetryPolicy {
            max_attempts: 5,
            base: Duration::from_millis(1),
            cap: Duration::from_millis(4),
            // 테스트는 연결 대기(인내)를 기다리지 않는다.
            patience: Duration::ZERO,
            patience_cap: Duration::ZERO,
        },
        progress_interval: Duration::ZERO,
        connect_timeout: Duration::from_secs(5),
        read_timeout: Duration::from_secs(5),
        ..ClientConfig::default()
    }
}

// ---- 다운로드 테스트 도구 ----

use std::path::Path;
use std::sync::{Arc, Mutex};

use chzzk_core::Progress;
use wiremock::{Request, Respond, ResponseTemplate};

/// 일반 VOD fixture(`testdata/vod/video_info.json`)의 videoNo·videoId.
pub const VOD_NO: u64 = 9000002;
pub const VOD_VIDEO_ID: &str = "000000000000000000000000000000000B02";
/// 빠른 다시보기 fixture(`testdata/hls/video_info.json`)의 videoNo.
pub const HLS_NO: u64 = 9000001;

/// PD rep 하나짜리 합성 MPD. `id`는 `PD_`로 시작하고 `url`에 `/pd/`가 있어야 PD로 걸러진다.
pub fn pd_mpd(id: &str, resolution: u32, url: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" xmlns:nvod="urn:naver:vod:2020">
  <Period>
    <AdaptationSet mimeType="video/mp4">
      <Representation id="{id}" bandwidth="1000" width="1280" height="{resolution}">
        <nvod:Label kind="resolution">{resolution}</nvod:Label>
        <BaseURL>{url}</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>"#
    )
}

/// 결정적인 테스트 바이트(위치마다 값이 다르다).
pub fn test_bytes(n: usize, seed: u8) -> Vec<u8> {
    (0..n)
        .map(|i| ((i * 31 + i / 251) as u8).wrapping_add(seed))
        .collect()
}

/// Range를 지원하는 응답기. Range가 없으면 200, 있으면 206(+Content-Range), 범위 밖이면 416.
pub struct RangeBody(pub Vec<u8>);

impl Respond for RangeBody {
    fn respond(&self, req: &Request) -> ResponseTemplate {
        let len = self.0.len();
        let Some(range) = req.headers.get("range").and_then(|v| v.to_str().ok()) else {
            return ResponseTemplate::new(200).set_body_bytes(self.0.clone());
        };
        let start: usize = range
            .strip_prefix("bytes=")
            .and_then(|r| r.strip_suffix('-'))
            .and_then(|s| s.parse().ok())
            .expect("bytes=N- 형식");
        if start >= len {
            return ResponseTemplate::new(416)
                .insert_header("content-range", format!("bytes */{len}"));
        }
        ResponseTemplate::new(206)
            .insert_header("content-range", format!("bytes {start}-{}/{len}", len - 1))
            .set_body_bytes(self.0[start..].to_vec())
    }
}

/// 진행률 이벤트를 모으는 콜백.
#[derive(Clone, Default)]
pub struct Events(pub Arc<Mutex<Vec<Progress>>>);

impl Events {
    pub fn callback(&self) -> impl Fn(Progress) + Send + Sync + 'static {
        let v = self.0.clone();
        move |p| v.lock().unwrap().push(p)
    }

    pub fn all(&self) -> Vec<Progress> {
        self.0.lock().unwrap().clone()
    }

    pub fn last(&self) -> Progress {
        self.all().last().cloned().expect("진행률 이벤트 없음")
    }
}

/// `{out}.part`, `{out}.part.json`
pub fn part_files(out: &Path) -> (std::path::PathBuf, std::path::PathBuf) {
    let mut p = out.as_os_str().to_owned();
    p.push(".part");
    let mut s = out.as_os_str().to_owned();
    s.push(".part.json");
    (p.into(), s.into())
}

/// 요청 한 번에 `Content-Length: total`을 보내고 본문 `body`만 쓴 뒤 연결을 끊는 raw TCP 서버.
/// 돌려주는 값은 `http://127.0.0.1:port`와 받은 요청 원문을 담을 스레드 핸들이다.
pub fn truncating_server(total: usize, body: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
    use std::io::{Read, Write};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    let h = std::thread::spawn(move || {
        let (mut s, _) = listener.accept().unwrap();
        let mut req = Vec::new();
        let mut buf = [0u8; 4096];
        while !req.windows(4).any(|w| w == b"\r\n\r\n") {
            let n = s.read(&mut buf).unwrap();
            if n == 0 {
                break;
            }
            req.extend_from_slice(&buf[..n]);
        }
        let head = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {total}\r\nContent-Type: video/mp4\r\n\r\n"
        );
        let _ = s.write_all(head.as_bytes());
        let _ = s.write_all(&body);
        let _ = s.flush();
        drop(s);
        String::from_utf8_lossy(&req).into_owned()
    });
    (format!("http://{addr}"), h)
}

// ---- HLS 테스트 도구 ----

/// 요청 path가 접미사로 끝나는지 보는 matcher. HLS 경로에 `*`, `~`, `=`가 있어 정확 일치가 번거롭다.
pub struct PathSuffix(pub String);

impl wiremock::Match for PathSuffix {
    fn matches(&self, r: &Request) -> bool {
        r.url.path().ends_with(&self.0)
    }
}

pub fn suffix(s: &str) -> PathSuffix {
    PathSuffix(s.to_string())
}

/// 빠른 다시보기 info fixture의 HLS master 주소를 `master_url`로 바꾼다.
pub fn hls_info(master_url: &str) -> Vec<u8> {
    let mut v: serde_json::Value =
        serde_json::from_slice(&fixture("testdata/hls/video_info.json")).unwrap();
    let inner = v["content"]["liveRewindPlaybackJson"].as_str().unwrap();
    let mut pb: serde_json::Value = serde_json::from_str(inner).unwrap();
    for m in pb["media"].as_array_mut().unwrap() {
        if m["protocol"] == "HLS" {
            m["path"] = serde_json::Value::String(master_url.to_string());
        }
    }
    v["content"]["liveRewindPlaybackJson"] = serde_json::Value::String(pb.to_string());
    serde_json::to_vec(&v).unwrap()
}

/// 합성 fMP4 init(`ftyp`로 시작).
pub fn synth_init() -> Vec<u8> {
    let mut v = vec![0, 0, 0, 16];
    v.extend_from_slice(b"ftypiso6");
    v.extend_from_slice(&[0, 0, 0, 1]);
    v.extend_from_slice(&[0, 0, 0, 12]);
    v.extend_from_slice(b"moov");
    v.extend_from_slice(b"INIT");
    v
}

/// 합성 세그먼트 `i`(`styp`로 시작, 약 1 KB, 세그먼트마다 다른 바이트).
pub fn synth_segment(i: usize) -> Vec<u8> {
    let mut v = vec![0, 0, 0, 8];
    v.extend_from_slice(b"styp");
    v.extend(test_bytes(1024, i as u8));
    v.extend_from_slice(format!("seg{i}").as_bytes());
    v
}

/// 합성 media playlist. 세그먼트 `n`개, 각 `extinf`초, init `init.m4s?type=hls`.
pub fn synth_media(n: usize, extinf: &str) -> String {
    let mut s = String::from(
        "#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n\
         #EXT-X-MAP:URI=\"init.m4s?type=hls\"\n",
    );
    for i in 0..n {
        s.push_str(&format!("#EXTINF:{extinf},\nseg{i}.m4v\n"));
    }
    s.push_str("#EXT-X-ENDLIST\n");
    s
}

/// 144p variant 하나짜리 합성 master.
pub const SYNTH_MASTER: &str =
    "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=192000,RESOLUTION=256x144\n144p/media.m3u8\n";

/// `{prefix}/master.m3u8`, `{prefix}/144p/media.m3u8`, init, 세그먼트 `n`개를 mount한다.
/// 세그먼트 응답 앞에 따로 mount한 mock이 있으면 그것이 먼저 쓰인다.
pub async fn mount_synth_hls(server: &MockServer, prefix: &str, n: usize) {
    use wiremock::Mock;
    use wiremock::matchers::{method, path};
    Mock::given(method("GET"))
        .and(path(format!("{prefix}/master.m3u8")))
        .respond_with(ResponseTemplate::new(200).set_body_string(SYNTH_MASTER))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{prefix}/144p/media.m3u8")))
        .respond_with(ResponseTemplate::new(200).set_body_string(synth_media(n, "2.000")))
        .mount(server)
        .await;
    Mock::given(method("GET"))
        .and(path(format!("{prefix}/144p/init.m4s")))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(synth_init()))
        .mount(server)
        .await;
    for i in 0..n {
        Mock::given(method("GET"))
            .and(path(format!("{prefix}/144p/seg{i}.m4v")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(synth_segment(i)))
            .mount(server)
            .await;
    }
}

/// 합성 HLS의 기대 출력(init ‖ seg0 ‖ … ‖ seg(n-1)).
pub fn synth_expected(n: usize) -> Vec<u8> {
    let mut v = synth_init();
    for i in 0..n {
        v.extend(synth_segment(i));
    }
    v
}

// ---- 연결 단절 도구(core.md 구현 중 변경 56) ----

use std::io::{Read, Write};
use std::net::{Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// 업스트림(wiremock) 앞에 서서 연결을 끊었다 이었다 하는 TCP 프록시.
///
/// - `down_for(d)`: 지금부터 `d` 동안 새 연결을 받자마자 끊는다(클라이언트에는 연결 계열 `Network` 오류).
///   이미 열린 연결은 건드리지 않는다. 단절 직전의 응답은 `Connection: close`로 보내면 연결이 재사용되지 않는다.
/// - `cut_after`: 연결마다 업스트림 → 클라이언트로 이만큼의 바이트(헤더 포함)만 흘리고 끊는다.
///   끊은 뒤 `cut_gap` 동안 단절한다(받다가 끊기는 회선을 흉내 낸다).
pub struct GateProxy {
    addr: SocketAddr,
    state: Arc<GateState>,
    stop: Arc<AtomicBool>,
}

struct GateState {
    down_until: Mutex<Instant>,
    cut_after: Option<usize>,
    cut_gap: Duration,
    /// 단절 중 끊어 낸 연결 수
    refused: std::sync::atomic::AtomicUsize,
}

impl GateState {
    fn is_down(&self) -> bool {
        Instant::now() < *self.down_until.lock().unwrap()
    }
    fn down_for(&self, d: Duration) {
        *self.down_until.lock().unwrap() = Instant::now() + d;
    }
}

/// 단절을 켜고 끌 수 있는 손잡이(응답기 안에서 쓴다).
#[derive(Clone)]
pub struct Gate(Arc<GateState>);

impl Gate {
    pub fn down_for(&self, d: Duration) {
        self.0.down_for(d);
    }
}

impl GateProxy {
    pub fn start(upstream: SocketAddr) -> Self {
        Self::start_with(upstream, None, Duration::ZERO)
    }

    pub fn start_with(upstream: SocketAddr, cut_after: Option<usize>, cut_gap: Duration) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let state = Arc::new(GateState {
            down_until: Mutex::new(Instant::now()),
            cut_after,
            cut_gap,
            refused: Default::default(),
        });
        let stop = Arc::new(AtomicBool::new(false));
        let (st, sp) = (state.clone(), stop.clone());
        std::thread::spawn(move || {
            while !sp.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((client, _)) => {
                        client.set_nonblocking(false).unwrap();
                        if st.is_down() {
                            st.refused.fetch_add(1, Ordering::Relaxed);
                            drop(client);
                            continue;
                        }
                        let st = st.clone();
                        std::thread::spawn(move || relay(client, upstream, st));
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(2)),
                }
            }
        });
        GateProxy { addr, state, stop }
    }

    pub fn url(&self) -> String {
        format!("http://{}", self.addr)
    }

    pub fn gate(&self) -> Gate {
        Gate(self.state.clone())
    }

    pub fn down_for(&self, d: Duration) {
        self.state.down_for(d);
    }

    /// 단절 중 끊어 낸 연결 수
    pub fn refused(&self) -> usize {
        self.state.refused.load(Ordering::Relaxed)
    }
}

impl Drop for GateProxy {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// 연결 하나를 업스트림에 이어 주고, `cut_after`를 넘으면 끊는다.
fn relay(client: TcpStream, upstream: SocketAddr, st: Arc<GateState>) {
    let Ok(up) = TcpStream::connect(upstream) else {
        return;
    };
    let (Ok(mut c_read), Ok(mut u_write)) = (client.try_clone(), up.try_clone()) else {
        return;
    };
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        while let Ok(n) = c_read.read(&mut buf) {
            if n == 0 || u_write.write_all(&buf[..n]).is_err() {
                break;
            }
        }
        let _ = u_write.shutdown(Shutdown::Write);
    });
    let (mut u_read, mut c_write) = (up, client);
    let mut sent = 0usize;
    let mut buf = [0u8; 8192];
    while let Ok(n) = u_read.read(&mut buf) {
        if n == 0 {
            break;
        }
        let n = match st.cut_after {
            Some(limit) => n.min(limit.saturating_sub(sent)),
            None => n,
        };
        if n > 0 && c_write.write_all(&buf[..n]).is_err() {
            break;
        }
        sent += n;
        if st.cut_after.is_some_and(|limit| sent >= limit) {
            st.down_for(st.cut_gap);
            break;
        }
    }
    let _ = c_write.shutdown(Shutdown::Both);
}

/// `template` 응답을 보내면서 동시에 `gate`를 `outage` 동안 끊고, 연결을 닫게 하는 응답기.
/// (이 응답 직후의 요청이 단절 중에 일어나게 한다. `Connection: close`라 연결이 재사용되지 않는다.)
pub struct ThenOutage {
    pub gate: Gate,
    pub outage: Duration,
    pub template: ResponseTemplate,
}

impl Respond for ThenOutage {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        self.gate.down_for(self.outage);
        self.template.clone().insert_header("connection", "close")
    }
}

/// 연속한 같은 phase를 하나로 접은 순서.
pub fn phase_order(events: &Events) -> Vec<chzzk_core::Phase> {
    let mut v: Vec<chzzk_core::Phase> = Vec::new();
    for p in events.all() {
        if v.last() != Some(&p.phase) {
            v.push(p.phase);
        }
    }
    v
}
