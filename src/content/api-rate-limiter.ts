/* Linux.do 工具箱 — API 速率限制与退避模块
 *
 * 提供 Promise pool 并发限制 + 429 Retry-After 退避逻辑，
 * 用于 collectLoadedPosts 等批量请求场景，避免触发
 * Discourse max_user_api_reqs_per_minute=20 限制。 */

/** 429 速率限制错误，携带 Retry-After 头解析后的等待毫秒数。 */
export class RateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(retryAfterMs: number, message = 'HTTP 429 Too Many Requests') {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }
}

/** 解析 Retry-After 响应头（支持秒数或 HTTP-date）。
 *  - 秒数: "120" → 120000 ms
 *  - HTTP-date: "Wed, 21 Oct 2026 07:28:00 GMT" → 与当前时间的差值（至少 0）
 *  - 无效/缺失: 返回 0。 */
export function parseRetryAfter(headerValue: string | null, now: Date = new Date()): number {
  if (!headerValue) return 0;
  const trimmed = headerValue.trim();
  if (!trimmed) return 0;

  // 纯数字 → 秒数
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date → 与 now 的差值
  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    return Math.max(0, date.getTime() - now.getTime());
  }
  return 0;
}

interface BatchFetchOptions<T> {
  /** 输入项数组。 */
  items: readonly T[];
  /** 对单个输入项执行的异步请求，返回所需结果。若抛出 RateLimitError 则触发退避重试。 */
  task: (item: T, attempt: number) => Promise<unknown>;
  /** 最大并发数（Promise pool 大小）。 */
  concurrency: number;
  /** 最大重试次数（429 触发，不含首次请求）。默认 3。 */
  maxRetries?: number;
  /** 退避初始等待毫秒数。Retry-After 头值优先；头缺失时用此值指数增长。默认 1000。 */
  initialBackoffMs?: number;
  /** 退避最大等待毫秒数（封顶）。默认 30000。 */
  maxBackoffMs?: number;
}

interface BatchFetchResult<T> {
  /** 成功结果，按输入顺序排列（失败项不包含）。 */
  results: Array<{ index: number; value: unknown }>;
  /** 失败项：输入索引 + 输入项 + 错误信息。 */
  failures: Array<{ index: number; item: T; error: Error }>;
}

/** 带并发限制与 429 退避的批量 fetch。
 *
 * Promise pool 模型：维护 concurrency 个活跃任务，一个完成立即启动下一个，
 * 保证至多 concurrency 个请求在飞。遇到 RateLimitError 时：
 *   1. 解析 retryAfterMs（取 max(header 值, 指数退避值)）
 *   2. 等待 retryAfterMs
 *   3. 重试该 item（attempt+1），重试次数耗尽则记入 failures
 * 非 RateLimitError 错误不重试，直接记入 failures。 */
export async function batchFetchWithBackoff<T>(
  options: BatchFetchOptions<T>,
): Promise<BatchFetchResult<T>> {
  const {
    items,
    task,
    concurrency,
    maxRetries = 3,
    initialBackoffMs = 1000,
    maxBackoffMs = 30000,
  } = options;

  const results: Array<{ index: number; value: unknown }> = [];
  const failures: Array<{ index: number; item: T; error: Error }> = [];

  if (items.length === 0) return { results, failures };

  let cursor = 0;

  async function runItem(item: T, index: number): Promise<void> {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const value = await task(item, attempt);
        results.push({ index, value });
        return;
      } catch (err) {
        if (err instanceof RateLimitError && attempt < maxRetries) {
          const exponentialMs = Math.min(initialBackoffMs * 2 ** attempt, maxBackoffMs);
          const waitMs = Math.max(err.retryAfterMs, exponentialMs);
          await sleep(waitMs);
          attempt += 1;
          continue;
        }
        failures.push({
          index,
          item,
          error: err instanceof Error ? err : new Error(String(err)),
        });
        return;
      }
    }
  }

  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await runItem(items[index] as T, index);
    }
  }

  const poolSize = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: poolSize }, () => worker()));

  return { results, failures };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const apiRateLimiter = {
  batchFetchWithBackoff,
  parseRetryAfter,
  RateLimitError,
};
