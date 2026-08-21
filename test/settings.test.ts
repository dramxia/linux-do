import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  getCachedSettings,
  getSettings,
  onSettingsChanged,
  saveSettings,
} from '../src/common/settings';
import { setupChromeMock, resetChromeMock, type ChromeMock } from './mocks/chrome';

let chromeMock: ChromeMock;

beforeEach(() => {
  chromeMock = setupChromeMock();
});

afterEach(() => {
  resetChromeMock();
  vi.restoreAllMocks();
});

describe('getSettings (normalizeSettings via mocked chrome.storage)', () => {
  it('returns DEFAULT_SETTINGS when storage returns the defaults verbatim (empty input)', async () => {
    // Our mock returns the defaults object as-is when nothing is set in store.
    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('fills in missing keys with defaults (partial input)', async () => {
    // Pre-set only one key; chrome.storage.sync.get returns defaults with override for that key.
    chromeMock.storage.sync.set({ includeMetadata: false });

    const settings = await getSettings();
    expect(settings.includeMetadata).toBe(false);
    // Other keys fall back to defaults.
    expect(settings.enablePostActions).toBe(DEFAULT_SETTINGS.enablePostActions);
    expect(settings.enableBase64Decode).toBe(DEFAULT_SETTINGS.enableBase64Decode);
    expect(settings.replaceUploadUrls).toBe(DEFAULT_SETTINGS.replaceUploadUrls);
  });

  it('returns all overridden values when full input is stored', async () => {
    const full = {
      enablePostActions: false,
      enableBase64Decode: false,
      includeMetadata: false,
      replaceUploadUrls: false,
    };
    chromeMock.storage.sync.set(full);

    const settings = await getSettings();
    expect(settings).toEqual(full);
  });

  it('falls back to defaults when chrome.runtime.lastError is set', async () => {
    // Simulate chrome.storage.sync.get failing via lastError.
    const originalGet = chromeMock.storage.sync.get;
    chromeMock.storage.sync.get = (_defaults, callback) => {
      chromeMock.runtime.lastError = { message: 'storage read failed' };
      callback({});
    };

    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);

    // restore
    chromeMock.storage.sync.get = originalGet;
    chromeMock.runtime.lastError = undefined;
  });

  it('falls back to defaults (no chrome.storage) when globalThis.chrome is undefined', async () => {
    const savedChrome = (globalThis as { chrome?: ChromeMock }).chrome;
    (globalThis as { chrome?: ChromeMock }).chrome = undefined;

    const settings = await getSettings();
    expect(settings).toEqual(DEFAULT_SETTINGS);

    (globalThis as { chrome?: ChromeMock }).chrome = savedChrome;
  });
});

describe('settings cache', () => {
  it('shares one storage read between concurrent callers', async () => {
    const originalGet = chromeMock.storage.sync.get;
    chromeMock.storage.sync.get = vi.fn(originalGet);

    const [first, second] = await Promise.all([getCachedSettings(), getCachedSettings()]);

    expect(first).toEqual(DEFAULT_SETTINGS);
    expect(second).toEqual(DEFAULT_SETTINGS);
    expect(chromeMock.storage.sync.get).toHaveBeenCalledTimes(1);
    await saveSettings({});
  });

  it('invalidates the cache when a known setting changes', async () => {
    const callback = vi.fn();
    onSettingsChanged(callback);
    await getCachedSettings();
    chromeMock.storage.sync.set({ includeMetadata: false });

    chromeMock.storage.onChanged.listeners[0]?.(
      { includeMetadata: { oldValue: true, newValue: false } },
      'sync',
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ includeMetadata: false }));
    await saveSettings({});
  });
});

describe('saveSettings', () => {
  it('stores a partial update without changing other settings', async () => {
    await saveSettings({ includeMetadata: false });
    const saved = await getSettings();
    expect(saved.includeMetadata).toBe(false);
    expect(saved.enablePostActions).toBe(DEFAULT_SETTINGS.enablePostActions);
  });

  it('stores a full settings object', async () => {
    const full = {
      enablePostActions: false,
      enableBase64Decode: false,
      includeMetadata: false,
      replaceUploadUrls: false,
    };
    await saveSettings(full);
    expect(await getSettings()).toEqual(full);
  });

  it('rejects when chrome.runtime.lastError is set on set()', async () => {
    const originalSet = chromeMock.storage.sync.set;
    chromeMock.storage.sync.set = (_items, callback) => {
      chromeMock.runtime.lastError = { message: 'write failed' };
      callback?.();
    };

    await expect(saveSettings({ includeMetadata: false })).rejects.toThrow('write failed');

    chromeMock.storage.sync.set = originalSet;
    chromeMock.runtime.lastError = undefined;
  });

  it('resolves when chrome.storage is undefined (no-op save)', async () => {
    const savedChrome = (globalThis as { chrome?: ChromeMock }).chrome;
    (globalThis as { chrome?: ChromeMock }).chrome = undefined;

    await expect(saveSettings({ includeMetadata: false })).resolves.toBeUndefined();

    (globalThis as { chrome?: ChromeMock }).chrome = savedChrome;
  });
});
