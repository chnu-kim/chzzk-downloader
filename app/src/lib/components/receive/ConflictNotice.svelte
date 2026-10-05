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
  <div class="notice warn" role="alert">
    <Icon name="alert" size={16} />
    <span class="text">{t('conflict.inQueue')}</span>
    <Button variant="link" onclick={onshowinlist}>{t('conflict.showInList')}</Button>
  </div>
{/if}

{#if n.exists}
  <div class="notice warn">
    <Icon name="alert" size={16} />
    <span class="text" id="exists-title">{t('conflict.exists')}</span>
    <span class="choices" role="radiogroup" aria-labelledby="exists-title">
      <label><input type="radio" name="existing" value="number" bind:group={choices.existing} />{t('conflict.number')}</label>
      <label><input type="radio" name="existing" value="overwrite" bind:group={choices.existing} />{t('conflict.overwrite')}</label>
    </span>
  </div>
{/if}

{#if n.partialSame != null}
  <div class="notice info">
    <Icon name="info" size={16} />
    <span class="text">
      {#if choices.partialFresh}
        {t('conflict.partial.freshChosen')}
      {:else}
        {t('conflict.partial', { size: formatBytes(n.partialSame) })}
      {/if}
    </span>
    <Button variant="link" aria-pressed={choices.partialFresh} onclick={() => (choices.partialFresh = !choices.partialFresh)}>
      {choices.partialFresh ? t('conflict.partial.continue') : t('conflict.partial.fresh')}
    </Button>
  </div>
{/if}

{#if n.partialOther}
  <div class="notice info">
    <Icon name="info" size={16} />
    <span class="text">{t('conflict.partialOther')}</span>
  </div>
{/if}

<style>
  .notice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-h);
    padding: var(--space-1) var(--space-3);
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
    gap: var(--space-3);
    color: var(--fg);
  }
  .choices label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    cursor: pointer;
  }
  .choices input {
    margin: 0;
    accent-color: var(--accent);
  }
</style>
