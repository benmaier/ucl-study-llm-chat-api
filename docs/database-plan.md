# Database Plan

## Overview

A PostgreSQL database for:
- **Token management** - Validating participant tokens for API proxy
- **Conversation logging** - Storing all participant conversations for research
- **Artifact storage** - Storing generated files (images, code, CSVs) directly in DB

## Provider

**Scaleway Serverless SQL Database** (Paris, France)

- Fully EU-based company and data centers
- PostgreSQL compatible
- Scales to zero when idle (cost-efficient)
- GDPR compliant

### Pricing

| Resource | Cost |
|----------|------|
| Compute | €0.14/vCPU/hour |
| Storage | €0.20/GB/month |
| Backups | Free (7-day retention) |

### Estimated Costs

For 400 participants × 2 hours each:

| Item | Estimate |
|------|----------|
| Storage (48GB worst case) | ~€10/month |
| Compute (scales to zero) | ~€5-15/month |
| **Total** | **~€15-25/month** |

## Schema

```sql
-- Participants/tokens for API proxy authentication
CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(64) UNIQUE NOT NULL,
  db_user VARCHAR(64) NOT NULL,  -- maps to participant_001, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true
);

-- Conversations
CREATE TABLE conversations (
  id SERIAL PRIMARY KEY,
  db_user TEXT DEFAULT current_user,  -- auto-filled by RLS
  started_at TIMESTAMP DEFAULT NOW(),
  ended_at TIMESTAMP,
  metadata JSONB  -- flexible field for experiment conditions, etc.
);

-- Individual messages in a conversation
CREATE TABLE messages (
  id SERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id),
  db_user TEXT DEFAULT current_user,  -- auto-filled by RLS
  role VARCHAR(20) NOT NULL,  -- 'user', 'assistant', 'system'
  content TEXT NOT NULL,
  is_deleted BOOLEAN DEFAULT false,  -- soft delete only
  created_at TIMESTAMP DEFAULT NOW(),
  metadata JSONB  -- token usage, model, etc.
);

-- Generated artifacts (images, code, CSVs)
CREATE TABLE artifacts (
  id SERIAL PRIMARY KEY,
  conversation_id INT REFERENCES conversations(id),
  message_id INT REFERENCES messages(id),
  db_user TEXT DEFAULT current_user,  -- auto-filled by RLS
  filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT,
  data BYTEA NOT NULL,  -- binary content stored directly
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX idx_tokens_token ON tokens(token);
CREATE INDEX idx_tokens_active ON tokens(is_active, expires_at);
CREATE INDEX idx_conversations_db_user ON conversations(db_user);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_db_user ON messages(db_user);
CREATE INDEX idx_artifacts_conversation ON artifacts(conversation_id);
```

## Access Control

Three types of database users with Row-Level Security (RLS):

### 1. Proxy Role (read-only for tokens)

Used by the Vercel proxy to validate tokens:

```sql
CREATE ROLE proxy_role WITH LOGIN PASSWORD 'proxy_secret';

-- Only SELECT on tokens table
GRANT SELECT ON tokens TO proxy_role;
```

### 2. Per-Participant Users (RLS-protected)

Each participant gets their own database user. Row-Level Security ensures they can only access their own data.

```sql
-- Create participant users
CREATE USER participant_001 WITH PASSWORD 'random_password_001';
CREATE USER participant_002 WITH PASSWORD 'random_password_002';
-- ... generate for all 400 participants

-- Grant limited permissions
GRANT INSERT ON conversations, messages, artifacts TO participant_001, participant_002;
GRANT SELECT ON conversations, messages, artifacts TO participant_001, participant_002;
GRANT UPDATE (is_deleted) ON messages TO participant_001, participant_002;
GRANT UPDATE (ended_at) ON conversations TO participant_001, participant_002;

-- Sequences needed for auto-increment IDs
GRANT USAGE ON SEQUENCE conversations_id_seq TO participant_001, participant_002;
GRANT USAGE ON SEQUENCE messages_id_seq TO participant_001, participant_002;
GRANT USAGE ON SEQUENCE artifacts_id_seq TO participant_001, participant_002;
```

### 3. Admin Role (full access)

Used by researchers via admin panel:

```sql
CREATE ROLE admin_role WITH LOGIN PASSWORD 'admin_secret';

-- Full access to all tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO admin_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO admin_role;

-- Admin bypasses RLS
ALTER ROLE admin_role BYPASSRLS;
```

## Row-Level Security (RLS)

RLS ensures participants can only see and modify their own data, even if they try to query everything.

### Enable RLS on Tables

```sql
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY;
```

### RLS Policies for Conversations

```sql
-- INSERT: auto-fill db_user, can only insert as yourself
CREATE POLICY insert_own_conversations ON conversations
  FOR INSERT
  WITH CHECK (db_user = current_user);

-- SELECT: only see your own conversations
CREATE POLICY select_own_conversations ON conversations
  FOR SELECT
  USING (db_user = current_user);

-- UPDATE: only update your own conversations
CREATE POLICY update_own_conversations ON conversations
  FOR UPDATE
  USING (db_user = current_user);
```

