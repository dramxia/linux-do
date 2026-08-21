/* Linux.do 工具箱 — Markdown 输出、文件下载与页面反馈 */
import type { PostMeta } from './discourse';

interface FormatOptions {
  includeMetadata?: boolean;
}

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

class ToastManager {
  private el: HTMLDivElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private shadow: ShadowRoot | null = null;

  private ensureShadow(): ShadowRoot {
    if (this.shadow) return this.shadow;
    const host = document.createElement('div');
    host.id = 'ldcopy-toast-host';
    this.shadow = host.attachShadow({ mode: 'closed' });
    const styleEl = document.createElement('style');
    styleEl.textContent = TOAST_SHADOW_STYLE;
    this.shadow.appendChild(styleEl);
    document.body.appendChild(host);
    return this.shadow;
  }

  show(message: string, duration = 2500): void {
    const shadow = this.ensureShadow();
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'ldcopy-toast';
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
