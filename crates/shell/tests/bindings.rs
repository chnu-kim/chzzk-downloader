//! 커밋된 `app/src/lib/bindings`가 Rust DTO와 같은지 검사한다.
//! 다르면 `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 다시 만든다.

use std::collections::BTreeMap;
use std::path::Path;

use chzzk_shell::bindings;

fn read_tree(dir: &Path) -> BTreeMap<String, String> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return BTreeMap::new();
    };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.path().is_file())
        .map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            // Windows에서 autocrlf로 받아도 비교가 깨지지 않게 줄 끝을 맞춘다.
            let body = std::fs::read_to_string(e.path())
                .unwrap()
                .replace("\r\n", "\n");
            (name, body)
        })
        .collect()
}

#[test]
fn bindings_are_up_to_date() {
    let committed = bindings::default_dir();
    if std::env::var("UPDATE_BINDINGS").is_ok_and(|v| v == "1") {
        if committed.exists() {
            std::fs::remove_dir_all(&committed).unwrap();
        }
        bindings::export(&committed).unwrap();
        return;
    }

    let tmp = tempfile::tempdir().unwrap();
    bindings::export(tmp.path()).unwrap();
    let fresh = read_tree(tmp.path());
    let have = read_tree(&committed);

    let missing: Vec<_> = fresh.keys().filter(|k| !have.contains_key(*k)).collect();
    let stale: Vec<_> = have.keys().filter(|k| !fresh.contains_key(*k)).collect();
    let changed: Vec<_> = fresh
        .iter()
        .filter(|(k, v)| have.get(*k).is_some_and(|h| h != *v))
        .map(|(k, _)| k)
        .collect();
    assert!(
        missing.is_empty() && stale.is_empty() && changed.is_empty(),
        "app/src/lib/bindings가 낡았다. `UPDATE_BINDINGS=1 cargo test -p chzzk-shell --test bindings`로 다시 만든다.\n\
         없음: {missing:?}\n남음: {stale:?}\n다름: {changed:?}"
    );
}

/// 큰 정수(`u64`)가 `bigint`가 아니라 `number`로 나간다(app.md §0).
#[test]
fn large_ints_are_numbers() {
    let tmp = tempfile::tempdir().unwrap();
    bindings::export(tmp.path()).unwrap();
    let tree = read_tree(tmp.path());
    assert!(tree.values().all(|v| !v.contains("bigint")), "{tree:#?}");
    assert!(tree["JobId.ts"].contains("export type JobId = number;"));
    assert!(tree["index.ts"].contains("export type * from \"./AppError\";"));
}
