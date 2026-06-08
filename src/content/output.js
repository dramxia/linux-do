/* Linux.do 工具箱 — 输出与反馈模块 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  function formatPostMd(meta, rawMd, title, url, options = {}) {
    if (options.includeMetadata === false) return rawMd.trim();

    const sourceUrl = url + (meta.postNumber ? '#post-' + meta.postNumber : '');
    const header = `<!-- 来源: ${sourceUrl} | 作者: ${meta.author}${meta.date ? ' | ' + meta.date : ''} -->`;
    return header + '\n\n' + rawMd.trim();
  }

  function formatTopicMd(posts, title, url, options = {}) {
    if (options.includeMetadata === false) {
      return posts.map((post) => post.raw.trim()).join('\n\n---\n\n');
    }

    const lines = [`<!-- 来源: ${url} -->`, ''];
    posts.forEach((post, index) => {
      const postNumber = post.meta.postNumber || index + 1;
      const postUrl = `${url}#post-${postNumber}`;
      lines.push(`<!-- #${postNumber} ${post.meta.author} | ${postUrl} -->`);
      lines.push('');
      lines.push(post.raw.trim());
      lines.push('');
    });
    return lines.join('\n');
  }

  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }

  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\n\r]/g, '_').replace(/\s+/g, ' ').substring(0, 80);
  }

  function showToast(message) {
    let toast = document.getElementById('ldcopy-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'ldcopy-toast';
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.className = 'ldcopy-toast ldcopy-toast-show';
    setTimeout(() => { toast.className = 'ldcopy-toast'; }, 2000);
  }

  namespace.output = {
    formatPostMd,
    formatTopicMd,
    copyToClipboard,
    downloadFile,
    sanitizeFilename,
    showToast,
  };
})();
