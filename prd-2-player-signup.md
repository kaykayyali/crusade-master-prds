# PRD-2: Player Sign-Up (v3)

> Player onboarding within a tenant. v3: stack updated to Hapi/Node/TS; minor content changes.

---

## 0. Glossary (per PRD-0 §3b)

- **Player** = a user with the `player` role for one campaign, on one team. Sees their own roster + their team's narrative log + their own data. **Cannot see other teams' data through the app.**
- **Crusade Team Leader** = a player who has also been granted the `crusade_team_leader` role for their team by the primary CM. They are still a player on that team; they additionally see their team's approval queue and can approve requests affecting their team for kinds the primary CM has enabled (PRD-1 §4.4).
- **Primary CM** = the user with the `cm` role for the campaign. Sees everything; approves anything.

A player can also be a CM-as-player (PRD-1 §5). A player can be a Crusade Team Leader. Roles stack.

---

## 1. Goals

Get a player from "I have an invite code" to "I'm a member of the campaign with no roster yet" in under 5 minutes.

**Success metric**: Median time from invite acceptance to first draft roster import attempt < 5 minutes.

---

## 2. User Stories

- **As a new player**, I can sign up with just an email address (magic-link auth).
- **As a player with an invite code**, I can enter it and land inside the campaign.
- **As a player**, I can pick my faction from a searchable list of all 26 Wahapedia factions.
- **As a returning player**, I can join additional campaigns in the same tenant via new invite codes.
- **As a player**, I get a guided first-tour explaining the async parse → review → approval flow.

---

## 3. Feature Modules

### 3.1 Account Creation

- Email + magic link (no password; per tenant SMTP)
- Display name (unique within the campaign, with collision suffixes)
- Optional avatar upload (stored in MinIO)
- Timezone (auto-detected, editable)
- Locale (en for MVP)

**Tenant assignment**: every new account is tied to one tenant. If a player needs to be in multiple tenants, they sign up separately in each — the email can be the same; the `User` rows are per-tenant.

### 3.2 Join via Invite

- Single text field: "Paste invite code or link"
- Validation:
  - Code exists
  - Code belongs to a campaign in the same tenant the user is signed up in (no cross-tenant joins)
  - Code not expired
  - Code not used beyond its max-uses (CM-configurable; default 1)
- If valid: account binds to campaign as `CampaignMember.role = 'player'`
- If invalid: clear error ("Code not found", "Code expired", "Code already used", "Wrong tenant")

### 3.3 Faction + Team Picker (two distinct picks)

When a player joins a campaign, they pick two things — a 40K faction and a campaign team (always; every campaign has teams in v1).

**Faction picker:**
- Searchable dropdown of all 26 Wahapedia factions. Each option shows:
  - Faction logo (from Wahapedia)
  - One-line description
  - Linked Armageddon-specific content flag (if any)
- Sets `CampaignMember.factionId`

**Team picker (always shown):**
- List of `CampaignTeam` rows for the campaign
- Each team shown with: name, color, description, current player count
- Each team shows its `expectedFactionIds` as a hint: "typically plays Imperial factions" or "typically plays Orks" (derived from the count of expected factions; details behind a tooltip)
- Sets `CampaignMember.teamId`
- The picker does NOT filter the 40K faction picker — any player can pick any team regardless of faction
- Teams are mandatory in v1; there is no teamless mode (free-for-all is out of scope)

