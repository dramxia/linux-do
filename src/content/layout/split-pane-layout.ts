/* Linux.do 工具箱 — 原生正文/评论分栏生命周期 */
import * as discourse from '../discourse';
import { getCachedSettings, type DiscourseSettings } from '../../common/settings';
import {
  ARTICLE_PANE_CLASS,
  BODY_CLASS,
  COMMENTS_STREAM_CLASS,
  NATIVE_STREAM_CLASS,
  ORIGINAL_MAIN_POST_CLASS,
  PREPARING_ROOT_CLASS,
  SIDEBAR_GUARD_CLASS,
  WRAPPER_CLASS,
} from './dom-queries';
import { restoreSplitHeaderTitle, scheduleSplitHeaderSync } from './header-title-cloner';
import { restoreFooterActions, syncArticleFooterActions } from './footer-actions-cloner';
import { bindResizeHandler } from './resize-handler';
import { handleError } from '../error-handler';
import { markLayoutMutation } from './layout-mutation-tracker';

interface ActiveLayoutState {
  generation: number;
  active: boolean;
  splitSessionActive: boolean;
  topicId: string;
  wrapper: HTMLElement | null;
  stream: HTMLElement | null;
  articlePane: HTMLElement | null;
  mainPost: HTMLElement | null;
  mainPostNextSibling: ChildNode | null;
  previousStreamAriaLabel: string | null;
  revealTimer: ReturnType<typeof setTimeout> | null;
  sidebarGuardTimer: ReturnType<typeof setTimeout> | null;
}

const layoutState: ActiveLayoutState = {
  generation: 0,
  active: false,
  splitSessionActive: false,
  topicId: '',
  wrapper: null,
  stream: null,
  articlePane: null,
  mainPost: null,
  mainPostNextSibling: null,
  previousStreamAriaLabel: null,
  revealTimer: null,
  sidebarGuardTimer: null,
};

function getNativeStream(): HTMLElement | null {
  if (layoutState.stream?.isConnected) return layoutState.stream;
  return (
    document.querySelector<HTMLElement>(`.${NATIVE_STREAM_CLASS}`) ||
    document.querySelector<HTMLElement>('#post_stream') ||
    document.querySelector<HTMLElement>('#post-stream') ||
    document.querySelector<HTMLElement>('.post-stream') ||
    document.querySelector<HTMLElement>('.topic-posts')
  );
}

function getNativeMainPost(stream: HTMLElement | null): HTMLElement | null {
  const numberedMainPost = stream?.querySelector<HTMLElement>(
    ':scope > [data-post-number="1"].topic-post, :scope > .topic-post[data-post-number="1"]',
  );
  if (numberedMainPost) return numberedMainPost;

  const firstPost = stream?.querySelector<HTMLElement>(
    ':scope > [data-post-id].topic-post, :scope > .topic-post',
  );
  if (!firstPost || firstPost.getAttribute('data-post-number')) return null;
  return firstPost;
}

function revealPreparedLayout(): void {
  document.documentElement.classList.remove(PREPARING_ROOT_CLASS);
  if (layoutState.revealTimer) {
    clearTimeout(layoutState.revealTimer);
    layoutState.revealTimer = null;
  }
}

export function prepareTopicSplitLayout(): void {
  if (!discourse.getTopicId()) return;
  document.documentElement.classList.add(PREPARING_ROOT_CLASS);
  if (layoutState.revealTimer) clearTimeout(layoutState.revealTimer);
  layoutState.revealTimer = setTimeout(revealPreparedLayout, 2000);
}

function releaseSidebarGuard(toggle: HTMLElement, attempt = 0): void {
  if (toggle.getAttribute('aria-expanded') === 'false' || attempt >= 12) {
    document.body?.classList.remove(SIDEBAR_GUARD_CLASS, 'sidebar-animate');
    layoutState.sidebarGuardTimer = null;
    return;
  }

  layoutState.sidebarGuardTimer = setTimeout(() => releaseSidebarGuard(toggle, attempt + 1), 16);
}

function collapseSidebarOnce(): void {
  if (layoutState.splitSessionActive) return;

  const toggle = document.querySelector<HTMLElement>(
    'button.btn-sidebar-toggle[aria-controls], button.btn-sidebar-toggle',
  );
  const expanded = toggle?.getAttribute('aria-expanded');
  if (!toggle || (expanded !== 'true' && expanded !== 'false')) return;

  layoutState.splitSessionActive = true;
  if (expanded === 'false') return;

  document.body.classList.add(SIDEBAR_GUARD_CLASS);
  toggle.click();
  releaseSidebarGuard(toggle);
}

