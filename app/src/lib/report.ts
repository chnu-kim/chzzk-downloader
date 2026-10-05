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
    // 막혔으면 알린다: 경로 경고 토스트만 남으면 복사된 줄 안다
    toasts.push(t('toast.copyFailed'), 'danger');
  }
}

/**
 * 설정 > 정보의 "문제 보고용 정보 복사": 오류 없이 앱·OS·시각만. 경로는 넣지 않는다(사용자 이름이 들어갈 수 있다).
 */
export function buildAppReport(info: AppInfo | null, now = new Date()): string {
  return [
    `앱: ${info ? `${info.version} (코어 ${info.coreVersion})` : '알 수 없음'}`,
    `OS: ${typeof navigator === 'undefined' ? '' : navigator.userAgent}`,
    `시각: ${now.toISOString()}`,
  ].join('\n');
}

export async function copyAppReport(info: AppInfo | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildAppReport(info));
    toasts.push(t('toast.copied'), 'copied');
  } catch {
    toasts.push(t('toast.copyFailed'), 'danger');
  }
}
