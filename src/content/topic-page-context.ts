/* Linux.do 工具箱 - 双栏阅读的详情页资格模型 */

import { isSameTopicIdentity, parseTopicRoute, type TopicRoute } from '../common/topic-route';

const NATIVE_ARTICLE_SELECTOR =
  '#topic-title, .topic-post-stream, .topic-post[data-post-number], article[data-post-number]';

export interface TopicPageSnapshot {
  route: TopicRoute | null;
  pageRoot: HTMLElement | null;
  topicMarker: HTMLElement | null;
}

export interface TopicPageContext extends TopicPageSnapshot {
  route: TopicRoute;
  pageRoot: HTMLElement;
  topicMarker: HTMLElement;
}

export function captureTopicPageSnapshot(): TopicPageSnapshot {
  const route = parseTopicRoute(window.location.pathname);
  const pageRoot = document.getElementById('main-outlet');
  const topicMarker = pageRoot?.querySelector<HTMLElement>(NATIVE_ARTICLE_SELECTOR) ?? null;
  return { route, pageRoot, topicMarker };
}

export function asTopicPageContext(snapshot: TopicPageSnapshot): TopicPageContext | null {
  const { route, pageRoot, topicMarker } = snapshot;
  return route && pageRoot && topicMarker ? { route, pageRoot, topicMarker } : null;
}

export function isSameTopicPageSnapshot(
  left: TopicPageSnapshot,
  right: TopicPageSnapshot,
): boolean {
  const sameRoute =
    left.route === null
      ? right.route === null
      : right.route !== null && isSameTopicIdentity(left.route, right.route);
  return (
    sameRoute &&
    left.pageRoot === right.pageRoot &&
    Boolean(left.topicMarker) === Boolean(right.topicMarker)
  );
}

export function captureTopicPageContext(): TopicPageContext | null {
  return asTopicPageContext(captureTopicPageSnapshot());
}

export function isTopicPageContextCurrent(context: TopicPageContext): boolean {
  const current = captureTopicPageContext();
  return (
    current !== null &&
    current.pageRoot === context.pageRoot &&
    isSameTopicIdentity(context.route, current.route)
  );
}