**Narrative-fit hint (when faction and team don't match expectedFactionIds):**

If a player picks a faction that's NOT in their chosen team's `expectedFactionIds`, the picker shows a soft warning before they submit:

> "Helsreach Defenders typically plays Imperial factions (per the Armageddon book). Mike has final approval — you can proceed, but Mike may want to discuss the narrative fit. Continue?"

The player can click "Continue anyway" or "Pick a different team." The app does **not block**. The CM's approval workflow is the enforcement point.

If `expectedFactionIds` is null (CM hasn't set any), no hint is shown.

If `CampaignTeam.expectedFactionIds` is set and the player's faction IS in the list, a green check is shown: "✓ fits Helsreach Defenders' Imperial narrative."

After both picks complete:
- Create empty `Roster` (no draft, no approved)
- Player is redirected to "Import your first roster" CTA

### 3.4 First-Time Onboarding

Modal flow shown on first login to a campaign:

1. **"Welcome"** — 1-line pitch + "Got it"
2. **"The flow"** — upload → BullMQ parse (a few seconds) → review the diff → CM approval → play
3. **"Async expectations"** — "imports take ~30 seconds; you'll get a notification when ready"
4. **"Roster gating"** — "you can't file battle results until your roster is CM-approved; submit early"
5. **"Import your roster"** — direct link to PRD-3 importer
6. **"You're set"** — dashboard with empty roster

---

## 4. User Flow

```mermaid
flowchart TD
    A[Player receives invite link] --> B[Lands on /join?code=XYZ]
    B --> C{Has account in this tenant?}
    C -->|No| D[Sign up: email + display name + tenant]
    C -->|Yes| E[Sign in via magic link]
    D --> F[Email magic link sent]
    E --> F
    F --> G[Click link in email]
    G --> H[Authenticated, back on /join]
    H --> I{Invite valid?}
    I -->|No| J[Show error]
    I -->|Yes| K{Pick faction (always)}
    K --> L[Pick team]
    L --> M[Create Roster shell]
    L --> M[Redirected to /campaigns/{id}]
    M --> N{First time in this campaign?}
    N -->|Yes| O[Onboarding tour]
    N -->|No| P[Standard dashboard]
    O --> Q[Import roster CTA → PRD-3]
```

### 4.1 Branch: Returning Player, New Campaign

Player signs in, opens dashboard, sees existing campaigns + "Join another campaign" button. Same flow as above from `I`.

### 4.2 Branch: Cross-Tenant Player

If a player is already in tenant A and gets an invite to tenant B, they must sign up separately. The UI explains this and offers a "create a new account in this tenant" link.

### 4.3 Branch: Invite Code Edge Cases

- **Expired**: CM controls expiry (default 14 days). Clear message with "Request new invite from your CM" button.
- **Used (max-uses reached)**: "This invite has been fully used."
- **Wrong tenant**: "This invite is for a different campaign group."

---

## 5. Faction + Team Picker Notes

**Faction:**
- 26 Wahapedia factions are the canonical list
- Picker does **not** filter to Armageddon-suitable factions
- Soft highlight: factions with documented Armageddon content get a small badge
- Legends / Forge World units are not in the picker; they're added during NR import

**Team:**
- Teams are CM-defined per campaign (see PRD-1 §5b)
- Team picker is always shown — every campaign has teams in v1; free-for-all is out of scope
- Team picker never restricts 40K faction choice (multi-faction teams are the norm)
- Team switch mid-campaign requires CM approval (creates a "team_switch" `ApprovalRequest` per PRD-5)

---

## 5b. Team-Scoped Data Isolation (v3.11)

Per PRD-0 §3b: **a player on Team A cannot see Team B's data through this app.** This is enforced at the data layer (Postgres RLS), not just the UI, so no application bug can leak cross-team data.

What a player on Team A sees:
- Their own roster + their own battle reports + their own history
- Their team's narrative log (events with `visibility = 'team'` or `visibility = 'public'`)
- Their team's public-facing announcements (if the CM marks them public)
- Their team's active players list (so they know who they're playing with)

What a player on Team A does NOT see:
- Team B's rosters
- Team B's battle reports
- Team B's requisitions, history, approval queue
- Team B's narrative log (unless the CM marks an event `visibility = 'public'`)
- The names of players on Team B (they know Team B exists by its name; they don't see its roster)
- Search results that include Team B's data

What a player can do about cross-team data:
- Talk to players on Team B out-of-band (Discord, in-person, etc.)
- The app **does not** have a "share with other team" feature; players share on their own
- The app does not block or facilitate this; it just enforces isolation
- Exception: when the crusade is archived (`Campaign.status = 'archived'`), all players across teams see all data in read-only mode (post-crusade retrospective)

**Crusade Team Leader view (additional capabilities):**

A Team Leader on Team A additionally sees:
- Their team's full approval queue (filtered to kinds they're authorized to approve per PRD-1 §4.4)
- Their team's full event log including `visibility = 'cm'` events that affect their team
- Their team's roster health overview

A Team Leader on Team A does NOT additionally see (compared to a regular player on Team A):
- Other teams' data (still isolated)
- Cross-team events that don't involve their team
- The primary CM's campaign-wide inbox (they see only their team's queue)
- Approval queue items for kinds they're not authorized to approve (those go to the primary CM)

