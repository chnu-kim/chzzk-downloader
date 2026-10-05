// "문제 보고용 정보 복사"(§9): {앱 버전, OS, code, status?, message, stage, 시각}. 비밀 값은 들어가지 않는다
// (AppError.message는 코어 불변식상 비밀이 없다). 경로가 들어갈 수 있어 복사 때 토스트로 알린다.
import type { AppError, AppInfo } from './bindings';
import { t } from './copy/ko';
import { toasts } from './stores/toast.svelte';

export function buildReport(err: AppError, info: AppInfo | null, now = new Date()): string {
  const status = err.payload?.type === 'http' ? String(err.payload.status) : null;
  const lines = [
    `앱: ${info ? `${info.version} (코어 ${info.coreVersion})` : '알 수 없음'}`,
    `OS: ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`,
    `code: ${err.code}`,
    status ? `status: ${status}` : null,
    `stage: ${err.stage ?? '-'}`,
    `message: ${err.message}`,
    `시각: ${now.toISOString()}`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export function reportHasPath(err: AppError): boolean {
  return err.payload?.type === 'path' || /[\\/]/.test(err.message);
}

/** 사용자 제스처(버튼 클릭) 안에서 부른다. */
export async function copyReport(err: AppError, info: AppInfo | null): Promise<void> {
  if (reportHasPath(err)) toasts.push(t('toast.reportHasPath'), 'info');
  try {
    await navigator.clipboard.writeText(buildReport(err, info));
    toasts.push(t('toast.copied'), 'copied');
  } catch {
    // 클립보드 쓰기가 막히면 조용히 넘긴다(토스트만 남지 않게 경고 토스트는 그대로 둔다)
  }
}
