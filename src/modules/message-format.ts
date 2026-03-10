/**
 * Unified message format for reading back stored conversations.
 *
 * Converts provider-specific TurnRecord data into a provider-agnostic
 * interleaved format of text, tool calls, and files.
 *
 * File/image parts carry raw base64 data — URL generation and
 * deduplication are the consumer's responsibility.
 */

import type { TurnRecord, StoredFile } from "./conversation-store.js";

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
 * Build interleaved parts from Claude provider state.
 * Walks the last assistant message's content blocks in order.
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

  function flushText() {
    if (textAccum.trim()) {
      parts.push({ type: "text", text: textAccum });
    }
    textAccum = "";
  }

  for (const block of lastAssistant.content) {
    if (block.type === "text" && block.text) {
      textAccum += block.text;
    } else if (block.type === "tool_use") {
      flushText();
      const code =
        typeof block.input?.code === "string"
          ? block.input.code
          : JSON.stringify(block.input ?? {});
      // Claude stores tool results in the next user message, not inline
      parts.push({
        type: "tool-call",
        toolCallId: `tool-${turn.turnNumber}-${toolIdx}`,
        toolName: block.name ?? "code_execution",
        input: { code },
        output: null,
      });
      toolIdx++;
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
 * Fallback builder for OpenAI or when provider state is missing.
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
  return buildPartsFallback(turn);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a single TurnRecord into a [user, assistant] message pair.
 */
export function convertTurnToMessages(turn: TurnRecord): UnifiedMessage[] {
  const userParts: UnifiedMessagePart[] = [
    { type: "text", text: turn.userMessage },
  ];

  return [
    { role: "user", id: `user-${turn.turnNumber}`, parts: userParts },
    {
      role: "assistant",
      id: `assistant-${turn.turnNumber}`,
      parts: buildAssistantParts(turn),
    },
  ];
}

/**
 * Convert all turns into a flat array of unified messages.
 */
export function convertTurnsToMessages(
  turns: TurnRecord[],
): UnifiedMessage[] {
  const messages: UnifiedMessage[] = [];
  for (const turn of turns) {
    messages.push(...convertTurnToMessages(turn));
  }
  return messages;
}
