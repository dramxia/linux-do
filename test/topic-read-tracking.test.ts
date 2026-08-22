import { describe, expect, it } from 'vitest';
import { buildTimingsBody } from '../src/content/topic-read-tracking';

describe('topic read tracking', () => {
  it('serializes only visible post timings and their total', () => {
    const body = new URLSearchParams(
      buildTimingsBody(
        123,
        new Map([
          [2, 1000.4],
          [7, 934.2],
          [8, 0],
        ]),
      ),
    );
    expect(body.get('timings[2]')).toBe('1000');
    expect(body.get('timings[7]')).toBe('934');
    expect(body.has('timings[8]')).toBe(false);
    expect(body.get('topic_time')).toBe('1934');
    expect(body.get('topic_id')).toBe('123');
  });
});
