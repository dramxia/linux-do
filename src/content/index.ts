/* Linux.do 工具箱 — Content Script 入口 */
import { layout } from './layout/split-pane-layout';
import { buttons } from './buttons';
import { base64 } from './base64';
import { messages } from './messages';
import { getCachedSettings, onSettingsChanged, type DiscourseSettings } from '../common/settings';
import { RefreshState } from './refresh-state';
import { ManagedObserver } from './managed-observer';
import { isExpectedLayoutMutation } from './layout/layout-mutation-tracker';

const refreshState = new RefreshState();
let latestSettings: DiscourseSettings | null = null;

async function refreshEnhancements(settings?: DiscourseSettings): Promise<void> {
  if (settings) {
    latestSettings = settings;
    if (settings.enableSplitLayout) layout.prepareTopicSplitLayout();
  }

  if (!refreshState.tryAcquire()) {
    refreshState.markPending();
    return;
  }

  Promise.resolve()
    .then(async () => {
      await layout.applyTopicSplitLayout(settings);
      await buttons.injectButtons();
      await base64.injectBase64Button();
    })
    .catch(() => {
      // 页面增强失败不应影响宿主页面，后续 DOM 变化会再次触发刷新。
    })
    .finally(() => {
      refreshState.release();
      if (refreshState.hasPending()) {
        refreshState.clearPending();
        scheduleRefreshEnhancements();
      }
    });
}

function scheduleRefreshEnhancements(delay = 150): void {
  refreshState.scheduleRefresh(refreshEnhancements, delay);
}

function scheduleBase64ButtonRefresh(delay = 100): void {
  refreshState.scheduleBase64(() => {
    base64.injectBase64Button();
  }, delay);
}

function bindDynamicPageEvents(): void {
  document.addEventListener('selectionchange', () => {
    scheduleBase64ButtonRefresh();
  });

  const target = document.body;
  const managedObserver = new ManagedObserver(
    target,
    {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    },
    (mutations) => {
      const relevantMutations = mutations.filter(
        (mutation) =>
          mutation.type !== 'attributes' ||
          (mutation.target instanceof Element &&
            mutation.target.matches('button.btn-sidebar-toggle')),
      );
      if (!relevantMutations.length) return;

      const requiresLayoutRebuild = relevantMutations.some((mutation) =>
        Array.from(mutation.addedNodes || [])
          .concat(Array.from(mutation.removedNodes || []))
          .some(
            (node) =>
              node.nodeType === Node.ELEMENT_NODE &&
              !isExpectedLayoutMutation(node) &&
              ((node as Element).matches('.post-stream, #post_stream, #post-stream') ||
                (node as Element).matches('.topic-post[data-post-number="1"]') ||
                Boolean((node as Element).querySelector('.topic-post[data-post-number="1"]'))),
          ),
      );
      const onlyToolkitChanges = relevantMutations.every((mutation) => {
        if (mutation.type === 'attributes') return false;
        const changedNodes = Array.from(mutation.addedNodes || []).concat(
          Array.from(mutation.removedNodes || []),
        );
        if (!changedNodes.length) return false;

        return changedNodes.every((node) => {
          if (isExpectedLayoutMutation(node)) return true;
          if (node.nodeType !== Node.ELEMENT_NODE) return true;
          const element = node as Element;
          if (
            element.matches(
              '.ldtk-shadow-host, [id^="ldcopy-"], .ldtk-topic-split-wrapper, .ldtk-topic-article-pane, .ldtk-topic-article-actions, .ldtk-topic-header-title',
            )
          ) {
            return true;
          }

          return Boolean(element.closest('.ldtk-shadow-host, .ldtk-topic-header-title'));
        });
      });

      if (!onlyToolkitChanges) {
        if (requiresLayoutRebuild && latestSettings?.enableSplitLayout) {
          layout.prepareTopicSplitLayout();
        }
        scheduleRefreshEnhancements(requiresLayoutRebuild ? 0 : 150);
      }
    },
  );
  managedObserver.start();

  const handleNavigation = (): void => {
    if (latestSettings?.enableSplitLayout) layout.prepareTopicSplitLayout();
    scheduleRefreshEnhancements(0);
  };
  window.addEventListener('discourse-navigate-completed', handleNavigation);
  window.addEventListener('page:change', handleNavigation);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) handleNavigation();
  });
}

function init(initialSettings: DiscourseSettings): void {
  messages.registerMessageHandlers(refreshEnhancements);
  bindDynamicPageEvents();
  onSettingsChanged((settings) => {
    latestSettings = settings;
    void refreshEnhancements(settings);
  });
  void refreshEnhancements(initialSettings);
}

function waitForDomReady(): Promise<void> {
  if (document.readyState !== 'loading') return Promise.resolve();
  return new Promise((resolve) => {
    document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
  });
}

async function bootstrap(): Promise<void> {
  layout.prepareTopicSplitLayout();
  const initialSettings = await getCachedSettings();
  latestSettings = initialSettings;
  if (!initialSettings.enableSplitLayout) layout.restoreTopicSplitLayout();
  await waitForDomReady();
  init(initialSettings);
}

void bootstrap();
