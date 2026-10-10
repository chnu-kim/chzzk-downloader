<script lang="ts">
  // URL 입력줄(system/patterns.md §6.1·§7·§14.1). 붙여넣기는 곧바로 불러오고, 직접 입력은 Enter나 [불러오기].
  // 스크롤 영역 `.main` 안에서 위에 붙는다(sticky, J8). 카드와 `.main` 사이에 overflow를 두지 않아야 붙는다.
  import { t } from '../../copy/ko';
  import { resolver } from '../../stores/resolve.svelte';
  import { ui } from '../../stores/ui.svelte';
  import { useDelayedLoading } from '../../useDelayedLoading.svelte';
  import Button from '../ui/Button.svelte';
  import TextField from '../ui/TextField.svelte';

  let input: HTMLInputElement | null = $state(null);
  let composing = false;
  const loading = $derived(resolver.state.kind === 'loading');
  const failed = $derived(resolver.state.kind === 'error');
  // 버튼 안 스피너는 LOADER_DELAY_MS 뒤에야 뜬다(빨리 끝나면 한 번도 보이지 않는다)
  const spinner = useDelayedLoading(() => loading);
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

  // 주소가 아니면 입력을 지우지 않고 전체를 골라 둔다(다시 붙여넣기 쉽게). 조합 중이면 건드리지 않는다
  $effect(() => {
    const s = resolver.state;
    if (s.kind === 'error' && s.error.code === 'invalidUrl' && !composing) input?.select();
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

<form class="urlbar" {onsubmit} aria-busy={loading ? 'true' : undefined}>
  <div class="urlbar-field">
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
      oncompositionstart={() => (composing = true)}
      oncompositionend={() => (composing = false)}
    />
  </div>
  <!-- 빈 입력은 aria-disabled. 불러오는 중의 중복 제출은 onsubmit이 막는다(300ms 안에는 모양을 바꾸지 않는다) -->
  <Button
    type="submit"
    variant="secondary"
    loading={spinner.visible}
    aria-disabled={!loading && !resolver.input.trim() ? 'true' : undefined}
  >
    {t('url.submit')}
  </Button>
</form>

<style>
  .urlbar {
    position: sticky;
    top: 0;
    z-index: var(--z-sticky);
    display: flex;
    gap: var(--gap-sibling);
    padding-bottom: var(--space-8);
    background: var(--bg);
  }
  .urlbar-field {
    flex: 1;
    min-width: 0;
  }
</style>
