/* Linux.do 工具箱 - 双栏 TopicResponse 预取协调器 */

import type { DiscourseSettings } from '../common/settings';
import {
  getTopicIdentityKey,
  HISTORY_NAVIGATION_EVENT_NAME,
  PAGE_NAVIGATION_EVENT_NAME,
  parseTopicRoute,
} from '../common/topic-route';
import {
  clearTopicResponsePrefetches,
  prefetchTopicResponse,
  pruneTopicResponsePrefetches,
} from './topic-api';
import { noteTopicRouteDetected, noteTopicRouteLeft } from './topic-perf';

const MIN_VIEWPORT_WIDTH = 1280;

export class TopicPrefetchCoordinator {
  private settings: DiscourseSettings | null = null;
  private bound = false;
  private resizeFrame: number | null = null;

  update(settings: DiscourseSettings): void {
    this.settings = settings;
    if (!this.bound) this.bind();
    this.sync();
  }

  sync(): void {
    const route = parseTopicRoute(window.location.pathname);
    if (route) noteTopicRouteDetected(route);
    else noteTopicRouteLeft();
    const eligible =
      route &&
      this.settings?.enableSplitReading === true &&
      window.innerWidth >= MIN_VIEWPORT_WIDTH;
    if (!eligible) {
      clearTopicResponsePrefetches();
      return;
    }
    const key = getTopicIdentityKey(route);
    pruneTopicResponsePrefetches(key ? [key] : []);
    prefetchTopicResponse(route);
  }

  private bind(): void {
    this.bound = true;
    const handleNavigation = (): void => this.sync();
    window.addEventListener('discourse-navigate-completed', handleNavigation);
    window.addEventListener('page:change', handleNavigation);
    window.addEventListener('popstate', handleNavigation);
    document.addEventListener(HISTORY_NAVIGATION_EVENT_NAME, handleNavigation);
    document.addEventListener(PAGE_NAVIGATION_EVENT_NAME, handleNavigation);
    window.addEventListener(
      'resize',
      () => {
        if (this.resizeFrame !== null) return;
        this.resizeFrame = window.requestAnimationFrame(() => {
          this.resizeFrame = null;
          this.sync();
        });
      },
      { passive: true },
    );
  }
}
