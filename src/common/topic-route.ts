/* Linux.do 工具箱 - 严格的主题详情路由与页面导航契约 */

export const PAGE_NAVIGATION_EVENT_NAME = 'ldtk:page-navigation';
export const HISTORY_NAVIGATION_EVENT_NAME = 'ldtk:history-navigation';

export interface TopicRoute {
  topicId: string;
  floor?: number;
}

function parsePositiveInteger(value: string | undefined): string | null {
  return value && /^[1-9]\d*$/.test(value) ? value : null;
}

export function parseTopicRoute(pathname: string): TopicRoute | null {
  if (!pathname.startsWith('/') || pathname.includes('//')) return null;
  const normalized =
    pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  const parts = normalized.slice(1).split('/');
  if (parts[0] !== 't') return null;

  if (parts.length === 2) {
    const topicId = parsePositiveInteger(parts[1]);
    return topicId ? { topicId } : null;
  }

  if (parts.length === 3) {
    const shorthandTopicId = parsePositiveInteger(parts[1]);
    const finalNumber = parsePositiveInteger(parts[2]);
    if (!finalNumber) return null;
    return shorthandTopicId
      ? { topicId: shorthandTopicId, floor: Number(finalNumber) }
      : { topicId: finalNumber };
  }

  if (parts.length === 4 && parts[1]) {
    const topicId = parsePositiveInteger(parts[2]);
    const floor = parsePositiveInteger(parts[3]);
    return topicId && floor ? { topicId, floor: Number(floor) } : null;
  }

  return null;
}

export function getTopicRouteKey(route: TopicRoute | null): string | null {
  return route ? `${route.topicId}:${route.floor ?? ''}` : null;
}

export function isSameTopicRoute(left: TopicRoute, right: TopicRoute | null): boolean {
  return left.topicId === right?.topicId && left.floor === right.floor;
}
