/* Linux.do 工具箱 — ManagedObserver
 * 封装 MutationObserver 生命周期：构造时注册 pagehide 自动 disconnect，
 * 避免页面进入 bfcache 时观察器与监听器残留。disconnect 时同步移除 pagehide
 * 监听，保持单次使用语义——需要重启时新建实例。 */
export class ManagedObserver {
  private observer: MutationObserver | null = null;
  private readonly target: Node;
  private readonly observerInit: MutationObserverInit;
  private readonly callback: MutationCallback;
  private readonly pagehideHandler = (): void => {
    this.disconnect();
  };

  isConnected = false;

  constructor(target: Node, observerInit: MutationObserverInit, callback: MutationCallback) {
    this.target = target;
    this.observerInit = observerInit;
    this.callback = callback;
    window.addEventListener('pagehide', this.pagehideHandler);
  }

  start(): void {
    if (this.observer) return;
    this.observer = new MutationObserver(this.callback);
    this.observer.observe(this.target, this.observerInit);
    this.isConnected = true;
  }

  disconnect(): void {
    if (!this.observer) return;
    this.observer.disconnect();
    this.observer = null;
    this.isConnected = false;
    window.removeEventListener('pagehide', this.pagehideHandler);
  }
}
