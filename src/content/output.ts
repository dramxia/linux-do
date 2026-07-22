/* Linux.do 工具箱 — 输出与反馈模块 */
import type { PostMeta } from './discourse';

interface FormatOptions {
  includeMetadata?: boolean;
}

export interface PostMarkdown {
  meta: PostMeta;
  raw: string;
  markdown: string;
}

// Toast 生命周期封装为类实例。原先 hideTimer 作为动态属性挂在 DOM 元素上，
// 现在收敛为 ToastManager 类，hideTimer 成为私有字段。单例 toastManager 供
// showToast 函数委派使用，调用方 (buttons.ts/base64.ts/messages.ts) 不需改动。
export class ToastManager {
  private el: HTMLDivElement | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  show(message: string, duration = 2500): void {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'ldcopy-toast';
      document.body.appendChild(this.el);
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

export function formatPostMd(meta: PostMeta, rawMd: string, title: string, url: string, options: FormatOptions = {}): string {
  if (options.includeMetadata === false) return rawMd.trim();

  const sourceUrl = url + (meta.postNumber ? '#post-' + meta.postNumber : '');
  const header = `<!-- 来源: ${sourceUrl} | 作者: ${meta.author}${meta.date ? ' | ' + meta.date : ''} -->`;
  return header + '\n\n' + rawMd.trim();
}

export function formatTopicMd(posts: Array<{ meta: PostMeta; raw: string }>, title: string, url: string, options: FormatOptions = {}): string {
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
  return name.replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').substring(0, 80);
}

export const output = {
  formatPostMd,
  formatTopicMd,
  copyToClipboard,
  downloadFile,
  sanitizeFilename,
  showToast,
};
