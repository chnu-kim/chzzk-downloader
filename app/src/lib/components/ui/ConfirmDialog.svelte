<script lang="ts" module>
  export interface ConfirmAction {
    label: string;
    variant: 'primary' | 'secondary' | 'danger';
    onclick: () => void;
    /** 처음 포커스를 받는 기본 버튼(안전한 쪽) */
    autofocus?: boolean;
  }
</script>

<script lang="ts">
  import Button from './Button.svelte';
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    title: string;
    body: string;
    /** 왼쪽부터 순서대로 */
    buttons: ConfirmAction[];
    onclose: () => void;
  }

  let { open, title, body, buttons, onclose }: Props = $props();
</script>

<Dialog {open} {title} {onclose}>
  {body}
  {#snippet actions()}
    {#each buttons as b (b.label)}
      <Button variant={b.variant} data-autofocus={b.autofocus ? '' : undefined} onclick={b.onclick}>
        {b.label}
      </Button>
    {/each}
  {/snippet}
</Dialog>
