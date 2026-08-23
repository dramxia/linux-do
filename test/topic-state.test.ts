import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildPaginationItems,
  buildNativeFloorUrl,
  COMMENTS_PAGE_PARAM,
  deriveInitialPage,
  getCommentPageForFloor,
  getTopicBaseUrl,
  parseTopicRoute,
  readTopicState,
  updatePageUrl,
  writeTopicState,
} from '../src/content/topic-state';

beforeEach(() => sessionStorage.clear());

describe('topic route and pagination state', () => {
  it.each([
    ['/t/topic/2766557', { topicId: '2766557', floor: undefined }],
    ['/t/topic/2766557/25', { topicId: '2766557', floor: 25 }],
    ['/t/2766557', { topicId: '2766557', floor: undefined }],
  ])('parses %s', (pathname, expected) => {
    expect(parseTopicRoute(pathname)).toEqual(expected);
  });

  it.each([
    '/',
    '/latest',
    '/top/2026/8',
    '/t',
    '/t/topic',
    '/t/topic/0',
    '/t/topic/123/not-a-floor',
    '/t/category/99/topic/123',
    '/t/topic/archive/123',
    '/t//123',
  ])('rejects non-detail route %s', (pathname) => {
    expect(parseTopicRoute(pathname)).toBeNull();
  });

  it('maps floors to comment pages with floor 1 reserved for the article', () => {
    expect(getCommentPageForFloor(1, 10)).toBe(1);
    expect(getCommentPageForFloor(2, 10)).toBe(1);
    expect(getCommentPageForFloor(11, 10)).toBe(1);
    expect(getCommentPageForFloor(12, 10)).toBe(2);
  });

  it('uses URL page before floor, session, and unread state', () => {
    const url = new URL('https://linux.do/t/topic/123/25');
    url.searchParams.set(COMMENTS_PAGE_PARAM, '4');
    expect(
      deriveInitialPage({
        url,
        routeFloor: 25,
        sessionPage: 3,
        lastReadPostNumber: 12,
        perPage: 10,
        pageCount: 8,
      }),
    ).toBe(4);
  });

  it('falls back from floor to session, unread, then page 1', () => {
    const url = new URL('https://linux.do/t/topic/123');
    const base = { url, perPage: 10, pageCount: 8 };
    expect(deriveInitialPage({ ...base, routeFloor: 25, sessionPage: 3 })).toBe(3);
    expect(deriveInitialPage({ ...base, sessionPage: 3, lastReadPostNumber: 42 })).toBe(3);
    expect(deriveInitialPage({ ...base, lastReadPostNumber: 42 })).toBe(5);
    expect(deriveInitialPage(base)).toBe(1);
  });

  it('builds a compact pagination window', () => {
    expect(buildPaginationItems(6, 12)).toEqual([1, 'ellipsis', 5, 6, 7, 'ellipsis', 12]);
    expect(buildPaginationItems(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('writes the selected page, including an explicit page 1', () => {
    const base = new URL('https://linux.do/t/topic/123?x=1');
    expect(updatePageUrl(base, 3).searchParams.get(COMMENTS_PAGE_PARAM)).toBe('3');
    expect(updatePageUrl(updatePageUrl(base, 3), 1).searchParams.get(COMMENTS_PAGE_PARAM)).toBe(
      '1',
    );
  });

  it('separates native floor URLs from canonical split-page URLs', () => {
    const floorUrl = new URL('https://linux.do/t/some-topic/123/50?x=1&ldo_comments_page=3#post');

    expect(getTopicBaseUrl(floorUrl).href).toBe(
      'https://linux.do/t/some-topic/123?x=1&ldo_comments_page=3#post',
    );
    expect(updatePageUrl(floorUrl, 4).href).toBe(
      'https://linux.do/t/some-topic/123?x=1&ldo_comments_page=4',
    );
    expect(buildNativeFloorUrl(floorUrl, 72).href).toBe('https://linux.do/t/some-topic/123/72?x=1');
  });

  it('round-trips split scroll state through session storage', () => {
    writeTopicState('123', {
      page: 2,
      leftScrollTop: 80,
      rightScrollTop: 40,
      articleFooterHeight: 224,
    });
    expect(readTopicState('123')).toEqual({
      page: 2,
      leftScrollTop: 80,
      rightScrollTop: 40,
      articleFooterHeight: 224,
    });
  });

  it('drops legacy native-mode fields from stored state', () => {
    sessionStorage.setItem(
      'ldtk:split-reading:123',
      JSON.stringify({
        page: 1,
        leftScrollTop: 0,
        rightScrollTop: 0,
        nativeMode: true,
        pendingAction: { floor: 2, action: 'invalid-action' },
      }),
    );
    expect(readTopicState('123')).toEqual({
      page: 1,
      leftScrollTop: 0,
      rightScrollTop: 0,
    });
  });
});
