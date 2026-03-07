/**
 * Gemini Client Module
 *
 * Code execution, file handling, chat, and streaming with Google's Gemini API.
 * Uses the @google/genai SDK (GA replacement for @google/generative-ai).
 *
 * Key differences from Claude/OpenAI:
 * - Code execution sandbox is ephemeral (no cross-turn file persistence)
 * - Generated images returned as inline base64 data, not downloadable file IDs
 * - Multi-turn via contents array with "user"/"model" roles
 */

import { GoogleGenAI } from "@google/genai";
import type {
  UploadedFile,
  CodeExecutionFile,
  CodeArtifact,
  CodeExecutionResult,
  MultiTurnCodeResult,
  ConversationMessage,
  StreamEvent,
  CodeExecutionOptions,
  ChatOptions,
} from "./types.js";
import { inferMimeType, mimeToExtension } from "./helpers.js";

// ---------------------------------------------------------------------------
// Client creation
// ---------------------------------------------------------------------------

export function createGeminiClient(apiKey?: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: apiKey || process.env.GOOGLE_API_KEY,
  });
}

// ---------------------------------------------------------------------------
// File operations
// ---------------------------------------------------------------------------

export async function uploadFile(
  client: GoogleGenAI,
  filePath: string,
  mimeType?: string
): Promise<UploadedFile> {
  const path = await import("path");
  const filename = path.basename(filePath);
  const detectedMimeType = mimeType || inferMimeType(filename);

  const uploaded = await client.files.upload({
    file: filePath,
    config: { mimeType: detectedMimeType },
  });

  return {
    file_id: uploaded.name!,
    filename: uploaded.displayName || filename,
    mime_type: detectedMimeType,
    size_bytes: Number(uploaded.sizeBytes || 0),
  };
}

