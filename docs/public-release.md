# 공개 저장소 만들기

비공개 저장소(PR #11→#12→#13→#14 머지 후 `master`)에서 `git filter-repo`로 이력을 정리해 새 공개 저장소를 만든다. 현재 트리는 이미 공개해도 되는 상태다(합성 fixture, `node scripts/ci/public-scan.mjs` 통과). 정리할 것은 **이력**에 남은 원본이다.

## 준비물

- `git-filter-repo` 2.47 이상(`pip install git-filter-repo`)과 Node 18 이상.
- 저장소 밖 비공개 보관소의 파일 세 개. **원문(실제 이름·ID·토큰·개인 이메일)이나 대입으로 되돌릴 수 있는 해시가 들어 있어 저장소에 커밋하지 않는다.** 아래 명령은 이 파일들을 `../`에 복사해 두었다고 본다.
  - `filter-repo-replacements.txt`: 실제 채널 이름·채널 ID·영상 번호·영상 ID·클립 ID·inKey·스트림 경로 키·제목·미디어 호스트·비공개 형제 프로젝트 이름, 옛 테스트에 남았던 실제 시각·길이·세그먼트 이름, 옛 문서의 로컬 임시 경로를 합성 fixture와 같은 가짜 값(`testdata/README.md`)으로 바꾸는 줄, 암호화 키 주소와 AES 조사 줄을 지우는 줄, 그리고 아래의 일반 규칙이다.
  - `private-denylist.txt`: 위 원문들(채널 이름·영상 번호·클립 ID·제목 구절·미디어 호스트·세그먼트 번호·태그 등)의 해시. `printf '%s\n' '<원문>' | node scripts/ci/public-scan.mjs --hash`로 만든다. 공개 `scripts/ci/public-denylist.txt`에는 되돌릴 수 없는 `blob:` 해시만 둔다(salt가 공개돼 있어 짧은 원문의 해시는 사전 대입으로 풀린다).
  - `mailmap.txt`: 옛 커밋의 개인 이메일을 GitHub noreply 주소로 바꾸는 한 줄. `chnu-kim <114627259+chnu-kim@users.noreply.github.com> <개인 이메일>` 모양이다.
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
  --replace-message ../filter-repo-replacements.txt \
  --mailmap ../mailmap.txt
```

- 지우는 경로: 위 `--path` 다섯 개(조사 기록, 디코드한 재생 정보, 원본 출처를 적은 README)와, `--strip-blobs-with-ids`로 옛 실물 fixture의 모든 버전(`testdata/{hls,vod,clip,synthetic}/`, Go 시절 `internal/api/testdata/`). 합성 fixture는 blob이 달라 남는다.
- 옛 `scripts/ci/public-denylist.txt` 버전도 같은 방법으로 지운다. 그 파일이 처음 생긴 커밋에서는 파일이 빠진다.
- `--mailmap`이 모든 커밋의 작성자·커미터 이메일을 noreply 주소로 바꾼다.
- 그 결과 옛 커밋에서는 fixture 파일이 빠져 테스트가 돌지 않는다. 마지막 커밋만 빌드·테스트 대상이다.
- 태그(`v0.2.0`, `v0.2.1`)도 다시 쓰인다. 공개할지 정해서 push한다.

## 확인

```bash
# 마지막 트리가 비공개 master와 같다(치환 규칙이 현재 파일을 건드리지 않았다)
test "$(git rev-parse HEAD^{tree})" = "$(cat ../private-tree.txt)" && echo same-tree

# 이력 전체 누출 검사(비공개 denylist 포함): 반드시 종료 코드 0
node scripts/ci/public-scan.mjs --all-history --denylist ../private-denylist.txt

# 작성자·커미터는 noreply 주소뿐이다(--all-history도 identity 규칙으로 본다)
git log --all --format='%ae%n%ce' | sort -u

# 옛 denylist 버전이 남지 않았다: 출력이 없어야 한다
git log --all -p -- scripts/ci/public-denylist.txt | grep -E '^\+[0-9a-f]{64}$'

# 현재 트리 검사와 게이트
node scripts/ci/public-scan.mjs
node --test scripts/ci/public-scan.test.mjs
node scripts/fixtures/gen-fixtures.mjs --check
cargo test --workspace --locked
```

2026-10-05에 `feat/tauri-app`(머지 전 master와 같은 내용)의 클론으로 위 절차를 돌려 `same-tree`, noreply 이메일만 남음, 옛 denylist 해시 없음, `--all-history --denylist` 종료 코드 0을 확인했다. 비공개 파일을 고쳤거나 master에 커밋이 더 쌓였으면 다시 돌린다.

통과하면 새 공개 저장소를 원격으로 더해 push한다(`git remote add origin <공개 저장소>`, `git push origin master`). 공개 저장소에서는 CI `public-scan.yml`이 매 push·PR마다 현재 트리와 이력 전체를 검사한다(비공개 저장소에서는 이력 검사를 건너뛴다).

## 이후 규칙

- 검사기는 `node scripts/ci/public-scan.mjs`로 부른다. POSIX는 `scripts/ci/public-scan.sh`, Windows PowerShell은 `scripts/ci/public-scan.ps1` 래퍼도 쓸 수 있다.
- 커밋 전 검사(선택): `git config core.hooksPath .githooks`로 `.githooks/pre-commit`을 켠다. 작업 트리가 아니라 **인덱스**(커밋될 내용)를 `--staged`로 본다. 비공개 denylist도 쓰려면 `PUBLIC_SCAN_DENYLIST=<파일>`을 환경에 둔다.
- 공개 denylist(`scripts/ci/public-denylist.txt`)에는 `blob:` 해시만 둔다. 채널 이름·영상 번호·클립 ID처럼 경우의 수가 적은 값은 salt가 공개된 해시로는 숨겨지지 않으므로, 막아야 하면 **비공개** denylist에 해시를 더하고 `--denylist <파일>`이나 `PUBLIC_SCAN_DENYLIST`로 넘긴다: `printf '%s\n' '<원문>' | node scripts/ci/public-scan.mjs --hash >> <비공개 denylist>`. 4토큰을 넘는 원문(제목)은 연속 4토큰 창마다 항목이 생긴다. 더 짧은 중간 구절을 막으려면 그 구절을 따로 넣는다.
- `--all-history`는 작성자·커미터·태거 이메일이 noreply 주소(`*@users.noreply.github.com`, `noreply@github.com`, `noreply@anthropic.com`)인지도 본다. 커밋은 noreply 주소로 한다.
- fixture는 `scripts/fixtures/gen-fixtures.mjs`로만 바꾼다. 실제 응답을 저장소에 넣지 않는다. 시각·길이·비트레이트도 실제 값을 옮기지 않고 둥근 가짜 값을 쓴다.

### 검사기의 한계

- 규칙은 **모양**만 본다(서명 토큰, hmac, 키 주소, 쿠키, 32·36자리 hex, 대시 UUID, inKey, 키 이름 뒤 40자리 이상 hex). 새로 생긴 실제 영상 번호·클립 ID·채널 이름은 모양으로 구별되지 않아, 비공개 denylist에 넣기 전에는 잡히지 않는다.
- 키 이름 없이 홀로 있는 40·64자리 hex(git rev, 잠금 파일 체크섬과 구별할 수 없다)는 보지 않는다.
- NUL이 든 파일은 UTF-16 해석과 6바이트 이상 글자 조각만 본다. 압축된 상자(zlib 등) 안의 글자는 보지 않는다. base64는 한 겹만 푼다.
