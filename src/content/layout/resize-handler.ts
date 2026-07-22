/* Linux.do 工具箱 — 分栏布局 resize 监听封装 */
import {
  WRAPPER_CLASS,
} from './dom-queries';
import { updateSplitPaneHeight } from './split-pane-layout';

let resizeListener: (() => void) | null = null;

export function bindResizeHandler(): void {
  if (resizeListener) return;
  resizeListener = () => {
    document.querySelectorAll<HTMLElement>(`.${WRAPPER_CLASS}`).forEach(updateSplitPaneHeight);
  };
  window.addEventListener('resize', resizeListener);
}

export function unbindResizeHandler(): void {
  if (!resizeListener) return;
  window.removeEventListener('resize', resizeListener);
  resizeListener = null;
}
