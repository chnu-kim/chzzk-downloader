<script lang="ts">
  // 고급: 네이버 로그인 정보(patterns.md §14.4). 쿠키 입력은 사용자가 펼쳤을 때만 DOM에 있다. 저장된 쿠키 값은 Rust가 다시 보내지 않으므로 입력칸은 늘
  // 비어서 시작하고, 저장·지우기 뒤에도 비운다. "저장됨 / 저장된 값 없음"만 보인다.
  import { tick } from 'svelte';
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { shortcutText } from '../../platform';
  import { platform } from '../../stores/platform.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import FieldRow from '../ui/FieldRow.svelte';
  import Notice from '../ui/Notice.svelte';
  import SecretField from '../ui/SecretField.svelte';
  import Switch from '../ui/Switch.svelte';

  /** 네이버 로그인 쿠키 이름(문구가 아니라 코드 상수, content.md §2 기술 상수) */
  const COOKIE_A = 'NID_AUT';
  const COOKIE_B = 'NID_SES';

  let open = $state(false);
  let nidAut = $state('');
  let nidSes = $state('');
  let busy = $state(false);
  let error = $state<AppError | null>(null);
  let missing = $state(false);
  let root: HTMLElement | null = $state(null);

  /** 입력칸 오류 표시는 설명 요소(`cookie-missing`)가 반드시 있어야 한다(InvalidProps) */
  function invalidProps(bad: boolean): { invalid: true; 'aria-describedby': string } | { invalid?: false } {
    return bad ? { invalid: true, 'aria-describedby': 'cookie-missing' } : {};
  }

  const saved = $derived(settings.dto?.naverCookiesSaved ?? false);
  const enabled = $derived(settings.dto?.useNaverCookies ?? false);
  // `settings`(설정 파일을 못 씀)는 B2 배너가 알리고 다시 보낸다(46). 여기서 또 보이면 B2로 고친 뒤에도 남는다.
  const errCopy = $derived(error && error.code !== 'settings' ? errorCopy(error, { place: 'cookie' }) : null);
  const steps = $derived([
    t('settings.cookie.howto.step1'),
    t('settings.cookie.howto.step2', { devtools: shortcutText(platform.os, 'devtools') }),
    t('settings.cookie.howto.step3'),
    t('settings.cookie.howto.step4', { cookieA: COOKIE_A, cookieB: COOKIE_B }),
  ]);

  // 오류 동작 [네이버 로그인 정보 설정]·[로그인 정보 다시 넣기]로 들어오면 펼치고 그 자리로 간다
  $effect(() => {
    if (open) return;
    // 접으면 입력 중이던 값도 버린다(비밀값을 화면 밖에 남기지 않는다)
    nidAut = '';
    nidSes = '';
    missing = false;
  });

  $effect(() => {
    if (!ui.openCookieSection) return;
    ui.openCookieSection = false;
    open = true;
    void tick().then(() => {
      root?.scrollIntoView?.({ block: 'start' });
      root?.querySelector<HTMLElement>('input')?.focus();
    });
  });

  async function save() {
    missing = !nidAut.trim() || !nidSes.trim();
    error = null;
    if (missing) return;
    busy = true;
    error = await settings.setCookies(nidAut, nidSes);
    busy = false;
    if (!error) {
      nidAut = '';
      nidSes = '';
    }
  }

  async function clear() {
    busy = true;
    missing = false;
    error = await settings.clearCookies();
    busy = false;
    nidAut = '';
    nidSes = '';
  }

  async function toggle(on: boolean) {
    error = await settings.patch({ useNaverCookies: on });
  }
</script>

<div bind:this={root}>
  <Disclosure title={t('settings.advanced')} bind:open>
    {#if open}
      <div class="cookie">
        <h3>{t('dialog.legacy.item.cookies')}</h3>
        <p class="why">{t('settings.cookie.body')}</p>
        <Notice tone="warning">{t('settings.cookie.help')}</Notice>

        {#key settings.revision}
          <div class="use">
            <span class="use-label" id="l-cookie-use">{t('settings.cookie.use')}</span>
            <span class="use-state">{saved ? t('settings.cookie.saved') : t('settings.cookie.notSaved')}</span>
            <Switch value={enabled && saved} labelledby="l-cookie-use" disabled={!saved || busy} onchange={toggle} />
          </div>
        {/key}

        <div class="fields">
          <FieldRow label={COOKIE_A}>
            {#snippet control({ labelId })}
              <SecretField labelledby={labelId} bind:value={nidAut} {...invalidProps(missing && !nidAut.trim())} disabled={busy} />
            {/snippet}
          </FieldRow>
          <FieldRow label={COOKIE_B}>
            {#snippet control({ labelId })}
              <SecretField labelledby={labelId} bind:value={nidSes} {...invalidProps(missing && !nidSes.trim())} disabled={busy} />
            {/snippet}
          </FieldRow>
        </div>

        {#if missing}
          <Notice id="cookie-missing" tone="danger">{t('settings.cookie.bothRequired')}</Notice>
        {:else if errCopy}
          <Notice tone="danger" title={errCopy.title}>
            {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
            {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
          </Notice>
        {/if}

        <div class="acts">
          <Button loading={busy} onclick={save}>{t('settings.cookie.save')}</Button>
          <Button variant="ghost" icon="trash-2" disabled={busy || !saved} onclick={clear}>{t('settings.cookie.clear')}</Button>
          <span class="howto">
            <Disclosure title={t('settings.cookie.howto')} variant="inline">
              <ol class="steps">
                {#each steps as step, i (i)}<li>{step}</li>{/each}
              </ol>
            </Disclosure>
          </span>
        </div>
      </div>
    {/if}
  </Disclosure>
</div>

<style>
  .cookie {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
  }
  h3 {
    margin: 0;
    font-size: var(--text-body);
    line-height: var(--leading-body);
    font-weight: var(--weight-strong);
  }
  .why {
    margin: 0;
    color: var(--fg-muted);
    line-height: var(--leading-read);
  }
  .use {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--gap-sibling);
  }
  .use-label {
    flex: 1;
    color: var(--fg);
  }
  .use-state {
    color: var(--fg-muted);
  }
  .acts {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--gap-sibling);
  }
  .howto {
    margin-inline-start: auto;
  }
  .steps {
    margin: 0;
    padding-inline-start: var(--space-20);
    color: var(--fg-muted);
    line-height: var(--leading-read);
  }
  .line {
    margin: 0;
    font-size: var(--text-caption);
    line-height: var(--leading-caption);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
</style>
