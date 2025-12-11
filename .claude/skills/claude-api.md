# Claude API Skill Document

## Overview

This document covers the Anthropic Claude API for building AI applications with code execution, web search, web fetch, and streaming capabilities.

**API Base URL:** `https://api.anthropic.com/v1/messages`
**Docs:** https://platform.claude.com/docs

## Authentication

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});
```

## Basic Message Request

```typescript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [
    { role: "user", content: "Hello, Claude!" }
  ],
});
```

---

## Code Execution Tool

The code execution tool allows Claude to run Bash commands and manipulate files in a secure sandboxed environment.

### Beta Header Required

```
anthropic-beta: code-execution-2025-08-25
```

### Available Models

- Claude Opus 4.5 (`claude-opus-4-5-20251101`)
- Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- Claude Sonnet 4 (`claude-sonnet-4-20250514`)
- Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- Claude Haiku 3.5 (`claude-3-5-haiku-latest`)

### Tool Definition

```json
{
  "type": "code_execution_20250825",
  "name": "code_execution"
}
```

### TypeScript Example

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const response = await anthropic.beta.messages.create({
  model: "claude-sonnet-4-5",
  betas: ["code-execution-2025-08-25"],
  max_tokens: 4096,
  messages: [
    {
      role: "user",
      content: "Calculate the mean and standard deviation of [1, 2, 3, 4, 5]"
    }
  ],
  tools: [{
    type: "code_execution_20250825",
    name: "code_execution"
  }]
});
```

### Sub-Tools

When code execution is enabled, Claude has access to:
- **bash_code_execution**: Run shell commands
- **text_editor_code_execution**: View, create, and edit files

### Response Format - Bash Command

```json
{
  "type": "server_tool_use",
  "id": "srvtoolu_01B3C4D5E6F7G8H9I0J1K2L3",
  "name": "bash_code_execution",
  "input": {
    "command": "python3 -c 'print(sum([1,2,3,4,5])/5)'"
  }
}
```

```json
{
  "type": "bash_code_execution_tool_result",
  "tool_use_id": "srvtoolu_01B3C4D5E6F7G8H9I0J1K2L3",
  "content": {
    "type": "bash_code_execution_result",
    "stdout": "3.0\n",
    "stderr": "",
    "return_code": 0
  }
}
```

### Response Format - With Generated Files

When code creates files (e.g., plots), they appear in the `content` array:

```json
{
  "type": "bash_code_execution_tool_result",
  "tool_use_id": "srvtoolu_013fDnYeNea2n7Yz4TKfohzR",
  "content": {
    "type": "bash_code_execution_result",
    "stdout": "",
    "stderr": "",
    "return_code": 0,
    "content": [
      {
        "type": "bash_code_execution_output",
        "file_id": "file_011CW1XeZz3b6dX2uruGEeNH"
      }
    ]
  }
}
```

**Important**: Files are referenced by `file_id` only - the actual content stays in the container and must be downloaded separately via the Files API.

### Response Format - File Operation

```json
{
  "type": "server_tool_use",
  "id": "srvtoolu_01C4D5E6F7G8H9I0J1K2L3M4",
  "name": "text_editor_code_execution",
  "input": {
    "command": "create",
    "path": "output.py",
    "file_text": "print('Hello World')"
  }
}
```

```json
{
  "type": "text_editor_code_execution_tool_result",
  "tool_use_id": "srvtoolu_01C4D5E6F7G8H9I0J1K2L3M4",
  "content": {
    "type": "text_editor_code_execution_result",
    "is_file_update": false
  }
}
```

### Retrieving Generated Files

Files generated during code execution are downloaded via the Files API REST endpoint:

