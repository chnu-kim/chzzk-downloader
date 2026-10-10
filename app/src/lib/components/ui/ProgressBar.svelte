<script lang="ts">
  // 진행 막대(docs/design/system/components.md §2.20). 앱 전용.
  // 채움은 ui.css가 scaleX(var(--p))로 그린다. --p는 style: 디렉티브로만 쓴다(CSP style-src 'self').
  import type { HTMLAttributes } from 'svelte/elements';
  import type { NameProps, ProgressState } from './vocab';

  type Props = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role'> &
    NameProps & {
      /** 0~100(소수는 내림). null이면 총량을 모른다(aria-valuenow 생략, 줄무늬) */
      value: number | null;
      state?: ProgressState;
      /** 스크린 리더가 읽을 완결 문장 */
      valuetext: string;
    };

  let { value, state: progressState = 'active', valuetext, label, labelledby, class: klass, ...rest }: Props = $props();

  const percent = $derived(value == null ? null : Math.min(100, Math.max(0, Math.floor(value))));

  // 값이 줄면 그 갱신 한 번만 전환을 끈다(되감기가 천천히 흐르지 않게). 다음 프레임에 뗀다
  let instant = $state(false);
  let prev: number | null = null;
  $effect.pre(() => {
    const now = percent;
    if (now != null && prev != null && now < prev) {
      instant = true;
      requestAnimationFrame(() => {
        instant = false;
      });
    }
    prev = now;
  });
</script>

<div
  {...rest}
  class={['progress', klass]}
  role="progressbar"
  data-state={progressState}
  data-instant={instant ? '' : undefined}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={percent ?? undefined}
  aria-valuetext={valuetext}
  aria-label={label}
  aria-labelledby={labelledby}
>
  <div class="fill" style:--p={percent == null ? undefined : percent / 100}></div>
</div>
