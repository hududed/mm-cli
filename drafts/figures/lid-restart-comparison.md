# Figure 1 — LID Persistence: Restart Without vs. With Persistence Layer

## ASCII version (for reference / designer handoff)

```
WITHOUT PERSISTENCE LAYER
─────────────────────────

  Weeks of operation          Gateway restarts           Members speak again
  ┌─────────────────┐         ┌──────────────┐           ┌────────────────┐
  │  Members speak  │──────▶  │  In-memory   │──wipe──▶  │  LID unknown   │
  │  LIDs learned   │         │  map flushed │           │  Message: DROP │
  │  (in-memory)    │         └──────────────┘           │  (silent)      │
  └─────────────────┘                                    └────────────────┘

  Result: Every restart = days of silently dropped messages
          until members re-identify themselves by speaking


WITH PERSISTENCE LAYER (three layers)
──────────────────────────────────────

  Layer 1: Discovery          Layer 2: Sync               Layer 3: Seed
  ┌─────────────────┐         ┌──────────────┐            ┌─────────────────┐
  │  Member speaks  │──────▶  │ .lid-map.json│──daily──▶  │ icfc.lid_       │
  │  LID resolved   │         │  (local file)│   cron     │ mappings (OB1)  │
  │  → file write   │         └──────────────┘            │ (Postgres)      │
  └─────────────────┘                                     └────────┬────────┘
                                                                   │
                              Gateway restarts                     │ on startup
                              ┌──────────────┐                    │
                              │  Seed from   │◀───────────────────┘
                              │  OB1 (< 1s)  │
                              │  Map intact  │
                              └──────┬───────┘
                                     │
                              ┌──────▼───────┐
                              │  LID known   │
                              │  Message: ✓  │
                              └──────────────┘

  Result: Restart is non-destructive. Mappings rebuild from Postgres
          in under a second before the first message is processed.
```

## Design notes for illustrator

Two-column layout. Left column = "Before" (red/warning palette). Right column = "After" (green/calm palette).

**Left column — Before:**
- Top: speech bubble icon → box labeled "In-memory map" (RAM icon)
- Arrow: "Gateway restart" (lightning bolt or reload icon) → box with ✗ "Map wiped"
- Arrow down → message bubble with ✗ "Message dropped (silent)"
- Label at bottom: "State lost on every restart"

**Right column — After:**
- Three stacked layers with arrows flowing down then looping back up:
  1. Speech bubble → `.lid-map.json` (file icon) — labeled "1. Discovery"
  2. `.lid-map.json` → Postgres cylinder (OB1) — labeled "2. Daily sync"
  3. Postgres → Gateway startup (power icon) — labeled "3. Seed on boot"
- "Gateway restart" lightning bolt → arrow to Postgres → "Restored in < 1s"
- Message bubble with ✓ "Message delivered"
- Label at bottom: "Restart is non-destructive"

**Caption:** "A gateway restart without persistence flushes weeks of learned identity mappings. The three-layer architecture — discovery, sync, seed — means every restart begins as informed as the moment before it."
