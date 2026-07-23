/* Linux.do 工具箱 — topic-meta 探测与克隆 */
import {
  ARTICLE_META_CLASS,
  ARTICLE_META_INNER_CLASS,
  ARTICLE_PANE_CLASS,
  COMMENTS_PANE_CLASS,
  HEADER_META_CLASS,
  HEADER_META_INNER_CLASS,
  TOPIC_META_SELECTORS,
  TOPIC_META_SOURCE_ATTR,
  topicMetaState,
} from './dom-queries';
import { ManagedObserver } from '../managed-observer';
import { syncSplitTopicMeta } from './header-title-cloner';

function findTopicMetaSource(): Element | null {
  const directMatch = Array.from(document.querySelectorAll(TOPIC_META_SELECTORS.join(','))).find(
    (el) =>
      !el.closest(`.${HEADER_META_CLASS}`) &&
      !el.closest(`.${ARTICLE_PANE_CLASS}`) &&
      !el.closest(`.${COMMENTS_PANE_CLASS}`),
  );

  if (directMatch) return directMatch;

  return (
    Array.from(
      document.querySelectorAll('#main-outlet .container.posts > .row > *, .topic-area > *'),
    ).find((el) => {
      if (
        el.closest(`.${HEADER_META_CLASS}`) ||
        el.closest(`.${ARTICLE_PANE_CLASS}`) ||
        el.closest(`.${COMMENTS_PANE_CLASS}`) ||
        el.matches('#topic-title')
      ) {
        return false;
      }

      const text = el.textContent || '';
      const hasStatsText =
        ['浏览量', '赞', '链接', '用户'].filter((label) => text.includes(label)).length >= 2;
      const hasAvatars = el.querySelectorAll('img.avatar, .avatar').length >= 2;
      const hasSummary = Boolean(el.querySelector('[title*="总结"], button, .btn'));
      return hasStatsText && (hasAvatars || hasSummary);
    }) || null
  );
}

function stripHeaderMetaCloneUnsafeNodes(clone: HTMLElement): void {
  clone.querySelectorAll(['script', 'style', '[id]'].join(',')).forEach((el) => {
    if (el.matches('script, style')) {
      el.remove();
      return;
    }
    el.removeAttribute('id');
  });
}

function buildTopicMetaClone(source: Element, innerClass: string): HTMLElement {
  const clone = source.cloneNode(true) as HTMLElement;
  clone.classList.add(innerClass);
  clone.removeAttribute('id');
  clone.removeAttribute(TOPIC_META_SOURCE_ATTR);
  stripHeaderMetaCloneUnsafeNodes(clone);
  return clone;
}

export function syncSplitHeaderMeta(
  mount: HTMLElement | null,
  headerTitle: HTMLElement | null,
): void {
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

export function syncArticleTopicMeta(pane: HTMLElement | null): void {
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

export function scheduleTopicMetaSync(delay = 80): void {
  if (topicMetaState.syncTimer) clearTimeout(topicMetaState.syncTimer);
  topicMetaState.syncTimer = setTimeout(() => {
    topicMetaState.syncTimer = null;
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

export function bindTopicMetaObserver(): void {
  if (topicMetaState.observer) return;

  const target = document.querySelector<HTMLElement>('#main-outlet, #main, body') || document.body;
  topicMetaState.observer = new ManagedObserver(
    target,
    {
      childList: true,
      subtree: true,
      characterData: true,
    },
    (mutations) => {
      const shouldSync = mutations.some((mutation) => {
        const nodes: Node[] = [
          mutation.target,
          ...Array.from(mutation.addedNodes || []),
          ...Array.from(mutation.removedNodes || []),
        ];

        return nodes.some(isNativeTopicMetaNode);
      });

      if (shouldSync) scheduleTopicMetaSync();
    },
  );
  topicMetaState.observer.start();
}

export function teardownTopicMetaObserver(): void {
  if (topicMetaState.syncTimer) {
    clearTimeout(topicMetaState.syncTimer);
    topicMetaState.syncTimer = null;
  }

  if (topicMetaState.observer) {
    topicMetaState.observer.disconnect();
    topicMetaState.observer = null;
  }
}
