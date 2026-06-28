/**
 * isCrusadeForceExport.ts — TypeScript port of the reference Python validator.
 * Used by the BullMQ parse-job worker as step 0 (before blob storage and parser
 * subprocess invocation). See PRD-3 §3.0 for the contract.
 *
 * Reference Python implementation: validators/is_crusade_force_export.py
 *
 * Detection signals (in order of strength):
 * 1. PRIMARY — top-level force.name === "Crusade Force" (NR labels Crusade Force
 *    exports this way; non-Crusade exports have force.name === "Army Roster")
 * 2. SECONDARY — any sub-force (force.forces[].name) === "Crusade Army"
 * 3. TERTIARY — Crusade rank markers in selection names (Battle-ready,
 *    Battle-hardened, Heroic, Legendary, Blooded) — suggestive but weak alone
 *
 * Decision:
 * - signals 1 OR 2 fire → CRUSADE
 * - signal 3 only → UNCERTAIN (let human reviewer decide)
 * - none → NON_CRUSADE
 *
 * Validated against validators/nr-exports/ (4 reference files).
 */

export enum Classification {
  CRUSADE = 'crusade',
  NON_CRUSADE = 'non_crusade',
  UNCERTAIN = 'uncertain',
}

const CRUSADE_RANKS = new Set([
  'Battle-ready',
  'Battle-hardened',
  'Heroic',
  'Legendary',
  // 'Blooded' is Cadian-specific (Cadian Shock Troops entry-name suffix).
  // Not on every Crusade export, so weak signal alone.
  'Blooded',
]);

export interface RosterExport {
  roster?: {
    forces?: Array<{
      name?: string;
      forces?: Array<{ name?: string }>;
    }>;
  };
}

function* walkStrings(node: unknown): Generator<string> {
  if (typeof node === 'string') {
    yield node;
  } else if (Array.isArray(node)) {
    for (const item of node) yield* walkStrings(item);
  } else if (node && typeof node === 'object') {
    for (const v of Object.values(node)) yield* walkStrings(v);
  }
}

function findRankMarkers(json: unknown): Set<string> {
  const found = new Set<string>();
  for (const s of walkStrings(json)) {
    for (const rank of CRUSADE_RANKS) {
      if (s.includes(rank)) found.add(rank);
    }
  }
  return found;
}

/**
 * Classify a parsed JSON object as CRUSADE, NON_CRUSADE, or UNCERTAIN.
 * Throws TypeError if the input doesn't have the expected shape.
 */
export function classifyExport(json: unknown): Classification {
  const data = json as RosterExport;
  const roster = data?.roster;
  if (!roster || typeof roster !== 'object') return Classification.UNCERTAIN;

  const forces = roster.forces ?? [];
  if (forces.length === 0) return Classification.UNCERTAIN;

  // Signal 1: top-level force name === "Crusade Force"
  const topForceName = forces[0]?.name;
  const topForceIsCrusade = topForceName === 'Crusade Force';

  // Signal 2: any sub-force named "Crusade Army"
  let hasCrusadeArmySub = false;
  for (const f of forces) {
    const subs = f?.forces ?? [];
    for (const sf of subs) {
      if (sf?.name === 'Crusade Army') {
        hasCrusadeArmySub = true;
        break;
      }
    }
    if (hasCrusadeArmySub) break;
  }

  // Signal 3: rank markers anywhere in the tree
  const rankMarkers = findRankMarkers(json);
  const hasRankMarkers = rankMarkers.size > 0;

  if (topForceIsCrusade || hasCrusadeArmySub) {
    return Classification.CRUSADE;
  }
  if (hasRankMarkers) {
    return Classification.UNCERTAIN;
  }
  return Classification.NON_CRUSADE;
}

/**
 * User-facing error message when classification is NON_CRUSADE or UNCERTAIN.
 * Per PRD-3 §3.0.
 */
export const NON_CRUSADE_ERROR_MESSAGE =
  "This doesn't look like a Crusade Force export. In New Recruit, use the 'Export Crusade Force' option from your Order of Battle screen.";

/**
 * Convenience wrapper for the parse-job worker. Throws an error with a
 * parseError code if the upload isn't a Crusade Force export.
 */
export function assertCrusadeForceExport(json: unknown): void {
  const result = classifyExport(json);
  if (result === Classification.CRUSADE) return;

  const err = new Error(NON_CRUSADE_ERROR_MESSAGE) as Error & { parseError?: string };
  err.parseError = 'NOT_CRUSADE_FORCE_EXPORT';
  throw err;
}