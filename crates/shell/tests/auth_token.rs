//! 토큰 계약(worker.md 구현 중 변경 13) known-answer. Worker `test/unit/token.test.ts`와 같은 벡터를 쓴다.

use chzzk_shell::auth::token::*;

const KAT_POLL: &str = "WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo";
// 철자 검사기 오탐을 피하려고 문자열을 둘로 나눈다.
const KAT_VERIFIER_B64: &str = concat!("vsC21rUDXpkBYxB", "RE9D-8wa2cqfiPLd0sDvQNlNjtT0");
const KAT_VERIFIER_HEX: &str = "bec0b6d6b5035e990163105113d0fef306b672a7e23cb774b03bd0365363b53d";
const ACCESS_A43_HASH_HEX: &str =
    "513fb3ed158b6c8cd12c11a4eea5c9c8170dbf52ffae0f6ce70b521ab10791b0";
const BARE_A43_HASH_HEX: &str = "0f007385b6f9d4b7eeb2748605afe1a984a0a3bfa3f014d09e2a784ce9e5cd1a";
const REFRESH_FF_HASH_HEX: &str =
    "deba2bae539cb8a2193d5017045fd0dbed5ac42128c7583d791a8948074d8fe1";

fn a(n: usize) -> String {
    "A".repeat(n)
}

fn hex_of(b64: &str) -> String {
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(b64)
        .unwrap();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn kat_poll_secret_from_0x5a() {
    assert_eq!(poll_secret_from_bytes(&[0x5a; 32]).expose(), KAT_POLL);
}

#[test]
fn kat_poll_verifier_hashes_b64url_string() {
    let v = poll_verifier(KAT_POLL);
    assert_eq!(v, KAT_VERIFIER_B64);
    assert_eq!(hex_of(&v), KAT_VERIFIER_HEX);
    // 디코드한 32바이트를 해시한 값과는 다르다(문자열을 해시한다)
    let raw_hash = stored_hash_hex(std::str::from_utf8(&[0x5a; 32]).unwrap());
    assert_ne!(raw_hash, KAT_VERIFIER_HEX);
    assert!(is_secret(&v));
}

#[test]
fn kat_stored_hash_includes_prefix() {
    let tok = format!("cda_{}", a(43));
    assert_eq!(stored_hash_hex(&tok), ACCESS_A43_HASH_HEX);
    assert_eq!(stored_hash_hex(&a(43)), BARE_A43_HASH_HEX);
    assert_ne!(ACCESS_A43_HASH_HEX, BARE_A43_HASH_HEX);
}

#[test]
fn kat_refresh_from_0xff() {
    let t = format!("cdr_{}", b64url(&[0xff; 32]));
    assert_eq!(t, format!("cdr_{}8", "_".repeat(42)));
    assert!(is_refresh_token(&t));
    assert_eq!(stored_hash_hex(&t), REFRESH_FF_HASH_HEX);
}

#[test]
fn sha256_abc_vector() {
    assert_eq!(
        stored_hash_hex("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn token_format_table() {
    let a42 = a(42);
    let a43 = a(43);
    let a44 = a(44);
    let rows: Vec<(bool, String, bool)> = vec![
        (true, format!("cda_{a43}"), true),
        (false, format!("cdr_{a43}"), true),
        (true, format!("cdr_{a43}"), false),
        (false, format!("cda_{a43}"), false),
        (true, format!("cdw_{a43}"), false),
        (true, format!("cdf_{a43}"), false),
        (true, format!("cda_{a42}"), false),
        (true, format!("cda_{a44}"), false),
        (true, format!("cda_{a42}+"), false),
        (true, "/".into(), false),
        (true, "=".into(), false),
        (true, format!("cda_{a43} "), false),
        (true, format!(" cda_{a43}"), false),
        (true, format!("CDA_{a43}"), false),
        (true, a43.clone(), false),
        (true, String::new(), false),
        (true, format!("cda_{}x", "_-".repeat(21)), true),
        (true, format!("cda_{a42}가"), false),
    ];
    for (is_access, s, want) in rows {
        let got = if is_access {
            is_access_token(&s)
        } else {
            is_refresh_token(&s)
        };
        assert_eq!(got, want, "{s:?} access={is_access}");
    }
}

#[test]
fn id_and_secret_lengths() {
    assert!(is_id(&a(22)));
    assert!(!is_id(&a(21)));
    assert!(!is_id(&a(23)));
    assert!(!is_id(&format!("{}=", a(21))));
    assert!(is_secret(&a(43)));
    assert!(!is_secret(&a(42)));
    assert!(!is_secret(&a(44)));
}

#[test]
fn user_code_table() {
    for (s, want) in [
        ("K7QX-4MRA", true),
        ("k7qx-4mra", false),
        ("K7QX4MRA", false),
        ("K0QX-4MRA", false),
        ("K1QX-4MRA", false),
        ("KIQX-4MRA", false),
        ("KOQX-4MRA", false),
        ("K7QX-4MRAA", false),
    ] {
        assert_eq!(is_user_code(s), want, "{s}");
    }
}

#[test]
fn channel_id_table() {
    let ch = "000000000000000000000000000000a1";
    assert!(is_channel_id(ch));
    assert!(!is_channel_id(&ch.replace('a', "A")));
    assert!(!is_channel_id(&ch[1..]));
    assert!(!is_channel_id(&format!("{ch}0")));
    assert!(!is_channel_id(&format!("{}g", &ch[1..])));
}

#[test]
fn new_poll_secret_is_random_and_well_formed() {
    let (x, y) = (new_poll_secret(), new_poll_secret());
    assert_ne!(x.expose(), y.expose());
    assert!(is_secret(x.expose()) && is_secret(y.expose()));
}
