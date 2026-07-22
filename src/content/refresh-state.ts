/* Linux.do 工具箱 — 刷新去抖与重入状态容器
 * 将 index.ts 原先的 4 个模块级 let 变量（refreshTimer/base64Timer/refreshInFlight/refreshPending）
 * 封装为类型化类实例，消除模块级可变 let 绑定。行为与原 debounce + re-entry 守卫完全一致。 */
export class RefreshState {
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private base64Timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private pending = false;

  // 去抖：清掉旧定时器，排一个新的。
  scheduleRefresh(callback: () => void, delay = 150): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      callback();
    }, delay);
  }

  scheduleBase64(callback: () => void, delay = 100): void {
    if (this.base64Timer) clearTimeout(this.base64Timer);
    this.base64Timer = setTimeout(() => {
      this.base64Timer = null;
      callback();
    }, delay);
  }

  // 重入守卫：成功获取返回 true 并标记 in-flight；并发调用返回 false 由调用方标记 pending。
  tryAcquire(): boolean {
    if (this.inFlight) return false;
    this.inFlight = true;
    return true;
  }

  release(): void {
    this.inFlight = false;
  }

  hasPending(): boolean {
    return this.pending;
  }

  markPending(): void {
    this.pending = true;
  }

  clearPending(): void {
    this.pending = false;
  }
}
