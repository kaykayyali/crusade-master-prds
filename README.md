# Crusade Master App — PRDs

Product requirements for a self-hosted, multi-tenant app that lets a Crusade Master administer and track players across Warhammer 40,000 Crusade campaigns, fed by New Recruit JSON imports parsed by the user's existing `bs-roster-parser` Python library.

**Stack** (v3): Vite + Vue 3 + TypeScript (frontend) · @hapi/hapi + Node 22 + TypeScript (backend) · PostgreSQL · MinIO · BullMQ + Redis (async pipeline) · Python 3.10+ parser subprocess · Docker Compose.
**MVP scope**: *Crusade: Armageddon* (10th Edition, June 2025) only.
**Companion data reference**: `wahapedia-crusade-10th-data-reference.md` (in the companion research folder; the app's data model assumes this content).
**Parser source**: `bs-roster-parser` Python library (referenced from PRD-3, lives in its own repo).

## Documents

| File | Subsystem |
|------|-----------|
| [prd-0-overview.md](./prd-0-overview.md) | App overview, shared data model, architecture, MVP scope |
| [prd-1-crusade-master-admin.md](./prd-1-crusade-master-admin.md) | Instance admin + CM dashboard, campaign lifecycle |
| [prd-2-player-signup.md](./prd-2-player-signup.md) | Tenant-scoped account creation, invite-code join, faction picker |
| [prd-3-army-export-versioning.md](./prd-3-army-export-versioning.md) | BullMQ pipeline, parser integration contract, configurable rule engine |
| [prd-4-events-deltas.md](./prd-4-events-deltas.md) | Event taxonomy, submission gating, Timeline |
| [prd-5-approval-system.md](./prd-5-approval-system.md) | Unified approval pipeline, `roster_approval` as primary kind |

## CHANGELOG

### v3.5 (current) — Approval-gating as a unifying principle

Per user: any operation that mutates shared campaign state or affects the narrative should be gateable by CM approval. Codified as PRD-0 §4b "Approval-Gating for Narrative Integrity" — the load-bearing mechanism for narrative integrity.

- **PRD-0 §4b**: new design principle section. Lists v1 categories (army roster changes, crusade points, all-player effects, battle updates, team/faction changes) and notes that auto-approve is a CM choice, never the default.
- **PRD-5 §2**: restructured around the principle. New §2.1 "Approval-Gating Principle", §2.2 "Action Categories" (the v1 list, grouped by category), §2.3 "Self-Serve" (what's deliberately not gated), §2.4 "Full Action × Approval Matrix" (the existing actions + new ones).
- **PRD-5 §2.4 additions**:
  - Team switch is approval-gated (already documented in PRD-1 §5b; now consolidated)
  - CM-triggered campaign-wide RP-affecting narrative events: optional co-CM approval (campaign setting)
  - CM mass-rebanning a unit mid-campaign: co-CM approval mandatory
  - CM editing `CampaignTeam.expectedFactionIds`: self-served but audit-logged
- The principle is open-ended: future narrative-affecting actions extend via new `ApprovalRequest.kind` values + a config entry in CM's auto-approve settings.

### v3.4 — Teams are mandatory

Per user direction: free-for-all mode is out of scope. Every campaign uses teams.

- **PRD-0**: removed `Campaign.teamsEnabled`. `CampaignMember.teamId` is now required (not optional). Comment in the schema block explicitly notes teams are mandatory in v1.
- **PRD-1 §5b**: removed the "free-for-all" branch. Schema notes that ≥1 team is required at creation; minimum viable (1 team, 1 player) is legal but pointless, UI nudges toward ≥2 teams.
- **PRD-2**: removed the "if `teamsEnabled`" conditional. Team picker is always shown. Signup diagram simplified to a single faction+team sequence.
- All other v3.3 narrative-intent / CM-approval logic unchanged.

### v3.3 — Narrative intent vs enforcement

The user clarified the team's relationship to factions: a campaign team has *narrative intent* (which 40K factions fit its story), but the **CM has final approval** — the app does not enforce. The Armageddon book (and other Crusade supplements) provide narrative reference; the CM's approval is the actual gate.

- **PRD-0 schema**: `CampaignTeam.expectedFactionIds: string[] | null` (narrative intent, editable by CM). `Roster.teamId` (roster is bound to a team directly, snapshotted at creation). `RosterApproved.factionId` + `RosterApproved.teamId` (snapshotted at approval, preserved historically).
- **PRD-1 §5b**: Armageddon templates pre-fill `expectedFactionIds` from the book. Helsreach/Hades Defenders expect Imperial factions; Gorgutz/Skari expect Orks. The CM can edit per their campaign. The hint surfaces in three places — team picker (PRD-2), roster rule check (PRD-3 `team-narrative-alignment`), and the narrative log (audit-trail of CM overrides).
- **PRD-3 rule gallery**: new built-in `team-narrative-alignment` rule. Default severity: **warn only**. Never fails. CM overrides are the actual enforcement point. Configurable per-rule-instance.
- **PRD-2 team picker**: shows "typically plays Imperial factions" hint per team. Mismatched faction + team → soft warning, player can continue. No blocking.
- **Team switching (PRD-1 §5b)**: requires CM approval (`team_switch` ApprovalRequest). On approval, Roster's teamId follows by default; CM can choose to freeze the old roster or create a new one. The `team-narrative-alignment` rule re-runs against the new team's expectedFactionIds on next approval.

### v3.2 — Campaign Teams as first-class schema

- **Distinction surfaced**: 40K `Faction` (seeded from Wahapedia) is now clearly separate from `CampaignTeam` (CM-defined per-campaign grouping of players). v3.1's "Custom Factions" note was conflating these.
- **PRD-0**: schema adds `Campaign.teamsEnabled`, `CampaignTeam { id, campaignId, name, description, color, narrativeLogFilter }`, and `CampaignMember.teamId`. `Faction` is global; `CampaignTeam` is per-campaign; `Roster` does NOT carry team info (member-level concept).
- **PRD-1 §5b**: rewritten. Teams are not factions — they are narrative sides within a campaign. Armageddon ships 4 template teams (Helsreach Defenders, Hades Defenders, Gorgutz's WAAAGH!, Skari's Kult of Speed); CMs can rename/edit. Battle pairing filters on team. Per-team dashboard rollups added.
- **PRD-2**: player signup now has a two-step picker — 40K faction + campaign team. Free-for-all campaigns skip the team step. Team switch mid-campaign requires CM approval (creates a `team_switch` `ApprovalRequest`).
- **PRD-4**: `NarrativeEventEffect.FilterExpr` supports `teamId` as a first-class axis alongside `factionId`. The two are distinct dimensions; CM can target events to a specific team.

### v3.1 — Rule builder in scope + critical user flows

- **Rule builder UI moved into v1 scope** (was v1.x). Built-in rule types only, no custom DSL. 9 rule types ship: `max-n-of-type`, `max-x-pct-of-role`, `max-points-per-unit`, `wargear-restriction`, `unit-whitelist`, `unit-blacklist`, `custom-name-pattern`, `total-xp-cap`, `crusade-rp-floor`. Auto-generated config forms from JSON Schema. Live preview + test-against-existing-data before save.
- **PRD-1: added CM critical user flows** with persona (Mike, IT pro, runs Wednesday night campaign, 3 hours/week on admin). 5 flows detailed: campaign setup, inbox triage day, roster approval with rule override, narrative event triggering, campaign health monitoring. Each flow has: trigger, why it matters, specific UI requirements, critical moment, edge case.
- **PRD-2: added player critical user flows** with persona (Sarah, software engineer, plays Astra Militarum, 2 games/week). 4 flows detailed: first roster import + approval, post-battle update filing, requisition purchase, per-unit timeline view.
- **PRD-1 inbox clarified**: shows approvals + deltas + battle reports. Does not compute every detail; per user direction. Different from the campaign's narrative log (storytelling surface).
- **Custom factions**: schema-ready (`Faction` table, not enum), UI for creating custom factions deferred to v1.x. PRD-1 §5b.
- **Discord integration**: noted as v2 future in PRD-1 §5c. Webhook-based forwarding of events.

### v3 — Hapi + BullMQ + parser subprocess

Major rewrite driven by the user's real stack and existing code:

| Area | v2 | v3 |
|------|----|----|
| Backend | FastAPI (Python) | **@hapi/hapi** (Node 22, TypeScript) — "I strongly prefer a node/typescript system" |
| Queue | None | **BullMQ + Redis** — "I think we use a queue to parse them" |
| Parser | Conceptual (TS would do everything) | **Python subprocess** running user's `bs-roster-parser` library |
| Rule engine | Built-in only | **Configurable** — builtin + CM-defined + crusade-defined, with ruleKey/severity/configSchema per instance. UI deferred to v1.x; data model + engine ship in v1. |
| Roster pipeline | Synchronous | **Async**: Hapi → MinIO blob → BullMQ `parse-job` → worker spawns Python → `diff-job` → `rule-check-job` → notify |
| PRD-3 surface | Generic | Now includes the exact parser contract (stdio JSON, exit codes, what the Python lib does and doesn't extract), and the app-side TS pass for the gaps |

**Architectural change**: the load-bearing flow is now a 5-stage async pipeline. The Python parser handles the BattleScribe quirks; the TS app handles the diff + rules + persistence. They communicate via stdio JSON.

### v2 — Locked design

| Area | v1 | v2 |
|------|----|----|
| Tech stack | Stack-neutral | Vite + FastAPI + Postgres + MinIO, Docker |
| Tenancy | Single | Multi-tenant with RLS + instance admin |
| MVP | "Armageddon first" | Armageddon only |
| Roster model | Active version per import | State machine: `RosterDraft` → `RosterApproved` |
| Diff audience | CM-first | Player-first |
| Ingestion | URL + file + manual | JSON file only |
| Events | Post-battle deltas | Every state transition is an event; submission gated by approved roster |
| Approvals | Generic | `roster_approval` is the primary kind |

### v1 — Initial draft

First pass. Superseded.

## How to read

Start with **PRD-0** (overview) → **PRD-3** (the load-bearing piece — BullMQ pipeline, parser contract, rule engine) → **PRD-4** (events + submission gating). Then PRD-1, 2, 5 as supporting infrastructure.

## Status

Drafts — pending review before implementation kickoff.
