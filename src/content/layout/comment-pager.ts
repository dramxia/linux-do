/* Linux.do 工具箱 — 评论分页状态机与加载编排 */
import * as discourse from '../discourse';
import type { DiscoursePost, TopicJson } from '../discourse';
import * as buttons from '../buttons';
import {
  COMMENTS_PANE_CLASS,
  PAGED_COMMENT_CLASS,
  PAGE_SIZE,
  PAGER_BUTTON_CLASS,
  PAGER_CLASS,
  PAGER_INFO_CLASS,
} from './dom-queries';
import { createPostFromJson } from './post-renderer';

// 分页状态封装为类实例。原先为模块级 const 对象 + 4 个 let 变量；
// 现在收敛为单一 PagerState 实例，destroy() 提供显式重置入口。
export class PagerState {
  topicId = '';
  page = 1;
  postIds: Array<string | number> = [];
  postsById = new Map<number, DiscoursePost>();
  loading = false;

  reset(topicId: string | null): void {
    this.topicId = topicId || '';
    this.page = 1;
    this.postIds = [];
    this.postsById.clear();
    this.loading = false;
    document.querySelectorAll<HTMLElement>(`.${COMMENTS_PANE_CLASS}`).forEach((stream) => {
      stream.removeAttribute('data-ldtk-pager-topic-id');
      stream.removeAttribute('data-ldtk-pager-page');
      stream.removeAttribute('data-ldtk-pager-key');
    });
  }

  destroy(): void {
    this.topicId = '';
    this.page = 1;
    this.postIds = [];
    this.postsById.clear();
    this.loading = false;
  }
}

const pagerState = new PagerState();

function resetPager(topicId: string | null): void {
  pagerState.reset(topicId);
}

function getTotalPages(): number {
  return Math.max(1, Math.ceil(Math.max(0, pagerState.postIds.length - 1) / PAGE_SIZE));
}

function shouldShowPager(): boolean {
  return getTotalPages() > 1;
}

function getPagePostIds(page: number): Array<string | number> {
  const commentIds = pagerState.postIds.slice(1);
  const start = (page - 1) * PAGE_SIZE;
  return commentIds.slice(start, start + PAGE_SIZE);
}

function getPageKey(page: number = pagerState.page): string {
  return getPagePostIds(page).join(',');
}

function isCurrentPageRendered(stream: HTMLElement): boolean {
  return (
    stream.getAttribute('data-ldtk-pager-topic-id') === pagerState.topicId &&
    stream.getAttribute('data-ldtk-pager-page') === String(pagerState.page) &&
    stream.getAttribute('data-ldtk-pager-key') === getPageKey()
  );
}

function setPagerStatus(stream: HTMLElement, text: string, isError = false): void {
  const infoEl = stream.parentElement?.querySelector<HTMLElement>(`.${PAGER_INFO_CLASS}`);
  if (!infoEl) return;
  infoEl.textContent = text;
  infoEl.classList.toggle('is-error', isError);
}

function updatePagerButtons(stream: HTMLElement): void {
  const totalPages = getTotalPages();
  const prevBtn = stream.parentElement?.querySelector<HTMLButtonElement>('[data-ldtk-pager-action="prev"]');
  const nextBtn = stream.parentElement?.querySelector<HTMLButtonElement>('[data-ldtk-pager-action="next"]');

  if (prevBtn) prevBtn.disabled = pagerState.loading || pagerState.page <= 1;
  if (nextBtn) nextBtn.disabled = pagerState.loading || pagerState.page >= totalPages;
}

function removePager(stream: HTMLElement): void {
  stream.parentElement?.querySelector(`:scope > .${PAGER_CLASS}`)?.remove();
}

function resetCommentsScroll(stream: HTMLElement): void {
  // 分页切换后立即回到评论栏顶部，避免平滑滚动带来的等待感。
  stream.scrollTop = 0;
}

function removePagedComments(stream: HTMLElement): void {
  stream.querySelectorAll(`:scope > .${PAGED_COMMENT_CLASS}`).forEach((postEl) => postEl.remove());
}

function renderCurrentPage(stream: HTMLElement): void {
  removePagedComments(stream);

  const postIds = getPagePostIds(pagerState.page);
  const fragment = document.createDocumentFragment();

  postIds.forEach((postId) => {
    const post = pagerState.postsById.get(Number(postId));
    if (post) fragment.appendChild(createPostFromJson(post));
  });

  stream.appendChild(fragment);

  const totalPages = getTotalPages();
  const commentCount = Math.max(0, pagerState.postIds.length - 1);
  stream.setAttribute('data-ldtk-pager-topic-id', pagerState.topicId);
  stream.setAttribute('data-ldtk-pager-page', String(pagerState.page));
  stream.setAttribute('data-ldtk-pager-key', getPageKey());

  if (!shouldShowPager()) {
    removePager(stream);
    return;
  }

  ensurePager(stream);
  setPagerStatus(stream, `第 ${pagerState.page} / ${totalPages} 页，共 ${commentCount} 条评论`);
  updatePagerButtons(stream);
}

