import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/common/settings';
import {
  applyTopicSplitLayout,
  restoreTopicSplitLayout,
} from '../src/content/layout/split-pane-layout';
import {
  ARTICLE_ACTIONS_CLASS,
  ARTICLE_PANE_CLASS,
  BODY_CLASS,
  COMMENTS_STREAM_CLASS,
  FOOTER_ACTIONS_PLACEHOLDER_ATTR,
  FOOTER_ACTIONS_SOURCE_ATTR,
  HEADER_TITLE_CLASS,
  NATIVE_STREAM_CLASS,
  ORIGINAL_MAIN_POST_CLASS,
  PREPARING_ROOT_CLASS,
  SIDEBAR_GUARD_CLASS,
  WRAPPER_CLASS,
} from '../src/content/layout/dom-queries';

function getElement<T extends Element = HTMLElement>(
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Missing fixture element: ${selector}`);
  return element;
}

const enabledSettings = { ...DEFAULT_SETTINGS, enableSplitLayout: true };

describe('split pane layout integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', '/t/layout-integration/42');
    document.body.className = 'page-shell';
    document.body.innerHTML = `
      <header class="d-header">
        <div class="contents">
          <div class="title">Site logo</div>
        </div>
      </header>
      <button
        id="sidebar-toggle"
        class="btn-sidebar-toggle"
        aria-controls="sidebar"
        aria-expanded="true"
        type="button"
      >Toggle sidebar</button>
      <main id="main-outlet">
        <section id="topic-title"><h1>Integration topic</h1></section>
        <div id="topic-root">
          <div id="before-stream">Before stream</div>
          <section id="post_stream" class="post-stream native-stream" aria-label="Original stream">
            <article
              id="main-post"
              class="topic-post original-main"
              data-post-id="101"
              data-post-number="1"
            >
              <div class="cooked">Main post body</div>
              <nav class="post-controls main-controls">
                <button id="main-action" type="button">Main action</button>
              </nav>
            </article>
            <article
              id="reply-post"
              class="topic-post original-reply"
              data-post-id="102"
              data-post-number="2"
            >
              <div class="cooked">Reply body</div>
              <nav class="post-controls reply-controls">
                <button id="reply-action" type="button">Reply action</button>
              </nav>
            </article>
          </section>
          <div id="footer-shell">
            <span id="before-footer">Before footer</span>
            <div id="topic-footer-buttons" class="native-footer" data-existing="kept">
              <button id="footer-action" type="button">Footer action</button>
            </div>
            <span id="after-footer">After footer</span>
          </div>
          <div id="after-stream">After stream</div>
        </div>
      </main>
    `;
  });

  afterEach(() => {
    restoreTopicSplitLayout();
    vi.clearAllTimers();
    vi.useRealTimers();
    document.documentElement.classList.remove(PREPARING_ROOT_CLASS);
    document.body.replaceChildren();
    document.body.removeAttribute('class');
    window.history.replaceState({}, '', '/');
  });

  it('moves native nodes without losing behavior and restores their exact positions', async () => {
    const topicRoot = getElement('#topic-root');
    const headerContents = getElement('.d-header .contents');
    const sidebarToggle = getElement<HTMLButtonElement>('#sidebar-toggle');
    const stream = getElement<HTMLElement>('#post_stream');
    const mainPost = getElement<HTMLElement>('#main-post');
    const replyPost = getElement<HTMLElement>('#reply-post');
    const footer = getElement<HTMLElement>('#topic-footer-buttons');
    const mainAction = getElement<HTMLButtonElement>('#main-action');
    const replyAction = getElement<HTMLButtonElement>('#reply-action');
    const footerAction = getElement<HTMLButtonElement>('#footer-action');

    const originalTopicMarkup = topicRoot.innerHTML;
    const originalHeaderMarkup = headerContents.innerHTML;
    const originalBodyClass = document.body.className;
    const originalStreamClass = stream.className;
    const originalMainClass = mainPost.className;
    const originalReplyClass = replyPost.className;
    const originalFooterClass = footer.className;
    const originalStreamParent = stream.parentElement;
    const originalStreamNextSibling = stream.nextSibling;
    const originalMainParent = mainPost.parentElement;
    const originalMainNextSibling = mainPost.nextSibling;
    const originalFooterParent = footer.parentElement;
    const originalFooterNextSibling = footer.nextSibling;
    const replyControls = getElement<HTMLElement>('.reply-controls', replyPost);

    const collapseSidebar = vi.fn(() => {
      document.body.classList.add('sidebar-animate');
      sidebarToggle.setAttribute('aria-expanded', 'false');
    });
    const onMainAction = vi.fn();
    const onReplyAction = vi.fn();
    const onFooterAction = vi.fn();
    sidebarToggle.addEventListener('click', collapseSidebar);
    mainAction.addEventListener('click', onMainAction);
    replyAction.addEventListener('click', onReplyAction);
    footerAction.addEventListener('click', onFooterAction);

    await applyTopicSplitLayout(enabledSettings);

    const wrapper = getElement<HTMLElement>(`.${WRAPPER_CLASS}`, topicRoot);
    const articlePane = getElement<HTMLElement>(`.${ARTICLE_PANE_CLASS}`, wrapper);
    const articleActions = getElement<HTMLElement>(`.${ARTICLE_ACTIONS_CLASS}`, articlePane);

    expect(Array.from(wrapper.children)).toEqual([articlePane, stream]);
    expect(mainPost.parentElement).toBe(articlePane);
    expect(articlePane.firstElementChild).toBe(mainPost);
    expect(stream.parentElement).toBe(wrapper);
    expect(replyPost.parentElement).toBe(stream);
    expect(replyPost.className).toBe(originalReplyClass);
    expect(getElement('.reply-controls', replyPost)).toBe(replyControls);
    expect(getElement('#reply-action', replyControls)).toBe(replyAction);
    expect(stream.classList).toContain(NATIVE_STREAM_CLASS);
    expect(stream.classList).toContain(COMMENTS_STREAM_CLASS);
    expect(stream.getAttribute('aria-label')).toBe('\u8bc4\u8bba\u5217\u8868');
    expect(mainPost.classList).toContain(ORIGINAL_MAIN_POST_CLASS);
    expect(footer.parentElement).toBe(articleActions);
    expect(footer.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(true);
    expect(document.querySelectorAll(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`)).toHaveLength(1);
    expect(document.body.classList).toContain(BODY_CLASS);
    expect(document.body.classList).not.toContain(SIDEBAR_GUARD_CLASS);
    expect(document.body.classList).not.toContain('sidebar-animate');
    expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false');
    expect(collapseSidebar).toHaveBeenCalledTimes(1);

    await applyTopicSplitLayout(enabledSettings);

    expect(getElement(`.${WRAPPER_CLASS}`, topicRoot)).toBe(wrapper);
    expect(getElement(`.${ARTICLE_PANE_CLASS}`, wrapper)).toBe(articlePane);
    expect(getElement(`.${ARTICLE_ACTIONS_CLASS}`, articlePane)).toBe(articleActions);
    expect(document.querySelectorAll(`.${WRAPPER_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.${ARTICLE_PANE_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`.${HEADER_TITLE_CLASS}`)).toHaveLength(1);
    expect(document.querySelectorAll(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`)).toHaveLength(1);
    expect(collapseSidebar).toHaveBeenCalledTimes(1);

    mainAction.click();
    replyAction.click();
    footerAction.click();
    expect(onMainAction).toHaveBeenCalledTimes(1);
    expect(onReplyAction).toHaveBeenCalledTimes(1);
    expect(onFooterAction).toHaveBeenCalledTimes(1);

    restoreTopicSplitLayout();

    expect(stream.parentElement).toBe(originalStreamParent);
    expect(stream.nextSibling).toBe(originalStreamNextSibling);
    expect(mainPost.parentElement).toBe(originalMainParent);
    expect(mainPost.nextSibling).toBe(originalMainNextSibling);
    expect(footer.parentElement).toBe(originalFooterParent);
    expect(footer.nextSibling).toBe(originalFooterNextSibling);
    expect(topicRoot.innerHTML).toBe(originalTopicMarkup);
    expect(headerContents.innerHTML).toBe(originalHeaderMarkup);
    expect(document.body.className).toBe(originalBodyClass);
    expect(stream.className).toBe(originalStreamClass);
    expect(stream.getAttribute('aria-label')).toBe('Original stream');
    expect(mainPost.className).toBe(originalMainClass);
    expect(replyPost.className).toBe(originalReplyClass);
    expect(footer.className).toBe(originalFooterClass);
    expect(footer.getAttribute('data-existing')).toBe('kept');
    expect(footer.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(false);
    expect(document.querySelector(`.${WRAPPER_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${ARTICLE_PANE_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${ARTICLE_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector(`.${HEADER_TITLE_CLASS}`)).toBeNull();
    expect(document.querySelector(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`)).toBeNull();
    expect(document.documentElement.classList).not.toContain(PREPARING_ROOT_CLASS);
    expect(document.body.classList).not.toContain(BODY_CLASS);
    expect(document.body.classList).not.toContain(SIDEBAR_GUARD_CLASS);
    expect(stream.classList).not.toContain(NATIVE_STREAM_CLASS);
    expect(stream.classList).not.toContain(COMMENTS_STREAM_CLASS);
    expect(mainPost.classList).not.toContain(ORIGINAL_MAIN_POST_CLASS);

    mainAction.click();
    replyAction.click();
    footerAction.click();
    expect(onMainAction).toHaveBeenCalledTimes(2);
    expect(onReplyAction).toHaveBeenCalledTimes(2);
    expect(onFooterAction).toHaveBeenCalledTimes(2);
  });

  it('collapses a sidebar that mounts after the first apply exactly once', async () => {
    const initialToggle = getElement<HTMLButtonElement>('#sidebar-toggle');
    initialToggle.remove();

    await applyTopicSplitLayout(enabledSettings);

    const topicRoot = getElement('#topic-root');
    const wrapper = getElement<HTMLElement>(`.${WRAPPER_CLASS}`, topicRoot);
    const sidebarToggle = document.createElement('button');
    sidebarToggle.className = 'btn-sidebar-toggle';
    sidebarToggle.type = 'button';
    sidebarToggle.setAttribute('aria-controls', 'sidebar');
    sidebarToggle.setAttribute('aria-expanded', 'true');
    const collapseSidebar = vi.fn(() => {
      sidebarToggle.setAttribute('aria-expanded', 'false');
    });
    sidebarToggle.addEventListener('click', collapseSidebar);
    document.body.insertBefore(sidebarToggle, getElement('#main-outlet'));

    await applyTopicSplitLayout(enabledSettings);

    expect(getElement(`.${WRAPPER_CLASS}`, topicRoot)).toBe(wrapper);
    expect(sidebarToggle.getAttribute('aria-expanded')).toBe('false');
    expect(collapseSidebar).toHaveBeenCalledTimes(1);

    await applyTopicSplitLayout(enabledSettings);

    expect(getElement(`.${WRAPPER_CLASS}`, topicRoot)).toBe(wrapper);
    expect(document.querySelectorAll(`.${WRAPPER_CLASS}`)).toHaveLength(1);
    expect(collapseSidebar).toHaveBeenCalledTimes(1);
  });

  it('adopts a replacement main post added to the native stream on repeat apply', async () => {
    const sidebarToggle = getElement<HTMLButtonElement>('#sidebar-toggle');
    sidebarToggle.setAttribute('aria-expanded', 'false');
    const stream = getElement<HTMLElement>('#post_stream');
    const originalMainPost = getElement<HTMLElement>('#main-post');
    const replyPost = getElement<HTMLElement>('#reply-post');

    await applyTopicSplitLayout(enabledSettings);

    const originalWrapper = getElement<HTMLElement>(`.${WRAPPER_CLASS}`);
    const replacementMainPost = document.createElement('article');
    replacementMainPost.id = 'replacement-main-post';
    replacementMainPost.className = 'topic-post replacement-main';
    replacementMainPost.dataset.postId = '201';
    replacementMainPost.dataset.postNumber = '1';
    replacementMainPost.innerHTML = `
      <div class="cooked">Replacement main post body</div>
      <nav class="post-controls replacement-main-controls">
        <button id="replacement-main-action" type="button">Replacement action</button>
      </nav>
    `;
    const replacementAction = getElement<HTMLButtonElement>(
      '#replacement-main-action',
      replacementMainPost,
    );
    const onReplacementAction = vi.fn();
    replacementAction.addEventListener('click', onReplacementAction);
    stream.insertBefore(replacementMainPost, replyPost);

    await applyTopicSplitLayout(enabledSettings);

    const nextWrapper = getElement<HTMLElement>(`.${WRAPPER_CLASS}`);
    const nextArticlePane = getElement<HTMLElement>(`.${ARTICLE_PANE_CLASS}`, nextWrapper);
    expect(nextWrapper).not.toBe(originalWrapper);
    expect(document.querySelectorAll(`.${WRAPPER_CLASS}`)).toHaveLength(1);
    expect(replacementMainPost.parentElement).toBe(nextArticlePane);
    expect(nextArticlePane.firstElementChild).toBe(replacementMainPost);
    expect(replacementMainPost.classList).toContain(ORIGINAL_MAIN_POST_CLASS);
    expect(stream.parentElement).toBe(nextWrapper);
    expect(replyPost.parentElement).toBe(stream);
    expect(originalMainPost.isConnected).toBe(false);

    replacementAction.click();
    expect(onReplacementAction).toHaveBeenCalledTimes(1);

    restoreTopicSplitLayout();

    expect(replacementMainPost.parentElement).toBe(stream);
    expect(stream.firstElementChild).toBe(replacementMainPost);
    expect(replacementMainPost.nextElementSibling).toBe(replyPost);
    expect(replacementMainPost.classList).not.toContain(ORIGINAL_MAIN_POST_CLASS);
    expect(originalMainPost.isConnected).toBe(false);
    replacementAction.click();
    expect(onReplacementAction).toHaveBeenCalledTimes(2);
  });

  it('restores footer actions to a connected fallback when their original container disconnects', async () => {
    const sidebarToggle = getElement<HTMLButtonElement>('#sidebar-toggle');
    sidebarToggle.setAttribute('aria-expanded', 'false');
    const mainOutlet = getElement<HTMLElement>('#main-outlet');
    const footerShell = getElement<HTMLElement>('#footer-shell');
    const footer = getElement<HTMLElement>('#topic-footer-buttons');
    const footerAction = getElement<HTMLButtonElement>('#footer-action');
    const onFooterAction = vi.fn();
    footerAction.addEventListener('click', onFooterAction);

    await applyTopicSplitLayout(enabledSettings);

    const articleActions = getElement<HTMLElement>(`.${ARTICLE_ACTIONS_CLASS}`);
    const placeholder = getElement<HTMLElement>(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`);
    expect(footer.parentElement).toBe(articleActions);
    expect(placeholder.parentElement).toBe(footerShell);

    footerShell.remove();
    expect(footerShell.isConnected).toBe(false);
    expect(placeholder.parentElement).toBe(footerShell);

    await applyTopicSplitLayout(enabledSettings);

    expect(footer.isConnected).toBe(true);
    expect(footer.parentElement).toBe(articleActions);
    expect(document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`)).toHaveLength(1);

    restoreTopicSplitLayout();

    expect(footer.isConnected).toBe(true);
    expect(footer.parentElement).toBe(mainOutlet);
    expect(footer.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(false);
    expect(document.querySelector(`.${ARTICLE_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`)).toBeNull();
    footerAction.click();
    expect(onFooterAction).toHaveBeenCalledTimes(1);
  });

  it('adopts a footer root replaced inside the portal host and restores the replacement', async () => {
    const sidebarToggle = getElement<HTMLButtonElement>('#sidebar-toggle');
    sidebarToggle.setAttribute('aria-expanded', 'false');
    const originalFooter = getElement<HTMLElement>('#topic-footer-buttons');
    const originalFooterParent = originalFooter.parentElement;
    const originalFooterNextSibling = originalFooter.nextSibling;

    await applyTopicSplitLayout(enabledSettings);

    const articleActions = getElement<HTMLElement>(`.${ARTICLE_ACTIONS_CLASS}`);
    const replacementFooter = document.createElement('div');
    replacementFooter.id = 'topic-footer-buttons';
    replacementFooter.className = 'native-footer rerendered-footer';
    replacementFooter.innerHTML =
      '<button id="replacement-footer-action" type="button">Replacement footer action</button>';
    const replacementAction = getElement<HTMLButtonElement>(
      '#replacement-footer-action',
      replacementFooter,
    );
    const onReplacementAction = vi.fn();
    replacementAction.addEventListener('click', onReplacementAction);
    articleActions.replaceChildren(replacementFooter);

    await applyTopicSplitLayout(enabledSettings);

    expect(replacementFooter.parentElement).toBe(articleActions);
    expect(replacementFooter.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(true);
    expect(originalFooter.isConnected).toBe(false);
    expect(document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`)).toHaveLength(1);

    replacementAction.click();
    expect(onReplacementAction).toHaveBeenCalledTimes(1);

    restoreTopicSplitLayout();

    expect(replacementFooter.isConnected).toBe(true);
    expect(replacementFooter.parentElement).toBe(originalFooterParent);
    expect(replacementFooter.nextSibling).toBe(originalFooterNextSibling);
    expect(replacementFooter.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(false);
    expect(getElement('#topic-footer-buttons')).toBe(replacementFooter);
    expect(document.querySelector(`.${ARTICLE_ACTIONS_CLASS}`)).toBeNull();
    expect(document.querySelector(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`)).toBeNull();
    replacementAction.click();
    expect(onReplacementAction).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      destination: 'a non-topic route',
      path: '/latest',
      nextMarkup: '<section id="latest-feed">Latest topics</section>',
      expectedFooterCount: 0,
    },
    {
      destination: 'another topic',
      path: '/t/another-topic/84',
      nextMarkup:
        '<section id="next-topic"><div id="topic-footer-buttons" data-topic="84">Next footer</div></section>',
      expectedFooterCount: 1,
    },
  ])(
    'does not leak the old footer after SPA navigation to $destination',
    async ({ path, nextMarkup, expectedFooterCount }) => {
      const sidebarToggle = getElement<HTMLButtonElement>('#sidebar-toggle');
      sidebarToggle.setAttribute('aria-expanded', 'false');
      const oldMainOutlet = getElement<HTMLElement>('#main-outlet');
      const oldFooter = getElement<HTMLElement>('#topic-footer-buttons');

      await applyTopicSplitLayout(enabledSettings);

      expect(oldFooter.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(true);
      oldMainOutlet.remove();
      expect(oldMainOutlet.isConnected).toBe(false);

      const nextMainOutlet = document.createElement('main');
      nextMainOutlet.id = 'main-outlet';
      nextMainOutlet.innerHTML = nextMarkup;
      document.body.appendChild(nextMainOutlet);
      window.history.replaceState({}, '', path);

      restoreTopicSplitLayout();

      expect(oldFooter.isConnected).toBe(false);
      expect(nextMainOutlet.contains(oldFooter)).toBe(false);
      expect(oldFooter.hasAttribute(FOOTER_ACTIONS_SOURCE_ATTR)).toBe(false);
      expect(document.querySelectorAll('#topic-footer-buttons')).toHaveLength(expectedFooterCount);
      expect(document.querySelector(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}]`)).toBeNull();
      if (expectedFooterCount) {
        expect(getElement('#topic-footer-buttons', nextMainOutlet).getAttribute('data-topic')).toBe(
          '84',
        );
      }
    },
  );
});
