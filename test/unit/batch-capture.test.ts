import { describe, expect, it } from "vitest";
import { buildSessionProjection } from "@earendil-works/pi-coding-agent";
import { captureUnindexedBatchesFromSession } from "../../src/batch-capture.js";

const unsummarizedIndexer = { isSummarized: () => false };

describe("captureUnindexedBatchesFromSession active branch", () => {
  it("captures a completed tool result retained after compaction", () => {
    const batches = captureUnindexedBatchesFromSession(
      [
        { id: "compaction-1", type: "compaction", firstKeptEntryId: "assistant-after" },
        {
          id: "assistant-after",
          type: "message",
          timestamp: "2025-01-01T00:00:00.000Z",
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "I checked the active branch." },
              { type: "toolCall", id: "active-call", name: "read", input: { path: "active.txt" } },
            ],
          },
        },
        {
          id: "result-after",
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "active-call",
            content: [{ type: "text", text: "active result" }],
          },
        },
      ],
      unsummarizedIndexer,
    );

    expect(batches).toEqual([
      {
        turnIndex: 0,
        timestamp: Date.parse("2025-01-01T00:00:00.000Z"),
        assistantText: "I checked the active branch.",
        toolCalls: [
          {
            toolCallId: "active-call",
            toolName: "read",
            args: { path: "active.txt" },
            resultText: "active result",
            isError: false,
          },
        ],
        userTurnGroup: 0,
      },
    ]);
  });

  it("excludes tool results from before the latest compaction", () => {
    const batches = captureUnindexedBatchesFromSession(
      [
        {
          id: "assistant-before",
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "stale-call", name: "read", input: { path: "stale.txt" } }],
          },
        },
        {
          id: "result-before",
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "stale-call",
            content: [{ type: "text", text: "stale result" }],
          },
        },
        { id: "compaction-1", type: "compaction", firstKeptEntryId: "assistant-after" },
        {
          id: "assistant-after",
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "toolCall", id: "active-call", name: "read", input: { path: "active.txt" } }],
          },
        },
        {
          id: "result-after",
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: "active-call",
            content: [{ type: "text", text: "active result" }],
          },
        },
      ],
      unsummarizedIndexer,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0].toolCalls.map((toolCall) => toolCall.toolCallId)).toEqual(["active-call"]);
    expect(batches[0].turnIndex).toBe(1);
    expect(batches[0].toolCalls.map((toolCall) => toolCall.resultText)).not.toContain("stale result");
  });
});

