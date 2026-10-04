//! 통합 테스트 공용 도구(설계 §8).
//!
//! 테스트 crate마다 쓰는 함수가 달라 사용하지 않는 함수가 생긴다.
#![allow(dead_code)]

use std::time::Duration;

use chzzk_core::{ClientConfig, Endpoints};
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
        progress_interval: Duration::ZERO,
        connect_timeout: Duration::from_secs(5),
        read_timeout: Duration::from_secs(5),
        ..ClientConfig::default()
    }
}
