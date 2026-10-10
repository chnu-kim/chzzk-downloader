<script lang="ts">
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import Kbd from '../ui/Kbd.svelte';
  import Skeleton from '../ui/Skeleton.svelte';

  let { oncancel }: { oncancel: () => void } = $props();
</script>

<section class="skel-card" aria-busy="true" aria-label={t('resolve.loading')}>
  <Skeleton variant="line" width="half" />
  <Skeleton variant="title" />
  <Skeleton variant="line" width="half" />
  <div class="foot">
    <span class="msg">{t('resolve.loading')}</span>
    <Button variant="ghost" size="sm" onclick={oncancel}>{t('resolve.cancel')}</Button>
    <Kbd>Esc</Kbd>
  </div>
</section>

<style>
  .skel-card {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    margin-top: var(--space-12);
    padding: var(--space-16);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-4);
  }
  .msg {
    flex: 1;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
</style>
