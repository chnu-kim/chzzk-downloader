//! `cargo xtask release <명령>`(docs/design/cicd.md §5). 각 명령의 판정은 종료 코드다(0 통과, 1 검사 실패, 2 입력 오류).
//! R2 배치(§5):
//!   releases/<v>/<정식 파일명>[.sig]   불변(If-None-Match: *)
//!   releases/<v>/SHA256SUMS, releases/<v>/manifest.json, releases/<v>/previous(승격 직전의 latest 버전, 롤백 대상)
//!   releases/latest.json               유일한 가변 객체, 항상 마지막에, CAS(If-Match / If-None-Match: *)로 쓴다

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::cli::{Args, Res, check, env, fail, input, usage};
use crate::manifest::{self, Expected, Item};
use crate::s3::{Put, S3, sha256_hex};
use crate::semver;
use crate::sig;

pub const LATEST: &str = "releases/latest.json";

fn key(version: &str, file: &str) -> String {
    format!("releases/{version}/{file}")
}

fn read(p: &Path) -> Res<Vec<u8>> {
    std::fs::read(p).map_err(|e| input(format!("{} 읽기: {e}", p.display())))
}

fn write(p: &Path, data: &[u8]) -> Res<()> {
    std::fs::write(p, data).map_err(|e| input(format!("{} 쓰기: {e}", p.display())))
}

fn version_arg(a: &Args) -> Res<String> {
    let v = a.req("version")?;
    if semver::parse(&v).is_none() {
        return usage(format!("--version {v}: semver가 아니다"));
    }
    Ok(v)
}

fn text(what: &str, b: Vec<u8>) -> Res<String> {
    String::from_utf8(b).map_err(|_| check(format!("{what}: UTF-8이 아니다")))
}

fn gh_output(k: &str, v: &str) -> Res<()> {
    if let Some(p) = env("GITHUB_OUTPUT") {
        use std::io::Write as _;
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .create(true)
            .open(&p)
            .map_err(|e| input(format!("GITHUB_OUTPUT: {e}")))?;
        writeln!(f, "{k}={v}").map_err(|e| input(format!("GITHUB_OUTPUT: {e}")))?;
    }
    Ok(())
}

pub fn dispatch(cmd: &str, a: &Args) -> Res<()> {
    match cmd {
        "collect" => {
            a.only(&["from", "out", "version", "os"])?;
            collect(
                Path::new(&a.req("from")?),
                Path::new(&a.req("out")?),
                &version_arg(a)?,
                a.opt("os").as_deref(),
            )
        }
        "sign" => {
            a.only(&["dir"])?;
            sign(Path::new(&a.req("dir")?))
        }
        "verify-sig" => {
            a.only(&["dir", "pubkey", "sig-dir"])?;
            let dir = PathBuf::from(a.req("dir")?);
            let sig_dir = a
                .opt("sig-dir")
                .map(PathBuf::from)
                .unwrap_or_else(|| dir.clone());
            verify_sig(&dir, &sig_dir, Path::new(&a.req("pubkey")?))
        }
        "sums" => {
            a.only(&["dir"])?;
            sums(Path::new(&a.req("dir")?))
        }
        "manifest" => {
            a.only(&["dir", "version", "pub-date", "base-url"])?;
            make_manifest(
                Path::new(&a.req("dir")?),
                &version_arg(a)?,
                &a.req("pub-date")?,
                &a.req("base-url")?,
            )
        }
        "put" => {
            a.only(&["dir", "version"])?;
            put(
                &S3::from_env()?,
                Path::new(&a.req("dir")?),
                &version_arg(a)?,
            )
        }
        "promote" => {
            a.only(&["dir", "version"])?;
            promote(
                &S3::from_env()?,
                Path::new(&a.req("dir")?),
                &version_arg(a)?,
            )
            .map(|_| ())
        }
        "verify" => {
            a.only(&["version", "pubkey", "base-url", "objects-only"])?;
            let src = Source::from_env(a.opt("base-url").as_deref())?;
            verify(
                &src,
                &version_arg(a)?,
                &read_pubkey(Path::new(&a.req("pubkey")?))?,
                a.opt("base-url").as_deref(),
                !a.flag("objects-only"),
            )
        }
        "rollback" => {
            a.only(&["to", "from", "pubkey", "base-url"])?;
            let to = a.req("to")?;
            if to != "none" && semver::parse(&to).is_none() {
                return usage(format!("--to {to}: semver 또는 none"));
            }
            let s3 = S3::from_env()?;
            let src = Source::S3(&s3);
            rollback(
                &s3,
                &src,
                &to,
                a.opt("from").as_deref(),
                &read_pubkey(Path::new(&a.req("pubkey")?))?,
                a.opt("base-url").as_deref(),
            )
        }
        "keygen" => {
            a.only(&["out"])?;
            let out = PathBuf::from(a.req("out")?);
            let (sk, pk) = sig::keygen(&std::env::var("XTASK_KEY_PASSWORD").unwrap_or_default())?;
            write(&out, sk.as_bytes())?;
            write(
                &PathBuf::from(format!("{}.pub", out.display())),
                pk.as_bytes(),
            )?;
            println!("keygen: {} (+ .pub)", out.display());
            Ok(())
        }
        "get" => {
            a.only(&["key", "out"])?;
            let k = a.req("key")?;
            match S3::from_env()?.get(&k)? {
                Some((b, _)) => write(Path::new(&a.req("out")?), &b),
                None => fail(format!("{k}가 없다")),
            }
        }
        "put-raw" => {
            a.only(&["key", "file"])?;
            if env("XTASK_ALLOW_RAW").as_deref() != Some("1") {
                return usage("put-raw는 selftest 전용이다(XTASK_ALLOW_RAW=1)");
            }
            S3::from_env()?.put_raw(&a.req("key")?, &read(Path::new(&a.req("file")?))?)
        }
        _ => usage(format!("모르는 명령 {cmd}(xtask/src/main.rs 목록)")),
    }
}

