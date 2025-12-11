# OpenAI API Skill Document

## Overview

This document covers the OpenAI Responses API for building AI applications with code interpreter, web search, and streaming capabilities.

**API Base URL:** `https://api.openai.com/v1/responses`
**Docs:** https://platform.openai.com/docs

## Authentication

```typescript
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

## Responses API Overview

The Responses API is OpenAI's newer API primitive that combines:
- Simplicity of Chat Completions
- Tool-use capabilities of Assistants API
- Built-in tools (web search, file search, code interpreter)
- Stateful conversations with automatic state management

---

## Code Interpreter Tool

The Code Interpreter tool allows models to write and run Python code in a sandboxed container environment.

### Tool Definition

```json
{
  "type": "code_interpreter",
  "container": {
    "type": "auto"
  }
}
```

### TypeScript Example

```typescript
import OpenAI from "openai";

const openai = new OpenAI();

const response = await openai.responses.create({
  model: "gpt-4o",
  input: "Calculate the mean and standard deviation of [1, 2, 3, 4, 5]",
  tools: [{
    type: "code_interpreter",
    container: {
      type: "auto"
    }
  }]
});

console.log(response.output_text);
```

### Container Configuration

```typescript
const response = await openai.responses.create({
  model: "gpt-4o",
  input: "Create a plot of sin(x)",
  tools: [{
    type: "code_interpreter",
    container: {
      type: "auto",
      memory_limit: "4g",
      file_ids: ["file-abc123", "file-def456"]  // Pre-load files
    }
  }]
});
```

### Container Properties

- **Type**: `auto` (automatically creates or reuses containers)
- **Memory Limit**: Configurable (e.g., "4g")
- **File IDs**: Pre-load files into container
- **Expiration**: 20 minutes of inactivity
- **Pricing**: $0.03 per container

### Response Format

The code interpreter response includes annotations pointing to generated files:

```json
{
  "id": "resp_abc123",
  "object": "response",
  "output": [
    {
      "type": "message",
      "role": "assistant",
      "content": [
        {
          "type": "text",
          "text": "I've created the plot. Here it is:",
          "annotations": [
            {
              "type": "container_file_citation",
              "container_id": "cntr_682d513bb0c48191b10bd4f8b0b3312200e64562acc2e0af",
              "file_id": "cfile_682d514b2e00819184b9b07e13557f82",
              "filename": "plot.png"
            }
          ]
        }
      ]
    }
  ],
  "output_text": "I've created the plot. Here it is:"
}
```

### Retrieving Generated Files

```typescript
// Extract container_file_citation annotations from response
function extractFileAnnotations(response: any) {
  const annotations = [];
  for (const item of response.output) {
    if (item.type === "message") {
      for (const content of item.content) {
        if (content.annotations) {
          for (const annotation of content.annotations) {
            if (annotation.type === "container_file_citation") {
              annotations.push(annotation);
            }
          }
        }
      }
    }
  }
  return annotations;
}

// Download files from container
async function downloadFiles(annotations: any[]) {
  for (const annotation of annotations) {
    const url = `https://api.openai.com/v1/containers/${annotation.container_id}/files/${annotation.file_id}`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
      }
    });

    const buffer = await response.arrayBuffer();
    writeFileSync(annotation.filename, Buffer.from(buffer));
    console.log(`Downloaded: ${annotation.filename}`);
  }
}
```

### Code Interpreter Streaming Events

| Event | Description |
|-------|-------------|
| `response.code_interpreter_call.in_progress` | Code interpreter is actively running |
| `response.code_interpreter_call_code.delta` | Partial code snippet being streamed |
| `response.code_interpreter_call_code.done` | Final code snippet completed |
| `response.code_interpreter_call.interpreting` | Code is being interpreted |
| `response.code_interpreter_call.completed` | Code interpreter call finished |

### Streaming Example with Code Interpreter

```typescript
const stream = await openai.responses.create({
  model: "gpt-4o",
  input: "Create a plot of x^2",
  tools: [{
    type: "code_interpreter",
    container: { type: "auto" }
  }],
  stream: true
});

for await (const event of stream) {
  if (event.type === "response.code_interpreter_call_code.delta") {
    process.stdout.write(event.code);
  }
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.text);
  }
}
```

---

## Web Search Tool

The web search tool allows models to access up-to-date information from the internet with sourced citations.

### Tool Definition

```json
{
  "type": "web_search",
  "filters": {
    "urls": ["example.com", "docs.example.com"]
  }
}
```

### TypeScript Example

```typescript
const response = await openai.responses.create({
  model: "gpt-4o",
  input: "What's the latest news about AI?",
  tools: [{
    type: "web_search"
  }]
});

