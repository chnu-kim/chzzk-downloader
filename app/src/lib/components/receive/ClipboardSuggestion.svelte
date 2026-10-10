<script lang="ts">
  // 창 포커스 때 클립보드의 치지직 주소 제안(system/patterns.md §7). 자동으로 불러오거나 받지 않는다.
  // Notice 하나: 클립보드 아이콘 · 안내 · 주소(말줄임, 선택 가능) · [불러오기] · [×].
  import { t } from '../../copy/ko';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    link: string;
    onload: () => void;
    ondismiss: () => void;
  }

  let { link, onload, ondismiss }: Props = $props();
  const shown = $derived(link.replace(/^https?:\/\//, ''));
</script>

<div role="group" aria-label={t('url.clipboard.title')}>
  <Notice
    variant="inline"
    tone="neutral"
    icon="clipboard-paste"
    actions={[{ id: 'load', label: t('common.load'), onclick: onload }]}
    onclose={ondismiss}
  >
    <div class="suggest">
      <span class="suggest-title">{t('url.clipboard.title')}</span>
      <span class="suggest-link selectable ellipsis">{shown}</span>
    </div>
  </Notice>
</div>

<style>
  .suggest {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
  }
  .suggest-title {
    flex: none;
  }
  .suggest-link {
    flex: 1;
    color: var(--fg-muted);
  }
</style>
