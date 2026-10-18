//! 파일명 템플릿을 `design/naming/template.json` 골든으로 검사한다.
//! 셸 미리보기 테스트(`crates/shell/tests/naming_preview.rs`)와 가짜 백엔드가 같은 파일을 읽고,
//! 기대값은 손으로 계산해 JSON에 있다. 기본 템플릿 = `default_filename` 동등성은 `naming.rs` 단위 테스트가 지킨다.

use std::fs;
use std::path::PathBuf;

use chzzk_core::model::{ContentKind, ContentMeta, ContentRef};
use chzzk_core::naming::{
    DEFAULT_TEMPLATE, Platform, TemplateError, Token, default_filename, parse_template,
    render_filename,
};
use serde_json::Value;

fn golden() -> Value {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../design/naming/template.json");
    serde_json::from_slice(&fs::read(path).expect("design/naming/template.json")).expect("JSON")
}

fn platform(s: &str) -> Platform {
    match s {
        "windows" => Platform::Windows,
        "macos" => Platform::MacOs,
        "linux" => Platform::Linux,
        other => panic!("모르는 platform: {other}"),
    }
}

fn opt(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(Value::as_str).map(str::to_string)
}

fn sample(g: &Value, name: &str) -> (ContentMeta, ContentRef) {
    let s = &g["samples"][name];
    let m = &s["meta"];
    let kind = match m["kind"].as_str().expect("kind") {
        "video" => ContentKind::Video,
        "clip" => ContentKind::Clip,
        "live" => ContentKind::Live,
        other => panic!("모르는 kind: {other}"),
    };
    let meta = ContentMeta {
        kind,
        title: opt(m, "title").expect("title"),
        channel_name: opt(m, "channelName").expect("channelName"),
        channel_id: None,
        live_open_date: opt(m, "liveOpenDate"),
        publish_date: opt(m, "publishDate"),
        adult: false,
        duration_secs: None,
    };
    let content = serde_json::from_value(s["content"].clone()).expect("content");
    (meta, content)
}

/// 오류 → 골든의 `{kind, token?}` 모양.
fn error_json(e: &TemplateError) -> Value {
    match e {
        TemplateError::UnbalancedBrace => serde_json::json!({"kind": "unbalancedBrace"}),
        TemplateError::UnknownToken(t) => {
            serde_json::json!({"kind": "unknownToken", "token": t})
        }
        TemplateError::DuplicateToken(t) => {
            serde_json::json!({"kind": "duplicateToken", "token": Token::name(*t)})
        }
        TemplateError::PathSeparator => serde_json::json!({"kind": "pathSeparator"}),
        TemplateError::MissingTitle => serde_json::json!({"kind": "missingTitle"}),
        TemplateError::TooLong => serde_json::json!({"kind": "tooLong"}),
    }
}

#[test]
fn golden_cases() {
    let g = golden();
    let cases = g["cases"].as_array().expect("cases");
    assert!(cases.len() > 20);
    for c in cases {
        let name = c["name"].as_str().unwrap();
        let tpl = c["template"].as_str().unwrap();
        if let Some(want) = c.get("error") {
            let got = parse_template(tpl).expect_err(name);
            assert_eq!(&error_json(&got), want, "{name}");
            continue;
        }
        let t = parse_template(tpl).unwrap_or_else(|e| panic!("{name}: {e:?}"));
        let (meta, content) = sample(&g, c["sample"].as_str().unwrap());
        let out = render_filename(
            &t,
            &meta,
            &content,
            platform(c["platform"].as_str().unwrap()),
        );
        assert_eq!(out, c["out"].as_str().unwrap(), "{name}");
    }
}

/// 골든의 기본 템플릿 케이스는 `default_filename`과도 같다(손으로 계산한 값과 기존 함수가 일치).
#[test]
fn golden_default_cases_match_default_filename() {
    let g = golden();
    let mut n = 0;
    for c in g["cases"].as_array().unwrap() {
        if c["template"].as_str() != Some(DEFAULT_TEMPLATE) {
            continue;
        }
        let (meta, _) = sample(&g, c["sample"].as_str().unwrap());
        let p = platform(c["platform"].as_str().unwrap());
        assert_eq!(default_filename(&meta, p), c["out"].as_str().unwrap());
        n += 1;
    }
    assert!(n >= 4);
}
