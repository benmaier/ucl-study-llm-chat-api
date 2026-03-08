/**
 * Abstract base class for conversation persistence writers.
 *
 * ## Overview
 *
 * A Writer is a pluggable persistence backend. Pass one or more Writer
 * instances to the `Conversation` constructor via `options.writers`.
 * The Conversation class calls the Writer methods at the right moments:
 *
 * - `onConversationStart()` — once, immediately after construction.
 * - `onTurnComplete()` — after each successful user→assistant turn.
 *   Receives the individual TurnRecord *and* the full SerializedConversation
 *   snapshot, so the writer can choose to store either or both.
 * - `onFileUploaded()` — when the user uploads a file via
 *   `conv.uploadFile()` or `conv.uploadFileFromBuffer()`.
 *
 * ## Error handling
 *
 * All writer calls are **fire-and-forget**: the Conversation class calls
 * them with `.catch(err => console.error(...))` and does NOT await the
 * result or propagate errors. This means a slow or failing writer never
 * blocks the conversation. If you need guaranteed delivery, implement
 * retry logic inside your writer.
 *
 * ## Implementing a custom writer
 *
 * ```typescript
 * import { ConversationWriter } from "ucl-study-llm-chat-api";
 *
 * class MyDatabaseWriter extends ConversationWriter {
 *   async onConversationStart(conversation) {
 *     await db.conversations.insert(conversation);
 *   }
 *   async onTurnComplete(id, turn, conversation) {
 *     await db.turns.insert({ conversationId: id, ...turn });
 *   }
 *   async onFileUploaded(id, upload) {
 *     await db.uploads.insert({ conversationId: id, ...upload });
 *   }
 * }
 * ```
 *
 * ## Built-in writers
 *
 * - {@link FileWriter} — writes the full JSON snapshot to a file after
 *   each turn. See `./file-writer.ts`.
 */

import type { SerializedConversation, TurnRecord, UploadRecord } from "./conversation-store.js";

export abstract class ConversationWriter {
  /**
   * Called once when the Conversation is first created (in the constructor).
   * Use this to create an initial record (e.g. a database row) before any
   * turns have been sent.
   *
   * @param conversation - The initial serialized state (no turns yet).
   */
  abstract onConversationStart(conversation: SerializedConversation): Promise<void>;

  /**
   * Called after each successful turn (user message + assistant response).
   *
   * @param conversationId - The conversation's unique ID.
   * @param turn - The just-completed TurnRecord with messages, files, and provider state.
   * @param conversation - Full serialized snapshot including all turns up to and including this one.
   */
  abstract onTurnComplete(
    conversationId: string,
    turn: TurnRecord,
    conversation: SerializedConversation
  ): Promise<void>;

  /**
   * Called when the user uploads a file via `conv.uploadFile()` or
   * `conv.uploadFileFromBuffer()`.
   *
   * Note: this fires immediately after the upload succeeds, which may be
   * before any turn references the file. The UploadRecord includes the
   * provider-specific file ID and optionally the base64 content.
   *
   * @param conversationId - The conversation's unique ID.
   * @param upload - The UploadRecord with file metadata and optional base64 data.
   */
  abstract onFileUploaded(
    conversationId: string,
    upload: UploadRecord
  ): Promise<void>;
}
