import type { SummarizerStats } from "./types.js";
import { CUSTOM_TYPE_STATS } from "./types.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/**
 * Usage shape returned by the LLM `complete()` call.
 * Mirrors the `Usage` interface from `@earendil-works/pi-ai` but declared locally
 * so we don't need a runtime import just for the type.
 */
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

/**
 * Accumulates cumulative token/cost stats for summarizer LLM calls.
 * Stats are persisted to the session via `pi.appendEntry(CUSTOM_TYPE_STATS, ...)`
 * and reconstructed on `session_start` / `session_tree`.
 */
export class StatsAccumulator {
  private stats: SummarizerStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCost: 0,
    totalPrunedRawChars: 0,
    totalPrunedSummaryChars: 0,
    callCount: 0,
    retryCount: 0,
    finalFailureCount: 0,
    failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 },
  };

  /** Add usage data from one summarizer LLM call. */
  add(usage: Usage): void {
    this.stats.totalInputTokens += usage.input ?? 0;
    this.stats.totalOutputTokens += usage.output ?? 0;
    this.stats.totalCost += usage.cost?.total ?? 0;
    this.stats.callCount += 1;
  }

  /** Record the raw and summary characters for one accepted prune. */
  addPrunedChars(rawChars: number, summaryChars: number): void {
    this.stats.totalPrunedRawChars += rawChars;
    this.stats.totalPrunedSummaryChars += summaryChars;
  }

  /** Record an automatic retry caused by a retryable manual summarizer failure. */
  addRetry(): void {
    this.stats.retryCount += 1;
  }

  /** Record a terminal batch failure without retaining its raw error text. */
  addFinalFailure(kind: keyof SummarizerStats["failureCounts"]): void {
    this.stats.finalFailureCount += 1;
    this.stats.failureCounts[kind] += 1;
  }

  /** Return a snapshot of the current cumulative stats. */
  getStats(): SummarizerStats {
    return { ...this.stats };
  }

  /** Reset all accumulated stats to zero. */
  reset(): void {
    this.stats = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      totalPrunedRawChars: 0,
      totalPrunedSummaryChars: 0,
      callCount: 0,
      retryCount: 0,
      finalFailureCount: 0,
      failureCounts: { "rate-limit": 0, network: 0, provider: 0, persistence: 0, cancelled: 0 },
    };
  }

  /** Serialize stats for session persistence. */
  toJSON(): SummarizerStats {
    return { ...this.stats };
  }

  /** Restore stats from a previously persisted snapshot. */
  fromJSON(data: SummarizerStats): void {
    this.stats = {
      totalInputTokens: data.totalInputTokens ?? 0,
      totalOutputTokens: data.totalOutputTokens ?? 0,
      totalCost: data.totalCost ?? 0,
      totalPrunedRawChars: data.totalPrunedRawChars ?? 0,
      totalPrunedSummaryChars: data.totalPrunedSummaryChars ?? 0,
      callCount: data.callCount ?? 0,
      retryCount: data.retryCount ?? 0,
      finalFailureCount: data.finalFailureCount ?? 0,
      failureCounts: {
        "rate-limit": data.failureCounts?.["rate-limit"] ?? 0,
        network: data.failureCounts?.network ?? 0,
        provider: data.failureCounts?.provider ?? 0,
        persistence: data.failureCounts?.persistence ?? 0,
        cancelled: data.failureCounts?.cancelled ?? 0,
      },
    };
  }

  /**
   * Reconstruct stats from session history by scanning all custom entries
   * with customType === CUSTOM_TYPE_STATS.
   */
  reconstructFromSession(ctx: ExtensionContext): void {
    this.reset();
    const branch = ctx.sessionManager.getBranch();
    for (const entry of branch) {
      if (
        entry.type === "custom" &&
        (entry as any).customType === CUSTOM_TYPE_STATS
      ) {
        const data = (entry as any).data as SummarizerStats;
        if (data) {
          this.fromJSON(data);
        }
      }
    }
  }

  /**
   * Persist current stats to the session.
   * Each call appends a new entry; on reconstructFromSession we scan
   * all entries and apply the LAST one (since each entry is a full snapshot).
   */
  persist(pi: ExtensionAPI): void {
    pi.appendEntry(CUSTOM_TYPE_STATS, this.toJSON());
  }
}

// ── Formatting helpers ──────────────────────────────────────────────────────

/** Format compact counts like Pi's status line (e.g. "1.2k", "340") */
export function formatCompactCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** Format token counts like Pi's status line (e.g. "1.2k", "340") */
export function formatTokens(n: number): string {
  return formatCompactCount(n);
}

/** Format live char progress like "1.2k summary chars / 8.4k raw chars". */
export function formatCharProgress(receivedChars: number, rawChars?: number): string {
  const receivedLabel = `${formatCompactCount(receivedChars)} summary char${receivedChars === 1 ? "" : "s"}`;
  if (rawChars == null) return receivedLabel;
  return `${receivedLabel} / ${formatCompactCount(rawChars)} raw char${rawChars === 1 ? "" : "s"}`;
}

/** Format cost like "$0.003" */
export function formatCost(n: number): string {
  if (n < 0.001 && n > 0) return `<$0.001`;
  return `$${n.toFixed(3)}`;
}

/** Estimate the input cost avoided by replacing raw output with summaries. */
export function formatTheoreticalSavings(
  stats: SummarizerStats,
  model?: { cost?: { input?: number } },
): string | null {
  const savedChars = stats.totalPrunedRawChars - stats.totalPrunedSummaryChars;
  if (savedChars <= 0) return null;

  const savedTokens = Math.round(savedChars / 4);
  const inputPricePerMillion = model?.cost?.input;
  if (typeof inputPricePerMillion !== "number") return "price unavailable";
  return `~${formatCost((savedTokens * inputPricePerMillion) / 1_000_000)}`;
}

/**
 * Build the stats suffix for the status widget.
 * Returns something like " │ ↑1.2k ↓340 $0.003" or "" if no calls yet.
 */
export function statsSuffix(stats: SummarizerStats): string {
  if (stats.callCount === 0) return "";
  return ` │ ↑${formatTokens(stats.totalInputTokens)} ↓${formatTokens(stats.totalOutputTokens)} ${formatCost(stats.totalCost)}`;
}