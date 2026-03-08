/**
 * Unified Conversation class for multi-turn LLM code execution.
 *
 * ## Overview
 *
 * Wraps Claude (Anthropic), OpenAI, and Gemini behind a single interface.
 * Manages all provider-specific state internally — callers never touch
 * raw messages arrays, response IDs, or contents arrays directly.
 *
 * ## Lifecycle
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────┐
 * │  new Conversation({ provider, writers? })                    │
 * │   └─ notifies writers: onConversationStart()                 │
 * │                                                              │
 * │  conv.uploadFile(path) → UploadedFile                        │
 * │   └─ stores base64 in UploadRecord (if persistUploadData)    │
 * │   └─ notifies writers: onFileUploaded()                      │
 * │                                                              │
 * │  conv.send(message, onEvent, { fileIds? }) → TurnResult      │
 * │   └─ calls provider API (streaming)                          │
 * │   └─ captures base64 of generated files                      │
 * │   └─ records TurnRecord with providerStateAfter              │
 * │   └─ notifies writers: onTurnComplete(turn, fullSnapshot)    │
 * │                                                              │
 * │  conv.downloadFiles(files, outputDir) → paths                │
 * │  conv.deleteFile(fileId)                                     │
 * └──────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Persistence
 *
 * Attach one or more {@link ConversationWriter} instances via `options.writers`.
 * After each turn, every writer receives the full `SerializedConversation`
 * snapshot (fire-and-forget). To resume later:
 *
 * ```typescript
 * // Save: happens automatically via writers (e.g. FileWriter)
 * // Resume:
 * const conv = await Conversation.loadFromFile("conversation.json");
 * await conv.send("continue...", onEvent);
 * ```
 *
 * ## Provider switching
 *
 * To switch providers mid-conversation (e.g. Claude → OpenAI after an error):
 *
 * ```typescript
 * const conv = await Conversation.resume(savedData, { provider: "openai" });
 * ```
 *
 * This reconstructs context from the text history and re-uploads all files
 * (user uploads + generated files) to the new provider. File IDs are
 * automatically mapped — old IDs passed to `send()` are translated to
 * the new provider's IDs.
 *
 * ### Provider switching internals
 *
 * | Target provider | Text history reconstruction | File re-upload |
 * |-----------------|---------------------------|----------------|
 * | Claude          | Injected as messages[]    | Via Files API  |
 * | OpenAI          | Prepended as text block on first send() | Via Files API  |
 * | Gemini          | Injected as contents[]    | Via Files API  |
 *
 * Note: provider switching is lossy — execution state (sandbox containers,
 * variable bindings) does not transfer. Only text history and files carry over.
 */

import { randomUUID } from "crypto";
import { readFile } from "fs/promises";
import type Anthropic from "@anthropic-ai/sdk";
import type OpenAI from "openai";
import type { GoogleGenAI } from "@google/genai";
import type {
  ConversationOptions,
  TurnResult,
  ConversationMessage,
  StreamEvent,
  SendOptions,
  UploadedFile,
  CodeExecutionFile,
} from "./types.js";
import type { ConversationWriter } from "./conversation-writer.js";
import {
  CONVERSATION_FORMAT_VERSION,
  validateSerializedConversation,
  type Provider,
  type SerializedConversation,
  type TurnRecord,
  type UploadRecord,
  type ProviderState,
} from "./conversation-store.js";
import {
  createAnthropicClient,
  executeCodeWithClaudeMultiTurn,
  uploadFile as uploadClaudeFile,
  uploadFileFromBuffer as uploadClaudeFileFromBuffer,
  deleteFile as deleteClaudeFile,
  downloadGeneratedFiles as downloadClaudeFiles,
  downloadFileToBuffer as downloadClaudeFileToBuffer,
} from "./anthropic-client.js";
import {
  createOpenAIClient,
  executeCodeWithOpenAIMultiTurn,
  uploadFile as uploadOpenAIFile,
  uploadFileFromBuffer as uploadOpenAIFileFromBuffer,
  deleteFile as deleteOpenAIFile,
  downloadGeneratedFiles as downloadOpenAIFiles,
  downloadFileToBuffer as downloadOpenAIFileToBuffer,
} from "./openai-client.js";
import {
  createGeminiClient,
  executeCodeWithGeminiMultiTurn,
  uploadFile as uploadGeminiFile,
  uploadFileFromBuffer as uploadGeminiFileFromBuffer,
  deleteFile as deleteGeminiFile,
  downloadGeneratedFiles as downloadGeminiFiles,
} from "./gemini-client.js";

