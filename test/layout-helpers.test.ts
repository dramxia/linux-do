import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr } from '../src/content/layout/dom-queries';

describe('escapeHtml', () => {
  it('escapes all five HTML special chars (& < > " \')', () => {
    expect(escapeHtml('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('escapes ampersand first to avoid double-encoding', () => {
    // &lt; should stay as &amp;lt; — escapeHtml operates on raw text, not existing entities.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('returns empty string for null/undefined input', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  it('coerces numbers to string before escaping (no special chars)', () => {
    expect(escapeHtml(42)).toBe('42');
    expect(escapeHtml(0)).toBe('0');
    expect(escapeHtml(-1.5)).toBe('-1.5');
  });

  it('coerces objects to [object Object] string', () => {
    expect(escapeHtml({})).toBe('[object Object]');
  });

  it('coerces booleans to "true"/"false"', () => {
    expect(escapeHtml(true)).toBe('true');
    expect(escapeHtml(false)).toBe('false');
  });

  it('returns input unchanged when there are no special chars', () => {
    expect(escapeHtml('plain text 123')).toBe('plain text 123');
  });

  it('escapes only the dangerous chars, leaving unicode intact', () => {
    expect(escapeHtml('你好 <world>')).toBe('你好 &lt;world&gt;');
  });
});

describe('escapeAttr', () => {
  it('escapes backticks in addition to HTML special chars', () => {
    expect(escapeAttr('`dangerous`')).toBe('&#96;dangerous&#96;');
  });

  it('escapes HTML special chars the same as escapeHtml', () => {
    expect(escapeAttr('a & b < c > d " e \' f')).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &#39; f',
    );
  });

  it('escapes a mix of backticks and angle brackets', () => {
    expect(escapeAttr('`<script>`')).toBe('&#96;&lt;script&gt;&#96;');
  });

  it('returns empty string for null/undefined input', () => {
    expect(escapeAttr(null)).toBe('');
    expect(escapeAttr(undefined)).toBe('');
  });

  it('returns plain ASCII strings unchanged', () => {
    expect(escapeAttr('safe-attr-value_123')).toBe('safe-attr-value_123');
  });

  it('coerces numbers via escapeHtml path (no backticks)', () => {
    expect(escapeAttr(7)).toBe('7');
  });
});
