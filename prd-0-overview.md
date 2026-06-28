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
- **Per v3.11: team-isolation policies.** Most queries also filter by the requesting user's team membership. A player on Team A cannot read Team B's data; a Crusade Team Leader of Team A cannot read Team B's data; only the Primary CM (and Instance Admin) cross team boundaries. RLS policies enforce this at the database layer — no application-layer bug can leak cross-team data.
- **Post-crusade relaxation:** when `Campaign.status = 'archived'`, the team-isolation policies relax to allow cross-team reads in read-only mode. The campaign is over; retrospective access is allowed.
- Wahapedia data, parser output schema, and reference data are shared across all tenants
- A user belongs to one tenant (per-`User` row); a CM can be CM of multiple campaigns within their tenant
- Instance Admin is the only cross-tenant role

### 3.4.1 Identity Model (v3.15)

Per-tenant auth via external identity providers. One `User` row per (tenant, person). One person can have multiple `User` rows across tenants. Each `User` has one or more `Identity` rows linking it to auth providers (Discord OAuth, email magic-link, etc.).

```ts
User { id, tenantId, email, displayName, globalRoles }
Identity { id, userId, provider: 'discord' | 'email' | 'google' | ..., providerSubjectId, providerData, linkedAt }
```

- `User.email`: the primary verified email for the user in this tenant. Used for identity-linking across providers and for magic-link fallback.
- `Identity.providerSubjectId`: e.g., Discord snowflake id, or the email address for magic-link identities.
- `Identity.providerData`: provider-specific claims stored as JSON (avatar hash, username, etc.). Refreshed on each sign-in.

**Identity linking at sign-in (per PRD-2 §3.1):**

1. User signs in via OAuth. Provider returns `email` (verified).
2. System queries `User` in this tenant where `email = ?`.
3. If found: link the new `Identity` to that `User`.
4. If not: create `User` + the new `Identity` + an email magic-link `Identity` (so the user can also sign in via email later).

**Per-tenant OAuth config (v3.15):**

- `Tenant.oauthConfig: { discord?: { clientId, clientSecret }, google?: ..., microsoft?: ... }`
- Instance-level defaults configured by Instance Admin (used when a tenant has no override).
- Magic-link always uses tenant-level SMTP (per PRD-0 §3.4).

See PRD-2 §3.1 for the full account-creation flow with diagrams and PRD-2 §5d.1 for the account-page IDENTITIES section where users manage their linked providers.

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
Roles = 'instance_admin' | 'cm' | 'crusade_team_leader' | 'player' | 'spectator'   // user can hold multiple
// A user with the `cm` role for a campaign has full authority on that campaign.
// A user with the `crusade_team_leader` role for a team has scoped authority on that team only.
// A user with the `player` role for a campaign is on exactly one team.
// A user can be both `cm` AND `player` for the same campaign (CM-as-player per PRD-1 §5).
// A user who is `crusade_team_leader` for a team is by definition also `player` on that team.

// === Campaign ===
// Teams are MANDATORY in v1: every campaign has at least one team. Free-for-all
// mode is out of scope.
Campaign {
  id, tenantId, name, supplementId, cmUserId, status, settings, createdAt,
  // Per-campaign pinned JSON Schema for the post-battle update form.
  // Set at campaign creation: copied from CrusadeSupplement.battleReportSchema
  // at that moment. Future updates to the supplement's schema do NOT affect
  // in-flight campaigns — the form is locked for the campaign's lifetime.
  // CM-customizable in principle (homebrew forms); v1 has no UI to author
  // them, but the field exists so a v1.x schema editor can write here.
  battleReportSchema: object | null,
  // Per-kind team-leader authority (default per PRD-1 §4.4; CM-configurable).
  teamLeaderAuthority: { [kind: string]: boolean },
  // Approval mode for multi-team-leader teams. 'any' = any one team leader
  // can approve; 'all' = every team leader must approve. Default 'any'.
  teamLeaderApprovalMode: 'any' | 'all',
  // Per-kind rule-pack enforcement settings (PRD-1 §4.4; CM-configurable).
  rulePackEnforcement: { [kind: string]: { ruleKeys: string[] } },

  // State (lifecycle): internal, tracks campaign progression.
  //   'created'  — initial; CM created the campaign; not yet started; no players yet
  //   'started'  — active; players can join, file approvals, play battles
  //   'ended'    — campaign is over (CM clicked "End"); roster updates locked
  //                but narrative log still accessible; team isolation still enforced
  //   'archived' — full read-only; team data isolation relaxed (PRD-0 §3b);
  //                retrospective mode for the post-crusade view
  // Phases (narrative): see CampaignPhase below — distinct concept.
  status: 'created' | 'started' | 'ended' | 'archived',
  activePhaseId: CampaignPhase['id'] | null,  // pointer to currently active phase (at most one)
}

