<script lang="ts">
  // 입력 영역(§10 InputPanel): UrlBar · 클립보드 제안 · 불러오기 상태별 카드 · 최근 VOD · 드롭.
  import { onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import * as api from '../../api';
  import type { AppError } from '../../bindings';
  import { pickChzzkLink } from '../../chzzkUrl';
  import type { ActionId } from '../../copy/errors';
  import { shouldSuggestClipboard } from '../../receive';
  import { copyReport } from '../../report';
  import { resolver } from '../../stores/resolve.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { ui } from '../../stores/ui.svelte';
  import ClipboardSuggestion from './ClipboardSuggestion.svelte';
  import DropOverlay from './DropOverlay.svelte';
  import RecentList from './RecentList.svelte';
  import ResolveCard from './ResolveCard.svelte';
  import ResolveError from './ResolveError.svelte';
  import ResolveSkeleton from './ResolveSkeleton.svelte';
  import UrlBar from './UrlBar.svelte';

  interface Props {
    /** 충돌 안내·중복 오류의 [목록에서 보기] (§15-15 목록이 받는다) */
    onshowjob?: (jobId: number) => void;
  }

  let { onshowjob = () => {} }: Props = $props();

  let suggestion: string | null = $state(null);
  /** 닫았거나 이미 불러온 주소는 다시 제안하지 않는다 */
  const dismissed = new SvelteSet<string>();

  // 어느 길(붙여넣기·Enter·드롭·최근 VOD·제안)로든 불러온 주소는 다시 제안하지 않는다(ui-visual §6.4 "한 번만")
  $effect(() => {
    const s = resolver.state;
    if (s.kind === 'loading') untrack(() => dismissed.add(s.url));
  });

  // 입력줄에 글이 생겨 숨긴 제안은 버린다(비우면 다음 창 포커스 때 다시 묻는다)
  $effect(() => {
    if (resolver.input.trim() !== '') untrack(() => (suggestion = null));
  });

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

  // 카드·오류·불러오기를 접으면 누르던 버튼이 사라지므로 포커스를 입력줄로 돌려 둔다(§8.10)
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
    // Esc: 불러오기 취소 → 카드·오류 닫기(§10 단축키)
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

<div class="input">
  <UrlBar />
  {#if showSuggestion && suggestion}
    <ClipboardSuggestion link={suggestion} onload={loadSuggestion} ondismiss={dismissSuggestion} />
  {/if}

  {#if resolver.state.kind === 'error'}
    <ResolveError
      error={resolver.state.error}
      cookiesEnabled={settings.cookiesEnabled}
      onaction={(a) => resolver.state.kind === 'error' && onaction(a, resolver.state.error)}
    />
  {/if}

  {#if resolver.state.kind === 'ready'}
    {#key resolver.state.gen}
      <ResolveCard
        view={resolver.state.view}
        onclose={close}
        onadded={added}
        {onaction}
        {onshowjob}
      />
    {/key}
  {:else if resolver.state.kind === 'loading'}
    <ResolveSkeleton oncancel={cancel} />
  {:else}
    <RecentList items={settings.dto?.recentVods ?? []} onreopen={(url) => void resolver.load(url)} />
  {/if}
</div>