pub fn read_pubkey(p: &Path) -> Res<String> {
    let t = text("공개 키", read(p)?)?;
    if t.trim() != t || t.is_empty() {
        return Err(input(format!(
            "{}: 앞뒤 공백·줄바꿈 없는 base64 한 줄이어야 한다",
            p.display()
        )));
    }
    Ok(t)
}

// ---- collect ----

/// OS별 bundles.json(bundle.mjs collect --release가 쓴 폴더들)을 모은다. 기대 집합과 정확히 같고 해시가 맞아야 한다.
/// from: bundles.json이 있는 폴더 하나, 또는 그런 폴더들을 담은 폴더(OS별 artifact를 받은 곳).
/// only_os: 그 OS 하나만 기대한다(빌드 작업의 자체 확인). 없으면 표의 모든 OS가 정확히 하나씩 있어야 한다.
pub fn collect(from: &Path, out: &Path, version: &str, only_os: Option<&str>) -> Res<()> {
    let exp: Vec<Expected> = manifest::expected()?
        .into_iter()
        .filter(|e| only_os.is_none_or(|o| e.os == o))
        .collect();
    let mut by_os: BTreeMap<String, PathBuf> = BTreeMap::new();
    let mut dirs: Vec<PathBuf> = if from.join("bundles.json").exists() {
        vec![from.to_path_buf()]
    } else {
        std::fs::read_dir(from)
            .map_err(|e| input(format!("{}: {e}", from.display())))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_dir())
            .collect()
    };
    dirs.sort();
    for d in dirs {
        let bj = d.join("bundles.json");
        if !bj.exists() {
            return fail(format!("{}: bundles.json이 없다", d.display()));
        }
        let v = manifest::read_json(&bj)?;
        let os = v["os"].as_str().unwrap_or_default().to_string();
        if v["version"].as_str() != Some(version) {
            return fail(format!(
                "{}: version {} ≠ {version}",
                bj.display(),
                v["version"]
            ));
        }
        if v["release"] != Value::Bool(true) {
            return fail(format!(
                "{}: 릴리스 모드(collect --release)로 모으지 않았다",
                bj.display()
            ));
        }
        if by_os.insert(os.clone(), d.clone()).is_some() {
            return fail(format!("OS {os}의 bundles.json이 둘 이상이다"));
        }
    }
    let want_os: BTreeSet<String> = match only_os {
        Some(o) if manifest::OSES.contains(&o) => [o.to_string()].into(),
        Some(o) => return usage(format!("--os {o}: {}", manifest::OSES.join("|"))),
        None => manifest::OSES.iter().map(|s| s.to_string()).collect(),
    };
    let got_os: BTreeSet<String> = by_os.keys().cloned().collect();
    if want_os != got_os {
        return fail(format!("OS 집합 {got_os:?} ≠ {want_os:?}"));
    }
    std::fs::create_dir_all(out).map_err(|e| input(format!("{}: {e}", out.display())))?;
    let mut items = vec![];
    for (os, d) in &by_os {
        let v = manifest::read_json(&d.join("bundles.json"))?;
        let arts = v["artifacts"].as_array().cloned().unwrap_or_default();
        let want: Vec<&Expected> = exp.iter().filter(|e| &e.os == os).collect();
        let mut listed = BTreeSet::new();
        for e in &want {
            let file = e.file(version);
            let a = arts
                .iter()
                .find(|a| a["kind"].as_str() == Some(&e.kind))
                .ok_or_else(|| check(format!("{os}: {} 산출물이 없다", e.kind)))?;
            if a["file"].as_str() != Some(file.as_str()) {
                return fail(format!("{os} {}: 파일 이름 {} ≠ {file}", e.kind, a["file"]));
            }
            let data = read(&d.join(&file))?;
            let sha = sha256_hex(&data);
            if a["sha256"].as_str() != Some(sha.as_str())
                || a["bytes"].as_u64() != Some(data.len() as u64)
            {
                return fail(format!("{file}: 해시·크기가 bundles.json과 다르다"));
            }
            write(&out.join(&file), &data)?;
            listed.insert(file.clone());
            items.push(Item {
                os: os.clone(),
                kind: e.kind.clone(),
                file,
                bytes: data.len() as u64,
                sha256: sha,
                updater: e.updater.clone(),
            });
        }
        if arts.len() != want.len() {
            return fail(format!(
                "{os}: bundles.json 산출물 {}개 ≠ 표 {}개",
                arts.len(),
                want.len()
            ));
        }
        // 폴더에 표 밖의 파일(예: 임시 서명)이 섞이지 않았다
        for f in std::fs::read_dir(d)
            .map_err(|e| input(e.to_string()))?
            .filter_map(|e| e.ok())
        {
            let n = f.file_name().to_string_lossy().to_string();
            if n != "bundles.json" && !listed.contains(&n) {
                return fail(format!("{os}: 표 밖의 파일 {n}"));
            }
        }
    }
    items.sort_by(|a, b| a.file.cmp(&b.file));
    manifest::write_inventory(out, version, &items)?;
    for i in &items {
        println!(
            "collect: {:<8}{:<9}{}  {} bytes  sha256 {}",
            i.os, i.kind, i.file, i.bytes, i.sha256
        );
    }
    Ok(())
}

