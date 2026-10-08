<script lang="ts">
  // 로그인 화면(S3, worker.md §11.7, 구현 중 변경 A3-1). 뷰가 아니라 App의 게이트 분기다: 잠긴 동안 본문은 이것뿐이다.
  // 스스로 authLogin을 부르지 않는다(설치 스모크는 자리표시 주소로 auth:true다). 문구·버튼은 loginScreen 표가 정한다.
  import { tick } from 'svelte';
  import { loginScreen, remainingSecs } from '../auth';
  import { t } from '../copy/ko';
  import Button from '../components/ui/Button.svelte';
  import Icon from '../components/ui/Icon.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { formatMmss } from '../format/duration';
  import { auth } from '../stores/auth.svelte';
  import { jobs } from '../stores/jobs.svelte';

  const status = $derived(auth.status);
  const screen = $derived(status ? loginScreen(status) : null);
  const pending = $derived(status?.state === 'pending' ? status.pending : null);

  // 남은 시간: pending일 때만 1초마다 다시 계산한다
  let now = $state(Date.now());
  $effect(() => {
    if (!pending) return;
    now = Date.now();
    const h = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(h);
  });

  function run(action: 'login' | 'reconnect') {
    if (action === 'login') void auth.login();
    else void auth.reconnect();
  }

  // 화면이 바뀌면(누른 버튼이 사라진다) 포커스가 body로 떨어지니 제목으로 옮긴다
  let lastKey = '';
  $effect(() => {
    const k = `${status?.state}:${status?.reason ?? ''}`;
    if (k === lastKey) return;
    lastKey = k;
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      document.querySelector<HTMLElement>('[data-view-heading]')?.focus();
    });
  });
</script>

{#if screen}
  <section class="panel" aria-labelledby="login-title">
    <span class="mark"><Icon name="drop" size={32} /></span>
    {#if screen.kind === 'checking'}
      <Spinner size={20} />
    {/if}
    <h2 id="login-title" class="title" tabindex="-1" data-view-heading>
      {#if screen.problem}<span class="alert"><Icon name="alert" size={20} /></span>{/if}
      {screen.title}
    </h2>

    {#if screen.kind === 'pending' && pending}
      <p class="sub">{t('auth.pending.code')}</p>
      <p class="code" aria-label={t('auth.pending.codeLabel', { code: pending.userCode })}>{pending.userCode}</p>
      <p class="remain">{t('auth.pending.body', { mmss: formatMmss(remainingSecs(pending.expiresAt, now)) })}</p>
      <div class="buttons">
        <Button variant="primary" disabled={auth.busy} onclick={() => void auth.reopen()}>{t('auth.reopen')}</Button>
        <Button disabled={auth.busy} onclick={() => void auth.cancel()}>{t('auth.cancel')}</Button>
      </div>
      <p class="help">
        {t('auth.browserHelp')}
        <Button variant="link" size="sm" disabled={auth.busy} onclick={() => void auth.copyLoginUrl()}>
          {t('auth.copyLoginUrl')}
        </Button>
      </p>
    {:else}
      {#if screen.body}<p class="body" role={screen.problem ? 'alert' : undefined}>{screen.body}</p>{/if}
      {#if screen.buttons.length > 0}
        <div class="buttons">
          {#each screen.buttons as b (b.action + b.label)}
            <Button variant={b.variant} disabled={auth.busy} onclick={() => run(b.action)}>{b.label}</Button>
          {/each}
        </div>
      {/if}
      {#if auth.reconnectFailed}<p class="help" role="status">{t('auth.reconnectFailed')}</p>{/if}
    {/if}

    {#if screen.otherAccountHelp}<p class="help">{t('auth.otherAccount.help')}</p>{/if}

    {#if jobs.runningCount > 0}
      <p class="note">{t('auth.runningNote', { n: jobs.runningCount })}</p>
    {:else if jobs.interruptedCount > 0}
      <p class="note">{t('banner.resumeNeedsLogin', { n: jobs.interruptedCount })}</p>
    {/if}
  </section>
{/if}

<style>
  .panel {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    box-sizing: border-box;
    width: min(420px, calc(100% - 2 * var(--gutter)));
    margin: var(--space-12) auto;
    padding: var(--space-6);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface);
    text-align: center;
  }
  .mark {
    color: var(--accent);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--text-xl);
    font-weight: var(--weight-semibold);
    letter-spacing: var(--tracking-tight);
  }
  .alert {
    display: inline-flex;
    color: var(--danger);
  }
  .body,
  .sub,
  .remain,
  .help,
  .note {
    margin: 0;
  }
  .body {
    font-size: var(--text-md);
    color: var(--fg-muted);
  }
  .sub,
  .help,
  .note {
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .code {
    margin: 0;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-family: var(--font-mono);
    font-size: 1.5rem;
    font-weight: var(--weight-semibold);
    letter-spacing: 0.08em;
    user-select: all;
  }
  .remain {
    font-size: var(--text-md);
    font-variant-numeric: tabular-nums;
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2);
  }
  .note {
    align-self: stretch;
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  /* 화면이 바뀔 때 프로그램으로 주는 포커스라 링을 보이지 않는다(전역 :focus-visible은 box-shadow다) */
  .title:focus {
    outline: none;
    box-shadow: none;
  }
</style>
