import { describe, expect, it } from 'vitest';
import { parseTopicEventDetail, sanitizeTopicMessage } from '../src/content/topic-events';

describe('topic event bridge validation', () => {
  it('accepts only the sanitized topic event shape', () => {
    expect(
      parseTopicEventDetail({
        topicId: 123,
        type: 'revised',
        postId: 456,
        updatedAt: '2026-08-22T00:00:00Z',
        cookie: 'must be ignored',
      }),
    ).toEqual({
      topicId: 123,
      type: 'revised',
      postId: 456,
      updatedAt: '2026-08-22T00:00:00Z',
    });
  });

  it('parses a serialized cross-world event payload', () => {
    expect(
      parseTopicEventDetail(
        JSON.stringify({ topicId: 123, type: 'deleted', postId: 456, ignored: 'value' }),
      ),
    ).toEqual({ topicId: 123, type: 'deleted', postId: 456 });
  });

  it('accepts reaction updates with a safe native emoji image URL', () => {
    expect(
      parseTopicEventDetail({
        topicId: 123,
        type: 'acted',
        postId: 456,
        currentReactionId: 'cry',
        currentReactionUrl: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
      }),
    ).toEqual({
      topicId: 123,
      type: 'acted',
      postId: 456,
      currentReactionId: 'cry',
      currentReactionUrl: 'https://cdn.linux.do/images/emoji/twitter/cry.png',
    });
  });

  it('rejects unsafe reaction image URLs', () => {
    expect(
      parseTopicEventDetail({
        topicId: 123,
        type: 'acted',
        postId: 456,
        currentReactionId: 'cry',
        currentReactionUrl: 'javascript:alert(1)',
      }),
    ).toBeNull();
  });

  it('rejects malformed serialized payloads', () => {
    expect(parseTopicEventDetail('{broken')).toBeNull();
  });

  it('accepts Discourse messages with a top-level post id', () => {
    expect(
      sanitizeTopicMessage(123, {
        type: 'created',
        id: 456,
        topic_id: 123,
        updated_at: '2026-08-22T00:00:00Z',
      }),
    ).toEqual({
      topicId: 123,
      type: 'created',
      postId: 456,
      updatedAt: '2026-08-22T00:00:00Z',
    });
  });

  it('accepts the acted message published after a reaction toggle', () => {
    expect(
      sanitizeTopicMessage(123, {
        type: 'acted',
        id: 456,
        topic_id: 123,
      }),
    ).toEqual({
      topicId: 123,
      type: 'acted',
      postId: 456,
    });
  });

  it.each(['boost_added', 'boost_removed'] as const)(
    'accepts the %s message published by discourse-boosts',
    (type) => {
      expect(
        sanitizeTopicMessage(123, {
          type,
          id: 456,
          topic_id: 123,
          boost: { id: 99, cooked: '<p>great</p>' },
        }),
      ).toEqual({ topicId: 123, type, postId: 456 });
    },
  );

  it('rejects messages for a different topic', () => {
    expect(sanitizeTopicMessage(123, { type: 'created', id: 456, topic_id: 999 })).toBeNull();
  });

  it.each([
    null,
    { topicId: 0, type: 'created', postId: 1 },
    { topicId: 1, type: 'unknown', postId: 1 },
    { topicId: 1, type: 'created', postId: '1' },
    { topicId: 1, type: 'created', postId: 1, updatedAt: 4 },
  ])('rejects invalid detail %#', (value) => {
    expect(parseTopicEventDetail(value)).toBeNull();
  });
});
