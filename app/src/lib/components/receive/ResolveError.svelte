<script lang="ts">
  // 불러오기 실패(S1-c). 문구와 동작은 errorCopy(§9 R 열).
  import type { AppError } from '../../bindings';
  import { actionLabel, errorCopy, type ActionId } from '../../copy/errors';
  import InlineAlert from '../ui/InlineAlert.svelte';
  import Button from '../ui/Button.svelte';

  interface Props {
    error: AppError;
    cookiesEnabled: boolean;
    onaction: (a: ActionId) => void;
  }

  let { error, cookiesEnabled, onaction }: Props = $props();
  const copy = $derived(errorCopy(error, { place: 'resolve', cookiesEnabled }));
</script>

<div class="wrap">
  <InlineAlert tone="danger" title={copy.title}>
    {#if copy.body}<p class="body">{copy.body}</p>{/if}
    {#if copy.detail}<p class="detail">{copy.detail}</p>{/if}
    {#snippet actions()}
      {#each copy.actions as a (a)}
        <Button size="sm" onclick={() => onaction(a)}>{actionLabel(a)}</Button>
      {/each}
    {/snippet}
  </InlineAlert>
</div>

<style>
  .wrap {
    margin-top: var(--space-2);
  }
  .body,
  .detail {
    margin: 0;
  }
  .detail {
    color: var(--fg-muted);
  }
</style>
