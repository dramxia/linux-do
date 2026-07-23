/* Linux.do 工具箱 — 输出与反馈模块
 *
 * T9 CSS 隔离：ToastManager 迁入 Shadow DOM（closed mode）。
 * Toast shadow host 挂载到 document.body，attachShadow({mode:'closed'}) 后
 * toast 元素与 <style> 注入 shadow root，:host { all: initial } 重置阻断
 * Discourse light DOM 样式泄漏。
 */
import type { PostMeta } from './discourse';

interface FormatOptions {
  includeMetadata?: boolean;
}

export interface PostMarkdown {
  meta: PostMeta;
  raw: string;
  markdown: string;
}

// Shadow DOM 内 <style> 标签内容。:host { all: initial } 阻断 light DOM 继承，
// toast 样式自包含。z-index 设为极高值确保覆盖所有 light DOM 层叠上下文。
const TOAST_SHADOW_STYLE = `
:host {
  all: initial;
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  pointer-events: none;
}
.ldcopy-toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  padding: 10px 20px;
  background: #1a1a2e;
  color: #fff;
  border: 1px solid #333;
  border-radius: 8px;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s, transform 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}
.ldcopy-toast-show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}
`;

// Toast 生命周期封装为类实例。原先 hideTimer 作为动态属性挂在 DOM 元素上，
// 现在收敛为 ToastManager 类，hideTimer 成为私有字段。单例 toastManager 供
// showToast 函数委派使用，调用方 (buttons.ts/base64.ts/messages.ts) 不需改动。
export class ToastManager {
  private el: HTMLDivElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  // shadow host 挂载到 document.body，shadow root 承载 toast 元素与 <style>。
  private host: HTMLDivElement | null = null;
  private shadow: ShadowRoot | null = null;

  private ensureShadow(): ShadowRoot {
    if (this.shadow) return this.shadow;
    this.host = document.createElement('div');
    this.host.id = 'ldcopy-toast-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });
    const styleEl = document.createElement('style');
    styleEl.textContent = TOAST_SHADOW_STYLE;
    this.shadow.appendChild(styleEl);
    document.body.appendChild(this.host);
    return this.shadow;
  }

  show(message: string, duration = 2500): void {
    const shadow = this.ensureShadow();
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'ldcopy-toast';
      // toast 元素注入 shadow root 而非 document.body。
      shadow.appendChild(this.el);
    }

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.el.textContent = message;
    this.el.className = 'ldcopy-toast ldcopy-toast-show';
    this.hideTimer = setTimeout(() => {
      this.hide();
    }, duration);
  }

  hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.el) {
      this.el.className = 'ldcopy-toast';
    }
  }
}

const toastManager = new ToastManager();

export function showToast(message: string): void {
  toastManager.show(message);
}

export function formatPostMd(
  meta: PostMeta,
  rawMd: string,
  title: string,
  url: string,
  options: FormatOptions = {},
): string {
  if (options.includeMetadata === false) return rawMd.trim();

  const sourceUrl = url + (meta.postNumber ? '#post-' + meta.postNumber : '');
  const header = `<!-- 来源: ${sourceUrl} | 作者: ${meta.author}${meta.date ? ' | ' + meta.date : ''} -->`;
  return header + '\n\n' + rawMd.trim();
}

export function formatTopicMd(
  posts: Array<{ meta: PostMeta; raw: string }>,
  title: string,
  url: string,
  options: FormatOptions = {},
): string {
  if (options.includeMetadata === false) {
    return posts.map((post) => post.raw.trim()).join('\n\n---\n\n');
  }

  const lines: string[] = [`<!-- 来源: ${url} -->`, ''];
  posts.forEach((post, index) => {
    const postNumber = post.meta.postNumber || String(index + 1);
    const postUrl = `${url}#post-${postNumber}`;
    lines.push(`<!-- #${postNumber} ${post.meta.author} | ${postUrl} -->`);
    lines.push('');
    lines.push(post.raw.trim());
    lines.push('');
  });
  return lines.join('\n');
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function downloadFile(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\n\r]/g, '_')
    .replace(/\s+/g, ' ')
    .substring(0, 80);
}

export const output = {
  formatPostMd,
  formatTopicMd,
  copyToClipboard,
  downloadFile,
  sanitizeFilename,
  showToast,
};
