//! 릴리스 산출물 표(release/expected-artifacts.json), 모은 목록(inventory.json), SHA256SUMS, updater 매니페스트.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::cli::{Res, check, input};
use crate::schema;

pub const PREFIX: &str = "chzzk-downloader";
pub const OSES: &[&str] = &["linux", "darwin", "windows"];

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask는 저장소 루트 아래에 있다")
        .to_path_buf()
}

pub fn read_json(p: &Path) -> Res<Value> {
    let t = std::fs::read(p).map_err(|e| input(format!("{} 읽기: {e}", p.display())))?;
    serde_json::from_slice(&t).map_err(|e| input(format!("{} JSON: {e}", p.display())))
}

/// 표의 산출물 하나(릴리스 모드: release 전용 항목 포함)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Expected {
    pub os: String,
    pub kind: String,
    pub name: String,
    pub updater: Vec<String>,
}

impl Expected {
    pub fn file(&self, version: &str) -> String {
        format!("{PREFIX}_{version}_{}", self.name)
    }
}

pub fn expected_from(spec: &Value) -> Res<Vec<Expected>> {
    let mut out = vec![];
    for os in OSES {
        let arts = spec
            .get(os)
            .and_then(|o| o.get("artifacts"))
            .and_then(Value::as_array)
            .ok_or_else(|| input(format!("expected-artifacts.json: {os}.artifacts가 없다")))?;
        for a in arts {
            let s = |k: &str| {
                a.get(k)
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .ok_or_else(|| input(format!("expected-artifacts.json {os}: {k}")))
            };
            let updater = match a.get("updater") {
                None => vec![],
                Some(v) => v
                    .as_array()
                    .ok_or_else(|| input("updater는 배열"))?
                    .iter()
                    .map(|x| {
                        x.as_str()
                            .map(str::to_string)
                            .ok_or_else(|| input("updater 항목은 문자열"))
                    })
                    .collect::<Res<Vec<_>>>()?,
            };
            out.push(Expected {
                os: os.to_string(),
                kind: s("kind")?,
                name: s("name")?,
                updater,
            });
        }
    }
    let keys: Vec<&String> = out.iter().flat_map(|e| &e.updater).collect();
    if keys.iter().collect::<BTreeSet<_>>().len() != keys.len() {
        return Err(input("expected-artifacts.json: updater 플랫폼 키가 겹친다"));
    }
    Ok(out)
}

pub fn expected() -> Res<Vec<Expected>> {
    expected_from(&read_json(&root().join("release/expected-artifacts.json"))?)
}

/// 버전 v의 releases/<v>/에 있어야 하는 SHA256SUMS 항목(산출물 + updater 산출물의 .sig)
pub fn expected_files(exp: &[Expected], version: &str) -> BTreeSet<String> {
    let mut s = BTreeSet::new();
    for e in exp {
        s.insert(e.file(version));
        if !e.updater.is_empty() {
            s.insert(format!("{}.sig", e.file(version)));
        }
    }
    s
}

#[derive(Debug, Clone)]
pub struct Item {
    pub os: String,
    pub kind: String,
    pub file: String,
    pub bytes: u64,
    pub sha256: String,
    pub updater: Vec<String>,
}

pub fn write_inventory(dir: &Path, version: &str, items: &[Item]) -> Res<()> {
    let v = json!({
        "version": version,
        "items": items.iter().map(|i| json!({
            "os": i.os, "kind": i.kind, "file": i.file, "bytes": i.bytes, "sha256": i.sha256, "updater": i.updater,
        })).collect::<Vec<_>>(),
    });
    std::fs::write(
        dir.join("inventory.json"),
        serde_json::to_string_pretty(&v).unwrap() + "\n",
    )
    .map_err(|e| input(format!("inventory.json 쓰기: {e}")))
}

pub fn read_inventory(dir: &Path) -> Res<(String, Vec<Item>)> {
    let v = read_json(&dir.join("inventory.json"))?;
    let version = v["version"]
        .as_str()
        .ok_or_else(|| input("inventory.json version"))?
        .to_string();
    let mut items = vec![];
    for i in v["items"]
        .as_array()
        .ok_or_else(|| input("inventory.json items"))?
    {
        let s = |k: &str| {
            i[k].as_str()
                .map(str::to_string)
                .ok_or_else(|| input(format!("inventory.json {k}")))
        };
        items.push(Item {
            os: s("os")?,
            kind: s("kind")?,
            file: s("file")?,
            bytes: i["bytes"]
                .as_u64()
                .ok_or_else(|| input("inventory.json bytes"))?,
            sha256: s("sha256")?,
            updater: i["updater"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(str::to_string))
                        .collect()
                })
                .unwrap_or_default(),
        });
    }
    Ok((version, items))
}

