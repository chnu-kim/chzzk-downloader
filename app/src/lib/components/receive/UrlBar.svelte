<script lang="ts">
  // URL 입력줄(§8.1·§8.4, ui-visual §6.4). 붙여넣기는 곧바로 불러오고, 직접 입력은 Enter나 [불러오기].
  import { t } from '../../copy/ko';
  import { resolver } from '../../stores/resolve.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import Spinner from '../ui/Spinner.svelte';
  import TextField from '../ui/TextField.svelte';

  let input: HTMLInputElement | null = $state(null);
  const loading = $derived(resolver.state.kind === 'loading');
  const failed = $derived(resolver.state.kind === 'error');

  // 단축키(Mod+L, 입력칸 밖 Mod+V)가 부를 곳
  $effect(() => {
    ui.urlTarget = {
      focus: () => input?.focus(),
      paste: (text) => void resolver.load(text),
    };
    return () => {
      ui.urlTarget = null;
    };
  });

  // 주소가 아니면 입력을 지우지 않고 골라 둔다(§9 invalidUrl "입력 선택")
  $effect(() => {
    const s = resolver.state;
    if (s.kind === 'error' && s.error.code === 'invalidUrl') input?.select();
  });

  function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!loading) void resolver.load(resolver.input);
  }

  // 빈 칸이나 전체 선택에 붙여넣으면 바로 불러온다. 글 중간에 붙여넣는 것은 그대로 둔다.
  function onpaste(e: ClipboardEvent) {
    const text = e.clipboardData?.getData('text/plain')?.trim();
    const el = e.currentTarget as HTMLInputElement;
    if (!text || loading) return;
    const whole = el.value === '' || (el.selectionStart === 0 && el.selectionEnd === el.value.length);
    if (!whole) return;
    e.preventDefault();
    void resolver.load(text);
  }
</script>

<form class="urlbar" {onsubmit}>
  <label class="sr-only" for="url-input">{t('url.label')}</label>
  <TextField
    id="url-input"
    bind:el={input}
    bind:value={resolver.input}
    placeholder={t('url.placeholder')}
    invalid={failed}
    readonly={loading}
    inputmode="url"
    {onpaste}
  />
  <Button type="submit" variant="primary" class="submit" disabled={loading || !resolver.input.trim()}>
    {#if loading}
      <Spinner label={t('resolve.loading')} />
    {:else}
      {t('url.submit')}
    {/if}
  </Button>
</form>

<style>
  .urlbar {
    display: flex;
    gap: var(--space-8);
  }
  .urlbar :global(.submit) {
    flex: none;
    width: 88px;
  }
</style>
