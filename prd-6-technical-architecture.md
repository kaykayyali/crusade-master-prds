# PRD-6 — Technical Architecture & API Surface

**Subsystem**: Cross-cutting technical decisions that don't fit into a single subsystem PRD. The Hapi API contract, OpenAPI/Swagger generation strategy, observability, and how to keep the API surface in sync with code.

**v3.25 focus**: OpenAPI/Swagger strategy with a maintenance approach.

---

## 0. Glossary

- **OpenAPI**: a specification (formerly Swagger) for describing HTTP APIs in a machine-readable format (YAML or JSON).
- **Swagger UI**: a browser-rendered UI for exploring an OpenAPI spec interactively.
- **Schema-first**: the API contract is defined before any code; code is generated from the schema.
- **Code-first**: the API contract is derived from code (route definitions, schemas) at build time. The schema becomes a build artifact.
- **Drift**: when the published API spec no longer matches the running code. Drift is the #1 way external integrations break.

---

## 1. Goals

1. **The API is self-documenting.** Anyone with a JWT can hit `/api/docs` and see every endpoint, every request shape, every response shape.
2. **The published OpenAPI spec is always accurate.** No drift between spec and code.
3. **Schema changes are reviewable.** A route change appears as a diff in the PR.
4. **External clients (including our own frontend) can generate types.** TypeScript types for the frontend come from the OpenAPI spec, not handwritten.

---

## 2. Code-First API Strategy

We use **code-first**: route definitions in Hapi are the source of truth; the OpenAPI spec is generated from them at build time. The opposite ("schema-first") would require us to maintain two definitions of every endpoint, which is exactly what drift looks like.

**Why code-first:**
- One place to edit (the route file)
- Schemas double as runtime validation (Joi) AND OpenAPI metadata
- No codegen pipeline; just a build step that introspects the running server

**Tooling: `@hapi/swagger` + `@hapi/inert` + `@hapi/vision`**

```ts
// apps/api/src/server.ts
import Hapi from '@hapi/hapi';
import Inert from '@hapi/inert';
import Vision from '@hapi/vision';
import HapiSwagger from 'hapi-swagger';

const server = Hapi.server({
  port: 3000,
  routes: {
    validate: { failAction: 'log' },  // validate but don't crash on bad input (logs only)
  },
});

await server.register([
  Inert,
  Vision,
  {
    plugin: HapiSwagger,
    options: {
      info: {
        title: 'Crusade Master API',
        version: process.env.npm_package_version,
        description: 'Multi-tenant Crusade campaign management',
      },
      schemes: ['https'],
      grouping: 'tags',
      sortPaths: 'groups',
      documentationPage: true,
      swaggerUI: true,
      // Generated YAML is exposed at /api/docs/openapi.yaml
      jsonPath: '/api/docs/openapi.json',
      yamlPath: '/api/docs/openapi.yaml',
    },
  },
]);
```

**Route example:**

```ts
// apps/api/src/routes/rosters.ts
import Joi from 'joi';

server.route({
  method: 'POST',
  path: '/api/campaigns/{campaignId}/rosters/{rosterId}/drafts',
  options: {
    tags: ['api', 'rosters'],
    description: 'Upload a new roster draft (JSON file)',
    validate: {
      params: Joi.object({
        campaignId: Joi.string().uuid().required(),
        rosterId: Joi.string().uuid().required(),
      }),
      payload: Joi.object({
        blobId: Joi.string().uuid().required(),  // Pre-uploaded to MinIO
        source: Joi.string().valid('nr_json', 'manual_edit').required(),
      }),
    },
    response: {
      schema: Joi.object({
        draftId: Joi.string().uuid(),
        status: Joi.string().valid('parsing'),
        enqueuedAt: Joi.date().iso(),
      }),
      failAction: 'log',
    },
    plugins: {
      'hapi-swagger': {
        responses: {
          '202': { description: 'Draft enqueued for parsing' },
          '400': { description: 'Validation failed' },
          '403': { description: 'Not a member of this campaign' },
          '404': { description: 'Campaign or roster not found' },
        },
        security: [{ bearerAuth: [] }],
      },
    },
  },
  handler: async (request, h) => { /* ... */ },
});
```

**What `@hapi/swagger` does:**
- At server startup, walks every registered route
- For each route, reads `options.validate.{params,query,payload,response}.schema` (Joi schemas)
- Converts Joi schemas → OpenAPI 3.0 schemas (handles `string().uuid()`, `number().min()`, etc.)
- Adds tag grouping from `options.tags`
- Adds security definitions from `options.plugins['hapi-swagger'].security`
- Emits a complete OpenAPI JSON document at `/api/docs/openapi.json`
- Serves a Swagger UI at `/api/docs`

