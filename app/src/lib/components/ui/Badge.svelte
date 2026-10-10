<script lang="ts">
  // 글자 배지(docs/design/system/components.md §2.19). 색이 아니라 글자로 종류를 말한다.
  import { t } from '../../copy/ko';
  import type { Kind } from './vocab';

  interface Props {
    kind: Kind;
  }

  let { kind }: Props = $props();

  const TEXT = {
    vod: () => t('kind.vod'),
    clip: () => t('kind.clip'),
    rewind: () => t('kind.liveRewind'),
    adult: () => t('badge.adult'),
  } as const;
</script>

<!-- 성인 "19"만 보이는 글자로는 뜻이 모자라 role=img + aria-label을 붙인다 -->
<span
  class="badge"
  role={kind === 'adult' ? 'img' : undefined}
  aria-label={kind === 'adult' ? t('badge.adult.label') : undefined}>{TEXT[kind]()}</span
>
