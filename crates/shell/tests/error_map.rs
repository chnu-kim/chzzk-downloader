//! `chzzk_core::Error` → `AppError` 매핑(app.md §5 "오류 DTO", §13).

use std::collections::HashSet;
use std::path::PathBuf;

use chzzk_core::{Error, ErrorKind, PlaybackKind, RequestKind, Unsupported};
use chzzk_shell::{AppError, ErrorCode, ErrorPayload, JobId, RequestKindDto, Stage};
use serde_json::{Value, json};

/// 코어 `ErrorKind` 전체. `sample`의 빠짐없는 match와 함께 새 종류를 놓치지 않게 한다.
const ALL_KINDS: [ErrorKind; 20] = [
    ErrorKind::InvalidUrl,
    ErrorKind::Api,
    ErrorKind::Http,
    ErrorKind::AuthRequired,
    ErrorKind::NoPlayback,
    ErrorKind::Encrypted,
    ErrorKind::NoQualities,
    ErrorKind::QualityNotFound,
    ErrorKind::PlaybackChanged,
    ErrorKind::SourceChanged,
    ErrorKind::RefreshExhausted,
    ErrorKind::Unsupported,
    ErrorKind::Parse,
    ErrorKind::LengthMismatch,
    ErrorKind::Network,
    ErrorKind::DiskFull,
    ErrorKind::FileLocked,
    ErrorKind::Io,
    ErrorKind::Settings,
    ErrorKind::Cancelled,
];

fn network_error() -> Error {
    // 잘못된 주소는 요청을 보내기 전에 reqwest 오류가 된다(네트워크 없음).
    let e = reqwest::Client::new().get("not a url").build().unwrap_err();
    Error::Network(e)
}

/// 종류마다 대표 오류 하나. `_` arm이 없어 코어에 종류가 늘면 컴파일이 깨진다.
fn sample(k: ErrorKind) -> Error {
    match k {
        ErrorKind::InvalidUrl => Error::InvalidUrl,
        ErrorKind::Api => Error::Api {
            code: 9004,
            message: Some("없는 영상".into()),
        },
        ErrorKind::Http => Error::HttpStatus {
            status: 503,
            kind: RequestKind::Media,
        },
        ErrorKind::AuthRequired => Error::AuthRequired { status: 403 },
        ErrorKind::NoPlayback => Error::NoPlayback { adult: true },
        ErrorKind::Encrypted => Error::EncryptedVod {
            method: "AES-128".into(),
        },
        ErrorKind::NoQualities => Error::NoQualities,
        ErrorKind::QualityNotFound => Error::QualityNotFound {
            requested: "1080p".into(),
            available: vec!["720p".into(), "480p".into()],
        },
        ErrorKind::PlaybackChanged => Error::PlaybackChanged {
            was: PlaybackKind::LiveRewindHls,
            now: PlaybackKind::Progressive,
        },
        ErrorKind::SourceChanged => Error::SourceChanged {
            detail: "길이".into(),
        },
        ErrorKind::RefreshExhausted => Error::RefreshExhausted,
        ErrorKind::Unsupported => Error::Unsupported(Unsupported::Discontinuity),
        ErrorKind::Parse => Error::Parse {
            what: "video info",
            detail: "html".into(),
        },
        ErrorKind::LengthMismatch => Error::LengthMismatch {
            expected: 10,
            actual: 9,
        },
        ErrorKind::Network => network_error(),
        ErrorKind::DiskFull => Error::DiskFull {
            path: PathBuf::from("/v/a.mp4.part"),
        },
        ErrorKind::FileLocked => Error::FileLocked {
            path: PathBuf::from("/v/a.mp4.part"),
        },
        ErrorKind::Io => Error::Io {
            op: "write",
            path: PathBuf::from("/v/a.mp4.part"),
            source: std::io::Error::other("EIO"),
        },
        ErrorKind::Settings => Error::Settings("읽기 전용".into()),
        ErrorKind::Cancelled => Error::Cancelled,
    }
}

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

#[test]
fn every_kind_maps_to_same_named_code() {
    let mut codes = HashSet::new();
    for k in ALL_KINDS {
        let e = sample(k);
        assert_eq!(e.kind(), k);
        let app = AppError::from(&e);
        // 코어 ErrorKind의 직렬화 이름과 셸 ErrorCode의 이름이 같다(프런트가 같은 키로 분기).
        assert_eq!(to_json(&app.code), to_json(&k), "{k:?}");
        assert_eq!(app.code, ErrorCode::from(k));
        assert_eq!(app.message, e.to_string());
        assert_eq!(app.resumable, e.is_resumable(), "{k:?}");
        assert_eq!(app.stage, None);
        codes.insert(app.code);
    }
    assert_eq!(codes.len(), ALL_KINDS.len(), "코드가 겹친다");
}

