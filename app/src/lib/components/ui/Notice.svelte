<script lang="ts" module>
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { IconName } from './icons';
  import type { NoticeAction, NoticeVariant, Tone } from './vocab';

  type NoticeVariantWithActions = Exclude<NoticeVariant, 'row'>;

  /** row는 동작 버튼·닫기가 없다(행의 동작 열이 맡는다) */
  type VariantProps =
    | { variant?: NoticeVariantWithActions; actions?: NoticeAction[]; onclose?: () => void }
    | { variant: 'row'; actions?: never; onclose?: never };

  /** 아이콘은 neutral일 때만 호출부가 고른다. 나머지 톤은 아이콘이 정해져 있다 */
  type ToneProps = { tone: 'neutral'; icon?: IconName } | { tone?: Exclude<Tone, 'neutral'>; icon?: never };

  // 루트로 통과시키는 속성은 이벤트·id·aria·data만 고른다(전체 HTMLAttributes를 유니온에 곱하면 svelte-check가 타입을 풀지 못한다)
  type Passthrough = Pick<
    HTMLAttributes<HTMLElement>,
    'id' | 'class' | 'aria-describedby' | 'onmouseenter' | 'onmouseleave' | 'onfocusin' | 'onfocusout'
  > & { [key: `data-${string}`]: string | undefined };

  export type NoticeProps = Passthrough & {
    title?: string;
    children: Snippet;
  } & VariantProps &
    ToneProps;

  const TONE_ICON: Record<Exclude<Tone, 'neutral'>, IconName> = {
    info: 'info',
    warning: 'triangle-alert',
    danger: 'circle-x',
  };
</script>

<script lang="ts">
  import { t } from '../../copy/ko';
  import Button from './Button.svelte';
  import Icon from './Icon.svelte';
  import IconButton from './IconButton.svelte';
  import { enterMotion } from './focus';

  let {
    variant = 'inline',
    tone = 'info',
    icon,
    title,
    children,
    actions,
    onclose,
    class: klass = '',
    ...rest
  }: NoticeProps = $props();

  const uid = $props.id();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;

  const iconName = $derived<IconName | undefined>(tone === 'neutral' ? icon : TONE_ICON[tone]);
  // 동작 버튼은 최대 3개(components.md §2.12)
  const shownActions = $derived((actions ?? []).slice(0, 3));
  // 라이브 영역은 글자 요소에만 둔다(동작 버튼이 들어가지 않게). row는 role이 없다(patterns.md §1.5)
  const role = $derived(variant === 'row' ? undefined : tone === 'danger' ? 'alert' : 'status');
</script>

{#snippet box()}
  <div
    class="notice notice-{variant} tone-{tone} {variant === 'banner' ? '' : klass}"
    {...variant === 'banner' ? {} : rest}
    {@attach variant === 'toast' ? enterMotion : undefined}
  >
    {#if iconName}
      {#if variant === 'row'}<Icon name={iconName} size="sm" />{:else}<Icon name={iconName} size="md" />{/if}
    {/if}
    <div class="notice-text" {role} aria-atomic="true">
      {#if title}<p class="notice-title" id={titleId}>{title}</p>{/if}
      <div id={bodyId}>{@render children()}</div>
    </div>
    {#if shownActions.length > 0 || onclose}
      <div class="notice-actions">
        {#each shownActions as a (a.id)}
          <Button variant="secondary" size="sm" onclick={a.onclick}>{a.label}</Button>
        {/each}
        {#if onclose}<IconButton icon="x" size="sm" label={t('common.close')} onclick={onclose} />{/if}
      </div>
    {/if}
  </div>
{/snippet}

{#if variant === 'banner'}
  <!-- banner: 바깥은 이름 붙은 영역. 제목이 없으면 본문 요소가 이름이다(계약 §3 Notice) -->
  <section aria-labelledby={title ? titleId : bodyId} class={klass} {...rest}>
    {@render box()}
  </section>
{:else}
  {@render box()}
{/if}
