<script lang="ts">
  // 홈(S1): 위는 입력 영역, 아래는 다운로드 목록(system/patterns.md §14.1·§14.2).
  // 열(폭·좌우 패딩)은 App이 소유한다(PageContainer) — 이 뷰는 자기 패딩도 폭 미디어 쿼리도 두지 않는다.
  // 입력 영역과 목록 사이 간격 `--space-24`는 목록 쪽 margin으로 둔다: 입력줄이 sticky로 붙는 상자(입력 영역 루트)가
  // display: contents가 되어도 입력 영역의 안쪽 자식 사이에 이 간격이 끼어들지 않게 한다.
  import JobList from '../components/jobs/JobList.svelte';
  import InputPanel from '../components/receive/InputPanel.svelte';
  import { jobs } from '../stores/jobs.svelte';
</script>

<div class="home">
  <InputPanel onshowjob={(id) => jobs.reveal(id)} />
  <div class="list">
    <JobList />
  </div>
</div>

<style>
  .list {
    margin-top: var(--space-24);
  }
</style>
