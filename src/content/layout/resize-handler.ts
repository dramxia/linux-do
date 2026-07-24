/* Linux.do 工具箱 — 分栏布局 resize 监听封装
 * 将原先的模块级 let resizeListener 收敛为 ResizeHandler 类实例，
 * 消除模块级可变 let 绑定。T8：与 ManagedObserver 一致，构造时注册
 * pagehide 自动 unbind，避免页面进入 bfcache 时 listener 残留。 */
import { WRAPPER_CLASS } from './dom-queries';
import { updateSplitPaneHeight } from './split-pane-layout';

class ResizeHandler {
  private listener: (() => void) | null = null;
  private readonly pagehideHandler = (): void => {
    if (this.listener) window.removeEventListener('resize', this.listener);
  };
  private readonly pageshowHandler = (event: PageTransitionEvent): void => {
    if (!event.persisted || !this.listener) return;
    window.addEventListener('resize', this.listener);
    this.listener();
  };

  bind(): void {
    if (this.listener) return;
    this.listener = () => {
      document.querySelectorAll<HTMLElement>(`.${WRAPPER_CLASS}`).forEach(updateSplitPaneHeight);
    };
    window.addEventListener('resize', this.listener);
    window.addEventListener('pagehide', this.pagehideHandler);
    window.addEventListener('pageshow', this.pageshowHandler);
  }

  unbind(): void {
    if (!this.listener) return;
    window.removeEventListener('resize', this.listener);
    window.removeEventListener('pagehide', this.pagehideHandler);
    window.removeEventListener('pageshow', this.pageshowHandler);
    this.listener = null;
  }
}

const resizeHandler = new ResizeHandler();

export function bindResizeHandler(): void {
  resizeHandler.bind();
}

export function unbindResizeHandler(): void {
  resizeHandler.unbind();
}
