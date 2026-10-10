<script lang="ts" module>
  import type { DialogProps } from './Dialog.svelte';

  /** 제목은 질문 한 문장, 본문은 해요체 1~2문장(components.md §2.11) */
  export type ConfirmDialogProps = Omit<DialogProps, 'children'> & { body: string };
</script>

<script lang="ts">
  import Dialog from './Dialog.svelte';

  let { body, open, title, primary, secondary, onclose }: ConfirmDialogProps = $props();
</script>

<Dialog {open} {title} {primary} {secondary} {onclose}>
  {body}
</Dialog>