**What `@hapi/swagger` does NOT do** (we have to handle these):
- Auto-generate TypeScript types from the spec (we use `openapi-typescript` in a build step)
- Auto-write the spec to a file (we use `server.inject()` to dump it, see §5)
- Drift detection (we use a custom CI check, see §5)

---

## 3. Versioning Strategy

### 3.1 URL-versioned major versions (rare)

For breaking changes that can't be done in place, we mount a new prefix:
- `/api/v1/campaigns/...` (current)
- `/api/v2/campaigns/...` (hypothetical v2)

We use `@hapi/api-version` plugin to negotiate versions per route.

### 3.2 Schema-versioned minor versions (default)

For non-breaking changes, we add optional fields to existing responses. Clients that don't know about new fields ignore them. Clients that do know use them.

### 3.3 Deprecation policy

When a field or endpoint is deprecated:
1. Mark it in the route's `options.plugins['hapi-swagger'].deprecated: true`
2. Add a `@deprecated` note in the schema description
3. The Swagger UI renders it as struck-through with a warning
4. Keep deprecated fields for ≥6 months before removal

### 3.1 Real-time Strategy: Polling (v3.28)

**Decision (v3.28): polling, not SSE/WebSocket, not refresh-only.**

v3.17 said "browser refresh is fine." The inbox UX (PRD-1 §6b Flow 2, PRD-5 §5.4) requires better-than-refresh — the CM needs to see newly-filed approvals appear without manual reload. v3.28 introduces polling as the simplest viable approach.

**Polling contract:**

```ts
// apps/web/src/composables/useInboxPoller.ts
export function useInboxPoller(options: {
  campaignId: string;
  intervalMs?: number;        // default 20000
  onUpdate: (items: ApprovalRequest[]) => void;
}) {
  let cursor: string | null = null;
  let timer: number | null = null;
  let paused = false;

  async function tick() {
    if (paused) return;
    if (document.visibilityState === 'hidden') return;
    const params = cursor ? `?since=${encodeURIComponent(cursor)}` : '';
    const res = await fetch(`/api/campaigns/${options.campaignId}/inbox${params}`);
    if (res.ok) {
      const { items, nextCursor } = await res.json();
      if (items.length > 0) options.onUpdate(items);
      cursor = nextCursor;
    }
  }

  function start() {
    tick();  // initial fetch
    timer = window.setInterval(tick, options.intervalMs ?? 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();  // immediate refresh on focus
    });
  }

  function pause() { paused = true; }
  function resume() { paused = false; tick(); }

  return { start, pause, resume };
}
```

**API contract:**

```ts
// GET /api/campaigns/:campaignId/inbox?since=<ISO8601 timestamp>
{
  items: ApprovalRequest[],   // only items created or updated since `since`
  nextCursor: string,         // ISO8601 timestamp to use for the next request
}
```

**Performance characteristics:**
- 8-16 peak users × 3 reqs/min/user = trivial load on Hapi/Postgres
- The query `SELECT * FROM approval_requests WHERE campaign_id = $1 AND updated_at > $2` is index-friendly on `(campaign_id, updated_at)`
- Cursor is per-campaign; each user's cursor is independent

**Why not SSE/WebSocket:**
- SSE requires sticky sessions or a Redis pub/sub fanout — additional infra
- WebSocket adds auth-on-connection complexity (token refresh, reconnect storms)
- Polling at 20s is good enough UX for a campaign-management tool with low concurrent user count
- v1.x may upgrade to SSE if user feedback demands sub-second latency

**Pause conditions (saves requests):**
- `document.visibilityState === 'hidden'` (backgrounded tab)
- User is actively in the inbox detail view (no point redrawing under their cursor)
- User has explicitly paused via a UI control

**Resume conditions:**
- `visibilitychange` to visible → immediate tick
- User navigates back to inbox view → immediate tick
- Pause control released → immediate tick

---

## 4. Generated TypeScript Types for Frontend

The Vue frontend imports types from the OpenAPI spec, generated at build time:

```ts
// apps/web/src/api/types.ts (generated, do not edit)
// Generated by: pnpm generate:api-types

export type Campaign = {
  id: string;
  tenantId: string;
  name: string;
  // ...
};

export type RosterDraft = {
  id: string;
  rosterId: string;
  status: 'parsing' | 'pending_review' | 'pending_approval' | 'approved' | 'rejected' | 'failed';
  // ...
};
```

**Build pipeline:**
```json
{
  "scripts": {
    "generate:api-types": "openapi-typescript http://localhost:3000/api/docs/openapi.json -o apps/web/src/api/types.ts",
    "prebuild": "pnpm generate:api-types"
  }
}
```

**Why this matters:** the frontend and backend can't drift. If the backend changes a response shape, the frontend fails to type-check. The build catches it before any user sees it.

