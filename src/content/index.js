/* Linux.do 工具箱 — Content Script 入口 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  let refreshTimer = null;
  let base64Timer = null;
  let refreshInFlight = false;
  let refreshPending = false;

  function refreshEnhancements() {
    if (refreshInFlight) {
      refreshPending = true;
      return;
    }

    refreshInFlight = true;
    Promise.all([
      namespace.buttons.injectButtons(),
      namespace.base64.injectBase64Button(),
    ]).catch(() => {
      // 页面增强失败不应影响宿主页面，后续 DOM 变化会再次触发刷新。
    }).finally(() => {
      refreshInFlight = false;
      if (refreshPending) {
        refreshPending = false;
        scheduleRefreshEnhancements();
      }
    });
  }

  function scheduleRefreshEnhancements(delay = 150) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshEnhancements();
    }, delay);
  }

  function scheduleBase64ButtonRefresh(delay = 100) {
    if (base64Timer) clearTimeout(base64Timer);
    base64Timer = setTimeout(() => {
      base64Timer = null;
      namespace.base64.injectBase64Button();
    }, delay);
  }

  function bindDynamicPageEvents() {
    document.addEventListener('selectionchange', () => {
      scheduleBase64ButtonRefresh();
    });

    const observer = new MutationObserver(() => scheduleRefreshEnhancements());
    observer.observe(document.querySelector('#main-outlet, #main, body') || document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('discourse-navigate-completed', () => scheduleRefreshEnhancements(0));
    window.addEventListener('page:change', () => scheduleRefreshEnhancements(0));
  }

  function init() {
    namespace.app = { refreshEnhancements };
    namespace.messages.registerMessageHandlers();
    refreshEnhancements();
    bindDynamicPageEvents();
    namespace.settings.onSettingsChanged(refreshEnhancements);
  }

  init();
})();
