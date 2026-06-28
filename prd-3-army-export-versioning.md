# PRD-3: Roster Import, Approval, & Rule Compliance (v3)

> BullMQ-driven async parsing pipeline, integration with the user's `bs-roster-parser` Python library, and a configurable rule engine that CMs and crusade settings can extend.

---

## 1. Goals

Get a player from "uploaded JSON" to "RosterDraft ready for review" in under 30 seconds. Surface the diff vs. the last approved roster to the player first. Run a configurable rule-check engine on every draft and gate submission by an approved roster.

**Success metrics:**
- 90% of NR-shaped JSON imports parse and produce a draft without manual fixup
- 85% of submitted drafts pass CM approval on first review
- Parse pipeline p95 latency: < 30s

---

## 2. The Roster State Machine

```
                        ┌──────────────────────┐
                        │   (no Roster yet)    │
                        └──────────┬───────────┘
                                   │ player uploads JSON
                                   ▼
                        ┌──────────────────────┐
                        │  RosterDraft         │
                        │  status: 'parsing'   │   (BullMQ job running)
                        └──────────┬───────────┘
                          parse OK │  parse fail
                                   ▼                  ▼
                        ┌──────────────────────┐  ┌─────────────────────┐
                        │  RosterDraft         │  │  RosterDraft         │
                        │  status:             │  │  status: 'failed'    │
                        │  'pending_review'    │  │  with parse error    │
                        └──────────┬───────────┘  └─────────────────────┘
                          ack by   │
                          player   │   player submits for approval
                                   ▼
                        ┌──────────────────────┐
                        │  RosterDraft         │
                        │  status:             │
                        │  'pending_approval'  │
                        └──────────┬───────────┘
                          approved │  rejected
                          by CM    │
                                   ▼                  ▼
                        ┌──────────────────────┐  ┌─────────────────────┐
                        │  RosterApproved      │  │  RosterDraft         │
                        │  (immutable)         │  │  status: 'rejected'  │
                        │  becomes "active"    │  │  with CM feedback    │
                        └──────────────────────┘  └─────────────────────┘
```

**Hard rule**: a player can only file a battle update, requisition, or any other event (PRD-4) if the most recent state of their Roster is `RosterApproved` at the relevant timestamp.

---

## 3. The Parser Integration Contract

The user's existing `bs-roster-parser` Python library does BattleScribe / New Recruit JSON parsing. We invoke it as a subprocess from a Node/TS worker. The contract is the boundary.

### 3.1 What's in scope of the Python parser

`bs-roster-parser` produces a `RosterSummary` (per its README) with:
- `roster_name`, `game_system`, `points_limit`, `faction`
- `units[]` — each with `name`, `type`, `pts`, `cp`, `model_count`, `breakdown[]` (per-variant with weapons)
- Aggregate totals: `total_pts`, `total_cp`, `unit_count`, `total_models`

### 3.2 What the app must parse separately (Python parser gaps)

The parser does **not** currently extract:
- Crusade state from `Order of Battle` (Supply Limit, Battle Tally, Victories, alignment, etc.)
- Requisitions already purchased (in the Nachmund example: Logistics Points, Surplus/Deficiency entries)
- Unit-level honours / scars / rank / XP
- Custom unit names that come from BSApp `customName` (parser handles this, but other NR-specific fields may not be)

These are parsed by a **TypeScript pass** over the raw JSON (in the worker, after the Python parser returns). This pass is a separate module (`app-side-parser.ts`) and is testable independently of the Python subprocess.

### 3.3 The contract

**Input** (worker → Python subprocess):
- Stdin: the raw roster JSON string
- Or argv: `--file <path>` for large rosters (worker writes to a temp file)

**Output** (Python → worker stdout):
- Single JSON object, schema = `RosterSummary.to_dict()` (already supported)
- On parse error: non-zero exit code + stderr containing the error message