---

## 5. Drift Detection — The Maintenance Strategy

This is the most important section. The user's emphasis: "thinking about how to keep it up to date is key."

### 5.1 The problem

`@hapi/swagger` generates the spec at server startup. The generated spec lives in memory; if the server isn't running, there's no spec to compare against. Without a baseline, every build produces a slightly different spec, and there's no way to know which changes were intentional.

### 5.2 The solution: spec snapshot in git

**Workflow:**

1. **At build time** (CI), the server boots up using a special `dump-spec` mode
2. **It generates** the full OpenAPI JSON and writes it to `apps/api/openapi.snapshot.json`
3. **It compares** against the committed `openapi.snapshot.json` in the repo
4. **If different**, the build fails with a clear message: "OpenAPI snapshot drift detected. Run `pnpm update:openapi-snapshot` and commit the change."

**The snapshot in git is the contract.** It's reviewed in PRs. It's the artifact external integrations pin to.

### 5.3 Implementation

```ts
// apps/api/scripts/dump-spec.ts
import { buildServer } from '../src/server';
import fs from 'fs';

async function main() {
  const server = await buildServer({ mode: 'no-db' });
  // Don't bind to a port; we just want the spec
  
  // Hapi-swagger exposes the spec via request injection
  const res = await server.inject({ method: 'GET', url: '/api/docs/openapi.json' });
  const spec = JSON.parse(res.payload);
  
  fs.writeFileSync(
    'apps/api/openapi.snapshot.json',
    JSON.stringify(spec, null, 2) + '\n'
  );
  console.log('Spec dumped to apps/api/openapi.snapshot.json');
  await server.stop();
}

main();
```

**CI script (`.github/workflows/drift-check.yml`):**

```yaml
name: OpenAPI Drift Check

on: [push, pull_request]

jobs:
  drift-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: pnpm install
      - run: pnpm dump:openapi
      - name: Check for drift
        run: |
          if ! git diff --quiet apps/api/openapi.snapshot.json; then
            echo "ERROR: OpenAPI snapshot drift detected."
            echo "Run 'pnpm update:openapi-snapshot' locally and commit the change."
            git diff --stat apps/api/openapi.snapshot.json
            exit 1
          fi
```

### 5.4 The contributor experience

When a developer adds or modifies a route:

1. They edit the route file (the source of truth)
2. They run `pnpm dump:openapi` locally
3. They see the diff in `apps/api/openapi.snapshot.json`
4. They commit both the route change AND the snapshot update
5. The PR review includes both diffs
6. CI verifies the snapshot is up to date
7. On merge, the snapshot is the new published contract

**Why this works:** the snapshot is treated like code. It can't drift because it's gated. And because it's in the PR diff, reviewers see it.

### 5.5 What about generated types in the frontend?

The frontend types are regenerated in the same workflow:

```yaml
- name: Regenerate frontend types
  run: pnpm generate:api-types

- name: Check for frontend type drift
  run: |
    if ! git diff --quiet apps/web/src/api/types.ts; then
      echo "ERROR: Frontend types out of sync with OpenAPI snapshot."
      git diff --stat apps/web/src/api/types.ts
      exit 1
    fi
```

If the spec changes, the frontend types change too, and the CI catches both.

### 5.6 Edge cases

**Breaking changes that affect consumers:**

If we need to break the API (rename a field, change a type, remove an endpoint), we MUST:
1. Add the new version (e.g., `/api/v2/...`)
2. Mark the old version deprecated in the spec (`deprecated: true`)
3. Update the snapshot (this is automatic)
4. Document the migration in the README
5. Wait ≥6 months before removing the old version

**Drift false positives:**

Sometimes the spec changes without a route change (e.g., `@hapi/swagger` version upgrade changes formatting). To handle this:
- Pin `@hapi/swagger` to a major version
- Document expected "formatting-only" changes in the CI workflow
- If the diff is purely cosmetic (whitespace, order), allow it with a flag (or just accept it)

**Initial setup:**

When first adopting this strategy, there's no committed snapshot yet. The workflow:
1. Run `pnpm dump:openapi` once
2. Commit `apps/api/openapi.snapshot.json` with the initial spec
3. All subsequent PRs are diffs against this baseline

---

## 6. OpenAPI Extensions We Use

Standard OpenAPI 3.0 covers most needs; these extensions are useful additions:

| Extension | Purpose | Where we use it |
|---|---|---|
| `x-tenant-scoped: true` | Marks endpoints that are tenant-scoped (vs. instance-scoped) | All `/api/tenants/{tenantId}/...` routes |
| `x-requires-role: ["cm"]` | Roles required to call this endpoint | CM-only admin routes |
| `x-rate-limit: "10/minute"` | Rate limit per PRD-7 (if added) | Upload endpoints |
| `x-audit-logged: true` | This endpoint generates an AuditLog entry | All mutating endpoints |

