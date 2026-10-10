<script lang="ts">
  // 충돌 안내(§6.4·§8.3). 완성 파일 / 같은 작업의 .part / 다른 .part / 목록 중복은 서로 독립이다.
  import type { OutputCheck } from '../../bindings';
  import { t } from '../../copy/ko';
  import { formatBytes } from '../../format/bytes';
  import { notices, type CardChoices } from '../../receive';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';

  interface Props {
    check: OutputCheck;
    choices: CardChoices;
    onshowinlist: () => void;
  }

  let { check, choices = $bindable(), onshowinlist }: Props = $props();
  const n = $derived(notices(check, choices));
</script>

{#if n.duplicate}
  <div class="conflict warn" role="alert">
    <Icon name="triangle-alert" size="sm" />
    <span class="text">{t('conflict.inQueue')}</span>
    <Button variant="ghost" size="sm" onclick={onshowinlist}>{t('conflict.showInList')}</Button>
  </div>
{/if}

{#if n.exists}
  <div class="conflict warn">
    <Icon name="triangle-alert" size="sm" />
    <span class="text" id="exists-title">{t('conflict.exists')}</span>
    <span class="choices" role="radiogroup" aria-labelledby="exists-title">
      <label><input type="radio" name="existing" value="number" bind:group={choices.existing} />{t('conflict.number')}</label>
      <label><input type="radio" name="existing" value="overwrite" bind:group={choices.existing} />{t('conflict.overwrite')}</label>
    </span>
  </div>
{/if}

{#if n.partialSame != null}
  <div class="conflict info">
    <Icon name="info" size="sm" />
    <span class="text">
      {#if choices.partialFresh}
        {t('conflict.partial.freshChosen')}
      {:else}
        {t('conflict.partial', { size: formatBytes(n.partialSame) })}
      {/if}
    </span>
    <Button variant="ghost" size="sm" aria-pressed={choices.partialFresh} onclick={() => (choices.partialFresh = !choices.partialFresh)}>
      {choices.partialFresh ? t('conflict.partial.continue') : t('conflict.partial.fresh')}
    </Button>
  </div>
{/if}

{#if n.partialOther}
  <div class="conflict info">
    <Icon name="info" size="sm" />
    <span class="text">{t('conflict.partialOther')}</span>
  </div>
{/if}

<style>
  .conflict {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-8);
    min-height: var(--control-h);
    padding: var(--space-4) var(--space-12);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }
  .warn {
    background: var(--warning-soft);
    color: var(--warning);
  }
  .info {
    background: var(--accent-soft);
    color: var(--fg);
  }
  .info :global(.icon) {
    color: var(--accent);
  }
  .text {
    flex: 1 1 auto;
    min-width: 0;
  }
  .warn .text {
    font-weight: var(--weight-medium);
  }
  .choices {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-12);
    color: var(--fg);
  }
  .choices label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    cursor: pointer;
  }
  .choices input {
    margin: 0;
    accent-color: var(--accent);
  }
</style>