// ---- sign / verify-sig ----

fn updater_items(dir: &Path) -> Res<(String, Vec<Item>)> {
    let (v, items) = manifest::read_inventory(dir)?;
    Ok((
        v,
        items
            .into_iter()
            .filter(|i| !i.updater.is_empty())
            .collect(),
    ))
}

pub fn sign(dir: &Path) -> Res<()> {
    let key = env("TAURI_SIGNING_PRIVATE_KEY")
        .ok_or_else(|| input("TAURI_SIGNING_PRIVATE_KEY가 없다"))?;
    let pw = std::env::var("TAURI_SIGNING_PRIVATE_KEY_PASSWORD").unwrap_or_default();
    let sk = sig::load_secret_key(&key, &pw)?;
    let (_, items) = updater_items(dir)?;
    if items.is_empty() {
        return fail("서명할 updater 산출물이 없다");
    }
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    for i in &items {
        let data = read(&dir.join(&i.file))?;
        if sha256_hex(&data) != i.sha256 {
            return fail(format!("{}: 내용이 inventory.json과 다르다", i.file));
        }
        let s = sig::sign(&sk, &data, &i.file, ts)?;
        write(&dir.join(format!("{}.sig", i.file)), s.as_bytes())?;
        println!("sign: {}.sig", i.file);
    }
    Ok(())
}

pub fn verify_sig(dir: &Path, sig_dir: &Path, pubkey: &Path) -> Res<()> {
    let pk = read_pubkey(pubkey)?;
    let (_, all) = manifest::read_inventory(dir)?;
    let mut checked = 0;
    for i in &all {
        let sp = sig_dir.join(format!("{}.sig", i.file));
        if i.updater.is_empty() {
            if sp.exists() {
                return fail(format!("{}: updater 산출물이 아닌데 서명이 있다", i.file));
            }
            continue;
        }
        let data = read(&dir.join(&i.file))?;
        let s = text("서명", read(&sp)?)?;
        sig::verify(&pk, &data, &s).map_err(|f| check(format!("{}: {}", i.file, f.msg)))?;
        sig::tamper_check(&pk, &data, &s).map_err(|f| check(format!("{}: {}", i.file, f.msg)))?;
        println!(
            "verify-sig: {} 통과(1바이트 변조·comment 변조 사본은 거부)",
            i.file
        );
        checked += 1;
    }
    if checked == 0 {
        return fail("검증한 서명이 없다");
    }
    Ok(())
}

