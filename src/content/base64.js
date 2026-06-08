/* Linux.do 工具箱 — Base64 选择工具模块 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  function decodeBase64Utf8(text) {
    const normalized = text.replace(/\s+/g, '');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // 兼容非 UTF-8 或历史内容，尽量给出可读结果。
      return binary;
    }
  }

  async function injectBase64Button() {
    const { output, settings: settingsApi } = namespace;
    const settings = await settingsApi.getSettings();
    if (!settings.enableBase64Decode) {
      document.querySelectorAll('.ldcopy-base64-btn').forEach((el) => el.remove());
      return;
    }

    const quoteContainer = document.querySelector('.quote-button');
    if (!quoteContainer || quoteContainer.querySelector('.ldcopy-base64-btn')) return;

    const base64Btn = document.createElement('button');
    base64Btn.className = 'btn btn-flat ldcopy-base64-btn';
    base64Btn.title = 'Base64 解码并复制';
    base64Btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: middle; margin-right: 2px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>base64';
    base64Btn.style.cssText = 'margin-right: 4px; padding: 4px 8px; font-size: 13px; order: -1; display: inline-flex; align-items: center;';

    base64Btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const selectedText = window.getSelection().toString().trim();
        if (!selectedText) {
          output.showToast('❌ 未选中文字');
          return;
        }
        await output.copyToClipboard(decodeBase64Utf8(selectedText));
        output.showToast('✅ Base64 解码已复制');
      } catch (err) {
        output.showToast('❌ Base64 解码失败: ' + err.message);
      }
    });

    quoteContainer.insertBefore(base64Btn, quoteContainer.firstChild);
  }

  namespace.base64 = {
    decodeBase64Utf8,
    injectBase64Button,
  };
})();
