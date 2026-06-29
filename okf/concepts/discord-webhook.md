---
type: Domain Concept
title: Discord Webhook
description: "Per-team Discord webhook registration for forwarding campaign events to a team-scoped guild channel. Team Leader (or CM) configures URL + event subscriptions; BullMQ delivery worker honors Discord rate limits and auto-disables on persistent failure."
resource: "https://github.com/kaykayyali/crusade-master-prds/blob/main/prd-8-discord-webhooks.md"
tags:
  - concept
  - discord
  - webhook
  - notifications
  - v4.0
  - prd-8
timestamp: "2026-06-28T21:30:00Z"
---

# Discord Webhook

A `DiscordWebhook` is a per-`CampaignTeam` registration of a Discord webhook URL that receives forwardings of campaign events. PRD-8 defines the full feature; this concept documents the data model and core invariants.

## Schema

```ts
DiscordWebhook {
  id,
  tenantId,
  campaignId,
  teamId,                          // FK to CampaignTeam; UNIQUE (campaignId, teamId) WHERE disabledAt IS NULL
  name,                            // friendly label for UI only (e.g., "Helsreach #crusade-chat")
  urlEncrypted,                    // servocrypt-encrypted URL — never logged, never returned post-creation
  urlFingerprint,                  // SHA-256 of plaintext URL; safe for audit logs
  createdByUserId,
  createdAt,
  updatedAt,
  disabledAt?,
  disabledReason?,
  consecutiveFailureCount: int,
  lastDeliveryAt?,
  lastSuccessAt?,
  minLoudness: 'loud' | 'normal' | 'quiet',   // default 'normal'
  autoDisableThreshold: int,                  // default 10
}

DiscordWebhookSubscription {
  webhookId,
  eventKind: EventKind,            // from PRD-4 §3 taxonomy
  enabled: bool,
  enabledAt?,
  enabledByUserId?
}

DiscordWebhookDelivery {
  id,
  webhookId,
  eventId,
  attempt,                         // 1..maxAttempts (default 5)
  status: 'pending' | 'success' | 'failed' | 'rate_limited' | 'gave_up',
  httpStatus?,
  errorMessage?,
  durationMs?,
  enqueuedAt,
  deliveredAt?,
  embedJson?
}
```

## Core Invariants

1. **At most one active webhook per team per campaign.** Enforced via `UNIQUE (campaignId, teamId) WHERE disabledAt IS NULL`. A "soft-retired" disabled row can coexist with a new one after URL rotation.
2. **Team-isolation enforced at fanout, not delivery.** The visibility filter (`public`/`campaign` always; `team`/`cm_only` only when `affectedTeamIds` includes the team) is computed once in the fanout step (PRD-4 §3.3 + PRD-8 §8.3). The delivery worker trusts its input.
3. **No `private` event is ever forwarded.** PRD-0 §3b team-isolation guarantee — leaks would happen if a private event hit a guild channel.
4. **URL is opaque after creation.** API responses redact; logs never include. The plaintext URL exists in worker process memory only for the duration of the HTTP call.

## Authorization

| Action | TL of team | CM of campaign | Player on team |
|---|---|---|---|
| Read | ✓ | ✓ (all teams) | ✓ (own team) |
| Edit name / loudness / subscriptions | ✓ | ✓ | ✗ |
| Rotate URL | ✓ | ✓ | ✗ |
| Send test embed | ✓ | ✓ | ✗ |
| View delivery log | ✓ | ✓ | ✓ |
| Delete | CM only | ✓ | ✗ |

Players on other teams cannot see the row exists (RLS-enforced).

## Delivery Pipeline

PRD-8 §8 in full:

1. Event emitted (PRD-4 §3) → fanout function runs
2. Fanout computes per-team eligibility (PRD-8 §8.3 visibility filter)
3. For each eligible team with a registered webhook subscribed to this `EventKind`, enqueue `discord-webhook-delivery` BullMQ job
4. Worker decrypts URL, renders embed from event payload, POSTs to Discord
5. Records delivery in `DiscordWebhookDelivery`, updates `DiscordWebhook` counters
6. Retries with exponential backoff on transient failure; honors `Retry-After` on 429
7. Auto-disables webhook after `consecutiveFailureCount >= autoDisableThreshold`

## Failure Handling Summary

| Discord response | Retry? | Increment counter? |
|---|---|---|
| `204` | n/a (success) | No (resets to 0) |
| `429` | Yes, after `Retry-After` | No (rate-limit is not a webhook failure) |
| `400` | No (bad embed; permanent) | No (our bug, not theirs) |
| `401`/`404` | No (URL revoked) | Yes |
| `5xx` | Yes (exponential backoff) | Yes |

After `autoDisableThreshold` consecutive 401/404/5xx/network failures, the webhook is auto-disabled and the TL + CM receive an in-app + email notification (not Discord, since Discord is the broken channel).

## Loudness Floor

Each webhook has a `minLoudness: 'loud' | 'normal' | 'quiet'` (default `'normal'`). Events whose `loudness` is below the floor do not fire the webhook even if subscribed. The mapping from `EventKind` to default loudness for Discord eligibility lives in PRD-8 §5.2 (separate from PRD-5 §8's in-app loudness assignment).

## Cross-references

- [PRD-8 — Discord Integration via Webhooks](/prds/prd-8-discord-webhooks.md) — Full specification
- [PRD-0 — Overview](/prds/prd-0-overview.md) — `Event` schema + `affectedTeamIds` extension, RLS policies
- [PRD-1 — CM Admin](/prds/prd-1-crusade-master-admin.md) — TL authority basis (§0)
- [PRD-4 — Events & Timeline](/prds/prd-4-events-deltas.md) — Event taxonomy, fanout function
- [PRD-5 — Approval System](/prds/prd-5-approval-system.md) — In-app loudness reference
- [PRD-6 — Technical Architecture](/prds/prd-6-technical-architecture.md) — OpenAPI `webhooks` block
- [PRD-7 — Testing Strategy](/prds/prd-7-testing-strategy.md) — Mock Discord receiver pattern
- [CrusadeTeamLeader](/concepts/crusade-team-leader.md) — TL role authority
- [Notification](/concepts/notification.md) — Adjacent in-app + email delivery channel