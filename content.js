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
            const waitMs = Math.max(err.retryAfterMs, exponentialMs);
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
    return Array.from(document.querySelectorAll("[data-post-id].topic-post, .topic-post")).filter(
      (el) => isHTMLElement(el)
    );
  }
  function getPostElements() {
    return getAllPostElements();
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
  var cachedSettings = null;
  async function getCachedSettings() {
    if (cachedSettings) return cachedSettings;
    cachedSettings = await getSettings();
    return cachedSettings;
  }
  function onSettingsChanged(callback) {
    if (!hasChromeStorage() || !chrome.storage?.onChanged) return;
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "sync") return;
      const changedKeys = Object.keys(changes);
      const settingsKeys = Object.keys(DEFAULT_SETTINGS);
      if (!changedKeys.some((key) => settingsKeys.includes(key))) return;
      cachedSettings = null;
      getSettings().then((settings) => {
        cachedSettings = settings;
        callback(settings);
      }).catch(() => callback(normalizeSettings()));
    });
  }

  // src/content/layout/dom-queries.ts
  var BODY_CLASS = "ldtk-topic-split-active";
  var PREPARING_ROOT_CLASS = "ldtk-topic-split-preparing";
  var SIDEBAR_GUARD_CLASS = "ldtk-topic-sidebar-collapsing";
  var WRAPPER_CLASS = "ldtk-topic-split-wrapper";
  var ARTICLE_PANE_CLASS = "ldtk-topic-article-pane";
  var COMMENTS_STREAM_CLASS = "ldtk-topic-comments-stream";
  var HEADER_TITLE_CLASS = "ldtk-topic-header-title";
  var HEADER_TITLE_INNER_CLASS = "ldtk-topic-header-title-inner";
  var ARTICLE_ACTIONS_CLASS = "ldtk-topic-article-actions";
  var FOOTER_ACTIONS_SOURCE_ATTR = "data-ldtk-footer-actions-source";
  var FOOTER_ACTIONS_TOPIC_ATTR = "data-ldtk-footer-actions-topic";
  var FOOTER_ACTIONS_PLACEHOLDER_ATTR = "data-ldtk-footer-actions-placeholder";
  var FOOTER_ACTIONS_SELECTORS = "#topic-footer-buttons, .topic-footer-main-buttons";
  var NATIVE_STREAM_CLASS = "ldtk-topic-native-stream";
  var ORIGINAL_MAIN_POST_CLASS = "ldtk-topic-original-main-post";

  // src/content/layout/header-title-cloner.ts
  var pendingTimers = /* @__PURE__ */ new Set();
  function getHeaderTitleMount() {
    return document.querySelector(".d-header .contents") || document.querySelector("header.d-header .contents") || document.querySelector(".d-header");
  }
  function stripHeaderCloneUnsafeNodes(clone) {
    clone.querySelectorAll(
      ["script", "style", ".edit-topic", ".topic-statuses", ".topic-notifications-button"].join(
        ","
      )
    ).forEach((el) => el.remove());
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
  }
  function syncSplitHeaderTitle() {
    if (!document.body?.classList.contains(BODY_CLASS)) return;
    const source = document.querySelector("#topic-title");
    const mount = getHeaderTitleMount();
    if (!source || !mount) return;
    let headerTitle = mount.querySelector(`:scope > .${HEADER_TITLE_CLASS}`);
    if (!headerTitle) {
      headerTitle = document.createElement("div");
      headerTitle.className = HEADER_TITLE_CLASS;
      const logoArea = mount.querySelector(
        ":scope > .title, :scope > .home-logo-wrapper, :scope > .brand-header"
      );
      if (logoArea) logoArea.insertAdjacentElement("afterend", headerTitle);
      else mount.insertBefore(headerTitle, mount.children[1] || null);
    }
    const clone = source.cloneNode(true);
    clone.className = HEADER_TITLE_INNER_CLASS;
    stripHeaderCloneUnsafeNodes(clone);
    headerTitle.replaceChildren(clone);
  }
  function clearPendingTimers() {
    pendingTimers.forEach((timer) => clearTimeout(timer));
    pendingTimers.clear();
  }
  function scheduleSplitHeaderSync() {
    clearPendingTimers();
    syncSplitHeaderTitle();
    [250, 1e3].forEach((delay) => {
      const timer = setTimeout(() => {
        pendingTimers.delete(timer);
        syncSplitHeaderTitle();
      }, delay);
      pendingTimers.add(timer);
    });
  }
  function restoreSplitHeaderTitle() {
    clearPendingTimers();
    document.querySelectorAll(`.${HEADER_TITLE_CLASS}`).forEach((el) => el.remove());
  }

  // src/content/layout/layout-mutation-tracker.ts
  var expectedNodes = /* @__PURE__ */ new Set();
  var clearTimer = null;
  function markLayoutMutation(...nodes) {
    nodes.forEach((node) => {
      if (node) expectedNodes.add(node);
    });
    if (clearTimer) return;
    clearTimer = setTimeout(() => {
      expectedNodes.clear();
      clearTimer = null;
    }, 0);
  }
  function isExpectedLayoutMutation(node) {
    return expectedNodes.has(node);
  }

  // src/content/layout/footer-actions-cloner.ts
  var footerPortalState = {
    source: null,
    placeholder: null,
    host: null,
    originalParent: null,
    originalNextSibling: null,
    topicId: ""
  };
  function findFooterActionsSource() {
    return Array.from(document.querySelectorAll(FOOTER_ACTIONS_SELECTORS)).find(
      (el) => el instanceof HTMLElement && !el.closest(`.${ARTICLE_PANE_CLASS}`) && !el.hasAttribute(FOOTER_ACTIONS_PLACEHOLDER_ATTR)
    ) || null;
  }
  function findFooterActionsHostReplacement() {
    const candidate = footerPortalState.host?.querySelector(
      ":scope > #topic-footer-buttons, :scope > .topic-footer-main-buttons"
    );
    return candidate instanceof HTMLElement && candidate !== footerPortalState.source ? candidate : null;
  }
  function createFooterActionsPlaceholder(source) {
    const placeholder = document.createElement("span");
    placeholder.hidden = true;
    placeholder.setAttribute(FOOTER_ACTIONS_PLACEHOLDER_ATTR, "true");
    markLayoutMutation(placeholder);
    source.parentElement?.insertBefore(placeholder, source);
    return placeholder;
  }
  function clearPortalState() {
    footerPortalState.source = null;
    footerPortalState.placeholder = null;
    footerPortalState.host = null;
    footerPortalState.originalParent = null;
    footerPortalState.originalNextSibling = null;
    footerPortalState.topicId = "";
  }
  function restoreSource(source, placeholder, originalParent, originalNextSibling, sourceTopicId) {
    source.removeAttribute(FOOTER_ACTIONS_SOURCE_ATTR);
    source.removeAttribute(FOOTER_ACTIONS_TOPIC_ATTR);
    markLayoutMutation(source);
    const currentTopicId = getTopicId();
    if (!currentTopicId || sourceTopicId && sourceTopicId !== currentTopicId) {
      source.remove();
      return;
    }
    if (placeholder?.parentElement?.isConnected) {
      placeholder.parentElement.insertBefore(source, placeholder);
      return;
    }
    if (originalParent?.isConnected) {
      const anchor = originalNextSibling?.parentNode === originalParent ? originalNextSibling : null;
      originalParent.insertBefore(source, anchor);
      return;
    }
    const replacement = findFooterActionsSource();
    if (replacement && replacement !== source) {
      source.remove();
      return;
    }
    const fallback = document.querySelector(".topic-area, .container.posts, #main-outlet") || document.body;
    fallback.appendChild(source);
  }
  function syncArticleFooterActions(pane) {
    if (!pane) return;
    const hostReplacement = findFooterActionsHostReplacement();
    const nextSource = findFooterActionsSource();
    const currentSource = footerPortalState.source;
    if (hostReplacement) {
      markLayoutMutation(currentSource);
      currentSource?.remove();
      footerPortalState.source = hostReplacement;
      hostReplacement.setAttribute(FOOTER_ACTIONS_SOURCE_ATTR, "true");
      hostReplacement.setAttribute(FOOTER_ACTIONS_TOPIC_ATTR, footerPortalState.topicId);
    } else if (nextSource && nextSource !== currentSource) {
      markLayoutMutation(currentSource, footerPortalState.placeholder);
      currentSource?.remove();
      footerPortalState.placeholder?.remove();
      footerPortalState.source = nextSource;
      footerPortalState.originalParent = nextSource.parentElement;
      footerPortalState.originalNextSibling = nextSource.nextSibling;
      footerPortalState.topicId = getTopicId() || "";
      footerPortalState.placeholder = createFooterActionsPlaceholder(nextSource);
      nextSource.setAttribute(FOOTER_ACTIONS_SOURCE_ATTR, "true");
      nextSource.setAttribute(FOOTER_ACTIONS_TOPIC_ATTR, footerPortalState.topicId);
    } else if (currentSource && !currentSource.isConnected) {
      markLayoutMutation(footerPortalState.placeholder, footerPortalState.host);
      footerPortalState.placeholder?.remove();
      footerPortalState.host?.remove();
      clearPortalState();
    }
    const source = footerPortalState.source;
    let articleActions = footerPortalState.host;
    if (!source) {
      articleActions?.remove();
      footerPortalState.host = null;
      return;
    }
    if (!articleActions?.isConnected || articleActions.parentElement !== pane) {
      articleActions = document.createElement("section");
      articleActions.className = ARTICLE_ACTIONS_CLASS;
      articleActions.setAttribute("aria-label", "\u4E3B\u9898\u64CD\u4F5C");
      markLayoutMutation(articleActions);
      pane.appendChild(articleActions);
      footerPortalState.host = articleActions;
    }
    if (source.parentElement !== articleActions) {
      markLayoutMutation(source);
      articleActions.appendChild(source);
    }
  }
  function restoreFooterActions() {
    const { source, placeholder, host, originalParent, originalNextSibling, topicId } = footerPortalState;
    if (source) {
      restoreSource(source, placeholder, originalParent, originalNextSibling, topicId);
    }
    markLayoutMutation(placeholder, host);
    placeholder?.remove();
    host?.remove();
    clearPortalState();
    const orphanedSource = document.querySelector(
      `[${FOOTER_ACTIONS_SOURCE_ATTR}="true"]`
    );
    const orphanedPlaceholder = document.querySelector(
      `[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}="true"]`
    );
    if (orphanedSource) {
      restoreSource(
        orphanedSource,
        orphanedPlaceholder,
        null,
        null,
        orphanedSource.getAttribute(FOOTER_ACTIONS_TOPIC_ATTR) || ""
      );
    }
    markLayoutMutation(orphanedPlaceholder);
    orphanedPlaceholder?.remove();
    document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`).forEach((el) => {
      markLayoutMutation(el);
      el.remove();
    });
  }

  // src/content/layout/resize-handler.ts
  var ResizeHandler = class {
    listener = null;
    pagehideHandler = () => {
      if (this.listener) window.removeEventListener("resize", this.listener);
    };
    pageshowHandler = (event) => {
      if (!event.persisted || !this.listener) return;
      window.addEventListener("resize", this.listener);
      this.listener();
    };
    bind() {
      if (this.listener) return;
      this.listener = () => {
        document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach(updateSplitPaneHeight);
      };
      window.addEventListener("resize", this.listener);
      window.addEventListener("pagehide", this.pagehideHandler);
      window.addEventListener("pageshow", this.pageshowHandler);
    }
    unbind() {
      if (!this.listener) return;
      window.removeEventListener("resize", this.listener);
      window.removeEventListener("pagehide", this.pagehideHandler);
      window.removeEventListener("pageshow", this.pageshowHandler);
      this.listener = null;
    }
  };
  var resizeHandler = new ResizeHandler();
  function bindResizeHandler() {
    resizeHandler.bind();
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
    // shadow host 挂载到 document.body，shadow root 承载 toast 元素与 <style>。
    host = null;
    shadow = null;
    ensureShadow() {
      if (this.shadow) return this.shadow;
      this.host = document.createElement("div");
      this.host.id = "ldcopy-toast-host";
      this.shadow = this.host.attachShadow({ mode: "closed" });
      const styleEl = document.createElement("style");
      styleEl.textContent = TOAST_SHADOW_STYLE;
      this.shadow.appendChild(styleEl);
      document.body.appendChild(this.host);
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

  // src/content/error-handler.ts
  function handleError(err, context) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[LinuxDoToolkit] ${context}:`, err);
    showToast(`${context}\u5931\u8D25: ${message}`);
  }

  // src/content/layout/split-pane-layout.ts
  var layoutState = {
    generation: 0,
    active: false,
    splitSessionActive: false,
    topicId: "",
    wrapper: null,
    stream: null,
    articlePane: null,
    mainPost: null,
    mainPostNextSibling: null,
    previousStreamAriaLabel: null,
    revealTimer: null,
    sidebarGuardTimer: null
  };
  function getNativeStream() {
    if (layoutState.stream?.isConnected) return layoutState.stream;
    return document.querySelector(`.${NATIVE_STREAM_CLASS}`) || document.querySelector("#post_stream") || document.querySelector("#post-stream") || document.querySelector(".post-stream") || document.querySelector(".topic-posts");
  }
  function getNativeMainPost(stream) {
    const numberedMainPost = stream?.querySelector(
      ':scope > [data-post-number="1"].topic-post, :scope > .topic-post[data-post-number="1"]'
    );
    if (numberedMainPost) return numberedMainPost;
    const firstPost = stream?.querySelector(
      ":scope > [data-post-id].topic-post, :scope > .topic-post"
    );
    if (!firstPost || firstPost.getAttribute("data-post-number")) return null;
    return firstPost;
  }
  function revealPreparedLayout() {
    document.documentElement.classList.remove(PREPARING_ROOT_CLASS);
    if (layoutState.revealTimer) {
      clearTimeout(layoutState.revealTimer);
      layoutState.revealTimer = null;
    }
  }
  function prepareTopicSplitLayout() {
    if (!getTopicId()) return;
    document.documentElement.classList.add(PREPARING_ROOT_CLASS);
    if (layoutState.revealTimer) clearTimeout(layoutState.revealTimer);
    layoutState.revealTimer = setTimeout(revealPreparedLayout, 2e3);
  }
  function releaseSidebarGuard(toggle, attempt = 0) {
    if (toggle.getAttribute("aria-expanded") === "false" || attempt >= 12) {
      document.body?.classList.remove(SIDEBAR_GUARD_CLASS, "sidebar-animate");
      layoutState.sidebarGuardTimer = null;
      return;
    }
    layoutState.sidebarGuardTimer = setTimeout(() => releaseSidebarGuard(toggle, attempt + 1), 16);
  }
  function collapseSidebarOnce() {
    if (layoutState.splitSessionActive) return;
    const toggle = document.querySelector(
      "button.btn-sidebar-toggle[aria-controls], button.btn-sidebar-toggle"
    );
    const expanded = toggle?.getAttribute("aria-expanded");
    if (!toggle || expanded !== "true" && expanded !== "false") return;
    layoutState.splitSessionActive = true;
    if (expanded === "false") return;
    document.body.classList.add(SIDEBAR_GUARD_CLASS);
    toggle.click();
    releaseSidebarGuard(toggle);
  }
  function createSplitShell(stream) {
    const parent = stream.parentElement;
    if (!parent) throw new Error("\u8BC4\u8BBA\u5217\u8868\u5C1A\u672A\u6302\u8F7D");
    const wrapper = document.createElement("div");
    wrapper.className = WRAPPER_CLASS;
    const articlePane = document.createElement("aside");
    articlePane.className = ARTICLE_PANE_CLASS;
    articlePane.setAttribute("aria-label", "\u6587\u7AE0\u5185\u5BB9");
    markLayoutMutation(wrapper, articlePane, stream);
    parent.insertBefore(wrapper, stream);
    wrapper.append(articlePane, stream);
    return { wrapper, articlePane };
  }
  function restoreMainPost() {
    const { stream, mainPost, mainPostNextSibling } = layoutState;
    if (!stream?.isConnected || !mainPost) return;
    const replacement = getNativeMainPost(stream);
    if (replacement && replacement !== mainPost) {
      markLayoutMutation(mainPost);
      mainPost.remove();
      return;
    }
    mainPost.classList.remove(ORIGINAL_MAIN_POST_CLASS);
    if (mainPost.parentElement === stream) return;
    const anchor = mainPostNextSibling?.parentNode === stream ? mainPostNextSibling : stream.firstChild;
    markLayoutMutation(mainPost);
    stream.insertBefore(mainPost, anchor);
  }
  function clearLayoutState(endSession) {
    layoutState.active = false;
    if (endSession) layoutState.splitSessionActive = false;
    layoutState.topicId = "";
    layoutState.wrapper = null;
    layoutState.stream = null;
    layoutState.articlePane = null;
    layoutState.mainPost = null;
    layoutState.mainPostNextSibling = null;
    layoutState.previousStreamAriaLabel = null;
  }
  function restoreOrphanedLayout() {
    const wrapper = document.querySelector(`.${WRAPPER_CLASS}`);
    const stream = wrapper?.querySelector(
      `:scope > .${NATIVE_STREAM_CLASS}, :scope > .post-stream, :scope > #post_stream`
    );
    const articlePane = wrapper?.querySelector(`:scope > .${ARTICLE_PANE_CLASS}`);
    const movedMain = articlePane?.querySelector(`.${ORIGINAL_MAIN_POST_CLASS}`);
    restoreFooterActions();
    if (stream && movedMain && !getNativeMainPost(stream)) {
      movedMain.classList.remove(ORIGINAL_MAIN_POST_CLASS);
      markLayoutMutation(movedMain);
      stream.insertBefore(movedMain, stream.firstChild);
    }
    markLayoutMutation(articlePane);
    articlePane?.remove();
    const legacyCommentsPane = wrapper?.querySelector(":scope > .ldtk-topic-comments-pane");
    markLayoutMutation(legacyCommentsPane);
    legacyCommentsPane?.remove();
    wrapper?.querySelectorAll(":scope > .ldtk-paged-comment, :scope > .ldtk-comments-pager").forEach((el) => {
      markLayoutMutation(el);
      el.remove();
    });
    if (wrapper?.parentElement && stream) {
      markLayoutMutation(stream, wrapper);
      wrapper.parentElement.insertBefore(stream, wrapper);
      wrapper.remove();
    }
    stream?.classList.remove(NATIVE_STREAM_CLASS, COMMENTS_STREAM_CLASS);
    stream?.removeAttribute("aria-hidden");
    stream?.removeAttribute("aria-label");
    restoreSplitHeaderTitle();
    document.body?.classList.remove(BODY_CLASS, SIDEBAR_GUARD_CLASS, "sidebar-animate");
  }
  function teardownCurrentLayout(endSession) {
    if (!layoutState.active) {
      if (document.body?.classList.contains(BODY_CLASS)) restoreOrphanedLayout();
      if (endSession) layoutState.splitSessionActive = false;
      revealPreparedLayout();
      return;
    }
    const { wrapper, stream, articlePane, previousStreamAriaLabel } = layoutState;
    restoreFooterActions();
    restoreMainPost();
    markLayoutMutation(articlePane);
    articlePane?.remove();
    if (stream) {
      stream.classList.remove(NATIVE_STREAM_CLASS, COMMENTS_STREAM_CLASS);
      stream.removeAttribute("aria-hidden");
      if (previousStreamAriaLabel === null) stream.removeAttribute("aria-label");
      else stream.setAttribute("aria-label", previousStreamAriaLabel);
    }
    if (wrapper?.parentElement && stream?.parentElement === wrapper) {
      markLayoutMutation(stream, wrapper);
      wrapper.parentElement.insertBefore(stream, wrapper);
      wrapper.remove();
    } else if (wrapper && !wrapper.children.length) {
      wrapper.remove();
    }
    restoreSplitHeaderTitle();
    document.body.classList.remove(BODY_CLASS, SIDEBAR_GUARD_CLASS, "sidebar-animate");
    if (layoutState.sidebarGuardTimer) {
      clearTimeout(layoutState.sidebarGuardTimer);
      layoutState.sidebarGuardTimer = null;
    }
    clearLayoutState(endSession);
    revealPreparedLayout();
  }
  function isCurrentLayoutIntact(topicId) {
    return Boolean(
      layoutState.active && layoutState.topicId === topicId && layoutState.wrapper?.isConnected && layoutState.stream?.isConnected && layoutState.articlePane?.isConnected && layoutState.mainPost?.parentElement === layoutState.articlePane && !getNativeMainPost(layoutState.stream)
    );
  }
  function activateLayout(stream, mainPost, topicId) {
    collapseSidebarOnce();
    const mainPostNextSibling = mainPost.nextSibling;
    const previousStreamAriaLabel = stream.getAttribute("aria-label");
    const { wrapper, articlePane } = createSplitShell(stream);
    layoutState.active = true;
    layoutState.topicId = topicId;
    layoutState.wrapper = wrapper;
    layoutState.stream = stream;
    layoutState.articlePane = articlePane;
    layoutState.mainPost = mainPost;
    layoutState.mainPostNextSibling = mainPostNextSibling;
    layoutState.previousStreamAriaLabel = previousStreamAriaLabel;
    mainPost.classList.add(ORIGINAL_MAIN_POST_CLASS);
    markLayoutMutation(mainPost);
    articlePane.appendChild(mainPost);
    stream.classList.add(NATIVE_STREAM_CLASS, COMMENTS_STREAM_CLASS);
    stream.removeAttribute("aria-hidden");
    stream.setAttribute("aria-label", "\u8BC4\u8BBA\u5217\u8868");
    syncArticleFooterActions(articlePane);
    document.body.classList.add(BODY_CLASS);
    scheduleSplitHeaderSync();
    updateSplitPaneHeight(wrapper);
    revealPreparedLayout();
  }
  function updateSplitPaneHeight(wrapper) {
    if (!wrapper?.isConnected) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const wrapperTop = wrapper.getBoundingClientRect().top;
    const headerBottom = document.querySelector(".d-header")?.getBoundingClientRect().bottom || 0;
    const paneTop = Math.max(0, wrapperTop, headerBottom);
    const height = Math.max(320, viewportHeight - paneTop - 8);
    wrapper.style.setProperty("--ldtk-topic-top-offset", `${paneTop}px`);
    wrapper.style.setProperty("--ldtk-split-pane-height", `${height}px`);
  }
  function restoreTopicSplitLayout() {
    layoutState.generation += 1;
    teardownCurrentLayout(true);
  }
  async function applyTopicSplitLayout(settings) {
    const generation = ++layoutState.generation;
    const currentSettings = settings || await getCachedSettings();
    if (generation !== layoutState.generation) return;
    const topicId = getTopicId();
    if (!currentSettings.enableSplitLayout || !topicId) {
      teardownCurrentLayout(true);
      return;
    }
    try {
      if (isCurrentLayoutIntact(topicId)) {
        collapseSidebarOnce();
        syncArticleFooterActions(layoutState.articlePane);
        updateSplitPaneHeight(layoutState.wrapper);
        revealPreparedLayout();
        return;
      }
      if (layoutState.active) {
        prepareTopicSplitLayout();
        teardownCurrentLayout(false);
      } else if (document.body.classList.contains(BODY_CLASS)) restoreOrphanedLayout();
      const stream = getNativeStream();
      const mainPost = getNativeMainPost(stream);
      if (!stream || !mainPost) return;
      activateLayout(stream, mainPost, topicId);
    } catch (err) {
      handleError(err, "\u5206\u680F\u5E03\u5C40");
      teardownCurrentLayout(false);
    }
  }
  bindResizeHandler();
  var layout = {
    applyTopicSplitLayout,
    prepareTopicSplitLayout,
    restoreTopicSplitLayout
  };

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
    const items = postEls.map((postEl, index) => ({
      postEl,
      meta: getFallbackMeta(postEl, index),
      index
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
    const posts = results.map(({ value }) => {
      const built = value;
      return { meta: built.meta, raw: built.raw };
    });
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
  var COLLECT_CONCURRENCY = 5;
  var COLLECT_MAX_RETRIES = 3;
  var COLLECT_INITIAL_BACKOFF_MS = 1e3;

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
    document.querySelectorAll("." + SHADOW_HOST_CLASS).forEach((el) => el.remove());
  }
  async function injectButtons() {
    const settings = await getCachedSettings();
    if (!settings.enablePostActions) {
      removeInjectedActions();
      return;
    }
    getPostElements().forEach((postEl) => {
      if (postEl.querySelector("." + SHADOW_HOST_CLASS)) return;
      const actionsEl = postEl.querySelector(".post-controls, .actions");
      if (!actionsEl) return;
      const host = document.createElement("div");
      host.className = SHADOW_HOST_CLASS;
      const shadow = host.attachShadow({ mode: "closed" });
      const styleEl = document.createElement("style");
      styleEl.textContent = BUTTON_SHADOW_STYLE;
      shadow.appendChild(styleEl);
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
          const latestSettings2 = await getSettings();
          const result = await buildPostMarkdown(postEl, latestSettings2);
          await copyToClipboard(result.markdown);
          showToast("\u2705 \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F");
        } catch (err) {
          handleError(err, "\u590D\u5236\u697C\u5C42");
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
          const latestSettings2 = await getSettings();
          const result = await buildPostMarkdown(postEl, latestSettings2);
          const title = getTopicTitle();
          const filename = sanitizeFilename(
            `${title}_#${result.meta.postNumber || "post"}.md`
          );
          downloadFile(result.markdown, filename);
          showToast(`\u2705 \u5DF2\u4E0B\u8F7D ${filename}`);
        } catch (err) {
          handleError(err, "\u4E0B\u8F7D\u697C\u5C42");
        } finally {
          downloadBtn.disabled = false;
        }
      });
      wrapper.appendChild(copyBtn);
      wrapper.appendChild(downloadBtn);
      shadow.appendChild(wrapper);
      actionsEl.appendChild(host);
    });
  }
  var buttons = {
    injectButtons,
    removeInjectedActions
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
          handleError(err, "Base64 \u89E3\u7801");
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
          handleError(err, "\u53BB\u4E2D\u6587");
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
              const settings = await getCachedSettings();
              const result = await collectLoadedPosts(settings);
              assertExportResult(result);
              const md = formatTopicMd(
                result.posts,
                getTopicTitle(),
                getTopicUrl(),
                settings
              );
              await copyToClipboard(md);
              sendResponse({ success: true, ...result });
              const prefix = getExportToastPrefix(result);
              showToast(result.failureCount === 0 ? "\u2705 \u5DF2\u590D\u5236\u6574\u4E2A\u4E3B\u9898" : `${prefix} \u5DF2\u590D\u5236`);
            } catch (err) {
              sendResponse({ success: false, error: err.message });
              handleError(err, "\u590D\u5236\u4E3B\u9898");
            }
          })();
          return true;
        }
        if (msg.action === "downloadTopic") {
          (async () => {
            try {
              const settings = await getCachedSettings();
              const result = await collectLoadedPosts(settings);
              assertExportResult(result);
              const title = getTopicTitle();
              const md = formatTopicMd(result.posts, title, getTopicUrl(), settings);
              const filename = sanitizeFilename(`${title}.md`);
              downloadFile(md, filename);
              sendResponse({ success: true, filename, ...result });
              const prefix = getExportToastPrefix(result);
              showToast(
                result.failureCount === 0 ? `\u2705 \u5DF2\u4E0B\u8F7D ${filename}` : `${prefix} \u5DF2\u4E0B\u8F7D ${filename}`
              );
            } catch (err) {
              sendResponse({ success: false, error: err.message });
              handleError(err, "\u4E0B\u8F7D\u4E3B\u9898");
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

  // src/content/refresh-state.ts
  var RefreshState = class {
    refreshTimer = null;
    base64Timer = null;
    inFlight = false;
    pending = false;
    // 去抖：清掉旧定时器，排一个新的。
    scheduleRefresh(callback, delay = 150) {
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        callback();
      }, delay);
    }
    scheduleBase64(callback, delay = 100) {
      if (this.base64Timer) clearTimeout(this.base64Timer);
      this.base64Timer = setTimeout(() => {
        this.base64Timer = null;
        callback();
      }, delay);
    }
    // 重入守卫：成功获取返回 true 并标记 in-flight；并发调用返回 false 由调用方标记 pending。
    tryAcquire() {
      if (this.inFlight) return false;
      this.inFlight = true;
      return true;
    }
    release() {
      this.inFlight = false;
    }
    hasPending() {
      return this.pending;
    }
    markPending() {
      this.pending = true;
    }
    clearPending() {
      this.pending = false;
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
  var refreshState = new RefreshState();
  var latestSettings = null;
  async function refreshEnhancements(settings) {
    if (settings) {
      latestSettings = settings;
      if (settings.enableSplitLayout) layout.prepareTopicSplitLayout();
    }
    if (!refreshState.tryAcquire()) {
      refreshState.markPending();
      return;
    }
    Promise.resolve().then(async () => {
      await layout.applyTopicSplitLayout(settings);
      await buttons.injectButtons();
      await base64.injectBase64Button();
    }).catch(() => {
    }).finally(() => {
      refreshState.release();
      if (refreshState.hasPending()) {
        refreshState.clearPending();
        scheduleRefreshEnhancements();
      }
    });
  }
  function scheduleRefreshEnhancements(delay = 150) {
    refreshState.scheduleRefresh(refreshEnhancements, delay);
  }
  function scheduleBase64ButtonRefresh(delay = 100) {
    refreshState.scheduleBase64(() => {
      base64.injectBase64Button();
    }, delay);
  }
  function bindDynamicPageEvents() {
    document.addEventListener("selectionchange", () => {
      scheduleBase64ButtonRefresh();
    });
    const target = document.body;
    const managedObserver = new ManagedObserver(
      target,
      {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["aria-expanded"]
      },
      (mutations) => {
        const relevantMutations = mutations.filter(
          (mutation) => mutation.type !== "attributes" || mutation.target instanceof Element && mutation.target.matches("button.btn-sidebar-toggle")
        );
        if (!relevantMutations.length) return;
        const requiresLayoutRebuild = relevantMutations.some(
          (mutation) => Array.from(mutation.addedNodes || []).concat(Array.from(mutation.removedNodes || [])).some(
            (node) => node.nodeType === Node.ELEMENT_NODE && !isExpectedLayoutMutation(node) && (node.matches(".post-stream, #post_stream, #post-stream") || node.matches('.topic-post[data-post-number="1"]') || Boolean(node.querySelector('.topic-post[data-post-number="1"]')))
          )
        );
        const onlyToolkitChanges = relevantMutations.every((mutation) => {
          if (mutation.type === "attributes") return false;
          const changedNodes = Array.from(mutation.addedNodes || []).concat(
            Array.from(mutation.removedNodes || [])
          );
          if (!changedNodes.length) return false;
          return changedNodes.every((node) => {
            if (isExpectedLayoutMutation(node)) return true;
            if (node.nodeType !== Node.ELEMENT_NODE) return true;
            const element = node;
            if (element.matches(
              '.ldtk-shadow-host, [id^="ldcopy-"], .ldtk-topic-split-wrapper, .ldtk-topic-article-pane, .ldtk-topic-article-actions, .ldtk-topic-header-title'
            )) {
              return true;
            }
            return Boolean(element.closest(".ldtk-shadow-host, .ldtk-topic-header-title"));
          });
        });
        if (!onlyToolkitChanges) {
          if (requiresLayoutRebuild && latestSettings?.enableSplitLayout) {
            layout.prepareTopicSplitLayout();
          }
          scheduleRefreshEnhancements(requiresLayoutRebuild ? 0 : 150);
        }
      }
    );
    managedObserver.start();
    const handleNavigation = () => {
      if (latestSettings?.enableSplitLayout) layout.prepareTopicSplitLayout();
      scheduleRefreshEnhancements(0);
    };
    window.addEventListener("discourse-navigate-completed", handleNavigation);
    window.addEventListener("page:change", handleNavigation);
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) handleNavigation();
    });
  }
  function init(initialSettings) {
    messages.registerMessageHandlers(refreshEnhancements);
    bindDynamicPageEvents();
    onSettingsChanged((settings) => {
      latestSettings = settings;
      void refreshEnhancements(settings);
    });
    void refreshEnhancements(initialSettings);
  }
  function waitForDomReady() {
    if (document.readyState !== "loading") return Promise.resolve();
    return new Promise((resolve) => {
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
  }
  async function bootstrap() {
    layout.prepareTopicSplitLayout();
    const initialSettings = await getCachedSettings();
    latestSettings = initialSettings;
    if (!initialSettings.enableSplitLayout) layout.restoreTopicSplitLayout();
    await waitForDomReady();
    init(initialSettings);
  }
  void bootstrap();
})();
//# sourceMappingURL=content.js.map
