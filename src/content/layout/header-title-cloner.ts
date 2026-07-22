/* Linux.do 工具箱 — header-title 克隆与编排 */
import {
  ARTICLE_META_CLASS,
  ARTICLE_PANE_CLASS,
  HEADER_META_CLASS,
  HEADER_TITLE_CLASS,
  HEADER_TITLE_INNER_CLASS,
  TOPIC_META_SOURCE_ATTR,
} from './dom-queries';
import { syncSplitHeaderMeta, syncArticleTopicMeta, teardownTopicMetaObserver } from './topic-meta-cloner';
import { syncArticleFooterActions, restoreFooterActions } from './footer-actions-cloner';

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

export function syncSplitTopicMeta(): void {
  syncSplitHeaderTitle();
  document.querySelectorAll<HTMLElement>(`.${ARTICLE_PANE_CLASS}`).forEach((pane) => {
    syncArticleTopicMeta(pane);
    syncArticleFooterActions(pane);
  });
}

export function scheduleSplitHeaderSync(): void {
  syncSplitTopicMeta();
  [100, 350, 800, 1500, 3000].forEach((delay) => {
    setTimeout(syncSplitTopicMeta, delay);
  });
}

export function restoreSplitHeaderTitle(): void {
  teardownTopicMetaObserver();

  document.querySelectorAll(`.${HEADER_TITLE_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`.${HEADER_META_CLASS}`).forEach((el) => el.remove());
  document.querySelectorAll(`.${ARTICLE_META_CLASS}`).forEach((el) => el.remove());
  restoreFooterActions();
  document.querySelectorAll(`[${TOPIC_META_SOURCE_ATTR}]`).forEach((el) => {
    el.removeAttribute(TOPIC_META_SOURCE_ATTR);
  });
}
