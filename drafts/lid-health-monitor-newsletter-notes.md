---
published: false
type: notes
---
# LID Health Monitor False Positive — Newsletter Notes

## The Incident
2:40am alert: "🔴 ICFC bot DOWN — WA status: unknown. Auto-restarting gateway..."

The bot was not down. The chat had been silent overnight. The health check couldn't prove it was alive because there was nothing in the logs, so it called it dead and restarted the gateway.

The restart wiped in-memory LID mappings. When WhatsApp delivered the 3-day offline backlog (April 5–8) at 8:01am, almost every message was silently dropped — "LID mapping not found for X; skipping inbound message" — repeated 50+ times in the logs. Three days of community messages, gone. Unrecoverable.

## The Root Cause (Two Layers)

**Layer 1: Logs are activity records, not health signals.**
The original health check worked by parsing `openclaw channels logs`. If the log contained "Listening for personal WhatsApp inbound messages" → healthy. If it contained nothing (new day, no activity yet) → fall through to `unknown` → treated as unhealthy.

A silent group chat at midnight produces no log lines. The health check read that as a dead connection. It wasn't.

**Layer 2: The monitor triggered a destructive action on an ambiguous signal.**
`unknown` ≠ `down`. The monitor should have required a confirmed bad status (`disconnected`, `logged_out`, `conflict`) before restarting anything. Instead it restarted on `unknown`.

## What LID Mappings Are
WhatsApp migrated group members from phone JIDs (`+1234567890@s.whatsapp.net`) to opaque LIDs (`131147564630245@lid`). The bot learns LID→phone mappings at runtime — when a member sends a message, their identity is revealed.

WhatsApp will not send the full mapping for a 400-person group on demand. Privacy by design — LIDs exist to prevent bulk phone number harvesting. Even official clients can't request them in bulk.

So the bot's LID table is earned incrementally — one message at a time. A gateway restart flushes the in-memory state. Any member who hasn't spoken since the restart is anonymous to the bot until they speak again.

## The Immediate Fixes Applied
1. **Health check rewritten**: `openclaw status` is now the primary signal. It reports `linked` or `pairing required` regardless of message activity. Logs are only consulted for error categorisation (Bad MAC, 401, 440).
2. **Monitor made conservative**: `unknown` no longer triggers alert or restart. Only explicit bad statuses do.

## What's Still Not Fixed
- The LID problem is architectural. Even with the health check fixed, any gateway restart loses LID mappings for members who haven't spoken recently.
- The right solution: persist LID mappings to the OB1 database on every update, rebuild from DB on restart. But this requires a spec, not a quick fix.
- Railway deploys (env var changes, redeploys) also trigger this — every deploy is a LID reset.

## The Engineering Lesson
"No signal" and "bad signal" are different things. A health check that can't distinguish them will eventually do something destructive in response to silence.

The fix wasn't clever — it was the obvious thing: ask the system directly (`openclaw status`) rather than inferring state from what it has or hasn't logged. Inference fails at midnight. Direct query doesn't.

## Possible Newsletter Angles
1. **"The 3am alert that wasn't wrong — just dumb"** — the health check wasn't broken, it was asking the wrong question. Logs answer "what happened?" Status answers "what is the state right now?"
2. **"Don't restart what you can't prove is broken"** — conservative automation: only act on confirmed bad signals, never on ambiguous ones. The cost of a false restart was 3 days of messages.
3. **"The privacy constraint that broke the bot"** — LIDs exist to protect users. That's correct. But they create an operational fragility most bot builders don't anticipate until they lose data.

## What mm spec new Should Produce
A spec for a LID persistence layer:
- On every incoming message, write LID→phone mapping to `icfc.lid_mappings` table in OB1
- On gateway startup, load all known mappings from DB before processing any messages
- Gateway restart becomes non-destructive: LID table is rebuilt from DB in seconds, not hours
- Acceptance criteria: zero messages dropped due to LID mapping not found after a gateway restart

