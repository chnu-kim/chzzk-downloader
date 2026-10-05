//! DASH MPD 파서와 PD(progressive mp4) 화질 선택(설계 §3.2, spec §5).
//!
//! - 실물 라벨은 `<nvod:Label>`(`urn:naver:vod:2020`)이므로 요소는 네임스페이스와 무관하게
//!   local name으로 찾는다.
//! - VOD와 클립이 같은 파서·같은 PD 필터·같은 선택 규칙(`id` 정확 일치)을 쓴다.

use std::fmt;

use ::url::Url;
use roxmltree::{Document, Node};

use crate::error::Error;
use crate::http;
use crate::model::{PdRep, Quality};

/// MPD의 Representation 하나. 문자열 속성은 원문 그대로다.
///
/// `Debug`는 `base_urls`의 서명 쿼리(`_lsu_sa_` 등)를 지운다.
#[derive(Clone, PartialEq, Eq)]
pub struct Representation {
    pub id: String,
    /// Representation@mimeType, 없으면 AdaptationSet@mimeType
    pub mime: String,
    pub bandwidth: Option<u64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<String>,
    /// `(kind, 텍스트)`. `nvod:Label`
    pub labels: Vec<(String, String)>,
    /// `BaseURL` 텍스트(엔티티만 풀고 `%xx`는 그대로)
    pub base_urls: Vec<String>,
    /// AdaptationSet 또는 Representation에 `ContentProtection`이 있다(AES 2차 방어).
    pub protected: bool,
}

impl fmt::Debug for Representation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let base_urls: Vec<String> = self
            .base_urls
            .iter()
            .map(|s| match Url::parse(s) {
                Ok(u) => http::redact_url(&u),
                // 상대 주소 등: 쿼리부터 버린다.
                Err(_) => s.split(['?', '#']).next().unwrap_or("").to_string(),
            })
            .collect();
        f.debug_struct("Representation")
            .field("id", &self.id)
            .field("mime", &self.mime)
            .field("bandwidth", &self.bandwidth)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("frame_rate", &self.frame_rate)
            .field("labels", &self.labels)
            .field("base_urls", &base_urls)
            .field("protected", &self.protected)
            .finish()
    }
}

impl Representation {
    /// `kind`가 같은 첫 라벨의 텍스트.
    pub fn label(&self, kind: &str) -> Option<&str> {
        self.labels
            .iter()
            .find(|(k, _)| k == kind)
            .map(|(_, v)| v.as_str())
    }

    /// PD 판정: `video/mp4`, id가 `PD_`로 시작, 첫 BaseURL에 `/pd/`, 보호되지 않음.
    pub fn is_pd(&self) -> bool {
        self.mime.contains("video/mp4")
            && self.id.starts_with("PD_")
            && self.base_urls.first().is_some_and(|u| u.contains("/pd/"))
            && !self.protected
    }
}

fn children<'a, 'input>(
    node: Node<'a, 'input>,
    local: &'static str,
) -> impl Iterator<Item = Node<'a, 'input>> {
    node.children()
        .filter(move |n| n.is_element() && n.tag_name().name() == local)
}

fn parse_err(detail: impl Into<String>) -> Error {
    Error::Parse {
        what: "MPD",
        detail: detail.into(),
    }
}

/// MPD XML을 읽어 모든 Period·AdaptationSet의 Representation을 문서 순서대로 돌려준다.
pub fn parse_mpd(xml: &str) -> Result<Vec<Representation>, Error> {
    let doc = Document::parse(xml).map_err(|e| parse_err(e.to_string()))?;
    let root = doc.root_element();
    if root.tag_name().name() != "MPD" {
        return Err(parse_err(format!(
            "루트 요소가 MPD가 아닙니다: {}",
            root.tag_name().name()
        )));
    }
    let mut out = Vec::new();
    for period in children(root, "Period") {
        for set in children(period, "AdaptationSet") {
            let set_mime = set.attribute("mimeType").unwrap_or("");
            let set_protected = children(set, "ContentProtection").next().is_some();
            for rep in children(set, "Representation") {
                out.push(parse_rep(rep, set_mime, set_protected));
            }
        }
    }
    Ok(out)
}