/// SHA256SUMS 본문: `<sha256>  <파일>` 파일 이름 바이트 순서
pub fn sums_text(entries: &BTreeMap<String, String>) -> String {
    entries.iter().map(|(f, h)| format!("{h}  {f}\n")).collect()
}

pub fn parse_sums(text: &str) -> Res<BTreeMap<String, String>> {
    let mut m = BTreeMap::new();
    for (n, line) in text.lines().enumerate() {
        let (h, f) = line
            .split_once("  ")
            .ok_or_else(|| check(format!("SHA256SUMS {}번째 줄 형식", n + 1)))?;
        if h.len() != 64
            || !h
                .bytes()
                .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
            || f.is_empty()
            || f.contains('/')
        {
            return Err(check(format!("SHA256SUMS {}번째 줄 형식", n + 1)));
        }
        if m.insert(f.to_string(), h.to_string()).is_some() {
            return Err(check(format!("SHA256SUMS: {f}가 두 번 있다")));
        }
    }
    if !text.is_empty() && !text.ends_with('\n') {
        return Err(check("SHA256SUMS: 끝 줄바꿈이 없다"));
    }
    Ok(m)
}

pub fn release_url(base: &str, version: &str, file: &str) -> String {
    format!("{}/releases/{version}/{file}", base.trim_end_matches('/'))
}

/// Tauri 정적 매니페스트. sigs: 파일 이름 → .sig 내용
pub fn build(
    items: &[Item],
    version: &str,
    pub_date: &str,
    base_url: &str,
    sigs: &BTreeMap<String, String>,
) -> Res<Value> {
    let mut platforms = serde_json::Map::new();
    for i in items {
        for key in &i.updater {
            let sig = sigs
                .get(&i.file)
                .ok_or_else(|| check(format!("{}의 서명이 없다", i.file)))?;
            let entry = json!({ "signature": sig, "url": release_url(base_url, version, &i.file) });
            if platforms.insert(key.clone(), entry).is_some() {
                return Err(check(format!("플랫폼 키 {key}가 겹친다")));
            }
        }
    }
    Ok(json!({ "version": version, "pub_date": pub_date, "platforms": platforms }))
}

pub fn to_bytes(v: &Value) -> Vec<u8> {
    (serde_json::to_string_pretty(v).unwrap() + "\n").into_bytes()
}

