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

### v3 (current) — Hapi + BullMQ + parser subprocess

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
