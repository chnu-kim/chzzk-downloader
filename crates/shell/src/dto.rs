//! 프런트로 가는 타입(docs/design/app.md §5). 모두 `ts-rs`로 `app/src/lib/bindings`에 TS 정의를 만든다.
//!
//! 코어 타입(`ContentRef`·`PlaybackKind` 등)은 코어 직렬화를 그대로 쓰고, ts-rs를 코어에 넣지 않으려고
//! 같은 serde 속성을 가진 셸 미러(`*Ts`)를 `#[ts(as = "...")]`로 붙인다. 미러는 TS 모양을 적는 데만 쓰며,
//! `tests/dto_json.rs`가 코어 직렬화와 미러 직렬화가 같은지 검사한다.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// 작업 id. `jobs.json`의 `nextId`로 단조 증가한다. JSON·TS에서는 숫자다(2^53 미만 전제).
/// serde newtype이라 JSON에서는 감싸지 않은 숫자다.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
pub struct JobId(pub u64);

/// `chzzk_core::PlaybackKind`의 TS 모양.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename = "PlaybackKind")]
pub enum PlaybackKindTs {
    Progressive,
    LiveRewindHls,
}
