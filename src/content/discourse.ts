/* Linux.do 工具箱 — Discourse 页面适配模块 */
import { RateLimitError, parseRetryAfter } from './api-rate-limiter';

export interface PostMeta {
  postId: string;
  postNumber: string;
  author: string;
  date: string;
}

type ImageMap = Record<string, string>;

function isHTMLElement(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement;
}

export function getTopicTitle(): string {
  for (const selector of ['.fancy-title', '#topic-title h1']) {
    const titleElement = document.querySelector(selector);
    const text = titleElement?.textContent?.trim();
    if (text) return text;
  }
  return document.title.replace(/\s*[—–-]\s*Linux\.do\s*$/, '').trim() || 'Untitled';
}

export function getTopicUrl(): string {
  return window.location.origin + window.location.pathname;
}

export function getTopicId(): string | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0] !== 't') return null;
  return parts.slice(1).find((part) => /^\d+$/.test(part)) || null;
}

export function getPostElements(): HTMLElement[] {
  const readingPosts = Array.from(
    document.querySelectorAll('.ldtk-topic-reading-root .topic-post'),
  ).filter((el): el is HTMLElement => isHTMLElement(el));
  if (readingPosts.length > 0) return readingPosts;
  return Array.from(document.querySelectorAll('.topic-post')).filter((el): el is HTMLElement =>
    isHTMLElement(el),
  );
}

export function getPostMeta(postEl: HTMLElement): PostMeta {
  const postId = postEl.getAttribute('data-post-id') || '';
  const postNumber = postEl.getAttribute('data-post-number') || '';
  const author =
    postEl.querySelector('.names .username')?.textContent?.trim() ||
    postEl.querySelector('.creator .username')?.textContent?.trim() ||
    postEl.dataset.username ||
    'Unknown';
  const timeEl = postEl.querySelector('time');
  const date =
    timeEl?.getAttribute('datetime') ||
    timeEl?.textContent?.trim() ||
    postEl.dataset.createdAt ||
    '';
  return { postId, postNumber, author, date };
}

export async function fetchRawPost(topicId: string | null, postNumber: string): Promise<string> {
  if (!topicId || !postNumber) throw new Error('缺少主题 ID 或楼层号');
  const res = await fetch(`/raw/${topicId}/${postNumber}`, { credentials: 'same-origin' });
  if (res.status === 429) {
    throw new RateLimitError(parseRetryAfter(res.headers.get('Retry-After')));
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export function getPostImages(postEl: HTMLElement): ImageMap {
  const images: ImageMap = {};
  postEl.querySelectorAll('img[data-base62-sha1]').forEach((img) => {
    const src = img.getAttribute('src') || '';
    const sha1 = img.getAttribute('data-base62-sha1') || '';
    if (!sha1 || !src) return;

    const extMatch = src.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1] : 'png';
    images[`${sha1}.${ext}`] = src;
  });
  return images;
}

export function replaceUploadUrls(rawMd: string, imageMap: ImageMap): string {
  return rawMd.replace(
    /!\[([^\]]*)\]\(upload:\/\/([^)]+)\)/g,
    (match, alt: string, uploadFilename: string) => {
      if (imageMap[uploadFilename]) return `![${alt}](${imageMap[uploadFilename]})`;
      return match;
    },
  );
}
