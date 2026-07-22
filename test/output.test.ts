import { describe, it, expect } from 'vitest';
import { formatPostMd, formatTopicMd, sanitizeFilename } from '../src/content/output';
import type { PostMeta } from '../src/content/discourse';

const sampleMeta: PostMeta = {
  postId: '42',
  postNumber: '3',
  author: 'alice',
  date: '2024-01-15',
};

describe('formatPostMd', () => {
  it('formats with metadata header by default', () => {
    const result = formatPostMd(sampleMeta, '  hello body  ', 'My Topic', 'https://linux.do/t/topic/1');
    expect(result).toBe(
      '<!-- 来源: https://linux.do/t/topic/1#post-3 | 作者: alice | 2024-01-15 -->\n\nhello body',
    );
  });

  it('omits header when includeMetadata is false', () => {
    const result = formatPostMd(
      sampleMeta,
      'body content',
      'My Topic',
      'https://linux.do/t/topic/1',
      { includeMetadata: false },
    );
    expect(result).toBe('body content');
  });

  it('omits #post-N anchor when postNumber is empty', () => {
    const meta: PostMeta = { postId: '1', postNumber: '', author: 'bob', date: '2024-02-01' };
    const result = formatPostMd(meta, 'body', 'Topic', 'https://linux.do/t/topic/1');
    expect(result).toContain('来源: https://linux.do/t/topic/1 |');
    expect(result).not.toContain('#post-');
  });

  it('omits date in header when meta.date is empty', () => {
    const meta: PostMeta = { postId: '1', postNumber: '2', author: 'bob', date: '' };
    const result = formatPostMd(meta, 'body', 'Topic', 'https://linux.do/t/topic/1');
    expect(result).toContain('作者: bob -->');
    expect(result).not.toContain(' | -->');
  });

  it('trims whitespace from raw markdown body', () => {
    const result = formatPostMd(
      sampleMeta,
      '\n\n  trimmed  \n\n',
      'T',
      'https://linux.do/t/topic/1',
      { includeMetadata: false },
    );
    expect(result).toBe('trimmed');
  });

  it('handles empty content (includeMetadata false) -> empty string', () => {
    const result = formatPostMd(sampleMeta, '   ', 'T', 'https://linux.do/t/topic/1', {
      includeMetadata: false,
    });
    expect(result).toBe('');
  });

  it('handles empty content (includeMetadata true) -> header only', () => {
    const result = formatPostMd(sampleMeta, '   ', 'T', 'https://linux.do/t/topic/1');
    expect(result).toBe('<!-- 来源: https://linux.do/t/topic/1#post-3 | 作者: alice | 2024-01-15 -->\n\n');
  });
});

describe('formatTopicMd', () => {
  it('formats single post with metadata', () => {
    const posts = [{ meta: sampleMeta, raw: 'post body' }];
    const result = formatTopicMd(posts, 'Topic Title', 'https://linux.do/t/topic/1');
    expect(result).toContain('<!-- 来源: https://linux.do/t/topic/1 -->');
    expect(result).toContain('<!-- #3 alice | https://linux.do/t/topic/1#post-3 -->');
    expect(result).toContain('post body');
  });

  it('formats multiple posts joined by newlines, each with its own header comment', () => {
    const posts = [
      { meta: { ...sampleMeta, postNumber: '1', author: 'alice' }, raw: 'first' },
      { meta: { ...sampleMeta, postNumber: '2', author: 'bob' }, raw: 'second' },
    ];
    const result = formatTopicMd(posts, 'T', 'https://linux.do/t/topic/1');
    expect(result).toContain('<!-- #1 alice | https://linux.do/t/topic/1#post-1 -->');
    expect(result).toContain('first');
    expect(result).toContain('<!-- #2 bob | https://linux.do/t/topic/1#post-2 -->');
    expect(result).toContain('second');
    // Order: title header, post1 header, post1 body, post2 header, post2 body
    expect(result.indexOf('#1 alice')).toBeLessThan(result.indexOf('first'));
    expect(result.indexOf('first')).toBeLessThan(result.indexOf('#2 bob'));
    expect(result.indexOf('#2 bob')).toBeLessThan(result.indexOf('second'));
  });

  it('falls back to index+1 when meta.postNumber is empty', () => {
    const posts = [{ meta: { ...sampleMeta, postNumber: '' }, raw: 'body' }];
    const result = formatTopicMd(posts, 'T', 'https://linux.do/t/topic/1');
    expect(result).toContain('<!-- #1 alice | https://linux.do/t/topic/1#post-1 -->');
  });

  it('joins posts with --- separator when includeMetadata is false', () => {
    const posts = [
      { meta: sampleMeta, raw: 'first post' },
      { meta: sampleMeta, raw: 'second post' },
    ];
    const result = formatTopicMd(posts, 'T', 'https://linux.do/t/topic/1', {
      includeMetadata: false,
    });
    expect(result).toBe('first post\n\n---\n\nsecond post');
  });

  it('trims each post raw when joining without metadata', () => {
    const posts = [
      { meta: sampleMeta, raw: '  first  ' },
      { meta: sampleMeta, raw: '  second  ' },
    ];
    const result = formatTopicMd(posts, 'T', 'https://linux.do/t/topic/1', {
      includeMetadata: false,
    });
    expect(result).toBe('first\n\n---\n\nsecond');
  });
});

describe('sanitizeFilename', () => {
  it('passes through a normal filename unchanged', () => {
    expect(sanitizeFilename('topic-title.md')).toBe('topic-title.md');
  });

  it('replaces OS-forbidden characters with underscores', () => {
    // < > : " / \ | ? * \n \r all become _
    expect(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j\nk')).toBe('a_b_c_d_e_f_g_h_i_j_k');
  });

  it('collapses runs of whitespace into single spaces', () => {
    expect(sanitizeFilename('hello   world\tname.md')).toBe('hello world name.md');
  });

  it('truncates very long names to 80 characters', () => {
    const long = 'x'.repeat(200);
    expect(sanitizeFilename(long).length).toBe(80);
  });

  it('preserves CJK characters in filename', () => {
    expect(sanitizeFilename('主题标题.md')).toBe('主题标题.md');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  it('handles input that is only forbidden chars', () => {
    expect(sanitizeFilename('<>:')).toBe('___');
  });
});
