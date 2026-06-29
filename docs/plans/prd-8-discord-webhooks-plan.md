# PRD-8 Plan — Discord Integration via Webhooks

> Plan / scoping doc. The actual PRD-8 will be drafted only after sign-off.

## 1. Repo Review (1-minute summary)

**Project:** Crusade Master — a self-hosted, multi-tenant app for Warhammer 40K Crusade campaign administration.

**Stack (locked v3):** Vite + Vue 3 + TS (frontend), @hapi/hapi + Node 22 + TS (backend), Postgres + RLS, MinIO, BullMQ + Redis, Python 3.10+ parser subprocess, Docker Compose. MVP supports only *Crusade: Armageddon* (10e, June 2025).

**PRD layout (8 docs upstream):**

| # | File | Subsystem |
|---|------|-----------|
| 0 | `prd-0-overview.md` | App overview, shared data model, MVP scope |
| 1 | `prd-1-crusade-master-admin.md` | Instance admin + CM dashboard, campaign lifecycle |
| 2 | `prd-2-player-signup.md` | Discord OAuth + magic-link, account page, faction picker |
| 3 | `prd-3-army-export-versioning.md` | BullMQ pipeline, parser integration, rule engine |
| 4 | `prd-4-events-deltas.md` | Event taxonomy, submission gating, Timeline |
| 5 | `prd-5-approval-system.md` | Unified approval pipeline |
| 6 | `prd-6-technical-architecture.md` | Hapi API, OpenAPI/Swagger, drift detection |
| 7 | `prd-7-testing-strategy.md` | Test pyramid, environments, e2e |

**OKF bundle (v3.28.1):** concept docs under `okf/concepts/` (CrusadeForce/Version/Army, ApprovalKind, Notification, CampaignState, etc.) + reference docs under `okf/references/`. Bundle has its own `validate.js`, `lint-frontmatter.js`, `check-orphans.js`, `check-index-sync.js` linters.

**Where Discord is already mentioned (signaling the project expects this work):**

