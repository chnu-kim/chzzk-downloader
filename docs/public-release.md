# 공개 저장소 만들기

비공개 저장소(PR #11→#12→#13→#14 머지 후 `master`)에서 `git filter-repo`로 이력을 정리해 새 공개 저장소를 만든다. 현재 트리는 이미 공개해도 되는 상태다(합성 fixture, `node scripts/ci/public-scan.mjs` 통과). 정리할 것은 **이력**에 남은 원본이다.

## 준비물

- `git-filter-repo` 2.47 이상(`pip install git-filter-repo`)과 Node 18 이상.
- 저장소 밖 비공개 보관소의 파일 세 개. **원문(실제 이름·ID·토큰)이나 대입으로 되돌릴 수 있는 해시가 들어 있어 저장소에 커밋하지 않는다.** 아래 명령은 이 파일들을 `../`에 복사해 두었다고 본다.
  - `filter-repo-replacements.txt`: 실제 채널 이름·채널 ID·영상 번호·영상 ID·클립 ID·inKey·스트림 경로 키·제목·미디어 호스트·비공개 형제 프로젝트 이름, 옛 테스트에 남았던 실제 시각·길이·세그먼트 이름, 옛 문서의 로컬 임시 경로를 합성 fixture와 같은 가짜 값(`testdata/README.md`)으로 바꾸는 줄, 암호화 키 주소와 AES 조사 줄을 지우는 줄, 그리고 아래의 일반 규칙이다. 원문은 fixture 밖에도 있었으므로 아래 "원문 집합"으로 빠짐없이 채운다.
  - 원문 집합(2026-10-05에 이력 전체 blob을 뽑아 대조한 결과). fixture·삭제 경로 **밖**의 옛 blob에 남아 있어 `--replace-text`로만 지워지는 것들이다:
    - 영상 번호: 설계 문서 "구현 중 변경"의 스모크 기록(`docs/design/core.md` 5개, `docs/spec/core-behavior.md` 3개), 옛 코어 테스트·`model.rs`·`crates/shell/tests/secrets.rs`의 fixture 영상 번호 2개, OAuth 조사의 영상 번호 1개. 재생 정보의 `liveId`·`streamSeq`(8자리)도 영상 번호와 같이 다룬다.
    - 32자리 채널 ID 10개(`info.rs`·`ownership.rs`·spec·OAuth 조사), 36자리 영상 ID 4개, 클립 ID 4개(`url.rs`·`clip_test.go`·OAuth 조사 포함), inKey 3개(`V1…` 모양, `info.rs`·`resolve.rs`), hmac 64자리와 그 앞부분 조각(`hls.rs`·`core.md` 인용), `st=`/`exp=` 시각, 스트림 경로 키(30자리), 세그먼트 이름(`144p_…_…`).
    - 채널 이름 3개와 제목 4개(`naming.rs`·`info.rs`·`resolve.rs`·spec·`core.md`), 미디어·CDN 호스트 6개(비공개 원문 목록에만 적는다)와 썸네일 URL의 base64 경로 조각, 형제 프로젝트 이름(`chzzk-oauth.md`·`ROADMAP.md`), 암호화 키 주소(`core.md`·spec).
    - 작성자 이메일 `chanuuuu@naver.com`은 공개 이력에 그대로 두기로 했다. 검사기·테스트(`scripts/ci/`)에도 이 주소가 있으므로 치환 파일과 원문 목록에 넣지 않는다(넣으면 현재 트리가 바뀌어 `same-tree`와 원문 대조가 실패한다).
    - 치환 파일을 만든 뒤에는 아래 "확인"의 원문 대조 명령으로 이력에서 한 번 더 찾는다.
  - `private-denylist.txt`: 위 원문들(채널 이름·영상 번호·클립 ID·제목 구절·미디어 호스트·세그먼트 번호·태그 등)의 해시. `printf '%s\n' '<원문>' | node scripts/ci/public-scan.mjs --hash`로 만든다. 공개 `scripts/ci/public-denylist.txt`에는 되돌릴 수 없는 `blob:` 해시만 둔다(salt가 공개돼 있어 짧은 원문의 해시는 사전 대입으로 풀린다).
  - `private-values.txt`: 치환 파일의 왼쪽 값(원문)만 한 줄에 하나씩 모은 목록. 아래 "확인"의 원문 대조에 쓴다.
  - 원문이 없는 일반 규칙(그대로 옮겨 둔다):

    ```
    regex:hmac=[0-9a-f]{4,}==>hmac=0000
    regex:hmac%3D[0-9a-f]{4,}==>hmac%3D0000
    regex:\b(exp|st)=1[0-9]{9}\b==>\1=0
    regex:exp%3D1[0-9]{9}==>exp%3D0
    regex:_lsu_sa_=[0-9a-f]{16,}==>_lsu_sa_=0000
    ```

## 절차

```bash
# 1. 새로 클론한다(filter-repo는 새 클론에서만 돈다). master 하나만 가져간다.
git clone --no-local --single-branch --branch master <비공개 저장소> chzzk-public
cd chzzk-public
git rev-parse HEAD^{tree} > ../private-tree.txt

# 2. 옛 실물 fixture blob 목록: testdata/·internal/api/testdata/에 있었던 모든 blob 중 지금 HEAD에 없는 것
git log --all --format=%H -- testdata internal/api/testdata \
  | while read c; do git ls-tree -r "$c" -- testdata internal/api/testdata; done \
  | awk '{print $3}' | sort -u > ../hist-blobs.txt
git ls-tree -r HEAD -- testdata | awk '{print $3}' | sort -u > ../cur-blobs.txt
comm -23 ../hist-blobs.txt ../cur-blobs.txt > ../strip-blob-ids.txt   # 2026-10-05(fixture 재생성 뒤) 기준 34개

# 2-1. 옛 denylist(대입으로 되돌릴 수 있는 해시가 들었던 버전): 지금 HEAD의 것만 남긴다
git log --all --format=%H -- scripts/ci/public-denylist.txt \
  | while read c; do git ls-tree "$c" -- scripts/ci/public-denylist.txt; done \
  | awk '{print $3}' | sort -u | grep -vx "$(git rev-parse HEAD:scripts/ci/public-denylist.txt)" \
  >> ../strip-blob-ids.txt

# 3. 이력 정리
git filter-repo \
  --invert-paths \
    --path docs/research/hls-live-rewind.md \
    --path testdata/hls/live_rewind_playback.decoded.json \
    --path testdata/hls/README.md \
    --path testdata/vod/README.md \
    --path testdata/synthetic/README.md \
  --strip-blobs-with-ids ../strip-blob-ids.txt \
  --replace-text ../filter-repo-replacements.txt \
  --replace-message ../filter-repo-replacements.txt
```

- 지우는 경로: 위 `--path` 다섯 개(조사 기록, 디코드한 재생 정보, 원본 출처를 적은 README)와, `--strip-blobs-with-ids`로 옛 실물 fixture의 모든 버전(`testdata/{hls,vod,clip,synthetic}/`, Go 시절 `internal/api/testdata/`). 합성 fixture는 blob이 달라 남는다.
- 옛 `scripts/ci/public-denylist.txt` 버전도 같은 방법으로 지운다. 그 파일이 처음 생긴 커밋에서는 파일이 빠진다.
- 작성자·커미터 이메일은 다시 쓰지 않는다(`--mailmap`을 쓰지 않는다). `chanuuuu@naver.com`과 noreply 주소가 그대로 남는다.
- 그 결과 옛 커밋에서는 fixture 파일이 빠져 테스트가 돌지 않는다. 마지막 커밋만 빌드·테스트 대상이다.
- 태그(`v0.2.0`, `v0.2.1`)는 master의 조상이라 `--single-branch` 클론에도 따라오고, 다시 쓰인다. 공개할지 정해서 push한다.
- `LICENSE`는 옛 커밋("remove docs")에서 지워져 지금 트리에 없다. 공개 저장소에 둘 라이선스를 정해 push 전에 더한다.

## 확인

```bash
# 마지막 트리가 비공개 master와 같다(치환 규칙이 현재 파일을 건드리지 않았다)
test "$(git rev-parse HEAD^{tree})" = "$(cat ../private-tree.txt)" && echo same-tree

# 이력 전체 누출 검사(비공개 denylist 포함): 반드시 종료 코드 0
node scripts/ci/public-scan.mjs --all-history --denylist ../private-denylist.txt

# 작성자·커미터는 허용 목록(noreply 주소, chanuuuu@naver.com)뿐이다(--all-history도 identity 규칙으로 본다)
git log --all --format='%ae%n%ce' | sort -u

# 옛 denylist 버전이 남지 않았다: 출력이 없어야 한다
git log --all -p -- scripts/ci/public-denylist.txt | grep -E '^\+[0-9a-f]{64}$'

# 원문 대조: 비공개 원문 목록(한 줄에 하나, 치환 파일의 왼쪽 값)을 이력 전체 blob에서 찾는다. 출력이 없어야 한다
git rev-list --objects --all | awk 'NF==2{print $1}' | sort -u \
  | while read h; do [ "$(git cat-file -t "$h")" = blob ] && git cat-file -p "$h" | LC_ALL=C grep -F -q -f ../private-values.txt && echo "남음: $h"; done
git log --all --format='%H %s%n%b' | LC_ALL=C grep -F -f ../private-values.txt

# 현재 트리 검사와 게이트
node scripts/ci/public-scan.mjs
node --test scripts/ci/public-scan.test.mjs
node scripts/fixtures/gen-fixtures.mjs --check
cargo test --workspace --locked
```

2026-10-05에 `feat/tauri-app`(머지 전 master와 같은 내용)의 클론으로 위 절차를 돌려 `same-tree`, 허용 목록 밖 이메일 없음, 옛 denylist 해시 없음, `--all-history --denylist` 종료 코드 0을 확인했다. 비공개 파일을 고쳤거나 master에 커밋이 더 쌓였으면 다시 돌린다.

통과하면 새 공개 저장소를 원격으로 더해 push한다(`git remote add origin <공개 저장소>`, `git push origin master`). 공개 저장소에서는 CI `ci.yml`의 `lint` 작업이 매 push·PR마다 현재 트리(`run.mjs scan`)와 이력 전체(`run.mjs scan-history`, CI의 새 클론에서만)를 검사한다(2026-10-05 이전에는 `public-scan.yml`이었다).

## 이후 규칙

- 검사기는 `node scripts/ci/public-scan.mjs`로 부른다. POSIX는 `scripts/ci/public-scan.sh`, Windows PowerShell은 `scripts/ci/public-scan.ps1` 래퍼도 쓸 수 있다.
- 커밋 전 검사(선택): `git config core.hooksPath .githooks`로 `.githooks/pre-commit`을 켠다. 작업 트리가 아니라 **인덱스**(커밋될 내용)를 본다(`node scripts/ci/run.mjs scan-staged` = `public-scan.mjs --staged`). 비공개 denylist도 쓰려면 `PUBLIC_SCAN_DENYLIST=<파일>`을 환경에 둔다.
- 공개 denylist(`scripts/ci/public-denylist.txt`)에는 `blob:` 해시만 둔다. 채널 이름·영상 번호·클립 ID처럼 경우의 수가 적은 값은 salt가 공개된 해시로는 숨겨지지 않으므로, 막아야 하면 **비공개** denylist에 해시를 더하고 `--denylist <파일>`이나 `PUBLIC_SCAN_DENYLIST`로 넘긴다: `printf '%s\n' '<원문>' | node scripts/ci/public-scan.mjs --hash >> <비공개 denylist>`. 4토큰을 넘는 원문(제목)은 연속 4토큰 창마다 항목이 생긴다. 더 짧은 중간 구절을 막으려면 그 구절을 따로 넣는다.
- `--all-history`는 작성자·커미터·태거 이메일이 허용 목록에 있는지도 본다: noreply 주소(`*@users.noreply.github.com`, `noreply@github.com`, `noreply@anthropic.com`, GitHub 봇의 `…[bot]@users.noreply.github.com` 포함)와, 공개하기로 한 작성자 이메일 `chanuuuu@naver.com`. 그 밖의 주소(회사 이메일 등)는 잡는다. 외부 기여자의 PR도 개인 이메일로 커밋했으면 공개 CI가 실패하므로, noreply 주소로 다시 커밋하게 한다.
- fixture는 `scripts/fixtures/gen-fixtures.mjs`로만 바꾼다. 실제 응답을 저장소에 넣지 않는다. 시각·길이·비트레이트도 실제 값을 옮기지 않고 둥근 가짜 값을 쓴다.

### 검사기의 한계

- 규칙은 **모양**만 본다(서명 토큰, hmac, 키 주소, 쿠키, 32·36자리 hex, 대시 UUID, inKey, 키 이름 뒤 40자리 이상 hex). 새로 생긴 실제 영상 번호·클립 ID·채널 이름은 모양으로 구별되지 않아, 비공개 denylist에 넣기 전에는 잡히지 않는다.
- 키 이름 없이 홀로 있는 40·64자리 hex(git rev, 잠금 파일 체크섬과 구별할 수 없다)는 보지 않는다.
- NUL이 든 파일은 UTF-16 해석과 6바이트 이상 글자 조각만 본다. 압축된 상자(zlib 등) 안의 글자는 보지 않는다. base64는 한 겹만 푼다.
