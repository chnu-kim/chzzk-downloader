//! 실측 M-⑤-A·B(decisions.md, 사용자 본인 방송 중): 생방송 녹화가 재조회 뒤에도 번호를 이어 받는가, 일시 404 구멍이 얼마나 나는가.
//!
//! ```text
//! cargo run -q -p chzzk-core --example live_check -- <방송 중인 본인 채널 ID> --out <폴더> [--minutes 90] [--probe-every 5] [--quality <id>]
//! ```
//!
//! 두 가지를 함께 돌린다.
//!
//! 1. **엔진 녹화**: `Chzzk::download`로 `--minutes`분 녹화하고 멈춘다(`<폴더>/live_check.mp4`). 엔진이 내는 실측 사건
//!    (`download::live_audit`)을 모아 재조회 뒤 이어짐(`after_refresh`)과 구멍 이유(`gap`)를 센다.
//! 2. **독립 비교**: `--probe-every`분마다 다시 조회해 새 주소의 media playlist를 처음 주소(만료되면 그 뒤의 새 주소)의
//!    playlist와 나란히 읽는다. 겹치는 번호 가운데 가장 새 조각을 양쪽에서 받아 길이·CRC32가 같은지 본다. 서명 만료를
//!    기다리지 않고도 "다시 조회한 주소가 같은 번호 체계를 잇는가"를 직접 본다. 처음 주소가 403이 되는 시점은 서명 수명이다.
//!
//! 출력은 판정 범주와 횟수·분 단위 시간뿐이다. 주소·서명·채널 ID는 찍지 않는다. 저장소(ROADMAP)에는 **판정 범주만** 적는다
//! (공개 저장소 규칙: 시각·길이 같은 준식별자도 옮기지 않는다). 구멍이 생기면 M-⑤-C(구멍 뒤 싱크)는 남긴 파일을 사람이 본다.
//!
//! 종료 코드: 0 녹화가 끝났다 · 1 녹화 오류 · 2 사용법·준비 실패.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use chzzk_core::download::live_audit::{self, Continuity};
use chzzk_core::hls::{self, LiveSnapshot};
use chzzk_core::model::{Quality, Source};
use chzzk_core::{
    CancellationToken, Chzzk, ClientConfig, ContentRef, DownloadOutcome, DownloadRequest,
    DuplicatePolicy, PlaybackKind, Progress,
};
use url::Url;

/// 일시 404 구멍이 시간당 이만큼 이하면 "드묾". 근거 없는 판정 표시 경계다(엔진 동작과 무관, 결과에는 횟수도 함께 찍는다).
const RARE_PER_HOUR: f64 = 2.0;

struct Args {
    channel_id: String,
    out: PathBuf,
    minutes: u64,
    probe_every: u64,
    quality: Option<String>,
}

fn parse_args() -> Option<Args> {
    let mut it = std::env::args().skip(1);
    let channel_id = it.next()?;
    let (mut out, mut minutes, mut probe_every, mut quality) = (None, 90, 5, None);
    while let Some(a) = it.next() {
        match a.as_str() {
            "--out" => out = Some(PathBuf::from(it.next()?)),
            "--minutes" => minutes = it.next()?.parse().ok()?,
            "--probe-every" => probe_every = it.next()?.parse().ok()?,
            "--quality" => quality = Some(it.next()?),
            _ => return None,
        }
    }
    (minutes > 0 && probe_every > 0).then_some(())?;
    Some(Args {
        channel_id,
        out: out?,
        minutes,
        probe_every,
        quality,
    })
}

/// 엔진의 실측 사건. 필드 이름 → 값.
type Fields = BTreeMap<String, String>;

#[derive(Clone, Default)]
struct Audit(Arc<Mutex<Vec<Fields>>>);

impl<S: tracing::Subscriber> tracing_subscriber::Layer<S> for Audit {
    fn on_event(&self, e: &tracing::Event<'_>, _: tracing_subscriber::layer::Context<'_, S>) {
        if e.metadata().target() != live_audit::LOG_TARGET {
            return;
        }
        struct V(Fields);
        impl tracing::field::Visit for V {
            fn record_str(&mut self, f: &tracing::field::Field, v: &str) {
                self.0.insert(f.name().into(), v.into());
            }
            fn record_debug(&mut self, f: &tracing::field::Field, v: &dyn std::fmt::Debug) {
                self.0.insert(f.name().into(), format!("{v:?}"));
            }
        }
        let mut v = V(Fields::new());
        e.record(&mut v);
        self.0.lock().unwrap().push(v.0);
    }
}