### RLS Policies for Messages

```sql
CREATE POLICY insert_own_messages ON messages
  FOR INSERT
  WITH CHECK (db_user = current_user);

CREATE POLICY select_own_messages ON messages
  FOR SELECT
  USING (db_user = current_user);

CREATE POLICY update_own_messages ON messages
  FOR UPDATE
  USING (db_user = current_user);

-- No DELETE policy = participants cannot delete messages
```

### RLS Policies for Artifacts

```sql
CREATE POLICY insert_own_artifacts ON artifacts
  FOR INSERT
  WITH CHECK (db_user = current_user);

CREATE POLICY select_own_artifacts ON artifacts
  FOR SELECT
  USING (db_user = current_user);

-- No UPDATE or DELETE policies for artifacts
```

## Integration with Vercel Proxy

The proxy caches tokens and refreshes every 5 minutes:

```typescript
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

let cachedTokens: Set<string> | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function validateToken(token: string): Promise<boolean> {
  // Refresh cache if expired
  if (!cachedTokens || Date.now() - cacheTime > CACHE_TTL) {
    const { rows } = await pool.query(
      "SELECT token FROM tokens WHERE is_active = true AND (expires_at IS NULL OR expires_at > NOW())"
    );
    cachedTokens = new Set(rows.map(r => r.token));
    cacheTime = Date.now();
  }

  return cachedTokens.has(token);
}
```

Environment variable for Vercel:
```
DATABASE_URL=postgresql://proxy_role:proxy_secret@xxx.scw.cloud:5432/research_db
```

## Integration with Desktop App

The Electron app connects directly to the database using participant credentials. Each participant logs in with their own username/password.

### Connection

```typescript
import { Pool } from "pg";

// Participant enters credentials in login screen
function createConnection(username: string, password: string): Pool {
  return new Pool({
    host: "your-db.scw.cloud",
    port: 5432,
    database: "research_db",
    user: username,      // e.g., "participant_001"
    password: password,  // e.g., "random_password_001"
    ssl: { rejectUnauthorized: false }
  });
}

let pool: Pool;

// On login
function onLogin(username: string, password: string) {
  pool = createConnection(username, password);
}
```

### Database Operations

```typescript
// Start conversation - db_user auto-filled by DEFAULT current_user
async function startConversation(): Promise<number> {
  const { rows } = await pool.query(
    "INSERT INTO conversations DEFAULT VALUES RETURNING id"
  );
  return rows[0].id;
}

// Log message - db_user auto-filled
async function logMessage(conversationId: number, role: string, content: string, metadata?: object) {
  const { rows } = await pool.query(
    "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4) RETURNING id",
    [conversationId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
  return rows[0].id;
}

// Save artifact - db_user auto-filled
async function saveArtifact(conversationId: number, messageId: number, filename: string, mimeType: string, data: Buffer) {
  await pool.query(
    "INSERT INTO artifacts (conversation_id, message_id, filename, mime_type, size_bytes, data) VALUES ($1, $2, $3, $4, $5, $6)",
    [conversationId, messageId, filename, mimeType, data.length, data]
  );
}

// Soft delete a message - RLS ensures only own messages
async function softDeleteMessage(messageId: number) {
  await pool.query(
    "UPDATE messages SET is_deleted = true WHERE id = $1",
    [messageId]
  );
  // RLS automatically filters: only works if db_user = current_user
}

// Get own conversations - RLS filters automatically
async function getMyConversations() {
  const { rows } = await pool.query(
    "SELECT * FROM conversations ORDER BY started_at DESC"
  );
  // Even though no WHERE clause, RLS ensures only own rows returned
  return rows;
}
```

### What RLS Does Automatically

| Query | What Happens |
|-------|--------------|
| `SELECT * FROM messages` | Only returns participant's own messages |
| `INSERT INTO messages (...)` | `db_user` auto-set to current participant |
| `UPDATE messages SET is_deleted = true WHERE id = 5` | Only works if message belongs to participant |
| `DELETE FROM messages` | Fails - no DELETE policy exists |

## Researcher Workflow

1. **Before experiment**:
   - Generate tokens via admin panel
   - Tokens stored in `tokens` table with `is_active = true`

2. **During experiment**:
   - Proxy validates tokens against DB (cached)
   - Desktop app logs all conversations and artifacts
   - Participants can only INSERT, not read others' data

3. **After experiment**:
   - Set `is_active = false` on tokens
   - Export data via admin panel for analysis
   - All conversations and artifacts available in DB

## Storage Estimate

Worst case: 400 participants × 2 hours × 1MB/minute

```
120 min × 1MB × 400 = 48 GB
```

Well under Scaleway's 1TB limit. Actual usage likely much lower.