function createSplitShell(stream: HTMLElement): {
  wrapper: HTMLElement;
  articlePane: HTMLElement;
} {
  const parent = stream.parentElement;
  if (!parent) throw new Error('评论列表尚未挂载');

  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_CLASS;

  const articlePane = document.createElement('aside');
  articlePane.className = ARTICLE_PANE_CLASS;
  articlePane.setAttribute('aria-label', '文章内容');

  markLayoutMutation(wrapper, articlePane, stream);
  parent.insertBefore(wrapper, stream);
  wrapper.append(articlePane, stream);
  return { wrapper, articlePane };
}

function restoreMainPost(): void {
  const { stream, mainPost, mainPostNextSibling } = layoutState;
  if (!stream?.isConnected || !mainPost) return;

  const replacement = getNativeMainPost(stream);
  if (replacement && replacement !== mainPost) {
    markLayoutMutation(mainPost);
    mainPost.remove();
    return;
  }
  mainPost.classList.remove(ORIGINAL_MAIN_POST_CLASS);
  if (mainPost.parentElement === stream) return;

  const anchor =
    mainPostNextSibling?.parentNode === stream ? mainPostNextSibling : stream.firstChild;
  markLayoutMutation(mainPost);
  stream.insertBefore(mainPost, anchor);
}

function clearLayoutState(endSession: boolean): void {
  layoutState.active = false;
  if (endSession) layoutState.splitSessionActive = false;
  layoutState.topicId = '';
  layoutState.wrapper = null;
  layoutState.stream = null;
  layoutState.articlePane = null;
  layoutState.mainPost = null;
  layoutState.mainPostNextSibling = null;
  layoutState.previousStreamAriaLabel = null;
}

function restoreOrphanedLayout(): void {
  const wrapper = document.querySelector<HTMLElement>(`.${WRAPPER_CLASS}`);
  const stream = wrapper?.querySelector<HTMLElement>(
    `:scope > .${NATIVE_STREAM_CLASS}, :scope > .post-stream, :scope > #post_stream`,
  );
  const articlePane = wrapper?.querySelector<HTMLElement>(`:scope > .${ARTICLE_PANE_CLASS}`);
  const movedMain = articlePane?.querySelector<HTMLElement>(`.${ORIGINAL_MAIN_POST_CLASS}`);

  restoreFooterActions();
  if (stream && movedMain && !getNativeMainPost(stream)) {
    movedMain.classList.remove(ORIGINAL_MAIN_POST_CLASS);
    markLayoutMutation(movedMain);
    stream.insertBefore(movedMain, stream.firstChild);
  }
  markLayoutMutation(articlePane);
  articlePane?.remove();
  const legacyCommentsPane = wrapper?.querySelector(':scope > .ldtk-topic-comments-pane');
  markLayoutMutation(legacyCommentsPane);
  legacyCommentsPane?.remove();
  wrapper
    ?.querySelectorAll(':scope > .ldtk-paged-comment, :scope > .ldtk-comments-pager')
    .forEach((el) => {
      markLayoutMutation(el);
      el.remove();
    });

  if (wrapper?.parentElement && stream) {
    markLayoutMutation(stream, wrapper);
    wrapper.parentElement.insertBefore(stream, wrapper);
    wrapper.remove();
  }

  stream?.classList.remove(NATIVE_STREAM_CLASS, COMMENTS_STREAM_CLASS);
  stream?.removeAttribute('aria-hidden');
  stream?.removeAttribute('aria-label');
  restoreSplitHeaderTitle();
  document.body?.classList.remove(BODY_CLASS, SIDEBAR_GUARD_CLASS, 'sidebar-animate');
}

function teardownCurrentLayout(endSession: boolean): void {
  if (!layoutState.active) {
    if (document.body?.classList.contains(BODY_CLASS)) restoreOrphanedLayout();
    if (endSession) layoutState.splitSessionActive = false;
    revealPreparedLayout();
    return;
  }

  const { wrapper, stream, articlePane, previousStreamAriaLabel } = layoutState;
  restoreFooterActions();
  restoreMainPost();
  markLayoutMutation(articlePane);
  articlePane?.remove();

  if (stream) {
    stream.classList.remove(NATIVE_STREAM_CLASS, COMMENTS_STREAM_CLASS);
    stream.removeAttribute('aria-hidden');
    if (previousStreamAriaLabel === null) stream.removeAttribute('aria-label');
    else stream.setAttribute('aria-label', previousStreamAriaLabel);
  }

  if (wrapper?.parentElement && stream?.parentElement === wrapper) {
    markLayoutMutation(stream, wrapper);
    wrapper.parentElement.insertBefore(stream, wrapper);
    wrapper.remove();
  } else if (wrapper && !wrapper.children.length) {
    wrapper.remove();
  }

  restoreSplitHeaderTitle();
  document.body.classList.remove(BODY_CLASS, SIDEBAR_GUARD_CLASS, 'sidebar-animate');
  if (layoutState.sidebarGuardTimer) {
    clearTimeout(layoutState.sidebarGuardTimer);
    layoutState.sidebarGuardTimer = null;
  }
  clearLayoutState(endSession);
  revealPreparedLayout();
}

