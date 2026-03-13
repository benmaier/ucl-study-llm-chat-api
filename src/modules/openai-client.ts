/**
 * OpenAI Responses API Module
 *
 * Provides functions for interacting with OpenAI's Responses API including:
 * - Code interpreter with file generation
 * - Streaming responses
 * - File retrieval from code execution
 */

import OpenAI from "openai";
import { writeFileSync, appendFileSync } from "fs";

/** Enable verbose per-event logging with DEBUG_STREAMS=1 */
const DEBUG_STREAMS = !!process.env.DEBUG_STREAMS;

import {
  UploadedFile,
  CodeExecutionFile,
  CodeArtifact,
  CodeExecutionResult,
  StreamEvent,
  CodeExecutionOptions,
  ChatOptions,
  ConversationMessage,
  MultiTurnCodeResult,
} from "./types.js";
import { inferMimeType } from "./helpers.js";

// Re-export types for convenience
export type {
  UploadedFile,
  CodeExecutionFile,
  CodeArtifact,
  CodeExecutionResult,
  StreamEvent,
  CodeExecutionOptions,
  ChatOptions,
  ConversationMessage,
  MultiTurnCodeResult,
} from "./types.js";

/**
 * Create OpenAI client
 */
export function createOpenAIClient(apiKey?: string): OpenAI {
  return new OpenAI({
    apiKey: apiKey || process.env.OPENAI_API_KEY,
  });
}

/**
 * Upload a file for use in code execution
 * Files uploaded this way can be referenced in code_interpreter via file_ids
 */
export async function uploadFile(
  client: OpenAI,
  filePath: string
): Promise<UploadedFile> {
  const fs = await import("fs");
  const path = await import("path");

  const filename = path.basename(filePath);
  const fileStream = fs.createReadStream(filePath);

  const file = await client.files.create({
    file: fileStream,
    purpose: "assistants", // Files for code interpreter use "assistants" purpose
  });

  return {
    file_id: file.id,
    filename: file.filename || filename,
    mime_type: inferMimeType(filename),
    size_bytes: file.bytes || 0,
  };
}

/**
 * Upload a file from a Buffer for use in code execution
 */
export async function uploadFileFromBuffer(
  client: OpenAI,
  buffer: Buffer,
  filename: string
): Promise<UploadedFile> {
  // Convert Buffer to ArrayBuffer for Blob compatibility
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const blob = new Blob([arrayBuffer]);
  const file = new File([blob], filename);

  const uploadedFile = await client.files.create({
    file: file,
    purpose: "assistants",
  });

  return {
    file_id: uploadedFile.id,
    filename: uploadedFile.filename || filename,
    mime_type: inferMimeType(filename),
    size_bytes: uploadedFile.bytes || buffer.length,
  };
}

/**
 * Delete an uploaded file
 */
export async function deleteFile(
  client: OpenAI,
  fileId: string
): Promise<void> {
  await client.files.del(fileId);
}

/**
 * Execute code with OpenAI's code interpreter (non-streaming)
 */
export async function executeCodeWithOpenAI(
  client: OpenAI,
  prompt: string,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gpt-5";

  // Build container configuration
  // For file uploads, use "auto" mode with file_ids - files must be uploaded via client.files.create()
  // The containerId option is for reusing an existing container session
  const containerConfig: any = { type: "auto" };

  // If fileIds are provided, include them in the auto container config
  if (options?.fileIds?.length) {
    containerConfig.file_ids = options.fileIds;
  }

  const response = await client.responses.create({
    model,
    input: prompt,
    tools: [
      {
        type: "code_interpreter",
        container: containerConfig,
      },
    ],
    include: ["code_interpreter_call.outputs"] as any,
  });

  // Extract text, files, and code artifacts from response
  let text = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;

  // Navigate the response structure
  const output = (response as any).output || [];

  for (const item of output) {
    if (item.type === "code_interpreter_call") {
      // Extract code artifact
      if (item.code) {
        codeArtifacts.push({
          id: item.id,
          path: "code_interpreter",
          code: item.code,
          language: "python",
        });
      }
      // Get container ID
      if (item.container_id) {
        containerId = item.container_id;
      }

      // Extract files from code_interpreter_call results/outputs
      const results = item.results || item.outputs || [];
      for (const result of results) {
        if (result.files) {
          for (const file of result.files) {
            const exists = files.some((f: CodeExecutionFile) => f.file_id === file.file_id);
            if (!exists) {
              files.push({
                file_id: file.file_id,
                container_id: item.container_id,
                filename: file.filename || `generated_${file.file_id}`,
                mimeType: file.mime_type,
              });
            }
          }
        }
      }
    } else if (item.type === "message") {
      for (const content of item.content || []) {
        if (content.type === "output_text") {
          text += content.text;

          // Check for file annotations
          if (content.annotations) {
            for (const annotation of content.annotations) {
              if (annotation.type === "container_file_citation") {
                files.push({
                  file_id: annotation.file_id,
                  container_id: annotation.container_id,
                  filename: annotation.filename,
                });
              }
            }
          }
        }
      }
    }
  }

  // Also check output_text for simpler access
  if (!text && (response as any).output_text) {
    text = (response as any).output_text;
  }

  return {
    text,
    files,
    codeArtifacts,
    containerId,
  };
}

