/* Linux.do 工具箱 — Base64 选择工具模块 */
import { copyToClipboard, showToast } from './output';
import type { DiscourseSettings } from '../common/settings';
import { handleError } from './error-handler';

export function decodeBase64Utf8(text: string): string {
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

export function stripChineseText(text: string): string {
  return text.replace(/[\p{Script=Han}\u3000-\u303f\uff01-\uff60]/gu, '');
}

function getSelectedText(): string {
  return window.getSelection()?.toString().trim() || '';
}

function styleSelectionToolButton(button: HTMLButtonElement, order: number): void {
  button.style.cssText = [
    'margin-right: 4px',
    'padding: 4px 8px',
    'font-size: 13px',
    `order: ${order}`,
    'display: inline-flex',
    'align-items: center',
  ].join('; ');
}

interface SelectionToolOptions {
  className: string;
  title: string;
  content: string;
  order: number;
  transform: (text: string) => string;
  successMessage: string;
  errorContext: string;
}

function createSelectionToolButton(options: SelectionToolOptions): HTMLButtonElement {
  const button = document.createElement('button');
  button.className = `btn btn-flat ${options.className}`;
  button.title = options.title;
  button.innerHTML = options.content;
  styleSelectionToolButton(button, options.order);

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      const selectedText = getSelectedText();
      if (!selectedText) {
        showToast('❌ 未选中文字');
        return;
      }
      await copyToClipboard(options.transform(selectedText));
      showToast(options.successMessage);
    } catch (err) {
      handleError(err, options.errorContext);
    }
  });

  return button;
}

export function injectBase64Button(settings: DiscourseSettings): void {
  if (!settings.enableBase64Decode) {
    document
      .querySelectorAll('.ldcopy-base64-btn, .ldcopy-strip-chinese-btn')
      .forEach((el) => el.remove());
    return;
  }

  const quoteContainer = document.querySelector('.quote-button');
  if (!quoteContainer) return;

  let base64Btn = quoteContainer.querySelector<HTMLButtonElement>('.ldcopy-base64-btn');
  if (!base64Btn) {
    base64Btn = createSelectionToolButton({
      className: 'ldcopy-base64-btn',
      title: 'Base64 解码并复制',
      content:
        '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: middle; margin-right: 2px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>base64',
      order: -2,
      transform: decodeBase64Utf8,
      successMessage: '✅ Base64 解码已复制',
      errorContext: 'Base64 解码',
    });
    quoteContainer.insertBefore(base64Btn, quoteContainer.firstChild);
  }

  if (!quoteContainer.querySelector('.ldcopy-strip-chinese-btn')) {
    const stripChineseBtn = createSelectionToolButton({
      className: 'ldcopy-strip-chinese-btn',
      title: '去掉选中文本中的中文并复制',
      content: '去中文',
      order: -1,
      transform: stripChineseText,
      successMessage: '✅ 已去中文并复制',
      errorContext: '去中文',
    });
    base64Btn.insertAdjacentElement('afterend', stripChineseBtn);
  }
}
