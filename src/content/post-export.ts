/* Linux.do 工具箱 — 楼层导出流程模块 */
import * as discourse from './discourse';
import type { PostMeta } from './discourse';
import * as markdown from './markdown';
import * as output from './output';
import { batchFetchWithBackoff } from './api-rate-limiter';
import type { DiscourseSettings } from '../common/settings';

export interface BuildPostResult {
  meta: PostMeta;
  markdown: string;
  raw: string;
}

export interface CollectedPost {
  meta: PostMeta;
  raw: string;
}

export interface PostFailure {
  meta: PostMeta;
  error: string;
}

export interface ExportResult {
  posts: CollectedPost[];
  failures: PostFailure[];
  total: number;
  successCount: number;
  failureCount: number;
}

export async function buildPostMarkdown(postEl: HTMLElement, settings: DiscourseSettings): Promise<BuildPostResult> {
  const topicId = discourse.getTopicId();
  const meta = discourse.getPostMeta(postEl);
  const raw = await discourse.fetchRawPost(topicId, meta.postNumber);
  return buildPostMarkdownFromRaw(postEl, meta, raw, settings);
}

/** Shared render path extracted so the batch collector reuses buildPostMarkdown's logic without re-fetching. */
function buildPostMarkdownFromRaw(
  postEl: HTMLElement,
  meta: PostMeta,
  raw: string,
  settings: DiscourseSettings,
): BuildPostResult {
  const normalized = markdown.normalizeDiscourseMd(raw);
  const processedRaw = settings.replaceUploadUrls === false
    ? normalized
    : discourse.replaceUploadUrls(normalized, discourse.getPostImages(postEl));
  const md = markdown.ensureMarkdown(processedRaw);

  return {
    meta,
    markdown: output.formatPostMd(
      meta,
      md,
      discourse.getTopicTitle(),
      discourse.getTopicUrl(),
      settings,
    ),
    raw: md,
  };
}

function getFallbackMeta(postEl: HTMLElement, index: number): PostMeta {
  try {
    return discourse.getPostMeta(postEl);
  } catch {
    return { postId: '', postNumber: String(index + 1), author: 'Unknown', date: '' };
  }
}

interface BatchItem {
  postEl: HTMLElement;
  meta: PostMeta;
  index: number;
}

export async function collectLoadedPosts(settings: DiscourseSettings): Promise<ExportResult> {
  const postEls = Array.from(discourse.getPostElements());
  const items: BatchItem[] = postEls.map((postEl, index) => ({
    postEl,
    meta: getFallbackMeta(postEl, index),
    index,
  }));

  const topicId = discourse.getTopicId();
  const { results, failures } = await batchFetchWithBackoff<BatchItem>({
    items,
    concurrency: COLLECT_CONCURRENCY,
    maxRetries: COLLECT_MAX_RETRIES,
    initialBackoffMs: COLLECT_INITIAL_BACKOFF_MS,
    task: async (item) => {
      const raw = await discourse.fetchRawPost(topicId, item.meta.postNumber);
      return buildPostMarkdownFromRaw(item.postEl, item.meta, raw, settings);
    },
  });

  const posts: CollectedPost[] = results.map(({ value }) => {
    const built = value as BuildPostResult;
    return { meta: built.meta, raw: built.raw };
  });

  const postFailures: PostFailure[] = failures.map((failure) => ({
    meta: failure.item.meta,
    error: failure.error.message || '未知错误',
  }));

  return {
    posts,
    failures: postFailures,
    total: postEls.length,
    successCount: posts.length,
    failureCount: postFailures.length,
  };
}

/** 降级路径并发数（保留串行 /raw/ 但限制为 5 并发，避免触发 429）。 */
const COLLECT_CONCURRENCY = 5;
/** 429 退避最大重试次数（不含首次请求）。 */
const COLLECT_MAX_RETRIES = 3;
/** 429 退避初始等待（指数增长：1s → 2s → 4s）。 */
const COLLECT_INITIAL_BACKOFF_MS = 1000;

export async function getAllPostsRaw(settings: DiscourseSettings): Promise<CollectedPost[]> {
  const result = await collectLoadedPosts(settings);
  return result.posts;
}

export const postExport = {
  buildPostMarkdown,
  collectLoadedPosts,
  getAllPostsRaw,
};
