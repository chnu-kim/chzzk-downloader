<script lang="ts">
  // 계정: 채널 이름 / 허가 범위·마지막 확인(또는 오프라인) / [로그아웃…] 다음에 편집자 머리 행·편집자 행들·맡은 채널 행들
  // (patterns.md §14.4, delegation.md §4·§5.6). 로그아웃 확인(D4)은 App의 LogoutDialog가 맡고, 여기서는 요청 플래그만 올린다.
  // 편집자 빼기는 지연 회수: 행을 숨기고 토스트 [되돌리기], 토스트가 닫힐 때 보낸다(stores/editors.svelte.ts).
  import { onDestroy, onMount, tick } from 'svelte';
  import type { EditorDto } from '../../bindings';
  import { announcer } from '../../stores/announce.svelte';
  import { t } from '../../copy/ko';
  import { cleanDisplayText } from '../../format/display';
  import { useDelayedLoading } from '../../useDelayedLoading.svelte';
  import { auth } from '../../stores/auth.svelte';
  import { editors, shownName } from '../../stores/editors.svelte';
  import { toasts } from '../../stores/toast.svelte';
  import { ui } from '../../stores/ui.svelte';
  import { COPIED_LABEL_MS } from '../../timing';
  import { dayText, whenText } from '../../when';
  import Button from '../ui/Button.svelte';
  import FieldRow from '../ui/FieldRow.svelte';
  import Notice from '../ui/Notice.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import TextField from '../ui/TextField.svelte';
  import SettingsSection from './SettingsSection.svelte';

  const uid = $props.id();
  const accountHelpId = `${uid}-account-help`;
  const edLabelId = `${uid}-ed-label`;
  const edHelpId = `${uid}-ed-help`;

  const status = $derived(auth.status);
  const stateText = $derived(
    status?.offline
      ? t('account.offline', { until: whenText(status.offline.graceUntil, Date.now()) })
      : status?.verifiedAt != null
        ? t('account.lastSeen', { time: whenText(status.verifiedAt, Date.now()) })
        : '',
  );

  const dto = $derived(editors.dto);
  const offline = $derived(status?.offline != null);
  const full = $derived(dto != null && dto.editors.length >= dto.editorsMax);
  const blocked = $derived(offline || full);
  const loading = useDelayedLoading(() => dto == null && editors.load === 'loading');

  /** 머리 행 도움말: 위에서 먼저 맞는 것 하나(delegation.md §4.3). 처음 읽는 중이면 빈 문자열 */
  const help = $derived.by(() => {
    if (offline) return t('editors.offline');
    if (dto && full) return t('editors.limit', { n: dto.editorsMax });
    if (dto?.pendingInviteUntil != null) return t('editors.pending', { date: dayText(dto.pendingInviteUntil, Date.now()) });
    if (editors.editors.length >= 1) return t('editors.help');
    if (dto) return t('editors.empty');
    if (editors.load === 'failed') return t('editors.loadFailed');
    return '';
  });

  const inviteDays = $derived(
    editors.invite ? Math.max(1, Math.round((editors.invite.expiresAt - Date.now() / 1000) / 86400)) : 7,
  );

  // 설정이 열려 있는 동안만 읽는다(마운트 ∧ 로그인)
  onMount(() => {
    void editors.openView();
    return () => editors.closeView();
  });
  // 이미 마운트된 채 로그인한 계정이 바뀌면(다시 signedIn, 또는 A → B) 다시 읽는다
  const signedInChannel = () => (auth.signedIn ? (auth.status?.channelId?.toLowerCase() ?? null) : null);
  let lastChannel = signedInChannel();
  $effect(() => {
    const now = signedInChannel();
    if (now && now !== lastChannel) void editors.openView();
    lastChannel = now;
  });

  // ── 주소 복사 ──
  // [복사했어요]는 복사한 그 주소에 묶는다: 다시 만들어 주소가 바뀌면(앞 주소는 무효) 곧바로 [주소 복사]로 돌아간다
  let copiedUrl: string | null = $state(null);
  const copied = $derived(copiedUrl != null && copiedUrl === editors.invite?.url);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  onDestroy(() => {
    if (copiedTimer) clearTimeout(copiedTimer);
  });
  async function copyInvite() {
    if (!editors.invite) return;
    const url = editors.invite.url;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      toasts.push(t('toast.copyFailed'), 'danger');
      return;
    }
    // 기다리는 사이 주소가 바뀌었으면(앞 주소는 무효) 틀린 내용을 알리지 않는다
    if (editors.invite?.url !== url) return;
    copiedUrl = url;
    announcer.say(t('action.copied'));
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => (copiedUrl = null), COPIED_LABEL_MS);
  }

  // ── 포커스(F-4): 행이 사라지면 다음 행 → 이전 행 → 머리 행 버튼 ──
  // 응답을 기다리는 사이 사용자가 포커스를 다른 곳으로 옮겼으면 빼앗지 않는다(JobList와 같은 규칙):
  // 사라진 행에 있던 포커스는 body로 떨어지므로, body(또는 없음)일 때만 옮긴다
  let makeBtn: HTMLButtonElement | null = $state(null);

  function focusRowButton(attr: 'data-editor' | 'data-delegated', id: string | undefined) {
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const el = id ? document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"] button`) : null;
    (el ?? makeBtn)?.focus();
  }

  function nextOf<T extends { channelId: string }>(rows: T[], id: string): string | undefined {
    const i = rows.findIndex((r) => r.channelId === id);
    return (rows[i + 1] ?? rows[i - 1])?.channelId;
  }

  // 응답이 왔는데도 행이 아직 있으면(dto가 없어 auth-changed가 와야 사라지는 경로) 포커스가 그 행에 있는 채로 기다린다.
  // 행이 사라질 때 포커스가 아직 그 행이었거나 body로 떨어졌을 때만 옮긴다(다른 곳으로 옮겼으면 빼앗지 않는다)
  let handoff: { attr: 'data-editor' | 'data-delegated'; id: string; next: string | undefined } | null = null;
  const rowOf = (attr: string, id: string) => document.querySelector<HTMLElement>(`[${attr}="${CSS.escape(id)}"]`);

  async function settle(attr: 'data-editor' | 'data-delegated', id: string, next: string | undefined) {
    await tick();
    const row = rowOf(attr, id);
    if (!row) return focusRowButton(attr, next);
    if (row.contains(document.activeElement)) handoff = { attr, id, next };
  }

  $effect(() => {
    void editors.editors;
    void editors.delegated;
    const h = handoff;
    if (!h) return;
    void tick().then(() => {
      if (rowOf(h.attr, h.id)) return;
      if (handoff === h) handoff = null;
      focusRowButton(h.attr, h.next);
    });
  });

  async function removeEditor(ed: EditorDto) {
    const next = nextOf(editors.editors, ed.channelId);
    if (await editors.remove(ed)) await settle('data-editor', ed.channelId, next);
  }

  async function leave(ch: { channelId: string; channelName: string }) {
    const next = nextOf(editors.delegated, ch.channelId);
    if (await editors.leave(ch)) await settle('data-delegated', ch.channelId, next);
  }

  // [되돌리기]로 행이 돌아오면(토스트 안에 있던 포커스가 body로 떨어진다) 그 행의 버튼으로 옮긴다
  let prevHidden = new Set<string>();
  $effect(() => {
    const now = new Set(editors.hidden);
    const back = [...prevHidden].find((id) => !now.has(id) && editors.editors.some((e) => e.channelId.toLowerCase() === id));
    prevHidden = now;
    if (!back) return;
    void tick().then(() => {
      const id = editors.editors.find((e) => e.channelId.toLowerCase() === back)?.channelId;
      focusRowButton('data-editor', id);
    });
  });

  const name = (s: string) => cleanDisplayText(s);
