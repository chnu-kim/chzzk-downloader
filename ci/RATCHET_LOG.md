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
| 2026-10-08 | `size.binary.linux` | 32559632 → 33581280 | Phase 3b A4: 업데이트 확인·설치 command와 설치 흐름(updater 플러그인 호출·quit 연동·진행 이벤트) 추가(PR #45 실행 37777649961의 CI 측정값, +3.14%). 서명된 업데이트로 옛 앱을 고치는 경로다(worker.md 67~) |
| 2026-10-08 | `size.bundle.linux-deb` | 9728508 → 10046698 | Phase 3b A3~A5 누적: 로그인 화면·업데이트 흐름·OwnershipGate(PR #46 실행 37791581034의 CI 측정값, +3.27%). 본인 영상만 받게 하는 게이트와 그 화면이다(worker.md 82~86) |
| 2026-10-08 | `size.dist_gz` | 61297 → 63384 | Phase 3b A4~A5 누적: 업데이트 배너·대화상자·막힌 작업 안내·OwnershipNotice(PR #46 실행 37791581034의 CI 측정값, +3.40%). 리뷰 반영 뒤 로컬 측정(같은 `gzipTotal`, level 9)은 63068로 이 값 아래다 |
| 2026-10-09 | `size.binary.darwin` | 22824784 → 23809376 | Phase 3b A3~A5 누적(로그인 화면·updater command·OwnershipGate, master A5 머지 실행 37797077630의 CI 측정값, +4.3%). macOS·Windows 번들은 master push·dispatch에서만 돌아 PR에서 드러나지 않았다 |
| 2026-10-09 | `size.bundle.darwin-dmg` | 7444649 → 7748531 | Phase 3b A3~A5 누적(로그인 화면·updater command·OwnershipGate, master A5 머지 실행 37797077630의 CI 측정값, +4.1%). macOS·Windows 번들은 master push·dispatch에서만 돌아 PR에서 드러나지 않았다 |
| 2026-10-09 | `size.binary.windows` | 19563008 → 20665344 | Phase 3b A3~A5 누적(로그인 화면·updater command·OwnershipGate, master A5 머지 실행 37797077630의 CI 측정값, +5.6%). macOS·Windows 번들은 master push·dispatch에서만 돌아 PR에서 드러나지 않았다 |
| 2026-10-09 | `size.bundle.windows-msi` | 6995968 → 7319552 | Phase 3b A3~A5 누적(로그인 화면·updater command·OwnershipGate, master A5 머지 실행 37797077630의 CI 측정값, +4.6%). macOS·Windows 번들은 master push·dispatch에서만 돌아 PR에서 드러나지 않았다 |
| 2026-10-09 | `size.bundle.windows-setup` | 4699475 → 4945876 | Phase 3b A3~A5 누적(로그인 화면·updater command·OwnershipGate, master A5 머지 실행 37797077630의 CI 측정값, +5.2%). macOS·Windows 번들은 master push·dispatch에서만 돌아 PR에서 드러나지 않았다 |
| 2026-10-10 | `tests.vitest` | 491 → 425 | 디자인 시스템 단계 (a): `app/src/styles/tokens.test.ts`(66개: 대비 31쌍 × 라이트·다크 + 다크 블록·움직임·글꼴 4개)를 지웠다. 같은 검사는 `design-tokens` gate(DT8·DT10·DT11·DT12, Worker 생성물까지)로 옮겼고 그 스크립트의 테스트는 `scripts/design/*.test.mjs`(node --test, `scripts-test` gate)가 센다(governance.md §2.2) |
| 2026-10-10 | `size.dist_gz` | 63384 → 67349 | 디자인 시스템 단계 (b): `ui/` 기본 컴포넌트 전면 교체(Notice·Surface·SettingsRow·FieldRow·EmptyState·Toolbar·Menu 등)와 전역 `ui.css`(옛 컴포넌트별 `<style>` 제거분을 상쇄하고도 +6.3%). 로컬 측정(같은 `gzipTotal`, level 9)이고 CI 측정값으로 조일 수 있다. 갤러리는 `CHZZK_GALLERY=1`일 때만 dist에 들어가 이 수에 없다 |
| 2026-10-10 | `size.dist_gz` | 67349 → 70690 | 디자인 시스템 단계 (c): 기능 화면 전면 재구성(홈 입력·최근 영상·영상 카드·작업 행 상태 어휘·완료 그룹 접힘·설정 보기/계정/고급·로그인·대화상자 D4·D7·지연 삭제 토스트)와 `layout.css`·`useDelayedLoading`, copy deck 키 추가분(+5.0%). 로컬 측정(같은 `gzipTotal`, level 9)이고 CI 측정값으로 조일 수 있다. legacy 별칭 절 삭제(−43줄)와 지역 `<style>` 걷어 냄을 상쇄하고도 늘었다 |
| 2026-10-10 | `size.dist_gz` | 70690 → 73316 | 디자인 시스템 단계 (d): governance §10 copy deck 전면 개정·errors L0/L1 문구·format(시간·크기·속도 서식)을 앱 번들에 넣어 +3.7%. 번들은 단일 JS 청크라 문구 확대가 그대로 늘린다(중복·골든 혼입 없음 확인). CI 측정값(실행 38042169210)이다 |
| 2026-10-10 | `size.binary.linux` | 33581280 → 34816368 | 디자인 시스템 단계 (f)(governance §10 (f) ratchet 칸): window-state 2.4.1·keepawake·windows/webview2-com 크레이트와 프런트 연결 대기·잠자기 방지·미달 엔진·메뉴·가드 코드(PR #72 실행 38061272721의 CI 측정값, +3.68%) |
| 2026-10-10 | `size.bundle.linux-deb` | 10046698 → 10383998 | 디자인 시스템 단계 (f)(governance §10 (f) ratchet 칸): 같은 증가분(window-state·keepawake 등)이 deb에 반영됨(실행 38061272721의 CI 측정값, +3.36%) |
| 2026-10-10 | `size.dist_gz` | 73316 → 76248 | 디자인 시스템 단계 (f)(governance §10 (f) ratchet 칸): 프런트 연결 대기·잠자기 방지·미달 엔진 안내·메뉴·가드 화면과 copy deck 문구(단일 JS 청크, 테스트 데이터·중복 혼입 없음 확인, 실행 38061272721의 CI 측정값, +4.00%) |
| 2026-10-11 | `size.binary.windows` | 20665344 → 21329920 | 디자인 시스템 단계 (f)(governance §10 (f) ratchet 칸): window-state·keepawake·windows/webview2-com 크레이트와 WebView2 보강. Windows 번들은 PR에서 돌지 않아 master 실행 38087544439의 CI 측정값(+3.22%)으로 올린다 |
| 2026-10-11 | `size.bundle.windows-msi` | 7319552 → 7540736 | 같은 증가분이 msi에 반영됨(master 실행 38087544439의 CI 측정값, +3.02%) |
