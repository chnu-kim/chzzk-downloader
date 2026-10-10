<script lang="ts">
  // Phase 3b A5: 셸이 own·notOwn·unknown을 채운다(system/patterns.md §6.5). 본인 영상이 아니면 danger(막힌 것),
  // 확인하지 못하면 warning(components.md §2.12 tone 기준)이고 둘 다 [받기]를 막는다(`unchecked`·`own`은 그리지 않는다).
  // [받기]의 aria-describedby가 이 id를 가리킨다. 관리자의 `adminOverride`는 info 안내만 그리고 막지 않는다(worker.md 102).
  import type { Ownership } from '../../bindings';
  import { t } from '../../copy/ko';
  import { errorCopy } from '../../copy/errors';
  import { BLOCK_REASON_ID } from '../../receive';
  import { auth } from '../../stores/auth.svelte';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    ownership: Ownership;
    channelName: string;
    /** 채널 ID를 모르는 영상(adminOverride에서 문구를 나눈다) */
    channelKnown?: boolean;
  }

  let { ownership, channelName, channelKnown = true }: Props = $props();
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

{#if ownership === 'adminOverride'}
  <!-- 관리자 예외(worker.md 102): 막힘이 아니라 안내다. [받기]의 aria-describedby에는 잇지 않는다 -->
  <Notice variant="inline" tone="info" title={t(channelKnown ? 'receive.admin.otherChannel.title' : 'receive.admin.unknown.title')}>
    {t(channelKnown ? 'receive.admin.otherChannel.body' : 'receive.admin.unknown.body')}
  </Notice>
{:else if copy}
  <Notice id={BLOCK_REASON_ID.ownership} variant="inline" tone={ownership === 'notOwn' ? 'danger' : 'warning'} title={copy.title}>
    {copy.body}
  </Notice>
{/if}
