# assistant-ui Skill Document

## Overview

assistant-ui is an open-source TypeScript/React library for building production-grade AI chat interfaces. It provides composable UI primitives following a Radix-style approach where you compose smaller pieces and customize styling.

**Key Stats:**
- 7.6k+ GitHub stars
- 400k+ monthly npm downloads
- Y Combinator backed

**Repository:** https://github.com/assistant-ui/assistant-ui
**Docs:** https://www.assistant-ui.com/docs

## Installation

### New Project
```bash
npx assistant-ui@latest create
```

### Existing Project
```bash
npx assistant-ui@latest init
```

### Manual Installation
```bash
npm install @assistant-ui/react @assistant-ui/react-ai-sdk @assistant-ui/react-ui ai @ai-sdk/anthropic @ai-sdk/openai
```

## Core Packages

| Package | Purpose |
|---------|---------|
| `@assistant-ui/react` | Core runtime and primitives |
| `@assistant-ui/react-ai-sdk` | AI SDK v5 integration |
| `@assistant-ui/react-ui` | Pre-built styled components |

## Architecture

### Runtime System

The runtime manages chat state and interactions. Use `useChatRuntime` from `@assistant-ui/react-ai-sdk`:

```typescript
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { Thread } from "@assistant-ui/react-ui";

const MyApp = () => {
  const runtime = useChatRuntime({
    api: "/api/chat",
  });

  return (
    <div className="h-full">
      <Thread runtime={runtime} />
    </div>
  );
};
```

### Transport Options

- **AssistantChatTransport** (default): Automatically forwards system messages and frontend tools to backend
- **DefaultChatTransport**: Standard AI SDK transport without forwarding

### Context Hierarchy

1. **AssistantContext**: Top-level state via `useAssistantRuntime`
2. **ThreadContext**: Individual conversation via `useThread`
3. **ComposerContext**: Message input via `useComposer`
4. **MessageContext**: Individual message state via `useMessage`
5. **MessagePartContext**: Content segment management
6. **AttachmentContext**: File handling

## UI Components

### Thread Component

Full-screen chat interface with message list and composer:

```typescript
import { Thread } from "@assistant-ui/react-ui";

// Basic usage
<Thread runtime={runtime} />
```

### CSS Setup

**With Tailwind:**
Add plugin to `tailwind.config.ts`

**Without Tailwind:**
```typescript
import "@assistant-ui/react-ui/styles/index.css";
```

### Using shadcn CLI
```bash
npx shadcn@latest add "https://r.assistant-ui.com/thread"
```

## Backend Integration (Next.js)

### API Route with Anthropic

```typescript
// app/api/chat/route.ts
import { anthropic } from "@ai-sdk/anthropic";
import { streamText } from "ai";

export async function POST(req: Request) {
  const { messages, system } = await req.json();

  const result = await streamText({
    model: anthropic("claude-sonnet-4-5"),
    system: system, // Use system message from frontend if provided
    messages,
  });

  return result.toDataStreamResponse();
}
```

### API Route with OpenAI

```typescript
// app/api/chat/route.ts
import { openai } from "@ai-sdk/openai";
import { streamText } from "ai";

export async function POST(req: Request) {
  const { messages, system } = await req.json();

  const result = await streamText({
    model: openai("gpt-4o"),
    system,
    messages,
  });

  return result.toDataStreamResponse();
}
```

## Frontend Tools

Frontend tools can be forwarded to the backend:

```typescript
import { frontendTools } from "@assistant-ui/react-ai-sdk";

// In your API route
const result = await streamText({
  model: anthropic("claude-sonnet-4-5"),
  tools: frontendTools(req), // Helper to extract frontend tools
  messages,
});
```

## Advanced Features

### Direct useChat Access

For fine-grained control:

```typescript
import { useAISDKRuntime } from "@assistant-ui/react-ai-sdk";
import { useChat } from "@ai-sdk/react";

const chat = useChat({ api: "/api/chat" });
const runtime = useAISDKRuntime(chat);
```

### Primitive Components

Compound component pattern for full customization:

```typescript
import { ThreadPrimitive } from "@assistant-ui/react";

<ThreadPrimitive.Root>
  <ThreadPrimitive.Viewport>
    {/* Custom message rendering */}
  </ThreadPrimitive.Viewport>
</ThreadPrimitive.Root>
```

## Provider Support

assistant-ui works with any provider supported by AI SDK:
- OpenAI
- Anthropic
- Google Gemini
- AWS Bedrock
- Azure OpenAI
- Mistral
- Groq
- Cohere
- Ollama

## Built-in Features

- Streaming message handling
- Auto-scrolling
- Keyboard shortcuts
- Accessibility
- Markdown rendering
- Code syntax highlighting
- File attachments
- Message branching/editing
- Retry mechanisms

## Example Project Structure

```
my-app/
├── app/
│   ├── api/
│   │   └── chat/
│   │       └── route.ts      # Backend API route
│   ├── layout.tsx
│   └── page.tsx              # Main chat page
├── components/
│   └── chat/
│       └── ChatInterface.tsx # Thread component
├── .env.local                # API keys
├── package.json
└── tailwind.config.ts
```

## Environment Variables

```env
# .env.local
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

## References

- [GitHub Repository](https://github.com/assistant-ui/assistant-ui)
- [Documentation](https://www.assistant-ui.com/docs)
- [AI SDK v5 Integration](https://www.assistant-ui.com/docs/runtimes/ai-sdk/use-chat)
- [Thread Component](https://www.assistant-ui.com/docs/legacy/styled/Thread)
- [Examples](https://github.com/assistant-ui/assistant-ui/tree/main/examples)
