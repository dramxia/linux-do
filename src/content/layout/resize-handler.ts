/* Linux.do 工具箱 — 分栏布局 resize 监听封装
 * 将原先的模块级 let resizeListener 收敛为 ResizeHandler 类实例，
 * 消除模块级可变 let 绑定。 */
import {
  WRAPPER_CLASS,
} from './dom-queries';
import { updateSplitPaneHeight } from './split-pane-layout';

class ResizeHandler {
  private listener: (() => void) | null = null;

  bind(): void {
    if (this.listener) return;
    this.listener = () => {
      document.querySelectorAll<HTMLElement>(`.${WRAPPER_CLASS}`).forEach(updateSplitPaneHeight);
    };
    window.addEventListener('resize', this.listener);
  }

  unbind(): void {
    if (!this.listener) return;
    window.removeEventListener('resize', this.listener);
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
