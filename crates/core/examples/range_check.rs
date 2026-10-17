//! 실측 M-②-3(PR ②-0, 오프라인): 빠른 다시보기 조각이 모두 키프레임(동기 샘플)으로 시작하는가.
//!
//! ```text
//! cargo run -q -p chzzk-core --example range_check -- <전체 받기 파일.mp4>
//! ```
//!
//! 입력은 `examples/dl`로 **구간 없이 끝까지** 받은 빠른 다시보기 파일이다(전체 받기는 조각 구조 그대로 남는다).
//! `--range`로 받은 파일은 일반 mp4로 바뀌어 검사하지 못하고, `--limit-mb`로 멈춘 `.part`는 잘린 파일이라 해석하지 못한다.
//! 네트워크를 쓰지 않는다(쿠키·주소를 다루지 않는다). 판정 규칙은 `chzzk_core::download::defrag::keyframe` 머리 주석.
//!
//! 출력은 판정(된다/안 된다/확인 못 함)과 조각 수 집계뿐이다. 파일 경로·오류 detail(바이트 위치가 들 수 있다)은 찍지 않는다.
//! 조각 수 × 조각 길이는 영상 길이를 드러내므로 ROADMAP 등 저장소에는 **판정 범주만** 적는다(공개 저장소 규칙, range.md §8).
//!
//! 종료 코드: 0 판정을 냈다(된다·안 된다) · 1 확인 못 함 · 2 사용법.

use std::fs::File;
use std::process::ExitCode;

use chzzk_core::download::defrag::keyframe::{Boundary, KeyframeCheck, Verdict, check_file};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let [input] = args.as_slice() else {
        eprintln!("사용법: range_check <전체 받기 파일.mp4>");
        return ExitCode::from(2);
    };
    let mut f = match File::open(input) {
        Ok(f) => f,
        Err(e) => {
            println!("판정: 확인 못 함(파일을 열지 못했다: {:?})", e.kind());
            return ExitCode::FAILURE;
        }
    };
    let r = match check_file(&mut f) {
        Ok(KeyframeCheck::Fragmented(r)) => r,
        Ok(KeyframeCheck::NotFragmented) => {
            println!(
                "판정: 확인 못 함(조각 구조 파일이 아니다. 구간 받기 결과·일반 mp4는 검사하지 못한다)"
            );
            return ExitCode::FAILURE;
        }
        Err(_) => {
            println!(
                "판정: 확인 못 함(파일 구조를 해석하지 못했다. 잘린 파일이면 끝까지 받은 파일로 다시)"
            );
            return ExitCode::FAILURE;
        }
    };
    let verdict = r.verdict();
    let word = match verdict {
        Verdict::Yes => "된다",
        Verdict::No => "안 된다",
        Verdict::Unknown => "확인 못 함",
    };
    let boundary = match r.boundary {
        Boundary::Styp => "styp",
        Boundary::Moof => "moof(styp 없음)",
    };
    println!("판정: {word}");
    println!("검사한 조각: {}개(경계: {boundary})", r.fragments);
    println!("키프레임으로 시작: {}개", r.sync);
    println!(
        "키프레임 아님: {}개(그중 I 프레임 표시: {}개)",
        r.non_sync, r.non_sync_independent
    );
    println!("확인 못 함(비디오 샘플 없음): {}개", r.no_video);
    if r.boundary == Boundary::Moof && verdict == Verdict::No {
        // styp가 없으면 HLS 조각 경계를 모른다. 조각 하나에 moof가 여럿이면 안쪽 moof까지 세어 지나치게 엄격하다.
        println!(
            "참고: styp가 없어 moof 하나를 조각 하나로 셌다. HLS 조각 하나에 moof가 여럿이면 이 판정은 지나치게 엄격하다."
        );
    }
    println!("저장소에는 판정 범주만 적는다(조각 수는 영상 길이를 드러낸다).");
    match verdict {
        Verdict::Yes | Verdict::No => ExitCode::SUCCESS,
        Verdict::Unknown => ExitCode::FAILURE,
    }
}
