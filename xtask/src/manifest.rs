//! 릴리스 산출물 표(release/expected-artifacts.json), 모은 목록(inventory.json), SHA256SUMS, updater 매니페스트.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use serde_json::{Value, json};

use crate::cli::{Res, check, input};
use crate::schema;

pub const PREFIX: &str = "chzzk-downloader";
pub const OSES: &[&str] = &["linux", "darwin", "windows"];

/// 저장소 루트. 미리 빌드한 xtask를 다른 작업에서 부를 때는 release.mjs가 XTASK_ROOT를 준다(컴파일한 경로에 기대지 않게)
pub fn root() -> PathBuf {
    if let Some(r) = crate::cli::env("XTASK_ROOT") {
        return PathBuf::from(r);
    }
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
    notes: Option<&str>,
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
    let mut m = json!({ "version": version, "pub_date": pub_date, "platforms": platforms });
    if let Some(n) = notes {
        m["notes"] = json!(n);
    }
    Ok(m)
}

/// 업데이트 노트 항목 수 상한(foundations §14 `UPDATE_NOTES_MAX_LINES`와 같은 값, 셸 consts.rs·앱 timing.ts)
pub const NOTES_MAX_ITEMS: usize = 5;
/// 항목 하나의 글자(Unicode scalar) 상한(`UPDATE_NOTES_LINE_MAX_GRAPHEMES`와 같은 값)
pub const NOTES_ITEM_MAX_CHARS: usize = 80;

/// 노트 한 줄 본문에서 거부할 것의 사유. 화면에 그대로 그려도 되는 일반 텍스트만 남기려는 작성 쪽 검사다
fn notes_item_problem(body: &str) -> Option<&'static str> {
    let n = body.chars().count();
    if n == 0 {
        return Some("본문이 비었다");
    }
    if n > NOTES_ITEM_MAX_CHARS {
        return Some("한 줄이 80자를 넘는다");
    }
    for c in body.chars() {
        let bad = c.is_control()
            || matches!(c,
                '\u{061C}' | '\u{200B}' | '\u{200E}' | '\u{200F}' | '\u{202A}'..='\u{202E}'
                | '\u{2028}' | '\u{2029}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}'
                | '\u{FEFF}' | '\u{00AD}');
        if bad {
            return Some("제어·보이지 않는 문자가 있다");
        }
    }
    if body.contains(['<', '>', '`']) || body.contains("](") {
        return Some("HTML·마크다운 표시(< > ` ]()는 쓸 수 없다");
    }
    if body.contains("http://") || body.contains("https://") {
        return Some("주소는 쓸 수 없다");
    }
    // content.md의 v0.1.2 금지: 영숫자가 아닌 글자(또는 줄 처음) 뒤의 v+숫자
    let cs: Vec<char> = body.chars().collect();
    for i in 0..cs.len().saturating_sub(1) {
        if cs[i] == 'v'
            && cs[i + 1].is_ascii_digit()
            && (i == 0 || !cs[i - 1].is_ascii_alphanumeric())
        {
            return Some("버전 표기(v숫자)는 쓸 수 없다");
        }
    }
    None
}

/// release/notes/<버전>.md → latest.json `notes`(항목 본문을 \n으로 이은 일반 텍스트).
/// 형식: 비어 있지 않은 줄은 모두 0열의 `- `로 시작(빈 줄은 무시), 항목 1~5개, 본문 1~80자.
pub fn parse_notes(raw: &str) -> Res<String> {
    let text = raw.strip_prefix('\u{FEFF}').unwrap_or(raw);
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    let mut items: Vec<String> = Vec::new();
    for (i, line) in text.split('\n').enumerate() {
        let line = line.trim_end_matches(' ');
        if line.is_empty() {
            continue;
        }
        let at = |why: &str| check(format!("release/notes: {}번째 줄: {why}", i + 1));
        let Some(rest) = line.strip_prefix("- ") else {
            return Err(at("0열의 `- `로 시작하는 목록 줄만 쓸 수 있다"));
        };
        let body = rest.trim_matches(' ');
        if let Some(why) = notes_item_problem(body) {
            return Err(at(why));
        }
        items.push(body.to_string());
    }
    if items.is_empty() || items.len() > NOTES_MAX_ITEMS {
        return Err(check(format!(
            "release/notes: 항목은 1~{NOTES_MAX_ITEMS}개여야 한다(지금 {}개)",
            items.len()
        )));
    }
    Ok(items.join("\n"))
}

