<script lang="ts">
  // 홈(S1): 위는 입력 영역, 아래는 다운로드 목록(patterns.md §14.2).
  import JobList from '../components/jobs/JobList.svelte';
  import InputPanel from '../components/receive/InputPanel.svelte';
  import { jobs } from '../stores/jobs.svelte';
</script>

<div class="home">
  <InputPanel onshowjob={(id) => jobs.reveal(id)} />
  <JobList />
</div>

<style>
  .home {
    width: 100%;
    max-width: var(--content-max);
    margin: 0 auto;
    padding: var(--gutter);
  }
  @media (min-width: 840px) {
    .home {
      padding: var(--gutter-wide);
    }
  }
</style>
