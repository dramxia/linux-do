import { describe, it, expect } from 'vitest';
import { base64 } from '../src/content/base64';

const { decodeBase64Utf8, stripChineseText } = base64;

describe('decodeBase64Utf8', () => {
  it('decodes valid ASCII base64', () => {
    // 'hello world' in base64
    expect(decodeBase64Utf8('aGVsbG8gd29ybGQ=')).toBe('hello world');
  });

  it('decodes base64 with surrounding whitespace by normalizing it away', () => {
    expect(decodeBase64Utf8('  aGVsbG8=\n  ')).toBe('hello');
  });

  it('decodes UTF-8 multi-byte sequences (Chinese)', () => {
    // '你好' -> UTF-8 bytes e4 bd a0 e5 a5 bd -> base64 5L2g5aW9
    expect(decodeBase64Utf8('5L2g5aW9')).toBe('你好');
  });

  it('decodes UTF-8 multi-byte sequences (emoji)', () => {
    // '✅' (U+2705) UTF-8 bytes e2 9c 85 -> base64 4pyF
    expect(decodeBase64Utf8('4pyF')).toBe('✅');
  });

  it('falls back to atob output when bytes are not valid UTF-8 (latin-1 fallback)', () => {
    // 0xFF 0xFE 0xFD are not valid UTF-8 leading bytes; fatal decoder throws,
    // function catches and returns binary (atob) result.
    // base64 of [0xFF, 0xFE, 0xFD] is //79
    const result = decodeBase64Utf8('//79');
    // atob('//79') returns 3 latin-1 chars with codes 0xFF 0xFE 0xFD
    expect(result.length).toBe(3);
    expect(result.charCodeAt(0)).toBe(0xFF);
    expect(result.charCodeAt(1)).toBe(0xFE);
    expect(result.charCodeAt(2)).toBe(0xFD);
  });

  it('throws on invalid base64 input (atob rejects)', () => {
    // atob rejects strings whose length is not a multiple of 4 after trimming,
    // and certain invalid chars. '!!invalid!!' contains '!' which is not base64.
    expect(() => decodeBase64Utf8('!!invalid!!')).toThrow();
  });

  it('decodes empty string to empty string', () => {
    expect(decodeBase64Utf8('')).toBe('');
  });
});

describe('stripChineseText', () => {
  it('removes all CJK characters from Chinese-only text', () => {
    expect(stripChineseText('你好世界')).toBe('');
  });

  it('removes Chinese characters from mixed Chinese+English text', () => {
    expect(stripChineseText('hello 你好 world 世界')).toBe('hello  world ');
  });

  it('returns text unchanged when there is no Chinese', () => {
    expect(stripChineseText('just plain english text')).toBe('just plain english text');
  });

  it('removes fullwidth punctuation (U+FF01-FF60 range)', () => {
    // U+FF01 ＝ fullwidth exclamation, U+FF0C fullwidth comma
    expect(stripChineseText('abc！，def')).toBe('abcdef');
  });

  it('removes CJK punctuation (U+3000-303F range)', () => {
    // U+3001 、 U+3002 。
    expect(stripChineseText('abc、def。')).toBe('abcdef');
  });

  it('returns empty string for input that is all CJK punctuation', () => {
    // U+3001 、 U+3002 。 U+303F 〿 — all in U+3000-303F range
    expect(stripChineseText('、。〿')).toBe('');
  });

  it('preserves digits and ASCII punctuation', () => {
    expect(stripChineseText('123, 你好 456!')).toBe('123,  456!');
  });

  it('returns empty string for empty input', () => {
    expect(stripChineseText('')).toBe('');
  });
});
