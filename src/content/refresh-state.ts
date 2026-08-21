type RefreshTask = () => void | Promise<void>;

/** Debounces a task and coalesces requests that arrive while it is running. */
export class RefreshScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private pending = false;

  constructor(
    private readonly task: RefreshTask,
    private readonly defaultDelay: number,
  ) {}

  schedule(delay = this.defaultDelay): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run();
    }, delay);
  }

  run(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.inFlight) {
      this.pending = true;
      return this.inFlight;
    }

    this.inFlight = this.runUntilIdle();
    return this.inFlight;
  }

  private async runUntilIdle(): Promise<void> {
    try {
      do {
        this.pending = false;
        await this.task();
      } while (this.pending);
    } finally {
      this.inFlight = null;
    }
  }
}
