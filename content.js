/* ========================================
   Linux.do 文章复制 & 下载 — Content Script
   使用 /raw/ API 获取原始内容，自动转换为 Markdown
   ======================================== */

(() => {
  'use strict';

  // ---------- HTML → Markdown 转换 ----------

  // 检测内容是否为 HTML（而非纯 Markdown）
  // 用 DOMParser 解析后判断是否存在 HTML 元素节点
  function isHtmlContent(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, 'text/html');
    // 如果 body 下有非 <p> 的元素，或者有带属性的标签，就是 HTML
    const elCount = doc.body.querySelectorAll('*').length;
    // 纯文本被 DOMParser 包装成 <body><p>...</p></body>，只有 1-2 个元素
    // 真正的 HTML 会有更多元素或带属性的标签
    if (elCount > 2) return true;
    // 检查是否有带属性的标签（如 <a href="...">、<img src="...">）
    const allEls = doc.body.querySelectorAll('*');
    for (const el of allEls) {
      if (el.attributes.length > 0) return true;
    }
    // 检查是否以显式 HTML 标签开头（非自动包装的 <p>）
    if (/^<(?!p>|\/p>)[a-zA-Z][\s\S]*>/.test(trimmed)) return true;
    return false;
  }

  // 轻量 HTML → Markdown 转换器
  function htmlToMarkdown(html) {
    // 创建临时 DOM 解析 HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const body = doc.body;

    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return '';

      const tag = node.tagName.toLowerCase();
      const children = Array.from(node.childNodes).map(walk).join('');

      switch (tag) {
        case 'h1': return `\n# ${children.trim()}\n\n`;
        case 'h2': return `\n## ${children.trim()}\n\n`;
        case 'h3': return `\n### ${children.trim()}\n\n`;
        case 'h4': return `\n#### ${children.trim()}\n\n`;
        case 'h5': return `\n##### ${children.trim()}\n\n`;
        case 'h6': return `\n###### ${children.trim()}\n\n`;
        case 'p': return `\n${children.trim()}\n\n`;
        case 'br': return '\n';
        case 'hr': return '\n---\n\n';
        case 'strong':
        case 'b': {
          const t = children.trim();
          return t ? `**${t}**` : '';
        }
        case 'em':
        case 'i': {
          const t = children.trim();
          return t ? `*${t}*` : '';
        }
        case 'del':
        case 's': {
          const t = children.trim();
          return t ? `~~${t}~~` : '';
        }
        case 'code': {
          const t = children.trim();
          return t ? `\`${t}\`` : '';
        }
        case 'pre': {
          const codeEl = node.querySelector('code');
          const lang = codeEl?.className?.match(/lang-(\w+)/)?.[1] || '';
          const codeText = codeEl ? codeEl.textContent : node.textContent;
          return `\n\`\`\`${lang}\n${codeText.trim()}\n\`\`\`\n\n`;
        }
        case 'a': {
          const href = node.getAttribute('href') || '';
          const t = children.trim();
          if (!t) return '';
          if (href && href !== t) return `[${t}](${href})`;
          return t;
        }
        case 'img': {
          const src = node.getAttribute('src') || '';
          const alt = node.getAttribute('alt') || '';
          return src ? `![${alt}](${src})` : '';
        }
        case 'blockquote': {
          const lines = children.trim().split('\n').map(l => `> ${l}`).join('\n');
          return `\n${lines}\n\n`;
        }
        case 'aside': {
          // Discourse <aside class="quote"> 引用块
          if (node.classList?.contains('quote')) {
            const titleEl = node.querySelector('.quote-controls, [data-username]');
            const quoteUser = node.getAttribute('data-username') ||
              titleEl?.getAttribute('data-username') || '';
            const bq = node.querySelector(':scope > blockquote');
            const content = bq ? Array.from(bq.childNodes).map(walk).join('').trim() : children.trim();
            const attribution = quoteUser ? `**${quoteUser} said:**\n` : '';
            const lines = (attribution + content).split('\n').map(l => `> ${l}`).join('\n');
            return `\n${lines}\n\n`;
          }
          return children;
        }
        case 'ul': {
          return '\n' + Array.from(node.children).map(li => {
            if (li.tagName?.toLowerCase() === 'li') {
              return `- ${walk(li).trim()}`;
            }
            return walk(li);
          }).join('\n') + '\n\n';
        }
        case 'ol': {
          return '\n' + Array.from(node.children).map((li, i) => {
            if (li.tagName?.toLowerCase() === 'li') {
              return `${i + 1}. ${walk(li).trim()}`;
            }
            return walk(li);
          }).join('\n') + '\n\n';
        }
        case 'li':
          return children;
        case 'table': {
          return htmlTableToMarkdown(node);
        }
        case 'sup':
          return `<sup>${children}</sup>`;
        case 'sub':
          return `<sub>${children}</sub>`;
        case 'mark':
          return `==${children.trim()}==`;
        case 'u':
          return children;
        case 'span': {
          // Discourse @mention
          if (node.classList?.contains('mention')) {
            return children.trim() || node.textContent.trim();
          }
          return children;
        }
        case 'div': {
          // Discourse <div class="lightbox-wrapper"> 图片包装
          if (node.classList?.contains('lightbox-wrapper')) {
            const img = node.querySelector('img');
            if (img) {
              const src = img.getAttribute('data-original-href') || img.getAttribute('src') || '';
              const alt = img.getAttribute('alt') || '';
              return src ? `\n![${alt}](${src})\n` : children;
            }
          }
          // Discourse <div class="onebox"> 链接预览
          if (node.classList?.contains('onebox')) {
            const link = node.querySelector('a[href]');
            const title = node.querySelector('.onebox-body h3, .source a')?.textContent?.trim();
            const href = link?.getAttribute('href') || '';
            if (title && href) return `\n[${title}](${href})\n`;
          }
          return children;
        }
        case 'section':
        case 'article':
        case 'main':
        case 'nav':
        case 'header':
        case 'footer':
        case 'figure':
        case 'figcaption':
        case 'details':
        case 'summary':
        case 'dd':
        case 'dt':
        case 'dl':
        case 'abbr':
        case 'cite':
        case 'ins':
          return children;
        default:
          return children;
      }
    }

    function htmlTableToMarkdown(tableEl) {
      const rows = [];
      tableEl.querySelectorAll('tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td, th')).map(cell => {
          return cell.textContent.trim().replace(/\|/g, '\\|');
        });
        rows.push(cells);
      });
      if (rows.length === 0) return '';

      const colCount = Math.max(...rows.map(r => r.length));
      // 补齐列数
      rows.forEach(r => { while (r.length < colCount) r.push(''); });

      const lines = [];
      lines.push('| ' + rows[0].join(' | ') + ' |');
      lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |');
      for (let i = 1; i < rows.length; i++) {
        lines.push('| ' + rows[i].join(' | ') + ' |');
      }
      return '\n' + lines.join('\n') + '\n\n';
    }

    let md = walk(body);
    // 清理多余空行（最多保留两个连续换行）
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
  }

  // 对 raw 内容进行后处理：如果是 HTML 则转换为 Markdown
  function ensureMarkdown(rawContent) {
    const trimmed = rawContent.trim();
    if (isHtmlContent(trimmed)) {
      return htmlToMarkdown(trimmed);
    }
    return trimmed;
  }

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

  // 规范化 Discourse Markdown → 标准 Markdown
  // 处理 Discourse 特有的图片语法: ![alt|WxH](url) → ![alt](url)
  function normalizeDiscourseMd(md) {
    // ![alt|640x500](url) → ![alt](url)
    // 也处理 ![alt|640x500|inline](url) 等多参数情况
    return md.replace(/!\[([^\]]+?)\|(\d+x\d+(?:x\d+)?(?:\|[^]]*)?)\]\(/g, '![$1](');
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
          const normalized = normalizeDiscourseMd(raw);
          const imageMap = getPostImages(postEl);
          const processedRaw = replaceUploadUrls(normalized, imageMap);
          const md = formatPostMd(meta, ensureMarkdown(processedRaw), getTopicTitle(), getTopicUrl());
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
          const normalized = normalizeDiscourseMd(raw);
          const imageMap = getPostImages(postEl);
          const processedRaw = replaceUploadUrls(normalized, imageMap);
          const title = getTopicTitle();
          const md = formatPostMd(meta, ensureMarkdown(processedRaw), title, getTopicUrl());
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
        const normalized = normalizeDiscourseMd(raw);
        const imageMap = getPostImages(postEl);
        const processedRaw = replaceUploadUrls(normalized, imageMap);
        posts.push({ meta, raw: ensureMarkdown(processedRaw) });
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
