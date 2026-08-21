/* Linux.do 工具箱 — popup 消息通信模块 */
import { getPostElements, getTopicTitle, getTopicUrl } from './discourse';
import {
  copyToClipboard,
  downloadFile,
  formatTopicMd,
  sanitizeFilename,
  showToast,
} from './output';
import { collectLoadedPosts } from './post-export';
import type { ExportResult } from './post-export';
import { getCachedSettings } from '../common/settings';
import { getErrorMessage, handleError } from './error-handler';

export type ContentMessage =
  { action: 'getInfo' } | { action: 'copyTopic' } | { action: 'downloadTopic' };

export interface PageInfoResponse {
  title: string;
  postCount: number;
}

interface ExportResponse {
  success: true;
  posts: ExportResult['posts'];
  failures: ExportResult['failures'];
  total: number;
  successCount: number;
  failureCount: number;
  filename?: string;
}

interface ErrorResponse {
  success: false;
  error: string;
}

type MessageResponse = PageInfoResponse | ExportResponse | ErrorResponse;

export function assertExportResult(result: ExportResult): void {
  if (result.total === 0) throw new Error('当前页面没有检测到已加载楼层');
  if (result.successCount === 0) throw new Error('已加载楼层全部导出失败');
}

export function getExportToastPrefix(result: ExportResult): string {
  if (result.failureCount === 0) return '✅';
  return `⚠️ 已处理 ${result.successCount}/${result.total} 个楼层，${result.failureCount} 个失败。`;
}

type TopicExportAction = 'copy' | 'download';

interface TopicExportOutcome {
  response: ExportResponse;
  toast: string;
}

async function exportTopic(action: TopicExportAction): Promise<TopicExportOutcome> {
  const settings = await getCachedSettings();
  const result = await collectLoadedPosts(settings);
  assertExportResult(result);

  const title = getTopicTitle();
  const markdown = formatTopicMd(result.posts, getTopicUrl(), settings);
  const prefix = getExportToastPrefix(result);

  if (action === 'copy') {
    await copyToClipboard(markdown);
    return {
      response: { success: true, ...result },
      toast: result.failureCount === 0 ? '✅ 已复制整个主题' : `${prefix} 已复制`,
    };
  }

  const filename = sanitizeFilename(`${title}.md`);
  downloadFile(markdown, filename);
  return {
    response: { success: true, filename, ...result },
    toast: result.failureCount === 0 ? `✅ 已下载 ${filename}` : `${prefix} 已下载 ${filename}`,
  };
}

async function handleTopicExport(
  action: TopicExportAction,
  sendResponse: (response: MessageResponse) => void,
): Promise<void> {
  try {
    const outcome = await exportTopic(action);
    sendResponse(outcome.response);
    showToast(outcome.toast);
  } catch (err) {
    sendResponse({ success: false, error: getErrorMessage(err) });
    handleError(err, action === 'copy' ? '复制主题' : '下载主题');
  }
}

export function registerMessageHandlers(): void {
  chrome.runtime.onMessage.addListener(
    (
      msg: ContentMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponse) => void,
    ) => {
      if (msg.action === 'getInfo') {
        const postEls = getPostElements();
        sendResponse({
          title: getTopicTitle(),
          postCount: postEls.length,
        });
        return true;
      }

      if (msg.action === 'copyTopic') {
        void handleTopicExport('copy', sendResponse);
        return true;
      }

      if (msg.action === 'downloadTopic') {
        void handleTopicExport('download', sendResponse);
        return true;
      }

      return false;
    },
  );
}
