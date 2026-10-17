use super::*;
use crate::chat::walk::{Next, next_step};
use crate::chat::{ChatCursor, parse_chat_page};
use crate::fsutil::rename_noclobber_with_retry;
use serde_json::value::RawValue;
use std::fs::OpenOptions;

const VIDEO: u64 = 9_000_002;

fn raw_msg(offset: u64, who: &str, text: &str) -> ChatMessage {
    let raw = format!(
        r#"{{"playerMessageTime":{offset},"userIdHash":"{who}","content":"{text}","messageTime":{offset}}}"#
    );
    ChatMessage::from_raw(RawValue::from_string(raw).unwrap()).unwrap()
}

fn state(cursor: u64) -> WalkState {
    WalkState {
        cursor: ChatCursor(cursor),
        ..WalkState::default()
    }
}

fn refs(v: &[ChatMessage]) -> Vec<&ChatMessage> {
    v.iter().collect()
}

struct Env {
    _dir: tempfile::TempDir,
    record: PathBuf,
}

fn env() -> Env {
    let dir = tempfile::tempdir().unwrap();
    let record = dir.path().join("영상.chat.jsonl");
    Env { _dir: dir, record }
}

/// 주의: `ChatPart`가 살아 있는 동안 그 `.part`를 이 함수로 읽지 않는다. Windows의 배타 잠금
/// (LockFileEx)은 다른 핸들의 읽기도 막아 `os error 33`이 난다(macOS·Linux의 advisory lock은 안 막는다).
/// 읽기 전에 `drop(p)`로 잠금을 풀거나, 잠근 핸들을 쓰는 `read_messages`·`for_each_message`를 쓴다.
fn read(p: &Path) -> Vec<u8> {
    std::fs::read(p).unwrap()
}

#[tokio::test]
async fn fresh_open_writes_sidecar_at_once() {
    let e = env();
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(part_path(&e.record).exists());
    assert!(sidecar_path(&e.record).exists());
    assert_eq!(p.resume_state(), WalkState::default());
    assert_eq!(p.lines(), 0);
    assert_eq!(p.end(), None);
    assert_eq!(p.committed(), 0);
}

#[tokio::test]
async fn commit_then_resume_restores_cursor_boundary_and_lines() {
    let e = env();
    // 같은 ms에 작성자·본문까지 같은 쌍둥이: 개수표가 2로 남아야 한다.
    let page = parse_chat_page(
        br#"{"code":200,"content":{"nextPlayerMessageTime":500,"videoChats":[
        {"playerMessageTime":100,"userIdHash":"a","content":"x","messageTime":100},
        {"playerMessageTime":100,"userIdHash":"a","content":"x","messageTime":100}]}}"#,
    )
    .unwrap();
    let step = next_step(&WalkState::default(), &page);
    let Next::Continue(st) = step.next.clone() else {
        panic!()
    };
    let kept: Vec<&ChatMessage> = step.keep.iter().map(|&i| &page.messages[i]).collect();
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&kept, &st, None).await.unwrap();
    assert_eq!(p.lines(), 2);
    assert_eq!(p.last_offset_ms(), Some(100));
    drop(p);

    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.resume_state(), st);
    assert_eq!(p.resume_state().cursor, ChatCursor(500));
    assert_eq!(p.resume_state().boundary_ms, Some(100));
    assert_eq!(p.resume_state().boundary.values().sum::<u32>(), 2);
    assert_eq!(p.lines(), 2);
    drop(p); // 잠금을 풀어야 다른 핸들로 읽을 수 있다(Windows)
    assert_eq!(
        read(&part_path(&e.record))
            .iter()
            .filter(|&&b| b == b'\n')
            .count(),
        2
    );
}

