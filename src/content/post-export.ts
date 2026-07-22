/* Linux.do 工具箱 — 楼层导出流程模块 */
import * as discourse from './discourse';
import type { PostMeta } from './discourse';
import * as markdown from './markdown';
import * as output from './output';
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

export async function collectLoadedPosts(settings: DiscourseSettings): Promise<ExportResult> {
  const postEls = Array.from(discourse.getPostElements());
  const posts: CollectedPost[] = [];
  const failures: PostFailure[] = [];

  for (const [index, postEl] of postEls.entries()) {
    try {
      const result = await buildPostMarkdown(postEl, settings);
      posts.push({ meta: result.meta, raw: result.raw });
    } catch (err) {
      const meta = getFallbackMeta(postEl, index);
      failures.push({
        meta,
        error: (err as Error)?.message || '未知错误',
      });
    }
  }

  return {
    posts,
    failures,
    total: postEls.length,
    successCount: posts.length,
    failureCount: failures.length,
  };
}

export async function getAllPostsRaw(settings: DiscourseSettings): Promise<CollectedPost[]> {
  const result = await collectLoadedPosts(settings);
  return result.posts;
}

export const postExport = {
  buildPostMarkdown,
  collectLoadedPosts,
  getAllPostsRaw,
};
