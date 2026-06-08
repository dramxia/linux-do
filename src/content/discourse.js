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

  function getPostElements() {
    return document.querySelectorAll('[data-post-id].topic-post, .topic-post');
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
    getPostElements,
    getPostMeta,
    fetchRawPost,
    getPostImages,
    replaceUploadUrls,
  };
})();
