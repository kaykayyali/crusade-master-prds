# PRD-5: Approval System (v2)

> Unified approval pipeline. v2 adds `roster_approval` as a first-class kind and ties every approval to the rule-compliance engine output.

---

## 1. Goals

One consistent pipeline for every approval-worthy action. The CM's inbox is the single view of "what needs my attention." Approvals are fast, auditable, and reversible.

**Success metric**: 95% of approval decisions made within 24 hours of submission.

---

## 2. Approval-Routed Actions

| Action | Approval required? | Approver | Auto-apply on approval? |
|--------|--------------------|----------|-------------------------|
| Player imports RosterDraft | No (player self-serves draft creation) | n/a | n/a — draft becomes `pending_review` |
| Player acknowledges rule-check issues | No (player self-serves acknowledgment) | n/a | n/a — draft becomes `pending_approval` |
| **Player submits RosterDraft for approval** | **Yes** | CM (or co-CM) | Yes — creates RosterApproved |
| Player files post-battle update | Yes | CM | Yes — applies events |
| Player files manual roster edit | Yes | CM | Yes |
| Player purchases Requisition | Yes | CM | Yes |
| Player requests roster revert | Yes | CM | Yes |
| Player switches faction mid-campaign | Yes | CM | Yes |
| CM edits campaign settings | No (CM is authority) | n/a | Yes |
| CM triggers narrative event | No (CM is authority) | n/a | Yes |
| CM rolls back a RosterApproval | No (CM is authority) | n/a | Yes (with audit) |
| CM overrides a rule check | No (CM is authority) | n/a | Yes (with audit) |
| CM grants or strips a co-CM role | No (primary CM only) | n/a | Yes |

A campaign setting `auto_approve_routine_battle_updates: bool` (default false) lets a CM skip approval for battle updates that have no anomalies. Triggers that always require approval:
- An OoA test failed
- A Requisition was purchased
- Honours / scars were added beyond the supplement's universal list
- Manual edits outside NR import
- The submitter is a new account (< 7 days)
- The submitter is the CM themselves (auto-routes to co-CM or self-approves with audit if no co-CM)

---

## 3. ApprovalRequest Schema

```ts
type ApprovalKind =
  | 'roster_approval'                // v2 new — most common kind
  | 'post_battle_update'
  | 'roster_manual_edit'
  | 'requisition_purchase'
  | 'roster_revert'
  | 'faction_switch'
  | 'custom';

interface ApprovalRequest {
  id: string;
  tenantId: string;
  campaignId: string;
  kind: ApprovalKind;
  submittedByUserId: string;
  submittedAt: timestamp;
  payload: Record<string, unknown>;     // kind-specific
  status: 'pending' | 'approved' | 'rejected' | 'changes_requested' | 'withdrawn';
  reviewerUserId: string | null;        // claimed by a CM
  decidedAt: timestamp | null;
  decisionReason: string | null;        // required if rejected or changes_requested
  contextHash: string;                  // hash of current state for drift detection
  ruleCheckIds: string[];               // v2 new — rule checks attached at submission
  activeRosterApprovedId: string | null; // v2 new — gating context
}
```

### 3.1 Per-Kind Payloads

**`roster_approval`** (v2 — most common):
```ts
{
  rosterId: string,
  draftId: string,           // RosterDraft being approved
  previousApprovedId: string | null,
  diffSummary: { added: int, removed: int, wargearChanged: int, crusadeChanged: int },
  ruleCheckIds: string[],
  playerNote: string | null,
}
```

**`post_battle_update`**:
```ts
{
  battleId: string,
  battleUpdateId: string,
  perUnitChanges: ...,
  ruleCheckIds: string[],     // any rule violations
}
```

Other kinds omitted for brevity.

---

## 4. Roster Approval Specifics (v2)

The roster approval flow is the most-used approval. Special handling:

- **CM sees**: the diff, the rule-check report, the player's optional note, the previously active RosterApproved for context
- **CM's options**:
  - **Approve** → creates RosterApproved, becomes active, emits `roster.approved` event
  - **Reject with feedback** → RosterDraft goes to `rejected` with CM notes; player can edit and resubmit (which creates a new RosterDraft)
  - **Request changes** → same as reject, with structured change requests (e.g., "remove the Hellhound — you don't have a Requisition for it")
  - **Override a specific rule** → marks a `fail` as `pass_with_override` with a reason. The override is itself an event (`rule_check.fail_overridden`)

### 4.1 Approval as the Source of Truth

When a roster is approved, the `RosterApproved.snapshot` becomes the canonical state. Future imports diff against this snapshot. The Timeline (PRD-4) records what was approved when.

---

## 5. Inbox UX

