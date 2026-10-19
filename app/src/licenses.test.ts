// @vitest-environment node
/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HLSJS_VERSION } from './lib/licenses';

// 정보 화면의 hls.js 고지 행 버전과 고지 원문(licenses/hlsjs.txt)이 어긋나지 않게 묶는다.
const notice = readFileSync(fileURLToPath(new URL('../../licenses/hlsjs.txt', import.meta.url)), 'utf8');

describe('hls.js 고지 원문', () => {
  it('첫 줄이 정보 화면 버전과 같다', () => {
    expect(notice.split('\n')[0]).toBe(`hls.js (hls.js ${HLSJS_VERSION})`);
  });

  it('정확한 버전이다(범위 표기 없음)', () => {
    expect(HLSJS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('Apache-2.0 원문과 두 저작권 줄이 있다', () => {
    expect(notice).toContain('Licensed under the Apache License, Version 2.0');
    expect(notice).toContain('Copyright (c) 2017 Dailymotion');
    expect(notice).toContain('Copyright (c) 2013-2015 Brightcove');
  });

  it('생성 모듈에 못 옮기는 글자(<, 백틱, ${, data:)가 없다', () => {
    expect(notice).not.toMatch(/[<`]|\$\{|data:/i);
  });
});
