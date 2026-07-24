/* Linux.do 工具箱 — 可在 bfcache 往返后恢复的 MutationObserver */
export class ManagedObserver {
  private observer: MutationObserver | null = null;
  private readonly target: Node;
  private readonly observerInit: MutationObserverInit;
  private readonly callback: MutationCallback;
  private readonly pagehideHandler = (): void => {
    this.pause();
  };
  private readonly pageshowHandler = (event: PageTransitionEvent): void => {
    if (event.persisted) this.start();
  };

  isConnected = false;

  constructor(target: Node, observerInit: MutationObserverInit, callback: MutationCallback) {
    this.target = target;
    this.observerInit = observerInit;
    this.callback = callback;
    window.addEventListener('pagehide', this.pagehideHandler);
    window.addEventListener('pageshow', this.pageshowHandler);
  }

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(this.callback);
    this.observer.observe(this.target, this.observerInit);
    this.isConnected = true;
  }

  disconnect(): void {
    this.pause();
    window.removeEventListener('pagehide', this.pagehideHandler);
    window.removeEventListener('pageshow', this.pageshowHandler);
  }

  private pause(): void {
    if (!this.observer) return;
    this.observer.disconnect();
    this.observer = null;
    this.isConnected = false;
  }
}
