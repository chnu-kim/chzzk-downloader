<script lang="ts">
  // Phase 3 자리(§12): 본인 영상이 아니거나 확인하지 못하면 알린다. Phase 2는 늘 `unchecked`라 그리지 않는다.
  import type { Ownership } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import InlineAlert from '../ui/InlineAlert.svelte';

  interface Props {
    ownership: Ownership;
    channelName: string;
  }

  let { ownership, channelName }: Props = $props();
  const copy = $derived(
    ownership === 'notOwn' || ownership === 'unknown'
      ? errorCopy(
          {
            code: ownership === 'notOwn' ? 'notOwnContent' : 'ownershipUnknown',
            message: '',
            stage: null,
            resumable: false,
            payload: null,
          },
          { place: 'resolve', channelName },
        )
      : null,
  );
</script>

{#if copy}
  <InlineAlert tone="danger" title={copy.title}>{copy.body}</InlineAlert>
{/if}