These extensions are non-standard but well-supported by code-first generation tools.

---

## 7. Authentication in the OpenAPI Spec

Hapi routes use bearer auth (JWT). We declare the security scheme once and reference it:

```ts
// apps/api/src/server.ts
{
  plugin: HapiSwagger,
  options: {
    // ...
    securityDefinitions: {
      bearerAuth: {
        type: 'apiKey',
        name: 'Authorization',
        in: 'header',
        description: 'JWT bearer token (issued by OAuth or magic-link)',
      },
    },
  },
}
```

Routes opt-in via:
```ts
plugins: {
  'hapi-swagger': {
    security: [{ bearerAuth: [] }],
  },
},
```

The Swagger UI gets a "Authorize" button that lets you paste a JWT for trying out endpoints.

---

## 8. What Goes In / Out of the OpenAPI Spec

### In scope (documented)

- All `/api/...` routes that return data to clients
- All request/response schemas
- All error responses (4xx, 5xx)
- Authentication requirements
- Rate limits (if any)

### Out of scope (not documented)

- Internal BullMQ worker endpoints (no HTTP surface)
- WebSocket / SSE channels (documented separately if added in v2)
- Health check endpoints (`/health`, `/ready`) — simple, no need to document
- Admin-only debug endpoints (`/_internal/...`) — prefix indicates private

### Conditional (document if user-facing)

- Webhooks (if we add outbound webhooks in v2): document as `webhooks` block
- Bulk operations: document with `x-bulk: true` extension

---

## 9. Alternative Approaches Considered

We evaluated four approaches and rejected three.

### Rejected: Schema-first with Stoplight / Spectral

Schema-first means writing OpenAPI YAML by hand, then generating handlers.

**Pros**: API contract is reviewable independently of code.
**Cons**: Requires manual maintenance of two definitions (YAML + code) unless we have codegen. Codegen from OpenAPI to Hapi routes is brittle and not type-safe.
**Verdict**: rejected. Drift risk too high for a small team.

### Rejected: tRPC (TypeScript-only RPC)

tRPC gives end-to-end types without OpenAPI.

**Pros**: No codegen; types are inferred.
**Cons**: TypeScript-only (can't generate OpenAPI for external clients); opinionated; harder to integrate with non-TS clients (Python parser subprocess, future Discord bot).
**Verdict**: rejected. We need OpenAPI for external integrations and non-TS consumers.

### Rejected: GraphQL

GraphQL with its single endpoint and schema-first development.

**Pros**: Clients fetch exactly what they need.
**Cons**: More complex server (resolvers, N+1, caching); overkill for our CRUD-heavy API; harder to use file uploads.
**Verdict**: rejected. Our API is mostly CRUD; REST/OpenAPI fits.

### Chosen: Code-first with @hapi/swagger

Code-first with Joi schemas as the source of truth, OpenAPI generated at build time, drift detection via snapshot.

**Pros**: One definition (the route file); schemas validate at runtime AND generate spec; no codegen pipeline for routes.
**Cons**: Snapshot drift requires CI discipline (mitigated by drift check).
**Verdict**: chosen. Best fit for our team size and stack.

---

## 10. Observability — Brief (deferred detail)

Observability isn't the focus of this PRD; just noting the dependencies:

- **Structured logs** (pino) include `tenantId`, `userId`, `requestId` — log lines are JSON, indexed in Loki
- **Metrics** (Prometheus) include request duration, error rate, RLS denial count — exposed at `/metrics`
- **Traces** (OpenTelemetry) span Hapi → DB → queue — exported to Tempo or Jaeger
- **Error tracking** (Sentry) captures unhandled exceptions with full context

These feed into the same API but are out of scope for the API contract itself.

---

## 11. Dependencies

- **PRD-0**: data model defines response shapes
- **PRD-1**: CM admin endpoints
- **PRD-2**: auth endpoints (OAuth, magic-link)
- **PRD-3**: roster endpoints
- **PRD-4**: event endpoints, history endpoints
- **PRD-5**: approval endpoints
- **PRD-7**: testing strategy references the OpenAPI snapshot for E2E tests

---

## 12. References

- @hapi/swagger: https://github.com/hapi-swagger/hapi-swagger
- OpenAPI 3.0 spec: https://swagger.io/specification/
- openapi-typescript: https://github.com/drwpow/openapi-typescript
- @hapi/api-version: https://github.com/hapi-community/api-version
- Joi (validation library that @hapi/swagger converts to OpenAPI): https://joi.dev
- Joi-to-OpenAPI conversion rules: https://github.com/hapi-swagger/hapi-swagger/blob/master/usage指南.md