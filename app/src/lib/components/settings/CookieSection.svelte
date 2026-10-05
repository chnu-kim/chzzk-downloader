<script lang="ts">
  // 고급: 네이버 로그인 정보(§8.7, ui-visual §6.8). 저장된 쿠키 값은 Rust가 다시 보내지 않으므로 입력칸은 늘
  // 비어서 시작하고, 저장·지우기 뒤에도 비운다. "저장됨 / 저장된 값 없음"만 보인다.
  import { tick } from 'svelte';
  import type { AppError } from '../../bindings';
  import { errorCopy } from '../../copy/errors';
  import { t } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { ui } from '../../stores/ui.svelte';
  import Button from '../ui/Button.svelte';
  import Disclosure from '../ui/Disclosure.svelte';
  import InlineAlert from '../ui/InlineAlert.svelte';
  import SecretField from '../ui/SecretField.svelte';
  import Switch from '../ui/Switch.svelte';

  let open = $state(false);
  let nidAut = $state('');
  let nidSes = $state('');
  let busy = $state(false);
  let error = $state<AppError | null>(null);
  let missing = $state(false);
  let root: HTMLElement | null = $state(null);

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
      <InlineAlert tone="warning" title={t('settings.cookie.danger')} />

      {#key settings.revision}
        <div class="row-main">
          <span class="label" id="l-cookie-use">{t('settings.cookie.use')}</span>
          <span class="state" class:ok={saved}>
            {saved ? t('settings.cookie.saved') : t('settings.cookie.notSaved')}
          </span>
          <Switch checked={enabled && saved} labelledby="l-cookie-use" disabled={!saved || busy} onchange={toggle} />
        </div>
      {/key}

      <div class="field">
        <label class="label mono-label" for="nid-aut">NID_AUT</label>
        <SecretField id="nid-aut" label="NID_AUT" bind:value={nidAut} invalid={missing && !nidAut.trim()} disabled={busy} />
      </div>
      <div class="field">
        <label class="label mono-label" for="nid-ses">NID_SES</label>
        <SecretField id="nid-ses" label="NID_SES" bind:value={nidSes} invalid={missing && !nidSes.trim()} disabled={busy} />
      </div>

      {#if missing}
        <InlineAlert tone="danger" title={t('settings.cookie.bothRequired')} />
      {:else if errCopy}
        <InlineAlert tone="danger" title={errCopy.title}>
          {#if errCopy.body}<p class="line">{errCopy.body}</p>{/if}
          {#if errCopy.detail}<p class="line detail">{errCopy.detail}</p>{/if}
        </InlineAlert>
      {/if}

      <div class="actions">
        <Button variant="primary" disabled={busy} onclick={save}>{t('settings.cookie.save')}</Button>
        <Button icon="trash" disabled={busy || !saved} onclick={clear}>{t('settings.cookie.clear')}</Button>
        <span class="howto">
          <Disclosure title={t('settings.cookie.howto')} variant="inline">
            <ol class="steps">
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
    margin-top: var(--space-6);
  }
  .cookie {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-2);
    padding: var(--space-4);
  }
  .why {
    line-height: 1.65;
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .row-main .label {
    flex: 1;
  }
  .state {
    font-size: var(--text-sm);
    color: var(--fg-muted);
  }
  .state.ok {
    color: var(--success);
  }
  .field {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .mono-label {
    flex: none;
    width: 72px;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
  .field :global(.secret) {
    flex: 1;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2);
  }
  .howto {
    margin-left: auto;
  }
  .steps {
    margin: var(--space-2) 0 0;
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
