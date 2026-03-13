/**
 * Unified message format for reading back stored conversations.
 *
 * Converts provider-specific TurnRecord data into a provider-agnostic
 * interleaved format of text, tool calls, and files.
 *
 * File/image parts carry raw base64 data — URL generation and
 * deduplication are the consumer's responsibility.
 */

import type {
  TurnRecord,
  StoredFile,
  UploadRecord,
} from "./conversation-store.js";

// ---------------------------------------------------------------------------
// Unified message types
// ---------------------------------------------------------------------------

export interface UnifiedTextPart {
  type: "text";
  text: string;
}

export interface UnifiedToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: { code: string };
  /** Execution output (stdout/traceback). Null when unavailable. */
  output: string | null;
}

export interface UnifiedFilePart {
  type: "file";
  fileId: string;
  filename: string;
  mimeType: string | null;
  /** Base64-encoded file content. Null if not captured. */
  base64Data: string | null;
}

export type UnifiedMessagePart =
  | UnifiedTextPart
  | UnifiedToolCallPart
  | UnifiedFilePart;

export interface UnifiedMessage {
  role: "user" | "assistant";
  id: string;
  parts: UnifiedMessagePart[];
}

// ---------------------------------------------------------------------------
// Provider-specific builders
// ---------------------------------------------------------------------------

/**
 * Build interleaved parts from Gemini provider state.
 * Walks the last model message's parts array in order.
 */
function buildPartsFromGemini(turn: TurnRecord): UnifiedMessagePart[] {
  const contents = turn.providerStateAfter?.geminiContents;
  if (!contents?.length) return buildPartsFallback(turn);

  const modelMsgs = contents.filter(
    (m: { role: string }) => m.role === "model",
  );
  const lastModel = modelMsgs[modelMsgs.length - 1];
  if (!lastModel?.parts?.length) return buildPartsFallback(turn);

  const parts: UnifiedMessagePart[] = [];
  let textAccum = "";
  let toolIdx = 0;
  let pendingCode = "";
  let inlineFileIdx = 0;

  function flushText() {
    if (textAccum.trim()) {
      parts.push({ type: "text", text: textAccum });
    }
    textAccum = "";
  }

  for (const part of lastModel.parts) {
    if (part.text !== undefined) {
      textAccum += part.text;
    } else if (part.executableCode) {
      flushText();
      pendingCode = part.executableCode.code ?? "";
    } else if (part.codeExecutionResult) {
      const output = part.codeExecutionResult.output || null;
      parts.push({
        type: "tool-call",
        toolCallId: `tool-${turn.turnNumber}-${toolIdx}`,
        toolName: "code_execution",
        input: { code: pendingCode },
        output,
      });
      toolIdx++;
      pendingCode = "";
    } else if (part.inlineData) {
      // Match to generatedFiles by position for filename/fileId
      if (
        turn.generatedFiles?.length &&
        inlineFileIdx < turn.generatedFiles.length
      ) {
        const file = turn.generatedFiles[inlineFileIdx];
        parts.push(storedFileToPart(file));
        inlineFileIdx++;
      } else {
        // No matching stored file — use inline data directly
        parts.push({
          type: "file",
          fileId: `inline-${turn.turnNumber}-${inlineFileIdx}`,
          filename: `output_${inlineFileIdx}.png`,
          mimeType: part.inlineData.mimeType ?? null,
          base64Data: part.inlineData.data ?? null,
        });
        inlineFileIdx++;
      }
    }
  }

  // Handle executableCode without a following codeExecutionResult
  if (pendingCode) {
    parts.push({
      type: "tool-call",
      toolCallId: `tool-${turn.turnNumber}-${toolIdx}`,
      toolName: "code_execution",
      input: { code: pendingCode },
      output: null,
    });
  }

  // Append remaining generated files not placed inline
  if (turn.generatedFiles?.length) {
    for (let i = inlineFileIdx; i < turn.generatedFiles.length; i++) {
      parts.push(storedFileToPart(turn.generatedFiles[i]));
    }
  }

  flushText();
  return parts;
}

/**
 * Extract tool output from a Claude tool result block.
 *
 * Handles both `bash_code_execution_tool_result` and
 * `text_editor_code_execution_tool_result` content blocks.
 */
