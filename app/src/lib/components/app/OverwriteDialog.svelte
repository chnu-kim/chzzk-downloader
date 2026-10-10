<script lang="ts">
  // D7 덮어쓰기 확인(system/patterns.md §5.2, content.md §5.3): 같은 이름의 완성 파일을 지우고 새로 받는다.
  // 앱이 사용자의 영상을 지우는 유일한 경우라 늘 묻는다. 오른쪽 끝 = 안전([그대로 두기], 채움·Enter·첫 포커스),
  // 왼쪽 끝 = 빨간 글자 [덮어쓰고 받기]. 카드("덮어쓰기"를 고른 뒤 [받기])와 건너뜀 행([덮어쓰고 받기…])이 함께 쓴다.
  import { t } from '../../copy/ko';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';

  interface Props {
    open: boolean;
    /** 덮어쓸 파일 이름(확장자 포함, 화면에 보이는 그대로) */
    name: string;
    /** 실행 중(받기 등록 등)이면 실행 버튼을 loading으로 둔다 */
    busy?: boolean;
    onconfirm: () => void;
    onclose: () => void;
  }

  let { open, name, busy = false, onconfirm, onclose }: Props = $props();
</script>

<ConfirmDialog
  {open}
  title={t('dialog.overwrite.title', { name })}
  body={t('dialog.overwrite.body')}
  {onclose}
  primary={{ id: 'keep', label: t('dialog.cancel.keepPaused'), onclick: onclose }}
  secondary={{ id: 'overwrite', label: t('dialog.overwrite.confirm'), tone: 'danger', loading: busy, onclick: onconfirm }}
/>
