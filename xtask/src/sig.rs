//! updater 서명(Tauri 형식). 키·서명 파일은 모두 minisign 텍스트 파일의 **base64**다(실측 2026-10-06, tauri-cli 2.12.1):
//!   개인 키  = base64("untrusted comment: <rsign 암호화 개인 키 머리줄>\n<base64 box>\n")  — 누출 검사 규칙 signing-key
//!   공개 키  = base64("untrusted comment: minisign public key: <keyid>\n<base64>\n")   — release/updater.pub, plugins.updater.pubkey
//!   .sig    = base64("untrusted comment: …\n<sig>\ntrusted comment: timestamp:<unix>\tfile:<name>\n<global sig>\n")
//! 검증은 updater 클라이언트(tauri-plugin-updater)와 같은 crate·같은 순서다: minisign-verify로 공개 키·서명을 decode하고
//! verify. 단 legacy(prehash 아닌) 서명은 받지 않는다(Tauri CLI와 이 도구는 모두 prehash 서명만 만든다).

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

use crate::cli::{Res, check, input};

fn b64_text(what: &str, s: &str) -> Res<String> {
    let raw = STANDARD
        .decode(s.trim())
        .map_err(|e| input(format!("{what}: base64가 아니다({e})")))?;
    String::from_utf8(raw).map_err(|_| input(format!("{what}: UTF-8 텍스트가 아니다")))
}

/// Tauri 형식 개인 키(base64 텍스트)와 비밀번호 → 서명 키
pub fn load_secret_key(key_b64: &str, password: &str) -> Res<minisign::SecretKey> {
    let text = b64_text("TAURI_SIGNING_PRIVATE_KEY", key_b64)?;
    let sk_box = minisign::SecretKeyBox::from_string(&text)
        .map_err(|e| input(format!("개인 키 형식: {e}")))?;
    sk_box
        .into_secret_key(Some(password.to_string()))
        .map_err(|e| input(format!("개인 키를 열 수 없다(비밀번호?): {e}")))
}

/// 서명 → .sig 파일 내용(base64, 끝 줄바꿈 없음 — Tauri CLI와 같다)
pub fn sign(sk: &minisign::SecretKey, data: &[u8], file_name: &str, timestamp: u64) -> Res<String> {
    let trusted = format!("timestamp:{timestamp}\tfile:{file_name}");
    let sig = minisign::sign(
        None,
        sk,
        std::io::Cursor::new(data),
        Some(&trusted),
        Some("signature from tauri secret key"),
    )
    .map_err(|e| check(format!("서명 실패({file_name}): {e}")))?;
    Ok(STANDARD.encode(sig.into_string()))
}

/// updater 클라이언트와 같은 검증. pubkey_b64 = release/updater.pub 내용, sig_b64 = .sig 내용
pub fn verify(pubkey_b64: &str, data: &[u8], sig_b64: &str) -> Res<()> {
    let pk_text = b64_text("공개 키", pubkey_b64)?;
    let pk = minisign_verify::PublicKey::decode(&pk_text)
        .map_err(|e| input(format!("공개 키 형식: {e}")))?;
    let sig_text = b64_text("서명", sig_b64).map_err(|f| check(f.msg))?;
    let sig = minisign_verify::Signature::decode(&sig_text)
        .map_err(|e| check(format!("서명 형식: {e}")))?;
    pk.verify(data, &sig, false)
        .map_err(|e| check(format!("서명 검증 실패: {e}")))
}

/// 음성 자체 검사: 데이터 1바이트 변조, 서명의 trusted comment 1글자 변조가 **모두** 거부돼야 한다.
/// 하나라도 통과하면 검증기가 고장 난 것이다(→ 실패).
pub fn tamper_check(pubkey_b64: &str, data: &[u8], sig_b64: &str) -> Res<()> {
    if data.is_empty() {
        return Err(check("빈 파일은 변조 검사를 할 수 없다"));
    }
    let mut bad = data.to_vec();
    let i = data.len() / 2;
    bad[i] ^= 0x01;
    if verify(pubkey_b64, &bad, sig_b64).is_ok() {
        return Err(check(format!(
            "1바이트 변조 사본({i}번째 바이트)이 검증을 통과했다 — 검증기 고장"
        )));
    }
    let sig_text = b64_text("서명", sig_b64)?;
    let forged = sig_text.replacen("timestamp:", "timestamp:9", 1);
    if forged == sig_text {
        return Err(check("서명에 trusted comment가 없다"));
    }
    if verify(pubkey_b64, data, &STANDARD.encode(forged)).is_ok() {
        return Err(check(
            "trusted comment를 바꾼 서명이 검증을 통과했다 — 검증기 고장",
        ));
    }
    Ok(())
}

