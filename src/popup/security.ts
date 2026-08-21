const SUPPORTED_HOSTNAMES = new Set(['linux.do', 'www.linux.do']);

export function isSupportedPageUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;

  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && SUPPORTED_HOSTNAMES.has(url.hostname);
  } catch {
    return false;
  }
}

export function renderPageInfo(container: HTMLElement, title: string, postCount: number): void {
  const titleElement = container.ownerDocument.createElement('div');
  titleElement.className = 'title';
  titleElement.textContent = title;

  const countElement = container.ownerDocument.createElement('div');
  countElement.textContent = `当前已加载 ${postCount} 个楼层`;

  container.replaceChildren(titleElement, countElement);
}
