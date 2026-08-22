/* Linux.do 工具箱 - 双栏阅读可见时长上报 */

interface VisiblePost {
  postNumber: number;
  startedAt: number;
}

function getCsrfToken(): string | null {
  return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content || null;
}

export function buildTimingsBody(topicId: number, timings: ReadonlyMap<number, number>): string {
  const body = new URLSearchParams();
  let topicTime = 0;
  timings.forEach((milliseconds, postNumber) => {
    const rounded = Math.max(0, Math.round(milliseconds));
    if (rounded === 0) return;
    body.set(`timings[${postNumber}]`, String(rounded));
    topicTime += rounded;
  });
  body.set('topic_time', String(topicTime));
  body.set('topic_id', String(topicId));
  return body.toString();
}

async function sendReadTimings(
  topicId: number,
  timings: ReadonlyMap<number, number>,
  keepalive = false,
): Promise<void> {
  if (timings.size === 0) return;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'X-Requested-With': 'XMLHttpRequest',
  };
  const csrfToken = getCsrfToken();
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  const response = await fetch('/topics/timings', {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: buildTimingsBody(topicId, timings),
    keepalive,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export class TopicReadTracker {
  private readonly totals = new Map<number, number>();
  private readonly visible = new Map<Element, VisiblePost>();
  private observer: IntersectionObserver | null = null;

  constructor(
    private readonly topicId: number,
    private readonly root: HTMLElement,
  ) {}

  observe(posts: readonly HTMLElement[]): void {
    this.disconnectObserver();
    if (typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        const now = performance.now();
        entries.forEach((entry) => {
          const postNumber = Number((entry.target as HTMLElement).dataset.postNumber);
          if (!Number.isInteger(postNumber) || postNumber <= 0) return;
          const current = this.visible.get(entry.target);
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            if (!current) this.visible.set(entry.target, { postNumber, startedAt: now });
          } else if (current) {
            this.addElapsed(current, now);
            this.visible.delete(entry.target);
          }
        });
      },
      { root: this.root, threshold: [0, 0.5, 1] },
    );
    posts.forEach((post) => this.observer?.observe(post));
  }

  flush(keepalive = false): void {
    this.captureVisible();
    if (this.totals.size === 0) return;
    const payload = new Map(this.totals);
    this.totals.clear();
    void sendReadTimings(this.topicId, payload, keepalive).catch(() => {
      // Read tracking is best effort and must never break the reading layout.
    });
  }

  disconnect(): void {
    this.flush(true);
    this.disconnectObserver();
  }

  private addElapsed(item: VisiblePost, now: number): void {
    const elapsed = Math.max(0, now - item.startedAt);
    this.totals.set(item.postNumber, (this.totals.get(item.postNumber) || 0) + elapsed);
  }

  private captureVisible(): void {
    const now = performance.now();
    this.visible.forEach((item) => this.addElapsed(item, now));
    this.visible.clear();
  }

  private disconnectObserver(): void {
    this.captureVisible();
    this.observer?.disconnect();
    this.observer = null;
  }
}
