//! DTO JSON 모양(app.md §5, §13): 코어 직렬화와 TS 미러가 같은지, camelCase, `u64` → 숫자, 이벤트 스냅샷.

use chzzk_core::{
    ContentKind, ContentMeta, ContentRef, DuplicatePolicy, LegacyImport, NaverCookies, PdRep,
    Phase, Platform, PlaybackKind, Progress, Quality, RecentVod, Resolved, Source, UserSettings,
};
use chzzk_shell::dto::{
    AuthStatusDto, ContentKindDto, ContentMetaDto, ContentRefTs, EnqueueRequest, JobDto, JobEvent,
    JobStatus, LegacyImportDto, Nullable, OnExisting, Ownership, PhaseTs, PlaybackKindTs,
    ProgressDto, QualityDto, ResolvedDto, SettingsPatch,
};
use chzzk_shell::{AppError, JobId, Stage};
use serde_json::{Value, json};

fn to_json<T: serde::Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap()
}

// ---------------------------------------------------------------------------
// 코어 타입과 TS 미러
// ---------------------------------------------------------------------------

// 미러는 `_` arm 없는 `From<코어>`로 만든다. 코어에 변형이 늘면 셸 컴파일이 깨지고, 아래 검사는
// 그 변환을 거친 미러가 코어와 같은 JSON인지 본다.

/// 기대 JSON. `_` arm이 없어 코어에 컨텐츠 종류가 늘면 테스트도 컴파일이 깨진다.
fn content_ref_json(c: &ContentRef) -> Value {
    match c {
        ContentRef::Video { video_no } => json!({"kind": "video", "videoNo": video_no}),
        ContentRef::Clip { clip_id } => json!({"kind": "clip", "clipId": clip_id}),
    }
}

#[test]
fn content_ref_mirror_matches_core() {
    for (core, s) in [
        (
            ContentRef::Video { video_no: 123 },
            json!({"kind": "video", "videoNo": 123}),
        ),
        (
            ContentRef::Clip {
                clip_id: "abc".into(),
            },
            json!({"kind": "clip", "clipId": "abc"}),
        ),
    ] {
        assert_eq!(to_json(&core), to_json(&ContentRefTs::from(&core)));
        assert_eq!(to_json(&core), s);
        assert_eq!(content_ref_json(&core), s);
    }
}

/// 기대 JSON. `_` arm이 없어 코어에 방식이 늘면 테스트도 컴파일이 깨진다.
fn playback_kind_json(k: PlaybackKind) -> &'static str {
    match k {
        PlaybackKind::Progressive => "progressive",
        PlaybackKind::LiveRewindHls => "liveRewindHls",
    }
}

#[test]
fn playback_kind_mirror_matches_core() {
    for core in [PlaybackKind::Progressive, PlaybackKind::LiveRewindHls] {
        assert_eq!(to_json(&core), to_json(&PlaybackKindTs::from(core)));
        assert_eq!(to_json(&core), json!(playback_kind_json(core)));
    }
}

/// 기대 JSON. `_` arm이 없어 코어에 단계가 늘면 테스트도 컴파일이 깨진다.
fn phase_json(p: Phase) -> &'static str {
    match p {
        Phase::Resolving => "resolving",
        Phase::Downloading => "downloading",
        Phase::Reresolving => "reresolving",
        Phase::Finalizing => "finalizing",
    }
}

#[test]
fn phase_mirror_matches_core() {
    for core in [
        Phase::Resolving,
        Phase::Downloading,
        Phase::Reresolving,
        Phase::Finalizing,
    ] {
        assert_eq!(to_json(&core), to_json(&PhaseTs::from(core)));
        assert_eq!(to_json(&core), json!(phase_json(core)));
    }
}

/// 코어 `ContentKind`는 `"Video"`로 나가므로 셸이 §5대로 `"video"`로 옮긴다.
#[test]
fn content_kind_is_lower_camel() {
    assert_eq!(to_json(&ContentKind::Video), json!("Video"));
    assert_eq!(
        to_json(&ContentKindDto::from(ContentKind::Video)),
        json!("video")
    );
    assert_eq!(
        to_json(&ContentKindDto::from(ContentKind::Clip)),
        json!("clip")
    );
    let back: ContentKindDto = serde_json::from_value(json!("clip")).unwrap();
    assert_eq!(back, ContentKindDto::Clip);
}

// ---------------------------------------------------------------------------
// 진행률·작업·이벤트
// ---------------------------------------------------------------------------

fn hls_progress() -> Progress {
    Progress {
        phase: Phase::Downloading,
        bytes: 5_000_000_000,
        total_bytes: None,
        total_bytes_estimate: Some(9_007_199_254_740_000),
        segments: Some((12, 345)),
        media_secs: Some((24.0, 690.5)),
        speed_bps: Some(1_048_576),
        eta_secs: Some(138),
        resumed_from: 1_000,
        refreshes: 1,
    }
}

