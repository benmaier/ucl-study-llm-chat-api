/**
 * OpenAI Responses API Module
 *
 * Provides functions for interacting with OpenAI's Responses API including:
 * - Code interpreter with file generation
 * - Streaming responses
 * - File retrieval from code execution
 */

import OpenAI from "openai";
import { writeFileSync } from "fs";
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
 * Infer MIME type from filename
 */
function inferMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase();
  const mimeTypes: Record<string, string> = {
    csv: "text/csv",
    json: "application/json",
    txt: "text/plain",
    md: "text/markdown",
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xls: "application/vnd.ms-excel",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    py: "text/x-python",
    js: "text/javascript",
    ts: "text/typescript",
  };
  return mimeTypes[ext || ""] || "application/octet-stream";
}

/**
 * Execute code with OpenAI's code interpreter (non-streaming)
 */
export async function executeCodeWithOpenAI(
  client: OpenAI,
  prompt: string,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gpt-4o";

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
  const model = options?.model ?? "gpt-4o";

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
    stream: true,
  });

  let fullText = "";
  let currentCode = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;
  let fullResponse: any = null;
  let currentCodeInterpreterId: string | undefined;

  for await (const event of stream as AsyncIterable<any>) {
    const eventType = event.type;

    switch (eventType) {
      case "response.created":
        // Response created, nothing to capture for unified interface
        break;

      case "response.output_item.added":
        // Track when a code interpreter call starts
        if (event.item?.type === "code_interpreter_call") {
          currentCodeInterpreterId = event.item.id;
          currentCode = "";
          onEvent({ type: "tool_start", toolName: "code_interpreter" });
        }
        break;

      case "response.output_text.delta":
        // Text is in event.delta, not event.text
        if (event.delta) {
          fullText += event.delta;
          onEvent({ type: "text", text: event.delta });
        }
        break;

      case "response.code_interpreter_call.in_progress":
        onEvent({ type: "code_executing" });
        break;

      case "response.code_interpreter_call_code.delta":
        // Code is in event.delta, not event.code
        const codeDelta = event.delta || event.code || "";
        if (codeDelta) {
          currentCode += codeDelta;
          onEvent({ type: "code", code: codeDelta });
        }
        break;

      case "response.code_interpreter_call_code.done":
        // Full code is available in event.code
        if (event.code) {
          currentCode = event.code;
        }
        onEvent({ type: "code_complete", code: currentCode });
        break;

      case "response.code_interpreter_call.completed":
        onEvent({ type: "tool_end", toolName: "code_interpreter" });
        break;

      case "response.output_text.annotation.added":
        // File annotations come through here during streaming
        const annotation = event.annotation;
        if (annotation?.type === "container_file_citation") {
          files.push({
            file_id: annotation.file_id,
            container_id: annotation.container_id,
            filename: annotation.filename,
          });
          // Capture container ID
          if (annotation.container_id) {
            containerId = annotation.container_id;
          }
        }
        break;

      case "response.completed":
        fullResponse = event.response;
        break;
    }
  }

  // Extract code artifacts and any additional files from final response
  if (fullResponse?.output) {
    for (const item of fullResponse.output) {
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
        // Get container ID if not already set
        if (item.container_id && !containerId) {
          containerId = item.container_id;
        }
      } else if (item.type === "message") {
        for (const content of item.content || []) {
          if (content.annotations) {
            for (const annotation of content.annotations) {
              if (annotation.type === "container_file_citation") {
                // Only add if not already in files array
                const exists = files.some((f) => f.file_id === annotation.file_id);
                if (!exists) {
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
  }

  return {
    text: fullText,
    files,
    codeArtifacts,
    containerId,
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
    model: options?.model ?? "gpt-4o",
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
    model: options?.model ?? "gpt-4o",
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
  const model = options?.model ?? "gpt-4o";

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
  let currentCodeInterpreterId: string | undefined;

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_item.added":
        if (event.item?.type === "code_interpreter_call") {
          currentCodeInterpreterId = event.item.id;
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
      case "response.code_interpreter_call_code.delta":
        const codeDelta = event.delta || event.code || "";
        if (codeDelta) {
          currentCode += codeDelta;
          onEvent({ type: "code", code: codeDelta });
        }
        break;
      case "response.code_interpreter_call_code.done":
        if (event.code) currentCode = event.code;
        onEvent({ type: "code_complete", code: currentCode });
        break;
      case "response.code_interpreter_call.completed":
        onEvent({ type: "tool_end", toolName: "code_interpreter" });
        break;
      case "response.output_text.annotation.added":
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
      case "response.completed":
        fullResponse = event.response;
        break;
    }
  }

  // Extract code artifacts from final response
  if (fullResponse?.output) {
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
      } else if (item.type === "message") {
        for (const content of item.content || []) {
          if (content.annotations) {
            for (const annotation of content.annotations) {
              if (annotation.type === "container_file_citation") {
                const exists = files.some((f) => f.file_id === annotation.file_id);
                if (!exists) {
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
  }

  // Build conversation history for the provider-agnostic interface
  const updatedMessages: ConversationMessage[] = [];
  // We don't reconstruct full history since OpenAI chains via response IDs,
  // but we expose the messages for the caller's convenience
  updatedMessages.push({ role: "user", content: userMessage });
  updatedMessages.push({ role: "assistant", content: fullText });

  return {
    text: fullText,
    files,
    codeArtifacts,
    containerId,
    messages: updatedMessages,
    responseId: fullResponse?.id,
  };
}