#[tokio::test]
async fn crash_tail_longer_than_sidecar_is_cut_and_no_duplicates() {
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    let committed = p.committed();
    drop(p);
    // 다음 페이지를 쓰다 죽은 꼬리(반쯤 쓴 줄)
    let mut f = OpenOptions::new()
        .append(true)
        .open(part_path(&e.record))
        .unwrap();
    f.write_all(b"{\"playerMessageTime\":99,\"user").unwrap();
    drop(f);
    assert!(read(&part_path(&e.record)).len() as u64 > committed);

    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    // 길이는 메타데이터로 본다(내용을 읽지 않으므로 잠금과 부딪히지 않는다)
    assert_eq!(
        std::fs::metadata(part_path(&e.record)).unwrap().len(),
        committed
    );
    let b = [raw_msg(60, "b", "two")];
    p.commit_page(&refs(&b), &state(90), None).await.unwrap();
    let got = p.read_messages().unwrap();
    assert_eq!(
        got.iter().map(|m| m.player_offset_ms).collect::<Vec<_>>(),
        vec![10, 60]
    );
    assert_eq!(p.lines(), 2);
}

#[tokio::test]
async fn missing_or_foreign_or_short_state_starts_over() {
    // 사이드카 없음: .part에 뭐가 있어도 처음부터
    let e = env();
    std::fs::write(part_path(&e.record), b"{\"junk\":1}\n").unwrap();
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.resume_state().cursor, ChatCursor(0));
    drop(p);
    assert_eq!(read(&part_path(&e.record)), b"");

    // 다른 영상의 사이드카
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    drop(p);
    let p = ChatPart::open(&e.record, VIDEO + 1, false).unwrap();
    assert_eq!(p.resume_state().cursor, ChatCursor(0));
    assert_eq!(p.lines(), 0);
    drop(p);
    assert_eq!(read(&part_path(&e.record)), b"");

    // .part가 sidecar보다 짧음
    let e = env();
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    drop(p);
    let f = OpenOptions::new()
        .write(true)
        .open(part_path(&e.record))
        .unwrap();
    f.set_len(3).unwrap();
    drop(f);
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.resume_state().cursor, ChatCursor(0));
    assert_eq!(p.lines(), 0);
}

#[tokio::test]
async fn committed_len_not_on_line_boundary_starts_over() {
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    drop(p);
    // 줄 끝(\n)을 다른 바이트로 바꾼다: 완전한 줄 경계가 아니다
    let mut bytes = read(&part_path(&e.record));
    *bytes.last_mut().unwrap() = b' ';
    std::fs::write(part_path(&e.record), bytes).unwrap();
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.resume_state().cursor, ChatCursor(0));
    drop(p);
    assert_eq!(read(&part_path(&e.record)), b"");
}

#[tokio::test]
async fn restart_discards_received() {
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    drop(p);
    let p = ChatPart::open(&e.record, VIDEO, true).unwrap();
    assert_eq!(p.resume_state(), WalkState::default());
    assert_eq!(p.lines(), 0);
    drop(p);
    assert_eq!(read(&part_path(&e.record)), b"");
}

#[tokio::test]
async fn second_open_is_file_locked_and_leaves_bytes_alone() {
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    drop(p); // 바이트는 잠금이 풀린 상태에서 읽는다(Windows)
    let before = read(&part_path(&e.record));
    let sc_before = read(&sidecar_path(&e.record));
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    // 잠근 쪽이 살아 있는 동안: 이어받기도 restart도 막히고 아무것도 바뀌지 않는다
    for restart in [false, true] {
        let err = ChatPart::open(&e.record, VIDEO, restart).unwrap_err();
        assert!(matches!(err, Error::FileLocked { .. }), "{err:?}");
    }
    assert_eq!(read(&sidecar_path(&e.record)), sc_before);
    drop(p);
    assert_eq!(read(&part_path(&e.record)), before);
    // 풀리면 다시 열린다
    ChatPart::open(&e.record, VIDEO, false).unwrap();
}

