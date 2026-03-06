# API Proxy Plan for Desktop App Security

## Problem

We're building an Electron desktop app for lab research. The app needs to call Claude and OpenAI APIs, but we can't embed API keys in the app because students could extract them.

## Solution

A simple "dumb pipe" proxy that:
1. Receives requests from the desktop app with a lab token
2. Validates the token
3. Swaps the token for the real API key
4. Forwards the request to Anthropic/OpenAI unchanged
5. Streams the response back to the desktop app

```
[Electron App] ──token──▶ [Vercel Proxy] ──API key──▶ [Anthropic/OpenAI]
                                │                              │
                                ◀────────── streams response ──┘
```

## Why This Works

- **Zero code changes**: The existing `anthropic-client.ts` and `openai-client.ts` modules stay exactly the same
- **Just change `baseURL`**: Point the SDK to the proxy instead of the real API
- **All features work**: Streaming, file uploads, downloads - everything passes through unchanged

## Implementation

### 1. Proxy Server (Vercel Serverless)

Two routes that act as pass-through proxies:

```
/api/anthropic/* → https://api.anthropic.com/*
/api/openai/*    → https://api.openai.com/v1/*
```

**Important**: The SDKs have different default baseURLs:
- Anthropic: `https://api.anthropic.com` (SDK adds `/v1/...` to paths)
- OpenAI: `https://api.openai.com/v1` (SDK paths don't include `/v1`)

So the OpenAI proxy must prepend `/v1` when forwarding.

### 2. Token Validation

Simple token-to-permission mapping. Options:
- **Hardcoded tokens**: Generate 30 tokens, one per participant
- **Database**: Store tokens in Vercel KV or similar (more flexible)

### 3. Desktop App Changes

Only change needed in the Electron app:

```typescript
// Before (exposes API key)
const client = new Anthropic({
  apiKey: "sk-ant-real-key-here",
});

// After (key stays on server)
const client = new Anthropic({
  baseURL: "https://your-proxy.vercel.app/api/anthropic",
  apiKey: "lab-token-participant-01",  // This becomes the auth token
});
```

Same pattern for OpenAI:

```typescript
const client = new OpenAI({
  baseURL: "https://your-proxy.vercel.app/api/openai",
  apiKey: "lab-token-participant-01",
});
```

## File Structure

```
proxy/
├── api/
│   ├── anthropic/
│   │   └── [...path].ts    # Catches all /api/anthropic/* requests
│   └── openai/
│       └── [...path].ts    # Catches all /api/openai/* requests
├── lib/
│   └── tokens.ts           # Token validation logic
├── package.json
├── vercel.json
└── .env                    # API keys (set in Vercel dashboard, not committed)
```

## Proxy Code

### `api/anthropic/[...path].ts`

```typescript
import { NextRequest } from "next/server";
import { validateToken } from "../../lib/tokens";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  // 1. Validate lab token
  const labToken = req.headers.get("x-api-key");
  if (!validateToken(labToken)) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  // 2. Build target URL
  const path = params.path.join("/");
  const targetUrl = `https://api.anthropic.com/${path}`;

  // 3. Clone headers, swap token for real API key
  const headers = new Headers(req.headers);
  headers.set("x-api-key", ANTHROPIC_API_KEY);
  headers.delete("host");

  // 4. Forward request
  const response = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: req.body,
    // @ts-ignore - duplex is needed for streaming request bodies
    duplex: "half",
  });

  // 5. Stream response back
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

// Support GET for file downloads
export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const labToken = req.headers.get("x-api-key");
  if (!validateToken(labToken)) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  const path = params.path.join("/");
  const targetUrl = `https://api.anthropic.com/${path}`;

  const headers = new Headers(req.headers);
  headers.set("x-api-key", ANTHROPIC_API_KEY);
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

