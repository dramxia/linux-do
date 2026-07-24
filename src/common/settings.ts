/* Linux.do 工具箱 — 设置模块 */

export interface DiscourseSettings {
  enablePostActions: boolean;
  enableBase64Decode: boolean;
  enableSplitLayout: boolean;
  includeMetadata: boolean;
  replaceUploadUrls: boolean;
}

type SettingsCallback = (settings: DiscourseSettings) => void;

export const DEFAULT_SETTINGS: Readonly<DiscourseSettings> = Object.freeze({
  enablePostActions: true,
  enableBase64Decode: true,
  enableSplitLayout: false,
  includeMetadata: true,
  replaceUploadUrls: true,
});

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
}

function normalizeSettings(value: Partial<DiscourseSettings> = {}): DiscourseSettings {
  return { ...DEFAULT_SETTINGS, ...value };
}

export function getSettings(): Promise<DiscourseSettings> {
  if (!hasChromeStorage()) {
    return Promise.resolve(normalizeSettings());
  }

  return new Promise<DiscourseSettings>((resolve) => {
    chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => {
      if (chrome.runtime?.lastError) {
        resolve(normalizeSettings());
        return;
      }
      resolve(normalizeSettings(items as Partial<DiscourseSettings>));
    });
  });
}

// T10: 初始化期缓存。首次 getCachedSettings() 调 getSettings() 并缓存到模块变量，
// onSettingsChanged 触发时置空，下次调用重新读取。交互期（按钮点击 handler）仍
// 直接调 getSettings() 实时读 chrome.storage.sync 最新值，不经过此缓存。
let cachedSettings: DiscourseSettings | null = null;

export async function getCachedSettings(): Promise<DiscourseSettings> {
  if (cachedSettings) return cachedSettings;
  cachedSettings = await getSettings();
  return cachedSettings;
}

export function saveSettings(
  partialSettings: Partial<DiscourseSettings>,
): Promise<DiscourseSettings> {
  const normalized = normalizeSettings(partialSettings);
  if (!hasChromeStorage()) {
    return Promise.resolve(normalized);
  }

  return new Promise<DiscourseSettings>((resolve, reject) => {
    chrome.storage.sync.set(partialSettings, () => {
      if (chrome.runtime?.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(normalized);
    });
  });
}

export function onSettingsChanged(callback: SettingsCallback): void {
  if (!hasChromeStorage() || !chrome.storage?.onChanged) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const changedKeys = Object.keys(changes);
    const settingsKeys = Object.keys(DEFAULT_SETTINGS);
    if (!changedKeys.some((key) => settingsKeys.includes(key))) return;
    cachedSettings = null;
    getSettings()
      .then((settings) => {
        cachedSettings = settings;
        callback(settings);
      })
      .catch(() => callback(normalizeSettings()));
  });
}