#[tokio::test]
async fn raw_with_line_breaks_stays_one_line() {
    let e = env();
    let raw = "{\r\n \"playerMessageTime\": 7,\n \"userIdHash\": \"a\",\n \"content\": \"줄\\n바꿈\",\r\n \"messageTime\": 7\n}";
    let m = ChatMessage::from_raw(RawValue::from_string(raw.to_string()).unwrap()).unwrap();
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&[&m], &state(9), None).await.unwrap();
    let back = p.read_messages().unwrap();
    drop(p);
    let bytes = read(&part_path(&e.record));
    assert_eq!(bytes.iter().filter(|&&b| b == b'\n').count(), 1);
    assert_eq!(*bytes.last().unwrap(), b'\n');
    assert_eq!(back.len(), 1);
    assert_eq!(back[0].text, "줄\n바꿈");
}

#[tokio::test]
async fn end_marker_and_counts_survive_reopen() {
    let e = env();
    let a = [raw_msg(10, "a", "one"), raw_msg(30, "b", "two")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), Some(ChatEnd::NoCursor))
        .await
        .unwrap();
    drop(p);
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.end(), Some(ChatEnd::NoCursor));
    assert_eq!(p.lines(), 2);
    assert_eq!(p.last_offset_ms(), Some(30));
}

#[tokio::test]
async fn debug_has_no_message_text() {
    let e = env();
    let a = [raw_msg(10, "작성자해시", "비밀본문")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    let dbg = format!("{p:?} {:?}", p.sidecar());
    assert!(
        !dbg.contains("비밀본문") && !dbg.contains("작성자해시"),
        "{dbg}"
    );
}

/// `filled`가 `.part`에 쓰는 바이트(`raw_msg(10, "a", "one")` 한 줄). 잠긴 `.part`를 읽지 않고 비교한다.
fn filled_bytes() -> Vec<u8> {
    let mut v =
        br#"{"playerMessageTime":10,"userIdHash":"a","content":"one","messageTime":10}"#.to_vec();
    v.push(b'\n');
    v
}

async fn filled(e: &Env) -> ChatPart {
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), Some(ChatEnd::NoCursor))
        .await
        .unwrap();
    p
}

#[tokio::test]
async fn finalize_moves_and_removes_sidecar() {
    let e = env();
    let p = filled(&e).await;
    let want = filled_bytes();
    let r = p.finalize(&[], DuplicatePolicy::Skip).await.unwrap();
    assert_eq!(r, ChatFinalized::Moved);
    assert_eq!(read(&e.record), want);
    assert!(!part_path(&e.record).exists());
    assert!(!sidecar_path(&e.record).exists());
}

#[tokio::test]
async fn skip_keeps_existing_bytes_and_leaves_part_and_sidecar() {
    let e = env();
    std::fs::write(&e.record, b"USER-FILE").unwrap();
    let p = filled(&e).await;
    let r = p.finalize(&[], DuplicatePolicy::Skip).await.unwrap();
    assert_eq!(
        r,
        ChatFinalized::TargetExists {
            path: e.record.clone()
        }
    );
    assert_eq!(read(&e.record), b"USER-FILE");
    assert!(part_path(&e.record).exists());
    assert!(sidecar_path(&e.record).exists());
}

#[tokio::test]
async fn overwrite_replaces_and_reuses_kept_part() {
    let e = env();
    std::fs::write(&e.record, b"USER-FILE").unwrap();
    let p = filled(&e).await;
    let want = filled_bytes();
    p.finalize(&[], DuplicatePolicy::Skip).await.unwrap();
    // Conflict 뒤 동의: 남은 .part로 요청 없이 마무리된다(end가 sidecar에 남아 있다)
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.end(), Some(ChatEnd::NoCursor));
    let r = p.finalize(&[], DuplicatePolicy::Overwrite).await.unwrap();
    assert_eq!(r, ChatFinalized::Moved);
    assert_eq!(read(&e.record), want);
    assert!(!sidecar_path(&e.record).exists());
}

