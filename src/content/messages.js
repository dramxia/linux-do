/* Linux.do 工具箱 — popup 消息通信模块 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  function registerMessageHandlers() {
    const { discourse, output, postExport, settings: settingsApi } = namespace;

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.action === 'getInfo') {
        const postEls = discourse.getPostElements();
        sendResponse({
          title: discourse.getTopicTitle(),
          url: discourse.getTopicUrl(),
          postCount: postEls.length,
        });
        return true;
      }

      if (msg.action === 'refreshEnhancements') {
        namespace.app?.refreshEnhancements?.();
        sendResponse({ success: true });
        return true;
      }

      if (msg.action === 'copyTopic') {
        (async () => {
          try {
            const settings = await settingsApi.getSettings();
            const posts = await postExport.getAllPostsRaw(settings);
            const md = output.formatTopicMd(posts, discourse.getTopicTitle(), discourse.getTopicUrl(), settings);
            await output.copyToClipboard(md);
            sendResponse({ success: true });
            output.showToast('✅ 已复制整个主题');
          } catch (err) {
            sendResponse({ success: false, error: err.message });
            output.showToast('❌ 失败: ' + err.message);
          }
        })();
        return true;
      }

      if (msg.action === 'downloadTopic') {
        (async () => {
          try {
            const settings = await settingsApi.getSettings();
            const posts = await postExport.getAllPostsRaw(settings);
            const title = discourse.getTopicTitle();
            const md = output.formatTopicMd(posts, title, discourse.getTopicUrl(), settings);
            const filename = output.sanitizeFilename(`${title}.md`);
            output.downloadFile(md, filename);
            sendResponse({ success: true, filename });
            output.showToast(`✅ 已下载 ${filename}`);
          } catch (err) {
            sendResponse({ success: false, error: err.message });
            output.showToast('❌ 失败: ' + err.message);
          }
        })();
        return true;
      }

      return false;
    });
  }

  namespace.messages = {
    registerMessageHandlers,
  };
})();
