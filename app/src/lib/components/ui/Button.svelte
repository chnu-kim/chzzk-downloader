<script lang="ts">
  // 동작 버튼(docs/design/system/components.md §2.1). 못 만드는 조합은 타입으로 막는다:
  // primary+danger, primary+disabled, lg+icon, children 없음.
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import Kbd from './Kbd.svelte';
  import Spinner from './Spinner.svelte';
  import type { IconName } from './icons';
  
  type Base = Omit<HTMLButtonAttributes, 'children' | 'disabled'> & {
    kbd?: string;
    loading?: boolean;
    children: Snippet;
    el?: HTMLButtonElement | null;
  };
  type Sizing = { size?: 'sm' | 'md'; icon?: IconName } | { size: 'lg'; icon?: never };
  type Look =
    | { variant: 'primary'; tone?: 'neutral'; disabled?: false }
    | { variant?: 'secondary' | 'ghost'; tone?: 'neutral' | 'danger'; disabled?: boolean };
  type Props = Base & Sizing & Look;

  let {
    variant = 'secondary',
    tone = 'neutral',
    size = 'md',
    icon,
    kbd,
    loading = false,
    disabled = false,
    children,
    el = $bindable(null),
    class: klass = '',
    onclick,
    ...rest
  }: Props = $props();

  // 불러오는 중·aria-disabled 에서는 클릭을 여기서 막는다(포커스는 그대로 둔다)
  function handleClick(e: MouseEvent) {
    if (loading || rest['aria-disabled'] === 'true' || rest['aria-disabled'] === true) {
      e.preventDefault();
      return;
    }
    (onclick as ((e: MouseEvent) => void) | null | undefined)?.(e);
  }
</script>

<button
  bind:this={el}
  type="button"
  {...rest}
  class={[
    'btn',
    variant === 'primary' && 'btn-primary',
    variant === 'ghost' && 'btn-ghost',
    size === 'sm' && 'btn-sm',
    size === 'lg' && 'btn-lg',
    tone === 'danger' && 'tone-danger',
    klass,
  ]}
  {disabled}
  aria-busy={loading ? 'true' : undefined}
  aria-disabled={loading ? 'true' : rest['aria-disabled']}
  onclick={handleClick}
>
  <span class="btn-label">
    {#if icon}<Icon name={icon} size="sm" />{/if}
    {@render children()}
    <!-- 단축키 표시는 보이기만 한다: 버튼 이름에 들어가지 않게 -->
    {#if kbd}<span aria-hidden="true"><Kbd>{kbd}</Kbd></span>{/if}
  </span>
  {#if loading}<Spinner size="sm" />{/if}
</button>
