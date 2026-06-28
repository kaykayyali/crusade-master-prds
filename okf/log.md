# Directory Update Log

## 2026-06-28

### v3.28 sync

* **Update**: Bundle synced to upstream v3.28 (commits `6cd2490` → `a916708`; v3.28.1 includes NR export detection logic). **8 PRD concepts**, **14 Domain Concepts** (added CrusadeForce, CrusadeForceVersion, CrusadeArmy, ApprovalSource, BattleUpdate, Notification), **11 Reference concepts**, **4 validators**.

* **Update**: All 8 PRDs and 9 existing concepts frontmatter updated to:
  - `timestamp: "2026-06-28T23:28:00Z"`
  - `resource:` URLs point at `a916708` commit
  - Titles reflect v3.28 changes (e.g., PRD-3 title: "Roster Import, Approval, & Rule Compliance" → "CrusadeForce Import, Approval, & Rule Compliance")

* **Creation**: New Domain Concepts reflecting v3.28 data model and v3.27 authority simplification:
  - [CrusadeForce](/concepts/crusade-force.md) — A player's army in a campaign. Replaces `Roster`. Status lifecycle. Multiple forces per player.
  - [CrusadeForceVersion](/concepts/crusade-force-version.md) — Immutable, monotonically-numbered snapshot of a force's OoB. Replaces `RosterApproved`.
  - [CrusadeArmy](/concepts/crusade-army.md) — Subset of units mustered from a `CrusadeForceVersion` for a specific battle. New entity in v3.28.
  - [ApprovalSource](/concepts/approval-source.md) — 3-value enum (was 4 before v3.27 removed `co_cm_required_unavailable`). Documents the v3.27 simplification.
  - [BattleUpdate](/concepts/battle-update.md) — Per-player post-battle submission; references `CrusadeArmy` or `CrusadeForceVersion` (v3.28).
  - [Notification](/concepts/notification.md) — User-facing materialization of an `Event`; fanout function determines recipients.

* **Update**: Bundle-root `index.md` rewritten for v3.28 framing — covers data model overhaul, authority simplification, polling real-time strategy, NR export validation, retrospective view.

* **Update**: `concepts/index.md` reorganized into sub-sections: Data model (v3.28), Approvals & audit, Roster history & groupings, Campaign lifecycle, Teams/battles/notifications.

* **Update**: Existing concept descriptions updated to reflect v3.28 (e.g., Rollback mentions the split into `crusade_force_revert` and `crusade_force_rollback`).

* **Update**: Public source PRDs updated to link to OKF concept pages for cross-cutting concepts (CrusadeForce, ApprovalKind, CampaignState, etc.). Example: PRD-3 now references `crusade-force`, `crusade-force-version`, `crusade-army` directly.

### Upstream commit history (v3.27 → v3.28.1)

| Commit | Date | Theme |
|--------|------|-------|
| `6cd2490` | 2026-06-28T19:43:00Z | v3.27: simplify authority hierarchy — remove co-CM concept |
| `2766f72` | 2026-06-28T23:08:00Z | v3.28: data model overhaul + polling + retrospective view |
| `a916708` | 2026-06-28T23:28:00Z | v3.28.1: NR export detection logic + 4 reference files |

### Bundled validation references (v3.28)

Four `validators/nr-exports/*.json` files in the source repo shipped alongside this bundle:

- `haan-crusade-10th.json` — known crusade shape, T'au Empire 10th ed
- `cadian-67-crusade-10th.json` — known crusade shape, Astra Militarum 10th ed
- `comp-list-non-crusade.json` — known non-crusade export (matched-play comp list)
- `cadian-67th-legion-11th-ed.json` — known crusade shape, 11th ed (forward-compat)

Plus Python and TypeScript validators. All four files classify correctly. Detection logic works for both 10th and 11th editions without modification.

## 2026-06-28

### v3.26 sync — initial bundle

* **Creation**: v3.26 sync of the Crusade Master OKF bundle at upstream commit `0c3c626`. **8 PRD concepts** under `prds/` (added PRD-6 *Technical Architecture / API Surface* and PRD-7 *Testing Strategy*), **9 Domain Concepts** under `concepts/` (added *CampaignState* and *CampaignPhase*), **11 Reference concepts** under `references/`, **4 validators** under `scripts/`.
