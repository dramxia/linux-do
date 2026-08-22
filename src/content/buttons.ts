/* Linux.do 工具箱 — 使用 Shadow DOM 隔离的楼层操作按钮 */
import { getPostElements, getTopicTitle } from './discourse';
import { copyToClipboard, downloadFile, sanitizeFilename, showToast } from './output';
import { buildPostMarkdown } from './post-export';
import { getSettings, type DiscourseSettings } from '../common/settings';
import { handleError } from './error-handler';

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';

const SHADOW_HOST_CLASS = 'ldtk-shadow-host';

const BUTTON_SHADOW_STYLE = `
:host {
  all: initial;
  display: inline-flex;
  align-items: center;
}
.ldcopy-actions {
  display: inline-flex;
  gap: 2px;
  margin-left: 4px;
  vertical-align: middle;
}
.ldcopy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--primary-low-mid, #919191);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.ldcopy-btn:hover {
  background: var(--d-hover, #e9e9e9);
  color: var(--primary, #1a1a1a);
}
.ldcopy-btn:active {
  transform: scale(0.92);
}
.ldcopy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.ldcopy-btn svg {
  display: block;
}
@media (prefers-reduced-motion: reduce) {
  .ldcopy-btn {
    transition: none;
  }
  .ldcopy-btn:active {
    transform: none;
  }
}
`;

function removeInjectedActions(): void {
  document.querySelectorAll(`.${SHADOW_HOST_CLASS}`).forEach((element) => element.remove());
}

interface ActionButtonOptions {
  title: string;
  icon: string;
  errorContext: string;
  action: () => Promise<void>;
}

function createActionButton(options: ActionButtonOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = 'ldcopy-btn';
  button.title = options.title;
  button.innerHTML = options.icon;
  button.setAttribute('aria-label', options.title);

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

function getActionsElement(postEl: HTMLElement): Element | null {
  const localActions = postEl.querySelector('.post-controls, .actions');
  if (localActions) return localActions;
  if (!postEl.classList.contains('ldtk-article-content')) return null;
  return (
    postEl
      .closest('.ldtk-article-pane')
      ?.querySelector('.ldtk-article-footer .post-controls, .ldtk-article-footer .actions') ?? null
  );
}

export function injectButtons(settings: DiscourseSettings): void {
  if (!settings.enablePostActions) {
    removeInjectedActions();
    return;
  }

  getPostElements().forEach((postEl) => {
    const actionsEl = getActionsElement(postEl);
    if (!actionsEl) return;
    if (actionsEl.querySelector(`.${SHADOW_HOST_CLASS}`)) return;

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
