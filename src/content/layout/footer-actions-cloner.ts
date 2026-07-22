/* Linux.do 工具箱 — footer-actions 迁移与还原 */
import {
  ARTICLE_ACTIONS_CLASS,
  ARTICLE_PANE_CLASS,
  COMMENTS_PANE_CLASS,
  FOOTER_ACTIONS_PLACEHOLDER_ATTR,
  FOOTER_ACTIONS_SELECTORS,
  FOOTER_ACTIONS_SOURCE_ATTR,
  HEADER_META_CLASS,
} from './dom-queries';

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

export function syncArticleFooterActions(pane: HTMLElement | null): void {
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

export function restoreFooterActions(): void {
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
