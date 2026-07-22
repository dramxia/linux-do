(() => {
  // src/common/settings.js
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
  function saveSettings(partialSettings) {
    if (!hasChromeStorage()) {
      return Promise.resolve(normalizeSettings(partialSettings));
    }
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(partialSettings, () => {
        if (chrome.runtime?.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve();
      });
    });
  }

  // src/popup/index.js
  document.addEventListener("DOMContentLoaded", async () => {
    const infoEl = document.getElementById("info");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const settingInputs = {
      enablePostActions: document.getElementById("enablePostActions"),
      enableBase64Decode: document.getElementById("enableBase64Decode"),
      enableSplitLayout: document.getElementById("enableSplitLayout"),
      includeMetadata: document.getElementById("includeMetadata"),
      replaceUploadUrls: document.getElementById("replaceUploadUrls")
    };
    async function loadSettings() {
      const settings = await getSettings();
      Object.entries(settingInputs).forEach(([key, input]) => {
        if (input) input.checked = Boolean(settings[key]);
      });
    }
    async function saveSetting(key, checked) {
      await saveSettings({ [key]: checked });
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: "refreshEnhancements" }, () => {
        });
      }
    }
    Object.entries(settingInputs).forEach(([key, input]) => {
      if (!input) return;
      input.addEventListener("change", () => {
        saveSetting(key, input.checked).catch((err) => {
          infoEl.innerHTML = `\u26A0\uFE0F \u8BBE\u7F6E\u4FDD\u5B58\u5931\u8D25\uFF1A${err.message}`;
        });
      });
    });
    await loadSettings();
    if (!tab?.url?.match(/linux\.do\//)) {
      infoEl.innerHTML = "\u26A0\uFE0F \u8BF7\u5728 linux.do \u7684\u5E16\u5B50\u9875\u9762\u4F7F\u7528\u6B64\u63D2\u4EF6";
      document.querySelectorAll(".btn").forEach((button) => {
        button.disabled = true;
      });
      return;
    }
    chrome.tabs.sendMessage(tab.id, { action: "getInfo" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        infoEl.innerHTML = "\u26A0\uFE0F \u9875\u9762\u672A\u52A0\u8F7D\u5B8C\u6210\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5";
        return;
      }
      infoEl.innerHTML = `
      <div class="title">${res.title}</div>
      <div>\u5F53\u524D\u5DF2\u52A0\u8F7D ${res.postCount} \u4E2A\u697C\u5C42</div>
    `;
    });
    document.getElementById("copyTopic").addEventListener("click", () => {
      chrome.tabs.sendMessage(tab.id, { action: "copyTopic" }, () => window.close());
    });
    document.getElementById("downloadTopic").addEventListener("click", () => {
      chrome.tabs.sendMessage(tab.id, { action: "downloadTopic" }, () => window.close());
    });
  });
})();
//# sourceMappingURL=popup.js.map
