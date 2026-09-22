import type { ToolCallIndexer } from "./indexer.js";

function isTextOnlyToolResult(message: any): boolean {
  return Array.isArray(message?.content) && message.content.every((block: any) => block?.type === "text");
}

/**
 * Filters the `context` event message array.
 * Removes ToolResultMessage entries where toolCallId is in the index.
 * Keeps ALL other messages including AssistantMessages with tool-call blocks.
 */
export function pruneMessages(messages: any[], indexer: ToolCallIndexer): any[] {
  return messages.filter((msg) => {
    // Only remove toolResult messages that have been summarized
    if (
      msg.role === "toolResult" &&
      isTextOnlyToolResult(msg) &&
      indexer.isSummarized(msg.toolCallId)
    ) {
      return false;
    }
    return true;
  });
}
