<script lang="ts">
  // Phase 3b A5: 셸이 own·notOwn·unknown을 채운다(system/patterns.md §6.5). 본인 영상이 아니면 danger(막힌 것),
  // 확인하지 못하면 warning(components.md §2.12 tone 기준)이고 둘 다 [받기]를 막는다(`unchecked`·`own`은 그리지 않는다).
  // [받기]의 aria-describedby가 이 id를 가리킨다.
  import type { Ownership } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { BLOCK_REASON_ID } from '../../receive';
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
  <Notice id={BLOCK_REASON_ID.ownership} variant="inline" tone={ownership === 'notOwn' ? 'danger' : 'warning'} title={copy.title}>
    {copy.body}
  </Notice>
{/if}