/**
 * Execute code with OpenAI using streaming
 */
export async function executeCodeWithOpenAIStreaming(
  client: OpenAI,
  prompt: string,
  onEvent: (event: StreamEvent) => void,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gpt-5";

  // Build container configuration
  // For file uploads, use "auto" mode with file_ids
  const containerConfig: any = { type: "auto" };

  // If fileIds are provided, include them in the auto container config
  if (options?.fileIds?.length) {
    containerConfig.file_ids = options.fileIds;
  }

  const stream = await client.responses.create({
    model,
    input: prompt,
    tools: [
      {
        type: "code_interpreter",
        container: containerConfig,
      },
    ],
    include: ["code_interpreter_call.outputs"] as any,
    stream: true,
  });

  let fullText = "";
  let currentCode = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;
  let fullResponse: any = null;
  /** Track tool item IDs whose code_output was already emitted during streaming */
  const toolOutputEmittedIds = new Set<string>();

  // Stream text and tool events in real-time.
  for await (const event of stream as AsyncIterable<any>) {
    switch (event.type) {
      case "response.output_item.added":
        if (event.item?.type === "code_interpreter_call") {
          currentCode = "";
          onEvent({ type: "tool_start", toolName: "code_interpreter" });
        }
        break;
      case "response.output_text.delta":
        if (event.delta) {
          fullText += event.delta;
          onEvent({ type: "text", text: event.delta });
        }
        break;
      case "response.code_interpreter_call.in_progress":
        onEvent({ type: "code_executing" });
        break;
      case "response.code_interpreter_call_code.delta": {
        const codeDelta = event.delta || event.code || "";
        if (codeDelta) {
          currentCode += codeDelta;
          onEvent({ type: "code", code: codeDelta });
        }
        break;
      }
      case "response.code_interpreter_call_code.done":
        if (event.code) currentCode = event.code;
        onEvent({ type: "code_complete", code: currentCode });
        break;
      case "response.code_interpreter_call.completed": {
        // Try to extract output from the completed event itself.
        // If `include: ["code_interpreter_call.outputs"]` populates the
        // event item, we can emit code_output BEFORE tool_end — matching
        // Claude/Gemini event ordering and avoiding the deferred-output path.
        const completedResults = (event as any).item?.results || (event as any).item?.outputs || [];
        const completedLogs: string[] = [];
        for (const r of completedResults) {
          if (r.type === "logs" && r.logs) completedLogs.push(r.logs);
        }
        if (completedLogs.length) {
          onEvent({ type: "code_output", output: completedLogs.join("\n") });
          toolOutputEmittedIds.add((event as any).item?.id);
        }
        onEvent({ type: "tool_end", toolName: "code_interpreter" });
        break;
      }
      case "response.output_text.annotation.added": {
        const annotation = event.annotation;
        if (annotation?.type === "container_file_citation") {
          files.push({
            file_id: annotation.file_id,
            container_id: annotation.container_id,
            filename: annotation.filename,
          });
          if (annotation.container_id) containerId = annotation.container_id;
        }
        break;
      }
      case "response.completed":
        fullResponse = event.response;
        break;
    }
  }

  // Extract artifacts/files and emit code_output from fullResponse.
  // Always emit one code_output per tool so the stream-mapper's
  // deferred-output queue stays in sync.  Skip tools whose output
  // was already emitted during the streaming phase.
  if (fullResponse?.output) {
    let responseText = "";
    for (const item of fullResponse.output) {
      if (item.type === "code_interpreter_call") {
        if (item.code) {
          codeArtifacts.push({
            id: item.id,
            path: "code_interpreter",
            code: item.code,
            language: "python",
          });
        }
        if (item.container_id && !containerId) containerId = item.container_id;

        const results = item.results || item.outputs || [];
        const logs: string[] = [];
        for (const result of results) {
          if (result.type === "logs" && result.logs) logs.push(result.logs);
          if (result.files) {
            for (const file of result.files) {
              const exists = files.some((f) => f.file_id === file.file_id);
              if (!exists) {
                files.push({
                  file_id: file.file_id,
                  container_id: item.container_id,
                  filename: file.filename || `generated_${file.file_id}`,
                  mimeType: file.mime_type,
                });
              }
            }
          }
        }
        // Emit code_output for every tool (even empty) so deferred queue
        // stays aligned.  Skip if already emitted during streaming.
        if (!toolOutputEmittedIds.has(item.id)) {
          onEvent({ type: "code_output", output: logs.length ? logs.join("\n") : "" });
        }
      } else if (item.type === "message") {
        for (const content of item.content || []) {
          if (content.type === "output_text") responseText += content.text;
        }
      }
    }
    if (responseText && responseText.length > fullText.length) {
      fullText = responseText;
    }
  }

  if (fullResponse?.output_text && fullResponse.output_text.length > fullText.length) {
    fullText = fullResponse.output_text;
  }

  return {
    text: fullText,
    files,
    codeArtifacts,
    containerId,
    openaiOutput: fullResponse?.output,
  };
}

