// 오류 L1 "자세히"(D51): ErrorDetails 조합과 detail을 바로 그리는 자리가 남지 않았는지 원천 검사.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import { t } from '../../copy/ko';
import ErrorDetails from './ErrorDetails.svelte';

describe('ErrorDetails', () => {
  it('자세히 summary 하나, 원문은 닫혀 있고 여러 줄을 그대로 둔다', () => {
    const { container } = render(ErrorDetails, { detail: '가\n나' });
    expect(screen.getAllByText(t('common.details'))).toHaveLength(1);
    const details = container.querySelector('details') as HTMLDetailsElement;
    expect(details.hasAttribute('open')).toBe(false);
    const line = container.querySelector('.error-detail') as HTMLElement;
    expect(line.textContent).toBe('가\n나');
    expect(line).toHaveClass('selectable');
  });

  it('오류 detail을 바로 그리는 자리가 남지 않는다(L1은 ErrorDetails·JobItem 펼침만)', () => {
    const base = resolve(__dirname, '..');
    const files = [
      'receive/ResolveError.svelte',
      'receive/ResolveCard.svelte',
      'jobs/JobItem.svelte',
      'settings/CookieSection.svelte',
      'settings/LegacySection.svelte',
      'settings/FileNameTemplateRow.svelte',
      '../views/SettingsView.svelte',
    ];
    for (const f of files) {
      const src = readFileSync(resolve(base, f), 'utf8');
      expect(src, f).not.toMatch(/\{#if\s+\w+\.detail\}\s*<p/);
    }
  });
});
