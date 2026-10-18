//! 파일 이름 규칙(템플릿) 미리보기와 오류 문구(docs/design/features/filename-template.md §4.3, app.md 91).
//!
//! 설정 화면은 입력이 바뀔 때마다 `preview_file_name_template` command를 부른다. 검증과 미리보기를 한 곳(코어
//! `naming`)이 해서 정리 규칙이 두 벌이 되지 않는다. 예시 값은 모두 가짜이고 날짜는 고정이다(골든이 날마다
//! 바뀌면 안 된다). 같은 예시를 `design/naming/template.json`이 손으로 계산해 두었다.

use chzzk_core::naming::{
    MAX_TEMPLATE_BYTES, Platform, TemplateError, Token, parse_template, render_filename,
};
use chzzk_core::{ContentKind, ContentMeta, ContentRef};

use crate::dto::{
    ContentKindDto, FileNameTemplatePreview, PreviewName, TemplateErrorDto, TemplateErrorKind,
};

/// 예시 값 하나(종류별).
fn sample(kind: ContentKind) -> (ContentMeta, ContentRef) {
    let (title, live, content) = match kind {
        ContentKind::Video => (
            "저녁 방송",
            Some("2026-10-18 21:00:00"),
            ContentRef::Video { video_no: 12345 },
        ),
        ContentKind::Clip => (
            "웃긴 장면",
            None,
            ContentRef::Clip {
                clip_id: "abcDEF123".into(),
            },
        ),
        ContentKind::Live => (
            "오늘 방송",
            Some("2026-10-18 20:30:00"),
            ContentRef::Live {
                channel_id: "sample-channel".into(),
            },
        ),
    };
    let meta = ContentMeta {
        kind,
        title: title.into(),
        channel_name: "채널이름".into(),
        channel_id: None,
        live_open_date: live.map(str::to_string),
        publish_date: None,
        adult: false,
        duration_secs: None,
    };
    (meta, content)
}

/// 템플릿을 읽어 영상·클립·생방송 예시 이름을 만든다. 읽을 수 없으면 오류 종류를 데이터로 돌려준다
/// (입력 중 상태라 오류 배너가 아니다).
pub fn preview_file_name_template(template: &str, platform: Platform) -> FileNameTemplatePreview {
    match parse_template(template) {
        Ok(t) => FileNameTemplatePreview::Ok {
            names: [ContentKind::Video, ContentKind::Clip, ContentKind::Live]
                .into_iter()
                .map(|kind| {
                    let (meta, content) = sample(kind);
                    PreviewName {
                        kind: ContentKindDto::from(kind),
                        name: render_filename(&t, &meta, &content, platform),
                    }
                })
                .collect(),
        },
        Err(e) => FileNameTemplatePreview::Invalid {
            error: TemplateErrorDto::from(&e),
        },
    }
}

impl From<&TemplateError> for TemplateErrorDto {
    fn from(e: &TemplateError) -> Self {
        let (kind, token) = match e {
            TemplateError::UnbalancedBrace => (TemplateErrorKind::UnbalancedBrace, None),
            TemplateError::UnknownToken(t) => (TemplateErrorKind::UnknownToken, Some(t.clone())),
            TemplateError::DuplicateToken(t) => (
                TemplateErrorKind::DuplicateToken,
                Some(Token::name(*t).to_string()),
            ),
            TemplateError::PathSeparator => (TemplateErrorKind::PathSeparator, None),
            TemplateError::MissingTitle => (TemplateErrorKind::MissingTitle, None),
            TemplateError::TooLong => (TemplateErrorKind::TooLong, None),
        };
        // 문구가 숫자를 따로 적지 않도록 상한을 같이 준다
        let max = matches!(e, TemplateError::TooLong).then_some(MAX_TEMPLATE_BYTES as u32);
        TemplateErrorDto { kind, token, max }
    }
}

/// `update_settings`의 가드 오류 문구(화면이 먼저 막으므로 보통 보이지 않는다).
pub fn error_message(e: &TemplateError) -> String {
    let why = match e {
        TemplateError::UnbalancedBrace => "중괄호 짝이 맞지 않습니다".to_string(),
        TemplateError::UnknownToken(t) => format!("쓸 수 없는 말입니다: {{{t}}}"),
        TemplateError::DuplicateToken(t) => {
            format!("한 번만 쓸 수 있습니다: {{{}}}", Token::name(*t))
        }
        TemplateError::PathSeparator => "/ 와 \\ 는 쓸 수 없습니다".to_string(),
        TemplateError::MissingTitle => "{title}이 들어가야 합니다".to_string(),
        TemplateError::TooLong => "규칙이 너무 깁니다".to_string(),
    };
    format!("파일 이름 규칙을 쓸 수 없습니다. {why}")
}