/**
 * Download files generated by code execution
 */
export async function downloadGeneratedFiles(
  files: CodeExecutionFile[],
  outputDir: string = ".",
  apiKey?: string
): Promise<string[]> {
  const downloadedPaths: string[] = [];

  for (const file of files) {
    try {
      // Construct download URL - need /content to get actual file bytes
      const url = `https://api.openai.com/v1/containers/${file.container_id}/files/${file.file_id}/content`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${apiKey || process.env.OPENAI_API_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const buffer = await response.arrayBuffer();
      const outputPath = `${outputDir}/${file.filename}`;
      writeFileSync(outputPath, Buffer.from(buffer));
      downloadedPaths.push(outputPath);

      console.log(`Downloaded: ${outputPath}`);
    } catch (error) {
      console.error(`Failed to download file ${file.file_id}:`, error);
    }
  }

  return downloadedPaths;
}

/**
 * Download a single generated file to a Buffer (without writing to disk).
 * Used internally for capturing base64 data for persistence.
 */
export async function downloadFileToBuffer(
  file: { file_id: string; container_id?: string },
  apiKey?: string
): Promise<{ buffer: Buffer; mimeType?: string }> {
  const url = `https://api.openai.com/v1/containers/${file.container_id}/files/${file.file_id}/content`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${apiKey || process.env.OPENAI_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type") ?? undefined;
  return { buffer, mimeType };
}

/**
 * Simple chat with OpenAI (no tools)
 */
export async function chatWithOpenAI(
  client: OpenAI,
  message: string,
  options?: ChatOptions
): Promise<string> {
  const messages: any[] = [];

  if (options?.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: message });

  const response = await client.chat.completions.create({
    model: options?.model ?? "gpt-5",
    messages,
  });

  return response.choices[0]?.message?.content || "";
}

/**
 * Stream a simple chat with OpenAI
 */
export async function streamChatWithOpenAI(
  client: OpenAI,
  message: string,
  onText: (text: string) => void,
  options?: ChatOptions
): Promise<string> {
  const messages: any[] = [];

  if (options?.system) {
    messages.push({ role: "system", content: options.system });
  }
  messages.push({ role: "user", content: message });

  const stream = await client.chat.completions.create({
    model: options?.model ?? "gpt-5",
    messages,
    stream: true,
  });

  let fullText = "";

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) {
      fullText += content;
      onText(content);
    }
  }

  return fullText;
}

/** Append a JSONL trace entry if traceFile is set. */
function trace(traceFile: string | undefined, layer: string, type: string, data: Record<string, unknown>) {
  if (!traceFile) return;
  try {
    appendFileSync(traceFile, JSON.stringify({ ts: new Date().toISOString(), layer, type, data }) + "\n");
  } catch { /* best-effort */ }
}

