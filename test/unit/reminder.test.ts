import { describe, expect, it } from "vitest";
import { countUnprunedToolCalls } from "../../src/reminder.js";

const indexer = (summarized: string[] = []) => ({
  isSummarized: (id: string) => summarized.includes(id),
}) as any;

describe("countUnprunedToolCalls", () => {
  it("counts only unsummarized calls with a visible matching result", () => {
    const messages = [
      { role: "assistant", content: [
        { type: "toolCall", id: "visible", name: "read", input: {} },
        { type: "toolCall", id: "omitted", name: "read", input: {} },
        { type: "toolCall", id: "already-pruned", name: "read", input: {} },
      ] },
      { role: "toolResult", toolCallId: "visible", content: [{ type: "text", text: "shown" }] },
      { role: "toolResult", toolCallId: "already-pruned", content: [{ type: "text", text: "summary exists" }] },
    ];

    expect(countUnprunedToolCalls(messages, indexer(["already-pruned"]))).toBe(1);
  });
});
