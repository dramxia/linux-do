/* Linux.do 工具箱 — 页面按钮注入模块
 *
 * T9 CSS 隔离：按钮迁入 Shadow DOM（closed mode）。
 * 每个 post 的 .post-controls 容器内创建 <div class="ldtk-shadow-host">，
 * attachShadow({mode:'closed'}) 后将 .ldcopy-actions wrapper 注入 shadow root。
 * 按钮样式通过 shadow root 内 <style> 标签注入，:host { all: initial } 重置
 * 阻断 Discourse light DOM 样式泄漏。postEl 通过闭包传递给点击 handler。
 */
import * as discourse from './discourse';
import * as output from './output';
import * as postExport from './post-export';
import { on } from './event-bus';
import {
  getSettings as _getSettings,
  getCachedSettings,
  type DiscourseSettings,
} from '../common/settings';
import { handleError } from './error-handler';

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

const SHADOW_HOST_CLASS = 'ldtk-shadow-host';

// Shadow DOM 内 <style> 标签内容。:host { all: initial } 阻断 light DOM 继承，
// 按钮样式自包含，含暗色模式适配（通过 :host-context(html.dark) /
// :host-context(body.dark) 感知宿主页面的暗色类）。
const BUTTON_SHADOW_STYLE = `
:host {
  all: initial;
  display: inline-block;
}
.ldcopy-actions {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
  vertical-align: middle;
}
.ldcopy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--primary-low-mid, #ccc);
  border-radius: 4px;
  background: var(--secondary, #f5f5f5);
  color: var(--primary, #333);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
  white-space: nowrap;
}
.ldcopy-btn:hover {
  background: var(--highlight-bg, #e8e8e8);
  border-color: var(--primary-medium, #999);
}
.ldcopy-btn:active {
  transform: scale(0.96);
}
.ldcopy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.ldcopy-btn svg {
  flex-shrink: 0;
  opacity: 0.8;
}
:host-context(html.dark) .ldcopy-btn,
:host-context(body.dark) .ldcopy-btn {
  background: #2a2a3e;
  border-color: #444;
  color: #ddd;
}
:host-context(html.dark) .ldcopy-btn:hover,
:host-context(body.dark) .ldcopy-btn:hover {
  background: #3a3a5e;
  border-color: #666;
}
@media (max-width: 768px) {
  .ldcopy-btn span {
    display: none;
  }
}
`;

export function removeInjectedActions(): void {
  document.querySelectorAll('.' + SHADOW_HOST_CLASS).forEach((el) => el.remove());
}

export async function injectButtons(): Promise<void> {
  const settings = await getCachedSettings();

  if (!settings.enablePostActions) {
    removeInjectedActions();
    return;
  }

  discourse.getPostElements().forEach((postEl) => {
    // 幂等：检查 shadow host 是否已存在。host 是 light DOM 元素，可直接 querySelector。
    if (postEl.querySelector('.' + SHADOW_HOST_CLASS)) return;

    const actionsEl = postEl.querySelector('.post-controls, .actions');
    if (!actionsEl) return;

    // 创建 shadow host（light DOM 中的容器元素）。
    const host = document.createElement('div');
    host.className = SHADOW_HOST_CLASS;

    // closed mode：外部 JS 无法通过 host.shadowRoot 访问内部，样式与 DOM 双重隔离。
    const shadow = host.attachShadow({ mode: 'closed' });

    // 注入 <style> 标签（不用 Constructable Stylesheets，按 AC 要求）。
    const styleEl = document.createElement('style');
    styleEl.textContent = BUTTON_SHADOW_STYLE;
    shadow.appendChild(styleEl);

    // wrapper 注入 shadow root，而非 actionsEl。
    const wrapper = document.createElement('div');
    wrapper.className = 'ldcopy-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ldcopy-btn';
    copyBtn.title = '复制本楼原始 Markdown';
    copyBtn.innerHTML = `${COPY_ICON} <span>复制</span>`;
    // postEl 通过闭包传递给 handler。shadow boundary 不影响 JS 闭包，
    // handler 仍能访问外层 postEl 变量。
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
        handleError(err, '复制楼层');
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
        const filename = output.sanitizeFilename(
          `${title}_#${result.meta.postNumber || 'post'}.md`,
        );
        output.downloadFile(result.markdown, filename);
        output.showToast(`✅ 已下载 ${filename}`);
      } catch (err) {
        handleError(err, '下载楼层');
      } finally {
        downloadBtn.disabled = false;
      }
    });

    wrapper.appendChild(copyBtn);
    wrapper.appendChild(downloadBtn);
    shadow.appendChild(wrapper);

    // host 注入 light DOM 的 .post-controls 容器。
    actionsEl.appendChild(host);
  });
}

export const buttons = {
  injectButtons,
  removeInjectedActions,
};

// 订阅 layout 的 posts:rendered 事件，触发按钮注入。
// emit 同步执行，等价于原先 comment-pager 直接调用 buttons.injectButtons()。
// injectButtons 内部通过 .ldtk-shadow-host 存在性检查保证幂等，与 index.ts refreshEnhancements
// 的初始加载调用不冲突（两者都调用 injectButtons，重复调用为 no-op）。
on('posts:rendered', () => {
  void injectButtons();
});