/** Summarize an OpenAI streaming event for trace logging (truncate large fields). */
function summarizeOpenAIEvent(event: any): Record<string, unknown> {
  const summary: Record<string, unknown> = { type: event.type };
  if (event.item?.type) summary.itemType = event.item.type;
  if (event.item?.id) summary.itemId = event.item.id;
  if (event.item?.status) summary.itemStatus = event.item.status;
  if (event.delta !== undefined) {
    summary.delta = typeof event.delta === "string" && event.delta.length > 100
      ? event.delta.slice(0, 100) + "..."
      : event.delta;
  }
  if (event.code !== undefined) {
    summary.code = typeof event.code === "string" && event.code.length > 100
      ? event.code.slice(0, 100) + "..."
      : event.code;
  }
  // For completed events, log results/outputs summary
  if (event.item?.results) {
    summary.resultsCount = event.item.results.length;
    summary.resultTypes = event.item.results.map((r: any) => r.type);
  }
  if (event.item?.outputs) {
    summary.outputsCount = event.item.outputs.length;
    summary.outputTypes = event.item.outputs.map((r: any) => r.type);
  }
  // For response.completed, log output summary
  if (event.response?.output) {
    summary.responseOutputCount = event.response.output.length;
    summary.responseOutputTypes = event.response.output.map((i: any) => i.type);
  }
  if (event.response?.status) summary.responseStatus = event.response.status;
  if (event.response?.incomplete_details) summary.incompleteDetails = event.response.incomplete_details;
  return summary;
}

/**
 * Multi-turn code execution with OpenAI.
 *
 * Uses the Responses API's `previous_response_id` to chain turns.
 * Pass the returned `responseId` back on subsequent calls.
 */