export async function uploadFileFromBuffer(
  client: GoogleGenAI,
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<UploadedFile> {
  const detectedMimeType = mimeType || inferMimeType(filename);
  const blob = new Blob([new Uint8Array(buffer)], { type: detectedMimeType });

  const uploaded = await client.files.upload({
    file: blob,
    config: { mimeType: detectedMimeType, displayName: filename },
  });

  return {
    file_id: uploaded.name!,
    filename: uploaded.displayName || filename,
    mime_type: detectedMimeType,
    size_bytes: buffer.length,
  };
}

export async function deleteFile(
  client: GoogleGenAI,
  fileId: string
): Promise<void> {
  await client.files.delete({ name: fileId });
}

// ---------------------------------------------------------------------------
// Code execution (non-streaming)
// ---------------------------------------------------------------------------

export async function executeCodeWithGemini(
  client: GoogleGenAI,
  prompt: string,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gemini-2.5-flash";

  const parts: any[] = [{ text: prompt }];
  if (options?.fileIds?.length) {
    for (const fileId of options.fileIds) {
      parts.push({
        fileData: { fileUri: fileId, mimeType: "application/octet-stream" },
      });
    }
  }

  const response = await client.models.generateContent({
    model,
    contents: [{ role: "user", parts }],
    config: { tools: [{ codeExecution: {} }] },
  });

  return parseGeminiResponse(response);
}

// ---------------------------------------------------------------------------
// Code execution (streaming)
// ---------------------------------------------------------------------------

export async function executeCodeWithGeminiStreaming(
  client: GoogleGenAI,
  prompt: string,
  onEvent: (event: StreamEvent) => void,
  options?: CodeExecutionOptions
): Promise<CodeExecutionResult> {
  const model = options?.model ?? "gemini-2.5-flash";

  const parts: any[] = [{ text: prompt }];
  if (options?.fileIds?.length) {
    for (const fileId of options.fileIds) {
      parts.push({
        fileData: { fileUri: fileId, mimeType: "application/octet-stream" },
      });
    }
  }

  const stream = await client.models.generateContentStream({
    model,
    contents: [{ role: "user", parts }],
    config: { tools: [{ codeExecution: {} }] },
  });

  return processGeminiStream(stream, onEvent);
}

// ---------------------------------------------------------------------------
// Multi-turn code execution (streaming)
// ---------------------------------------------------------------------------

export async function executeCodeWithGeminiMultiTurn(
  client: GoogleGenAI,
  userMessage: string,
  onEvent: (event: StreamEvent) => void,
  previousContents?: any[],
  options?: CodeExecutionOptions
): Promise<MultiTurnCodeResult> {
  const model = options?.model ?? "gemini-2.5-flash";

  // Build contents array with history
  const contents: any[] = previousContents ? [...previousContents] : [];

  const userParts: any[] = [{ text: userMessage }];
  if (options?.fileIds?.length) {
    for (const fileId of options.fileIds) {
      userParts.push({
        fileData: { fileUri: fileId, mimeType: "application/octet-stream" },
      });
    }
  }
  contents.push({ role: "user", parts: userParts });

  const stream = await client.models.generateContentStream({
    model,
    contents,
    config: { tools: [{ codeExecution: {} }] },
  });

  const { text, files, codeArtifacts, modelParts } =
    await processGeminiStreamWithParts(stream, onEvent);

  // Append model response to contents for next turn
  const updatedContents = [...contents, { role: "model", parts: modelParts }];

  const updatedMessages: ConversationMessage[] = [];
  updatedMessages.push({ role: "user", content: userMessage });
  updatedMessages.push({ role: "assistant", content: text });

  return {
    text,
    files,
    codeArtifacts,
    messages: updatedMessages,
    geminiContents: updatedContents,
  };
}

// ---------------------------------------------------------------------------
// File download (base64 decode — no network call)
// ---------------------------------------------------------------------------

export async function downloadGeneratedFiles(
  files: CodeExecutionFile[],
  outputDir: string = "."
): Promise<string[]> {
  const fs = await import("fs");
  const path = await import("path");
  const downloadedPaths: string[] = [];

  console.log(`Attempting to download ${files.length} file(s)...`);

  for (const file of files) {
    if (!file.base64Data) {
      console.warn(`  No base64 data for file ${file.file_id}, skipping`);
      continue;
    }

    const buffer = Buffer.from(file.base64Data, "base64");
    const outputPath = path.join(outputDir, file.filename);
    fs.writeFileSync(outputPath, buffer);
    downloadedPaths.push(outputPath);
    console.log(
      `  Downloaded: ${outputPath} (${buffer.length} bytes)`
    );
  }

  return downloadedPaths;
}

// ---------------------------------------------------------------------------
// Simple chat
// ---------------------------------------------------------------------------

export async function chatWithGemini(
  client: GoogleGenAI,
  message: string,
  options?: ChatOptions
): Promise<string> {
  const response = await client.models.generateContent({
    model: options?.model ?? "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: message }] }],
    config: options?.system
      ? { systemInstruction: options.system }
      : undefined,
  });

  return (
    response.candidates?.[0]?.content?.parts
      ?.filter((p: any) => p.text)
      .map((p: any) => p.text)
      .join("") || ""
  );
}

export async function streamChatWithGemini(
  client: GoogleGenAI,
  message: string,
  onText: (text: string) => void,
  options?: ChatOptions
): Promise<string> {
  const stream = await client.models.generateContentStream({
    model: options?.model ?? "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: message }] }],
    config: options?.system
      ? { systemInstruction: options.system }
      : undefined,
  });

  let fullText = "";
  for await (const chunk of stream) {
    const text =
      chunk.candidates?.[0]?.content?.parts
        ?.filter((p: any) => p.text)
        .map((p: any) => p.text)
        .join("") || "";
    if (text) {
      fullText += text;
      onText(text);
    }
  }

  return fullText;
}

// ---------------------------------------------------------------------------
// Internal: parse non-streaming response
// ---------------------------------------------------------------------------

function parseGeminiResponse(response: any): CodeExecutionResult {
  let text = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  let inlineFileIndex = 0;

  const parts = response.candidates?.[0]?.content?.parts || [];

  for (const part of parts) {
    if (part.text) {
      text += part.text;
    } else if (part.executableCode) {
      codeArtifacts.push({
        id: `gemini_code_${Date.now()}_${codeArtifacts.length}`,
        path: "code_execution",
        code: part.executableCode.code,
        language: (part.executableCode.language || "PYTHON").toLowerCase(),
      });
    } else if (part.inlineData) {
      const ext = mimeToExtension(part.inlineData.mimeType || "image/png");
      const filename = `output_${inlineFileIndex}.${ext}`;
      files.push({
        file_id: `gemini_inline_${inlineFileIndex}_${Date.now()}`,
        filename,
        base64Data: part.inlineData.data,
        mimeType: part.inlineData.mimeType,
      });
      inlineFileIndex++;
    }
    // codeExecutionResult stdout is available in conversation history
    // but not appended to text (the model summarizes results in its text parts)
  }

  return { text, files, codeArtifacts };
}

// ---------------------------------------------------------------------------
// Internal: process streaming response
// ---------------------------------------------------------------------------

async function processGeminiStream(
  stream: AsyncIterable<any>,
  onEvent: (event: StreamEvent) => void
): Promise<CodeExecutionResult> {
  const { text, files, codeArtifacts } = await processGeminiStreamWithParts(
    stream,
    onEvent
  );
  return { text, files, codeArtifacts };
}

async function processGeminiStreamWithParts(
  stream: AsyncIterable<any>,
  onEvent: (event: StreamEvent) => void
): Promise<{
  text: string;
  files: CodeExecutionFile[];
  codeArtifacts: CodeArtifact[];
  modelParts: any[];
}> {
  let fullText = "";
  const files: CodeExecutionFile[] = [];
  const codeArtifacts: CodeArtifact[] = [];
  const modelParts: any[] = [];
  let inlineFileIndex = 0;
  let codeBlockActive = false;

  // Each streaming chunk delivers fresh delta parts (not a growing array).
  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];

    for (const part of parts) {
      modelParts.push(part);

      if (part.text) {
        fullText += part.text;
        onEvent({ type: "text", text: part.text });
      } else if (part.executableCode) {
        if (!codeBlockActive) {
          onEvent({ type: "tool_start", toolName: "code_execution" });
          codeBlockActive = true;
        }
        onEvent({ type: "code", code: part.executableCode.code });
        codeArtifacts.push({
          id: `gemini_code_${Date.now()}_${codeArtifacts.length}`,
          path: "code_execution",
          code: part.executableCode.code,
          language: (part.executableCode.language || "PYTHON").toLowerCase(),
        });
        onEvent({ type: "code_complete", code: part.executableCode.code });
      } else if (part.codeExecutionResult) {
        if (part.codeExecutionResult.output) {
          onEvent({
            type: "code_output",
            output: part.codeExecutionResult.output,
          });
        }
        if (codeBlockActive) {
          onEvent({ type: "tool_end", toolName: "code_execution" });
          codeBlockActive = false;
        }
      } else if (part.inlineData) {
        const ext = mimeToExtension(part.inlineData.mimeType || "image/png");
        const filename = `output_${inlineFileIndex}.${ext}`;
        files.push({
          file_id: `gemini_inline_${inlineFileIndex}_${Date.now()}`,
          filename,
          base64Data: part.inlineData.data,
          mimeType: part.inlineData.mimeType,
        });
        inlineFileIndex++;
      }
    }
  }

  // Close any unclosed code block
  if (codeBlockActive) {
    onEvent({ type: "tool_end", toolName: "code_execution" });
  }

  return { text: fullText, files, codeArtifacts, modelParts };
}
