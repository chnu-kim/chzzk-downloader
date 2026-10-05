<script lang="ts">
  // 창에 끌어다 놓은 주소 글(ui-visual §6.4 드래그 오버). 네이티브 드롭을 꺼 두었으므로(tauri.conf
  // `dragDropEnabled: false`, app.md 구현 중 변경 5) 웹뷰의 HTML5 drag 이벤트로 받는다.
  // dragover 동안에는 브라우저가 글 내용을 보여 주지 않으므로(보호 모드) 종류만 보고 띄우고, 놓았을 때 고른다.
  // 파일 드롭은 받지 않는다: 막지 않으면 웹뷰가 그 파일로 이동해 버린다.
  // 창 안에서 시작한 끌기(입력칸 글 옮기기 등)는 받지 않고 브라우저 기본 동작에 맡긴다(`inPageDrag`).
  import { textFromDrop } from '../../chzzkUrl';
  import { isInPageDrag, trackInPageDrags } from '../../inPageDrag';
  import { t } from '../../copy/ko';
  import Icon from '../ui/Icon.svelte';

  let { ondropurl }: { ondropurl: (text: string) => void } = $props();

  trackInPageDrags();

  let depth = 0;
  let active = $state(false);

  function accepts(dt: DataTransfer | null): boolean {
    if (isInPageDrag()) return false;
    const types = dt ? Array.from(dt.types ?? []) : [];
    return !types.includes('Files') && (types.includes('text/uri-list') || types.includes('text/plain'));
  }

  function ondragenter(e: DragEvent) {
    if (!accepts(e.dataTransfer)) return;
    e.preventDefault();
    depth += 1;
    active = true;
  }

  function ondragover(e: DragEvent) {
    if (isInPageDrag()) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = accepts(e.dataTransfer) ? 'copy' : 'none';
  }

  function ondragleave() {
    if (!active) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) active = false;
  }

  function ondrop(e: DragEvent) {
    depth = 0;
    active = false;
    if (isInPageDrag()) return;
    e.preventDefault();
    const dt = e.dataTransfer;
    if (!dt || !accepts(dt)) return;
    const text = textFromDrop((type) => dt.getData(type));
    if (text) ondropurl(text);
  }
</script>

<svelte:window {ondragenter} {ondragover} {ondragleave} {ondrop} />

{#if active}
  <div class="overlay" aria-hidden="true">
    <div class="inner">
      <Icon name="drop" size={32} />
      <span>{t('url.dropHere')}</span>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: var(--header-h) 0 0 0;
    z-index: var(--z-banner);
    padding: var(--space-3);
    background: color-mix(in srgb, var(--accent-soft) 88%, transparent);
    pointer-events: none;
  }
  .inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    height: 100%;
    border: 2px dashed var(--accent);
    border-radius: var(--radius-lg);
    color: var(--accent);
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
  }
</style>
