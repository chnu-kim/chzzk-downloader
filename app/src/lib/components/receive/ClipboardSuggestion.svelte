<script lang="ts">
  // 창 포커스 때 클립보드의 치지직 주소 제안(ui-visual §6.4). 자동으로 불러오거나 받지 않는다.
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';

  interface Props {
    link: string;
    onload: () => void;
    ondismiss: () => void;
  }

  let { link, onload, ondismiss }: Props = $props();
  const shown = $derived(link.replace(/^https?:\/\//, ''));
</script>

<div class="suggest" role="group" aria-label={t('url.clipboard.title')}>
  <span class="icon"><Icon name="clipboard" size={16} /></span>
  <span class="title">{t('url.clipboard.title')}</span>
  <span class="link" title={link}>{shown}</span>
  <Button variant="link" onclick={onload}>{t('url.clipboard.load')}</Button>
  <IconButton icon="x" label={t('common.close')} onclick={ondismiss} />
</div>

<style>
  .suggest {
    display: flex;
    align-items: center;
    gap: var(--space-8);
    height: var(--control-h);
    margin-top: var(--space-8);
    padding: 0 var(--space-4) 0 var(--space-12);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    font-size: var(--text-sm);
    animation: rise var(--dur-base) var(--ease-out);
  }
  .icon {
    color: var(--fg-muted);
  }
  .title {
    flex: none;
    color: var(--fg);
  }
  .link {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow-wrap: normal;
    color: var(--fg-muted);
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
</style>
