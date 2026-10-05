// 앱 command 이름 목록. `build.rs`(AppManifest)와 `lib.rs`(테스트)가 `include!`로 함께 쓴다.
// command를 더하면 여기, `commands.rs`, `lib.rs`의 `generate_handler!`, `capabilities/default.json`을 함께 고친다
// (`tests/ipc.rs`가 capabilities와 이 목록이 같은지, 목록의 모든 command가 처리기에 있는지 검사한다).
&[
    "app_info",
    "get_settings",
    "update_settings",
    "set_naver_cookies",
    "clear_naver_cookies",
    "import_legacy",
    "pick_folder",
    "resolve",
    "check_output",
    "enqueue",
    "list_jobs",
    "subscribe_jobs",
    "pause_job",
    "resume_job",
    "remove_job",
    "clear_finished",
    "open_output",
    "reveal_output",
    "quit",
    "auth_status",
    "clipboard_link",
]