// CampaignPhase (v3.18): CM-defined narrative periods within a campaign.
// Distinct from Campaign.status (state/lifecycle). Phases are CM data used
// to communicate narrative context to players, with optional game-relevant
// effects (v1.x).
// Example: Phase 1 - "Arrivals" — orbital drop ships battle for dominance;
// those who succeed may provide orbital support to drop ships, aiding them
// to setup fortifications and forward operations.
CampaignPhase {
  id, campaignId,
  name: string,                              // e.g., "Phase 1 - Arrivals"
  description: markdown,                     // narrative context (what's happening in the world)
  // Structured game-relevant effects (v1.x). v1: null.
  // v1.x: { availableRequisitions: [...], disabledRules: [...], pointCapModifier: ... }
  effects: object | null,
  activatedAt: timestamp | null,
  deactivatedAt: timestamp | null,
  // Soft-delete via revokedAt; phases can be removed but history is preserved.
  revokedAt?: timestamp,
  revokedByUserId?: string,
}
// v1 invariant: at most one CampaignPhase has activatedAt != null AND deactivatedAt = null per campaign.
// v1.x may allow multiple simultaneous phases (e.g., overlapping "Day phase" + "Helsreach Siege" phase).
// Transitions: activate sets activatedAt = now, deactivatedAt = null;
//             activate another phase implicitly deactivates the current one (sets deactivatedAt = now).
CampaignTeam {
  id, campaignId, name, description, color, narrativeLogFilter,
  // Narrative intent: which 40K factions fit this team's story. NOT enforced
  // by the app — the rule engine surfaces a soft warn, and the CM has final
  // approval on every roster. Books (e.g., Armageddon) ship with these pre-filled.
  expectedFactionIds: string[] | null
}
// TeamLeader join table — a user can be a team leader for multiple teams
// (rare; usually just one), and a team can have multiple team leaders (v3.12).
TeamLeader {
  id, teamId, userId,
  grantedAt, grantedByUserId,        // who promoted them
  revokedAt?: timestamp, revokedByUserId?: string,  // soft-delete; team leader is removed
}
// Once a campaign is started, every team must have ≥1 active TeamLeader row.
// CM is the only role that can grant or revoke TeamLeader rows (policy).
CampaignMember { id, campaignId, userId, joinedAt, status, factionId, teamId: CampaignTeam['id'] }
CampaignMember { id, campaignId, userId, joinedAt, status, factionId, teamId: CampaignTeam['id'] }
// ^ Note: CampaignMember.teamId is the player's team membership.
//   TeamLeader is a separate join for team-scoped approval authority.
//   A user can be a player on a team (CampaignMember) AND a team leader
//   for that team (TeamLeader) — the roles stack.

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

// === Crusade supplements (per-book config) ===
// Each released Crusade book is one row. v1 ships Armageddon.
CrusadeSupplement {
  id,                                  // e.g., 'armageddon', 'nachmund-gauntlet' (v1.x+)
  name,
  releasedAt,
  // Per-supplement default JSON Schema for the post-battle update form.
  // The form UI auto-generates from this schema. Fields differ per book:
  // Armageddon uses the standard Crusade form (agendas, OoA tests, per-unit XP);
  // Nachmund has multi-player agendas and Crusade Blessings; etc.
  // null = fall back to the system-default standard Crusade battle report form.
  // This is the supplement's CURRENT default; campaigns pin their own copy
  // via Campaign.battleReportSchema below.
  battleReportSchema: object | null,
  // Per-supplement pre-filled content (e.g., Armageddon's Helsreach/Hades/Gorgutz/Skari teams)
  seedData: object,
}

// === Approval ===
ApprovalRequest { id, tenantId, campaignId, kind, submittedByUserId, payload, status, reviewerUserId, decidedAt, decisionReason, contextHash, ruleCheckIds, activeRosterApprovedId, approvalSource }

// === History (computed once ApprovalRequest is approved) ===
// Every approved changeset generates HistoryEntry rows. Tombstoned (not
// hard-deleted) when a rollback is approved. The grouping dimension is
// derived (multiple grouping strategies on the same data), but each
// entry has a single primary group for storage + indexing.
HistoryEntry {
  id, tenantId, campaignId,
  approvalRequestId,                    // ties entry back to its approval (G5)
  grouping,                             // 'unit' | 'roster_version' | 'battle' | 'requisition' | 'state_field'
  groupKey,                             // stable id within grouping (unitId, rosterApprovedId, battleId, etc.)
  summary,                              // human-readable 1-line ("Cadian Castellan XP 5→8, +1 kill")
  payload,                              // structured diff (per-grouping shape)
  occurredAt,
  tombstoned: boolean,                  // true after rollback; hidden from timelines, kept in audit log
  tombstonedByApprovalRequestId?: string,
}
HistoryEntryIndex { historyEntryId, groupKey, dimension }  // secondary indexes (e.g., unitId, battleId) for cross-grouping queries

