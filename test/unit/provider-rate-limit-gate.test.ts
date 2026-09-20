import { describe, expect, it } from "vitest";
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
});
