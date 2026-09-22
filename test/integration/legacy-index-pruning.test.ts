import { describe, expect, it } from "vitest";
import { ToolCallIndexer } from "../../src/indexer.js";
import { pruneMessages } from "../../src/pruner.js";
import { CUSTOM_TYPE_INDEX } from "../../src/types.js";

describe("legacy index reconstruction and pruning", () => {
  it("preserves an image result while pruning an indexed text result after reload", () => {
    const indexer = new ToolCallIndexer();
    indexer.reconstructFromSession({
      sessionManager: {
        getBranch: () => [{
          type: "custom",
          customType: CUSTOM_TYPE_INDEX,
          data: {
            toolCalls: [
              { toolCallId: "legacy-image", toolName: "read", args: {}, resultText: "", isError: false, turnIndex: 0, timestamp: 0 },
              { toolCallId: "legacy-text", toolName: "read", args: {}, resultText: "recoverable text", isError: false, turnIndex: 1, timestamp: 1 },
            ],
          },
        }],
      },
    } as any);

    const imageResult = { role: "toolResult", toolCallId: "legacy-image", content: [{ type: "image", data: "base64", mimeType: "image/png" }] };
    const textResult = { role: "toolResult", toolCallId: "legacy-text", content: [{ type: "text", text: "recoverable text" }] };

    expect(pruneMessages([imageResult, textResult], indexer)).toEqual([imageResult]);
  });
});
