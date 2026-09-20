import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type {
  CapturedBatch,
  ContextPruneConfig,
  SummarizerThinking,
  SummarizeBatchOptions,
  SummarizeBatchesOptions,
  SummarizeResult,
  SummarizeFailure,
} from "./types.js";
import { serializeBatchForSummarizer } from "./batch-capture.js";
import { ProviderRateLimitGate } from "./provider-rate-limit-gate.js";

const rateLimitGate = new ProviderRateLimitGate();

export function waitForSummarizerCooldown(
  signal?: AbortSignal,
  onWaiting?: (remainingMs: number) => void,
): Promise<boolean> {
  return rateLimitGate.waitForCooldown(signal, onWaiting);
}
const SYSTEM_PROMPT = `You are summarizing a batch of tool calls made by an AI coding assistant.
For each tool call provide:
- Tool name and a one-sentence description of what it did
- Key outcome: success/failure and the most important data returned
- Any findings the future conversation needs to remember

Keep each tool call to 1-3 bullet points. Be concise.`;

export function summarizerThinkingOptions(config: ContextPruneConfig): Record<string, unknown> {
  const level: SummarizerThinking = config.summarizerThinking;
  if (level === "default") {
    return {};
  }

  // stream()/complete() accept provider-level options. For reasoning-capable providers,
  // pi-ai adapters translate reasoningEffort into the provider-specific field.
  // "off" intentionally sends no effort; adapters that support explicit disable
  // handle that the same way as an absent effort, while preserving compatibility.
  return { reasoningEffort: level === "off" ? undefined : level };
}

/**
 * Returns the model to use for summarization.
 * config.summarizerModel === "default" => ctx.model
 * "provider/model-id" => ctx.modelRegistry.find(provider, modelId), fallback to ctx.model with warning
 */
export function resolveModel(config: ContextPruneConfig, ctx: ExtensionContext): any {
  if (config.summarizerModel === "default") {
    return ctx.model;
  }

  const slashIndex = config.summarizerModel.indexOf("/");
  if (slashIndex === -1) {
    ctx.ui.notify(
      `pruner: invalid summarizerModel "${config.summarizerModel}", expected "provider/model-id". Falling back to default model.`,
      "warning"
    );
    return ctx.model;
  }

  const provider = config.summarizerModel.slice(0, slashIndex);
  const modelId = config.summarizerModel.slice(slashIndex + 1);

  const found = ctx.modelRegistry.find(provider, modelId);
  if (!found) {
    ctx.ui.notify(
      `pruner: model "${config.summarizerModel}" not found in registry. Falling back to default model.`,
      "warning"
    );
    return ctx.model;
  }

  return found;
}

function receivedTextChars(message: AssistantMessage): number {
  return message.content.reduce((sum, content) => {
    return content.type === "text" ? sum + content.text.length : sum;
  }, 0);
}

