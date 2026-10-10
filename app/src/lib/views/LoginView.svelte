<script lang="ts">
  // 로그인 화면(S3, system/patterns.md §13, worker.md §11.7·구현 중 변경 62). 뷰가 아니라 App의 게이트 분기다: 잠긴 동안 본문은 이것뿐이다.
  // 열(폭·패딩)은 App의 PageContainer가 소유한다. 스스로 authLogin을 부르지 않는다(설치 스모크는 자리표시 주소로 auth:true다).
  // 문구·버튼은 loginScreen 표(auth.ts)가 정한다 — 이 파일은 그 표를 그릴 뿐이고 버튼 구성을 바꾸지 않는다.
  import { tick } from 'svelte';
  import * as api from '../api';
  import { loginScreen, remainingSecs } from '../auth';
  import { errorCopy, toAppError } from '../copy/errors';
  import { t } from '../copy/ko';
  import Button from '../components/ui/Button.svelte';
  import Icon from '../components/ui/Icon.svelte';
  import Notice from '../components/ui/Notice.svelte';
  import Spinner from '../components/ui/Spinner.svelte';
  import { formatMmss } from '../format/duration';
  import { auth } from '../stores/auth.svelte';
  import { jobs } from '../stores/jobs.svelte';
  import { toasts } from '../stores/toast.svelte';
  import { useDelayedLoading } from '../useDelayedLoading.svelte';

  // 남은 시간: pending일 때만 1초마다 다시 계산한다(stuck 판정도 이 값으로 한다)
  let now = $state(Date.now());
  const status = $derived(auth.status);
  const screen = $derived(status ? loginScreen(status, now) : null);
  const pending = $derived(status?.state === 'pending' ? status.pending : null);
  /** 처음 로그인하는 화면(signedOut): 비공식 고지·동의 문구·처리방침 링크가 함께 보인다(C2·C7) */
  const idle = $derived(status?.state === 'signedOut' && screen?.kind === 'message');
  // 상태 확인 스피너는 300ms 안에 끝나면 보이지 않는다(깜박임 방지, patterns.md §2.2)
  const checkingLoader = useDelayedLoading(() => screen?.kind === 'checking');

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

  /** 개인정보 처리방침: 로그인 전에도 열린다(고정 Worker 경로를 브라우저로 열 뿐이다) */
  function openPrivacy() {
    api.openWebPage('privacy').catch((e) => toasts.push(errorCopy(toAppError(e), { place: 'other' }).title, 'danger'));
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
  <div class="login">
    <section class="surface panel" aria-labelledby="login-title">
      <div class="head">
        <h2 id="login-title" class="title" tabindex="-1" data-focus-container data-view-heading>
          {#if screen.problem}<span class="alert"><Icon name="circle-x" /></span>{/if}
          {screen.title}
        </h2>
        <!-- 옆의 제목 글자가 상태를 말한다(Spinner는 글자가 없다) -->
        {#if screen.kind === 'checking' && checkingLoader.visible}<Spinner />{/if}
      </div>

      {#if screen.kind === 'pending' && pending}
        <p class="body num">{t('auth.pending.body', { mmss: formatMmss(remainingSecs(pending.expiresAt, now)) })}</p>
        <div class="buttons">
          <Button variant="primary" loading={auth.isBusy('reopen')} onclick={() => void auth.reopen()}>{t('auth.reopen')}</Button>
          <Button disabled={auth.isBusy('cancel')} onclick={() => void auth.cancel()}>{t('auth.cancel')}</Button>
        </div>
        <div class="help-block">
          <p class="help">{t('auth.browserHelp')}</p>
          <div class="link">
            <Button class="edge-start btn-inline" variant="ghost" size="sm" disabled={auth.isBusy('copy')} onclick={() => void auth.copyLoginUrl()}>
              {t('auth.copyLoginUrl')}
            </Button>
          </div>
        </div>
        <p class="help">{t('auth.pending.sameDevice')}</p>
        {#if screen.stuck}
          <p class="help" role="status">{t('auth.pending.stuck')}</p>
          <div class="buttons">
            <Button variant="secondary" disabled={auth.isBusy('login')} onclick={() => void auth.restartLogin()}>
              {t('auth.relogin')}
            </Button>
          </div>
        {/if}
      {:else}
        {#if screen.body}<p class="body" role={screen.problem ? 'alert' : undefined}>{screen.body}</p>{/if}
        {#if idle}
          <!-- 비공식 고지: 받는 것·받지 않는 것: 끊는 길이 스크롤 없이 720×520 안에 든다 -->
          <Notice tone="neutral" icon="info">{t('notice.short')}</Notice>
          <p class="body">{t('auth.consent')}</p>
        {/if}
        {#if screen.buttons.length > 0}
          <div class={['buttons', idle && 'stack']}>
            {#each screen.buttons as b (b.action + b.label)}
              <!-- loginScreen 표의 'link'는 새 어휘에 없어 작은 ghost로 그린다 -->
              {#if b.variant === 'primary'}
                <Button variant="primary" loading={auth.isBusy(b.action)} onclick={() => run(b.action)}>{b.label}</Button>
              {:else if b.variant === 'link'}
                <Button class="btn-inline" variant="ghost" size="sm" disabled={auth.isBusy(b.action)} onclick={() => run(b.action)}>{b.label}</Button>
              {:else}
                <Button variant="secondary" disabled={auth.isBusy(b.action)} onclick={() => run(b.action)}>{b.label}</Button>
              {/if}
            {/each}
          </div>
        {/if}
        {#if idle}
          <div class="link">
            <Button class="edge-start btn-inline" variant="ghost" size="sm" onclick={openPrivacy}>{t('auth.privacy')}</Button>
          </div>
        {/if}
        {#if auth.reconnectFailed}<p class="help" role="status">{t('auth.reconnectFailed')}</p>{/if}
      {/if}

      {#if screen.otherAccount === 'help'}
        <p class="help">{t('auth.otherAccount.help')}</p>
      {:else if screen.otherAccount === 'link'}
        <p class="help">
          {t('auth.otherAccount.lead')}
          <Button class="btn-inline" variant="ghost" size="sm" disabled={auth.isBusy('login')} onclick={() => run('login')}>
            {t('auth.otherAccount')}
          </Button>
        </p>
      {/if}
    </section>

    <!-- 패널 아래 한 줄: 로그인 화면이 열린 동안 받던 다운로드가 어떻게 되는지 -->
    {#if jobs.activeCount > 0}
      <p class="note">{t('auth.runningNote', { n: jobs.activeCount })}</p>
    {:else if jobs.interruptedCount > 0}
      <p class="note">{t('banner.resumeNeedsLogin', { n: jobs.interruptedCount })}</p>
    {/if}
  </div>
{/if}

<style>
  /* 가운데 정렬은 상자(패널)에만 허용한다. 글자는 왼쪽 정렬(patterns.md §13 규칙 1).
     열(PageContainer)의 위 여백 16 위에 24를 더해 패널 위 여백이 --space-40이 된다 */
  .login {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    width: var(--dialog-w);
    max-width: 100%;
    margin: calc(var(--space-40) - var(--space-16)) auto 0;
  }
  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    padding: var(--space-20);
  }
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-8);
  }
  .title {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    min-width: 0;
    color: var(--fg);
    font-size: var(--text-display);
    line-height: var(--leading-display);
    font-weight: var(--weight-strong);
  }
  .alert {
    display: inline-flex;
    color: var(--danger-ink);
  }
  .body {
    color: var(--fg);
    line-height: var(--leading-read);
  }
  .help,
  .note {
    color: var(--fg-muted);
    line-height: var(--leading-read);
  }
  .help-block {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-sibling);
  }
  /* 처음 로그인: 주 버튼이 전폭이다(열 방향 flex라 버튼이 가로로 늘어난다). 본문과 20 간격 */
  .buttons.stack {
    flex-direction: column;
    margin-top: var(--space-8);
  }
</style>
