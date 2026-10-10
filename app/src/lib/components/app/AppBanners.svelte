<script lang="ts" module>
  // 배너 우선순위(system/patterns.md §1.4): 한 번에 하나만 보이고 오류가 먼저다.
  //   ① B2 설정 저장 실패 → ② B4 업데이트 실패 → ③ B4 진행(받는 중·설치 중) → (④ B5 서비스 공지 block·warn: 자리만) →
  //   ⑤ B1 받다 만 영상 → ⑥ B4 새 버전 → (⑦ B5 info: 자리만)
  // B5(서비스 공지)는 Worker `/notice`가 생기는 단계(e)에서 이 표에 들어온다(앱에 공지 데이터가 아직 없다).
  // B4 진행과 B4 새 버전은 같은 배너 노드('update')로 그려진다: 버튼을 눌러도 포커스·라이브 영역이 끊기지 않게(worker.md 77).
  export type BannerKind = 'settings' | 'updateFailed' | 'update' | 'interrupted';

  export interface BannerState {
    /** 설정 저장 실패(B2) */
    settingsError: boolean;
    /** 설치 실패(B4 실패) */
    updateFailure: boolean;
    /** 받는 중·설치 중(B4 진행) */
    updateBusy: boolean;
    /** 재시작 직후 중단된 작업이 있고 닫지 않았다(B1) */
    interrupted: boolean;
    /** 새 버전이 있고 닫지 않았다(B4 새 버전) */
    updateAvailable: boolean;
  }

  /** 지금 보일 배너 하나. 없으면 null */
  export function pickBanner(s: BannerState): BannerKind | null {
    if (s.settingsError) return 'settings';
    if (s.updateFailure) return 'updateFailed';
    if (s.updateBusy) return 'update';
    if (s.interrupted) return 'interrupted';
    if (s.updateAvailable) return 'update';
    return null;
  }
</script>

<script lang="ts">
  import * as api from '../../api';
  import { t } from '../../copy/ko';
  import { formatFileSize, formatPercent, sizeBaseOf } from '../../format/bytes';
  import { jobs } from '../../stores/jobs.svelte';
  import { platform } from '../../stores/platform.svelte';
  import { settings } from '../../stores/settings.svelte';
  import { update } from '../../stores/update.svelte';
  import Notice from '../ui/Notice.svelte';
  import UpdateBanner from './UpdateBanner.svelte';

  let resuming = $state(false);

  async function resumeAll() {
    resuming = true;
    try {
      await jobs.resumeAllInterrupted();
    } finally {
      resuming = false;
    }
  }

  const which = $derived(
    pickBanner({
      settingsError: settings.saveError !== null,
      updateFailure: update.failure !== null,
      updateBusy: update.busy,
      interrupted: jobs.showInterruptedBanner,
      updateAvailable: update.showBanner,
    }),
  );
  /** 받는 중에는 시작 때 본 버전(그사이 확인 결과가 available을 비워도 진행 배너가 남는다) */
  const updateVersion = $derived(update.busy ? (update.installVersion ?? update.available?.version ?? '') : (update.available?.version ?? ''));
  // 받는 중 문구는 진행 정도(퍼센트, 크기를 모르면 받은 바이트)까지 deck 한 줄이다(`update.downloading`).
  // 화면(`updateShown`)에는 정확한 값이, 라이브로 읽히는 글(`updateStatus`)에는 25% 단위(크기를 모르면 100MB 단위)가 들어간다
  const LIVE_PERCENT_STEP = 25;
  const LIVE_BYTES_STEP = 100_000_000;
  const base = $derived(sizeBaseOf(platform.os));
  const updateShown = $derived(
    update.phase === 'downloading'
      ? t('update.downloading', {
          percent:
            update.pct !== null && update.total
              ? formatPercent(update.received, update.total)
              : formatFileSize(update.received, base),
        })
      : null,
  );
  const updateStatus = $derived(
    update.phase === 'downloading'
      ? t('update.downloading', {
          percent:
            update.pct !== null
              ? formatPercent(Math.floor(update.pct / LIVE_PERCENT_STEP) * LIVE_PERCENT_STEP, 100)
              : formatFileSize(Math.floor(update.received / LIVE_BYTES_STEP) * LIVE_BYTES_STEP, base),
        })
      : update.phase === 'installing'
        ? t('update.installing')
        : null,
  );
</script>

{#if which !== null}
<div class="banner-slot">
{#if which === 'update'}
  <UpdateBanner
    version={updateVersion}
    busy={update.busy || update.pending}
    status={updateStatus}
    shown={updateShown}
    oninstall={() => void update.install()}
    onlater={() => update.later()}
  />
{:else if which === 'updateFailed'}
  <!-- 실패해도 지금 버전은 계속 쓸 수 있어 warning(서명 확인 실패만 danger). 다시 받을 새 버전이 있을 때만 [다시 시도] -->
  <Notice
    variant="banner"
    tone={update.failure === 'untrusted' ? 'danger' : 'warning'}
    actions={update.failure === 'failed' && update.available
      ? [{ id: 'retry', label: t('action.retry'), loading: update.pending, onclick: () => void update.install() }]
      : []}
    onclose={() => update.dismissFailure()}
  >
    {update.failure === 'untrusted' ? t('update.untrusted') : t('update.failed')}
  </Notice>
{:else if which === 'settings'}
  <Notice
    variant="banner"
    tone="danger"
    actions={[
      { id: 'openConfig', label: t('common.openConfigFolder'), onclick: () => void api.openAppFolder('config').catch(() => {}) },
      { id: 'retry', label: t('action.retry'), onclick: () => void settings.retrySave() },
    ]}
    onclose={() => settings.dismissSaveError()}
  >
    {t('banner.settingsError')}
  </Notice>
{:else if which === 'interrupted'}
  <Notice
    variant="banner"
    tone="info"
    actions={[{ id: 'resumeAll', label: t('banner.resumeAll'), loading: resuming, onclick: () => void resumeAll() }]}
    onclose={() => jobs.dismissBanner()}
  >
    {t('banner.interrupted', { n: jobs.resumableCount })}
  </Notice>
{/if}
</div>
{/if}

<style>
  /* 배너 아래 여백 8: 세로 예산 "배너 B1 +48" = 높이 40 + 8(patterns.md §14.1·§15) */
  .banner-slot {
    margin-bottom: var(--space-8);
  }
</style>