function safeFailureMessage(value: unknown): string {
  const firstLine = (value instanceof Error ? value.message : String(value)).split(/[\r\n]/, 1)[0];
  return firstLine
    .replace(/\b(?:api[_-]?key|authorization)\b\s*[:=]?\s*(?:bearer\s+)?\S+/gi, "[redacted]")
    .replace(/\bbearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[endpoint]")
    .slice(0, 160) || "provider error";
}

/** Classifies a provider failure without retaining its raw error or stack. */
export function classifySummarizerFailure(value: unknown): SummarizeFailure {
  const message = safeFailureMessage(value);
  const normalized = message.toLowerCase();
  if (/\b429\b|rate.?limit|too many requests|quota exceeded/.test(normalized)) {
    return { failureKind: "rate-limit", failureMessage: "rate limited", retryable: true };
  }
  if (/network|fetch failed|econn|enotfound|etimedout|socket|connection|tls|timeout/.test(normalized)) {
    return { failureKind: "network", failureMessage: "network error", retryable: true };
  }
  if (/\b5\d\d\b|server error|internal error|service unavailable|overloaded|temporar/.test(normalized)) {
    return { failureKind: "provider", failureMessage: "temporary provider error", retryable: true };
  }
  return { failureKind: "provider", failureMessage: message || "provider error", retryable: false };
}

/**
 * Summarizes a captured batch. Returns a summary or a structured, safe failure.
 * Abort remains exceptional so flushPending can preserve its cancellation semantics.
 */
export async function summarizeBatch(
  batch: CapturedBatch,
  config: ContextPruneConfig,
  ctx: ExtensionContext,
  options: SummarizeBatchOptions = {}
): Promise<SummarizeResult | SummarizeFailure> {
  // Fast-fail if already aborted before we even start.
  if (options.signal?.aborted) throw new Error("summarizeBatch: aborted before start");

  const remainingCooldownMs = rateLimitGate.remainingMs();
  if (remainingCooldownMs > 0) {
    return { failureKind: "rate-limit", failureMessage: `provider cooldown: retry in ${Math.ceil(remainingCooldownMs / 1000)}s`, retryable: false };
  }
  try {
    const model = resolveModel(config, ctx);

    const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!auth.ok) {
      const authMessage = "error" in auth ? auth.error : "authentication failed";
      const failure = classifySummarizerFailure(authMessage);
      if (options.notifyOnFailure !== false) ctx.ui.notify(`pruner: summarization failed: ${failure.failureMessage}`, "error");
      return failure;
    }

    const provider = ctx.modelRegistry.getProvider(model.provider);
    if (!provider) {
      const failure: SummarizeFailure = { failureKind: "provider", failureMessage: "unknown provider", retryable: false };
      if (options.notifyOnFailure !== false) ctx.ui.notify(`pruner: summarization failed: ${failure.failureMessage}`, "error");
      return failure;
    }

    const serialized = serializeBatchForSummarizer(batch);
    const userMessage =
      SYSTEM_PROMPT + "\n\n<tool-call-batch>\n" + serialized + "\n</tool-call-batch>";

    // Use the provider-owned stream API directly. The compatibility registry
    // facade still exposes auth/header resolution, but no longer exposes a
    // top-level stream() helper of its own.
    const responseStream = provider.stream(
      auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model,
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: userMessage }],
            timestamp: Date.now(),
          },
        ],
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        env: auth.env,
        signal: options.signal,
        ...summarizerThinkingOptions(config),
      }
    );

    let lastReportedChars = -1;
    options.onTextProgress?.(0);
    const reportTextProgress = (message: AssistantMessage) => {
      const chars = receivedTextChars(message);
      if (chars !== lastReportedChars) {
        lastReportedChars = chars;
        options.onTextProgress?.(chars);
      }
    };

    for await (const event of responseStream) {
      // Belt-and-suspenders: break early when signal fires mid-stream.
      if (options.signal?.aborted) break;
      if (event.type === "text_start" || event.type === "text_delta" || event.type === "text_end") {
        reportTextProgress(event.partial);
      }
    }

    // If signal fired while we were iterating, propagate the abort so
    // flushPending can detect it and restore batches.
    if (options.signal?.aborted) throw new Error("summarizeBatch: aborted during stream");

    const response = await responseStream.result();
    reportTextProgress(response);
    // stopReason "aborted" means the provider cut the stream short (e.g. signal
    // fired just before the final chunk). Treat identically to the signal check
    // above — throw so flushPending's catch can detect options.signal.aborted.
    if (response.stopReason === "aborted") {
      throw new Error("summarizeBatch: stream stopped with reason aborted");
    }
    if (response.stopReason === "error") {
      throw new Error(response.errorMessage ?? "Summarizer stopped with reason: error");
    }

    const llmText = response.content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");

    rateLimitGate.recordSuccess();
    return {
      summaryText: llmText,
      usage: response.usage,
    };
  } catch (err: any) {
    // Propagate abort errors upward so flushPending can check signal.aborted
    // and return { ok: false, reason: "aborted" } without showing a UI error.
    if (options.signal?.aborted) throw err;
    const failure = classifySummarizerFailure(err);
    if (failure.failureKind === "rate-limit") rateLimitGate.recordRateLimit();
    if (options.notifyOnFailure !== false) ctx.ui.notify(`pruner: summarization failed: ${failure.failureMessage}`, "error");
    return failure;
  }
}

/**
 * Summarizes multiple captured batches — one LLM call per batch, run in parallel.
 *
 * Returns an array of per-batch results. Each element is either a SummarizeResult
 * (success) or null (that specific batch's call failed). The array length always
 * equals batches.length so callers can zip by index.
 *
 * Rationale for parallel-per-batch instead of a single merged call:
 *   • Each batch becomes its own summary message (one per turn), so they can be
 *     rendered, browsed, and recovered independently via context_tree_query.
 *   • Parallel calls give similar end-to-end latency to a single merged call while
 *     keeping the summaries strictly separated.
 */
export async function summarizeBatches(
  batches: CapturedBatch[],
  config: ContextPruneConfig,
  ctx: ExtensionContext,
  options: SummarizeBatchesOptions = {}
): Promise<Array<SummarizeResult | SummarizeFailure>> {
  if (batches.length === 0) return [];
  // Single batch — delegate to the single-batch path (no extra overhead)
  if (batches.length === 1) {
    return [
      await summarizeBatch(batches[0], config, ctx, {
        signal: options.signal,
        onTextProgress: (receivedChars) => {
          options.onBatchTextProgress?.(0, 1, batches[0], receivedChars);
        },
      }),
    ];
  }

  // Multiple batches — run in parallel; each produces its own SummarizeResult
  return Promise.all(
    batches.map((batch, index) =>
      summarizeBatch(batch, config, ctx, {
        signal: options.signal,
        onTextProgress: (receivedChars) => {
          options.onBatchTextProgress?.(index, batches.length, batch, receivedChars);
        },
      })
    )
  );
}
