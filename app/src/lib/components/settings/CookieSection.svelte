<script lang="ts">
  // 고급: 네이버 로그인 정보(§8.7, patterns.md §14.4). 저장된 쿠키 값은 Rust가 다시 보내지 않으므로 입력칸은 늘
  // 비어서 시작하고, 저장·지우기 뒤에도 비운다. "저장됨 / 저장된 값 없음"만 보인다.
  import { tick } from 'svelte';
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import Notice from '../ui/Notice.svelte';
  import SecretField from '../ui/SecretField.svelte';
  import Switch from '../ui/Switch.svelte';

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
  const steps = $derived(
    t('settings.cookie.howto.steps')
      .split(/\s*\d\.\s+/)
      .filter(Boolean),
  );

  // 오류 동작 [네이버 로그인 정보 설정]·[로그인 정보 다시 넣기]로 들어오면 펼치고 그 자리로 간다
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

<section bind:this={root}>
  <Disclosure title={t('settings.cookie.title')} bind:open>
    <div class="group cookie">
      <p class="help why">{t('settings.cookie.why')}</p>
      <Notice tone="warning">{t('settings.cookie.danger')}</Notice>

      {#key settings.revision}
        <div class="srow-main">
          <span class="label" id="l-cookie-use">{t('settings.cookie.use')}</span>
          <span class="state" class:ok={saved}>
            {saved ? t('settings.cookie.saved') : t('settings.cookie.notSaved')}
          </span>
          <Switch value={enabled && saved} labelledby="l-cookie-use" disabled={!saved || busy} onchange={toggle} />
        </div>
      {/key}

      <div class="cfield">
        <span class="label mono-label" id="l-nid-aut">NID_AUT</span>
        <SecretField labelledby="l-nid-aut" bind:value={nidAut} {...invalidProps(missing && !nidAut.trim())} disabled={busy} />
      </div>
      <div class="cfield">
        <span class="label mono-label" id="l-nid-ses">NID_SES</span>
        <SecretField labelledby="l-nid-ses" bind:value={nidSes} {...invalidProps(missing && !nidSes.trim())} disabled={busy} />
      </div>

      {#if missing}
        <Notice id="cookie-missing" tone="danger">{t('settings.cookie.bothRequired')}</Notice>
      {:else if errCopy}
        <Notice tone="danger" title={errCopy.title}>
          {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
          {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
        </Notice>
      {/if}

      <div class="cacts">
        <Button variant="primary" loading={busy} onclick={save}>{t('settings.cookie.save')}</Button>
        <Button icon="trash-2" disabled={busy || !saved} onclick={clear}>{t('settings.cookie.clear')}</Button>
        <span class="howto">
          <Disclosure title={t('settings.cookie.howto')} variant="inline">
            <ol class="hsteps">
              {#each steps as step, i (i)}<li>{step}</li>{/each}
            </ol>
          </Disclosure>
        </span>
      </div>
    </div>
  </Disclosure>
</section>

<style>
  section {
    margin-top: var(--space-24);
  }
  .cookie {
    display: flex;
    flex-direction: column;
    gap: var(--space-12);
    margin-top: var(--space-8);
    padding: var(--space-16);
  }
  .why {
    line-height: 1.65;
  }
  .srow-main .label {
    flex: 1;
  }
  .state {
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .state.ok {
    color: var(--success);
  }
  .cfield {
    display: flex;
    align-items: center;
    gap: var(--space-12);
  }
  .mono-label {
    flex: none;
    width: 72px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .cfield :global(.field-wrap) {
    flex: 1;
  }
  .cacts {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-8);
  }
  .howto {
    margin-left: auto;
  }
  .hsteps {
    margin: var(--space-8) 0 0;
    padding-left: 1.25rem;
    font-size: var(--text-sm);
    line-height: 1.65;
    color: var(--fg-muted);
  }
  .line {
    margin: 0;
    font-size: var(--text-sm);
  }
  .detail {
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }
</style>
