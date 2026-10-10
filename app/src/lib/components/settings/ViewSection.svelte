<script lang="ts">
  // 보기: 글자 크기(모든 OS)와 모양(Linux만). 세그먼트 없이 RadioGroup이다(patterns.md §6.3, platform.md §11).
  // 값을 바꾸면 `settings.patch`가 저장하고 `<html data-text-scale>`·`data-theme`은 settings store가 붙인다.
  import type { SettingsPatch, TextScale, Theme } from '../../bindings';
  import { t, type CopyKey } from '../../copy/ko';
  import { settings } from '../../stores/settings.svelte';
  import { platform } from '../../stores/platform.svelte';
  import { useDelayedLoading } from '../../useDelayedLoading.svelte';
  import RadioGroup from '../ui/RadioGroup.svelte';
  import SettingsRow from '../ui/SettingsRow.svelte';
  import Skeleton from '../ui/Skeleton.svelte';
  import SettingsSection from './SettingsSection.svelte';

  let { save }: { save: (p: SettingsPatch) => Promise<void> } = $props();

  // 값 → copy 키는 리터럴 표로 고른다(키를 조립하지 않는다)
  const TEXT_SCALE_LABEL = {
    default: 'settings.textScale.default',
    large: 'settings.textScale.large',
    'x-large': 'settings.textScale.xLarge',
  } as const satisfies Record<TextScale, CopyKey>;
  const THEME_LABEL = {
    system: 'settings.theme.system',
    light: 'settings.theme.light',
    dark: 'settings.theme.dark',
  } as const satisfies Record<Theme, CopyKey>;

  const textScaleOptions = (Object.keys(TEXT_SCALE_LABEL) as TextScale[]).map((v) => ({
    id: `text-scale-${v}`,
    value: v,
    label: t(TEXT_SCALE_LABEL[v]),
  }));
  const themeOptions = (Object.keys(THEME_LABEL) as Theme[]).map((v) => ({
    id: `theme-${v}`,
    value: v,
    label: t(THEME_LABEL[v]),
  }));

  const dto = $derived(settings.dto);
  const loading = useDelayedLoading(() => !settings.dto);
</script>

<SettingsSection title={t('settings.view')}>
  {#key settings.revision}
    <SettingsRow label={t('settings.textScale')}>
      {#snippet control({ labelId })}
        {#if dto}
          <RadioGroup
            variant="inline"
            name="text-scale"
            labelledby={labelId}
            value={dto.textScale}
            options={textScaleOptions}
            onchange={(v) => void save({ textScale: v })}
          />
        {:else if loading.visible}
          <span class="pending"><Skeleton variant="control" /></span>
        {/if}
      {/snippet}
    </SettingsRow>
    {#if platform.os === 'linux'}
      <SettingsRow label={t('settings.theme')}>
        {#snippet control({ labelId })}
          {#if dto}
            <RadioGroup
              variant="inline"
              name="theme"
              labelledby={labelId}
              value={dto.theme}
              options={themeOptions}
              onchange={(v) => void save({ theme: v })}
            />
          {:else if loading.visible}
            <span class="pending"><Skeleton variant="control" /></span>
          {/if}
        {/snippet}
      </SettingsRow>
    {/if}
  {/key}
</SettingsSection>

<style>
  .pending {
    width: var(--label-w);
  }
</style>
