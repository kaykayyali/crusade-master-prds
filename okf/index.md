---
okf_version: "0.1"
---

# Crusade Master App — OKF Bundle (v3.28 sync + v4.0 PRD-8)

This bundle captures the product requirements for the Crusade Master app
synced to upstream v3.28 (commits `6cd2490` → `a916708`; v3.28.1 adds NR
export detection logic). It documents:

- The **locked stack** — Hapi/Node/TS + BullMQ + Python parser subprocess + configurable rule engine
- **Campaign Teams** (v3.2+, mandatory v3.4+) and **Crusade Team Leader** role (v3.11+) with team-scoped approval authority (v3.12) + TL gate at campaign start (v3.28)
- **NR-as-source-of-truth** principle (v3.9) — the app parses and displays but never mutates
- **Data model overhaul (v3.28)** — `CrusadeForce / CrusadeForceVersion / CrusadeArmy` replace the prior `Roster / RosterDraft / RosterApproved` model. Multiple forces per player; army is first-class entity.
- **Authority hierarchy simplification (v3.27)** — CM unilateral authority; no second approver for any kind
- **State vs Phase distinction** (v3.18, cosmetic-only Phase v3.19)
- **History layer** — HistoryEntry, ChangesetGroupings G1–G7, Rollback (v3.10)
- **Approval-Gating** principle (v3.5) and canonical `ApprovalKind` enum (v3.6, v3.27, v3.28)
- **Always-fire re-assessment warning** (v3.17) — when approval settings change with pending approvals
- **Auth** (v3.15) — Discord OAuth primary, email magic-link fallback
- **Polling real-time strategy (v3.28)** — `useInboxPoller` composable, 20s cursor-based fetch
- **OpenAPI/Swagger code-first API strategy** (v3.25) via @hapi/swagger
- **Event taxonomy** (v3.17 expansion) covering campaign / member / team / roster / battle lifecycle
- **Event→Notification fanout** (v3.26)
- **NR export validation gate (v3.28)** — parse-job step 0 detects Crusade Force exports
- **Per-team Discord webhook forwarding (v4.0, PRD-8)** — TL/CM registers a Discord webhook URL per team; team-scoped events forwarded as rich embeds via a BullMQ delivery worker with retry + auto-disable
- **`ended` and `archived` state behavior** (v3.28)
- **Retrospective View (v3.28)** — archived campaigns get a read-only, cross-team UI shell
- **Vitest + testcontainers + Playwright** testing strategy (PRD-7, v3.24+)

The source PRDs live in
[kaykayyali/crusade-master-prds](https://github.com/kaykayyali/crusade-master-prds);
each PRD is a separate OKF concept under [`prds/`](prds/).

## Subsystem PRDs

* [PRD-0 — Overview](prds/prd-0-overview.md)
* [PRD-1 — Instance Admin & CM Administration](prds/prd-1-crusade-master-admin.md)
* [PRD-2 — Player Sign-Up](prds/prd-2-player-signup.md)
* [PRD-3 — CrusadeForce Import, Approval, & Rule Compliance](prds/prd-3-army-export-versioning.md)
* [PRD-4 — Events, Submissions, & Timeline](prds/prd-4-events-deltas.md)
* [PRD-5 — Approval System](prds/prd-5-approval-system.md)
* [PRD-6 — Technical Architecture & API Surface](prds/prd-6-technical-architecture.md)
* [PRD-7 — Testing Strategy](prds/prd-7-testing-strategy.md)
* [PRD-8 — Discord Integration via Webhooks](prds/prd-8-discord-webhooks.md) **(v4.0, NEW)**

## Domain Concepts

Cross-cutting schema concepts that don't get their own PRD upstream but
warrant first-class OKF concepts here.

### Data model (v3.28)

* [CrusadeForce](concepts/crusade-force.md) — A player's army. Replaces `Roster` (v3.28).
* [CrusadeForceVersion](concepts/crusade-force-version.md) — Immutable versioned snapshot. Replaces `RosterApproved` (v3.28).
* [CrusadeArmy](concepts/crusade-army.md) — Mustered subset for a battle. New in v3.28.

### Approvals & audit

* [ApprovalKind](concepts/approval-kind.md) — Canonical enum (v3.6+).
* [ApprovalSource](concepts/approval-source.md) — 3-value enum (v3.27).

### History & changesets

* [HistoryEntry](concepts/history-entry.md) — Append-only record (v3.10).
* [ChangesetGrouping](concepts/changeset-grouping.md) — G1–G7 groupings (v3.10).
* [Rollback](concepts/rollback.md) — Tombstone + compensating entry (v3.10; split in v3.28).

### Lifecycle

* [CampaignState](concepts/campaign-state.md) — State machine (v3.18; full behavior v3.28).
* [CampaignPhase](concepts/campaign-phase.md) — Narrative periods, cosmetic-only (v3.19).

### Teams, battles, notifications

* [CampaignTeam](concepts/campaign-team.md) — Per-campaign side (v3.4+).
* [Crusade Team Leader](concepts/crusade-team-leader.md) — Team-scoped authority (v3.11+).
* [BattleReportForm](concepts/battle-report-form.md) — Per-Campaign JSON Schema (v3.8+).
* [BattleUpdate](concepts/battle-update.md) — Per-player post-battle submission (v3.28).
* [Notification](concepts/notification.md) — User-facing materialization of an Event (v3.26). Discord delivery added in v4.0 (PRD-8).
* [DiscordWebhook](concepts/discord-webhook.md) — Per-team Discord webhook registration + delivery log schema (v4.0, PRD-8).

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
- For the data model, read [concepts/crusade-force.md](concepts/crusade-force.md), [concepts/crusade-force-version.md](concepts/crusade-force-version.md), and [concepts/crusade-army.md](concepts/crusade-army.md).
- For Phases (cosmetic-only), read [concepts/campaign-phase.md](concepts/campaign-phase.md).
- For the authority hierarchy (v3.27: no second approver), read PRD-5 §3.2 and PRD-1 §5.
- For the testing strategy, read [PRD-7](prds/prd-7-testing-strategy.md).
- For the API/OpenAPI strategy, read [PRD-6](prds/prd-6-technical-architecture.md).
- For real-time polling, read PRD-6 §3.1.
- For Discord webhook delivery, read PRD-8 + `concepts/discord-webhook.md`.
- For NR export detection, read PRD-3 §3.0 and `validators/`.
- See [`log.md`](log.md) for the v3.28 sync history.