/// 독립 비교 한 번의 결과.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Probe {
    /// 겹치는 가장 새 조각이 양쪽에서 같다
    Same,
    /// 같은 번호인데 내용이 다르다
    Differ,
    /// 번호가 겹치지 않는다
    NoOverlap,
    /// 다시 조회한 방송 ID가 다르다
    NewLive,
    /// 확인 못 함(읽기 실패)
    Unknown,
}

struct Http(reqwest::Client);

impl Http {
    async fn get(&self, u: &Url) -> Result<bytes::Bytes, u16> {
        let r = self
            .0
            .get(u.clone())
            .header(reqwest::header::USER_AGENT, chzzk_core::http::user_agent())
            .header(reqwest::header::REFERER, "https://chzzk.naver.com/")
            .send()
            .await
            .map_err(|_| 0u16)?;
        let s = r.status();
        if !s.is_success() {
            return Err(s.as_u16());
        }
        r.bytes().await.map_err(|_| 0)
    }

    async fn media_url(&self, master: &Url, quality: &Quality) -> Result<Url, u16> {
        let b = self.get(master).await?;
        let vs = hls::parse_master(std::str::from_utf8(&b).map_err(|_| 0u16)?, master)
            .map_err(|_| 0u16)?;
        vs.iter()
            .find(|v| v.track_id == quality.id)
            .or_else(|| {
                vs.iter()
                    .find(|v| v.height.is_some() && v.height == quality.height)
            })
            .map(|v| v.uri.clone())
            .ok_or(0)
    }

    async fn snapshot(&self, media: &Url) -> Result<LiveSnapshot, u16> {
        let b = self.get(media).await?;
        hls::parse_live_media(std::str::from_utf8(&b).map_err(|_| 0u16)?, media).map_err(|_| 0)
    }

    async fn fingerprint(&self, snap: &LiveSnapshot, msn: u64) -> Option<(usize, u32)> {
        let s = snap.playlist.segments.iter().find(|s| s.msn == msn)?;
        let b = self.get(&s.uri).await.ok()?;
        Some((b.len(), crc32fast::hash(&b)))
    }
}

/// 서명 쿼리의 `exp=`(유닉스 초)에서 남은 분. 값 자체는 찍지 않는다.
fn minutes_to_exp(u: &Url) -> Option<i64> {
    let exp = u.query_pairs().find_map(|(_, v)| {
        let i = v.find("exp=")? + 4;
        let d: String = v[i..].chars().take_while(char::is_ascii_digit).collect();
        d.parse::<i64>().ok()
    })?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64;
    Some((exp - now) / 60)
}

fn mins(d: Duration) -> u64 {
    d.as_secs() / 60
}

struct Report {
    started: Instant,
    probes: Vec<Probe>,
    /// 처음 주소가 403이 된 때(분)
    first_expired_at: Option<u64>,
}