describe("captureUnindexedBatchesFromProjection", () => {
  const project = (sourceEntry: any, messages: any[]) => ({ sourceEntry, messages });

  it("does not capture a tool result omitted by a context edit", async () => {
    const { captureUnindexedBatchesFromProjection, serializeBatchesForSummarizer } = await import("../../src/batch-capture.js");
    const assistant = { id: "assistant", type: "message", timestamp: "2025-01-01T00:00:00.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "hidden-call", name: "read", input: {} }] } };
    const result = { id: "result", type: "message", message: { role: "toolResult", toolCallId: "hidden-call", content: [{ type: "text", text: "sensitive raw text" }] } };
    const edit = { id: "edit", type: "context_edit", targetId: "result", replacement: null };

    const batches = captureUnindexedBatchesFromProjection(
      [assistant, result, edit],
      [project(assistant, [assistant.message]), project(result, []), project(edit, [])],
      unsummarizedIndexer,
    );

    expect(batches).toEqual([]);
    expect(serializeBatchesForSummarizer(batches)).not.toContain("sensitive raw text");
  });

  it("captures only replacement content for an edited tool result", async () => {
    const { captureUnindexedBatchesFromProjection, serializeBatchesForSummarizer } = await import("../../src/batch-capture.js");
    const assistant = { id: "assistant", type: "message", timestamp: "2025-01-01T00:00:00.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "replaced-call", name: "read", input: {} }] } };
    const result = { id: "result", type: "message", message: { role: "toolResult", toolCallId: "replaced-call", content: [{ type: "text", text: "raw secret" }] } };
    const edit = { id: "edit", type: "context_edit", targetId: "result", replacement: { content: [{ type: "text", text: "safe replacement" }] } };
    const replacement = { ...result.message, content: edit.replacement.content };

    const batches = captureUnindexedBatchesFromProjection(
      [assistant, result, edit],
      [project(assistant, [assistant.message]), project(result, [replacement]), project(edit, [])],
      unsummarizedIndexer,
    );

    expect(batches[0].toolCalls).toMatchObject([{ toolCallId: "replaced-call", resultText: "safe replacement" }]);
    expect(serializeBatchesForSummarizer(batches)).not.toContain("raw secret");
  });

  it("keeps compaction-relative turn indexes while using the projected active tail", async () => {
    const { captureUnindexedBatchesFromProjection } = await import("../../src/batch-capture.js");
    const before = { id: "before", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "old", name: "read", input: {} }] } };
    const oldResult = { id: "old-result", type: "message", message: { role: "toolResult", toolCallId: "old", content: [{ type: "text", text: "old raw" }] } };
    const compaction = { id: "compact", type: "compaction", firstKeptEntryId: "after" };
    const after = { id: "after", type: "message", timestamp: "2025-01-01T00:00:01.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "active", name: "read", input: {} }] } };
    const afterResult = { id: "after-result", type: "message", message: { role: "toolResult", toolCallId: "active", content: [{ type: "text", text: "raw active" }] } };
    const edit = { id: "edit", type: "context_edit", targetId: "after-result", replacement: { content: [{ type: "text", text: "projected active" }] } };
    const replacement = { ...afterResult.message, content: edit.replacement.content };

    const batches = captureUnindexedBatchesFromProjection(
      [before, oldResult, compaction, after, afterResult, edit],
      [project(compaction, []), project(after, [after.message]), project(afterResult, [replacement]), project(edit, [])],
      unsummarizedIndexer,
    );

    expect(batches).toHaveLength(1);
    expect(batches[0]).toMatchObject({ turnIndex: 1, toolCalls: [{ toolCallId: "active", resultText: "projected active" }] });
  });

  it("ignores unrelated context edits without breaking matching", async () => {
    const { captureUnindexedBatchesFromProjection } = await import("../../src/batch-capture.js");
    const user = { id: "user", type: "message", message: { role: "user", content: "request" } };
    const assistant = { id: "assistant", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", input: {} }] } };
    const result = { id: "result", type: "message", message: { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "visible result" }] } };
    const edit = { id: "edit", type: "context_edit", targetId: "user", replacement: null };

    const batches = captureUnindexedBatchesFromProjection(
      [user, assistant, result, edit],
      [project(user, []), project(assistant, [assistant.message]), project(result, [result.message]), project(edit, [])],
      unsummarizedIndexer,
    );

    expect(batches[0].toolCalls).toMatchObject([{ toolCallId: "call", resultText: "visible result" }]);
  });

  it("preserves user-turn boundaries when a user entry is omitted", async () => {
    const { captureUnindexedBatchesFromProjection } = await import("../../src/batch-capture.js");
    const user1 = { id: "user-1", type: "message", message: { role: "user", content: "first" } };
    const assistant1 = { id: "assistant-1", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-1", name: "read", input: {} }] } };
    const result1 = { id: "result-1", type: "message", message: { role: "toolResult", toolCallId: "call-1", content: [{ type: "text", text: "first result" }] } };
    const user2 = { id: "user-2", type: "message", message: { role: "user", content: "second" } };
    const assistant2 = { id: "assistant-2", type: "message", message: { role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "read", input: {} }] } };
    const result2 = { id: "result-2", type: "message", message: { role: "toolResult", toolCallId: "call-2", content: [{ type: "text", text: "second result" }] } };

    const batches = captureUnindexedBatchesFromProjection(
      [user1, assistant1, result1, user2, assistant2, result2],
      [project(user1, [user1.message]), project(assistant1, [assistant1.message]), project(result1, [result1.message]), project(user2, []), project(assistant2, [assistant2.message]), project(result2, [result2.message])],
      unsummarizedIndexer,
    );

    expect(batches.map((batch) => batch.userTurnGroup)).toEqual([1, 2]);
  });

  it("uses Pi's projection to apply context-edit omission and replacement", async () => {
    const { captureUnindexedBatchesFromProjection } = await import("../../src/batch-capture.js");
    const assistant = { id: "assistant", type: "message", timestamp: "2025-01-01T00:00:00.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "call", name: "read", input: {} }] } };
    const result = { id: "result", type: "message", parentId: "assistant", timestamp: "2025-01-01T00:00:00.000Z", message: { role: "toolResult", toolCallId: "call", content: [{ type: "text", text: "raw secret" }] } };
    const edit = { id: "edit", type: "context_edit", parentId: "result", targetId: "result", replacement: { content: [{ type: "text", text: "safe replacement" }] } };
    const projection = buildSessionProjection([assistant, result, edit] as any);

    const batches = captureUnindexedBatchesFromProjection([assistant, result, edit], projection.entries, unsummarizedIndexer);
    const omittedProjection = buildSessionProjection([assistant, result, { ...edit, replacement: null }] as any);
    const omittedBatches = captureUnindexedBatchesFromProjection([assistant, result, edit], omittedProjection.entries, unsummarizedIndexer);

    expect(projection.entries.find((entry) => entry.sourceEntry.id === "result")?.messages[0]).toMatchObject({ toolCallId: "call", content: [{ type: "text", text: "safe replacement" }] });
    expect(omittedBatches).toEqual([]);
    expect(batches[0]).toMatchObject({ timestamp: Date.parse("2025-01-01T00:00:00.000Z"), toolCalls: [{ toolCallId: "call", resultText: "safe replacement" }] });
  });
});
