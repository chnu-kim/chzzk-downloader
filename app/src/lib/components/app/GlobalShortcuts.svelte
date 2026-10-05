<script lang="ts">
  // 창 전체 단축키(§10). macOS는 Cmd, 그 밖은 Ctrl.
  import { tick } from 'svelte';
  import { isInPageDrag, trackInPageDrags } from '../../inPageDrag';
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

  // 창 어디에 무엇을 떨어뜨려도 웹뷰가 그곳으로 이동하지 않게 한다(파일·링크). 네이티브 드롭을 꺼 두었으므로
  // (tauri.conf `dragDropEnabled: false`) 막지 않으면 웹뷰의 기본 동작이 돈다. 홈의 DropOverlay가 받는 주소 글은
  // 그쪽이 먼저 막고 dropEffect를 정한다. 창 안에서 시작한 끌기를 입력칸에 놓는 것(글 옮기기)만 기본 동작에 맡긴다.
  trackInPageDrags();

  function inPageEdit(e: DragEvent): boolean {
    return isInPageDrag() && editable(e.target);
  }

  function ondragover(e: DragEvent) {
    if (e.defaultPrevented || inPageEdit(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  }

  function ondrop(e: DragEvent) {
    if (inPageEdit(e)) return;
    e.preventDefault();
  }
</script>

<svelte:window {onkeydown} {ondragover} {ondrop} />
<svelte:document {onpaste} />