console.log(response.output_text);

// Access sources
for (const item of response.output) {
  if (item.sources) {
    console.log("Sources:", item.sources);
  }
}
```

### Search Types

1. **Non-reasoning web search**: Quick lookups, model passes along search tool's responses
2. **Agentic search with reasoning models**: Model actively manages search process, can perform multiple searches

### Domain Filtering

```typescript
const response = await openai.responses.create({
  model: "gpt-4o",
  input: "Search for TypeScript documentation",
  tools: [{
    type: "web_search",
    filters: {
      urls: ["typescriptlang.org", "devblogs.microsoft.com"]  // Up to 100 URLs
    }
  }]
});
```

### Accessing Sources

```typescript
// Sources contain all URLs consulted
const sources = response.output[0].sources;
for (const source of sources) {
  console.log(`Title: ${source.title}`);
  console.log(`URL: ${source.url}`);
}

// Citations show inline references (subset of sources)
for (const item of response.output) {
  if (item.content) {
    for (const content of item.content) {
      if (content.citations) {
        console.log("Citations:", content.citations);
      }
    }
  }
}
```

---

## Streaming

### Basic Streaming

```typescript
const stream = await openai.responses.create({
  model: "gpt-4o",
  input: "Hello, tell me a story",
  stream: true
});

for await (const event of stream) {
  if (event.type === "response.output_text.delta") {
    process.stdout.write(event.text);
  }
}
```

### Streaming Event Types

| Event | Description |
|-------|-------------|
| `response.created` | Response object created |
| `response.output_text.delta` | Text content delta |
| `response.output_text.done` | Text content completed |
| `response.code_interpreter_call.in_progress` | Code interpreter running |
| `response.code_interpreter_call_code.delta` | Code snippet delta |
| `response.code_interpreter_call_code.done` | Code snippet done |
| `response.code_interpreter_call.completed` | Code interpreter finished |
| `response.web_search.in_progress` | Web search running |
| `response.web_search.done` | Web search completed |
| `response.done` | Full response completed |

### Streaming with Multiple Tools

```typescript
const stream = await openai.responses.create({
  model: "gpt-4o",
  input: "Search for recent Python trends and create a visualization",
  tools: [
    { type: "web_search" },
    { type: "code_interpreter", container: { type: "auto" } }
  ],
  stream: true
});

for await (const event of stream) {
  switch (event.type) {
    case "response.output_text.delta":
      process.stdout.write(event.text);
      break;
    case "response.web_search.in_progress":
      console.log("\n[Searching web...]");
      break;
    case "response.code_interpreter_call_code.delta":
      console.log("\n[Code]:", event.code);
      break;
    case "response.done":
      console.log("\n[Complete]");
      break;
  }
}
```

### Background Mode

For long-running tasks, use background mode to avoid timeouts:

```typescript
// Start in background
const response = await openai.responses.create({
  model: "o3",  // Reasoning models can take longer
  input: "Complex analysis task...",
  background: true,
  stream: true
});

// Resume streaming later
const resumed = await openai.responses.retrieve(response.id, {
  stream: true,
  sequence_number: lastSequenceNumber  // Track position
});

for await (const event of resumed) {
  // Process events
}
```

---

## Multi-turn Conversations

The Responses API supports stateful conversations:

```typescript
// First message
const response1 = await openai.responses.create({
  model: "gpt-4o",
  input: "My name is Alice"
});

// Continue conversation by referencing previous response
const response2 = await openai.responses.create({
  model: "gpt-4o",
  input: [
    { type: "response", id: response1.id },
    { type: "message", role: "user", content: "What's my name?" }
  ]
});

