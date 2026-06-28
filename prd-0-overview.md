# PRD-0: Crusade Master App — Overview (v3)

> Shared architecture, data model, MVP scope. v3 reflects the locked stack (Hapi/Node/TS, BullMQ + Python parser subprocess, configurable rules engine).

---

## 1. Background and Goals

### 1.1 Background

Warhammer 40,000 Crusade is a narrative play mode where units gain experience, ranks, and battle honors across linked games. Group Crusade administration requires a "Crusade Master" to coordinate, verify, and enforce rules across 4–16 players over weeks/months.

Players prep their lists in New Recruit. NR handles list construction and basic UI rule checks, but offers no **enforcement** tooling: nothing tells a CM "this player added a unit without a requisition," "this roster exceeds the campaign point cap," or "this battle was filed against an out-of-date roster."

The user's existing `bs-roster-parser` Python library already handles the messy BattleScribe / New Recruit JSON parsing. The app is the **enforcement, diff, and timeline layer** that consumes the parser's output, runs configurable rule checks, and produces a queryable event timeline.

### 1.2 Goals

| Goal | Metric | Target |
|------|--------|--------|
| **Business**: self-hosted multi-tenant app | Instances running ≥ 1 active campaign | 50+ within 6 months of v1 |
| **User (CM)**: cut per-battle admin time | Time CM spends per post-battle update | < 2 min |
| **User (Player)**: roster compliance before submission | % of battle filings passing first-try approval | > 85% |
| **Product**: data ownership | % of user data exportable in open formats | 100% (JSON + CSV) |

### 1.3 MVP Scope

- **Crusade supplement**: *Crusade: Armageddon* (10th Edition, 128pp, June 2025) — the only supplement supported at MVP
- **Edition**: 10th Edition only
- **Other 10th-ed supplements** (Leviathan, Tyrannic War, Pariah Nexus, Nachmund Gauntlet) are out of scope at MVP; data model is schema-ready, UI is not

---

## 2. User Types

| User | Scope |
|------|-------|
| **Instance Admin** | All tenants on the self-hosted Docker instance |
| **Crusade Master (CM)** | One tenant, can own multiple campaigns; can also be a Player |
| **Player** | One tenant, can join multiple campaigns |
| **Spectator (read-only)** | Public campaigns (cross-tenant if `allow_cross_tenant_spectators: true`) |

A user can hold multiple roles. A CM playing in their own campaign gets a "playing in your own campaign" badge; their own approvals self-approve with audit log if no co-CM exists.

---

## 3. Architecture

### 3.1 Tech Stack (locked v3)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | **Vite + Vue 3** + TypeScript + Tailwind + Pinia | Vue chosen for Hapi integration ergonomics; revisable |
| Backend | **@hapi/hapi** (Node.js 22 LTS) + TypeScript | Hapi 21.x; plugin-based |
| Database | PostgreSQL 16 | Row-level security for tenant isolation |
| Object storage | MinIO | S3-compatible; for raw JSON blobs, generated PDFs, avatars |
| Queue | **BullMQ** + Redis 7 | Async roster parsing, rule checks, notifications |
| Auth | Magic-link email (or OIDC via env-var) | No passwords |
| **Parser** | **Python 3.10+ subprocess** running `bs-roster-parser` | User's existing library; not rewritten in TS |
| Deployment | Docker Compose (single-node MVP) | Self-hosted |
| Background worker | Node/TS process running BullMQ consumers | One or more, scales independently |

### 3.2 Components

```
┌──────────────────────────────────────────────────────────────┐
│                  Frontend (Vite + Vue 3 SPA)                  │
│  TypeScript + Tailwind + Pinia + IndexedDB cache             │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTPS / JSON
┌──────────────────▼───────────────────────────────────────────┐
│                  Hapi backend (Node 22, TypeScript)          │
│  Plugins: auth, campaigns, rosters, battles, approvals,      │
│           events, admin                                       │
└──┬───────────────┬───────────────────┬───────────────┬───────┘
   │               │                   │               │
┌──▼──────┐  ┌─────▼──────┐  ┌─────────▼──────┐  ┌─────▼────┐
│Postgres │  │   MinIO    │  │  Redis +       │  │  SMTP    │
│+ RLS    │  │ (S3 API)   │  │  BullMQ        │  │ (magic   │
│         │  │            │  │                │  │  link)   │
└─────────┘  └────────────┘  └───────┬────────┘  └──────────┘
                                     │
                          ┌──────────▼──────────┐
                          │  Worker process(es) │
                          │  (Node/TS, BullMQ)  │
                          │  - parse-job        │
                          │  - rule-check-job   │
                          │  - wahapedia-refresh│
                          │  - email-sender     │
                          └──────────┬──────────┘
                                     │ subprocess
                          ┌──────────▼──────────┐
                          │  Python parser      │
                          │  bs-roster-parser   │
                          │  via stdio JSON     │
                          └─────────────────────┘
```

