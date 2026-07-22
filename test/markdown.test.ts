import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { markdown } from '../src/content/markdown';

const { normalizeDiscourseMd, htmlToMarkdown, htmlTableToMarkdown } = markdown;

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, 'fixtures');

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), 'utf8');
}

describe('normalizeDiscourseMd', () => {
  it('strips image size suffix |WxH from alt text', () => {
    const input = '![photo|400x300](https://cdn.example.com/x.png)';
    expect(normalizeDiscourseMd(input)).toBe('![photo](https://cdn.example.com/x.png)');
  });

  it('strips image size suffix |WxHxN (with crop count)', () => {
    const input = '![photo|400x300x2](https://cdn.example.com/x.png)';
    expect(normalizeDiscourseMd(input)).toBe('![photo](https://cdn.example.com/x.png)');
  });

  it('strips image size suffix |WxH|extra (with trailing |attrs)', () => {
    const input = '![photo|400x300|extra](https://cdn.example.com/x.png)';
    expect(normalizeDiscourseMd(input)).toBe('![photo](https://cdn.example.com/x.png)');
  });

  it('leaves images without size suffix unchanged', () => {
    const input = '![photo](https://cdn.example.com/x.png)';
    expect(normalizeDiscourseMd(input)).toBe('![photo](https://cdn.example.com/x.png)');
  });

  it('leaves plain text without images unchanged', () => {
    expect(normalizeDiscourseMd('just a paragraph with [a link](https://x.com)')).toBe(
      'just a paragraph with [a link](https://x.com)',
    );
  });

  it('normalizes multiple images in the same markdown', () => {
    const input = '![a|10x10](u1.png) and ![b|20x20x3|crop](u2.png)';
    expect(normalizeDiscourseMd(input)).toBe('![a](u1.png) and ![b](u2.png)');
  });

  it('returns empty string unchanged', () => {
    expect(normalizeDiscourseMd('')).toBe('');
  });
});

describe('htmlToMarkdown — simple-paragraph fixture', () => {
  const md = htmlToMarkdown(readFixture('simple-paragraph.html'));

  it('converts <p> into separated paragraphs', () => {
    expect(md).toContain('First paragraph');
    expect(md).toContain('Second paragraph');
    expect(md).toContain('Third paragraph');
  });

  it('converts <strong> into **bold**', () => {
    expect(md).toContain('**bold**');
  });

  it('converts <em> into *italic*', () => {
    expect(md).toContain('*italic*');
  });

  it('converts <a> into [text](href)', () => {
    expect(md).toContain('[link to example](https://example.com/page)');
  });

  it('converts inline <code> into `code`', () => {
    expect(md).toContain('`codeSnippet`');
  });
});

describe('htmlToMarkdown — table fixture', () => {
  const md = htmlToMarkdown(readFixture('table.html'));

  it('emits a markdown table with pipe rows', () => {
    expect(md).toMatch(/\| 名称 \| 类型 \| 说明 \|/);
    expect(md).toMatch(/\| vitest \| 测试框架 \| fast unit testing \|/);
    expect(md).toMatch(/\| esbuild \| bundler \| esm bundling \|/);
    expect(md).toMatch(/\| typescript \| typechecker \| strict mode \|/);
  });

  it('emits the header separator row with dashes', () => {
    expect(md).toMatch(/\| --- \| --- \| --- \|/);
  });
});

describe('htmlToMarkdown — blockquote fixture', () => {
  const md = htmlToMarkdown(readFixture('blockquote.html'));

  it('renders aside.quote as a > blockquote with attribution', () => {
    expect(md).toContain('**alice said:**');
    // Every line of the quote should be prefixed with >
    expect(md).toMatch(/> .*quoted paragraph from \*\*alice\*\*/);
    expect(md).toMatch(/> Second paragraph of the quote/);
  });

  it('preserves the paragraphs surrounding the quote', () => {
    expect(md).toContain('Before the quote.');
    expect(md).toContain('After the quote.');
  });
});

