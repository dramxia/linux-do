import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BODY_CLASS,
  COMMENTS_STREAM_CLASS,
  NATIVE_STREAM_CLASS,
  ORIGINAL_MAIN_POST_CLASS,
  WRAPPER_CLASS,
} from '../src/content/layout/dom-queries';

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

describe('split pane layout settings race', () => {
  let restoreTopicSplitLayout: (() => void) | undefined;
  let unbindResizeHandler: (() => void) | undefined;

  beforeEach(() => {
    window.history.replaceState({}, '', '/t/settings-race/42');
    document.body.className = 'page-shell';
    document.body.innerHTML = `
      <button
        id="sidebar-toggle"
        class="btn-sidebar-toggle"
        aria-controls="sidebar"
        aria-expanded="true"
        type="button"
      >Toggle sidebar</button>
      <main id="main-outlet">
        <div id="topic-root">
          <section id="post_stream" class="post-stream native-stream" aria-label="Original stream">
            <article
              id="main-post"
              class="topic-post original-main"
              data-post-id="101"
              data-post-number="1"
            >Main post</article>
            <article
              id="reply-post"
              class="topic-post original-reply"
              data-post-id="102"
              data-post-number="2"
            >Reply</article>
          </section>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    restoreTopicSplitLayout?.();
    unbindResizeHandler?.();
    restoreTopicSplitLayout = undefined;
    unbindResizeHandler = undefined;
    vi.doUnmock('../src/common/settings');
    vi.resetModules();
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.body.removeAttribute('class');
    window.history.replaceState({}, '', '/');
  });

  it('ignores a stale enable result after a newer disable result has completed', async () => {
    const enableRead = createDeferred<TestSettings>();
    const disableRead = createDeferred<TestSettings>();
    const getCachedSettings = vi
      .fn()
      .mockReturnValueOnce(enableRead.promise)
      .mockReturnValueOnce(disableRead.promise);
    vi.doMock('../src/common/settings', () => ({ getCachedSettings }));

    const layoutModule = await import('../src/content/layout/split-pane-layout');
    const resizeModule = await import('../src/content/layout/resize-handler');
    restoreTopicSplitLayout = layoutModule.restoreTopicSplitLayout;
    unbindResizeHandler = resizeModule.unbindResizeHandler;

    const stream = document.querySelector<HTMLElement>('#post_stream');
    const mainPost = document.querySelector<HTMLElement>('#main-post');
    const topicRoot = document.querySelector<HTMLElement>('#topic-root');
    const sidebarToggle = document.querySelector<HTMLButtonElement>('#sidebar-toggle');
    if (!stream || !mainPost || !topicRoot || !sidebarToggle) {
      throw new Error('Settings race fixture is incomplete');
    }

    const originalStreamParent = stream.parentElement;
    const originalMainParent = mainPost.parentElement;
    const sidebarClick = vi.fn();
    sidebarToggle.addEventListener('click', sidebarClick);

    const enabledSettings: TestSettings = {
      enablePostActions: true,
      enableBase64Decode: true,
      enableSplitLayout: true,
      includeMetadata: true,
      replaceUploadUrls: true,
    };
    const disabledSettings: TestSettings = {
      ...enabledSettings,
      enableSplitLayout: false,
    };

    const pendingEnable = layoutModule.applyTopicSplitLayout();
    const pendingDisable = layoutModule.applyTopicSplitLayout();
    expect(getCachedSettings).toHaveBeenCalledTimes(2);

    disableRead.resolve(disabledSettings);
    await pendingDisable;

    expect(document.body.classList).not.toContain(BODY_CLASS);
    expect(topicRoot.querySelector(`.${WRAPPER_CLASS}`)).toBeNull();
    expect(sidebarClick).not.toHaveBeenCalled();

    enableRead.resolve(enabledSettings);
    await pendingEnable;

    expect(document.body.className).toBe('page-shell');
    expect(topicRoot.querySelector(`.${WRAPPER_CLASS}`)).toBeNull();
    expect(stream.parentElement).toBe(originalStreamParent);
    expect(mainPost.parentElement).toBe(originalMainParent);
    expect(stream.classList).not.toContain(NATIVE_STREAM_CLASS);
    expect(stream.classList).not.toContain(COMMENTS_STREAM_CLASS);
    expect(mainPost.classList).not.toContain(ORIGINAL_MAIN_POST_CLASS);
    expect(sidebarToggle.getAttribute('aria-expanded')).toBe('true');
    expect(sidebarClick).not.toHaveBeenCalled();
  });
});
