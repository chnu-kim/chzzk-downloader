<script lang="ts">
  // 저장 폴더 행(system/patterns.md §6.5): 라벨 fg · 값(경로) muted, 선택·복사 가능 · [변경…].
  // 긴 경로는 끝을 말줄임한다(title 툴팁 없이: 전체 값은 선택해서 복사한다).
  import { t } from '../../copy/ko';
  import Button from '../ui/Button.svelte';
  import FieldRow from '../ui/FieldRow.svelte';

  interface Props {
    path: string;
    onchange: () => void;
    disabled?: boolean;
  }

  let { path, onchange, disabled = false }: Props = $props();
</script>

<FieldRow label={t('folder.label')}>
  {#snippet control()}
    <span class="selectable ellipsis">{path}</span>
  {/snippet}
  {#snippet actions()}
    <Button variant="ghost" size="sm" class="edge-end" {disabled} onclick={onchange}>{t('folder.change')}</Button>
  {/snippet}
</FieldRow>
