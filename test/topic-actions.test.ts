import { describe, expect, it } from 'vitest';
import {
  parseTopicActionRequest,
  parseTopicActionResult,
  parseTopicInteractionRequest,
  parseTopicInteractionResult,
} from '../src/content/topic-actions';

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

  it('accepts a Boost submission with inline content', () => {
    expect(
      parseTopicActionRequest({
        requestId: 'boost:1',
        topicId: 123,
        postId: 456,
        floor: 7,
        action: 'boost',
        routeUrl: 'https://linux.do/t/topic/123/7',
        boostRaw: '支持一下',
      })?.action,
    ).toBe('boost');
  });

  it('rejects a Boost action without content', () => {
    expect(
      parseTopicActionRequest({
        requestId: 'boost:2',
        topicId: 123,
        postId: 456,
        floor: 7,
        action: 'boost',
        routeUrl: 'https://linux.do/t/topic/123/7',
      }),
    ).toBeNull();
  });

  it('accepts a custom reaction action and rejects one without a reaction id', () => {
    const request = {
      requestId: 'reaction:1',
      topicId: 123,
      postId: 456,
      floor: 7,
      action: 'reaction',
      routeUrl: 'https://linux.do/t/topic/123/7',
    };
    expect(parseTopicActionRequest({ ...request, reactionId: 'heart' })).toMatchObject({
      action: 'reaction',
      reactionId: 'heart',
    });
    expect(parseTopicActionRequest(request)).toBeNull();
  });

  it('accepts a shared-issue action and its state payload', () => {
    expect(
      parseTopicActionRequest({
        requestId: 'shared-issue:1',
        topicId: 123,
        postId: 456,
        floor: 1,
        action: 'sharedIssue',
        routeUrl: 'https://linux.do/t/topic/123',
      }),
    ).toMatchObject({ action: 'sharedIssue' });
    expect(
      parseTopicActionResult({
        requestId: 'shared-issue:1',
        ok: true,
        phase: 'settled',
        sharedIssueCount: 7,
        userCreatedSharedIssue: true,
      }),
    ).toMatchObject({ sharedIssueCount: 7, userCreatedSharedIssue: true });
  });

  it('rejects incomplete shared-issue result state', () => {
    expect(
      parseTopicActionResult({
        requestId: 'shared-issue:2',
        ok: true,
        phase: 'settled',
        sharedIssueCount: 7,
      }),
    ).toBeNull();
  });

  it('rejects results with an unknown phase', () => {
    expect(
      parseTopicActionResult({ requestId: 'action:2', ok: true, phase: 'finished' }),
    ).toBeNull();
  });

  it('parses silent interaction requests and drops extra fields', () => {
    expect(
      parseTopicInteractionRequest(
        JSON.stringify({
          requestId: 'interaction:1',
          topicId: 123,
          postId: 456,
          floor: 7,
          interaction: 'likeUsers',
          page: 2,
          pageSize: 30,
          routeUrl: 'https://linux.do/t/topic/123/7?ldo_comments_page=1',
          token: 'ignored',
        }),
      ),
    ).toEqual({
      requestId: 'interaction:1',
      topicId: 123,
      postId: 456,
      floor: 7,
      interaction: 'likeUsers',
      page: 2,
      pageSize: 30,
      routeUrl: 'https://linux.do/t/topic/123/7?ldo_comments_page=1',
    });
  });

  it('rejects malformed silent interaction requests', () => {
    expect(
      parseTopicInteractionRequest({
        requestId: 'interaction:2',
        topicId: 123,
        postId: 456,
        floor: 7,
        interaction: 'likeUsers',
        page: -1,
        pageSize: 30,
        routeUrl: '/t/topic/123/7',
      }),
    ).toBeNull();
  });

  it('accepts sanitized reaction options and like users results', () => {
    expect(
      parseTopicInteractionResult({
        requestId: 'interaction:3',
        interaction: 'reactionOptions',
        ok: true,
        reactionOptions: [{ id: 'heart', url: 'https://linux.do/images/heart.png', isMain: true }],
      }),
    ).toMatchObject({ interaction: 'reactionOptions', ok: true });
    expect(
      parseTopicInteractionResult({
        requestId: 'interaction:4',
        interaction: 'likeUsers',
        ok: true,
        users: [{ id: 1, username: 'alice', avatarTemplate: '/avatar/{size}.png' }],
        total: 1,
        hasMore: false,
      }),
    ).toMatchObject({ interaction: 'likeUsers', ok: true, total: 1 });
  });
});
