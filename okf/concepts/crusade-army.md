---
type: Domain Concept
title: CrusadeArmy
description: "A subset of units mustered from a CrusadeForceVersion for a specific battle. Distinct from the force's full OoB. New in v3.28."
resource: "https://github.com/kaykayyali/crusade-master-prds/blob/a916708/prd-0-overview.md"
tags:
  - concept
  - crusade-army
  - muster
  - v3.28
  - data-model
timestamp: "2026-06-28T23:28:00Z"
---

# CrusadeArmy

A `CrusadeArmy` is the subset of units a player actually takes to a specific battle. It is **distinct from** the `CrusadeForce` (full OoB): a player with a 3000pt force might muster 2000pt armies for individual games.

**New in v3.28** as part of the data model overhaul that replaces `Roster / RosterDraft / RosterApproved`.

## Fields

```ts
CrusadeArmy {
  id, crusadeForceVersionId,         // which approved OoB this was mustered from
  battleId?,                         // linked battle (null if ad-hoc / saved muster)
  name?,                             // optional player-given name, e.g. "Strike Force Alpha"
  selectedUnitIds: string[],         // subset of unit IDs from the force version
  totalPoints,
  createdAt
}
```

## Why a separate entity?

NR's "Crusade Force" export contains the full OoB. For a specific battle, the player musters a *subset* of that force within the campaign point cap. The campaign management app needs to record what was actually taken to a battle, separate from the force's full OoB, because:

- The mustered army is what's referenced from a `Battle` row
- A 3000pt force can muster 2000pt armies — these are valid even though the force exceeds the campaign point cap
- Multiple armies can be mustered from the same force version over a campaign

A saved muster (not linked to a battle) lets players pre-build army lists for tournaments.

## Battle-update gating

A `Battle` row references the `CrusadeArmy` (or, if no specific muster was filed, `CrusadeForceVersion`) used in that game. The post-battle update flow uses the army's `selectedUnitIds` as the starting point for XP/honour/scar changes.

# Cross-references

- [PRD-0 — Overview](/prds/prd-0-overview.md) — Schema definition
- [PRD-3 — Roster Import, Approval, & Rule Compliance](/prds/prd-3-army-export-versioning.md) — Force version + army creation flow
- [PRD-4 — Events, Submissions, & Timeline](/prds/prd-4-events-deltas.md) — Battle record references army
- [CrusadeForce](/concepts/crusade-force.md) — Parent entity
- [CrusadeForceVersion](/concepts/crusade-force-version.md) — Each army is mustered from a specific version
- [BattleReportForm](/concepts/battle-report-form.md) — Post-battle form operates on the army's units
- [New Recruit](/references/new-recruit-json.md) — Muster UI lives in NR; app records it