```typescript
// Both beta headers required
const response = await anthropic.beta.messages.create({
  model: "claude-sonnet-4-5",
  betas: ["code-execution-2025-08-25", "files-api-2025-04-14"],
  max_tokens: 4096,
  messages: [{
    role: "user",
    content: "Create a matplotlib visualization and save it as output.png"
  }],
  tools: [{
    type: "code_execution_20250825",
    name: "code_execution"
  }]
});

// Extract file IDs from the response
function extractFileIds(response: any): string[] {
  const fileIds: string[] = [];
  for (const block of response.content) {
    if (block.type === "bash_code_execution_tool_result") {
      const result = block.content;
      if (result?.type === "bash_code_execution_result" && Array.isArray(result.content)) {
        for (const item of result.content) {
          // Files have type "bash_code_execution_output"
          if (item.type === "bash_code_execution_output" && item.file_id) {
            fileIds.push(item.file_id);
          }
        }
      }
    }
  }
  return fileIds;
}

// Download files via REST API
const fileIds = extractFileIds(response);
for (const fileId of fileIds) {
  const url = `https://api.anthropic.com/v1/files/${fileId}/content`;

  const downloadResponse = await fetch(url, {
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "files-api-2025-04-14",
    },
  });

  if (downloadResponse.ok) {
    const buffer = Buffer.from(await downloadResponse.arrayBuffer());
    const filename = `downloaded_${fileId.slice(-8)}.png`;
    writeFileSync(filename, buffer);
    console.log(`Downloaded: ${filename} (${buffer.length} bytes)`);
  }
}
```

### Container Reuse

Containers persist for 30 days and can be reused:

```typescript
// First request
const response1 = await anthropic.beta.messages.create({
  model: "claude-sonnet-4-5",
  betas: ["code-execution-2025-08-25"],
  max_tokens: 4096,
  messages: [{
    role: "user",
    content: "Write a random number to /tmp/number.txt"
  }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});

// Extract container ID
const containerId = response1.container.id;

// Second request - reuse container
const response2 = await anthropic.beta.messages.create({
  container: containerId,  // Reuse the same container
  model: "claude-sonnet-4-5",
  betas: ["code-execution-2025-08-25"],
  max_tokens: 4096,
  messages: [{
    role: "user",
    content: "Read the number from /tmp/number.txt"
  }],
  tools: [{ type: "code_execution_20250825", name: "code_execution" }]
});
```

### Container Environment

- **Python**: 3.11.12
- **Memory**: 5GiB RAM
- **Disk**: 5GiB workspace
- **CPU**: 1 CPU
- **Internet**: Disabled (security)
- **Expiration**: 30 days after creation

### Pre-installed Libraries

- **Data Science**: pandas, numpy, scipy, scikit-learn, statsmodels
- **Visualization**: matplotlib, seaborn
- **Math**: sympy, mpmath
- **File Processing**: openpyxl, xlsxwriter, pillow, pypdf

---

## Web Search Tool

The web search tool gives Claude access to real-time web content with automatic citations.

### Tool Definition

```json
{
  "type": "web_search_20250305",
  "name": "web_search",
  "max_uses": 5,
  "allowed_domains": ["example.com"],
  "blocked_domains": ["untrusted.com"],
  "user_location": {
    "type": "approximate",
    "city": "San Francisco",
    "region": "California",
    "country": "US",
    "timezone": "America/Los_Angeles"
  }
}
```

### TypeScript Example

```typescript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{
    role: "user",
    content: "What's the weather in NYC today?"
  }],
  tools: [{
    type: "web_search_20250305",
    name: "web_search",
    max_uses: 5
  }]
});
```

### Response Format

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "text",
      "text": "I'll search for the current weather."
    },
    {
      "type": "server_tool_use",
      "id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
      "name": "web_search",
      "input": {
        "query": "weather NYC today"
      }
    },
    {
      "type": "web_search_tool_result",
      "tool_use_id": "srvtoolu_01WYG3ziw53XMcoyKL4XcZmE",
      "content": [
        {
          "type": "web_search_result",
          "url": "https://weather.com/...",
          "title": "NYC Weather",
          "encrypted_content": "Ev0DCioIAxgCIiQ3...",
          "page_age": "December 11, 2025"
        }
      ]
    },
    {
      "text": "The current weather in NYC is ",
      "type": "text"
    },
    {
      "text": "partly cloudy with a temperature of 45°F",
      "type": "text",
      "citations": [
        {
          "type": "web_search_result_location",
          "url": "https://weather.com/...",
          "title": "NYC Weather",
          "encrypted_index": "Eo8BCioIAhgBIiQyY...",
          "cited_text": "Currently partly cloudy, 45°F..."
        }
      ]
    }
  ]
}
```

### Pricing

$10 per 1,000 searches + standard token costs

---

## Web Fetch Tool

The web fetch tool retrieves full content from specified URLs and PDFs.

### Beta Header Required

```
anthropic-beta: web-fetch-2025-09-10
```

### Tool Definition

```json
{
  "type": "web_fetch_20250910",
  "name": "web_fetch",
  "max_uses": 10,
  "allowed_domains": ["example.com"],
  "citations": {
    "enabled": true
  },
  "max_content_tokens": 100000
}
```

### TypeScript Example

```typescript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{
    role: "user",
    content: "Please analyze the content at https://example.com/article"
  }],
  tools: [{
    type: "web_fetch_20250910",
    name: "web_fetch",
    max_uses: 5
  }],
  headers: {
    "anthropic-beta": "web-fetch-2025-09-10"
  }
});
```

