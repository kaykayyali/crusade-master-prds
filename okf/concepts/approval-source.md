---
type: Domain Concept
title: ApprovalSource
description: "Field on ApprovalRequest recording HOW the request was decided. Values: cm_review | auto_approve_routine | self_approved. Removed co_cm_required_unavailable in v3.27."
resource: "https://github.com/kaykayyali/crusade-master-prds/blob/a916708/prd-5-approval-system.md"
tags:
  - concept
  - approval
  - audit
  - v3.27
  - v3.28
timestamp: "2026-06-28T23:28:00Z"
---

# ApprovalSource

`approvalSource` is a field on `ApprovalRequest` recording **how** the request was decided. It is distinct from `ApprovalRequest.status` (which records the *outcome*: pending/approved/rejected/withdrawn).

## Enum (v3.28)

```ts
approvalSource:
  | 'cm_review'                   // routed to a CM or TL (within team scope); covers pending and approved
  | 'auto_approve_routine'        // campaign's auto-approve-routine-battle-updates setting fired
  | 'self_approved'               // submitter's own action; auto-approved at the submitter's authority level
```

**Removed in v3.27**: `co_cm_required_unavailable`. The CM has full authority over their campaign and no second approver is required for any kind (per v3.27 authority hierarchy). High-impact kinds (`mass_reban`, `point_cap_change`, `roster_manual_edit`, etc.) are no longer special-cased — the CM unilaterally approves all of them.

## Semantic meaning

- **`cm_review`** — a CM or TL (within team scope) reviewed and approved (or is reviewing — the field is populated at request creation based on routing, not on decision)
- **`auto_approve_routine`** — the campaign's `auto_approve_routine_battle_updates: bool` setting fired (no anomalies in the battle data)
- **`self_approved`** — submitter's own action auto-approved at their authority level (Player / TL / CM filing on themselves)

The `pending | approved | rejected` lifecycle is `ApprovalRequest.status`. The routing-decision lineage is `approvalSource`. These are orthogonal axes.

## Use cases

- Audit filtering: "show me all approvals the CM did unilaterally" → `approvalSource = 'self_approved' AND submittedByUserId = cmId`
- Analytics: "show me auto-approved routine battle updates" → `approvalSource = 'auto_approve_routine'`
- Future hooks (narrative analytics, future audit surfaces): count by `approvalSource` for metrics without special-casing CM-as-player. Discord webhook delivery (PRD-8) consumes this field to attach approver metadata to embeds.

# Cross-references

- [PRD-5 — Approval System](/prds/prd-5-approval-system.md) — Schema definition, routing decision
- [PRD-0 — Overview](/prds/prd-0-overview.md) — Listed in shared data model
- [ApprovalKind](/concepts/approval-kind.md) — The `kind` field is orthogonal to `approvalSource`
- [CampaignState](/concepts/campaign-state.md) — `Campaign.status` may affect which ApprovalKinds can fire (e.g., `ended` state suspends routing)