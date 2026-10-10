<script lang="ts">
  // 다운로드 목록(docs/design/system/patterns.md §2.4·§3·§4·§14.3): 머리(완료 항목 지우기) · 그룹 · 행 · 빈 상태 · D2(취소 확인) · D7(덮어쓰기 확인).
  // 키보드: 행 사이 위·아래(roving tabindex), Space 일시정지·이어받기, Enter 기본 동작, Delete 지우기·취소(§8 단축키).
  import { onDestroy, tick, untrack } from 'svelte';
  import type { JobDto, JobId } from '../../bindings';
  import { t } from '../../copy/ko';
  import {
    deleteAction,
    enterAction,
    jobBlock,
    jobButtons,
    queueAhead,
    shownJobs,
    spaceAction,
    type JobAction,
  } from '../../jobs';
  import { auth } from '../../stores/auth.svelte';
  import { jobs } from '../../stores/jobs.svelte';
  import { power } from '../../stores/power.svelte';
  import { settings } from '../../stores/settings.svelte';
  import OverwriteDialog from '../app/OverwriteDialog.svelte';
  import Button from '../ui/Button.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import EmptyState from '../ui/EmptyState.svelte';
  import { isImeKey } from '../ui/focus';
  import Surface from '../ui/Surface.svelte';
  import JobItem from './JobItem.svelte';

  const uid = $props.id();

  let listEl: HTMLElement | null = $state(null);
  let headingEl: HTMLHeadingElement | null = $state(null);
  /** 목록 안에서 마지막으로 포커스를 가진 행과 그 자리(지워지면 이웃으로 옮긴다) */
  let focusedId: JobId | null = $state(null);
  let focusedIndex = 0;

  const tabbableId = $derived(
    focusedId != null && jobs.order.includes(focusedId) ? focusedId : (jobs.order[0] ?? null),
  );

  /**
   * 빈 상태 두 종류(J13). 기록이 없으면 첫 실행 안내, 있으면(비운 뒤) 한 줄이다: 비운 뒤에 첫 실행 안내를
   * 되풀이하면 거짓이 된다(patterns.md §2.4). 설정을 아직 모르면 아무것도 그리지 않는다(로딩 중에 "없음"을 먼저 보이지 않는다).
   */
  const emptyKind = $derived.by(() => {
    const dto = settings.dto;
    if (!jobs.ready || jobs.groups.length > 0 || !dto) return null;
    return dto.recentVods.length === 0 && dto.lastUrl == null ? 'first' : 'cleared';
  });

  function itemEl(id: JobId): HTMLElement | null {
    return listEl?.querySelector<HTMLElement>(`[data-job-id="${id}"]`) ?? null;
  }

  function focusItem(id: JobId) {
    const el = itemEl(id);
    if (!el) return;
    el.focus();
    el.scrollIntoView?.({ block: 'nearest' });
  }

  function onfocus(job: JobDto) {
    focusedId = job.id;
    focusedIndex = jobs.order.indexOf(job.id);
  }

  // 목록 밖으로 포커스가 나가면 잊는다(나중에 그 행이 지워져도 포커스를 빼앗지 않게)
  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && listEl?.contains(next)) return;
    if (next) focusedId = null;
  }

  // 포커스를 가진 행이 사라지면(취소·지우기·숨김·접힘) 포커스가 body로 떨어진다. 다음 행 → 이전 행 → 목록 제목으로 옮긴다(F-4).
  $effect(() => {
    const order = jobs.order;
    const id = focusedId;
    if (id == null || order.includes(id)) return;
    const active = document.activeElement;
    if (active && active !== document.body && !listEl?.contains(active)) return;
    focusedId = null;
    void tick().then(() => {
      const next = order[Math.min(focusedIndex, order.length - 1)];
      if (next != null) focusItem(next);
      else headingEl?.focus();
    });
  });

  // [목록에서 보기]·다른 곳에서 행을 보여 달라고 할 때. 요청은 한 번 쓰고 비운다(남겨 두면 설정에서 돌아와
  // 목록이 다시 그려질 때 옛 행으로 포커스를 빼앗는다).
  $effect(() => {
    const req = jobs.focusRequest;
    if (!req) return;
    untrack(() => (jobs.focusRequest = null));
    void tick().then(() => focusItem(req.id));
  });

  // D2·D7은 이 목록 안에 있다. 열린 채 뷰가 바뀌면(Mod+,) 돌아왔을 때 다시 뜨지 않게 닫는다.
  onDestroy(() => {
    jobs.cancelConfirm();
    jobs.cancelOverwrite();
  });

  function onkeydown(e: KeyboardEvent, job: JobDto) {
    if (isImeKey(e)) return;
    // 행 안 버튼·메뉴의 키는 그쪽이 받는다(Space·Enter가 두 번 돌지 않게)
    if (e.target !== e.currentTarget) return;
    const order = jobs.order;
    const i = order.indexOf(job.id);
    const b = jobButtons(job, jobs.state.progress.get(job.id), settings.cookiesEnabled, jobBlock(job, auth.status));
    let action: JobAction | null = null;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (i < order.length - 1) focusItem(order[i + 1]);
        return;
      case 'ArrowUp':
        e.preventDefault();
        if (i > 0) focusItem(order[i - 1]);
        return;
      case 'Home':
        e.preventDefault();
        if (order.length) focusItem(order[0]);
        return;
      case 'End':
        e.preventDefault();
        if (order.length) focusItem(order[order.length - 1]);
        return;
      case ' ':
        action = spaceAction(b);
        break;
      case 'Enter':
        action = enterAction(job, b);
        break;
      case 'Delete':
      case 'Backspace':
        action = deleteAction(job, b);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (action) void jobs.request(job.id, action);
  }