### Response Format

```json
{
  "type": "web_fetch_tool_result",
  "tool_use_id": "srvtoolu_01234567890abcdef",
  "content": {
    "type": "web_fetch_result",
    "url": "https://example.com/article",
    "content": {
      "type": "document",
      "source": {
        "type": "text",
        "media_type": "text/plain",
        "data": "Full text content of the article..."
      },
      "title": "Article Title",
      "citations": {"enabled": true}
    },
    "retrieved_at": "2025-08-25T10:30:00Z"
  }
}
```

### PDF Response

```json
{
  "type": "web_fetch_tool_result",
  "tool_use_id": "srvtoolu_02",
  "content": {
    "type": "web_fetch_result",
    "url": "https://example.com/paper.pdf",
    "content": {
      "type": "document",
      "source": {
        "type": "base64",
        "media_type": "application/pdf",
        "data": "JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmo..."
      },
      "citations": {"enabled": true}
    },
    "retrieved_at": "2025-08-25T10:30:02Z"
  }
}
```

### Pricing

No additional charges - only standard token costs for fetched content.

---

## Streaming

### Basic Streaming

```typescript
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});

stream.on("text", (text) => {
  console.log(text);
});

await stream.finalMessage();
```

### Streaming with Code Execution

```typescript
const stream = await anthropic.beta.messages.stream({
  model: "claude-sonnet-4-5",
  betas: ["code-execution-2025-08-25"],
  max_tokens: 4096,
  messages: [{
    role: "user",
    content: "Create a plot of sin(x) from 0 to 2π"
  }],
  tools: [{
    type: "code_execution_20250825",
    name: "code_execution"
  }]
});

for await (const event of stream) {
  if (event.type === "content_block_delta") {
    if (event.delta.type === "text_delta") {
      process.stdout.write(event.delta.text);
    }
  }
}
```

### CRITICAL: Extracting Code Artifacts in Streaming Mode

**Important Gotcha**: In streaming mode, `stream.finalMessage()` returns `server_tool_use` blocks with **empty `input: {}`**. The tool input JSON is streamed via `input_json_delta` events and must be accumulated manually.

```typescript
// Track tool inputs during streaming
const toolInputs = new Map<string, { name: string; input: string }>();
let currentToolId: string | undefined;
let currentToolName: string | undefined;
let currentToolInput = "";

for await (const event of stream) {
  if (event.type === "content_block_start") {
    const block = event.content_block;
    if (block?.type === "server_tool_use") {
      currentToolId = block.id;
      currentToolName = block.name;
      currentToolInput = "";
    }
  } else if (event.type === "content_block_delta") {
    const delta = event.delta;
    if (delta?.type === "input_json_delta") {
      // ACCUMULATE the JSON - this is the key!
      currentToolInput += delta.partial_json || "";
    }
  } else if (event.type === "content_block_stop") {
    if (currentToolId && currentToolName) {
      // Save accumulated input
      toolInputs.set(currentToolId, {
        name: currentToolName,
        input: currentToolInput,
      });
    }
    currentToolId = undefined;
    currentToolName = undefined;
    currentToolInput = "";
  }
}

// After streaming, parse accumulated tool inputs for code artifacts
const codeArtifacts = [];
for (const [id, tool] of toolInputs) {
  if (tool.name === "text_editor_code_execution" && tool.input) {
    try {
      const input = JSON.parse(tool.input);
      if (input?.command === "create" && input?.path && input?.file_text) {
        codeArtifacts.push({
          path: input.path,
          content: input.file_text,
        });
      }
    } catch (e) {
      // JSON parse failed
    }
  }
}
```

**What you get from code execution:**
1. `result.text` - Streamed text response
2. `result.codeArtifacts` - Array of code files (path + content) - must be accumulated from stream
3. `result.files` - Array of generated files (file_id for download via Files API)

### SSE Event Types

| Event | Description |
|-------|-------------|
| `message_start` | Initial message object with empty content |
| `content_block_start` | Beginning of a content block |
| `content_block_delta` | Incremental updates (text_delta, input_json_delta, thinking_delta) |
| `content_block_stop` | End of a content block |
| `message_delta` | Final message updates with stop_reason |
| `message_stop` | End of stream |
| `ping` | Keep-alive event |

### Event Flow Example

```
event: message_start
data: {"type": "message_start", "message": {"id": "msg_abc", ...}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "!"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn"}}

event: message_stop
data: {"type": "message_stop"}
```

