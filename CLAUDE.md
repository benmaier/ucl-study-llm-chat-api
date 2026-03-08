# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TypeScript library providing a unified interface for LLM code execution across three providers (Anthropic Claude, OpenAI, Gemini). Each provider runs Python in a sandboxed container — send a prompt, get back text, generated files, and executed source code. Built for a UCL research study deployment.

## Commands

```bash
npm run build              # TypeScript compilation (tsc) → dist/
npm test                   # All tests (unit + integration)
npm run test:unit          # Unit tests only (fast, no API keys)
npm run test:integration   # Integration tests (needs API keys, hits live APIs)
npm run test:watch         # Vitest watch mode
```

Demo scripts (standalone, verbose output): `npm run test:anthropic`, `npm run test:openai`, `npm run test:gemini` and variants (`:upload`, `:stream`).

## Environment Variables

Set in `.env` (see `.env.example`):
- `ANTHROPIC_API_KEY` — required for Claude tests/demos
- `OPENAI_API_KEY` — required for OpenAI tests/demos
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — required for Gemini tests/demos
- `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASE_URL` — optional observability

Integration tests skip automatically when the relevant API key is missing (using `describe.skipIf`).

## Architecture

All production code lives in `src/modules/`. The library is a set of provider-specific functions that share common types and a unified `Conversation` class.

### Provider Clients (`anthropic-client.ts`, `openai-client.ts`, `gemini-client.ts`)

Each provider module exports the same function shapes with provider-specific prefixes:
- `createXxxClient(apiKey?)` — initialize SDK client
- `executeCodeWithXxx(client, prompt, options)` — non-streaming code execution
- `executeCodeWithXxxStreaming(client, prompt, onEvent, options)` — streaming with `StreamEvent` callbacks
- `executeCodeWithXxxMultiTurn(...)` — multi-turn variant carrying conversation state
- `chatWithXxx` / `streamChatWithXxx` — text-only chat (no code execution)
- `uploadFile` / `uploadFileFromBuffer` / `deleteFile` / `downloadGeneratedFiles`

All return the shared `CodeExecutionResult` type (text, files, codeArtifacts).

### Key Provider Differences

| | Claude | OpenAI | Gemini |
|---|---|---|---|
| Code tool | `code_execution_20250825` | `code_interpreter` | `codeExecution` |
| Multi-turn state | messages[] + containerId | `previous_response_id` | contents[] array |
| File download | HTTP via Files API | HTTP from container | Inline base64 |
| Cross-turn files | Persistent | Persistent | **Ephemeral** (no cross-turn access) |
| Default model | claude-sonnet-4-5-20250929 | gpt-4o | gemini-2.5-flash |

### Shared Types (`types.ts`)

- `CodeExecutionResult` — unified output: `{ text, files, codeArtifacts, containerId? }`
- `StreamEvent` — real-time event: `{ type, text?, code?, toolName?, output? }`
- `MultiTurnCodeResult` — extends `CodeExecutionResult` with conversation state
- `CodeArtifact` — extracted source code: `{ id, path, code, language }`
- `SendOptions` — options for `Conversation.send()`: `{ fileIds? }`

### Conversation Class (`conversation.ts`)

Provider-agnostic multi-turn manager. Internally tracks different state per provider (Claude messages+containerId, OpenAI responseId, Gemini contents array). Unified API:
- `new Conversation({ provider })` — create instance
- `conv.uploadFile(filePath, mimeType?)` / `conv.uploadFileFromBuffer(buffer, filename, mimeType?)` — upload files
- `conv.send(message, onEvent, { fileIds? })` — send a turn, optionally referencing uploaded files
- `conv.downloadFiles(files, outputDir)` — download generated files
- `conv.deleteFile(fileId)` — clean up uploaded files

### Key Pool (`key-pool.ts`)

Database-based API key rotation for research deployments. Connects to PostgreSQL, calls `assign_api_key()` stored function, caches keys in memory. Keys never stored on participant machines.

### Helpers (`helpers.ts`)

Pure utility functions: `inferMimeType`, `inferLanguage`, `mimeToExtension`, `extractCodeFromPartialJson`, `parseResponse`.

## Testing

Two tiers:
- **Unit** (`src/__tests__/unit/`) — pure function tests, no API keys, fast
- **Integration** (`src/__tests__/integration/`) — live API calls, 120s timeout per test

Vitest config loads `.env` via `setupFiles: ["dotenv/config"]`. Run a single test file with `npx vitest run src/__tests__/unit/helpers.test.ts`.

## TypeScript Config

ES2022 target, ESNext modules, strict mode, bundler module resolution. Test and demo files excluded from `dist/` output. Generates `.d.ts` declaration files.
