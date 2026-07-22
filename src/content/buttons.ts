/* Linux.do 工具箱 — 页面按钮注入模块 */
import * as discourse from './discourse';
import * as output from './output';
import * as postExport from './post-export';
import { getSettings as _getSettings, type DiscourseSettings } from '../common/settings';

const COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

export function removeInjectedActions(): void {
  document.querySelectorAll('.ldcopy-actions').forEach((el) => el.remove());
}

export async function injectButtons(): Promise<void> {
  const settings = await _getSettings();

  if (!settings.enablePostActions) {
    removeInjectedActions();
    return;
  }

  discourse.getPostElements().forEach((postEl) => {
    if (postEl.querySelector('.ldcopy-actions')) return;

    const actionsEl = postEl.querySelector('.post-controls, .actions');
    if (!actionsEl) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'ldcopy-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ldcopy-btn';
    copyBtn.title = '复制本楼原始 Markdown';
    copyBtn.innerHTML = `${COPY_ICON} <span>复制</span>`;
    copyBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      copyBtn.disabled = true;
      try {
        const latestSettings: DiscourseSettings = await _getSettings();
        const result = await postExport.buildPostMarkdown(postEl, latestSettings);
        await output.copyToClipboard(result.markdown);
        output.showToast('✅ 已复制到剪贴板');
      } catch (err) {
        output.showToast('❌ 失败: ' + (err as Error).message);
      } finally {
        copyBtn.disabled = false;
      }
    });

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'ldcopy-btn';
    downloadBtn.title = '下载本楼为 Markdown 文件';
    downloadBtn.innerHTML = `${DOWNLOAD_ICON} <span>下载</span>`;
    downloadBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadBtn.disabled = true;
      try {
        const latestSettings: DiscourseSettings = await _getSettings();
        const result = await postExport.buildPostMarkdown(postEl, latestSettings);
        const title = discourse.getTopicTitle();
        const filename = output.sanitizeFilename(`${title}_#${result.meta.postNumber || 'post'}.md`);
        output.downloadFile(result.markdown, filename);
        output.showToast(`✅ 已下载 ${filename}`);
      } catch (err) {
        output.showToast('❌ 失败: ' + (err as Error).message);
      } finally {
        downloadBtn.disabled = false;
      }
    });

    wrapper.appendChild(copyBtn);
    wrapper.appendChild(downloadBtn);
    actionsEl.appendChild(wrapper);
  });
}

export const buttons = {
  injectButtons,
  removeInjectedActions,
};