// ---- sums / manifest ----

pub fn sums(dir: &Path) -> Res<()> {
    let (_, items) = manifest::read_inventory(dir)?;
    let mut m = BTreeMap::new();
    for i in &items {
        let mut files = vec![i.file.clone()];
        if !i.updater.is_empty() {
            files.push(format!("{}.sig", i.file));
        }
        for f in files {
            m.insert(f.clone(), sha256_hex(&read(&dir.join(&f))?));
        }
    }
    let t = manifest::sums_text(&m);
    write(&dir.join("SHA256SUMS"), t.as_bytes())?;
    print!("{t}");
    Ok(())
}

pub fn make_manifest(dir: &Path, version: &str, pub_date: &str, base_url: &str) -> Res<()> {
    let (inv_v, items) = manifest::read_inventory(dir)?;
    if inv_v != version {
        return fail(format!("inventory.json version {inv_v} ≠ {version}"));
    }
    let mut sigs = BTreeMap::new();
    for i in items.iter().filter(|i| !i.updater.is_empty()) {
        sigs.insert(
            i.file.clone(),
            text("서명", read(&dir.join(format!("{}.sig", i.file)))?)?,
        );
    }
    let m = manifest::build(&items, version, pub_date, base_url, &sigs)?;
    manifest::check_manifest(&m, &manifest::expected()?, version, Some(base_url))?;
    write(&dir.join("manifest.json"), &manifest::to_bytes(&m))?;
    println!(
        "manifest: {} 플랫폼, 스키마 통과",
        m["platforms"].as_object().map(|o| o.len()).unwrap_or(0)
    );
    Ok(())
}

// ---- put / promote ----

fn upload_list(dir: &Path) -> Res<Vec<String>> {
    let sums = manifest::parse_sums(&text("SHA256SUMS", read(&dir.join("SHA256SUMS"))?)?)?;
    let mut files: Vec<String> = sums.keys().cloned().collect();
    files.push("SHA256SUMS".into());
    files.push("manifest.json".into());
    Ok(files)
}

/// 덮어쓰지 않는다. 이미 있으면 같은 sha256일 때만 성공(재실행 안전), 다르면 실패.
fn put_immutable(s3: &S3, k: &str, data: &[u8]) -> Res<&'static str> {
    match s3.put_new(k, data)? {
        Put::Created => Ok("올림"),
        Put::Precondition => {
            let (cur, _) = s3
                .get(k)?
                .ok_or_else(|| check(format!("{k}: 412인데 객체가 없다")))?;
            if sha256_hex(&cur) == sha256_hex(data) {
                Ok("이미 같은 내용")
            } else {
                fail(format!("{k}: 다른 내용이 이미 있다(덮어쓰지 않는다)"))
            }
        }
    }
}

pub fn put(s3: &S3, dir: &Path, version: &str) -> Res<()> {
    let files = upload_list(dir)?;
    let want = manifest::expected_files(&manifest::expected()?, version);
    let got: BTreeSet<String> = files
        .iter()
        .filter(|f| *f != "SHA256SUMS" && *f != "manifest.json")
        .cloned()
        .collect();
    if got != want {
        return fail(format!("SHA256SUMS 항목이 표와 다르다: {got:?} ≠ {want:?}"));
    }
    // 매니페스트는 맨 끝에(산출물이 다 올라간 뒤에만 버전 폴더가 완결된다)
    for f in &files {
        let what = put_immutable(s3, &key(version, f), &read(&dir.join(f))?)?;
        println!("put: releases/{version}/{f} {what}");
    }
    Ok(())
}

