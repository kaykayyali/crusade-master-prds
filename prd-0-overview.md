# PRD-0: Crusade Master App — Overview (v2)

> Shared architecture, data model, MVP scope, and links to subsystem PRDs. v2 reflects the locked tech stack, multi-tenant model, and Armageddon-only MVP.

---

## 1. Background and Goals

### 1.1 Background

Warhammer 40,000 Crusade is a narrative play mode where units gain experience, ranks, and battle honors across linked games. Running a group Crusade (typically 4–16 players over weeks/months) requires a "Crusade Master" to:

- Coordinate match pairings and scheduling
- Verify post-battle updates and roster changes
- Enforce house rules and adjudicate disputes
- Maintain a consistent narrative arc

Players typically prep their lists in New Recruit. NR handles list construction well but offers no enforcement tooling: nothing tells a CM "this player added a unit without a requisition," "this roster exceeds the campaign point cap," or "this battle was filed against an out-of-date roster." The app's job is the **enforcement and timeline** layer on top of NR.

### 1.2 Goals

| Goal | Metric | Target |
|------|--------|--------|
| **Business**: replace ad-hoc Crusade administration (paper / spreadsheets / Discord) | Self-hosted instances running ≥ 1 active campaign | 50+ instances within 6 months of v1 |
| **User (CM)**: cut per-battle admin time | Time CM spends processing a post-battle update | < 2 min per battle |
| **User (Player)**: roster compliance before submission | % of battle filings that pass first-try approval | > 85% |
| **Product**: data ownership | % of user data exportable in open formats | 100% (JSON + CSV) |

### 1.3 MVP Scope

**Crusade supplement**: *Crusade: Armageddon* (10th Edition, 128pp, June 2025). Armageddon is the only supplement supported at MVP.

**Edition**: 10th Edition only. The app does not model 11th-edition rules; users running 11th-ed content are out of scope.

**Crusade supplements explicitly out of MVP** (data model is schema-ready for all 5, but UI is Armageddon-only):
- *Crusade: Leviathan* (launch book, June 2023)
- *Crusade: Tyrannic War* (2023)
- *Crusade: Pariah Nexus* (Jan 2024)
- *Crusade: Nachmund Gauntlet* (Feb 2025)

---

## 2. User Types

| User | What they do | Tenant scope |
|------|--------------|--------------|
| **Instance Admin** | Operates the self-hosted Docker instance. Created at first-run via env-var bootstrap or wizard. Manages global settings, sees all tenants for abuse moderation | All tenants on the instance |
| **Crusade Master (CM)** | Owns one or more campaigns within their tenant. Approves roster changes, adjudicates disputes, triggers narrative events, manages campaign lifecycle | One tenant, can be CM of multiple campaigns |
| **Player** | Joins campaigns in their tenant. Imports rosters (JSON), files post-battle updates, requests requisitions, plays in battles | One tenant, can join multiple campaigns |
| **Spectator (read-only)** | Views public campaign narrative, leaderboard, public rosters | Cross-tenant if campaign is set public |

**A user can hold multiple roles** (e.g., Instance Admin + CM + Player). A CM can also be a player in their own campaign — this is allowed and a "playing in your own campaign" badge is shown to other members.

---

## 3. Architecture

### 3.1 Tech Stack (locked)

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Vite + (Vue or React, TBD) | TypeScript, Tailwind, IndexedDB cache |
| Backend | FastAPI (Python 3.12) | Async, Pydantic v2, SQLAlchemy 2.x |
| Database | PostgreSQL 16 | Row-level security for tenant isolation |
| Object storage | MinIO | S3-compatible; for NR export blobs, generated PDFs, avatars |
| Auth | Magic-link email (or OIDC via env-var config) | No passwords |
| Background jobs | APScheduler or Celery + Redis | NR import parsing, Wahapedia refresh, rule-compliance engine |
| Deployment | Docker Compose (single-node MVP), Docker Swarm or k8s for multi-node | Self-hosted |

### 3.2 Components

```
┌──────────────────────────────────────────────────────────────┐
│                  Frontend (Vite SPA)                         │
│  Vite + Vue/React + TypeScript + Tailwind + IndexedDB        │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTPS / JSON
┌──────────────────▼───────────────────────────────────────────┐
│               FastAPI backend (single process MVP)           │
│  Routers: auth, campaigns, rosters, battles, approvals,      │
│           events, admin                                      │
│  Background workers: NR parsing, Wahapedia refresh,           │
│                      rule-compliance engine                  │
└──┬───────────────┬───────────────────┬───────────────┬───────┘
   │               │                   │               │
┌──▼──────┐  ┌─────▼──────┐  ┌─────────▼──────┐  ┌─────▼────┐
│Postgres │  │   MinIO    │  │  Redis (cache, │  │  SMTP    │
│+ RLS    │  │ (S3 API)   │  │   job queue)   │  │  (magic  │
│         │  │            │  │                │  │   link)  │
└─────────┘  └────────────┘  └────────────────┘  └──────────┘
```

### 3.3 Tenancy Model

Multi-tenant on a single Docker instance:

- Every domain table has `tenant_id UUID NOT NULL` with row-level security policies
- Tenants are isolated; no cross-tenant queries except via Instance Admin role
- Each tenant has its own CM(s), campaigns, members
- A user belongs to one tenant (their account is provisioned with a `tenant_id` at signup)
- The Wahapedia cache and reference data (units, factions, supplements) are shared across all tenants on the instance (read-only)

### 3.4 Wahapedia Integration

- Nightly job fetches `https://wahapedia.ru/wh40k10ed/*.csv` and the export spec XLSX
- Diff against the cached version
- Updated data is republished to all tenants
- Per-tenant override is **not** supported (everyone sees the same Wahapedia snapshot)

