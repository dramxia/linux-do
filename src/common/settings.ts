/* Linux.do 工具箱 — 设置模块 */

export interface DiscourseSettings {
  enableSplitReading: boolean;
  commentsPerPage: 10 | 20;
  enablePostActions: boolean;
  enableBase64Decode: boolean;
  includeMetadata: boolean;
  replaceUploadUrls: boolean;
}

export type SettingKey = keyof DiscourseSettings;

type SettingsCallback = (settings: DiscourseSettings) => void;

export const DEFAULT_SETTINGS: Readonly<DiscourseSettings> = Object.freeze({
  enableSplitReading: false,
  commentsPerPage: 10,
  enablePostActions: true,
  enableBase64Decode: true,
  includeMetadata: true,
  replaceUploadUrls: true,
});

export const SETTING_KEYS: readonly SettingKey[] = Object.freeze([
  'enableSplitReading',
  'commentsPerPage',
  'enablePostActions',
  'enableBase64Decode',
  'includeMetadata',
  'replaceUploadUrls',
]);

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.sync);
}

function normalizeSettings(value: Partial<DiscourseSettings> = {}): DiscourseSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    commentsPerPage: value.commentsPerPage === 20 ? 20 : 10,
  };
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

let cachedSettings: Promise<DiscourseSettings> | null = null;

export function getCachedSettings(): Promise<DiscourseSettings> {
  if (!cachedSettings) {
    cachedSettings = getSettings().catch(() => {
      cachedSettings = null;
      return normalizeSettings();
    });
  }
  return cachedSettings;
}

export function saveSettings(partialSettings: Partial<DiscourseSettings>): Promise<void> {
  if (!hasChromeStorage()) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
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

export function onSettingsChanged(callback: SettingsCallback): void {
  if (!hasChromeStorage() || !chrome.storage?.onChanged) return;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;
    const changedKeys = Object.keys(changes);
    if (!changedKeys.some((key) => SETTING_KEYS.includes(key as SettingKey))) return;
    cachedSettings = null;
    void getCachedSettings().then(callback);
  });
}