</script>

{#if auth.signedIn}
  <SettingsSection title={t('settings.account')}>
    <!-- 도움말이 "범위 · 마지막 확인" 두 조각이라 SettingsRow의 문자열 help 대신 같은 클래스로 짠다 -->
    <div class="row">
      <div class="row-main">
        <span class="row-label" id="l-account">{status?.channelName ?? t('settings.account')}</span>
        <span class="row-help" id={accountHelpId}>
          {t('account.scope')}
          {#if stateText}<span aria-hidden="true">{' · '}</span>{stateText}{/if}
        </span>
      </div>
      <div class="row-control">
        <Button variant="ghost" size="sm" class="edge-end" aria-describedby="l-account" onclick={() => (ui.logoutConfirm = true)}>
          {t('account.logout')}
        </Button>
      </div>
    </div>

    <div class="row">
      <div class="row-main">
        <span class="row-label" id={edLabelId}>{t('editors.title')}</span>
        <span class="row-help" id={edHelpId}>
          {help}
          {#if !help && loading.visible}<Skeleton variant="line" width="half" />{/if}
        </span>
      </div>
      <div class="row-control">
        <Button
          variant="secondary"
          size="sm"
          class="edge-end"
          bind:el={makeBtn}
          loading={editors.inviting}
          aria-disabled={blocked ? 'true' : undefined}
          aria-describedby={help ? edHelpId : undefined}
          onclick={() => void editors.createInvite()}
        >
          {t('editors.invite.make')}
        </Button>
      </div>
      {#if editors.invite || editors.inviteError}
        <div class="row-extra">
          {#if editors.inviteError}
            <Notice variant="inline" tone="danger">{editors.inviteError}</Notice>
          {/if}
          {#if editors.invite}
            <FieldRow label={t('editors.invite.label')} help={t('editors.invite.help', { days: inviteDays })}>
              {#snippet control({ labelId, helpId })}
                <TextField readonly class="selectable" value={editors.invite!.url} labelledby={labelId} aria-describedby={helpId} />
              {/snippet}
              {#snippet actions()}
                <Button variant="secondary" size="sm" onclick={() => void copyInvite()}>
                  <span class="swap">
                    <span class:off={copied}>{t('action.copyUrl')}</span>
                    <span class:off={!copied}>{t('action.copied')}</span>
                  </span>
                </Button>
              {/snippet}
            </FieldRow>
          {/if}
        </div>
      {/if}
    </div>

    {#each editors.editors as ed (ed.channelId)}
      {@const id = `${uid}-e-${ed.channelId}`}
      <div class="row" data-editor={ed.channelId}>
        <div class="row-main">
          <span class="row-label" id="{id}-l"><bdi>{name(ed.channelName)}</bdi></span>
          <span class="row-help" id="{id}-h">
            {ed.status === 'pending'
              ? t('editors.waiting', { date: dayText(ed.since, Date.now()) })
              : t('editors.since', { date: dayText(ed.since, Date.now()) })}
          </span>
        </div>
        <div class="row-control">
          <Button
            variant="ghost"
            size="sm"
            class="edge-end"
            loading={editors.removing.has(ed.channelId.toLowerCase())}
            aria-label={t('a11y.removeEditor', { name: shownName(ed.channelName) })}
            aria-disabled={offline ? 'true' : undefined}
            aria-describedby={offline ? accountHelpId : `${id}-h`}
            onclick={() => void removeEditor(ed)}
          >
            {t('editors.remove')}
          </Button>
        </div>
        {#if editors.rowError.get(ed.channelId.toLowerCase())}
          <div class="row-extra">
            <Notice variant="inline" tone="danger">{editors.rowError.get(ed.channelId.toLowerCase())}</Notice>
          </div>
        {/if}
      </div>
    {/each}

    {#if editors.delegated.length > 0}
      <div class="row">
        <div class="row-main">
          <span class="row-label">{t('delegated.title')}</span>
          <span class="row-help">{t('delegated.help')}</span>
        </div>
      </div>
      {#each editors.delegated as ch (ch.channelId)}
        {@const id = `${uid}-d-${ch.channelId}`}
        <div class="row" data-delegated={ch.channelId}>
          <div class="row-main">
            <span class="row-label" id="{id}-l"><bdi>{name(ch.channelName)}</bdi></span>
            {#if ch.since != null}
              <span class="row-help" id="{id}-h">{t('editors.since', { date: dayText(ch.since, Date.now()) })}</span>
            {/if}
          </div>
          <div class="row-control">
            <Button
              variant="ghost"
              size="sm"
              class="edge-end"
              loading={editors.leaving.has(ch.channelId.toLowerCase())}
              aria-label={t('a11y.leaveDelegation', { name: shownName(ch.channelName) })}
              aria-disabled={offline ? 'true' : undefined}
              aria-describedby={offline ? accountHelpId : ch.since != null ? `${id}-h` : undefined}
              onclick={() => void leave(ch)}
            >
              {t('delegated.leave')}
            </Button>
          </div>
          {#if editors.leaveError.get(ch.channelId.toLowerCase())}
            <div class="row-extra">
              <Notice variant="inline" tone="danger">{editors.leaveError.get(ch.channelId.toLowerCase())}</Notice>
            </div>
          {/if}
        </div>
      {/each}
    {/if}
  </SettingsSection>
{/if}

<style>
  .row-extra {
    flex: 1 0 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
  }
  .swap {
    display: inline-grid;
  }
  .swap > span {
    grid-area: 1 / 1;
  }
  .swap > .off {
    visibility: hidden;
  }
</style>