fn parse_rep(rep: Node<'_, '_>, set_mime: &str, set_protected: bool) -> Representation {
    let text = |n: Node<'_, '_>| n.text().unwrap_or("").trim().to_string();
    Representation {
        id: rep.attribute("id").unwrap_or("").to_string(),
        mime: rep.attribute("mimeType").unwrap_or(set_mime).to_string(),
        bandwidth: rep.attribute("bandwidth").and_then(|v| v.parse().ok()),
        width: rep.attribute("width").and_then(|v| v.parse().ok()),
        height: rep.attribute("height").and_then(|v| v.parse().ok()),
        frame_rate: rep.attribute("frameRate").map(str::to_string),
        labels: children(rep, "Label")
            .map(|n| (n.attribute("kind").unwrap_or("").to_string(), text(n)))
            .collect(),
        base_urls: children(rep, "BaseURL").map(text).collect(),
        protected: set_protected || children(rep, "ContentProtection").next().is_some(),
    }
}

/// PD rep만 골라 화질과 다운로드 주소로 바꾼다. 남는 것이 없으면 `Error::NoQualities`.
///
/// `label`은 `Label[kind=resolution]` + `"p"`(없으면 id), `resolution`은 그 숫자다.
pub fn pd_reps(reps: &[Representation]) -> Result<Vec<PdRep>, Error> {
    let mut out = Vec::new();
    for r in reps.iter().filter(|r| r.is_pd()) {
        // 서명 쿼리가 있으므로 원문 URL은 오류에 넣지 않는다.
        let url = Url::parse(&r.base_urls[0])
            .map_err(|e| parse_err(format!("{}의 BaseURL이 올바르지 않습니다: {e}", r.id)))?;
        let resolution = r.label("resolution").and_then(|v| v.trim().parse().ok());
        out.push(PdRep {
            quality: Quality {
                id: r.id.clone(),
                label: Quality::label_for(&r.id, resolution),
                resolution,
                width: r.width,
                height: r.height,
                bandwidth: r.bandwidth,
                frame_rate: r.frame_rate.clone(),
            },
            url,
        });
    }
    if out.is_empty() {
        return Err(Error::NoQualities);
    }
    Ok(out)
}