/// releases/latest.json을 이번 manifest.json으로 바꾼다(CAS). → 승격 전 버전(none 포함)
pub fn promote(s3: &S3, dir: &Path, version: &str) -> Res<String> {
    let new = read(&dir.join("manifest.json"))?;
    let remote = s3
        .get(&key(version, "manifest.json"))?
        .ok_or_else(|| check(format!("releases/{version}/manifest.json이 없다(put 먼저)")))?;
    if remote.0 != new {
        return fail("올린 manifest.json과 로컬 manifest.json이 다르다");
    }
    let cur = s3.get(LATEST)?;
    let prev = match &cur {
        None => "none".to_string(),
        Some((b, _)) => {
            let v: Value = serde_json::from_slice(b)
                .map_err(|e| check(format!("지금 latest.json이 JSON이 아니다: {e}")))?;
            let c = v["version"]
                .as_str()
                .ok_or_else(|| check("지금 latest.json에 version이 없다"))?
                .to_string();
            if c == version {
                if *b != new {
                    return fail(format!("latest.json이 이미 {version}인데 내용이 다르다"));
                }
                let p = s3
                    .get(&key(version, "previous"))?
                    .ok_or_else(|| check("이미 승격됐는데 previous가 없다"))?;
                let p = text("previous", p.0)?;
                println!("promote: 이미 {version}(prev {p})");
                gh_output("prev", &p)?;
                return Ok(p);
            }
            let (cv, nv) = (
                semver::parse(&c)
                    .ok_or_else(|| check(format!("지금 latest 버전 {c}가 semver가 아니다")))?,
                semver::parse(version).unwrap(),
            );
            if semver::cmp(&nv, &cv) != std::cmp::Ordering::Greater {
                return fail(format!("단조 증가가 아니다: {version} ≤ 지금 latest {c}"));
            }
            c
        }
    };
    put_immutable(s3, &key(version, "previous"), prev.as_bytes())
        .map_err(|f| check(format!("previous 기록: {}", f.msg)))?;
    let r = match &cur {
        None => s3.put_new(LATEST, &new)?,
        Some((_, etag)) => s3.put_if_match(LATEST, &new, etag)?,
    };
    if let Put::Precondition = r {
        return fail("latest.json이 읽은 뒤에 바뀌었다(CAS 실패) — 다시 실행한다");
    }
    println!("promote: latest.json = {version} (prev {prev})");
    gh_output("prev", &prev)?;
    Ok(prev)
}

// ---- verify / rollback ----

/// 다시 받는 곳: S3(기본) 또는 Phase 3 Worker(VERIFY_VIA=worker, DIST_BASE_URL + CI_VERIFY_TOKEN)
pub enum Source<'a> {
    S3(&'a S3),
    Owned(S3),
    Worker {
        base: String,
        token: String,
        http: reqwest::blocking::Client,
    },
}

impl Source<'_> {
    pub fn from_env(base_url: Option<&str>) -> Res<Source<'static>> {
        if env("VERIFY_VIA").as_deref() == Some("worker") {
            let base = base_url
                .map(str::to_string)
                .ok_or_else(|| input("VERIFY_VIA=worker는 --base-url이 필요하다"))?;
            let token = env("CI_VERIFY_TOKEN")
                .ok_or_else(|| input("VERIFY_VIA=worker는 CI_VERIFY_TOKEN이 필요하다"))?;
            let http = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(600))
                .build()
                .map_err(|e| input(e.to_string()))?;
            return Ok(Source::Worker {
                base: base.trim_end_matches('/').to_string(),
                token,
                http,
            });
        }
        Ok(Source::Owned(S3::from_env()?))
    }

    fn get(&self, k: &str) -> Res<Option<Vec<u8>>> {
        match self {
            Source::S3(s) => Ok(s.get(k)?.map(|x| x.0)),
            Source::Owned(s) => Ok(s.get(k)?.map(|x| x.0)),
            Source::Worker { base, token, http } => {
                let r = http
                    .get(format!("{base}/{k}"))
                    .bearer_auth(token)
                    .send()
                    .map_err(|e| check(format!("GET {k}: {e}")))?;
                match r.status().as_u16() {
                    200 => Ok(Some(r.bytes().map_err(|e| check(e.to_string()))?.to_vec())),
                    404 => Ok(None),
                    s => fail(format!("GET {k}: HTTP {s}")),
                }
            }
        }
    }

    fn need(&self, k: &str) -> Res<Vec<u8>> {
        self.get(k)?.ok_or_else(|| check(format!("{k}가 없다")))
    }
}

