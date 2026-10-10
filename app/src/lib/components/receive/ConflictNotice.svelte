<script lang="ts">
  // 카드 안 충돌 안내(system/patterns.md §6.5). 완성 파일 / 같은 작업의 .part / 다른 .part / 목록 중복은 서로 독립이다.
  // 모두 Notice 하나씩이고 선택은 RadioGroup이다. 목록 중복은 [받기]를 막으므로 id(BLOCK_REASON_ID)로 사유를 잇는다.
  import type { OutputCheck } from '../../bindings';
  import { t } from '../../copy/ko';
  import { formatBytes } from '../../format/bytes';
  import { BLOCK_REASON_ID, notices, type CardChoices, type ExistingChoice } from '../../receive';
  import Notice from '../ui/Notice.svelte';
  import RadioGroup from '../ui/RadioGroup.svelte';

  interface Props {
    check: OutputCheck;
    choices: CardChoices;
    onshowinlist: () => void;
  }

  let { check, choices = $bindable(), onshowinlist }: Props = $props();
  const n = $derived(notices(check, choices));

  const existingOptions: { id: string; value: ExistingChoice; label: string }[] = [
    { id: 'number', value: 'number', label: t('conflict.number') },
    { id: 'overwrite', value: 'overwrite', label: t('conflict.overwrite') },
  ];
</script>

{#if n.duplicate}
  <Notice
    id={BLOCK_REASON_ID.duplicate}
    variant="inline"
    tone="neutral"
    actions={[{ id: 'show', label: t('conflict.showInList'), onclick: onshowinlist }]}
  >
    {t('conflict.inQueue')}
  </Notice>
{/if}

{#if n.exists}
  <Notice variant="inline" tone="warning">
    <p id="exists-title" class="line">{t('conflict.exists')}</p>
    <RadioGroup name="existing" labelledby="exists-title" options={existingOptions} bind:value={choices.existing} />
  </Notice>
{/if}

{#if n.partialSame != null}
  <Notice
    variant="inline"
    tone="neutral"
    title={t('conflict.partial.title')}
    actions={[
      {
        id: 'fresh',
        label: choices.partialFresh ? t('conflict.partial.continue') : t('conflict.partial.fresh'),
        onclick: () => (choices.partialFresh = !choices.partialFresh),
      },
    ]}
  >
    {choices.partialFresh ? t('conflict.partial.freshChosen') : t('conflict.partial.body', { size: formatBytes(n.partialSame) })}
  </Notice>
{/if}

{#if n.partialOther}
  <Notice variant="inline" tone="neutral">{t('conflict.partialOther')}</Notice>
{/if}

<style>
  .line {
    margin: 0;
  }
</style>
