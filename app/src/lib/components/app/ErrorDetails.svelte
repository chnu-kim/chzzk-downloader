<script lang="ts">
  // 오류 L1 "자세히"(README D51, system/patterns.md §10.1, components.md §2.14 ②). Notice `details` 슬롯에 들어간다:
  // 라이브 영역(.notice-text) 밖이라 L0만 낭독되고, 펼쳐도 다시 읽히지 않는다. 원문은 선택할 수 있게 둔다.
  import { t } from '../../copy/ko';
  import Disclosure from '../ui/Disclosure.svelte';

  interface Props {
    detail: string;
  }

  let { detail }: Props = $props();
</script>

<Disclosure variant="inline" title={t('common.details')}>
  <p class="error-detail selectable"><bdi>{detail}</bdi></p>
</Disclosure>

<style>
  /* 원문·코드 줄: mono caption, 여러 줄(`\n`)은 줄을 바꾼다. 토큰만 쓴다 */
  .error-detail {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
</style>
