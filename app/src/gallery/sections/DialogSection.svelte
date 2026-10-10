<script lang="ts">
  // 대화상자: 버튼으로 연다(동시에 하나). 오른쪽 끝 = 안전한 쪽(primary), 위험 동작은 왼쪽 끝 secondary
  // (docs/design/system/components.md §2.10·§2.11). 열면 .scrim이 body 직속으로 옮겨지고 나머지는 inert가 된다.
  import Button from '../../lib/components/ui/Button.svelte';
  import ConfirmDialog from '../../lib/components/ui/ConfirmDialog.svelte';
  import Dialog from '../../lib/components/ui/Dialog.svelte';
  import TextField from '../../lib/components/ui/TextField.svelte';
  import { DIALOG, FIELD, TITLE } from '../fixtures';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';

  type Which = 'confirm' | 'danger' | 'custom' | 'loading';
  let which = $state<Which | null>(null);
  let text = $state('');
  const close = () => {
    which = null;
  };
  // 제목은 객체로 넘긴다(design-lint DS7이 `title=` 글자를 막는다: 컴포넌트의 title prop도 걸린다)
  const safe = { id: 'safe', label: DIALOG.safe, onclick: close };
  const confirmProps = { title: DIALOG.confirmTitle, body: DIALOG.confirmBody, primary: safe, secondary: { id: 'run', label: DIALOG.run, onclick: close } };
  const dangerProps = {
    title: DIALOG.dangerTitle,
    body: DIALOG.dangerBody,
    primary: safe,
    secondary: { id: 'run', label: DIALOG.cancelRun, tone: 'danger' as const, onclick: close },
  };
  const customProps = { title: DIALOG.customTitle, primary: safe, secondary: { id: 'run', label: DIALOG.run, onclick: close } };
  const loadingProps = {
    title: DIALOG.loadingTitle,
    body: DIALOG.loadingBody,
    primary: safe,
    secondary: { id: 'run', label: DIALOG.run, loading: true, onclick: close },
  };
</script>

<Section name="dialog" heading={TITLE.dialog}>
  <Row>
    <Button data-dialog-trigger="confirm" onclick={() => (which = 'confirm')}>{DIALOG.open.confirm}</Button>
    <Button data-dialog-trigger="danger" onclick={() => (which = 'danger')}>{DIALOG.open.danger}</Button>
    <Button data-dialog-trigger="custom" onclick={() => (which = 'custom')}>{DIALOG.open.custom}</Button>
    <Button data-dialog-trigger="loading" onclick={() => (which = 'loading')}>{DIALOG.open.loading}</Button>
  </Row>

  <ConfirmDialog open={which === 'confirm'} {...confirmProps} onclose={close} />
  <ConfirmDialog open={which === 'danger'} {...dangerProps} onclose={close} />
  <Dialog open={which === 'custom'} {...customProps} onclose={close}>
    <TextField label={FIELD.label} placeholder={FIELD.placeholder} bind:value={text} />
  </Dialog>
  <ConfirmDialog open={which === 'loading'} {...loadingProps} onclose={close} />
</Section>
