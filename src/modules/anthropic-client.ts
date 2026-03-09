/**
 * Anthropic Claude API Module
 *
 * Provides functions for interacting with Claude API including:
 * - Code execution with file generation
 * - Streaming responses
 * - File retrieval from code execution
 */

import Anthropic from "@anthropic-ai/sdk";
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
import { inferMimeType, inferLanguage, extractCodeFromPartialJson } from "./helpers.js";

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
 * Create Anthropic client
 */
export function createAnthropicClient(apiKey?: string): Anthropic {
  return new Anthropic({
    apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
  });
}

/**
 * Upload a file to Claude's Files API for use in code execution
 */
export async function uploadFile(
  client: Anthropic,
  filePath: string,
  mimeType?: string
): Promise<UploadedFile> {
  const fs = await import("fs");
  const path = await import("path");

  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);

  // Infer mime type if not provided
  const detectedMimeType = mimeType || inferMimeType(filename);

  // Use REST API for file upload
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: detectedMimeType }), filename);

  const response = await fetch("https://api.anthropic.com/v1/files", {
    method: "POST",
    headers: {
      "x-api-key": client.apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  return {
    file_id: result.id,
    filename: result.filename,
    mime_type: result.mime_type,
    size_bytes: result.size_bytes,
  };
}

/**
 * Upload a file from a Buffer
 */
export async function uploadFileFromBuffer(
  client: Anthropic,
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<UploadedFile> {
  const detectedMimeType = mimeType || inferMimeType(filename);

  // Convert Buffer to ArrayBuffer for Blob compatibility
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  const formData = new FormData();
  formData.append("file", new Blob([arrayBuffer], { type: detectedMimeType }), filename);

  const response = await fetch("https://api.anthropic.com/v1/files", {
    method: "POST",
    headers: {
      "x-api-key": client.apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  return {
    file_id: result.id,
    filename: result.filename,
    mime_type: result.mime_type,
    size_bytes: result.size_bytes,
  };
}

/**
 * Delete an uploaded file
 */
export async function deleteFile(
  client: Anthropic,
  fileId: string
): Promise<void> {
  const response = await fetch(`https://api.anthropic.com/v1/files/${fileId}`, {
    method: "DELETE",
    headers: {
      "x-api-key": client.apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File deletion failed: ${response.status} - ${errorText}`);
  }
}

/**
 * Execute code with Claude's code execution tool (non-streaming)
 */
export async function executeCodeWithClaude(
  client: Anthropic,
  prompt: string,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "claude-sonnet-4-5-20250929";
  const maxTokens = options?.maxTokens ?? 8192;

  // Build message content - include file references if fileIds provided
  let messageContent: any = prompt;
  if (options?.fileIds?.length) {
    messageContent = [
      { type: "text", text: prompt },
      ...options.fileIds.map((id) => ({
        type: "container_upload",
        file_id: id,
      })),
    ];
  }

  const requestParams: any = {
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: messageContent,
      },
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution",
      },
    ],
  };

  // Files API still requires a beta header
  if (options?.fileIds?.length) {
    requestParams.betas = ["files-api-2025-04-14"];
  }

  if (options?.containerId) {
    requestParams.container = options.containerId;
  }

  const response = await (requestParams.betas
    ? client.beta.messages.create(requestParams)
    : client.messages.create(requestParams));

  // Extract text, files, and code artifacts from response
  let text = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;

  // Get container ID from response
  if ((response as any).container?.id) {
    containerId = (response as any).container.id;
  }

  for (const block of response.content) {
    const blockType = (block as any).type;
    if (blockType === "text") {
      text += (block as any).text;
    } else if (blockType === "server_tool_use") {
      // Extract code artifacts from text_editor_code_execution tool calls
      const toolBlock = block as any;
      if (toolBlock.name === "text_editor_code_execution") {
        const input = toolBlock.input;
        if (input?.command === "create" && input?.path && input?.file_text) {
          codeArtifacts.push({
            id: toolBlock.id || `claude_${Date.now()}`,
            path: input.path,
            code: input.file_text,
            language: inferLanguage(input.path),
          });
        }
      }
    } else if (blockType === "bash_code_execution_tool_result") {
      const result = (block as any).content;
      // Files are in result.content array with type "bash_code_execution_output"
      if (result?.type === "bash_code_execution_result" && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === "bash_code_execution_output" && item.file_id) {
            files.push({
              file_id: item.file_id,
              filename: item.filename || `file_${item.file_id.slice(-8)}.png`,
            });
          }
        }
      }
    }
  }

  return { text, files, codeArtifacts, containerId };
}

/**
 * Execute code with Claude using streaming
 */
export async function executeCodeWithClaudeStreaming(
  client: Anthropic,
  prompt: string,
  onEvent: (event: StreamEvent) => void,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "claude-sonnet-4-5-20250929";
  const maxTokens = options?.maxTokens ?? 8192;

  // Build message content - include file references if fileIds provided
  let messageContent: any = prompt;
  if (options?.fileIds?.length) {
    messageContent = [
      { type: "text", text: prompt },
      ...options.fileIds.map((id) => ({
        type: "container_upload",
        file_id: id,
      })),
    ];
  }

  const requestParams: any = {
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: "user",
        content: messageContent,
      },
    ],
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution",
      },
    ],
  };

  // Files API still requires a beta header
  if (options?.fileIds?.length) {
    requestParams.betas = ["files-api-2025-04-14"];
  }

  if (options?.containerId) {
    requestParams.container = options.containerId;
  }

  const stream = await (requestParams.betas
    ? client.beta.messages.stream(requestParams)
    : client.messages.stream(requestParams));

  let fullText = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;
  let currentToolName: string | undefined;
  let currentToolId: string | undefined;
  let currentToolInput = "";
  let lastExtractedCodeLength = 0;

  // Map to store accumulated tool inputs by ID
  const toolInputs: Map<string, { name: string; input: string }> = new Map();

  for await (const event of stream) {
    // Handle different event types
    if (event.type === "message_start") {
      // Check for container in message
      if ((event as any).message?.container?.id) {
        containerId = (event as any).message.container.id;
      }
    } else if (event.type === "content_block_start") {
      const block = (event as any).content_block;
      if (block?.type === "server_tool_use") {
        currentToolName = block.name;
        currentToolId = block.id;
        currentToolInput = "";
        lastExtractedCodeLength = 0;
        onEvent({ type: "tool_start", toolName: block.name });
      }
    } else if (event.type === "content_block_delta") {
      const delta = (event as any).delta;
      if (delta?.type === "text_delta") {
        fullText += delta.text;
        onEvent({ type: "text", text: delta.text });
      } else if (delta?.type === "input_json_delta") {
        // Accumulate tool input JSON
        currentToolInput += delta.partial_json || "";

        // For text_editor_code_execution, extract and stream the code content
        if (currentToolName === "text_editor_code_execution") {
          const { newCode, totalLength } = extractCodeFromPartialJson(
            currentToolInput,
            lastExtractedCodeLength
          );
          lastExtractedCodeLength = totalLength;

          if (newCode) {
            // Stream the extracted code (not the raw JSON)
            onEvent({ type: "tool_input", text: newCode });
          }
        } else {
          // For other tools, stream raw JSON as before
          onEvent({ type: "tool_input", text: delta.partial_json });
        }
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolName && currentToolId) {
        // Save accumulated input for this tool
        toolInputs.set(currentToolId, {
          name: currentToolName,
          input: currentToolInput,
        });
        onEvent({ type: "tool_end", toolName: currentToolName });
        currentToolName = undefined;
        currentToolId = undefined;
        currentToolInput = "";
        lastExtractedCodeLength = 0;
      }
    }
  }

  // Parse accumulated tool inputs to extract code artifacts
  for (const [toolId, tool] of toolInputs) {
    if (tool.name === "text_editor_code_execution" && tool.input) {
      try {
        const input = JSON.parse(tool.input);
        if (input?.command === "create" && input?.path && input?.file_text) {
          codeArtifacts.push({
            id: toolId,
            path: input.path,
            code: input.file_text,
            language: inferLanguage(input.path),
          });
        }
      } catch (e) {
        // JSON parse failed, skip this tool
      }
    }
  }

  // Get final message to extract files (code artifacts already extracted from stream)
  const finalMessage = await stream.finalMessage();

  // Extract container ID from final message
  if ((finalMessage as any).container?.id) {
    containerId = (finalMessage as any).container.id;
  }

  // Extract generated files and execution output from final message
  for (const block of finalMessage.content) {
    const blockType = (block as any).type;
    if (blockType === "bash_code_execution_tool_result") {
      const result = (block as any).content;

      if (result?.type === "bash_code_execution_result" && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === "bash_code_execution_output" && item.file_id) {
            // Generated file
            files.push({
              file_id: item.file_id,
              filename: item.filename || `file_${item.file_id.slice(-8)}.png`,
            });
          } else if (item.type === "text" && item.text) {
            // stdout/stderr from code execution
            onEvent({ type: "code_output", output: item.text });
          }
        }
      }
    }
  }

  return { text: fullText, files, codeArtifacts, containerId };
}

/**
 * Download files generated by code execution
 */
export async function downloadGeneratedFiles(
  client: Anthropic,
  files: CodeExecutionFile[],
  outputDir: string = "."
): Promise<string[]> {
  const downloadedPaths: string[] = [];

  console.log(`Attempting to download ${files.length} file(s)...`);

  for (const file of files) {
    console.log(`  File ID: ${file.file_id}, Filename: ${file.filename || "unknown"}`);

    try {
      // Determine filename - use provided or generate from ID
      let filename = file.filename;
      if (!filename) {
        // Try to infer extension from file_id or default to .bin
        filename = `file_${file.file_id.slice(-8)}.png`;
      }

      // Download file content via REST API
      const url = `https://api.anthropic.com/v1/files/${file.file_id}/content`;
      console.log(`  Downloading from: ${url}`);

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "x-api-key": client.apiKey || "",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "files-api-2025-04-14",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      console.log(`  Downloaded ${buffer.length} bytes`);

      // Save to disk
      const outputPath = `${outputDir}/${filename}`;
      writeFileSync(outputPath, buffer);
      downloadedPaths.push(outputPath);

      console.log(`  Saved to: ${outputPath}`);
    } catch (error) {
      console.error(`  Failed to download file ${file.file_id}:`, error);
    }
  }

  return downloadedPaths;
}

/**
 * Download a single generated file to a Buffer (without writing to disk).
 * Used internally for capturing base64 data for persistence.
 */
export async function downloadFileToBuffer(
  client: Anthropic,
  file: { file_id: string }
): Promise<{ buffer: Buffer; mimeType?: string }> {
  const url = `https://api.anthropic.com/v1/files/${file.file_id}/content`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "x-api-key": client.apiKey || "",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const mimeType = response.headers.get("content-type") ?? undefined;
  return { buffer, mimeType };
}

/**
 * Simple chat with Claude (no tools)
 */
export async function chatWithClaude(
  client: Anthropic,
  message: string,
  options?: ChatOptions
): Promise<string> {
  const response = await client.messages.create({
    model: options?.model ?? "claude-sonnet-4-5-20250514",
    max_tokens: options?.maxTokens ?? 1024,
    system: options?.system,
    messages: [{ role: "user", content: message }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.type === "text" ? textBlock.text : "";
}

/**
 * Stream a simple chat with Claude
 */
export async function streamChatWithClaude(
  client: Anthropic,
  message: string,
  onText: (text: string) => void,
  options?: ChatOptions
): Promise<string> {
  const stream = client.messages.stream({
    model: options?.model ?? "claude-sonnet-4-5-20250514",
    max_tokens: options?.maxTokens ?? 1024,
    system: options?.system,
    messages: [{ role: "user", content: message }],
  });

  let fullText = "";

  stream.on("text", (text) => {
    fullText += text;
    onText(text);
  });

  await stream.finalMessage();
  return fullText;
}

/**
 * Multi-turn code execution with Claude.
 *
 * Pass the returned `messages` array back on subsequent calls to continue
 * the conversation. The container is reused automatically.
 */
export async function executeCodeWithClaudeMultiTurn(
  client: Anthropic,
  userMessage: string,
  onEvent: (event: StreamEvent) => void,
  previousMessages?: ConversationMessage[],
  options?: CodeExecutionOptions
): Promise<MultiTurnCodeResult> {
  // Build the raw messages array for the API.
  // Previous turns use the raw content blocks we stored; new turn is plain text.
  const rawMessages: any[] = [];

  if (previousMessages) {
    for (const msg of previousMessages) {
      rawMessages.push({ role: msg.role, content: msg.content });
    }
  }

  if (options?.fileIds?.length) {
    rawMessages.push({
      role: "user",
      content: [
        { type: "text", text: userMessage },
        ...options.fileIds.map((id) => ({
          type: "container_upload",
          file_id: id,
        })),
      ],
    });
  } else {
    rawMessages.push({ role: "user", content: userMessage });
  }

  const model = options?.model ?? "claude-sonnet-4-5-20250929";
  const maxTokens = options?.maxTokens ?? 8192;

  const requestParams: any = {
    model,
    max_tokens: maxTokens,
    messages: rawMessages,
    tools: [
      {
        type: "code_execution_20250825",
        name: "code_execution",
      },
    ],
  };

  if (options?.fileIds?.length) {
    requestParams.betas = ["files-api-2025-04-14"];
  }

  if (options?.containerId) {
    requestParams.container = options.containerId;
  }

  const stream = await (requestParams.betas
    ? client.beta.messages.stream(requestParams)
    : client.messages.stream(requestParams));

  let fullText = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined = options?.containerId;
  let currentToolName: string | undefined;
  let currentToolId: string | undefined;
  let currentToolInput = "";
  let lastExtractedCodeLength = 0;
  const toolInputs: Map<string, { name: string; input: string }> = new Map();

  for await (const event of stream) {
    if (event.type === "message_start") {
      if ((event as any).message?.container?.id) {
        containerId = (event as any).message.container.id;
      }
    } else if (event.type === "content_block_start") {
      const block = (event as any).content_block;
      if (block?.type === "server_tool_use") {
        currentToolName = block.name;
        currentToolId = block.id;
        currentToolInput = "";
        lastExtractedCodeLength = 0;
        onEvent({ type: "tool_start", toolName: block.name });
      }
    } else if (event.type === "content_block_delta") {
      const delta = (event as any).delta;
      if (delta?.type === "text_delta") {
        fullText += delta.text;
        onEvent({ type: "text", text: delta.text });
      } else if (delta?.type === "input_json_delta") {
        currentToolInput += delta.partial_json || "";
        if (currentToolName === "text_editor_code_execution") {
          const { newCode, totalLength } = extractCodeFromPartialJson(
            currentToolInput,
            lastExtractedCodeLength
          );
          lastExtractedCodeLength = totalLength;
          if (newCode) onEvent({ type: "tool_input", text: newCode });
        } else {
          onEvent({ type: "tool_input", text: delta.partial_json });
        }
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolName && currentToolId) {
        toolInputs.set(currentToolId, { name: currentToolName, input: currentToolInput });
        onEvent({ type: "tool_end", toolName: currentToolName });
        currentToolName = undefined;
        currentToolId = undefined;
        currentToolInput = "";
        lastExtractedCodeLength = 0;
      }
    }
  }

  for (const [toolId, tool] of toolInputs) {
    if (tool.name === "text_editor_code_execution" && tool.input) {
      try {
        const input = JSON.parse(tool.input);
        if (input?.command === "create" && input?.path && input?.file_text) {
          codeArtifacts.push({
            id: toolId,
            path: input.path,
            code: input.file_text,
            language: inferLanguage(input.path),
          });
        }
      } catch (e) { /* skip */ }
    }
  }

  const finalMessage = await stream.finalMessage();

  if ((finalMessage as any).container?.id) {
    containerId = (finalMessage as any).container.id;
  }

  for (const block of finalMessage.content) {
    if ((block as any).type === "bash_code_execution_tool_result") {
      const result = (block as any).content;
      if (result?.type === "bash_code_execution_result" && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === "bash_code_execution_output" && item.file_id) {
            files.push({
              file_id: item.file_id,
              filename: item.filename || `file_${item.file_id.slice(-8)}.png`,
            });
          } else if (item.type === "text" && item.text) {
            // stdout/stderr from code execution
            onEvent({ type: "code_output", output: item.text });
          }
        }
      }
    }
  }

  // Build the updated conversation history.
  // We store the raw content blocks so the API gets them back verbatim.
  const updatedMessages: ConversationMessage[] = previousMessages
    ? [...previousMessages]
    : [];
  updatedMessages.push({ role: "user", content: userMessage });
  updatedMessages.push({ role: "assistant", content: finalMessage.content as any });

  return {
    text: fullText,
    files,
    codeArtifacts,
    containerId,
    messages: updatedMessages,
  };
}