function extractClaudeToolOutput(block: Record<string, unknown>): string | null {
  const content = block.content as Record<string, unknown> | undefined;
  if (!content) return null;

  const contentType = content.type as string | undefined;

  // bash_code_execution_result → stdout
  if (contentType === "bash_code_execution_result") {
    const stdout = content.stdout as string | undefined;
    const stderr = content.stderr as string | undefined;
    const parts: string[] = [];
    if (stdout) parts.push(stdout);
    if (stderr) parts.push(`[stderr] ${stderr}`);
    return parts.length > 0 ? parts.join("\n") : null;
  }

  // text_editor_code_execution_create_result → file created successfully
  if (contentType === "text_editor_code_execution_create_result") {
    return "File created successfully.";
  }

  // text_editor_code_execution_tool_result_error → error message
  if (contentType === "text_editor_code_execution_tool_result_error") {
    const msg = content.error_message as string | undefined;
    return msg ? `Error: ${msg}` : "Error (unknown)";
  }

  return null;
}

/**
 * Build interleaved parts from Claude provider state.
 * Walks the last assistant message's content blocks in order.
 *
 * Claude server-side tool use produces these block types:
 * - `server_tool_use` / `tool_use` → tool invocation (code input)
 * - `bash_code_execution_tool_result` → bash execution output (stdout/stderr)
 * - `text_editor_code_execution_tool_result` → file editor result
 */
function buildPartsFromClaude(turn: TurnRecord): UnifiedMessagePart[] {
  const msgs = turn.providerStateAfter?.claudeMessages;
  if (!msgs?.length) return buildPartsFallback(turn);

  const assistantMsgs = msgs.filter(
    (m: { role: string }) => m.role === "assistant",
  );
  const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
  if (!lastAssistant?.content?.length) return buildPartsFallback(turn);

  const parts: UnifiedMessagePart[] = [];
  let textAccum = "";
  let toolIdx = 0;

  // Map tool_use_id → index in parts[] so result blocks can back-fill output
  const toolIdToIndex = new Map<string, number>();

  function flushText() {
    if (textAccum.trim()) {
      parts.push({ type: "text", text: textAccum });
    }
    textAccum = "";
  }

  for (const block of lastAssistant.content) {
    if (block.type === "text" && block.text) {
      textAccum += block.text;
    } else if (block.type === "tool_use" || block.type === "server_tool_use") {
      flushText();
      const code =
        typeof block.input?.command === "string"
          ? block.input.command
          : typeof block.input?.code === "string"
            ? block.input.code
            : JSON.stringify(block.input ?? {});
      const partIndex = parts.length;
      parts.push({
        type: "tool-call",
        toolCallId: `tool-${turn.turnNumber}-${toolIdx}`,
        toolName: block.name ?? "code_execution",
        input: { code },
        output: null,
      });
      if (block.id) {
        toolIdToIndex.set(block.id as string, partIndex);
      }
      toolIdx++;
    } else if (
      block.type === "bash_code_execution_tool_result" ||
      block.type === "text_editor_code_execution_tool_result"
    ) {
      // Back-fill the output on the matching tool-call part
      const toolUseId = block.tool_use_id as string | undefined;
      if (toolUseId && toolIdToIndex.has(toolUseId)) {
        const idx = toolIdToIndex.get(toolUseId)!;
        const toolPart = parts[idx] as UnifiedToolCallPart;
        toolPart.output = extractClaudeToolOutput(
          block as Record<string, unknown>,
        );
      }
    }
  }

  // Append generated files
  if (turn.generatedFiles?.length) {
    for (const file of turn.generatedFiles) {
      parts.push(storedFileToPart(file));
    }
  }

  flushText();
  return parts;
}

/**
 * Build interleaved parts from OpenAI provider state.
 * Walks `openaiOutput` array which contains items in order:
 *   code_interpreter_call, message (with text after tool)
 */
function buildPartsFromOpenAI(turn: TurnRecord): UnifiedMessagePart[] {
  const output = turn.providerStateAfter?.openaiOutput;
  if (!output?.length) return buildPartsFallback(turn);

  const parts: UnifiedMessagePart[] = [];
  let toolIdx = 0;

  for (const item of output) {
    if (item.type === "code_interpreter_call") {
      const code = item.code ?? "";
      const results = item.results || item.outputs || [];
      const logs: string[] = [];
      for (const r of results) {
        if (r.type === "logs" && r.logs) logs.push(r.logs);
      }
      parts.push({
        type: "tool-call",
        toolCallId: `tool-${turn.turnNumber}-${toolIdx}`,
        toolName: "code_interpreter",
        input: { code },
        output: logs.length ? logs.join("\n") : null,
      });
      toolIdx++;
    } else if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text" && content.text) {
          parts.push({ type: "text", text: content.text });
        }
      }
    }
  }

  // Append generated files
  if (turn.generatedFiles?.length) {
    for (const file of turn.generatedFiles) {
      parts.push(storedFileToPart(file));
    }
  }

  return parts;
}

