/* Linux.do 工具箱 — Base64 选择工具模块 */
import * as output from './output';
import { getSettings as _getSettings } from '../common/settings';

function decodeBase64Utf8(text: string): string {
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

function stripChineseText(text: string): string {
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

export async function injectBase64Button(): Promise<void> {
  const settings = await _getSettings();
  if (!settings.enableBase64Decode) {
    document.querySelectorAll('.ldcopy-base64-btn, .ldcopy-strip-chinese-btn').forEach((el) => el.remove());
    return;
  }

  const quoteContainer = document.querySelector('.quote-button');
  if (!quoteContainer) return;

  let base64Btn = quoteContainer.querySelector<HTMLButtonElement>('.ldcopy-base64-btn');
  if (!base64Btn) {
    base64Btn = document.createElement('button');
    base64Btn.className = 'btn btn-flat ldcopy-base64-btn';
    base64Btn.title = 'Base64 解码并复制';
    base64Btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: middle; margin-right: 2px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>base64';
    styleSelectionToolButton(base64Btn, -2);

    base64Btn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const selectedText = getSelectedText();
        if (!selectedText) {
          output.showToast('❌ 未选中文字');
          return;
        }
        await output.copyToClipboard(decodeBase64Utf8(selectedText));
        output.showToast('✅ Base64 解码已复制');
      } catch (err) {
        output.showToast('❌ Base64 解码失败: ' + (err as Error).message);
      }
    });

    quoteContainer.insertBefore(base64Btn, quoteContainer.firstChild);
  }

  if (!quoteContainer.querySelector('.ldcopy-strip-chinese-btn')) {
    const stripChineseBtn = document.createElement('button');
    stripChineseBtn.className = 'btn btn-flat ldcopy-strip-chinese-btn';
    stripChineseBtn.title = '去掉选中文本中的中文并复制';
    stripChineseBtn.textContent = '去中文';
    styleSelectionToolButton(stripChineseBtn, -1);

    stripChineseBtn.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const selectedText = getSelectedText();
        if (!selectedText) {
          output.showToast('❌ 未选中文字');
          return;
        }

        const strippedText = stripChineseText(selectedText);
        await output.copyToClipboard(strippedText);
        output.showToast('✅ 已去中文并复制');
      } catch (err) {
        output.showToast('❌ 去中文失败: ' + (err as Error).message);
      }
    });

    base64Btn.insertAdjacentElement('afterend', stripChineseBtn);
  }
}

export const base64 = {
  decodeBase64Utf8,
  stripChineseText,
  injectBase64Button,
};
