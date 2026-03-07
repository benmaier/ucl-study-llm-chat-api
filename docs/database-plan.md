# Database Plan

## Overview

A PostgreSQL database for:
- **Token management** - Authenticating participants and assigning experiment conditions
- **API key pool** - Securely distributing API keys to participants via load-balanced pools
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

### Core Tables

```sql
-- Participants/tokens for authentication
CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  token VARCHAR(64) UNIQUE NOT NULL,
  db_user VARCHAR(64) NOT NULL,  -- maps to participant_001, etc.
  condition_id INT REFERENCES experiment_conditions(id),
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

### Key Pool Tables

```sql
-- Experiment conditions (e.g., 'claude-only', 'openai-only', 'both')
CREATE TABLE experiment_conditions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Pool of API keys
CREATE TABLE api_keys (
  id SERIAL PRIMARY KEY,
  provider VARCHAR(20) NOT NULL,           -- 'anthropic' or 'openai'
  api_key TEXT NOT NULL,
  label VARCHAR(100),                       -- e.g., 'anthropic-key-1'
  session_assignment_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Links conditions to their available keys
CREATE TABLE condition_key_pools (
  id SERIAL PRIMARY KEY,
  condition_id INT REFERENCES experiment_conditions(id) ON DELETE CASCADE,
  api_key_id INT REFERENCES api_keys(id) ON DELETE CASCADE,
  UNIQUE(condition_id, api_key_id)
);

-- Audit log of key assignments
CREATE TABLE session_key_assignments (
  id SERIAL PRIMARY KEY,
  db_user VARCHAR(64) NOT NULL,
  api_key_id INT REFERENCES api_keys(id),
  provider VARCHAR(20) NOT NULL,
  assigned_at TIMESTAMP DEFAULT NOW()
);
```

### `assign_api_key()` Function

Participants never get direct SELECT on `api_keys`. Instead they call a stored function that runs with admin privileges:

```sql
CREATE OR REPLACE FUNCTION assign_api_key(p_provider VARCHAR(20))
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_condition_id INT;
  v_key_id INT;
  v_api_key TEXT;
BEGIN
  -- Look up participant's condition via current_user + tokens table
  SELECT t.condition_id INTO v_condition_id
  FROM tokens t
  WHERE t.db_user = current_user
    AND t.is_active = true
  LIMIT 1;

  IF v_condition_id IS NULL THEN
    RAISE EXCEPTION 'No active condition found for user %', current_user;
  END IF;

  -- Find least-used active key for this provider in this condition's pool
  SELECT ak.id, ak.api_key
  INTO v_key_id, v_api_key
  FROM api_keys ak
  JOIN condition_key_pools ckp ON ckp.api_key_id = ak.id
  WHERE ckp.condition_id = v_condition_id
    AND ak.provider = p_provider
    AND ak.is_active = true
  ORDER BY ak.session_assignment_count ASC
  LIMIT 1;

  IF v_key_id IS NULL THEN
    RAISE EXCEPTION 'No active % key available for condition %', p_provider, v_condition_id;
  END IF;

  -- Increment session_assignment_count for load balancing
  UPDATE api_keys SET session_assignment_count = session_assignment_count + 1
  WHERE id = v_key_id;

  -- Log the assignment
  INSERT INTO session_key_assignments (db_user, api_key_id, provider)
  VALUES (current_user, v_key_id, p_provider);

  RETURN v_api_key;
END;
$$;
```

## Access Control

Two types of database users with Row-Level Security (RLS):

### 1. Per-Participant Users (RLS-protected)

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

-- Grant EXECUTE on the key assignment function (NOT direct access to api_keys table)
GRANT EXECUTE ON FUNCTION assign_api_key(VARCHAR) TO participant_001, participant_002;

-- Grant SELECT on tokens so condition lookup works within the function
-- (the SECURITY DEFINER function runs as admin, so this is optional but explicit)
```

### 2. Admin Role (full access)

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

## Integration with Desktop App

The Electron app connects directly to the database using participant credentials. At login, it fetches API keys via the key pool, then calls Claude/OpenAI APIs directly.

### Connection and Key Pool

```typescript
import { Pool } from "pg";
import { createKeyPool } from "test-native-apis";

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
async function onLogin(username: string, password: string) {
  pool = createConnection(username, password);

  // Fetch API keys from the database key pool
  const keyPool = createKeyPool(pool);
  await keyPool.fetchKeys();  // fetches keys for all available providers

  // Use keys to create API clients
  const anthropicKey = keyPool.getKey("anthropic");
  const openaiKey = keyPool.getKey("openai");

  console.log("Available providers:", keyPool.getAvailableProviders());
  console.log("Condition:", keyPool.getCondition());
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
| `SELECT * FROM api_keys` | Fails - no SELECT granted on api_keys |

## Researcher Workflow

1. **Before experiment**:
   - Create experiment conditions and assign API keys to pools
   - Generate participant users and tokens via admin panel
   - Assign each token to a condition

2. **During experiment**:
   - Desktop app fetches API keys via `assign_api_key()` at login
   - App calls Claude/OpenAI APIs directly with the assigned keys
   - Desktop app logs all conversations and artifacts to DB
   - Participants can only INSERT, not read others' data

3. **After experiment**:
   - Set `is_active = false` on tokens
   - Export data via admin panel for analysis
   - Review `session_key_assignments` for key usage audit trail
   - All conversations and artifacts available in DB

## Storage Estimate

Worst case: 400 participants × 2 hours × 1MB/minute

```
120 min × 1MB × 400 = 48 GB
```

Well under Scaleway's 1TB limit. Actual usage likely much lower.
