<script lang="ts">
  // 끌어 놓기 안내(표시만, docs/design/system/components.md §2.27). 끌기 이벤트 처리는 사용처가 한다.
  import { t } from '../../copy/ko';
  import Icon from './Icon.svelte';

  interface Props {
    open: boolean;
  }

  let { open }: Props = $props();
</script>

{#if open}
  <div class="drop-overlay">
    <div class="drop-label"><Icon name="download" /> <span>{t('url.dropHere')}</span></div>
  </div>
{/if}
