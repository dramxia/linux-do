/* Linux.do 工具箱 — 主题分栏布局模块 */
import * as discourse from './discourse';
import type { DiscoursePost, TopicJson } from './discourse';
import * as buttons from './buttons';
import { getSettings as _getSettings } from '../common/settings';

interface PagerState {
  topicId: string;
  page: number;
  postIds: Array<string | number>;
  postsById: Map<number, DiscoursePost>;
  loading: boolean;
}

const BODY_CLASS = 'ldtk-topic-split-active';
  const WRAPPER_CLASS = 'ldtk-topic-split-wrapper';
  const ARTICLE_PANE_CLASS = 'ldtk-topic-article-pane';
  const ARTICLE_CLONE_CLASS = 'ldtk-topic-article-clone';
  const COMMENTS_PANE_CLASS = 'ldtk-topic-comments-pane';
  const COMMENTS_STREAM_CLASS = 'ldtk-topic-comments-stream';
  const HEADER_TITLE_CLASS = 'ldtk-topic-header-title';
  const HEADER_TITLE_INNER_CLASS = 'ldtk-topic-header-title-inner';
  const HEADER_META_CLASS = 'ldtk-topic-header-meta';
  const HEADER_META_INNER_CLASS = 'ldtk-topic-header-meta-inner';
  const ARTICLE_META_CLASS = 'ldtk-topic-article-meta';
  const ARTICLE_META_INNER_CLASS = 'ldtk-topic-article-meta-inner';
  const ARTICLE_ACTIONS_CLASS = 'ldtk-topic-article-actions';
  const FOOTER_ACTIONS_SOURCE_ATTR = 'data-ldtk-footer-actions-source';
  const FOOTER_ACTIONS_PLACEHOLDER_ATTR = 'data-ldtk-footer-actions-placeholder';
  const TOPIC_META_SOURCE_ATTR = 'data-ldtk-topic-meta-source';
  const NATIVE_STREAM_CLASS = 'ldtk-topic-native-stream';
  const ORIGINAL_MAIN_POST_CLASS = 'ldtk-topic-original-main-post';
  const PAGED_COMMENT_CLASS = 'ldtk-paged-comment';
  const PAGER_CLASS = 'ldtk-comments-pager';
  const PAGER_INFO_CLASS = 'ldtk-comments-pager-info';
  const PAGER_BUTTON_CLASS = 'ldtk-comments-pager-button';
  const PAGE_SIZE = 20;
  const TOPIC_META_SELECTORS = [
    '.topic-map',
    '.topic-map-expanded',
    '.topic-map__contents',
    '.topic-map-section',
    '.topic-map-summary',
    '.topic-map-stats',
    '.topic-map__stats',
    '.topic-stats',
  ];
  const FOOTER_ACTIONS_SELECTORS = '#topic-footer-buttons, .topic-footer-main-buttons';

  const pagerState: PagerState = {
    topicId: '',
    page: 1,
    postIds: [],
    postsById: new Map<number, DiscoursePost>(),
    loading: false,
  };

  let topicMetaObserver: MutationObserver | null = null;
  let topicMetaSyncTimer: ReturnType<typeof setTimeout> | null = null;

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
      document.querySelector<HTMLElement>('#post-stream') ||
      document.querySelector<HTMLElement>('.post-stream') ||
      document.querySelector<HTMLElement>('.topic-posts')
    );
  }

  function updateSplitPaneHeight(wrapper: HTMLElement | null): void {
    if (!wrapper) return;

    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const wrapperTop = Math.max(0, wrapper.getBoundingClientRect().top);
    const height = Math.max(320, viewportHeight - wrapperTop - 8);
    wrapper.style.setProperty('--ldtk-split-pane-height', `${height}px`);
  }

  function getHeaderTitleMount(): HTMLElement | null {
    return (
      document.querySelector<HTMLElement>('.d-header .contents') ||
      document.querySelector<HTMLElement>('header.d-header .contents') ||
      document.querySelector<HTMLElement>('.d-header')
    );
  }

  function stripHeaderCloneUnsafeNodes(clone: HTMLElement): void {
    clone.querySelectorAll([
      'script',
      'style',
      '.edit-topic',
      '.topic-statuses',
      '.topic-notifications-button',
    ].join(',')).forEach((el) => el.remove());

    clone.querySelectorAll('[id]').forEach((el) => {
      el.removeAttribute('id');
    });
  }

  function findTopicMetaSource(): Element | null {
    const directMatch = Array.from(document.querySelectorAll(TOPIC_META_SELECTORS.join(','))).find((el) => (
      !el.closest(`.${HEADER_META_CLASS}`) &&
      !el.closest(`.${ARTICLE_PANE_CLASS}`) &&
      !el.closest(`.${COMMENTS_PANE_CLASS}`)
    ));

    if (directMatch) return directMatch;

    return Array.from(document.querySelectorAll('#main-outlet .container.posts > .row > *, .topic-area > *')).find((el) => {
      if (
        el.closest(`.${HEADER_META_CLASS}`) ||
        el.closest(`.${ARTICLE_PANE_CLASS}`) ||
        el.closest(`.${COMMENTS_PANE_CLASS}`) ||
        el.matches('#topic-title')
      ) {
        return false;
      }

      const text = el.textContent || '';
      const hasStatsText = ['浏览量', '赞', '链接', '用户'].filter((label) => text.includes(label)).length >= 2;
      const hasAvatars = el.querySelectorAll('img.avatar, .avatar').length >= 2;
      const hasSummary = Boolean(el.querySelector('[title*="总结"], button, .btn'));
      return hasStatsText && (hasAvatars || hasSummary);
    }) || null;
  }

  function stripHeaderMetaCloneUnsafeNodes(clone: HTMLElement): void {
    clone.querySelectorAll([
      'script',
      'style',
      '[id]',
    ].join(',')).forEach((el) => {
      if (el.matches('script, style')) {
        el.remove();
        return;
      }
      el.removeAttribute('id');
    });
  }

  function syncSplitHeaderMeta(mount: HTMLElement | null, headerTitle: HTMLElement | null): void {
    const source = findTopicMetaSource();
    if (!source || !mount) return;

    document.querySelectorAll(`[${TOPIC_META_SOURCE_ATTR}]`).forEach((el) => {
      if (el !== source) el.removeAttribute(TOPIC_META_SOURCE_ATTR);
    });
    source.setAttribute(TOPIC_META_SOURCE_ATTR, 'true');

    let headerMeta = mount.querySelector<HTMLElement>(`:scope > .${HEADER_META_CLASS}`);

    if (!headerMeta) {
      headerMeta = document.createElement('div');
      headerMeta.className = HEADER_META_CLASS;

      if (headerTitle?.parentElement === mount) {
        headerTitle.insertAdjacentElement('afterend', headerMeta);
      } else {
        mount.insertBefore(headerMeta, mount.children[2] || null);
      }
    }

    headerMeta.replaceChildren(buildTopicMetaClone(source, HEADER_META_INNER_CLASS));
  }

  function buildTopicMetaClone(source: Element, innerClass: string): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    clone.classList.add(innerClass);
    clone.removeAttribute('id');
    clone.removeAttribute(TOPIC_META_SOURCE_ATTR);
    stripHeaderMetaCloneUnsafeNodes(clone);
    return clone;
  }

  function syncArticleTopicMeta(pane: HTMLElement | null): void {
    if (!pane) return;

    const source = findTopicMetaSource();
    let articleMeta = pane.querySelector<HTMLElement>(`:scope > .${ARTICLE_META_CLASS}`);

    if (!source) {
      articleMeta?.remove();
      return;
    }

    if (!articleMeta) {
      articleMeta = document.createElement('section');
      articleMeta.className = ARTICLE_META_CLASS;
      articleMeta.setAttribute('aria-label', '主题统计与操作');
      pane.appendChild(articleMeta);
    }

    articleMeta.replaceChildren(buildTopicMetaClone(source, ARTICLE_META_INNER_CLASS));
  }

  function findFooterActionsSource(): HTMLElement | null {
    return Array.from(document.querySelectorAll(FOOTER_ACTIONS_SELECTORS)).find((el): el is HTMLElement => (
      el instanceof HTMLElement &&
      !el.closest(`.${ARTICLE_PANE_CLASS}`) &&
      !el.closest(`.${HEADER_META_CLASS}`) &&
      !el.closest(`.${COMMENTS_PANE_CLASS}`)
    )) || null;
  }

  function ensureFooterActionsPlaceholder(source: HTMLElement): HTMLElement {
    const existing = document.querySelector<HTMLElement>(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}="true"]`);
    if (existing) return existing;

    const placeholder = document.createElement('span');
    placeholder.hidden = true;
    placeholder.setAttribute(FOOTER_ACTIONS_PLACEHOLDER_ATTR, 'true');
    source.parentElement?.insertBefore(placeholder, source);
    return placeholder;
  }

  function syncArticleFooterActions(pane: HTMLElement | null): void {
    if (!pane) return;

    const movedSource = pane.querySelector<HTMLElement>(`:scope > .${ARTICLE_ACTIONS_CLASS} > [${FOOTER_ACTIONS_SOURCE_ATTR}="true"]`);
    const source = movedSource || findFooterActionsSource();
    let articleActions = pane.querySelector<HTMLElement>(`:scope > .${ARTICLE_ACTIONS_CLASS}`);

    if (!source) {
      articleActions?.remove();
      return;
    }

    if (!articleActions) {
      articleActions = document.createElement('section');
      articleActions.className = ARTICLE_ACTIONS_CLASS;
      articleActions.setAttribute('aria-label', '主题操作');
      pane.appendChild(articleActions);
    }

    if (!movedSource) {
      ensureFooterActionsPlaceholder(source);
      source.setAttribute(FOOTER_ACTIONS_SOURCE_ATTR, 'true');
      articleActions.appendChild(source);
    }
  }

  function restoreFooterActions(): void {
    const source = document.querySelector<HTMLElement>(`[${FOOTER_ACTIONS_SOURCE_ATTR}="true"]`);
    const placeholder = document.querySelector<HTMLElement>(`[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}="true"]`);

    if (source) {
      source.removeAttribute(FOOTER_ACTIONS_SOURCE_ATTR);
      if (placeholder?.parentElement) {
        placeholder.parentElement.insertBefore(source, placeholder);
      }
    }

    placeholder?.remove();
    document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`).forEach((el) => el.remove());
  }

  function syncSplitHeaderTitle(): void {
    const source = document.querySelector<HTMLElement>('#topic-title');
    const mount = getHeaderTitleMount();
    if (!source || !mount) return;

    let headerTitle = mount.querySelector<HTMLElement>(`:scope > .${HEADER_TITLE_CLASS}`);

    if (!headerTitle) {
      headerTitle = document.createElement('div');
      headerTitle.className = HEADER_TITLE_CLASS;

      const logoArea = mount.querySelector<HTMLElement>(':scope > .title, :scope > .home-logo-wrapper, :scope > .brand-header');
      if (logoArea) {
        logoArea.insertAdjacentElement('afterend', headerTitle);
      } else {
        mount.insertBefore(headerTitle, mount.children[1] || null);
      }
    }

    const clone = source.cloneNode(true) as HTMLElement;
    clone.className = HEADER_TITLE_INNER_CLASS;
    stripHeaderCloneUnsafeNodes(clone);
    headerTitle.replaceChildren(clone);
    syncSplitHeaderMeta(mount, headerTitle);
  }

  function syncSplitTopicMeta(): void {
    syncSplitHeaderTitle();
    document.querySelectorAll<HTMLElement>(`.${ARTICLE_PANE_CLASS}`).forEach((pane) => {
      syncArticleTopicMeta(pane);
      syncArticleFooterActions(pane);
    });
  }

  function scheduleSplitHeaderSync(): void {
    syncSplitTopicMeta();
    [100, 350, 800, 1500, 3000].forEach((delay) => {
      setTimeout(syncSplitTopicMeta, delay);
    });
  }

  function scheduleTopicMetaSync(delay = 80): void {
    if (topicMetaSyncTimer) clearTimeout(topicMetaSyncTimer);
    topicMetaSyncTimer = setTimeout(() => {
      topicMetaSyncTimer = null;
      syncSplitTopicMeta();
    }, delay);
  }

  function isNativeTopicMetaNode(node: Node): boolean {
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const el = node as Element;

    if (
      el.closest?.(`.${HEADER_META_CLASS}`) ||
      el.closest?.(`.${ARTICLE_PANE_CLASS}`) ||
      el.closest?.(`.${COMMENTS_PANE_CLASS}`)
    ) {
      return false;
    }

    const selectors = TOPIC_META_SELECTORS.join(',');
    return el.matches?.(selectors) || Boolean(el.querySelector?.(selectors));
  }

  function bindTopicMetaObserver(): void {
    if (topicMetaObserver) return;

    const target = document.querySelector<HTMLElement>('#main-outlet, #main, body') || document.body;
    topicMetaObserver = new MutationObserver((mutations) => {
      const shouldSync = mutations.some((mutation) => {
        const nodes: Node[] = [
          mutation.target,
          ...Array.from(mutation.addedNodes || []),
          ...Array.from(mutation.removedNodes || []),
        ];

        return nodes.some(isNativeTopicMetaNode);
      });

      if (shouldSync) scheduleTopicMetaSync();
    });

    topicMetaObserver.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function restoreSplitHeaderTitle(): void {
    if (topicMetaSyncTimer) {
      clearTimeout(topicMetaSyncTimer);
      topicMetaSyncTimer = null;
    }

    if (topicMetaObserver) {
      topicMetaObserver.disconnect();
      topicMetaObserver = null;
    }

    document.querySelectorAll(`.${HEADER_TITLE_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`.${HEADER_META_CLASS}`).forEach((el) => el.remove());
    document.querySelectorAll(`.${ARTICLE_META_CLASS}`).forEach((el) => el.remove());
    restoreFooterActions();
    document.querySelectorAll(`[${TOPIC_META_SOURCE_ATTR}]`).forEach((el) => {
      el.removeAttribute(TOPIC_META_SOURCE_ATTR);
    });
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

  function restoreTopicSplitLayout(): void {
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

  function resetPager(topicId: string | null): void {
    pagerState.topicId = topicId || '';
    pagerState.page = 1;
    pagerState.postIds = [];
    pagerState.postsById.clear();
    pagerState.loading = false;
    document.querySelectorAll<HTMLElement>(`.${COMMENTS_PANE_CLASS}`).forEach((stream) => {
      stream.removeAttribute('data-ldtk-pager-topic-id');
      stream.removeAttribute('data-ldtk-pager-page');
      stream.removeAttribute('data-ldtk-pager-key');
    });
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

  export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }[char] as string));
  }

  export function escapeAttr(value: unknown): string {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  function createPostFromJson(post: DiscoursePost): HTMLElement {
    const article = document.createElement('article');
    article.className = `topic-post ${PAGED_COMMENT_CLASS}`;
    article.setAttribute('data-post-id', String(post.id || ''));
    article.setAttribute('data-post-number', String(post.post_number || ''));

    const avatar = post.avatar_template
      ? post.avatar_template.replace('{size}', '45')
      : '';
    const createdAt = post.created_at || '';
    const cooked = post.cooked || '';

    article.innerHTML = `
      <div class="topic-avatar">
        ${avatar ? `<img class="avatar" width="45" height="45" src="${escapeAttr(avatar)}" alt="">` : ''}
      </div>
      <div class="topic-body">
        <div class="topic-meta-data">
          <span class="names">
            <span class="username">${escapeHtml(post.username || 'Unknown')}</span>
          </span>
          ${createdAt ? `<a class="post-date" href="#post-${escapeAttr(post.post_number || '')}"><time datetime="${escapeAttr(createdAt)}">${escapeHtml(createdAt.slice(0, 10))}</time></a>` : ''}
        </div>
        <div class="cooked">${cooked}</div>
        <section class="post-menu-area">
          <nav class="post-controls"></nav>
        </section>
      </div>
    `;

    return article;
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

  async function loadTopicSnapshot(topicId: string): Promise<TopicJson | undefined> {
    const topic = await discourse.fetchTopicJson(topicId);
    const posts = topic?.post_stream?.posts || [];
    pagerState.postIds = topic?.post_stream?.stream || posts.map((post) => post.id).filter((id): id is number => typeof id === 'number');
    posts.forEach((post) => {
      if (post?.id) pagerState.postsById.set(Number(post.id), post);
    });
    return topic;
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

  async function applyTopicSplitLayout(): Promise<void> {
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

  window.addEventListener('resize', () => {
    document.querySelectorAll<HTMLElement>(`.${WRAPPER_CLASS}`).forEach(updateSplitPaneHeight);
  });

  export const layout = {
    applyTopicSplitLayout,
    restoreTopicSplitLayout,
  };
