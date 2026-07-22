/* Linux.do 工具箱 — 楼层导出流程模块 */
import * as discourse from './discourse.js';
import * as markdown from './markdown.js';
import * as output from './output.js';

export async function buildPostMarkdown(postEl, settings) {
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

function getFallbackMeta(postEl, index) {
  try {
    return discourse.getPostMeta(postEl);
  } catch {
    return { postId: '', postNumber: String(index + 1), author: 'Unknown', date: '' };
  }
}

export async function collectLoadedPosts(settings) {
  const postEls = Array.from(discourse.getPostElements());
  const posts = [];
  const failures = [];

  for (const [index, postEl] of postEls.entries()) {
    try {
      const result = await buildPostMarkdown(postEl, settings);
      posts.push({ meta: result.meta, raw: result.raw });
    } catch (err) {
      const meta = getFallbackMeta(postEl, index);
      failures.push({
        meta,
        error: err?.message || '未知错误',
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

export async function getAllPostsRaw(settings) {
  const result = await collectLoadedPosts(settings);
  return result.posts;
}

export const postExport = {
  buildPostMarkdown,
  collectLoadedPosts,
  getAllPostsRaw,
};
