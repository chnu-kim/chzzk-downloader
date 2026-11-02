<script lang="ts">
  // 파일 이름 행(system/patterns.md §6.5): 입력칸(fg) + 확장자 + [원래 이름으로]. 최종 이름이 입력과 다르면 아래 caption으로 저장될 이름.
  // 이름이 비면 help가 사유 문장이다(§6.4, 오류 표시는 없다 §6.1). 한글을 치는 칸이라 Enter에 동작을 달지 않는다(제출은 카드의 Mod+Enter).
  import { t } from '../../copy/ko';
  import { BLOCK_REASON_ID } from '../../receive';
  import Button from '../ui/Button.svelte';
  import FieldRow from '../ui/FieldRow.svelte';
  import TextField from '../ui/TextField.svelte';

  interface Props {
    value: string;
    suggested: string;
    /** 실제로 저장될 이름이 입력과 다를 때(정리·200바이트 절단) */
    willSaveAs: string | null;
    disabled?: boolean;
    /** 확장자 라벨(고른 화질로 정한다: 영상 `.mp4`, 오디오만 `.m4a`) */
    ext: string;
  }

  let { value = $bindable(), suggested, willSaveAs, disabled = false, ext }: Props = $props();
  const empty = $derived(!value.trim());
</script>

<FieldRow
  label={t('filename.label')}
  help={empty ? t('filename.empty.help') : willSaveAs ? t('filename.willSaveAs', { name: willSaveAs }) : undefined}
>
  {#snippet control({ labelId, helpId })}
    <TextField labelledby={labelId} bind:value {disabled} aria-describedby={helpId} />
    <span class="ext">{ext}</span>
  {/snippet}
  {#snippet actions()}
    <!-- 이미 원래 이름이면 할 일이 없어 그리지 않는다(사유 없는 비활성은 두지 않는다, patterns.md §6.4) -->
    {#if value !== suggested}
      <Button variant="ghost" size="sm" class="edge-end" {disabled} onclick={() => (value = suggested)}>
        {t('filename.reset')}
      </Button>
    {/if}
  {/snippet}
</FieldRow>
<!-- [받기]의 aria-describedby가 가리키는 고정 id(FieldRow help id는 uid라 줄 수 없다). 숨겨도 설명 계산에 든다 -->
{#if empty}<span id={BLOCK_REASON_ID.emptyName} hidden>{t('filename.empty.help')}</span>{/if}

<style>
  .ext {
    flex: none;
  }
</style>
