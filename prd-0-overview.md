# PRD-0: Crusade Master App — Overview

> Shared architecture, data model, MVP scope (Armageddon), and links to subsystem PRDs.

---

## 1. Background and Goals

### 1.1 Background

Warhammer 40,000 Crusade is a narrative play mode where units gain experience, ranks, and battle honors across linked games. Running a group Crusade (typically 4–16 players over weeks/months) requires a "Crusade Master" to:

- Coordinate match pairings and scheduling
- Verify post-battle updates (XP, ranks, honours, scars, requisition spends)
- Enforce house rules and adjudicate disputes
- Maintain a consistent narrative arc

Today this is mostly done with paper rosters, spreadsheets, or paid tools (Administratum, ServoCrypt). The recent release of New Recruit's JSON export and Wahapedia's CSV data export make it possible to build an automated, self-hosted tool that any CM can run without depending on a third-party Patreon.

### 1.2 Goals

| Goal | Metric | Target |
|------|--------|--------|
| **Business**: replace paper/spreadsheet Crusade administration | Group campaigns using the app end-to-end | 5+ active campaigns within 90 days of launch |
| **User (CM)**: cut per-battle admin time | Time CM spends processing a post-battle update | < 2 minutes per battle |
| **User (Player)**: visibility into own force | Time for a player to see their current Crusade state | < 10 seconds (one screen) |
| **Product**: data ownership | % of user data exportable in open formats | 100% (JSON + CSV) |

### 1.3 MVP Scope

**Crusade: Armageddon** (launched June 2026 with 11th Edition Warhammer 40,000). The app MVP supports the full Armageddon rule set: alignment, supply limit, requisitions, logistics points, and Armageddon-specific agendas and relics.

**Explicit non-MVP (future iterations):**
- Crusade: Leviathan (10th-ed launch book)
- Crusade: Tyrannic War
- Crusade: Pariah Nexus
- Crusade: Nachmund Gauntlet

These are scaffolded in the data model from day one so the schema doesn't need a migration later, but their mechanic-specific UIs (e.g., Nachmund's three-alignment system) ship in PRD-6+.

---

## 2. User Types

| User | What they do | What they can see |
|------|--------------|-------------------|
| **Crusade Master (CM)** | Owns one or more campaigns. Approves post-battle updates, adjudicates disputes, generates events, manages the campaign lifecycle | All campaigns they own + all rosters in those campaigns |
| **Player** | Joins a campaign. Imports their army from New Recruit, files post-battle updates, requests requisitions | Only their own roster and public campaign info (leaderboard, narrative log) |
| **Spectator (read-only)** | Views campaign narrative, leaderboard, public rosters | Public campaign info only |
| **System Admin** | Operates the platform (errata refresh, abuse moderation) | All data, audit log access |

---

## 3. Architecture (shared)

```
┌──────────────────────────────────────────────────────────────┐
│                    Client (Web, mobile-first)                │
│  React or SvelteKit  ·  Tailwind  ·  IndexedDB cache         │
└──────────────────┬───────────────────────────────────────────┘
                   │ HTTPS
┌──────────────────▼───────────────────────────────────────────┐
│                     API Gateway                              │
│  Auth (OAuth or email-magic-link)  ·  Rate limiting          │
└──────────────────┬───────────────────────────────────────────┘
                   │
   ┌───────────────┼───────────────┬──────────────────┐
   │               │               │                  │
┌──▼─────────┐ ┌───▼──────────┐ ┌──▼─────────────┐ ┌──▼─────────┐
│ Campaign   │ │ Roster &     │ │ Battle &       │ │ Approval   │
│ Service    │ │ Crusade      │ │ Event Service  │ │ Workflow   │
│ (CM ops)   │ │ Card Service │ │ (deltas)       │ │ Service    │
└──┬─────────┘ └──┬───────────┘ └──┬─────────────┘ └──┬─────────┘
   │             │                │                  │
   └─────────────┴────────────────┴──────────────────┘
                     │
        ┌────────────┼─────────────┐
        │            │             │
   ┌────▼────┐  ┌─────▼─────┐ ┌────▼────────┐
   │Postgres │  │ Object    │ │ Wahapedia   │
   │ (OLTP)  │  │ Storage   │ │ Cache (CSV) │
   └─────────┘  │ (exports) │ └─────────────┘
                └───────────┘
```

**Key tech choices:**
- **Postgres** for relational data (campaigns, rosters, battles, audit log)
- **Object storage** (S3-compatible) for NR export JSON blobs, PDF rosters
- **Wahapedia data refresh** runs nightly; results cached in `wahapedia_cache` tables and joined to faction tables

---

## 4. Shared Data Model