/// 경쟁: 검사 시점에는 없다가 마무리 직전에 사용자가 같은 이름을 만든다.
#[tokio::test]
async fn skip_race_target_appears_just_before_rename() {
    let e = env();
    let p = filled(&e).await;
    let target = e.record.clone();
    let r = p
        .finalize_using(&[], move |from, to| {
            assert!(!to.exists(), "검사 시점에는 없다");
            std::fs::write(to, b"RACED").unwrap();
            rename_noclobber_with_retry(from, to)
        })
        .await
        .unwrap();
    assert_eq!(r, ChatFinalized::TargetExists { path: target });
    assert_eq!(read(&e.record), b"RACED");
    assert!(part_path(&e.record).exists());
    assert!(sidecar_path(&e.record).exists());
}

#[tokio::test]
async fn companion_moved_then_record_blocked_resumes_without_removing() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"ASS").unwrap();
    std::fs::write(&e.record, b"USER-RECORD").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let r = p.finalize(&comp, DuplicatePolicy::Skip).await.unwrap();
    // 자막은 옮겼고 기록 이름이 막혔다
    assert_eq!(
        r,
        ChatFinalized::TargetExists {
            path: e.record.clone()
        }
    );
    assert_eq!(read(&sub_to), b"ASS");
    assert!(!sub_from.exists());
    assert_eq!(read(&e.record), b"USER-RECORD");
    assert!(part_path(&e.record).exists() && sidecar_path(&e.record).exists());

    // 다시 마무리: 이미 최종 이름에 있는 자막은 다시 옮기지 않는다(사용자가 그새 고친 자막도 그대로)
    std::fs::write(&sub_to, b"EDITED").unwrap();
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(p.is_moved(&sub_to));
    let r = p.finalize(&comp, DuplicatePolicy::Overwrite).await.unwrap();
    assert_eq!(r, ChatFinalized::Moved);
    assert_eq!(read(&sub_to), b"EDITED");
    assert_ne!(read(&e.record), b"USER-RECORD");
}

#[tokio::test]
async fn companion_blocked_stops_before_record() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.srt");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"SRT").unwrap();
    std::fs::write(&sub_to, b"USER-SUB").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let r = p.finalize(&comp, DuplicatePolicy::Skip).await.unwrap();
    assert_eq!(
        r,
        ChatFinalized::TargetExists {
            path: sub_to.clone()
        }
    );
    assert_eq!(read(&sub_to), b"USER-SUB");
    assert!(sub_from.exists());
    // 기록은 건드리지 않았다
    assert!(!e.record.exists());
    assert!(part_path(&e.record).exists() && sidecar_path(&e.record).exists());
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(!p.is_moved(&sub_to));
}

#[tokio::test]
async fn overwrite_companion_and_record() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"NEW-ASS").unwrap();
    std::fs::write(&sub_to, b"OLD").unwrap();
    std::fs::write(&e.record, b"OLD").unwrap();
    let comp = [Companion {
        from: sub_from,
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let r = p.finalize(&comp, DuplicatePolicy::Overwrite).await.unwrap();
    assert_eq!(r, ChatFinalized::Moved);
    assert_eq!(read(&sub_to), b"NEW-ASS");
    assert_ne!(read(&e.record), b"OLD");
}

/// 사이드카 자리를 디렉터리로 막아 다음 커밋의 sidecar 쓰기를 실패시킨다(`restore`로 되돌린다).
fn block_sidecar(record: &Path) -> PathBuf {
    let sc = sidecar_path(record);
    let aside = sc.with_extension("json.aside");
    std::fs::rename(&sc, &aside).unwrap();
    std::fs::create_dir(&sc).unwrap();
    aside
}

fn restore_sidecar(record: &Path, aside: &Path) {
    let sc = sidecar_path(record);
    std::fs::remove_dir(&sc).unwrap();
    std::fs::rename(aside, &sc).unwrap();
}

#[tokio::test]
async fn failed_commit_poisons_part_and_reopen_has_no_duplicates() {
    let e = env();
    let p1 = [raw_msg(10, "a", "one")];
    let p2 = [raw_msg(20, "b", "two")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&p1), &state(15), None).await.unwrap();

    let aside = block_sidecar(&e.record);
    assert!(p.commit_page(&refs(&p2), &state(25), None).await.is_err());
    // 독 상태: 같은 페이지 재시도, 읽기, 마무리가 모두 막힌다(커밋하지 않은 줄을 섞지 않는다)
    assert!(p.commit_page(&refs(&p2), &state(25), None).await.is_err());
    assert!(p.read_messages().is_err());
    assert!(p.for_each_message(|_| Ok(())).is_err());
    assert!(p.finalize(&[], DuplicatePolicy::Overwrite).await.is_err());

    // 다시 열면 첫 커밋으로 돌아가 꼬리가 잘리고, 같은 페이지를 다시 커밋해도 한 번만 들어간다.
    restore_sidecar(&e.record, &aside);
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert_eq!(p.lines(), 1);
    p.commit_page(&refs(&p2), &state(25), None).await.unwrap();
    assert_eq!(p.lines(), 2);
    assert_eq!(p.read_messages().unwrap().len(), 2);
    drop(p);
    assert_eq!(
        read(&part_path(&e.record))
            .iter()
            .filter(|&&b| b == b'\n')
            .count(),
        2
    );
}

