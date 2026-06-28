# Crusade Master App — PRDs

Product requirements for a self-hosted, multi-tenant app that lets a Crusade Master administer and track players across Warhammer 40,000 Crusade campaigns, fed by New Recruit JSON imports parsed by the user's existing `bs-roster-parser` Python library.

**Stack** (v3): Vite + Vue 3 + TypeScript (frontend) · @hapi/hapi + Node 22 + TypeScript (backend) · PostgreSQL · MinIO · BullMQ + Redis (async pipeline) · Python 3.10+ parser subprocess · Docker Compose.
**MVP scope**: *Crusade: Armageddon* (10th Edition, June 2025) only.
**Companion data reference**: `wahapedia-crusade-10th-data-reference.md` (in the companion research folder; the app's data model assumes this content).
**Parser source**: `bs-roster-parser` Python library (referenced from PRD-3, lives in its own repo).

## Documents

| File | Subsystem |
|------|-----------|
| [prd-0-overview.md](./prd-0-overview.md) | App overview, shared data model, architecture, MVP scope |
| [prd-1-crusade-master-admin.md](./prd-1-crusade-master-admin.md) | Instance admin + CM dashboard, campaign lifecycle |
| [prd-2-player-signup.md](./prd-2-player-signup.md) | Tenant-scoped account creation, invite-code join, faction picker |
| [prd-3-army-export-versioning.md](./prd-3-army-export-versioning.md) | BullMQ pipeline, parser integration contract, configurable rule engine |
| [prd-4-events-deltas.md](./prd-4-events-deltas.md) | Event taxonomy, submission gating, Timeline |
| [prd-5-approval-system.md](./prd-5-approval-system.md) | Unified approval pipeline, `roster_approval` as primary kind |

## CHANGELOG

### v3.19 (current) — Phase effects are cosmetic only

Per user: "The phase effects are not enforced as part of this system yet. They are cosmetic for now. Players can enforce the rules as they like in their matches."

**Simplification of v3.18:**
- The `CampaignPhase.effects` field is **reserved for v1.x** but always null in v1. The system does not interpret or enforce it.
- The `CampaignPhase.description` field is markdown narrative content, **displayed to players as flavor text** but not interpreted by the system.
- Players read the active phase description and apply any rule modifications themselves at the table.
- This is consistent with the broader principle from PRD-0 §4b.2 (NR-as-source-of-truth; the app is not a rules adjudicator) and PRD-3 §6 (rule engine is campaign-level only, not unit-level).

**What this means for v1:**
- Phases are 100% narrative context: banner on the dashboard, header in the narrative log, phase delimiters in the timeline view.
- Phase activation never affects which rules fire, which requisitions are available, what the point cap is, or any other system behavior.
- v1.x could add structured `effects` documents that the system interprets — but per user direction, that's deferred indefinitely until there's a clear use case.

**Where this is documented:**
- PRD-0 §4: `CampaignPhase` schema comment explicitly says effects are cosmetic-only.
- PRD-1 §4.4.5: Phases section makes the cosmetic-only nature explicit with concrete examples.
- PRD-4 §3.2: State vs Phase comparison table includes the row "Does the system enforce phase rules? **No (v3.19).**"

### v3.18 — State vs Phase + event archival deferred

Two refinements:

**1. State vs Phase are distinct concepts (PRD-0 §4, PRD-1 §4.4.5, PRD-4 §3.2).**
Per user: "Let's break phases into 2 construct. Campaigns have a state, and a phase. State is internal, tracking if it's created. started, ended, or archived. Phase would be a field section of data for the CM, useful for periods in the campaign where certain modifiers or lore is in place."

- **State** = `Campaign.status` (lifecycle): `created` → `started` → `ended` → `archived` (with optional re-open). System-managed, gates functionality (no approvals unless `started`, read-only if `archived`).
- **Phase** = `CampaignPhase` table (CM data): narrative periods within a `started` campaign. CM-authored, freely toggled. At most one active at a time in v1.
- Example given by user: Phase 1 - "Arrivals" — "As forces land on the planet, orbital drop ships battle for dominance. Those who succeed may provide orbital support to drop ships, aiding them to setup fortifications and forward operations."

**Why separate them:**
- State is system-managed; phase is CM data. Mixing them would mean the CM's narrative choices accidentally gate functionality.
- State transitions emit `campaign.started` / `campaign.ended` / `campaign.archived` events.
- Phase transitions emit `campaign.phase_activated` / `campaign.phase_deactivated` / `campaign.phase_created` / `campaign.phase_updated` / `campaign.phase_removed` events.

**Crusade Administration panel → Phases section (PRD-1 §4.4.5):**
- CM creates phases ahead of time (multiple, all deactivated).
- CM activates a phase when the narrative period begins; activating another phase implicitly deactivates the current one.
- Active phase is shown as a banner on the player dashboard above the cards (PRD-2 §5c).
- Activation requires `Campaign.status = 'started'`.
- v1: phases are pure narrative (name + description); v1.x adds structured `effects` document for game-relevant modifiers.
- Players see only the active phase; inactive phases are CM-only by default.

**2. Event archival deferred (PRD-4 §3).**
Per user: "Event archival is not something to worry about. We can review performance implications later, and could easily control things via pagination, or indexing by campaign."
- v1 does not include an event archival / cold-storage strategy.
- The timeline view (PRD-4 §6) uses pagination + indexing by campaign for performance.
- Audit log (PRD-1 §4.6) is retained for the lifetime of the campaign + 1 year after archival (already documented; this is the only retention rule for events).
- v1.x may add an archival strategy if performance requires it (cold-storage of old events; online queries limited to recent window).

### v3.17 — Always-fire warning + comprehensive event taxonomy + no live updates

Four refinements:

**1. Warning UI always fires when ruleset changes (PRD-1 §4.4, PRD-5 §5.4).**
Per user: "always show the user what in flight approvals would be affected. If there are none, show the same flow, confirm nothing is affected."
- Modal opens every time the CM saves a ruleset change (Approvals section or Rules section).
- Two variants: Variant A (pending approvals affected, shows the count + breakdown) and Variant B (no pending approvals affected, shows the 0 count with confirmation message).
- Past approvals still NOT affected; change is still "difficult to rollback" because the audit log reflects it.
- Other settings changes (team rename, etc.) do NOT fire this warning — they don't affect who can approve.

**2. No live updates in v1 (PRD-5 §5.4).**
Per user: "browser refresh is fine."
- v1 ships with refresh-based UI. When the CM saves a ruleset change, affected users see the new state on their next page load or manual refresh.
- No WebSocket / SSE / polling infrastructure.
- v1.x may add real-time updates; v1 ships simple.

**3. Approvals are campaign-owned, not user-owned (PRD-4 §3, PRD-5 §5.4).**
Per user: "Approvals are never 'owned' by user. They are owned by the campaign. Changing the rules for who can approve just drives the ui and api rules, it doesn't mutate each approval object."
- The API enforces the ruleset; the UI abides.
- The `Event` for an approval records `actorUserId` at decision time, but the `ApprovalRequest` itself is campaign-owned.
- TL A's approval of item X is permanent. If TL A leaves and TL B wants to undo it, TL B files a NEW `roster_rollback` approval — the original is untouched.
- The "limitation" on visibility is at the data layer (RLS) + application layer (API filter). Some events are team-contextual, some are CM-only (e.g., starting/ending the campaign).

**4. Comprehensive event taxonomy (PRD-4 §3).**
Per user: "All events in a campaign should be tracked. Including starting, ending, moving between phases, player join, player leave, team creation, team changes, team removal. There might be more."
- New categories added:
  - **Campaign lifecycle**: `campaign.created`, `campaign.started`, `campaign.archived`, `campaign.unarchived`, `campaign.phase_changed`, `campaign.settings_updated`
  - **Member lifecycle**: `member.joined`, `member.left`, `member.removed`, `member.role_changed`
  - **Team lifecycle**: `team.created`, `team.changed`, `team.removed`, `team_member.added`, `team_member.removed`, `team_switch.requested`, `team_switch.approved`, `team_switch.rejected`
  - **Approval pipeline**: `approval.requested`, `approval.approved`, `approval.rejected`, `approval.changes_requested`, `approval.withdrawn`, `approval.overridden`, `approval.bulk_approved`, `approval.bulk_reverted`
  - **Rollback**: `rollback.executed`, `rollback.compensating_entry`
  - **System**: `system.notification.email_sent`, `system.notification.failed`
- Extending the taxonomy is a data-model-agnostic change (the `kind` column is `text` or a wide enum). v1.x can add kinds for Discord integration, multi-supplement campaigns, etc.
- Default visibility per kind documented in PRD-4 §8.

### v3.16 — Authority is current-ruleset; ruleset-change warning

Per user: **there is no concept of "in flight authority change."** All open items requiring approval are associated to a campaign, and the API/UI enforces whatever setting is currently set in the campaign. When team leaders change OR when the ruleset changes, the eligible-approver set updates immediately.

**Why this matters architecturally:**
- Authority is **derived** from the campaign's current state, not stored on the approval request.
- When settings change, no migrations, no re-assignment logic — the next query naturally returns the new eligible-approver set.
- RLS + API WHERE clause evaluate the current settings at every query.
- Past decisions stand (immutable). In-flight requests re-assess automatically.

**Worked example (PRD-5 §5.4):**
- Mike disables `roster_approval` for TLs while Alice has a pending roster approval open in her detail view.
- Alice's UI updates live: "Approve" button disabled, tooltip "this kind is no longer in your authority per the current campaign settings."
- If Alice tries to click Approve anyway (stale tab), the API returns 403.
- Item stays pending; now CM-only. Mike sees it.
- If Mike re-enables the authority later, item becomes Alice's again automatically — current ruleset always wins.
- Past approvals stand. Audit log records the ruleset change as a separate event.

**Re-assessment warning UI (PRD-5 §5.4, PRD-1 §4.4):**

When the CM is about to save a ruleset change that affects pending approvals, the UI must warn them before saving, because the change is "difficult to rollback" (the audit log will reflect the change even if rules are toggled back).

The warning modal shows:
- The settings being changed
- The count and breakdown of pending approvals that would be re-assessed
- After-change state
- Explicit note: past approvals are NOT affected; the change is difficult to rollback
- [Cancel] / [Confirm change] buttons

If no pending approvals would be affected, the change saves silently without a warning.

The warning fires for any settings change that affects pending approvals — including Approvals section changes (team-leader authority, approval mode) and Rules section changes (rule pack toggle, per-kind rule enforcement).

**Concrete example from user:**
- TL A approves a roster change.
- TL A leaves the team.
- TL B comes in, wants to rollback the change.
- TL B files a NEW `roster_rollback` approval request. The original approval is untouched.

### v3.15 — OAuth + magic-link auth + campaign-scoped inbox

Three significant architecture shifts:

**1. OAuth + magic-link authentication (PRD-0 §3.4.1, PRD-2 §3.1).**
Per user: user fields and account-level fields need to be adjustable. One approach: use OAuth providers — Discord is one option. Regular email flows also possible. Research and refine.

- v1 supports **Discord OAuth2** (`identify` + `email` scopes) and **email magic-link** as a fallback.
- New `Identity` table (PRD-0 §3.4.1): one `User` per (tenant, person); one `User` can have multiple `Identity` rows linking to multiple auth providers.
- Identity linking at sign-in: when OAuth returns a verified email matching an existing `User` in the tenant, the new identity is linked to that user (otherwise new user + identity).
- Per-tenant OAuth config (`Tenant.oauthConfig`) — instance-level defaults, tenant can override.
- Profile fields table updated: email from OAuth (locked); display name + avatar are user-editable overrides.
- Research notes captured for v1.x refinement: account merging across tenants, OAuth refresh tokens (Discord access tokens expire 7d), Discord guild verification for CM role-grant.

**2. Inbox is campaign-scoped + authority-filtered (PRD-5 §5).**
Per user: events/deltas are campaign-scoped, filtered by the user's authority. Enforced at the API level. We track users at all approval points and reference the user who made the decision. Soft-delete (archive) only; we don't delete data.

- **One campaign inbox, many views.** Every user with access sees the same queue, filtered by their authority at the API layer.
- **Authority filter is API-enforced** (not just UI). Alice cannot trick the UI into requesting Hades items — the server query has a WHERE clause on team + kind authority; RLS adds redundant check.
- **User tracked at every approval point** via `ApprovalRequest.reviewerUserId`. Past approvals stand even if the user's role changes.
- **Soft-delete throughout.** Team leader grants (`TeamLeader.revokedAt`), audit log entries, history entries — all carry archive timestamps, never hard-deleted unless explicitly required (e.g., account-deletion 30-day window).
- **Worked example rewritten.** Alice's "Actionable" tab + "All team items" tab reframe as filters on the same campaign inbox. Authority filter chip + Team filter chip + Player filter chip. Disabled action buttons (with tooltips) for unauthorized kinds.

**3. TL default view: see all pending approvals, action only authorized ones (PRD-5 §5.4).**
Per user: team leaders should see all pending approvals, and only be able to action ones for which they have authority. The UI should have a filter for showing actionable items, and filtering by player.

- Default tab for TLs: "My team" (8 items — full team scope)
- Filter chip: "Authority: Actionable for me" narrows to 7 items (where Alice can act)
- Filter chip: by player (e.g., show only sarah_k's items)
- Action buttons disabled for unauthorized kinds, with tooltip explanation

### v3.14 — 4 page surfaces + TL inbox worked example

Per user direction: users need an **account page** + a **campaign-scoped player page** + a **roster page** + **specialized views for their generated crusade cards**. Added all four as PRD-2 §5d–§5g.

**1. Account page (PRD-2 §5d, per-user).**
Settings that travel with the user across campaigns and tenants. Sections: PROFILE / NOTIFICATIONS / SECURITY / TENANTS & CAMPAIGNS / DANGER ZONE. Per-role sub-pages at `/account/team-leader` and `/account/cm` for role-specific settings. Quiet hours, MFA opt-in, session management, account deletion (with email confirmation).

**2. Campaign-scoped player page (PRD-2 §5e, per-campaign).**
The player's profile within a specific campaign. Sections: YOUR IDENTITY (role/team/faction + switch buttons that create `team_switch` / `faction_switch` approvals) / YOUR CRUSADE STATS / NOTIFICATIONS (per-campaign loudness override) / DISPLAY (handle visibility, leaderboard visibility) / DANGER ZONE (leave campaign). Team Leader leave-campaign flow forces a replacement per PRD-1 §4.2.

**3. Roster page (PRD-2 §5f, per-roster).**
The army view. Header stats (points / battles / RP), units table with role filters, requisitions history (NR-side per PRD-4 §7b.2), history link. State variants: Approved / Pending approval / Superseded / Rolled back / Empty. "Print Order of Battle" button auto-generates a printable HTML/PDF view mirroring the `ArmageddonBlankOrderOfBattle.pdf` template the user provided.

**4. Crusade card view (PRD-2 §5g, per-unit).**
The unit's auto-generated card. Mirrors the `ArmageddonCrusadeCards.pdf` template: model count / points / wargear / battle honours (with provenance) / battle scars (with provenance) / battle tally / unit timeline. **Read-only display per PRD-0 §4b.2** — the page surfaces "To edit unit state, update in NR and re-import."

**5. Settings hierarchy (per-user vs per-campaign).**
Documented in PRD-2 §5d.3. Per-user: name, avatar, auth, default loudness, sessions. Per-campaign: notification overrides, display preferences. The CM has additional settings: default team-leader authority, bulk-approve cap defaults, per-tenant defaults.

**6. TL inbox worked example (PRD-5 §5.4).**
Concrete walkthrough:
- **Campaign**: Aurelian Crusade, 4 teams (Helsreach / Hades / Gorgutz / Skari), Alice is Helsreach TL, Bob is Hades TL, Carol + Dave are co-leaders of Gorgutz, Skari has no TL yet.
- **13 pending items** in the campaign's queue.
- **Alice's "Actionable" tab** shows 5 items (all Helsreach players, kinds she's authorized for).
- **Alice's "All team items" tab** shows 8 items (5 actionable + 3 read-only: CM-gifted requisition, cross-team team_switch, auto-approved battle).
- **Alice doesn't see** Hades / Gorgutz / Skari items at all (RLS + team isolation).
- **Mid-flight authority change** worked through: Alice keeps approval rights on in-flight requests when CM disables her kind-authority (intent at filing time wins, per the question I asked earlier).

**7. Sort + filter details (PRD-5 §5.5).**
- Sort: oldest first (default FIFO), newest first, by submitter, by team, by kind.
- Filters are additive: campaign / team / kind / submitter / age / status / authority (TL inbox only).
- Recently decided items shown for 24h with undo banner.

**Defaults used where the user didn't answer my earlier questions:**
- **Q1 (settings scope)**: per-user for personal prefs + small per-campaign override surface. Documented in §5d.3 hierarchy table.
- **Q2 (mid-flight authority)**: intent at filing time wins. Worked through in §5.4.
- **Q3 (TL inbox scope)**: default tab = Actionable (authorized kinds only); secondary tab = All team items (read-only).

### v3.13 — UI critical pass + campaign-creation team-leader gate

Critical pass through the UI surfaces. Six additions / expansions:

**1. Campaign-creation wizard with team-leader gate (PRD-1 §4.1).**
Per user: "Yes" — update §4.1 to require team leader assignment before "Start campaign."
- 6-step wizard: Basics → Teams → Rules → Approvals → Invite Players → Review & Start.
- Step 2 (Teams) has a hard block: every team needs at least one team leader OR a pending team leader invite before the wizard proceeds to Step 3.
- Step 5 (Invite Players) lets the CM pre-assign players by email; their team-leader invite is automatic when they accept.
- Step 6 (Review & Start) blocks Start if any team still has no leader and no accepted invite.
- Pre-campaign state (`Campaign.status: 'pending'`) lets players join but blocks approvals/battles.

**2. Player Dashboard UI (PRD-2 §5c, new).**
- Top-level surface for all signed-in users (Player / Team Leader / Primary CM).
- Cards: MY ROSTER CARD / MY PENDING APPROVALS / RECENT ACTIVITY / TEAM PROGRESS.
- Team Leader variant: adds MY TEAM'S INBOX + TEAM HEALTH with nudge.
- Primary CM variant: adds CM inbox + Crusade Admin nav.
- Empty states table for every card with explicit CTAs.
- Per-role navigation matrix at the bottom.

**3. Audit Log Viewer (PRD-1 §4.6, new).**
- Filter by actor / action / target / date / campaign.
- Click row → opens the underlying record.
- Export CSV / JSON.
- Retention: lifetime of campaign + 1 year after archival.
- Per-role visibility: CM full, Team Leader team-scoped, Player own-actions.

**4. Inbox UX expanded (PRD-5 §5, v3.13).**
- Role-aware layouts: Primary CM (all teams) vs Team Leader (their team only, kinds authorized).
- Tab-by-kind navigation (Roster / Battle / Requisition / Rollback / Settings).
- **Bulk approve modal**: groups by kind, shows safety check ("5 of 7 selected, 2 skipped: details"), consequence preview, two-button confirmation, 5-second undo banner. Cap 50 per batch.
- Approval detail view: 3 tabs (Diff / Rule Checks / Context), sticky action buttons, keyboard shortcuts (A/R for routine).
- Empty states for inbox.
- Notification indicator bell in inbox header.

**5. Notifications UX (PRD-5 §8, v3.13).**
- Per-user `Notification` table (PRD-0 §4 schema).
- Three loudness classes: `loud` (toast + email + bell), `normal` (bell + list), `quiet` (list only).
- Toast UX (8s auto-dismiss, bottom-right desktop / top mobile).
- Bell badge + side panel.
- Full `/notifications` page with filters (kind / campaign / read / date range).
- Self-approval notifications are `quiet` (CM already knows); team-leader-approves-player notifications to player are `loud`.

**6. Timeline + Narrative Log UI (PRD-4 §6, §8, v3.13).**
- Per-unit timeline view (PRD-4 §7b G1 grouping): cards with event type icons, expandable battle reports, filter chips, "Show rolled-back" toggle, export as markdown.
- All 6 v1 groupings supported on the same underlying `HistoryEntry` rows.
- Narrative log: player view (team-scoped) / Team Leader view (team-scoped + cm-only-for-team) / CM view (full + visibility filter) / Retrospective view (when archived).
- Empty states for each view.

**Schema additions:**
- PRD-0 §4: `Notification { id, recipientUserId, kind, title, summary, sourceEventId?, sourceApprovalRequestId?, readAt, loudness, ... }`
- `PendingTeamLeaderInvite` (implied; for campaign-creation flow): player invited by email, automatically becomes team leader when they accept.

### v3.12 — Multi-team-leader + removal workflow + Crusade Administration panel

Four refinements from the user:

**1. Team leaders set before campaign starts.** Per user: "By default, team leaders should be set before the campaign starts." During campaign creation in the Crusade Administration panel, the CM assigns team leaders per team. Once the campaign is started, every team must always have at least one active team leader.

**2. Naming — NOT a co-CM.** Per user: "we shouldn't refer to it as a Co-Crusade Master. Instead, refer to them as team leader in the context of that campaign." Team leaders are players with delegated team-scoped approval authority. Not a promotion to CM. The Glossary sections in PRD-0/1/2/5 explicitly forbid the "co-CM" / "co-Crusade Master" terminology in user-facing language.

**3. Team-leader removal workflow.** Per user: "When a team leader is removed, only the CM should be allowed to do it. As part of that workflow, the CM must pick a team leader to replace them. Once the campaign is started, a team leader must always exist."
- Only the CM can grant or revoke team leader roles (policy, not a setting).
- CM removes a team leader → system checks if it's the last on the team → if yes, requires picking a replacement from the team's players → atomic operation (both succeed or both fail).
- If no (other leaders exist), removal proceeds; in-flight approvals where the removed leader was the sole reviewer fall back to the primary CM.
- Audit log records the change.

**4. Multiple team leaders per team.** Per user: "each team should be allowed to have multiple team leaders. But, only the CM can add or update that list for a team. This is policy."
- A team can have multiple team leaders.
- New `TeamLeader` join table (PRD-0 §4): `id, teamId, userId, grantedAt, grantedByUserId, revokedAt?, revokedByUserId?`. Soft-delete via `revokedAt`.
- Only the CM can INSERT or UPDATE rows in this table.
- New `Campaign.teamLeaderApprovalMode: 'any' | 'all'` setting (default `'any'`):
  - `'any'` (default): any one team leader can approve
  - `'all'`: every team leader must approve (rare; stronger check)
- Mid-flight `'all'`-mode requests handle team leader removal by auto-recording `abstained` for the removed leader.

**Crusade Administration panel (PRD-1 §4.4):** renamed from "Campaign Settings." New sections:
- General (point cap, OoA, etc.)
- Teams (per-team CRUD + team leader management)
- Rules (rule pack enable/disable)
- Approvals (per-kind team-leader authority, `teamLeaderApprovalMode`, bulk-approve cap, rule-pack enforcement per kind)
- Archive (soft / hard)

**Schema changes:**
- PRD-0 §4: new `TeamLeader` join table
- PRD-0 §4: `Campaign` adds `teamLeaderAuthority`, `teamLeaderApprovalMode`, `rulePackEnforcement`

### v3.11 — Crusade Team Leader + team-isolated data model

Big rename + privacy model. The user clarified: the "co-CM" concept is now a **Crusade Team Leader** — a player on a team who has been approved by the primary CM to approve changes for their own team only.

**Roles (new Glossary in PRD-0 §3b, PRD-1 §0, PRD-2 §0, PRD-5 §0):**
- **Primary CM** — full campaign authority. The only role that can approve cross-team / campaign-wide actions.
- **Crusade Team Leader** — a player on a team with delegated per-team approval authority. They are also a player (they have a roster, they play). **Cannot see or approve anything for other teams.**
- **Player** — on one team, sees own data + own team's narrative log.
- **Spectator** — public-link read-only.
- A user can hold multiple roles. CM-as-player (PRD-1 §5) and Team-Leader-as-player both stack.

**Per-kind team-leader authority (PRD-1 §4.4):**

The primary CM configures `Campaign.teamLeaderAuthority: { [kind: ApprovalKind]: boolean }`. Defaults:
- ✅ Enabled for: `roster_approval`, `roster_revert`, `roster_rollback`, `history_rollback`, `faction_switch`, `post_battle_update`, `rp_adjustment`
- ❌ Disabled for: `roster_manual_edit`, `requisition_purchase` (CM-gifted), `team_switch` (cross-team), `requisition_rp_override`, `mass_reban`, `campaign_announcement`, `point_cap_change`, `custom`

The CM can flip any of these per campaign. Team leader approvals are scoped to their team — a Helsreach leader cannot approve a Gorgutz WAAAGH! request (RLS + API enforce, returns 403).

**Team data isolation (PRD-0 §3b):**
- **Two teams cannot search or investigate each other's data through this app.** Enforced at Postgres RLS layer, not just the UI. Players on Team A see only Team A's data; team leaders see only their team's data; only the primary CM (and Instance Admin) cross team boundaries.
- The app **does not** have a "share with other team" feature. Players share out-of-band if they want (Discord, screenshots).
- **Exception: when the crusade is archived** (`Campaign.status = 'archived'`), all data is read-only-visible to all players across teams (post-crusade retrospective).

**CM self-edit prevention:**

For kinds where the CM is the actor AND is also a player (`roster_manual_edit`, etc.), the request must be approved by someone OTHER than the submitting CM. Options: a second Primary CM (multi-CM campaigns), or a Crusade Team Leader of the affected team (if the kind allows). Otherwise stays pending with `approvalSource: 'co_cm_required_unavailable'`.

**Narrative log (PRD-4 §8):**

Three scopes:
1. **Team-scoped** (default for players) — events with `visibility = 'team'` for the player's team
2. **Public** (cross-team) — events marked `visibility = 'public'` (campaign announcements, point-cap changes, etc.)
3. **CM-only** — events marked `visibility = 'cm'` (sensitive: team switches, override reasons, rollback audit)

Default visibility per event kind is documented in PRD-4 §8. CM can override per-event.

**Crusade-end archival:**

`Campaign.status = 'archived'` switches the campaign to retrospective mode: RLS policies relax to allow cross-team reads in read-only mode; no new approvals; the narrative log is the central retrospective surface with all teams' chronology.

**Schema changes:**
- PRD-0 §3b adds glossary
- `Roles` enum gains `'crusade_team_leader'`
- PRD-0 RLS section describes team-isolation policies
- PRD-5 §3 schema's `approvalSource` enum: removed `co_cm_review` (no longer distinct)
- PRD-5 §3.2 routing table rewritten with team-leader column + scope enforcement
- PRD-5 §3.3 §3 updated: CM-as-player + Team-Leader-as-player both stack

**Six PRD files updated** (PRD-0, 1, 2, 4, 5 + README).

### v3.10 — History, changeset groupings, rollback

Three new architectural pieces:

**1. History generation from approved changesets.**
Per user: "Every approved changeset should generate history objects. Every tracked metric or detail needs to be able to be visualized as a timeline over the campaign."

- **PRD-0 §4**: new `HistoryEntry` data model. Entries are generated only when an `ApprovalRequest` is approved (drafts and pending approvals do not generate history).
- **PRD-4 §7b.1**: history generation rules. Cross-grouping indexes on `HistoryEntryIndex` so a single entry is queryable from multiple grouping dimensions.
- **PRD-4 §7b.5**: worked example showing Sarah's Cadian Castellan across the campaign via three different grouping views.

**2. Requisitions in NR (read-only history).**
Per user: "Requisitions are done in new recruit. We parse it and show it as a history. The history is only computed once change set is approved."

- **PRD-4 §7b.2**: requisitions are done in NR; this app parses and shows them as history. The `requisition_purchase` `ApprovalRequest` kind is reserved for CM-gifted / narrative-driven requisitions only.
- **PRD-2 §6 Flow 3**: rewritten. No "buy requisition" button. Sarah's workflow is NR-side; the app displays the result. New "Requisitions in this upload" section in the diff view.
- **PRD-5 §3.2**: `requisition_purchase` kind narrowed to "CM-gifted or narrative-driven."

**3. Changeset groupings (proposed for user approval).**
Per user: "Propose other groupings for me to approve." v1 ships G1–G6:

| # | Grouping | Default for |
|---|---|---|
| G1 Per-Unit | All field changes to one unit within a single approval | Roster changes (per-unit timeline) |
| G2 Per-Roster-Version | All changes from one NR import | Roster approvals |
| G3 Per-Battle | All changes from one battle | Battle updates |
| G4 Per-Requisition | RP cost + unit change from one requisition | Requisitions |
| G5 Per-ApprovalRequest | All changes from one approval (broadest) | Always stored; ties history to its authorization |
| G6 Per-State-Field | One field change = one entry (granular) | Base layer that G1–G5 group over |
| G7 Per-Narrative-Arc | Manually-tagged arc | **Deferred to v2+** |

Time-bucketed rollups (per-day, per-week, per-session) are computed on read from G3 + G4 — not stored separately.

**4. Rollback (CM-approved).**
Per user: "In the event that the roster update was bad, or the user changes their mind, they need to 'rollback' the roster version. This would be an action requiring CM approval."

- **PRD-4 §7b.4**: rollback mechanics. New `roster_rollback` and `history_rollback` `ApprovalRequest` kinds. On approval, all linked `HistoryEntry` rows get `tombstoned = true` (hidden from timelines, retained in audit log). A compensating entry is created.
- **PRD-5 §3.1**: payload schemas for `roster_rollback` (specific `RosterApproved`) and `history_rollback` (specific `HistoryEntry` ids).
- **PRD-5 §3.2 routing**: rollback kinds require CM approval; CM-as-player rollback auto-approves per PRD-1 §5.
- **PRD-4 §7b.4 cascading invalidation**: battle reports referencing a rolled-back roster surface a "rolled back" badge in the UI; the report itself remains approved (it was a real event).

### v3.9 — NR-as-source-of-truth + form schema pinning

Three architectural clarifications:

**1. New Recruit is the source of truth for unit/roster state.**
Per user: "Unit and roster data, including XP, traits, battle scars, relics. All of those details live in New Recruit. We make a best effort to parse out the json payload, and show it in an aesthetic fashion, but we dont provide any way to mutate that data. Doing so means our code needs to know the rules of those systems, and creates an anti pattern with the decision to couple with new recruit."

- **PRD-0 §4b.2 (new)**: architectural principle codified. Unit/roster data is NR's domain. Our app parses, displays, but never mutates and never offers an in-app edit surface.
- **PRD-3 §3**: read-only display contract on the parser pipeline. Every extracted field is display data, never written back.
- **PRD-3 §6**: rule engine scope narrowed to **campaign-level rules only** — no unit-level rules (relic legality, datasheet constraints, etc.). All built-in rule types are campaign-level (already were; this makes the boundary explicit).
- **PRD-4 §4.1**: battle update form is **campaign-level only**. Removed per-unit XP/honour/scar/OoA fields. Form collects: opponent, mission, result, agendas attempted/achieved, narrative report, `sourceRosterApprovedId`, optional `postBattleRosterDraftId`.
- **PRD-5 §3.1 `post_battle_update`**: removed `perUnitChanges` array. Added `sourceRosterApprovedId` + `postBattleRosterDraftId`. Unit changes are visible via the roster diff (read-only) but not approved per-unit.
- **PRD-2 §6 Flow 2**: player flow rewritten. Form is lighter than before because per-unit work happens in NR. New critical moment: "did Sarah re-import her post-battle NR list before filing?" (order matters for the audit trail).
- **PRD-2 §6 Flow 4 (timeline)**: events on the per-unit timeline are mostly sourced from NR roster diffs (read-only display), with linked battle reports inline.

**2. Battle report schemas: defaults per supplement, configurable in principle, tooling out of scope.**
Per user: "The battle report schema should have defaults set for each supplement. Ultimately tho, it needs to be configurable, because CM's often want to homebrew things. But we dont need to flesh out that system too much now, as its very open ended."

- **PRD-0 §4**: `CrusadeSupplement.battleReportSchema` is the supplement's default. v1 ships Armageddon's standard Crusade form.
- **PRD-4 §4.1**: explicit note that CM-custom schemas are possible in principle (data model supports) but v1 has no UI to author them. v1.x may add a schema editor.

**3. Form versions pinned to campaign.**
Per user: "Form versions should be pinned to the campaign. Once it starts, it's locked. Always provide basic defaults per supplement. Future may require custom versioning and some kind of tool to make them. Out of scope."

- **PRD-0 §4**: `Campaign.battleReportSchema` is **copied from `CrusadeSupplement.battleReportSchema` at campaign creation**. Once pinned, future updates to the supplement's schema do NOT affect in-flight campaigns. The form is locked for the campaign's lifetime.
- **PRD-4 §4.1**: explicit pinning rules. Always-fallback-to-supplement-default noted for safety.

### v3.8 — Supplement-specific battle report forms + per-player batching

Per user: battle updates come in via a form, and "some crusades have a specific form to fill." The user shared three reference PDFs (Armageddon Crusade Cards, Armageddon Blank Order of Battle, Nachmund Mission Record Sheet) — these map to three different surfaces in the app:

| PDF | App surface | Form? |
|---|---|---|
| ArmageddonCrusadeCards.pdf | Per-unit tracking card (`CrusadeForceState[unit]` view) | Auto-generated, no form |
| ArmageddonBlankOrderOfBattle.pdf | Roster snapshot (`RosterApproved` view) | Auto-generated, no form |
| MissionRecordSheet.pdf (Nachmund) | Per-battle update form | **Supplement-specific JSON Schema** |

The supplement-specific piece is the battle report form, not the other two. The other two are derived from existing data and need no per-supplement code.

- **PRD-0 §4**: `CrusadeSupplement.battleReportSchema: JSONSchema | null` — per-book form definition. `null` falls back to the standard Crusade form.
- **PRD-4 §4.1**: rewritten. Form is auto-generated from the JSON Schema. Different supplements have different schemas (Armageddon uses standard Crusade form; Nachmund has multi-player agendas + Crusade Blessings). The system default covers Armageddon v1 without bespoke UI.
- **PRD-4 §4.1 disambiguation table**: maps each user-provided PDF to its corresponding app surface.
- **PRD-5 §3.1 `post_battle_update` payload**: added `formData` (supplement-specific) and `disputed` (auto-flag if a player's BattleUpdate conflicts with another player's for the same battle).
- **PRD-5 §9.1 (new)**: explicit batching model — **per-ApprovalRequest, not per-battle**. 1v1 = 2 approvals, 4-player FFA = 4 approvals. Batching happens via auto-approve (routines) + bulk-approve (inbox, capped at 50). Battle-context grouping in the inbox shows related BattleUpdates under one expandable row but keeps approvals separate.
- **PRD-5 §9**: added `bulk_approve_max_batch_size: int` campaign setting to prevent accidental mega-actions.

### v3.7 — CM-as-Player: auto-approve, never bypass the pipeline

Per user: when the CM is also a player, their deltas should auto-approve (no waiting for themselves) but **always go through the full pipeline** so future event hooks work uniformly.

Example given: CM on Helsreach Defenders updates their army list. The team view page (v1.x future feature) needs to show Helsreach's aggregate progress including the CM's deltas. That only works if the CM's approval fires the same events as everyone else's.

- **PRD-1 §5 rewritten**: every CM-as-player delta auto-approves but goes through the pipeline. ApprovalRequest created, rule checks run (CM gets the same `team-narrative-alignment` warn as any player), RosterApproved created, events emit, notifications fire.
- **PRD-5 §3 schema**: added `approvalSource` field with 5 values: `cm_review`, `co_cm_review`, `auto_approve_routine`, `self_approved`, `co_cm_required_unavailable`. Records HOW each request was approved — queryable later for filtering, counting, or special-casing downstream consumers if ever needed.
- **PRD-5 §3.3 (new)**: explicit architectural rule — "auto-approve ≠ pipeline bypass." Every auto-approved request still creates the row, runs rule checks, mutates state, emits events, fires notifications.
- **PRD-5 §3.2 routing table**: high-impact kinds (`roster_manual_edit`, `requisition_rp_override`, `mass_reban`, `point_cap_change`) still require co-CM when available. With no co-CM, they fall back to `co_cm_required_unavailable` with audit. CM cannot unilaterally approve high-impact kinds even when self-as-player.
- **PRD-4 §7.1 (new)**: documents the team rollup data path for the v1.x team view page — `Event.targetId → RosterApproved.teamId → CampaignTeam`. v1 keeps schema normalized; v2 may denormalize for query speed.
- **Edge cases updated** in PRD-1 §10 and PRD-5 §14 to reflect the new `approvalSource` semantics.

### v3.6 — ApprovalKind enum as canonical contract

Per user direction: expand the `ApprovalRequest.kind` enum to be the canonical contract for all narrative-affecting actions routed through the approval queue.

- **PRD-5 §3**: full enum rewrite with 13 kinds grouped by category (Army roster / Team-faction / Battle updates / Crusade points / All-player effects / Extension point).
- **PRD-5 §3.1**: every kind has a typed payload schema (roster_approval, roster_manual_edit, requisition_purchase, roster_revert, team_switch, faction_switch, post_battle_update, rp_adjustment, requisition_rp_override, mass_reban, campaign_announcement, point_cap_change, custom).
- **PRD-5 §3.2 (new)**: routing table per kind — default approver + co-approval rule. High-impact kinds (`roster_manual_edit`, `requisition_rp_override`, `mass_reban`, `point_cap_change`) require co-CM approval mandatory; others make it optional via campaign setting.
- The `custom` kind is the v2+ extension point: future categories extend via the enum, with `schemaRef` pointing to a JSON Schema for the payload.

### v3.5 — Approval-gating as a unifying principle

Per user: any operation that mutates shared campaign state or affects the narrative should be gateable by CM approval. Codified as PRD-0 §4b "Approval-Gating for Narrative Integrity" — the load-bearing mechanism for narrative integrity.

- **PRD-0 §4b**: new design principle section. Lists v1 categories (army roster changes, crusade points, all-player effects, battle updates, team/faction changes) and notes that auto-approve is a CM choice, never the default.
- **PRD-5 §2**: restructured around the principle. New §2.1 "Approval-Gating Principle", §2.2 "Action Categories" (the v1 list, grouped by category), §2.3 "Self-Serve" (what's deliberately not gated), §2.4 "Full Action × Approval Matrix" (the existing actions + new ones).
- **PRD-5 §2.4 additions**:
  - Team switch is approval-gated (already documented in PRD-1 §5b; now consolidated)
  - CM-triggered campaign-wide RP-affecting narrative events: optional co-CM approval (campaign setting)
  - CM mass-rebanning a unit mid-campaign: co-CM approval mandatory
  - CM editing `CampaignTeam.expectedFactionIds`: self-served but audit-logged
- The principle is open-ended: future narrative-affecting actions extend via new `ApprovalRequest.kind` values + a config entry in CM's auto-approve settings.

### v3.4 — Teams are mandatory

Per user direction: free-for-all mode is out of scope. Every campaign uses teams.

- **PRD-0**: removed `Campaign.teamsEnabled`. `CampaignMember.teamId` is now required (not optional). Comment in the schema block explicitly notes teams are mandatory in v1.
- **PRD-1 §5b**: removed the "free-for-all" branch. Schema notes that ≥1 team is required at creation; minimum viable (1 team, 1 player) is legal but pointless, UI nudges toward ≥2 teams.
- **PRD-2**: removed the "if `teamsEnabled`" conditional. Team picker is always shown. Signup diagram simplified to a single faction+team sequence.
- All other v3.3 narrative-intent / CM-approval logic unchanged.

### v3.3 — Narrative intent vs enforcement

The user clarified the team's relationship to factions: a campaign team has *narrative intent* (which 40K factions fit its story), but the **CM has final approval** — the app does not enforce. The Armageddon book (and other Crusade supplements) provide narrative reference; the CM's approval is the actual gate.

- **PRD-0 schema**: `CampaignTeam.expectedFactionIds: string[] | null` (narrative intent, editable by CM). `Roster.teamId` (roster is bound to a team directly, snapshotted at creation). `RosterApproved.factionId` + `RosterApproved.teamId` (snapshotted at approval, preserved historically).
- **PRD-1 §5b**: Armageddon templates pre-fill `expectedFactionIds` from the book. Helsreach/Hades Defenders expect Imperial factions; Gorgutz/Skari expect Orks. The CM can edit per their campaign. The hint surfaces in three places — team picker (PRD-2), roster rule check (PRD-3 `team-narrative-alignment`), and the narrative log (audit-trail of CM overrides).
- **PRD-3 rule gallery**: new built-in `team-narrative-alignment` rule. Default severity: **warn only**. Never fails. CM overrides are the actual enforcement point. Configurable per-rule-instance.
- **PRD-2 team picker**: shows "typically plays Imperial factions" hint per team. Mismatched faction + team → soft warning, player can continue. No blocking.
- **Team switching (PRD-1 §5b)**: requires CM approval (`team_switch` ApprovalRequest). On approval, Roster's teamId follows by default; CM can choose to freeze the old roster or create a new one. The `team-narrative-alignment` rule re-runs against the new team's expectedFactionIds on next approval.

### v3.2 — Campaign Teams as first-class schema

- **Distinction surfaced**: 40K `Faction` (seeded from Wahapedia) is now clearly separate from `CampaignTeam` (CM-defined per-campaign grouping of players). v3.1's "Custom Factions" note was conflating these.
- **PRD-0**: schema adds `Campaign.teamsEnabled`, `CampaignTeam { id, campaignId, name, description, color, narrativeLogFilter }`, and `CampaignMember.teamId`. `Faction` is global; `CampaignTeam` is per-campaign; `Roster` does NOT carry team info (member-level concept).
- **PRD-1 §5b**: rewritten. Teams are not factions — they are narrative sides within a campaign. Armageddon ships 4 template teams (Helsreach Defenders, Hades Defenders, Gorgutz's WAAAGH!, Skari's Kult of Speed); CMs can rename/edit. Battle pairing filters on team. Per-team dashboard rollups added.
- **PRD-2**: player signup now has a two-step picker — 40K faction + campaign team. Free-for-all campaigns skip the team step. Team switch mid-campaign requires CM approval (creates a `team_switch` `ApprovalRequest`).
- **PRD-4**: `NarrativeEventEffect.FilterExpr` supports `teamId` as a first-class axis alongside `factionId`. The two are distinct dimensions; CM can target events to a specific team.

### v3.1 — Rule builder in scope + critical user flows

- **Rule builder UI moved into v1 scope** (was v1.x). Built-in rule types only, no custom DSL. 9 rule types ship: `max-n-of-type`, `max-x-pct-of-role`, `max-points-per-unit`, `wargear-restriction`, `unit-whitelist`, `unit-blacklist`, `custom-name-pattern`, `total-xp-cap`, `crusade-rp-floor`. Auto-generated config forms from JSON Schema. Live preview + test-against-existing-data before save.
- **PRD-1: added CM critical user flows** with persona (Mike, IT pro, runs Wednesday night campaign, 3 hours/week on admin). 5 flows detailed: campaign setup, inbox triage day, roster approval with rule override, narrative event triggering, campaign health monitoring. Each flow has: trigger, why it matters, specific UI requirements, critical moment, edge case.
- **PRD-2: added player critical user flows** with persona (Sarah, software engineer, plays Astra Militarum, 2 games/week). 4 flows detailed: first roster import + approval, post-battle update filing, requisition purchase, per-unit timeline view.
- **PRD-1 inbox clarified**: shows approvals + deltas + battle reports. Does not compute every detail; per user direction. Different from the campaign's narrative log (storytelling surface).
- **Custom factions**: schema-ready (`Faction` table, not enum), UI for creating custom factions deferred to v1.x. PRD-1 §5b.
- **Discord integration**: noted as v2 future in PRD-1 §5c. Webhook-based forwarding of events.

### v3 — Hapi + BullMQ + parser subprocess

Major rewrite driven by the user's real stack and existing code:

| Area | v2 | v3 |
|------|----|----|
| Backend | FastAPI (Python) | **@hapi/hapi** (Node 22, TypeScript) — "I strongly prefer a node/typescript system" |
| Queue | None | **BullMQ + Redis** — "I think we use a queue to parse them" |
| Parser | Conceptual (TS would do everything) | **Python subprocess** running user's `bs-roster-parser` library |
| Rule engine | Built-in only | **Configurable** — builtin + CM-defined + crusade-defined, with ruleKey/severity/configSchema per instance. UI deferred to v1.x; data model + engine ship in v1. |
| Roster pipeline | Synchronous | **Async**: Hapi → MinIO blob → BullMQ `parse-job` → worker spawns Python → `diff-job` → `rule-check-job` → notify |
| PRD-3 surface | Generic | Now includes the exact parser contract (stdio JSON, exit codes, what the Python lib does and doesn't extract), and the app-side TS pass for the gaps |

**Architectural change**: the load-bearing flow is now a 5-stage async pipeline. The Python parser handles the BattleScribe quirks; the TS app handles the diff + rules + persistence. They communicate via stdio JSON.

### v2 — Locked design

| Area | v1 | v2 |
|------|----|----|
| Tech stack | Stack-neutral | Vite + FastAPI + Postgres + MinIO, Docker |
| Tenancy | Single | Multi-tenant with RLS + instance admin |
| MVP | "Armageddon first" | Armageddon only |
| Roster model | Active version per import | State machine: `RosterDraft` → `RosterApproved` |
| Diff audience | CM-first | Player-first |
| Ingestion | URL + file + manual | JSON file only |
| Events | Post-battle deltas | Every state transition is an event; submission gated by approved roster |
| Approvals | Generic | `roster_approval` is the primary kind |

### v1 — Initial draft

First pass. Superseded.

## How to read

Start with **PRD-0** (overview) → **PRD-3** (the load-bearing piece — BullMQ pipeline, parser contract, rule engine) → **PRD-4** (events + submission gating). Then PRD-1, 2, 5 as supporting infrastructure.

## Status

Drafts — pending review before implementation kickoff.
