<script lang="ts">
  // 불러오기 실패(S1-c). 문구와 동작은 errorCopy(§9 R 열). 알림은 Notice 하나(components.md §2.12).
  import type { AppError } from '../../bindings';
  import { actionLabel, errorCopy, type ActionId } from '../../copy/errors';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    error: AppError;
    cookiesEnabled: boolean;
    onaction: (a: ActionId) => void;
  }

  let { error, cookiesEnabled, onaction }: Props = $props();
  const copy = $derived(errorCopy(error, { place: 'resolve', cookiesEnabled }));
  const actions = $derived(
    copy.actions.map((a) => ({ id: a, label: actionLabel(a), onclick: () => onaction(a) })),
  );
</script>

<!-- UrlBar의 입력칸이 aria-describedby로 이 id를 가리킨다(invalid 입력은 오류 설명 요소가 필수) -->
<div id="resolve-error" class="wrap">
  <Notice tone="danger" title={copy.title} {actions}>
    {#if copy.body}<p class="body">{copy.body}</p>{/if}
    {#if copy.detail}<p class="detail">{copy.detail}</p>{/if}
  </Notice>
</div>

<style>
  .wrap {
    margin-top: var(--space-8);
  }
  .body,
  .detail {
    margin: 0;
  }
  .detail {
    color: var(--fg-muted);
  }
</style>
