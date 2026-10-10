//! `chzzk_shell::format`을 `design/format/*.json` 골든으로 검사한다.
//! TS(`app/src/lib/format/format.test.ts`)가 같은 파일을 읽는다. 기대값은 손으로 계산해 JSON에 있고
//! 두 구현이 독립적으로 맞춘다. 알 수 없는 `fn`은 panic이다(JSON에 케이스만 늘고 함수가 빠지는 일을 막는다).

use std::fs;
use std::path::PathBuf;

use chzzk_shell::format::*;
use serde_json::{Value, json};

fn golden_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../design/format")
}

fn base(v: &Value) -> SizeBase {
    SizeBase::from_number(v.as_u64().expect("진법은 숫자")).expect("진법은 1000 또는 1024")
}

fn wall(v: &Value) -> Wall {
    let n = |k: &str| v[k].as_i64().unwrap_or_else(|| panic!("Wall.{k}"));
    Wall {
        y: n("y"),
        mo: n("mo"),
        d: n("d"),
        h: n("h"),
        mi: n("mi"),
    }
}

fn wall_json(w: Wall) -> Value {
    json!({"y": w.y, "mo": w.mo, "d": w.d, "h": w.h, "mi": w.mi})
}

fn u(v: &Value) -> u64 {
    v.as_u64()
        .unwrap_or_else(|| panic!("음이 아닌 정수여야 한다: {v}"))
}

fn secs(v: &Value) -> Option<u64> {
    if v.is_null() { None } else { Some(u(v)) }
}

fn s(x: String) -> Value {
    Value::String(x)
}

/// 함수 이름 → 호출. 알 수 없으면 panic.
fn call(name: &str, a: &[Value]) -> Value {
    match name {
        "formatFileSize" => s(format_file_size(u(&a[0]), base(&a[1]))),
        "formatProgressSize" => {
            let (r, t) = format_progress_size(
                u(&a[0]),
                if a[1].is_null() { None } else { Some(u(&a[1])) },
                base(&a[2]),
            );
            json!({"received": r, "total": t})
        }
        "formatEstimate" => s(format_estimate(u(&a[0]), base(&a[1]))),
        "formatSpeed" => s(format_speed(u(&a[0]), base(&a[1]))),
        "formatPercent" => s(format_percent(
            u(&a[0]),
            u(&a[1]),
            a[2].as_bool().expect("complete"),
        )),
        "formatRemaining" => s(format_remaining(secs(&a[0]))),
        "formatElapsed" => s(format_elapsed(u(&a[0]))),
        "formatDaysAgo" => s(format_days_ago(u(&a[0]))),
        "formatSpan" => s(format_span(u(&a[0]))),
        "formatClock" => s(format_clock(u(&a[0]))),
        "formatMmss" => s(format_mmss(u(&a[0]))),
        "formatCount" => s(format_count(u(&a[0]))),
        "formatDate" => s(format_date(wall(&a[0]))),
        "formatDateTime" => s(format_date_time(wall(&a[0]))),
        "formatWhen" => s(format_when(wall(&a[0]), wall(&a[1]))),
        "formatAgo" => s(format_ago(
            a[0].as_i64().expect("unix"),
            a[1].as_i64().expect("now"),
        )),
        "parseKstWall" => match a[0].as_str().and_then(parse_kst_wall) {
            Some(w) => wall_json(w),
            None => Value::Null,
        },
        "wallOf" => wall_json(wall_of(
            a[0].as_i64().expect("unix"),
            a[1].as_i64().expect("offset"),
        )),
        "formatSpokenPercent" => s(format_spoken_percent(u(&a[0]))),
        "formatSpokenSize" => s(format_spoken_size(u(&a[0]), base(&a[1]))),
        "formatSpokenSpeed" => s(format_spoken_speed(u(&a[0]), base(&a[1]))),
        "formatSpokenRemaining" => s(format_spoken_remaining(secs(&a[0]))),
        other => panic!("골든에 있는데 Rust 거울이 없는 함수: {other}"),
    }
}

fn run_cases(file: &str, name: &str, cases: &Value, count: &mut usize) {
    for c in cases
        .as_array()
        .unwrap_or_else(|| panic!("{file}: cases 배열"))
    {
        let args = c["args"]
            .as_array()
            .unwrap_or_else(|| panic!("{file}: args 배열"));
        let got = call(name, args);
        assert_eq!(
            got, c["out"],
            "{file} {name}: {} args={:?}",
            c["name"], args
        );
        *count += 1;
    }
}

#[test]
fn golden_files_match() {
    let mut files: Vec<_> = fs::read_dir(golden_dir())
        .expect("design/format")
        .map(|e| e.expect("항목").path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(files.len() >= 16, "골든 파일이 줄었다: {}", files.len());

    let mut count = 0;
    for path in &files {
        let file = path
            .file_name()
            .expect("이름")
            .to_string_lossy()
            .into_owned();
        let v: Value =
            serde_json::from_str(&fs::read_to_string(path).expect("읽기")).expect("JSON");
        if let Some(fns) = v.get("fns") {
            for (name, cases) in fns.as_object().expect("fns 객체") {
                run_cases(&file, name, cases, &mut count);
            }
        } else {
            let name = v["fn"]
                .as_str()
                .unwrap_or_else(|| panic!("{file}: fn 없음"));
            let cases = &v["cases"];
            assert!(
                cases.as_array().is_some_and(|c| c.len() >= 8),
                "{file}: 케이스 8개 이상"
            );
            run_cases(&file, name, cases, &mut count);
        }
    }
    assert!(count >= 150, "검사한 케이스가 적다: {count}");
}

#[test]
fn os_base_and_constants() {
    use chzzk_shell::dto::OsDto;
    assert_eq!(size_base_of(OsDto::Windows), SizeBase::Binary);
    assert_eq!(size_base_of(OsDto::Macos), SizeBase::Decimal);
    assert_eq!(size_base_of(OsDto::Linux), SizeBase::Decimal);
    assert_eq!(UNIT_GAP, "");
    assert_eq!(WINDOWS_ROUNDING, Rounding::Round);
}