function isCurrentLayoutIntact(topicId: string): boolean {
  return Boolean(
    layoutState.active &&
    layoutState.topicId === topicId &&
    layoutState.wrapper?.isConnected &&
    layoutState.stream?.isConnected &&
    layoutState.articlePane?.isConnected &&
    layoutState.mainPost?.parentElement === layoutState.articlePane &&
    !getNativeMainPost(layoutState.stream),
  );
}

function activateLayout(stream: HTMLElement, mainPost: HTMLElement, topicId: string): void {
  collapseSidebarOnce();
  const mainPostNextSibling = mainPost.nextSibling;
  const previousStreamAriaLabel = stream.getAttribute('aria-label');
  const { wrapper, articlePane } = createSplitShell(stream);

  layoutState.active = true;
  layoutState.topicId = topicId;
  layoutState.wrapper = wrapper;
  layoutState.stream = stream;
  layoutState.articlePane = articlePane;
  layoutState.mainPost = mainPost;
  layoutState.mainPostNextSibling = mainPostNextSibling;
  layoutState.previousStreamAriaLabel = previousStreamAriaLabel;

  mainPost.classList.add(ORIGINAL_MAIN_POST_CLASS);
  markLayoutMutation(mainPost);
  articlePane.appendChild(mainPost);
  stream.classList.add(NATIVE_STREAM_CLASS, COMMENTS_STREAM_CLASS);
  stream.removeAttribute('aria-hidden');
  stream.setAttribute('aria-label', '评论列表');
  syncArticleFooterActions(articlePane);

  document.body.classList.add(BODY_CLASS);
  scheduleSplitHeaderSync();
  updateSplitPaneHeight(wrapper);
  revealPreparedLayout();
}

export function updateSplitPaneHeight(wrapper: HTMLElement | null): void {
  if (!wrapper?.isConnected) return;
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const wrapperTop = wrapper.getBoundingClientRect().top;
  const headerBottom =
    document.querySelector<HTMLElement>('.d-header')?.getBoundingClientRect().bottom || 0;
  const paneTop = Math.max(0, wrapperTop, headerBottom);
  const height = Math.max(320, viewportHeight - paneTop - 8);
  wrapper.style.setProperty('--ldtk-topic-top-offset', `${paneTop}px`);
  wrapper.style.setProperty('--ldtk-split-pane-height', `${height}px`);
}

export function restoreTopicSplitLayout(): void {
  layoutState.generation += 1;
  teardownCurrentLayout(true);
}

export async function applyTopicSplitLayout(settings?: DiscourseSettings): Promise<void> {
  const generation = ++layoutState.generation;
  const currentSettings = settings || (await getCachedSettings());
  if (generation !== layoutState.generation) return;

  const topicId = discourse.getTopicId();
  if (!currentSettings.enableSplitLayout || !topicId) {
    teardownCurrentLayout(true);
    return;
  }

  try {
    if (isCurrentLayoutIntact(topicId)) {
      collapseSidebarOnce();
      syncArticleFooterActions(layoutState.articlePane);
      updateSplitPaneHeight(layoutState.wrapper);
      revealPreparedLayout();
      return;
    }

    if (layoutState.active) {
      prepareTopicSplitLayout();
      teardownCurrentLayout(false);
    } else if (document.body.classList.contains(BODY_CLASS)) restoreOrphanedLayout();

    const stream = getNativeStream();
    const mainPost = getNativeMainPost(stream);
    if (!stream || !mainPost) return;
    activateLayout(stream, mainPost, topicId);
  } catch (err) {
    handleError(err, '分栏布局');
    teardownCurrentLayout(false);
  }
}

bindResizeHandler();

export const layout = {
  applyTopicSplitLayout,
  prepareTopicSplitLayout,
  restoreTopicSplitLayout,
};
