import { describe, expect, it } from "vitest";
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
    expect(batches[0].toolCalls.map((toolCall) => toolCall.resultText)).not.toContain("stale result");
  });
});
