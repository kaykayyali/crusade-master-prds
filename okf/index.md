---
okf_version: "0.1"
---

# Crusade Master App — OKF Bundle (v3.26 sync)

This bundle captures the product requirements for the Crusade Master app
synced to upstream v3.26 (commit `0c3c626`). It documents:

- The **locked stack** — Hapi/Node/TS + BullMQ + Python parser subprocess + configurable rule engine
- **Campaign Teams** (v3.2+, mandatory v3.4+) and **Crusade Team Leader** role (v3.11+) with team-scoped approval authority (v3.12) + campaign-creation gate (v3.13)
- **NR-as-source-of-truth** principle (v3.9) — the app parses and displays but never mutates
- **State vs Phase distinction** (v3.18, cosmetic-only Phase v3.19) — system lifecycle vs CM-authored narrative
- **History layer** — HistoryEntry, ChangesetGroupings G1–G7, Rollback (v3.10)
- **Approval-Gating** principle (v3.5) and canonical `ApprovalKind` enum (v3.6, extended v3.10/v3.12)
- **Always-fire re-assessment warning** (v3.17) — when approval settings change with pending approvals
- **Auth** (v3.15) — Discord OAuth primary, email magic-link fallback
- **OpenAPI/Swagger** code-first API strategy (v3.25) via @hapi/swagger
- **Event taxonomy** (v3.17 expansion) covering campaign / member / team / roster / battle lifecycle
- **Event→Notification fanout** (v3.26)
- **Vitest + testcontainers + Playwright** testing strategy (PRD-7, v3.24+)

The source PRDs live in
[kaykayyali/crusade-master-prds](https://github.com/kaykayyali/crusade-master-prds);
each PRD is a separate OKF concept under [`prds/`](prds/).

## Subsystem PRDs

* [PRD-0 — Overview](prds/prd-0-overview.md)
* [PRD-1 — Instance Admin & CM Administration](prds/prd-1-crusade-master-admin.md)
* [PRD-2 — Player Sign-Up](prds/prd-2-player-signup.md)
* [PRD-3 — Roster Import, Approval, & Rule Compliance](prds/prd-3-army-export-versioning.md)
* [PRD-4 — Events, Submissions, & Timeline](prds/prd-4-events-deltas.md)
* [PRD-5 — Approval System](prds/prd-5-approval-system.md)
* [PRD-6 — Technical Architecture & API Surface](prds/prd-6-technical-architecture.md)
* [PRD-7 — Testing Strategy](prds/prd-7-testing-strategy.md)

## Domain Concepts

Cross-cutting schema concepts that don't get their own PRD upstream but
warrant first-class OKF concepts here.

* [CampaignTeam](concepts/campaign-team.md) — Per-campaign narrative side (v3.2+). Mandatory in v3.4+.
* [Crusade Team Leader](concepts/crusade-team-leader.md) — Team-scoped approval authority (v3.11+).
* [ApprovalKind](concepts/approval-kind.md) — Canonical enum of every approval-gated action (v3.6+).
* [BattleReportForm](concepts/battle-report-form.md) — Per-Campaign JSON Schema (v3.8+).
* [HistoryEntry](concepts/history-entry.md) — Append-only history record (v3.10).
* [ChangesetGrouping](concepts/changeset-grouping.md) — G1–G7 configurable groupings (v3.10).
* [Rollback](concepts/rollback.md) — Tombstone + compensating entry pattern (v3.10).
* [CampaignState](concepts/campaign-state.md) — Lifecycle state machine: created → started → ended → archived (v3.18).
* [CampaignPhase](concepts/campaign-phase.md) — CM-authored narrative periods, cosmetic-only (v3.18 / v3.19).

## References

### v3 Architecture

* [Hapi](references/hapi.md) · [BullMQ](references/bullmq.md) · [Redis](references/redis.md) · [MinIO](references/minio.md) · [PostgreSQL](references/postgres.md) · [bs-roster-parser](references/bs-roster-parser.md) · [Rule Engine](references/rule-engine.md)

### Upstream data sources

* [Wahapedia](references/wahapedia.md) · [New Recruit](references/new-recruit-json.md) · [Crusade: Armageddon](references/crusade-armageddon.md)

### Competitors (paid)

* [Administratum](references/administratum.md) · [ServoCrypt](references/servocrypt.md)

## Validators

Four focused zero-dependency Node.js scripts under [`scripts/`](scripts/) — each
addresses one concern and exits 0/1/2 cleanly. Run from the bundle root:

```bash
node scripts/validate.js           . --check-links --strict --explain
node scripts/lint-frontmatter.js   . --strict --explain
node scripts/check-index-sync.js   . --explain
node scripts/check-orphans.js      . --strict --explain
```

A passing bundle reports `all good ✓` from all four. CI gate:

```bash
for s in validate lint-frontmatter check-index-sync check-orphans; do
  node scripts/$s.js . --strict || exit 1
done
```

## How to use this bundle

- For a high-level overview, start with [PRD-0](prds/prd-0-overview.md).
- For the lifecycle state machine, read [concepts/campaign-state.md](concepts/campaign-state.md) and PRD-1 §4.4.5.
- For Phases (cosmetic-only), read [concepts/campaign-phase.md](concepts/campaign-phase.md).
- For the testing strategy, read [PRD-7](prds/prd-7-testing-strategy.md).
- For the API/OpenAPI strategy, read [PRD-6](prds/prd-6-technical-architecture.md).
- See [`log.md`](log.md) for the v3.26-sync history.
