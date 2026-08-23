/* Linux.do 工具箱 - 双栏阅读的单一生命周期控制器 */
import type { DiscourseSettings } from '../common/settings';
import { parseTopicEventDetail, TOPIC_EVENT_NAME } from './topic-events';
import { parseTopicRoute } from './topic-state';
import { TopicLayoutRuntime, type TopicLayoutRuntimeState } from './topic-layout';

const MIN_VIEWPORT_WIDTH = 1280;

interface TopicLayoutDriver {
  activate(settings: DiscourseSettings, force?: boolean): Promise<void>;
  disable(): void;
  invalidate(): void;
  updateGeometry(): void;
  getState(): TopicLayoutRuntimeState;
}

function getRouteKey(): string | null {
  const route = parseTopicRoute(window.location.pathname);
  return route ? `${route.topicId}:${route.floor ?? ''}` : null;
}

export class TopicLayoutController {
  private settings: DiscourseSettings | null = null;
  private routeKey: string | null = null;
  private pageRoot: HTMLElement | null = null;
  private wideViewport = window.innerWidth >= MIN_VIEWPORT_WIDTH;
  private started = false;
  private navigationFrame: number | null = null;
  private resizeFrame: number | null = null;

  constructor(private readonly runtime: TopicLayoutDriver = new TopicLayoutRuntime()) {}

  start(settings: DiscourseSettings): void {
    if (this.started) {
      this.updateSettings(settings);
      return;
    }
    this.started = true;
    this.settings = settings;
    this.capturePageContext();
    window.addEventListener('discourse-navigate-completed', this.handleNavigation);
    window.addEventListener('page:change', this.handleNavigation);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('resize', this.handleResize, { passive: true });
    document.addEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    void this.applyIntent();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('discourse-navigate-completed', this.handleNavigation);
    window.removeEventListener('page:change', this.handleNavigation);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    if (this.navigationFrame !== null) window.cancelAnimationFrame(this.navigationFrame);
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
    this.navigationFrame = null;
    this.resizeFrame = null;
    this.runtime.disable();
  }

  updateSettings(settings: DiscourseSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (!this.started) return;

    if (!settings.enableSplitReading) {
      this.runtime.disable();
      return;
    }

    const layoutIntentChanged =
      !previous?.enableSplitReading || previous.commentsPerPage !== settings.commentsPerPage;
    if (layoutIntentChanged || this.runtime.getState() === 'disabled') {
      void this.applyIntent();
    }
  }

  private readonly handleNavigation = (): void => {
    if (!this.started) return;
    this.reconcilePageContext(true);
    if (this.navigationFrame !== null) return;
    this.navigationFrame = window.requestAnimationFrame(() => {
      this.navigationFrame = null;
      if (this.started) this.reconcilePageContext(false);
    });
  };

  private reconcilePageContext(updateGeometry: boolean): void {
    const previousRouteKey = this.routeKey;
    const previousPageRoot = this.pageRoot;
    this.capturePageContext();
    if (previousRouteKey === this.routeKey && previousPageRoot === this.pageRoot) {
      if (updateGeometry) this.runtime.updateGeometry();
      return;
    }
    this.runtime.invalidate();
    void this.applyIntent();
  }

  private readonly handlePageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) this.handleNavigation();
  };

  private readonly handleResize = (): void => {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = null;
      const nextWideViewport = window.innerWidth >= MIN_VIEWPORT_WIDTH;
      if (nextWideViewport === this.wideViewport) {
        if (nextWideViewport) this.runtime.updateGeometry();
        return;
      }
      this.wideViewport = nextWideViewport;
      void this.applyIntent();
    });
  };

  private readonly handleTopicEvent = (event: CustomEvent<unknown>): void => {
    const detail = parseTopicEventDetail(event.detail);
    const route = parseTopicRoute(window.location.pathname);
    if (!detail || !route || String(detail.topicId) !== route.topicId) return;
    const loading = this.runtime.getState() === 'loading';
    this.runtime.invalidate();
    if (loading && this.settings?.enableSplitReading) void this.applyIntent();
  };

  private capturePageContext(): void {
    this.routeKey = getRouteKey();
    this.pageRoot = document.getElementById('main-outlet');
    this.wideViewport = window.innerWidth >= MIN_VIEWPORT_WIDTH;
  }

  private async applyIntent(): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    if (!settings.enableSplitReading) {
      this.runtime.disable();
      return;
    }
    await this.runtime.activate(settings);
  }
}