describe('htmlToMarkdown — code-block fixture', () => {
  const md = htmlToMarkdown(readFixture('code-block.html'));

  it('emits a fenced code block with lang from class="lang-X"', () => {
    expect(md).toMatch(/```typescript\n/);
    expect(md).toContain('function add(a: number, b: number): number {');
    expect(md).toContain('return a + b;');
    expect(md).toContain('```');
  });

  it('emits a fenced code block with empty lang when no lang class', () => {
    expect(md).toMatch(/```\nplain\ncode\nblock\n```/);
  });
});

describe('htmlToMarkdown — image-link-mixed fixture', () => {
  const md = htmlToMarkdown(readFixture('image-link-mixed.html'));

  it('converts inline <img> into ![alt](src)', () => {
    expect(md).toContain('![screenshot](https://cdn.example.com/upload/image.png)');
  });

  it('extracts original-href from lightbox-wrapper as the image URL', () => {
    expect(md).toContain('![big](https://cdn.example.com/original/big.jpg)');
  });

  it('converts plain <a> into [text](href)', () => {
    expect(md).toContain('[example resource](https://example.org/resource)');
  });

  it('converts onebox into a markdown link with the title as text', () => {
    expect(md).toContain('[foo/bar repository](https://github.com/foo/bar)');
  });
});

describe('htmlToMarkdown — edge cases', () => {
  it('returns empty string for empty input', () => {
    expect(htmlToMarkdown('')).toBe('');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(htmlToMarkdown('   \n\n  ')).toBe('');
  });

  it('converts headings h1-h6 into # syntax', () => {
    const html = '<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>';
    const md = htmlToMarkdown(html);
    expect(md).toContain('# H1');
    expect(md).toContain('## H2');
    expect(md).toContain('### H3');
    expect(md).toContain('#### H4');
    expect(md).toContain('##### H5');
    expect(md).toContain('###### H6');
  });

  it('converts <hr> into ---', () => {
    expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toContain('---');
  });

  it('converts <del>/<s> into ~~strikethrough~~', () => {
    expect(htmlToMarkdown('<del>old</del>')).toContain('~~old~~');
    expect(htmlToMarkdown('<s>old</s>')).toContain('~~old~~');
  });

  it('converts unordered list into dash bullets', () => {
    const md = htmlToMarkdown('<ul><li>one</li><li>two</li></ul>');
    expect(md).toContain('- one');
    expect(md).toContain('- two');
  });

  it('converts ordered list into numbered items', () => {
    const md = htmlToMarkdown('<ol><li>first</li><li>second</li></ol>');
    expect(md).toContain('1. first');
    expect(md).toContain('2. second');
  });

  it('collapses 3+ newlines into at most 2', () => {
    const md = htmlToMarkdown('<p>a</p><p>b</p><p>c</p>');
    expect(md).not.toMatch(/\n{3,}/);
  });
});

describe('htmlTableToMarkdown', () => {
  it('returns empty string for a table with no rows', () => {
    const el = document.createElement('table');
    expect(htmlTableToMarkdown(el)).toBe('');
  });

  it('returns a markdown table with header + separator + body rows', () => {
    const el = document.createElement('table');
    el.innerHTML = `
      <thead><tr><th>A</th><th>B</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>2</td></tr>
        <tr><td>3</td><td>4</td></tr>
      </tbody>
    `;
    const md = htmlTableToMarkdown(el);
    expect(md).toMatch(/^\n\| A \| B \|\n/);
    expect(md).toMatch(/\| --- \| --- \|\n/);
    expect(md).toMatch(/\| 1 \| 2 \|\n/);
    expect(md).toMatch(/\| 3 \| 4 \|\n\n$/);
  });

  it('escapes pipe characters inside cells as \\|', () => {
    const el = document.createElement('table');
    el.innerHTML = `<tr><td>a|b</td></tr>`;
    expect(htmlTableToMarkdown(el)).toContain('a\\|b');
  });

  it('pads short rows with empty cells to match the widest row', () => {
    const el = document.createElement('table');
    el.innerHTML = `
      <tr><th>A</th><th>B</th><th>C</th></tr>
      <tr><td>only one</td></tr>
    `;
    const md = htmlTableToMarkdown(el);
    expect(md).toMatch(/\| only one \|  \|  \|/);
  });
});
