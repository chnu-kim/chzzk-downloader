<script lang="ts">
  // D1 창 닫기 확인(§8.8). Rust가 받는 중인 작업이 있을 때 창 닫기·Cmd+Q를 막고 `close-requested`를 보내면 띄운다.
  // 오른쪽(primary, 첫 포커스)은 안전한 쪽 [계속 받기], 왼쪽(secondary)이 실행 쪽 [닫기]다(components.md §2.8).
  // [닫기]는 `quit`(받는 중인 작업을 멈춰 저장하고 종료)이고 한 번만 누를 수 있다(진행 중 loading).
  // 종료 중에는 keep()이 막는다(눌러도 되돌릴 수 없는데 살아 있는 버튼으로 보이지 않게).
  import { onMount } from 'svelte';
  import * as api from '../../api';
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { toasts } from '../../stores/toast.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';

  let open = $state(false);
  let running = $state(0);
  let quitting = $state(false);

  onMount(() => {
    let off: (() => void) | null = null;
    let gone = false;
    // 열려 있는 동안 다시 오면(작업 수가 바뀌었을 수 있다) 수만 고친다
    void api
      .onCloseRequested((n) => {
        running = n;
        open = true;
      })
      .then((f) => {
        if (gone) f();
        else off = f;
      })
      .catch(() => {});
    return () => {
      gone = true;
      off?.();
    };
  });

  function keep() {
    if (quitting) return;
    open = false;
  }

  async function quit() {
    if (quitting) return;
    quitting = true;
    try {
      await api.quit();
      // 정상이면 Rust가 앱을 끝낸다. 이미 종료 중이었으면 아무 일도 없이 돌아온다(그쪽이 끝낸다).
    } catch (e) {
      quitting = false;
      open = false;
      toasts.push(errorCopy(e as AppError, { place: 'other' }).title, 'danger');
    }
  }
</script>

<ConfirmDialog
  {open}
  title={t('dialog.close.title')}
  body={t('dialog.close.body', { n: running })}
  onclose={keep}
  primary={{ id: 'keep', label: t('dialog.close.keep'), onclick: keep }}
  secondary={{ id: 'confirm', label: t('dialog.close.confirm'), loading: quitting, onclick: () => void quit() }}
/>
