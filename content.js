"use strict";
(() => {
  // src/content/api-rate-limiter.ts
  var RateLimitError = class extends Error {
    retryAfterMs;
    constructor(retryAfterMs, message = "HTTP 429 Too Many Requests") {
      super(message);
      this.name = "RateLimitError";
      this.retryAfterMs = retryAfterMs;
    }
  };
  function parseRetryAfter(headerValue, now = /* @__PURE__ */ new Date()) {
    if (!headerValue) return 0;
    const trimmed = headerValue.trim();
    if (!trimmed) return 0;
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed) * 1e3;
    }
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) {
      return Math.max(0, date.getTime() - now.getTime());
    }
    return 0;
  }
  async function batchFetchWithBackoff(options) {
    const {
      items,
      task,
      concurrency,
      maxRetries = 3,
      initialBackoffMs = 1e3,
      maxBackoffMs = 3e4
    } = options;
    const results = [];
    const failures = [];
    if (items.length === 0) return { results, failures };
    let cursor = 0;
    async function runItem(item, index) {
      let attempt = 0;
      while (true) {
        try {
          const value = await task(item, attempt);
          results.push({ index, value });
          return;
        } catch (err) {
          if (err instanceof RateLimitError && attempt < maxRetries) {
            const exponentialMs = Math.min(initialBackoffMs * 2 ** attempt, maxBackoffMs);
            const retryAfterMs = Number.isFinite(err.retryAfterMs) ? Math.min(Math.max(err.retryAfterMs, 0), maxBackoffMs) : maxBackoffMs;
            const waitMs = Math.max(retryAfterMs, exponentialMs);
            await sleep(waitMs);
            attempt += 1;
            continue;
          }
          failures.push({
            index,
            item,
            error: err instanceof Error ? err : new Error(String(err))
          });
          return;
        }
      }
    }
    async function worker() {
      while (cursor < items.length) {
        const index = cursor;
        cursor += 1;
        await runItem(items[index], index);
      }
    }
    const poolSize = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: poolSize }, () => worker()));
    results.sort((left, right) => left.index - right.index);
    failures.sort((left, right) => left.index - right.index);
    return { results, failures };
  }
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  // src/content/discourse.ts
  function isHTMLElement(el) {
    return el instanceof HTMLElement;
  }
  function getTopicTitle() {
    for (const selector of [".fancy-title", "#topic-title h1"]) {
      const titleElement = document.querySelector(selector);
      const text = titleElement?.textContent?.trim();
      if (text) return text;
    }
    return document.title.replace(/\s*[—–-]\s*Linux\.do\s*$/, "").trim() || "Untitled";
  }
  function getTopicUrl() {
    return window.location.origin + window.location.pathname;
  }
  function getTopicId() {
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (parts[0] !== "t") return null;
    return parts.slice(1).find((part) => /^\d+$/.test(part)) || null;
  }
  function getPostElements() {
    const readingPosts = Array.from(
      document.querySelectorAll(".ldtk-topic-reading-root .topic-post")
    ).filter((el) => isHTMLElement(el));
    if (readingPosts.length > 0) return readingPosts;
    return Array.from(document.querySelectorAll(".topic-post")).filter(
      (el) => isHTMLElement(el)
    );
  }
  function getPostMeta(postEl) {
    const postId = postEl.getAttribute("data-post-id") || "";
    const postNumber = postEl.getAttribute("data-post-number") || "";
    const author = postEl.querySelector(".names .username")?.textContent?.trim() || postEl.querySelector(".creator .username")?.textContent?.trim() || postEl.dataset.username || "Unknown";
    const timeEl = postEl.querySelector("time");
    const date = timeEl?.getAttribute("datetime") || timeEl?.textContent?.trim() || postEl.dataset.createdAt || "";
    return { postId, postNumber, author, date };
  }
  async function fetchRawPost(topicId, postNumber) {
    if (!topicId || !postNumber) throw new Error("\u7F3A\u5C11\u4E3B\u9898 ID \u6216\u697C\u5C42\u53F7");
    const res = await fetch(`/raw/${topicId}/${postNumber}`, { credentials: "same-origin" });
    if (res.status === 429) {
      throw new RateLimitError(parseRetryAfter(res.headers.get("Retry-After")));
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
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
    return rawMd.replace(
      /!\[([^\]]*)\]\(upload:\/\/([^)]+)\)/g,
      (match, alt, uploadFilename) => {
        if (imageMap[uploadFilename]) return `![${alt}](${imageMap[uploadFilename]})`;
        return match;
      }
    );
  }

  // src/content/output.ts
  var TOAST_SHADOW_STYLE = `
:host {
  all: initial;
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  z-index: 2147483647;
  pointer-events: none;
}
.ldcopy-toast {
  position: fixed;
  bottom: 40px;
  left: 50%;
  transform: translateX(-50%) translateY(20px);
  padding: 10px 20px;
  background: #1a1a2e;
  color: #fff;
  border: 1px solid #333;
  border-radius: 8px;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s, transform 0.3s;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  white-space: nowrap;
}
.ldcopy-toast-show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
  pointer-events: auto;
}
`;
  var ToastManager = class {
    el = null;
    hideTimer = null;
    shadow = null;
    ensureShadow() {
      if (this.shadow) return this.shadow;
      const host = document.createElement("div");
      host.id = "ldcopy-toast-host";
      this.shadow = host.attachShadow({ mode: "closed" });
      const styleEl = document.createElement("style");
      styleEl.textContent = TOAST_SHADOW_STYLE;
      this.shadow.appendChild(styleEl);
      document.body.appendChild(host);
      return this.shadow;
    }
    show(message, duration = 2500) {
      const shadow = this.ensureShadow();
      if (!this.el) {
        this.el = document.createElement("div");
        this.el.className = "ldcopy-toast";
        shadow.appendChild(this.el);
      }
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.el.textContent = message;
      this.el.className = "ldcopy-toast ldcopy-toast-show";
      this.hideTimer = setTimeout(() => {
        this.hide();
      }, duration);
    }
    hide() {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      if (this.el) {
        this.el.className = "ldcopy-toast";
      }
    }
  };
  var toastManager = new ToastManager();
  function showToast(message) {
    toastManager.show(message);
  }
  function formatPostMd(meta, rawMd, url, options = {}) {
    if (options.includeMetadata === false) return rawMd.trim();
    const sourceUrl = url + (meta.postNumber ? "#post-" + meta.postNumber : "");
    const header = `<!-- \u6765\u6E90: ${sourceUrl} | \u4F5C\u8005: ${meta.author}${meta.date ? " | " + meta.date : ""} -->`;
    return header + "\n\n" + rawMd.trim();
  }
  function formatTopicMd(posts, url, options = {}) {
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
          if (el.classList?.contains("mention"))
            return children.trim() || el.textContent?.trim() || "";
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
  var COLLECT_CONCURRENCY = 5;
  var COLLECT_MAX_RETRIES = 3;
  var COLLECT_INITIAL_BACKOFF_MS = 1e3;
  async function buildPostMarkdown(postEl, settings) {
    const topicId = getTopicId();
    const meta = getPostMeta(postEl);
    const raw = await fetchRawPost(topicId, meta.postNumber);
    return buildPostMarkdownFromRaw(postEl, meta, raw, settings);
  }
  function buildPostMarkdownFromRaw(postEl, meta, raw, settings) {
    const normalized = normalizeDiscourseMd(raw);
    const processedRaw = settings.replaceUploadUrls === false ? normalized : replaceUploadUrls(normalized, getPostImages(postEl));
    const md = ensureMarkdown(processedRaw);
    return {
      meta,
      markdown: formatPostMd(meta, md, getTopicUrl(), settings),
      raw: md
    };
  }
  async function collectLoadedPosts(settings) {
    const postEls = getPostElements();
    const items = postEls.map((postEl) => ({
      postEl,
      meta: getPostMeta(postEl)
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
      }
    });
    const posts = results.map(({ value }) => ({ meta: value.meta, raw: value.raw }));
    const postFailures = failures.map((failure) => ({
      meta: failure.item.meta,
      error: failure.error.message || "\u672A\u77E5\u9519\u8BEF"
    }));
    return {
      posts,
      failures: postFailures,
      total: postEls.length,
      successCount: posts.length,
      failureCount: postFailures.length
    };
  }

  // src/common/settings.ts
  var DEFAULT_SETTINGS = Object.freeze({
    enableSplitReading: false,
    commentsPerPage: 10,
    enablePostActions: true,
    enableBase64Decode: true,
    includeMetadata: true,
    replaceUploadUrls: true
  });
  var SETTING_KEYS = Object.freeze([
    "enableSplitReading",
    "commentsPerPage",
    "enablePostActions",
    "enableBase64Decode",
    "includeMetadata",
    "replaceUploadUrls"
  ]);
  function hasChromeStorage() {
    return typeof chrome !== "undefined" && Boolean(chrome.storage?.sync);
  }
  function normalizeSettings(value = {}) {
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      commentsPerPage: value.commentsPerPage === 20 ? 20 : 10
    };
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
  var cachedSettings = null;
  function getCachedSettings() {
    if (!cachedSettings) {
      cachedSettings = getSettings().catch(() => {
        cachedSettings = null;
        return normalizeSettings();
      });
    }
    return cachedSettings;
  }
  function onSettingsChanged(callback) {
    if (!hasChromeStorage() || !chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      const changedKeys = Object.keys(changes);
      if (!changedKeys.some((key) => SETTING_KEYS.includes(key))) return;
      cachedSettings = null;
      void getCachedSettings().then(callback);
    });
  }

  // src/content/error-handler.ts
  function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
  }
  function handleError(err, context) {
    console.error(`[LinuxDoToolkit] ${context}:`, err);
    showToast(`${context}\u5931\u8D25: ${getErrorMessage(err)}`);
  }

  // src/content/buttons.ts
  var COPY_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
  var SHADOW_HOST_CLASS = "ldtk-shadow-host";
  var BUTTON_SHADOW_STYLE = `
:host {
  all: initial;
  display: inline-flex;
  align-items: center;
}
.ldcopy-actions {
  display: inline-flex;
  gap: 2px;
  margin-left: 4px;
  vertical-align: middle;
}
.ldcopy-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--primary-low-mid, #919191);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}
.ldcopy-btn:hover {
  background: var(--d-hover, #e9e9e9);
  color: var(--primary, #1a1a1a);
}
.ldcopy-btn:active {
  transform: scale(0.92);
}
.ldcopy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.4;
}
.ldcopy-btn svg {
  display: block;
}
@media (prefers-reduced-motion: reduce) {
  .ldcopy-btn {
    transition: none;
  }
  .ldcopy-btn:active {
    transform: none;
  }
}
`;
  function removeInjectedActions() {
    document.querySelectorAll(`.${SHADOW_HOST_CLASS}`).forEach((element) => element.remove());
  }
  function createActionButton(options) {
    const button = document.createElement("button");
    button.className = "ldcopy-btn";
    button.title = options.title;
    button.innerHTML = options.icon;
    button.setAttribute("aria-label", options.title);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      button.disabled = true;
      try {
        await options.action();
      } catch (err) {
        handleError(err, options.errorContext);
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }
  function createActions(postEl) {
    const wrapper = document.createElement("div");
    wrapper.className = "ldcopy-actions";
    wrapper.appendChild(
      createActionButton({
        title: "\u590D\u5236\u672C\u697C\u539F\u59CB Markdown",
        icon: COPY_ICON,
        errorContext: "\u590D\u5236\u697C\u5C42",
        action: async () => {
          const result = await buildPostMarkdown(postEl, await getSettings());
          await copyToClipboard(result.markdown);
          showToast("\u2705 \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
        }
      })
    );
    wrapper.appendChild(
      createActionButton({
        title: "\u4E0B\u8F7D\u672C\u697C\u4E3A Markdown \u6587\u4EF6",
        icon: DOWNLOAD_ICON,
        errorContext: "\u4E0B\u8F7D\u697C\u5C42",
        action: async () => {
          const result = await buildPostMarkdown(postEl, await getSettings());
          const filename = sanitizeFilename(
            `${getTopicTitle()}_#${result.meta.postNumber || "post"}.md`
          );
          downloadFile(result.markdown, filename);
          showToast(`\u2705 \u5DF2\u4E0B\u8F7D ${filename}`);
        }
      })
    );
    return wrapper;
  }
  function getActionsElement(postEl) {
    const localActions = postEl.querySelector(".post-controls, .actions");
    if (localActions) return localActions;
    if (!postEl.classList.contains("ldtk-article-content")) return null;
    return postEl.closest(".ldtk-article-pane")?.querySelector(".ldtk-article-footer .post-controls, .ldtk-article-footer .actions") ?? null;
  }
  function injectButtons(settings) {
    if (!settings.enablePostActions) {
      removeInjectedActions();
      return;
    }
    getPostElements().forEach((postEl) => {
      const actionsEl = getActionsElement(postEl);
      if (!actionsEl) return;
      if (actionsEl.querySelector(`.${SHADOW_HOST_CLASS}`)) return;
      const host = document.createElement("div");
      host.className = SHADOW_HOST_CLASS;
      const shadow = host.attachShadow({ mode: "closed" });
      const styleEl = document.createElement("style");
      styleEl.textContent = BUTTON_SHADOW_STYLE;
      shadow.appendChild(styleEl);
      shadow.appendChild(createActions(postEl));
      actionsEl.appendChild(host);
    });
  }

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
  function createSelectionToolButton(options) {
    const button = document.createElement("button");
    button.className = `btn btn-flat ${options.className}`;
    button.title = options.title;
    button.innerHTML = options.content;
    styleSelectionToolButton(button, options.order);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const selectedText = getSelectedText();
        if (!selectedText) {
          showToast("\u274C \u672A\u9009\u4E2D\u6587\u5B57");
          return;
        }
        await copyToClipboard(options.transform(selectedText));
        showToast(options.successMessage);
      } catch (err) {
        handleError(err, options.errorContext);
      }
    });
    return button;
  }
  function injectBase64Button(settings) {
    if (!settings.enableBase64Decode) {
      document.querySelectorAll(".ldcopy-base64-btn, .ldcopy-strip-chinese-btn").forEach((el) => el.remove());
      return;
    }
    const quoteContainer = document.querySelector(".quote-button");
    if (!quoteContainer) return;
    let base64Btn = quoteContainer.querySelector(".ldcopy-base64-btn");
    if (!base64Btn) {
      base64Btn = createSelectionToolButton({
        className: "ldcopy-base64-btn",
        title: "Base64 \u89E3\u7801\u5E76\u590D\u5236",
        content: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align: middle; margin-right: 2px;"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>base64',
        order: -2,
        transform: decodeBase64Utf8,
        successMessage: "\u2705 Base64 \u89E3\u7801\u5DF2\u590D\u5236",
        errorContext: "Base64 \u89E3\u7801"
      });
      quoteContainer.insertBefore(base64Btn, quoteContainer.firstChild);
    }
    if (!quoteContainer.querySelector(".ldcopy-strip-chinese-btn")) {
      const stripChineseBtn = createSelectionToolButton({
        className: "ldcopy-strip-chinese-btn",
        title: "\u53BB\u6389\u9009\u4E2D\u6587\u672C\u4E2D\u7684\u4E2D\u6587\u5E76\u590D\u5236",
        content: "\u53BB\u4E2D\u6587",
        order: -1,
        transform: stripChineseText,
        successMessage: "\u2705 \u5DF2\u53BB\u4E2D\u6587\u5E76\u590D\u5236",
        errorContext: "\u53BB\u4E2D\u6587"
      });
      base64Btn.insertAdjacentElement("afterend", stripChineseBtn);
    }
  }

  // src/content/messages.ts
  function assertExportResult(result) {
    if (result.total === 0) throw new Error("\u5F53\u524D\u9875\u9762\u6CA1\u6709\u68C0\u6D4B\u5230\u5DF2\u52A0\u8F7D\u697C\u5C42");
    if (result.successCount === 0) throw new Error("\u5DF2\u52A0\u8F7D\u697C\u5C42\u5168\u90E8\u5BFC\u51FA\u5931\u8D25");
  }
  function getExportToastPrefix(result) {
    if (result.failureCount === 0) return "\u2705";
    return `\u26A0\uFE0F \u5DF2\u5904\u7406 ${result.successCount}/${result.total} \u4E2A\u697C\u5C42\uFF0C${result.failureCount} \u4E2A\u5931\u8D25\u3002`;
  }
  async function exportTopic(action) {
    const settings = await getCachedSettings();
    const result = await collectLoadedPosts(settings);
    assertExportResult(result);
    const title = getTopicTitle();
    const markdown = formatTopicMd(result.posts, getTopicUrl(), settings);
    const prefix = getExportToastPrefix(result);
    if (action === "copy") {
      await copyToClipboard(markdown);
      return {
        response: { success: true, ...result },
        toast: result.failureCount === 0 ? "\u2705 \u5DF2\u590D\u5236\u6574\u4E2A\u4E3B\u9898" : `${prefix} \u5DF2\u590D\u5236`
      };
    }
    const filename = sanitizeFilename(`${title}.md`);
    downloadFile(markdown, filename);
    return {
      response: { success: true, filename, ...result },
      toast: result.failureCount === 0 ? `\u2705 \u5DF2\u4E0B\u8F7D ${filename}` : `${prefix} \u5DF2\u4E0B\u8F7D ${filename}`
    };
  }
  async function handleTopicExport(action, sendResponse) {
    try {
      const outcome = await exportTopic(action);
      sendResponse(outcome.response);
      showToast(outcome.toast);
    } catch (err) {
      sendResponse({ success: false, error: getErrorMessage(err) });
      handleError(err, action === "copy" ? "\u590D\u5236\u4E3B\u9898" : "\u4E0B\u8F7D\u4E3B\u9898");
    }
  }
  function registerMessageHandlers() {
    chrome.runtime.onMessage.addListener(
      (msg, _sender, sendResponse) => {
        if (msg.action === "getInfo") {
          const postEls = getPostElements();
          sendResponse({
            title: getTopicTitle(),
            postCount: postEls.length
          });
          return true;
        }
        if (msg.action === "copyTopic") {
          void handleTopicExport("copy", sendResponse);
          return true;
        }
        if (msg.action === "downloadTopic") {
          void handleTopicExport("download", sendResponse);
          return true;
        }
        return false;
      }
    );
  }

  // src/content/refresh-state.ts
  var RefreshScheduler = class {
    constructor(task, defaultDelay) {
      this.task = task;
      this.defaultDelay = defaultDelay;
    }
    task;
    defaultDelay;
    timer = null;
    inFlight = null;
    pending = false;
    schedule(delay = this.defaultDelay) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.run();
      }, delay);
    }
    run() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.inFlight) {
        this.pending = true;
        return this.inFlight;
      }
      this.inFlight = this.runUntilIdle();
      return this.inFlight;
    }
    async runUntilIdle() {
      try {
        do {
          this.pending = false;
          await this.task();
        } while (this.pending);
      } finally {
        this.inFlight = null;
      }
    }
  };

  // src/content/managed-observer.ts
  var ManagedObserver = class {
    observer = null;
    target;
    observerInit;
    callback;
    pagehideHandler = () => {
      this.pause();
    };
    pageshowHandler = (event) => {
      if (event.persisted) this.start();
    };
    isConnected = false;
    constructor(target, observerInit, callback) {
      this.target = target;
      this.observerInit = observerInit;
      this.callback = callback;
      window.addEventListener("pagehide", this.pagehideHandler);
      window.addEventListener("pageshow", this.pageshowHandler);
    }
    start() {
      if (this.observer) return;
      this.observer = new MutationObserver(this.callback);
      this.observer.observe(this.target, this.observerInit);
      this.isConnected = true;
    }
    disconnect() {
      this.pause();
      window.removeEventListener("pagehide", this.pagehideHandler);
      window.removeEventListener("pageshow", this.pageshowHandler);
    }
    pause() {
      if (!this.observer) return;
      this.observer.disconnect();
      this.observer = null;
      this.isConnected = false;
    }
  };

  // src/content/topic-api.ts
  var MEGA_TOPIC_POST_LIMIT = 1e4;
  var POST_BATCH_SIZE = 20;
  function assertOk(response) {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  }
  function isFinitePositiveInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value > 0;
  }
  function isTopicPost(value) {
    if (!value || typeof value !== "object") return false;
    const post = value;
    return isFinitePositiveInteger(post.id) && isFinitePositiveInteger(post.topic_id) && isFinitePositiveInteger(post.post_number) && typeof post.username === "string" && typeof post.created_at === "string" && typeof post.cooked === "string";
  }
  function parseTopicResponse(value) {
    if (!value || typeof value !== "object") throw new Error("\u4E3B\u9898\u6570\u636E\u683C\u5F0F\u65E0\u6548");
    const topic = value;
    const stream = topic.post_stream?.stream;
    const posts = topic.post_stream?.posts;
    if (!isFinitePositiveInteger(topic.id) || typeof topic.title !== "string" || typeof topic.posts_count !== "number" || !Array.isArray(stream) || !stream.every(isFinitePositiveInteger) || !Array.isArray(posts) || !posts.every(isTopicPost)) {
      throw new Error("\u4E3B\u9898\u6570\u636E\u683C\u5F0F\u65E0\u6548");
    }
    return topic;
  }
  async function fetchTopic(topicId, signal, floor) {
    const floorSegment = floor && floor > 1 ? `/${Math.trunc(floor)}` : "";
    const response = await fetch(
      `/t/${encodeURIComponent(topicId)}${floorSegment}.json?track_visit=true&forceLoad=true`,
      {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        signal
      }
    );
    return parseTopicResponse(await assertOk(response).json());
  }
  function buildPostsUrl(topicId, postIds) {
    const params = new URLSearchParams();
    postIds.forEach((postId) => params.append("post_ids[]", String(postId)));
    return `/t/${encodeURIComponent(topicId)}/posts.json?${params.toString()}`;
  }
  async function fetchPosts(topicId, postIds, signal) {
    if (postIds.length === 0) return [];
    const response = await fetch(buildPostsUrl(topicId, postIds), {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal
    });
    const payload = await assertOk(response).json();
    const posts = payload.post_stream?.posts;
    if (!Array.isArray(posts) || !posts.every(isTopicPost)) {
      throw new Error("\u697C\u5C42\u6570\u636E\u683C\u5F0F\u65E0\u6548");
    }
    const byId = new Map(posts.map((post) => [post.id, post]));
    return postIds.flatMap((postId) => {
      const post = byId.get(postId);
      return post ? [post] : [];
    });
  }
  async function fetchPostReplies(postId, after = 1, signal) {
    const params = new URLSearchParams({ after: String(Math.max(1, Math.trunc(after))) });
    const response = await fetch(`/posts/${encodeURIComponent(String(postId))}/replies?${params}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      signal
    });
    const replies = await assertOk(response).json();
    if (!Array.isArray(replies) || !replies.every(isTopicPost)) {
      throw new Error("\u56DE\u590D\u6570\u636E\u683C\u5F0F\u65E0\u6548");
    }
    return replies;
  }
  var TopicDataSource = class _TopicDataSource {
    topic;
    article;
    commentPostIds;
    cache = /* @__PURE__ */ new Map();
    cacheByPostNumber = /* @__PURE__ */ new Map();
    constructor(topic, article) {
      this.topic = topic;
      this.article = article;
      topic.post_stream.posts.forEach((post) => this.cachePost(post));
      this.commentPostIds = topic.post_stream.stream.filter((postId) => postId !== article.id);
    }
    static async create(topicId, signal, floor) {
      const topic = await fetchTopic(topicId, signal, floor);
      let article = topic.post_stream.posts.find((post) => post.post_number === 1);
      if (!article) {
        const initialIds = topic.post_stream.stream.slice(0, POST_BATCH_SIZE);
        const initialPosts = await fetchPosts(topicId, initialIds, signal);
        initialPosts.forEach((post) => topic.post_stream.posts.push(post));
        article = initialPosts.find((post) => post.post_number === 1);
      }
      if (!article) throw new Error("\u672A\u627E\u5230\u4E3B\u9898\u6B63\u6587");
      return new _TopicDataSource(topic, article);
    }
    get commentCount() {
      return this.commentPostIds.length;
    }
    get isMegaTopic() {
      return this.topic.posts_count >= MEGA_TOPIC_POST_LIMIT || this.topic.post_stream.stream.length >= MEGA_TOPIC_POST_LIMIT;
    }
    getCachedPost(postId) {
      return this.cache.get(postId);
    }
    getCachedPostByNumber(postNumber) {
      return this.cacheByPostNumber.get(postNumber);
    }
    async loadPage(page, perPage, signal) {
      const start = (page - 1) * perPage;
      const ids = this.commentPostIds.slice(start, start + perPage);
      await this.loadPosts(ids, signal);
      const replyTargetIds = ids.flatMap((postId) => {
        const targetFloor = this.cache.get(postId)?.reply_to_post_number;
        if (!targetFloor) return [];
        const targetId = this.topic.post_stream.stream[targetFloor - 1];
        return targetId ? [targetId] : [];
      });
      await this.loadPosts([...new Set(replyTargetIds)], signal);
      return ids.map((postId, index) => {
        const post = this.cache.get(postId);
        return post || {
          id: postId,
          topic_id: this.topic.id,
          post_number: start + index + 2,
          username: "system",
          created_at: "",
          cooked: "<p>\u6B64\u56DE\u590D\u4E0D\u53EF\u89C1\u6216\u5DF2\u5220\u9664</p>",
          hidden: true
        };
      });
    }
    async loadPosts(postIds, signal) {
      const missingIds = postIds.filter((postId) => !this.cache.has(postId));
      for (let index = 0; index < missingIds.length; index += POST_BATCH_SIZE) {
        const posts = await fetchPosts(
          String(this.topic.id),
          missingIds.slice(index, index + POST_BATCH_SIZE),
          signal
        );
        posts.forEach((post) => this.cachePost(post));
      }
    }
    cachePost(post) {
      const previous = this.cache.get(post.id);
      if (previous && previous.post_number !== post.post_number) {
        this.cacheByPostNumber.delete(previous.post_number);
      }
      this.cache.set(post.id, post);
      this.cacheByPostNumber.set(post.post_number, post);
    }
    async refreshPost(postId, signal) {
      const [post] = await fetchPosts(String(this.topic.id), [postId], signal);
      if (!post) {
        this.invalidatePost(postId);
        return null;
      }
      this.cachePost(post);
      if (post.post_number === 1) this.article = post;
      return post;
    }
    invalidatePost(postId) {
      const post = this.cache.get(postId);
      if (post) this.cacheByPostNumber.delete(post.post_number);
      this.cache.delete(postId);
    }
  };

  // src/content/topic-actions.ts
  var TOPIC_ACTION_REQUEST_NAME = "ldtk:topic-action-request";
  var TOPIC_ACTION_RESULT_NAME = "ldtk:topic-action-result";
  var TOPIC_REACTION_PICKER_REQUEST_NAME = "ldtk:reaction-picker-request";
  function parseSerialized(value) {
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  function parseTopicActionResult(value) {
    const parsed = parseSerialized(value);
    if (!parsed || typeof parsed !== "object") return null;
    const detail = parsed;
    if (typeof detail.requestId !== "string" || !/^[a-zA-Z0-9:_-]{1,100}$/.test(detail.requestId) || typeof detail.ok !== "boolean" || !["triggered", "settled"].includes(detail.phase) || detail.message !== void 0 && typeof detail.message !== "string") {
      return null;
    }
    return {
      requestId: detail.requestId,
      ok: detail.ok,
      phase: detail.phase,
      ...detail.message === void 0 ? {} : { message: detail.message }
    };
  }

  // src/content/topic-events.ts
  var TOPIC_EVENT_NAME = "ldtk:topic-event";
  var TOPIC_EVENT_TYPES = [
    "created",
    "acted",
    "boost_added",
    "boost_removed",
    "revised",
    "rebaked",
    "deleted",
    "destroyed",
    "recovered"
  ];
  function isReactionId(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 100 && !/[\u0000-\u001f]/.test(value);
  }
  function isSafeReactionUrl(value) {
    if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
    try {
      return new URL(value, "https://linux.do").protocol === "https:";
    } catch {
      return false;
    }
  }
  function parseTopicEventDetail(value) {
    let parsedValue = value;
    if (typeof value === "string") {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        return null;
      }
    }
    if (!parsedValue || typeof parsedValue !== "object") return null;
    const detail = parsedValue;
    if (!Number.isInteger(detail.topicId) || Number(detail.topicId) <= 0 || !Number.isInteger(detail.postId) || Number(detail.postId) <= 0 || !TOPIC_EVENT_TYPES.includes(detail.type) || detail.updatedAt !== void 0 && typeof detail.updatedAt !== "string" || detail.currentReactionId !== void 0 && detail.currentReactionId !== null && !isReactionId(detail.currentReactionId) || detail.currentReactionUrl !== void 0 && (!isReactionId(detail.currentReactionId) || !isSafeReactionUrl(detail.currentReactionUrl))) {
      return null;
    }
    return {
      topicId: detail.topicId,
      type: detail.type,
      postId: detail.postId,
      ...detail.updatedAt === void 0 ? {} : { updatedAt: detail.updatedAt },
      ...detail.currentReactionId === void 0 ? {} : { currentReactionId: detail.currentReactionId },
      ...detail.currentReactionUrl === void 0 ? {} : { currentReactionUrl: detail.currentReactionUrl }
    };
  }

  // src/content/topic-read-tracking.ts
  function getCsrfToken() {
    return document.querySelector('meta[name="csrf-token"]')?.content || null;
  }
  function buildTimingsBody(topicId, timings) {
    const body = new URLSearchParams();
    let topicTime = 0;
    timings.forEach((milliseconds, postNumber) => {
      const rounded = Math.max(0, Math.round(milliseconds));
      if (rounded === 0) return;
      body.set(`timings[${postNumber}]`, String(rounded));
      topicTime += rounded;
    });
    body.set("topic_time", String(topicTime));
    body.set("topic_id", String(topicId));
    return body.toString();
  }
  async function sendReadTimings(topicId, timings, keepalive = false) {
    if (timings.size === 0) return;
    const headers = {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest"
    };
    const csrfToken = getCsrfToken();
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
    const response = await fetch("/topics/timings", {
      method: "POST",
      credentials: "same-origin",
      headers,
      body: buildTimingsBody(topicId, timings),
      keepalive
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }
  var TopicReadTracker = class {
    constructor(topicId, root) {
      this.topicId = topicId;
      this.root = root;
    }
    topicId;
    root;
    totals = /* @__PURE__ */ new Map();
    visible = /* @__PURE__ */ new Map();
    observer = null;
    observe(posts) {
      this.disconnectObserver();
      if (typeof IntersectionObserver === "undefined") return;
      this.observer = new IntersectionObserver(
        (entries) => {
          const now = performance.now();
          entries.forEach((entry) => {
            const postNumber = Number(entry.target.dataset.postNumber);
            if (!Number.isInteger(postNumber) || postNumber <= 0) return;
            const current = this.visible.get(entry.target);
            if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
              if (!current) this.visible.set(entry.target, { postNumber, startedAt: now });
            } else if (current) {
              this.addElapsed(current, now);
              this.visible.delete(entry.target);
            }
          });
        },
        { root: this.root, threshold: [0, 0.5, 1] }
      );
      posts.forEach((post) => this.observer?.observe(post));
    }
    flush(keepalive = false) {
      this.captureVisible();
      if (this.totals.size === 0) return;
      const payload = new Map(this.totals);
      this.totals.clear();
      void sendReadTimings(this.topicId, payload, keepalive).catch(() => {
      });
    }
    disconnect() {
      this.flush(true);
      this.disconnectObserver();
    }
    addElapsed(item, now) {
      const elapsed = Math.max(0, now - item.startedAt);
      this.totals.set(item.postNumber, (this.totals.get(item.postNumber) || 0) + elapsed);
    }
    captureVisible() {
      const now = performance.now();
      this.visible.forEach((item) => this.addElapsed(item, now));
      this.visible.clear();
    }
    disconnectObserver() {
      this.captureVisible();
      this.observer?.disconnect();
      this.observer = null;
    }
  };

  // src/content/topic-state.ts
  var COMMENTS_PAGE_PARAM = "ldo_comments_page";
  var SESSION_PREFIX = "ldtk:split-reading:";
  var NATIVE_ACTIONS = /* @__PURE__ */ new Set([
    "like",
    "reply",
    "bookmark",
    "more",
    "edit",
    "delete",
    "recover"
  ]);
  function parseTopicRoute(pathname) {
    const parts = pathname.split("/").filter(Boolean);
    if (parts[0] !== "t") return null;
    const numericParts = parts.slice(1).filter((part) => /^\d+$/.test(part));
    if (numericParts.length === 0) return null;
    const [topicId, floor] = numericParts;
    return { topicId, floor: floor ? Number(floor) : void 0 };
  }
  function getPageCount(commentCount, perPage) {
    return Math.max(1, Math.ceil(Math.max(0, commentCount) / perPage));
  }
  function clampPage(page, pageCount) {
    if (!Number.isFinite(page)) return 1;
    return Math.min(Math.max(1, Math.trunc(page)), Math.max(1, pageCount));
  }
  function getCommentPageForFloor(floor, perPage) {
    if (!Number.isFinite(floor) || floor <= 1) return 1;
    return Math.floor((Math.trunc(floor) - 2) / perPage) + 1;
  }
  function parsePositiveInteger(value) {
    if (!value || !/^\d+$/.test(value)) return void 0;
    const parsed = Number(value);
    return parsed > 0 ? parsed : void 0;
  }
  function deriveInitialPage(options) {
    const urlPage = parsePositiveInteger(options.url.searchParams.get(COMMENTS_PAGE_PARAM));
    if (urlPage) return clampPage(urlPage, options.pageCount);
    if (options.routeFloor && options.routeFloor > 1) {
      return clampPage(
        getCommentPageForFloor(options.routeFloor, options.perPage),
        options.pageCount
      );
    }
    if (options.sessionPage) return clampPage(options.sessionPage, options.pageCount);
    if (options.lastReadPostNumber && options.lastReadPostNumber > 0) {
      const firstUnreadFloor = options.lastReadPostNumber + 1;
      return clampPage(getCommentPageForFloor(firstUnreadFloor, options.perPage), options.pageCount);
    }
    return 1;
  }
  function buildPaginationItems(currentPage, pageCount) {
    const total = Math.max(1, Math.trunc(pageCount));
    const current = clampPage(currentPage, total);
    if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
    const pages = /* @__PURE__ */ new Set([1, total, current - 1, current, current + 1]);
    const ordered = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
    const result = [];
    ordered.forEach((page, index) => {
      const previous = ordered[index - 1];
      if (previous && page - previous > 1) result.push("ellipsis");
      result.push(page);
    });
    return result;
  }
  function updatePageUrl(url, page) {
    const next = new URL(url.href);
    next.searchParams.set(COMMENTS_PAGE_PARAM, String(Math.max(1, Math.trunc(page))));
    return next;
  }
  function getSessionKey(topicId) {
    return `${SESSION_PREFIX}${topicId}`;
  }
  function readTopicState(topicId, storage = sessionStorage) {
    try {
      const raw = storage.getItem(getSessionKey(topicId));
      if (!raw) return null;
      const value = JSON.parse(raw);
      if (typeof value.page !== "number" || !Number.isFinite(value.page) || value.page < 1) {
        return null;
      }
      const pending = value.pendingAction;
      const pendingAction = pending && Number.isInteger(pending.floor) && pending.floor > 0 && NATIVE_ACTIONS.has(pending.action) ? pending : void 0;
      return {
        page: Math.max(1, Math.trunc(value.page)),
        leftScrollTop: Math.max(0, Number(value.leftScrollTop) || 0),
        rightScrollTop: Math.max(0, Number(value.rightScrollTop) || 0),
        nativeMode: value.nativeMode === true,
        pendingAction
      };
    } catch {
      return null;
    }
  }
  function writeTopicState(topicId, state, storage = sessionStorage) {
    try {
      storage.setItem(getSessionKey(topicId), JSON.stringify(state));
    } catch {
    }
  }

  // src/content/topic-layout.ts
  var ROOT_CLASS = "ldtk-topic-reading-root";
  var ACTIVE_CLASS = "ldtk-split-reading-active";
  var PENDING_CLASS = "ldtk-split-reading-pending";
  var STYLE_ID = "ldtk-topic-reading-style";
  var PENDING_STYLE_ID = "ldtk-topic-reading-pending-style";
  var RETURN_BUTTON_ID = "ldtk-native-return";
  var MIN_VIEWPORT_WIDTH = 1280;
  var nativeAttemptKey = null;
  var actionRequestSequence = 0;
  var DISCOURSE_ICON_REPLACEMENTS = {
    "d-liked": "heart",
    "d-unliked": "far-heart",
    "d-post-share": "arrow-up-from-bracket"
  };
  var NATIVE_ACTION_SELECTORS = {
    like: '.post-action-menu__like, button[title*="\u8D5E"], button[aria-label*="\u8D5E"]',
    reply: '.post-action-menu__reply, button[title*="\u56DE\u590D"], button[aria-label*="\u56DE\u590D"]',
    bookmark: '.post-action-menu__bookmark, button[title*="\u4E66\u7B7E"], button[aria-label*="\u4E66\u7B7E"]',
    more: '.post-action-menu__more, button[title*="\u66F4\u591A"], button[aria-label*="\u66F4\u591A"]',
    edit: '.post-action-menu__edit, button[title*="\u7F16\u8F91"], button[aria-label*="\u7F16\u8F91"]',
    delete: '.post-action-menu__delete, button[title*="\u5220\u9664"], button[aria-label*="\u5220\u9664"]',
    recover: '.post-action-menu__recover, button[title*="\u6062\u590D"], button[aria-label*="\u6062\u590D"]'
  };
  var PENDING_STYLE = `
html.${PENDING_CLASS} #main-outlet,
html.${PENDING_CLASS} .sidebar-wrapper,
html.${PENDING_CLASS} .topic-navigation,
html.${PENDING_CLASS} .timeline-container {
  visibility: hidden !important;
}
`;
  var LAYOUT_STYLE = `
html.${ACTIVE_CLASS},
html.${ACTIVE_CLASS} body {
  overflow: hidden !important;
}
html.${ACTIVE_CLASS} #main-outlet {
  position: relative !important;
  z-index: 400 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
html.${ACTIVE_CLASS} .sidebar-wrapper,
html.${ACTIVE_CLASS} .topic-navigation,
html.${ACTIVE_CLASS} .timeline-container {
  display: none !important;
}
html.${ACTIVE_CLASS} #main-outlet .discourse-reactions-picker.is-expanded {
  z-index: 410 !important;
  visibility: visible !important;
  pointer-events: auto !important;
}
html.${ACTIVE_CLASS} #main-outlet .discourse-boosts__input-container,
html.${ACTIVE_CLASS} #main-outlet .discourse-boosts__input-container * {
  visibility: visible !important;
  pointer-events: auto !important;
}
html.${ACTIVE_CLASS} #reply-control {
  z-index: 400 !important;
}
html.${ACTIVE_CLASS} #reply-control.open {
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
}
.${ROOT_CLASS} {
  position: fixed;
  inset: var(--ldtk-header-height, 60px) 0 0;
  z-index: 90;
  box-sizing: border-box;
  overflow: hidden;
  color: var(--primary, #222);
  background: var(--secondary, #fff);
  font-family: var(--font-family, Arial, sans-serif);
  letter-spacing: 0;
}
.${ROOT_CLASS} *, .${ROOT_CLASS} *::before, .${ROOT_CLASS} *::after {
  box-sizing: border-box;
}
.ldtk-reading-grid {
  width: min(100%, 1920px);
  height: 100%;
  margin: 0 auto;
  padding: 16px 24px;
  display: grid;
  grid-template-columns: minmax(0, 58fr) minmax(420px, 42fr);
  gap: 24px;
}
.ldtk-reading-pane {
  min-width: 0;
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  background: var(--secondary, #fff);
  border: 1px solid var(--primary-low, #e4e4e4);
  border-radius: 6px;
}
.ldtk-article-pane {
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: hidden;
}
.ldtk-article-scroll {
  flex: 1 1 auto;
  min-height: 0;
  padding: 28px clamp(24px, 4vw, 64px) 40px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
.ldtk-article-header {
  max-width: 780px;
  margin: 0 auto 28px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-article-header h1 {
  margin: 0 0 12px;
  color: var(--primary, #222);
  font-size: 28px;
  line-height: 1.3;
  font-weight: 650;
  overflow-wrap: anywhere;
  letter-spacing: 0;
}
.ldtk-article-header p,
.ldtk-comment-status,
.ldtk-post-meta {
  color: var(--primary-medium, #6b6b6b);
}
.ldtk-article-content {
  max-width: 780px;
  margin: 0 auto;
}
.ldtk-article-footer {
  position: relative;
  z-index: 2;
  flex: 0 0 auto;
  width: 100%;
  max-height: min(38vh, 230px);
  padding: 0 clamp(24px, 4vw, 64px) 12px;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--primary, #222);
  background: var(--secondary, #fff);
  border-top: 1px solid var(--primary-low, #e4e4e4);
  box-shadow: 0 -4px 12px rgb(0 0 0 / 4%);
  scrollbar-gutter: stable;
}
.ldtk-article-footer > * {
  max-width: 780px;
  margin-right: auto;
  margin-left: auto;
}
.ldtk-article-reply-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 38px;
  padding: 8px 0;
  border-top: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-article-reply-summary[hidden] {
  display: none;
}
.ldtk-article-reply-chip {
  display: inline-flex;
  align-items: flex-start;
  gap: 5px;
  min-height: 30px;
  max-width: min(100%, 300px);
  padding: 3px 9px 3px 4px;
  border: 0;
  border-radius: 8px;
  color: var(--primary-medium, #666);
  background: var(--primary-very-low, #f5f5f5);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.ldtk-article-reply-chip:hover {
  color: var(--primary, #222);
  background: var(--primary-low, #e9e9e9);
}
.ldtk-article-reply-chip:focus-visible {
  outline: 2px solid var(--tertiary, #0088cc);
  outline-offset: 2px;
}
.ldtk-article-reply-avatar {
  flex: 0 0 auto;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}
.ldtk-article-reply-content {
  min-width: 0;
  padding-top: 2px;
  overflow-wrap: anywhere;
  white-space: normal;
  line-height: 1.45;
  text-align: left;
}
.ldtk-article-reply-content img.emoji {
  display: inline-block;
  width: 18px;
  height: 18px;
  margin: 0 1px;
  border-radius: 0;
  object-fit: contain;
  vertical-align: -4px;
}
.ldtk-topic-summary {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px 20px;
  min-height: 68px;
  padding: 12px 0;
  border-top: 1px solid var(--primary-low, #e4e4e4);
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-topic-stat {
  display: grid;
  gap: 2px;
  min-width: 52px;
  color: var(--primary-medium, #666);
  font-size: 12px;
  line-height: 1.2;
}
.ldtk-topic-stat strong {
  color: var(--tertiary, #0088cc);
  font-size: 19px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.ldtk-topic-participants {
  display: flex;
  align-items: center;
  min-width: 0;
}
.ldtk-topic-participants a {
  display: block;
  margin-left: -5px;
}
.ldtk-topic-participants a:first-child {
  margin-left: 0;
}
.ldtk-topic-participants img {
  display: block;
  width: 30px;
  height: 30px;
  border: 2px solid var(--secondary, #fff);
  border-radius: 50%;
  background: var(--primary-low, #e4e4e4);
}
.ldtk-topic-read-time {
  margin-left: auto;
  text-align: right;
}
.ldtk-topic-read-time strong {
  color: var(--primary-medium, #666);
}
.ldtk-comments-pane {
  position: relative;
  background: var(--secondary, #fff);
}
.ldtk-comments-toolbar {
  position: sticky;
  top: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 54px;
  padding: 8px 12px;
  background: var(--secondary, #fff);
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-comments-toolbar h2 {
  margin: 0 auto 0 0;
  font-size: 16px;
  line-height: 1.3;
  font-weight: 650;
  letter-spacing: 0;
}
.ldtk-toolbar-button,
.ldtk-pagination button,
.ldtk-reply-target {
  min-width: 32px;
  min-height: 32px;
  padding: 6px 9px;
  border: 1px solid var(--primary-low, #ddd);
  border-radius: 4px;
  color: var(--primary, #222);
  background: var(--secondary, #fff);
  font: inherit;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.ldtk-toolbar-button:hover,
.ldtk-pagination button:hover,
.ldtk-reply-target:hover {
  background: var(--primary-very-low, #f5f5f5);
}
.ldtk-toolbar-button:focus-visible,
.ldtk-pagination button:focus-visible,
.ldtk-reply-target:focus-visible {
  outline: 2px solid var(--tertiary, #0088cc);
  outline-offset: 2px;
}
.ldtk-toolbar-button:disabled,
.ldtk-pagination button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.ldtk-new-replies {
  display: none;
  width: calc(100% - 24px);
  margin: 10px 12px 0;
  padding: 9px 12px;
  border: 1px solid var(--tertiary-low, #b9dff3);
  border-radius: 4px;
  color: var(--tertiary, #0088cc);
  background: var(--tertiary-very-low, #edf7fc);
  font: inherit;
  cursor: pointer;
}
.ldtk-new-replies[data-visible="true"] { display: block; }
.ldtk-comments-list {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  padding: 0 16px;
}
.${ROOT_CLASS} .topic-post {
  display: grid;
  grid-template-columns: 48px minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  max-width: 100%;
  gap: 12px;
  padding: 20px 0;
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
  background: transparent;
}
.${ROOT_CLASS} .topic-post:last-child { border-bottom: 0; }
.${ROOT_CLASS} .ldtk-article-content.topic-post {
  display: block;
  padding: 0;
  border: 0;
}
.${ROOT_CLASS} .topic-avatar img {
  display: block;
  width: 42px;
  height: 42px;
  border-radius: 50%;
}
.${ROOT_CLASS} .topic-body {
  width: 100% !important;
  min-width: 0;
  max-width: 100%;
}
.ldtk-post-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}
.${ROOT_CLASS} .names .username {
  color: var(--primary, #222);
  font-weight: 650;
  text-decoration: none;
}
.ldtk-post-meta {
  margin-left: auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-decoration: none;
}
.ldtk-reply-target {
  min-height: 24px;
  padding: 3px 6px;
  border-color: var(--tertiary-low, #9ccfe8);
  color: var(--tertiary-hover, #006699);
  background: var(--tertiary-very-low, #e7f5fc);
  box-shadow: inset 3px 0 0 var(--tertiary, #0088cc);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
  text-align: left;
}
.ldtk-reply-target:hover {
  border-color: var(--tertiary, #0088cc);
  color: var(--tertiary-hover, #005580);
  background: var(--tertiary-low, #d7edf8);
}
.${ROOT_CLASS} .cooked {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
  overflow-wrap: anywhere;
  font-size: 15px;
  line-height: 1.65;
}
.${ROOT_CLASS} .cooked pre,
.${ROOT_CLASS} .cooked table,
.${ROOT_CLASS} .cooked .md-table,
.${ROOT_CLASS} .cooked .onebox {
  max-width: 100%;
  overflow-x: auto;
  overscroll-behavior-inline: contain;
}
.${ROOT_CLASS} .cooked pre {
  white-space: pre;
}
.${ROOT_CLASS} .cooked table {
  display: block;
}
.${ROOT_CLASS} .cooked p,
.${ROOT_CLASS} .cooked li,
.${ROOT_CLASS} .cooked a,
.${ROOT_CLASS} .cooked blockquote {
  overflow-wrap: anywhere;
}
.${ROOT_CLASS} .cooked img,
.${ROOT_CLASS} .cooked video,
.${ROOT_CLASS} .cooked iframe,
.${ROOT_CLASS} .cooked object,
.${ROOT_CLASS} .cooked canvas,
.${ROOT_CLASS} .cooked svg {
  max-width: 100%;
}
.${ROOT_CLASS} .cooked img,
.${ROOT_CLASS} .cooked video {
  height: auto;
}
.ldtk-post-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 40px;
  margin-top: 16px;
  color: var(--primary-medium, #6b6b6b);
}
.ldtk-post-extra-controls,
.ldtk-post-actions,
.ldtk-more-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.ldtk-post-actions {
  margin-left: auto;
}
.ldtk-more-actions[hidden] {
  display: none;
}
.ldtk-post-menu-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 32px;
  min-height: 32px;
  padding: 6px 8px;
  border: 0;
  border-radius: 4px;
  color: var(--primary-low-mid, #919191);
  background: transparent;
  font: inherit;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
.ldtk-post-menu-button:hover {
  color: var(--primary, #222);
  background: var(--d-hover, var(--primary-very-low, #f2f2f2));
}
.ldtk-post-menu-button:focus-visible {
  outline: 2px solid var(--tertiary, #0088cc);
  outline-offset: 2px;
}
.ldtk-post-menu-button:disabled,
.ldtk-post-menu-button[aria-busy="true"] {
  cursor: wait;
  opacity: 0.5;
}
.ldtk-post-menu-button .d-icon {
  width: 16px;
  height: 16px;
  fill: currentColor;
  pointer-events: none;
}
.ldtk-post-menu-button .btn-toggle-reaction-emoji {
  display: block;
  width: 18px;
  height: 18px;
  object-fit: contain;
  pointer-events: none;
}
.ldtk-post-menu-button.button-count {
  gap: 5px;
  color: var(--primary-medium, #777);
  font-variant-numeric: tabular-nums;
}
.ldtk-post-menu-button.like-count .d-icon,
.ldtk-post-menu-button[aria-pressed="true"].post-action-menu__like {
  color: var(--love, #fa6c8d);
}
.ldtk-post-menu-button.bookmarked {
  color: var(--tertiary, #0088cc);
}
.ldtk-post-menu-button.post-action-menu__reply {
  padding-inline: 9px;
  color: var(--primary-medium, #666);
}
.${ROOT_CLASS} .discourse-boosts__post-menu {
  width: 100%;
  padding: 4px 0;
}
.${ROOT_CLASS} .discourse-boosts__list {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}
.${ROOT_CLASS} .discourse-boosts__bubble {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 4px 8px 4px 4px;
  border: 0;
  border-radius: 50px;
  color: var(--primary, #222);
  background: var(--primary-100, var(--primary-very-low, #f2f2f2));
  font-size: 12px;
  line-height: 1;
}
.${ROOT_CLASS} .discourse-boosts__bubble > a {
  flex: 0 0 auto;
}
.${ROOT_CLASS} .discourse-boosts__bubble .avatar {
  display: block;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  object-fit: cover;
}
.${ROOT_CLASS} .discourse-boosts__cooked {
  min-width: 0;
  max-width: 100%;
  overflow-wrap: anywhere;
  white-space: normal;
}
.${ROOT_CLASS} .discourse-boosts__cooked p {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin: 0;
}
.${ROOT_CLASS} .discourse-boosts__cooked img.emoji,
.${ROOT_CLASS} .discourse-boosts__cooked img.emoji.only-emoji {
  width: 16px;
  height: 16px;
  margin: 0;
  object-fit: contain;
}
.${ROOT_CLASS} .discourse-boosts__add-btn {
  color: var(--primary-medium, #666);
}
.${ROOT_CLASS} .discourse-boosts__add-btn:hover {
  color: var(--primary, #222);
}
.ldtk-inline-replies {
  margin-top: 8px;
  border-top: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-inline-replies[hidden] {
  display: none;
}
.ldtk-inline-reply {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr);
  gap: 10px;
  padding: 14px 0;
  border-bottom: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-inline-reply-avatar img {
  display: block;
  width: 32px;
  height: 32px;
  border-radius: 50%;
}
.ldtk-inline-reply-body {
  min-width: 0;
}
.ldtk-inline-reply-heading {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
}
.ldtk-inline-reply-heading strong {
  color: var(--primary, #222);
  font-size: 13px;
}
.ldtk-inline-reply-floor {
  margin-left: auto;
  padding: 2px 0;
  border: 0;
  color: var(--primary-medium, #777);
  background: transparent;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.ldtk-inline-reply .cooked {
  font-size: 14px;
}
.ldtk-inline-replies-status,
.ldtk-load-more-replies {
  width: 100%;
  padding: 10px;
  border: 0;
  color: var(--primary-medium, #666);
  background: transparent;
  font: inherit;
  font-size: 13px;
  text-align: center;
}
.ldtk-load-more-replies {
  cursor: pointer;
}
.ldtk-load-more-replies:hover {
  color: var(--tertiary, #0088cc);
  background: var(--primary-very-low, #f5f5f5);
}
.ldtk-deleted-placeholder {
  color: var(--primary-medium, #666);
  font-style: italic;
}
.ldtk-destroyed-post > .ldtk-deleted-placeholder {
  grid-column: 1 / -1;
  margin: 0;
}
.ldtk-comment-status {
  padding: 36px 16px;
  text-align: center;
}
.ldtk-pagination {
  position: sticky;
  bottom: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 52px;
  padding: 8px 12px;
  background: var(--secondary, #fff);
  border-top: 1px solid var(--primary-low, #e4e4e4);
}
.ldtk-pagination button[aria-current="page"] {
  color: var(--secondary, #fff);
  border-color: var(--tertiary, #0088cc);
  background: var(--tertiary, #0088cc);
}
.ldtk-pagination-ellipsis { padding: 0 3px; color: var(--primary-medium, #666); }
.ldtk-post-highlight {
  outline: 3px solid var(--tertiary, #0088cc);
  outline-offset: -3px;
  background: var(--tertiary-very-low, #edf7fc) !important;
}
#${RETURN_BUTTON_ID} {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 2147483646;
  min-height: 40px;
  padding: 9px 14px;
  border: 1px solid var(--tertiary, #0088cc);
  border-radius: 5px;
  color: var(--secondary, #fff);
  background: var(--tertiary, #0088cc);
  box-shadow: 0 4px 14px rgb(0 0 0 / 20%);
  font: 600 14px/1.2 var(--font-family, Arial, sans-serif);
  cursor: pointer;
}
@media (prefers-reduced-motion: reduce) {
  .${ROOT_CLASS} *, #${RETURN_BUTTON_ID} { scroll-behavior: auto !important; }
  .${ROOT_CLASS} .heart-animation { animation: none !important; }
}
`;
  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }
  function getAvatarUrl(template) {
    if (!template) return null;
    const url = template.replace("{size}", "90");
    return url.startsWith("//") ? `${window.location.protocol}${url}` : url;
  }
  function formatCompactNumber(value) {
    const normalized = Math.max(0, value);
    if (normalized < 1e3) return String(normalized);
    const units = [
      { threshold: 1e6, suffix: "m" },
      { threshold: 1e3, suffix: "k" }
    ];
    const unit = units.find(({ threshold }) => normalized >= threshold);
    if (!unit) return String(normalized);
    const compact = normalized / unit.threshold;
    return `${compact >= 100 ? Math.round(compact) : compact.toFixed(1).replace(/\.0$/, "")}${unit.suffix}`;
  }
  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== void 0) element.textContent = text;
    return element;
  }
  function createButton(className, text, label = text) {
    const button = createElement("button", className, text);
    button.type = "button";
    button.setAttribute("aria-label", label);
    return button;
  }
  function createDiscourseIcon(name) {
    const symbolName = DISCOURSE_ICON_REPLACEMENTS[name] || name;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.classList.add("fa", "d-icon", `d-icon-${name}`, "svg-icon", "svg-string");
    icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#${symbolName}`);
    icon.appendChild(use);
    return icon;
  }
  function setButtonIcon(button, name) {
    const use = button.querySelector("use");
    if (!use) return;
    use.setAttribute("href", `#${DISCOURSE_ICON_REPLACEMENTS[name] || name}`);
    const icon = use.closest("svg");
    if (icon) icon.setAttribute("class", `fa d-icon d-icon-${name} svg-icon svg-string`);
  }
  function createPostMenuButton(options) {
    const classes = ["ldtk-post-menu-button", "btn-flat", options.className].filter(Boolean).join(" ");
    const button = createButton(classes, "", options.label);
    button.title = options.label;
    button.appendChild(createDiscourseIcon(options.icon));
    if (options.visibleLabel) button.appendChild(createElement("span", "", options.visibleLabel));
    return button;
  }
  function getNativePost(floor) {
    const candidates = document.querySelectorAll(
      `#main-outlet .topic-post[data-post-number="${floor}"], #main-outlet article[data-post-number="${floor}"]`
    );
    return candidates[0] || null;
  }
  function buildNativeFloorUrl(floor) {
    const url = new URL(window.location.href);
    const parts = window.location.pathname.split("/").filter(Boolean);
    const numericIndexes = parts.flatMap((part, index) => /^\d+$/.test(part) ? [index] : []);
    if (numericIndexes.length >= 2) parts.splice(numericIndexes[1], 1);
    if (floor > 1) parts.push(String(floor));
    url.pathname = `/${parts.join("/")}`;
    url.searchParams.delete(COMMENTS_PAGE_PARAM);
    url.hash = "";
    return url.href;
  }
  function removeReturnButton() {
    document.getElementById(RETURN_BUTTON_ID)?.remove();
  }
  function ensureLayoutStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = createElement("style");
    style.id = STYLE_ID;
    style.textContent = LAYOUT_STYLE;
    document.head.appendChild(style);
  }
  function ensurePendingStyle() {
    if (document.getElementById(PENDING_STYLE_ID)) return;
    const style = createElement("style");
    style.id = PENDING_STYLE_ID;
    style.textContent = PENDING_STYLE;
    (document.head || document.documentElement).appendChild(style);
  }
  function clearPendingTopicLayout() {
    document.documentElement.classList.remove(PENDING_CLASS);
    document.getElementById(PENDING_STYLE_ID)?.remove();
  }
  function prepareTopicLayout(settings) {
    const route = parseTopicRoute(window.location.pathname);
    const eligible = Boolean(route) && window.innerWidth >= MIN_VIEWPORT_WIDTH && settings?.enableSplitReading !== false;
    if (!eligible) {
      clearPendingTopicLayout();
      return false;
    }
    ensurePendingStyle();
    document.documentElement.classList.add(PENDING_CLASS);
    return true;
  }
  function addHighlight(element) {
    element.classList.add("ldtk-post-highlight");
    window.setTimeout(() => element.classList.remove("ldtk-post-highlight"), 1800);
  }
  function tryPendingNativeAction(route, state) {
    const pending = state.pendingAction;
    if (!pending) return;
    const attempt = () => {
      const post = getNativePost(pending.floor);
      if (!post) return false;
      post.scrollIntoView({ block: "center" });
      addHighlight(post);
      const control = post.querySelector(NATIVE_ACTION_SELECTORS[pending.action]);
      control?.click();
      writeTopicState(route.topicId, { ...state, pendingAction: void 0 });
      return true;
    };
    if (attempt()) return;
    if (route.floor !== pending.floor) {
      window.location.assign(buildNativeFloorUrl(pending.floor));
      return;
    }
    const observer = new MutationObserver(() => {
      if (attempt()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(() => observer.disconnect(), 8e3);
  }
  function ensureNativeMode(options) {
    ensureLayoutStyle();
    clearPendingTopicLayout();
    document.documentElement.classList.remove(ACTIVE_CLASS);
    document.querySelector(`.${ROOT_CLASS}`)?.remove();
    let button = document.getElementById(RETURN_BUTTON_ID);
    if (!button) {
      button = createButton("", "\u8FD4\u56DE\u53CC\u680F\u9605\u8BFB");
      button.id = RETURN_BUTTON_ID;
      document.body.appendChild(button);
    }
    button.onclick = () => {
      nativeAttemptKey = null;
      removeReturnButton();
      writeTopicState(options.route.topicId, {
        ...options.state,
        nativeMode: false,
        pendingAction: void 0
      });
      void refreshTopicLayout(options.settings, true);
    };
    const pending = options.state.pendingAction;
    if (pending) {
      const attemptKey = `${options.route.topicId}:${pending.floor}:${pending.action}`;
      if (attemptKey !== nativeAttemptKey) {
        nativeAttemptKey = attemptKey;
        tryPendingNativeAction(options.route, options.state);
      }
    }
  }
  var TopicLayout = class {
    constructor(route, source, settings, initialPage, callbacks) {
      this.route = route;
      this.source = source;
      this.settings = settings;
      this.callbacks = callbacks;
      this.currentPage = initialPage;
      this.pageCount = getPageCount(source.commentCount, settings.commentsPerPage);
      const savedState = readTopicState(route.topicId);
      this.state = savedState ? {
        ...savedState,
        page: initialPage,
        rightScrollTop: savedState.page === initialPage ? savedState.rightScrollTop : 0
      } : {
        page: initialPage,
        leftScrollTop: 0,
        rightScrollTop: 0
      };
    }
    route;
    source;
    settings;
    callbacks;
    root = createElement("section", ROOT_CLASS);
    articlePane = createElement("section", "ldtk-reading-pane ldtk-article-pane");
    articleScroll = createElement("div", "ldtk-article-scroll");
    commentsPane = createElement("section", "ldtk-reading-pane ldtk-comments-pane");
    commentsList = createElement("div", "ldtk-comments-list");
    pagination = createElement("nav", "ldtk-pagination");
    newRepliesButton = createButton("ldtk-new-replies", "\u6709\u65B0\u56DE\u590D\uFF0C\u70B9\u51FB\u5237\u65B0");
    refreshButton = createButton("ldtk-toolbar-button", "\u5237\u65B0", "\u5237\u65B0\u8BC4\u8BBA");
    status = createElement("div", "ldtk-comment-status");
    currentPage;
    pageCount;
    state;
    eventVersions = /* @__PURE__ */ new Map();
    reactionImages = /* @__PURE__ */ new Map();
    replyAborts = /* @__PURE__ */ new Map();
    articleReplies = [];
    readTracker = null;
    pageAbort = null;
    newReplyCount = 0;
    destroyed = false;
    saveTimer = null;
    mount(initialPosts, articleReplies = []) {
      this.articleReplies = articleReplies;
      this.ensureStyle();
      this.root.setAttribute("aria-label", "\u4E3B\u9898\u53CC\u680F\u9605\u8BFB");
      const grid = createElement("div", "ldtk-reading-grid");
      grid.append(this.articlePane, this.commentsPane);
      this.root.appendChild(grid);
      this.renderArticle();
      this.renderCommentsShell();
      this.renderComments(initialPosts);
      this.updateHeaderOffset();
      document.body.appendChild(this.root);
      document.documentElement.classList.add(ACTIVE_CLASS);
      clearPendingTopicLayout();
      removeReturnButton();
      this.articleScroll.scrollTop = this.state.leftScrollTop;
      this.commentsPane.scrollTop = this.state.rightScrollTop;
      this.articleScroll.addEventListener("scroll", this.scheduleSave, { passive: true });
      this.commentsPane.addEventListener("scroll", this.scheduleSave, { passive: true });
      this.root.addEventListener("click", this.handleClick);
      this.root.addEventListener("pointerover", this.handleReactionPointerOver);
      this.root.addEventListener("pointerout", this.handleReactionPointerOut);
      this.root.addEventListener("focusin", this.handleReactionFocusIn);
      this.root.addEventListener("focusout", this.handleReactionFocusOut);
      window.addEventListener("popstate", this.handlePopState);
      window.addEventListener("pagehide", this.handlePageHide);
      document.addEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent);
      injectButtons(this.settings);
      if (this.route.floor) void this.goToFloor(this.route.floor, false);
    }
    destroy(save = true, preserveShell = false) {
      if (this.destroyed) return;
      this.destroyed = true;
      if (save) this.saveState();
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.pageAbort?.abort();
      this.replyAborts.forEach((controller) => controller.abort());
      this.replyAborts.clear();
      this.readTracker?.disconnect();
      this.articleScroll.removeEventListener("scroll", this.scheduleSave);
      this.commentsPane.removeEventListener("scroll", this.scheduleSave);
      this.root.removeEventListener("click", this.handleClick);
      this.root.removeEventListener("pointerover", this.handleReactionPointerOver);
      this.root.removeEventListener("pointerout", this.handleReactionPointerOut);
      this.root.removeEventListener("focusin", this.handleReactionFocusIn);
      this.root.removeEventListener("focusout", this.handleReactionFocusOut);
      window.removeEventListener("popstate", this.handlePopState);
      window.removeEventListener("pagehide", this.handlePageHide);
      document.removeEventListener(TOPIC_EVENT_NAME, this.handleTopicEvent);
      this.root.remove();
      if (!preserveShell) {
        document.documentElement.classList.remove(ACTIVE_CLASS);
        document.getElementById(STYLE_ID)?.remove();
      }
    }
    persistState() {
      this.saveState();
    }
    updateHeaderOffset() {
      const header = document.querySelector(".d-header-wrap, .d-header");
      const height = Math.max(0, Math.round(header?.getBoundingClientRect().bottom || 0));
      this.root.style.setProperty("--ldtk-header-height", `${height || 60}px`);
    }
    matches(route, settings) {
      return this.route.topicId === route.topicId && this.settings.commentsPerPage === settings.commentsPerPage;
    }
    ensureStyle() {
      ensureLayoutStyle();
    }
    renderArticle() {
      const scrollTop = this.articleScroll.scrollTop;
      const header = createElement("header", "ldtk-article-header");
      const title = createElement("h1");
      title.innerHTML = this.source.topic.fancy_title || this.source.topic.title;
      const meta = createElement(
        "p",
        "",
        `${this.source.article.display_username || this.source.article.username} \xB7 ${formatDate(this.source.article.created_at)}`
      );
      header.append(title, meta);
      const content = createElement("article", "ldtk-article-content topic-post");
      content.dataset.postId = String(this.source.article.id);
      content.dataset.postNumber = "1";
      content.dataset.username = this.source.article.username;
      content.dataset.createdAt = this.source.article.created_at;
      const body = createElement("div", "topic-body");
      const cooked = createElement("div", "cooked");
      cooked.innerHTML = this.source.article.cooked;
      const footer = createElement("footer", "ldtk-article-footer");
      footer.setAttribute("aria-label", "\u6B63\u6587\u4FE1\u606F\u548C\u64CD\u4F5C");
      footer.appendChild(this.createPostControls(this.source.article));
      const boosts = this.createBoosts(this.source.article);
      if (boosts) footer.appendChild(boosts);
      const replySummary = this.createArticleReplySummary(this.source.article, this.articleReplies);
      if (replySummary) {
        footer.appendChild(replySummary);
        const repliesButton = footer.querySelector("[data-toggle-replies]");
        repliesButton?.setAttribute("aria-expanded", "true");
      }
      const summary = this.createTopicSummary();
      if (summary) footer.appendChild(summary);
      body.appendChild(cooked);
      content.appendChild(body);
      this.articleScroll.replaceChildren(header, content);
      this.articlePane.replaceChildren(this.articleScroll, footer);
      this.articleScroll.scrollTop = scrollTop;
    }
    renderCommentsShell() {
      const toolbar = createElement("header", "ldtk-comments-toolbar");
      const heading = createElement("h2", "", `\u8BC4\u8BBA ${this.source.commentCount}`);
      this.refreshButton.title = "\u4ECE\u670D\u52A1\u5668\u91CD\u65B0\u52A0\u8F7D\u4E3B\u9898\u548C\u8BC4\u8BBA";
      this.refreshButton.addEventListener("click", this.callbacks.requestRefresh);
      toolbar.append(heading, this.refreshButton);
      this.newRepliesButton.dataset.visible = "false";
      this.newRepliesButton.addEventListener("click", this.callbacks.requestRefresh);
      this.pagination.setAttribute("aria-label", "\u8BC4\u8BBA\u5206\u9875");
      this.commentsPane.append(
        toolbar,
        this.newRepliesButton,
        this.status,
        this.commentsList,
        this.pagination
      );
    }
    createPost(post) {
      const article = createElement("article", "topic-post ldtk-reading-post");
      article.dataset.postId = String(post.id);
      article.dataset.postNumber = String(post.post_number);
      article.dataset.username = post.username;
      article.dataset.createdAt = post.created_at;
      if (post.hidden) article.classList.add("is-hidden");
      const avatar = createElement("div", "topic-avatar");
      const avatarUrl = getAvatarUrl(post.avatar_template);
      if (avatarUrl) {
        const image = createElement("img");
        image.src = avatarUrl;
        image.alt = "";
        image.width = 42;
        image.height = 42;
        image.loading = "lazy";
        avatar.appendChild(image);
      }
      const body = createElement("div", "topic-body");
      const heading = createElement("header", "ldtk-post-heading");
      const names = createElement("span", "names");
      const username = createElement(
        "span",
        "username",
        post.display_username || post.name || post.username
      );
      names.appendChild(username);
      heading.appendChild(names);
      if (post.reply_to_post_number) {
        const replyTargetPost = this.source.getCachedPostByNumber(post.reply_to_post_number);
        const replyTargetUsername = replyTargetPost?.username.trim();
        const replyLabel = replyTargetUsername ? `\u56DE\u590D @${replyTargetUsername} \xB7 #${post.reply_to_post_number}` : `\u56DE\u590D #${post.reply_to_post_number}`;
        const replyTitle = replyTargetUsername ? `\u8DF3\u8F6C\u5230 @${replyTargetUsername} \u7684 ${post.reply_to_post_number} \u697C\u8BC4\u8BBA` : `\u8DF3\u8F6C\u5230 ${post.reply_to_post_number} \u697C`;
        const replyTarget = createButton("ldtk-reply-target", replyLabel, replyTitle);
        replyTarget.dataset.targetFloor = String(post.reply_to_post_number);
        heading.appendChild(replyTarget);
      }
      const time = createElement("a", "ldtk-post-meta");
      time.href = buildNativeFloorUrl(post.post_number);
      const timestamp = createElement(
        "time",
        "",
        `#${post.post_number} \xB7 ${formatDate(post.created_at)}`
      );
      timestamp.dateTime = post.created_at;
      time.appendChild(timestamp);
      heading.appendChild(time);
      const cooked = createElement("div", "cooked");
      if (post.deleted_at && !post.cooked.trim()) {
        cooked.classList.add("ldtk-deleted-placeholder");
        cooked.textContent = "\u6B64\u56DE\u590D\u5DF2\u5220\u9664";
      } else {
        cooked.innerHTML = post.cooked;
      }
      body.append(heading, cooked, this.createPostControls(post));
      const boosts = this.createBoosts(post);
      if (boosts) body.appendChild(boosts);
      article.append(avatar, body);
      return article;
    }
    createPostControls(post) {
      const controls = createElement("nav", "post-controls ldtk-post-controls");
      controls.setAttribute("aria-label", `${post.post_number} \u697C\u64CD\u4F5C`);
      const extraControls = createElement("div", "ldtk-post-extra-controls");
      const actions = createElement("div", "actions ldtk-post-actions");
      const like = post.actions_summary?.find((action) => action.id === 2);
      const likeCount = Math.max(0, post.reaction_users_count ?? like?.count ?? 0);
      const hasLiked = post.current_user_used_main_reaction ?? like?.acted === true;
      const currentReactionId = post.current_user_reaction?.id;
      const hasCustomReaction = Boolean(currentReactionId && !hasLiked);
      const hasReaction = hasLiked || Boolean(currentReactionId);
      const replyCount = Math.max(0, post.reply_count || 0);
      const addNativeAction = (container, action, icon, label, className, visibleLabel) => {
        const button = createPostMenuButton({ className, icon, label, visibleLabel });
        button.dataset.topicAction = action;
        button.dataset.postId = String(post.id);
        button.dataset.floor = String(post.post_number);
        container.appendChild(button);
        return button;
      };
      if (likeCount > 0) {
        const likeUsers = addNativeAction(
          extraControls,
          "likeUsers",
          "d-liked",
          `${likeCount} \u4E2A\u8D5E\uFF0C\u67E5\u770B\u70B9\u8D5E\u7528\u6237`,
          "post-action-menu__like-count like-count button-count highlight-action",
          String(likeCount)
        );
        likeUsers.setAttribute("aria-haspopup", "dialog");
        likeUsers.setAttribute("aria-expanded", "false");
      }
      if (replyCount > 0) {
        const replies = createPostMenuButton({
          className: "post-action-menu__show-replies show-replies btn-icon-text button-count",
          icon: "chevron-down",
          label: `\u5C55\u5F00 ${replyCount} \u4E2A\u56DE\u590D`,
          visibleLabel: `${replyCount} \u4E2A\u56DE\u590D`
        });
        replies.dataset.toggleReplies = String(post.id);
        replies.dataset.floor = String(post.post_number);
        replies.setAttribute("aria-expanded", "false");
        extraControls.appendChild(replies);
      }
      if (like && post.yours !== true) {
        const likeLabel = hasCustomReaction ? `\u53D6\u6D88 ${currentReactionId} \u8868\u6001` : hasLiked ? "\u53D6\u6D88\u8D5E" : "\u8D5E";
        const stateClass = hasLiked ? "has-like" : hasCustomReaction ? "has-reaction" : "like";
        const likeButton = addNativeAction(
          actions,
          "like",
          hasLiked ? "d-liked" : "d-unliked",
          likeLabel,
          `post-action-menu__like toggle-like btn-icon ${stateClass}`
        );
        if (hasCustomReaction && currentReactionId) {
          const reactionImage = this.createCurrentReactionImage(post, currentReactionId);
          if (reactionImage) likeButton.replaceChildren(reactionImage);
        }
        likeButton.setAttribute("aria-pressed", String(hasReaction));
        likeButton.setAttribute("aria-haspopup", "menu");
      }
      const copyLink = createPostMenuButton({
        className: "post-action-menu__copy-link btn-icon",
        icon: "link",
        label: "\u590D\u5236\u6B64\u697C\u94FE\u63A5"
      });
      copyLink.dataset.copyPostLink = String(post.post_number);
      actions.appendChild(copyLink);
      if (!post.deleted_at) {
        const bookmarkIcon = post.bookmark_reminder_at ? "discourse-bookmark-clock" : post.bookmarked ? "bookmark" : "far-bookmark";
        const bookmark = addNativeAction(
          actions,
          "bookmark",
          bookmarkIcon,
          post.bookmarked ? "\u7F16\u8F91\u4E66\u7B7E" : "\u6DFB\u52A0\u4E66\u7B7E",
          `post-action-menu__bookmark btn-icon ${post.bookmarked ? "bookmarked" : ""}`
        );
        bookmark.setAttribute("aria-haspopup", "menu");
        bookmark.setAttribute("aria-expanded", "false");
        bookmark.setAttribute("aria-pressed", String(post.bookmarked === true));
      }
      if (post.can_boost === true && (post.boosts?.length || 0) === 0) {
        const boost = addNativeAction(
          actions,
          "boost",
          "rocket",
          "\u52A9\u63A8",
          "post-action-menu__boost boost btn-flat"
        );
        boost.setAttribute("aria-haspopup", "menu");
        boost.setAttribute("aria-expanded", "false");
      }
      const moreActions = createElement("span", "ldtk-more-actions");
      moreActions.hidden = true;
      addNativeAction(
        moreActions,
        "share",
        "d-post-share",
        "\u5206\u4EAB",
        "post-action-menu__share btn-icon"
      );
      const canFlag = post.actions_summary?.some(
        (action) => action.id !== 2 && action.can_act === true
      );
      if (canFlag)
        addNativeAction(moreActions, "flag", "flag", "\u4E3E\u62A5", "post-action-menu__flag btn-icon");
      if (post.can_edit)
        addNativeAction(moreActions, "edit", "pencil", "\u7F16\u8F91", "post-action-menu__edit btn-icon");
      if (post.can_delete)
        addNativeAction(
          moreActions,
          "delete",
          "trash-can",
          "\u5220\u9664",
          "post-action-menu__delete btn-icon"
        );
      if (post.can_recover)
        addNativeAction(
          moreActions,
          "recover",
          "rotate-left",
          "\u6062\u590D",
          "post-action-menu__recover btn-icon"
        );
      actions.appendChild(moreActions);
      const showMore = createPostMenuButton({
        className: "post-action-menu__show-more show-more-actions btn-icon",
        icon: "ellipsis",
        label: "\u66F4\u591A"
      });
      showMore.dataset.showMore = "true";
      showMore.setAttribute("aria-expanded", "false");
      actions.appendChild(showMore);
      if (this.source.topic.details?.can_create_post !== false) {
        addNativeAction(
          actions,
          "reply",
          "reply",
          `\u56DE\u590D ${post.username}`,
          "post-action-menu__reply reply btn-icon-text",
          "\u56DE\u590D"
        );
      }
      controls.append(extraControls, actions);
      return controls;
    }
    createBoosts(post) {
      const boosts = post.boosts || [];
      if (boosts.length === 0) return null;
      const postMenu = createElement("div", "discourse-boosts__post-menu");
      const wrapper = createElement("div", "discourse-boosts");
      const list = createElement("div", "discourse-boosts__list");
      boosts.forEach((boost) => {
        const bubble = createElement("span", "discourse-boosts__bubble");
        const user = boost.user;
        const avatarUrl = getAvatarUrl(user?.avatar_template);
        if (user && avatarUrl) {
          const profile = createElement("a");
          profile.href = `/u/${encodeURIComponent(user.username)}`;
          profile.dataset.userCard = user.username;
          profile.title = user.name || user.username;
          profile.setAttribute("aria-label", user.name || user.username);
          const avatar = createElement("img", "avatar");
          avatar.src = avatarUrl;
          avatar.alt = "";
          avatar.width = 24;
          avatar.height = 24;
          avatar.loading = "lazy";
          profile.appendChild(avatar);
          bubble.appendChild(profile);
        }
        const cooked = createElement("span", "discourse-boosts__cooked");
        cooked.innerHTML = boost.cooked;
        bubble.appendChild(cooked);
        list.appendChild(bubble);
      });
      if (post.can_boost === true) {
        const addBoost = createPostMenuButton({
          className: "discourse-boosts__add-btn btn-flat",
          icon: "rocket",
          label: "\u52A9\u63A8"
        });
        addBoost.dataset.topicAction = "boost";
        addBoost.dataset.postId = String(post.id);
        addBoost.dataset.floor = String(post.post_number);
        addBoost.setAttribute("aria-haspopup", "menu");
        addBoost.setAttribute("aria-expanded", "false");
        list.appendChild(addBoost);
      }
      wrapper.appendChild(list);
      postMenu.appendChild(wrapper);
      return postMenu;
    }
    createReplySummaryContent(post) {
      const cooked = createElement("div");
      cooked.innerHTML = post.cooked;
      const content = createElement("span", "ldtk-article-reply-content");
      const textParts = [];
      const blockTags = /* @__PURE__ */ new Set(["P", "DIV", "LI", "BLOCKQUOTE", "PRE", "TR"]);
      const appendText = (value) => {
        content.appendChild(document.createTextNode(value));
        textParts.push(value);
      };
      const appendNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          appendText(node.textContent || "");
          return;
        }
        if (!(node instanceof HTMLElement)) return;
        if (node instanceof HTMLImageElement) {
          const alt = node.alt || node.title;
          const isEmoji = node.classList.contains("emoji") || /^:[^:]+:$/.test(alt);
          if (isEmoji && node.getAttribute("src")) {
            const emoji = createElement("img", "emoji");
            emoji.src = node.getAttribute("src") || "";
            emoji.alt = alt;
            emoji.title = node.title;
            emoji.width = 18;
            emoji.height = 18;
            emoji.loading = "lazy";
            content.appendChild(emoji);
            textParts.push(alt);
          } else if (alt) {
            appendText(alt);
          }
          return;
        }
        if (node instanceof HTMLBRElement) {
          appendText(" ");
          return;
        }
        Array.from(node.childNodes).forEach(appendNode);
        if (blockTags.has(node.tagName)) appendText(" ");
      };
      Array.from(cooked.childNodes).forEach(appendNode);
      const text = textParts.join("").replace(/\s+/g, " ").trim();
      if (content.childNodes.length === 0) appendText(`\u67E5\u770B ${post.post_number} \u697C\u56DE\u590D`);
      return { element: content, text: text || `\u67E5\u770B ${post.post_number} \u697C\u56DE\u590D` };
    }
    createArticleReplySummary(article, replies) {
      if (replies.length === 0) return null;
      const summary = createElement("div", "ldtk-article-reply-summary");
      summary.dataset.articleReplySummary = String(article.id);
      summary.setAttribute("aria-label", "\u6B63\u6587\u7684\u76F4\u63A5\u56DE\u590D");
      replies.slice(0, 8).forEach((reply) => {
        const replyContent = this.createReplySummaryContent(reply);
        const button = createButton(
          "ldtk-article-reply-chip",
          "",
          `\u8DF3\u8F6C\u5230 ${reply.username} \u7684 ${reply.post_number} \u697C\u56DE\u590D\uFF1A${replyContent.text}`
        );
        button.dataset.targetFloor = String(reply.post_number);
        const avatarUrl = getAvatarUrl(reply.avatar_template);
        if (avatarUrl) {
          const avatar = createElement("img", "ldtk-article-reply-avatar");
          avatar.src = avatarUrl;
          avatar.alt = "";
          avatar.loading = "lazy";
          button.appendChild(avatar);
        }
        button.appendChild(replyContent.element);
        summary.appendChild(button);
      });
      return summary;
    }
    createTopicSummary() {
      const topic = this.source.topic;
      const participants = topic.details?.participants || [];
      const linkCount = topic.details?.links?.length;
      const stats = [];
      if (typeof topic.views === "number") stats.push({ value: topic.views, label: "\u6D4F\u89C8\u91CF" });
      if (typeof topic.like_count === "number") stats.push({ value: topic.like_count, label: "\u8D5E" });
      if (typeof linkCount === "number") stats.push({ value: linkCount, label: "\u94FE\u63A5" });
      if (typeof topic.participant_count === "number") {
        stats.push({ value: topic.participant_count, label: "\u7528\u6237" });
      }
      const readMinutes = typeof topic.word_count === "number" && topic.word_count > 0 ? Math.max(1, Math.ceil(topic.word_count / 200)) : null;
      if (stats.length === 0 && participants.length === 0 && readMinutes === null) return null;
      const summary = createElement("section", "ldtk-topic-summary");
      summary.setAttribute("aria-label", "\u4E3B\u9898\u4FE1\u606F");
      stats.forEach((stat) => {
        const item = createElement("span", "ldtk-topic-stat");
        item.append(
          createElement("strong", "", formatCompactNumber(stat.value)),
          createElement("span", "", stat.label)
        );
        summary.appendChild(item);
      });
      if (participants.length > 0) {
        const people = createElement("span", "ldtk-topic-participants");
        people.setAttribute("aria-label", "\u4E3B\u8981\u53C2\u4E0E\u8005");
        participants.slice(0, 8).forEach((participant) => {
          const avatarUrl = getAvatarUrl(participant.avatar_template);
          if (!avatarUrl) return;
          const profile = createElement("a");
          profile.href = `/u/${encodeURIComponent(participant.username)}`;
          profile.title = participant.name || participant.username;
          profile.setAttribute("aria-label", participant.name || participant.username);
          const avatar = createElement("img");
          avatar.src = avatarUrl;
          avatar.alt = "";
          avatar.loading = "lazy";
          profile.appendChild(avatar);
          people.appendChild(profile);
        });
        if (people.childElementCount > 0) summary.appendChild(people);
      }
      if (readMinutes !== null) {
        const readTime = createElement("span", "ldtk-topic-stat ldtk-topic-read-time");
        readTime.append(
          createElement("strong", "", `${formatCompactNumber(readMinutes)} \u5206\u949F`),
          createElement("span", "", "\u9605\u8BFB\u65F6\u95F4")
        );
        summary.appendChild(readTime);
      }
      return summary;
    }
    createCurrentReactionImage(post, reactionId) {
      const nativePost = document.querySelector(
        `#main-outlet .topic-post[data-post-id="${post.id}"], #main-outlet .topic-post[data-post-number="${post.post_number}"]`
      );
      const nativeImage = nativePost?.querySelector(
        ".discourse-reactions-reaction-button .btn-toggle-reaction-emoji"
      );
      const expectedAlts = /* @__PURE__ */ new Set([`:${reactionId}`, `:${reactionId}:`]);
      let image = null;
      if (nativeImage && (!nativeImage.alt || expectedAlts.has(nativeImage.alt))) {
        image = nativeImage.cloneNode(false);
      } else {
        const cached = this.reactionImages.get(post.id);
        if (cached?.id === reactionId && cached.url) {
          image = document.createElement("img");
          image.src = cached.url;
        }
      }
      if (!image) return null;
      image.className = "btn-toggle-reaction-emoji reaction-button";
      image.alt = `:${reactionId}:`;
      image.setAttribute("aria-hidden", "true");
      image.draggable = false;
      image.removeAttribute("style");
      image.removeAttribute("width");
      image.removeAttribute("height");
      return image;
    }
    createInlineReply(post) {
      const reply = createElement("article", "ldtk-inline-reply");
      reply.dataset.postId = String(post.id);
      reply.dataset.postNumber = String(post.post_number);
      const avatar = createElement("div", "ldtk-inline-reply-avatar");
      const avatarUrl = getAvatarUrl(post.avatar_template);
      if (avatarUrl) {
        const image = createElement("img");
        image.src = avatarUrl;
        image.alt = "";
        image.width = 32;
        image.height = 32;
        image.loading = "lazy";
        avatar.appendChild(image);
      }
      const body = createElement("div", "ldtk-inline-reply-body");
      const heading = createElement("header", "ldtk-inline-reply-heading");
      heading.appendChild(
        createElement("strong", "", post.display_username || post.name || post.username)
      );
      const floor = createButton(
        "ldtk-inline-reply-floor",
        `#${post.post_number} \xB7 ${formatDate(post.created_at)}`,
        `\u8DF3\u8F6C\u5230 ${post.post_number} \u697C`
      );
      floor.dataset.targetFloor = String(post.post_number);
      heading.appendChild(floor);
      const cooked = createElement("div", "cooked");
      cooked.innerHTML = post.cooked;
      body.append(heading, cooked);
      reply.append(avatar, body);
      return reply;
    }
    appendInlineReplies(panel, parent, replies) {
      panel.querySelector(".ldtk-inline-replies-status")?.remove();
      panel.querySelector(".ldtk-load-more-replies")?.remove();
      const existing = new Set(
        Array.from(panel.querySelectorAll(".ldtk-inline-reply")).map(
          (element) => element.dataset.postId
        )
      );
      replies.forEach((reply) => {
        if (!existing.has(String(reply.id))) panel.appendChild(this.createInlineReply(reply));
      });
      const loadedCount = panel.querySelectorAll(".ldtk-inline-reply").length;
      panel.dataset.loadedCount = String(loadedCount);
      const lastReply = Array.from(panel.querySelectorAll(".ldtk-inline-reply")).at(-1);
      if (lastReply?.dataset.postNumber) panel.dataset.after = lastReply.dataset.postNumber;
      if (loadedCount < Math.max(0, parent.reply_count || 0) && replies.length > 0) {
        const more = createButton("ldtk-load-more-replies", "\u52A0\u8F7D\u66F4\u591A\u56DE\u590D");
        more.dataset.loadReplies = String(parent.id);
        panel.appendChild(more);
      }
    }
    async loadInlineReplies(button, append) {
      const postId = Number(button.dataset.toggleReplies || button.dataset.loadReplies);
      const post = this.source.getCachedPost(postId);
      const postElement = this.root.querySelector(`[data-post-id="${postId}"]`);
      const controls = postElement?.querySelector(".ldtk-post-controls");
      if (!post || !postElement || !controls) return;
      let panel = postElement.querySelector(".ldtk-inline-replies");
      if (!panel) {
        panel = createElement("section", "ldtk-inline-replies");
        panel.setAttribute("aria-label", `${post.post_number} \u697C\u7684\u56DE\u590D`);
        panel.setAttribute("aria-live", "polite");
        controls.insertAdjacentElement("afterend", panel);
      }
      if (!append)
        panel.replaceChildren(createElement("p", "ldtk-inline-replies-status", "\u6B63\u5728\u52A0\u8F7D\u56DE\u590D..."));
      else {
        button.disabled = true;
        button.textContent = "\u6B63\u5728\u52A0\u8F7D...";
      }
      this.replyAborts.get(postId)?.abort();
      const request = new AbortController();
      this.replyAborts.set(postId, request);
      try {
        const after = append ? Number(panel.dataset.after) || 1 : 1;
        const replies = await fetchPostReplies(postId, after, request.signal);
        if (this.destroyed || request.signal.aborted) return;
        this.appendInlineReplies(panel, post, replies);
        if (!append && replies.length === 0) {
          panel.appendChild(createElement("p", "ldtk-inline-replies-status", "\u6682\u65E0\u53EF\u89C1\u56DE\u590D"));
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        panel.replaceChildren(
          createElement("p", "ldtk-inline-replies-status", "\u56DE\u590D\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5")
        );
      } finally {
        if (this.replyAborts.get(postId) === request) this.replyAborts.delete(postId);
        button.disabled = false;
      }
    }
    async loadArticleReplySummary(button) {
      const postId = Number(button.dataset.toggleReplies);
      if (postId !== this.source.article.id) return;
      this.replyAborts.get(postId)?.abort();
      const request = new AbortController();
      this.replyAborts.set(postId, request);
      button.disabled = true;
      try {
        const replies = await fetchPostReplies(postId, 1, request.signal);
        if (this.destroyed || request.signal.aborted) return;
        this.articleReplies = replies;
        const summary = this.createArticleReplySummary(this.source.article, replies);
        if (!summary) {
          showToast("\u6682\u65E0\u53EF\u89C1\u56DE\u590D");
          return;
        }
        button.closest(".ldtk-post-controls")?.insertAdjacentElement("afterend", summary);
        button.setAttribute("aria-expanded", "true");
        button.setAttribute("aria-label", "\u6536\u8D77\u56DE\u590D");
        setButtonIcon(button, "chevron-up");
      } catch (error) {
        if (error.name !== "AbortError") showToast("\u56DE\u590D\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
      } finally {
        if (this.replyAborts.get(postId) === request) this.replyAborts.delete(postId);
        button.disabled = false;
      }
    }
    toggleInlineReplies(button) {
      const postId = Number(button.dataset.toggleReplies);
      if (postId === this.source.article.id) {
        const summary = this.root.querySelector(
          `[data-article-reply-summary="${postId}"]`
        );
        if (!summary) {
          void this.loadArticleReplySummary(button);
          return;
        }
        summary.hidden = !summary.hidden;
        const expanded2 = !summary.hidden;
        button.setAttribute("aria-expanded", String(expanded2));
        button.setAttribute("aria-label", `${expanded2 ? "\u6536\u8D77" : "\u5C55\u5F00"}\u56DE\u590D`);
        setButtonIcon(button, expanded2 ? "chevron-up" : "chevron-down");
        return;
      }
      const postElement = this.root.querySelector(`[data-post-id="${postId}"]`);
      const panel = postElement?.querySelector(".ldtk-inline-replies");
      if (!panel) {
        button.setAttribute("aria-expanded", "true");
        setButtonIcon(button, "chevron-up");
        void this.loadInlineReplies(button, false);
        return;
      }
      panel.hidden = !panel.hidden;
      const expanded = !panel.hidden;
      button.setAttribute("aria-expanded", String(expanded));
      button.setAttribute("aria-label", `${expanded ? "\u6536\u8D77" : "\u5C55\u5F00"}\u56DE\u590D`);
      setButtonIcon(button, expanded ? "chevron-up" : "chevron-down");
    }
    requestPageAction(button) {
      const action = button.dataset.topicAction;
      const postId = Number(button.dataset.postId);
      const floor = Number(button.dataset.floor);
      if (!action || !postId || !floor) return;
      const request = {
        requestId: `${Date.now()}:${++actionRequestSequence}`,
        topicId: this.source.topic.id,
        postId,
        floor,
        action,
        routeUrl: this.buildActionRoute(floor)
      };
      const waitsForMenuClose = action === "bookmark" || action === "boost" || action === "likeUsers";
      let triggered = false;
      const finish = () => {
        window.clearTimeout(timeout);
        button.disabled = false;
        button.removeAttribute("aria-busy");
        button.removeEventListener(TOPIC_ACTION_RESULT_NAME, handleResult);
      };
      const handleResult = (event) => {
        if (!(event instanceof CustomEvent)) return;
        const result = parseTopicActionResult(event.detail);
        if (!result || result.requestId !== request.requestId) return;
        if (!result.ok) {
          finish();
          showToast(result.message || "\u64CD\u4F5C\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5");
          return;
        }
        triggered = true;
        button.disabled = false;
        button.removeAttribute("aria-busy");
        if (waitsForMenuClose) {
          button.setAttribute("aria-expanded", String(result.phase === "triggered"));
        }
        if (action === "like" && result.phase === "triggered") {
          finish();
          window.setTimeout(
            () => void this.updateVisiblePost({ topicId: request.topicId, postId, type: "revised" }),
            700
          );
        } else if (action === "bookmark" && result.phase === "settled") {
          finish();
          void this.updateVisiblePost({ topicId: request.topicId, postId, type: "revised" });
        } else if (action === "boost" && result.phase === "settled") {
          finish();
          void this.updateVisiblePost({ topicId: request.topicId, postId, type: "revised" });
        } else if (action === "likeUsers" && result.phase === "settled") {
          finish();
        } else if (!waitsForMenuClose) {
          finish();
        }
      };
      const timeout = window.setTimeout(
        () => {
          finish();
          if (!triggered) showToast("\u539F\u7AD9\u64CD\u4F5C\u54CD\u5E94\u8D85\u65F6\uFF0C\u8BF7\u91CD\u8BD5");
        },
        waitsForMenuClose ? 12e4 : 1e4
      );
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      if (action === "like") {
        button.classList.add("heart-animation");
        window.setTimeout(() => button.classList.remove("heart-animation"), 450);
      }
      button.addEventListener(TOPIC_ACTION_RESULT_NAME, handleResult);
      button.dispatchEvent(
        new CustomEvent(TOPIC_ACTION_REQUEST_NAME, {
          bubbles: true,
          detail: JSON.stringify(request)
        })
      );
    }
    requestReactionPicker(button, open) {
      const postId = Number(button.dataset.postId);
      const floor = Number(button.dataset.floor);
      if (!postId || !floor) return;
      const request = {
        topicId: this.source.topic.id,
        postId,
        floor,
        open,
        routeUrl: this.buildActionRoute(floor)
      };
      button.dispatchEvent(
        new CustomEvent(TOPIC_REACTION_PICKER_REQUEST_NAME, {
          bubbles: true,
          detail: JSON.stringify(request)
        })
      );
    }
    getReactionButton(target) {
      if (!(target instanceof Element)) return null;
      const button = target.closest(
        '.post-action-menu__like[data-topic-action="like"]'
      );
      return button && this.root.contains(button) ? button : null;
    }
    isWithinButton(button, target) {
      return target instanceof Node && button.contains(target);
    }
    handleReactionPointerOver = (event) => {
      const pointerEvent = event;
      if (pointerEvent.pointerType !== "mouse") return;
      const button = this.getReactionButton(event.target);
      if (!button || this.isWithinButton(button, pointerEvent.relatedTarget)) return;
      this.requestReactionPicker(button, true);
    };
    handleReactionPointerOut = (event) => {
      const pointerEvent = event;
      if (pointerEvent.pointerType !== "mouse") return;
      const button = this.getReactionButton(event.target);
      if (!button || this.isWithinButton(button, pointerEvent.relatedTarget)) return;
      this.requestReactionPicker(button, false);
    };
    handleReactionFocusIn = (event) => {
      const button = this.getReactionButton(event.target);
      if (button) this.requestReactionPicker(button, true);
    };
    handleReactionFocusOut = (event) => {
      const focusEvent = event;
      const button = this.getReactionButton(event.target);
      if (!button || this.isWithinButton(button, focusEvent.relatedTarget)) return;
      this.requestReactionPicker(button, false);
    };
    buildActionRoute(floor) {
      const url = new URL(buildNativeFloorUrl(floor));
      url.searchParams.set(COMMENTS_PAGE_PARAM, String(this.currentPage));
      return url.href;
    }
    renderComments(posts) {
      this.replyAborts.forEach((controller) => controller.abort());
      this.replyAborts.clear();
      this.status.hidden = true;
      if (posts.length === 0) {
        this.status.hidden = false;
        this.status.textContent = this.source.commentCount === 0 ? "\u6682\u65E0\u8BC4\u8BBA" : "\u672C\u9875\u8BC4\u8BBA\u4E0D\u53EF\u89C1";
        this.commentsList.replaceChildren();
      } else {
        const fragment = document.createDocumentFragment();
        posts.forEach((post) => fragment.appendChild(this.createPost(post)));
        this.commentsList.replaceChildren(fragment);
      }
      this.renderPagination();
      this.readTracker?.disconnect();
      this.readTracker = new TopicReadTracker(this.source.topic.id, this.commentsPane);
      this.readTracker.observe(
        Array.from(this.commentsList.querySelectorAll(".topic-post"))
      );
      injectButtons(this.settings);
    }
    renderPagination() {
      const fragment = document.createDocumentFragment();
      const previous = createButton("", "\u4E0A\u4E00\u9875");
      previous.disabled = this.currentPage <= 1;
      previous.dataset.page = String(this.currentPage - 1);
      fragment.appendChild(previous);
      buildPaginationItems(this.currentPage, this.pageCount).forEach((item) => {
        if (item === "ellipsis") {
          fragment.appendChild(createElement("span", "ldtk-pagination-ellipsis", "..."));
          return;
        }
        const page = createButton("", String(item), `\u7B2C ${item} \u9875`);
        page.dataset.page = String(item);
        if (item === this.currentPage) page.setAttribute("aria-current", "page");
        fragment.appendChild(page);
      });
      const next = createButton("", "\u4E0B\u4E00\u9875");
      next.disabled = this.currentPage >= this.pageCount;
      next.dataset.page = String(this.currentPage + 1);
      fragment.appendChild(next);
      this.pagination.replaceChildren(fragment);
    }
    async loadPage(page, updateHistory, targetFloor) {
      const nextPage = clampPage(page, this.pageCount);
      if (nextPage === this.currentPage && targetFloor === void 0) return;
      this.pageAbort?.abort();
      const request = new AbortController();
      this.pageAbort = request;
      this.readTracker?.flush();
      this.status.hidden = false;
      this.status.textContent = "\u6B63\u5728\u52A0\u8F7D\u8BC4\u8BBA...";
      this.refreshButton.disabled = true;
      Array.from(this.pagination.querySelectorAll("button")).forEach((button) => {
        button.disabled = true;
      });
      try {
        const posts = await this.source.loadPage(
          nextPage,
          this.settings.commentsPerPage,
          request.signal
        );
        if (this.destroyed || request.signal.aborted || this.pageAbort !== request) return;
        this.currentPage = nextPage;
        this.renderComments(posts);
        this.commentsPane.scrollTop = 0;
        this.saveState();
        if (updateHistory) {
          const url = updatePageUrl(new URL(window.location.href), nextPage);
          window.history.pushState(window.history.state, "", url);
        }
        if (targetFloor) this.highlightFloor(targetFloor);
      } catch (error) {
        if (error.name === "AbortError" || this.pageAbort !== request) return;
        this.status.hidden = false;
        this.status.textContent = "\u8BC4\u8BBA\u52A0\u8F7D\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5";
        this.renderPagination();
      } finally {
        if (this.pageAbort === request) this.refreshButton.disabled = false;
      }
    }
    async goToFloor(floor, updateHistory) {
      if (floor <= 1) {
        this.articleScroll.scrollTo({ top: 0, behavior: "smooth" });
        const article = this.articlePane.querySelector(".topic-post");
        if (article) addHighlight(article);
        return;
      }
      const page = getCommentPageForFloor(floor, this.settings.commentsPerPage);
      if (page === this.currentPage) this.highlightFloor(floor);
      else await this.loadPage(page, updateHistory, floor);
    }
    highlightFloor(floor) {
      const post = this.commentsList.querySelector(`[data-post-number="${floor}"]`);
      post?.scrollIntoView({ block: "center", behavior: "smooth" });
      if (post) addHighlight(post);
    }
    handleClick = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const pageButton = target.closest("[data-page]");
      if (pageButton && this.pagination.contains(pageButton)) {
        event.preventDefault();
        void this.loadPage(Number(pageButton.dataset.page), true);
        return;
      }
      const repliesButton = target.closest("[data-toggle-replies]");
      if (repliesButton) {
        event.preventDefault();
        this.toggleInlineReplies(repliesButton);
        return;
      }
      const loadRepliesButton = target.closest("[data-load-replies]");
      if (loadRepliesButton) {
        event.preventDefault();
        void this.loadInlineReplies(loadRepliesButton, true);
        return;
      }
      const showMoreButton = target.closest("[data-show-more]");
      if (showMoreButton) {
        event.preventDefault();
        const actions = showMoreButton.closest(".ldtk-post-actions");
        const moreActions = actions?.querySelector(".ldtk-more-actions");
        if (moreActions) {
          moreActions.hidden = false;
          showMoreButton.hidden = true;
          showMoreButton.setAttribute("aria-expanded", "true");
        }
        return;
      }
      const copyLinkButton = target.closest("[data-copy-post-link]");
      if (copyLinkButton) {
        event.preventDefault();
        const floor2 = Number(copyLinkButton.dataset.copyPostLink);
        copyLinkButton.disabled = true;
        void copyToClipboard(buildNativeFloorUrl(floor2)).then(() => showToast("\u5DF2\u590D\u5236\u6B64\u697C\u94FE\u63A5")).catch(() => showToast("\u590D\u5236\u94FE\u63A5\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5")).finally(() => {
          copyLinkButton.disabled = false;
        });
        return;
      }
      const actionButton = target.closest("[data-topic-action][data-floor]");
      if (actionButton) {
        event.preventDefault();
        this.requestPageAction(actionButton);
        return;
      }
      const targetButton = target.closest("[data-target-floor]");
      if (targetButton) {
        event.preventDefault();
        void this.goToFloor(Number(targetButton.dataset.targetFloor), true);
        return;
      }
      const complexEmbed = target.closest(".poll, [data-poll-name], iframe, .lazyYT-container");
      if (complexEmbed) {
        const post = target.closest("[data-post-number]");
        if (post) {
          event.preventDefault();
          this.callbacks.handoffNative(Number(post.dataset.postNumber));
        }
        return;
      }
      const anchor = target.closest("a[href]");
      if (!anchor) return;
      const url = new URL(anchor.href, window.location.href);
      const route = parseTopicRoute(url.pathname);
      const hashFloor = url.hash.match(/^#post[_-](\d+)$/)?.[1];
      const floor = route?.floor || (hashFloor ? Number(hashFloor) : void 0);
      if (route?.topicId === this.route.topicId && floor) {
        event.preventDefault();
        void this.goToFloor(floor, true);
      }
    };
    handlePopState = () => {
      const route = parseTopicRoute(window.location.pathname);
      if (route?.topicId !== this.route.topicId) return;
      const urlPage = Number(new URL(window.location.href).searchParams.get(COMMENTS_PAGE_PARAM));
      const page = urlPage > 0 ? urlPage : route.floor ? getCommentPageForFloor(route.floor, this.settings.commentsPerPage) : 1;
      void this.loadPage(page, false);
    };
    handlePageHide = () => {
      this.saveState();
      this.readTracker?.flush(true);
    };
    handleTopicEvent = (event) => {
      const detail = parseTopicEventDetail(event.detail);
      if (!detail || detail.topicId !== this.source.topic.id) return;
      if (detail.type === "created") {
        this.newReplyCount += 1;
        this.newRepliesButton.textContent = `\u6709 ${this.newReplyCount} \u6761\u65B0\u56DE\u590D\uFF0C\u70B9\u51FB\u5237\u65B0`;
        this.newRepliesButton.dataset.visible = "true";
        return;
      }
      if (detail.type === "acted" && detail.currentReactionId !== void 0) {
        if (detail.currentReactionId) {
          this.reactionImages.set(detail.postId, {
            id: detail.currentReactionId,
            ...detail.currentReactionUrl ? { url: detail.currentReactionUrl } : {}
          });
        } else {
          this.reactionImages.delete(detail.postId);
        }
      }
      void this.updateVisiblePost(detail);
    };
    async updateVisiblePost(detail) {
      const eventVersion = (this.eventVersions.get(detail.postId) || 0) + 1;
      this.eventVersions.set(detail.postId, eventVersion);
      const current = this.root.querySelector(`[data-post-id="${detail.postId}"]`);
      if (!current) {
        this.source.invalidatePost(detail.postId);
        return;
      }
      if (detail.type === "destroyed") {
        const placeholder = createElement(
          "article",
          "topic-post ldtk-reading-post ldtk-destroyed-post"
        );
        placeholder.dataset.postId = String(detail.postId);
        placeholder.dataset.postNumber = current.dataset.postNumber || "";
        placeholder.appendChild(createElement("p", "ldtk-deleted-placeholder", "\u6B64\u56DE\u590D\u5DF2\u88AB\u5220\u9664"));
        current.replaceWith(placeholder);
        this.source.invalidatePost(detail.postId);
        return;
      }
      try {
        const post = await this.source.refreshPost(detail.postId);
        if (!post || this.destroyed || this.eventVersions.get(detail.postId) !== eventVersion) {
          return;
        }
        const replacement = post.post_number === 1 ? null : this.createPost(post);
        if (replacement) {
          current.replaceWith(replacement);
          injectButtons(this.settings);
        } else {
          this.renderArticle();
          injectButtons(this.settings);
        }
      } catch {
      }
    }
    scheduleSave = () => {
      if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.saveState(), 150);
    };
    saveState() {
      writeTopicState(this.route.topicId, {
        page: this.currentPage,
        leftScrollTop: this.articleScroll.scrollTop,
        rightScrollTop: this.commentsPane.scrollTop,
        nativeMode: false
      });
    }
  };
  var activeLayout = null;
  var loadingKey = null;
  var loadingAbort = null;
  var refreshVersion = 0;
  var latestSettings = null;
  function cleanupLayout() {
    refreshVersion += 1;
    loadingAbort?.abort();
    loadingAbort = null;
    loadingKey = null;
    activeLayout?.destroy();
    activeLayout = null;
    document.documentElement.classList.remove(ACTIVE_CLASS);
    document.querySelector(`.${ROOT_CLASS}`)?.remove();
    document.getElementById(STYLE_ID)?.remove();
    clearPendingTopicLayout();
  }
  function handoffToNative(route, settings, floor, action) {
    const previous = readTopicState(route.topicId) || {
      page: getCommentPageForFloor(floor, settings.commentsPerPage),
      leftScrollTop: 0,
      rightScrollTop: 0
    };
    activeLayout?.destroy();
    activeLayout = null;
    const state = {
      ...previous,
      nativeMode: true,
      pendingAction: action ? { floor, action } : void 0
    };
    writeTopicState(route.topicId, state);
    nativeAttemptKey = null;
    ensureNativeMode({ route, settings, state });
    const post = getNativePost(floor);
    if (post && !action) {
      post.scrollIntoView({ block: "center" });
      addHighlight(post);
    } else if (!post && route.floor !== floor) {
      window.location.assign(buildNativeFloorUrl(floor));
    }
  }
  async function refreshTopicLayout(settings, force = false) {
    latestSettings = settings;
    const route = parseTopicRoute(window.location.pathname);
    if (!settings.enableSplitReading || window.innerWidth < MIN_VIEWPORT_WIDTH || !route) {
      cleanupLayout();
      removeReturnButton();
      nativeAttemptKey = null;
      return;
    }
    const state = readTopicState(route.topicId);
    if (state?.nativeMode && !force) {
      cleanupLayout();
      ensureNativeMode({ route, settings, state });
      return;
    }
    if (force && state?.nativeMode) {
      writeTopicState(route.topicId, { ...state, nativeMode: false, pendingAction: void 0 });
    }
    const key = `${route.topicId}:${settings.commentsPerPage}`;
    if (!force && activeLayout?.matches(route, settings)) {
      activeLayout.updateHeaderOffset();
      return;
    }
    if (!force && loadingKey === key) return;
    const retainedLayout = force && activeLayout?.matches(route, settings) ? activeLayout : null;
    if (!retainedLayout) {
      prepareTopicLayout(settings);
      activeLayout?.destroy();
      activeLayout = null;
    }
    loadingAbort?.abort();
    const version = ++refreshVersion;
    loadingKey = key;
    const request = new AbortController();
    loadingAbort = request;
    let candidate = null;
    try {
      const source = await TopicDataSource.create(route.topicId, request.signal, route.floor);
      if (version !== refreshVersion) return;
      if (source.isMegaTopic) {
        if (retainedLayout) {
          showToast("\u4E3B\u9898\u5185\u5BB9\u8FC7\u591A\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u53CC\u680F\u5185\u5BB9");
        } else {
          cleanupLayout();
        }
        return;
      }
      const pageCount = getPageCount(source.commentCount, settings.commentsPerPage);
      const session = readTopicState(route.topicId);
      const initialPage = deriveInitialPage({
        url: new URL(window.location.href),
        routeFloor: route.floor,
        sessionPage: session?.page,
        lastReadPostNumber: source.topic.last_read_post_number,
        perPage: settings.commentsPerPage,
        pageCount
      });
      const articleRepliesRequest = (source.article.reply_count || 0) > 0 ? fetchPostReplies(source.article.id, 1, request.signal).catch((error) => {
        if (error.name === "AbortError") throw error;
        return [];
      }) : Promise.resolve([]);
      const [posts, articleReplies] = await Promise.all([
        source.loadPage(initialPage, settings.commentsPerPage, request.signal),
        articleRepliesRequest
      ]);
      if (version !== refreshVersion) return;
      retainedLayout?.persistState();
      candidate = new TopicLayout(route, source, settings, initialPage, {
        requestRefresh: () => {
          const currentSettings = latestSettings;
          if (currentSettings) void refreshTopicLayout(currentSettings, true);
        },
        handoffNative: (floor, action) => handoffToNative(route, settings, floor, action)
      });
      candidate.mount(posts, articleReplies);
      if (version !== refreshVersion) {
        candidate.destroy(false, Boolean(retainedLayout));
        return;
      }
      retainedLayout?.destroy(false, true);
      activeLayout = candidate;
      candidate = null;
    } catch (error) {
      candidate?.destroy(false, Boolean(retainedLayout));
      if (error.name === "AbortError") return;
      if (retainedLayout && activeLayout === retainedLayout) {
        console.warn("[Linux.do \u5DE5\u5177\u7BB1] \u53CC\u680F\u9605\u8BFB\u5237\u65B0\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u53CC\u680F\u5185\u5BB9", error);
        showToast("\u5237\u65B0\u5931\u8D25\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u53CC\u680F\u5185\u5BB9");
      } else {
        console.warn("[Linux.do \u5DE5\u5177\u7BB1] \u53CC\u680F\u9605\u8BFB\u52A0\u8F7D\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u539F\u9875\u9762", error);
        cleanupLayout();
      }
    } finally {
      if (version === refreshVersion) {
        loadingKey = null;
        loadingAbort = null;
      }
    }
  }
  var topicLayoutOwnedSelectors = [
    `.${ROOT_CLASS}`,
    `#${STYLE_ID}`,
    `#${PENDING_STYLE_ID}`,
    `#${RETURN_BUTTON_ID}`
  ];

  // src/content/index.ts
  var selectionToolsEnhancement = {
    refresh: injectBase64Button,
    ownedSelectors: [".ldcopy-base64-btn", ".ldcopy-strip-chinese-btn"]
  };
  var enhancements = [
    {
      refresh: refreshTopicLayout,
      ownedSelectors: topicLayoutOwnedSelectors
    },
    {
      refresh: injectButtons,
      ownedSelectors: [".ldtk-shadow-host"]
    },
    selectionToolsEnhancement
  ];
  var toolkitSelector = [
    "#ldcopy-toast-host",
    ...enhancements.flatMap((enhancement) => enhancement.ownedSelectors)
  ].join(", ");
  async function runEnhancements(items) {
    const settings = await getCachedSettings();
    await Promise.allSettled(
      items.map(({ refresh }) => Promise.resolve().then(() => refresh(settings)))
    );
  }
  var enhancementScheduler = new RefreshScheduler(() => runEnhancements(enhancements), 150);
  var selectionToolsScheduler = new RefreshScheduler(
    () => runEnhancements([selectionToolsEnhancement]),
    100
  );
  function isToolkitMutation(mutation) {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
    if (changedNodes.length === 0) return false;
    return changedNodes.every((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches(toolkitSelector) || Boolean(node.closest(toolkitSelector));
    });
  }
  function bindDynamicPageEvents() {
    document.addEventListener("selectionchange", () => {
      selectionToolsScheduler.schedule();
    });
    const target = document.body;
    const managedObserver = new ManagedObserver(
      target,
      {
        childList: true,
        subtree: true
      },
      (mutations) => {
        if (!mutations.every(isToolkitMutation)) enhancementScheduler.schedule();
      }
    );
    managedObserver.start();
    const handleNavigation = () => {
      enhancementScheduler.schedule(0);
    };
    window.addEventListener("discourse-navigate-completed", handleNavigation);
    window.addEventListener("page:change", handleNavigation);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) handleNavigation();
    });
    window.addEventListener("resize", handleNavigation, { passive: true });
  }
  function init() {
    registerMessageHandlers();
    bindDynamicPageEvents();
    onSettingsChanged(() => {
      void enhancementScheduler.run();
    });
    void enhancementScheduler.run();
  }
  function waitForDomReady() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  }
  async function bootstrap() {
    prepareTopicLayout();
    const settings = await getCachedSettings();
    prepareTopicLayout(settings);
    await waitForDomReady();
    init();
  }
  void bootstrap();
})();
//# sourceMappingURL=content.js.map
