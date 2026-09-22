import { describe, expect, it } from "vitest";
import { pruneMessages } from "../../src/pruner.js";

const indexer = { isSummarized: () => true } as any;

describe("pruneMessages", () => {
  it("retains a legacy indexed result that contains an image", () => {
    const imageResult = {
      role: "toolResult",
      toolCallId: "legacy-image",
      content: [{ type: "image", data: "base64", mimeType: "image/png" }],
    };

    expect(pruneMessages([imageResult], indexer)).toEqual([imageResult]);
  });

  it("continues to prune indexed text-only results", () => {
    const textResult = {
      role: "toolResult",
      toolCallId: "indexed-text",
      content: [{ type: "text", text: "recoverable" }],
    };

    expect(pruneMessages([textResult], indexer)).toEqual([]);
  });
});
