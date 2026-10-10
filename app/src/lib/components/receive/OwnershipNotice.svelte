<script lang="ts">
  // Phase 3b A5: 셸이 own·notOwn·unknown을 채운다. 본인 영상이 아니거나 확인하지 못하면 알린다(`unchecked`·`own`은 그리지 않는다).
  import type { Ownership } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { auth } from '../../stores/auth.svelte';
  import Notice from '../ui/Notice.svelte';

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
          { place: 'resolve', channelName, myChannel: auth.status?.channelName ?? undefined },
        )
      : null,
  );
</script>

{#if copy}
  <Notice tone="danger" title={copy.title}>{copy.body}</Notice>
{/if}