/// 버전 폴더를 다시 받아 확인한다. latest면 releases/latest.json이 그 버전의 manifest.json과 바이트 동일한지도.
pub fn verify(
    src: &Source,
    version: &str,
    pubkey: &str,
    base_url: Option<&str>,
    latest: bool,
) -> Res<()> {
    let exp = manifest::expected()?;
    let sums = manifest::parse_sums(&text("SHA256SUMS", src.need(&key(version, "SHA256SUMS"))?)?)?;
    let names: BTreeSet<String> = sums.keys().cloned().collect();
    let want = manifest::expected_files(&exp, version);
    if names != want {
        return fail(format!(
            "SHA256SUMS 항목이 표와 다르다: {names:?} ≠ {want:?}"
        ));
    }
    let mbytes = src.need(&key(version, "manifest.json"))?;
    let m: Value =
        serde_json::from_slice(&mbytes).map_err(|e| check(format!("manifest.json: {e}")))?;
    manifest::check_manifest(&m, &exp, version, base_url)?;
    for e in &exp {
        let file = e.file(version);
        let data = src.need(&key(version, &file))?;
        if sha256_hex(&data) != sums[&file] {
            return fail(format!("{file}: sha256이 SHA256SUMS와 다르다"));
        }
        if !e.updater.is_empty() {
            let sb = src.need(&key(version, &format!("{file}.sig")))?;
            if sha256_hex(&sb) != sums[&format!("{file}.sig")] {
                return fail(format!("{file}.sig: sha256이 SHA256SUMS와 다르다"));
            }
            let s = text("서명", sb)?;
            for k in &e.updater {
                if m["platforms"][k]["signature"].as_str() != Some(s.as_str()) {
                    return fail(format!("매니페스트 {k}의 signature가 {file}.sig와 다르다"));
                }
            }
            sig::verify(pubkey, &data, &s).map_err(|f| check(format!("{file}: {}", f.msg)))?;
        }
        println!(
            "verify: releases/{version}/{file} 해시{} 통과",
            if e.updater.is_empty() { "" } else { "·서명" }
        );
    }
    if latest {
        let lb = src.need(LATEST)?;
        if lb != mbytes {
            let lv: Option<String> = serde_json::from_slice::<Value>(&lb)
                .ok()
                .and_then(|v| v["version"].as_str().map(str::to_string));
            return fail(format!(
                "latest.json(version {}) ≠ releases/{version}/manifest.json",
                lv.unwrap_or_else(|| "?".into())
            ));
        }
        println!("verify: latest.json = releases/{version}/manifest.json");
    }
    Ok(())
}

/// latest.json을 to 버전으로 되돌린다(to의 객체를 먼저 확인, CAS 교체, 다시 확인). to = none이면 latest.json을 지운다(첫 릴리스).
/// from을 주면 지금 latest가 from 또는 to일 때만 바꾼다(다른 누군가가 바꾼 상태를 덮지 않는다).
pub fn rollback(
    s3: &S3,
    src: &Source,
    to: &str,
    from: Option<&str>,
    pubkey: &str,
    base_url: Option<&str>,
) -> Res<()> {
    let cur = s3.get(LATEST)?;
    let cur_v = cur.as_ref().map(|(b, _)| {
        serde_json::from_slice::<Value>(b)
            .ok()
            .and_then(|v| v["version"].as_str().map(str::to_string))
            .unwrap_or_else(|| "?".into())
    });
    if let (Some(f), Some(c)) = (from, cur_v.as_deref())
        && c != f
        && c != to
    {
        return fail(format!(
            "지금 latest가 {c}다(--from {f}도 --to {to}도 아니다) — 바꾸지 않는다"
        ));
    }
    if to == "none" {
        if cur.is_some() {
            s3.delete(LATEST)?;
        }
        if s3.get(LATEST)?.is_some() {
            return fail("latest.json을 지웠는데 아직 있다");
        }
        println!("rollback: latest.json 없음(첫 릴리스 전 상태)");
        return Ok(());
    }
    verify(src, to, pubkey, base_url, false)
        .map_err(|f| check(format!("되돌릴 버전 {to}의 객체 확인 실패: {}", f.msg)))?;
    let target = s3
        .get(&key(to, "manifest.json"))?
        .ok_or_else(|| check(format!("releases/{to}/manifest.json이 없다")))?
        .0;
    match &cur {
        Some((b, _)) if *b == target => println!("rollback: 이미 {to}"),
        Some((_, etag)) => {
            if let Put::Precondition = s3.put_if_match(LATEST, &target, etag)? {
                return fail("latest.json이 읽은 뒤에 바뀌었다(CAS 실패)");
            }
        }
        None => {
            if let Put::Precondition = s3.put_new(LATEST, &target)? {
                return fail("latest.json이 읽은 뒤에 생겼다(CAS 실패)");
            }
        }
    }
    verify(src, to, pubkey, base_url, true)?;
    println!("rollback: latest.json = {to}");
    Ok(())
}
