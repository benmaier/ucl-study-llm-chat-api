/**
 * FileWriter — persists conversations as JSON files on disk.
 *
 * ## Behavior
 *
 * Writes the **full** `SerializedConversation` snapshot to a single JSON file.
 * The file is overwritten on every event (conversation start, turn complete),
 * so it always reflects the latest complete state. This makes it simple and
 * crash-safe: if the process dies mid-turn, the file still contains the last
 * successfully completed turn.
 *
 * ## Usage
 *
 * ```typescript
 * import { Conversation, FileWriter } from "ucl-study-llm-chat-api";
 *
 * const writer = new FileWriter("/tmp/conversation.json");
 * const conv = new Conversation({
 *   provider: "anthropic",
 *   writers: [writer],
 * });
 *
 * await conv.send("Hello", onEvent);
 * // /tmp/conversation.json now contains the full conversation state
 * ```
 *
 * ## Resuming from a file
 *
 * ```typescript
 * const conv = await Conversation.loadFromFile("/tmp/conversation.json");
 * await conv.send("Follow-up question", onEvent);
 * ```
 *
 * ## Limitations
 *
 * - `onFileUploaded` is a no-op. Uploaded file metadata is included in the
 *   next `onTurnComplete` snapshot. If you need immediate persistence of
 *   uploads (before a turn references them), subclass and override.
 * - The file grows with each turn (all turns + base64 file data). For
 *   long-running conversations with many generated files, consider a
 *   database-backed writer instead.
 */

import { writeFile } from "fs/promises";
import { ConversationWriter } from "./conversation-writer.js";
import type { SerializedConversation, TurnRecord, UploadRecord } from "./conversation-store.js";

export class FileWriter extends ConversationWriter {
  /**
   * @param filePath - Absolute or relative path where the JSON file will be written.
   *   Parent directory must exist. The file is created on first write and overwritten
   *   on subsequent writes.
   */
  constructor(private filePath: string) {
    super();
  }

  async onConversationStart(conversation: SerializedConversation): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(conversation, null, 2));
  }

  async onTurnComplete(
    _conversationId: string,
    _turn: TurnRecord,
    conversation: SerializedConversation
  ): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(conversation, null, 2));
  }

  async onFileUploaded(
    _conversationId: string,
    _upload: UploadRecord
  ): Promise<void> {
    // No-op: the full conversation (including uploads) is written on the next
    // turn via onTurnComplete. If you need immediate persistence of uploads,
    // subclass FileWriter and override this method.
  }
}
