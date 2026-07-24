import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BODY_CLASS, PREPARING_ROOT_CLASS, WRAPPER_CLASS } from '../src/content/layout/dom-queries';

interface TestSettings {
  enablePostActions: boolean;
  enableBase64Decode: boolean;
  enableSplitLayout: boolean;
  includeMetadata: boolean;
  replaceUploadUrls: boolean;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve(value: T) {
      if (!resolvePromise) throw new Error('Deferred promise resolver is unavailable');
      resolvePromise(value);
    },
  };
}

function installIndexDependencyMocks(getCachedSettings: () => Promise<TestSettings>): void {
  vi.doMock('../src/common/settings', () => ({
    getCachedSettings,
    onSettingsChanged: vi.fn(),
  }));
  vi.doMock('../src/content/buttons', () => ({
    buttons: { injectButtons: vi.fn().mockResolvedValue(undefined) },
  }));
  vi.doMock('../src/content/base64', () => ({
    base64: { injectBase64Button: vi.fn().mockResolvedValue(undefined) },
  }));
  vi.doMock('../src/content/messages', () => ({
    messages: { registerMessageHandlers: vi.fn() },
  }));
}

describe('content index split layout lifecycle', () => {
  let restoreTopicSplitLayout: (() => void) | undefined;
  let unbindResizeHandler: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/t/index-integration/42');
    document.body.className = 'page-shell';
  });

  afterEach(() => {
    restoreTopicSplitLayout?.();
    window.dispatchEvent(new Event('pagehide'));
    unbindResizeHandler?.();
    restoreTopicSplitLayout = undefined;
    unbindResizeHandler = undefined;
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.doUnmock('../src/common/settings');
    vi.doUnmock('../src/content/buttons');
    vi.doUnmock('../src/content/base64');
    vi.doUnmock('../src/content/messages');
    vi.resetModules();
    vi.restoreAllMocks();
    document.documentElement.classList.remove(PREPARING_ROOT_CLASS);
    document.body.replaceChildren();
    document.body.removeAttribute('class');
    window.history.replaceState({}, '', '/');
  });

  it('prepares synchronously while settings load and reveals after disabled settings resolve', async () => {
    document.body.innerHTML = '<main id="main-outlet"></main>';
    const settingsRead = createDeferred<TestSettings>();
    const getCachedSettings = vi.fn(() => settingsRead.promise);
    installIndexDependencyMocks(getCachedSettings);

    await import('../src/content/index');
    const layoutModule = await import('../src/content/layout/split-pane-layout');
    const resizeModule = await import('../src/content/layout/resize-handler');
    restoreTopicSplitLayout = layoutModule.restoreTopicSplitLayout;
    unbindResizeHandler = resizeModule.unbindResizeHandler;

    expect(getCachedSettings).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList).toContain(PREPARING_ROOT_CLASS);

    settingsRead.resolve({
      enablePostActions: true,
      enableBase64Decode: true,
      enableSplitLayout: false,
      includeMetadata: true,
      replaceUploadUrls: true,
    });
    await Promise.resolve();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.advanceTimersByTimeAsync(0);

    expect(document.documentElement.classList).not.toContain(PREPARING_ROOT_CLASS);
    expect(document.body.classList).not.toContain(BODY_CLASS);
  });

  it('observes an aria-expanded-only sidebar update and collapses the mounted toggle', async () => {
    document.body.innerHTML = `
      <header class="d-header"><div class="contents"><div class="title">Site</div></div></header>
      <button
        id="sidebar-toggle"
        class="btn-sidebar-toggle"
        aria-controls="sidebar"
        type="button"
      >Toggle sidebar</button>
      <main id="main-outlet">
        <section id="topic-title"><h1>Observer topic</h1></section>
        <div id="topic-root">
          <section id="post_stream" class="post-stream" aria-label="Original stream">
            <article class="topic-post" data-post-id="101" data-post-number="1">Main post</article>
            <article class="topic-post" data-post-id="102" data-post-number="2">Reply</article>
          </section>
        </div>
      </main>
    `;
    const enabledSettings: TestSettings = {
      enablePostActions: true,
      enableBase64Decode: true,
      enableSplitLayout: true,
      includeMetadata: true,
      replaceUploadUrls: true,
    };
    const getCachedSettings = vi.fn().mockResolvedValue(enabledSettings);
    installIndexDependencyMocks(getCachedSettings);
    const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle');
    if (!sidebarToggle) throw new Error('Sidebar fixture is missing');
    const collapseSidebar = vi.fn(() => {
      sidebarToggle.setAttribute('aria-expanded', 'false');
    });
    sidebarToggle.addEventListener('click', collapseSidebar);

    await import('../src/content/index');
    const layoutModule = await import('../src/content/layout/split-pane-layout');
    const resizeModule = await import('../src/content/layout/resize-handler');
    restoreTopicSplitLayout = layoutModule.restoreTopicSplitLayout;
    unbindResizeHandler = resizeModule.unbindResizeHandler;
    await Promise.resolve();
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await vi.advanceTimersByTimeAsync(0);

    expect(document.body.classList).toContain(BODY_CLASS);
    expect(document.querySelectorAll(`.${WRAPPER_CLASS}`)).toHaveLength(1);
    expect(sidebarToggle.hasAttribute('aria-expanded')).toBe(false);
    expect(collapseSidebar).not.toHaveBeenCalled();

    sidebarToggle.setAttribute('aria-expanded', 'true');
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150);

    expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false');
    expect(collapseSidebar).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(150);
    expect(collapseSidebar).toHaveBeenCalledTimes(1);
  });
});
