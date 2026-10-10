<script lang="ts">
  // 입력 영역(system/patterns.md §14.1·§14.2): 입력줄(sticky) · 붙여넣기 힌트 · 클립보드 제안 · 불러오는 중 한 줄 ·
  // 영상 카드 · 최근 영상 · 드롭. 래퍼 요소를 두지 않는다: 입력줄의 sticky가 이 아래의 목록까지 붙어 있으려면
  // 입력줄의 부모가 목록과 같은 열이어야 해서다(HomeView가 이 컴포넌트와 목록을 같은 열에 둔다).
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import * as api from '../../api';
  import type { AppError } from '../../bindings';
  import { pickChzzkLink } from '../../chzzkUrl';
  import { t } from '../../copy/ko';
  import type { ActionId } from '../../copy/errors';
  import { copyReport } from '../../report';
  import { shortcutText } from '../../platform';
  import { shouldSuggestClipboard } from '../../receive';
  import { platform } from '../../stores/platform.svelte';
  import { resolver } from '../../stores/resolve.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { ui } from '../../stores/ui.svelte';
  import { useDelayedLoading } from '../../useDelayedLoading.svelte';
  import Notice from '../ui/Notice.svelte';
  import ClipboardSuggestion from './ClipboardSuggestion.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import RecentList from './RecentList.svelte';
  import ResolveCard from './ResolveCard.svelte';
  import ResolveError from './ResolveError.svelte';
  import UrlBar from './UrlBar.svelte';

  interface Props {
    /** 충돌 안내·중복 오류의 [목록에서 보기] (목록이 받는다) */
    onshowjob?: (jobId: number) => void;
  }

  let { onshowjob = () => {} }: Props = $props();

  let suggestion: string | null = $state(null);
  /** 닫았거나 이미 불러온 주소는 다시 제안하지 않는다 */
  const dismissed = new SvelteSet<string>();

  // 어느 길(붙여넣기·Enter·드롭·최근 VOD·제안)로든 불러온 주소는 다시 제안하지 않는다(patterns.md §7 "같은 값은 한 번만")
  $effect(() => {
    const s = resolver.state;
    if (s.kind === 'loading') untrack(() => dismissed.add(s.url));
  });

  // 입력줄에 글이 생겨 숨긴 제안은 버린다(비우면 다음 창 포커스 때 다시 묻는다)
  $effect(() => {
    if (resolver.input.trim() !== '') untrack(() => (suggestion = null));
  });

  const loading = $derived(resolver.state.kind === 'loading');
  // 불러오는 중 한 줄은 LOADER_DELAY_MS 뒤에야 뜬다(빨리 끝나면 한 번도 보이지 않는다, patterns.md §2.2)
  const loadingLine = useDelayedLoading(() => loading);
  // 힌트·최근 영상은 카드가 열렸거나 불러오는 중이면 숨긴다(높이 520 예산, patterns.md §17-10)
  const idleLike = $derived(resolver.state.kind !== 'ready' && !loading);

  const showSuggestion = $derived(
    shouldSuggestClipboard(suggestion, {
      inputEmpty: resolver.input.trim() === '',
      idle: resolver.idle,
      dismissed,
    }),
  );

  function canSuggest() {
    return resolver.input.trim() === '' && resolver.idle;
  }

  // 창이 포커스를 얻을 때 클립보드에 치지직 주소가 있는지 Rust에 묻는다(글 자체는 Rust 밖으로 나오지 않는다).
  async function checkClipboard() {
    if (!canSuggest()) return;
    let link: string | null;
    try {
      link = await api.clipboardLink();
    } catch {
      return;
    }
    // 묻는 사이 사용자가 입력했을 수 있다
    suggestion = shouldSuggestClipboard(link, { inputEmpty: canSuggest(), idle: true, dismissed }) ? link : null;
  }

  function loadSuggestion() {
    if (!suggestion) return;
    const link = suggestion;
    dismissed.add(link);
    suggestion = null;
    void resolver.load(link);
  }

  function dismissSuggestion() {
    if (suggestion) dismissed.add(suggestion);
    suggestion = null;
  }

  // 카드·오류·불러오기를 접으면 누르던 버튼이 사라지므로 포커스를 입력줄로 돌려 둔다(patterns.md §9 F-6)
  async function focusInput() {
    await tick();
    ui.urlTarget?.focus();
  }

  async function added() {
    resolver.finish();
    await focusInput();
  }

  function close() {
    resolver.close();
    void focusInput();
  }

  function cancel() {
    resolver.cancel();
    void focusInput();
  }

  // 창 밖에서 끌어다 놓은 글. 카드·오류·불러오기가 열려 있으면 진짜 치지직 주소일 때만 바꾼다
  // (주소가 아닌 글로 고르던 카드를 버리지 않는다).
  function ondropurl(text: string) {
    if (!resolver.idle && !pickChzzkLink(text)) return;
    void resolver.load(text);
  }

  function onaction(a: ActionId, err: AppError) {
    switch (a) {
      case 'retry': {
        const s = resolver.state;
        void resolver.load(s.kind === 'error' ? s.url : resolver.input);
        break;
      }
      case 'close':
        close();
        break;
      case 'openCookieSettings':
      case 'reenterCookies':
        ui.goSettings({ cookies: true });
        break;
      case 'copyReport':
        void copyReport(err, settings.info);
        break;
      case 'showInList':
        if (err.payload?.type === 'duplicateOutput') onshowjob(err.payload.jobId);
        break;
      default:
        // 목록 동작(resume·remove 등)은 불러오기 오류에 나오지 않는다(errorCopy 표 테스트)
        break;
    }
  }

  onMount(() => {
    void checkClipboard();
    const onfocus = () => void checkClipboard();
    window.addEventListener('focus', onfocus);
    // Esc: 불러오기 취소 → 카드·오류 닫기(patterns.md §8)
    const off = ui.onEscape(() => {
      const kind = resolver.state.kind;
      if (kind === 'loading') cancel();
      else if (kind === 'ready' || kind === 'error') close();
      else return false;
      return true;
    });
    return () => {
      window.removeEventListener('focus', onfocus);
      off();
    };
  });