#[tokio::test]
async fn dropped_commit_future_poisons_part() {
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    // 첫 poll에서 blocking 작업을 기다리다 멈추고, 이어서 준비된 가지가 이겨 future가 버려진다.
    let (kept, st) = (refs(&a), state(50));
    tokio::select! {
        biased;
        _ = p.commit_page(&kept, &st, None) => panic!("끝나면 안 된다"),
        _ = std::future::ready(()) => {}
    }
    assert!(p.read_messages().is_err());
    assert!(p.commit_page(&refs(&a), &state(50), None).await.is_err());
}

#[tokio::test]
async fn for_each_message_streams_stops_early_and_keeps_write_position() {
    let e = env();
    let a = [raw_msg(10, "a", "one"), raw_msg(20, "b", "two")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(30), None).await.unwrap();
    let mut seen = 0;
    p.for_each_message(|_| {
        seen += 1;
        Ok(())
    })
    .unwrap();
    assert_eq!(seen, 2);
    // 콜백 오류에서 멈추고 그 오류를 돌려준다
    let mut n = 0;
    let err = p
        .for_each_message(|_| {
            n += 1;
            Err(Error::Parse {
                what: "chat",
                detail: "stop".into(),
            })
        })
        .unwrap_err();
    assert_eq!(n, 1);
    assert!(matches!(err, Error::Parse { .. }));
    // 읽은 뒤에도 쓰기 위치가 끝이라 다음 커밋이 덧붙는다
    let b = [raw_msg(40, "c", "three")];
    p.commit_page(&refs(&b), &state(50), None).await.unwrap();
    assert_eq!(p.read_messages().unwrap().len(), 3);
}

#[tokio::test]
async fn moved_companion_temp_recreated_by_caller_is_removed() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"ASS").unwrap();
    std::fs::write(&e.record, b"USER-RECORD").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    p.finalize(&comp, DuplicatePolicy::Skip).await.unwrap();

    // 다시 마무리하면서 호출자가 자막을 다시 렌더해 `.part`를 또 만들었다: 고아로 남기지 않는다.
    std::fs::write(&sub_from, b"ASS2").unwrap();
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    let r = p.finalize(&comp, DuplicatePolicy::Overwrite).await.unwrap();
    assert_eq!(r, ChatFinalized::Moved);
    assert!(!sub_from.exists());
    assert_eq!(read(&sub_to), b"ASS");
}

/// 자막 rename 직후(`moved` 기록 전) 프로세스가 멈춘다: rename을 실제로 한 뒤 패닉한다.
#[tokio::test]
async fn companion_move_interrupted_after_rename_is_recovered_by_intent() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"ASS").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let r = p
        .finalize_using(&comp, |a, b| {
            std::fs::rename(a, b).unwrap();
            panic!("rename 뒤 중단");
        })
        .await;
    assert!(r.is_err());
    assert_eq!(read(&sub_to), b"ASS");
    assert!(!sub_from.exists());

    // 다시 열면 `moved`에는 없지만 이동 의도가 남아 있어 옮긴 것으로 본다
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(!p.is_moved(&sub_to));
    assert_eq!(p.sidecar().moving, ["영상.ass"]);
    assert!(p.is_move_interrupted(&sub_from, &sub_to));
    let r = p.finalize(&comp, DuplicatePolicy::Skip).await.unwrap();
    assert_eq!(r, ChatFinalized::Moved);
    assert_eq!(read(&sub_to), b"ASS");
    assert!(e.record.exists());
    assert!(!sidecar_path(&e.record).exists());
}

