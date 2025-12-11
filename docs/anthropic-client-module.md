# Anthropic Claude Client Module

A TypeScript module for interacting with Claude's API, featuring code execution with streaming support, file generation, and artifact retrieval.

> **Note:** This module uses a [unified interface](#unified-interface) shared with the OpenAI module, allowing your frontend to use either provider interchangeably.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Unified Interface](#unified-interface)
- [API Reference](#api-reference)
  - [Types](#types)
  - [Functions](#functions)
- [File Upload](#file-upload)
- [Streaming Events](#streaming-events)
- [Frontend Integration](#frontend-integration)
  - [Next.js API Route](#nextjs-api-route)
  - [React Frontend Component](#react-frontend-component)
  - [Server-Sent Events (SSE)](#server-sent-events-sse)
- [Container Sessions](#container-sessions)
- [File Downloads](#file-downloads)
- [Error Handling](#error-handling)
- [Common Pitfalls](#common-pitfalls)

---

## Installation

```bash
npm install @anthropic-ai/sdk dotenv
```

Set your API key in `.env`:

```
ANTHROPIC_API_KEY=your-api-key-here
```

## Quick Start

```typescript
import "dotenv/config";
import {
  createAnthropicClient,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
  StreamEvent,
} from "./modules/anthropic-client.js";

const client = createAnthropicClient();

const result = await executeCodeWithClaudeStreaming(
  client,
  "Create a plot of y = x^2 and save it as plot.png",
  (event) => {
    if (event.type === "text") {
      process.stdout.write(event.text || "");
    }
  }
);

// Download generated images
if (result.files.length > 0) {
  await downloadGeneratedFiles(client, result.files, "./output");
}

// Access code artifacts (Python files created)
for (const artifact of result.codeArtifacts) {
  console.log(`File: ${artifact.path}`);
  console.log(artifact.code);
}
```

---

## Unified Interface

This module shares a common interface with the OpenAI module (`src/modules/types.ts`), enabling your frontend to switch between providers without code changes.

### Shared Types

```typescript
// src/modules/types.ts

interface CodeArtifact {
  id: string;       // Unique identifier
  path: string;     // File path (e.g., "plot.py") or "code_interpreter" for OpenAI
  code: string;     // Full source code
  language: string; // Programming language (e.g., "python")
}

interface CodeExecutionFile {
  file_id: string;
  filename: string;
  container_id?: string;  // OpenAI only
}

interface CodeExecutionResult {
  text: string;                  // Model's text response
  files: CodeExecutionFile[];    // Generated files (images, etc.)
  codeArtifacts: CodeArtifact[]; // Source code files created/executed
  containerId?: string;          // Container ID for follow-up requests
}

interface StreamEvent {
  type: StreamEventType;
  text?: string;      // Text content (for "text" type)
  code?: string;      // Code content (for "code" types)
  toolName?: string;  // Tool name (for "tool_start"/"tool_end")
}

type StreamEventType =
  | "text"           // Text response streaming
  | "tool_start"     // Code execution tool started
  | "tool_input"     // Tool input streaming (Claude only)
  | "code"           // Code streaming (OpenAI only)
  | "code_executing" // Code is being executed
  | "code_complete"  // Code execution complete
  | "tool_end";      // Code execution tool ended
```

### Provider-Agnostic Frontend

Your frontend can work with either provider using the same code:

```typescript
import type { CodeExecutionResult, StreamEvent } from "./modules/types.js";

// Generic handler works with both providers
function handleResult(result: CodeExecutionResult) {
  // Text response
  console.log(result.text);

  // Code artifacts (same structure for both)
  for (const artifact of result.codeArtifacts) {
    console.log(`${artifact.path} (${artifact.language})`);
    console.log(artifact.code);
  }

  // Generated files
  for (const file of result.files) {
    console.log(`File: ${file.filename} (ID: ${file.file_id})`);
  }
}

// Generic event handler
function handleEvent(event: StreamEvent) {
  switch (event.type) {
    case "text":
      process.stdout.write(event.text || "");
      break;
    case "tool_start":
      console.log(`[${event.toolName} started]`);
      break;
    case "tool_end":
      console.log(`[${event.toolName} completed]`);
      break;
  }
}
```

### Switching Providers

```typescript
// Claude
import { createAnthropicClient, executeCodeWithClaudeStreaming } from "./modules/anthropic-client.js";
const client = createAnthropicClient();
const result = await executeCodeWithClaudeStreaming(client, prompt, handleEvent);

// OpenAI - same result type, same event handler
import { createOpenAIClient, executeCodeWithOpenAIStreaming } from "./modules/openai-client.js";
const client = createOpenAIClient();
const result = await executeCodeWithOpenAIStreaming(client, prompt, handleEvent);

// Both return CodeExecutionResult with identical structure
handleResult(result);
```

---

## API Reference

### Types

#### `CodeExecutionFile`

Represents a file generated during code execution (images, data files, etc.).

```typescript
interface CodeExecutionFile {
  file_id: string;       // Unique identifier for downloading
  filename: string;      // Original filename
  container_id?: string; // OpenAI only
}
```

#### `CodeArtifact`

Represents source code created by Claude during execution.

```typescript
interface CodeArtifact {
  id: string;       // Unique identifier
  path: string;     // File path (e.g., "plot.py")
  code: string;     // Full source code
  language: string; // Programming language (e.g., "python")
}
```

#### `CodeExecutionResult`

The complete result returned after execution.

```typescript
interface CodeExecutionResult {
  text: string;                  // Claude's text response
  files: CodeExecutionFile[];    // Generated files (images, etc.)
  codeArtifacts: CodeArtifact[]; // Source code files created
  containerId?: string;          // Container ID for follow-up requests
}
```

#### `StreamEvent`

Events emitted during streaming execution.

```typescript
interface StreamEvent {
  type: StreamEventType;
  text?: string;      // Text content (for "text" type)
  code?: string;      // Code content
  toolName?: string;  // Tool name (for "tool_start" and "tool_end" types)
}

type StreamEventType =
  | "text"           // Text response streaming
  | "tool_start"     // Code execution tool started
  | "tool_input"     // Tool input streaming
  | "code_executing" // Code is being executed
  | "code_complete"  // Code execution complete
  | "tool_end";      // Code execution tool ended
```

### Functions

#### `createAnthropicClient()`

Creates an Anthropic client using the `ANTHROPIC_API_KEY` environment variable.

```typescript
function createAnthropicClient(): Anthropic
```

#### `uploadFile()`

Upload a file to Claude's Files API for use in code execution.

```typescript
async function uploadFile(
  client: Anthropic,
  filePath: string,
  mimeType?: string
): Promise<UploadedFile>
```

#### `uploadFileFromBuffer()`

Upload a file from a Buffer (useful for in-memory data).

```typescript
async function uploadFileFromBuffer(
  client: Anthropic,
  buffer: Buffer,
  filename: string,
  mimeType?: string
): Promise<UploadedFile>
```

#### `deleteFile()`

Delete an uploaded file from Claude's Files API.

```typescript
async function deleteFile(
  client: Anthropic,
  fileId: string
): Promise<void>
```

#### `executeCodeWithClaude()`

Execute code with Claude's code execution tool (non-streaming).

```typescript
async function executeCodeWithClaude(
  client: Anthropic,
  prompt: string,
  options?: {
    model?: string;        // Default: "claude-sonnet-4-5-20250929"
    maxTokens?: number;    // Default: 8192
    containerId?: string;  // For continuing in same container
    fileIds?: string[];    // File IDs to make available for code execution
  }
): Promise<CodeExecutionResult>
```

#### `executeCodeWithClaudeStreaming()`

Execute code with streaming - provides real-time events during execution.

```typescript
async function executeCodeWithClaudeStreaming(
  client: Anthropic,
  prompt: string,
  onEvent: (event: StreamEvent) => void,
  options?: {
    model?: string;        // Default: "claude-sonnet-4-5-20250929"
    maxTokens?: number;    // Default: 8192
    containerId?: string;  // For continuing in same container
    fileIds?: string[];    // File IDs to make available for code execution
  }
): Promise<CodeExecutionResult>
```

#### `downloadGeneratedFiles()`

Download files generated during code execution to disk.

```typescript
async function downloadGeneratedFiles(
  client: Anthropic,
  files: CodeExecutionFile[],
  outputDir: string = "."
): Promise<string[]>  // Returns array of saved file paths
```

#### `chatWithClaude()`

Simple chat without code execution (non-streaming).

```typescript
async function chatWithClaude(
  client: Anthropic,
  message: string,
  options?: {
    model?: string;
    maxTokens?: number;
    system?: string;
  }
): Promise<string>
```

#### `streamChatWithClaude()`

Simple chat with streaming (no code execution).

```typescript
async function streamChatWithClaude(
  client: Anthropic,
  message: string,
  onText: (text: string) => void,
  options?: {
    model?: string;
    maxTokens?: number;
    system?: string;
  }
): Promise<string>
```

---

## File Upload

Upload files to Claude's Files API and reference them in code execution. This allows Claude to analyze, process, or transform your files.

### Basic File Upload

```typescript
import {
  createAnthropicClient,
  uploadFile,
  executeCodeWithClaude,
  deleteFile,
} from "./modules/anthropic-client.js";

const client = createAnthropicClient();

// Upload a CSV file
const uploaded = await uploadFile(client, "./data.csv");
console.log(`Uploaded: ${uploaded.filename} (${uploaded.file_id})`);

// Use the file in code execution
const result = await executeCodeWithClaude(
  client,
  "Analyze the uploaded CSV file and create a summary chart",
  { fileIds: [uploaded.file_id] }
);

// Clean up when done
await deleteFile(client, uploaded.file_id);
```

### Upload from Buffer

```typescript
import { uploadFileFromBuffer } from "./modules/anthropic-client.js";

// Create data in memory
const csvData = "name,value\nA,10\nB,20\nC,30";
const buffer = Buffer.from(csvData, "utf-8");

// Upload the buffer
const uploaded = await uploadFileFromBuffer(
  client,
  buffer,
  "data.csv",
  "text/csv"
);

// Use in code execution
const result = await executeCodeWithClaude(
  client,
  "Plot this data as a bar chart",
  { fileIds: [uploaded.file_id] }
);
```

### Multiple Files

```typescript
// Upload multiple files
const file1 = await uploadFile(client, "./sales_2023.csv");
const file2 = await uploadFile(client, "./sales_2024.csv");

// Reference all files in execution
const result = await executeCodeWithClaude(
  client,
  "Compare the two sales datasets and create a visualization",
  { fileIds: [file1.file_id, file2.file_id] }
);
```

### Supported File Types

The module automatically infers MIME types for common file extensions:

| Extension | MIME Type |
|-----------|-----------|
| .csv | text/csv |
| .json | application/json |
| .txt | text/plain |
| .pdf | application/pdf |
| .png | image/png |
| .jpg, .jpeg | image/jpeg |
| .xlsx | application/vnd.openxmlformats-officedocument.spreadsheetml.sheet |
| .py | text/x-python |

For other types, specify the MIME type explicitly:

```typescript
const uploaded = await uploadFile(client, "./custom.data", "application/octet-stream");
```

---

## Streaming Events

During `executeCodeWithClaudeStreaming()`, the `onEvent` callback receives events in this order:

| Event Type | When | Properties |
|------------|------|------------|
| `text` | Text is being generated | `text`: The text chunk |
| `tool_start` | Code execution begins | `toolName`: Tool name |
| `tool_input` | Code is being written | `text`: JSON fragment |
| `tool_end` | Code execution completes | `toolName`: Tool name |

### Event Timeline

```
1. text         → "I'll create a plot..."
2. text         → " Let me write the code."
3. tool_start   → { toolName: "text_editor_code_execution" }
4. tool_input   → { "command": "cre...
5. tool_input   → ate", "path": "plot...
6. tool_input   → .py", "file_text": "import...
7. tool_end     → { toolName: "text_editor_code_execution" }
8. tool_start   → { toolName: "bash" }
9. tool_end     → { toolName: "bash" }
10. text        → "I've created the plot..."
```

---

## Frontend Integration

### Next.js API Route

Create an API route that streams events to the frontend using Server-Sent Events (SSE).

```typescript
// app/api/claude/route.ts
import { NextRequest } from "next/server";
import {
  createAnthropicClient,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
  StreamEvent,
} from "@/lib/anthropic-client";

export async function POST(req: NextRequest) {
  const { prompt, containerId } = await req.json();
  const client = createAnthropicClient();

  // Create a TransformStream for SSE
  const encoder = new TextEncoder();
  const stream = new TransformStream();
  const writer = stream.writable.getWriter();

  // Helper to send SSE events
  const sendEvent = async (event: string, data: any) => {
    await writer.write(
      encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    );
  };

  // Process in background
  (async () => {
    try {
      const result = await executeCodeWithClaudeStreaming(
        client,
        prompt,
        async (event: StreamEvent) => {
          await sendEvent("stream", event);
        },
        { containerId }
      );

      // Send code artifacts
      for (const artifact of result.codeArtifacts) {
        await sendEvent("code_artifact", artifact);
      }

      // Download and send file URLs
      if (result.files.length > 0) {
        // Option 1: Download to server and send local URLs
        const paths = await downloadGeneratedFiles(client, result.files, "./public/generated");
        for (const path of paths) {
          await sendEvent("file", { url: path.replace("./public", "") });
        }

        // Option 2: Send file IDs for client-side download
        // for (const file of result.files) {
        //   await sendEvent("file_id", file);
        // }
      }

      // Send completion with full result
      await sendEvent("done", {
        text: result.text,
        containerId: result.containerId,
        codeArtifacts: result.codeArtifacts,
        fileCount: result.files.length,
      });
    } catch (error) {
      await sendEvent("error", { message: String(error) });
    } finally {
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

### React Frontend Component

```tsx
// components/ClaudeChat.tsx
"use client";

import { useState, useCallback } from "react";

interface CodeArtifact {
  path: string;
  content: string;
}

interface ChatState {
  streamingText: string;
  codeArtifacts: CodeArtifact[];
  generatedFiles: string[];
  isExecutingCode: boolean;
  currentTool: string | null;
  containerId: string | null;
  isLoading: boolean;
  error: string | null;
}

export function ClaudeChat() {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<ChatState>({
    streamingText: "",
    codeArtifacts: [],
    generatedFiles: [],
    isExecutingCode: false,
    currentTool: null,
    containerId: null,
    isLoading: false,
    error: null,
  });

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;

    setState((prev) => ({
      ...prev,
      streamingText: "",
      codeArtifacts: [],
      generatedFiles: [],
      isLoading: true,
      error: null,
    }));

    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          containerId: state.containerId,
        }),
      });

      if (!response.ok) throw new Error("Request failed");

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) throw new Error("No response body");

      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ") && eventType) {
            const data = JSON.parse(line.slice(6));
            handleSSEEvent(eventType, data);
            eventType = "";
          }
        }
      }
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: String(error),
        isLoading: false,
      }));
    }
  }, [prompt, state.containerId]);

  const handleSSEEvent = (eventType: string, data: any) => {
    switch (eventType) {
      case "stream":
        if (data.type === "text") {
          setState((prev) => ({
            ...prev,
            streamingText: prev.streamingText + (data.text || ""),
          }));
        } else if (data.type === "tool_start") {
          setState((prev) => ({
            ...prev,
            isExecutingCode: true,
            currentTool: data.toolName,
          }));
        } else if (data.type === "tool_end") {
          setState((prev) => ({
            ...prev,
            isExecutingCode: false,
            currentTool: null,
          }));
        }
        break;

      case "code_artifact":
        setState((prev) => ({
          ...prev,
          codeArtifacts: [...prev.codeArtifacts, data],
        }));
        break;

      case "file":
        setState((prev) => ({
          ...prev,
          generatedFiles: [...prev.generatedFiles, data.url],
        }));
        break;

      case "done":
        setState((prev) => ({
          ...prev,
          containerId: data.containerId,
          isLoading: false,
        }));
        break;

      case "error":
        setState((prev) => ({
          ...prev,
          error: data.message,
          isLoading: false,
        }));
        break;
    }
  };

  return (
    <div className="claude-chat">
      {/* Input */}
      <div className="input-section">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask Claude to write and execute code..."
          disabled={state.isLoading}
        />
        <button onClick={handleSubmit} disabled={state.isLoading}>
          {state.isLoading ? "Processing..." : "Send"}
        </button>
      </div>

      {/* Streaming Response */}
      <div className="response-section">
        {state.streamingText && (
          <div className="text-response">
            {state.streamingText}
          </div>
        )}

        {/* Code Execution Indicator */}
        {state.isExecutingCode && (
          <div className="code-execution-indicator">
            Executing: {state.currentTool}...
          </div>
        )}

        {/* Code Artifacts */}
        {state.codeArtifacts.map((artifact, i) => (
          <div key={i} className="code-artifact">
            <div className="artifact-header">{artifact.path}</div>
            <pre>
              <code>{artifact.content}</code>
            </pre>
          </div>
        ))}

        {/* Generated Files (Images) */}
        {state.generatedFiles.map((url, i) => (
          <div key={i} className="generated-file">
            <img src={url} alt={`Generated file ${i + 1}`} />
          </div>
        ))}

        {/* Error Display */}
        {state.error && (
          <div className="error">Error: {state.error}</div>
        )}
      </div>
    </div>
  );
}
```

### Server-Sent Events (SSE)

The frontend receives events in this format:

```
event: stream
data: {"type":"text","text":"I'll create"}