#[test]
fn progress_tuples_are_flattened() {
    let p = ProgressDto::from(&hls_progress());
    assert_eq!(
        to_json(&p),
        json!({
            "phase": "downloading",
            "bytes": 5_000_000_000u64,
            "totalBytes": null,
            "totalBytesEstimate": 9_007_199_254_740_000u64,
            "segmentsDone": 12,
            "segmentsTotal": 345,
            "mediaSecsDone": 24.0,
            "mediaSecsTotal": 690.5,
            "speedBps": 1_048_576,
            "etaSecs": 138,
            "resumedFrom": 1_000,
            "refreshes": 1
        })
    );
    let progressive = Progress {
        phase: Phase::Finalizing,
        bytes: 10,
        total_bytes: Some(10),
        total_bytes_estimate: None,
        segments: None,
        media_secs: None,
        speed_bps: None,
        eta_secs: None,
        resumed_from: 0,
        refreshes: 0,
    };
    let v = to_json(&ProgressDto::from(&progressive));
    assert_eq!(v["segmentsDone"], Value::Null);
    assert_eq!(v["mediaSecsTotal"], Value::Null);
    assert_eq!(v["totalBytes"], json!(10));
}

fn job(status: JobStatus) -> JobDto {
    JobDto {
        id: JobId(41),
        url: "https://chzzk.naver.com/video/123".into(),
        title: "제목".into(),
        channel_name: "채널".into(),
        kind: ContentKindDto::Video,
        playback_kind: PlaybackKind::Progressive,
        quality_label: "720p".into(),
        output: "/v/[251005] 채널 - 제목.mp4".into(),
        status,
        progress: None,
        error: None,
        partial_bytes: None,
        final_bytes: None,
        missing: false,
        created_at: 1_759_650_000,
        finished_at: None,
    }
}

#[test]
fn job_event_status_snapshot() {
    let mut j = job(JobStatus::Failed);
    j.error =
        Some(AppError::from(chzzk_core::Error::NoPlayback { adult: false }).at(Stage::Resolve));
    j.partial_bytes = Some(1_234_567);
    j.finished_at = Some(1_759_650_100);
    assert_eq!(
        to_json(&JobEvent::Status { job: j }),
        json!({
            "type": "status",
            "job": {
                "id": 41,
                "url": "https://chzzk.naver.com/video/123",
                "title": "제목",
                "channelName": "채널",
                "kind": "video",
                "playbackKind": "progressive",
                "qualityLabel": "720p",
                "output": "/v/[251005] 채널 - 제목.mp4",
                "status": "failed",
                "progress": null,
                "error": {
                    "code": "noPlayback",
                    "message": "재생 정보가 없습니다",
                    "stage": "resolve",
                    "resumable": true,
                    "payload": {"type": "noPlayback", "adult": false}
                },
                "partialBytes": 1_234_567,
                "finalBytes": null,
                "missing": false,
                "createdAt": 1_759_650_000u64,
                "finishedAt": 1_759_650_100u64
            }
        })
    );
}

#[test]
fn job_event_other_variants() {
    let added = to_json(&JobEvent::Added {
        job: job(JobStatus::Queued),
    });
    assert_eq!(added["type"], json!("added"));
    assert_eq!(added["job"]["status"], json!("queued"));

    let progress = to_json(&JobEvent::Progress {
        id: JobId(41),
        progress: ProgressDto::from(&hls_progress()),
    });
    assert_eq!(progress["type"], json!("progress"));
    assert_eq!(progress["id"], json!(41));
    assert_eq!(progress["progress"]["segmentsTotal"], json!(345));

    assert_eq!(
        to_json(&JobEvent::Removed { id: JobId(41) }),
        json!({"type": "removed", "id": 41})
    );
}

#[test]
fn job_status_names_and_active() {
    let all = [
        (JobStatus::Queued, "queued", true),
        (JobStatus::Running, "running", true),
        (JobStatus::Pausing, "pausing", true),
        (JobStatus::Paused, "paused", true),
        (JobStatus::Interrupted, "interrupted", true),
        (JobStatus::Completed, "completed", false),
        (JobStatus::Skipped, "skipped", false),
        (JobStatus::Failed, "failed", false),
    ];
    for (s, name, active) in all {
        assert_eq!(to_json(&s), json!(name));
        assert_eq!(s.is_active(), active, "{name}");
        let back: JobStatus = serde_json::from_value(json!(name)).unwrap();
        assert_eq!(back, s);
    }
}

