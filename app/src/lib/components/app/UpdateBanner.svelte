<script lang="ts">
  // 업데이트 배너(B4, system/patterns.md §12, worker.md §11.6). 표시 전용이다: 배선은 AppBanners와 update store가 한다.
  // 새 버전: [지금 업데이트] 하나와 [×](이번 실행 동안 숨김). [나중에]는 [×]와 같은 일이라 두지 않는다(patterns.md §17-18).
  // `status`가 있으면(받는 중·설치 중) 본문이 그 문구로 바뀌고 [×]가 없어진다. 배너와 [지금 업데이트]는 같은 노드로 남는다
  // (누른 버튼의 포커스와 라이브 영역이 끊기지 않게, worker.md 77). 이때 버튼은 `loading`(aria-disabled·aria-busy)이다.
  // 실패(`failed`)도 같은 노드다: tone warning·제목 `update.failed`·본문 `common.keepUsing`, 버튼은 [다시 시도](같은 id라 같은 노드),
  // [×]는 실패만 닫는다(app.md 129).
  // 받는 중 문구는 진행 정도까지 deck 한 줄이다(`update.downloading`, content.md §15.1). 화면에는 정확한 퍼센트(`shown`)가
  // 보이고(스크린 리더에게는 숨김), AppBanners가 LiveAnnouncer로 읽는 `status`는 25% 단위로만 바뀐다(1%마다 다시 읽지 않게, content.md §10).
  import { t } from '../../copy/ko';
  import { updateNoteLines } from '../../format/display';
  import Notice from '../ui/Notice.svelte';
  import UpdateNotes from './UpdateNotes.svelte';

  interface Props {
    version: string;
    /** 설치 요청 중·받는 중: [지금 업데이트]가 눌리지 않는다(aria-disabled라 포커스는 남는다) */
    busy?: boolean;
    /** 진행 단계 문구(스크린 리더가 읽는 글). 있으면 [×]가 없다 */
    status?: string | null;
    /** 화면에 보이는 정확한 진행 문구. 있으면 `aria-hidden`으로 보이고 `status`는 읽기 전용(sr-only)으로 둔다 */
    shown?: string | null;
    /** latest.json의 바뀐 점(서명되지 않는 일반 텍스트). 새 버전을 알릴 때(`status === null`)만 접는 줄로 보인다 */
    notes?: string | null;
    oninstall: () => void;
    onlater: () => void;
    /** 설치가 실패했다(B4 실패, warning, patterns.md §12). 같은 배너·같은 버튼 노드로 그려 [다시 시도]를 눌러도 포커스가 남는다(app.md 구현 중 변경 129) */
    failed?: boolean;
    /** 실패 배너 [×]: 실패만 닫는다(새 버전 배너가 같은 노드로 뒤를 잇는다) */
    ondismiss?: () => void;
    /** [다시 시도]로 시작한 요청이 첫 진행 이벤트·결과 전이다: 실패 배너의 글·제목을 그대로 두고 [×]·바뀐 점만 감춘다(라이브 영역에 엉뚱한 문장이 읽히지 않게, app.md 129) */
    retrying?: boolean;
  }

  let { version, busy = false, status = null, shown = null, notes = null, oninstall, onlater, failed = false, ondismiss, retrying = false }: Props = $props();

  // 다시 시도 요청 중(진행 문구가 아직 없을 때)은 실패 모양을 유지한다
  const asFailed = $derived(failed || (retrying && status === null));
  const off = $derived(busy || status !== null);
  // 정리 뒤 남는 줄이 있을 때만 슬롯을 넘긴다(빈 자기 줄이 생기지 않게)
  const hasNotes = $derived(updateNoteLines(notes).length > 0);
</script>

<Notice
  variant="banner"
  tone={asFailed ? 'warning' : 'info'}
  title={asFailed ? t('update.failed') : undefined}
  actions={[{ id: 'install', label: asFailed ? t('action.retry') : t('update.install'), loading: off, onclick: oninstall }]}
  onclose={failed ? ondismiss : retrying || status !== null ? undefined : onlater}
  details={!asFailed && status === null && hasNotes ? details : undefined}
>
  {#if asFailed}
    {t('common.keepUsing')}
  {:else if status !== null}
    {#if shown}
      <span aria-hidden="true">{shown}</span><span class="sr-only">{status}</span>
    {:else}
      {status}
    {/if}
  {:else}
    {t('update.banner', { version })}
  {/if}
</Notice>

{#snippet details()}
  <UpdateNotes {notes} />
{/snippet}
