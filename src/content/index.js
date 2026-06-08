/* Linux.do 工具箱 — Content Script 入口 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  function refreshEnhancements() {
    namespace.buttons.injectButtons();
    namespace.base64.injectBase64Button();
  }

  function bindDynamicPageEvents() {
    document.addEventListener('selectionchange', () => {
      setTimeout(() => namespace.base64.injectBase64Button(), 100);
    });

    const observer = new MutationObserver(() => refreshEnhancements());
    observer.observe(document.querySelector('#main-outlet, #main, body') || document.body, {
      childList: true,
      subtree: true,
    });

    window.addEventListener('discourse-navigate-completed', refreshEnhancements);
    window.addEventListener('page:change', refreshEnhancements);
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