fn summarize(audit: &Audit, rep: &Report, recorded_secs: f64) -> (String, String) {
    let events = audit.0.lock().unwrap().clone();
    let get = |f: &Fields, k: &str| f.get(k).cloned().unwrap_or_default();
    let num = |f: &Fields, k: &str| f.get(k).and_then(|v| v.parse::<u64>().ok());

    let mut refresh: BTreeMap<String, u32> = BTreeMap::new();
    let mut gaps: BTreeMap<String, u64> = BTreeMap::new();
    let (mut cont, mut skipped, mut behind) = (0u32, 0u32, 0u32);
    for f in &events {
        match get(f, "event").as_str() {
            "refresh" => *refresh.entry(get(f, "cause")).or_default() += 1,
            "gap" => *gaps.entry(get(f, "cause")).or_default() += num(f, "count").unwrap_or(0),
            "after_refresh" => {
                if let (Some(n), Some(a), Some(b)) =
                    (num(f, "next_msn"), num(f, "first"), num(f, "last"))
                {
                    match live_audit::classify(n, a, b) {
                        c if c.continues() => cont += 1,
                        Continuity::Skipped(_) => skipped += 1,
                        _ => behind += 1,
                    }
                }
            }
            _ => {}
        }
    }
    let count = |p: Probe| rep.probes.iter().filter(|x| **x == p).count();
    println!(
        "── 집계({}분 경과, 녹화 {}분) ──",
        mins(rep.started.elapsed()),
        (recorded_secs / 60.0) as u64
    );
    println!("엔진 재조회: {refresh:?}");
    println!("엔진 재조회 뒤 첫 목록: 이어짐 {cont} · 건너뜀 {skipped} · 줄어듦 {behind}");
    println!(
        "독립 비교: 같은 조각 {} · 다른 조각 {} · 겹침 없음 {} · 다른 방송 {} · 확인 못 함 {}",
        count(Probe::Same),
        count(Probe::Differ),
        count(Probe::NoOverlap),
        count(Probe::NewLive),
        count(Probe::Unknown)
    );
    match rep.first_expired_at {
        Some(m) => println!("처음 주소 403: 시작 뒤 약 {m}분"),
        None => println!("처음 주소 403: 아직 없음"),
    }
    println!("구멍: {gaps:?}");

    let a = if behind > 0 {
        "줄어듦"
    } else if count(Probe::Differ) > 0 || count(Probe::NoOverlap) > 0 {
        "안 이어짐(독립 비교)"
    } else if skipped > 0 {
        "안 이어짐(엔진 재조회 뒤 건너뜀, 재조회가 늦었을 수도 있다)"
    } else if cont > 0 || count(Probe::Same) > 0 {
        "이어짐"
    } else {
        "관찰 못 함"
    };
    let gone = gaps.get(live_audit::GAP_SEGMENT_GONE).copied().unwrap_or(0);
    let hours = rep.started.elapsed().as_secs_f64() / 3600.0;
    let b = if gone == 0 {
        "없음"
    } else if (gone as f64) / hours.max(1.0 / 60.0) <= RARE_PER_HOUR {
        "드묾"
    } else {
        "잦음"
    };
    (a.to_string(), b.to_string())
}

