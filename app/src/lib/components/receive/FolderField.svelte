<script lang="ts">
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';

  interface Props {
    path: string;
    onchange: () => void;
    disabled?: boolean;
  }

  let { path, onchange, disabled = false }: Props = $props();
</script>

<div class="row">
  <span class="label" id="folder-label">{t('folder.label')}</span>
  <span class="value" title={path} aria-labelledby="folder-label">{path}</span>
  <Button variant="link" {disabled} onclick={onchange}>{t('folder.change')}</Button>
</div>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-h);
  }
  .label {
    flex: none;
    width: 96px;
    color: var(--fg-muted);
  }
  .value {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: normal;
  }
</style>