/// `u64`는 JSON 숫자(문자열·bigint 아님)이고 `JobId`는 감싸지 않은 숫자다.
#[test]
fn large_ints_are_plain_numbers() {
    let mut j = job(JobStatus::Completed);
    j.final_bytes = Some(9_007_199_254_740_991);
    let v = to_json(&j);
    assert!(v["finalBytes"].is_u64());
    assert!(v["id"].is_u64());
    let id: JobId = serde_json::from_value(json!(7)).unwrap();
    assert_eq!(id, JobId(7));
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

fn quality(id: &str, res: u32) -> Quality {
    Quality {
        id: id.into(),
        label: format!("{res}p"),
        resolution: Some(res),
        width: Some(res * 16 / 9),
        height: Some(res),
        bandwidth: Some(2_048_000),
        frame_rate: Some("30".into()),
    }
}

fn resolved() -> Resolved {
    let rep = |id: &str, res: u32| PdRep {
        quality: quality(id, res),
        url: url::Url::parse(&format!(
            "https://cdn.example/{id}.mp4?_lsu_sa_=SIGNEDTOKEN"
        ))
        .unwrap(),
    };
    Resolved {
        content: ContentRef::Video { video_no: 123 },
        meta: ContentMeta {
            kind: ContentKind::Video,
            title: "제목".into(),
            channel_name: "채널".into(),
            channel_id: Some("75cb".into()),
            live_open_date: Some("2025-10-05 12:00:00".into()),
            publish_date: None,
            adult: false,
            duration_secs: Some(3600.5),
        },
        source: Source::Progressive {
            reps: vec![
                rep("PD_480P_854_1024_96", 480),
                rep("PD_720P_1280_2048_192", 720),
            ],
        },
    }
}

#[test]
fn resolved_dto_snapshot_without_signed_urls() {
    let dto = ResolvedDto::new(
        "https://chzzk.naver.com/video/123".into(),
        &resolved(),
        None,
        Platform::Linux,
        Ownership::Unchecked,
    );
    let v = to_json(&dto);
    let s = v.to_string();
    assert!(!s.contains("SIGNEDTOKEN"), "{s}");
    assert!(!s.contains("cdn.example"), "{s}");
    assert_eq!(v["content"], json!({"kind": "video", "videoNo": 123}));
    assert_eq!(v["playbackKind"], json!("progressive"));
    assert_eq!(v["ownership"], json!("unchecked"));
    // 해상도 최대(720p, index 1)
    assert_eq!(v["defaultQualityIndex"], json!(1));
    assert_eq!(v["suggestedFileName"], json!("[251005] 채널 - 제목"));
    assert_eq!(
        v["meta"],
        json!({
            "kind": "video",
            "title": "제목",
            "channelName": "채널",
            "channelId": "75cb",
            "liveOpenDate": "2025-10-05 12:00:00",
            "publishDate": null,
            "adult": false,
            "durationSecs": 3600.5
        })
    );
    assert_eq!(
        v["qualities"][1],
        json!({
            "id": "PD_720P_1280_2048_192",
            "label": "720p",
            "resolution": 720,
            "width": 1280,
            "height": 720,
            "bandwidth": 2_048_000,
            "frameRate": "30"
        })
    );

    // 마지막 화질 라벨이 있으면 그것
    let dto = ResolvedDto::new(
        String::new(),
        &resolved(),
        Some("480p"),
        Platform::Linux,
        Ownership::Unchecked,
    );
    assert_eq!(dto.default_quality_index, 0);
}

#[test]
fn ownership_names() {
    for (o, s) in [
        (Ownership::Unchecked, "unchecked"),
        (Ownership::Own, "own"),
        (Ownership::NotOwn, "notOwn"),
        (Ownership::Unknown, "unknown"),
    ] {
        assert_eq!(to_json(&o), json!(s));
    }
}

// ---------------------------------------------------------------------------
// 프런트가 보내는 값
// ---------------------------------------------------------------------------

#[test]
fn enqueue_request_from_camel_case() {
    let req: EnqueueRequest = serde_json::from_value(json!({
        "url": "https://chzzk.naver.com/clips/abc",
        "content": {"kind": "clip", "clipId": "abc"},
        "title": "제목",
        "channelName": "채널",
        "channelId": null,
        "qualityId": "720p",
        "qualityLabel": "720p",
        "expectedKind": "liveRewindHls",
        "folder": null,
        "fileName": "[클립] 채널 - 제목",
        "onExisting": "overwrite",
        "restart": true
    }))
    .unwrap();
    assert_eq!(
        req.content,
        ContentRef::Clip {
            clip_id: "abc".into()
        }
    );
    assert_eq!(req.expected_kind, PlaybackKind::LiveRewindHls);
    assert_eq!(req.on_existing, OnExisting::Overwrite);
    assert!(req.restart);
    assert_eq!(req.folder, None);
    assert_eq!(
        DuplicatePolicy::from(OnExisting::Overwrite),
        DuplicatePolicy::Overwrite
    );
    assert_eq!(
        DuplicatePolicy::from(OnExisting::Skip),
        DuplicatePolicy::Skip
    );
}

/// 키 없음·`null`·값을 구분한다.
#[test]
fn settings_patch_distinguishes_absent_null_value() {
    let p: SettingsPatch = serde_json::from_value(json!({})).unwrap();
    assert_eq!(p, SettingsPatch::default());
    assert_eq!(p.download_folder, Nullable::Keep);

    let p: SettingsPatch = serde_json::from_value(json!({"downloadFolder": null})).unwrap();
    assert_eq!(p.download_folder, Nullable::Clear);

    let p: SettingsPatch = serde_json::from_value(json!({
        "downloadFolder": "/v",
        "useNaverCookies": true,
        "segmentConcurrency": 6,
        "maxParallelDownloads": 3,
        "autoResumeInterrupted": true
    }))
    .unwrap();
    assert_eq!(p.download_folder, Nullable::Set("/v".to_string()));
    assert_eq!(p.use_naver_cookies, Some(true));
    assert_eq!(p.segment_concurrency, Some(6));
    assert_eq!(p.max_parallel_downloads, Some(3));
    assert_eq!(p.auto_resume_interrupted, Some(true));

    // 다른 필드의 null은 "바꾸지 않음"
    let p: SettingsPatch = serde_json::from_value(json!({"useNaverCookies": null})).unwrap();
    assert_eq!(p.use_naver_cookies, None);
}

// ---------------------------------------------------------------------------
// 그 밖
// ---------------------------------------------------------------------------

#[test]
fn legacy_import_dto_has_no_cookie_values() {
    let l = LegacyImport {
        settings: UserSettings {
            recent_vods: vec![
                RecentVod {
                    url: "https://chzzk.naver.com/video/1".into(),
                    title: "a".into(),
                },
                RecentVod {
                    url: "https://chzzk.naver.com/video/2".into(),
                    title: "b".into(),
                },
            ],
            ..UserSettings::default()
        },
        cookies: Some(NaverCookies::new("NIDSECRET_AUT", "NIDSECRET_SES")),
        warnings: vec!["평문 쿠키".into()],
    };
    let v = to_json(&LegacyImportDto::from(&l));
    assert_eq!(
        v,
        json!({"recentCount": 2, "hasCookies": true, "warnings": ["평문 쿠키"]})
    );
    assert!(!v.to_string().contains("NIDSECRET"));
}

#[test]
fn auth_status_disabled() {
    assert_eq!(
        to_json(&AuthStatusDto::disabled()),
        json!({"state": "disabled", "channelId": null, "channelName": null})
    );
}

// ---------------------------------------------------------------------------
// 코어 구조체 → DTO가 필드를 흘리지 않는다
// ---------------------------------------------------------------------------

/// `ContentMeta`의 모든 필드가 DTO에 같은 이름·값으로 간다(`kind`만 소문자로 옮긴다).
#[test]
fn content_meta_dto_keeps_every_core_field() {
    let m = ContentMeta {
        kind: ContentKind::Clip,
        title: "제목".into(),
        channel_name: "채널".into(),
        channel_id: Some("abc".into()),
        live_open_date: Some("2026-01-02 03:04:05".into()),
        publish_date: Some("2026-01-03 00:00:00".into()),
        adult: true,
        duration_secs: Some(12.5),
    };
    let mut core = to_json(&m);
    core["kind"] = json!("clip");
    assert_eq!(to_json(&ContentMetaDto::from(&m)), core);
}

/// `Quality`의 모든 필드가 DTO에 같은 이름·값으로 간다.
#[test]
fn quality_dto_keeps_every_core_field() {
    let q = Quality {
        id: "PD_720P".into(),
        label: "720p".into(),
        resolution: Some(720),
        width: Some(1280),
        height: Some(720),
        bandwidth: Some(2_048_000),
        frame_rate: Some("60.0".into()),
    };
    assert_eq!(to_json(&QualityDto::from(&q)), to_json(&q));
}

/// `Progress`의 모든 필드가 DTO에 간다. 튜플 두 개만 `*Done`·`*Total`로 펼친다.
#[test]
fn progress_dto_keeps_every_core_field() {
    let p = hls_progress();
    let mut core = to_json(&p);
    let obj = core.as_object_mut().unwrap();
    for (tuple, done, total) in [
        ("segments", "segmentsDone", "segmentsTotal"),
        ("mediaSecs", "mediaSecsDone", "mediaSecsTotal"),
    ] {
        let v = obj.remove(tuple).unwrap();
        obj.insert(done.into(), v[0].clone());
        obj.insert(total.into(), v[1].clone());
    }
    assert_eq!(to_json(&ProgressDto::from(&p)), core);
}
