<script lang="ts">
  import Button from '../Button.svelte';
  import Dialog from '../Dialog.svelte';

  let open = $state(false);
  let closed = $state(0);
</script>

<Button onclick={() => (open = true)}>열기</Button>
<span data-testid="closed">{closed}</span>
<Dialog
  {open}
  title="다운로드를 멈추고 닫을까요?"
  onclose={() => {
    open = false;
    closed += 1;
  }}
>
  본문
  {#snippet actions()}
    <Button variant="primary" data-autofocus="" onclick={() => (open = false)}>계속 받기</Button>
    <Button onclick={() => (open = false)}>닫기</Button>
  {/snippet}
</Dialog>
