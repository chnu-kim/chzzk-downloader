<script lang="ts">
  // 업데이트 배너(B4, system/patterns.md §12, worker.md §11.6). 표시 전용이다: 배선은 AppBanners와 update store가 한다.
  // 새 버전: [지금 업데이트] 하나와 [×](이번 실행 동안 숨김). [나중에]는 [×]와 같은 일이라 두지 않는다(patterns.md §17-18).
  // `status`가 있으면(받는 중·설치 중) 본문이 그 문구로 바뀌고 [×]가 없어진다. 배너와 [지금 업데이트]는 같은 노드로 남는다
  // (누른 버튼의 포커스와 라이브 영역이 끊기지 않게, worker.md 77). 이때 버튼은 `loading`(aria-disabled·aria-busy)이다.
  // 라이브로 읽히는 본문은 단계 문구뿐이고 퍼센트(`detail`)는 보이기만 한다(1%마다 다시 읽지 않게).
  import { t } from '../../copy/ko';
  import Notice from '../ui/Notice.svelte';

  interface Props {
    version: string;
    /** 설치 요청 중·받는 중: [지금 업데이트]가 눌리지 않는다(aria-disabled라 포커스는 남는다) */
    busy?: boolean;
    /** 진행 단계 문구. 있으면 [×]가 없다 */
    status?: string | null;
    /** 진행 정도(퍼센트·바이트). 화면에만 보인다 */
    detail?: string | null;
    oninstall: () => void;
    onlater: () => void;
  }

  let { version, busy = false, status = null, detail = null, oninstall, onlater }: Props = $props();

  const off = $derived(busy || status !== null);
</script>

<Notice
  variant="banner"
  tone="info"
  actions={[{ id: 'install', label: t('update.install'), loading: off, onclick: oninstall }]}
  onclose={status === null ? onlater : undefined}
>
  {#if status !== null}
    {status}{#if detail}{' '}<span aria-hidden="true">{detail}</span>{/if}
  {:else}
    {t('update.banner', { version })}
  {/if}
</Notice>