// Support DELETE for file cleanup
export async function DELETE(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const labToken = req.headers.get("x-api-key");
  if (!validateToken(labToken)) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  const path = params.path.join("/");
  const targetUrl = `https://api.anthropic.com/${path}`;

  const headers = new Headers(req.headers);
  headers.set("x-api-key", ANTHROPIC_API_KEY);
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: "DELETE",
    headers,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
```

### `api/openai/[...path].ts`

```typescript
import { NextRequest } from "next/server";
import { validateToken } from "../../lib/tokens";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

// OpenAI SDK default baseURL is https://api.openai.com/v1
// So when user sets baseURL to our proxy, paths don't include /v1
// We must add /v1 when forwarding to the real API

export async function POST(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const labToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!validateToken(labToken)) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  const path = params.path.join("/");
  const targetUrl = `https://api.openai.com/v1/${path}`;  // Note: /v1/ added

  const headers = new Headers(req.headers);
  headers.set("Authorization", `Bearer ${OPENAI_API_KEY}`);
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: "POST",
    headers,
    body: req.body,
    // @ts-ignore
    duplex: "half",
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const labToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!validateToken(labToken)) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  const path = params.path.join("/");
  const targetUrl = `https://api.openai.com/v1/${path}`;  // Note: /v1/ added

  const headers = new Headers(req.headers);
  headers.set("Authorization", `Bearer ${OPENAI_API_KEY}`);
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: "GET",
    headers,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const labToken = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!validateToken(labToken)) {
    return new Response(JSON.stringify({ error: "Invalid token" }), {
      status: 401,
    });
  }

  const path = params.path.join("/");
  const targetUrl = `https://api.openai.com/v1/${path}`;  // Note: /v1/ added

  const headers = new Headers(req.headers);
  headers.set("Authorization", `Bearer ${OPENAI_API_KEY}`);
  headers.delete("host");

  const response = await fetch(targetUrl, {
    method: "DELETE",
    headers,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}
```

### `lib/tokens.ts`

```typescript
// Simple hardcoded tokens for 30 participants
// In production, consider using Vercel KV or a database

const VALID_TOKENS = new Set([
  "lab-2024-participant-01",
  "lab-2024-participant-02",
  "lab-2024-participant-03",
  // ... generate 30 tokens
  "lab-2024-participant-30",
]);

export function validateToken(token: string | null | undefined): boolean {
  if (!token) return false;
  return VALID_TOKENS.has(token);
}

// Optional: Generate tokens programmatically
export function generateTokens(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) =>
    `${prefix}-${String(i + 1).padStart(2, "0")}`
  );
}
```

### `vercel.json`

```json
{
  "functions": {
    "api/**/*.ts": {
      "maxDuration": 300
    }
  }
}
```

### `package.json`

```json
{
  "name": "lab-api-proxy",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build"
  },
  "dependencies": {
    "next": "^14.0.0"
  }
}
```

## Deployment Steps

1. **Create Vercel account** (free tier is sufficient for 30 users)

2. **Create GitHub repo** with the proxy code

3. **Connect to Vercel**:
   - Go to vercel.com → New Project
   - Import your GitHub repo
   - It auto-detects Next.js

4. **Add environment variables** in Vercel dashboard:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   OPENAI_API_KEY=sk-...
   ```

5. **Deploy** - Vercel gives you a URL like `https://lab-proxy.vercel.app`

6. **Update desktop app** to use the proxy URL

## Optional Enhancements

### Conversation Logging

Add logging to track all conversations for research:

```typescript
// In the proxy, before forwarding:
async function logRequest(token: string, path: string, body: any) {
  // Log to Vercel KV, Supabase, or external logging service
  await kv.lpush(`logs:${token}`, {
    timestamp: Date.now(),
    path,
    body,
  });
}
```

### Rate Limiting

Prevent abuse:

```typescript
import { Ratelimit } from "@upstash/ratelimit";
import { kv } from "@vercel/kv";

const ratelimit = new Ratelimit({
  redis: kv,
  limiter: Ratelimit.slidingWindow(100, "1h"), // 100 requests per hour
});

// In handler:
const { success } = await ratelimit.limit(labToken);
if (!success) {
  return new Response("Rate limited", { status: 429 });
}
```

### Token Expiration

Make tokens expire after the study:

```typescript
interface TokenInfo {
  token: string;
  expiresAt: Date;
  participantId: string;
}

// Store in database with expiration
```

## Cost Estimate

- **Vercel**: Free tier includes 100GB bandwidth, 100 hours serverless compute
- **For 30 concurrent users**: Well within free tier
- **If you exceed**: ~$20/month for Pro plan

## Security Notes

1. **Never commit `.env`** - API keys only go in Vercel dashboard
2. **Use HTTPS** - Vercel provides this automatically
3. **Rotate tokens** - Generate new tokens for each study
4. **Monitor usage** - Check Vercel analytics for unusual patterns
