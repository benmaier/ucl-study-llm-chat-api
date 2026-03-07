# Research Lab Chat Application
## Architecture Proposal

---

## Slide 1: Overview

**What we're building:**

A desktop application for research participants to interact with AI assistants (Claude and ChatGPT), with:

- Secure API access (participants can't steal credentials)
- Automatic conversation logging for research analysis
- File/artifact storage (images, code, CSVs generated during sessions)
- Participant management for researchers

---

## Slide 2: The Challenge

**Problem:** We need participants to use AI APIs, but we can't give them the API keys.

- API keys embedded in desktop apps can be extracted
- Students could use the keys outside the lab
- This would incur unexpected costs and compromise the study

**Solution:** API keys are stored in a PostgreSQL database and distributed to participants at login via a secure database function. Participants never see or have direct access to the key table.

---

## Slide 3: Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        LAB COMPUTERS                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Participant 1  │  │  Participant 2  │  │  Participant N  │  │
│  │  Desktop App    │  │  Desktop App    │  │  Desktop App    │  │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  │
└───────────┼────────────────────┼────────────────────┼───────────┘
            │                    │                    │
            ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLOUD SERVICES                             │
│                                                                 │
│   ┌─────────────────┐                          ┌───────────┐   │
│   │    Scaleway     │   assign_api_key()        │  Admin    │   │
│   │    Database     │──────────────────────┐    │  Panel    │   │
│   │   (PostgreSQL)  │                      │    │  (Web)    │   │
│   └────────┬────────┘                      │    └─────┬─────┘   │
│            │                               │          │         │
│            │  ┌─────────────┐              │          │         │
│            │  │   Claude    │◀─────────────┤          │         │
│            └─▶│   OpenAI    │  (direct API │          │         │
│               │   APIs      │   calls with │          │         │
│               └─────────────┘   pool keys) │          │         │
│                                            │          │         │
│            Desktop Apps ───────────────────▶│          │         │
│            (direct DB connection)           │          │         │
└─────────────────────────────────────────────────────────────────┘
```

**Flow:** Desktop App → Scaleway DB → `assign_api_key()` → APIs directly

---

## Slide 4: What is Scaleway?

**Scaleway** is a European cloud provider based in Paris, France.

**Think of it as:** A place to store all our data, fully within the EU.

**Why we chose Scaleway over US providers (AWS, Google Cloud):**

| Concern | Scaleway Advantage |
|---------|-------------------|
| GDPR compliance | French company, EU data centers only |
| Data residency | Data never leaves EU (Paris, Amsterdam) |
| US CLOUD Act | Not subject to US government data requests |
| Ethics approval | Easier to justify to ethics committees |

**Our use:** PostgreSQL database storing:
- Participant accounts
- API key pools (securely distributed at login)
- Conversation logs
- Generated files (images, code, etc.)

**Cost:** ~€15-25/month (scales to zero when not in use)

---

## Slide 5: Security Model

### Three Layers of Protection

**Layer 1: Database Key Pool**
- Real API keys stored only in the database (never on participant machines)
- Participants call a `SECURITY DEFINER` function to get a key at login
- They cannot directly query the `api_keys` table
- Keys are load-balanced across participants and usage is audited

**Layer 2: Database Authentication**
- Each participant gets unique database username/password
- Credentials entered at app login
- Invalid credentials = no access

**Layer 3: Row-Level Security (RLS)**
- Even with valid login, participants can only see their own data
- Enforced by the database itself, not application code
- Participant A cannot see Participant B's conversations, even if they try

```
Participant_001 runs: SELECT * FROM api_keys;
Database returns:     ERROR: permission denied for table api_keys

Participant_001 runs: SELECT assign_api_key('anthropic');
Database returns:     sk-ant-...  (least-used key for their condition)
```

---

## Slide 6: Data Flow - During Experiment

```
1. Participant logs into desktop app
   └─▶ App connects to database with participant credentials
       └─▶ App calls assign_api_key() to get API keys for their condition
           └─▶ Keys cached in memory for the session

2. Participant sends message to AI
   └─▶ App calls Claude/OpenAI API directly (using pool key)
       └─▶ Response streamed back to app

3. Conversation logged automatically
   └─▶ App saves message + response to database
       └─▶ Any generated files (images, code) saved as well

4. If an API becomes unreachable mid-session
   └─▶ App can switch to another provider via keyPool.switchProvider()
```

---

## Slide 7: Admin Panel (Researcher Interface)

A simple web application for researchers to manage the study.

### Features

| Function | Description |
|----------|-------------|
| **Participant Management** | Create accounts, generate credentials, assign to conditions |
| **Condition Management** | Define experiment conditions (claude-only, openai-only, both) |
| **Key Pool Management** | Add/remove API keys, assign to condition pools |
| **Session Monitoring** | See active sessions, key assignment audit log |
| **Data Export** | Download conversations, artifacts for analysis |
| **Experiment Control** | Enable/disable access for all participants |

### Implementation

This can be built with off-the-shelf tools:

- **Retool / Appsmith**: Drag-and-drop admin panel builders
- **Django Admin**: Python framework with built-in admin interface
- **Simple custom app**: Basic CRUD operations, ~1-2 days development

The admin panel connects to the same Scaleway database with full access privileges.

---

## Slide 8: What Researchers Control

| Before Experiment | During Experiment | After Experiment |
|-------------------|-------------------|------------------|
| Create participant accounts | Monitor active sessions | Export all data |
| Define experiment conditions | View key usage statistics | Analyze conversations |
| Configure API key pools | Revoke access if needed | Download artifacts |
| Set token expiration dates | See errors/issues | Generate reports |

---

## Slide 9: Desktop Application

**Technology:** Electron (cross-platform: Windows, Mac, Linux)

**Features:**
- Chat interface for AI interaction
- Code execution with live streaming
- File upload/download
- Automatic conversation logging
- Login with participant credentials

**What participants see:**
- Simple chat interface
- Their own conversation history
- Generated images/files

**What participants cannot do:**
- Access other participants' data
- Use the AI outside the app
- Extract API credentials (keys exist only in DB and in-memory during session)

---

## Slide 10: Data Storage

### What Gets Stored

| Data Type | Storage | Example |
|-----------|---------|---------|
| Conversations | Database (text) | Messages between participant and AI |
| Metadata | Database (JSON) | Timestamps, token usage, model used |
| Images | Database (binary) | Charts, plots generated by AI |
| Code files | Database (binary) | Python scripts, CSVs created |
| Participant info | Database (text) | Username, condition, session times |
| Key assignments | Database (audit log) | Which key was assigned to whom and when |

### Storage Estimate

- 400 participants × 2 hours each
- Worst case: 1MB/minute of artifacts
- **Total: ~48GB** (well within limits)

### Data Retention

- All data preserved for research analysis
- "Deleted" messages only hidden, not removed
- Full audit trail maintained

---

## Slide 11: Cost Summary

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **Scaleway Database** | Data storage, auth, key pool | €15-25 |
| **Claude API** | AI responses | Variable* |
| **OpenAI API** | AI responses | Variable* |

*API costs depend on usage (tokens consumed, code execution time)

**Infrastructure cost: ~€20/month**

---

## Slide 12: Compliance & Ethics

### GDPR Compliance

- Data stored in EU (Paris, France)
- European company (Scaleway)
- No US CLOUD Act exposure
- Data isolation between participants
- Full audit trail
- Data export capability

### For Ethics Application

- Clear data flow documentation
- Participant data isolation guaranteed by database
- No third-party access to conversation data
- API providers only see anonymized requests (no participant identifiers)
- API keys are never stored on participant machines

---

## Slide 13: Implementation Timeline

| Phase | Tasks | Duration |
|-------|-------|----------|
| **1. Infrastructure** | Set up Scaleway DB, key pools, conditions | 1 week |
| **2. Desktop App** | Build Electron app with chat interface | 2-3 weeks |
| **3. Admin Panel** | Participant/token/key pool management | 1 week |
| **4. Testing** | Security testing, load testing | 1 week |
| **5. Pilot** | Small-scale trial run | 1 week |

**Total: 6-8 weeks**

---

## Slide 14: Summary

### What We're Proposing

1. **Secure API access** via database key pool (keys never on participant machines)
2. **EU-hosted database** on Scaleway (GDPR compliant)
3. **Per-participant isolation** via PostgreSQL Row-Level Security
4. **Experiment conditions** with per-condition API key pools
5. **Simple admin panel** for researcher control
6. **Cross-platform desktop app** for participants

### Key Benefits

- Participants cannot steal API credentials
- All data stays in EU
- Complete conversation logging for research
- Low infrastructure cost (~€20/month)
- Researchers have full control
- No external proxy service needed — simpler architecture

---

## Slide 15: Questions?

### Documentation Available

- `database-plan.md` - Database schema, key pool, and security
- `anthropic-client-module.md` - Claude API integration
- `openai-client-module.md` - OpenAI API integration

### Next Steps

1. Confirm requirements
2. Set up Scaleway cloud account
3. Begin development