export class Conversation {
  private provider: Provider;
  private model?: string;
  private maxTokens?: number;

  // Provider clients
  private anthropicClient?: Anthropic;
  private openaiClient?: OpenAI;
  private geminiClient?: GoogleGenAI;

  // Claude state
  private rawMessages: ConversationMessage[] = [];
  private containerId?: string;

  // OpenAI state
  private responseId?: string;

  // Gemini state
  private geminiContents: any[] = [];

  // Provider-agnostic text history
  private textHistory: { role: "user" | "assistant"; content: string }[] = [];

  // Persistence
  private id: string;
  private createdAt: string;
  private updatedAt: string;
  private metadata?: Record<string, any>;
  private turns: TurnRecord[] = [];
  private uploads: UploadRecord[] = [];
  private writers: ConversationWriter[] = [];
  private persistUploadData: boolean;

  // Provider switching: text history to inject on first send after switch
  private switchedFromHistory?: { role: "user" | "assistant"; content: string }[];

  // File ID mapping from provider switch re-uploads (oldId → newId)
  private fileIdMap: Map<string, string> = new Map();

  /**
   * Create a new conversation.
   *
   * Initializes the provider client and notifies all attached writers via
   * `onConversationStart()`. To resume an existing conversation, use the
   * static `Conversation.resume()` or `Conversation.loadFromFile()` methods.
   *
   * @param options.provider - Which LLM provider to use ("anthropic" | "openai" | "gemini").
   * @param options.apiKey - API key override. Falls back to the corresponding env var.
   * @param options.model - Model override (e.g. "claude-sonnet-4-5-20250929").
   * @param options.maxTokens - Max tokens override for the provider.
   * @param options.id - Unique conversation ID. Auto-generated (UUID) if omitted.
   * @param options.metadata - Arbitrary metadata (experiment condition, participant ID, etc.).
   * @param options.writers - Writers to notify after each turn (fire-and-forget).
   * @param options.persistUploadData - Store base64 of uploaded files for re-upload on
   *   provider switch. Default: true.
   */
  constructor(options: ConversationOptions) {
    this.provider = options.provider;
    this.model = options.model;
    this.maxTokens = options.maxTokens;
    this.id = options.id ?? randomUUID();
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
    this.metadata = options.metadata;
    this.writers = options.writers ?? [];
    this.persistUploadData = options.persistUploadData ?? true;

    if (this.provider === "anthropic") {
      this.anthropicClient = createAnthropicClient(options.apiKey);
    } else if (this.provider === "gemini") {
      this.geminiClient = createGeminiClient(options.apiKey);
    } else {
      this.openaiClient = createOpenAIClient(options.apiKey);
    }

    // Notify writers of conversation start (fire-and-forget)
    if (this.writers.length > 0) {
      const serialized = this.serialize();
      for (const writer of this.writers) {
        writer.onConversationStart(serialized).catch(err =>
          console.error("Writer onConversationStart error:", err)
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Static factories: resume from serialized data
  // ---------------------------------------------------------------------------

  /**
   * Resume a conversation from a serialized snapshot.
   *
   * ### Same-provider resume
   * Restores native provider state from the last turn's `providerStateAfter`.
   * The conversation continues as if it never stopped (same container, same
   * response chain, same contents array).
   *
   * ### Cross-provider resume (provider switch)
   * When `options.provider` differs from the saved provider:
   * 1. Text history is reconstructed in the target provider's format.
   * 2. All files with base64 data (user uploads + generated files) are
   *    re-uploaded to the new provider. Old→new file ID mappings are stored
   *    and can be retrieved via `getFileIdMap()`.
   * 3. File IDs passed to subsequent `send()` calls are auto-translated.
   *
   * @param data - A `SerializedConversation` snapshot (from a Writer, file, or DB).
   * @param options.apiKey - API key for the target provider.
   * @param options.provider - Override provider (triggers provider switch if different).
   * @param options.writers - Writers to attach to the resumed conversation.
   * @param options.metadata - Override metadata (otherwise restored from snapshot).
   * @returns The reconstructed Conversation, ready for `send()`.
   */
  static async resume(
    data: SerializedConversation,
    options: {
      apiKey?: string;
      provider?: Provider;
      writers?: ConversationWriter[];
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Conversation> {
    const validated = validateSerializedConversation(data);
    const targetProvider = options.provider ?? validated.provider;
    const isSwitching = targetProvider !== validated.provider;

    // Create instance (writers not passed to constructor to avoid double onConversationStart)
    const conv = new Conversation({
      provider: targetProvider,
      apiKey: options.apiKey,
      model: validated.model,
      maxTokens: validated.maxTokens,
      id: validated.id,
      metadata: options.metadata ?? validated.metadata,
    });

    // Restore state
    conv.createdAt = validated.createdAt;
    conv.updatedAt = validated.updatedAt;
    conv.textHistory = [...validated.textHistory];
    conv.turns = [...validated.turns];
    conv.uploads = [...validated.uploads];
    conv.writers = options.writers ?? [];

    if (!isSwitching && validated.turns.length > 0) {
      // Same provider: restore native state from last turn
      const lastState = validated.turns[validated.turns.length - 1].providerStateAfter;
      conv.restoreProviderState(targetProvider, lastState);
    } else if (isSwitching) {
      // Different provider: reconstruct from text history
      if (validated.textHistory.length > 0) {
        conv.reconstructForNewProvider(validated.textHistory);
      }

      // Re-upload files that have base64 data to the new provider
      await conv.reuploadFiles(validated);
    }

    return conv;
  }

  /**
   * Load and resume a conversation from a JSON file (as written by {@link FileWriter}).
   *
   * Convenience wrapper around `Conversation.resume()` that reads and parses
   * the file first. Supports the same `options` for provider switching,
   * writer attachment, etc.
   *
   * @param filePath - Path to the JSON file containing a `SerializedConversation`.
   */
  static async loadFromFile(
    filePath: string,
    options: {
      apiKey?: string;
      provider?: Provider;
      writers?: ConversationWriter[];
      metadata?: Record<string, any>;
    } = {}
  ): Promise<Conversation> {
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    return await Conversation.resume(data, options);
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  /**
   * Upload a file from disk to the current provider.
   *
   * The file becomes available for reference in subsequent `send()` calls
   * via `options.fileIds`. If `persistUploadData` is true (default), the
   * file content is stored as base64 in the UploadRecord for re-upload
   * on provider switch.
   *
   * @param filePath - Path to the file on disk.
   * @param mimeType - Optional MIME type override. Auto-detected if omitted.
   * @returns An `UploadedFile` with the provider-specific `file_id`.
   */
  async uploadFile(filePath: string, mimeType?: string): Promise<UploadedFile> {
    let result: UploadedFile;
    if (this.provider === "anthropic") {
      result = await uploadClaudeFile(this.anthropicClient!, filePath, mimeType);
    } else if (this.provider === "gemini") {
      result = await uploadGeminiFile(this.geminiClient!, filePath, mimeType);
    } else {
      result = await uploadOpenAIFile(this.openaiClient!, filePath);
    }

    // Record upload
    const record: UploadRecord = {
      fileId: result.file_id,
      filename: result.filename,
      mimeType: result.mime_type,
      sizeBytes: result.size_bytes,
      provider: this.provider,
      uploadedAt: new Date().toISOString(),
    };
    if (this.persistUploadData) {
      const fs = await import("fs");
      record.base64Data = fs.readFileSync(filePath).toString("base64");
    }
    this.uploads.push(record);
    this.notifyUpload(record);

    return result;
  }

  /**
   * Upload a file from an in-memory Buffer to the current provider.
   *
   * Same behavior as `uploadFile()` but accepts a Buffer instead of a path.
   * If `persistUploadData` is true (default), the buffer content is stored
   * as base64 in the UploadRecord.
   *
   * @param buffer - File content as a Buffer.
   * @param filename - Filename to report to the provider (e.g. "data.csv").
   * @param mimeType - Optional MIME type override.
   * @returns An `UploadedFile` with the provider-specific `file_id`.
   */
  async uploadFileFromBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string
  ): Promise<UploadedFile> {
    let result: UploadedFile;
    if (this.provider === "anthropic") {
      result = await uploadClaudeFileFromBuffer(this.anthropicClient!, buffer, filename, mimeType);
    } else if (this.provider === "gemini") {
      result = await uploadGeminiFileFromBuffer(this.geminiClient!, buffer, filename, mimeType);
    } else {
      result = await uploadOpenAIFileFromBuffer(this.openaiClient!, buffer, filename);
    }

    const record: UploadRecord = {
      fileId: result.file_id,
      filename: result.filename,
      mimeType: result.mime_type,
      sizeBytes: result.size_bytes,
      provider: this.provider,
      uploadedAt: new Date().toISOString(),
    };
    if (this.persistUploadData) {
      record.base64Data = buffer.toString("base64");
    }
    this.uploads.push(record);
    this.notifyUpload(record);

    return result;
  }

  /**
   * Delete a previously uploaded file from the current provider.
   *
   * @param fileId - The provider-specific file ID (from `UploadedFile.file_id`).
   */
  async deleteFile(fileId: string): Promise<void> {
    if (this.provider === "anthropic") {
      return deleteClaudeFile(this.anthropicClient!, fileId);
    } else if (this.provider === "gemini") {
      return deleteGeminiFile(this.geminiClient!, fileId);
    } else {
      return deleteOpenAIFile(this.openaiClient!, fileId);
    }
  }

  /**
   * Download files generated during code execution to disk.
   *
   * @param files - Array of `CodeExecutionFile` objects (from `TurnResult.files`).
   * @param outputDir - Directory to write files to. Defaults to current directory.
   * @returns Array of file paths written to disk.
   */
  async downloadFiles(
    files: CodeExecutionFile[],
    outputDir: string = "."
  ): Promise<string[]> {
    if (this.provider === "anthropic") {
      return downloadClaudeFiles(this.anthropicClient!, files, outputDir);
    } else if (this.provider === "gemini") {
      return downloadGeminiFiles(files, outputDir);
    } else {
      return downloadOpenAIFiles(files, outputDir);
    }
  }

  // ---------------------------------------------------------------------------
  // Send
  // ---------------------------------------------------------------------------

  /**
   * Send a message and get the assistant's response (with code execution).
   *
   * This is the main interaction method. It:
   * 1. Sends the message to the current provider's API (streaming).
   * 2. Captures base64 data for any generated files.
   * 3. Records a TurnRecord and notifies all writers.
   * 4. Returns the assistant's text, generated files, and code artifacts.
   *
   * If the conversation was resumed with a provider switch, file IDs in
   * `options.fileIds` are automatically translated from old→new IDs.
   *
   * @param message - The user's message text.
   * @param onEvent - Callback for streaming events (text chunks, code execution status, etc.).
   *   Use `(_event) => {}` for a silent handler.
   * @param options.fileIds - File IDs to make available for code execution in this turn.
   *   These are the IDs returned by `uploadFile()` / `uploadFileFromBuffer()`.
   * @returns Text response, generated files, and code artifacts.
   */
  async send(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    // Auto-translate file IDs if we have a mapping from provider switch
    let resolvedOptions = options;
    if (options?.fileIds && this.fileIdMap.size > 0) {
      resolvedOptions = {
        ...options,
        fileIds: options.fileIds.map(id => this.fileIdMap.get(id) ?? id),
      };
    }

    if (this.provider === "anthropic") {
      return this.sendClaude(message, onEvent, resolvedOptions);
    } else if (this.provider === "gemini") {
      return this.sendGemini(message, onEvent, resolvedOptions);
    } else {
      return this.sendOpenAI(message, onEvent, resolvedOptions);
    }
  }

  private async sendClaude(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    const startedAt = new Date().toISOString();

    const result = await executeCodeWithClaudeMultiTurn(
      this.anthropicClient!,
      message,
      onEvent,
      this.rawMessages.length > 0 ? this.rawMessages : undefined,
      {
        model: this.model,
        maxTokens: this.maxTokens,
        containerId: this.containerId,
        fileIds: options?.fileIds,
      }
    );

    // Capture base64 for generated files (for persistence/provider switch)
    await this.captureGeneratedFileData(result.files);

    // Update internal state
    this.rawMessages = result.messages;
    this.containerId = result.containerId;
    this.textHistory.push({ role: "user", content: message });
    this.textHistory.push({ role: "assistant", content: result.text });

    // Record turn
    this.recordTurn(startedAt, message, options?.fileIds ?? [], result.text, result.codeArtifacts, result.files, {
      claudeMessages: this.rawMessages as any,
      claudeContainerId: this.containerId,
    });

    return { text: result.text, files: result.files, codeArtifacts: result.codeArtifacts };
  }

  private async sendOpenAI(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    const startedAt = new Date().toISOString();

    // If resuming from a different provider, prepend history as context
    let effectiveMessage = message;
    if (this.switchedFromHistory && !this.responseId) {
      const historyBlock = this.switchedFromHistory
        .map(h => `${h.role === "user" ? "User" : "Assistant"}: ${h.content}`)
        .join("\n\n");
      effectiveMessage = `[Previous conversation context]\n${historyBlock}\n\n[Current message]\n${message}`;
      this.switchedFromHistory = undefined;
    }

    const result = await executeCodeWithOpenAIMultiTurn(
      this.openaiClient!,
      effectiveMessage,
      onEvent,
      this.responseId,
      {
        model: this.model,
        maxTokens: this.maxTokens,
        fileIds: options?.fileIds,
      }
    );

    // Capture base64 for generated files (for persistence/provider switch)
    await this.captureGeneratedFileData(result.files);

    // Update internal state
    this.responseId = result.responseId;
    this.containerId = result.containerId;
    this.textHistory.push({ role: "user", content: message });
    this.textHistory.push({ role: "assistant", content: result.text });

    // Record turn
    this.recordTurn(startedAt, message, options?.fileIds ?? [], result.text, result.codeArtifacts, result.files, {
      openaiResponseId: this.responseId,
      openaiContainerId: this.containerId,
    });

    return { text: result.text, files: result.files, codeArtifacts: result.codeArtifacts };
  }

  private async sendGemini(
    message: string,
    onEvent: (event: StreamEvent) => void,
    options?: SendOptions
  ): Promise<TurnResult> {
    const startedAt = new Date().toISOString();

    const result = await executeCodeWithGeminiMultiTurn(
      this.geminiClient!,
      message,
      onEvent,
      this.geminiContents.length > 0 ? this.geminiContents : undefined,
      {
        model: this.model,
        maxTokens: this.maxTokens,
        fileIds: options?.fileIds,
      }
    );

    // Update internal state
    this.geminiContents = result.geminiContents || [];
    this.textHistory.push({ role: "user", content: message });
    this.textHistory.push({ role: "assistant", content: result.text });

    // Record turn
    this.recordTurn(startedAt, message, options?.fileIds ?? [], result.text, result.codeArtifacts, result.files, {
      geminiContents: this.geminiContents,
    });

    return { text: result.text, files: result.files, codeArtifacts: result.codeArtifacts };
  }

  // ---------------------------------------------------------------------------
  // Persistence internals
  // ---------------------------------------------------------------------------

  /** Build a TurnRecord from a completed turn, push to this.turns, and notify writers. */
  private recordTurn(
    startedAt: string,
    userMessage: string,
    fileIds: string[],
    assistantText: string,
    codeArtifacts: TurnResult["codeArtifacts"],
    files: CodeExecutionFile[],
    providerStateAfter: ProviderState
  ): void {
    const turn: TurnRecord = {
      turnNumber: this.turns.length + 1,
      startedAt,
      completedAt: new Date().toISOString(),
      userMessage,
      attachedFileIds: fileIds,
      assistantText,
      codeArtifacts,
      generatedFiles: files.map(f => ({
        fileId: f.file_id,
        filename: f.filename,
        containerId: f.container_id,
        mimeType: f.mimeType,
        base64Data: f.base64Data,
      })),
      provider: this.provider,
      model: this.model,
      providerStateAfter,
    };
    this.turns.push(turn);
    this.updatedAt = turn.completedAt;
    this.notifyTurn(turn);
  }

  /** Fire-and-forget: serialize current state and call onTurnComplete on all writers. */
  private notifyTurn(turn: TurnRecord): void {
    if (this.writers.length === 0) return;
    const serialized = this.serialize();
    for (const writer of this.writers) {
      writer.onTurnComplete(this.id, turn, serialized).catch(err =>
        console.error("Writer onTurnComplete error:", err)
      );
    }
  }

  /** Fire-and-forget: call onFileUploaded on all writers. */
  private notifyUpload(upload: UploadRecord): void {
    for (const writer of this.writers) {
      writer.onFileUploaded(this.id, upload).catch(err =>
        console.error("Writer onFileUploaded error:", err)
      );
    }
  }

  /** Build the full serialized conversation from current state. */
  private serialize(): SerializedConversation {
    return {
      formatVersion: CONVERSATION_FORMAT_VERSION,
      id: this.id,
      provider: this.provider,
      model: this.model,
      maxTokens: this.maxTokens,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
      uploads: this.uploads,
      turns: this.turns,
      textHistory: this.textHistory,
    };
  }

  // ---------------------------------------------------------------------------
  // File data capture & re-upload
  // ---------------------------------------------------------------------------

  /**
   * Download generated files that lack base64Data and attach it.
   * Gemini files already have inline base64; Claude/OpenAI need HTTP download.
   */
  private async captureGeneratedFileData(files: CodeExecutionFile[]): Promise<void> {
    for (const file of files) {
      if (file.base64Data) continue; // already has data (Gemini)

      try {
        if (this.provider === "anthropic") {
          const { buffer, mimeType } = await downloadClaudeFileToBuffer(
            this.anthropicClient!,
            { file_id: file.file_id }
          );
          file.base64Data = buffer.toString("base64");
          if (!file.mimeType && mimeType) file.mimeType = mimeType;
        } else if (this.provider === "openai" && file.container_id) {
          const { buffer, mimeType } = await downloadOpenAIFileToBuffer(
            { file_id: file.file_id, container_id: file.container_id }
          );
          file.base64Data = buffer.toString("base64");
          if (!file.mimeType && mimeType) file.mimeType = mimeType;
        }
      } catch (err) {
        console.error(`Failed to capture base64 for file ${file.file_id}:`, err);
      }
    }
  }

  /**
   * Re-upload user uploads and generated files from a previous conversation
   * to the current (new) provider. Populates fileIdMap with old→new mappings.
   */
  private async reuploadFiles(validated: SerializedConversation): Promise<void> {
    // Re-upload user-uploaded files
    for (const upload of validated.uploads) {
      if (!upload.base64Data) continue;
      try {
        const buffer = Buffer.from(upload.base64Data, "base64");
        const result = await this.uploadFileFromBuffer(buffer, upload.filename, upload.mimeType);
        this.fileIdMap.set(upload.fileId, result.file_id);
      } catch (err) {
        console.error(`Failed to re-upload file ${upload.filename}:`, err);
      }
    }

    // Re-upload generated files from all turns
    for (const turn of validated.turns) {
      for (const gf of turn.generatedFiles) {
        if (!gf.base64Data) continue;
        try {
          const buffer = Buffer.from(gf.base64Data, "base64");
          const result = await this.uploadFileFromBuffer(buffer, gf.filename, gf.mimeType);
          this.fileIdMap.set(gf.fileId, result.file_id);
        } catch (err) {
          console.error(`Failed to re-upload generated file ${gf.filename}:`, err);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Provider switching internals
  // ---------------------------------------------------------------------------

  /**
   * Restore native provider state from a ProviderState snapshot.
   * Used when resuming on the same provider.
   */
  private restoreProviderState(provider: Provider, state: ProviderState): void {
    if (provider === "anthropic") {
      this.rawMessages = (state.claudeMessages ?? []) as ConversationMessage[];
      this.containerId = state.claudeContainerId;
    } else if (provider === "openai") {
      this.responseId = state.openaiResponseId;
      this.containerId = state.openaiContainerId;
    } else if (provider === "gemini") {
      this.geminiContents = state.geminiContents ?? [];
    }
  }

  /**
   * Convert text history into the target provider's native format.
   *
   * - Claude: plain messages[] array (role + content).
   * - OpenAI: stored in `switchedFromHistory` for text-prefix injection
   *   on the first `send()` call (OpenAI can't accept raw message arrays).
   * - Gemini: contents[] array with role remapping (assistant → model).
   */
  private reconstructForNewProvider(
    history: { role: "user" | "assistant"; content: string }[]
  ): void {
    if (this.provider === "anthropic") {
      // Claude accepts a full messages[] array
      this.rawMessages = history.map(h => ({
        role: h.role,
        content: h.content,
      })) as ConversationMessage[];
      this.containerId = undefined;
    } else if (this.provider === "openai") {
      // OpenAI only accepts previous_response_id, not message arrays.
      // Store history for injection on first send().
      this.responseId = undefined;
      this.containerId = undefined;
      this.switchedFromHistory = history;
    } else if (this.provider === "gemini") {
      // Gemini accepts a full contents[] array
      this.geminiContents = history.map(h => ({
        role: h.role === "assistant" ? "model" : "user",
        parts: [{ text: h.content }],
      }));
    }
  }

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  /** Unique conversation ID (UUID). Stable across resume/provider switch. */
  getId(): string {
    return this.id;
  }

  /**
   * Provider-agnostic text history: flat list of user/assistant messages.
   * Returns a copy — mutations do not affect the conversation.
   */
  getHistory(): { role: "user" | "assistant"; content: string }[] {
    return [...this.textHistory];
  }

  /** The currently active provider ("anthropic" | "openai" | "gemini"). */
  getProvider(): Provider {
    return this.provider;
  }

  /**
   * All completed turns, in order. Each TurnRecord includes the user message,
   * assistant response, code artifacts, generated files, and provider state.
   * Returns a copy.
   */
  getTurns(): TurnRecord[] {
    return [...this.turns];
  }

  /**
   * All files uploaded by the user during this conversation.
   * Returns a copy.
   */
  getUploads(): UploadRecord[] {
    return [...this.uploads];
  }

  /**
   * Map of old file IDs → new file IDs created during provider switch re-upload.
   *
   * Empty if the conversation was not resumed with a provider switch, or if
   * no files had base64 data to re-upload. Callers can use this to translate
   * file IDs manually, though `send()` does this automatically.
   */
  getFileIdMap(): Map<string, string> {
    return new Map(this.fileIdMap);
  }

  /**
   * All new-provider file IDs created during provider switch re-upload.
   *
   * Convenience method — equivalent to `[...getFileIdMap().values()]`.
   * Useful for cleanup: pass these to `deleteFile()` when done.
   */
  getReuploadedFileIds(): string[] {
    return [...this.fileIdMap.values()];
  }
}
