# Crusade Master App — PRDs

Product requirements for an app that lets a Crusade Master administer and track players across Warhammer 40,000 Crusade campaigns, fed by New Recruit JSON exports and Wahapedia data.

**MVP scope:** *Crusade: Armageddon* (11th-edition launch supplement, June 2026). The other three 10th-ed supplements (Leviathan, Tyrannic War, Pariah Nexus, Nachmund Gauntlet) ship in later iterations; the data model is scaffold-ready for all of them from day one.

## Documents

| File | Subsystem |
|------|-----------|
| [prd-0-overview.md](./prd-0-overview.md) | App overview, shared data model, architecture, MVP scope |
| [prd-1-crusade-master-admin.md](./prd-1-crusade-master-admin.md) | CM dashboard, campaign lifecycle, member management |
| [prd-2-player-signup.md](./prd-2-player-signup.md) | Account creation, invite-code join, faction picker, onboarding |
| [prd-3-army-export-versioning.md](./prd-3-army-export-versioning.md) | New Recruit JSON import, Wahapedia cross-ref, immutable RosterVersioning |
| [prd-4-events-deltas.md](./prd-4-events-deltas.md) | Event taxonomy, post-battle updates, delta computation, narrative events |
| [prd-5-approval-system.md](./prd-5-approval-system.md) | Unified approval pipeline, drift detection, reversibility |

## Companion data reference

For the underlying Wahapedia × 10th-ed Crusade data model these PRDs assume, see the `wahapedia-crusade-10th-data-reference.md` research document.

## Status

Drafts — pending review before implementation kickoff.
