import { describe, it, expect } from 'vitest';
import { replaceUploadUrls } from '../src/content/discourse';

describe('replaceUploadUrls', () => {
  it('replaces a single upload:// image with the mapped URL', () => {
    const input = '![alt text](upload://abc123.png)';
    const map = { 'abc123.png': 'https://cdn.example.com/upload/abc123.png' };
    expect(replaceUploadUrls(input, map)).toBe(
      '![alt text](https://cdn.example.com/upload/abc123.png)',
    );
  });

  it('replaces multiple uploads in the same markdown', () => {
    const input = '![a](upload://file1.png) and ![b](upload://file2.jpg)';
    const map = {
      'file1.png': 'https://cdn.example.com/upload/file1.png',
      'file2.jpg': 'https://cdn.example.com/upload/file2.jpg',
    };
    expect(replaceUploadUrls(input, map)).toBe(
      '![a](https://cdn.example.com/upload/file1.png) and ![b](https://cdn.example.com/upload/file2.jpg)',
    );
  });

  it('leaves upload:// references unchanged when no mapping is provided', () => {
    const input = '![a](upload://unknown.png)';
    expect(replaceUploadUrls(input, {})).toBe('![a](upload://unknown.png)');
  });

  it('leaves markdown without upload:// unchanged', () => {
    const input = '![a](https://cdn.example.com/already.png) plain text';
    const map = { 'x.png': 'https://cdn.example.com/x.png' };
    expect(replaceUploadUrls(input, map)).toBe(input);
  });

  it('handles mixed upload:// and regular URLs (only uploads replaced)', () => {
    const input =
      '![first](upload://a.png) ![second](https://cdn.example.com/b.png) ![third](upload://c.png)';
    const map = {
      'a.png': 'https://cdn.example.com/a.png',
      'c.png': 'https://cdn.example.com/c.png',
    };
    expect(replaceUploadUrls(input, map)).toBe(
      '![first](https://cdn.example.com/a.png) ![second](https://cdn.example.com/b.png) ![third](https://cdn.example.com/c.png)',
    );
  });

  it('preserves empty alt text when replacing', () => {
    const input = '![](upload://no-alt.png)';
    const map = { 'no-alt.png': 'https://cdn.example.com/no-alt.png' };
    expect(replaceUploadUrls(input, map)).toBe('![](https://cdn.example.com/no-alt.png)');
  });

  it('returns empty string for empty input', () => {
    expect(replaceUploadUrls('', { 'x.png': 'y' })).toBe('');
  });

  it('handles filenames with dots and special chars in upload:// filename', () => {
    const input = '![alt](upload://my.file-v2.png)';
    const map = { 'my.file-v2.png': 'https://cdn.example.com/my.file-v2.png' };
    expect(replaceUploadUrls(input, map)).toBe('![alt](https://cdn.example.com/my.file-v2.png)');
  });
});
