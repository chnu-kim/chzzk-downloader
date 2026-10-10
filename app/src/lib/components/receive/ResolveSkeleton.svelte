<script lang="ts">
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import Kbd from '../ui/Kbd.svelte';
  import Skeleton from '../ui/Skeleton.svelte';

  let { oncancel }: { oncancel: () => void } = $props();
</script>

<section class="card" aria-busy="true" aria-label={t('resolve.loading')}>
  <Skeleton width="9rem" height={12} />
  <Skeleton width="70%" height={16} />
  <div class="row">
    <Skeleton width="6rem" height={12} />
    <Skeleton width="10rem" height={12} />
    <Skeleton width="6rem" height={12} />
  </div>
  <div class="foot">
    <span class="msg">{t('resolve.loading')}</span>
    <Button variant="link" onclick={oncancel}>{t('resolve.cancel')}</Button>
    <Kbd>Esc</Kbd>
  </div>
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    margin-top: var(--space-12);
    padding: var(--space-16);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  .row {
    display: flex;
    gap: var(--space-12);
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
