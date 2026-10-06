//! 릴리스 도구(docs/design/cicd.md §5, 구현 중 변경 G6). `cargo xtask release <명령> [--옵션 값]…`
//!
//! 명령(모두 결정적: 종료 코드·해시·서명·스키마로만 판정한다):
//!   collect    --from <폴더> --out <폴더> --version <v>   OS별 bundles.json(bundle.mjs collect --release)을 모아 기대 집합·해시 확인
//!   sign       --dir <폴더>                               updater 산출물에 서명(env TAURI_SIGNING_PRIVATE_KEY[_PASSWORD]) → <file>.sig
//!   verify-sig --dir <폴더> --pubkey <파일> [--sig-dir <폴더>]  모든 .sig 검증 + 1바이트 변조 사본은 반드시 실패
//!   sums       --dir <폴더>                               SHA256SUMS
//!   manifest   --dir <폴더> --version <v> --pub-date <RFC3339> --base-url <URL>   manifest.json(Tauri 정적 스키마) + 스키마 검증
//!   put        --dir <폴더> --version <v>                 releases/<v>/…를 덮어쓰기 없이(If-None-Match: *) 올린다
//!   promote    --dir <폴더> --version <v>                 releases/latest.json을 CAS로 바꾼다(마지막에). prev를 GITHUB_OUTPUT에
//!   verify     --version <v> --pubkey <파일> [--objects-only]   다시 받아 해시·서명·스키마·버전 확인
//!   rollback   --to <v|none> --pubkey <파일> [--from <v>]       latest.json을 그 버전의 manifest.json으로 CAS 교체 → 다시 verify
//!   keygen     --out <파일>                               Tauri 형식 키 쌍(env XTASK_KEY_PASSWORD, 시험용)
//!   get        --key <키> --out <파일>                    객체 하나 받기(진단·selftest)
//!   list-keys  --prefix releases/…                        접두 아래 키를 한 줄씩(ListObjectsV2, 잘리면 exit 2, 보존 상한 prune의 입력)
//!   delete-version --version <v>                          releases/<v>/ 아래를 지운다(latest와 그 previous는 거부, prune 전용)
//!   put-raw    --key <키> --file <파일>                   조건 없이 덮어쓰기(selftest의 변조 전용, env XTASK_ALLOW_RAW=1)
//! 종료 코드: 0 통과, 1 검사 실패, 2 사용법·입력·환경 오류.

mod cli;
mod manifest;
mod release;
mod s3;
mod schema;
mod semver;
mod sig;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    std::process::exit(cli::run(&args));
}
