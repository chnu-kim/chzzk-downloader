<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Icon from './Icon.svelte';
  import Kbd from './Kbd.svelte';
  import type { IconName } from './icons';

  interface Props extends HTMLButtonAttributes {
    /** primary: 화면에 하나. secondary: 대부분. danger: D2만. link: 면 없는 글자 버튼 */
    variant?: 'primary' | 'secondary' | 'danger' | 'link';
    /** md 36px, sm 28px(목록 항목 안) */
    size?: 'md' | 'sm';
    /** secondary의 글자를 accent로(기본 동작임을 알리는 "이어받기") */
    accentText?: boolean;
    icon?: IconName;
    /** 버튼 안 단축키 표시(글자 뒤 8px) */
    kbd?: string;
    children?: Snippet;
    el?: HTMLButtonElement | null;
  }

  let {
    variant = 'secondary',
    size = 'md',
    accentText = false,
    icon,
    kbd,
    type = 'button',
    children,
    el = $bindable(null),
    class: klass = '',
    ...rest
  }: Props = $props();
</script>

<button
  bind:this={el}
  {type}
  class="btn {variant} {size} {klass}"
  class:accent-text={accentText}
  {...rest}
>
  {#if icon}<Icon name={icon} size={size === 'sm' ? 16 : 20} />{/if}
  {#if children}<span class="label">{@render children()}</span>{/if}
  <!-- 단축키 표시는 보이기만 한다: 버튼 이름("다운로드")에 들어가지 않게 -->
  {#if kbd}<span class="kbd-hint" aria-hidden="true"><Kbd>{kbd}</Kbd></span>{/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: var(--control-h);
    padding: 0 14px;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    font: inherit;
    font-size: var(--text-md);
    font-weight: var(--weight-medium);
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    transition:
      background-color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  .btn.sm {
    height: var(--control-h-sm);
    padding: 0 10px;
    font-size: var(--text-sm);
  }
  .kbd-hint {
    display: inline-flex;
    margin-left: 2px;
  }

  .primary {
    background: var(--accent);
    color: var(--accent-fg);
  }
  .primary:hover:not(:disabled):not([aria-disabled='true']) {
    background: var(--accent-hover);
  }

  .secondary {
    background: var(--surface);
    color: var(--fg);
    border-color: var(--border-strong);
  }
  .secondary.accent-text {
    color: var(--accent);
  }
  .secondary:hover:not(:disabled):not([aria-disabled='true']) {
    background: var(--surface-2);
  }
  .secondary:active:not(:disabled):not([aria-disabled='true']) {
    background: var(--surface-2);
    border-color: var(--fg-muted);
  }

  .danger {
    background: var(--danger);
    color: var(--danger-fg);
  }
  .danger:hover:not(:disabled):not([aria-disabled='true']) {
    background: var(--danger-hover);
  }

  .link {
    background: none;
    color: var(--accent);
    padding: 0 6px;
    height: auto;
    min-height: var(--control-h-sm);
  }
  .link:hover:not(:disabled):not([aria-disabled='true']) .label {
    text-decoration: underline;
  }

  /* 비활성은 반투명이 아니라 색을 바꾼다(ui-visual §7) */
  .btn:disabled,
  .btn[aria-disabled='true'] {
    cursor: default;
    background: var(--surface-2);
    color: var(--fg-faint);
    border-color: var(--border);
  }
  .link:disabled,
  .link[aria-disabled='true'] {
    background: none;
    border-color: transparent;
  }
</style>
