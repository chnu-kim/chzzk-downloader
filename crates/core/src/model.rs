//! 코어가 주고받는 데이터 모델.

use std::fmt;

use ::url::Url;
use serde::{Deserialize, Serialize};

use crate::http::DebugUrl;

/// 사용자가 준 주소가 가리키는 컨텐츠. `url::parse_content_url`로 만든다.
///
/// 직렬화 형태: `{"kind":"video","videoNo":123}`, `{"kind":"clip","clipId":"abc"}`.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ContentRef {
    Video { video_no: u64 },
    Clip { clip_id: String },
}

/// 컨텐츠 종류.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ContentKind {
    Video,
    Clip,
}

/// 파일명·표시·소유 확인에 쓰는 메타데이터.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentMeta {
    pub kind: ContentKind,
    /// 앞뒤 공백을 지운 제목
    pub title: String,
    pub channel_name: String,
    /// VOD `content.channel.channelId` / 클립 `ownerChannel.channelId`, 소문자
    pub channel_id: Option<String>,
    /// `"YYYY-MM-DD HH:MM:SS"`(KST 문자열 그대로)
    pub live_open_date: Option<String>,
    /// 파일명 날짜 폴백
    pub publish_date: Option<String>,
    pub adult: bool,
    pub duration_secs: Option<f64>,
}

/// 사용자가 고르는 화질 하나.
///
/// `id`는 정확 일치 선택 키다. `label`은 표시와 "마지막 화질" 기억에만 쓴다.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    /// DASH rep@id(`"PD_720P_1280_2048_192"`) / HLS encodingTrackId(`"720p"`)
    pub id: String,
    /// `"{resolution}p"`, resolution이 없으면 `id`
    pub label: String,
    /// 짧은 변. DASH `Label[kind=resolution]` / HLS `min(videoWidth, videoHeight)`
    pub resolution: Option<u32>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub bandwidth: Option<u64>,
    /// 실물이 문자열이다(`"60.0"`, `"30"`).
    pub frame_rate: Option<String>,
}

impl Quality {
    /// `resolution`으로 `label`을 정해 만든다.
    pub(crate) fn label_for(id: &str, resolution: Option<u32>) -> String {
        match resolution {
            Some(r) => format!("{r}p"),
            None => id.to_string(),
        }
    }
}

/// 다운로드 방식. 목록을 보여 줄 때의 종류와 재조회 결과를 비교하는 데 쓴다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PlaybackKind {
    Progressive,
    LiveRewindHls,
}

/// PD(progressive mp4) 화질 하나와 그 다운로드 주소.
///
/// `Debug`는 주소를 `http::redact_url`로 가린다.
#[derive(Clone, PartialEq, Eq)]
pub struct PdRep {
    pub quality: Quality,
    /// 서명 쿼리가 든 주소. 로그·오류에는 `http::redact_url`을 거친다.
    pub url: Url,
}

impl fmt::Debug for PdRep {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("PdRep")
            .field("quality", &self.quality)
            .field("url", &DebugUrl(&self.url))
            .finish()
    }
}

/// 다운로드 소스. `Debug`는 서명 주소를 가린다.
#[derive(Clone, PartialEq, Eq)]
pub enum Source {
    /// PD 필터를 통과한 rep만
    Progressive { reps: Vec<PdRep> },
    /// master playlist는 다운로드 때 받는다.
    LiveRewindHls {
        master_url: Url,
        tracks: Vec<Quality>,
    },
}

impl fmt::Debug for Source {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Source::Progressive { reps } => {
                f.debug_struct("Progressive").field("reps", reps).finish()
            }
            Source::LiveRewindHls { master_url, tracks } => f
                .debug_struct("LiveRewindHls")
                .field("master_url", &DebugUrl(master_url))
                .field("tracks", tracks)
                .finish(),
        }
    }
}

/// `resolve` 결과.
#[derive(Clone, Debug, PartialEq)]
pub struct Resolved {
    pub content: ContentRef,
    pub meta: ContentMeta,
    pub source: Source,
}

impl Resolved {
    /// 다운로드 방식.
    pub fn kind(&self) -> PlaybackKind {
        match self.source {
            Source::Progressive { .. } => PlaybackKind::Progressive,
            Source::LiveRewindHls { .. } => PlaybackKind::LiveRewindHls,
        }
    }

