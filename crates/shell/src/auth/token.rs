//! 토큰 형식과 해시 입력 계약(docs/design/worker.md 구현 중 변경 13). Worker `src/core/token.ts`와 같아야 하고
//! `tests/auth_token.rs`가 Worker `test/unit/token.test.ts`와 같은 known-answer로 고정한다.

use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chzzk_core::Secret;
use sha2::{Digest, Sha256};

/// access 토큰 접두
pub const ACCESS_PREFIX: &str = "cda_";
/// refresh 토큰 접두
pub const REFRESH_PREFIX: &str = "cdr_";
/// 32바이트 난수의 b64url(패딩 없음) 길이
pub const SECRET_LEN: usize = 43;
/// 16바이트 id(loginId·handle)의 b64url 길이
pub const ID_LEN: usize = 22;
/// 확인 코드 알파벳(Worker `core/usercode.ts`)
pub const USER_CODE_ALPHABET: &str = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/// b64url 알파벳 `[A-Za-z0-9_-]`만으로 정확히 `len`자
fn is_b64url_of_len(s: &str, len: usize) -> bool {
    s.len() == len
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// `^cda_[A-Za-z0-9_-]{43}$`
pub fn is_access_token(s: &str) -> bool {
    s.strip_prefix(ACCESS_PREFIX)
        .is_some_and(|b| is_b64url_of_len(b, SECRET_LEN))
}

/// `^cdr_[A-Za-z0-9_-]{43}$`
pub fn is_refresh_token(s: &str) -> bool {
    s.strip_prefix(REFRESH_PREFIX)
        .is_some_and(|b| is_b64url_of_len(b, SECRET_LEN))
}

/// loginId·handle: `^[A-Za-z0-9_-]{22}$`
pub fn is_id(s: &str) -> bool {
    is_b64url_of_len(s, ID_LEN)
}

/// pollSecret·pollVerifier: `^[A-Za-z0-9_-]{43}$`
pub fn is_secret(s: &str) -> bool {
    is_b64url_of_len(s, SECRET_LEN)
}

/// 확인 코드 `^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$`
pub fn is_user_code(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 9
        && b[4] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| i == 4 || USER_CODE_ALPHABET.as_bytes().contains(c))
}

/// 채널 ID `^[0-9a-f]{32}$`
pub fn is_channel_id(s: &str) -> bool {
    s.len() == 32 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// b64url(패딩 없음)
pub fn b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// 32바이트 난수로 만든 pollSecret(메모리에만 둔다)
pub fn new_poll_secret() -> Secret<String> {
    let mut b = [0u8; 32];
    getrandom::fill(&mut b).expect("OS 난수원을 쓸 수 없다");
    poll_secret_from_bytes(&b)
}

/// 테스트·KAT용: 주어진 32바이트의 pollSecret
pub fn poll_secret_from_bytes(b: &[u8; 32]) -> Secret<String> {
    Secret::new(b64url(b))
}

/// `pollVerifier = b64url(SHA-256(UTF-8(pollSecret 문자열)))`(13 (다)). 디코드한 32바이트가 아니라 문자열을 해시한다.
pub fn poll_verifier(poll_secret: &str) -> String {
    b64url(Sha256::digest(poll_secret.as_bytes()).as_slice())
}

/// 서버 저장 해시 계약(13 (나)): **접두를 포함한** 토큰 문자열 전체 UTF-8의 SHA-256 소문자 hex.
/// 앱은 해시를 보내지 않는다. Worker와 같은 계약인지 테스트로 고정하려고 둔다.
pub fn stored_hash_hex(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
