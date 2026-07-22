/* Linux.do 工具箱 — split-pane 容器/高度/文章面板克隆/顶层编排/拆除恢复/原生主帖探测 */
import * as discourse from '../discourse';
import { getSettings as _getSettings } from '../../common/settings';
import {
  ARTICLE_CLONE_CLASS,
  ARTICLE_PANE_CLASS,
  BODY_CLASS,
  COMMENTS_PANE_CLASS,
  COMMENTS_STREAM_CLASS,
  NATIVE_STREAM_CLASS,
  ORIGINAL_MAIN_POST_CLASS,
  PAGED_COMMENT_CLASS,
  PAGER_CLASS,
  WRAPPER_CLASS,
} from './dom-queries';
import {
  bindTopicMetaObserver,
  syncArticleTopicMeta,
} from './topic-meta-cloner';
import {
  restoreSplitHeaderTitle,
  scheduleSplitHeaderSync,
} from './header-title-cloner';
import {
  createPostFromJson,
  ensureCommentPager,
  loadTopicSnapshot,
  pagerState,
  resetPager,
} from './comment-pager';
import { restoreFooterActions, syncArticleFooterActions } from './footer-actions-cloner';
import { bindResizeHandler } from './resize-handler';

function getSplitWrapper(stream: HTMLElement | null): HTMLElement | null {
  if (!stream?.parentElement) return null;
  if (stream.parentElement.classList.contains(WRAPPER_CLASS)) {
    return stream.parentElement;
  }

  const wrapper = document.createElement('div');
  wrapper.className = WRAPPER_CLASS;
  stream.parentElement.insertBefore(wrapper, stream);
  wrapper.appendChild(stream);
  return wrapper;
}

function getNativeStream(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`.${NATIVE_STREAM_CLASS}`) ||
    document.querySelector<HTMLElement>('#post_stream') ||
    document.querySelector<HTMLElement>('.post-stream') ||
    document.querySelector<HTMLElement>('.topic-posts')
  );
}

export function updateSplitPaneHeight(wrapper: HTMLElement | null): void {
  if (!wrapper) return;

  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const wrapperTop = Math.max(0, wrapper.getBoundingClientRect().top);
  const height = Math.max(320, viewportHeight - wrapperTop - 8);
  wrapper.style.setProperty('--ldtk-split-pane-height', `${height}px`);
}

function stripCloneUnsafeNodes(clone: HTMLElement): void {
  clone.querySelectorAll([
    '.ldcopy-actions',
    '.topic-map',
    '.embedded-posts',
    'script',
    'style',
  ].join(',')).forEach((el) => el.remove());

  clone.querySelectorAll('[id]').forEach((el) => {
    el.removeAttribute('id');
  });
}

function buildArticleClone(mainPost: HTMLElement): HTMLElement {
  const clone = mainPost.cloneNode(true) as HTMLElement;
  clone.classList.add(ARTICLE_CLONE_CLASS);
  clone.classList.remove(ORIGINAL_MAIN_POST_CLASS);
  clone.removeAttribute('id');
  stripCloneUnsafeNodes(clone);
  return clone;
}

function ensureArticlePane(wrapper: HTMLElement, stream: HTMLElement): HTMLElement {
  let pane = wrapper.querySelector<HTMLElement>(`:scope > .${ARTICLE_PANE_CLASS}`);

  if (!pane) {
    pane = document.createElement('aside');
    pane.className = ARTICLE_PANE_CLASS;
    pane.setAttribute('aria-label', '文章内容');
    wrapper.insertBefore(pane, stream);
  }

  return pane;
}

function ensureCommentsPane(wrapper: HTMLElement): HTMLElement {
  let pane = wrapper.querySelector<HTMLElement>(`:scope > .${COMMENTS_PANE_CLASS}`);

  if (!pane) {
    pane = document.createElement('section');
    pane.className = COMMENTS_PANE_CLASS;
    pane.setAttribute('aria-label', '评论分页');
    wrapper.appendChild(pane);
  }

  pane.classList.remove(COMMENTS_STREAM_CLASS);
  return pane;
}

function ensureCommentsStream(pane: HTMLElement): HTMLElement {
  let stream = pane.querySelector<HTMLElement>(`:scope > .${COMMENTS_STREAM_CLASS}`);

  if (!stream) {
    stream = document.createElement('div');
    stream.className = COMMENTS_STREAM_CLASS;
    pane.insertBefore(stream, pane.firstChild);
  }

  Array.from(pane.children).forEach((child) => {
    if (
      child !== stream &&
      !child.classList.contains(PAGER_CLASS)
    ) {
      stream!.appendChild(child);
    }
  });

  return stream;
}

function syncArticlePane(pane: HTMLElement, mainPost: HTMLElement): void {
  const postId = mainPost.getAttribute('data-post-id') || '';
  const currentPostId = pane.getAttribute('data-source-post-id') || '';

  if (currentPostId !== postId || !pane.querySelector(`.${ARTICLE_CLONE_CLASS}`)) {
    restoreFooterActions();
    pane.replaceChildren(buildArticleClone(mainPost));
    pane.setAttribute('data-source-post-id', postId);
  }

  syncArticleTopicMeta(pane);
  syncArticleFooterActions(pane);
}

