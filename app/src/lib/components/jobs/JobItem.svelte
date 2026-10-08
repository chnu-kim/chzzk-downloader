<script lang="ts">
  // 다운로드 목록 항목(§8.5, ui-visual §6.5). `job`과 `progress`만 보고 그리고, 동작은 전부 `onaction`으로 올린다.
  // 왼쪽 3px 레일 + 아이콘 + 문구로 상태를 세 겹으로 말한다(색만으로 말하지 않는다).
  import type { JobDto, ProgressDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import {
    barView,
    failedCopy,
    blockCopyKey,
    isAccentAction,
    jobActionIcon,
    jobActionLabel,
    jobButtons,
    statusParts,
    type JobAction,
    type JobBlock,
  } from '../../jobs';
  import { kindLabel, kindTone } from '../../receive';
  import Badge from '../ui/Badge.svelte';
  import Button from '../ui/Button.svelte';
  import Icon from '../ui/Icon.svelte';
  import IconButton from '../ui/IconButton.svelte';
  import Menu, { type MenuItem } from '../ui/Menu.svelte';
  import ProgressBar from '../ui/ProgressBar.svelte';
  import Spinner from '../ui/Spinner.svelte';

  interface Props {
    job: JobDto;
    progress: ProgressDto | null;
    /** 대기 줄에서 앞에 선 수 */
    ahead: number;
    runStartedAt: number | null;
    cookiesEnabled: boolean;
    /** 이어받기를 셸이 거부할 작업이면 이유(A5). 안내를 보이고 이어받기 계열 버튼을 뺀다 */
    block: JobBlock | null;
    highlighted: boolean;
    /** roving tabindex: 목록에서 하나만 0 */
    tabbable: boolean;
    onaction: (a: JobAction) => void;
    onkeydown: (e: KeyboardEvent) => void;
    onfocus: () => void;
    el?: HTMLElement | null;
  }

  let {
    job,
    progress,
    ahead,
    runStartedAt,
    cookiesEnabled,
    block,
    highlighted,
    tabbable,
    onaction,
    onkeydown,
    onfocus,
    el = $bindable(null),
  }: Props = $props();

  const tone = $derived(kindTone(job.kind, job.playbackKind));
  const bar = $derived(barView(job, progress));
  const parts = $derived(statusParts(job, progress, { ahead, runStartedAt }));
  const buttons = $derived(jobButtons(job, progress, cookiesEnabled, block));
  const err = $derived(job.status === 'failed' ? failedCopy(job, cookiesEnabled) : null);
  const rail = $derived(railOf(job.status));
  const busy = $derived(
    (job.status === 'running' && (!progress || progress.phase === 'resolving')) || job.status === 'pausing',
  );
  const menuItems: MenuItem[] = $derived(
    buttons.menu.map((a) => ({
      label: jobActionLabel(a),
      icon: jobActionIcon(a),
      danger: a === 'remove',
      onselect: () => onaction(a),
    })),
  );

  function railOf(s: JobDto['status']): 'accent' | 'muted' | 'danger' | 'success' | 'idle' {
    switch (s) {
      case 'running':
        return 'accent';
      case 'pausing':
      case 'paused':
      case 'interrupted':
        return 'muted';
      case 'failed':
        return 'danger';
      case 'completed':
        return 'success';
      default:
        return 'idle';
    }
  }
</script>

<!-- 항목은 버튼이 아니라 키보드 이동 대상이다(§10 roving tabindex: 위·아래·Space·Enter·Delete).
     role="group"은 비대화형이라 tabindex·keydown에 a11y 경고가 나지만, 안쪽 버튼과 따로 항목 자체가 포커스를 받아야 한다. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<article
  bind:this={el}
  class="item rail-{rail}"
  class:failed={job.status === 'failed'}
  class:new={highlighted}
  data-job-id={job.id}
  aria-label={job.title}
  aria-describedby={block ? `job-${job.id}-blocked` : undefined}
  tabindex={tabbable ? 0 : -1}
  {onkeydown}
  onfocusin={onfocus}
>
  <div class="row title-row">
    <Badge {tone} title={tone === 'rewind' ? t('kind.liveRewind.tip') : undefined}>{kindLabel(tone)}</Badge>
    <span class="title" title={job.title}>{job.title}</span>
    <span class="quality">{job.qualityLabel}</span>
  </div>

  {#if bar}
    <div class="row bar-row">
      <div class="bar">
        <ProgressBar value={bar.value} tone={bar.tone} striped={bar.striped} valueText={bar.valueText} label={job.title} />
      </div>
      {#if bar.percent}<span class="percent tnum">{bar.percent}</span>{/if}
    </div>
  {/if}

  {#if err}
    <div class="error">
      <span class="err-icon"><Icon name="alert" /></span>
      <div>
        <p class="err-title">{err.title}</p>
        <!-- 막힌 작업은 다시 시도할 버튼이 없으므로 '다시 시도해 주세요' 같은 본문을 숨기고 막힌 이유만 둔다(app.md 구현 중 변경 A5-1) -->
        {#if !block}
          {#if err.body}<p class="err-body">{err.body}</p>{/if}
          {#if err.detail}<p class="err-body detail">{err.detail}</p>{/if}
        {/if}
      </div>
    </div>
  {/if}

  <div class="row status-row">
    {#if parts.length}
      <p class="status tnum">
        {#if busy}<span class="lead"><Spinner size={16} /></span>
        {:else if job.status === 'completed' && !job.missing}<span class="lead ok"><Icon name="check" size={16} /></span>
        {:else if job.status === 'paused' || job.status === 'interrupted'}<span class="lead"><Icon name="pause" size={16} /></span>
        {/if}
        <!-- 조각 사이 빈칸은 문자열로만 넣는다(태그 사이 줄바꿈 빈칸이 끼면 `·  2.3 GB`처럼 두 칸이 된다) -->
        {#each parts as part, i (i)}{#if i > 0 && !part.faint}<span class="dot" class:wide-only={part.wideOnly} aria-hidden="true"
              >{' · '}</span
            >{:else if i > 0}{' '}{/if}<span class:value={part.value} class:faint={part.faint} class:wide-only={part.wideOnly}
            >{part.text}</span
          >{/each}
      </p>
    {:else}
      <span class="status"></span>
    {/if}
    <div class="actions">
      {#each buttons.primary as a (a)}
        <Button size="sm" icon={jobActionIcon(a)} accentText={isAccentAction(a)} onclick={() => onaction(a)}>
          {jobActionLabel(a)}
        </Button>
      {/each}
      {#if buttons.cancel}
        <IconButton icon="x" label="{t('action.cancel')}: {job.title}" onclick={() => onaction('cancel')} />
      {/if}
      <Menu label={t('job.more', { title: job.title })} items={menuItems} />
    </div>
  </div>

  {#if block}
    <p class="blocked" id="job-{job.id}-blocked">
      <span class="lead"><Icon name="alert" size={16} /></span>{t(blockCopyKey(block))}
    </p>
  {/if}
</article>

<style>
  .item {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4) var(--space-3) calc(var(--space-4) + var(--rail-w));
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }
  /* 왼쪽 레일: 항목 전체를 덮는 층에 레일 폭만 칠하고, 그 층을 테두리 안쪽 radius로 깎는다.
     항목 자체를 overflow로 깎으면 [⋯] 메뉴가 잘리고, 메뉴 항목에 포커스를 줄 때 항목 안이 스크롤된다. */
  .item::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: calc(var(--radius-md) - 1px);
    background: linear-gradient(to right, var(--rail-color) var(--rail-w), transparent var(--rail-w));
    pointer-events: none;
  }
  .item {
    --rail-color: var(--border-strong);
  }
  .rail-accent {
    --rail-color: var(--accent);
  }
  .rail-muted {
    --rail-color: var(--fg-muted);
  }
  .rail-danger {
    --rail-color: var(--danger);
  }
  .rail-success {
    --rail-color: var(--success);
  }
  .item.failed {
    border-color: var(--danger);
  }
  /* 키보드 포커스: 항목 테두리가 포커스 링이 된다. hover는 아무것도 바꾸지 않는다(항목은 버튼이 아니다) */
  .item:focus-visible {
    outline: none;
    border-color: var(--focus);
    box-shadow: var(--focus-ring);
  }
  .item.new {
    animation: highlight var(--dur-highlight) var(--ease-out);
  }
  @keyframes highlight {
    from {
      background: var(--accent-soft);
    }
    to {
      background: var(--surface);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .item.new {
      animation: none;
    }
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
  }
  .quality {
    flex: none;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .bar {
    flex: 1;
  }
  .percent {
    flex: none;
    min-width: 3ch;
    text-align: right;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
  }
  .blocked {
    display: flex;
    gap: var(--space-1);
    align-items: center;
    margin: 0;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .status-row {
    flex-wrap: wrap;
    justify-content: space-between;
    row-gap: var(--space-2);
  }
  .status {
    flex: 1 1 auto;
    margin: 0;
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .lead {
    display: inline-flex;
    vertical-align: -3px;
    margin-right: var(--space-1);
  }
  .lead.ok {
    color: var(--success);
  }
  .value {
    color: var(--fg);
  }
  .faint {
    color: var(--fg-faint);
  }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin-left: auto;
  }
  .error {
    display: flex;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--danger-soft);
  }
  .err-icon {
    color: var(--danger);
  }
  .err-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: var(--weight-semibold);
    color: var(--danger);
  }
  .err-body {
    margin: 2px 0 0;
    font-size: var(--text-sm);
    color: var(--fg);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
  /* 폭 720~839: HLS "조각 …" 숨김(ui-visual §8) */
  @media (max-width: 839px) {
    .wide-only {
      display: none;
    }
  }
</style>