### 3.3 Roster Import Pipeline (the load-bearing flow)

```mermaid
flowchart LR
    A[Player uploads .json] --> B[Hapi: validate, store blob in MinIO]
    B --> C[BullMQ: enqueue parse-job with blobId + rosterId]
    C --> D[Worker: download blob]
    D --> E[Worker: spawn python -m bs_roster_parser with stdin]
    E --> F[Python: emit RosterSummary.to_dict on stdout]
    F --> G[Worker: parse stdout JSON]
    G --> H[Worker: app-side pass for Order of Battle / requisitions]
    H --> I[Worker: write RosterDraft to Postgres]
    I --> J[Worker: enqueue diff-job with new + lastApproved]
    J --> K[Worker diff: compute Delta set]
    K --> L[Worker rule-check: run configured rules]
    L --> M[Worker: write RuleCheck records, update RosterDraft.status=pending_review]
    M --> N[Worker: notify player (in-app + email)]
```

Each step is idempotent and re-runnable on failure. The blob in MinIO is the source of truth — re-running the pipeline from any step is a no-op or a re-process, never a re-upload.

### 3.4 Tenancy Model

Multi-tenant on a single Docker instance:

- Every domain table has `tenant_id UUID NOT NULL` with row-level security policies
- Wahapedia data, parser output schema, and reference data are shared across all tenants
- A user belongs to one tenant (per-`User` row); a CM can be CM of multiple campaigns within their tenant
- Instance Admin is the only cross-tenant role

### 3.5 Wahapedia Integration

- Nightly BullMQ-delayed job refreshes `https://wahapedia.ru/wh40k10ed/*.csv` and export spec XLSX
- Cached, diff'd, republished to all tenants
- Per-tenant override not supported

---

## 4. Shared Data Model

```ts
// === Tenancy ===
Tenant { id, name, slug, createdAt, settings }
User { id, tenantId, email, displayName, roles, createdAt }
Roles = 'instance_admin' | 'cm' | 'player' | 'spectator'   // user can hold multiple

// === Campaign ===
// Teams are MANDATORY in v1: every campaign has at least one team. Free-for-all
// mode is out of scope.
Campaign { id, tenantId, name, supplementId, cmUserId, status, settings, createdAt }
CampaignTeam {
  id, campaignId, name, description, color, narrativeLogFilter,
  // Narrative intent: which 40K factions fit this team's story. NOT enforced
  // by the app — the rule engine surfaces a soft warn, and the CM has final
  // approval on every roster. Books (e.g., Armageddon) ship with these pre-filled.
  expectedFactionIds: string[] | null
}
CampaignMember { id, campaignId, userId, joinedAt, status, factionId, teamId: CampaignTeam['id'] }

// === Roster (state machine) ===
Roster {
  id, campaignId, ownerUserId, factionId, name,
  teamId,                                  // snapshotted from CampaignMember at creation;
                                          // re-associating to a new team requires CM action
  currentDraftId, currentApprovedId
}
RosterDraft {
  id, rosterId,
  sourceJsonBlobId,                  // MinIO key
  sourceParserVersion,               // e.g. 'bs-roster-parser@1.0.0'
  parserOutputJson,                  // the RosterSummary.to_dict() snapshot
  appParseOutputJson,                // app-side extraction (Order of Battle, requisitions, honours)
  status: 'parsing' | 'pending_review' | 'pending_approval' | 'rejected' | 'failed',
  createdAt,
  parseError?: string,
}
RosterApproved {
  id, rosterId, sourceDraftId, approvedAt, approvedByUserId,
  snapshot, pointLimit,
  // Snapshotted at approval time so the historical record keeps the team/faction
  // alignment even if the player later switches teams or factions.
  factionId, teamId,
  activeRosterApprovedId?
}
RosterApprovalHistory { rosterId, approvedId, approvedAt, approvedByUserId }  // chron. list

// === Crusade state (lives on RosterApproved or on app-extracted draft data) ===
CrusadeForceState { supplementId, supplyLimit?, logisticsPoints?, battleTally, victories, requisitions, alignment?, ... }

// === Battles ===
Battle {
  id, campaignId,
  playerAId, playerBId,
  scheduledAt, status, resultA, resultB, missionId,
  approvedRosterIdA, approvedRosterIdB  // pinned at battle time
}
BattleUpdate { id, battleId, submittedByUserId, submittedAt, status }

// === Rule engine ===
RuleDefinition { id, tenantId, scope: 'builtin' | 'cm' | 'crusade', authorUserId?, campaignId?, ruleKey, config, enabled, severity }
RuleCheck { id, draftId, runId, kind, status: 'pass' | 'warn' | 'fail', details }

// === Events (unified timeline) ===
Event { id, tenantId, campaignId, kind, occurredAt, actorUserId, targetType, targetId, payload, delta, visibility, activeRosterApprovedId }
Delta { id, eventId, entityType, entityId, field, beforeValue, afterValue, reason }

// === Approval ===
ApprovalRequest { id, tenantId, campaignId, kind, submittedByUserId, payload, status, reviewerUserId, decidedAt, decisionReason, contextHash, ruleCheckIds, activeRosterApprovedId }

// === Queue / async ===
JobRecord { id, kind, payload, status, attempts, lastError, resultRef, enqueuedAt, completedAt }

// === Audit ===
AuditLog { id, tenantId, actorUserId, action, targetType, targetId, payload, occurredAt }
```