#[tokio::main]
async fn main() -> ExitCode {
    use tracing_subscriber::layer::SubscriberExt;

    let Some(args) = parse_args() else {
        eprintln!(
            "사용법: live_check <채널 ID> --out <폴더> [--minutes 90] [--probe-every 5] [--quality <id>]"
        );
        return ExitCode::from(2);
    };
    let audit = Audit::default();
    tracing::subscriber::set_global_default(tracing_subscriber::registry().with(audit.clone()))
        .expect("구독자");

    let c = Chzzk::new(ClientConfig::default()).expect("클라이언트");
    let content = ContentRef::Live {
        channel_id: args.channel_id.clone(),
    };
    let r = match c.resolve(&content).await {
        Ok(r) => r,
        Err(e) => {
            println!("준비 실패: 조회 오류({:?})", e.kind());
            return ExitCode::from(2);
        }
    };
    let Source::Live {
        master_url,
        tracks,
        live_id,
    } = r.source.clone()
    else {
        println!("준비 실패: 생방송이 아니다");
        return ExitCode::from(2);
    };
    let quality = match &args.quality {
        Some(id) => tracks.iter().find(|t| &t.id == id),
        None => tracks
            .iter()
            .filter(|t| !t.audio_only)
            .min_by_key(|t| t.resolution.or(t.height).unwrap_or(u32::MAX)),
    };
    let Some(quality) = quality.cloned() else {
        println!("준비 실패: 화질을 고르지 못했다");
        return ExitCode::from(2);
    };
    println!(
        "화질 {} · {}분 녹화 · {}분마다 비교",
        quality.label, args.minutes, args.probe_every
    );
    match minutes_to_exp(&master_url) {
        Some(m) => println!("서명 만료까지 약 {m}분(주소의 exp 기준)"),
        None => println!("서명 만료 시각을 주소에서 읽지 못했다"),
    }

    let http = Http(reqwest::Client::new());
    let Ok(first_media) = http.media_url(&master_url, &quality).await else {
        println!("준비 실패: media playlist 주소를 얻지 못했다");
        return ExitCode::from(2);
    };
    if std::fs::create_dir_all(&args.out).is_err() {
        println!("준비 실패: 출력 폴더를 만들지 못했다");
        return ExitCode::from(2);
    }
    let output = args.out.join("live_check.mp4");

    let stop = CancellationToken::new();
    let recorded = Arc::new(Mutex::new(0f64));
    let req = DownloadRequest {
        embed_metadata: false,
        throttle: Default::default(),
        content,
        quality_id: quality.id.clone(),
        expected_kind: PlaybackKind::Live,
        output: output.clone(),
        on_existing: DuplicatePolicy::Overwrite,
        concurrency: chzzk_core::download::DEFAULT_CONCURRENCY,
        live_stop: Some(stop.clone()),
        recording_id: None,
        range: None,
    };
    let engine = {
        let (c, recorded) = (c.clone(), recorded.clone());
        tokio::spawn(async move {
            let cb = move |p: Progress| {
                if let Some(l) = p.live {
                    *recorded.lock().unwrap() = l.recorded_secs;
                }
            };
            c.download(req, CancellationToken::new(), &cb).await
        })
    };

    let mut rep = Report {
        started: Instant::now(),
        probes: Vec::new(),
        first_expired_at: None,
    };
    let deadline = rep.started + Duration::from_secs(args.minutes * 60);
    let mut old = first_media;
    let mut engine = engine;
    let result = loop {
        let next_probe = Instant::now() + Duration::from_secs(args.probe_every * 60);
        let wake = next_probe.min(deadline);
        tokio::select! {
            r = &mut engine => break r,
            _ = tokio::time::sleep_until(wake.into()) => {}
        }
        if Instant::now() >= deadline {
            stop.cancel();
            break (&mut engine).await;
        }
        // 독립 비교
        let p = match c
            .resolve(&ContentRef::Live {
                channel_id: args.channel_id.clone(),
            })
            .await
        {
            Ok(r2) => match r2.source {
                Source::Live { live_id: id2, .. } if id2 != live_id => Probe::NewLive,
                Source::Live { master_url: m2, .. } => match http.media_url(&m2, &quality).await {
                    Ok(new_media) => {
                        let (o, n) = (http.snapshot(&old).await, http.snapshot(&new_media).await);
                        let p = match (&o, &n) {
                            (Err(403), Ok(_)) => {
                                rep.first_expired_at
                                    .get_or_insert(mins(rep.started.elapsed()));
                                None
                            }
                            (Ok(o), Ok(n)) => Some(compare(&http, o, n).await),
                            _ => Some(Probe::Unknown),
                        };
                        // 처음 주소가 만료되면 새 주소를 기준으로 잇는다(만료 전에는 처음 주소를 계속 쓴다: 수명을 잰다)
                        if matches!(o, Err(403)) {
                            old = new_media;
                        }
                        p.unwrap_or(Probe::Unknown)
                    }
                    Err(_) => Probe::Unknown,
                },
                _ => Probe::Unknown,
            },
            Err(_) => Probe::Unknown,
        };
        rep.probes.push(p);
        let secs = *recorded.lock().unwrap();
        summarize(&audit, &rep, secs);
    };

    let secs = *recorded.lock().unwrap();
    let (a, b) = summarize(&audit, &rep, secs);
    let code = match result {
        Ok(Ok(DownloadOutcome::Completed { live, .. })) => {
            if let Some(l) = live {
                println!("녹화 끝: {:?} · 구멍 {}", l.reason, l.gaps.unwrap_or(0));
            }
            println!(
                "남긴 파일: {}",
                output.file_name().unwrap().to_string_lossy()
            );
            ExitCode::SUCCESS
        }
        Ok(Ok(other)) => {
            println!("녹화 끝: {other:?}");
            ExitCode::SUCCESS
        }
        Ok(Err(e)) => {
            println!("녹화 오류: {:?}", e.kind());
            ExitCode::FAILURE
        }
        Err(_) => {
            println!("녹화 작업이 비정상 종료했다");
            ExitCode::FAILURE
        }
    };
    println!("판정 M-⑤-A: {a}");
    println!("판정 M-⑤-B: {b}");
    code
}

/// 두 스냅샷에서 겹치는 가장 새 번호의 조각을 양쪽에서 받아 비교한다.
async fn compare(http: &Http, o: &LiveSnapshot, n: &LiveSnapshot) -> Probe {
    let range = |s: &LiveSnapshot| {
        Some((
            s.playlist.segments.first()?.msn,
            s.playlist.segments.last()?.msn,
        ))
    };
    let (Some((oa, ob)), Some((na, nb))) = (range(o), range(n)) else {
        return Probe::Unknown;
    };
    let (lo, hi) = (oa.max(na), ob.min(nb));
    if lo > hi {
        return Probe::NoOverlap;
    }
    match (http.fingerprint(o, hi).await, http.fingerprint(n, hi).await) {
        (Some(x), Some(y)) if x == y => Probe::Same,
        (Some(_), Some(_)) => Probe::Differ,
        _ => Probe::Unknown,
    }
}
