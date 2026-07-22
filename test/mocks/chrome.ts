/* Vitest 用手写 chrome.* mock，覆盖测试所需的 chrome.storage.sync / chrome.runtime API。
 * 提供 chrome.storage.sync.get / set、chrome.storage.onChanged.addListener、
 * chrome.runtime.onMessage.addListener、chrome.runtime.lastError、
 * chrome.runtime.sendMessage、chrome.runtime.id。
 * 不依赖 vitest-chrome-mv3；保持最小、可重置。 */

type StorageGetCallback = (items: Record<string, unknown>) => void;
type StorageSetCallback = () => void;
type StorageChanges = Record<string, { oldValue?: unknown; newValue?: unknown }>;
type StorageChangedListener = (changes: StorageChanges, areaName: string) => void;
type MessageListener = (
  msg: unknown,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void,
) => boolean | undefined | void;

interface StorageArea {
  get: (defaults: Record<string, unknown>, callback: StorageGetCallback) => void;
  set: (items: Record<string, unknown>, callback?: StorageSetCallback) => void;
}

interface ListenerRegistry<T extends (...args: never[]) => void> {
  addListener: (listener: T) => void;
  listeners: T[];
}

interface ChromeMock {
  storage: {
    sync: StorageArea;
    onChanged: ListenerRegistry<StorageChangedListener>;
  };
  runtime: {
    id: string;
    lastError: { message: string } | undefined;
    onMessage: ListenerRegistry<MessageListener>;
    sendMessage: (message: unknown, callback?: (response: unknown) => void) => void;
  };
}

function createStorageArea(): StorageArea {
  let store: Record<string, unknown> = {};
  return {
    get(defaults: Record<string, unknown>, callback: StorageGetCallback): void {
      const result: Record<string, unknown> = { ...defaults };
      for (const key of Object.keys(defaults)) {
        if (key in store) result[key] = store[key];
      }
      callback(result);
    },
    set(items: Record<string, unknown>, callback?: StorageSetCallback): void {
      store = { ...store, ...items };
      callback?.();
    },
  };
}

function createChromeMock(): ChromeMock {
  return {
    storage: {
      sync: createStorageArea(),
      onChanged: { addListener() {}, listeners: [] },
    },
    runtime: {
      id: 'test-extension-id',
      lastError: undefined,
      onMessage: { addListener() {}, listeners: [] },
      sendMessage() {},
    },
  };
}

function wireListeners(mock: ChromeMock): void {
  mock.storage.onChanged.addListener = (listener) => {
    mock.storage.onChanged.listeners.push(listener);
  };
  mock.runtime.onMessage.addListener = (listener) => {
    mock.runtime.onMessage.listeners.push(listener);
  };
}

function setupChromeMock(): ChromeMock {
  const mock = createChromeMock();
  wireListeners(mock);
  (globalThis as { chrome?: ChromeMock }).chrome = mock;
  return mock;
}

function resetChromeMock(): void {
  const mock = createChromeMock();
  wireListeners(mock);
  (globalThis as { chrome?: ChromeMock }).chrome = mock;
}

export { setupChromeMock, resetChromeMock, type ChromeMock, type MessageListener, type StorageChangedListener };
