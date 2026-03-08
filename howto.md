# How to Use This Repository

This repository provides TypeScript modules for interacting with Claude (Anthropic) and OpenAI APIs, specifically for **code execution** - where the AI can write and run Python code, generate files (like charts), and process uploaded data.

## Overview

### What This Does

Both Claude and OpenAI offer "code execution" or "code interpreter" features:
- You send a prompt like "Create a scatter plot of this data"
- The AI writes Python code
- The code runs in a sandboxed container
- You get back the results (text response + generated files like images)

This repo provides a **unified interface** so you can use either provider with the same code structure.

### Repository Structure

```
├── src/
│   ├── modules/
│   │   ├── anthropic-client.ts   # Claude API wrapper
│   │   ├── openai-client.ts      # OpenAI API wrapper
│   │   ├── types.ts              # Shared TypeScript interfaces
│   │   └── langfuse-client.ts    # Optional observability
│   ├── test/
│   │   ├── test-anthropic.ts           # Basic Claude test
│   │   ├── test-anthropic-debug.ts     # Debug Claude responses
│   │   ├── test-anthropic-file-upload.ts  # Claude file upload test
│   │   ├── test-openai.ts              # Basic OpenAI test
│   │   └── test-openai-file-upload.ts  # OpenAI file upload test
│   └── index.ts                  # Main exports
├── test-data/
│   └── sample.csv                # Test CSV file
├── docs/
│   ├── anthropic-client-module.md
│   └── openai-client-module.md
└── .env                          # Your API keys (create this)
```

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create `.env` File

Create a `.env` file in the root directory:

```env
ANTHROPIC_API_KEY=sk-ant-...your-key-here...
OPENAI_API_KEY=sk-...your-key-here...
```

Get your keys from:
- Anthropic: https://console.anthropic.com/
- OpenAI: https://platform.openai.com/api-keys

### 3. Build the TypeScript

```bash
npm run build
```

## Running Tests

### Basic Code Execution Tests

These tests ask the AI to create a plot of y = x² and save it as an image:

```bash
# Test Claude
npm run test:anthropic

# Test OpenAI
npm run test:openai
```

### File Upload Tests

These tests upload a CSV file, then ask the AI to plot the data:

```bash
# Test Claude file upload
npm run test:anthropic:upload

# Test OpenAI file upload
npm run test:openai:upload
```

### Debug Test (Claude only)

Shows the raw API response structure:

```bash
npm run test:anthropic:debug
```

## What Each Test Does

### `test-anthropic.ts` / `test-openai.ts`

