import { describe, expect, it } from 'vitest';
import { isSupportedPageUrl, renderPageInfo } from '../src/popup/security';

describe('isSupportedPageUrl', () => {
  it.each(['https://linux.do/t/topic/123', 'https://www.linux.do/t/topic/123'])(
    'accepts supported HTTPS pages: %s',
    (url) => {
      expect(isSupportedPageUrl(url)).toBe(true);
    },
  );

  it.each([
    'http://linux.do/t/topic/123',
    'https://linux.do.evil.example/t/topic/123',
    'https://evil.example/path/linux.do/',
    'https://evil.example/?next=linux.do/',
    'not a URL',
    undefined,
  ])('rejects unsupported or malformed pages: %s', (url) => {
    expect(isSupportedPageUrl(url)).toBe(false);
  });
});

describe('renderPageInfo', () => {
  it('renders an untrusted topic title as text', () => {
    const container = document.createElement('div');
    const maliciousTitle =
      'topic</div><style id="injected">body{display:none}</style><img src="https://evil.example">';

    renderPageInfo(container, maliciousTitle, 3);

    expect(container.querySelector('style')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.title')?.textContent).toBe(maliciousTitle);
    expect(container.textContent).toContain('当前已加载 3 个楼层');
  });
});