function ensurePager(stream: HTMLElement): HTMLElement | null {
  const pane = stream.parentElement;
  if (!pane) return null;

  let pager = pane.querySelector<HTMLElement>(`:scope > .${PAGER_CLASS}`);

  if (!pager) {
    pager = document.createElement('nav');
    pager.className = PAGER_CLASS;
    pager.setAttribute('aria-label', '评论分页');
    pager.innerHTML = `
      <button class="${PAGER_BUTTON_CLASS}" type="button" data-ldtk-pager-action="prev">上一页</button>
      <span class="${PAGER_INFO_CLASS}">正在加载评论...</span>
      <button class="${PAGER_BUTTON_CLASS}" type="button" data-ldtk-pager-action="next">下一页</button>
    `;

    pager.addEventListener('click', (event) => {
      const target = event.target as Element;
      const button = target.closest('[data-ldtk-pager-action]');
      if (!button || pagerState.loading) return;

      const action = button.getAttribute('data-ldtk-pager-action');
      loadPage(stream, pagerState.page + (action === 'next' ? 1 : -1));
    });

    pane.appendChild(pager);
  }

  return pager;
}

async function loadPage(stream: HTMLElement, page: number): Promise<void> {
  const totalPages = getTotalPages();
  const nextPage = Math.min(Math.max(1, page), totalPages);
  const shouldResetScroll = nextPage !== pagerState.page;
  const postIds = getPagePostIds(nextPage);
  const missingIds = postIds.filter((postId) => !pagerState.postsById.has(Number(postId)));

  pagerState.loading = true;
  if (shouldShowPager()) {
    ensurePager(stream);
    updatePagerButtons(stream);
    setPagerStatus(stream, '正在加载评论...');
  } else {
    removePager(stream);
  }

  try {
    if (missingIds.length) {
      const posts = await discourse.fetchPostsByIds(pagerState.topicId, missingIds);
      posts.forEach((post) => {
        if (post?.id) pagerState.postsById.set(Number(post.id), post);
      });
    }

    pagerState.page = nextPage;
    renderCurrentPage(stream);
    if (shouldResetScroll) resetCommentsScroll(stream);
    buttons.injectButtons?.();
  } catch (err) {
    setPagerStatus(stream, `评论加载失败：${(err as Error)?.message || '未知错误'}`, true);
  } finally {
    pagerState.loading = false;
    updatePagerButtons(stream);
  }
}

async function ensureCommentPager(stream: HTMLElement, topicId: string): Promise<void> {
  if (pagerState.topicId !== topicId) resetPager(topicId);

  if (!pagerState.postIds.length && !pagerState.loading) {
    pagerState.loading = true;

    try {
      const topic = await discourse.fetchTopicJson(topicId);
      pagerState.postIds = topic?.post_stream?.stream || [];
      (topic?.post_stream?.posts || []).forEach((post) => {
        if (post?.id) pagerState.postsById.set(Number(post.id), post);
      });
    } catch (err) {
      ensurePager(stream);
      setPagerStatus(stream, `评论初始化失败：${(err as Error)?.message || '未知错误'}`, true);
      return;
    } finally {
      pagerState.loading = false;
    }
  }

  if (!pagerState.postIds.length) {
    removePager(stream);
    return;
  }

  if (!stream.querySelector(`:scope > .${PAGED_COMMENT_CLASS}`)) {
    await loadPage(stream, pagerState.page);
  } else if (isCurrentPageRendered(stream)) {
    const totalPages = getTotalPages();
    const commentCount = Math.max(0, pagerState.postIds.length - 1);
    if (!shouldShowPager()) {
      removePager(stream);
      return;
    }

    ensurePager(stream);
    setPagerStatus(stream, `第 ${pagerState.page} / ${totalPages} 页，共 ${commentCount} 条评论`);
    updatePagerButtons(stream);
  } else {
    renderCurrentPage(stream);
  }
}

export async function loadTopicSnapshot(topicId: string): Promise<TopicJson | undefined> {
  const topic = await discourse.fetchTopicJson(topicId);
  const posts = topic?.post_stream?.posts || [];
  pagerState.postIds = topic?.post_stream?.stream || posts.map((post) => post.id).filter((id): id is number => typeof id === 'number');
  posts.forEach((post) => {
    if (post?.id) pagerState.postsById.set(Number(post.id), post);
  });
  return topic;
}

export {
  pagerState,
  resetPager,
  ensureCommentPager,
  createPostFromJson,
};