console.log(response2.output_text);  // "Your name is Alice"
```

### Conversation Branching

```typescript
// Branch from a specific point
const branch = await openai.responses.create({
  model: "gpt-4o",
  input: [
    { type: "response", id: response1.id },
    { type: "message", role: "user", content: "Different question..." }
  ]
});
```

---

## Error Handling

```typescript
try {
  const response = await openai.responses.create({
    model: "gpt-4o",
    input: "Test message",
    tools: [{ type: "code_interpreter", container: { type: "auto" } }]
  });
} catch (error) {
  if (error instanceof OpenAI.APIError) {
    console.log("Status:", error.status);
    console.log("Message:", error.message);

    if (error.code === "rate_limit_exceeded") {
      // Handle rate limiting
    }
    if (error.code === "container_expired") {
      // Container expired after 20 min inactivity
    }
  }
}
```

---

## Pricing

| Feature | Cost |
|---------|------|
| Code Interpreter | $0.03 per container |
| Web Search | Included in API usage |
| GPT-4o Input | $2.50 per 1M tokens |
| GPT-4o Output | $10.00 per 1M tokens |
| GPT-4o-mini Input | $0.15 per 1M tokens |
| GPT-4o-mini Output | $0.60 per 1M tokens |

---

## Complete Example: Plotting with Code Interpreter

```typescript
import OpenAI from "openai";
import { writeFileSync } from "fs";

const openai = new OpenAI();

async function plotFunction() {
  // Create response with code interpreter
  const response = await openai.responses.create({
    model: "gpt-4o",
    input: `Plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.
            Save the plot as function_plot.png`,
    tools: [{
      type: "code_interpreter",
      container: { type: "auto" }
    }]
  });

  // Print text response
  console.log(response.output_text);

  // Extract and download generated files
  for (const item of response.output) {
    if (item.type === "message") {
      for (const content of item.content) {
        if (content.annotations) {
          for (const annotation of content.annotations) {
            if (annotation.type === "container_file_citation") {
              // Download file
              const url = `https://api.openai.com/v1/containers/${annotation.container_id}/files/${annotation.file_id}`;

              const fileResponse = await fetch(url, {
                headers: {
                  "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
                }
              });

              const buffer = await fileResponse.arrayBuffer();
              writeFileSync(annotation.filename, Buffer.from(buffer));
              console.log(`Downloaded: ${annotation.filename}`);
            }
          }
        }
      }
    }
  }
}

plotFunction();
```

### Streaming Version

```typescript
import OpenAI from "openai";
import { writeFileSync } from "fs";

const openai = new OpenAI();

async function plotFunctionStreaming() {
  let fullResponse: any = null;

  const stream = await openai.responses.create({
    model: "gpt-4o",
    input: `Plot the function f(x) = (x-1)^3 - exp(-x) - 5 and compute all its zeros.
            Save the plot as function_plot.png`,
    tools: [{
      type: "code_interpreter",
      container: { type: "auto" }
    }],
    stream: true
  });

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        process.stdout.write(event.text);
        break;
      case "response.code_interpreter_call.in_progress":
        console.log("\n[Executing code...]");
        break;
      case "response.code_interpreter_call_code.delta":
        // Optionally show code being executed
        break;
      case "response.done":
        fullResponse = event.response;
        break;
    }
  }

  // After streaming, download files
  if (fullResponse) {
    for (const item of fullResponse.output) {
      if (item.type === "message") {
        for (const content of item.content) {
          if (content.annotations) {
            for (const annotation of content.annotations) {
              if (annotation.type === "container_file_citation") {
                const url = `https://api.openai.com/v1/containers/${annotation.container_id}/files/${annotation.file_id}`;

                const fileResponse = await fetch(url, {
                  headers: {
                    "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`
                  }
                });

                const buffer = await fileResponse.arrayBuffer();
                writeFileSync(annotation.filename, Buffer.from(buffer));
                console.log(`\nDownloaded: ${annotation.filename}`);
              }
            }
          }
        }
      }
    }
  }
}

plotFunctionStreaming();
```

---

## Comparison: Responses API vs Chat Completions

| Feature | Responses API | Chat Completions |
|---------|---------------|------------------|
| Built-in Tools | Yes (code interpreter, web search) | No (manual tool calling) |
| State Management | Automatic | Manual |
| Conversation History | Reference by ID | Pass full history |
| File Handling | Built-in container | External handling |
| Streaming Events | Semantic (tool-aware) | Text-only |
| Multi-modal | Native support | Limited |

---

## References

- [Responses API](https://platform.openai.com/docs/api-reference/responses)
- [Code Interpreter](https://platform.openai.com/docs/guides/tools-code-interpreter)
- [Web Search](https://platform.openai.com/docs/guides/tools-web-search)
- [Streaming Responses](https://platform.openai.com/docs/guides/streaming-responses)
- [Streaming Events](https://platform.openai.com/docs/api-reference/responses-streaming/response)
- [Migration Guide](https://platform.openai.com/docs/guides/migrate-to-responses)
