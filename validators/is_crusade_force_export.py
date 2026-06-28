#!/usr/bin/env python3
"""
is_crusade_force_export.py — Detect whether an uploaded JSON file is a New Recruit
"Crusade Force" export.

This script is the reference implementation for the parse-time validation gate
described in PRD-3 §3.0. The same logic must be replicated in the BullMQ worker
(parse-job step 0) so it runs before any blob storage or parser subprocess invocation.

Detection signals (in order of strength):

1. PRIMARY — top-level force name is "Crusade Force"
   Crusade exports have force.name == "Crusade Force" at the top level (this is
   how New Recruit labels its Crusade Force export). Non-Crusade exports have
   force.name == "Army Roster" or other labels.

2. SECONDARY — presence of a sub-force named "Crusade Army" inside the main force
   Crusade exports wrap the actual army in a sub-force named "Crusade Army"
   (which is the musterable subset). Non-Crusade exports don't have this structure.

3. TERTIARY — Crusade rank markers in selection names
   10th edition ranks: "Battle-ready", "Battle-hardened", "Heroic", "Legendary"
   (also "Blooded" for Cadian Shock Troops specific)
   11th edition uses the same rank names per the supplied reference file.

If signals 1 + 2 both fire, it's a Crusade export. Signal 3 alone is suggestive
but not definitive (rank names could appear in custom narrative lists). We
require signals 1 OR 2 to fire for a positive identification; signal 3 alone
returns "uncertain" and lets the human reviewer decide.

Detection has been validated against the four reference files in
validators/nr-exports/:
- haan-crusade-10th.json        → CRUSADE (T'au Empire, 10th ed)
- cadian-67-crusade-10th.json   → CRUSADE (Astra Militarum, 10th ed)
- comp-list-non-crusade.json    → NON-CRUSADE (Astra Militarum comp list, 10th ed)
- cadian-67th-legion-11th-ed.json → CRUSADE (Astra Militarum, 11th ed)

Usage:
    python is_crusade_force_export.py <path-to-json>
    # exit 0 = crusade, 1 = non-crusade, 2 = uncertain, 3 = error

    # Or as a library:
    from is_crusade_force_export import classify_export, Classification
    result = classify_export(json_data)
    if result == Classification.CRUSADE:
        ...
"""

import json
import sys
from enum import Enum
from pathlib import Path
from typing import Any


class Classification(Enum):
    CRUSADE = "crusade"
    NON_CRUSADE = "non_crusade"
    UNCERTAIN = "uncertain"


# Crusade rank markers across editions. Listed separately so we can track which
# edition contributed which marker if we ever need to differentiate 10th vs 11th.
CRUSADE_RANKS_10TH = {
    "Battle-ready",
    "Battle-hardened",
    "Heroic",
    "Legendary",
    # "Blooded" is Cadian-specific (Cadian Shock Troops entry-name suffix) and
    # appears on Crusade exports of that faction. Not present on every Crusade
    # export, so it's a weak signal by itself.
    "Blooded",
}
CRUSADE_RANKS_11TH = {
    "Battle-ready",
    "Battle-hardened",
    "Heroic",
    "Legendary",
}
ALL_CRUSADE_RANKS = CRUSADE_RANKS_10TH | CRUSADE_RANKS_11TH


def _walk_strings(node: Any):
    """Yield every string value in the JSON tree."""
    if isinstance(node, str):
        yield node
    elif isinstance(node, dict):
        for v in node.values():
            yield from _walk_strings(v)
    elif isinstance(node, list):
        for item in node:
            yield from _walk_strings(item)


def _find_rank_markers(json_data: Any) -> set[str]:
    """Return the set of Crusade rank markers found anywhere in the JSON tree."""
    found = set()
    for s in _walk_strings(json_data):
        for rank in ALL_CRUSADE_RANKS:
            if rank in s:
                found.add(rank)
    return found


def classify_export(json_data: Any) -> Classification:
    """
    Classify a parsed JSON object as CRUSADE, NON_CRUSADE, or UNCERTAIN.

    Signals:
    - top_force_name_is_crusade_force: json_data["roster"]["forces"][0]["name"] == "Crusade Force"
    - has_crusade_army_sub_force: any force in forces[].forces[] has name == "Crusade Army"
    - has_crusade_rank_markers: at least one Crusade rank marker (Battle-ready, etc.)

    Decision:
    - top_force_name_is_crusade_force AND has_crusade_army_sub_force -> CRUSADE (high confidence)
    - top_force_name_is_crusade_force OR has_crusade_army_sub_force -> CRUSADE (medium confidence)
    - has_crusade_rank_markers only -> UNCERTAIN (signal too weak alone)
    - none of the above -> NON_CRUSADE
    """
    roster = json_data.get("roster") if isinstance(json_data, dict) else None
    if not isinstance(roster, dict):
        return Classification.UNCERTAIN

    forces = roster.get("forces") or []
    if not forces:
        return Classification.UNCERTAIN

    # Signal 1: top-level force name
    top_force_name = forces[0].get("name") if isinstance(forces[0], dict) else None
    top_force_is_crusade = top_force_name == "Crusade Force"

    # Signal 2: sub-force named "Crusade Army" inside any top-level force
    has_crusade_army_sub = False
    for f in forces:
        if not isinstance(f, dict):
            continue
        sub_forces = f.get("forces") or []
        for sf in sub_forces:
            if isinstance(sf, dict) and sf.get("name") == "Crusade Army":
                has_crusade_army_sub = True
                break
        if has_crusade_army_sub:
            break

    # Signal 3: rank markers anywhere in the tree
    rank_markers = _find_rank_markers(json_data)
    has_rank_markers = bool(rank_markers)

    # Decision
    if (top_force_is_crusade and has_crusade_army_sub) or top_force_is_crusade or has_crusade_army_sub:
        return Classification.CRUSADE
    if has_rank_markers:
        return Classification.UNCERTAIN
    return Classification.NON_CRUSADE


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(f"Usage: {argv[0]} <path-to-json>", file=sys.stderr)
        return 3

    path = Path(argv[1])
    if not path.exists():
        print(f"File not found: {path}", file=sys.stderr)
        return 3

    try:
        with path.open() as f:
            data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        return 3

    result = classify_export(data)
    print(f"{path.name}: {result.value}")
    if result == Classification.UNCERTAIN:
        ranks = _find_rank_markers(data)
        if ranks:
            print(f"  Found Crusade rank markers: {sorted(ranks)}", file=sys.stderr)
        print("  Unable to confirm this is a Crusade Force export.", file=sys.stderr)
        return 2
    if result == Classification.NON_CRUSADE:
        # Per PRD-3 §3.0, the user-facing message for non-Crusade exports
        print(
            "  This doesn't look like a Crusade Force export. In New Recruit, "
            "use the 'Export Crusade Force' option from your Order of Battle screen.",
            file=sys.stderr,
        )
        return 1
    return 0  # CRUSADE


if __name__ == "__main__":
    sys.exit(main(sys.argv))