function showArticleLoading(pane: HTMLElement): void {
  if (pane.querySelector(`.${ARTICLE_CLONE_CLASS}`)) return;
  restoreFooterActions();
  const placeholder = document.createElement('div');
  placeholder.className = ARTICLE_CLONE_CLASS;
  placeholder.textContent = '正在加载正文...';
  pane.replaceChildren(placeholder);
  pane.removeAttribute('data-source-post-id');
}

function getNativeMainPost(nativeStream: HTMLElement | null): HTMLElement | null {
  return (
    nativeStream?.querySelector?.<HTMLElement>('[data-post-number="1"].topic-post, .topic-post[data-post-number="1"]') ||
    nativeStream?.querySelector?.<HTMLElement>('[data-post-id].topic-post, .topic-post') ||
    null
  );
}

async function ensureSplitFromTopic(wrapper: HTMLElement, nativeStream: HTMLElement, topicId: string): Promise<void> {
  const articlePane = ensureArticlePane(wrapper, nativeStream);
  const commentsPane = ensureCommentsPane(wrapper);
  const commentsStream = ensureCommentsStream(commentsPane);

  document.body.classList.add(BODY_CLASS);
  scheduleSplitHeaderSync();
  bindTopicMetaObserver();
  nativeStream.classList.add(NATIVE_STREAM_CLASS);
  nativeStream.setAttribute('aria-hidden', 'true');
  showArticleLoading(articlePane);
  updateSplitPaneHeight(wrapper);

  try {
    if (pagerState.topicId !== topicId || !pagerState.postIds.length) {
      resetPager(topicId);
      await loadTopicSnapshot(topicId);
    }

    const firstPost = pagerState.postsById.get(Number(pagerState.postIds[0]));
    const mainPost = getNativeMainPost(nativeStream) || (firstPost ? createPostFromJson(firstPost) : null);
    if (!mainPost) throw new Error('未找到主题正文');

    syncArticlePane(articlePane, mainPost);
    updateSplitPaneHeight(wrapper);
    await ensureCommentPager(commentsStream, topicId);
    updateSplitPaneHeight(wrapper);
    setTimeout(() => updateSplitPaneHeight(wrapper), 250);
  } catch (err) {
    // 任何接口或 DOM 适配异常都回退到站点原生布局，避免留下半初始化页面。
    restoreTopicSplitLayout();
    throw err;
  }
}

export function restoreTopicSplitLayout(): void {
  document.body.classList.remove(BODY_CLASS);
  restoreSplitHeaderTitle();

  document.querySelectorAll(`.${ARTICLE_PANE_CLASS}`).forEach((pane) => pane.remove());
  document.querySelectorAll(`.${COMMENTS_PANE_CLASS}`).forEach((pane) => pane.remove());
  document.querySelectorAll(`.${PAGER_CLASS}`).forEach((pager) => pager.remove());
  document.querySelectorAll(`.${PAGED_COMMENT_CLASS}`).forEach((postEl) => postEl.remove());
  document.querySelectorAll<HTMLElement>(`.${NATIVE_STREAM_CLASS}`).forEach((stream) => {
    stream.classList.remove(NATIVE_STREAM_CLASS);
    stream.removeAttribute('aria-hidden');
    if (stream.parentElement?.classList.contains(WRAPPER_CLASS)) {
      stream.parentElement.parentElement?.insertBefore(stream, stream.parentElement);
    }
  });
  document.querySelectorAll<HTMLElement>(`.${WRAPPER_CLASS}`).forEach((wrapper) => {
    if (!wrapper.children.length) wrapper.remove();
    else wrapper.classList.remove(WRAPPER_CLASS);
  });
  document.querySelectorAll(`.${COMMENTS_STREAM_CLASS}`).forEach((stream) => stream.classList.remove(COMMENTS_STREAM_CLASS));
  document.querySelectorAll<HTMLElement>(`.${ORIGINAL_MAIN_POST_CLASS}`).forEach((postEl) => {
    postEl.classList.remove(ORIGINAL_MAIN_POST_CLASS);
    postEl.removeAttribute('aria-hidden');
  });
}

export async function applyTopicSplitLayout(): Promise<void> {
  const settings = await _getSettings();
  const topicId = discourse.getTopicId();

  if (!settings.enableSplitLayout || !topicId) {
    restoreTopicSplitLayout();
    return;
  }

  const stream = getNativeStream();
  const wrapper = getSplitWrapper(stream);
  if (!stream || !wrapper) return;

  await ensureSplitFromTopic(wrapper, stream, topicId);
}

bindResizeHandler();

export const layout = {
  applyTopicSplitLayout,
  restoreTopicSplitLayout,
};
