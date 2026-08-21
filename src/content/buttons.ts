/* Linux.do 工具箱 — 使用 Shadow DOM 隔离的楼层操作按钮 */
import { getPostElements, getTopicTitle } from './discourse';
import { copyToClipboard, downloadFile, sanitizeFilename, showToast } from './output';
import { buildPostMarkdown } from './post-export';
import { getSettings, type DiscourseSettings } from '../common/settings';
import { handleError } from './error-handler';

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';

const SHADOW_HOST_CLASS = 'ldtk-shadow-host';

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

function removeInjectedActions(): void {
  document.querySelectorAll(`.${SHADOW_HOST_CLASS}`).forEach((element) => element.remove());
}

interface ActionButtonOptions {
  title: string;
  label: string;
  icon: string;
  errorContext: string;
  action: () => Promise<void>;
}

function createActionButton(options: ActionButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'ldcopy-btn';
  button.title = options.title;
  button.innerHTML = `${options.icon} <span>${options.label}</span>`;

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    button.disabled = true;
    try {
      await options.action();
    } catch (err) {
      handleError(err, options.errorContext);
    } finally {
      button.disabled = false;
    }
  });

  return button;
}

function createActions(postEl: HTMLElement): HTMLDivElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'ldcopy-actions';

  wrapper.appendChild(
    createActionButton({
      title: '复制本楼原始 Markdown',
      label: '复制',
      icon: COPY_ICON,
      errorContext: '复制楼层',
      action: async () => {
        const result = await buildPostMarkdown(postEl, await getSettings());
        await copyToClipboard(result.markdown);
        showToast('✅ 已复制到剪贴板');
      },
    }),
  );

  wrapper.appendChild(
    createActionButton({
      title: '下载本楼为 Markdown 文件',
      label: '下载',
      icon: DOWNLOAD_ICON,
      errorContext: '下载楼层',
      action: async () => {
        const result = await buildPostMarkdown(postEl, await getSettings());
        const filename = sanitizeFilename(
          `${getTopicTitle()}_#${result.meta.postNumber || 'post'}.md`,
        );
        downloadFile(result.markdown, filename);
        showToast(`✅ 已下载 ${filename}`);
      },
    }),
  );

  return wrapper;
}

export function injectButtons(settings: DiscourseSettings): void {
  if (!settings.enablePostActions) {
    removeInjectedActions();
    return;
  }

  getPostElements().forEach((postEl) => {
    if (postEl.querySelector(`.${SHADOW_HOST_CLASS}`)) return;

    const actionsEl = postEl.querySelector('.post-controls, .actions');
    if (!actionsEl) return;

    const host = document.createElement('div');
    host.className = SHADOW_HOST_CLASS;
    const shadow = host.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = BUTTON_SHADOW_STYLE;
    shadow.appendChild(styleEl);
    shadow.appendChild(createActions(postEl));
    actionsEl.appendChild(host);
  });
}
