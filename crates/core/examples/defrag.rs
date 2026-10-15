//! 수동 검증용: 조각난 mp4를 복사한 뒤 일반 mp4로 변환한다(core.md 구현 중 변경 60). 원본은 바꾸지 않는다.
//!
//! ```text
//! cargo run -q -p chzzk-core --example defrag -- <입력.mp4> <출력.mp4>
//! ```

use std::fs::OpenOptions;
use std::process::ExitCode;

use chzzk_core::download::defrag::defragment;

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input, output] = args.as_slice() else {
        eprintln!("사용법: defrag <입력.mp4> <출력.mp4>");
        return ExitCode::from(2);
    };
    if let Err(e) = std::fs::copy(input, output) {
        eprintln!("복사 실패: {e}");
        return ExitCode::FAILURE;
    }
    let mut f = match OpenOptions::new().read(true).write(true).open(output) {
        Ok(f) => f,
        Err(e) => {
            eprintln!("열기 실패: {e}");
            return ExitCode::FAILURE;
        }
    };
    match defragment(&mut f) {
        Ok(r) => {
            println!("{r:?}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("변환 실패(출력은 원본 사본 그대로): {e}");
            ExitCode::FAILURE
        }
    }
}
