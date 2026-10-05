# Ratchet 기록

`ci/ratchet.json`의 기준을 **느슨하게** 할 때(커버리지·테스트 수를 낮추기, 크기 기준을 키우기, 허용치를 넓히기, 키를 지우기) 같은 변경에서 이 파일에 한 줄을 더한다. 줄에는 바뀐 키의 경로를 글자 그대로(예: `coverage_lines.rust`) 적고 이유를 쓴다. CI `lint`의 `ratchet-log` gate가 기준 커밋 대비 diff에서 확인한다(docs/design/cicd.md §4.2). 조이는 변경(`ratchet.mjs write`)은 적지 않아도 된다.

| 날짜 | 키 | 이전 → 이후 | 이유 |
|---|---|---|---|
| 2026-10-06 | `size.binary.darwin` | 19101600 → 20303840 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.binary.windows` | 18455552 → 19681792 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.bundle.darwin-dmg` | 7086358 → 7688326 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.bundle.windows-setup` | 4440275 → 4718577 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.bundle.windows-msi` | 6500352 → 7057408 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