    /// 화질 목록. 원래 순서(MPD·encodingTrack 순서) 그대로이며 정렬하지 않는다.
    pub fn qualities(&self) -> Vec<&Quality> {
        match &self.source {
            Source::Progressive { reps } => reps.iter().map(|r| &r.quality).collect(),
            Source::LiveRewindHls { tracks, .. } => tracks.iter().collect(),
        }
    }

    /// 기본으로 고를 화질의 index.
    ///
    /// `last_label`과 `label`이 같은 첫 항목 → 없으면 `resolution.or(height)`가 가장 큰 항목
    /// (같으면 앞) → 그것도 없으면 0.
    pub fn default_quality(&self, last_label: Option<&str>) -> usize {
        default_quality_index(&self.qualities(), last_label)
    }
}

/// `Resolved::default_quality`의 본체. 목록만으로 계산한다.
pub(crate) fn default_quality_index(qs: &[&Quality], last_label: Option<&str>) -> usize {
    if let Some(last) = last_label
        && let Some(i) = qs.iter().position(|q| q.label == last)
    {
        return i;
    }
    let mut best: Option<(usize, u32)> = None;
    for (i, q) in qs.iter().enumerate() {
        if let Some(v) = q.resolution.or(q.height)
            && best.is_none_or(|(_, b)| v > b)
        {
            best = Some((i, v));
        }
    }
    best.map_or(0, |(i, _)| i)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::info::{Playback, classify, parse_video_info};
    use crate::testutil::fixture;

    fn hls_resolved() -> Resolved {
        let (meta, v) = parse_video_info(&fixture("testdata/hls/video_info.json")).unwrap();
        let Playback::LiveRewind { master_url, tracks } = classify(&v).unwrap() else {
            panic!("LiveRewind가 아니다")
        };
        Resolved {
            content: ContentRef::Video { video_no: 9000001 },
            meta,
            source: Source::LiveRewindHls { master_url, tracks },
        }
    }

    /// spec §5.6 기본 선택(설계 §8.1: resolution 기준, label 비교)
    #[test]
    fn default_quality() {
        let r = hls_resolved();
        assert_eq!(r.kind(), PlaybackKind::LiveRewindHls);
        assert_eq!(r.qualities().len(), 5);
        // resolution 최대 → index 4(`1080p`)
        assert_eq!(r.default_quality(None), 4);
        assert_eq!(r.default_quality(Some("480p")), 1);
        // 옛 Go 형식 이름은 일치하지 않으므로 최대 해상도로 폴백
        assert_eq!(r.default_quality(Some("720P_1280_2048_192")), 4);

        // 클립(세로 영상): height(1280/854)가 아니라 resolution 라벨(720/480) 기준
        let reps = crate::mpd::parse_mpd(&crate::testutil::fixture_str(
            "testdata/clip/clip_multi.mpd",
        ))
        .unwrap();
        let (meta, _) =
            crate::info::parse_clip_info(&fixture("testdata/clip/clip_multi_playinfo.json"))
                .unwrap();
        let clip = Resolved {
            content: ContentRef::Clip {
                clip_id: "x".into(),
            },
            meta,
            source: Source::Progressive {
                reps: crate::mpd::pd_reps(&reps).unwrap(),
            },
        };
        assert_eq!(clip.kind(), PlaybackKind::Progressive);
        assert_eq!(clip.default_quality(None), 0);
        assert_eq!(clip.default_quality(Some("480p")), 1);
        // 옛 Go `lastQualityName`(qualityId 라벨)은 일치하지 않아 폴백
        assert_eq!(clip.default_quality(Some("720P_1280_2048_192")), 0);
    }

    #[test]
    fn default_quality_without_sizes() {
        let q = |id: &str, res: Option<u32>| Quality {
            id: id.into(),
            label: Quality::label_for(id, res),
            resolution: res,
            width: None,
            height: None,
            bandwidth: None,
            frame_rate: None,
        };
        let a = q("a", None);
        let b = q("b", None);
        assert_eq!(default_quality_index(&[&a, &b], None), 0);
        assert_eq!(default_quality_index(&[], Some("x")), 0);
        // 같은 해상도면 앞의 것
        let c = q("c", Some(720));
        let d = q("d", Some(720));
        assert_eq!(default_quality_index(&[&a, &c, &d], None), 1);
    }

    #[test]
    fn playback_kind_serializes_camel_case() {
        assert_eq!(
            serde_json::to_string(&PlaybackKind::LiveRewindHls).unwrap(),
            "\"liveRewindHls\""
        );
    }
}
