<script lang="ts">
  import { t } from '../../copy/ko';
  import IconButton from './IconButton.svelte';
  import TextField from './TextField.svelte';

  interface Props {
    value: string;
    id?: string;
    label?: string;
    invalid?: boolean;
    disabled?: boolean;
  }

  // 값은 가린 채로 시작한다. 보기를 켜도 저장하지 않는 한 Rust로 보내지 않는다(ui-visual §7).
  let { value = $bindable(), id, label, invalid = false, disabled = false }: Props = $props();
  let shown = $state(false);
</script>

<div class="secret">
  <TextField
    bind:value
    {id}
    aria-label={label}
    type={shown ? 'text' : 'password'}
    mono
    {invalid}
    {disabled}
  />
  <IconButton
    icon={shown ? 'eye-off' : 'eye'}
    label={shown ? t('settings.cookie.hide') : t('settings.cookie.show')}
    aria-pressed={shown}
    {disabled}
    onclick={() => (shown = !shown)}
  />
</div>

<style>
  .secret {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }
</style>