/// 이동 의도가 없으면 원본 없이 최종 파일만 있어도 우리 것으로 치지 않는다(무관한 기존 파일을 지킨다).
#[tokio::test]
async fn companion_in_place_without_intent_is_not_ours() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_to, b"USER-SUB").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    assert!(!p.is_move_interrupted(&sub_from, &sub_to));
    let r = p.finalize(&comp, DuplicatePolicy::Skip).await.unwrap();
    assert_eq!(
        r,
        ChatFinalized::TargetExists {
            path: sub_to.clone()
        }
    );
    assert_eq!(read(&sub_to), b"USER-SUB");
    assert!(!e.record.exists());
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(!p.is_moved(&sub_to));
    assert!(p.sidecar().moving.is_empty());
}

/// 막힌 보조 파일의 이동 의도는 지운다. 남으면 그 뒤 임시 파일이 사라졌을 때 사용자 파일을 우리 것으로 본다.
#[tokio::test]
async fn blocked_companion_clears_intent() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.srt");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"SRT").unwrap();
    std::fs::write(&sub_to, b"USER-SUB").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let r = p.finalize(&comp, DuplicatePolicy::Skip).await.unwrap();
    assert!(matches!(r, ChatFinalized::TargetExists { .. }));
    std::fs::remove_file(&sub_from).unwrap();
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(p.sidecar().moving.is_empty());
    assert!(!p.is_move_interrupted(&sub_from, &sub_to));
    assert_eq!(read(&sub_to), b"USER-SUB");
}

/// rename이 오류여도 의도를 지운다.
#[tokio::test]
async fn failed_companion_rename_clears_intent() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"ASS").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let r = p
        .finalize_using(&comp, |_, b| {
            Err(map_io_error("rename", b, io::Error::other("디스크 오류")))
        })
        .await;
    assert!(r.is_err());
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(p.sidecar().moving.is_empty());
    assert!(sub_from.exists() && !sub_to.exists());
}

/// 이동 의도를 적지 못하면 옮기지 않는다(옮긴 뒤 멈추면 무관한 파일과 가를 수 없다).
#[tokio::test]
async fn companion_not_moved_when_intent_cannot_be_written() {
    let e = env();
    let sub_to = e.record.with_file_name("영상.ass");
    let sub_from = part_path(&sub_to);
    std::fs::write(&sub_from, b"ASS").unwrap();
    let comp = [Companion {
        from: sub_from.clone(),
        to: sub_to.clone(),
    }];
    let p = filled(&e).await;
    let aside = block_sidecar(&e.record);
    assert!(p.finalize(&comp, DuplicatePolicy::Skip).await.is_err());
    assert!(sub_from.exists());
    assert!(!sub_to.exists());
    assert!(!e.record.exists());
    restore_sidecar(&e.record, &aside);
    let p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    assert!(p.sidecar().moving.is_empty());
}

// ---------------------------------------------------------------------------
// 셸이 쓰는 정리·확인(④-4): `discard_chat_partial`·`chat_partial_bytes`
// ---------------------------------------------------------------------------

/// 영상 최종 경로와 그 옆 기록 경로.
fn video_env() -> (tempfile::TempDir, PathBuf, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let video = dir.path().join("영상.mp4");
    let record = crate::naming::sibling_path(&video, crate::chat::collect::RECORD_EXT);
    (dir, video, record)
}

