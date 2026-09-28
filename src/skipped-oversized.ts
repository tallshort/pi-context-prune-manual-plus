import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CapturedBatch } from "./types.js";
import { CUSTOM_TYPE_SKIPPED_OVERSIZED } from "./types.js";

/** Branch-local, durable exclusions for oversized batches beyond a frontier hole. */
export class SkippedOversizedTracker {
  private readonly toolCallIds = new Set<string>();

  reset(): void {
    this.toolCallIds.clear();
  }

  isSkipped(toolCallId: string): boolean {
    return this.toolCallIds.has(toolCallId);
  }

  reconstructFromSession(ctx: ExtensionContext): void {
    this.reset();
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== CUSTOM_TYPE_SKIPPED_OVERSIZED) continue;
      const data = entry.data as { toolCallIds?: unknown } | undefined;
      if (!Array.isArray(data?.toolCallIds)) continue;
      for (const id of data.toolCallIds) {
        if (typeof id === "string" && id.length > 0) this.toolCallIds.add(id);
      }
    }
  }

  /** Persist first; a failed write must never suppress a batch on the next attempt. */
  mark(batch: CapturedBatch, append: (type: string, data: { toolCallIds: string[] }) => void): void {
    const ids = batch.toolCalls.map((call) => call.toolCallId).filter((id) => !this.toolCallIds.has(id));
    if (ids.length === 0) return;
    append(CUSTOM_TYPE_SKIPPED_OVERSIZED, { toolCallIds: ids });
    for (const id of ids) this.toolCallIds.add(id);
  }
}
