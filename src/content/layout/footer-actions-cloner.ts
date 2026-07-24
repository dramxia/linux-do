/* Linux.do 工具箱 — 原生 footer-actions 迁移与还原 */
import {
  ARTICLE_ACTIONS_CLASS,
  ARTICLE_PANE_CLASS,
  FOOTER_ACTIONS_PLACEHOLDER_ATTR,
  FOOTER_ACTIONS_SELECTORS,
  FOOTER_ACTIONS_SOURCE_ATTR,
  FOOTER_ACTIONS_TOPIC_ATTR,
} from './dom-queries';
import { markLayoutMutation } from './layout-mutation-tracker';
import { getTopicId } from '../discourse';

interface FooterPortalState {
  source: HTMLElement | null;
  placeholder: HTMLElement | null;
  host: HTMLElement | null;
  originalParent: HTMLElement | null;
  originalNextSibling: ChildNode | null;
  topicId: string;
}

const footerPortalState: FooterPortalState = {
  source: null,
  placeholder: null,
  host: null,
  originalParent: null,
  originalNextSibling: null,
  topicId: '',
};

function findFooterActionsSource(): HTMLElement | null {
  return (
    Array.from(document.querySelectorAll(FOOTER_ACTIONS_SELECTORS)).find(
      (el): el is HTMLElement =>
        el instanceof HTMLElement &&
        !el.closest(`.${ARTICLE_PANE_CLASS}`) &&
        !el.hasAttribute(FOOTER_ACTIONS_PLACEHOLDER_ATTR),
    ) || null
  );
}

function findFooterActionsHostReplacement(): HTMLElement | null {
  const candidate = footerPortalState.host?.querySelector(
    ':scope > #topic-footer-buttons, :scope > .topic-footer-main-buttons',
  );
  return candidate instanceof HTMLElement && candidate !== footerPortalState.source
    ? candidate
    : null;
}

function createFooterActionsPlaceholder(source: HTMLElement): HTMLElement {
  const placeholder = document.createElement('span');
  placeholder.hidden = true;
  placeholder.setAttribute(FOOTER_ACTIONS_PLACEHOLDER_ATTR, 'true');
  markLayoutMutation(placeholder);
  source.parentElement?.insertBefore(placeholder, source);
  return placeholder;
}

function clearPortalState(): void {
  footerPortalState.source = null;
  footerPortalState.placeholder = null;
  footerPortalState.host = null;
  footerPortalState.originalParent = null;
  footerPortalState.originalNextSibling = null;
  footerPortalState.topicId = '';
}

function restoreSource(
  source: HTMLElement,
  placeholder: HTMLElement | null,
  originalParent: HTMLElement | null,
  originalNextSibling: ChildNode | null,
  sourceTopicId: string,
): void {
  source.removeAttribute(FOOTER_ACTIONS_SOURCE_ATTR);
  source.removeAttribute(FOOTER_ACTIONS_TOPIC_ATTR);
  markLayoutMutation(source);

  const currentTopicId = getTopicId();
  if (!currentTopicId || (sourceTopicId && sourceTopicId !== currentTopicId)) {
    source.remove();
    return;
  }

  if (placeholder?.parentElement?.isConnected) {
    placeholder.parentElement.insertBefore(source, placeholder);
    return;
  }

  if (originalParent?.isConnected) {
    const anchor = originalNextSibling?.parentNode === originalParent ? originalNextSibling : null;
    originalParent.insertBefore(source, anchor);
    return;
  }

  const replacement = findFooterActionsSource();
  if (replacement && replacement !== source) {
    source.remove();
    return;
  }

  const fallback =
    document.querySelector<HTMLElement>('.topic-area, .container.posts, #main-outlet') ||
    document.body;
  fallback.appendChild(source);
}

export function syncArticleFooterActions(pane: HTMLElement | null): void {
  if (!pane) return;

  const hostReplacement = findFooterActionsHostReplacement();
  const nextSource = findFooterActionsSource();
  const currentSource = footerPortalState.source;
  if (hostReplacement) {
    markLayoutMutation(currentSource);
    currentSource?.remove();
    footerPortalState.source = hostReplacement;
    hostReplacement.setAttribute(FOOTER_ACTIONS_SOURCE_ATTR, 'true');
    hostReplacement.setAttribute(FOOTER_ACTIONS_TOPIC_ATTR, footerPortalState.topicId);
  } else if (nextSource && nextSource !== currentSource) {
    markLayoutMutation(currentSource, footerPortalState.placeholder);
    currentSource?.remove();
    footerPortalState.placeholder?.remove();
    footerPortalState.source = nextSource;
    footerPortalState.originalParent = nextSource.parentElement;
    footerPortalState.originalNextSibling = nextSource.nextSibling;
    footerPortalState.topicId = getTopicId() || '';
    footerPortalState.placeholder = createFooterActionsPlaceholder(nextSource);
    nextSource.setAttribute(FOOTER_ACTIONS_SOURCE_ATTR, 'true');
    nextSource.setAttribute(FOOTER_ACTIONS_TOPIC_ATTR, footerPortalState.topicId);
  } else if (currentSource && !currentSource.isConnected) {
    markLayoutMutation(footerPortalState.placeholder, footerPortalState.host);
    footerPortalState.placeholder?.remove();
    footerPortalState.host?.remove();
    clearPortalState();
  }

  const source = footerPortalState.source;
  let articleActions = footerPortalState.host;
  if (!source) {
    articleActions?.remove();
    footerPortalState.host = null;
    return;
  }

  if (!articleActions?.isConnected || articleActions.parentElement !== pane) {
    articleActions = document.createElement('section');
    articleActions.className = ARTICLE_ACTIONS_CLASS;
    articleActions.setAttribute('aria-label', '主题操作');
    markLayoutMutation(articleActions);
    pane.appendChild(articleActions);
    footerPortalState.host = articleActions;
  }

  if (source.parentElement !== articleActions) {
    markLayoutMutation(source);
    articleActions.appendChild(source);
  }
}

export function restoreFooterActions(): void {
  const { source, placeholder, host, originalParent, originalNextSibling, topicId } =
    footerPortalState;
  if (source) {
    restoreSource(source, placeholder, originalParent, originalNextSibling, topicId);
  }

  markLayoutMutation(placeholder, host);
  placeholder?.remove();
  host?.remove();
  clearPortalState();

  const orphanedSource = document.querySelector<HTMLElement>(
    `[${FOOTER_ACTIONS_SOURCE_ATTR}="true"]`,
  );
  const orphanedPlaceholder = document.querySelector<HTMLElement>(
    `[${FOOTER_ACTIONS_PLACEHOLDER_ATTR}="true"]`,
  );
  if (orphanedSource) {
    restoreSource(
      orphanedSource,
      orphanedPlaceholder,
      null,
      null,
      orphanedSource.getAttribute(FOOTER_ACTIONS_TOPIC_ATTR) || '',
    );
  }
  markLayoutMutation(orphanedPlaceholder);
  orphanedPlaceholder?.remove();
  document.querySelectorAll(`.${ARTICLE_ACTIONS_CLASS}`).forEach((el) => {
    markLayoutMutation(el);
    el.remove();
  });
}
