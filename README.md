# test-native-apis

TypeScript library for code execution with Claude (Anthropic), OpenAI, and Gemini. Each provider runs Python in a sandboxed container -- you send a prompt, get back text, generated files (plots, CSVs), and the source code that was executed.

## Features

- **Three providers** with the same interface: Anthropic, OpenAI, Gemini
- **Streaming** -- real-time text, code, and execution status events
- **File upload** -- upload CSVs/images, reference them in prompts
- **File download** -- retrieve generated plots and data files
- **Multi-turn conversations** -- `Conversation` class manages state across turns
- **Key pool** -- database-based API key rotation for research deployments

## Setup

```bash
npm install
cp .env.example .env   # add your API keys
npm run build
```

### Environment Variables

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=AI...
```

## Quick Start

```typescript
import {
  createAnthropicClient,
  executeCodeWithClaudeStreaming,
  downloadGeneratedFiles,
} from "test-native-apis";

const client = createAnthropicClient();
const result = await executeCodeWithClaudeStreaming(
  client,
  "Plot y = sin(x) from 0 to 10 and save as plot.png",
  (event) => {
    if (event.type === "text") process.stdout.write(event.text || "");
  }
);

await downloadGeneratedFiles(client, result.files, "./output");
```

### Multi-turn Conversation

```typescript
import { Conversation } from "test-native-apis";

const conv = new Conversation({ provider: "anthropic" });
const r1 = await conv.send("Generate 100 random numbers, save to data.csv", handler);
const r2 = await conv.send("Read data.csv and compute the mean", handler);
// r2 can access data.csv from r1's turn
```

## Project Structure

```
src/
  modules/
    anthropic-client.ts    Claude provider
    openai-client.ts       OpenAI provider
    gemini-client.ts       Gemini provider
    conversation.ts        Unified multi-turn Conversation class
    helpers.ts             Shared pure functions (MIME types, parsing)
    types.ts               Shared TypeScript interfaces
    key-pool.ts            Database-based API key pool
    langfuse-client.ts     Optional observability
  test/                    Standalone demo scripts
  __tests__/               Vitest test suite
    unit/                    Pure function tests (no API keys)
    integration/             Live API tests (skip without keys)
```

## Testing

```bash
npm test                # all tests (unit + integration)
npm run test:unit       # unit tests only (fast, free)
npm run test:integration  # integration tests only (needs API keys)
npm run test:watch      # vitest watch mode
```

Integration tests skip automatically when the relevant API key is missing. See [TESTING.md](TESTING.md) for details.

## Demos

Standalone scripts in `src/test/` demonstrate each provider with verbose terminal output (colored streaming, step-by-step logging). These are useful for seeing the APIs in action and debugging.

### Code Execution (streaming)

```bash
npm run test:anthropic        # Claude: plot + find zeros, streaming
npm run test:openai           # OpenAI: same prompt, streaming
npm run test:gemini           # Gemini: same prompt, streaming
```

### File Upload + Execution

```bash
npm run test:anthropic:upload   # Upload CSV, plot it (non-streaming)
npm run test:openai:upload      # Same for OpenAI
npm run test:gemini:upload      # Same for Gemini
```

### File Upload + Streaming Execution

```bash
npm run test:anthropic:stream   # Upload CSV, plot with live streaming
npm run test:openai:stream      # Same for OpenAI
npm run test:gemini:stream      # Same for Gemini
```

### Multi-turn Conversations

```bash
npm run demo:multi-turn    # Two-turn plotting demo (all 3 providers)
npm run test:multi-turn    # Cross-turn file access verification
```

The multi-turn file access test generates data with a known seed in turn 1, then verifies the model can read it back in turn 2 by checking statistics against locally computed expected values. Gemini is skipped because its sandbox is ephemeral (no cross-turn file persistence).

## Streaming Events

| Event Type       | Description                                  | Provider    |
|-----------------|----------------------------------------------|-------------|
| `text`          | AI text response chunk                       | All         |
| `tool_start`    | Code execution tool started                  | All         |
| `tool_input`    | Extracted code streaming                     | Claude      |
| `code`          | Code being written                           | OpenAI, Gemini |
| `code_executing`| Code is running in sandbox                   | OpenAI      |
| `code_complete` | Code execution finished                      | OpenAI, Gemini |
| `code_output`   | Execution stdout                             | Gemini      |
| `tool_end`      | Code execution tool completed                | All         |

## Provider Differences

| Feature                     | Claude                          | OpenAI                      | Gemini                        |
|----------------------------|---------------------------------|-----------------------------|-------------------------------|
| Code execution tool        | `code_execution_20250825`       | `code_interpreter`          | `codeExecution`               |
| File download              | Files API (HTTP download)       | Container files (HTTP)      | Inline base64                 |
| Multi-turn state           | Messages array + container ID   | `previous_response_id`      | Contents array                |
| Cross-turn file access     | Yes (persistent container)      | Yes (persistent container)  | No (ephemeral sandbox)        |

## Key Pool

For research deployments where API keys shouldn't be on participant machines:

```typescript
import { Pool } from "pg";
import { createKeyPool, createAnthropicClient } from "test-native-apis";

const dbPool = new Pool({ /* connection config */ });
const keyPool = createKeyPool(dbPool);
await keyPool.fetchKeys();

const client = createAnthropicClient(keyPool.getKey("anthropic"));
```

See [howto.md](howto.md) for full key pool documentation.