</script>

{#snippet rows(list: readonly JobDto[])}
  <ul class="job-list">
    {#each list as job (job.id)}
      <li>
        <JobItem
          {job}
          progress={jobs.state.progress.get(job.id) ?? null}
          floor={jobs.state.percent.get(job.id) ?? 0}
          ahead={queueAhead(jobs.queueOrder, job.id)}
          runStartedAt={jobs.runStartedAt.get(job.id) ?? null}
          waitingSince={jobs.waitingSince.get(job.id) ?? null}
          recovered={jobs.recovered.has(job.id)}
          cookiesEnabled={settings.cookiesEnabled}
          block={jobBlock(job, auth.status)}
          highlighted={jobs.highlight.has(job.id)}
          tabbable={tabbableId === job.id}
          onaction={(a) => void jobs.request(job.id, a)}
          onkeydown={(e) => onkeydown(e, job)}
          onfocus={() => onfocus(job)}
        />
      </li>
    {/each}
  </ul>
{/snippet}

<section class="list" aria-labelledby="{uid}-title">
  <div class="list-head">
    <h2 id="{uid}-title" class="list-title" tabindex="-1" data-focus-container bind:this={headingEl}>{t('list.title')}</h2>
    <!-- 지울 것이 없으면 버튼이 없다. 도움말은 읽어 주기만 한다(파일은 그대로라는 안심) -->
    {#if jobs.hasFinished}
      <Button
        variant="ghost"
        size="sm"
        class="edge-end"
        aria-describedby="{uid}-clear-help"
        onclick={() => jobs.clearFinished()}
      >
        {t('list.clearFinished')}
      </Button>
      <span id="{uid}-clear-help" class="sr-only">{t('list.clearFinished.help')}</span>
    {/if}
  </div>

  {#if emptyKind === 'first'}
    <Surface variant="group">
      <EmptyState
        title={t('list.empty.title')}
        steps={[t('list.empty.step1'), t('list.empty.step2'), t('list.empty.step3')]}
      >
        {t('list.empty.scope')}
      </EmptyState>
    </Surface>
  {:else if emptyKind === 'cleared'}
    <EmptyState variant="inline">{t('list.cleared')}</EmptyState>
  {:else}
    <div class="groups" bind:this={listEl} onfocusout={onfocusout}>
      {#each jobs.groups as group (group.id)}
        <section class="job-group" aria-labelledby={group.foldable ? undefined : `${uid}-${group.id}`}>
          {#if group.foldable}
            <!-- 완료 11개부터 기본 접힘. 머리 줄이 토글이고, 접힌 동안은 최신 5개만, 펼치면 전부 같은 그룹 상자 안에 보인다 -->
            <Disclosure variant="group" title={group.label} heading="h3" bind:open={jobs.finishedOpen}>
              <Surface variant="group">{@render rows(shownJobs(group, jobs.finishedOpen))}</Surface>
            </Disclosure>
          {:else}
            <div class="group-head">
              <h3 id="{uid}-{group.id}" class="group-title num">{group.label}</h3>
              <!-- 받는 동안 컴퓨터가 잠들지 않게 붙들고 있을 때만(셸이 보호를 실제로 얻었을 때 `keep-awake`가 true, platform.md §15) -->
              {#if group.id === 'running' && power.keepingAwake}
                <span class="group-note">{t('power.keepingAwake')}</span>
              {/if}
            </div>
            <Surface variant="group">{@render rows(group.jobs)}</Surface>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</section>

<ConfirmDialog
  open={jobs.confirm != null}
  title={t('dialog.cancel.title', { title: jobs.confirm?.title ?? '' })}
  body={t('dialog.cancel.body', { size: jobs.confirmSize })}
  onclose={() => jobs.cancelConfirm()}
  primary={{
    id: 'back',
    label: t(jobs.confirm?.running === false ? 'dialog.cancel.keepPaused' : 'dialog.cancel.keepRunning'),
    onclick: () => jobs.cancelConfirm(),
  }}
  secondary={{ id: 'confirm', label: t('dialog.cancel.confirm'), tone: 'danger', onclick: () => void jobs.confirmRemove() }}
/>

<OverwriteDialog
  open={jobs.overwrite != null}
  name={jobs.overwrite?.name ?? ''}
  onconfirm={() => void jobs.confirmOverwrite()}
  onclose={() => jobs.cancelOverwrite()}
/>

<style>
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-sibling);
    min-height: var(--control-h-sm);
    margin-bottom: var(--gap-label);
  }
  .list-title {
    margin: 0;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-strong);
  }

  /* 그룹 머리: 캡션 크기 600 muted, 개수는 tabular */
  .job-group + .job-group {
    margin-top: var(--space-16);
  }
  .group-head {
    display: flex;
    align-items: baseline;
    gap: var(--space-8);
    margin: 0 0 var(--gap-label);
    min-width: 0;
  }
  .group-note {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    color: var(--fg-muted);
  }
  .group-title {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
    font-weight: var(--weight-strong);
    color: var(--fg-muted);
  }

  /* 행 사이는 1px 선. 첫·끝 행은 그룹 상자의 반경을 따라가 강조 면이 모서리를 넘지 않는다 */
  .job-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .job-list > li + li {
    border-top: 1px solid var(--separator);
  }
  .job-list > li:first-child {
    border-top-left-radius: var(--radius-group);
    border-top-right-radius: var(--radius-group);
  }
  .job-list > li:last-child {
    border-bottom-left-radius: var(--radius-group);
    border-bottom-right-radius: var(--radius-group);
  }
</style>
