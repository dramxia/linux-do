/* Linux.do 工具箱 — Discourse 页面适配模块 */
import { RateLimitError, parseRetryAfter } from './api-rate-limiter';

export interface PostMeta {
  postId: string;
  postNumber: string;
  author: string;
  date: string;
}

export interface DiscoursePost {
  id?: number;
  post_number?: number;
  username?: string;
  avatar_template?: string;
  created_at?: string;
  cooked?: string;
}

export interface TopicJson {
  post_stream?: {
    stream?: number[];
    posts?: DiscoursePost[];
  };
}

interface PostsResponse {
  post_stream?: { posts?: DiscoursePost[] };
  posts?: DiscoursePost[];
}

type ImageMap = Record<string, string>;

function isHTMLElement(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement;
}

export function getTopicTitle(): string {
  const fancy = document.querySelector('.fancy-title');
  if (isHTMLElement(fancy)) {
    const text = fancy.textContent?.trim();
    if (text) return text;
  }
  const titleEl = document.querySelector('#topic-title h1');
  if (isHTMLElement(titleEl)) {
    const text = titleEl.textContent?.trim();
    if (text) return text;
  }
  return document.title.replace(/\s*[—–-]\s*Linux\.do\s*$/, '').trim() || 'Untitled';
}

export function getTopicUrl(): string {
  return window.location.origin + window.location.pathname;
}

export function getTopicId(): string | null {
  const match = window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
  return match ? match[1] : null;
}

function getAllPostElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll('[data-post-id].topic-post, .topic-post'))
    .filter((el): el is HTMLElement => isHTMLElement(el) && !el.closest('.ldtk-topic-article-pane'));
}

export function getPostElements(): HTMLElement[] {
  return getAllPostElements()
    .filter((postEl) => !postEl.closest('.ldtk-topic-native-stream'));
}

export function getNativePostElements(): HTMLElement[] {
  return getAllPostElements()
    .filter((postEl) => !postEl.classList.contains('ldtk-paged-comment'));
}

export function getPostMeta(postEl: HTMLElement): PostMeta {
  const postId = postEl.getAttribute('data-post-id') || '';
  const postNumber = postEl.getAttribute('data-post-number') || '';
  const author =
    postEl.querySelector('.names .username')?.textContent?.trim() ||
    postEl.querySelector('.creator .username')?.textContent?.trim() ||
    'Unknown';
  const timeEl = postEl.querySelector('time');
  const date = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';
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

export async function fetchTopicJson(topicId: string | null): Promise<TopicJson> {
  if (!topicId) throw new Error('缺少主题 ID');
  const res = await fetch(`/t/${topicId}.json`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json() as TopicJson;
}

export async function fetchPostsByIds(topicId: string | null, postIds: Array<string | number>): Promise<DiscoursePost[]> {
  if (!topicId) throw new Error('缺少主题 ID');
  if (!postIds.length) return [];

  const url = new URL(`/t/${topicId}/posts.json`, window.location.origin);
  postIds.forEach((postId) => {
    url.searchParams.append('post_ids[]', String(postId));
  });

  const res = await fetch(url.pathname + url.search, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json() as PostsResponse;
  return data?.post_stream?.posts || data?.posts || [];
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
  return rawMd.replace(/!\[([^\]]*)\]\(upload:\/\/([^)]+)\)/g, (match, alt: string, uploadFilename: string) => {
    if (imageMap[uploadFilename]) return `![${alt}](${imageMap[uploadFilename]})`;
    return match;
  });
}

export const discourse = {
  getTopicTitle,
  getTopicUrl,
  getTopicId,
  getAllPostElements,
  getPostElements,
  getNativePostElements,
  getPostMeta,
  fetchRawPost,
  fetchTopicJson,
  fetchPostsByIds,
  getPostImages,
  replaceUploadUrls,
};
