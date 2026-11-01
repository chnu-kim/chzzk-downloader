<script lang="ts">
  // 업데이트 "이번 버전에서 바뀐 점"(D69, system/patterns.md §12). 배너 B4의 Notice `details` 슬롯에 들어가는 접는 목록이다.
  // latest.json의 notes는 서명되지 않으므로 줄·길이를 다시 막고(`updateNoteLines`) 텍스트 노드로만 그린다: HTML·마크다운은 해석하지 않는다.
  // 방향이 섞인 글이 목록을 흩뜨리지 않게 줄마다 `<bdi>`로 감싼다. 남은 줄이 없으면 접는 줄 자체를 그리지 않는다.
  import { t } from '../../copy/ko';
  import { updateNoteLines } from '../../format/display';
  import Disclosure from '../ui/Disclosure.svelte';

  interface Props {
    notes: string | null;
  }

  let { notes }: Props = $props();

  const lines = $derived(updateNoteLines(notes));
</script>

{#if lines.length > 0}
  <Disclosure variant="inline" title={t('update.notes.title')}>
    <ul class="update-notes">
      {#each lines as line, i (i)}
        <li><bdi>{line}</bdi></li>
      {/each}
    </ul>
  </Disclosure>
{/if}

<style>
  /* 기본 글머리표를 그대로 쓴다(forced-colors에서도 남는다). 토큰만 쓴다 */
  .update-notes {
    margin: 0;
    padding-inline-start: var(--space-16);
    color: var(--fg);
  }
  .update-notes > li + li {
    margin-top: var(--space-4);
  }
</style>
