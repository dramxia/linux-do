import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS,
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
    chromeMock.storage.sync.set({ enableSplitLayout: true });

    const settings = await getSettings();
    expect(settings.enableSplitLayout).toBe(true);
    // Other keys fall back to defaults.
    expect(settings.enablePostActions).toBe(DEFAULT_SETTINGS.enablePostActions);
    expect(settings.enableBase64Decode).toBe(DEFAULT_SETTINGS.enableBase64Decode);
    expect(settings.includeMetadata).toBe(DEFAULT_SETTINGS.includeMetadata);
    expect(settings.replaceUploadUrls).toBe(DEFAULT_SETTINGS.replaceUploadUrls);
  });

  it('returns all overridden values when full input is stored', async () => {
    const full = {
      enablePostActions: false,
      enableBase64Decode: false,
      enableSplitLayout: true,
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

describe('saveSettings (normalizes then stores)', () => {
  it('normalizes partial input by merging with defaults', async () => {
    const saved = await saveSettings({ enableSplitLayout: true });
    expect(saved.enableSplitLayout).toBe(true);
    expect(saved.enablePostActions).toBe(DEFAULT_SETTINGS.enablePostActions);
  });

  it('returns normalized full settings object', async () => {
    const saved = await saveSettings({
      enablePostActions: false,
      enableBase64Decode: false,
      enableSplitLayout: true,
      includeMetadata: false,
      replaceUploadUrls: false,
    });
    expect(saved).toEqual({
      enablePostActions: false,
      enableBase64Decode: false,
      enableSplitLayout: true,
      includeMetadata: false,
      replaceUploadUrls: false,
    });
  });

  it('rejects when chrome.runtime.lastError is set on set()', async () => {
    const originalSet = chromeMock.storage.sync.set;
    chromeMock.storage.sync.set = (_items, callback) => {
      chromeMock.runtime.lastError = { message: 'write failed' };
      callback?.();
    };

    await expect(saveSettings({ enableSplitLayout: true })).rejects.toThrow('write failed');

    chromeMock.storage.sync.set = originalSet;
    chromeMock.runtime.lastError = undefined;
  });

  it('resolves with normalized settings when chrome.storage is undefined (no-op save)', async () => {
    const savedChrome = (globalThis as { chrome?: ChromeMock }).chrome;
    (globalThis as { chrome?: ChromeMock }).chrome = undefined;

    const saved = await saveSettings({ enableSplitLayout: true });
    expect(saved.enableSplitLayout).toBe(true);
    expect(saved.enablePostActions).toBe(DEFAULT_SETTINGS.enablePostActions);

    (globalThis as { chrome?: ChromeMock }).chrome = savedChrome;
  });
});
