// 웹 구성요소 미달 경고 배너(platform.md §5): 프로브가 하나라도 false면 AppBanners에 경고 하나, 모두 true면 없다.
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '../../copy/ko';
import { engineFixText } from '../../platform';

vi.mock('../../api', () => ({
  Channel: class {
    onmessage = () => {};
  },
  subscribeJobs: vi.fn(),
  openAppFolder: vi.fn(),
}));

const { engine } = await import('../../stores/engine.svelte');
const { platform } = await import('../../stores/platform.svelte');
const { default: AppBanners } = await import('./AppBanners.svelte');

beforeEach(() => {
  engine.old = false;
  engine.dismissed = false;
  platform.set('linux');
});
afterEach(() => {
  engine.old = false;
  engine.dismissed = false;
  platform.set('linux');
});

describe('엔진 미달 경고', () => {
  it('모두 true면 배너가 없다', () => {
    render(AppBanners);
    expect(screen.queryByText(t('engine.old.title'))).toBeNull();
  });

  it.each(['macos', 'windows', 'linux'] as const)('프로브 false: 제목 + 본문에 %s의 고치는 법, 앱을 막지 않는다', (os) => {
    platform.set(os);
    engine.old = true;
    render(AppBanners);
    expect(screen.getByText(t('engine.old.title'))).toBeInTheDocument();
    expect(screen.getByText(t('engine.old.body', { fix: engineFixText(os) }))).toBeInTheDocument();
    // 경고(warning)이고 모달이 아니다
    expect(document.querySelector('.notice-banner')).toHaveClass('tone-warning');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('[×]로 닫으면 이번 실행에서는 다시 뜨지 않는다', async () => {
    engine.old = true;
    render(AppBanners);
    await userEvent.setup().click(screen.getByRole('button', { name: t('common.close') }));
    expect(screen.queryByText(t('engine.old.title'))).toBeNull();
    expect(engine.showBanner).toBe(false);
  });
});