**UI signals for isolation:**

- When a player views the campaign dashboard, the team-scoped narrative log is the default view. A "Public announcements only" tab shows cross-team events marked `visibility = 'public'`. There is no "All teams" view.
- When a player tries to navigate to a URL that would expose cross-team data (e.g., a teammate's roster id), the API returns 404 (per RLS) and the UI shows "Not found."
- The narrative log never suggests "X happened to Team B's player Y" — it only shows events on the player's own team.

---

## 6. Critical User Flows — Player (Sarah)

**Persona — Sarah, the player:**
Late 20s, software engineer, plays Astra Militarum. Has been in the hobby for 2 years. In Mike's 8-player campaign. Uses New Recruit on her laptop to build lists (she likes the auto-cost-calc). Plays about 2 games per week, usually on Wednesday nights and one weekend afternoon. Spends ~30 minutes/week on Crusade admin in her current tool (Administratum free tier + Discord + a paper roster).

Sarah's pain points with current tools:
- She forgets which roster version is "active" — the one she plays with vs. the one Mike approved.
- She filed a battle update last week and isn't sure if it was approved; the only signal is Mike saying "good game" in Discord.
- She wants to see her Cadian Shock Troops' journey: from "Battle-ready" to "Battle-hardened" with each battle's contribution. Right now this is mental math across a paper sheet.

Sarah's success criteria for this app:
- She can see, at any time, the current state of her roster (active, approved, with current XP/rank for every unit).
- She can file a post-battle update in under 5 minutes and see the result reflected in her roster.
- The system tells her when something needs her attention (roster pending review, requisition available, etc.) without her having to chase Mike.

### Flow 1: First roster import + approval (the most complex flow)

**Trigger:** Sarah finished her NR list and wants to play. She's been added to the campaign by Mike; she got an invite link in Discord. She clicks the link.

**Why this matters:** First-time experience determines whether Sarah recommends the tool to her other 40K friends. If it's confusing, she tells the group "it's too much work" and the campaign quietly goes back to Discord-only.

**UI requirements:**

- **Invite link lands her on a sign-up page** with the campaign name pre-filled ("Aurelian Crusade"). She sees: campaign CM (Mike), campaign rules preview, member count.
- **Sign-up is one email + one display name.** No password to remember; magic-link auth.
- **Onboarding tour is 4 modals** (per §3.4). The first 2 explain the flow; the last 2 are about the upload process.
- **The upload zone is the dominant element on the empty-roster page.** Big drop target, "Upload your New Recruit JSON" in 24pt, "We parse it in ~30 seconds" subtext. No "browse files" button hidden in a corner.
- **Upload latency is the single biggest UX risk.** When Sarah drops the file:
  - File validates client-side (size, .json extension, basic structure)
  - Status changes to "Parsing… 5s" with a live timer
  - If parsing hits 30s, the timer turns amber; at 60s, red, with a "still working" message
  - When ready, the screen transitions to the diff view
- **The diff view is player-first.** Even with no prior roster, Sarah sees: "We found 13 units. Here's the list. Tap any to see details." She can review the parse result before submitting.
- **Rule check results appear below the diff.** If everything's green, "All clear. Submit for CM approval?" with a single button. If there's a warn, the player must acknowledge before the button enables.
- **Submission is irreversible** (a new draft is required to change anything). The button text says "Submit for Mike's review" not "Submit" — names the CM, makes the human loop visible.
- **After submission, the screen shows a status card**: "Submitted 2 minutes ago. Mike usually reviews within 4 hours. You'll get a notification."
- **When Mike approves (or rejects), Sarah gets a notification** (in-app toast + email). On the campaign page, her roster now shows "Active since 2 hours ago" with a green badge.

**Critical moment:** The parsing latency. Sarah is anxious — "did it work?" — and 30 seconds of a spinner is uncomfortable. Mitigation: (a) live timer so she knows it's not stuck, (b) clear copy explaining what's happening ("Extracting units from your New Recruit file…", "Comparing to last approved roster…", "Running campaign rules…"), (c) at 60s, a "still working — this is unusual, you can wait or contact your CM" message with a "contact CM" link.

**Edge case:** The parser fails. Sarah sees a clear error: "We couldn't read your file. Common causes: corrupt download, NR's 'private list' feature, or a list built in BattleScribe (not NR). Try re-exporting from NR or contact Mike." The retry button re-runs the same blob; the re-upload button lets her pick a different file.

**Edge case:** Sarah drops the wrong file (e.g., a list from a different campaign). The parse succeeds, but the diff against her current (empty) Roster shows units from a different faction. The rule check flags "Faction mismatch: roster is Tyranids, your campaign faction is Astra Militarum." Sarah cancels, re-exports the right list from NR, re-uploads.

### Flow 2: Filing a post-battle update

**Trigger:** Sarah just played a 2000-pt game against Mike's Tyranids and won. She's at home, tired. She already updated her NR list with the battle's effects (XP, honours, scars, etc.) and re-exported the JSON; the post-battle roster is now visible in her army view. She wants to file the campaign-level update.

**Why this matters:** This is the moment where the campaign's narrative moves forward. The form is intentionally lighter than per-unit data entry because, per PRD-0 §4b.2, **unit data lives in NR** — Sarah already did the per-unit work in NR. The form here is for the campaign-level record: what happened, who won, what agendas were achieved.

**UI requirements:**

- **The "File Battle Update" button is on the campaign dashboard, prominent, never more than 2 clicks from the campaign home.**
- **Form is auto-generated from `Campaign.battleReportSchema`** (PRD-4 §4.1) and is **campaign-level only**. Per-unit XP/honour/scar/relic fields are deliberately absent.
- **Form is pre-filled with what the system can infer:**
  - Opponent: a member-list dropdown filtered to her campaign, sorted by "recently played" (Mike is at the top)
  - Date: today
  - Result: a single "I won" / "I lost" / "Draw" toggle
  - Mission: text input, with autocomplete from prior missions this campaign
  - Source roster: defaulted to Sarah's currently approved roster. A dropdown lets her pick a different one if she used an older roster for this battle.
- **Agendas section is explicit:** Armageddon agendas (e.g., "Extermination Targets" for Astra Militarum) appear in a checklist. Sarah ticks which she attempted, then ticks which she achieved. The system doesn't compute the agenda outcome — that's the CM's verification job.
- **Battle report is a markdown textarea** with a "min 200 chars" hint if the campaign's `require_battle_report` is on. Sarah types 3-4 sentences; the form shows a live char count.
- **Side panel: read-only roster diff.** The form shows the diff between `sourceRosterApprovedId` and Sarah's most recently uploaded post-battle roster (if any). This is the visual proof of what happened to her units in this battle — but it's **read-only display**, sourced from NR. Sarah can't edit per-unit fields here; she goes to NR if she needs to fix something.
- **"Save as draft" and "Submit" are both available.** If Sarah runs out of time, she saves and comes back.
- **On submit, the form transitions to a "Pending Mike's review" card** with the timestamp, the campaign-level deltas that will be applied, and a "view what will change" expander showing agenda outcomes and roster diff.

**Critical moment:** The "did Sarah actually re-import her NR list with the post-battle roster?" question. The form's side panel shows a warning if the source roster is older than the player's most recent upload: "Your post-battle roster hasn't been imported yet. The unit diff shown is based on your last approved roster. Re-import your NR list to see the post-battle state." This nudges Sarah to upload first, then file the report — getting the order right matters for the audit trail.

**Edge case:** Sarah wins, files the update, then realizes she made a mistake. The update is "pending." Sarah clicks "withdraw" and starts over. Mike never sees the broken version.

**Edge case:** Sarah and Mike disagree on the result. Mike files his own update saying he won. The system flags `BattleUpdate.disputed`; both updates are in the inbox with the other's as context. Mike (as CM) adjudicates.

**Edge case:** Sarah files a battle update referencing a roster that's been superseded. The system warns: "Your referenced roster is no longer your active roster (you uploaded a newer version 2 days ago). Update the reference, or proceed with the original?" Sarah can either pick the newer roster or confirm the older one — explicit user choice.

### Flow 3: Requisitions — done in NR, shown as history

**Trigger:** Sarah's Leman Russ was destroyed in a game. The OoA test failed; she chose to remove the unit. She wants to bring it back next week.

**Why this matters:** Per PRD-0 §4b.2 and PRD-4 §7b.2, **requisitions are done in New Recruit**, not in this app's UI. Sarah marks the requisition in NR (spends RP, adds the unit, marks "Requisition: Replaced Destroyed Unit" on the unit's crusade card), exports JSON, and uploads to this app. The requisition shows up as a history entry — visible in Sarah's requisition history, on the unit's per-unit timeline, and on the campaign's narrative log.

