# PRDs

All product requirements documents for the Crusade Master app, one concept per PRD. Synced to upstream **v3.28** (commit `a916708`; v3.28.1 includes NR export detection logic).

* [Crusade Master App — Overview (v3.28)](/prds/prd-0-overview.md) — Architecture, shared data model (incl. CrusadeForce/Version/Army v3.28), MVP scope, Faction table (v3.21).
* [Instance Admin & CM Administration (v3.28)](/prds/prd-1-crusade-master-admin.md) — Instance admin, CM dashboard, Crusade Administration Panel, Campaign Teams, Crusade Team Leader, lifecycle state machine, Phases, TL gate at campaign start (v3.28), `ended`/`archived` state behavior (v3.28).
* [Player Sign-Up (v3.28)](/prds/prd-2-player-signup.md) — OAuth (Discord) + magic-link fallback (v3.15). 4 page surfaces (v3.14). Retrospective View (v3.28).
* [CrusadeForce Import, Approval, & Rule Compliance (v3.28)](/prds/prd-3-army-export-versioning.md) — BullMQ pipeline, bs-roster-parser subprocess, rule engine gating, NR export validation gate (v3.28). Data model overhaul from `Roster` to `CrusadeForce` (v3.28).
* [Events, Submissions, & Timeline (v3.28)](/prds/prd-4-events-deltas.md) — Comprehensive event taxonomy (v3.17). State vs Phase (v3.18). BattleUpdates, HistoryEntry, Rollback, Event→Notification fanout (v3.26).
* [Approval System (v3.28)](/prds/prd-5-approval-system.md) — ApprovalKind enum, `approvalSource` field, team-leader authority, always-fire re-assessment warning (v3.17), authority hierarchy simplified (v3.27).
* [Technical Architecture & API Surface (v3.28)](/prds/prd-6-technical-architecture.md) — Hapi API contract, OpenAPI/Swagger (code-first, v3.25), `useInboxPoller` real-time strategy (v3.28).
* [Testing Strategy (v3.28)](/prds/prd-7-testing-strategy.md) — Vitest + pytest + Playwright + testcontainers + GitHub Actions (v3.24+).