/// Tauri 형식 키 쌍(시험용) → (개인 키 base64, 공개 키 base64)
pub fn keygen(password: &str) -> Res<(String, String)> {
    let kp = minisign::KeyPair::generate_encrypted_keypair(Some(password.to_string()))
        .map_err(|e| check(format!("keygen: {e}")))?;
    let sk = kp
        .sk
        .to_box(None)
        .map_err(|e| check(format!("keygen: {e}")))?
        .into_string();
    let pk = kp
        .pk
        .to_box()
        .map_err(|e| check(format!("keygen: {e}")))?
        .into_string();
    Ok((STANDARD.encode(sk), STANDARD.encode(pk)))
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIX: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/tauri-cli");

    fn fix(name: &str) -> Vec<u8> {
        std::fs::read(format!("{FIX}/{name}")).unwrap()
    }

    fn text(name: &str) -> String {
        String::from_utf8(fix(name)).unwrap()
    }

    /// 골든: `tauri signer generate`·`tauri signer sign`(tauri-cli 2.12.1)이 만든 공개 키·서명을 updater와 같은 방식으로 받는다
    #[test]
    fn accepts_tauri_cli_signature() {
        verify(
            &text("key.pub"),
            &fix("sample.bin"),
            &text("sample.bin.sig"),
        )
        .unwrap();
        tamper_check(
            &text("key.pub"),
            &fix("sample.bin"),
            &text("sample.bin.sig"),
        )
        .unwrap();
    }

    #[test]
    fn rejects_tampered_data_and_comment() {
        let mut data = fix("sample.bin");
        data[0] ^= 0x80;
        assert_eq!(
            verify(&text("key.pub"), &data, &text("sample.bin.sig"))
                .unwrap_err()
                .code,
            1
        );
        let forged = b64_text("t", &text("sample.bin.sig"))
            .unwrap()
            .replace("file:sample.bin", "file:other.bin");
        assert_eq!(
            verify(
                &text("key.pub"),
                &fix("sample.bin"),
                &STANDARD.encode(forged)
            )
            .unwrap_err()
            .code,
            1
        );
    }

    #[test]
    fn sign_then_verify_with_encrypted_key() {
        let (sk_b64, pk_b64) = keygen("pw-1").unwrap();
        assert!(
            b64_text("k", &sk_b64)
                .unwrap()
                .starts_with("untrusted comment: ")
        );
        assert!(load_secret_key(&sk_b64, "wrong").is_err());
        let sk = load_secret_key(&sk_b64, "pw-1").unwrap();
        let data = b"chzzk updater artifact".to_vec();
        let sig = sign(&sk, &data, "a.AppImage", 1_700_000_000).unwrap();
        assert!(!sig.ends_with('\n'));
        let sig_text = b64_text("s", &sig).unwrap();
        assert!(
            sig_text.contains("trusted comment: timestamp:1700000000\tfile:a.AppImage\n"),
            "{sig_text}"
        );
        verify(&pk_b64, &data, &sig).unwrap();
        tamper_check(&pk_b64, &data, &sig).unwrap();
        // 다른 키의 공개 키로는 실패
        let (_, other_pk) = keygen("pw-2").unwrap();
        assert_eq!(verify(&other_pk, &data, &sig).unwrap_err().code, 1);
        // Tauri CLI 키의 공개 키로도 실패(키 id가 다르다)
        assert_eq!(verify(&text("key.pub"), &data, &sig).unwrap_err().code, 1);
    }

    #[test]
    fn tamper_check_detects_broken_verifier_input() {
        assert!(tamper_check(&text("key.pub"), b"", &text("sample.bin.sig")).is_err());
    }
}
