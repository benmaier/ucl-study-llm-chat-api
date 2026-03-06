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

**Solution:** A secure architecture that keeps API keys on our servers, not on participant machines.

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
│   ┌─────────────┐        ┌─────────────┐        ┌───────────┐   │
│   │   Vercel    │───────▶│   Claude    │        │  Admin    │   │
│   │   Proxy     │───────▶│   OpenAI    │        │  Panel    │   │
│   │  (Gateway)  │        │   APIs      │        │  (Web)    │   │
│   └──────┬──────┘        └─────────────┘        └─────┬─────┘   │
│          │                                            │         │
│          │         ┌─────────────────┐                │         │
│          └────────▶│    Scaleway     │◀───────────────┘         │
│                    │    Database     │                          │
│                    │   (PostgreSQL)  │◀──── Desktop Apps        │
│                    └─────────────────┘       (direct connection)│
└─────────────────────────────────────────────────────────────────┘
```

---

## Slide 4: What is Vercel?

**Vercel** is a cloud platform for hosting web applications and serverless functions.

**Think of it as:** A middleman that receives requests, does something with them, and passes them on.

**Why we use it:**

| Feature | Benefit |
|---------|---------|
| Serverless functions | Only runs (and costs money) when actually used |
| Auto-scaling | Handles 1 or 100 participants without configuration |
| HTTPS included | Secure connections out of the box |
| Simple deployment | Push code to GitHub → automatically deployed |

**Our use:** A simple "proxy" that:
1. Receives requests from the desktop app
2. Checks if the participant token is valid
3. Adds the real API key
4. Forwards to Claude/OpenAI
5. Returns the response

**Cost:** Free tier sufficient for this project (~100 hours/month compute)

---

## Slide 5: What is Scaleway?

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
- Conversation logs
- Generated files (images, code, etc.)

**Cost:** ~€15-25/month (scales to zero when not in use)

---

## Slide 6: Security Model

### Three Layers of Protection

**Layer 1: API Proxy**
- Real API keys stored only on Vercel (never on participant machines)
- Participants use "lab tokens" that only work through our proxy
- Tokens can be deactivated instantly

**Layer 2: Database Authentication**
- Each participant gets unique database username/password
- Credentials entered at app login
- Invalid credentials = no access

**Layer 3: Row-Level Security (RLS)**
- Even with valid login, participants can only see their own data
- Enforced by the database itself, not application code
- Participant A cannot see Participant B's conversations, even if they try

```
Participant_001 runs: SELECT * FROM messages;
Database returns:     Only Participant_001's messages (automatic filtering)
```

---

## Slide 7: Data Flow - During Experiment

```
1. Participant logs into desktop app
   └─▶ App connects to database with participant credentials

2. Participant sends message to AI
   └─▶ App sends request to Vercel proxy (with lab token)
       └─▶ Proxy validates token
           └─▶ Proxy adds real API key
               └─▶ Request sent to Claude/OpenAI
                   └─▶ Response streamed back to app

3. Conversation logged automatically
   └─▶ App saves message + response to database
       └─▶ Any generated files (images, code) saved as well
```

---

## Slide 8: Admin Panel (Researcher Interface)

A simple web application for researchers to manage the study.

### Features

| Function | Description |
|----------|-------------|
| **Participant Management** | Create accounts, generate credentials, assign to conditions |
| **Token Management** | Generate/revoke API access tokens |
| **Session Monitoring** | See active sessions, usage statistics |
| **Data Export** | Download conversations, artifacts for analysis |
| **Experiment Control** | Enable/disable access for all participants |

### Implementation

This can be built with off-the-shelf tools:

- **Retool / Appsmith**: Drag-and-drop admin panel builders
- **Django Admin**: Python framework with built-in admin interface
- **Simple custom app**: Basic CRUD operations, ~1-2 days development

The admin panel connects to the same Scaleway database with full access privileges.

---

## Slide 9: What Researchers Control

| Before Experiment | During Experiment | After Experiment |
|-------------------|-------------------|------------------|
| Create participant accounts | Monitor active sessions | Export all data |
| Generate unique credentials | View usage statistics | Analyze conversations |
| Configure experiment conditions | Revoke access if needed | Download artifacts |
| Set token expiration dates | See errors/issues | Generate reports |

---

## Slide 10: Desktop Application

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
- Extract API credentials

---

## Slide 11: Data Storage

### What Gets Stored

| Data Type | Storage | Example |
|-----------|---------|---------|
| Conversations | Database (text) | Messages between participant and AI |
| Metadata | Database (JSON) | Timestamps, token usage, model used |
| Images | Database (binary) | Charts, plots generated by AI |
| Code files | Database (binary) | Python scripts, CSVs created |
| Participant info | Database (text) | Username, condition, session times |

### Storage Estimate

- 400 participants × 2 hours each
- Worst case: 1MB/minute of artifacts
- **Total: ~48GB** (well within limits)

### Data Retention

- All data preserved for research analysis
- "Deleted" messages only hidden, not removed
- Full audit trail maintained

---

## Slide 12: Cost Summary

| Service | Purpose | Monthly Cost |
|---------|---------|--------------|
| **Scaleway Database** | Data storage, auth | €15-25 |
| **Vercel Proxy** | API gateway | €0 (free tier) |
| **Claude API** | AI responses | Variable* |
| **OpenAI API** | AI responses | Variable* |

*API costs depend on usage (tokens consumed, code execution time)

**Infrastructure cost: ~€20/month**

---

## Slide 13: Compliance & Ethics

### GDPR Compliance

✅ Data stored in EU (Paris, France)
✅ European company (Scaleway)
✅ No US CLOUD Act exposure
✅ Data isolation between participants
✅ Full audit trail
✅ Data export capability

### For Ethics Application

- Clear data flow documentation
- Participant data isolation guaranteed by database
- No third-party access to conversation data
- API providers only see anonymized requests (no participant identifiers)

---

## Slide 14: Implementation Timeline

| Phase | Tasks | Duration |
|-------|-------|----------|
| **1. Infrastructure** | Set up Scaleway DB, Vercel proxy | 1 week |
| **2. Desktop App** | Build Electron app with chat interface | 2-3 weeks |
| **3. Admin Panel** | Participant/token management | 1 week |
| **4. Testing** | Security testing, load testing | 1 week |
| **5. Pilot** | Small-scale trial run | 1 week |

**Total: 6-8 weeks**

---

## Slide 15: Summary

### What We're Proposing

1. **Secure API access** via Vercel proxy (keys never on participant machines)
2. **EU-hosted database** on Scaleway (GDPR compliant)
3. **Per-participant isolation** via PostgreSQL Row-Level Security
4. **Simple admin panel** for researcher control
5. **Cross-platform desktop app** for participants

### Key Benefits

- ✅ Participants cannot steal API credentials
- ✅ All data stays in EU
- ✅ Complete conversation logging for research
- ✅ Low infrastructure cost (~€20/month)
- ✅ Researchers have full control

---

## Slide 16: Questions?

### Documentation Available

- `proxy-plan.md` - Technical details of API proxy
- `database-plan.md` - Database schema and security
- `anthropic-client-module.md` - Claude API integration
- `openai-client-module.md` - OpenAI API integration

### Next Steps

1. Confirm requirements
2. Set up cloud accounts (Scaleway, Vercel)
3. Begin development
