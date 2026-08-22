import { describe, expect, it } from 'vitest';
import { parseTopicActionRequest, parseTopicActionResult } from '../src/content/topic-actions';

describe('topic action bridge validation', () => {
  it('parses a serialized action request and drops extra fields', () => {
    expect(
      parseTopicActionRequest(
        JSON.stringify({
          requestId: 'action:1',
          topicId: 123,
          postId: 456,
          floor: 7,
          action: 'bookmark',
          routeUrl: 'https://linux.do/t/topic/123/7?ldo_comments_page=1',
          token: 'ignored',
        }),
      ),
    ).toEqual({
      requestId: 'action:1',
      topicId: 123,
      postId: 456,
      floor: 7,
      action: 'bookmark',
      routeUrl: 'https://linux.do/t/topic/123/7?ldo_comments_page=1',
    });
  });

  it.each([
    null,
    '{broken',
    { requestId: 'x', topicId: 0, postId: 1, floor: 1, action: 'like', routeUrl: '/t/x/1' },
    { requestId: 'x', topicId: 1, postId: 1, floor: 1, action: 'unknown', routeUrl: '/t/x/1' },
    { requestId: '<bad>', topicId: 1, postId: 1, floor: 1, action: 'like', routeUrl: '/t/x/1' },
  ])('rejects invalid requests %#', (value) => {
    expect(parseTopicActionRequest(value)).toBeNull();
  });

  it('parses action results from the page world', () => {
    expect(
      parseTopicActionResult(JSON.stringify({ requestId: 'action:2', ok: true, phase: 'settled' })),
    ).toEqual({ requestId: 'action:2', ok: true, phase: 'settled' });
  });

  it('rejects results with an unknown phase', () => {
    expect(
      parseTopicActionResult({ requestId: 'action:2', ok: true, phase: 'finished' }),
    ).toBeNull();
  });
});