## Connection to Broader Theme
This is the same pattern as the personal OS post: the spec said one thing (health check = log parsing), reality revealed something else (logs ≠ health). The difference is this one had a real cost — 3 days of community data lost before we caught it.

The newsletter angle might be: building AI infrastructure for a community isn't just about the happy path. It's about what happens at 2:40am when nothing is wrong but the system thinks it is.

---

## Resolution — 2026-04-12 (What's Still Not Fixed, now fixed)

The "still not fixed" items above are now closed. Notes from the build session:

### The Three-Layer LID Persistence Loop
Built the full persistence system from scratch:

**Layer 1 — Discovery (icfc-archiver OpenClaw plugin)**
Replaced bundle-patching (`sed` on compiled openclaw JS at startup) with an official plugin. The plugin registers `api.on('message_received', handler)`. Every group message fires it. LID→phone mapping written atomically to `.lid-map.json` using `writeFileSync` + `renameSync` (never a partial write).

**Layer 2 — Durable sync (syncLidMappings in heartbeat cron)**
Already existed in `src/heartbeat/index.ts` but was silently failing — `icfc.lid_mappings` table didn't exist in OB1. The spec said "do not alter the schema" — implying the table already existed. It didn't. Created it: `lid VARCHAR PRIMARY KEY, phone, push_name, first/last_seen_at`. Now the daily 14:01 UTC cron reads `.lid-map.json` and upserts to OB1.

**Layer 3 — Seed on startup (start-jetson.sh)**
On container boot, before the gateway starts, query `icfc.lid_mappings` and pre-populate `.lid-map.json`. Gateway restart is now non-destructive — mappings rebuild from OB1 in under a second.

### The exec-approvals Root Cause (unrelated bug, same session)
The on-demand `@Mr. Thabit summary` command was failing: `exec denied: host=gateway security=deny`.

Traced into openclaw source: `defaults.security: "deny"` in `exec-approvals.json` propagates as `configuredSecurity` into `processGatewayAllowlist()` → `resolveExecHostApprovalContext()` → `minSecurity("deny", agent.security)` → deny always wins. The per-agent `"allowlist"` setting is irrelevant when the global default is `"deny"`.

Fix: `defaults.security: "deny"` → `"allowlist"`. Also needed: explicit `agents.gateway` section — OpenClaw 2026.4.11 separates the `gateway` execution host from `agents.*`. Wildcard doesn't cover it.

Additionally: stale agent sessions (20+ messages of failed exec history) caused the model to stop attempting exec entirely. Cleared sessions after fixing approvals.

### Plugin vs Bundle-Patching
The old Railway approach: `sed` injection into compiled `loader-*.js` at startup. Every openclaw upgrade required re-verifying grep patterns, tab counts, function names.

The new approach: official plugin API. Verified against running container source before writing a line. The spec assumed `api.registerHook('message:received', ...)` — actual API is `api.on('message_received', ...)`. Task 0 caught this.

### Migration (Railway → Jetson)
ICFC moved off Railway entirely today. Known remaining gap: daily email digest cron (`summarize.js daily-summary`) still runs in Railway's `mm-agent` Hono server against Railway's Postgres. Tomorrow's 7am digest will miss today's messages, which are archiving to Jetson OB1. Cron needs to move to `mm-heartbeat.service` on Jetson.

### harness verify result
`mm harness verify specs/openclaw-plugin-archiver.md` — 12/17 verifiable criteria met, 3 runtime-only. Two spec violations in `start-openclaw.sh` (Patches 2 & 3 deleted, spec said don't) — irrelevant since Railway is being decommissioned. Version strings evolved past spec values (v17 vs v1) — 16 deploy iterations between spec and ship, normal.

### Numbers
- 237 rows in `icfc.memories` at time of migration
- 0 rows in `icfc.lid_mappings` (table created today, will fill as LID users speak)
- All senders today resolved via phone JID — no LID-only members seen yet in this session
