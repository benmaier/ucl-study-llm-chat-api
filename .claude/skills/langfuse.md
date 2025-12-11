# Langfuse Skill Document

## Overview

Langfuse is an open-source LLM engineering platform for observability, prompt management, and evaluation. It provides comprehensive tracing for LLM applications.

**Website:** https://langfuse.com
**Docs:** https://langfuse.com/docs
**GitHub:** https://github.com/langfuse/langfuse

## Key Features

- **Observability**: Traces, spans, and metrics for LLM calls
- **Sessions**: Group related traces for multi-turn conversations
- **Prompt Management**: Version, collaborate, and deploy prompts
- **Evaluation**: LLM-as-judge, human feedback, custom scoring
- **OpenTelemetry**: Built on OTEL for standard observability

---

## Installation (TypeScript SDK v4)

```bash
npm install @langfuse/tracing @langfuse/otel @opentelemetry/sdk-node
```

### Additional Integrations

```bash
# For OpenAI automatic instrumentation
npm install @langfuse/openai

# For LangChain integration
npm install @langfuse/langchain
```

## Configuration

### Environment Variables

```env
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com  # Or self-hosted URL
```

### Instrumentation Setup

Create `instrumentation.ts`:

```typescript
import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseSpanProcessor } from "@langfuse/otel";

const sdk = new NodeSDK({
  spanProcessors: [
    new LangfuseSpanProcessor({
      secretKey: process.env.LANGFUSE_SECRET_KEY,
      publicKey: process.env.LANGFUSE_PUBLIC_KEY,
      baseUrl: process.env.LANGFUSE_BASE_URL,
    }),
  ],
});

sdk.start();
```

---

## Tracing

### Manual Tracing with `startActiveObservation`

```typescript
import { startActiveObservation } from "@langfuse/tracing";

async function processUserQuery(query: string) {
  return startActiveObservation("process-query", async (span) => {
    // Update trace with metadata
    span.updateTrace({
      userId: "user-123",
      sessionId: "session-abc",
      metadata: { source: "api" },
      tags: ["production"],
    });

    // Your LLM call here
    const result = await callLLM(query);

    // Child observations are automatically nested
    return result;
  });
}
```

### Manual Observation Control

```typescript
import { startObservation } from "@langfuse/tracing";

const rootSpan = startObservation("data-processing");

try {
  // Set session and user info
  rootSpan.updateTrace({
    userId: "user-123",
    sessionId: "session-abc",
  });

  // Do work...
  const result = await processData();

  rootSpan.end();
  return result;
} catch (error) {
  rootSpan.recordException(error);
  rootSpan.end();
  throw error;
}
```

### Function Wrapper with `observe`

```typescript
import { observe } from "@langfuse/tracing";

const processQuery = observe("process-query", async (query: string) => {
  // Automatic tracing
  const result = await callLLM(query);
  return result;
});

// Usage
const result = await processQuery("What is AI?");
```

---

## Session Tracking

Sessions group related traces for multi-turn conversations.

### Setting Session ID

```typescript
import { startActiveObservation, propagateAttributes } from "@langfuse/tracing";

async function handleConversationTurn(sessionId: string, message: string) {
  return startActiveObservation("conversation-turn", async (span) => {
    // Set session ID for entire trace
    span.updateTrace({
      sessionId: sessionId,
      userId: "user-123",
    });

    // Process message
    const response = await llm.chat(message);

    return response;
  });
}

// Usage - all turns share same sessionId
const sessionId = `session-${Date.now()}`;
await handleConversationTurn(sessionId, "Hello");
await handleConversationTurn(sessionId, "Tell me more");
await handleConversationTurn(sessionId, "Thanks!");
```

### Propagating Attributes Across Nested Operations

```typescript
import { propagateAttributes } from "@langfuse/tracing";

async function handleRequest(sessionId: string, userId: string) {
  // Propagate attributes to all nested observations
  return propagateAttributes(
    {
      sessionId,
      userId,
      metadata: { plan: "premium" },
      tags: ["authenticated"],
    },
    async () => {
      // All child operations inherit these attributes
      await step1();
      await step2();
      await step3();
    }
  );
}
```

---

## OpenAI Integration

### Automatic Instrumentation

```typescript
import { instrumentOpenAI } from "@langfuse/openai";
import OpenAI from "openai";

const openai = instrumentOpenAI(new OpenAI());

// All OpenAI calls are automatically traced
const response = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});
```

### With Session Context

```typescript
import { startActiveObservation } from "@langfuse/tracing";
import { instrumentOpenAI } from "@langfuse/openai";
import OpenAI from "openai";

const openai = instrumentOpenAI(new OpenAI());

async function chatWithTracking(sessionId: string, message: string) {
  return startActiveObservation("chat", async (span) => {
    span.updateTrace({ sessionId });

    // OpenAI call is automatically traced as child
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
    });

    return response.choices[0].message.content;
  });
}
```

---

## Anthropic Integration

For Anthropic, use manual tracing:

```typescript
import { startActiveObservation } from "@langfuse/tracing";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

async function chatWithClaude(sessionId: string, message: string) {
  return startActiveObservation("claude-chat", async (span) => {
    span.updateTrace({
      sessionId,
      metadata: { model: "claude-sonnet-4-5" },
    });

    // Create child span for the LLM call
    return startActiveObservation("llm-call", async (llmSpan) => {
      llmSpan.setAttribute("model", "claude-sonnet-4-5");
      llmSpan.setAttribute("input", message);

      const startTime = Date.now();

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 1024,
        messages: [{ role: "user", content: message }],
      });

      // Record metrics
      llmSpan.setAttribute("output", response.content[0].text);
      llmSpan.setAttribute("input_tokens", response.usage.input_tokens);
      llmSpan.setAttribute("output_tokens", response.usage.output_tokens);
      llmSpan.setAttribute("duration_ms", Date.now() - startTime);

      return response.content[0].text;
    });
  });
}
```

