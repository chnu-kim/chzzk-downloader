# 공개 저장소 만들기

비공개 저장소(PR #11→#12→#13→#14 머지 후 `master`)에서 `git filter-repo`로 이력을 정리해 새 공개 저장소를 만든다. 현재 트리는 이미 공개해도 되는 상태다(합성 fixture, `node scripts/ci/public-scan.mjs` 통과). 정리할 것은 **이력**에 남은 원본이다.

## 준비물

- `git-filter-repo` 2.47 이상(`pip install git-filter-repo`)과 Node 18 이상.
- 치환 규칙 파일 `<비공개 보관소>/filter-repo-replacements.txt`. **원문(실제 이름·ID·토큰)이 들어 있어 저장소에 커밋하지 않는다.** 공개 준비 작업(2026-10-05) 때 만들어 저장소 밖 비공개 보관소에 둔다. 아래 명령은 이 파일을 `../filter-repo-replacements.txt`로 복사해 두었다고 본다.
  - 내용: 실제 채널 이름·채널 ID·영상 번호·영상 ID·클립 ID·inKey·스트림 경로 키·제목·미디어 호스트를 합성 fixture와 같은 가짜 값(`testdata/README.md`)으로 바꾸는 줄, 암호화 키 주소와 AES 조사 줄을 지우는 줄, 그리고 아래의 일반 규칙이다.
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
comm -23 ../hist-blobs.txt ../cur-blobs.txt > ../strip-blob-ids.txt   # 2026-10-05 기준 24개

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
- 그 결과 옛 커밋에서는 fixture 파일이 빠져 테스트가 돌지 않는다. 마지막 커밋만 빌드·테스트 대상이다.
- 태그(`v0.2.0`, `v0.2.1`)도 다시 쓰인다. 공개할지 정해서 push한다.

## 확인

```bash
# 마지막 트리가 비공개 master와 같다(치환 규칙이 현재 파일을 건드리지 않았다)
test "$(git rev-parse HEAD^{tree})" = "$(cat ../private-tree.txt)" && echo same-tree

# 이력 전체 누출 검사: 반드시 종료 코드 0
node scripts/ci/public-scan.mjs --all-history

# 현재 트리 검사와 게이트
node scripts/ci/public-scan.mjs
node --test scripts/ci/public-scan.test.mjs
node scripts/fixtures/gen-fixtures.mjs --check
cargo test --workspace --locked
```

2026-10-05에 `feat/tauri-app`(머지 전 master와 같은 내용)의 클론으로 위 절차를 돌려 `same-tree`와 `--all-history` 종료 코드 0을 확인했다.

통과하면 새 공개 저장소를 원격으로 더해 push한다(`git remote add origin <공개 저장소>`, `git push origin master`). 공개 저장소에서는 CI `public-scan.yml`이 매 push·PR마다 현재 트리와 이력 전체를 검사한다(비공개 저장소에서는 이력 검사를 건너뛴다).

## 이후 규칙

- 검사기는 `node scripts/ci/public-scan.mjs`로 부른다. POSIX는 `scripts/ci/public-scan.sh`, Windows PowerShell은 `scripts/ci/public-scan.ps1` 래퍼도 쓸 수 있다.
- denylist 해시의 salt는 공개 소스에 있으므로, 경우의 수가 적은 항목(8자리 영상 번호, 짧은 채널 이름)은 대입으로 되돌릴 수 있다. 막는 효과는 그대로지만 "목록 자체가 원문을 숨긴다"는 보장은 hex ID·inKey·여러 단어 제목·blob 해시에만 있다.
- 새 실제 값을 막으려면 원문을 커밋하지 말고 해시만 `scripts/ci/public-denylist.txt`에 더한다: `printf '%s\n' '<원문>' | node scripts/ci/public-scan.mjs --hash`.
- fixture는 `scripts/fixtures/gen-fixtures.mjs`로만 바꾼다. 실제 응답을 저장소에 넣지 않는다.