**What this app DOES surface (read-only display, sourced from NR):**

- **Requisition history view** — a tab on Sarah's roster page. Lists past requisitions with date, type, RP cost, the unit affected. Each row links to the per-unit timeline (G1 grouping).
- **"What this does" preview at roster import time** — when Sarah uploads a new NR list, the diff view highlights the requisition: "Requisition: Replaced Destroyed Unit — Leman Russ added, -3 RP." The preview is informational; Sarah doesn't "buy" anything in our app.
- **Per-requisition grouping in the campaign timeline (G4)** — the CM and Sarah can filter the campaign timeline to show only requisitions, which is useful for the "what did my army look like at any point in time" use case.

**What this app does NOT do for routine requisitions:**

- No "buy requisition" button. No RP deduction UI. No CM approval workflow for routine purchases.
- The `requisition_purchase` `ApprovalRequest` kind (PRD-5 §3.2) is reserved for **CM-gifted or narrative-driven** requisitions — e.g., Mike grants Sarah a free Leman Russ replacement as a narrative reward at end-of-session. That kind of requisition goes through normal approval; routine player-bought ones don't.

**Workflow:**

1. Sarah plays a battle; her Leman Russ is destroyed.
2. Sarah opens NR, marks the unit as destroyed, applies "Requisition: Replaced Destroyed Unit" (NR-side flow), adds the new Leman Russ to her list, marks the RP cost. NR's requisition mechanic handles the rest.
3. Sarah exports NR JSON, uploads to this app.
4. App parses the new roster, sees the new unit + the requisition marker, generates a `HistoryEntry` row (G4 grouping: per-requisition).
5. The requisition history view shows it. The unit's per-unit timeline shows it. The campaign narrative log shows it.
6. CM doesn't need to approve — this happened in NR, the app just displays it.