/// release/latest.schema.json 검증 + 스키마 밖의 결정적 규칙(플랫폼 키 = 표의 updater 키 전부, url 접두)
pub fn check_manifest(
    v: &Value,
    exp: &[Expected],
    version: &str,
    base_url: Option<&str>,
) -> Res<()> {
    let schema = read_json(&root().join("release/latest.schema.json"))?;
    let problems =
        schema::validate(&schema, v).map_err(|e| input(format!("latest.schema.json: {e}")))?;
    if let Some(p) = problems.first() {
        return Err(check(format!(
            "매니페스트가 스키마와 다르다: {p}{}",
            if problems.len() > 1 {
                format!(" 외 {}건", problems.len() - 1)
            } else {
                String::new()
            }
        )));
    }
    if v["version"] != json!(version) {
        return Err(check(format!(
            "매니페스트 version {} ≠ {version}",
            v["version"]
        )));
    }
    let want: BTreeSet<String> = exp.iter().flat_map(|e| e.updater.clone()).collect();
    let got: BTreeSet<String> = v["platforms"]
        .as_object()
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    if want != got {
        return Err(check(format!("플랫폼 키 {got:?} ≠ 표 {want:?}")));
    }
    for e in exp {
        for key in &e.updater {
            let url = v["platforms"][key]["url"].as_str().unwrap_or_default();
            let tail = format!("/releases/{version}/{}", e.file(version));
            let ok = match base_url {
                Some(b) => url == release_url(b, version, &e.file(version)),
                None => url.ends_with(&tail),
            };
            if !ok {
                return Err(check(format!("{key}의 url이 {tail}를 가리키지 않는다")));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn exp() -> Vec<Expected> {
        expected().unwrap()
    }

    fn items(version: &str) -> Vec<Item> {
        exp()
            .into_iter()
            .map(|e| Item {
                file: e.file(version),
                os: e.os,
                kind: e.kind,
                bytes: 1,
                sha256: "0".repeat(64),
                updater: e.updater,
            })
            .collect()
    }

    fn sigs(items: &[Item]) -> BTreeMap<String, String> {
        items
            .iter()
            .filter(|i| !i.updater.is_empty())
            .map(|i| (i.file.clone(), "QUJD".repeat(40)))
            .collect()
    }

    /// 표와 스키마가 서로 맞는다: 표로 만든 매니페스트가 스키마를 통과하고, 스키마의 필수 플랫폼 키 = 표의 updater 키
    #[test]
    fn table_and_schema_agree() {
        let it = items("1.2.3");
        let m = build(
            &it,
            "1.2.3",
            "2026-10-06T00:00:00Z",
            "https://dist.example.invalid",
            &sigs(&it),
        )
        .unwrap();
        check_manifest(&m, &exp(), "1.2.3", Some("https://dist.example.invalid")).unwrap();
        let schema = read_json(&root().join("release/latest.schema.json")).unwrap();
        let req: BTreeSet<String> = schema["properties"]["platforms"]["required"]
            .as_array()
            .unwrap()
            .iter()
            .map(|x| x.as_str().unwrap().to_string())
            .collect();
        let want: BTreeSet<String> = exp().iter().flat_map(|e| e.updater.clone()).collect();
        assert_eq!(req, want);
        // 매니페스트 바이트는 결정적(키 정렬)
        assert_eq!(
            to_bytes(&m),
            to_bytes(
                &build(
                    &it,
                    "1.2.3",
                    "2026-10-06T00:00:00Z",
                    "https://dist.example.invalid",
                    &sigs(&it)
                )
                .unwrap()
            )
        );
    }

    #[test]
    fn manifest_negative_cases() {
        let it = items("1.2.3");
        let good = build(
            &it,
            "1.2.3",
            "2026-10-06T00:00:00+09:00",
            "https://d.example.invalid/",
            &sigs(&it),
        )
        .unwrap();
        check_manifest(&good, &exp(), "1.2.3", Some("https://d.example.invalid")).unwrap();
        // 다른 버전
        assert_eq!(
            check_manifest(&good, &exp(), "1.2.4", None)
                .unwrap_err()
                .code,
            1
        );
        // 플랫폼 하나 빠짐
        let mut m = good.clone();
        m["platforms"]
            .as_object_mut()
            .unwrap()
            .remove("darwin-aarch64");
        assert!(check_manifest(&m, &exp(), "1.2.3", None).is_err());
        // 모르는 최상위 키, 날짜 형식, 빈 서명, url이 다른 버전 폴더
        for (path, val) in [
            ("/extra", json!(1)),
            ("/pub_date", json!("yesterday")),
            ("/platforms/linux-x86_64/signature", json!("")),
            (
                "/platforms/linux-x86_64/url",
                json!(
                    "https://d.example.invalid/releases/1.2.2/chzzk-downloader_1.2.3_linux-x86_64.AppImage"
                ),
            ),
            (
                "/platforms/linux-x86_64/url",
                json!(
                    "http://d.example.invalid/releases/1.2.3/chzzk-downloader_1.2.3_linux-x86_64.AppImage"
                ),
            ),
        ] {
            let mut m = good.clone();
            let (parent, key) = path.rsplit_once('/').unwrap();
            m.pointer_mut(if parent.is_empty() { "" } else { parent })
                .unwrap()
                .as_object_mut()
                .unwrap()
                .insert(key.to_string(), val);
            assert!(
                check_manifest(&m, &exp(), "1.2.3", Some("https://d.example.invalid")).is_err(),
                "{path}"
            );
        }
        // 서명이 없는 산출물
        let mut s = sigs(&it);
        s.pop_first();
        assert!(
            build(
                &it,
                "1.2.3",
                "2026-10-06T00:00:00Z",
                "https://d.example.invalid",
                &s
            )
            .is_err()
        );
    }

    #[test]
    fn sums_roundtrip_and_shape() {
        let mut m = BTreeMap::new();
        m.insert("b.bin".to_string(), "a".repeat(64));
        m.insert("a.bin".to_string(), "b".repeat(64));
        let t = sums_text(&m);
        assert!(t.starts_with(&format!("{}  a.bin\n", "b".repeat(64))));
        assert_eq!(parse_sums(&t).unwrap(), m);
        for bad in [
            "x  a\n",
            &format!("{}  a", "a".repeat(64)),
            &format!("{} a\n", "a".repeat(64)),
            &format!("{}  a/b\n", "a".repeat(64)),
            &format!("{}  a\n", "A".repeat(64)),
        ] {
            assert!(parse_sums(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn expected_set_has_sigs_for_updater_artifacts() {
        let files = expected_files(&exp(), "0.2.0");
        assert!(files.contains("chzzk-downloader_0.2.0_linux-x86_64.AppImage.sig"));
        assert!(files.contains("chzzk-downloader_0.2.0_linux-x86_64.deb"));
        assert!(!files.contains("chzzk-downloader_0.2.0_linux-x86_64.deb.sig"));
        assert!(files.contains("chzzk-downloader_0.2.0_darwin-aarch64.app.tar.gz.sig"));
    }
}
