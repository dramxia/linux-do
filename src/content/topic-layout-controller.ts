/* Linux.do 工具箱 - 双栏阅读的单一生命周期控制器 */
import type { DiscourseSettings } from '../common/settings';
import {
  getTopicIdentityKey,
  HISTORY_NAVIGATION_EVENT_NAME,
  PAGE_NAVIGATION_EVENT_NAME,
} from '../common/topic-route';
import { parseTopicEventDetail, TOPIC_EVENT_NAME } from './topic-events';
import { TopicLayoutRuntime, type TopicLayoutRuntimeState } from './topic-layout';
import {
  asTopicPageContext,
  captureTopicPageSnapshot,
  isSameTopicPageSnapshot,
  type TopicPageSnapshot,
} from './topic-page-context';

const MIN_VIEWPORT_WIDTH = 1280;

interface TopicLayoutDriver {
  activate(settings: DiscourseSettings, force?: boolean): Promise<void>;
  disable(): void;
  suspend(): void;
  invalidate(): void;
  reconcilePageContext(): void;
  getState(): TopicLayoutRuntimeState;
}

export class TopicLayoutController {
  private settings: DiscourseSettings | null = null;
  private pageSnapshot: TopicPageSnapshot = captureTopicPageSnapshot();
  private wideViewport = window.innerWidth >= MIN_VIEWPORT_WIDTH;
  private started = false;
  private resizeFrame: number | null = null;
  private pageRootObserver: MutationObserver | null = null;
  private dirtyLoadingTopicId: string | null = null;

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
    window.addEventListener('popstate', this.handleHistoryNavigation);
    window.addEventListener('pageshow', this.handlePageShow);
    window.addEventListener('resize', this.handleResize, { passive: true });
    document.addEventListener(HISTORY_NAVIGATION_EVENT_NAME, this.handleHistoryNavigation);
    document.addEventListener(PAGE_NAVIGATION_EVENT_NAME, this.handleNavigation);
    document.addEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    this.pageRootObserver = new MutationObserver(this.handlePageRootMutations);
    this.pageRootObserver.observe(document.body, { childList: true, subtree: true });
    void this.applyIntent();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('discourse-navigate-completed', this.handleNavigation);
    window.removeEventListener('page:change', this.handleNavigation);
    window.removeEventListener('popstate', this.handleHistoryNavigation);
    window.removeEventListener('pageshow', this.handlePageShow);
    window.removeEventListener('resize', this.handleResize);
    document.removeEventListener(HISTORY_NAVIGATION_EVENT_NAME, this.handleHistoryNavigation);
    document.removeEventListener(PAGE_NAVIGATION_EVENT_NAME, this.handleNavigation);
    document.removeEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent as EventListener);
    this.pageRootObserver?.disconnect();
    this.pageRootObserver = null;
    if (this.resizeFrame !== null) window.cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = null;
    this.dirtyLoadingTopicId = null;
    this.runtime.disable();
  }

  updateSettings(settings: DiscourseSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (!this.started) return;

    if (!settings.enableSplitReading) {
      this.dirtyLoadingTopicId = null;
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
    const previous = this.pageSnapshot;
    this.capturePageContext();
    if (isSameTopicPageSnapshot(previous, this.pageSnapshot)) {
      if (this.runtime.getState() === 'unsupported') {
        void this.applyIntent();
        return;
      }
      this.runtime.reconcilePageContext();
      return;
    }
    this.dirtyLoadingTopicId = null;
    this.runtime.invalidate();
    void this.applyIntent();
  };

  private readonly handleHistoryNavigation = (): void => {
    if (!this.started) return;
    const previous = this.pageSnapshot;
    this.capturePageContext();
    if (isSameTopicPageSnapshot(previous, this.pageSnapshot)) {
      this.runtime.reconcilePageContext();
      return;
    }
    this.dirtyLoadingTopicId = null;
    this.runtime.invalidate();
    this.runtime.suspend();
  };

  private readonly handlePageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) this.handleNavigation();
  };

  private readonly handleResize = (): void => {
    if (this.resizeFrame !== null) return;
    this.resizeFrame = window.requestAnimationFrame(() => {
      this.resizeFrame = null;
      const nextWideViewport = window.innerWidth >= MIN_VIEWPORT_WIDTH;
      if (nextWideViewport === this.wideViewport) {
        if (nextWideViewport) this.runtime.reconcilePageContext();
        return;
      }
      this.wideViewport = nextWideViewport;
      void this.applyIntent();
    });
  };

  private readonly handleTopicEvent = (event: CustomEvent<unknown>): void => {
    const detail = parseTopicEventDetail(event.detail);
    const route = captureTopicPageSnapshot().route;
    if (!detail || !route || String(detail.topicId) !== route.topicId) return;
    if (this.runtime.getState() === 'loading') {
      this.dirtyLoadingTopicId = getTopicIdentityKey(route);
      return;
    }
    this.runtime.invalidate();
  };

  private readonly handlePageRootMutations = (mutations: MutationRecord[]): void => {
    if (mutations.length === 0) return;
    const snapshot = captureTopicPageSnapshot();
    if (
      snapshot.pageRoot !== this.pageSnapshot.pageRoot ||
      Boolean(snapshot.topicMarker) !== Boolean(this.pageSnapshot.topicMarker) ||
      (this.runtime.getState() === 'unsupported' && asTopicPageContext(snapshot) !== null)
    ) {
      this.handleNavigation();
    }
  };

  private capturePageContext(): void {
    this.pageSnapshot = captureTopicPageSnapshot();
    this.wideViewport = window.innerWidth >= MIN_VIEWPORT_WIDTH;
  }

  private async applyIntent(): Promise<void> {
    const settings = this.settings;
    if (!settings) return;
    if (!settings.enableSplitReading) {
      this.dirtyLoadingTopicId = null;
      this.runtime.disable();
      return;
    }
    if (!asTopicPageContext(this.pageSnapshot) || !this.wideViewport) {
      this.dirtyLoadingTopicId = null;
      this.runtime.suspend();
      return;
    }
    await this.runtime.activate(settings);
    const activeTopicId = getTopicIdentityKey(captureTopicPageSnapshot().route);
    if (
      this.runtime.getState() === 'active' &&
      this.dirtyLoadingTopicId !== null &&
      this.dirtyLoadingTopicId === activeTopicId
    ) {
      this.dirtyLoadingTopicId = null;
      this.runtime.invalidate();
    }
  }
}
