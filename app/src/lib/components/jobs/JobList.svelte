<script lang="ts">
  // 다운로드 목록(§10 JobList): 헤더(완료 항목 지우기) · 그룹 · 항목 · 빈 상태 · D2(취소 확인).
  // 키보드: 항목 사이 위·아래(roving tabindex), Space 일시정지·이어받기, Enter 기본 동작, Delete 지우기·취소(§10 단축키).
  import { onDestroy, tick, untrack } from 'svelte';
  import type { JobDto, JobId } from '../../bindings';
  import { t } from '../../copy/ko';
  import {
    deleteAction,
    enterAction,
    jobBlock,
    jobButtons,
    queueAhead,
    spaceAction,
    type JobAction,
  } from '../../jobs';
  import { auth } from '../../stores/auth.svelte';
  import { jobs } from '../../stores/jobs.svelte';
  import { settings } from '../../stores/settings.svelte';
  import Button from '../ui/Button.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';
  import Icon from '../ui/Icon.svelte';
  import JobItem from './JobItem.svelte';

  let listEl: HTMLElement | null = $state(null);
  let headingEl: HTMLHeadingElement | null = $state(null);
  /** 목록 안에서 마지막으로 포커스를 가진 항목과 그 자리(지워지면 이웃으로 옮긴다) */
  let focusedId: JobId | null = $state(null);
  let focusedIndex = 0;

  const tabbableId = $derived(
    focusedId != null && jobs.order.includes(focusedId) ? focusedId : (jobs.order[0] ?? null),
  );

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

  // 목록 밖으로 포커스가 나가면 잊는다(나중에 그 항목이 지워져도 포커스를 빼앗지 않게)
  function onfocusout(e: FocusEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && listEl?.contains(next)) return;
    if (next) focusedId = null;
  }

  // 포커스를 가진 항목이 지워지면(취소·지우기·완료 정리) 포커스가 body로 떨어진다. 이웃 항목이나 목록 제목으로 옮긴다.
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

  // [목록에서 보기]·다른 곳에서 항목을 보여 달라고 할 때. 요청은 한 번 쓰고 비운다(남겨 두면 설정에서 돌아와
  // 목록이 다시 그려질 때 옛 항목으로 포커스를 빼앗는다).
  $effect(() => {
    const req = jobs.focusRequest;
    if (!req) return;
    untrack(() => (jobs.focusRequest = null));
    void tick().then(() => focusItem(req.id));
  });

  // D2는 이 목록 안에 있다. 열린 채 뷰가 바뀌면(Mod+,) 돌아왔을 때 다시 뜨지 않게 닫는다.
  onDestroy(() => jobs.cancelConfirm());

  function onkeydown(e: KeyboardEvent, job: JobDto) {
    // 항목 안 버튼·메뉴의 키는 그쪽이 받는다(Space·Enter가 두 번 돌지 않게)
    if (e.target !== e.currentTarget || e.isComposing) return;
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
    if (action) void jobs.act(job.id, action);
  }
</script>

<section class="list" aria-labelledby="list-title">
  <div class="head">
    <h2 id="list-title" class="list-title" tabindex="-1" bind:this={headingEl}>{t('list.title')}</h2>
    <Button variant="link" disabled={!jobs.hasFinished} onclick={() => void jobs.clearFinished()}>
      {t('list.clearFinished')}
    </Button>
  </div>

  {#if jobs.ready && jobs.order.length === 0}
    <div class="empty">
      <span class="empty-icon"><Icon name="drop" size={32} /></span>
      <p class="empty-title">{t('list.empty.title')}</p>
      <p class="empty-body">{t('list.empty.body')}</p>
    </div>
  {:else}
    <div class="groups" bind:this={listEl} onfocusout={onfocusout}>
      {#each jobs.groups as group (group.id)}
        <section class="group" aria-labelledby="group-{group.id}">
          <h3 id="group-{group.id}" class="group-title tnum">{group.label}</h3>
          <ul>
            {#each group.jobs as job (job.id)}
              <li>
                <JobItem
                  {job}
                  progress={jobs.state.progress.get(job.id) ?? null}
                  ahead={queueAhead(jobs.queueOrder, job.id)}
                  runStartedAt={jobs.runStartedAt.get(job.id) ?? null}
                  cookiesEnabled={settings.cookiesEnabled}
                  block={jobBlock(job, auth.status)}
                  highlighted={jobs.highlight.has(job.id)}
                  tabbable={tabbableId === job.id}
                  onaction={(a) => void jobs.act(job.id, a)}
                  onkeydown={(e) => onkeydown(e, job)}
                  onfocus={() => onfocus(job)}
                />
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    </div>
  {/if}
</section>

<ConfirmDialog
  open={jobs.confirm != null}
  title={t('dialog.cancel.title')}
  body={t('dialog.cancel.body', { size: jobs.confirmSize })}
  onclose={() => jobs.cancelConfirm()}
  buttons={[
    { label: t('dialog.cancel.back'), variant: 'primary', autofocus: true, onclick: () => jobs.cancelConfirm() },
    { label: t('dialog.cancel.confirm'), variant: 'danger', onclick: () => void jobs.confirmRemove() },
  ]}
/>

<style>
  .list {
    margin-top: var(--space-24);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-8);
  }
  .list-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }
  /* 뷰 전환·지운 뒤 프로그램으로 주는 포커스라 링을 보이지 않는다(전역 :focus-visible은 box-shadow다) */
  .list-title:focus {
    outline: none;
    box-shadow: none;
  }
  .group + .group {
    margin-top: var(--space-16);
  }
  .group-title {
    margin: 0 0 var(--space-8);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    color: var(--fg-muted);
  }
  ul {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-8);
    min-height: 160px;
    padding: var(--space-32) var(--space-16);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    text-align: center;
  }
  .empty-icon {
    color: var(--fg-faint);
  }
  .empty-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    line-height: var(--leading-title, 1.3);
  }
  .empty-body {
    margin: 0;
    font-size: var(--text-md);
    color: var(--fg-muted);
  }
</style>