**Invocation pattern** (in the worker, pseudo-TS):
```ts
import { spawn } from 'node:child_process';

async function parseRoster(rawJson: string): Promise<RosterSummary> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python', ['-m', 'bs_roster_parser'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => stdout += d);
    proc.stderr.on('data', (d) => stderr += d);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`parser exit ${code}: ${stderr}`));
      resolve(JSON.parse(stdout));
    });
    proc.stdin.write(rawJson);
    proc.stdin.end();
  });
}
```

The worker then runs `app-side-parser.ts` on the same raw JSON to fill the gaps, and merges the two outputs.

### 3.4 Deployment

The worker container must have:
- Node 22 + the worker code
- Python 3.10+ in the same image
- The `bs-roster-parser` package installed (`pip install git+https://git.damascusfront.net/kaykayyali/bs-roster-parser.git`)

Or, alternatively, a separate Python image with the parser installed, called via HTTP from the worker. Subprocess is simpler; promote to sidecar if parse latency becomes a bottleneck.

---

## 4. The BullMQ Pipeline (DETAILED)

### 4.1 Job types

| Job | Trigger | Inputs | Outputs |
|-----|---------|--------|---------|
| `parse-job` | Player uploads JSON, or new draft from manual edit | `rosterId`, `draftId`, `blobId` (MinIO) | Writes `RosterDraft.parserOutputJson` + `appParseOutputJson`; updates status |
| `diff-job` | After `parse-job` succeeds | `draftId` | Writes `Delta[]` records into the draft's diff summary |
| `rule-check-job` | After `diff-job` succeeds | `draftId` | Writes `RuleCheck[]` records; updates `RosterDraft.status` |
| `notification-job` | Status change requiring user-visible event | `userId`, `kind`, `payload` | Sends in-app toast + email |
| `wahapedia-refresh-job` | Nightly cron | n/a | Updates cached CSVs, emits `system.errata_applied` events for affected units |

### 4.2 Failure handling

- Each job has a max attempt count (default 3) with exponential backoff
- On final failure: `RosterDraft.status = 'failed'`, `parseError` field populated, user notified with retry option
- The blob in MinIO is the source of truth — any job can be re-queued by the player ("retry import") without re-uploading

### 4.3 Throughput

- One worker process handles one parse at a time (Python subprocess is synchronous)
- For higher throughput, run multiple worker containers
- Backpressure: BullMQ concurrency limit per worker (default 4) prevents OOM

---

## 5. The App-Side Parser (TypeScript)

Fills the gaps the Python parser leaves:

```ts
interface AppParseOutput {
  crusadeState: {
    supplement: string;             // e.g. 'Nachmund Gauntlet', 'Armageddon'
    supplyLimit?: number;
    logisticsPoints?: number;
    battleTally: number;
    victories: number;
    alignment?: 'guardians' | 'despoilers' | 'marauders';
    requisitionsPurchased: RequisitionRef[];
  };
  unitMetadata: {
    [bsEntryId: string]: {
      customName?: string;
      rank?: 'Blooded' | 'Battle-ready' | 'Battle-hardened' | 'Heroic' | 'Legendary';
      xp?: number;
      honours: string[];
      scars: string[];
    };
  };
  warnings: string[];                  // e.g. "Order of Battle node 'X' not recognized"
}
```

Implementation: walk the same `roster.forces[0].selections` tree that the Python parser walks, but focus on the `Order of Battle` subtree and the `unit.upgrades` tree (which holds honours/scars). This is a relatively shallow walk; no fancy recursion needed.

---

## 6. The Rule Engine (CONFIGURABLE)

### 6.1 Architecture

A rule is a TypeScript module implementing this interface:

```ts
interface RuleDefinition {
  id: string;                          // stable identifier
  ruleKey: string;                      // e.g. 'point-cap', 'faction-lock', 'unit-provenance'
  name: string;                         // display name
  description: string;                  // shown to player/CM
  defaultConfig: Record<string, any>;
  configSchema?: JSONSchema;            // for CM UI to render config form
  appliesTo: 'roster' | 'unit' | 'crusade';
  evaluate: (input: RuleInput, config: RuleConfig) => RuleResult;
}

interface RuleInput {
  draft: RosterDraft;
  previousApproved: RosterApproved | null;
  campaign: Campaign;
  crusadeState: CrusadeForceState;
  delta: Delta[];
}

interface RuleResult {
  status: 'pass' | 'warn' | 'fail';
  details?: string;                    // human-readable
  context?: Record<string, any>;       // for UI
}
```

