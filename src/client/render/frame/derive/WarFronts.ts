import type { PlayerState } from "../../types";

/**
 * WarFronts — derive active wars from the all-players attack data the client
 * already mirrors (PlayerState.outgoingAttacks / incomingAttacks).
 *
 * A "war" is a pair of players where at least one side has a live attack
 * against the other. Each war keeps one entry per direction: A→B and B→A are
 * separate attack stacks that can coexist (push and counter-push), and each
 * direction renders its own arrows colored by the attacking player.
 *
 * Pure derivation over the shared PlayerState map — no game state access, so
 * it runs identically live and in tests.
 */

export interface WarDirection {
  /** Attacker smallID (arrow color source). */
  attackerID: number;
  /** Defender smallID. 0 = terra nullius. */
  targetID: number;
  /** Attack ids in this direction (one arrow cluster each). */
  attackIDs: string[];
  /** Total troops currently committed in this direction. */
  troops: number;
  /** True when every attack in this direction is retreating. */
  retreating: boolean;
}

export interface War {
  /** Sorted smallID pair (min, max) identifying the war. */
  a: number;
  b: number;
  /** A→B direction, absent when only B→A is active. */
  ab: WarDirection | null;
  /** B→A direction, absent when only A→B is active. */
  ba: WarDirection | null;
}

/** Key for the small war cache: ordered smallID pair. */
function warKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Aggregate all live attacks into wars. Reads every player's
 * outgoingAttacks (incomingAttacks is the same attacks seen from the other
 * side, so scanning outgoing only covers everything exactly once).
 *
 * @param players smallID → PlayerState (the renderer's shared map)
 * @param includeFn optional filter; return false to drop a war entirely
 *   (used by the "only my wars" toggle).
 */
export function extractWars(
  players: ReadonlyMap<number, PlayerState>,
  includeFn?: (war: War) => boolean,
): War[] {
  const wars = new Map<string, War>();

  for (const ps of players.values()) {
    if (!ps.isAlive) continue;
    for (const atk of ps.outgoingAttacks) {
      if (ps.smallID === atk.targetID) continue;
      const key = warKey(ps.smallID, atk.targetID);
      let war = wars.get(key);
      if (war === undefined) {
        const a = Math.min(ps.smallID, atk.targetID);
        const b = Math.max(ps.smallID, atk.targetID);
        war = { a, b, ab: null, ba: null };
        wars.set(key, war);
      }
      // Direction: attacker→target. `ab` means a→b using the sorted pair.
      const dir: WarDirection =
        war.a === ps.smallID
          ? (war.ab ??= newDirection(ps.smallID, atk.targetID))
          : (war.ba ??= newDirection(ps.smallID, atk.targetID));
      dir.attackIDs.push(atk.id);
      dir.troops += atk.troops;
      if (!atk.retreating) dir.retreating = false;
    }
  }

  const result: War[] = [];
  for (const war of wars.values()) {
    // Terra-nullius "wars" (land grabs) have one-sided direction only; still
    // wars for arrow purposes.
    if (includeFn && !includeFn(war)) continue;
    result.push(war);
  }
  // Stable order: largest committed troops first.
  result.sort(
    (x, y) =>
      warTroops(y) - warTroops(x) || x.a - y.a || x.b - y.b,
  );
  return result;
}

function newDirection(attackerID: number, targetID: number): WarDirection {
  return {
    attackerID,
    targetID,
    attackIDs: [],
    troops: 0,
    retreating: true,
  };
}

export function warTroops(war: War): number {
  return (war.ab?.troops ?? 0) + (war.ba?.troops ?? 0);
}

/**
 * Does this war involve the local player or one of their allies/teammates?
 * (The "only my wars" filter.) `allies` is the renderer's friendly set:
 * local player + allies + teammates.
 */
export function warInvolvesFriendly(
  war: War,
  localID: number,
  allies: ReadonlySet<number>,
): boolean {
  if (localID <= 0) return false;
  if (war.a === localID || war.b === localID) return true;
  return (
    (war.a !== 0 && allies.has(war.a)) || (war.b !== 0 && allies.has(war.b))
  );
}

/**
 * Wars where an arrow direction should skip rendering because the whole
 * direction is retreating is handled by the pass (blink); this helper only
 * prunes empty directions for callers building pass input.
 */
export function directionIsActive(dir: WarDirection | null): boolean {
  return dir !== null && dir.attackIDs.length > 0;
}
