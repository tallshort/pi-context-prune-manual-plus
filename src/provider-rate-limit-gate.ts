const BASE_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 60_000;

/** Process-local cooldown shared by all summarizer provider requests. */
export class ProviderRateLimitGate {
  private blockedUntil = 0;
  private consecutiveRateLimits = 0;

  constructor(private readonly now: () => number = Date.now) {}

  remainingMs(): number {
    return Math.max(0, this.blockedUntil - this.now());
  }

  recordSuccess(): void {
    this.consecutiveRateLimits = 0;
  }

  async waitForCooldown(
    signal?: AbortSignal,
    onWaiting?: (remainingMs: number) => void,
  ): Promise<boolean> {
    while (!signal?.aborted) {
      const remaining = this.remainingMs();
      if (remaining === 0) return true;
      onWaiting?.(remaining);
      await new Promise<void>((resolve) => {
        const onAbort = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          resolve();
        };
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolve();
        }, Math.min(remaining, 1_000));
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
      });
    }
    return false;
  }

  recordRateLimit(): void {
    this.consecutiveRateLimits += 1;
    const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (this.consecutiveRateLimits - 1));
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + cooldown);
  }
}
