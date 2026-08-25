/* Linux.do 工具箱 - 双栏阅读的分页、路由与会话状态 */

import { parseTopicRoute } from '../common/topic-route';

export { parseTopicRoute, type TopicRoute } from '../common/topic-route';

export const COMMENTS_PAGE_PARAM = 'ldo_comments_page';
const SESSION_PREFIX = 'ldtk:split-reading:';

export interface TopicReadingState {
  page: number;
  leftScrollTop: number;
  rightScrollTop: number;
  articleFooterHeight?: number;
  articleColumnWidthPercent?: number;
}

export type PaginationItem = number | 'ellipsis';

export function getPageCount(commentCount: number, perPage: number): number {
  return Math.max(1, Math.ceil(Math.max(0, commentCount) / perPage));
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
}

export function getCommentPageForFloor(floor: number, perPage: number): number {
  if (!Number.isFinite(floor) || floor <= 1) return 1;
  return Math.floor((Math.trunc(floor) - 2) / perPage) + 1;
}

function parsePositiveInteger(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return parsed > 0 ? parsed : undefined;
}

export function deriveInitialPage(options: {
  url: URL;
  routeFloor?: number;
  sessionPage?: number;
  lastReadPostNumber?: number;
  perPage: number;
  pageCount: number;
}): number {
  const urlPage = parsePositiveInteger(options.url.searchParams.get(COMMENTS_PAGE_PARAM));
  if (urlPage) return clampPage(urlPage, options.pageCount);
  if (options.routeFloor && options.routeFloor > 1) {
    return clampPage(
      getCommentPageForFloor(options.routeFloor, options.perPage),
      options.pageCount,
    );
  }
  if (options.sessionPage) return clampPage(options.sessionPage, options.pageCount);
  if (options.lastReadPostNumber && options.lastReadPostNumber > 0) {
    const firstUnreadFloor = options.lastReadPostNumber + 1;
    return clampPage(getCommentPageForFloor(firstUnreadFloor, options.perPage), options.pageCount);
  }
  return 1;
}

export function buildPaginationItems(currentPage: number, pageCount: number): PaginationItem[] {
  const total = Math.max(1, Math.trunc(pageCount));
  const current = clampPage(currentPage, total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current - 1, current, current + 1]);
  const ordered = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: PaginationItem[] = [];
  ordered.forEach((page, index) => {
    const previous = ordered[index - 1];
    if (previous && page - previous > 1) result.push('ellipsis');
    result.push(page);
  });
  return result;
}

export function updatePageUrl(url: URL, page: number): URL {
  const next = getTopicBaseUrl(url);
  next.searchParams.set(COMMENTS_PAGE_PARAM, String(Math.max(1, Math.trunc(page))));
  next.hash = '';
  return next;
}

export function getTopicBaseUrl(url: URL): URL {
  const next = new URL(url.href);
  const route = parseTopicRoute(next.pathname);
  if (!route?.floor) return next;
  const parts = next.pathname.split('/').filter(Boolean);
  parts.pop();
  next.pathname = `/${parts.join('/')}`;
  return next;
}

export function buildNativeFloorUrl(url: URL, floor: number): URL {
  const next = getTopicBaseUrl(url);
  if (Number.isFinite(floor) && floor > 1) {
    next.pathname = `${next.pathname.replace(/\/$/, '')}/${Math.trunc(floor)}`;
  }
  next.searchParams.delete(COMMENTS_PAGE_PARAM);
  next.hash = '';
  return next;
}

function getSessionKey(topicId: string): string {
  return `${SESSION_PREFIX}${topicId}`;
}

export function readTopicState(
  topicId: string,
  storage: Storage = sessionStorage,
): TopicReadingState | null {
  try {
    const raw = storage.getItem(getSessionKey(topicId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<TopicReadingState>;
    if (typeof value.page !== 'number' || !Number.isFinite(value.page) || value.page < 1) {
      return null;
    }
    const articleFooterHeight =
      typeof value.articleFooterHeight === 'number' &&
      Number.isFinite(value.articleFooterHeight) &&
      value.articleFooterHeight > 0
        ? Math.round(value.articleFooterHeight)
        : undefined;
    const articleColumnWidthPercent =
      typeof value.articleColumnWidthPercent === 'number' &&
      Number.isFinite(value.articleColumnWidthPercent) &&
      value.articleColumnWidthPercent > 0 &&
      value.articleColumnWidthPercent < 100
        ? Math.round(value.articleColumnWidthPercent * 10) / 10
        : undefined;
    return {
      page: Math.max(1, Math.trunc(value.page)),
      leftScrollTop: Math.max(0, Number(value.leftScrollTop) || 0),
      rightScrollTop: Math.max(0, Number(value.rightScrollTop) || 0),
      ...(articleFooterHeight === undefined ? {} : { articleFooterHeight }),
      ...(articleColumnWidthPercent === undefined ? {} : { articleColumnWidthPercent }),
    };
  } catch {
    return null;
  }
}

export function writeTopicState(
  topicId: string,
  state: TopicReadingState,
  storage: Storage = sessionStorage,
): void {
  try {
    storage.setItem(getSessionKey(topicId), JSON.stringify(state));
  } catch {
    // Storage may be unavailable in privacy mode; the layout still works without persistence.
  }
}
