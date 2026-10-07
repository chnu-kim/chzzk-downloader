//! 앱 로그인(`auth`) 테스트 공용 도구.

use std::path::Path;

use chzzk_core::Secret;
use chzzk_shell::auth::{SessionStore, StoredSession, TokenBundle, WorkerBase};
use time::OffsetDateTime;

pub const ORIGIN: &str = "https://worker.example.invalid";
pub const CH: &str = "000000000000000000000000000000a1";

/// 기준 시각 2030-01-01T00:00:00Z
pub fn t0() -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp(1_893_456_000).unwrap()
}

/// 접두 + seed를 'A'로 43자까지 채운 토큰
pub fn tok(prefix: &str, seed: &str) -> String {
    assert!(seed.len() <= 43);
    format!("{prefix}{seed:A<43}")
}

pub fn base() -> WorkerBase {
    WorkerBase::parse(ORIGIN).unwrap()
}

pub fn store(dir: &Path) -> SessionStore {
    SessionStore::new(dir.to_path_buf(), &base())
}

/// n번째 묶음: access 만료 now+24h, refresh 만료 now+30d
pub fn bundle(n: u32, now: OffsetDateTime) -> TokenBundle {
    bundle_with(
        n,
        now + time::Duration::hours(24),
        now + time::Duration::days(30),
    )
}

/// 같은 값, 만료 직접 지정
pub fn bundle_with(n: u32, access_exp: OffsetDateTime, refresh_exp: OffsetDateTime) -> TokenBundle {
    TokenBundle {
        access_token: Secret::new(tok("cda_", &format!("acc{n}"))),
        access_expires_at: access_exp,
        refresh_token: Secret::new(tok("cdr_", &format!("ref{n}"))),
        refresh_expires_at: refresh_exp,
        channel_id: CH.to_string(),
        channel_name: "채널".to_string(),
        is_admin: false,
    }
}

/// 저장 세션: `bundle(n, verified_at)`과 같은 토큰, refresh 만료 지정
pub fn stored(
    n: u32,
    verified_at: OffsetDateTime,
    refresh_expires_at: OffsetDateTime,
) -> StoredSession {
    let b = bundle_with(
        n,
        verified_at + time::Duration::hours(24),
        refresh_expires_at,
    );
    StoredSession::from_bundle(b, verified_at)
}

/// 디렉토리를 파일로 바꿔 save를 실패시킨다
pub fn break_dir(dir: &Path) {
    std::fs::remove_dir_all(dir).unwrap();
    std::fs::write(dir, b"x").unwrap();
}

/// `break_dir`를 되돌린다
pub fn fix_dir(dir: &Path) {
    std::fs::remove_file(dir).unwrap();
    std::fs::create_dir_all(dir).unwrap();
}

/// session.json을 JSON으로 읽는다(검사용)
pub fn read_session(dir: &Path) -> Option<serde_json::Value> {
    let b = std::fs::read(dir.join("session.json")).ok()?;
    serde_json::from_slice(&b).ok()
}