/**
 * Fallback builder when provider state is missing.
 * Text first, then tools, then files (no interleaving info available).
 */
function buildPartsFallback(turn: TurnRecord): UnifiedMessagePart[] {
  const parts: UnifiedMessagePart[] = [];

  if (turn.assistantText) {
    parts.push({ type: "text", text: turn.assistantText });
  }

  if (turn.codeArtifacts?.length) {
    for (let i = 0; i < turn.codeArtifacts.length; i++) {
      parts.push({
        type: "tool-call",
        toolCallId: `tool-${turn.turnNumber}-${i}`,
        toolName: "code_execution",
        input: { code: turn.codeArtifacts[i].code },
        output: null,
      });
    }
  }

  if (turn.generatedFiles?.length) {
    for (const file of turn.generatedFiles) {
      parts.push(storedFileToPart(file));
    }
  }

  return parts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function storedFileToPart(file: StoredFile): UnifiedFilePart {
  return {
    type: "file",
    fileId: file.fileId,
    filename: file.filename,
    mimeType: file.mimeType ?? null,
    base64Data: file.base64Data ?? null,
  };
}

/**
 * Dispatch to the right builder based on available provider state.
 */
function buildAssistantParts(turn: TurnRecord): UnifiedMessagePart[] {
  const ps = turn.providerStateAfter;

  if (ps?.geminiContents?.length) {
    return buildPartsFromGemini(turn);
  }
  if (ps?.claudeMessages?.length) {
    return buildPartsFromClaude(turn);
  }
  if (ps?.openaiOutput?.length) {
    return buildPartsFromOpenAI(turn);
  }
  return buildPartsFallback(turn);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Regex to strip the "[Attached files:...]" prefix injected at send time. */
const ATTACHED_FILES_PREFIX = /^\[Attached files:\n[\s\S]*?\]\n\n/;

/**
 * Build user message parts: strip file-list prefix, add file parts
 * for any attachments referenced in this turn.
 */
function buildUserParts(
  turn: TurnRecord,
  uploadsMap: Map<string, UploadRecord>,
): UnifiedMessagePart[] {
  const parts: UnifiedMessagePart[] = [];

  // Add file parts for attached uploads
  if (turn.attachedFileIds?.length) {
    for (const fileId of turn.attachedFileIds) {
      const upload = uploadsMap.get(fileId);
      if (upload) {
        parts.push({
          type: "file",
          fileId: upload.fileId,
          filename: upload.filename,
          mimeType: upload.mimeType ?? null,
          base64Data: upload.base64Data ?? null,
        });
      }
    }
  }

  // Strip the "[Attached files:...]" prefix — it's context for the LLM,
  // not meant for display
  const text = turn.userMessage.replace(ATTACHED_FILES_PREFIX, "");
  if (text) {
    parts.push({ type: "text", text });
  }

  return parts;
}

/**
 * Convert a single TurnRecord into a [user, assistant] message pair.
 *
 * @param turn - The turn to convert.
 * @param uploads - Upload records for resolving attachedFileIds to metadata.
 */
export function convertTurnToMessages(
  turn: TurnRecord,
  uploads?: UploadRecord[],
): UnifiedMessage[] {
  const uploadsMap = new Map<string, UploadRecord>();
  if (uploads) {
    for (const u of uploads) {
      uploadsMap.set(u.fileId, u);
    }
  }

  return [
    {
      role: "user",
      id: `user-${turn.turnNumber}`,
      parts: buildUserParts(turn, uploadsMap),
    },
    {
      role: "assistant",
      id: `assistant-${turn.turnNumber}`,
      parts: buildAssistantParts(turn),
    },
  ];
}

/**
 * Convert all turns into a flat array of unified messages.
 *
 * @param turns - All turns from the conversation.
 * @param uploads - Upload records for resolving attachedFileIds to metadata.
 */
export function convertTurnsToMessages(
  turns: TurnRecord[],
  uploads?: UploadRecord[],
): UnifiedMessage[] {
  const messages: UnifiedMessage[] = [];
  for (const turn of turns) {
    messages.push(...convertTurnToMessages(turn, uploads));
  }
  return messages;
}
