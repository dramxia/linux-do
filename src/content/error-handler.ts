/* Linux.do 工具箱 — 统一错误处理
 *
 * T10: 所有散落的 try/catch 改为在 catch 块调 handleError，统一错误日志 +
 * Toast 反馈。保留 try/catch 结构（调用方仍可在 finally 中重置 UI 状态、
 * 在 catch 后决定是否 rethrow），但错误呈现逻辑收敛到此处，避免各处
 * 自行拼接 `(err as Error).message` 字符串。
 */
import { showToast } from './output';

export function handleError(err: unknown, context: string): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[LinuxDoToolkit] ${context}:`, err);
  showToast(`${context}失败: ${message}`);
}