---

## 4. Shared Data Model

```ts
// === Tenancy ===
Tenant { id, name, slug, createdAt, settings }
User { id, tenantId, email, displayName, role, createdAt }
Role = 'instance_admin' | 'cm' | 'player' | 'spectator'   // user can hold multiple

// === Campaign ===
Campaign { id, tenantId, name, supplementId, cmUserId, status, settings, createdAt }
CampaignMember { id, campaignId, userId, joinedAt, status, factionId }

// === Roster (the key new model — see PRD-3 for state machine) ===
Roster { id, campaignId, ownerUserId, factionId, name, currentDraftId, currentApprovedId }
RosterDraft { id, rosterId, sourceJsonBlobId, status, createdAt, ackByPlayerAt }
RosterApproved { id, rosterId, sourceDraftId, approvedAt, approvedByUserId, snapshot, pointLimit }
RosterApprovalHistory { rosterId, approvedId, approvedAt, approvedByUserId }   // chron. list

// === Crusade state (lives on RosterApproved snapshot) ===
CrusadeForceState { supplementId, supplyLimit?, logisticsPoints?, battleTally, victories, requisitions, ... }

// === Battles ===
Battle { id, campaignId, playerAId, playerBId, scheduledAt, status, resultA, resultB, missionId, approvedRosterIdA, approvedRosterIdB }
BattleUpdate { id, battleId, submittedByUserId, submittedAt, status }

// === Events (the unified delta model — see PRD-4) ===
Event { id, tenantId, campaignId, kind, occurredAt, actorUserId, targetType, targetId, payload, delta, visibility }
Delta { id, eventId, entityType, entityId, field, beforeValue, afterValue, reason }

// === Rule compliance ===
RuleCheck { id, runId, kind, status: 'pass' | 'warn' | 'fail', details, refDraftId }

// === Approval (see PRD-5) ===
ApprovalRequest { id, tenantId, kind, submittedByUserId, payload, status, reviewerUserId, decidedAt, decisionReason, contextHash }

// === Audit ===
AuditLog { id, tenantId, actorUserId, action, targetType, targetId, payload, occurredAt }
```

**Identifiers**: UUIDv7 (time-ordered) for efficient audit-log scans.

---

## 5. Subsystem PRDs

| PRD | Subsystem | v2 changes from v1 |
|-----|-----------|---------------------|
| PRD-1 | Instance Admin & Crusade Master Administration | Added instance admin role; multi-tenant model |
| PRD-2 | Player Sign-Up | Tenant-bounded; invite-code scoped to tenant |
| PRD-3 | Roster Import, Approval, & Rule Compliance | **Major rewrite** — state machine, diff-to-player-first, NR JSON only |
| PRD-4 | Events, Submissions, & Timeline | **Major rewrite** — submission gating, timeline model |
| PRD-5 | Approval System | Added `roster_approval` kind |

---

## 6. Success Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Time-to-first-approved-roster | Player joins → first RosterApproved exists | < 30 min |
| CM admin time per battle | CM time per battle approval | < 2 min |
| First-try approval rate | Battle filings passing CM approval on first review | > 85% |
| Rule-check catch rate | Rule violations caught by automated engine vs. manual CM review | > 95% |
| Tenant density | Campaigns per tenant at steady state | > 2 |
| Data freshness (Wahapedia) | Time from Wahapedia update to reflected in app | < 24h |
| Player retention | % of players still filing updates at week 8 | > 60% |

---

## 7. Non-Goals (MVP)

- ❌ Matched Play / non-Crusade 40K rules
- ❌ Tournament pairings engine
- ❌ Mobile native apps (web-only, mobile-responsive)
- ❌ Real-time push (email + in-app only for MVP)
- ❌ 9th-ed Crusade support
- ❌ 11th-edition rules support
- ❌ Other Games Workshop systems (Age of Sigmar, Kill Team, Horus Heresy)
- ❌ NR URL fetch / scraping (JSON upload only, per user direction)
- ❌ PDF generation as deliverable (HTML printable versions are fine)

---

## 8. Open Questions

| Question | Default | Owner |
|----------|---------|-------|
| Frontend: Vue or React? | Vue (better FastAPI integration story) | TBD by frontend lead |
| Email provider for magic links | SMTP via env vars; supports SES/Postmark/Resend | TBD |
| Multi-node deployment story | Document Docker Swarm in v1.1 | TBD |
| Cross-tenant spectator campaigns | Disabled by default; per-campaign toggle | TBD |

---

## 9. v2 Changes from v1

| What | Why |
|------|-----|
| Added Vite + FastAPI + Postgres + MinIO stack | Per user direction |
| Added instance admin role | Multi-tenant self-hosted model |
| Removed 11th-ed references and "edition transition" concerns | *Crusade: Armageddon* is 10th-ed, June 2025; the 11th-ed launch box is a different product |
| MVP = Armageddon only (was: Armageddon first, others follow) | Per user direction |
| Removed NR URL fetch path | Per user direction (JSON upload only) |
| Renamed "Crusade Master Approval System" framing | Now a unified approval system with multiple kinds |
| Roster state machine: draft → pending → approved | Per user direction (gating principle) |
| Event model reframed as timeline-of-state-transitions | Per user direction (events = deltas) |

---

## 10. References

- *Crusade: Armageddon*, Games Workshop, June 2025, 128pp, 10th-edition supplement (Lexicanum, Bell of Lost Souls, multiple retailers)
- Wahapedia × 10th-ed Crusade data reference (companion research doc)
- New Recruit JSON export format (BattleScribe schema dialect)
- Administratum (Goonhammer) — closest commercial competitor
- ServoCrypt — closest open collaborative competitor