These types are referenced by every subsystem PRD. Detailed fields live in each subsystem's PRD; the table here shows what crosses boundaries.

```ts
// === Identity ===
User { id, email, displayName, role: 'player' | 'cm' | 'admin', createdAt }
Campaign { id, name, supplementId, cmUserId, status, createdAt, settings }
CampaignMember { campaignId, userId, joinedAt, status, factionId }

// === Roster (per player, per campaign) ===
Roster { id, campaignId, ownerUserId, factionId, name, version, createdAt }
RosterVersion { id, rosterId, versionNumber, sourceImportId, snapshotJson, pointLimit, createdAt }
Unit { id, rosterVersionId, wahapediaDatasheetId, name, customName, rank, xp, status }

// === Crusade card (lives on Unit) ===
BattleHonour { id, unitId, name, sourceSupplementId, gainedAt }
BattleScar { id, unitId, name, sourceSupplementId, gainedAt }

// === Supplements ===
CrusadeSupplement { id, code, name, edition, releaseDate }  // 'armageddon', 'nachmund', etc.

// === Battles ===
Battle { id, campaignId, playerAId, playerBId, scheduledAt, status, resultA, resultB, missionId }
BattleUpdate { id, battleId, submittedByUserId, submittedAt, status: 'pending' | 'approved' | 'rejected' }
Delta { id, battleUpdateId, entityType, entityId, field, beforeValue, afterValue, reason }

// === Approval ===
ApprovalRequest { id, kind, submittedByUserId, payload, status, reviewerUserId, decidedAt, decisionReason }

// === Audit ===
AuditLog { id, actorUserId, action, targetType, targetId, payload, occurredAt }
```

**Identifiers are UUIDv7** (time-ordered) so audit log scans are efficient.

---

## 5. Subsystem PRDs

| PRD | Subsystem | Status |
|-----|-----------|--------|
| PRD-1 | Crusade Master Administration | Drafted |
| PRD-2 | Player Sign-Up | Drafted |
| PRD-3 | Army Export & Versioning | Drafted |
| PRD-4 | Events & Deltas | Drafted |
| PRD-5 | Approval System | Drafted |

Each PRD can be developed and shipped independently once the shared data model is implemented. Dependencies are explicit in each PRD's "Dependencies" section.

---

## 6. Crusade Supplement Coverage

| Supplement | Code | MVP? | Mechanic highlights |
|------------|------|------|---------------------|
| Armageddon | `armageddon` | **Yes** | Alignment, Supply Limit, Armageddon-specific Requisitions |
| Nachmund Gauntlet | `nachmund` | Future | 3 alignments (Guardians/Despoilers/Marauders), Logistics Points |
| Pariah Nexus | `pariah` | Future | Contagion mechanic, Nephilim agendas |
| Tyrannic War | `tyrannic` | Future | Tyrannic agendas, faction-gated objectives |

The MVP is **Armageddon** because it ships with 11th-ed, is the active launch supplement, and is the only supplement that requires no carryover from 10th-ed data.

---

## 7. Success Metrics

| Metric | Definition | Target |
|--------|------------|--------|
| Time-to-first-update | From player joining a campaign to first post-battle update filed | < 30 min |
| CM admin time per battle | CM time per battle approval | < 2 min |
| Roster import success rate | NR imports that produce a valid roster without manual fixup | > 90% |
| Data freshness | Time from Wahapedia data update to reflected in app | < 24h |
| Player retention | % of players still filing updates at week 8 | > 60% |

---

## 8. Non-Goals (MVP)

- ❌ Matched Play / non-Crusade 40K rules
- ❌ Tournament mode / pairings engine
- ❌ Mobile native apps (web-only, mobile-responsive)
- ❌ Real-time push notifications (email + in-app only for MVP)
- ❌ 9th-ed Crusade support
- ❌ Other Games Workshop systems (Age of Sigmar, Kill Team, Horus Heresy)

---

## 9. Open Questions

- **Auth provider**: roll our own (email magic link) or use Supabase/Clerk? (TBD by infra team)
- **Hosting target**: Vercel + Supabase vs self-hosted Docker? (TBD)
- **Data residency**: EU-only for GDPR, or multi-region? (TBD)
- **Multi-tenant CMs**: can one user be CM of multiple campaigns? (Yes — supported in schema, UI in PRD-1)

---

## 10. References

- Wahapedia × 10th-ed Crusade data reference (companion research doc, deep-research output)
- New Recruit JSON export format (BattleScribe schema dialect)
- Administratum (Goonhammer) — closest commercial competitor
- ServoCrypt — closest open collaborative competitor
- *Crusade: Armageddon* (Games Workshop, June 2026)
