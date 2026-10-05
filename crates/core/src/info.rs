//! VOD·클립 정보 JSON 파서와 재생 방식 분류(설계 §3.2, spec §3.1·§3.2·§4).
//!
//! 네트워크 없이 응답 바이트만 다루는 순수 함수다. `inKey` 분기는 이 모듈의 `classify` 한 곳에만 있다.
//!
//! - 문자열 필드는 전부 `Option<String>`으로 받고 `None`과 `""`를 같게 본다(Go는 null을 `""`로 읽었다).
//! - 오류 메시지에 서명 토큰이 든 원문 URL을 넣지 않는다.

use std::fmt;

use ::url::Url;
use serde::Deserialize;
use serde_json::Value;

use crate::error::{Error, Unsupported};
use crate::http::{DebugUrl, Secret, masked};
use crate::model::{ContentKind, ContentMeta, Quality};

/// VOD info(`/service/v2/videos/{no}`)의 `content`에서 읽는 필드.
///
/// `Debug`는 `in_key`와 `live_rewind_playback_json`(서명 주소 포함)을 `***`로 가린다.
#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VideoContent {
    pub video_id: Option<String>,
    pub video_title: Option<String>,
    pub in_key: Option<String>,
    pub encryption_type: Option<String>,
    /// JSON이 든 문자열(이중 인코딩)
    pub live_rewind_playback_json: Option<String>,
    pub live_open_date: Option<String>,
    pub publish_date: Option<String>,
    pub vod_status: Option<String>,
    pub adult: Option<bool>,
    /// 초
    pub duration: Option<f64>,
    pub channel: Option<ChannelRef>,
}

impl fmt::Debug for VideoContent {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("VideoContent")
            .field("video_id", &self.video_id)
            .field("video_title", &self.video_title)
            .field("in_key", &masked(&self.in_key))
            .field("encryption_type", &self.encryption_type)
            .field(
                "live_rewind_playback_json",
                &masked(&self.live_rewind_playback_json),
            )
            .field("live_open_date", &self.live_open_date)
            .field("publish_date", &self.publish_date)
            .field("vod_status", &self.vod_status)
            .field("adult", &self.adult)
            .field("duration", &self.duration)
            .field("channel", &self.channel)
            .finish()
    }
}

/// `content.channel` / `content.ownerChannel`.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ChannelRef {
    pub channel_id: Option<String>,
    pub channel_name: Option<String>,
}

/// 재생 방식. `classify`·`parse_clip_info`가 만든다.
///
/// `Debug`는 `in_key`를 `***`로, `master_url`을 `http::redact_url`로 가린다.
#[derive(Clone, PartialEq, Eq)]
pub enum Playback {
    /// 일반 VOD·클립. vodplay API에서 MPD를 받는다.
    Dash { video_id: String, in_key: String },
    /// 빠른 다시보기(라이브 리와인드). `master_url`은 `hdnts` 서명 쿼리를 포함한다.
    LiveRewind {
        master_url: Url,
        tracks: Vec<Quality>,
    },
    /// 암호화 VOD(설계 §11 AES seam). `resolve`는 MPD를 받지 않고 `EncryptedVod`를 낸다.
    Encrypted {
        method: String,
        video_id: String,
        in_key: Option<String>,
    },
}

impl fmt::Debug for Playback {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Playback::Dash { video_id, .. } => f
                .debug_struct("Dash")
                .field("video_id", video_id)
                .field("in_key", &Secret::new(()))
                .finish(),
            Playback::LiveRewind { master_url, tracks } => f
                .debug_struct("LiveRewind")
                .field("master_url", &DebugUrl(master_url))
                .field("tracks", tracks)
                .finish(),
            Playback::Encrypted {
                method,
                video_id,
                in_key,
            } => f
                .debug_struct("Encrypted")
                .field("method", method)
                .field("video_id", video_id)
                .field("in_key", &masked(in_key))
                .finish(),
        }
    }
}

/// 응답 봉투. `content`는 `code`를 확인한 뒤에 해석한다.
#[derive(Deserialize)]
struct Envelope {
    code: Option<i64>,
    message: Option<String>,
    #[serde(default)]
    content: Value,
}

