/* ========================================
   Linux.do 文章复制 & 下载 — Content Script
   使用 /raw/ API 获取原始 Markdown
   ======================================== */

(() => {
  'use strict';

  // ---------- 页面信息提取 ----------

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

  // 从 URL 提取 topic_id: /t/slug/:topic_id/:post_number
  function getTopicId() {
    const m = window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
    return m ? m[1] : null;
  }

  // 获取帖子元信息
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

  // 通过 raw API 获取原始 Markdown
  async function fetchRawPost(topicId, postNumber) {
    const url = `/raw/${topicId}/${postNumber}`;
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }

  // ---------- 格式化输出 ----------
  // raw 内容原样保留，元信息用 HTML 注释嵌入，不产生多余空行

  function formatPostMd(meta, rawMd, title, url) {
    const sourceUrl = url + (meta.postNumber ? '#post-' + meta.postNumber : '');
    const header = `<!-- 来源: ${sourceUrl} | 作者: ${meta.author}${meta.date ? ' | ' + meta.date : ''} -->`;
    return header + '\n\n' + rawMd.trim();
  }

  function formatTopicMd(posts, title, url) {
    const lines = [`<!-- 来源: ${url} -->`, ''];
    posts.forEach((p, idx) => {
      const postUrl = `${url}#post-${p.meta.postNumber || idx + 1}`;
      lines.push(`<!-- #${p.meta.postNumber || idx + 1} ${p.meta.author} | ${postUrl} -->`);
      lines.push('');
      lines.push(p.raw.trim());
      lines.push('');
    });
    return lines.join('\n');
  }

  // ---------- 工具函数 ----------

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  // 从帖子元素中提取所有图片的真实URL，返回 { sha1.ext: 真实URL } 的映射
  function getPostImages(postEl) {
    const images = {};
    const imgElements = postEl.querySelectorAll('img[data-base62-sha1]');
    imgElements.forEach(img => {
      const src = img.getAttribute('src') || '';
      const sha1 = img.getAttribute('data-base62-sha1') || '';
      if (sha1 && src) {
        // 从 src 推断扩展名
        const extMatch = src.match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch ? extMatch[1] : 'png';
        images[`${sha1}.${ext}`] = src;
      }
    });
    return images;
  }

  // 将原始 Markdown 中的 upload:// 引用替换为真实 URL
  function replaceUploadUrls(rawMd, imageMap) {
    // 匹配 ![alt](upload://filename.ext)
    return rawMd.replace(/!\[([^\]]*)\]\(upload:\/\/([^)]+)\)/g, (match, alt, uploadFilename) => {
      // uploadFilename 如 g0EUoU3Nq87LsqokCKNo9R16kWU.png
      if (imageMap[uploadFilename]) {
        return `![${alt}](${imageMap[uploadFilename]})`;
      }
      return match;
    });
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').substring(0, 80);
  }

  function showToast(msg) {
    let toast = document.getElementById('ldcopy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ldcopy-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.className = 'ldcopy-toast ldcopy-toast-show';
    setTimeout(() => { toast.className = 'ldcopy-toast'; }, 2000);
  }

  // ---------- 注入按钮 ----------

  function injectButtons() {
    const posts = document.querySelectorAll('[data-post-id].topic-post, .topic-post');

    posts.forEach(postEl => {
      if (postEl.querySelector('.ldcopy-actions')) return;

      const actionsEl = postEl.querySelector('.post-controls, .actions');
      if (!actionsEl) return;

      const wrapper = document.createElement('div');
      wrapper.className = 'ldcopy-actions';

      // 复制按钮
      const copyBtn = document.createElement('button');
      copyBtn.className = 'ldcopy-btn';
      copyBtn.title = '复制本楼原始 Markdown';
      copyBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg> <span>复制</span>`;
      copyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyBtn.disabled = true;
        try {
          const topicId = getTopicId();
          const meta = getPostMeta(postEl);
          const raw = await fetchRawPost(topicId, meta.postNumber);
          const imageMap = getPostImages(postEl);
          const processedRaw = replaceUploadUrls(raw, imageMap);
          const md = formatPostMd(meta, processedRaw, getTopicTitle(), getTopicUrl());
          await copyToClipboard(md);
          showToast('✅ 已复制到剪贴板');
        } catch (err) {
          showToast('❌ 失败: ' + err.message);
        } finally {
          copyBtn.disabled = false;
        }
      });

      // 下载按钮
      const dlBtn = document.createElement('button');
      dlBtn.className = 'ldcopy-btn';
      dlBtn.title = '下载本楼为 Markdown 文件';
      dlBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> <span>下载</span>`;
      dlBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        dlBtn.disabled = true;
        try {
          const topicId = getTopicId();
          const meta = getPostMeta(postEl);
          const raw = await fetchRawPost(topicId, meta.postNumber);
          const imageMap = getPostImages(postEl);
          const processedRaw = replaceUploadUrls(raw, imageMap);
          const title = getTopicTitle();
          const md = formatPostMd(meta, processedRaw, title, getTopicUrl());
          const filename = sanitizeFilename(`${title}_#${meta.postNumber || 'post'}.md`);
          downloadFile(md, filename);
          showToast(`✅ 已下载 ${filename}`);
        } catch (err) {
          showToast('❌ 失败: ' + err.message);
        } finally {
          dlBtn.disabled = false;
        }
      });

      wrapper.appendChild(copyBtn);
      wrapper.appendChild(dlBtn);
      actionsEl.appendChild(wrapper);
    });
  }

  // ---------- 整个主题（由 popup 触发） ----------

  async function getAllPostsRaw() {
    const topicId = getTopicId();
    const postEls = document.querySelectorAll('[data-post-id].topic-post, .topic-post');
    const posts = [];

    for (const postEl of postEls) {
      const meta = getPostMeta(postEl);
      try {
        const raw = await fetchRawPost(topicId, meta.postNumber);
        const imageMap = getPostImages(postEl);
        const processedRaw = replaceUploadUrls(raw, imageMap);
        posts.push({ meta, raw: processedRaw });
      } catch {
        // 单个帖子获取失败则跳过
      }
    }
    return posts;
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'getInfo') {
      const postEls = document.querySelectorAll('[data-post-id].topic-post, .topic-post');
      sendResponse({
        title: getTopicTitle(),
        url: getTopicUrl(),
        postCount: postEls.length,
      });
      return true;
    }

    if (msg.action === 'copyTopic') {
      (async () => {
        try {
          const posts = await getAllPostsRaw();
          const md = formatTopicMd(posts, getTopicTitle(), getTopicUrl());
          await copyToClipboard(md);
          sendResponse({ success: true });
          showToast('✅ 已复制整个主题');
        } catch (err) {
          sendResponse({ success: false, error: err.message });
          showToast('❌ 失败: ' + err.message);
        }
      })();
      return true;
    }

    if (msg.action === 'downloadTopic') {
      (async () => {
        try {
          const posts = await getAllPostsRaw();
          const title = getTopicTitle();
          const md = formatTopicMd(posts, title, getTopicUrl());
          const filename = sanitizeFilename(`${title}.md`);
          downloadFile(md, filename);
          sendResponse({ success: true, filename });
          showToast(`✅ 已下载 ${filename}`);
        } catch (err) {
          sendResponse({ success: false, error: err.message });
          showToast('❌ 失败: ' + err.message);
        }
      })();
      return true;
    }
  });

  // ---------- 初始化 ----------

  injectButtons();

  const observer = new MutationObserver(() => injectButtons());
  observer.observe(document.querySelector('#main-outlet, #main, body') || document.body, {
    childList: true,
    subtree: true,
  });

  window.addEventListener('discourse-navigate-completed', injectButtons);
  window.addEventListener('page:change', injectButtons);
})();
