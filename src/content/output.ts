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
  bottom: 32px;
  left: 50%;
  transform: translateX(-50%) translateY(12px);
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  background: #18181b;
  color: #fafafa;
  border: 1px solid #27272a;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
    "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease, transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  box-shadow:
    0 4px 6px -1px rgb(0 0 0 / 0.1),
    0 2px 4px -2px rgb(0 0 0 / 0.1);
  white-space: nowrap;
}
.ldcopy-toast::before {
  content: "";
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  background: currentColor;
  -webkit-mask: var(--ldtk-toast-icon) center / contain no-repeat;
  mask: var(--ldtk-toast-icon) center / contain no-repeat;
}
.ldcopy-toast[data-tone="success"] {
  --ldtk-toast-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%234ade80' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E");
}
.ldcopy-toast[data-tone="error"] {
  --ldtk-toast-icon: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f87171' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='12' cy='12' r='10'/%3E%3Cline x1='12' x2='12' y1='8' y2='12'/%3E%3Cline x1='12' x2='12.01' y1='16' y2='16'/%3E%3C/svg%3E");
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

  show(message: string, duration = 2500, tone: 'success' | 'error' = 'success'): void {
    const shadow = this.ensureShadow();
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'ldcopy-toast';
      shadow.appendChild(this.el);
    }

    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.el.textContent = message;
    this.el.dataset.tone = tone;
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
  const isError = /^[❌⚠✕✗]|失败|错误/.test(message);
  const cleaned = message.replace(/^[✅❌⚠️✓✕✗]+\s*/u, '').trim();
  toastManager.show(cleaned, 2500, isError ? 'error' : 'success');
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