event: stream
data: {"type":"text","text":" a plot for you."}

event: stream
data: {"type":"tool_start","toolName":"text_editor_code_execution"}

event: stream
data: {"type":"tool_input","text":"{\"command\":\"create\""}

event: stream
data: {"type":"tool_end","toolName":"text_editor_code_execution"}

event: code_artifact
data: {"path":"plot.py","content":"import matplotlib...","command":"create"}

event: file
data: {"url":"/generated/plot.png"}

event: done
data: {"text":"I've created...","containerId":"ctn_xxx","fileCount":1}
```

---

## Container Sessions

Use the `containerId` to maintain state across multiple requests:

```typescript
// First request - creates a new container
const result1 = await executeCodeWithClaudeStreaming(
  client,
  "Create a variable x = 42",
  handleEvent
);

console.log(result1.containerId); // "ctn_abc123..."

// Second request - reuse the container
const result2 = await executeCodeWithClaudeStreaming(
  client,
  "What is x * 2?",  // Can access x from previous execution
  handleEvent,
  { containerId: result1.containerId }
);
```

---

## File Downloads

### Server-Side Download

```typescript
const paths = await downloadGeneratedFiles(client, result.files, "./output");
// Returns: ["./output/plot.png", "./output/data.csv"]
```

### Manual Download via REST API

If you need more control over downloads:

```typescript
async function downloadFile(fileId: string): Promise<Buffer> {
  const response = await fetch(
    `https://api.anthropic.com/v1/files/${fileId}/content`,
    {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
```

### Frontend File Download

To let users download directly from the frontend:

```typescript
// API route to proxy file downloads
// app/api/files/[fileId]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const response = await fetch(
    `https://api.anthropic.com/v1/files/${params.fileId}/content`,
    {
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "files-api-2025-04-14",
      },
    }
  );

  return new Response(response.body, {
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${params.fileId}.png"`,
    },
  });
}
```

---

## Error Handling

```typescript
try {
  const result = await executeCodeWithClaudeStreaming(
    client,
    prompt,
    handleEvent
  );
} catch (error) {
  if (error instanceof Anthropic.APIError) {
    switch (error.status) {
      case 400:
        console.error("Bad request:", error.message);
        break;
      case 401:
        console.error("Invalid API key");
        break;
      case 429:
        console.error("Rate limited - wait and retry");
        break;
      case 500:
        console.error("Anthropic server error");
        break;
    }
  }
}
```

---

## Common Pitfalls

### 1. Model Name Must Be Exact

```typescript
// Wrong - will cause 404
model: "claude-sonnet-4-5-20250514"

// Correct
model: "claude-sonnet-4-5-20250929"
```

### 2. Code Artifacts Require Manual Extraction in Streaming

The `finalMessage()` in streaming mode returns empty `input: {}` for tool blocks. This module handles it by accumulating `input_json_delta` events during streaming.

### 3. Files API Requires REST, Not SDK

The SDK's `client.beta.files` methods may not work. Use the REST API directly:

```typescript
fetch(`https://api.anthropic.com/v1/files/${fileId}/content`, {
  headers: {
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "files-api-2025-04-14",
  },
});
```

### 4. Code Execution Is Token-Heavy

A single code execution request can use 10,000+ tokens due to:
- System context for the code execution environment
- Tool definitions
- Multi-turn tool use within a single request

Plan for this in rate limit handling.

### 5. Generated Files vs Code Artifacts

- **`files`**: Binary outputs (images, CSVs) - require download via API
- **`codeArtifacts`**: Source code (Python files) - available immediately as strings

---

## Complete Example

See `src/test/test-anthropic.ts` for a complete working example that:

1. Sends a prompt requesting a mathematical plot
2. Streams the response in real-time
3. Extracts code artifacts (Python source)
4. Downloads generated images
5. Displays all results

Run with:

```bash
npm run test:anthropic
```
