# Domain Concepts

Cross-cutting schema entities referenced by 2+ PRDs. Each is a `type: Domain Concept` rather than its own PRD because they are documented inline within a parent PRD's section.

Synced to upstream **v3.28** (commits `6cd2490` → `a916708`). See [`log.md`](../log.md) for the sync history.

## Data model (v3.28 overhaul)

* [CrusadeForce](/concepts/crusade-force.md) — A player's army in this campaign. Replaces `Roster`. Status: `pending_approval` | `deployed` | `withdrawn`.
* [CrusadeForceVersion](/concepts/crusade-force-version.md) — Immutable, monotonically-numbered snapshot. Replaces `RosterApproved`. Each upload creates a new version.
* [CrusadeArmy](/concepts/crusade-army.md) — Subset of units mustered from a `CrusadeForceVersion` for a specific battle. New in v3.28.

## Approvals & audit

* [ApprovalKind](/concepts/approval-kind.md) — Canonical TypeScript enum of every approval-gated action. v3.28: `crusade_force_*` renames, `crusade_force_creation` added, `faction_switch` removed.
* [ApprovalSource](/concepts/approval-source.md) — Field on ApprovalRequest recording HOW the request was decided. 3-value enum (v3.27).

## Roster history & groupings

* [HistoryEntry](/concepts/history-entry.md) — Append-only history record, generated on ApprovalRequest approval. References specific `CrusadeForceVersionId` (v3.28).
* [ChangesetGrouping](/concepts/changeset-grouping.md) — G1–G7 configurable groupings (v3.10).
* [Rollback](/concepts/rollback.md) — Tombstone + compensating entry pattern. v3.28 split into `crusade_force_revert` and `crusade_force_rollback`.

## Campaign lifecycle

* [CampaignState](/concepts/campaign-state.md) — Lifecycle state machine: created → started → ended → archived. v3.28 added full behavioral specs.
* [CampaignPhase](/concepts/campaign-phase.md) — CM-authored narrative periods. Cosmetic-only (v3.19).

## Teams, battles, notifications

* [CampaignTeam](/concepts/campaign-team.md) — Per-campaign narrative side. Mandatory (v3.4).
* [Crusade Team Leader](/concepts/crusade-team-leader.md) — Player with delegated team-scoped approval authority. Multi-leader (v3.12); TL gate at campaign start (v3.28).
* [BattleReportForm](/concepts/battle-report-form.md) — Per-Campaign JSON Schema for the post-battle update form.
* [BattleUpdate](/concepts/battle-update.md) — Per-player post-battle submission; references a `CrusadeArmy` or `CrusadeForceVersion` (v3.28).
* [Notification](/concepts/notification.md) — User-facing materialization of an `Event`; fanout function determines recipients (v3.26 / v3.28). Discord delivery added in v4.0 (PRD-8).
* [DiscordWebhook](/concepts/discord-webhook.md) — Per-team Discord webhook registration + delivery log schema (v4.0, PRD-8).