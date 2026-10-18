//! 파일 이름 규칙 미리보기(`preview_file_name_template`)를 `design/naming/template.json` 골든으로 검사한다.
//! 코어 `naming_golden.rs`와 가짜 백엔드가 같은 파일을 읽는다. 규칙 OS는 인자라 세 OS를 한 호스트에서 본다.

use std::fs;
use std::path::PathBuf;

use chzzk_core::Platform;
use chzzk_shell::dto::{FileNameTemplatePreview, TemplateErrorKind};
use chzzk_shell::naming_preview::preview_file_name_template;
use serde_json::{Value, json};

fn golden() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../design/naming/template.json");
    serde_json::from_slice(&fs::read(path).expect("design/naming/template.json")).expect("JSON")
}

#[test]
fn preview_matches_golden() {
    let g = golden();
    let rows = g["preview"].as_array().expect("preview");
    assert!(rows.len() >= 4);
    for row in rows {
        let tpl = row["template"].as_str().unwrap();
        let got = serde_json::to_value(preview_file_name_template(tpl, Platform::Linux)).unwrap();
        let want = match row.get("error") {
            Some(e) => json!({"status": "invalid", "error": e}),
            None => json!({"status": "ok", "names": row["linux"]}),
        };
        assert_eq!(got, want, "{tpl}");
    }
}

/// 같은 템플릿이라도 규칙 OS에 따라 예시 이름이 다르다(저장 폴더 볼륨 기준).
#[test]
fn preview_follows_platform_rules() {
    let names = |p| match preview_file_name_template("{date}: {title}?", p) {
        FileNameTemplatePreview::Ok { names } => {
            names.into_iter().map(|n| n.name).collect::<Vec<_>>()
        }
        other => panic!("{other:?}"),
    };
    assert_eq!(names(Platform::Linux)[0], "261018: 저녁 방송?.mp4");
    assert_eq!(names(Platform::MacOs)[0], "261018_ 저녁 방송?.mp4");
    assert_eq!(names(Platform::Windows)[0], "261018_ 저녁 방송_.mp4");
    // 클립에는 날짜가 없다. `:`는 지우는 구분 문자(공백 - _ . ~ , ·)가 아니라 남는다
    assert_eq!(names(Platform::Linux)[1], ": 웃긴 장면?.mp4");
}

#[test]
fn preview_error_kinds_and_json_shape() {
    for (tpl, kind, token) in [
        ("{", TemplateErrorKind::UnbalancedBrace, None),
        ("{x}", TemplateErrorKind::UnknownToken, Some("x")),
        (
            "{title}{title}",
            TemplateErrorKind::DuplicateToken,
            Some("title"),
        ),
        ("{title}/", TemplateErrorKind::PathSeparator, None),
        ("a", TemplateErrorKind::MissingTitle, None),
        ("", TemplateErrorKind::MissingTitle, None),
    ] {
        match preview_file_name_template(tpl, Platform::Linux) {
            FileNameTemplatePreview::Invalid { error } => {
                assert_eq!(error.kind, kind, "{tpl:?}");
                assert_eq!(error.token.as_deref(), token, "{tpl:?}");
            }
            other => panic!("{tpl:?}: {other:?}"),
        }
    }
    // 토큰이 없는 오류는 `token` 키가 아예 없다
    let v = serde_json::to_value(preview_file_name_template("{", Platform::Linux)).unwrap();
    assert_eq!(
        v,
        json!({"status": "invalid", "error": {"kind": "unbalancedBrace"}})
    );
}

/// 너무 긴 규칙의 오류는 상한(`MAX_TEMPLATE_BYTES`)을 함께 준다. 화면 문구가 숫자를 따로 적지 않고 이 값을 쓴다
/// (코어 상수와 문구가 어긋나지 않게).
#[test]
fn too_long_error_carries_the_limit() {
    let max = chzzk_core::naming::MAX_TEMPLATE_BYTES;
    let ok = format!("{{title}}{}", "a".repeat(max - "{title}".len()));
    assert!(matches!(
        preview_file_name_template(&ok, Platform::Linux),
        FileNameTemplatePreview::Ok { .. }
    ));
    let long = format!("{ok}a");
    let v = serde_json::to_value(preview_file_name_template(&long, Platform::Linux)).unwrap();
    assert_eq!(
        v,
        json!({"status": "invalid", "error": {"kind": "tooLong", "max": max}})
    );
}