### Streaming with Server Tools (Web Search, Code Execution)

```
event: content_block_start
data: {"type": "content_block_start", "index": 1, "content_block": {"type": "server_tool_use", "id": "srvtoolu_xyz", "name": "web_search"}}

event: content_block_delta
data: {"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": "{\"query\":"}}

// Pause while tool executes

event: content_block_start
data: {"type": "content_block_start", "index": 2, "content_block": {"type": "web_search_tool_result", ...}}
```

### Fine-Grained Tool Streaming

Beta feature for streaming tool parameters without buffering:

```typescript
const response = await anthropic.beta.messages.stream({
  model: "claude-sonnet-4-5",
  max_tokens: 65536,
  tools: [/* your tools */],
  messages: [/* your messages */],
  betas: ["fine-grained-tool-streaming-2025-05-14"]
});
```

---

## Error Handling

### Error Codes

| Error Code | Description |
|------------|-------------|
| `unavailable` | Tool temporarily unavailable |
| `execution_time_exceeded` | Maximum execution time limit reached |
| `container_expired` | Container no longer available |
| `invalid_tool_input` | Invalid parameters |
| `too_many_requests` | Rate limit exceeded |
| `file_not_found` | File doesn't exist (text_editor) |
| `string_not_found` | old_str not found (str_replace) |
| `max_uses_exceeded` | Maximum tool uses exceeded |

### Example Error Response

```json
{
  "type": "bash_code_execution_tool_result",
  "tool_use_id": "srvtoolu_01VfmxgZ46TiHbmXgy928hQR",
  "content": {
    "type": "bash_code_execution_tool_result_error",
    "error_code": "execution_time_exceeded"
  }
}
```

---

## Common Pitfalls and Solutions

### 1. Empty `input` in Streaming Mode

**Problem**: When using `stream.finalMessage()`, the `server_tool_use` blocks have `input: {}` instead of the actual tool parameters.

**Solution**: Accumulate `input_json_delta` events during streaming. See "CRITICAL: Extracting Code Artifacts in Streaming Mode" section above.

### 2. File Download Fails with SDK Methods

**Problem**: `anthropic.beta.files.retrieveMetadata()` or `anthropic.beta.files.download()` may not work or throw errors.

**Solution**: Use the REST API directly:
```typescript
const url = `https://api.anthropic.com/v1/files/${fileId}/content`;
const response = await fetch(url, {
  headers: {
    "x-api-key": process.env.ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": "files-api-2025-04-14",
  },
});
```

### 3. Generated Files Have No Filename

**Problem**: The `bash_code_execution_output` object only contains `file_id` and `type` - no filename.

**Solution**: Generate a filename from the file_id or use a default:
```typescript
const filename = item.filename || `file_${item.file_id.slice(-8)}.png`;
```

### 4. Files Not Being Extracted

**Problem**: Code looks for wrong type in response.

**Solution**: Generated files have `type: "bash_code_execution_output"` (not just `file_id` at top level):
```typescript
// Correct structure:
result.content = [
  { type: "bash_code_execution_output", file_id: "file_xxx" }
]
```

### 5. Model Name Not Found

**Problem**: `404 not_found_error` when using model name.

**Solution**: Use full model ID with date suffix:
- ❌ `claude-sonnet-4-5`
- ✅ `claude-sonnet-4-5-20250929`

---

## Pricing

| Feature | Cost |
|---------|------|
| Code Execution | $0.05/hour per container (first 50 hours/day free) |
| Web Search | $10 per 1,000 searches |
| Web Fetch | No additional cost (token-based) |
| Input Tokens | Model-dependent |
| Output Tokens | Model-dependent |

---

## Complete Example: Plotting with Code Execution (Non-Streaming)

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "fs";

const anthropic = new Anthropic();

async function plotFunction() {
  const response = await anthropic.beta.messages.create({
    model: "claude-sonnet-4-5-20250929",
    betas: ["code-execution-2025-08-25", "files-api-2025-04-14"],
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `Plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.
                Save the plot as function_plot.png`
    }],
    tools: [{
      type: "code_execution_20250825",
      name: "code_execution"
    }]
  });

  // Extract text response and code artifacts
  for (const block of response.content) {
    if (block.type === "text") {
      console.log(block.text);
    } else if (block.type === "server_tool_use") {
      // In non-streaming mode, input is populated
      if (block.name === "text_editor_code_execution") {
        const input = block.input;
        if (input?.command === "create") {
          console.log(`\n--- Code: ${input.path} ---`);
          console.log(input.file_text);
        }
      }
    }
  }

  // Extract and download generated files via REST API
  for (const block of response.content) {
    if (block.type === "bash_code_execution_tool_result") {
      const result = block.content;
      if (result?.type === "bash_code_execution_result" && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === "bash_code_execution_output" && item.file_id) {
            // Download via REST API
            const url = `https://api.anthropic.com/v1/files/${item.file_id}/content`;
            const downloadResponse = await fetch(url, {
              headers: {
                "x-api-key": process.env.ANTHROPIC_API_KEY!,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "files-api-2025-04-14",
              },
            });

            if (downloadResponse.ok) {
              const buffer = Buffer.from(await downloadResponse.arrayBuffer());
              const filename = `downloaded_${item.file_id.slice(-8)}.png`;
              writeFileSync(filename, buffer);
              console.log(`Downloaded: ${filename} (${buffer.length} bytes)`);
            }
          }
        }
      }
    }
  }
}