### 6.2 Built-in rules (v1 ship list)

| Rule key | Default severity | Description |
|----------|------------------|-------------|
| `point-cap` | fail | Roster total > `campaign.point_cap` |
| `faction-lock` | fail | Unit has a faction keyword not in player's faction |
| `unit-cap-universal` | warn | More than 3 of the same datasheet (universal Crusade rule) |
| `unit-provenance` | warn | Unit in roster not in prior RosterApproved AND no requisition event since |
| `wargear-legality` | warn | Wargear option not in matching datasheet's Wahapedia options |
| `legends-unit` | warn | Unit flagged as Legend in Wahapedia |
| `removed-unit` | warn | Unit in prior approved but not in new draft (could be intentional) |
| `honour-provenance` | warn | New honour in draft not earned via prior approved event |
| `xp-consistency` | fail | Unit XP/rank in draft doesn't match what prior events would produce |

### 6.3 Configurable rules (per-CM, per-crusade)

A rule can be **instantiated** with custom config at three scopes:
- `builtin` — system default, applies to all campaigns
- `cm` — a CM defines it for one of their campaigns (e.g., "max 2 units of any one type")
- `crusade` — the campaign's supplement defines it (e.g., Nachmund's Logistics Points constraints)

The user said: "These rules need to also be configurable later by the cm and by crusade." So the data model must support:
- A CM creating a new rule instance with a config
- The campaign settings referencing rule instances to apply
- A future crusade supplement shipping new built-in rules that auto-attach when a campaign is created with that supplement

**Storage** (PRD-0 shared model):
```ts
RuleDefinition {
  id, tenantId,
  scope: 'builtin' | 'cm' | 'crusade',
  authorUserId?,           // null for builtin
  campaignId?,             // null for builtin or system-wide cm rules
  ruleKey,                 // matches a built-in ruleKey
  config,                  // JSON; merged with builtin defaults
  enabled,
  severity,                // override default severity per-instance
  createdAt,
}
```

**Evaluation order**: builtin rules → crusade rules (if supplement ships them) → CM rules (per-campaign). The campaign's `enabledRuleIds` list is the final gate; nothing outside the enabled set is evaluated.

### 6.4 UI for CM rule editing (v1 IN SCOPE)

CM-definable rules ship in v1. **Built-in rule types only** for v1; no custom DSL or sandboxed JS. Same data model + engine; the UI is the v1 addition.

**v1 built-in rule types (the "rule pack gallery"):**

