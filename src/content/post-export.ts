/* Linux.do 工具箱 — 楼层导出流程模块 */
import {
  fetchRawPost,
  getPostElements,
  getPostImages,
  getPostMeta,
  getTopicId,
  getTopicUrl,
  replaceUploadUrls,
} from './discourse';
import type { PostMeta } from './discourse';
import { ensureMarkdown, normalizeDiscourseMd } from './markdown';
import { formatPostMd } from './output';
import { batchFetchWithBackoff } from './api-rate-limiter';
import type { DiscourseSettings } from '../common/settings';

const COLLECT_CONCURRENCY = 5;
const COLLECT_MAX_RETRIES = 3;
const COLLECT_INITIAL_BACKOFF_MS = 1000;

interface BuildPostResult {
  meta: PostMeta;
  markdown: string;
  raw: string;
}

interface CollectedPost {
  meta: PostMeta;
  raw: string;
}

interface PostFailure {
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

export async function buildPostMarkdown(
  postEl: HTMLElement,
  settings: DiscourseSettings,
): Promise<BuildPostResult> {
  const topicId = getTopicId();
  const meta = getPostMeta(postEl);
  const raw = await fetchRawPost(topicId, meta.postNumber);
  return buildPostMarkdownFromRaw(postEl, meta, raw, settings);
}

/** 单楼层与批量导出共用的 Markdown 处理流程。 */
function buildPostMarkdownFromRaw(
  postEl: HTMLElement,
  meta: PostMeta,
  raw: string,
  settings: DiscourseSettings,
): BuildPostResult {
  const normalized = normalizeDiscourseMd(raw);
  const processedRaw =
    settings.replaceUploadUrls === false
      ? normalized
      : replaceUploadUrls(normalized, getPostImages(postEl));
  const md = ensureMarkdown(processedRaw);

  return {
    meta,
    markdown: formatPostMd(meta, md, getTopicUrl(), settings),
    raw: md,
  };
}

interface BatchItem {
  postEl: HTMLElement;
  meta: PostMeta;
}

export async function collectLoadedPosts(settings: DiscourseSettings): Promise<ExportResult> {
  const postEls = getPostElements();
  const items: BatchItem[] = postEls.map((postEl) => ({
    postEl,
    meta: getPostMeta(postEl),
  }));

  const topicId = getTopicId();
  const { results, failures } = await batchFetchWithBackoff({
    items,
    concurrency: COLLECT_CONCURRENCY,
    maxRetries: COLLECT_MAX_RETRIES,
    initialBackoffMs: COLLECT_INITIAL_BACKOFF_MS,
    task: async (item) => {
      const raw = await fetchRawPost(topicId, item.meta.postNumber);
      return buildPostMarkdownFromRaw(item.postEl, item.meta, raw, settings);
    },
  });

  const posts: CollectedPost[] = results.map(({ value }) => ({ meta: value.meta, raw: value.raw }));

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