- `okf/concepts/notification.md` — `channels: { inApp, email, discord? }` — Discord explicitly the "future third channel"
- `prd-1-crusade-master-admin.md` §5c — 2-line placeholder: "Webhook-based Discord integration is a high-value v2 feature…"
- `prd-1-crusade-master-admin.md` §6b Flow 5 — "Mike can copy text from here to post in Discord" (CM's pain point)
- `prd-2-player-signup.md` §3.1 — Discord OAuth is the **primary sign-in provider**; we already have Discord identity per user
- `prd-4-events-deltas.md` §3.3 — Event→Notification fanout diagram leaves a slot for future Discord hook
- `prd-5-approval-system.md` §8 — Notifications UX loudness table is in-app/email only; Discord row is implied
- `prd-5-approval-system.md` (3 mentions) — "future event hooks (team view pages, Discord, narrative analytics) work uniformly"
- `prd-6-technical-architecture.md` §4.1 — "Webhooks (if we add outbound webhooks in v2): document as `webhooks` block"
- `prd-7-testing-strategy.md` — env table already has Discord test app column; PRD-13.3 mentions "future Discord" event hook
- `README.md` v3.15 — "Discord integration: noted as v2 future in PRD-1 §5c. Webhook-based forwarding of events."

**Net:** PRD-1 §5c is a TODO. The Notification model already has the channel slot. Discord OAuth identity already exists. The architecture is webhook-ready; only the PRD that defines it is missing. **This PRD closes the loop.**

## 2. PRD-8 Scope — Recommended

**Title:** PRD-8 — Discord Integration via Webhooks

**One-line:** Allow a Crusade Master to register one or more Discord webhook URLs per campaign, subscribe to a subset of campaign events by kind + loudness, and have those events delivered as rich embeds to the chosen Discord channel — with team-isolation enforced, retry/backoff on Discord's 429s, and no full bot integration.

**In scope (v1 of this feature):**

- Per-campaign webhook configuration (multiple webhooks per campaign allowed)
- Webhook registration: URL + friendly name + channel description (text CM sees in UI; not sent)
- Per-webhook subscription: pick which `EventKind` values + which loudness (`loud` / `normal` / `quiet`) to forward
- **Visibility-gated forwarding**: only events with `visibility ∈ {'public', 'campaign'}` are eligible. `team`, `cm_only`, `private` are NEVER forwardable (team-isolation guarantee per PRD-0 §3b / §4b.3)
- Rich Discord embeds: title, description, color (per loudness), fields, author, timestamp, link back to in-app source
- Delivery worker: BullMQ-backed, retry with exponential backoff, honors Discord `Retry-After` on 429, auto-disables on persistent failure + notifies CM
- CM UI: list, add, edit (rename + subscriptions only — URL is opaque), delete, rotate (regenerate-secret), test-send (sends a synthetic test event to verify URL works)
- Audit: every webhook delivery attempt is logged to the audit trail with success/failure status, response code, attempt count
- Per-user override: users can opt out of having their actions echoed to Discord in their account page (`/account/notifications`) — for users uncomfortable with their name + actions in a semi-public guild channel
- Tenant-level defaults (optional, nice-to-have): Instance Admin or CM can set a "default webhook" that pre-populates new campaigns
- OpenAPI: add `webhooks` block per PRD-6 §4.1 placeholder

**Out of scope (explicit non-goals, document as deferred):**

- ❌ Full Discord bot (slash commands, DMs, reactions, role-lookups). We use webhooks only.
- ❌ Bidirectional sync (Discord → app). Read-only forwarding, app → Discord only.
- ❌ Threaded messages / persistent threads per event. Each event is one embed.
- ❌ Discord OAuth guild verification (linking a Discord guild to a tenant). OAuth is already used for sign-in (PRD-2); we don't extend it for this PRD.
- ❌ Cross-tenant webhooks. Webhooks are per-campaign, scoped by tenant.
- ❌ Per-team webhooks (e.g., Team A's webhook different from Team B's). A campaign has one set; CM routes within.
- ❌ Custom embed templates per webhook (v1). Templating is JSON-driven from event payload; no per-webhook editor.

## 3. PRD-8 Structure (sections I'll write)

Following the existing PRD layout:

1. **Goals & non-goals** (above)
2. **Glossary** — webhook, Discord embed, 429 rate-limit, visibility levels
3. **Background & user stories**
   - Mike (CM) wants campaign chatter in #crusade-aurelian automatically
   - Sarah (player) doesn't want her personal actions echoed to a guild she doesn't read; can opt out per-account
   - Instance Admin needs tenant-default webhooks for new campaigns
4. **Data model** (new tables):
   - `DiscordWebhook { id, tenantId, campaignId, name, urlEncrypted, createdByUserId, createdAt, disabledAt?, disabledReason? }`
   - `DiscordWebhookSubscription { webhookId, eventKind, minLoudness }`
   - `DiscordWebhookDelivery { id, webhookId, eventId, attempt, status, httpStatus, error?, deliveredAt? }`
   - `UserNotificationPreference` extension: `echoToDiscord: bool` (default true; respects loudness)
5. **Configuration UI** (CM panel → Integrations → Discord)
   - List / add / edit / delete / rotate / test-send
   - Subscription matrix: per-event-kind checkbox + loudness radio
6. **Delivery pipeline** — flowchart + worker config (BullMQ `discord-webhook-delivery` queue)
7. **Embed format** — per loudness color, per event-kind payload shape (samples for `approval.requested`, `battle.filed`, `crusade.rp_gained`, `campaign.phase_activated`, etc.)
8. **Rate-limit handling** — Discord's 30/min/webhook, 5 concurrent/webhook; backoff math
9. **Visibility & team-isolation** — enforcement point (event fanout step, NOT delivery worker); test matrix
10. **Per-user opt-out** — account page setting, how it interacts with loudness, opt-out vs opt-in default
11. **Security** — URL encrypted at rest (KMS or app-level key); never logged; rotate flow; URL only shown once on creation
12. **Failure modes & auto-disable** — N consecutive failures (configurable; default 10 in 1h) → webhook disabled, audit log entry, in-app notification to CM
13. **Tenant defaults** (optional, instance admin or CM-set)
14. **OpenAPI surface** — `webhooks` block per PRD-6 §4.1
15. **Cross-PRD touch points** — explicit list of every change in PRD-1/2/4/5/6/7
16. **Testing strategy** — unit (mocked Discord), integration (testcontainers + a mock Discord receiver), e2e (real Discord test channel in staging only)
17. **Migration & rollout** — feature flag, gradual enablement

## 4. Cross-PRD changes this PRD will introduce

| Doc | Section | Change |
|---|---|---|
| `prd-0-overview.md` | §3.4 / §4 (data model) | Add `DiscordWebhook*` tables; `UserNotificationPreference.echoToDiscord` |
| `prd-1-crusade-master-admin.md` | §5c | **Replace the 2-line placeholder** with a link + 1-line summary pointing at PRD-8 |
| `prd-1-crusade-master-admin.md` | §3.2 | Optional: add `tenant_settings.default_discord_webhook_url` for instance defaults |
| `prd-2-player-signup.md` | §5d (account page) | Add `echoToDiscord` to NOTIFICATIONS section |
| `prd-4-events-deltas.md` | §3.3 | Note that fanout now also produces Discord `NotificationDelivery` rows when subscribed |
| `prd-5-approval-system.md` | §8 (Notifications UX table) | Add Discord column to the loudness table (or add a separate sub-table since channels ≠ loudness) |
| `prd-6-technical-architecture.md` | §4.1 (OpenAPI) | Implement the `webhooks` block (currently placeholder) |
| `prd-7-testing-strategy.md` | env table, §5 (mock OAuth) | Already mentions "Discord test app"; add mock Discord webhook receiver; add `webhook-delivery-job` to test matrix |
| `okf/concepts/notification.md` | description + channels field | Flip Discord from "future" to "delivered via webhook (PRD-8)" |
| `okf/concepts/` | NEW: `discord-webhook.md` | New concept doc for `DiscordWebhook` family |

## 5. New files this PRD creates

- `prd-8-discord-webhooks.md` (and `.html` rendered version, matching existing convention)
- `okf/prds/prd-8-discord-webhooks.md`
- `okf/concepts/discord-webhook.md`
- `okf/scripts/` — possibly a `discord-embed-renderer.js` validator that lint-checks embed JSON shapes if we templatize

## 6. Design choices — signed off

User decisions on the four sign-off points (2026-06-28):

1. **Webhooks only, no bot.** Confirmed. PRD-1 §5c placeholder language stays. Avoids bot tokens, OAuth scope expansion, DMs, slash commands.
2. **Per-campaign, but limit 1 per team.** Each `CampaignTeam` gets at most one webhook. A campaign with N teams has up to N webhooks. The webhook is a team-scoped resource; it's owned by the team's TL (with CM override). Per-tenant defaults are out of scope.
3. **Per-event-kind subscription (no loudness floor in v1).** TL picks which `EventKind` values trigger the team's webhook. The default set is curated for "team updates" — roster updates for the team's players, approval requests directed at the team's TL, battle reports involving team members, member lifecycle on the team. The TL can prune the defaults.
4. **No per-user opt-out.** If a webhook is registered and an event matches, it fires. Period. PRD-2 §5d does NOT add an `echoToDiscord` preference.

**Other locked positions (auto-decided, push back if disagreeing):**

- **Visibility gating rule:** forward to Team X's webhook iff `event.visibility ∈ {'public', 'campaign'}` OR `event.affectedTeamIds` includes Team X's id. `private` events are never forwarded. This implements the team-isolation invariant (PRD-0 §3b / §4b.3) at the fanout step, not the delivery worker — the delivery worker is dumb pipe.
- **Authorization on the team's webhook config:** TL of the team has full CRUD on their team's webhook. CM of the campaign has full CRUD on any team's webhook (override). Players on the team have read-only view (can see delivery status, test results, but can't edit). Players on other teams cannot see the webhook exists.
- **URL encrypted at rest, shown only on creation.** Standard. Use the same `servocrypt` envelope pattern already referenced in `okf/references/servocrypt.md`.
- **Auto-disable after N failures.** Default 10 consecutive failures; configurable per webhook. Disabled webhook logs an audit entry and surfaces an in-app notification to the TL + CM.
- **Retries:** exponential backoff with jitter; max 5 attempts over ~30 min; honor Discord's `Retry-After` header on 429.
- **No campaign-wide webhook in v1.** CM gets the TL view of all team webhooks (read) but doesn't get a separate campaign-wide channel. Defer to v1.x.
- **No bot-side interactions.** No PATCH/edit-message, no threads, no reactions, no DMs. Send-only.

## 7. Open questions resolved during drafting

- Webhook **rotation** (regenerate URL without losing config + subscriptions)? **Yes.** `POST /webhook/rotate` returns a new URL; subscriptions stay.
- Expose raw event payload to TL for debugging? **Yes, read-only, in the delivery log; redact `payload.private` fields.**
- Edit-message affordance? **Deferred.** v1 is send-only.
- Per-team webhook naming: TL supplies a friendly label (e.g., "Helsreach #crusade-chat"). Used in UI + delivery log; never sent to Discord.
- What if a team's webhook is disabled when an event fires? Event still emitted, in-app feed still updated, just no Discord delivery. Audit log records "webhook skipped (disabled)".

---

**Ready for your call on the four sign-off points.** Once you green-light (or adjust), I'll draft PRD-8 + the cross-PRD edits + the new OKF concept, then run the bundle's linters to confirm everything is in sync.