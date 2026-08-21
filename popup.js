"use strict";
(() => {
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
  function saveSettings(partialSettings) {
    if (!hasChromeStorage()) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(partialSettings, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        cachedSettings = null;
        resolve();
      });
    });
  }

  // src/popup/security.ts
  var SUPPORTED_HOSTNAMES = /* @__PURE__ */ new Set(["linux.do", "www.linux.do"]);
  function isSupportedPageUrl(rawUrl) {
    if (!rawUrl) return false;
    try {
      const url = new URL(rawUrl);
      return url.protocol === "https:" && SUPPORTED_HOSTNAMES.has(url.hostname);
    } catch {
      return false;
    }
  }
  function renderPageInfo(container, title, postCount) {
    const titleElement = container.ownerDocument.createElement("div");
    titleElement.className = "title";
    titleElement.textContent = title;
    const countElement = container.ownerDocument.createElement("div");
    countElement.textContent = `\u5F53\u524D\u5DF2\u52A0\u8F7D ${postCount} \u4E2A\u697C\u5C42`;
    container.replaceChildren(titleElement, countElement);
  }

  // src/popup/index.ts
  document.addEventListener("DOMContentLoaded", async () => {
    const infoEl = document.getElementById("info");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const tabId = tab?.id;
    const settingInputs = new Map(
      SETTING_KEYS.map((key) => [key, document.getElementById(key)])
    );
    async function loadSettings() {
      const settings = await getSettings();
      settingInputs.forEach((input, key) => {
        if (input) input.checked = settings[key];
      });
    }
    settingInputs.forEach((input, key) => {
      if (!input) return;
      input.addEventListener("change", () => {
        saveSettings({ [key]: input.checked }).catch((err) => {
          if (infoEl) infoEl.textContent = `\u26A0\uFE0F \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A${err.message}`;
        });
      });
    });
    await loadSettings();
    if (!isSupportedPageUrl(tab?.url)) {
      if (infoEl) infoEl.textContent = "\u26A0\uFE0F \u8BF7\u5728 linux.do \u7684\u5E16\u5B50\u9875\u9762\u4F7F\u7528\u6B64\u63D2\u4EF6";
      document.querySelectorAll(".btn").forEach((button) => {
        button.disabled = true;
      });
      return;
    }
    if (tabId === void 0) {
      if (infoEl) infoEl.textContent = "\u26A0\uFE0F \u9875\u9762\u672A\u52A0\u8F7D\u5B8C\u6210\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5";
      return;
    }
    chrome.tabs.sendMessage(
      tabId,
      { action: "getInfo" },
      {},
      (res) => {
        if (chrome.runtime.lastError || !res) {
          if (infoEl) infoEl.textContent = "\u26A0\uFE0F \u9875\u9762\u672A\u52A0\u8F7D\u5B8C\u6210\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5";
          return;
        }
        if (infoEl) {
          renderPageInfo(infoEl, res.title, res.postCount);
        }
      }
    );
    const topicActions = ["copyTopic", "downloadTopic"];
    topicActions.forEach((action) => {
      document.getElementById(action)?.addEventListener("click", () => {
        chrome.tabs.sendMessage(tabId, { action }, {}, () => window.close());
      });
    });
  });
})();
//# sourceMappingURL=popup.js.map
