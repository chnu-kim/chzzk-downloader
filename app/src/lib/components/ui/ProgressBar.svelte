<script lang="ts">
  interface Props {
    /** 0~1. `null`이면 총량을 모른다(indeterminate, aria-valuenow 생략) */
    value: number | null;
    /** 채움색: 받는 중 accent, 멈춤 muted, 실패 danger */
    tone?: 'accent' | 'muted' | 'danger';
    /** 링크 갱신 중(reresolving) 45° 줄무늬 */
    striped?: boolean;
    /** 스크린 리더가 읽을 문장("58퍼센트, 2분 18초 남음") */
    valueText?: string;
    label?: string;
  }

  let { value, tone = 'accent', striped = false, valueText, label }: Props = $props();

  const clamped = $derived(value == null ? null : Math.min(1, Math.max(0, value)));
  const percent = $derived(clamped == null ? undefined : Math.floor(clamped * 100));
</script>

<div
  class="track"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={percent}
  aria-valuetext={valueText}
>
  {#if clamped == null}
    <div class="fill indeterminate {tone}"></div>
  {:else}
    <!-- width는 transition하지 않는다(ui-visual §4) -->
    <div class="fill {tone}" class:striped style:width="{clamped * 100}%"></div>
  {/if}
</div>

<style>
  .track {
    position: relative;
    height: var(--progress-h);
    border-radius: var(--radius-xs);
    background: var(--surface-2);
    overflow: hidden;
  }
  .fill {
    height: 100%;
    border-radius: inherit;
  }
  .accent {
    background-color: var(--accent);
  }
  .muted {
    background-color: var(--fg-muted);
  }
  .danger {
    background-color: var(--danger);
  }
  .striped {
    background-image: repeating-linear-gradient(
      45deg,
      var(--accent) 0 8px,
      var(--accent-hover) 8px 16px
    );
    background-size: 22.6px 22.6px;
    animation: stripes 0.8s linear infinite;
  }
  .indeterminate {
    position: absolute;
    width: 30%;
    animation: slide 1.2s var(--ease-out) infinite;
  }
  @keyframes stripes {
    to {
      background-position: 22.6px 0;
    }
  }
  @keyframes slide {
    from {
      left: -30%;
    }
    to {
      left: 100%;
    }
  }
  /* 줄무늬는 정지한 채 남긴다(패턴이 정보). indeterminate는 트랙만 */
  @media (prefers-reduced-motion: reduce) {
    .striped {
      animation: none;
    }
    .indeterminate {
      display: none;
    }
  }
</style>
