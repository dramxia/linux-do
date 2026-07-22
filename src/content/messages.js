/* Linux.do 工具箱 — popup 消息通信模块 */
import * as discourse from './discourse.js';
import * as output from './output.js';
import * as postExport from './post-export.js';
import { getSettings as _getSettings } from '../common/settings.js';

function assertExportResult(result) {
  if (result.total === 0) throw new Error('当前页面没有检测到已加载楼层');
  if (result.successCount === 0) throw new Error('已加载楼层全部导出失败');
}

function getExportToastPrefix(result) {
  if (result.failureCount === 0) return '✅';
  return `⚠️ 已处理 ${result.successCount}/${result.total} 个楼层，${result.failureCount} 个失败。`;
}

export function registerMessageHandlers(refreshEnhancements) {
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
      refreshEnhancements?.();
      sendResponse({ success: true });
      return true;
    }

    if (msg.action === 'copyTopic') {
      (async () => {
        try {
          const settings = await _getSettings();
          const result = await postExport.collectLoadedPosts(settings);
          assertExportResult(result);
          const md = output.formatTopicMd(result.posts, discourse.getTopicTitle(), discourse.getTopicUrl(), settings);
          await output.copyToClipboard(md);
          sendResponse({ success: true, ...result });
          const prefix = getExportToastPrefix(result);
          output.showToast(result.failureCount === 0 ? '✅ 已复制整个主题' : `${prefix} 已复制`);
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
          const settings = await _getSettings();
          const result = await postExport.collectLoadedPosts(settings);
          assertExportResult(result);
          const title = discourse.getTopicTitle();
          const md = output.formatTopicMd(result.posts, title, discourse.getTopicUrl(), settings);
          const filename = output.sanitizeFilename(`${title}.md`);
          output.downloadFile(md, filename);
          sendResponse({ success: true, filename, ...result });
          const prefix = getExportToastPrefix(result);
          output.showToast(result.failureCount === 0 ? `✅ 已下载 ${filename}` : `${prefix} 已下载 ${filename}`);
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

export const messages = {
  registerMessageHandlers,
};