// === Queue / async ===
JobRecord { id, kind, payload, status, attempts, lastError, resultRef, enqueuedAt, completedAt }

// === Audit ===
AuditLog { id, tenantId, actorUserId, action, targetType, targetId, payload, occurredAt }

// === Notifications ===
// Per-user notification queue. Generated from Event outbox at fanout time.
// Toast and email delivery are derived from this table; list page reads it.
Notification {
  id, tenantId, recipientUserId,
  kind: 'approval_status' | 'approval_requested' | 'event_visible_to_user' | 'team_leader_grant' | 'team_leader_revoke' | 'roster_rollback_executed' | 'campaign_archived',
  title, summary,                                 // markdown summaries, not full payloads
  sourceEventId?, sourceApprovalRequestId?,       // links to the originating record
  readAt: timestamp | null,
  createdAt,
  campaignId?: string,
  // Quiet-class determines UI delivery loudness (see PRD-5 §6).
  loudness: 'loud' | 'normal' | 'quiet',
}

**Identifiers**: UUIDv7.

---

## 3b. Glossary of Roles

Per v3.11 — these terms have specific meanings in this app. Drift between "what I meant" and "what's written" is exactly what we want to avoid.

| Role | Who they are | What they can do |
|---|---|---|
| **Instance Admin** | A user with the `instance_admin` role. Cross-tenant. | Provisions tenants, sees all campaigns, doesn't play. |
| **Primary CM** | A user with the `cm` role for a specific campaign. One per campaign (more can be promoted to co-CM-via-secondary-CM, but that's a separate concept). | Full campaign authority: create campaign, configure rules, approve any action, see all teams' data, edit any roster. |
| **Crusade Team Leader** | A user with the `crusade_team_leader` role for one specific team. **They are also a player on that team** (they have a roster, they play in battles). The primary CM promotes them by granting the role for a specific team. **A team can have multiple team leaders.** The CM is the only role that can add or update the team leader list for any team (policy). | Sees their team's data; can approve `ApprovalRequest`s affecting their team for kinds the primary CM has enabled for them; **cannot see or approve anything for other teams**. The primary CM controls which actions a team leader can approve, per `ApprovalKind`. When multiple team leaders exist on a team, **any one** of them can approve a request in their team's scope (default OR-semantics; the primary CM can switch to AND-semantics per campaign setting if desired). |
| **Player** | A user with the `player` role for a campaign. On exactly one team. | Sees their own roster + their team's narrative log + their own data. Files approvals, plays games, edits nothing about other teams. |
| **Spectator** | Read-only public-link user. | Sees what the campaign's `publicVisibility` setting exposes. No team membership. |

**Co-approval (PRD-5):** the term "co-approval" refers to an `ApprovalRequest` requiring two distinct approvers. In v3.12 the candidates are: Primary CM + a second Primary CM (if the campaign has multiple CMs); or Primary CM + a Crusade Team Leader (if the kind allows team-leader approval and the request is within that leader's scope). The approval pair depends on the request's scope and the campaign's configuration. **There is no automatic co-approval kind; every dual-approval is a configuration choice.**

**Multi-leader on a team:** a team can have multiple team leaders. Any one of them can approve a request in their team's scope (default OR-semantics). The primary CM controls whether approval requires any one or all of the team leaders via `Campaign.teamLeaderApprovalMode: 'any' | 'all'` (default `'any'`). With `'all'`, every team leader on the team must approve before the request is decided — a stronger check, used rarely. The audit log records which team leaders approved, in order.

**Naming for the UI:** team leaders are referred to as **"team leader"** in user-facing language in the context of a specific campaign. Do NOT use "co-CM," "co-Crusade Master," or any terminology that implies they share the CM's role. They are players with delegated team-scoped approval authority. The role grants them limited, scoped authority — not a promotion to CM.

**Roster-level CM (player who is also a CM, possibly also a team leader):** a user can hold multiple roles for the same campaign. E.g., the Primary CM is typically also a player (PRD-1 §5); a Crusade Team Leader is by definition also a player on their team. Role combinations resolve at query time: a user's effective permissions are the union of their roles, scoped by team membership where applicable.

**Data isolation between teams (v3.11):**

- **Two teams cannot search, view, or investigate each other's data through this app.** RLS policies enforce isolation at the data layer: most queries filter by the requesting user's team membership.
- **Players on Team A cannot see Team B's rosters, requisitions, battle reports, narrative log entries, or approval queues through the app.**
- **Cross-team data sharing is explicitly NOT a feature.** If players want to share, they do it out-of-band (Discord, screenshots, printed sheets, conversation). The app does not facilitate it.
- **Exception: when a crusade ends** (campaign status transitions to `archived`), all data in that campaign becomes readable by every player across all teams, in read-only mode. This is the post-crusade retrospective surface.
- The Crusade Team Leader of Team A can see Team A's data fully but cannot see Team B's data even if their own team is playing in cross-team battles. Cross-team battles are visible only via the public narrative log (if the CM marks them as such) or via out-of-band sharing.

---

## 4b. Design Principle: Approval-Gating for Narrative Integrity

> Any operation that mutates shared campaign state or affects the narrative **must be gateable by CM approval**. The approval system is the load-bearing mechanism for narrative integrity in this app.

The user's framing: narrative integrity is the central concern of a Crusade app, and approvals are how it is preserved. Concretely, the v1 categories that fall under this principle:

| Category | Why it's narrative-affecting | v1 status |
|---|---|---|
| **Army roster changes** (add/remove units, requisition purchases, unit stat changes) | The roster is the player's army; changes are persistent and visible | Approval required (PRD-3 + PRD-5) |
| **Crusade points** (RP grants/deducts, narrative event payouts) | RP is the campaign currency; movements are visible to all | Approval required (PRD-4) |
| **All-player effects** (campaign-wide announcements, mass narrative events, point-cap changes) | Affects every player's view of the campaign state | Approval required (PRD-4) |
| **Battle updates** (per-unit XP, honours, scars, OoA tests) | Persistent unit state; affects future battles | Approval required (PRD-4 + PRD-5) |
| **Team changes** (player switches teams) | Reframes the player's narrative identity in the campaign | Approval required (PRD-1 §5b + PRD-5) |

The principle is **open-ended**: any future operation that touches shared campaign state should be added to this list. The approval system (PRD-5) is the extension surface — new categories = new `ApprovalRequest.kind` values + a config entry in the CM's auto-approve settings.

**Auto-approve as a CM choice, not a default:** the principle is about *capability*, not blanket enforcement. A CM can configure a campaign as "all routine battle updates auto-approve" (per PRD-5). The system supports both extremes: strict CMs who approve every change, and hands-off CMs who only gate the narrative-critical moments.

**What is NOT approval-gated (player-internal data):**
- Player UI preferences (theme, language, notification settings)
- Player's own drafts (private until submitted; once submitted, they enter the approval queue)
- Per-unit cosmetics that don't change game state (paint color, custom name drafts)

### 4b.2 Architectural Principle: New Recruit is the Source of Truth for Unit/Roster State

> **Unit and roster data — XP, traits, battle honours, battle scars, relics, wargear, all of it — lives in New Recruit. This app reads from NR (via the parser pipeline), displays the parsed data beautifully, and provides NO surface to mutate it.**

**Why:** mutating unit data in this app would mean our code knows the rules of those systems — which characters can take which relics, which honours are valid for which unit types, the legal wargear per datasheet, etc. That couples us to Games Workshop's rules in a way that creates a permanent anti-pattern: every time GW updates a codex, we'd be playing catch-up. New Recruit is already the canonical tool for this; we lean on it.

**What this means concretely:**

- The player edits in NR, exports JSON, uploads here. Our parser reads the new state and displays it.
- The roster pipeline (PRD-3) extracts unit data from the JSON via `bs-roster-parser` + the app-side-parser; this is **read-only display data**, never written back to NR.
- The rule engine (PRD-3 §6.4) enforces **campaign-level** rules only (point caps, faction locks, unit caps by catalog name, team narrative alignment). It does NOT enforce unit-level rules like "this character can't take that relic."
- The post-battle update form (PRD-4 §4.1) collects **campaign-level** data only (mission, result, agendas, narrative battle report). Per-unit XP/honour/scar/relic changes happen in NR; our app records the new roster version that resulted from the battle.
- Per-unit timeline views (PRD-2 §6 Flow 4) show events derived from NR re-imports — "this unit went from 5 XP to 8 XP because you re-imported on YYYY-MM-DD with the post-battle roster."

**Workflow:**

1. Player plays a battle (in person)
2. Player updates their NR list with the battle's effects (XP, honours, scars, etc.)
3. Player exports NR JSON, uploads to this app
4. App parses, shows the new unit state (read-only display)
5. Player files a post-battle update in this app (campaign-level: mission, agendas, narrative)
6. CM approves the battle report (and/or the new roster)
7. Campaign-level events fire (agenda scoring, RP adjustment, narrative log entry); unit state is unchanged in our app because it was already updated via the re-import

This keeps the system clean: NR owns unit data, our app owns campaign data, neither tries to do the other's job.

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