#[tokio::test]
async fn discard_removes_part_sidecar_and_subtitle_temps() {
    let (_d, video, record) = video_env();
    let p = ChatPart::open(&record, VIDEO, false).unwrap();
    drop(p);
    let ass_tmp = part_path(&crate::naming::sibling_path(&video, ".ass"));
    let srt_tmp = part_path(&crate::naming::sibling_path(&video, ".srt"));
    std::fs::write(&ass_tmp, b"x").unwrap();
    std::fs::write(&srt_tmp, b"x").unwrap();
    // 완성 파일은 건드리지 않는다
    let done_ass = crate::naming::sibling_path(&video, ".ass");
    std::fs::write(&done_ass, b"user").unwrap();

    assert_eq!(
        discard_chat_partial(&video, VIDEO).unwrap(),
        crate::download::part::Discarded::Removed
    );
    assert!(!part_path(&record).exists());
    assert!(!sidecar_path(&record).exists());
    assert!(!ass_tmp.exists());
    assert!(!srt_tmp.exists());
    assert_eq!(read(&done_ass), b"user");
}

#[tokio::test]
async fn discard_keeps_other_videos_part() {
    let (_d, video, record) = video_env();
    drop(ChatPart::open(&record, VIDEO + 1, false).unwrap());
    assert_eq!(
        discard_chat_partial(&video, VIDEO).unwrap(),
        crate::download::part::Discarded::NotOwned
    );
    assert!(part_path(&record).exists());
    assert!(sidecar_path(&record).exists());
}

#[tokio::test]
async fn discard_without_files_is_ok() {
    let (_d, video, _record) = video_env();
    assert_eq!(
        discard_chat_partial(&video, VIDEO).unwrap(),
        crate::download::part::Discarded::Removed
    );
}

#[tokio::test]
async fn discard_while_locked_is_file_locked_and_keeps_files() {
    let (_d, video, record) = video_env();
    let p = ChatPart::open(&record, VIDEO, false).unwrap();
    let err = discard_chat_partial(&video, VIDEO).unwrap_err();
    assert!(matches!(err, Error::FileLocked { .. }), "{err:?}");
    drop(p);
    assert!(part_path(&record).exists());
    assert!(sidecar_path(&record).exists());
}

#[tokio::test]
async fn partial_bytes_reads_committed_len_of_same_video_only() {
    let (_d, video, record) = video_env();
    assert_eq!(chat_partial_bytes(&video, VIDEO), None);
    let page = parse_chat_page(
        br#"{"code":200,"content":{"nextPlayerMessageTime":500,"videoChats":[
        {"playerMessageTime":100,"userIdHash":"a","content":"x","messageTime":100}]}}"#,
    )
    .unwrap();
    let step = next_step(&WalkState::default(), &page);
    let Next::Continue(st) = step.next.clone() else {
        panic!()
    };
    let kept: Vec<&ChatMessage> = step.keep.iter().map(|&i| &page.messages[i]).collect();
    let mut p = ChatPart::open(&record, VIDEO, false).unwrap();
    // 첫 페이지 전(open 직후)에도 sidecar가 있어 0이다: 받은 것이 없어도 "남은 파일이 있다"
    let committed = p.committed();
    assert_eq!(committed, 0);
    p.commit_page(&kept, &st, None).await.unwrap();
    let committed = p.committed();
    drop(p);
    assert!(committed > 0);
    assert_eq!(chat_partial_bytes(&video, VIDEO), Some(committed));
    assert_eq!(chat_partial_bytes(&video, VIDEO + 1), None);
    // sidecar보다 짧은 `.part`는 이 sidecar의 파일이 아니다
    std::fs::write(part_path(&record), b"").unwrap();
    assert_eq!(chat_partial_bytes(&video, VIDEO), None);
}

#[test]
fn partial_bytes_without_sidecar_is_part_len_when_part_exists() {
    let (_d, video, record) = video_env();
    std::fs::write(part_path(&record), b"abc\n").unwrap();
    // sidecar가 없으면 주인을 모르는 남은 파일이다: 지우기 경로가 D2를 거치도록 길이를 준다
    assert_eq!(chat_partial_bytes(&video, VIDEO), Some(4));
}