/// 봉투를 읽고 `code == 200`이면 `content`를 돌려준다.
fn open_envelope(body: &[u8], what: &'static str) -> Result<Value, Error> {
    let env: Envelope = serde_json::from_slice(body).map_err(|e| Error::Parse {
        what,
        detail: e.to_string(),
    })?;
    match env.code {
        Some(200) => {}
        Some(code) => {
            return Err(Error::Api {
                code,
                message: env.message,
            });
        }
        None => {
            return Err(Error::Parse {
                what,
                detail: "code 필드가 없습니다".into(),
            });
        }
    }
    if !env.content.is_object() {
        return Err(Error::Parse {
            what,
            detail: "content가 object가 아닙니다".into(),
        });
    }
    Ok(env.content)
}

/// 비어 있지 않은 문자열만 남긴다(`None == ""`).
fn non_empty(s: &Option<String>) -> Option<&str> {
    s.as_deref().filter(|s| !s.is_empty())
}

fn owned_non_empty(s: &Option<String>) -> Option<String> {
    non_empty(s).map(str::to_string)
}

/// VOD info 응답을 읽는다. `code != 200`이면 `Error::Api`.
pub fn parse_video_info(body: &[u8]) -> Result<(ContentMeta, VideoContent), Error> {
    const WHAT: &str = "video info";
    let content = open_envelope(body, WHAT)?;
    let v: VideoContent = serde_json::from_value(content).map_err(|e| Error::Parse {
        what: WHAT,
        detail: e.to_string(),
    })?;
    let channel = v.channel.clone().unwrap_or_default();
    let meta = ContentMeta {
        kind: ContentKind::Video,
        title: v.video_title.as_deref().unwrap_or("").trim().to_string(),
        channel_name: channel.channel_name.unwrap_or_default(),
        channel_id: non_empty(&channel.channel_id).map(str::to_lowercase),
        live_open_date: owned_non_empty(&v.live_open_date),
        publish_date: owned_non_empty(&v.publish_date),
        adult: v.adult.unwrap_or(false),
        duration_secs: v.duration,
    };
    Ok((meta, v))
}

/// 재생 방식을 정한다. `encryptionType` → `inKey` → `liveRewindPlaybackJson` 순서다.
///
/// AES VOD에도 `inKey`가 있으므로 `encryptionType`을 가장 먼저 본다.
pub fn classify(v: &VideoContent) -> Result<Playback, Error> {
    if let Some(method) = non_empty(&v.encryption_type) {
        return Ok(Playback::Encrypted {
            method: method.to_string(),
            video_id: v.video_id.clone().unwrap_or_default(),
            in_key: owned_non_empty(&v.in_key),
        });
    }
    if let Some(in_key) = non_empty(&v.in_key) {
        let video_id = non_empty(&v.video_id).ok_or_else(|| Error::Parse {
            what: "video info",
            detail: "inKey는 있는데 videoId가 없습니다".into(),
        })?;
        return Ok(Playback::Dash {
            video_id: video_id.to_string(),
            in_key: in_key.to_string(),
        });
    }
    if let Some(json) = non_empty(&v.live_rewind_playback_json) {
        return parse_live_rewind(json);
    }
    Err(Error::NoPlayback {
        adult: v.adult.unwrap_or(false),
    })
}

