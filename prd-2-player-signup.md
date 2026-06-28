# PRD-2: Player Sign-Up (v3)

> Player onboarding within a tenant. v3: stack updated to Hapi/Node/TS; minor content changes.

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

### 3.3 Faction Picker

Searchable dropdown of all 26 Wahapedia factions. Each option shows:
- Faction logo (from Wahapedia)
- One-line description
- Linked Armageddon-specific content flag (if any)

After selection:
- Create `CampaignMember.factionId`
- Create an empty `Roster` (no draft, no approved)
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
    I -->|Yes| K[Pick faction]
    K --> L[Create Roster shell]
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

## 5. Faction Picker Notes

- 26 Wahapedia factions are the canonical list
- Picker does **not** filter to Armageddon-suitable factions
- Soft highlight: factions with documented Armageddon content get a small badge
- Legends / Forge World units are not in the picker; they're added during NR import

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

**Trigger:** Sarah just played a 2000-pt game against Mike's Tyranids and won. She's at home, tired, but wants to file the update before she forgets the details.

**Why this matters:** This is the most data-entry-heavy moment. Sarah has to remember what happened, translate it to the app's schema, and submit. If the form is annoying, she puts it off until tomorrow — and forgets.

**UI requirements:**

- **The "File Battle Update" button is on the campaign dashboard, prominent, never more than 2 clicks from the campaign home.**
- **Form is pre-filled with what the system can infer:**
  - Opponent: a member-list dropdown filtered to her campaign, sorted by "recently played" (Mike is at the top)
  - Date: today
  - Result: a single "I won" / "I lost" / "Draw" toggle
  - Mission: text input, with autocomplete from prior missions this campaign
- **Per-unit changes default to the universal Crusade rules:**
  - All units gain 3 XP (pre-checked)
  - OoA test section appears only if at least one unit has <50% models remaining
- **Agendas section is explicit:** Armageddon agendas (e.g., "Extermination Targets" for Astra Militarum) appear in a checklist. Sarah ticks which she attempted, then ticks which she achieved. The system doesn't compute the agenda outcome — that's the CM's verification job.
- **Battle report is a markdown textarea** with a "min 200 chars" hint if the campaign's `require_battle_report` is on. Sarah types 3-4 sentences; the form shows a live char count.
- **"Save as draft" and "Submit" are both available.** If Sarah runs out of time, she saves and comes back.
- **On submit, the form transitions to a "Pending Mike's review" card** with the timestamp, the deltas that will be applied, and a "view what will change" expander.

**Critical moment:** The OoA test. If a unit was destroyed, Sarah needs to record the OoA test (D6 roll) and the result (failed → XP loss or honour-scar swap). The form should auto-suggest "this unit was destroyed; OoA test required." If Sarah forgets, the form highlights it in red on submit and refuses to send. (Optional v1.x: the OoA test could be a D6 roller built into the form, so Sarah doesn't have to find a physical die. v1 has a manual D6 input field.)

**Edge case:** Sarah wins, files the update, then realizes she made a mistake. The update is "pending." Sarah clicks "withdraw" and starts over. Mike never sees the broken version.

**Edge case:** Sarah and Mike disagree on the result. Mike files his own update saying he won. The system flags `BattleUpdate.disputed`; both updates are in the inbox with the other's as context. Mike (as CM) adjudicates.

### Flow 3: Buying a requisition

**Trigger:** Sarah's Leman Russ was destroyed in a game. The OoA test failed; she chose to remove the unit. She wants to bring it back next week.

**Why this matters:** Requisitions are the player's "spend RP to fix a thing" mechanic. The moment of purchase is the moment Sarah is asking the system "show me the impact, then let me commit." If the UI hides the impact, she gets surprised by the result and loses trust.

**UI requirements:**

- **Requisition shop is a tab on Sarah's roster view.** Lists the available requisitions for Armageddon + Astra Militarum, each with a 1-line description and the RP cost.
- **The shop is empty if Sarah has no active RosterApproved.** The UI shows "You need an approved roster to buy requisitions" with a link to the roster page. (This is the submission-gating surface; Sarah sees the rule made visible.)
- **Each requisition card has a "What this does" preview** that opens a tooltip or side panel with the delta: "Replace 1 destroyed unit of any type. Your available destroyed-unit slots: 1. Current RP: 3."
- **The confirm button shows the cost in big type: "Confirm: Spend 3 RP to add 1 Leman Russ."** Sarah taps confirm.
- **The requisition goes to the CM's inbox as a pending approval.** Sarah sees "Pending Mike's review" and an ETA based on Mike's recent approval times (median of last 10 approvals).
- **When Mike approves, Sarah gets a notification** and the new unit appears in her roster. If Mike rejects, Sarah sees the reason and the RP is unspent.

**Critical moment:** The "what this does" preview. Requisitions have cascade effects — adding a unit might require a new requisition event AND a new unit node AND affect the point cap. The preview must show all of this. Sarah needs to know "if I buy this, here's the full list of changes."

**Edge case:** Sarah doesn't have enough RP. The button is disabled; the cost is shown in red; hovering shows "You have 1 RP. This costs 3."

**Edge case:** Sarah buys a requisition, Mike approves, but the imported NR list she used doesn't have the corresponding unit slot. The system emits a `unit.replaced` event but the unit doesn't appear in her roster until she re-imports. Sarah sees: "Approved. Re-import your NR list to see the new unit in your roster." (Cascading re-import is the cost of the "JSON is the source of truth" model.)

### Flow 4: Checking her timeline

**Trigger:** Sarah wants to see what happened to her Cadian Shock Troops. They were Battle-ready, then Battle-hardened, and now have a Battle Scar "Lost in the Fog." How did that happen?

**Why this matters:** This is Sarah's army's *story*. The timeline is the payoff for every approval, every battle, every requisition. It must be beautiful, because it's the reason Sarah cares about the app.

**UI requirements:**

- **Per-unit timeline view** on the roster page. Click a unit, see its event history.
- **Each event is a 1-line narrative card** with an icon (XP gain, rank promotion, honour gained, OoA test, requisition added) and a date.
- **Filter by event kind.** "Show me all my OoA tests" or "Show me every rank promotion."
- **Battle reports are expandable in-line** so Sarah can re-read what happened in the battle that caused this event.
- **Compare to active vs. archived timelines.** If a unit was destroyed and Sarah bought a replacement, the destroyed unit's timeline is preserved separately; the new unit starts fresh.
- **Export as markdown.** Sarah can paste her army's story into a Discord channel or a print-out for the table.

**Critical moment:** The very first time Sarah opens a unit's timeline and sees "Battle-ready → Battle-hardened on 2026-08-15 (Battle vs. Mike's Tyranids, +3 XP). Battle Scar 'Lost in the Fog' gained 2026-08-22 (OoA test failed in Battle 22, honour-scar swap)." That's the moment she tells her friends about the app.

**Edge case:** A unit from a NR list that was rejected and re-imported has two timelines. The current unit is the latest; the previous one is in the audit log. Sarah can drill in but the UI surfaces "this is the second version of this unit; the first was rejected on YYYY-MM-DD."

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
