# PRD-2: Player Sign-Up

> Player onboarding flow: account creation, joining a campaign via invite, choosing a faction, and first-time onboarding.

---

## 1. Goals

Get a player from "I have an invite code" to "I see my empty Crusade roster" in under 5 minutes, with no required manual data entry beyond faction choice.

**Success metric**: Median time from invite acceptance to first roster import attempt < 5 minutes.

---

## 2. User Stories

- **As a new player**, I can sign up with just an email address (magic-link auth) — no password to remember.
- **As a player with an invite code**, I can enter it and immediately land inside the campaign.
- **As a player**, I can pick my faction (with searchable picker across all 26 Wahapedia factions).
- **As a player**, I get a guided first-tour explaining Crusade card mechanics, post-battle update flow, and requisitions.

---

## 3. Feature Modules

### 3.1 Account Creation

- Email + magic link (no password; CM invitation email is the bootstrap)
- Display name (unique within a campaign, globally unique for CM)
- Optional avatar upload
- Timezone (auto-detected, editable; used for battle scheduling)
- Locale (en for MVP)

### 3.2 Join via Invite

- Single text field: "Paste invite code or link"
- Validation against `Campaign.joinCode`
- If valid: account auto-binds to campaign with `CampaignMember` role `player`
- If invalid: clear error ("Code not found or expired" vs "Already used")

### 3.3 Faction Picker

Searchable dropdown of all 26 Wahapedia factions. Each option shows:
- Faction logo (from Wahapedia or local)
- One-line description
- Linked supplement (auto-selected if campaign supplement has faction-specific content)

After selection, the system creates a placeholder `Roster` with no units. Player then imports their first army (PRD-3).

### 3.4 First-Time Onboarding

Modal flow shown only on first login:

1. **"Welcome"**: 1-line pitch + "Got it" button
2. **"Crusade basics"**: 3-step explainer with visuals (rank ladder, OoA test, requisitions)
3. **"Import your army"**: direct link to PRD-3 importer
4. **"You're set"**: dashboard with empty roster

The tour can be re-invoked from settings at any time.

---

## 4. User Flow

```mermaid
flowchart TD
    A[Player receives invite link] --> B{Click link}
    B --> C[Lands on /join?code=XYZ]
    C --> D{Has account?}
    D -->|No| E[Sign up: email + display name]
    D -->|Yes| F[Sign in via magic link]
    E --> G[Email magic link sent]
    F --> G
    G --> H[Click link in email]
    H --> I[Authenticated, on /join page]
    I --> J[Pick faction]
    J --> K[Confirm join]
    K --> L[Redirected to /campaigns/{id} dashboard]
    L --> M{First time?}
    M -->|Yes| N[Onboarding tour]
    M -->|No| O[Standard dashboard]
    N --> P[Import army CTA]
    P --> Q[Hand off to PRD-3]
```

### 4.1 Branch: Returning Player, New Campaign

Player signs in, opens dashboard, sees existing campaign(s) + a "Join another campaign" button. Same flow as above from `J` (pick faction).

### 4.2 Branch: Invite Code Expired

CM controls expiry (default 14 days). Expired codes show a clear message with a "Request new invite from your CM" button (sends in-app notification to CM).

---

## 5. Faction Picker Notes

The 26 Wahapedia factions are not equally Crusade-friendly in the Armageddon supplement. The picker should:

- **Highlight** factions with strong Armageddon content (per Wahapedia faction page)
- **Allow** picking any faction; if a faction has no Armageddon-specific content, show a soft warning ("Limited Armageddon content — you'll use mostly universal Crusade rules")
- **Not restrict** player choice; some CMs run "anything goes" campaigns

---

## 6. Out of Scope

- Multi-campaign cross-roster management (future)
- Player-to-player messaging (not part of MVP)
- Spectator sign-up (spectators can view via public campaign URL, no auth)

---

## 7. Dependencies

- **PRD-0**: `User`, `Campaign`, `CampaignMember` types
- **PRD-1**: CM-side invite generation
- **Auth infra** (PRD-0): magic-link email delivery
- **PRD-3**: army import handoff

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Invite-to-onboarded time | < 5 min median |
| Drop-off at faction picker | < 10% |
| Players completing onboarding tour | > 80% |
| Magic-link delivery success rate | > 99% (incl. retry on bounce) |

---

## 9. Edge Cases

1. **Two players pick the same display name in same campaign**: append `#2`, `#3`, etc. (e.g., `Jake#2`). Show a non-blocking warning.
2. **Player joins, then CM removes them**: player loses access but their roster data is retained for 30 days in case of dispute, then hard-deleted.
3. **Player wants to switch faction mid-campaign**: requires CM approval (per PRD-5), creates a new roster version while keeping the old one as a snapshot.
4. **Player's email bounces**: account marked `email_unverified`; cannot file battle updates until resolved. Banner on dashboard explains.
