# Ratchet 기록

`ci/ratchet.json`의 기준을 **느슨하게** 할 때(커버리지·테스트 수를 낮추기, 크기 기준을 키우기, 허용치를 넓히기, 키를 지우기) 같은 변경에서 이 파일에 한 줄을 더한다. 줄에는 바뀐 키의 경로를 글자 그대로(예: `coverage_lines.rust`) 적고 이유를 쓴다. CI `lint`의 `ratchet-log` gate가 기준 커밋 대비 diff에서 확인한다(docs/design/cicd.md §4.2). 조이는 변경(`ratchet.mjs write`)은 적지 않아도 된다.

| 날짜 | 키 | 이전 → 이후 | 이유 |
|---|---|---|---|
| 2026-10-06 | `size.binary.darwin` | 19101600 → 20303840 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.binary.windows` | 18455552 → 19681792 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.bundle.darwin-dmg` | 7086358 → 7688326 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.bundle.windows-setup` | 4440275 → 4718577 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.bundle.windows-msi` | 6500352 → 7057408 | G6: tauri-plugin-updater 등록(릴리스 리허설 37375444247의 CI 측정값, +6~9%). updater는 Phase 3 자동 업데이트의 전제다 |
| 2026-10-06 | `size.binary.linux` | 28181752 → 29686784 | G6: tauri-plugin-updater 등록(릴리스 리허설 37377704140의 CI 측정값, +5~7%) |
| 2026-10-06 | `size.bundle.linux-deb` | 9262424 → 9918794 | G6: tauri-plugin-updater 등록(릴리스 리허설 37377704140의 CI 측정값, +5~7%) |
| 2026-10-06 | `size.binary.linux` | 29686784 → 32559736 | 툴체인 1.96.1 → 1.99.0(코드 변경 없음, PR #12 실행 37404351747의 CI 측정값, +9.7%). 같은 실행의 AppImage는 +0.5%, deb는 −1.9%라 배포 크기 차이는 작다(cicd.md 76) |
| 2026-10-06 | `size.binary.darwin` | 20303840 → 22824784 | 툴체인 1.96.1 → 1.99.0(코드 변경 없음, ci.yml dispatch 37406016037의 CI 측정값, +12.4%). 같은 실행의 dmg는 −3.2%, Windows 바이너리는 −0.6%라 배포 크기는 줄었다(cicd.md 76) |
| 2026-10-06 | `tests.worker` | 없음 → 0(`$pending`) | Phase 3 W1: worker/ vitest 통과 수를 새 키로 더했다(느슨하게 하기가 아니다). 첫 master 실행의 `ratchet-measurements-worker`로 `write --from-run`해 채우고 `PENDING_ALLOWED`에서 뺀다 |
| 2026-10-08 | `size.dist_gz` | 57260 → 61297 | Phase 3b A3: 로그인 화면·AuthGate 분기·계정 슬롯·업데이트 배너·copy deck 추가(PR #44 실행 37767092248의 CI 측정값, +7.05%). 로그인 없이는 앱을 쓸 수 없게 하는 화면이다(worker.md 62) |
