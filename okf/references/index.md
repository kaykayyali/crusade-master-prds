# References

External sources, upstream data, architecture components, and competitors. Each is `type: Reference` rather than documented inline.

## v3 Architecture

* [Hapi](/references/hapi.md) — Node.js HTTP framework (API server + worker host).
* [BullMQ](/references/bullmq.md) — Redis-backed job queue for the async roster pipeline.
* [Redis](/references/redis.md) — In-memory store backing BullMQ, idempotency, rate limits.
* [MinIO](/references/minio.md) — S3-compatible object storage for uploads and exports.
* [PostgreSQL](/references/postgres.md) — Primary relational store; RLS-enforced multi-tenancy.
* [bs-roster-parser](/references/bs-roster-parser.md) — User's Python parser, invoked as a subprocess.
* [Rule Engine](/references/rule-engine.md) — First-class v3 component, gates approval on compliance.

## Upstream data sources

* [Wahapedia](/references/wahapedia.md) — Community wiki, source of 40K faction + unit + Crusade data.
* [New Recruit](/references/new-recruit-json.md) — Free army-list builder; v3.9 source of truth for unit/roster state.
* [Crusade: Armageddon](/references/crusade-armageddon.md) — MVP-scope supplement (Armageddon-only per v3).

## Competitors (paid)

* [Administratum](/references/administratum.md) — Subscription-based Crusade tracker (Goonhammer).
* [ServoCrypt](/references/servocrypt.md) — Subscription-based Crusade tracker.
