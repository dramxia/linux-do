/* Linux.do 工具箱 — 楼层导出流程模块 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  async function buildPostMarkdown(postEl, settings) {
    const { discourse, markdown, output } = namespace;
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

  async function getAllPostsRaw(settings) {
    const { discourse } = namespace;
    const posts = [];

    for (const postEl of discourse.getPostElements()) {
      try {
        const result = await buildPostMarkdown(postEl, settings);
        posts.push({ meta: result.meta, raw: result.raw });
      } catch {
        // 单个帖子获取失败时跳过，避免影响整帖导出。
      }
    }

    return posts;
  }

  namespace.postExport = {
    buildPostMarkdown,
    getAllPostsRaw,
  };
})();
