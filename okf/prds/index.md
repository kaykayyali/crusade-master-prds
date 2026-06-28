# PRDs

All product requirements documents for the Crusade Master app, one concept per PRD. Synced to upstream v3.26 (`0c3c626`).

## PRD

* [Crusade Master App — Overview (v3.26)](/prds/prd-0-overview.md) — Architecture, data model, MVP scope, State vs Phase distinction (v3.18).
* [Instance Admin & Crusade Master Administration (v3.26)](/prds/prd-1-crusade-master-admin.md) — Instance admin, CM dashboard, Crusade Administration Panel, Campaign Teams, Crusade Team Leader, lifecycle state machine (v3.18, mermaid v3.23), Phases (v3.18 cosmetic-only v3.19).
* [Player Sign-Up (v3.26)](/prds/prd-2-player-signup.md) — Player onboarding. OAuth (Discord) + magic-link fallback (v3.15). 4 page surfaces (v3.14).
* [Roster Import, Approval, & Rule Compliance (v3.26)](/prds/prd-3-army-export-versioning.md) — BullMQ pipeline, bs-roster-parser subprocess, rule engine gating.
* [Events, Submissions, & Timeline (v3.26)](/prds/prd-4-events-deltas.md) — Comprehensive event taxonomy (v3.17). State vs Phase (v3.18). BattleUpdates, HistoryEntry, Rollback, Event→Notification fanout (v3.26).
* [Approval System (v3.26)](/prds/prd-5-approval-system.md) — ApprovalKind enum, approvalSource field, team-leader authority, always-fire re-assessment warning (v3.17).
* [Technical Architecture & API Surface (v3.26)](/prds/prd-6-technical-architecture.md) — Hapi API contract, OpenAPI/Swagger (code-first, v3.25), observability.
* [Testing Strategy (v3.26)](/prds/prd-7-testing-strategy.md) — Vitest + pytest + Playwright + testcontainers + GitHub Actions (v3.24+).