#[test]
fn payload_per_kind() {
    let path = json!({"type": "path", "path": "/v/a.mp4.part"});
    let expected: Vec<(ErrorKind, Value)> = vec![
        (ErrorKind::InvalidUrl, Value::Null),
        (
            ErrorKind::Api,
            json!({"type": "api", "code": 9004, "apiMessage": "없는 영상"}),
        ),
        (
            ErrorKind::Http,
            json!({"type": "http", "status": 503, "requestKind": "media"}),
        ),
        (
            ErrorKind::AuthRequired,
            json!({"type": "authRequired", "status": 403}),
        ),
        (
            ErrorKind::NoPlayback,
            json!({"type": "noPlayback", "adult": true}),
        ),
        (ErrorKind::Encrypted, Value::Null),
        (ErrorKind::NoQualities, Value::Null),
        (
            ErrorKind::QualityNotFound,
            json!({"type": "qualityNotFound", "requested": "1080p", "available": ["720p", "480p"]}),
        ),
        (
            ErrorKind::PlaybackChanged,
            json!({"type": "playbackChanged", "was": "liveRewindHls", "now": "progressive"}),
        ),
        (ErrorKind::SourceChanged, Value::Null),
        (ErrorKind::RefreshExhausted, Value::Null),
        (ErrorKind::Unsupported, Value::Null),
        (ErrorKind::Parse, Value::Null),
        (ErrorKind::LengthMismatch, Value::Null),
        (ErrorKind::Network, Value::Null),
        (ErrorKind::DiskFull, path.clone()),
        (ErrorKind::FileLocked, path.clone()),
        (ErrorKind::Io, path),
        (ErrorKind::Settings, Value::Null),
        (ErrorKind::Cancelled, Value::Null),
    ];
    assert_eq!(expected.len(), ALL_KINDS.len());
    for (k, want) in expected {
        let app = AppError::from(sample(k));
        assert_eq!(to_json(&app.payload), want, "{k:?}");
    }
}

#[test]
fn http_request_kinds() {
    for (core, dto, s) in [
        (RequestKind::Api, RequestKindDto::Api, "api"),
        (RequestKind::Mpd, RequestKindDto::Mpd, "mpd"),
        (RequestKind::Media, RequestKindDto::Media, "media"),
    ] {
        assert_eq!(RequestKindDto::from(core), dto);
        assert_eq!(to_json(&dto), json!(s));
    }
    // 4xx(408·429 제외)는 이어받을 수 없다는 코어 분류가 그대로 넘어온다.
    let app = AppError::from(Error::HttpStatus {
        status: 404,
        kind: RequestKind::Api,
    });
    assert!(!app.resumable);
}

#[test]
fn job_error_json_snapshot() {
    let app = AppError::from(Error::DiskFull {
        path: PathBuf::from("/v/a.mp4.part"),
    })
    .at(Stage::Download);
    assert_eq!(
        to_json(&app),
        json!({
            "code": "diskFull",
            "message": "디스크 공간이 부족합니다: /v/a.mp4.part",
            "stage": "download",
            "resumable": true,
            "payload": {"type": "path", "path": "/v/a.mp4.part"}
        })
    );
    let app = AppError::from(Error::InvalidUrl).at(Stage::Resolve);
    assert_eq!(
        to_json(&app),
        json!({
            "code": "invalidUrl",
            "message": "치지직 VOD 또는 클립 주소가 아닙니다",
            "stage": "resolve",
            "resumable": true,
            "payload": null
        })
    );
}

#[test]
fn shell_errors() {
    let cases = [
        (
            AppError::job_not_found(JobId(7)),
            "jobNotFound",
            Value::Null,
        ),
        (
            AppError::duplicate_output(JobId(3)),
            "duplicateOutput",
            json!({"type": "duplicateOutput", "jobId": 3}),
        ),
        (
            AppError::invalid_input("두 값을 모두 넣어 주세요"),
            "invalidInput",
            Value::Null,
        ),
        (
            AppError::file_missing(&PathBuf::from("/v/a.mp4")),
            "fileMissing",
            json!({"type": "path", "path": "/v/a.mp4"}),
        ),
        (AppError::not_logged_in(), "notLoggedIn", Value::Null),
        (AppError::not_own_content(), "notOwnContent", Value::Null),
        (
            AppError::ownership_unknown(),
            "ownershipUnknown",
            Value::Null,
        ),
        (AppError::internal("x"), "internal", Value::Null),
    ];
    for (app, code, payload) in cases {
        let v = to_json(&app);
        assert_eq!(v["code"], json!(code));
        assert_eq!(v["payload"], payload, "{code}");
        assert_eq!(v["stage"], Value::Null);
        assert_eq!(v["resumable"], json!(false));
        assert!(!app.message.is_empty());
    }
    assert!(AppError::job_not_found(JobId(7)).message.contains('7'));
}

/// `jobs.json`의 `lastError`로 저장했다가 다시 읽는다.
#[test]
fn round_trips_through_json() {
    for k in ALL_KINDS {
        let app = AppError::from(sample(k)).at(Stage::Download);
        let back: AppError = serde_json::from_value(to_json(&app)).unwrap();
        assert_eq!(back, app);
    }
    let dup = AppError::duplicate_output(JobId(3));
    let back: AppError = serde_json::from_value(to_json(&dup)).unwrap();
    assert_eq!(back, dup);
    assert!(matches!(
        back.payload,
        Some(ErrorPayload::DuplicateOutput { job_id: JobId(3) })
    ));
}

#[test]
fn display_is_message() {
    let app = AppError::from(Error::NoQualities);
    assert_eq!(app.to_string(), "다운로드 가능한 화질이 없습니다");
}