plotFunction();
```

## Complete Example: Streaming with Code Artifacts

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync } from "fs";

const anthropic = new Anthropic();

interface CodeArtifact {
  path: string;
  content: string;
}

async function plotFunctionStreaming() {
  const stream = await anthropic.beta.messages.stream({
    model: "claude-sonnet-4-5-20250929",
    betas: ["code-execution-2025-08-25", "files-api-2025-04-14"],
    max_tokens: 8192,
    messages: [{
      role: "user",
      content: `Plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.`
    }],
    tools: [{
      type: "code_execution_20250825",
      name: "code_execution"
    }]
  });

  // Accumulate tool inputs during streaming (CRITICAL!)
  const toolInputs = new Map<string, { name: string; input: string }>();
  let currentToolId: string | undefined;
  let currentToolName: string | undefined;
  let currentToolInput = "";

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      const block = (event as any).content_block;
      if (block?.type === "server_tool_use") {
        currentToolId = block.id;
        currentToolName = block.name;
        currentToolInput = "";
        console.log(`\n[${block.name}]`);
      }
    } else if (event.type === "content_block_delta") {
      const delta = (event as any).delta;
      if (delta?.type === "text_delta") {
        process.stdout.write(delta.text);
      } else if (delta?.type === "input_json_delta") {
        currentToolInput += delta.partial_json || "";
      }
    } else if (event.type === "content_block_stop") {
      if (currentToolId && currentToolName) {
        toolInputs.set(currentToolId, { name: currentToolName, input: currentToolInput });
      }
      currentToolId = undefined;
      currentToolName = undefined;
      currentToolInput = "";
    }
  }

  // Parse code artifacts from accumulated tool inputs
  const codeArtifacts: CodeArtifact[] = [];
  for (const [id, tool] of toolInputs) {
    if (tool.name === "text_editor_code_execution" && tool.input) {
      try {
        const input = JSON.parse(tool.input);
        if (input?.command === "create" && input?.path && input?.file_text) {
          codeArtifacts.push({ path: input.path, content: input.file_text });
        }
      } catch (e) { /* ignore parse errors */ }
    }
  }

  console.log(`\n\nCode artifacts: ${codeArtifacts.length}`);
  for (const artifact of codeArtifacts) {
    console.log(`\n--- ${artifact.path} ---`);
    console.log(artifact.content);
  }

  // Get final message for file IDs
  const finalMessage = await stream.finalMessage();

  // Download generated files
  for (const block of finalMessage.content) {
    if (block.type === "bash_code_execution_tool_result") {
      const result = (block as any).content;
      if (result?.type === "bash_code_execution_result" && Array.isArray(result.content)) {
        for (const item of result.content) {
          if (item.type === "bash_code_execution_output" && item.file_id) {
            const url = `https://api.anthropic.com/v1/files/${item.file_id}/content`;
            const response = await fetch(url, {
              headers: {
                "x-api-key": process.env.ANTHROPIC_API_KEY!,
                "anthropic-version": "2023-06-01",
                "anthropic-beta": "files-api-2025-04-14",
              },
            });

            if (response.ok) {
              const buffer = Buffer.from(await response.arrayBuffer());
              const filename = `plot_${item.file_id.slice(-8)}.png`;
              writeFileSync(filename, buffer);
              console.log(`Downloaded: ${filename} (${buffer.length} bytes)`);
            }
          }
        }
      }
    }
  }
}

plotFunctionStreaming();
```

## References

- [Code Execution Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/code-execution-tool)
- [Web Search Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)
- [Web Fetch Tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)
- [Streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Fine-grained Tool Streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)
- [Files API](https://platform.claude.com/docs/en/build-with-claude/files)