export async function executeCodeWithOpenAIMultiTurn(
  client: OpenAI,
  userMessage: string,
  onEvent: (event: StreamEvent) => void,
  previousResponseId?: string,
  options?: CodeExecutionOptions
): Promise<MultiTurnCodeResult> {
  const model = options?.model ?? "gpt-5";

  const containerConfig: any = { type: "auto" };
  if (options?.fileIds?.length) {
    containerConfig.file_ids = options.fileIds;
  }

  const requestParams: any = {
    model,
    input: userMessage,
    tools: [
      {
        type: "code_interpreter",
        container: containerConfig,
      },
    ],
    include: ["code_interpreter_call.outputs"],
    stream: true,
  };

  if (previousResponseId) {
    requestParams.previous_response_id = previousResponseId;
  }

  const stream: any = await client.responses.create(requestParams);

  let fullText = "";
  let currentCode = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;
  let fullResponse: any = null;
  /** Track tool item IDs whose code_output was already emitted during streaming */
  const toolOutputEmittedIds = new Set<string>();

  // Stream text and tool events in real-time.
  for await (const event of stream) {
    trace(options?.traceFile, "openai", event.type, summarizeOpenAIEvent(event));
    switch (event.type) {
      case "response.output_item.added":
        if (event.item?.type === "code_interpreter_call") {
          currentCode = "";
          onEvent({ type: "tool_start", toolName: "code_interpreter" });
        }
        break;
      case "response.output_text.delta":
        if (event.delta) {
          fullText += event.delta;
          onEvent({ type: "text", text: event.delta });
        }
        break;
      case "response.code_interpreter_call.in_progress":
        onEvent({ type: "code_executing" });
        break;
      case "response.code_interpreter_call_code.delta": {
        const codeDelta = event.delta || event.code || "";
        if (codeDelta) {
          currentCode += codeDelta;
          onEvent({ type: "code", code: codeDelta });
        }
        break;
      }
      case "response.code_interpreter_call_code.done":
        if (event.code) currentCode = event.code;
        onEvent({ type: "code_complete", code: currentCode });
        break;
      case "response.code_interpreter_call.completed": {
        // Try to extract output from the completed event itself.
        // If `include: ["code_interpreter_call.outputs"]` populates the
        // event item, we can emit code_output BEFORE tool_end — matching
        // Claude/Gemini event ordering and avoiding the deferred-output path.
        const completedResults = (event as any).item?.results || (event as any).item?.outputs || [];
        const completedLogs: string[] = [];
        for (const r of completedResults) {
          if (r.type === "logs" && r.logs) completedLogs.push(r.logs);
        }
        if (completedLogs.length) {
          onEvent({ type: "code_output", output: completedLogs.join("\n") });
          toolOutputEmittedIds.add((event as any).item?.id);
        }
        onEvent({ type: "tool_end", toolName: "code_interpreter" });
        break;
      }
      case "response.output_text.annotation.added": {
        const annotation = event.annotation;
        if (annotation?.type === "container_file_citation") {
          files.push({
            file_id: annotation.file_id,
            container_id: annotation.container_id,
            filename: annotation.filename,
          });
          if (annotation.container_id) containerId = annotation.container_id;
        }
        break;
      }
      case "response.completed":
        fullResponse = event.response;
        break;
    }
  }

  // Trace: full response summary
  if (fullResponse) {
    trace(options?.traceFile, "openai", "FULL_RESPONSE_SUMMARY", {
      status: fullResponse.status,
      incomplete_details: fullResponse.incomplete_details ?? null,
      outputCount: fullResponse.output?.length ?? 0,
      outputTypes: fullResponse.output?.map((i: any) => i.type),
      outputIds: fullResponse.output?.map((i: any) => i.id),
      outputTextLength: fullResponse.output_text?.length ?? 0,
    });
  }

  // Debug: log full response structure (enable with DEBUG_STREAMS=1)
  if (DEBUG_STREAMS && fullResponse) {
    console.log("[openai-client] Response status:", fullResponse.status,
      "| incomplete_details:", JSON.stringify(fullResponse.incomplete_details ?? null),
      "| output items:", fullResponse.output?.length ?? 0,
      "| output types:", fullResponse.output?.map((i: any) => i.type).join(", "),
      "| output_text length:", fullResponse.output_text?.length ?? 0);
    for (let i = 0; i < (fullResponse.output?.length ?? 0); i++) {
      const item = fullResponse.output[i];
      const summary: any = { type: item.type, id: item.id };
      if (item.type === "message") {
        summary.content = item.content?.map((c: any) => ({
          type: c.type,
          textLength: c.text?.length ?? 0,
          textPreview: c.text?.slice(0, 100),
        }));
      } else if (item.type === "code_interpreter_call") {
        summary.codeLength = item.code?.length ?? 0;
        summary.status = item.status;
        const results = item.results || item.outputs || [];
        summary.resultsCount = results.length;
        summary.resultTypes = results.map((r: any) => r.type);
      }
      console.log(`[openai-client] output[${i}]:`, JSON.stringify(summary));
    }
  }

  // Extract code artifacts, files, and emit code_output from fullResponse.
  // Always emit one code_output per tool so the stream-mapper's
  // deferred-output queue stays in sync.  Skip tools whose output
  // was already emitted during the streaming phase.
  if (fullResponse?.output) {
    let responseText = "";
    for (const item of fullResponse.output) {
      if (item.type === "code_interpreter_call") {
        if (item.code) {
          codeArtifacts.push({
            id: item.id,
            path: "code_interpreter",
            code: item.code,
            language: "python",
          });
        }
        if (item.container_id && !containerId) containerId = item.container_id;

        const results = item.results || item.outputs || [];
        const logs: string[] = [];
        for (const result of results) {
          if (result.type === "logs" && result.logs) logs.push(result.logs);
          if (result.files) {
            for (const file of result.files) {
              const exists = files.some((f) => f.file_id === file.file_id);
              if (!exists) {
                files.push({
                  file_id: file.file_id,
                  container_id: item.container_id,
                  filename: file.filename || `generated_${file.file_id}`,
                  mimeType: file.mime_type,
                });
              }
            }
          }
        }
        // Emit code_output for every tool (even empty) so deferred queue
        // stays aligned.  Skip if already emitted during streaming.
        if (!toolOutputEmittedIds.has(item.id)) {
          onEvent({ type: "code_output", output: logs.length ? logs.join("\n") : "" });
        }
      } else if (item.type === "message") {
        for (const content of item.content || []) {
          if (content.type === "output_text") responseText += content.text;
        }
      }
    }
    if (responseText && responseText.length > fullText.length) {
      fullText = responseText;
    }
  }

  if (fullResponse?.output_text && fullResponse.output_text.length > fullText.length) {
    fullText = fullResponse.output_text;
  }

  const updatedMessages: ConversationMessage[] = [];
  updatedMessages.push({ role: "user", content: userMessage });
  updatedMessages.push({ role: "assistant", content: fullText });

  return {
    text: fullText,
    files,
    codeArtifacts,
    containerId,
    messages: updatedMessages,
    responseId: fullResponse?.id,
    openaiOutput: fullResponse?.output,
  };
}
