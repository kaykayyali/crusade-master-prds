# Directory Update Log

## 2026-06-28

* **Creation**: v3.26 sync of the Crusade Master OKF bundle at upstream commit `0c3c626`. **8 PRD concepts** under `prds/` (added PRD-6 *Technical Architecture / API Surface* and PRD-7 *Testing Strategy*), **9 Domain Concepts** under `concepts/` (added *CampaignState* and *CampaignPhase*), **11 Reference concepts** under `references/`, **4 validators** under `scripts/`.

* **Update**: Bundle-root `index.md` rewritten for v3.26 framing.

* **Creation**: New Domain Concepts added in this resync:
  - [CampaignState](concepts/campaign-state.md) — Lifecycle state machine: created → started → ended → archived (v3.18). Distinct from Phase.
  - [CampaignPhase](concepts/campaign-phase.md) — CM-authored narrative periods; cosmetic-only per v3.19 (no rule enforcement).

* **Update**: Bundle now reflects v3.17–v3.26 upstream changes:
  - v3.17: comprehensive event taxonomy expansion (PRD-4 §3); always-fire re-assessment warning (PRD-5 §5.7)
  - v3.18: State vs Phase distinction (PRD-0 §4, PRD-1 §4.4.5)
  - v3.19: phase effects are cosmetic only (PRD-1 §4.4.5)
  - v3.20: empty UI surfaces visible only to users who can act
  - v3.21: cross-PRD consistency audit (fix 4 inconsistencies)
  - v3.22: round 2 audit fixes
  - v3.23: mermaid diagrams for relationships, inheritance, flows
  - v3.25: PRD-6 (Technical Architecture / Swagger), PRD-7 (Testing Strategy) added
  - v3.26: final cleanup, Event→Notification fanout

* **Update**: Linkified prose cross-references across all 8 PRDs and 9 Domain Concepts.

### Upstream commit history (v3.16 → v3.26)

| Commit | Date | Theme |
|--------|------|-------|
| `c5b9374` | 2026-06-28T16:31:42Z | v3.16: authority is current-ruleset; ruleset-change warning |
| `615c782` | 2026-06-28T16:53:42Z | v3.17: always-fire warning + comprehensive event taxonomy + no live updates |
| `e706fbe` | 2026-06-28T17:05:40Z | v3.18: State vs Phase + event archival deferred |
| `0a03b9c` | 2026-06-28T17:15:52Z | v3.19: phase effects are cosmetic only |
| `7ac4119` | 2026-06-28T18:27:28Z | v3.20: empty UI surfaces visible only to users who can act |
| `00dc36d` | 2026-06-28T18:32:25Z | v3.21: cross-PRD consistency audit — fix 4 inconsistencies |
| `0bb52c7` | 2026-06-28T18:37:16Z | v3.22: round 2 audit fixes |
| `ccc18e7` | 2026-06-28T18:48:42Z | v3.23: mermaid diagrams for relationships, inheritance, flows |
| `55146e8` | 2026-06-28T18:52:14Z | v3.25: PRD-6 (Technical Architecture / Swagger) + PRD-7 (Testing Strategy) |
| `0c3c626` | 2026-06-28T20:34:04Z | v3.26: final cleanup — terminology, diagrams, inconsistencies |

PRD body growth in this resync (v3.16 → v3.26):
- prd-0: 494 → 669 lines (+175, +State vs Phase + glossary + audit fixes)
- prd-1: 632 → 827 lines (+195, +state machine + phases + mermaid diagrams)
- prd-2: 883 → 937 lines (+54, +audit fixes)
- prd-3: 459 → 510 lines (+51, +audit fixes + v3.24 test stack)
- prd-4: 567 → 693 lines (+126, +event taxonomy expansion + State vs Phase + fanout)
- prd-5: 1020 → 1207 lines (+187, +always-fire warning + audit fixes + fanout)
- prd-6: NEW, 475 lines
- prd-7: NEW, 619 lines
- TOTAL: 5937 lines across 8 PRDs
