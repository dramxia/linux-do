/* Linux.do 工具箱 — 输出与反馈模块 */
import type { PostMeta } from './discourse';

interface ToastElement extends HTMLDivElement {
  hideTimer?: ReturnType<typeof setTimeout> | null;
}

interface FormatOptions {
  includeMetadata?: boolean;
}

export interface PostMarkdown {
  meta: PostMeta;
  raw: string;
  markdown: string;
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

export function showToast(message: string): void {
  let toast = document.getElementById('ldcopy-toast') as ToastElement | null;
  if (!toast) {
    toast = document.createElement('div') as ToastElement;
    toast.id = 'ldcopy-toast';
    document.body.appendChild(toast);
  }

  if (toast.hideTimer) clearTimeout(toast.hideTimer);
  toast.textContent = message;
  toast.className = 'ldcopy-toast ldcopy-toast-show';
  toast.hideTimer = setTimeout(() => {
    toast!.className = 'ldcopy-toast';
    toast!.hideTimer = null;
  }, 2500);
}

export const output = {
  formatPostMd,
  formatTopicMd,
  copyToClipboard,
  downloadFile,
  sanitizeFilename,
  showToast,
};