**Identifiers**: UUIDv7.

---

## 5. Subsystem PRDs

| PRD | Subsystem | v3 change |
|-----|-----------|-----------|
| PRD-1 | Instance Admin & CM Administration | Stack mentions Hapi; minor |
| PRD-2 | Player Sign-Up | Stack mentions Hapi; minor |
| PRD-3 | Roster Import, Approval, & Rule Compliance | **Major rewrite** — BullMQ pipeline, parser integration contract, configurable rule engine |
| PRD-4 | Events, Submissions, & Timeline | Async pipeline acknowledged in event flow |
| PRD-5 | Approval System | Now feeds from rule-check results from the worker |

---

## 6. Success Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Time-to-first-approved-roster | Player joins → first RosterApproved | < 30 min |
| CM admin time per battle | CM time per battle approval | < 2 min |
| First-try approval rate | Battle filings passing CM approval on first review | > 85% |
| Rule-check catch rate | Rule violations caught automatically vs. by CM manual review | > 95% |
| Parse pipeline throughput | Roster imports completed per minute per worker | > 30 |
| Parse pipeline latency | Player uploads → RosterDraft ready | < 30s p95 |
| Data freshness (Wahapedia) | Time from Wahapedia update to reflected | < 24h |
| Tenant density | Campaigns per tenant | > 2 |

---

## 7. Non-Goals (MVP)

- ❌ Matched Play / non-Crusade 40K rules
- ❌ Tournament pairings engine
- ❌ Mobile native apps (web-only, mobile-responsive)
- ❌ Real-time push (email + in-app only)
- ❌ 9th-ed Crusade support, 11th-edition rules
- ❌ Other Games Workshop systems (AoS, Kill Team, HH)
- ❌ NR URL fetch / scraping (JSON upload only)
- ❌ Rewriting the Python parser in TypeScript (subprocess is the contract)

---

## 8. Open Questions

| Question | Default | Owner |
|----------|---------|-------|
| ORM choice (Prisma vs Drizzle vs Kysely) | TBD by backend lead — Drizzle recommended for Hapi + strict typing | TBD |
| Frontend: Vue 3 vs React? | Vue 3 (better Hapi integration) | TBD |
| Sidecar Python vs subprocess per job? | Subprocess per job (simpler ops; promote to sidecar if latency demands) | TBD |
| Multi-node deployment | Single-node MVP; Docker Swarm docs in v1.1 | TBD |
| Cross-tenant spectator campaigns | Disabled by default; per-campaign toggle | TBD |

---

## 9. v2 → v3 Changes

| What | Why |
|------|-----|
| Backend: FastAPI (Python) → **@hapi/hapi (Node 22, TypeScript)** | Per user — "I strongly prefer a node/typescript system" |
| Added **BullMQ + Redis** for async pipeline | Per user — "I think we use a queue to parse them. Maybe BullMQ" |
| Added **Python parser as subprocess** called from Node worker | Per user — existing `bs-roster-parser` library is Python, "can be adapted" |
| Added **configurable rule engine** with CM-defined and crusade-defined rules | Per user — "These rules need to also be configurable later by the cm and by crusade" |
| PRD-3 parse pipeline re-architected: upload → MinIO → BullMQ → worker → python → diff → rule-check → notify | The async pipeline is the load-bearing flow |

---

## 10. v1 → v2 changes (for history)

See CHANGELOG in README. Major: stack, multi-tenancy, MVP scope, roster state machine, submission gating, event timeline.

---

## 11. References

- *Crusade: Armageddon*, Games Workshop, June 2025, 128pp, 10th-edition supplement
- Wahapedia × 10th-ed Crusade data reference (companion research doc)
- `bs-roster-parser` Python library (the user's existing tool)
- New Recruit JSON export format (BattleScribe schema dialect)
- Administratum (Goonhammer) — closest commercial competitor
- ServoCrypt — closest open collaborative competitor
- Hapi docs: https://hapi.dev
- BullMQ docs: https://docs.bullmq.io
