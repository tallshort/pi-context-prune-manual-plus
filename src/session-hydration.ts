import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PruneFrontierTracker } from "./frontier.js";
import { ToolCallIndexer } from "./indexer.js";
import { StatsAccumulator } from "./stats.js";

/** Rebuilds all persisted pruning state for the current session branch. */
export function hydrateSessionState(
  ctx: ExtensionContext,
  indexer: ToolCallIndexer,
  stats: StatsAccumulator,
  frontier: PruneFrontierTracker,
): void {
  indexer.reconstructFromSession(ctx);
  stats.reconstructFromSession(ctx);
  frontier.reconstructFromSession(ctx);
}
