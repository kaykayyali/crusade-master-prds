# PRD-1: Crusade Master Administration

> Crusader Master dashboard, campaign lifecycle, member management, and CM-only operations.

---

## 1. Goals

Enable a Crusade Master to run one or more campaigns end-to-end without depending on a third-party service. The CM is the campaign's owner; they configure it, invite players, monitor progress, generate narrative events, and approve post-battle updates.

**Success metric**: A CM can launch a fully-configured campaign with 8 players in under 15 minutes.

---

## 2. User Stories

- **As a CM**, I can create a new campaign, choose the supplement (Armageddon for MVP), and configure house rules (point cap, max games/week, OoA test variant).
- **As a CM**, I can generate an invite code/link that lets players join without me manually adding them.
- **As a CM**, I can see all rosters in my campaign at a glance, with rank distribution, total RP, and outstanding approval requests.
- **As a CM**, I can pause, archive, or end a campaign.
- **As a CM**, I can override any data the system holds (with audit trail).
- **As a CM**, I can run multiple campaigns.

---

## 3. Feature Modules

### 3.1 Campaign Creation

| Field | Type | Notes |
|-------|------|-------|
| name | string | 3-60 chars, required |
| supplement | enum | `armageddon` for MVP; `nachmund`, `pariah`, `tyrannic` for future |
| point_cap | int | Default 2000, range 500–3000 |
| max_games_per_player_per_week | int | Default 2 |
| ooa_test_variant | enum | `standard` (D6) or `lenient` (D6, 1-2 fail) |
| allow_mixed_supplements | bool | Default false |
| custom_house_rules | markdown | Free text, rendered on campaign page |
| start_date | date | When battles can begin being filed |

**Output**: campaign record, unique join code (8-char alphanumeric), shareable URL.

### 3.2 Member Management

- CM sees a member list: `displayName, faction, joinedAt, status, lastActivityAt`
- CM can: invite (via email or link), remove, suspend, promote to co-CM
- Players can self-serve removal (leave campaign)
- Co-CMs have all CM rights except: deleting the campaign, transferring ownership

### 3.3 Dashboard

The CM dashboard surfaces:
1. **Pending approvals count** (clickable → PRD-5 inbox)
2. **Active campaigns** (cards, with quick stats: # players, # battles, # pending updates)
3. **Leaderboard preview** (top 3 forces by RP, by battles played)
4. **Recent activity feed** (last 10 events across the CM's campaigns)
5. **Narrative log** (auto-aggregated from approved battles, see PRD-4)
6. **Errata alert** (banner when Wahapedia data refresh affected rules the campaign uses)

### 3.4 Campaign Settings

Editable post-creation: point cap, max games/week, OoA variant, house rules, supplement (with confirmation if changes affect active units).

Deletable: CM can archive (soft delete) or hard-delete. Hard-delete is logged and requires typed confirmation of campaign name.

### 3.5 Override Tool

CMs can edit any field on any record, with required reason text. Every override writes to the audit log and shows in the affected player's notification.

Examples:
- Force-set a unit's rank after a manual re-roll
- Manually grant a Battle Honour from a non-standard source
- Reverse an erroneous approval

---

## 4. User Flow

### 4.1 Happy Path: Create Campaign

```mermaid
flowchart TD
    A[CM lands on /dashboard] --> B{Has campaign?}
    B -->|No| C[Click 'New Campaign']
    B -->|Yes| D[Open existing]
    C --> E[Fill form: name, supplement, point cap]
    E --> F[Submit]
    F --> G[System creates campaign + join code]
    G --> H[CM shares join code/URL with players]
    H --> I[Players join (see PRD-2)]
    I --> J[CM dashboard shows member count growing]
```

### 4.2 Branch: Mid-Campaign Supplement Switch

If a CM switches supplement (e.g., to add Nachmund rules later), the system runs a migration step:
- Existing units' honours/scars are preserved
- New supplement-specific fields default to safe values
- CM sees a migration report before confirming

---

## 5. CM-Only Operations (cross-reference)

| Operation | Where defined |
|-----------|---------------|
| Generate narrative event | PRD-4 |
| Approve post-battle update | PRD-5 |
| Adjust leaderboard scoring | PRD-1 (this doc) |
| Edit campaign settings | PRD-1 |
| Override any record | PRD-1 |
| Export campaign as PDF | PRD-1 (feature) |

---

## 6. Out of Scope (this PRD)

- Player-side roster editing (PRD-3)
- Approval workflow logic (PRD-5)
- Event generation rules (PRD-4)

---

## 7. Dependencies

- **PRD-0** for shared data model (`Campaign`, `CampaignMember`, `User`, `CrusadeSupplement`)
- **PRD-5** for the approval inbox link
- **PRD-4** for the event generation trigger and narrative log
- **Auth service** (PRD-0, infra-level) for CM role gating

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Time from "create" click to "campaign live" | < 2 min |
| Campaigns per active CM | > 1 (multi-campaign supported) |
| CM override usage rate | < 5% of unit changes (otherwise approval flow is broken) |

---

## 9. Edge Cases

1. **CM account deleted**: campaign ownership must transfer or campaign is archived. UI for ownership transfer is a single-page "Transfer ownership" wizard.
2. **CM is also a player in own campaign**: allowed by default, with a clear "playing in your own campaign" warning to other members.
3. **All players leave**: campaign goes into "dormant" state; auto-archive after 90 days.
4. **Two CMs edit settings concurrently**: last-write-wins with a 5-second debounce; second writer sees a "someone else just edited" toast.
