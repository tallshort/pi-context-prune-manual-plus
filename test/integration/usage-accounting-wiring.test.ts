import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("flush usage accounting wiring", () => {
  it("has one StatsAccumulator usage-add boundary and no settlement-time double count", () => {
    const indexPath = fileURLToPath(new URL("../../index.ts", import.meta.url));
    const source = readFileSync(indexPath, "utf8");

    expect(source).toContain("addUsage: (usage) => statsAccum.add(usage)");
    expect(source).not.toContain("statsAccum.add(result.usage)");
    expect(source.match(/statsAccum\.add\(/g)).toHaveLength(1);
    expect(source.indexOf("addUsage: (usage) => statsAccum.add(usage)")).toBeLessThan(
      source.indexOf("const shouldSkipOversized"),
    );
  });

  it("passes the usage callback to both bounded manual attempts and parallel flushes", () => {
    const indexPath = fileURLToPath(new URL("../../index.ts", import.meta.url));
    const source = readFileSync(indexPath, "utf8");

    expect(source).toContain("onUsage: (response) => onUsage(batch, response)");
    expect(source).toMatch(/summarizeBatches\([\s\S]*?onUsage,[\s\S]*?signal: options\.signal/);
  });
});