```
┌─────────────────────────────────────────────────────┐
│ Inbox                              [Filter ▾] [⚙]  │
├─────────────────────────────────────────────────────┤
│ 7 pending · 0 claimed by you                        │
├─────────────────────────────────────────────────────┤
│ ☐ Roster approval — jake42                          │
│   Submitted 1h ago · Campaign: Aurelian Crusade    │
│   Diff: +2 units, −1 unit, 3 wargear swaps         │
│   Rule checks: 1 warn (Legends unit — needs override)
│   [View Diff] [Approve] [Reject] [Override & Approve] │
├─────────────────────────────────────────────────────┤
│ ☐ Post-battle update — sarah_k vs. mike_t            │
│   Submitted 2h ago · Battle 12                       │
│   Result: W · 1 unit promoted, 1 OoA test           │
│   [View] [Approve] [Reject] [Request Changes]      │
└─────────────────────────────────────────────────────┘
```

- **Filter**: by campaign, kind, submitter, age
- **Sort**: oldest first (FIFO)
- **Claim**: optional — first CM to claim locks the request; another CM can override
- **Bulk actions**: only for `post_battle_update` with no anomalies (per §2 auto-approve rules)

### 5.1 Detail View

Clicking an item opens a side panel:
- Full proposed change with deltas highlighted
- Current state of affected entity
- Submitter's notes
- Recent related events
- For `roster_approval`: full diff view, rule check report
- Quick-approve / quick-reject buttons
- "Open in full view" link

---

## 6. Drift Detection

If the current state has changed since submission (e.g., the player imported a new RosterDraft while approval was pending), the CM sees a "Drift detected" warning. Side-by-side: original proposal vs. recomputed proposal.

Options:
- **Re-validate** — ask the player to resubmit
- **Force-apply** — apply the original intent anyway, with audit log
- **Reject** — reject as stale

---

## 7. Reversibility

Every approved change is reversible within a configurable window (default 7 days, per campaign setting). Rollback creates a new set of events that exactly invert the originals.

For destructive approvals (e.g., RosterApproval that included a unit that no longer has provenance), rollback requires typed confirmation.

---

## 8. Notifications

When a submission's status changes, the submitter is notified:

| Channel | MVP? |
|---------|------|
| In-app (toast + notifications list) | Yes |
| Email | Yes |

---

## 9. Campaign-Level Approval Policies

| Policy | Effect |
|--------|--------|
| `auto_approve_routine_battle_updates: bool` | Auto-approve battle updates with no anomalies (triggers in §2) |
| `auto_approve_first_roster: bool` | First RosterApproved for a player is auto-approved (skip CM for initial onboarding friction); default off |
| `require_battle_report: bool` | Battle updates must include a markdown report ≥ 200 chars; default on |
| `lock_ooa_modifications: bool` | Players cannot manually edit OoA results; must be CM-overridden |
| `require_two_approvals: bool` | Battle updates that destroy units need two CM approvals |
| `override_window_days: int` | Days within which an approval can be rolled back; default 7 |

Each policy enforced at form-submit time and at apply time.

---

## 10. User Flow: Roster Approval

```mermaid
flowchart TD
    A[Player submits RosterDraft] --> B[Create ApprovalRequest kind=roster_approval]
    B --> C[CM sees in inbox]
    C --> D{Decision}
    D -->|Approve| E[Create RosterApproved]
    D -->|Reject| F[Status=rejected with feedback]
    D -->|Override + approve| G[Mark rule check as pass_with_override, then create RosterApproved]
    E --> H[Emit roster.approved event]
    F --> I[Player can edit + resubmit]
    G --> H
    H --> J[Player can now file battles per PRD-4]
```

---

## 11. Out of Scope

- Cross-campaign approvals
- AI auto-adjudication of disputes (future)
- Multi-CM voting / consensus requirements

---

## 12. Dependencies

- **PRD-0**: `ApprovalRequest`, `ApprovalAuditEntry`, `User` (CM role)
- **PRD-1**: CM dashboard inbox link
- **PRD-3**: roster approval is the primary approval kind; rule-check engine output feeds the inbox
- **PRD-4**: every approved action produces events
- **Auth infra**: CM role gating
- **Notifications infra**: in-app + email

---

## 13. Success Metrics

| Metric | Target |
|--------|--------|
| Median time from submission to decision | < 2 hours |
| Inbox clearance rate within 24h | > 95% |
| Drift events detected and handled correctly | 100% |
| Approval rollback rate | < 1% of approvals |
| CM time per approval | < 30s for routine updates |
| Roster approval first-try rate | > 85% |

---

## 14. Edge Cases

1. **Two CMs approve the same request simultaneously**: optimistic locking via `contextHash`; second approver sees "already decided."
2. **Submitter withdraws while a CM has it claimed**: CM sees "withdrawn" banner; request is closed.
3. **Approval is for a now-deleted entity** (e.g., the unit was destroyed in a later update): apply step fails transactionally; CM is shown an error and asked to reject.
4. **CM is the submitter and no co-CM exists**: self-approves with audit-log entry `self_approved: true`. The CM-as-player edge case from PRD-1.
5. **Submitter suspended mid-approval**: pending requests auto-rejected with reason "submitter suspended."
6. **Active RosterApproved changes during approval**: drift detected; CM is shown the new state; choose re-validate, force-apply, or reject.
