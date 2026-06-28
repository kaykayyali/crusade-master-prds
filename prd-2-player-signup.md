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

## 6. Out of Scope

- Cross-tenant single sign-on
- Player-to-player direct messaging
- Spectator sign-up (spectators are public-link-based)
- OAuth login (env-var OIDC config possible but out of MVP)

---

## 7. Dependencies

- **PRD-0**: `User`, `Tenant`, `Campaign`, `CampaignMember`, `Roster`
- **PRD-1**: CM-side invite generation
- **PRD-3**: army import handoff
- **Auth infra**: SMTP, magic-link delivery
- **Wahapedia data** (PRD-0 infra): faction list, descriptions

---

## 8. Success Metrics

| Metric | Target |
|--------|--------|
| Invite-to-roster-imported time | < 5 min median |
| Drop-off at faction picker | < 10% |
| Players completing onboarding tour | > 80% |
| Magic-link delivery success | > 99% |

---

## 9. Edge Cases

1. **Two players pick same display name in same campaign**: append `#2`, `#3` etc. Non-blocking warning.
2. **Player joins, then CM removes them**: player loses access; roster data retained for 30 days, then hard-deleted.
3. **Player wants to switch faction mid-campaign**: requires CM approval (per PRD-5), creates a new Roster while keeping the old one as a snapshot.
4. **Email bounces**: account marked `email_unverified`; cannot file battle updates until resolved.
5. **Player tries to join with code from a tenant they have no account in**: error with a "create an account in this tenant" link.
