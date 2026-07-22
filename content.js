"use strict";
(() => {
  // src/content/discourse.ts
  function isHTMLElement(el) {
    return el instanceof HTMLElement;
  }
  function getTopicTitle() {
    const fancy = document.querySelector(".fancy-title");
    if (isHTMLElement(fancy)) {
      const text = fancy.textContent?.trim();
      if (text) return text;
    }
    const titleEl = document.querySelector("#topic-title h1");
    if (isHTMLElement(titleEl)) {
      const text = titleEl.textContent?.trim();
      if (text) return text;
    }
    return document.title.replace(/\s*[—–-]\s*Linux\.do\s*$/, "").trim() || "Untitled";
  }
  function getTopicUrl() {
    return window.location.origin + window.location.pathname;
  }
  function getTopicId() {
    const match = window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }
  function getAllPostElements() {
    return Array.from(document.querySelectorAll("[data-post-id].topic-post, .topic-post")).filter((el) => isHTMLElement(el) && !el.closest(".ldtk-topic-article-pane"));
  }
  function getPostElements() {
    return getAllPostElements().filter((postEl) => !postEl.closest(".ldtk-topic-native-stream"));
  }
  function getPostMeta(postEl) {
    const postId = postEl.getAttribute("data-post-id") || "";
    const postNumber = postEl.getAttribute("data-post-number") || "";
    const author = postEl.querySelector(".names .username")?.textContent?.trim() || postEl.querySelector(".creator .username")?.textContent?.trim() || "Unknown";
    const timeEl = postEl.querySelector("time");
    const date = timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || "";
    return { postId, postNumber, author, date };
  }
  async function fetchRawPost(topicId, postNumber) {
    if (!topicId || !postNumber) throw new Error("\u7F3A\u5C11\u4E3B\u9898 ID \u6216\u697C\u5C42\u53F7");
    const res = await fetch(`/raw/${topicId}/${postNumber}`, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  }
  async function fetchTopicJson(topicId) {
    if (!topicId) throw new Error("\u7F3A\u5C11\u4E3B\u9898 ID");
    const res = await fetch(`/t/${topicId}.json`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  }
  async function fetchPostsByIds(topicId, postIds) {
    if (!topicId) throw new Error("\u7F3A\u5C11\u4E3B\u9898 ID");
    if (!postIds.length) return [];
    const url = new URL(`/t/${topicId}/posts.json`, window.location.origin);
    postIds.forEach((postId) => {
      url.searchParams.append("post_ids[]", String(postId));
    });
    const res = await fetch(url.pathname + url.search, {
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.post_stream?.posts || data?.posts || [];
  }
  function getPostImages(postEl) {
    const images = {};
    postEl.querySelectorAll("img[data-base62-sha1]").forEach((img) => {
      const src = img.getAttribute("src") || "";
      const sha1 = img.getAttribute("data-base62-sha1") || "";
      if (!sha1 || !src) return;
      const extMatch = src.match(/\.([a-zA-Z0-9]+)$/);
      const ext = extMatch ? extMatch[1] : "png";
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

  // src/common/settings.ts
  var DEFAULT_SETTINGS = Object.freeze({
    enablePostActions: true,
    enableBase64Decode: true,
    enableSplitLayout: false,
    includeMetadata: true,
    replaceUploadUrls: true
  });
  function hasChromeStorage() {
    return typeof chrome !== "undefined" && Boolean(chrome.storage?.sync);
  }
  function normalizeSettings(value = {}) {
    return { ...DEFAULT_SETTINGS, ...value };
  }
  function getSettings() {
    if (!hasChromeStorage()) {
      return Promise.resolve(normalizeSettings());
    }
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
        if (chrome.runtime?.lastError) {
          resolve(normalizeSettings());
          return;
        }
        resolve(normalizeSettings(items));
      });
    });
  }
  function onSettingsChanged(callback) {
    if (!hasChromeStorage() || !chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      const changedKeys = Object.keys(changes);
      const settingsKeys = Object.keys(DEFAULT_SETTINGS);
      if (!changedKeys.some((key) => settingsKeys.includes(key))) return;
      getSettings().then(callback).catch(() => callback(normalizeSettings()));
    });
  }

  // src/content/layout/dom-queries.ts
  var BODY_CLASS = "ldtk-topic-split-active";
  var WRAPPER_CLASS = "ldtk-topic-split-wrapper";
  var ARTICLE_PANE_CLASS = "ldtk-topic-article-pane";
  var ARTICLE_CLONE_CLASS = "ldtk-topic-article-clone";
  var COMMENTS_PANE_CLASS = "ldtk-topic-comments-pane";
  var COMMENTS_STREAM_CLASS = "ldtk-topic-comments-stream";
  var HEADER_TITLE_CLASS = "ldtk-topic-header-title";
  var HEADER_TITLE_INNER_CLASS = "ldtk-topic-header-title-inner";
  var HEADER_META_CLASS = "ldtk-topic-header-meta";
  var HEADER_META_INNER_CLASS = "ldtk-topic-header-meta-inner";
  var ARTICLE_META_CLASS = "ldtk-topic-article-meta";
  var ARTICLE_META_INNER_CLASS = "ldtk-topic-article-meta-inner";
  var ARTICLE_ACTIONS_CLASS = "ldtk-topic-article-actions";
  var FOOTER_ACTIONS_SOURCE_ATTR = "data-ldtk-footer-actions-source";
  var FOOTER_ACTIONS_PLACEHOLDER_ATTR = "data-ldtk-footer-actions-placeholder";
  var TOPIC_META_SOURCE_ATTR = "data-ldtk-topic-meta-source";
  var NATIVE_STREAM_CLASS = "ldtk-topic-native-stream";
  var ORIGINAL_MAIN_POST_CLASS = "ldtk-topic-original-main-post";
  var PAGED_COMMENT_CLASS = "ldtk-paged-comment";
  var PAGER_CLASS = "ldtk-comments-pager";
  var PAGER_INFO_CLASS = "ldtk-comments-pager-info";
  var PAGER_BUTTON_CLASS = "ldtk-comments-pager-button";
  var PAGE_SIZE = 20;
  var TOPIC_META_SELECTORS = [
    ".topic-map",
    ".topic-map-expanded",
    ".topic-map__contents",
    ".topic-map-section",
    ".topic-map-summary",
    ".topic-map-stats",
    ".topic-map__stats",
    ".topic-stats"
  ];
  var FOOTER_ACTIONS_SELECTORS = "#topic-footer-buttons, .topic-footer-main-buttons";
  var topicMetaState = {
    observer: null,
    syncTimer: null
  };
  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }
  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  // src/content/layout/footer-actions-cloner.ts
  function findFooterActionsSource() {
    return Array.from(document.querySelectorAll(FOOTER_ACTIONS_SELECTORS)).find((el) => el instanceof HTMLElement && !el.closest(`.${ARTICLE_PANE_CLASS}`) && !el.closest(`.${HEADER_META_CLASS}`) && !el.closest(`.${COMMENTS_PANE_CLASS}`)) || null;
  }
  function ensureFooterActionsPlaceholder(source) {
    const existing = document.querySelector(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}="true"]`);
    if (existing) return existing;
    const placeholder = document.createElement("span");
    placeholder.hidden = true;
    placeholder.setAttribute(FOOTER_ACTIONS_PLACEHOLDER_ATTR, "true");
    source.parentElement?.insertBefore(placeholder, source);
    return placeholder;
  }
  function syncArticleFooterActions(pane) {
    if (!pane) return;
    const movedSource = pane.querySelector(`:scope > .${ARTICLE_ACTIONS_CLASS} > [${FOOTER_ACTIONS_SOURCE_ATTR}="true"]`);
    const source = movedSource || findFooterActionsSource();
    let articleActions = pane.querySelector(`:scope > .${ARTICLE_ACTIONS_CLASS}`);
    if (!source) {
      articleActions?.remove();
      return;
    }
    if (!articleActions) {
      articleActions = document.createElement("section");
      articleActions.className = ARTICLE_ACTIONS_CLASS;
      articleActions.setAttribute("aria-label", "\u4E3B\u9898\u64CD\u4F5C");
      pane.appendChild(articleActions);
    }
    if (!movedSource) {
      ensureFooterActionsPlaceholder(source);
      source.setAttribute(FOOTER_ACTIONS_SOURCE_ATTR, "true");
      articleActions.appendChild(source);
    }
  }
  function restoreFooterActions() {
    const source = document.querySelector(`[${FOOTER_ACTIONS_SOURCE_ATTR}="true"]`);
    const placeholder = document.querySelector(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}="true"]`);
    if (source) {
      source.removeAttribute(FOOTER_ACTIONS_SOURCE_ATTR);
      if (placeholder?.parentElement) {
        placeholder.parentElement.insertBefore(source, placeholder);
      }
    }
    placeholder?.remove();
    document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`).forEach((el) => el.remove());
  }

  // src/content/layout/header-title-cloner.ts
  function getHeaderTitleMount() {
    return document.querySelector(".d-header .contents") || document.querySelector("header.d-header .contents") || document.querySelector(".d-header");
  }
  function stripHeaderCloneUnsafeNodes(clone) {
    clone.querySelectorAll([
      "script",
      "style",
      ".edit-topic",
      ".topic-statuses",
      ".topic-notifications-button"
    ].join(",")).forEach((el) => el.remove());
    clone.querySelectorAll("[id]").forEach((el) => {
      el.removeAttribute("id");
    });
  }
  function syncSplitHeaderTitle() {
    const source = document.querySelector("#topic-title");
    const mount = getHeaderTitleMount();
    if (!source || !mount) return;
    let headerTitle = mount.querySelector(`:scope > .${HEADER_TITLE_CLASS}`);
    if (!headerTitle) {
      headerTitle = document.createElement("div");
      headerTitle.className = HEADER_TITLE_CLASS;
      const logoArea = mount.querySelector(":scope > .title, :scope > .home-logo-wrapper, :scope > .brand-header");
      if (logoArea) {
        logoArea.insertAdjacentElement("afterend", headerTitle);
      } else {
        mount.insertBefore(headerTitle, mount.children[1] || null);
      }
    }
    const clone = source.cloneNode(true);
    clone.className = HEADER_TITLE_INNER_CLASS;
    stripHeaderCloneUnsafeNodes(clone);
    headerTitle.replaceChildren(clone);
    syncSplitHeaderMeta(mount, headerTitle);
  }
  function syncSplitTopicMeta() {
    syncSplitHeaderTitle();
    document.querySelectorAll(`.${ARTICLE_PANE_CLASS}`).forEach((pane) => {
      syncArticleTopicMeta(pane);
      syncArticleFooterActions(pane);
    });
  }
  function scheduleSplitHeaderSync() {
    syncSplitTopicMeta();
    [100, 350, 800, 1500, 3e3].forEach((delay) => {
      setTimeout(syncSplitTopicMeta, delay);
    });
  }
  function restoreSplitHeaderTitle() {
    teardownTopicMetaObserver();
    document.querySelectorAll(`.${HEADER_TITLE_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`.${HEADER_META_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`.${ARTICLE_META_CLASS}`).forEach((el) => el.remove());
    restoreFooterActions();
    document.querySelectorAll(`[${TOPIC_META_SOURCE_ATTR}]`).forEach((el) => {
      el.removeAttribute(TOPIC_META_SOURCE_ATTR);
    });
  }

  // src/content/layout/topic-meta-cloner.ts
  function findTopicMetaSource() {
    const directMatch = Array.from(document.querySelectorAll(TOPIC_META_SELECTORS.join(","))).find((el) => !el.closest(`.${HEADER_META_CLASS}`) && !el.closest(`.${ARTICLE_PANE_CLASS}`) && !el.closest(`.${COMMENTS_PANE_CLASS}`));
    if (directMatch) return directMatch;
    return Array.from(document.querySelectorAll("#main-outlet .container.posts > .row > *, .topic-area > *")).find((el) => {
      if (el.closest(`.${HEADER_META_CLASS}`) || el.closest(`.${ARTICLE_PANE_CLASS}`) || el.closest(`.${COMMENTS_PANE_CLASS}`) || el.matches("#topic-title")) {
        return false;
      }
      const text = el.textContent || "";
      const hasStatsText = ["\u6D4F\u89C8\u91CF", "\u8D5E", "\u94FE\u63A5", "\u7528\u6237"].filter((label) => text.includes(label)).length >= 2;
      const hasAvatars = el.querySelectorAll("img.avatar, .avatar").length >= 2;
      const hasSummary = Boolean(el.querySelector('[title*="\u603B\u7ED3"], button, .btn'));
      return hasStatsText && (hasAvatars || hasSummary);
    }) || null;
  }
  function stripHeaderMetaCloneUnsafeNodes(clone) {
    clone.querySelectorAll([
      "script",
      "style",
      "[id]"
    ].join(",")).forEach((el) => {
      if (el.matches("script, style")) {
        el.remove();
        return;
      }
      el.removeAttribute("id");
    });
  }
  function buildTopicMetaClone(source, innerClass) {
    const clone = source.cloneNode(true);
    clone.classList.add(innerClass);
    clone.removeAttribute("id");
    clone.removeAttribute(TOPIC_META_SOURCE_ATTR);
    stripHeaderMetaCloneUnsafeNodes(clone);
    return clone;
  }
  function syncSplitHeaderMeta(mount, headerTitle) {
    const source = findTopicMetaSource();
    if (!source || !mount) return;
    document.querySelectorAll(`[${TOPIC_META_SOURCE_ATTR}]`).forEach((el) => {
      if (el !== source) el.removeAttribute(TOPIC_META_SOURCE_ATTR);
    });
    source.setAttribute(TOPIC_META_SOURCE_ATTR, "true");
    let headerMeta = mount.querySelector(`:scope > .${HEADER_META_CLASS}`);
    if (!headerMeta) {
      headerMeta = document.createElement("div");
      headerMeta.className = HEADER_META_CLASS;
      if (headerTitle?.parentElement === mount) {
        headerTitle.insertAdjacentElement("afterend", headerMeta);
      } else {
        mount.insertBefore(headerMeta, mount.children[2] || null);
      }
    }
    headerMeta.replaceChildren(buildTopicMetaClone(source, HEADER_META_INNER_CLASS));
  }
  function syncArticleTopicMeta(pane) {
    if (!pane) return;
    const source = findTopicMetaSource();
    let articleMeta = pane.querySelector(`:scope > .${ARTICLE_META_CLASS}`);
    if (!source) {
      articleMeta?.remove();
      return;
    }
    if (!articleMeta) {
      articleMeta = document.createElement("section");
      articleMeta.className = ARTICLE_META_CLASS;
      articleMeta.setAttribute("aria-label", "\u4E3B\u9898\u7EDF\u8BA1\u4E0E\u64CD\u4F5C");
      pane.appendChild(articleMeta);
    }
    articleMeta.replaceChildren(buildTopicMetaClone(source, ARTICLE_META_INNER_CLASS));
  }
  function scheduleTopicMetaSync(delay = 80) {
    if (topicMetaState.syncTimer) clearTimeout(topicMetaState.syncTimer);
    topicMetaState.syncTimer = setTimeout(() => {
      topicMetaState.syncTimer = null;
      syncSplitTopicMeta();
    }, delay);
  }
  function isNativeTopicMetaNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node;
    if (el.closest?.(`.${HEADER_META_CLASS}`) || el.closest?.(`.${ARTICLE_PANE_CLASS}`) || el.closest?.(`.${COMMENTS_PANE_CLASS}`)) {
      return false;
    }
    const selectors = TOPIC_META_SELECTORS.join(",");
    return el.matches?.(selectors) || Boolean(el.querySelector?.(selectors));
  }
  function bindTopicMetaObserver() {
    if (topicMetaState.observer) return;
    const target = document.querySelector("#main-outlet, #main, body") || document.body;
    topicMetaState.observer = new MutationObserver((mutations) => {
      const shouldSync = mutations.some((mutation) => {
        const nodes = [
          mutation.target,
          ...Array.from(mutation.addedNodes || []),
          ...Array.from(mutation.removedNodes || [])
        ];
        return nodes.some(isNativeTopicMetaNode);
      });
      if (shouldSync) scheduleTopicMetaSync();
    });
    topicMetaState.observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true
    });
  }
  function teardownTopicMetaObserver() {
    if (topicMetaState.syncTimer) {
      clearTimeout(topicMetaState.syncTimer);
      topicMetaState.syncTimer = null;
    }
    if (topicMetaState.observer) {
      topicMetaState.observer.disconnect();
      topicMetaState.observer = null;
    }
  }

  // src/content/output.ts
  function formatPostMd(meta, rawMd, title, url, options = {}) {
    if (options.includeMetadata === false) return rawMd.trim();
    const sourceUrl = url + (meta.postNumber ? "#post-" + meta.postNumber : "");
    const header = `<!-- \u6765\u6E90: ${sourceUrl} | \u4F5C\u8005: ${meta.author}${meta.date ? " | " + meta.date : ""} -->`;
    return header + "\n\n" + rawMd.trim();
  }
  function formatTopicMd(posts, title, url, options = {}) {
    if (options.includeMetadata === false) {
      return posts.map((post) => post.raw.trim()).join("\n\n---\n\n");
    }
    const lines = [`<!-- \u6765\u6E90: ${url} -->`, ""];
    posts.forEach((post, index) => {
      const postNumber = post.meta.postNumber || String(index + 1);
      const postUrl = `${url}#post-${postNumber}`;
      lines.push(`<!-- #${postNumber} ${post.meta.author} | ${postUrl} -->`);
      lines.push("");
      lines.push(post.raw.trim());
      lines.push("");
    });
    return lines.join("\n");
  }
  function copyToClipboard(text) {
    return navigator.clipboard.writeText(text);
  }
  function downloadFile(content, filename) {
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }
  function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*\n\r]/g, "_").replace(/\s+/g, " ").substring(0, 80);
  }
  function showToast(message) {
    let toast = document.getElementById("ldcopy-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "ldcopy-toast";
      document.body.appendChild(toast);
    }
    if (toast.hideTimer) clearTimeout(toast.hideTimer);
    toast.textContent = message;
    toast.className = "ldcopy-toast ldcopy-toast-show";
    toast.hideTimer = setTimeout(() => {
      toast.className = "ldcopy-toast";
      toast.hideTimer = null;
    }, 2500);
  }

  // src/content/markdown.ts
  function isHtmlContent(text) {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(trimmed, "text/html");
    const elCount = doc.body.querySelectorAll("*").length;
    if (elCount > 2) return true;
    for (const el of doc.body.querySelectorAll("*")) {
      if (el.attributes.length > 0) return true;
    }
    return /^<(?!p>|\/p>)[a-zA-Z][\s\S]*>/.test(trimmed);
  }
  function htmlTableToMarkdown(tableEl) {
    const rows = [];
    tableEl.querySelectorAll("tr").forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll("td, th")).map((cell) => {
        return cell.textContent?.trim().replace(/\|/g, "\\|") || "";
      });
      rows.push(cells);
    });
    if (rows.length === 0) return "";
    const colCount = Math.max(...rows.map((row) => row.length));
    rows.forEach((row) => {
      while (row.length < colCount) row.push("");
    });
    const lines = [];
    lines.push("| " + rows[0].join(" | ") + " |");
    lines.push("| " + rows[0].map(() => "---").join(" | ") + " |");
    for (let i = 1; i < rows.length; i += 1) {
      lines.push("| " + rows[i].join(" | ") + " |");
    }
    return "\n" + lines.join("\n") + "\n\n";
  }
  function htmlToMarkdown(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    function walk(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      const el = node;
      const tag = el.tagName.toLowerCase();
      const children = Array.from(el.childNodes).map(walk).join("");
      switch (tag) {
        case "h1":
          return `
# ${children.trim()}

`;
        case "h2":
          return `
## ${children.trim()}

`;
        case "h3":
          return `
### ${children.trim()}

`;
        case "h4":
          return `
#### ${children.trim()}

`;
        case "h5":
          return `
##### ${children.trim()}

`;
        case "h6":
          return `
###### ${children.trim()}

`;
        case "p":
          return `
${children.trim()}

`;
        case "br":
          return "\n";
        case "hr":
          return "\n---\n\n";
        case "strong":
        case "b": {
          const text = children.trim();
          return text ? `**${text}**` : "";
        }
        case "em":
        case "i": {
          const text = children.trim();
          return text ? `*${text}*` : "";
        }
        case "del":
        case "s": {
          const text = children.trim();
          return text ? `~~${text}~~` : "";
        }
        case "code": {
          const text = children.trim();
          return text ? `\`${text}\`` : "";
        }
        case "pre": {
          const codeEl = el.querySelector("code");
          const lang = codeEl?.className?.match(/lang-(\w+)/)?.[1] || "";
          const codeText = codeEl ? codeEl.textContent || "" : el.textContent || "";
          return `
\`\`\`${lang}
${codeText.trim()}
\`\`\`

`;
        }
        case "a": {
          const href = el.getAttribute("href") || "";
          const text = children.trim();
          if (!text) return "";
          return href && href !== text ? `[${text}](${href})` : text;
        }
        case "img": {
          const src = el.getAttribute("src") || "";
          const alt = el.getAttribute("alt") || "";
          return src ? `![${alt}](${src})` : "";
        }
        case "blockquote": {
          const lines = children.trim().split("\n").map((line) => `> ${line}`).join("\n");
          return `
${lines}

`;
        }
        case "aside": {
          if (el.classList?.contains("quote")) {
            const titleEl = el.querySelector(".quote-controls, [data-username]");
            const quoteUser = el.getAttribute("data-username") || titleEl?.getAttribute("data-username") || "";
            const blockquote = el.querySelector(":scope > blockquote");
            const content = blockquote ? Array.from(blockquote.childNodes).map(walk).join("").trim() : children.trim();
            const attribution = quoteUser ? `**${quoteUser} said:**
` : "";
            const lines = (attribution + content).split("\n").map((line) => `> ${line}`).join("\n");
            return `
${lines}

`;
          }
          return children;
        }
        case "ul": {
          return "\n" + Array.from(el.children).map((li) => {
            return li.tagName?.toLowerCase() === "li" ? `- ${walk(li).trim()}` : walk(li);
          }).join("\n") + "\n\n";
        }
        case "ol": {
          return "\n" + Array.from(el.children).map((li, index) => {
            return li.tagName?.toLowerCase() === "li" ? `${index + 1}. ${walk(li).trim()}` : walk(li);
          }).join("\n") + "\n\n";
        }
        case "li":
          return children;
        case "table":
          return htmlTableToMarkdown(el);
        case "sup":
          return `<sup>${children}</sup>`;
        case "sub":
          return `<sub>${children}</sub>`;
        case "mark":
          return `==${children.trim()}==`;
        case "span": {
          if (el.classList?.contains("mention")) return children.trim() || (el.textContent?.trim() || "");
          return children;
        }
        case "div": {
          if (el.classList?.contains("lightbox-wrapper")) {
            const img = el.querySelector("img");
            if (img) {
              const src = img.getAttribute("data-original-href") || img.getAttribute("src") || "";
              const alt = img.getAttribute("alt") || "";
              return src ? `
![${alt}](${src})
` : children;
            }
          }
          if (el.classList?.contains("onebox")) {
            const link = el.querySelector("a[href]");
            const title = el.querySelector(".onebox-body h3, .source a")?.textContent?.trim() || "";
            const href = link?.getAttribute("href") || "";
            if (title && href) return `
[${title}](${href})
`;
          }
          return children;
        }
        case "section":
        case "article":
        case "main":
        case "nav":
        case "header":
        case "footer":
        case "figure":
        case "figcaption":
        case "details":
        case "summary":
        case "dd":
        case "dt":
        case "dl":
        case "abbr":
        case "cite":
        case "ins":
        case "u":
          return children;
        default:
          return children;
      }
    }
    return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim();
  }
  function ensureMarkdown(rawContent) {
    const trimmed = rawContent.trim();
    return isHtmlContent(trimmed) ? htmlToMarkdown(trimmed) : trimmed;
  }
  function normalizeDiscourseMd(md) {
    return md.replace(/!\[([^\]]+?)\|(\d+x\d+(?:x\d+)?(?:\|[^\]]*)?)\]\(/g, "![$1](");
  }

  // src/content/post-export.ts
  async function buildPostMarkdown(postEl, settings) {
    const topicId = getTopicId();
    const meta = getPostMeta(postEl);
    const raw = await fetchRawPost(topicId, meta.postNumber);
    const normalized = normalizeDiscourseMd(raw);
    const processedRaw = settings.replaceUploadUrls === false ? normalized : replaceUploadUrls(normalized, getPostImages(postEl));
    const md = ensureMarkdown(processedRaw);
    return {
      meta,
      markdown: formatPostMd(
        meta,
        md,
        getTopicTitle(),
        getTopicUrl(),
        settings
      ),
      raw: md
    };
  }
  function getFallbackMeta(postEl, index) {
    try {
      return getPostMeta(postEl);
    } catch {
      return { postId: "", postNumber: String(index + 1), author: "Unknown", date: "" };
    }
  }
  async function collectLoadedPosts(settings) {
    const postEls = Array.from(getPostElements());
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
          error: err?.message || "\u672A\u77E5\u9519\u8BEF"
        });
      }
    }
    return {
      posts,
      failures,
      total: postEls.length,
      successCount: posts.length,
      failureCount: failures.length
    };
  }

  // src/content/buttons.ts
  var COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
  function removeInjectedActions() {
    document.querySelectorAll(".ldcopy-actions").forEach((el) => el.remove());
  }
  async function injectButtons() {
    const settings = await getSettings();
    if (!settings.enablePostActions) {
      removeInjectedActions();
      return;
    }
    getPostElements().forEach((postEl) => {
      if (postEl.querySelector(".ldcopy-actions")) return;
      const actionsEl = postEl.querySelector(".post-controls, .actions");
      if (!actionsEl) return;
      const wrapper = document.createElement("div");
      wrapper.className = "ldcopy-actions";
      const copyBtn = document.createElement("button");
      copyBtn.className = "ldcopy-btn";
      copyBtn.title = "\u590D\u5236\u672C\u697C\u539F\u59CB Markdown";
      copyBtn.innerHTML = `${COPY_ICON} <span>\u590D\u5236</span>`;
      copyBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyBtn.disabled = true;
        try {
          const latestSettings = await getSettings();
          const result = await buildPostMarkdown(postEl, latestSettings);
          await copyToClipboard(result.markdown);
          showToast("\u2705 \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
        } catch (err) {
          showToast("\u274C \u5931\u8D25: " + err.message);
        } finally {
          copyBtn.disabled = false;
        }
      });
      const downloadBtn = document.createElement("button");
      downloadBtn.className = "ldcopy-btn";
      downloadBtn.title = "\u4E0B\u8F7D\u672C\u697C\u4E3A Markdown \u6587\u4EF6";
      downloadBtn.innerHTML = `${DOWNLOAD_ICON} <span>\u4E0B\u8F7D</span>`;
      downloadBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        downloadBtn.disabled = true;
        try {
          const latestSettings = await getSettings();
          const result = await buildPostMarkdown(postEl, latestSettings);
          const title = getTopicTitle();
          const filename = sanitizeFilename(`${title}_#${result.meta.postNumber || "post"}.md`);
          downloadFile(result.markdown, filename);
          showToast(`\u2705 \u5DF2\u4E0B\u8F7D ${filename}`);
        } catch (err) {
          showToast("\u274C \u5931\u8D25: " + err.message);
        } finally {
          downloadBtn.disabled = false;
        }
      });
      wrapper.appendChild(copyBtn);
      wrapper.appendChild(downloadBtn);
      actionsEl.appendChild(wrapper);
    });
  }
  var buttons = {
    injectButtons,
    removeInjectedActions
  };

  // src/content/layout/post-renderer.ts
  function createPostFromJson(post) {
    const article = document.createElement("article");
    article.className = `topic-post ${PAGED_COMMENT_CLASS}`;
    article.setAttribute("data-post-id", String(post.id || ""));
    article.setAttribute("data-post-number", String(post.post_number || ""));
    const avatar = post.avatar_template ? post.avatar_template.replace("{size}", "45") : "";
    const createdAt = post.created_at || "";
    const cooked = post.cooked || "";
    article.innerHTML = `
    <div class="topic-avatar">
      ${avatar ? `<img class="avatar" width="45" height="45" src="${escapeAttr(avatar)}" alt="">` : ""}
    </div>
    <div class="topic-body">
      <div class="topic-meta-data">
        <span class="names">
          <span class="username">${escapeHtml(post.username || "Unknown")}</span>
        </span>
        ${createdAt ? `<a class="post-date" href="#post-${escapeAttr(post.post_number || "")}"><time datetime="${escapeAttr(createdAt)}">${escapeHtml(createdAt.slice(0, 10))}</time></a>` : ""}
      </div>
      <div class="cooked">${cooked}</div>
      <section class="post-menu-area">
        <nav class="post-controls"></nav>
      </section>
    </div>
  `;
    return article;
  }

  // src/content/layout/comment-pager.ts
  var pagerState = {
    topicId: "",
    page: 1,
    postIds: [],
    postsById: /* @__PURE__ */ new Map(),
    loading: false
  };
  function resetPager(topicId) {
    pagerState.topicId = topicId || "";
    pagerState.page = 1;
    pagerState.postIds = [];
    pagerState.postsById.clear();
    pagerState.loading = false;
    document.querySelectorAll(`.${COMMENTS_PANE_CLASS}`).forEach((stream) => {
      stream.removeAttribute("data-ldtk-pager-topic-id");
      stream.removeAttribute("data-ldtk-pager-page");
      stream.removeAttribute("data-ldtk-pager-key");
    });
  }
  function getTotalPages() {
    return Math.max(1, Math.ceil(Math.max(0, pagerState.postIds.length - 1) / PAGE_SIZE));
  }
  function shouldShowPager() {
    return getTotalPages() > 1;
  }
  function getPagePostIds(page) {
    const commentIds = pagerState.postIds.slice(1);
    const start = (page - 1) * PAGE_SIZE;
    return commentIds.slice(start, start + PAGE_SIZE);
  }
  function getPageKey(page = pagerState.page) {
    return getPagePostIds(page).join(",");
  }
  function isCurrentPageRendered(stream) {
    return stream.getAttribute("data-ldtk-pager-topic-id") === pagerState.topicId && stream.getAttribute("data-ldtk-pager-page") === String(pagerState.page) && stream.getAttribute("data-ldtk-pager-key") === getPageKey();
  }
  function setPagerStatus(stream, text, isError = false) {
    const infoEl = stream.parentElement?.querySelector(`.${PAGER_INFO_CLASS}`);
    if (!infoEl) return;
    infoEl.textContent = text;
    infoEl.classList.toggle("is-error", isError);
  }
  function updatePagerButtons(stream) {
    const totalPages = getTotalPages();
    const prevBtn = stream.parentElement?.querySelector('[data-ldtk-pager-action="prev"]');
    const nextBtn = stream.parentElement?.querySelector('[data-ldtk-pager-action="next"]');
    if (prevBtn) prevBtn.disabled = pagerState.loading || pagerState.page <= 1;
    if (nextBtn) nextBtn.disabled = pagerState.loading || pagerState.page >= totalPages;
  }
  function removePager(stream) {
    stream.parentElement?.querySelector(`:scope > .${PAGER_CLASS}`)?.remove();
  }
  function resetCommentsScroll(stream) {
    stream.scrollTop = 0;
  }
  function removePagedComments(stream) {
    stream.querySelectorAll(`:scope > .${PAGED_COMMENT_CLASS}`).forEach((postEl) => postEl.remove());
  }
  function renderCurrentPage(stream) {
    removePagedComments(stream);
    const postIds = getPagePostIds(pagerState.page);
    const fragment = document.createDocumentFragment();
    postIds.forEach((postId) => {
      const post = pagerState.postsById.get(Number(postId));
      if (post) fragment.appendChild(createPostFromJson(post));
    });
    stream.appendChild(fragment);
    const totalPages = getTotalPages();
    const commentCount = Math.max(0, pagerState.postIds.length - 1);
    stream.setAttribute("data-ldtk-pager-topic-id", pagerState.topicId);
    stream.setAttribute("data-ldtk-pager-page", String(pagerState.page));
    stream.setAttribute("data-ldtk-pager-key", getPageKey());
    if (!shouldShowPager()) {
      removePager(stream);
      return;
    }
    ensurePager(stream);
    setPagerStatus(stream, `\u7B2C ${pagerState.page} / ${totalPages} \u9875\uFF0C\u5171 ${commentCount} \u6761\u8BC4\u8BBA`);
    updatePagerButtons(stream);
  }
  function ensurePager(stream) {
    const pane = stream.parentElement;
    if (!pane) return null;
    let pager = pane.querySelector(`:scope > .${PAGER_CLASS}`);
    if (!pager) {
      pager = document.createElement("nav");
      pager.className = PAGER_CLASS;
      pager.setAttribute("aria-label", "\u8BC4\u8BBA\u5206\u9875");
      pager.innerHTML = `
      <button class="${PAGER_BUTTON_CLASS}" type="button" data-ldtk-pager-action="prev">\u4E0A\u4E00\u9875</button>
      <span class="${PAGER_INFO_CLASS}">\u6B63\u5728\u52A0\u8F7D\u8BC4\u8BBA...</span>
      <button class="${PAGER_BUTTON_CLASS}" type="button" data-ldtk-pager-action="next">\u4E0B\u4E00\u9875</button>
    `;
      pager.addEventListener("click", (event) => {
        const target = event.target;
        const button = target.closest("[data-ldtk-pager-action]");
        if (!button || pagerState.loading) return;
        const action = button.getAttribute("data-ldtk-pager-action");
        loadPage(stream, pagerState.page + (action === "next" ? 1 : -1));
      });
      pane.appendChild(pager);
    }
    return pager;
  }
  async function loadPage(stream, page) {
    const totalPages = getTotalPages();
    const nextPage = Math.min(Math.max(1, page), totalPages);
    const shouldResetScroll = nextPage !== pagerState.page;
    const postIds = getPagePostIds(nextPage);
    const missingIds = postIds.filter((postId) => !pagerState.postsById.has(Number(postId)));
    pagerState.loading = true;
    if (shouldShowPager()) {
      ensurePager(stream);
      updatePagerButtons(stream);
      setPagerStatus(stream, "\u6B63\u5728\u52A0\u8F7D\u8BC4\u8BBA...");
    } else {
      removePager(stream);
    }
    try {
      if (missingIds.length) {
        const posts = await fetchPostsByIds(pagerState.topicId, missingIds);
        posts.forEach((post) => {
          if (post?.id) pagerState.postsById.set(Number(post.id), post);
        });
      }
      pagerState.page = nextPage;
      renderCurrentPage(stream);
      if (shouldResetScroll) resetCommentsScroll(stream);
      injectButtons?.();
    } catch (err) {
      setPagerStatus(stream, `\u8BC4\u8BBA\u52A0\u8F7D\u5931\u8D25\uFF1A${err?.message || "\u672A\u77E5\u9519\u8BEF"}`, true);
    } finally {
      pagerState.loading = false;
      updatePagerButtons(stream);
    }
  }
  async function ensureCommentPager(stream, topicId) {
    if (pagerState.topicId !== topicId) resetPager(topicId);
    if (!pagerState.postIds.length && !pagerState.loading) {
      pagerState.loading = true;
      try {
        const topic = await fetchTopicJson(topicId);
        pagerState.postIds = topic?.post_stream?.stream || [];
        (topic?.post_stream?.posts || []).forEach((post) => {
          if (post?.id) pagerState.postsById.set(Number(post.id), post);
        });
      } catch (err) {
        ensurePager(stream);
        setPagerStatus(stream, `\u8BC4\u8BBA\u521D\u59CB\u5316\u5931\u8D25\uFF1A${err?.message || "\u672A\u77E5\u9519\u8BEF"}`, true);
        return;
      } finally {
        pagerState.loading = false;
      }
    }
    if (!pagerState.postIds.length) {
      removePager(stream);
      return;
    }
    if (!stream.querySelector(`:scope > .${PAGED_COMMENT_CLASS}`)) {
      await loadPage(stream, pagerState.page);
    } else if (isCurrentPageRendered(stream)) {
      const totalPages = getTotalPages();
      const commentCount = Math.max(0, pagerState.postIds.length - 1);
      if (!shouldShowPager()) {
        removePager(stream);
        return;
      }
      ensurePager(stream);
      setPagerStatus(stream, `\u7B2C ${pagerState.page} / ${totalPages} \u9875\uFF0C\u5171 ${commentCount} \u6761\u8BC4\u8BBA`);
      updatePagerButtons(stream);
    } else {
      renderCurrentPage(stream);
    }
  }
  async function loadTopicSnapshot(topicId) {
    const topic = await fetchTopicJson(topicId);
    const posts = topic?.post_stream?.posts || [];
    pagerState.postIds = topic?.post_stream?.stream || posts.map((post) => post.id).filter((id) => typeof id === "number");
    posts.forEach((post) => {
      if (post?.id) pagerState.postsById.set(Number(post.id), post);
    });
    return topic;
  }

  // src/content/layout/resize-handler.ts
  var resizeListener = null;
  function bindResizeHandler() {
    if (resizeListener) return;
    resizeListener = () => {
      document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(updateSplitPaneHeight);
    };
    window.addEventListener("resize", resizeListener);
  }

  // src/content/layout/split-pane-layout.ts
  function getSplitWrapper(stream) {
    if (!stream?.parentElement) return null;
    if (stream.parentElement.classList.contains(WRAPPER_CLASS)) {
      return stream.parentElement;
    }
    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    stream.parentElement.insertBefore(wrapper, stream);
    wrapper.appendChild(stream);
    return wrapper;
  }
  function getNativeStream() {
    return document.querySelector(`.${NATIVE_STREAM_CLASS}`) || document.querySelector("#post_stream") || document.querySelector(".post-stream") || document.querySelector(".topic-posts");
  }
  function updateSplitPaneHeight(wrapper) {
    if (!wrapper) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const wrapperTop = Math.max(0, wrapper.getBoundingClientRect().top);
    const height = Math.max(320, viewportHeight - wrapperTop - 8);
    wrapper.style.setProperty("--ldtk-split-pane-height", `${height}px`);
  }
  function stripCloneUnsafeNodes(clone) {
    clone.querySelectorAll([
      ".ldcopy-actions",
      ".topic-map",
      ".embedded-posts",
      "script",
      "style"
    ].join(",")).forEach((el) => el.remove());
    clone.querySelectorAll("[id]").forEach((el) => {
      el.removeAttribute("id");
    });
  }
  function buildArticleClone(mainPost) {
    const clone = mainPost.cloneNode(true);
    clone.classList.add(ARTICLE_CLONE_CLASS);
    clone.classList.remove(ORIGINAL_MAIN_POST_CLASS);
    clone.removeAttribute("id");
    stripCloneUnsafeNodes(clone);
    return clone;
  }
  function ensureArticlePane(wrapper, stream) {
    let pane = wrapper.querySelector(`:scope > .${ARTICLE_PANE_CLASS}`);
    if (!pane) {
      pane = document.createElement("aside");
      pane.className = ARTICLE_PANE_CLASS;
      pane.setAttribute("aria-label", "\u6587\u7AE0\u5185\u5BB9");
      wrapper.insertBefore(pane, stream);
    }
    return pane;
  }
  function ensureCommentsPane(wrapper) {
    let pane = wrapper.querySelector(`:scope > .${COMMENTS_PANE_CLASS}`);
    if (!pane) {
      pane = document.createElement("section");
      pane.className = COMMENTS_PANE_CLASS;
      pane.setAttribute("aria-label", "\u8BC4\u8BBA\u5206\u9875");
      wrapper.appendChild(pane);
    }
    pane.classList.remove(COMMENTS_STREAM_CLASS);
    return pane;
  }
  function ensureCommentsStream(pane) {
    let stream = pane.querySelector(`:scope > .${COMMENTS_STREAM_CLASS}`);
    if (!stream) {
      stream = document.createElement("div");
      stream.className = COMMENTS_STREAM_CLASS;
      pane.insertBefore(stream, pane.firstChild);
    }
    Array.from(pane.children).forEach((child) => {
      if (child !== stream && !child.classList.contains(PAGER_CLASS)) {
        stream.appendChild(child);
      }
    });
    return stream;
  }
  function syncArticlePane(pane, mainPost) {
    const postId = mainPost.getAttribute("data-post-id") || "";
    const currentPostId = pane.getAttribute("data-source-post-id") || "";
    if (currentPostId !== postId || !pane.querySelector(`.${ARTICLE_CLONE_CLASS}`)) {
      restoreFooterActions();
      pane.replaceChildren(buildArticleClone(mainPost));
      pane.setAttribute("data-source-post-id", postId);
    }
    syncArticleTopicMeta(pane);
    syncArticleFooterActions(pane);
  }
  function showArticleLoading(pane) {
    if (pane.querySelector(`.${ARTICLE_CLONE_CLASS}`)) return;
    restoreFooterActions();
    const placeholder = document.createElement("div");
    placeholder.className = ARTICLE_CLONE_CLASS;
    placeholder.textContent = "\u6B63\u5728\u52A0\u8F7D\u6B63\u6587...";
    pane.replaceChildren(placeholder);
    pane.removeAttribute("data-source-post-id");
  }
  function getNativeMainPost(nativeStream) {
    return nativeStream?.querySelector?.('[data-post-number="1"].topic-post, .topic-post[data-post-number="1"]') || nativeStream?.querySelector?.("[data-post-id].topic-post, .topic-post") || null;
  }
  async function ensureSplitFromTopic(wrapper, nativeStream, topicId) {
    const articlePane = ensureArticlePane(wrapper, nativeStream);
    const commentsPane = ensureCommentsPane(wrapper);
    const commentsStream = ensureCommentsStream(commentsPane);
    document.body.classList.add(BODY_CLASS);
    scheduleSplitHeaderSync();
    bindTopicMetaObserver();
    nativeStream.classList.add(NATIVE_STREAM_CLASS);
    nativeStream.setAttribute("aria-hidden", "true");
    showArticleLoading(articlePane);
    updateSplitPaneHeight(wrapper);
    try {
      if (pagerState.topicId !== topicId || !pagerState.postIds.length) {
        resetPager(topicId);
        await loadTopicSnapshot(topicId);
      }
      const firstPost = pagerState.postsById.get(Number(pagerState.postIds[0]));
      const mainPost = getNativeMainPost(nativeStream) || (firstPost ? createPostFromJson(firstPost) : null);
      if (!mainPost) throw new Error("\u672A\u627E\u5230\u4E3B\u9898\u6B63\u6587");
      syncArticlePane(articlePane, mainPost);
      updateSplitPaneHeight(wrapper);
      await ensureCommentPager(commentsStream, topicId);
      updateSplitPaneHeight(wrapper);
      setTimeout(() => updateSplitPaneHeight(wrapper), 250);
    } catch (err) {
      restoreTopicSplitLayout();
      throw err;
    }
  }
  function restoreTopicSplitLayout() {
    document.body.classList.remove(BODY_CLASS);
    restoreSplitHeaderTitle();
    document.querySelectorAll(`.${ARTICLE_PANE_CLASS}`).forEach((pane) => pane.remove());
    document.querySelectorAll(`.${COMMENTS_PANE_CLASS}`).forEach((pane) => pane.remove());
    document.querySelectorAll(`.${PAGER_CLASS}`).forEach((pager) => pager.remove());
    document.querySelectorAll(`.${PAGED_COMMENT_CLASS}`).forEach((postEl) => postEl.remove());
    document.querySelectorAll(`.${NATIVE_STREAM_CLASS}`).forEach((stream) => {
      stream.classList.remove(NATIVE_STREAM_CLASS);
      stream.removeAttribute("aria-hidden");
      if (stream.parentElement?.classList.contains(WRAPPER_CLASS)) {
        stream.parentElement.parentElement?.insertBefore(stream, stream.parentElement);
      }
    });
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach((wrapper) => {
      if (!wrapper.children.length) wrapper.remove();
      else wrapper.classList.remove(WRAPPER_CLASS);
    });
    document.querySelectorAll(`.${COMMENTS_STREAM_CLASS}`).forEach((stream) => stream.classList.remove(COMMENTS_STREAM_CLASS));
    document.querySelectorAll(`.${ORIGINAL_MAIN_POST_CLASS}`).forEach((postEl) => {
      postEl.classList.remove(ORIGINAL_MAIN_POST_CLASS);
      postEl.removeAttribute("aria-hidden");
    });
  }
  async function applyTopicSplitLayout() {
    const settings = await getSettings();
    const topicId = getTopicId();
    if (!settings.enableSplitLayout || !topicId) {
      restoreTopicSplitLayout();
      return;
    }
    const stream = getNativeStream();
    const wrapper = getSplitWrapper(stream);
    if (!stream || !wrapper) return;
    await ensureSplitFromTopic(wrapper, stream, topicId);
  }
  bindResizeHandler();
  var layout = {
    applyTopicSplitLayout,
    restoreTopicSplitLayout
  };

  // src/content/base64.ts
  function decodeBase64Utf8(text) {
    const normalized = text.replace(/\s+/g, "");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return binary;
    }
  }
  function stripChineseText(text) {
    return text.replace(/[\p{Script=Han}\u3000-\u303f\uff01-\uff60]/gu, "");
  }
  function getSelectedText() {
    return window.getSelection()?.toString().trim() || "";
  }
  function styleSelectionToolButton(button, order) {
    button.style.cssText = [
      "margin-right: 4px",
      "padding: 4px 8px",
      "font-size: 13px",
      `order: ${order}`,
      "display: inline-flex",
      "align-items: center"
    ].join("; ");
  }
  async function injectBase64Button() {
    const settings = await getSettings();
    if (!settings.enableBase64Decode) {
      document.querySelectorAll(".ldcopy-base64-btn, .ldcopy-strip-chinese-btn").forEach((el) => el.remove());
      return;
    }
    const quoteContainer = document.querySelector(".quote-button");
    if (!quoteContainer) return;
    let base64Btn = quoteContainer.querySelector(".ldcopy-base64-btn");
    if (!base64Btn) {
      base64Btn = document.createElement("button");
      base64Btn.className = "btn btn-flat ldcopy-base64-btn";
      base64Btn.title = "Base64 \u89E3\u7801\u5E76\u590D\u5236";
      base64Btn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: middle; margin-right: 2px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>base64';
      styleSelectionToolButton(base64Btn, -2);
      base64Btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          const selectedText = getSelectedText();
          if (!selectedText) {
            showToast("\u274C \u672A\u9009\u4E2D\u6587\u5B57");
            return;
          }
          await copyToClipboard(decodeBase64Utf8(selectedText));
          showToast("\u2705 Base64 \u89E3\u7801\u5DF2\u590D\u5236");
        } catch (err) {
          showToast("\u274C Base64 \u89E3\u7801\u5931\u8D25: " + err.message);
        }
      });
      quoteContainer.insertBefore(base64Btn, quoteContainer.firstChild);
    }
    if (!quoteContainer.querySelector(".ldcopy-strip-chinese-btn")) {
      const stripChineseBtn = document.createElement("button");
      stripChineseBtn.className = "btn btn-flat ldcopy-strip-chinese-btn";
      stripChineseBtn.title = "\u53BB\u6389\u9009\u4E2D\u6587\u672C\u4E2D\u7684\u4E2D\u6587\u5E76\u590D\u5236";
      stripChineseBtn.textContent = "\u53BB\u4E2D\u6587";
      styleSelectionToolButton(stripChineseBtn, -1);
      stripChineseBtn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          const selectedText = getSelectedText();
          if (!selectedText) {
            showToast("\u274C \u672A\u9009\u4E2D\u6587\u5B57");
            return;
          }
          const strippedText = stripChineseText(selectedText);
          await copyToClipboard(strippedText);
          showToast("\u2705 \u5DF2\u53BB\u4E2D\u6587\u5E76\u590D\u5236");
        } catch (err) {
          showToast("\u274C \u53BB\u4E2D\u6587\u5931\u8D25: " + err.message);
        }
      });
      base64Btn.insertAdjacentElement("afterend", stripChineseBtn);
    }
  }
  var base64 = {
    decodeBase64Utf8,
    stripChineseText,
    injectBase64Button
  };

  // src/content/messages.ts
  function assertExportResult(result) {
    if (result.total === 0) throw new Error("\u5F53\u524D\u9875\u9762\u6CA1\u6709\u68C0\u6D4B\u5230\u5DF2\u52A0\u8F7D\u697C\u5C42");
    if (result.successCount === 0) throw new Error("\u5DF2\u52A0\u8F7D\u697C\u5C42\u5168\u90E8\u5BFC\u51FA\u5931\u8D25");
  }
  function getExportToastPrefix(result) {
    if (result.failureCount === 0) return "\u2705";
    return `\u26A0\uFE0F \u5DF2\u5904\u7406 ${result.successCount}/${result.total} \u4E2A\u697C\u5C42\uFF0C${result.failureCount} \u4E2A\u5931\u8D25\u3002`;
  }
  function registerMessageHandlers(refreshEnhancements2) {
    chrome.runtime.onMessage.addListener(
      (msg, _sender, sendResponse) => {
        if (msg.action === "getInfo") {
          const postEls = getPostElements();
          sendResponse({
            title: getTopicTitle(),
            url: getTopicUrl(),
            postCount: postEls.length
          });
          return true;
        }
        if (msg.action === "refreshEnhancements") {
          refreshEnhancements2?.();
          sendResponse({ success: true });
          return true;
        }
        if (msg.action === "copyTopic") {
          (async () => {
            try {
              const settings = await getSettings();
              const result = await collectLoadedPosts(settings);
              assertExportResult(result);
              const md = formatTopicMd(result.posts, getTopicTitle(), getTopicUrl(), settings);
              await copyToClipboard(md);
              sendResponse({ success: true, ...result });
              const prefix = getExportToastPrefix(result);
              showToast(result.failureCount === 0 ? "\u2705 \u5DF2\u590D\u5236\u6574\u4E2A\u4E3B\u9898" : `${prefix} \u5DF2\u590D\u5236`);
            } catch (err) {
              sendResponse({ success: false, error: err.message });
              showToast("\u274C \u5931\u8D25: " + err.message);
            }
          })();
          return true;
        }
        if (msg.action === "downloadTopic") {
          (async () => {
            try {
              const settings = await getSettings();
              const result = await collectLoadedPosts(settings);
              assertExportResult(result);
              const title = getTopicTitle();
              const md = formatTopicMd(result.posts, title, getTopicUrl(), settings);
              const filename = sanitizeFilename(`${title}.md`);
              downloadFile(md, filename);
              sendResponse({ success: true, filename, ...result });
              const prefix = getExportToastPrefix(result);
              showToast(result.failureCount === 0 ? `\u2705 \u5DF2\u4E0B\u8F7D ${filename}` : `${prefix} \u5DF2\u4E0B\u8F7D ${filename}`);
            } catch (err) {
              sendResponse({ success: false, error: err.message });
              showToast("\u274C \u5931\u8D25: " + err.message);
            }
          })();
          return true;
        }
        return false;
      }
    );
  }
  var messages = {
    registerMessageHandlers
  };

  // src/content/index.ts
  var refreshTimer = null;
  var base64Timer = null;
  var refreshInFlight = false;
  var refreshPending = false;
  async function refreshEnhancements() {
    if (refreshInFlight) {
      refreshPending = true;
      return;
    }
    refreshInFlight = true;
    Promise.resolve().then(async () => {
      await layout.applyTopicSplitLayout();
      await buttons.injectButtons();
      await base64.injectBase64Button();
    }).catch(() => {
    }).finally(() => {
      refreshInFlight = false;
      if (refreshPending) {
        refreshPending = false;
        scheduleRefreshEnhancements();
      }
    });
  }
  function scheduleRefreshEnhancements(delay = 150) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshEnhancements();
    }, delay);
  }
  function scheduleBase64ButtonRefresh(delay = 100) {
    if (base64Timer) clearTimeout(base64Timer);
    base64Timer = setTimeout(() => {
      base64Timer = null;
      base64.injectBase64Button();
    }, delay);
  }
  function bindDynamicPageEvents() {
    document.addEventListener("selectionchange", () => {
      scheduleBase64ButtonRefresh();
    });
    const observer = new MutationObserver((mutations) => {
      const onlyToolkitChanges = mutations.every((mutation) => {
        const target = mutation.target;
        const addedNodes = Array.from(mutation.addedNodes || []);
        const removedNodes = Array.from(mutation.removedNodes || []);
        return target?.closest?.(".ldtk-topic-split-wrapper") || addedNodes.concat(removedNodes).every((node) => node.nodeType !== Node.ELEMENT_NODE || node.matches?.('[class^="ldtk-"], [id^="ldcopy-"]') || node.closest?.(".ldtk-topic-split-wrapper"));
      });
      if (!onlyToolkitChanges) scheduleRefreshEnhancements();
    });
    observer.observe(document.querySelector("#main-outlet, #main, body") || document.body, {
      childList: true,
      subtree: true
    });
    window.addEventListener("discourse-navigate-completed", () => scheduleRefreshEnhancements(0));
    window.addEventListener("page:change", () => scheduleRefreshEnhancements(0));
  }
  function init() {
    messages.registerMessageHandlers(refreshEnhancements);
    refreshEnhancements();
    bindDynamicPageEvents();
    onSettingsChanged(refreshEnhancements);
  }
  init();
})();
//# sourceMappingURL=content.js.map