/// `quality.id`가 정확히 같은 rep를 고른다. 없으면 `QualityNotFound`(가능한 id 목록 포함).
pub fn select_pd<'a>(reps: &'a [PdRep], quality_id: &str) -> Result<&'a PdRep, Error> {
    reps.iter()
        .find(|r| r.quality.id == quality_id)
        .ok_or_else(|| Error::QualityNotFound {
            requested: quality_id.to_string(),
            available: reps.iter().map(|r| r.quality.id.clone()).collect(),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::fixture_str;

    fn clip_reps() -> Vec<Representation> {
        parse_mpd(&fixture_str("internal/api/testdata/clip_multi.mpd")).unwrap()
    }

    fn vod_mpd() -> String {
        fixture_str("testdata/vod/playback.mpd")
    }

    /// spec §8.1 TestParseClipQualitiesFromMPD + §5.4 표
    #[test]
    fn clip_pd_qualities() {
        let pd = pd_reps(&clip_reps()).unwrap();
        let rows: Vec<_> = pd
            .iter()
            .map(|r| {
                let q = &r.quality;
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
                    "PD_720P_1280_2048_192",
                    "720p",
                    Some(720),
                    Some(1_800_000),
                    Some(720),
                    Some(1280),
                    Some("30")
                ),
                (
                    "PD_480P_854_1024_128",
                    "480p",
                    Some(480),
                    Some(1_000_000),
                    Some(480),
                    Some(854),
                    Some("30")
                ),
            ]
        );
        for r in &pd {
            assert!(r.quality.id.starts_with("PD_"));
            assert!(r.url.path().contains("/pd/"));
            assert!(r.url.path().ends_with(".mp4"));
            assert_eq!(r.url.host_str(), Some("clip.example.invalid"));
        }
    }

    /// spec §8.1 TestSelectClipBaseURLFromMPD
    #[test]
    fn select_exact() {
        let reps = clip_reps();
        let pd = pd_reps(&reps).unwrap();
        let r = select_pd(&pd, "PD_720P_1280_2048_192").unwrap();
        assert!(r.url.as_str().contains("/pd/"));
        assert!(r.url.path().ends_with(".mp4"));
        // %xx 인코딩된 서명 쿼리는 그대로 보존된다.
        assert!(r.url.query().unwrap().starts_with("hdnts=exp%3D0"));

        let Err(Error::QualityNotFound {
            requested,
            available,
        }) = select_pd(&pd, "PD_NONEXISTENT")
        else {
            panic!("QualityNotFound가 아니다");
        };
        assert_eq!(requested, "PD_NONEXISTENT");
        assert_eq!(available, ["PD_720P_1280_2048_192", "PD_480P_854_1024_128"]);

        // HLS용 UUID rep는 파싱은 되지만 선택 대상이 아니다.
        let uuid = "00000000-0000-0000-0000-0000000000c1";
        assert!(reps.iter().any(|r| r.id == uuid && r.mime == "video/mp2t"));
        assert!(matches!(
            select_pd(&pd, uuid),
            Err(Error::QualityNotFound { .. })
        ));
    }

    /// spec §5.1: `nvod:Label`을 local name으로 읽는다.
    #[test]
    fn nvod_label_localname() {
        let reps = clip_reps();
        let r = &reps[0];
        assert_eq!(r.label("qualityId"), Some("720P_1280_2048_192"));
        assert_eq!(r.label("fps"), Some("30"));
        assert_eq!(r.label("resolution"), Some("720"));
        assert_eq!(r.label("none"), None);
    }

    /// spec §9.1-3: 일반 VOD도 PD 필터를 건다.
    #[test]
    fn vod_pd_filter() {
        let reps = parse_mpd(&vod_mpd()).unwrap();
        // video/mp4 2 + video/mp2t 2(AdaptationSet에서 상속) + audio/mp4 1
        let mimes: Vec<_> = reps.iter().map(|r| r.mime.as_str()).collect();
        assert_eq!(
            mimes,
            [
                "video/mp4",
                "video/mp4",
                "video/mp2t",
                "video/mp2t",
                "audio/mp4"
            ]
        );
        assert!(reps.iter().all(|r| !r.protected));

        let pd = pd_reps(&reps).unwrap();
        let ids: Vec<_> = pd.iter().map(|r| r.quality.id.as_str()).collect();
        assert_eq!(ids, ["PD_144P_256_128_64", "PD_720P_1280_4000_192"]);
        let labels: Vec<_> = pd.iter().map(|r| r.quality.label.as_str()).collect();
        assert_eq!(labels, ["144p", "720p"]);
        assert_eq!(pd[1].quality.frame_rate.as_deref(), Some("60"));
        assert_eq!(pd[1].quality.bandwidth, Some(3_200_000));
        for r in &pd {
            assert_eq!(r.url.host_str(), Some("vod.example.invalid"));
            assert!(r.url.path().contains("/pd/"));
        }
    }

    /// AES 2차 방어: `ContentProtection`이 붙은 rep는 PD가 아니다.
    #[test]
    fn content_protection_rejected() {
        let cp = r#"<ContentProtection schemeIdUri="urn:mpeg:dash:sea:2012"/>"#;
        // AdaptationSet 수준
        let xml = vod_mpd().replacen(
            r#"mimeType="video/mp4">"#,
            &format!(r#"mimeType="video/mp4">{cp}"#),
            1,
        );
        let reps = parse_mpd(&xml).unwrap();
        assert!(reps[0].protected && reps[1].protected);
        assert!(matches!(pd_reps(&reps), Err(Error::NoQualities)));

        // Representation 수준(하나만 보호되면 그것만 빠진다)
        let xml = vod_mpd().replacen(
            r#"<nvod:Label kind="qualityId">144P"#,
            &format!(r#"{cp}<nvod:Label kind="qualityId">144P"#),
            1,
        );
        let pd = pd_reps(&parse_mpd(&xml).unwrap()).unwrap();
        let ids: Vec<_> = pd.iter().map(|r| r.quality.id.as_str()).collect();
        assert_eq!(ids, ["PD_720P_1280_4000_192"]);
    }

    #[test]
    fn mpd_rejects() {
        assert!(matches!(parse_mpd("<html/>"), Err(Error::Parse { .. })));
        assert!(matches!(parse_mpd("not xml"), Err(Error::Parse { .. })));
        assert!(matches!(
            pd_reps(&parse_mpd("<MPD/>").unwrap()),
            Err(Error::NoQualities)
        ));
    }

    /// 라벨이 없으면 label은 id, resolution은 None.
    #[test]
    fn label_falls_back_to_id() {
        let xml = r#"<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><AdaptationSet mimeType="video/mp4">
            <Representation id="PD_X" height="360"><BaseURL>https://h/a/pd/x.mp4</BaseURL></Representation>
        </AdaptationSet></Period></MPD>"#;
        let pd = pd_reps(&parse_mpd(xml).unwrap()).unwrap();
        assert_eq!(pd[0].quality.label, "PD_X");
        assert_eq!(pd[0].quality.resolution, None);
        assert_eq!(pd[0].quality.height, Some(360));
    }
}
