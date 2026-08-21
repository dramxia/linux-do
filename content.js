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
    const match = window.location.pathname.match(/\/t\/[^/]+\/(\d+)/);
    return match ? match[1] : null;
  }
  function getPostElements() {
    return Array.from(document.querySelectorAll(".topic-post")).filter(
      (el) => isHTMLElement(el)
    );
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
    enablePostActions: true,
    enableBase64Decode: true,
    includeMetadata: true,
    replaceUploadUrls: true
  });
  var SETTING_KEYS = Object.freeze([
    "enablePostActions",
    "enableBase64Decode",
    "includeMetadata",
    "replaceUploadUrls"
  ]);
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
  var COPY_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';
  var DOWNLOAD_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>';
  var SHADOW_HOST_CLASS = "ldtk-shadow-host";
  var BUTTON_SHADOW_STYLE = `
:host {
  all: initial;
  display: inline-block;
}
.ldcopy-actions {
  display: inline-flex;
  gap: 4px;
  margin-left: 8px;
  vertical-align: middle;
}
.ldcopy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--primary-low-mid, #ccc);
  border-radius: 4px;
  background: var(--secondary, #f5f5f5);
  color: var(--primary, #333);
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s ease;
  line-height: 1.2;
  white-space: nowrap;
}
.ldcopy-btn:hover {
  background: var(--highlight-bg, #e8e8e8);
  border-color: var(--primary-medium, #999);
}
.ldcopy-btn:active {
  transform: scale(0.96);
}
.ldcopy-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.ldcopy-btn svg {
  flex-shrink: 0;
  opacity: 0.8;
}
:host-context(html.dark) .ldcopy-btn,
:host-context(body.dark) .ldcopy-btn {
  background: #2a2a3e;
  border-color: #444;
  color: #ddd;
}
:host-context(html.dark) .ldcopy-btn:hover,
:host-context(body.dark) .ldcopy-btn:hover {
  background: #3a3a5e;
  border-color: #666;
}
@media (max-width: 768px) {
  .ldcopy-btn span {
    display: none;
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
    button.innerHTML = `${options.icon} <span>${options.label}</span>`;
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
        label: "\u590D\u5236",
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
        label: "\u4E0B\u8F7D",
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
  function injectButtons(settings) {
    if (!settings.enablePostActions) {
      removeInjectedActions();
      return;
    }
    getPostElements().forEach((postEl) => {
      if (postEl.querySelector(`.${SHADOW_HOST_CLASS}`)) return;
      const actionsEl = postEl.querySelector(".post-controls, .actions");
      if (!actionsEl) return;
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

  // src/content/index.ts
  var selectionToolsEnhancement = {
    refresh: injectBase64Button,
    ownedSelectors: [".ldcopy-base64-btn", ".ldcopy-strip-chinese-btn"]
  };
  var enhancements = [
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
    await Promise.all([getCachedSettings(), waitForDomReady()]);
    init();
  }
  void bootstrap();
})();
//# sourceMappingURL=content.js.map
