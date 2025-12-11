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

// Types for code execution responses
export interface CodeExecutionFile {
  file_id: string;
  container_id: string;
  filename: string;
}

export interface CodeArtifact {
  id: string;
  code: string;
  status: string;
}

export interface CodeExecutionResult {
  text: string;
  files: CodeExecutionFile[];
  codeArtifacts: CodeArtifact[];
  containerId?: string;
  responseId: string;
}

export interface StreamEvent {
  type: string;
  text?: string;
  code?: string;
  toolName?: string;
}

/**
 * Create OpenAI client
 */
export function createOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Execute code with OpenAI's code interpreter (non-streaming)
 */
export async function executeCodeWithOpenAI(
  client: OpenAI,
  prompt: string,
  options?: {
    model?: string;
  }
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gpt-4o";

  const response = await client.responses.create({
    model,
    input: prompt,
    tools: [
      {
        type: "code_interpreter",
        container: {
          type: "auto",
        },
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
          code: item.code,
          status: item.status || "completed",
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
    responseId: response.id,
  };
}

/**
 * Execute code with OpenAI using streaming
 */
export async function executeCodeWithOpenAIStreaming(
  client: OpenAI,
  prompt: string,
  onEvent: (event: StreamEvent) => void,
  options?: {
    model?: string;
  }
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gpt-4o";

  const stream = await client.responses.create({
    model,
    input: prompt,
    tools: [
      {
        type: "code_interpreter",
        container: {
          type: "auto",
        },
      },
    ],
    stream: true,
  });

  let fullText = "";
  let currentCode = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let containerId: string | undefined;
  let responseId = "";
  let fullResponse: any = null;
  let currentCodeInterpreterId: string | undefined;

  for await (const event of stream as AsyncIterable<any>) {
    const eventType = event.type;

    switch (eventType) {
      case "response.created":
        responseId = event.response?.id || "";
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
            code: item.code,
            status: item.status || "completed",
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
    responseId,
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
  options?: {
    model?: string;
    system?: string;
  }
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
  options?: {
    model?: string;
    system?: string;
  }
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
