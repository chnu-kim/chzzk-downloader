<script lang="ts">
  // D4 로그아웃 확인(system/patterns.md §5.2, content.md §5.3). 계정 메뉴의 [로그아웃…]과 설정 계정 행의 [로그아웃…]이
  // `ui.logoutConfirm = true`로 요청하고, App에 하나만 둔 이 대화상자가 받는다(로그인 화면이 열린 동안에는 마운트하지 않는다).
  // 오른쪽 끝 = 안전([로그인 유지], 채움·Enter·첫 포커스), 왼쪽 = [로그아웃](neutral: 다시 로그인하면 복구된다).
  // 받는 중인 다운로드는 로그아웃해도 계속된다(본문이 말한다).
  import { t } from '../../copy/ko';
  import { auth } from '../../stores/auth.svelte';
  import { ui } from '../../stores/ui.svelte';
  import ConfirmDialog from '../ui/ConfirmDialog.svelte';

  function close() {
    ui.logoutConfirm = false;
  }

  function confirm() {
    // 응답이 늦어도 대화상자는 닫고, 진행은 상태 변화(잠금)가 보여 준다
    close();
    void auth.logout();
  }
</script>

<ConfirmDialog
  open={ui.logoutConfirm}
  title={t('dialog.logout.title')}
  body={t('dialog.logout.body')}
  onclose={close}
  primary={{ id: 'keep', label: t('dialog.logout.cancel'), onclick: close }}
  secondary={{ id: 'logout', label: t('dialog.logout.confirm'), loading: auth.isBusy('logout'), onclick: confirm }}
/>
