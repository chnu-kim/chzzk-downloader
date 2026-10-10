<script lang="ts">
  import type { NoticeAction } from '../vocab';
  import Notice from '../Notice.svelte';

  // Notice의 tone×variant 조합을 문자열 props로 흔들기 위한 하네스(타입 유니온을 풀어 준다)
  interface Props {
    tone?: 'neutral' | 'info' | 'warning' | 'danger';
    variant?: 'inline' | 'banner' | 'row' | 'toast';
    icon?: 'clipboard-paste' | 'circle-check' | 'info' | 'triangle-alert' | 'circle-x';
    title?: string;
    actions?: NoticeAction[];
    onclose?: () => void;
  }
  let { tone = 'info', variant = 'inline', icon, title, actions, onclose }: Props = $props();
</script>

{#if variant === 'row'}
  {#if tone === 'neutral'}
    <Notice variant="row" tone="neutral" {icon} {title}>본문 글</Notice>
  {:else}
    <Notice variant="row" {tone} {title}>본문 글</Notice>
  {/if}
{:else if tone === 'neutral'}
  <Notice {variant} tone="neutral" {icon} {title} {actions} {onclose}>본문 글</Notice>
{:else}
  <Notice {variant} {tone} {title} {actions} {onclose}>본문 글</Notice>
{/if}
