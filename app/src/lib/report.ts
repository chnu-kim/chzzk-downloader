// "문제 보고용 정보 복사"(§9): {app, os, code, status?, stage, message, time}. 비밀 값은 들어가지 않는다
// (AppError.message는 코어 불변식상 비밀이 없다). 경로가 들어갈 수 있어 복사 때 토스트로 알린다.
import type { AppError, AppInfo } from './bindings';
import { t } from './copy/ko';
import { toasts } from './stores/toast.svelte';

/** 보고 줄의 필드 이름은 전부 영문이고 모르는 값은 `unknown`이다(개발자가 읽는 글이라 deck이 아니다, content.md §15.4) */
const UNKNOWN = 'unknown';

/** 두 보고가 함께 쓰는 앞쪽 줄: 앱 버전·OS */
function envLines(info: AppInfo | null): string[] {
  return [
    `app: ${info ? `${info.version} (core ${info.coreVersion})` : UNKNOWN}`,
    `os: ${info?.platform ?? UNKNOWN}`,
  ];
}

export function buildReport(err: AppError, info: AppInfo | null, now = new Date()): string {
  const status = err.payload?.type === 'http' ? String(err.payload.status) : null;
  const lines = [
    ...envLines(info),
    `code: ${err.code}`,
    status ? `status: ${status}` : null,
    `stage: ${err.stage ?? '-'}`,
    `message: ${err.message}`,
    `time: ${now.toISOString()}`,
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

export function reportHasPath(err: AppError): boolean {
  return err.payload?.type === 'path' || /[\\/]/.test(err.message);
}

/**
 * 사용자 제스처(버튼 클릭) 안에서 부른다. 복사가 끝나면 토스트는 한 장이다: 경로가 들어 있으면 `toast.reportHasPath`가
 * `toast.copied`를 대신한다(한 사건 한 토스트: 둘을 잇달아 올리면 경고가 바로 대체된다, patterns.md §1.1-1).
 */
export async function copyReport(err: AppError, info: AppInfo | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildReport(err, info));
  } catch {
    toasts.push(t('toast.copyFailed'), 'danger');
    return;
  }
  if (reportHasPath(err)) toasts.push(t('toast.reportHasPath'), 'info');
  else toasts.push(t('action.copied'), 'copied');
}

/**
 * 설정 > 정보의 "문제 보고용 정보 복사": 오류 없이 앱·OS·시각만. 경로는 넣지 않는다(사용자 이름이 들어갈 수 있다).
 */
export function buildAppReport(info: AppInfo | null, now = new Date()): string {
  return [...envLines(info), `time: ${now.toISOString()}`].join('\n');
}

export async function copyAppReport(info: AppInfo | null): Promise<void> {
  try {
    await navigator.clipboard.writeText(buildAppReport(info));
    toasts.push(t('action.copied'), 'copied');
  } catch {
    toasts.push(t('toast.copyFailed'), 'danger');
  }
}
