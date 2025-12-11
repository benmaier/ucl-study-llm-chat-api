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
} from "./types.js";

/**
 * Create OpenAI client
 */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Create a container for file uploads and code execution
 */
export async function createContainer(): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/containers", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: `container_${Date.now()}`,
      expires_after: { anchor: "last_active_at", days: 1 },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Container creation failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();
  return result.id;
}

/**
 * Upload a file to a container for use in code execution
 */
export async function uploadFile(
  filePath: string,
  containerId: string,
  mimeType?: string
): Promise<UploadedFile> {
  const fs = await import("fs");
  const path = await import("path");

  const filename = path.basename(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const detectedMimeType = mimeType || inferMimeType(filename);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: detectedMimeType }), filename);

  const response = await fetch(
    `https://api.openai.com/v1/containers/${containerId}/files`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  return {
    file_id: result.id,
    filename: result.name || filename,
    mime_type: detectedMimeType,
    size_bytes: result.bytes || fileBuffer.length,
  };
}

/**
 * Upload a file from a Buffer to a container
 */
export async function uploadFileFromBuffer(
  buffer: Buffer,
  filename: string,
  containerId: string,
  mimeType?: string
): Promise<UploadedFile> {
  const detectedMimeType = mimeType || inferMimeType(filename);

  // Convert Buffer to ArrayBuffer for Blob compatibility
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

  const formData = new FormData();
  formData.append("file", new Blob([arrayBuffer], { type: detectedMimeType }), filename);

  const response = await fetch(
    `https://api.openai.com/v1/containers/${containerId}/files`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File upload failed: ${response.status} - ${errorText}`);
  }

  const result = await response.json();

  return {
    file_id: result.id,
    filename: result.name || filename,
    mime_type: detectedMimeType,
    size_bytes: result.bytes || buffer.length,
  };
}

/**
 * Delete a file from a container
 */
export async function deleteFile(
  fileId: string,
  containerId: string
): Promise<void> {
  const response = await fetch(
    `https://api.openai.com/v1/containers/${containerId}/files/${fileId}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`File deletion failed: ${response.status} - ${errorText}`);
  }
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

  // Build container configuration - include file_ids if provided
  const containerConfig: any = options?.containerId
    ? { type: "container", container_id: options.containerId }
    : { type: "auto" };

  // If fileIds are provided, they need to be in the container with a specific container_id
  // OpenAI requires files to be uploaded to a container first, then referenced via container_id
  if (options?.fileIds?.length && options?.containerId) {
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

  // Build container configuration - include file_ids if provided
  const containerConfig: any = options?.containerId
    ? { type: "container", container_id: options.containerId }
    : { type: "auto" };

  // If fileIds are provided, they need to be in the container with a specific container_id
  if (options?.fileIds?.length && options?.containerId) {
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
  outputDir: string = "."
): Promise<string[]> {
  const downloadedPaths: string[] = [];

  for (const file of files) {
    try {
      // Construct download URL
      const url = `https://api.openai.com/v1/containers/${file.container_id}/files/${file.file_id}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
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
