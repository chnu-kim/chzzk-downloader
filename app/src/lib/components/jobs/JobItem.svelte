<script lang="ts">
  // 다운로드 목록 행(docs/design/system/patterns.md §3.2·§10.3·§14.3). `job`과 `progress`만 보고 그리고, 동작은 전부 `onaction`으로 올린다.
  // 세로로 제목 줄 · 막대 줄 · 상태 줄(명사형 조각) · 본문 줄(해요체 한 문장) · 동작 줄이 쌓인다. 상태 레일은 없다(ADR-0003):
  // 상태는 막대 색 + 아이콘 + 글자 세 겹으로 말한다(색만으로 말하지 않는다).
  import type { JobDto, ProgressDto } from '../../bindings';
  import { t } from '../../copy/ko';
  import { sizeBaseOf } from '../../format/bytes';
  import {
    barView,
    blockCopyKey,
    bodyLine,
    cancelLabel,
    failedCopy,
    jobActionIcon,
    jobActionLabel,
    jobButtons,
    isWaitingNetwork,
    statusLine,
    statusParts,
    type JobAction,
    type JobBlock,
  } from '../../jobs';
  import { kindTone } from '../../receive';
  import { platform } from '../../stores/platform.svelte';
  import { ETA_REFRESH_MS } from '../../timing';
  import Badge from '../ui/Badge.svelte';
  import Button from '../ui/Button.svelte';
  import { isImeKey } from '../ui/focus';
  import Menu from '../ui/Menu.svelte';
  import Notice from '../ui/Notice.svelte';
  import ProgressBar from '../ui/ProgressBar.svelte';
  import type { ProgressState } from '../ui/vocab';

  interface Props {
    job: JobDto;
    progress: ProgressDto | null;
    /** 이 작업이 지금까지 보인 가장 큰 퍼센트(P-4). 스토어가 작업별로 기억한다 */
    floor: number;
    /** 대기 줄에서 앞에 선 수 */
    ahead: number;
    runStartedAt: number | null;
    /** 연결 대기에 들어온 것을 처음 본 시각(ms). 없으면 대기 중이 아니다 */
    waitingSince?: number | null;
    /** 연결 대기에서 막 풀려 회복 줄을 보이는 동안 */
    recovered?: boolean;
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
    floor,
    ahead,
    runStartedAt,
    waitingSince = null,
    recovered = false,
    cookiesEnabled,
    block,
    highlighted,
    tabbable,
    onaction,
    onkeydown,
    onfocus,
    el = $bindable(null),
  }: Props = $props();

  const uid = $props.id();
  const tone = $derived(kindTone(job.kind, job.playbackKind));
  const bar = $derived(barView(job, progress, floor));
  const waiting = $derived(isWaitingNetwork(job, progress));
  // 연결 대기 중에는 진행률 이벤트가 없어도 경과 시간(`{elapsed}째`)이 흐른다: 대기 중일 때만 1초 시계를 켠다
  let now = $state(Date.now());
  $effect(() => {
    if (!waiting) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), ETA_REFRESH_MS);
    return () => clearInterval(timer);
  });
  const base = $derived(sizeBaseOf(platform.os));
  const parts = $derived(
    statusParts(job, progress, { ahead, runStartedAt, base, waitingSince, now: waiting ? now : undefined }),
  );
  const buttons = $derived(jobButtons(job, progress, cookiesEnabled, block));
  const cancel = $derived(cancelLabel(job, progress));
  const err = $derived(job.status === 'failed' ? failedCopy(job, cookiesEnabled) : null);
  const body = $derived(bodyLine(job, progress, { base, recovered }));
  const missing = $derived(job.status === 'completed' && job.missing);
  /** 제목 전체 보기(행 아래 인라인 펼침). 잘린 제목에 키보드·터치로 닿는 길이다 */
  let titleOpen = $state(false);

  const menuItems = $derived(
    buttons.menu.map((a) => ({
      id: a,
      label: jobActionLabel(a, platform.os),
      icon: jobActionIcon(a),
      tone: a === 'remove' ? ('danger' as const) : ('neutral' as const),
      onclick: () => (a === 'showTitle' ? (titleOpen = !titleOpen) : onaction(a)),
    })),
  );
  // barView는 tone·striped로 말한다. ProgressBar는 state 넷이다.
  const barState = $derived<ProgressState>(
    !bar ? 'active' : bar.striped ? 'waiting' : bar.tone === 'danger' ? 'failed' : bar.tone === 'muted' ? 'paused' : 'active',
  );

  // IME 조합 중의 키는 항목이 받지 않는다(DX6). 안쪽 버튼·메뉴의 키는 목록이 걸러 낸다
  function handleKeydown(e: KeyboardEvent) {
    if (isImeKey(e)) return;
    onkeydown(e);
  }
</script>

