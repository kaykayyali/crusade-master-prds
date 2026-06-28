# Crusade Master App — PRDs

Product requirements for a self-hosted, multi-tenant app that lets a Crusade Master administer and track players across Warhammer 40,000 Crusade campaigns, fed by New Recruit JSON exports and a rule-compliance engine.

**Stack**: Vite (frontend) + FastAPI (backend) + Postgres + MinIO. Self-hosted via Docker.
**MVP scope**: *Crusade: Armageddon* (10th Edition, June 2025). The app is single-edition and single-supplement.
**Companion data reference**: `wahapedia-crusade-10th-data-reference.md` (in this repo's companion research folder).

## Documents

| File | Subsystem | v2 |
|------|-----------|----|
| [prd-0-overview.md](./prd-0-overview.md) | App overview, shared data model, architecture, MVP scope | ✓ |
| [prd-1-crusade-master-admin.md](./prd-1-crusade-master-admin.md) | Instance admin + CM dashboard, campaign lifecycle, member management | ✓ |
| [prd-2-player-signup.md](./prd-2-player-signup.md) | Tenant-scoped account creation, invite-code join, faction picker, onboarding | ✓ |
| [prd-3-army-export-versioning.md](./prd-3-army-export-versioning.md) | Roster state machine (draft → approved), diff-to-player-first, **rule-compliance engine** | ✓ |
| [prd-4-events-deltas.md](./prd-4-events-deltas.md) | Event taxonomy, **submission gating**, Timeline reconstruction | ✓ |
| [prd-5-approval-system.md](./prd-5-approval-system.md) | Unified approval pipeline, **`roster_approval` as primary kind** | ✓ |

## CHANGELOG

### v2 (current)

Major rewrite incorporating locked design decisions from the user. Key changes:

| Area | Before (v1) | After (v2) |
|------|-------------|------------|
| Tech stack | Stack-neutral assumptions (React/Postgres) | **Vite + FastAPI + Postgres + MinIO**, self-hosted Docker |
| Tenancy | Implicit single-tenant | **Multi-tenant** with Postgres row-level security; instance admin role |
| MVP | "Armageddon first, others follow" | **Armageddon only** for v1; schema-ready for others, not UI-ready |
| Roster model | "Active version" per import | **State machine**: `RosterDraft` (pending_review → pending_approval) → `RosterApproved` (immutable, becomes active) |
| Diff audience | CM-first | **Player-first** — the player reviews and acknowledges before submission |
| NR ingestion | URL fetch + file upload + manual entry | **JSON file upload only** |
| Event model | "Post-battle deltas + narrative events" | **Every state transition is an event; submission gating by approved roster; Timeline reconstruction** |
| Approval system | Generic action approvals | **`roster_approval` is the primary kind**; rule-check engine output feeds the inbox |
| Edition framing | "10th with 11th-ed migration concerns" | **10th-edition only, period.** (A prior version of the companion data reference incorrectly claimed *Crusade: Armageddon* was 11th-ed; that has been corrected.) |

### v1 (initial draft)

First pass — generated from initial requirements. Superseded by v2.

## Status

Drafts — pending review before implementation kickoff.

## How to read

If you're picking one PRD to start with: **PRD-0** (overview) → **PRD-3** (roster state machine) → **PRD-4** (events + submission gating). Those three are the load-bearing pieces; PRDs 1, 2, 5 are the supporting infrastructure.