**Critical moment:** When Sarah uploads the new NR list, the roster diff view should clearly call out the requisition so Sarah can verify "yes, that's the Leman Russ I bought in NR." Without that confirmation, Sarah might wonder if the upload caught the requisition correctly. The diff UI gets a "Requisitions in this upload" section that lists each requisition with its NR-derived details.

**Edge case:** Sarah uploads a new NR list but the requisition marker isn't visible (e.g., NR's requisition field is in a position the parser doesn't extract yet). The diff UI shows: "This upload has a new Leman Russ but no requisition marker detected. If you applied a requisition in NR, double-check the export." Helps Sarah catch export mistakes before they pollute the history.

**Edge case:** Sarah has a CM-gifted requisition (`requisition_purchase` approval) AND a routine NR-bought requisition in the same campaign. The history view shows both with different icons/badges so Sarah can distinguish "free gift from Mike" vs "bought in NR." The CM-gifted one has a CM note attached ("narrative reward for winning the Helsreach arc").

### Flow 4: Checking her timeline

**Trigger:** Sarah wants to see what happened to her Cadian Shock Troops. They were Battle-ready, then Battle-hardened, and now have a Battle Scar "Lost in the Fog." How did that happen?

**Why this matters:** This is Sarah's army's *story*. The timeline is the payoff for every approval, every battle, every requisition. It must be beautiful, because it's the reason Sarah cares about the app.

