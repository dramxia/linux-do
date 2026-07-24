/* Linux.do 工具箱 — 分栏头部标题同步 */
import { BODY_CLASS, HEADER_TITLE_CLASS, HEADER_TITLE_INNER_CLASS } from './dom-queries';

const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

function getHeaderTitleMount(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('.d-header .contents') ||
    document.querySelector<HTMLElement>('header.d-header .contents') ||
    document.querySelector<HTMLElement>('.d-header')
  );
}

function stripHeaderCloneUnsafeNodes(clone: HTMLElement): void {
  clone
    .querySelectorAll(
      ['script', 'style', '.edit-topic', '.topic-statuses', '.topic-notifications-button'].join(
        ',',
      ),
    )
    .forEach((el) => el.remove());

  clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
}

function syncSplitHeaderTitle(): void {
  if (!document.body?.classList.contains(BODY_CLASS)) return;

  const source = document.querySelector<HTMLElement>('#topic-title');
  const mount = getHeaderTitleMount();
  if (!source || !mount) return;

  let headerTitle = mount.querySelector<HTMLElement>(`:scope > .${HEADER_TITLE_CLASS}`);
  if (!headerTitle) {
    headerTitle = document.createElement('div');
    headerTitle.className = HEADER_TITLE_CLASS;

    const logoArea = mount.querySelector<HTMLElement>(
      ':scope > .title, :scope > .home-logo-wrapper, :scope > .brand-header',
    );
    if (logoArea) logoArea.insertAdjacentElement('afterend', headerTitle);
    else mount.insertBefore(headerTitle, mount.children[1] || null);
  }

  const clone = source.cloneNode(true) as HTMLElement;
  clone.className = HEADER_TITLE_INNER_CLASS;
  stripHeaderCloneUnsafeNodes(clone);
  headerTitle.replaceChildren(clone);
}

function clearPendingTimers(): void {
  pendingTimers.forEach((timer) => clearTimeout(timer));
  pendingTimers.clear();
}

export function scheduleSplitHeaderSync(): void {
  clearPendingTimers();
  syncSplitHeaderTitle();

  [250, 1000].forEach((delay) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      syncSplitHeaderTitle();
    }, delay);
    pendingTimers.add(timer);
  });
}

export function restoreSplitHeaderTitle(): void {
  clearPendingTimers();
  document.querySelectorAll(`.${HEADER_TITLE_CLASS}`).forEach((el) => el.remove());
}
