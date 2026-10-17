<script lang="ts">
  // Phase 3b A5: 셸이 own·notOwn·unknown을 채운다(system/patterns.md §6.5). 본인 영상이 아니면 danger(막힌 것),
  // 확인하지 못하면 warning(components.md §2.12 tone 기준)이고 둘 다 [받기]를 막는다(`unchecked`·`own`은 그리지 않는다).
  // [받기]의 aria-describedby가 이 id를 가리킨다. 관리자의 `adminOverride`는 info 안내만 그리고 막지 않는다(worker.md 102).
  import type { Ownership } from '../../bindings';
  import { t } from '../../copy/ko';
  import { actionLabel, errorCopy } from '../../copy/errors';
  import { BLOCK_REASON_ID } from '../../receive';
  import { auth } from '../../stores/auth.svelte';
  import { resolver } from '../../stores/resolve.svelte';
  import { whenText } from '../../when';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    ownership: Ownership;
    channelName: string;
    /** 영상의 채널 ID(맡은 채널의 생방송을 가른다). 모르면 null */
    channelId?: string | null;
    /** 카드가 생방송이다 */
    live?: boolean;
    /** 채널 ID를 모르는 영상(adminOverride에서 문구를 나눈다) */
    channelKnown?: boolean;
  }

  let { ownership, channelName, channelId = null, live = false, channelKnown = true }: Props = $props();

  const delegatedCount = $derived(auth.status?.delegatedChannels.length ?? 0);
  // 맡은 채널의 생방송(L-D1): 이미 편집자라 초대 안내와 다시 불러오기는 막다른 길이다
  const delegatedLive = $derived(
    ownership === 'notOwn' &&
      live &&
      !!channelId &&
      (auth.status?.delegatedChannels ?? []).some((d) => d.channelId.toLowerCase() === channelId.toLowerCase()),
  );
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
          { place: 'resolve', channelName, myChannel: auth.status?.channelName ?? undefined, delegatedCount, delegatedLive },
        )
      : null,
  );
  const checkedAt = $derived(auth.status?.delegationsCheckedAt ?? null);
  const failure = $derived(resolver.recheckFailure);
  const failLine = $derived(
    failure == null ? null : failure.code === 'network' ? t('receive.recheck.offline') : errorCopy(failure, { place: 'other' }).title,
  );
  // Notice 안 버튼: [닫기]는 카드 바닥과 겹쳐 그리지 않는다(app.md 구현 중 변경 81 (라))
  const actions = $derived(
    (copy?.actions ?? [])
      .filter((a) => a === 'recheck')
      .map((a) => ({ id: a, label: actionLabel(a), loading: resolver.rechecking, onclick: () => void resolver.recheck() })),
  );
</script>

{#if ownership === 'adminOverride'}
  <!-- 관리자 예외(worker.md 102): 막힘이 아니라 안내다. [받기]의 aria-describedby에는 잇지 않는다 -->
  <Notice variant="inline" tone="info" title={t(channelKnown ? 'receive.admin.otherChannel.title' : 'receive.admin.unknown.title')}>
    {t(channelKnown ? 'receive.admin.otherChannel.body' : 'receive.admin.unknown.body')}
  </Notice>
{:else if copy}
  <Notice variant="inline" tone={ownership === 'notOwn' ? 'danger' : 'warning'} title={copy.title} {actions}>
    <!-- [받기]의 aria-describedby 대상: 제목 + 본문만(버튼·행·마지막 확인 글자가 설명에 섞이지 않게). 숨긴 요소도 설명 계산에 든다 -->
    <span id={BLOCK_REASON_ID.ownership} hidden>{copy.title} {copy.body}</span>
    <p class="line">{copy.body}</p>
    {#each copy.rows as row (row)}<p class="line">{row}</p>{/each}
    {#if failLine}<p class="line">{failLine}</p>{/if}
    {#if ownership === 'notOwn' && !delegatedLive && checkedAt != null}
      <p class="line muted">{t('account.lastSeen', { time: whenText(checkedAt, Date.now()) })}</p>
    {/if}
  </Notice>
{/if}

<style>
  .line {
    margin: 0;
  }
  .muted {
    color: var(--fg-muted);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }
</style>
