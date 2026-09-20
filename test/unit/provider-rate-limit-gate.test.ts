import { describe, expect, it, vi } from "vitest";
import { ProviderRateLimitGate } from "../../src/provider-rate-limit-gate.js";

describe("ProviderRateLimitGate", () => {
  it("blocks until the cooldown expires", () => {
    let now = 1_000;
    const gate = new ProviderRateLimitGate(() => now);
    gate.recordRateLimit();
    expect(gate.remainingMs()).toBe(5_000);
    now += 5_000;
    expect(gate.remainingMs()).toBe(0);
  });

  it("increases repeated cooldowns and caps the duration", () => {
    let now = 0;
    const gate = new ProviderRateLimitGate(() => now);
    gate.recordRateLimit();
    gate.recordRateLimit();
    expect(gate.remainingMs()).toBe(10_000);
    gate.recordRateLimit();
    gate.recordRateLimit();
    gate.recordRateLimit();
    expect(gate.remainingMs()).toBe(60_000);
  });
  it("keeps exponential backoff after cooldown expiry until a provider request succeeds", () => {
    let now = 0;
    const gate = new ProviderRateLimitGate(() => now);
    gate.recordRateLimit();
    now += 5_000;
    expect(gate.remainingMs()).toBe(0);
    gate.recordRateLimit();
    expect(gate.remainingMs()).toBe(10_000);
    gate.recordSuccess();
    now += 10_000;
    gate.recordRateLimit();
    expect(gate.remainingMs()).toBe(5_000);
  });
  it("waits through cooldown and reports remaining time", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const gate = new ProviderRateLimitGate();
      gate.recordRateLimit();
      const waiting: number[] = [];
      const done = gate.waitForCooldown(undefined, (remaining) => waiting.push(remaining));
      await vi.advanceTimersByTimeAsync(5_000);
      await expect(done).resolves.toBe(true);
      expect(waiting[0]).toBe(5_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
