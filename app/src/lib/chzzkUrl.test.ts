import { describe, expect, it } from 'vitest';
import { isChzzkContentUrl, pickChzzkLink, textFromDrop } from './chzzkUrl';

// crates/core/src/url.rs 테스트와 같은 사례(판정은 Rust가 다시 하지만 드롭에서 주소를 고를 때 어긋나지 않게)
describe('isChzzkContentUrl', () => {
  it.each([
    'https://chzzk.naver.com/video/1234567',
    'https://chzzk.naver.com/video/123?t=10',
    'https://chzzk.naver.com/video/123/?t=10',
    'https://chzzk.naver.com/video/123#x',
    'https://chzzk.naver.com/video/123/',
    'http://chzzk.naver.com/video/123',
    '  https://chzzk.naver.com/video/123  ',
    'chzzk.naver.com/video/123',
    'HTTPS://CHZZK.NAVER.COM/video/123',
    'https://m.chzzk.naver.com/video/1',
    'https://chzzk.naver.com/clips/TestClip01',
    'https://chzzk.naver.com/clips/AbCdEf1234/',
    'https://chzzk.naver.com/clips/AbCdEf1234?param=1',
    'https://chzzk.naver.com/embed/clip/AbCdEf1234?autoPlay=true',
    'https://chzzk.naver.com/clips/abc#a/b',
  ])('받는다: %s', (s) => {
    expect(isChzzkContentUrl(s)).toBe(true);
  });

  it.each([
    '',
    'https://chzzk.naver.com/',
    'https://chzzk.naver.com/live/abcd',
    'https://chzzk.naver.com/clips/',
    'https://chzzk.naver.com/embed/clip/',
    'http://evil.com/?chzzk.naver.com/clips/abc',
    'https://chzzk.naver.com.evil.com/clips/abc',
    'https://chzzk.naver.com/clips/abc/extra',
    'https://chzzk.naver.com/clips/abc//',
    'https://chzzk.naver.com/clips/a%20b',
    'https://chzzk.naver.com/embed/clips/abc',
    'ftp://chzzk.naver.com/clips/abc',
    'https://chzzk.naver.com/video/+12',
  ])('거부한다: %s', (s) => {
    expect(isChzzkContentUrl(s)).toBe(false);
  });
});

describe('pickChzzkLink·textFromDrop', () => {
  it('글 중 첫 영상 주소', () => {
    expect(pickChzzkLink('이거 봐 chzzk.naver.com/clips/abc_D-1 재밌음')).toBe('chzzk.naver.com/clips/abc_D-1');
    expect(pickChzzkLink('https://example.com/video/1 https://m.chzzk.naver.com/video/9')).toBe(
      'https://m.chzzk.naver.com/video/9',
    );
    expect(pickChzzkLink('hunter2')).toBeNull();
    expect(pickChzzkLink(`${'x'.repeat(5000)} https://chzzk.naver.com/video/1`)).toBeNull();
  });

  it('uri-list를 먼저, 주석 줄은 빼고, 주소가 없으면 첫 줄', () => {
    const data = (m: Record<string, string>) => (type: string) => m[type] ?? '';
    expect(
      textFromDrop(data({ 'text/uri-list': '# 주석\nhttps://chzzk.naver.com/video/5', 'text/plain': 'x' })),
    ).toBe('https://chzzk.naver.com/video/5');
    expect(textFromDrop(data({ 'text/plain': '보세요\nhttps://chzzk.naver.com/clips/ab' }))).toBe(
      'https://chzzk.naver.com/clips/ab',
    );
    expect(textFromDrop(data({ 'text/plain': 'https://chzzk.naver.com/live/x\n둘째 줄' }))).toBe(
      'https://chzzk.naver.com/live/x',
    );
    expect(textFromDrop(data({}))).toBeNull();
  });
});