{#snippet statusText(text: string)}
  <span class="job-status num">{text}</span>
{/snippet}

<!-- 항목은 버튼이 아니라 키보드 이동 대상이다(patterns.md §8 roving tabindex: 위·아래·Space·Enter·Delete).
     role="group"은 비대화형이라 tabindex·keydown에 a11y 경고가 나지만, 안쪽 버튼과 따로 항목 자체가 포커스를 받아야 한다. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<article
  bind:this={el}
  class="item"
  class:new={highlighted}
  class:failed={job.status === 'failed'}
  data-job-id={job.id}
  aria-label={job.title}
  aria-describedby={block ? `${uid}-blocked` : undefined}
  tabindex={tabbable ? 0 : -1}
  onkeydown={handleKeydown}
  onfocusin={onfocus}
>
  <div class="job-head">
    <span class="job-title">{job.title}</span>
    <Badge kind={tone} />
    <span class="job-quality num">{job.qualityLabel}</span>
  </div>

  {#if bar}
    <div class="job-bar">
      <!-- 준비 중은 value = null 막대다(행 안에는 스피너를 두지 않는다, P-8) -->
      <ProgressBar value={bar.value} state={barState} valuetext={bar.valueText} label={job.title} />
      <span class="job-pct num">{bar.percent ?? ''}</span>
    </div>
  {/if}

  {#if err}
    <Notice variant="row" tone="danger">{@render statusText(err.title)}</Notice>
  {:else if missing}
    <Notice variant="row" tone="warning">{@render statusText(statusLine(parts))}</Notice>
  {:else if job.status === 'completed'}
    <Notice variant="row" tone="neutral" icon="check">{@render statusText(statusLine(parts))}</Notice>
  {:else if parts.length}
    <Notice variant="row" tone="neutral">{@render statusText(statusLine(parts))}</Notice>
  {/if}

  {#if err && !block}
    <!-- 막힌 작업은 다시 시도할 버튼이 없으므로 '다시 시도해 주세요' 같은 본문을 숨기고 막힌 이유만 둔다(app.md 구현 중 변경 63) -->
    {#if err.body}<p class="job-body indent">{err.body}</p>{/if}
    {#if err.detail}<p class="job-body indent detail selectable">{err.detail}</p>{/if}
  {/if}
  <!-- 본문 줄: 연결 대기 · 회복 직후 · 멈춘 지 30일 · 완료(파일 없음)·건너뜀. 실패 작업은 위 오류 본문 아래에 멈춘 지 30일 줄만 더한다 -->
  {#if body}
    <p class="job-body" class:indent={missing || !!err}>{body}</p>
  {/if}

  {#if block}
    <Notice variant="row" tone="warning" id="{uid}-blocked">{@render statusText(t(blockCopyKey(block)))}</Notice>
  {/if}

  <div class="job-actions">
    {#each buttons.primary as a (a)}
      <Button variant="ghost" size="sm" icon={jobActionIcon(a)} onclick={() => onaction(a)}>
        {jobActionLabel(a, platform.os)}
      </Button>
    {/each}
    {#if buttons.cancel}
      <Button
        variant="ghost"
        size="sm"
        tone={cancel.tone}
        aria-label={t('a11y.cancelJob', { title: job.title })}
        onclick={() => onaction('cancel')}
      >
        {cancel.label}
      </Button>
    {/if}
    <span class="job-more">
      <Menu size="sm" label={t('a11y.more', { title: job.title })} items={menuItems} />
    </span>
  </div>

  {#if titleOpen}
    <p class="job-fulltitle selectable">{job.title}</p>
  {/if}
</article>

<style>
  .item {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-12) var(--space-16);
    border-radius: inherit;
    background: transparent;
    transition: background-color var(--motion-base) var(--ease-out);
  }
  /* 새 항목 강조: 클래스가 붙어 있는 동안(HIGHLIGHT_MS) 면을 칠하고, 떨어지면 --motion-base로 사라진다(reduce면 즉시) */
  .item.new {
    background: var(--accent-soft);
  }

  .job-head {
    display: flex;
    align-items: flex-start;
    gap: var(--space-4);
    min-width: 0;
  }
  /* 제목은 2줄까지 보여 끝에서 갈리는 "1부/2부"를 구별한다. 종류 배지는 제목 뒤 */
  .job-title {
    display: -webkit-box;
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow-wrap: anywhere;
    line-height: var(--leading-body);
  }
  .job-quality {
    flex: none;
    margin-inline-start: auto;
    padding-inline-start: var(--space-8);
    color: var(--fg-muted);
  }

  .job-bar {
    display: flex;
    align-items: center;
    gap: var(--space-12);
    min-width: 0;
    line-height: var(--leading-body);
  }
  .job-pct {
    flex: none;
    width: var(--pct-w);
    text-align: end;
    font-weight: var(--weight-regular);
  }

  /* 상태 줄: 명사형 조각, 말줄임 */
  .job-status {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-muted);
  }

  /* 본문 줄: 해요체 한 문장. 아이콘이 있는 상태 줄 밑에서는 아이콘 폭만큼 들여쓴다(§10.3) */
  .job-body {
    margin: 0;
    color: var(--fg-muted);
    line-height: var(--leading-read);
  }
  .job-body.indent {
    padding-inline-start: calc(var(--icon-sm) + var(--space-8));
  }
  .job-body.detail {
    overflow-wrap: anywhere;
  }

  /* 동작 줄: 자기 줄이라 폭이 좁아도 접히지 않는다. [⋯]는 오른쪽 끝(edge-end 보정) */
  .job-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: var(--gap-sibling);
    min-height: var(--control-h-sm);
  }
  .job-more {
    margin-inline-end: calc(0px - var(--space-4));
  }

  .job-fulltitle {
    margin: 0;
    overflow-wrap: anywhere;
    line-height: var(--leading-read);
  }
</style>
