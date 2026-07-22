/* Linux.do 工具箱 — 模块间事件总线（同步 pub/sub）
 *
 * 解耦 layout→buttons 单向依赖：comment-pager 的 loadPage 完成后 emit 'posts:rendered'，
 * buttons.ts 订阅该事件触发 injectButtons。emit 同步执行所有 handler，等价于直接调用，
 * 无 setTimeout/microtask 延迟，保留 loadPage 完成→按钮注入的原始时序。
 *
 * off() 供 T8 在 pagehide 清理时注销 handler。
 */
type EventHandler = (data?: unknown) => void;

const handlers = new Map<string, Set<EventHandler>>();

export function on(event: string, handler: EventHandler): void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler);
}

export function off(event: string, handler: EventHandler): void {
  const set = handlers.get(event);
  if (!set) return;
  set.delete(handler);
  if (set.size === 0) {
    handlers.delete(event);
  }
}

export function emit(event: string, data?: unknown): void {
  const set = handlers.get(event);
  if (!set) return;
  // 同步遍历：handler 在当前调用栈内立即执行。复制一份避免 handler 内 off() 导致迭代错位。
  for (const handler of Array.from(set)) {
    handler(data);
  }
}