| Type | Description | Config fields |
|------|-------------|---------------|
| `max-n-of-type` | No more than N units with the same canonical name | `n: integer` |
| `max-x-pct-of-role` | Role can have at most X% of total points | `role: enum(HQ, Troops, Elites, Fast Attack, Heavy Support, Flyer, Dedicated Transport)`, `max_pct: number 0-100` |
| `max-points-per-unit` | Any single unit can be at most N points | `n: integer` |
| `wargear-restriction` | Wargear only allowed in specific unit names | `wargear: string`, `allowed_in: string[]` (unit names) |
| `unit-whitelist` | Only these units may be in the roster | `units: string[]` (catalog names) |
| `unit-blacklist` | These units may not be in the roster | `units: string[]` (catalog names) |
| `custom-name-pattern` | Custom unit names must match a regex | `pattern: string` (regex), `flags: string` (e.g. 'i') |
| `total-xp-cap` | No unit may have more than N XP at approval time | `n: integer` |
| `crusade-rp-floor` | Player must have at least N RP at approval time | `n: integer` |
| `team-narrative-alignment` | Roster's 40K faction should fit the team's narrative (per `CampaignTeam.expectedFactionIds`); **warn only — never fail**. The CM has final approval on roster fit (PRD-1 §5b). | `expected_faction_ids: string[]` (auto-populated from the team's `expectedFactionIds`, editable per-rule-instance) |

**Adding a custom rule (CM flow):**

```mermaid
flowchart TD
    A[CM opens Campaign Settings → Rules tab] --> B[Click 'Add Rule']
    B --> C[Pick rule type from gallery]
    C --> D[Fill config form auto-generated from configSchema]
    D --> E[Live preview: 'this will check 12 units in the current approved roster']
    E --> F[Test against last RosterApproved: shows pass/warn/fail breakdown]
    F --> G{Accept test result?}
    G -->|No| H[Tweak config]
    H --> D
    G -->|Yes| I[Name + describe the rule]
    I --> J[Set severity: pass / warn / fail]
    J --> K[Save]
    K --> L[Rule attached to campaign; runs on every new RosterDraft]
```

**UI requirements:**

- The rule gallery shows each type with a one-line description and a sample config (so CMs understand what they're picking without reading docs)
- The config form is auto-generated from `configSchema` (JSON Schema → form fields) — same engine regardless of which rule type
- Live preview shows the count of units/changes the rule will inspect against the most recent `RosterApproved` ("this rule would inspect 12 units, 1 requisition")
- Test mode runs the rule against the actual current data and shows the result without persisting — so CMs can iterate without affecting players
- Naming + describing is required (the rule shows up in the player's rule check report; needs a human-readable name)
- Severity override is per-instance (the rule's default severity comes from its pack, but a CM can dial it up or down per their campaign)
- Drag-to-reorder rules in the campaign's rule list (order matters when multiple rules produce different verdicts on the same data)

**Where the rule-builder UI lives:**

- PRD-1 (CM dashboard): new "Rules" tab in Campaign Settings
- The rule pack gallery is also accessible from the Roster Approval detail view (CM can add a rule on the fly while reviewing a roster that triggered no rule but they want to enforce going forward)

**Future (v2+):** custom rule logic via a sandboxed JS expression language, or uploaded rule packs. Data model and engine already support it (the `RuleDefinition` could carry an `expression` field); v1 just doesn't expose it.

---

## 7. The Diff (Player-First)

The diff is **for the player, not just the CM**. The player must explicitly review and acknowledge it before submitting for approval.

| Change | Visualization |
|--------|--------------|
| Unit added | Green left-arrow in unified, full row in side-by-side |
| Unit removed | Red right-arrow in unified, full row in side-by-side |
| Wargear swapped | Yellow highlight on changed field |
| Crusade state changed (RP, supply limit, etc.) | Inline numeric delta |
| Honours/scars added | Inline with reason "earned via Battle #X" or "unearned — CM override needed" |
| Stats changed (after Wahapedia refresh) | Blue info icon with timestamp |

The diff is two layers:
1. **Structural diff** — units and wargear
2. **Crusade diff** — XP, ranks, honours, scars, requisitions, supply limit

### 7.1 Diff implementation

The diff runs in the worker (TS) against two `RosterSummary` objects + the `AppParseOutput`:

```ts
function diffRosters(prev: RosterSummary | null, next: RosterSummary, prevApp: AppParseOutput | null, nextApp: AppParseOutput): Delta[] {
  const deltas: Delta[] = [];
  // ... unit-level match by canonical name or entry id
  // ... wargear-level match per model variant
  // ... crusade state diff (RP, supply, honours, scars)
  return deltas;
}
```

Key detail: unit matching across two rosters must handle:
- Same unit, different number of models (e.g., 5 → 10 Intercessors)
- Custom name changes
- Entry-id changes (e.g., player re-imported a fresh NR list)

Strategy:
1. **By entry id** (most reliable)
2. **By canonical name + faction** (fallback)
3. **Flag unmatched** as separate "added" / "removed" deltas

---

## 8. CM Approval

When the player submits the draft (status: `pending_review` → `pending_approval`), it enters the CM's approval inbox (PRD-5).

CM sees:
- The same diff the player saw
- The full rule-check report
- Player's optional notes
- The currently-active RosterApproved for context
- "Override & approve" option for specific rule-check fails

CM's options:
- **Approve** → creates `RosterApproved`, becomes active, emits `roster.approved` event
- **Reject with feedback** → draft goes to `rejected`, player can edit and resubmit
- **Request changes** → same as reject, with structured change requests
- **Override a specific rule** → marks a `fail` as `pass_with_override` with a reason

---

## 9. Rollback

A CM can roll back a RosterApproval within a configurable window (default 7 days). Rollback inverts the deltas that the rolled-back Roster introduced. Since the Timeline (PRD-4) is the source of truth, the rollback is just a new event in the timeline that says "RosterApproved X is superseded by Y."

For destructive approvals (rare, since approval is mostly additive), rollback requires typed confirmation.

---

## 10. User Flow: First-Time Import

```mermaid
flowchart TD
    A[Player on campaign dashboard] --> B[Click 'Import Roster']
    B --> C[Upload .json file]
    C --> D[Hapi: validate, store blob in MinIO, enqueue parse-job]
    D --> E[Worker: download blob, spawn python parser]
    E --> F[Worker: app-side parse, write RosterDraft.status=pending_review]
    F --> G[Player sees diff + rule check results]
    G --> H{Issues to resolve?}
    H -->|Yes, blocking| I[Player goes back to NR, fixes, re-exports]
    H -->|No or soft warnings| J[Player acknowledges]
    I --> C
    J --> K[Submit for CM approval]
    K --> L[CM reviews per PRD-5]
    L --> M{Approved?}
    M -->|Yes| N[RosterApproved created, becomes active]
    M -->|No| O[Rejected, player can edit and resubmit]
    N --> P[Player can now file battles per PRD-4]
```

---

## 11. Out of Scope

- NR URL fetch / scraping
- Manual unit editing in the UI (JSON import is the canonical path; CMs have an override tool per PRD-1)
- ~~Rule builder UI for CMs (data model + engine ready; UI deferred to v1.x)~~ **MOVED INTO SCOPE for v1: built-in rule types only, see §6.4**
- Custom DSL or sandboxed JS for rule logic (data model supports; v2+)
- Diff in real-time while player edits (diff runs at parse-job time only)

---

## 12. Dependencies

- **PRD-0**: `Roster`, `RosterDraft`, `RosterApproved`, `CrusadeForceState`, `RuleDefinition`, `RuleCheck`
- **PRD-4**: every approval creates an event
- **PRD-5**: approval workflow consumes rule-check results
- **`bs-roster-parser`** Python package: must be installed in the worker container
- **BullMQ + Redis**: async job infrastructure
- **Wahapedia CSV cache** (infra): nightly refresh, shared across tenants

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Parse pipeline p95 latency | < 30s |
| First-try approval rate | > 85% |
| Rule-check catch rate | > 95% |
| Wahapedia cross-ref match rate | > 95% (by entry id), > 90% (by name) |
| Parse pipeline throughput | > 30 imports/min/worker |
| Retry-after-failure recovery rate | > 99% (i.e., the parser either succeeds first time or succeeds on retry) |

---

## 14. Edge Cases

1. **Two players share the same NR list URL** (copy-paste mistake): system detects duplicate import blob and prompts to use the existing roster vs. import-as-new.
2. **Import with a custom unit name** ("Brother Tyler's Veterans"): stored as `Unit.customName`; `wahapedia_id` retained for stats lookup.
3. **Import with a Legends / Forge World unit**: stored with `wahapedia_id = null`; rule engine flags `warn`; player acknowledges; CM approves with override.
4. **Corrupt JSON**: parse fails, `RosterDraft.status = 'failed'` with `parseError`. Player sees clear error, can re-upload.
5. **Player imports during a pending approval**: the new draft is staged separately; pending approval refers to the older draft. Drift handled by PRD-5.
6. **CM switches the campaign's `point_cap` after a roster is approved**: existing approved rosters are retroactively checked; if a roster now exceeds the cap, the player is notified and must re-import.
7. **Parser subprocess crashes (OOM, segfault)**: BullMQ job fails; `RosterDraft.status = 'failed'` with stderr in `parseError`; player can retry; no zombie state.
8. **Worker runs on a different host than Hapi**: BullMQ + MinIO + Postgres are all networked services; the worker is a separate container with no special affinity.