</script>

<DropOverlay {ondropurl} />

<UrlBar />

<div class="below">
  {#if resolver.state.kind === 'error'}
    <ResolveError
      error={resolver.state.error}
      cookiesEnabled={settings.cookiesEnabled}
      onaction={(a) => resolver.state.kind === 'error' && onaction(a, resolver.state.error)}
    />
  {/if}

  {#if idleLike}
    <p class="hint">{t('url.pasteHint', { paste: shortcutText(platform.os, 'paste') })}</p>
  {/if}

  {#if showSuggestion && suggestion}
    <ClipboardSuggestion link={suggestion} onload={loadSuggestion} ondismiss={dismissSuggestion} />
  {/if}

  {#if loading && loadingLine.visible}
    <Notice
      variant="inline"
      tone="neutral"
      actions={[{ id: 'cancel', label: t('common.cancel'), onclick: cancel }]}
    >
      {t('resolve.loading')}
    </Notice>
  {/if}

  {#if resolver.state.kind === 'ready'}
    <!-- 입력줄 아래 8(입력줄 패딩) + 섹션 간격 24: 세로 예산 "입력줄 28 + 8 + 24"(patterns.md §15) -->
    <div class="card-slot">
      {#key resolver.state.gen}
        <ResolveCard
          view={resolver.state.view}
          onclose={close}
          onadded={added}
          {onaction}
          {onshowjob}
        />
      {/key}
    </div>
  {:else if idleLike}
    <RecentList items={settings.dto?.recentVods ?? []} onreopen={(url) => void resolver.load(url)} />
  {/if}
</div>

<style>
  .below {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
  .card-slot {
    margin-top: var(--space-24);
  }
  .hint {
    margin: 0;
    color: var(--fg-muted);
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }
</style>
