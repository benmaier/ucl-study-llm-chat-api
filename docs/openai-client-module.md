# OpenAI Responses API Client Module

A TypeScript module for interacting with OpenAI's Responses API, featuring code interpreter with streaming support, file generation, and artifact retrieval.

> **Note:** This module uses a [unified interface](#unified-interface) shared with the Claude module, allowing your frontend to use either provider interchangeably.

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
- [Comparison with Claude API](#comparison-with-claude-api)

---

## Installation

```bash
npm install openai dotenv
```

Set your API key in `.env`:

```
OPENAI_API_KEY=your-api-key-here
```

## Quick Start

```typescript
import "dotenv/config";
import {
  createOpenAIClient,
  executeCodeWithOpenAIStreaming,
  downloadGeneratedFiles,
  StreamEvent,
} from "./modules/openai-client.js";

const client = createOpenAIClient();

const result = await executeCodeWithOpenAIStreaming(
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
  await downloadGeneratedFiles(result.files, "./output");
}

// Access code artifacts (Python code executed)
for (const artifact of result.codeArtifacts) {
  console.log(`${artifact.path} (${artifact.language})`);
  console.log(artifact.code);
}
```

---

## Unified Interface

This module shares a common interface with the Claude module (`src/modules/types.ts`), enabling your frontend to switch between providers without code changes.

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
// OpenAI
import { createOpenAIClient, executeCodeWithOpenAIStreaming } from "./modules/openai-client.js";
const client = createOpenAIClient();
const result = await executeCodeWithOpenAIStreaming(client, prompt, handleEvent);

// Claude - same result type, same event handler
import { createAnthropicClient, executeCodeWithClaudeStreaming } from "./modules/anthropic-client.js";
const client = createAnthropicClient();
const result = await executeCodeWithClaudeStreaming(client, prompt, handleEvent);

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
  container_id?: string; // Container where file was created (OpenAI only)
}
```

#### `CodeArtifact`

Represents Python code executed by the code interpreter.

```typescript
interface CodeArtifact {
  id: string;       // Unique identifier
  path: string;     // "code_interpreter" for OpenAI
  code: string;     // Full Python source code that was executed
  language: string; // Programming language (e.g., "python")
}
```

#### `CodeExecutionResult`

The complete result returned after execution.

```typescript
interface CodeExecutionResult {
  text: string;                  // Model's text response
  files: CodeExecutionFile[];    // Generated files (images, etc.)
  codeArtifacts: CodeArtifact[]; // Python code that was executed
  containerId?: string;          // Container ID for reference
}
```

#### `StreamEvent`

Events emitted during streaming execution.

```typescript
interface StreamEvent {
  type: StreamEventType;
  text?: string;      // Text content (for "text" type)
  code?: string;      // Code content (for "code" and "code_complete" types)
  toolName?: string;  // Tool name (for "tool_start" and "tool_end" types)
}

type StreamEventType =
  | "text"           // Text response streaming
  | "tool_start"     // Code execution tool started
  | "code"           // Code streaming
  | "code_executing" // Code is being executed
  | "code_complete"  // Code execution complete
  | "tool_end";      // Code execution tool ended
```

### Functions

#### `createOpenAIClient()`

Creates an OpenAI client using the `OPENAI_API_KEY` environment variable.

```typescript
function createOpenAIClient(): OpenAI
```

#### `createContainer()`

Create a container for file uploads and code execution.

```typescript
async function createContainer(): Promise<string>  // Returns container ID
```

#### `uploadFile()`

Upload a file to a container for use in code execution.

```typescript
async function uploadFile(
  filePath: string,
  containerId: string,
  mimeType?: string
): Promise<UploadedFile>
```

#### `uploadFileFromBuffer()`

Upload a file from a Buffer to a container.

```typescript
async function uploadFileFromBuffer(
  buffer: Buffer,
  filename: string,
  containerId: string,
  mimeType?: string
): Promise<UploadedFile>
```

#### `deleteFile()`

Delete a file from a container.

```typescript
async function deleteFile(
  fileId: string,
  containerId: string
): Promise<void>
```

#### `executeCodeWithOpenAI()`

Execute code with OpenAI's code interpreter (non-streaming).

```typescript
async function executeCodeWithOpenAI(
  client: OpenAI,
  prompt: string,
  options?: {
    model?: string;       // Default: "gpt-4o"
    containerId?: string; // Container with uploaded files
    fileIds?: string[];   // File IDs to make available (requires containerId)
  }
): Promise<CodeExecutionResult>
```

#### `executeCodeWithOpenAIStreaming()`

Execute code with streaming - provides real-time events during execution.

```typescript
async function executeCodeWithOpenAIStreaming(
  client: OpenAI,
  prompt: string,
  onEvent: (event: StreamEvent) => void,
  options?: {
    model?: string;       // Default: "gpt-4o"
    containerId?: string; // Container with uploaded files
    fileIds?: string[];   // File IDs to make available (requires containerId)
  }
): Promise<CodeExecutionResult>
```

#### `downloadGeneratedFiles()`

Download files generated during code execution to disk.

```typescript
async function downloadGeneratedFiles(
  files: CodeExecutionFile[],
  outputDir: string = "."
): Promise<string[]>  // Returns array of saved file paths
```

#### `chatWithOpenAI()`

Simple chat without code interpreter (non-streaming).

```typescript
async function chatWithOpenAI(
  client: OpenAI,
  message: string,
  options?: {
    model?: string;
    system?: string;
  }
): Promise<string>
```

#### `streamChatWithOpenAI()`

Simple chat with streaming (no code interpreter).

```typescript
async function streamChatWithOpenAI(
  client: OpenAI,
  message: string,
  onText: (text: string) => void,
  options?: {
    model?: string;
    system?: string;
  }
): Promise<string>
```

---

## File Upload

Upload files to OpenAI containers and reference them in code execution. This requires first creating a container, then uploading files to it.

### Basic File Upload

```typescript
import {
  createOpenAIClient,
  createContainer,
  uploadFile,
  executeCodeWithOpenAI,
  deleteFile,
} from "./modules/openai-client.js";

const client = createOpenAIClient();

// 1. Create a container first
const containerId = await createContainer();
console.log(`Created container: ${containerId}`);

// 2. Upload a CSV file to the container
const uploaded = await uploadFile("./data.csv", containerId);
console.log(`Uploaded: ${uploaded.filename} (${uploaded.file_id})`);

// 3. Use the file in code execution
const result = await executeCodeWithOpenAI(
  client,
  "Analyze the uploaded CSV file and create a summary chart",
  { containerId, fileIds: [uploaded.file_id] }
);

// 4. Clean up when done
await deleteFile(uploaded.file_id, containerId);
```

### Upload from Buffer

```typescript
import { uploadFileFromBuffer } from "./modules/openai-client.js";

// Create data in memory
const csvData = "name,value\nA,10\nB,20\nC,30";
const buffer = Buffer.from(csvData, "utf-8");

// Upload the buffer to a container
const uploaded = await uploadFileFromBuffer(
  buffer,
  "data.csv",
  containerId,
  "text/csv"
);

// Use in code execution
const result = await executeCodeWithOpenAI(
  client,
  "Plot this data as a bar chart",
  { containerId, fileIds: [uploaded.file_id] }
);
```

### Multiple Files

```typescript
// Create container
const containerId = await createContainer();

// Upload multiple files to the same container
const file1 = await uploadFile("./sales_2023.csv", containerId);
const file2 = await uploadFile("./sales_2024.csv", containerId);

// Reference all files in execution
const result = await executeCodeWithOpenAI(
  client,
  "Compare the two sales datasets and create a visualization",
  { containerId, fileIds: [file1.file_id, file2.file_id] }
);
```

### File Access in Code Interpreter

Uploaded files are available at `/mnt/data/` in the code interpreter environment:

```python
# In the code interpreter, files are at:
import pandas as pd
df = pd.read_csv('/mnt/data/data.csv')
```

### Important Notes

1. **Container Required**: Unlike Claude, OpenAI requires you to create a container first before uploading files.
2. **Container Cost**: Each container session costs $0.03.
3. **Container Expiration**: Containers expire after a period of inactivity (configurable, default 1 day).
4. **File Location**: Uploaded files appear at `/mnt/data/` in the code interpreter.

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

---

## Streaming Events

During `executeCodeWithOpenAIStreaming()`, the `onEvent` callback receives events in this order:

| Event Type | When | Properties |
|------------|------|------------|
| `tool_start` | Code interpreter begins | `toolName`: "code_interpreter" |
| `code_executing` | Code execution starts | - |
| `code` | Code is being written | `code`: Code chunk |
| `code_complete` | Full code available | `code`: Complete code |
| `tool_end` | Code interpreter completes | `toolName`: "code_interpreter" |
| `text` | Text response streams | `text`: Text chunk |

### Event Timeline

```
1. tool_start       → { toolName: "code_interpreter" }
2. code_executing   → Code execution beginning
3. code             → "import matplotlib..."
4. code             → ".pyplot as plt..."
5. code             → "\nimport numpy..."
6. ...              → (more code deltas)
7. code_complete    → { code: "full code here" }
8. tool_end         → { toolName: "code_interpreter" }
9. text             → "The plot of..."
10. text            → " y = x^2..."
11. ...             → (more text deltas)
```

### Raw API Events

The OpenAI Responses API emits these events (mapped to StreamEvent types):

| API Event | StreamEvent Type |
|-----------|------------------|
| `response.output_item.added` (code_interpreter_call) | `tool_start` |
| `response.code_interpreter_call.in_progress` | `code_executing` |
| `response.code_interpreter_call_code.delta` | `code` |
| `response.code_interpreter_call_code.done` | `code_complete` |
| `response.code_interpreter_call.completed` | `tool_end` |
| `response.output_text.delta` | `text` |
| `response.output_text.annotation.added` | (file captured internally) |
| `response.completed` | (final response captured) |

---

## Frontend Integration

### Next.js API Route

Create an API route that streams events to the frontend using Server-Sent Events (SSE).

```typescript
// app/api/openai/route.ts
import { NextRequest } from "next/server";
import {
  createOpenAIClient,
  executeCodeWithOpenAIStreaming,
  downloadGeneratedFiles,
  StreamEvent,
} from "@/lib/openai-client";

export async function POST(req: NextRequest) {
  const { prompt } = await req.json();
  const client = createOpenAIClient();

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
      const result = await executeCodeWithOpenAIStreaming(
        client,
        prompt,
        async (event: StreamEvent) => {
          await sendEvent("stream", event);
        }
      );

      // Send code artifacts
      for (const artifact of result.codeArtifacts) {
        await sendEvent("code_artifact", artifact);
      }

      // Download and send file URLs
      if (result.files.length > 0) {
        const paths = await downloadGeneratedFiles(
          result.files,
          "./public/generated"
        );
        for (const path of paths) {
          await sendEvent("file", { url: path.replace("./public", "") });
        }
      }

      // Send completion with full result
      await sendEvent("done", {
        text: result.text,
        containerId: result.containerId,
        responseId: result.responseId,
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
// components/OpenAIChat.tsx
"use client";

import { useState, useCallback } from "react";

interface CodeArtifact {
  id: string;
  code: string;
  status: string;
}

interface ChatState {
  streamingText: string;
  streamingCode: string;
  codeArtifacts: CodeArtifact[];
  generatedFiles: string[];
  isExecutingCode: boolean;
  isLoading: boolean;
  error: string | null;
}

export function OpenAIChat() {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<ChatState>({
    streamingText: "",
    streamingCode: "",
    codeArtifacts: [],
    generatedFiles: [],
    isExecutingCode: false,
    isLoading: false,
    error: null,
  });

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim()) return;

    setState((prev) => ({
      ...prev,
      streamingText: "",
      streamingCode: "",
      codeArtifacts: [],
      generatedFiles: [],
      isLoading: true,
      error: null,
    }));

    try {
      const response = await fetch("/api/openai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
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
  }, [prompt]);

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
            streamingCode: "",
          }));
        } else if (data.type === "code") {
          setState((prev) => ({
            ...prev,
            streamingCode: prev.streamingCode + (data.code || ""),
          }));
        } else if (data.type === "tool_end") {
          setState((prev) => ({
            ...prev,
            isExecutingCode: false,
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
    <div className="openai-chat">
      {/* Input */}
      <div className="input-section">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Ask OpenAI to write and execute code..."
          disabled={state.isLoading}
        />
        <button onClick={handleSubmit} disabled={state.isLoading}>
          {state.isLoading ? "Processing..." : "Send"}
        </button>
      </div>

      {/* Code Execution (live) */}
      {state.isExecutingCode && state.streamingCode && (
        <div className="code-streaming">
          <div className="code-header">Executing Code...</div>
          <pre>
            <code>{state.streamingCode}</code>
          </pre>
        </div>
      )}

      {/* Code Artifacts (final) */}
      {state.codeArtifacts.map((artifact, i) => (
        <div key={i} className="code-artifact">
          <div className="artifact-header">
            Python Code (ID: {artifact.id.slice(-8)})
          </div>
          <pre>
            <code>{artifact.code}</code>
          </pre>
        </div>
      ))}

      {/* Text Response */}
      {state.streamingText && (
        <div className="text-response">{state.streamingText}</div>
      )}

      {/* Generated Files (Images) */}
      {state.generatedFiles.map((url, i) => (
        <div key={i} className="generated-file">
          <img src={url} alt={`Generated file ${i + 1}`} />
        </div>
      ))}

      {/* Error Display */}
      {state.error && <div className="error">Error: {state.error}</div>}
    </div>
  );
}
```

### Server-Sent Events (SSE)

The frontend receives events in this format:

```
event: stream
data: {"type":"tool_start","toolName":"code_interpreter"}

event: stream
data: {"type":"code","code":"import matplotlib"}

event: stream
data: {"type":"code","code":".pyplot as plt"}

event: stream
data: {"type":"code_complete","code":"import matplotlib.pyplot as plt\n..."}

event: stream
data: {"type":"tool_end","toolName":"code_interpreter"}

event: stream
data: {"type":"text","text":"The plot"}

event: stream
data: {"type":"text","text":" has been saved."}

event: code_artifact
data: {"id":"ci_abc123","code":"import matplotlib...","status":"completed"}

event: file
data: {"url":"/generated/plot.png"}

event: done
data: {"text":"The plot has been saved.","responseId":"resp_xxx","fileCount":1}
```

---

## Container Sessions

OpenAI's code interpreter runs in containers. The container ID is returned for reference but unlike Claude, OpenAI doesn't currently support reusing containers across requests through the Responses API.

```typescript
const result = await executeCodeWithOpenAIStreaming(
  client,
  "Create a plot",
  handleEvent
);

console.log(result.containerId); // "cntr_abc123..."
// Note: Container reuse not supported in Responses API
```

---

## File Downloads

### Server-Side Download

```typescript
const paths = await downloadGeneratedFiles(result.files, "./output");
// Returns: ["./output/plot.png", "./output/data.csv"]
```

### Download URL Structure

OpenAI container files are downloaded from:

```
https://api.openai.com/v1/containers/{container_id}/files/{file_id}
```

### Manual Download

```typescript
async function downloadFile(
  containerId: string,
  fileId: string
): Promise<Buffer> {
  const response = await fetch(
    `https://api.openai.com/v1/containers/${containerId}/files/${fileId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Download failed: ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
```

### Frontend File Proxy

```typescript
// app/api/files/[containerId]/[fileId]/route.ts
export async function GET(
  req: NextRequest,
  { params }: { params: { containerId: string; fileId: string } }
) {
  const response = await fetch(
    `https://api.openai.com/v1/containers/${params.containerId}/files/${params.fileId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    }
  );

  return new Response(response.body, {
    headers: {
      "Content-Type":
        response.headers.get("Content-Type") || "application/octet-stream",
    },
  });
}
```

---

## Error Handling

```typescript
try {
  const result = await executeCodeWithOpenAIStreaming(
    client,
    prompt,
    handleEvent
  );
} catch (error) {
  if (error instanceof OpenAI.APIError) {
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
        console.error("OpenAI server error");
        break;
    }
  }
}
```

---

## Common Pitfalls

### 1. Text Delta Field Name

In streaming, text content is in `event.delta`, not `event.text`:

```typescript
// Wrong
case "response.output_text.delta":
  if (event.text) { ... }  // undefined!

// Correct
case "response.output_text.delta":
  if (event.delta) { ... }  // works!
```

### 2. Code Delta Field Name

Similarly, code content is in `event.delta`:

```typescript
// Correct
case "response.code_interpreter_call_code.delta":
  const codeDelta = event.delta || event.code || "";
```

### 3. File Annotations in Streaming

Files are announced via `response.output_text.annotation.added` events, not in the final response only. The module captures these during streaming.

### 4. Multiple Files May Be Generated

The code interpreter can generate multiple files, including:
- The requested file (e.g., `plot.png`)
- Additional files with auto-generated names

Both are included in `result.files`.

### 5. Code Interpreter Cost

Code Interpreter costs $0.03 per container session. Each new request creates a new container.

---

## Comparison with Claude API

| Feature | OpenAI | Claude |
|---------|--------|--------|
| API | Responses API | Messages API (beta) |
| Tool Name | `code_interpreter` | `code_execution_20250825` |
| Container Reuse | Not supported | Supported via `containerId` |
| Code Artifacts | In `code_interpreter_call.code` | In `text_editor_code_execution` tool input |
| File Location | `container_file_citation` annotations | `bash_code_execution_output` in tool results |
| Text Delta Field | `event.delta` | `delta.text` |
| Cost | $0.03/container | Token-based |

### Key Differences in Implementation

1. **Code Artifacts**:
   - OpenAI: Available directly in `code_interpreter_call` output item
   - Claude: Must accumulate `input_json_delta` events and parse JSON

2. **File Discovery**:
   - OpenAI: Via `container_file_citation` annotations
   - Claude: Via `bash_code_execution_output` items

3. **Streaming Text**:
   - OpenAI: `event.delta` in `response.output_text.delta`
   - Claude: `delta.text` in `content_block_delta`

---

## Complete Example

See `src/test/test-openai.ts` for a complete working example that:

1. Sends a prompt requesting a mathematical plot
2. Streams the response in real-time
3. Extracts code artifacts (Python source)
4. Downloads generated images
5. Displays all results

Run with:

```bash
npm run test:openai
```

---

## Sources

- [OpenAI Streaming Events](https://platform.openai.com/docs/api-reference/responses-streaming/response)
- [OpenAI Streaming Responses Guide](https://platform.openai.com/docs/guides/streaming-responses)
- [OpenAI Code Interpreter](https://platform.openai.com/docs/guides/tools-code-interpreter)
