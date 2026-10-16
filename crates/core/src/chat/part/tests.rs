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
    assert_eq!(read(&part_path(&e.record)).len() as u64, committed);
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
    assert_eq!(read(&part_path(&e.record)), b"");
    drop(p);

    // 다른 영상의 사이드카
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    drop(p);
    let p = ChatPart::open(&e.record, VIDEO + 1, false).unwrap();
    assert_eq!(p.resume_state().cursor, ChatCursor(0));
    assert_eq!(p.lines(), 0);
    assert_eq!(read(&part_path(&e.record)), b"");
    drop(p);

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
    assert_eq!(read(&part_path(&e.record)), b"");
}

#[tokio::test]
async fn second_open_is_file_locked_and_leaves_bytes_alone() {
    let e = env();
    let a = [raw_msg(10, "a", "one")];
    let mut p = ChatPart::open(&e.record, VIDEO, false).unwrap();
    p.commit_page(&refs(&a), &state(50), None).await.unwrap();
    let before = read(&part_path(&e.record));
    let sc_before = read(&sidecar_path(&e.record));
    // 잠근 쪽이 살아 있는 동안: 이어받기도 restart도 막히고 아무것도 바뀌지 않는다
    for restart in [false, true] {
        let err = ChatPart::open(&e.record, VIDEO, restart).unwrap_err();
        assert!(matches!(err, Error::FileLocked { .. }), "{err:?}");
    }
    assert_eq!(read(&part_path(&e.record)), before);
    assert_eq!(read(&sidecar_path(&e.record)), sc_before);
    drop(p);
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
    let bytes = read(&part_path(&e.record));
    assert_eq!(bytes.iter().filter(|&&b| b == b'\n').count(), 1);
    assert_eq!(*bytes.last().unwrap(), b'\n');
    let back = p.read_messages().unwrap();
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
    let want = read(&part_path(&e.record));
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
    let want = read(&part_path(&e.record));
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