/// `liveRewindPlaybackJson` 안쪽.
#[derive(Deserialize)]
struct LiveRewindPlayback {
    #[serde(default)]
    media: Vec<LiveRewindMedia>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LiveRewindMedia {
    protocol: Option<String>,
    path: Option<String>,
    #[serde(default)]
    encoding_track: Vec<EncodingTrack>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EncodingTrack {
    encoding_track_id: String,
    video_bit_rate: Option<u64>,
    video_width: Option<u32>,
    video_height: Option<u32>,
    /// 실물이 문자열(`"60.0"`)이다.
    video_frame_rate: Option<String>,
}

impl EncodingTrack {
    fn into_quality(self) -> Quality {
        // 짧은 변을 해상도로 본다(세로 영상에서도 DASH resolution 라벨과 같은 뜻).
        let resolution = match (self.video_width, self.video_height) {
            (Some(w), Some(h)) => Some(w.min(h)),
            (_, h) => h,
        };
        Quality {
            label: Quality::label_for(&self.encoding_track_id, resolution),
            id: self.encoding_track_id,
            resolution,
            width: self.video_width,
            height: self.video_height,
            bandwidth: self.video_bit_rate,
            frame_rate: self.video_frame_rate,
        }
    }
}

/// 이중 인코딩된 `liveRewindPlaybackJson`에서 `protocol == "HLS"`인 첫 media를 읽는다.
fn parse_live_rewind(json: &str) -> Result<Playback, Error> {
    const WHAT: &str = "liveRewindPlaybackJson";
    let p: LiveRewindPlayback = serde_json::from_str(json).map_err(|e| Error::Parse {
        what: WHAT,
        detail: e.to_string(),
    })?;
    let media = p
        .media
        .into_iter()
        .find(|m| m.protocol.as_deref() == Some("HLS"))
        .ok_or(Error::Unsupported(Unsupported::NoHlsMedia))?;
    let path = non_empty(&media.path).ok_or_else(|| Error::Parse {
        what: WHAT,
        detail: "HLS media에 path가 없습니다".into(),
    })?;
    // 원문 URL에는 서명 토큰이 있으므로 오류에 넣지 않는다.
    let master_url = Url::parse(path).map_err(|e| Error::Parse {
        what: WHAT,
        detail: format!("master 주소가 올바르지 않습니다: {e}"),
    })?;
    if !matches!(master_url.scheme(), "http" | "https") {
        return Err(Error::Parse {
            what: WHAT,
            detail: "master 주소가 http(s)가 아닙니다".into(),
        });
    }
    let tracks = media
        .encoding_track
        .into_iter()
        .map(EncodingTrack::into_quality)
        .collect();
    Ok(Playback::LiveRewind { master_url, tracks })
}

/// 클립 info(`/service/v1/play-info/clip/{id}`)의 `content`.
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct ClipContent {
    video_id: Option<String>,
    in_key: Option<String>,
    content_title: Option<String>,
    adult: Option<bool>,
    owner_channel: Option<ChannelRef>,
}

/// 클립 info 응답을 읽는다. 클립은 항상 DASH다. `videoId`/`inKey`가 비면 `Error::Parse`.
pub fn parse_clip_info(body: &[u8]) -> Result<(ContentMeta, Playback), Error> {
    const WHAT: &str = "clip info";
    let content = open_envelope(body, WHAT)?;
    let c: ClipContent = serde_json::from_value(content).map_err(|e| Error::Parse {
        what: WHAT,
        detail: e.to_string(),
    })?;
    let (Some(video_id), Some(in_key)) = (non_empty(&c.video_id), non_empty(&c.in_key)) else {
        return Err(Error::Parse {
            what: WHAT,
            detail: "클립 재생 정보(videoId/inKey)가 없습니다".into(),
        });
    };
    let playback = Playback::Dash {
        video_id: video_id.to_string(),
        in_key: in_key.to_string(),
    };
    let channel = c.owner_channel.unwrap_or_default();
    let meta = ContentMeta {
        kind: ContentKind::Clip,
        title: c.content_title.as_deref().unwrap_or("").trim().to_string(),
        channel_name: channel.channel_name.unwrap_or_default(),
        channel_id: non_empty(&channel.channel_id).map(str::to_lowercase),
        live_open_date: None,
        publish_date: None,
        adult: c.adult.unwrap_or(false),
        duration_secs: None,
    };
    Ok((meta, playback))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fixture;

    /// 합성 fixture `testdata/vod/video_info.json`의 inKey(자리표시자).
    const VOD_IN_KEY: &str =
        "V100000000000000000000000000000000000000000000000000000000000000000000000000000000b2";

    fn video_content(rel: &str) -> (ContentMeta, VideoContent) {
        parse_video_info(&fixture(rel)).unwrap()
    }

    /// fixture JSON을 `Value`로 바꿔 `content`만 고친 뒤 다시 파싱한다.
    fn video_content_with(rel: &str, edit: impl FnOnce(&mut Value)) -> VideoContent {
        let mut v: Value = serde_json::from_slice(&fixture(rel)).unwrap();
        edit(&mut v["content"]);
        parse_video_info(&serde_json::to_vec(&v).unwrap())
            .unwrap()
            .1
    }

    #[test]
    fn live_rewind_fixture() {
        let (meta, v) = video_content("testdata/hls/video_info.json");
        assert_eq!(meta.kind, ContentKind::Video);
        assert_eq!(meta.title, "테스트 다시보기");
        assert_eq!(meta.channel_name, "테스트채널");
        assert_eq!(
            meta.channel_id.as_deref(),
            Some("000000000000000000000000000000a1")
        );
        assert_eq!(meta.live_open_date.as_deref(), Some("2026-01-02 12:00:00"));
        assert_eq!(meta.publish_date.as_deref(), Some("2026-01-02 13:00:00"));
        assert!(!meta.adult);
        assert_eq!(meta.duration_secs, Some(740.0));

        let Playback::LiveRewind { master_url, tracks } = classify(&v).unwrap() else {
            panic!("LiveRewind가 아니다");
        };
        assert_eq!(master_url.host_str(), Some("hls.example.invalid"));
        assert_eq!(
            master_url.path(),
            "/live_rewind/kr/streamkey0/vod_playlist.m3u8"
        );
        assert!(master_url.query().unwrap().starts_with("hdnts=st=0~exp=0"));

        // spec §4.1 표: encodingTrack 순서 그대로
        let rows: Vec<_> = tracks
            .iter()
            .map(|q| {
                (
                    q.id.as_str(),
                    q.label.as_str(),
                    q.resolution,
                    q.bandwidth,
                    q.width,
                    q.height,
                    q.frame_rate.as_deref(),
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                (
                    "720p",
                    "720p",
                    Some(720),
                    Some(3_000_000),
                    Some(1280),
                    Some(720),
                    Some("60.0")
                ),
                (
                    "480p",
                    "480p",
                    Some(480),
                    Some(1_500_000),
                    Some(852),
                    Some(480),
                    Some("30.0")
                ),
                (
                    "360p",
                    "360p",
                    Some(360),
                    Some(600_000),
                    Some(640),
                    Some(360),
                    Some("30.0")
                ),
                (
                    "144p",
                    "144p",
                    Some(144),
                    Some(128_000),
                    Some(256),
                    Some(144),
                    Some("30.0")
                ),
                (
                    "1080p",
                    "1080p",
                    Some(1080),
                    Some(8_192_000),
                    Some(1920),
                    Some(1080),
                    Some("60.0")
                ),
            ]
        );
    }

    #[test]
    fn dash_fixture() {
        let (meta, v) = video_content("testdata/vod/video_info.json");
        assert_eq!(meta.channel_name, "가상채널");
        assert_eq!(
            meta.channel_id.as_deref(),
            Some("000000000000000000000000000000b2")
        );
        assert!(meta.title.starts_with("가상 일반 VOD"));
        assert_eq!(meta.live_open_date.as_deref(), Some("2026-01-01 23:00:00"));
        assert_eq!(
            classify(&v).unwrap(),
            Playback::Dash {
                video_id: "000000000000000000000000000000000B02".into(),
                in_key: VOD_IN_KEY.into(),
            }
        );
    }

    #[test]
    fn classify_dash() {
        let v = video_content_with("testdata/hls/video_info.json", |c| {
            c["inKey"] = "K".into();
        });
        // inKey가 생기면 liveRewindPlaybackJson이 남아 있어도 DASH다.
        assert!(matches!(classify(&v).unwrap(), Playback::Dash { in_key, .. } if in_key == "K"));
    }

    /// AES VOD에도 inKey가 있다. encryptionType이 먼저다.
    #[test]
    fn classify_aes_precedence() {
        let (_, v) = video_content("testdata/synthetic/vod_info_aes.json");
        assert_eq!(
            classify(&v).unwrap(),
            Playback::Encrypted {
                method: "AES".into(),
                video_id: "000000000000000000000000000000000B02".into(),
                in_key: Some(VOD_IN_KEY.into()),
            }
        );
    }

    #[test]
    fn classify_encryption_empty_string_is_absent() {
        let v = video_content_with("testdata/synthetic/vod_info_aes.json", |c| {
            c["encryptionType"] = "".into();
        });
        assert!(matches!(classify(&v).unwrap(), Playback::Dash { .. }));
    }

    #[test]
    fn classify_inkey_empty_string() {
        // inKey ""와 null은 같다 → 빠른 다시보기로 간다.
        let v = video_content_with("testdata/hls/video_info.json", |c| {
            c["inKey"] = "".into();
        });
        assert!(matches!(classify(&v).unwrap(), Playback::LiveRewind { .. }));
    }

    #[test]
    fn classify_no_playback() {
        let v = video_content_with("testdata/hls/video_info.json", |c| {
            c["liveRewindPlaybackJson"] = Value::Null;
            c["adult"] = true.into();
        });
        assert!(matches!(
            classify(&v),
            Err(Error::NoPlayback { adult: true })
        ));
        let v = video_content_with("testdata/vod/video_info.json", |c| {
            c["inKey"] = "".into();
        });
        assert!(matches!(
            classify(&v),
            Err(Error::NoPlayback { adult: false })
        ));
    }

    #[test]
    fn classify_dash_without_video_id() {
        let v = video_content_with("testdata/vod/video_info.json", |c| {
            c["videoId"] = Value::Null;
        });
        assert!(matches!(classify(&v), Err(Error::Parse { .. })));
    }

    /// `media[0]` 고정이 아니라 `protocol == "HLS"`인 첫 항목이다(spec §9.1-5 정정).
    #[test]
    fn live_rewind_picks_hls_media() {
        let inner = r#"{"media":[
            {"protocol":"DASH","path":"https://x/a.mpd","encodingTrack":[]},
            {"protocol":"HLS","path":"https://x/b.m3u8","encodingTrack":[{"encodingTrackId":"720p"}]}
        ]}"#;
        let v = video_content_with("testdata/hls/video_info.json", |c| {
            c["liveRewindPlaybackJson"] = inner.into();
        });
        let Playback::LiveRewind { master_url, tracks } = classify(&v).unwrap() else {
            panic!()
        };
        assert_eq!(master_url.as_str(), "https://x/b.m3u8");
        // 크기 정보가 없으면 label은 id
        assert_eq!(tracks[0].label, "720p");
        assert_eq!(tracks[0].resolution, None);
    }

    #[test]
    fn live_rewind_rejects() {
        let set = |inner: &str| {
            let v = video_content_with("testdata/hls/video_info.json", |c| {
                c["liveRewindPlaybackJson"] = inner.into();
            });
            classify(&v)
        };
        assert!(matches!(
            set(r#"{"media":[{"protocol":"DASH","path":"https://x/a.mpd"}]}"#),
            Err(Error::Unsupported(Unsupported::NoHlsMedia))
        ));
        assert!(matches!(
            set(r#"{"media":[]}"#),
            Err(Error::Unsupported(Unsupported::NoHlsMedia))
        ));
        assert!(matches!(
            set(r#"{"media":[{"protocol":"HLS"}]}"#),
            Err(Error::Parse { .. })
        ));
        assert!(matches!(set("not json"), Err(Error::Parse { .. })));
        // 서명 토큰이 든 원문 URL을 오류에 넣지 않는다.
        let err = set(r#"{"media":[{"protocol":"HLS","path":"/rel?hdnts=secret"}]}"#).unwrap_err();
        assert!(!err.to_string().contains("secret"), "{err}");
    }

    #[test]
    fn api_code_not_200() {
        let body = br#"{"code":404,"message":"not found","content":null}"#;
        assert!(matches!(
            parse_video_info(body),
            Err(Error::Api { code: 404, message: Some(m) }) if m == "not found"
        ));
        assert!(matches!(
            parse_clip_info(br#"{"code":500,"message":null}"#),
            Err(Error::Api {
                code: 500,
                message: None
            })
        ));
        assert!(matches!(
            parse_video_info(b"<html>"),
            Err(Error::Parse { .. })
        ));
        assert!(matches!(
            parse_video_info(br#"{"code":200,"content":null}"#),
            Err(Error::Parse { .. })
        ));
    }

    #[test]
    fn clip_fixtures() {
        let cases = [
            (
                "testdata/clip/clip_playinfo.json",
                "테스트 클립 하나",
                "000000000000000000000000000000000C03",
            ),
            (
                "testdata/clip/clip_multi_playinfo.json",
                "테스트 클립 둘 - A vs B | 여러 화질 #태그",
                "000000000000000000000000000000000C04",
            ),
        ];
        for (rel, title, vid) in cases {
            let (meta, pb) = parse_clip_info(&fixture(rel)).unwrap();
            assert_eq!(meta.kind, ContentKind::Clip);
            assert_eq!(meta.title, title);
            assert_eq!(meta.channel_name, "클립채널");
            assert_eq!(
                meta.channel_id.as_deref(),
                Some("000000000000000000000000000000c3")
            );
            assert!(!meta.adult);
            assert_eq!(meta.live_open_date, None);
            let Playback::Dash { video_id, in_key } = pb else {
                panic!("{rel}")
            };
            assert_eq!(video_id, vid);
            assert!(!in_key.is_empty());
        }
    }

    #[test]
    fn clip_missing_keys() {
        let mut v: Value =
            serde_json::from_slice(&fixture("testdata/clip/clip_playinfo.json")).unwrap();
        v["content"]["inKey"] = "".into();
        assert!(matches!(
            parse_clip_info(&serde_json::to_vec(&v).unwrap()),
            Err(Error::Parse { .. })
        ));
    }

    #[test]
    fn channel_id_lowercased() {
        let mut body: Value =
            serde_json::from_slice(&fixture("testdata/hls/video_info.json")).unwrap();
        body["content"]["channel"]["channelId"] = "ABCdef".into();
        let (meta, _) = parse_video_info(&serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(meta.channel_id.as_deref(), Some("abcdef"));
    }
}
