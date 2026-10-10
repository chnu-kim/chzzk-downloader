<script lang="ts">
  import Button from '../Button.svelte';
  import Dialog from '../Dialog.svelte';

  // 안전한 쪽(primary) = 계속 받기, 실행 쪽(secondary) = 닫기. 둘째 대화상자는 대기열·본문 없음 확인용이다.
  interface Props {
    secondaryTone?: 'neutral' | 'danger';
    second?: boolean;
  }
  let { secondaryTone = 'danger', second = false }: Props = $props();

  let open = $state(false);
  let open2 = $state(false);
  let closed = $state(0);
  let primaryRuns = $state(0);
  let secondaryRuns = $state(0);
</script>

<Button onclick={() => (open = true)}>열기</Button>
{#if second}<Button onclick={() => (open2 = true)}>둘째 열기</Button>{/if}
<span data-testid="closed">{closed}</span>
<span data-testid="primary-runs">{primaryRuns}</span>
<span data-testid="secondary-runs">{secondaryRuns}</span>
<Dialog
  {open}
  title="다운로드를 멈추고 닫을까요?"
  primary={{
    id: 'keep',
    label: '계속 받기',
    onclick: () => {
      primaryRuns += 1;
      open = false;
    },
  }}
  secondary={{
    id: 'close',
    label: '닫기',
    tone: secondaryTone,
    onclick: () => {
      secondaryRuns += 1;
      open = false;
    },
  }}
  onclose={() => {
    open = false;
    closed += 1;
  }}
>
  본문
</Dialog>
{#if second}
  <Dialog
    open={open2}
    title="둘째 대화상자"
    primary={{ id: 'ok', label: '확인', onclick: () => (open2 = false) }}
    onclose={() => (open2 = false)}
  />
{/if}
