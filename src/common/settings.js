/* Linux.do 工具箱 — 设置模块 */
(() => {
  'use strict';

  const namespace = globalThis.LinuxDoToolkit = globalThis.LinuxDoToolkit || {};

  const DEFAULT_SETTINGS = Object.freeze({
    enablePostActions: true,
    enableBase64Decode: true,
    enableSplitLayout: false,
    includeMetadata: true,
    replaceUploadUrls: true,
  });

  function hasChromeStorage() {
    return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
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

  function onSettingsChanged(callback) {
    if (!hasChromeStorage() || !chrome.storage?.onChanged) return;

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'sync') return;
      const changedKeys = Object.keys(changes);
      const settingsKeys = Object.keys(DEFAULT_SETTINGS);
      if (!changedKeys.some((key) => settingsKeys.includes(key))) return;
      getSettings().then(callback).catch(() => callback(normalizeSettings()));
    });
  }

  namespace.settings = {
    DEFAULT_SETTINGS,
    getSettings,
    saveSettings,
    onSettingsChanged,
  };
})();
