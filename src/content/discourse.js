/* Linux.do 工具箱 — Discourse 页面适配模块 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  function getTopicTitle() {
    return (
      document.querySelector('.fancy-title')?.textContent?.trim() ||
      document.querySelector('#topic-title h1')?.textContent?.trim() ||
      document.title.replace(/\s*[—–-]\s*Linux\.do\s*$/, '').trim() ||
      'Untitled'
    );
  }

  function getTopicUrl() {
    return window.location.origin + window.location.pathname;
  }

  function getTopicId() {
    const match = window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }

  function getAllPostElements() {
    return Array.from(document.querySelectorAll('[data-post-id].topic-post, .topic-post'))
      .filter((postEl) => !postEl.closest('.ldtk-topic-article-pane'));
  }

  function getPostElements() {
    return getAllPostElements()
      .filter((postEl) => !postEl.closest('.ldtk-topic-native-stream'));
  }

  function getNativePostElements() {
    return getAllPostElements()
      .filter((postEl) => !postEl.classList.contains('ldtk-paged-comment'));
  }

  function getPostMeta(postEl) {
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

  async function fetchRawPost(topicId, postNumber) {
    if (!topicId || !postNumber) throw new Error('缺少主题 ID 或楼层号');
    const res = await fetch(`/raw/${topicId}/${postNumber}`, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  async function fetchTopicJson(topicId) {
    if (!topicId) throw new Error('缺少主题 ID');
    const res = await fetch(`/t/${topicId}.json`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }

  async function fetchPostsByIds(topicId, postIds) {
    if (!topicId) throw new Error('缺少主题 ID');
    if (!postIds.length) return [];

    const url = new URL(`/t/${topicId}/posts.json`, window.location.origin);
    postIds.forEach((postId) => {
      url.searchParams.append('post_ids[]', postId);
    });

    const res = await fetch(url.pathname + url.search, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    return data?.post_stream?.posts || data?.posts || [];
  }

  function getPostImages(postEl) {
    const images = {};
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

  function replaceUploadUrls(rawMd, imageMap) {
    return rawMd.replace(/!\[([^\]]*)\]\(upload:\/\/([^)]+)\)/g, (match, alt, uploadFilename) => {
      if (imageMap[uploadFilename]) return `![${alt}](${imageMap[uploadFilename]})`;
      return match;
    });
  }

  namespace.discourse = {
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
})();