**UI requirements:**

- **Per-unit timeline view** on the roster page. Click a unit, see its event history.
- **Each event is a 1-line narrative card** with an icon (XP gain, rank promotion, honour gained, OoA test, requisition added) and a date. Most events are sourced from NR roster diffs — "this unit went from 5 XP to 8 XP because you re-imported on YYYY-MM-DD" — with the linked battle report inline. Per PRD-0 §4b.2, the timeline shows NR state changes as read-only display; it doesn't try to record per-unit changes that aren't in NR.
- **Filter by event kind.** "Show me all my OoA tests" or "Show me every rank promotion."
- **Battle reports are expandable in-line** so Sarah can re-read what happened in the battle that caused this event.
- **Compare to active vs. archived timelines.** If a unit was destroyed and Sarah bought a replacement, the destroyed unit's timeline is preserved separately; the new unit starts fresh.
- **Export as markdown.** Sarah can paste her army's story into a Discord channel or a print-out for the table.

**Critical moment:** The very first time Sarah opens a unit's timeline and sees "Battle-ready → Battle-hardened on 2026-08-15 (Battle vs. Mike's Tyranids, +3 XP). Battle Scar 'Lost in the Fog' gained 2026-08-22 (OoA test failed in Battle 22, honour-scar swap)." That's the moment she tells her friends about the app. The "Lost in the Fog" entry is shown because Sarah's NR list says the unit has that scar — the timeline is reading NR state, not app-side data.

**Edge case:** A unit from a NR list that was rejected and re-imported has two timelines. The current unit is the latest; the previous one is in the audit log. Sarah can drill in but the UI surfaces "this is the second version of this unit; the first was rejected on YYYY-MM-DD."

**Edge case:** A unit was destroyed in NR (player removed it from the list) but never re-imported into the app. The app still shows the unit's last-known state. The timeline surfaces: "this unit was last seen in your YYYY-MM-DD NR import; you haven't re-imported since." Sarah can either re-import the latest NR (which won't have the unit) or upload a roster with the unit back in (a `requisition_purchase` was probably involved).

---

## 8. Out of Scope

- Cross-tenant single sign-on
- Player-to-player direct messaging
- Spectator sign-up (spectators are public-link-based)
- OAuth login (env-var OIDC config possible but out of MVP)

---

## 9. Dependencies

- **PRD-0**: `User`, `Tenant`, `Campaign`, `CampaignMember`, `Roster`
- **PRD-1**: CM-side invite generation
- **PRD-3**: army import handoff
- **Auth infra**: SMTP, magic-link delivery
- **Wahapedia data** (PRD-0 infra): faction list, descriptions

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Invite-to-roster-imported time | < 5 min median |
| Drop-off at faction picker | < 10% |
| Players completing onboarding tour | > 80% |
| Magic-link delivery success | > 99% |

---

## 11. Edge Cases

1. **Two players pick same display name in same campaign**: append `#2`, `#3` etc. Non-blocking warning.
2. **Player joins, then CM removes them**: player loses access; roster data retained for 30 days, then hard-deleted.
3. **Player wants to switch faction mid-campaign**: requires CM approval (per PRD-5), creates a new Roster while keeping the old one as a snapshot.
4. **Email bounces**: account marked `email_unverified`; cannot file battle updates until resolved.
5. **Player tries to join with code from a tenant they have no account in**: error with a "create an account in this tenant" link.
