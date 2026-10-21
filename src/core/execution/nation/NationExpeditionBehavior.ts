import { canSeeTile, knownPlayers } from "../../game/FogOfWarIntel";
import { Game, Player, UnitType } from "../../game/Game";
import { PseudoRandom } from "../../PseudoRandom";
import { ExpeditionShipExecution } from "../ExpeditionShipExecution";

export interface FogAIState {
  nextNuclearTick: number;
  nextExpeditionTick: number;
  directions: number[];
}
export const initialFogAIState = (): FogAIState => ({
  nextNuclearTick: 0,
  nextExpeditionTick: 0,
  directions: [],
});
const DIRECTIONS = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

/** Target choices use unknown directions, never hidden coasts or country locations. */
export function maybeDispatchExpedition(
  game: Game,
  player: Player,
  random: PseudoRandom,
  state: FogAIState,
): boolean {
  if (
    !game.config().fogOfWar() ||
    game.inSpawnPhase() ||
    !player.isAlive() ||
    game.config().isUnitDisabled(UnitType.ExpeditionShip) ||
    game.ticks() < state.nextExpeditionTick
  )
    return false;
  state.nextExpeditionTick = game.ticks() + 100;
  const ports = player
    .units(UnitType.Port)
    .filter(
      (p) =>
        p.isActive() &&
        !p.isUnderConstruction() &&
        !p.isMarkedForDeletion() &&
        game.neighbors(p.tile()).some((t) => game.isWater(t)),
    );
  if (!ports.length) return false;
  const cost = game.unitInfo(UnitType.ExpeditionShip).cost(game, player);
  // Keep enough gold for defense and construction. Wealthier nations may fund
  // two voyages; this is an AI spending policy, not a unit cap.
  if (player.gold() < cost + 250_000n) return false;
  const voyaging = player
    .units(UnitType.ExpeditionShip)
    .filter((u) => u.expeditionState()?.phase === "sailing").length;
  const budget = player.gold() >= 2_000_000n ? 2 : 1;
  if (voyaging >= budget) return false;
  const underAttack = player.incomingAttacks().length > 0;
  if (underAttack) return false;
  const localEnemy = knownPlayers(game, player).some(
    (p) => p !== player && !player.isFriendly(p) && player.sharesBorderWith(p),
  );
  if (localEnemy && !random.chance(5)) return false;
  const port = random.randElement(ports);
  const distance = Math.max(
    64,
    Math.min(512, Math.floor(Math.max(game.width(), game.height()) / 3)),
  );
  const directions = random
    .shuffleArray(DIRECTIONS.map((_, i) => i))
    .sort(
      (a, b) =>
        Number(state.directions.includes(a)) -
        Number(state.directions.includes(b)),
    );
  for (const direction of directions) {
    const [dx, dy] = DIRECTIONS[direction];
    const x = Math.max(
      0,
      Math.min(game.width() - 1, game.x(port.tile()) + dx * distance),
    );
    const y = Math.max(
      0,
      Math.min(game.height() - 1, game.y(port.tile()) + dy * distance),
    );
    const target = game.ref(x, y);
    if (canSeeTile(game, player, target)) continue;
    game.addExecution(new ExpeditionShipExecution(player, target));
    state.nextExpeditionTick = game.ticks() + 600;
    state.directions.push(direction);
    if (state.directions.length > 4) state.directions.shift();
    return true;
  }
  return false;
}
