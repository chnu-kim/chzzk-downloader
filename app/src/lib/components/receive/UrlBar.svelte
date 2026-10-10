<script lang="ts">
  // URL 입력줄(§8.1·§8.4, docs/design/system/patterns.md §6·§7). 붙여넣기는 곧바로 불러오고, 직접 입력은 Enter나 [불러오기].
  import { t } from '../../copy/ko';
  import { resolver } from '../../stores/resolve.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import TextField from '../ui/TextField.svelte';

  let input: HTMLInputElement | null = $state(null);
  const loading = $derived(resolver.state.kind === 'loading');
  const failed = $derived(resolver.state.kind === 'error');
  // 오류면 설명 요소(ResolveError의 #resolve-error)를 aria-describedby로 잇는다(InvalidProps 타입이 강제)
  const invalidProps = $derived(
    failed ? { invalid: true as const, 'aria-describedby': 'resolve-error' } : { invalid: false as const },
  );

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
    if (!loading && resolver.input.trim()) void resolver.load(resolver.input);
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
  <TextField
    id="url-input"
    label={t('url.label')}
    bind:el={input}
    bind:value={resolver.input}
    placeholder={t('url.placeholder')}
    {...invalidProps}
    readonly={loading}
    inputmode="url"
    {onpaste}
  />
  <!-- primary에는 disabled가 없다(타입). 빈 입력은 aria-disabled로 알리고 제출은 onsubmit이 막는다 -->
  <Button
    type="submit"
    variant="primary"
    class="submit"
    {loading}
    aria-disabled={!loading && !resolver.input.trim() ? 'true' : undefined}
  >
    {t('url.submit')}
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
