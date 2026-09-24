import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { appendUsageLog, normalizeUsage, randomUUID, type UsageLogRecord } from "./usage-log.js";
import type { CapturedBatch } from "./types.js";

/** The runtime session manager supports appendUsage although extension contexts expose it read-only. */
export type UsageSession = Pick<SessionManager, "getSessionId"> &
  Partial<Pick<SessionManager, "appendUsage">>;

export type UsageLogWriter = (record: UsageLogRecord) => void;

function notifyUsageErrorSafely(notifyError: (error: unknown) => void, error: unknown): void {
  try {
    notifyError(error);
  } catch {
    // Usage diagnostics must never change pruning outcomes.
  }
}

/** Report one provider response independently of whether its summary is later accepted. */
export function reportSummarizerUsage(
  session: UsageSession,
  response: AssistantMessage,
  batch: CapturedBatch,
  notifyError: (error: unknown) => void,
  writeLog: UsageLogWriter = appendUsageLog,
): void {
  if (!response.usage) return;
  const provider = response.provider;
  const model = (response as AssistantMessage & { responseModel?: string }).responseModel ?? response.model;
  let entry: ReturnType<SessionManager["appendUsage"]> | undefined;
  let sessionId = "";
  try {
    sessionId = session.getSessionId();
    if (typeof session.appendUsage === "function") {
      entry = session.appendUsage(
        "context_prune",
        provider,
        model,
        response.usage as Usage,
        `summarizer call: ${batch.toolCalls.length} tool call${batch.toolCalls.length === 1 ? "" : "s"} (turn ${batch.turnIndex})`,
      );
    }
  } catch (error) {
    notifyUsageErrorSafely(notifyError, error);
  }

  try {
    writeLog({
      v: 1,
      id: entry ? `${sessionId}:${entry.id}` : randomUUID(),
      ts: entry?.timestamp ?? new Date().toISOString(),
      source: "context-prune",
      label: "summarizer",
      provider,
      model,
      usage: normalizeUsage(response.usage),
      sessionId,
      ...(entry ? { usageEntryId: entry.id } : {}),
      kind: "context_prune",
    });
  } catch (error) {
    notifyUsageErrorSafely(notifyError, error);
  }
}

interface SummarizerUsageReporterOptions {
  session: UsageSession;
  addUsage: (usage: Usage) => void;
  notifyError: (error: unknown) => void;
  writeLog?: UsageLogWriter;
}

/**
 * Create the single accounting boundary used by the flush pipeline. The same
 * final response object is ignored if accidentally delivered twice, while a
 * retry's distinct response is counted as a separate paid call.
 */
export function createSummarizerUsageReporter(options: SummarizerUsageReporterOptions) {
  const reported = new WeakSet<AssistantMessage>();
  return (batch: CapturedBatch, response: AssistantMessage): boolean => {
    if (!response.usage || reported.has(response)) return false;
    reported.add(response);
    try {
      options.addUsage(response.usage);
    } catch (error) {
      notifyUsageErrorSafely(options.notifyError, error);
    }
    reportSummarizerUsage(
      options.session,
      response,
      batch,
      options.notifyError,
      options.writeLog ?? appendUsageLog,
    );
    return true;
  };
}
