# Domain Concepts

Cross-cutting schema entities referenced by 2+ PRDs. Each is a `type: Domain Concept` rather than its own PRD because they are documented inline within a parent PRD's section.

* [CampaignTeam](/concepts/campaign-team.md) — Per-campaign narrative side, distinct from a 40K Faction (v3.2+). Mandatory in v3.4+.
* [Crusade Team Leader](/concepts/crusade-team-leader.md) — Player with delegated team-scoped approval authority (v3.11+). Multi-leader (v3.12) + removal workflow + campaign-creation gate (v3.13).
* [ApprovalKind](/concepts/approval-kind.md) — Canonical TypeScript enum (v3.6+); v3.10 rollback kinds, v3.12 team-leader kinds, v3.11 approvalSource field.
* [BattleReportForm](/concepts/battle-report-form.md) — Per-Campaign JSON Schema for the post-battle update form (v3.8+).
* [HistoryEntry](/concepts/history-entry.md) — Append-only history record, generated on ApprovalRequest approval (v3.10).
* [ChangesetGrouping](/concepts/changeset-grouping.md) — G1–G7 configurable groupings (v3.10).
* [Rollback](/concepts/rollback.md) — Tombstone + compensating entry pattern. CM-approved (v3.10).
* [CampaignState](/concepts/campaign-state.md) — Lifecycle state machine: created → started → ended → archived (v3.18, mermaid v3.23).
* [CampaignPhase](/concepts/campaign-phase.md) — CM-authored narrative periods, cosmetic-only (v3.18, refined v3.19).