---

## Scoring and Evaluation

### User Feedback

```typescript
import { Langfuse } from "@langfuse/core";

const langfuse = new Langfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
});

// Score a specific trace
await langfuse.score({
  traceId: "trace-id-from-observation",
  name: "user-feedback",
  value: 1,  // 0-1 scale
  comment: "Helpful response",
});
```

### Custom Scores

```typescript
// Quality score
await langfuse.score({
  traceId: traceId,
  name: "response-quality",
  value: 0.85,
  dataType: "NUMERIC",
});

// Categorical score
await langfuse.score({
  traceId: traceId,
  name: "response-type",
  value: "accurate",
  dataType: "CATEGORICAL",
});
```

---

## Cost Tracking

Langfuse automatically calculates costs based on token usage:

```typescript
import { startActiveObservation } from "@langfuse/tracing";

async function trackedLLMCall(message: string) {
  return startActiveObservation("llm-call", async (span) => {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
    });

    // Token usage is automatically captured
    // Cost is calculated based on model pricing
    return response;
  });
}
```

---

## Trace Attributes

| Attribute | Description |
|-----------|-------------|
| `userId` | Unique user identifier |
| `sessionId` | Session identifier for grouping traces |
| `version` | Application version |
| `tags` | Array of tags for filtering |
| `metadata` | Additional JSON metadata |

### Example with All Attributes

```typescript
span.updateTrace({
  userId: "user-123",
  sessionId: "session-abc",
  version: "1.0.0",
  tags: ["production", "premium-user", "experiment-a"],
  metadata: {
    feature: "chat",
    source: "web-app",
    experiment: "new-prompt-v2",
  },
});
```

---

## Distributed Tracing

For cross-service tracing:

```typescript
import { propagateAttributes } from "@langfuse/tracing";

// In service A - propagate via HTTP headers
const result = await propagateAttributes(
  {
    sessionId: "session-abc",
    userId: "user-123",
  },
  async () => {
    // Make HTTP request to service B
    // Headers automatically include trace context
    return fetch("http://service-b/api", {
      headers: getTracingHeaders(), // SDK provides this
    });
  },
  { asBaggage: true }  // Enable cross-service propagation
);
```

---

## Next.js Integration Example

```typescript
// app/api/chat/route.ts
import { startActiveObservation } from "@langfuse/tracing";
import { instrumentOpenAI } from "@langfuse/openai";
import OpenAI from "openai";

const openai = instrumentOpenAI(new OpenAI());

export async function POST(req: Request) {
  const { message, sessionId, userId } = await req.json();

  return startActiveObservation("api-chat", async (span) => {
    span.updateTrace({
      sessionId,
      userId,
      metadata: { endpoint: "/api/chat" },
    });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: message }],
      stream: true,
    });

    // Stream response...
    return new Response(/* stream */);
  });
}
```

---

## Viewing Data in Langfuse Dashboard

### Traces View
- See all traces with timing and cost
- Filter by userId, sessionId, tags
- View trace hierarchy

### Sessions View
- Group traces by sessionId
- See full conversation flow
- Calculate session-level metrics

### Analytics
- Token usage over time
- Cost breakdown by model
- Error rates and latency

---

## Complete Example: Chat Session Tracking

```typescript
import { startActiveObservation, propagateAttributes } from "@langfuse/tracing";
import { instrumentOpenAI } from "@langfuse/openai";
import OpenAI from "openai";

const openai = instrumentOpenAI(new OpenAI());

class ChatSession {
  private sessionId: string;
  private userId: string;
  private messages: Array<{ role: string; content: string }> = [];

  constructor(userId: string) {
    this.sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.userId = userId;
  }

  async sendMessage(content: string): Promise<string> {
    return startActiveObservation("chat-turn", async (span) => {
      span.updateTrace({
        sessionId: this.sessionId,
        userId: this.userId,
        metadata: {
          turnNumber: this.messages.length / 2 + 1,
        },
      });

      // Add user message
      this.messages.push({ role: "user", content });

      // Call LLM (automatically traced)
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: this.messages,
      });

      const assistantMessage = response.choices[0].message.content;

      // Add assistant message
      this.messages.push({ role: "assistant", content: assistantMessage });

      return assistantMessage;
    });
  }

  getSessionId(): string {
    return this.sessionId;
  }
}

// Usage
async function main() {
  const session = new ChatSession("user-123");

  console.log("Session:", session.getSessionId());

  const response1 = await session.sendMessage("Hello, I have a question about TypeScript");
  console.log("Assistant:", response1);

  const response2 = await session.sendMessage("How do I use generics?");
  console.log("Assistant:", response2);

  const response3 = await session.sendMessage("Thanks, that helps!");
  console.log("Assistant:", response3);

  // All three turns are grouped under the same sessionId in Langfuse
}

main();
```

---

## Self-Hosting

Langfuse can be self-hosted:

```bash
docker compose up -d
```

Requirements:
- PostgreSQL database
- Langfuse platform version ≥ 3.95.0 for SDK v4

---

## References

- [Documentation](https://langfuse.com/docs)
- [TypeScript SDK Overview](https://langfuse.com/docs/observability/sdk/typescript/overview)
- [Instrumentation Guide](https://langfuse.com/docs/observability/sdk/typescript/instrumentation)
- [GitHub Repository](https://github.com/langfuse/langfuse)
- [GitHub JS SDK](https://github.com/langfuse/langfuse-js)