/// 이미 이어진 notes 검사(업로드 뒤 verify·rollback에도 걸린다). 사유 목록, 비면 통과.
/// 과거 매니페스트의 rollback을 깨지 않도록 이 규칙은 느슨하게만 바꾼다.
pub fn check_notes(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lines: Vec<&str> = s.split('\n').collect();
    if lines.len() > NOTES_MAX_ITEMS {
        out.push(format!("notes: 줄이 {NOTES_MAX_ITEMS}개를 넘는다"));
    }
    for (i, l) in lines.iter().enumerate() {
        if let Some(why) = notes_item_problem(l) {
            out.push(format!("notes: {}번째 줄: {why}", i + 1));
        }
    }
    out
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
    if let Some(n) = v.get("notes").and_then(Value::as_str)
        && let Some(p) = check_notes(n).first()
    {
        return Err(check(format!("매니페스트 {p}")));
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
    fn vectors() -> Value {
        read_json(&root().join("xtask/testdata/notes-vectors.json")).unwrap()
    }

    /// 공유 벡터(scripts/ci/release.test.mjs와 같은 파일): 받아들이는 입력은 정규화 결과가 같고, 거부하는 입력은 줄 번호를 말한다
    #[test]
    fn parse_notes_shared_vectors() {
        let v = vectors();
        for c in v["accept"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let got = parse_notes(c["input"].as_str().unwrap())
                .unwrap_or_else(|e| panic!("{name}: {}", e.msg));
            assert_eq!(got, c["output"].as_str().unwrap(), "{name}");
            assert!(
                check_notes(&got).is_empty(),
                "{name}: 정규화 결과는 check_notes를 통과한다"
            );
        }
        for c in v["reject"].as_array().unwrap() {
            let name = c["name"].as_str().unwrap();
            let e = parse_notes(c["input"].as_str().unwrap())
                .expect_err(&format!("{name}: 거부해야 한다"));
            assert_eq!(e.code, 1, "{name}");
            assert!(e.msg.starts_with("release/notes: "), "{name}: {}", e.msg);
            if let Some(n) = c["line"].as_u64() {
                assert!(e.msg.contains(&format!("{n}번째 줄")), "{name}: {}", e.msg);
            }
        }
    }

    #[test]
    fn check_notes_rules() {
        assert!(check_notes("a\nb").is_empty());
        assert!(!check_notes("").is_empty());
        assert!(!check_notes("a\n\nb").is_empty(), "빈 줄");
        assert!(!check_notes("a\nb\nc\nd\ne\nf").is_empty(), "여섯 줄");
        assert!(!check_notes(&"가".repeat(81)).is_empty(), "81자");
        assert!(check_notes(&"가".repeat(80)).is_empty());
        assert!(!check_notes("<b>").is_empty());
        assert!(!check_notes("a\u{202e}b").is_empty());
        assert!(!check_notes("a\tb").is_empty());
    }

    fn base_manifest(notes: Option<&str>) -> Value {
        let it = items("1.2.3");
        build(
            &it,
            "1.2.3",
            "2026-10-06T00:00:00Z",
            "https://d.example.invalid",
            &sigs(&it),
            notes,
        )
        .unwrap()
    }

    #[test]
    fn build_with_and_without_notes() {
        let with = base_manifest(Some("첫째\n둘째"));
        check_manifest(&with, &exp(), "1.2.3", Some("https://d.example.invalid")).unwrap();
        assert_eq!(with["notes"], json!("첫째\n둘째"));
        let without = base_manifest(None);
        check_manifest(&without, &exp(), "1.2.3", Some("https://d.example.invalid")).unwrap();
        assert!(without.get("notes").is_none(), "과거 호환: 키 자체가 없다");
        // 결정적 바이트, notes는 정렬된 키 순서(BTreeMap)로 platforms 앞
        let a = String::from_utf8(to_bytes(&with)).unwrap();
        assert_eq!(
            a.as_bytes(),
            to_bytes(&base_manifest(Some("첫째\n둘째"))).as_slice()
        );
        assert!(a.find("\"notes\"").unwrap() < a.find("\"platforms\"").unwrap());
    }

    #[test]
    fn check_manifest_notes_negative() {
        let chk = |n: Value| {
            let mut m = base_manifest(None);
            m.as_object_mut().unwrap().insert("notes".into(), n);
            check_manifest(&m, &exp(), "1.2.3", Some("https://d.example.invalid"))
        };
        chk(json!("정상\n두 줄")).unwrap();
        assert!(chk(json!("")).is_err(), "minLength");
        assert!(chk(json!("가".repeat(513))).is_err(), "maxLength");
        assert!(chk(json!("a\nb\nc\nd\ne\nf")).is_err(), "여섯 줄");
        assert!(chk(json!("a\n\nb")).is_err(), "빈 줄");
        assert!(chk(json!(5)).is_err(), "문자열이 아님");
    }

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
            None,
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
                    &sigs(&it),
                    None
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
            None,
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
                &s,
                None
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
        assert!(files.contains("chzzk-downloader_0.2.0_linux-x86_64.deb.sig"));
        assert!(files.contains("chzzk-downloader_0.2.0_darwin-aarch64.dmg"));
        assert!(!files.contains("chzzk-downloader_0.2.0_darwin-aarch64.dmg.sig"));
        assert!(files.contains("chzzk-downloader_0.2.0_darwin-aarch64.app.tar.gz.sig"));
    }
}
