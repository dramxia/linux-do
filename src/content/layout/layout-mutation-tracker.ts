/* Linux.do 工具箱 — 标记当前任务内由分栏控制器搬移的 DOM 节点 */

const expectedNodes = new Set<Node>();
let clearTimer: ReturnType<typeof setTimeout> | null = null;

export function markLayoutMutation(...nodes: Array<Node | null | undefined>): void {
  nodes.forEach((node) => {
    if (node) expectedNodes.add(node);
  });

  if (clearTimer) return;
  clearTimer = setTimeout(() => {
    expectedNodes.clear();
    clearTimer = null;
  }, 0);
}

export function isExpectedLayoutMutation(node: Node): boolean {
  return expectedNodes.has(node);
}
