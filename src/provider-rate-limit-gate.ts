const BASE_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 60_000;

/** Process-local cooldown shared by all summarizer provider requests. */
export class ProviderRateLimitGate {
  private blockedUntil = 0;
  private consecutiveRateLimits = 0;

  constructor(private readonly now: () => number = Date.now) {}

  remainingMs(): number {
    const remaining = Math.max(0, this.blockedUntil - this.now());
    if (remaining === 0) this.consecutiveRateLimits = 0;
    return remaining;
  }

  recordRateLimit(): void {
    this.consecutiveRateLimits += 1;
    const cooldown = Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (this.consecutiveRateLimits - 1));
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + cooldown);
  }
}