1. Creates an API client
2. Sends a prompt: "Create a plot of y = x² and save it as plot.png"
3. Streams the response (shows text as it's generated)
4. Extracts code artifacts (the Python code that was written)
5. Downloads any generated files (the plot image)

### `test-anthropic-file-upload.ts` / `test-openai-file-upload.ts`

1. Creates an API client
2. **Uploads** `test-data/sample.csv` to the API
3. Sends a prompt referencing the uploaded file
4. The AI reads the CSV and creates a scatter plot
5. Downloads the generated plot
6. Deletes the uploaded file (cleanup)

## Understanding the Code

### Unified Types (`src/modules/types.ts`)

Both modules return the same data structures:

```typescript
// What you get back from code execution
interface CodeExecutionResult {
  text: string;                  // AI's text response
  files: CodeExecutionFile[];    // Generated files (images, etc.)
  codeArtifacts: CodeArtifact[]; // The Python code that was written
  containerId?: string;          // For reusing the same container
}

// A generated file
interface CodeExecutionFile {
  file_id: string;
  filename: string;
}

// The code that was executed
interface CodeArtifact {
  id: string;
  path: string;      // e.g., "plot.py" or "code_interpreter"
  code: string;      // The actual Python code
  language: string;  // "python"
}
```

### Key Functions

**Claude (`anthropic-client.ts`):**
```typescript
// Create client
const client = createAnthropicClient();

// Upload a file
const file = await uploadFile(client, "./data.csv");

// Execute code (with streaming)
const result = await executeCodeWithClaudeStreaming(
  client,
  "Analyze this data",
  (event) => console.log(event),  // Stream handler
  { fileIds: [file.file_id] }     // Reference uploaded files
);

// Download generated files
await downloadGeneratedFiles(client, result.files, "./output");

// Clean up
await deleteFile(client, file.file_id);
```

**OpenAI (`openai-client.ts`):**
```typescript
// Create client
const client = createOpenAIClient();

// Upload a file
const file = await uploadFile(client, "./data.csv");

// Execute code (with streaming)
const result = await executeCodeWithOpenAIStreaming(
  client,
  "Analyze this data",
  (event) => console.log(event),  // Stream handler
  { fileIds: [file.file_id] }     // Reference uploaded files
);

// Download generated files
await downloadGeneratedFiles(result.files, "./output");

// Clean up
await deleteFile(client, file.file_id);
```

**Unified via Conversation class (works with any provider):**
```typescript
import { Conversation } from "test-native-apis";

const conv = new Conversation({ provider: "gemini" }); // or "anthropic", "openai"

// Upload
const file = await conv.uploadFile("./data.csv");

// Execute with file reference
const result = await conv.send(
  "Analyze this data",
  (event) => console.log(event),
  { fileIds: [file.file_id] }
);

// Download generated files
await conv.downloadFiles(result.files, "./output");

// Clean up
await conv.deleteFile(file.file_id);
```

### Streaming Events

When using the streaming functions, you get real-time events:

| Event Type | Meaning |
|------------|---------|
| `text` | AI is generating text |
| `tool_start` | Code execution is starting |
| `code` | Code is being written (OpenAI) |
| `tool_input` | Tool input streaming (Claude - extracted code, not raw JSON) |
| `code_executing` | Code is running |
| `code_complete` | Code finished |
| `tool_end` | Code execution completed |

**Note on Claude streaming:** The module uses `eager_input_streaming: true` on the code execution tool to enable incremental code streaming. Without this, Claude's API buffers tool inputs and sends them all at once after validation, causing delays.

## Costs

### Claude
- **50 free hours/day** of container time
- **$0.05/hour** after that
- Plus normal token costs

### OpenAI
- **$0.03 per session** (flat fee)
- Plus normal token costs

## Troubleshooting

### "ANTHROPIC_API_KEY not set"
Make sure your `.env` file exists and has the correct format.

### "File not found" errors
Run tests from the repository root directory, not from `src/`.

### TypeScript errors
Run `npm run build` to compile. Check that you have the latest dependencies with `npm install`.

### API errors
- Check your API key is valid
- Check you have credits/billing set up
- Claude code execution requires an active API account

## Key Pool (Database-Based API Keys)

For the research experiment, API keys are not stored in `.env` files on participant machines. Instead, they're fetched from a PostgreSQL database at login via a secure key pool.

### How It Works

1. Multiple API keys per provider are stored in the database
2. Keys are organized into per-condition pools (e.g., "claude-only", "openai-only", "both")
3. Each participant is assigned to a condition
4. At login, the app calls a database function that returns the least-used key for their condition
5. Keys are cached in memory for the session

### Usage

```typescript
import { Pool } from "pg";
import { createKeyPool, createAnthropicClient, createOpenAIClient } from "test-native-apis";

// Connect to database with participant credentials
const dbPool = new Pool({
  host: "your-db.scw.cloud",
  port: 5432,
  database: "research_db",
  user: "participant_001",
  password: "random_password_001",
  ssl: { rejectUnauthorized: false },
});

// Create key pool and fetch keys
const keyPool = createKeyPool(dbPool);
await keyPool.fetchKeys();  // fetches for all available providers

// Check what's available
console.log("Providers:", keyPool.getAvailableProviders());  // e.g., ["anthropic"]
console.log("Condition:", keyPool.getCondition());            // e.g., { id: 1, name: "claude-only" }

// Create clients with pool keys
const anthropicKey = keyPool.getKey("anthropic");
if (anthropicKey) {
  const client = createAnthropicClient(anthropicKey);
  // Use client as normal...
}

const openaiKey = keyPool.getKey("openai");
if (openaiKey) {
  const client = createOpenAIClient(openaiKey);
  // Use client as normal...
}

// Mid-session provider switch (if one API goes down)
const fallbackKey = await keyPool.switchProvider("openai");
```

### Backward Compatibility

All client functions still fall back to `process.env` when no `apiKey` parameter is provided. Existing code using `.env` files continues to work unchanged.

## Next Steps

- Read `docs/anthropic-client-module.md` for detailed Claude API usage
- Read `docs/openai-client-module.md` for detailed OpenAI API usage
- Read `docs/database-plan.md` for the database schema and key pool design
- Look at the test files for working examples
- Try modifying the prompts to generate different visualizations
