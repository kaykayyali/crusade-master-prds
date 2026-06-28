---
type: Domain Concept
title: BattleUpdate
description: "A per-player post-battle submission against a specific Battle. References the CrusadeArmy (or CrusadeForceVersion) used. Triggers post_battle_update ApprovalKind (PRD-5)."
resource: "https://github.com/kaykayyali/crusade-master-prds/blob/a916708/prd-4-events-deltas.md"
tags:
  - concept
  - battle
  - post-battle
  - v3.28
timestamp: "2026-06-28T23:28:00Z"
---

# BattleUpdate

A `BattleUpdate` is a per-player post-battle submission. A 1v1 game produces 2 `BattleUpdate`s (one per player); a 4-player game produces 4 (one per participating player). Each is its own `ApprovalRequest` (kind: `post_battle_update`).

## Fields

```ts
BattleUpdate {
  id, battleId, submittedByUserId, submittedAt,
  status: 'pending_approval' | 'approved' | 'rejected' | 'failed' | 'auto_approved',
  crusadeArmyId?,                    // which army was mustered for this battle (v3.28)
  crusadeForceVersionId?,            // or which force version was current if no specific muster filed (v3.28)
  // Per-player form data, validated against Campaign.battleReportSchema:
  opponent, mission, result,
  agendasAttempted: string[],
  agendasAchieved: string[],
  perUnitXpChanges: { unitId, xpDelta }[],
  perUnitHonourChanges: { unitId, honourAdded: string }[],
  perUnitScarChanges: { unitId, scarAdded: string }[],
  perUnitRankChanges: { unitId, newRank: string }[],
  ooATestResult: 'pass' | 'fail' | 'not_attempted',
  narrative: string | null,
}
```

## BattleReportForm validation

The form payload is validated against `Campaign.battleReportSchema` (per PRD-0 §4, PRD-4 §4.1) — a per-campaign JSON Schema that is **pinned at campaign creation** (`CrusadeSupplement.battleReportSchema` is copied at that moment). Future updates to the supplement's schema do NOT affect in-flight campaigns.

## Approval routing

Each `BattleUpdate` is its own `ApprovalRequest` of kind `post_battle_update`. Multiple `BattleUpdate`s from the same battle can be batched in the CM inbox (PRD-5 §5.4).

The CM's `auto_approve_routine_battle_updates: bool` campaign setting can auto-approve routine battle updates without anomalies. Anomalies that always require approval:
- OoA test failed
- Requisition purchased (in the battle's aftermath)
- Honours / scars added beyond supplement's universal list
- Manual edits outside NR import
- Submitter is a new account (< 7 days)
- Submitter is the CM themselves (CM-as-player)

# Cross-references

- [PRD-4 — Events, Submissions, & Timeline](/prds/prd-4-events-deltas.md) — Battle update flow, event taxonomy
- [PRD-5 — Approval System](/prds/prd-5-approval-system.md) — `post_battle_update` ApprovalKind
- [CrusadeArmy](/concepts/crusade-army.md) — What was mustered for the battle
- [CrusadeForceVersion](/concepts/crusade-force-version.md) — Force version current at the time of the battle
- [BattleReportForm](/concepts/battle-report-form.md) — Per-campaign JSON Schema for validation
- [ApprovalKind](/concepts/approval-kind.md) — `post_battle_update` enum value
- [HistoryEntry](/concepts/history-entry.md) — Generated on approval