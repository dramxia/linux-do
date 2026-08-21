/* Linux.do 工具箱 — 统一错误日志与页面反馈 */
import { showToast } from './output';

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function handleError(err: unknown, context: string): void {
  console.error(`[LinuxDoToolkit] ${context}:`, err);
  showToast(`${context}失败: ${getErrorMessage(err)}`);
}
