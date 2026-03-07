# Testing Guide

## Two Tiers of Tests

### Unit Tests (`src/__tests__/unit/`)
Fast, free, no API keys needed. Cover pure helper functions and parsing logic.
Run on every change, no env setup required.

### Integration Tests (`src/__tests__/integration/`)
Hit live APIs (Anthropic, OpenAI, Gemini). Slow and cost money.
Run manually or in CI with keys set. Automatically skipped when the relevant API key is missing.

## Running Tests

```bash
# All tests (unit always run, integration only if keys present)
npm test

# Unit tests only (always fast, always free)
npm run test:unit

# Integration tests only (needs API keys)
npm run test:integration

# Watch mode for development
npm run test:watch
```

## When to Write Which

- New helper/parsing logic -> unit test
- New API interaction -> integration test

## API Keys for Integration Tests

Integration tests skip gracefully when keys are missing:

| Provider  | Environment Variable   |
|-----------|----------------------|
| Anthropic | `ANTHROPIC_API_KEY`  |
| OpenAI    | `OPENAI_API_KEY`     |
| Gemini    | `GOOGLE_API_KEY`     |

Set them in `.env` (loaded automatically via `dotenv/config`).

## Gemini Limitation

The multi-turn file access test is skipped for Gemini because its code execution sandbox is ephemeral -- files generated in one turn are not accessible in subsequent turns.

## Legacy Scripts

The old standalone test scripts still work:

```bash
npm run test:anthropic
npm run test:openai
npm run test:gemini
npm run test:multi-turn
npm run demo:multi-turn
```

## Test File Naming

- Unit: `src/__tests__/unit/*.test.ts`
- Integration: `src/__tests__/integration/*.test.ts`
