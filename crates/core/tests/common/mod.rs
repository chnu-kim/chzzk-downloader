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

/// 실물 fixture의 미디어 호스트.
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
pub const VOD_VIDEO_ID: &str = "0000000000000000000000000000000000B02";
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
