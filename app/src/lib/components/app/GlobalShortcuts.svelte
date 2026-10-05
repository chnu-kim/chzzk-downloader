<script lang="ts">
  // 창 전체 단축키(§10). macOS는 Cmd, 그 밖은 Ctrl.
  import { tick } from 'svelte';
  import { modKey, ui } from '../../stores/ui.svelte';

  function editable(t: EventTarget | null): boolean {
    if (!(t instanceof HTMLElement)) return false;
    return t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement;
  }

  async function onkeydown(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      // 대화상자·메뉴는 스스로 받아 멈춘다(defaultPrevented)
      if (!e.defaultPrevented && ui.escape()) e.preventDefault();
      return;
    }
    if (!modKey(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'l') {
      e.preventDefault();
      if (ui.view !== 'home') {
        ui.goHome();
        await tick();
      }
      ui.urlTarget?.focus();
    } else if (e.key === ',') {
      e.preventDefault();
      ui.goSettings();
    }
  }

  // 입력칸 밖 Mod+V: 입력줄에 붙여넣고 바로 불러온다(§8.10). 클립보드 API 대신 paste 이벤트의 글을 쓴다
  // (사용자 제스처 안이라 권한이 필요 없고, 웹뷰에 클립보드 읽기 권한을 주지 않는다).
  function onpaste(e: ClipboardEvent) {
    if (editable(e.target) || ui.view !== 'home' || !ui.urlTarget) return;
    const text = e.clipboardData?.getData('text/plain')?.trim();
    if (!text) return;
    e.preventDefault();
    ui.urlTarget.paste(text);
  }
</script>

<svelte:window {onkeydown} />
<svelte:document {onpaste} />
