<script lang="ts">
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import TextField from '../ui/TextField.svelte';

  interface Props {
    value: string;
    suggested: string;
    /** 실제로 저장될 이름이 입력과 다를 때(정리·200바이트 절단) */
    willSaveAs: string | null;
    disabled?: boolean;
  }

  let { value = $bindable(), suggested, willSaveAs, disabled = false }: Props = $props();
</script>

<div class="row">
  <label class="label" for="filename-input">{t('filename.label')}</label>
  <div class="input">
    <TextField id="filename-input" bind:value {disabled} aria-describedby={willSaveAs ? 'filename-will' : undefined} />
    <span class="ext">{t('filename.ext')}</span>
    <Button variant="link" disabled={disabled || value === suggested} onclick={() => (value = suggested)}>
      {t('filename.reset')}
    </Button>
  </div>
</div>
{#if willSaveAs}
  <p id="filename-will" class="will" title={willSaveAs}>{t('filename.willSaveAs', { name: willSaveAs })}</p>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .label {
    flex: none;
    width: 96px;
    color: var(--fg-muted);
  }
  .input {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .ext {
    flex: none;
    color: var(--fg-muted);
  }
  .will {
    margin: var(--space-1) 0 0 calc(96px + var(--space-2));
    font-size: var(--text-xs);
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: normal;
  }
</style>
