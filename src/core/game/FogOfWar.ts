import type { StampedIntent } from "../Schemas";
import { Game, Nukes, Player, PlayerType, Structures, UnitType } from "./Game";
import { fogAmbientBrightness, fogHasGlobalVision } from "./GamePhases";

export interface FogState {
  brightness: Uint8Array;
  countries: ReadonlySet<number>;
}

export const FOG_UNIT_RADIUS = 48;
export const FOG_NUCLEAR_RADIUS = 6;

/** Capped area bands avoid giving large nations linearly growing vision. */
export function territoryVisionRadius(area: number): number {
  return area >= 200_000 ? 40 : area >= 50_000 ? 32 : area >= 10_000 ? 24 : 16;
}

const falloffs = new Map<string, Uint8Array>();

// Fields and observers are computed synchronously. Retain one workspace, rather
// than one map-sized allocation per field (or every previously loaded map).
let distanceScratch: Uint16Array | Int32Array = new Uint16Array(0);
let rowScratch = new Uint8Array(0);
let columnScratch = new Uint8Array(0);
let positionScratch = new Int32Array(0);
let startScratch = new Int32Array(0);

function visionScratch(width: number, height: number, limit: number) {
  const wide = limit > 0xffff;
  if (
    distanceScratch.length !== width * height ||
    wide !== distanceScratch instanceof Int32Array
  ) {
    distanceScratch = wide
      ? new Int32Array(width * height)
      : new Uint16Array(width * height);
  }
  if (rowScratch.length !== height) {
    rowScratch = new Uint8Array(height);
    positionScratch = new Int32Array(height);
    startScratch = new Int32Array(height);
  }
  if (columnScratch.length !== width) columnScratch = new Uint8Array(width);
  distanceScratch.fill(limit);
  rowScratch.fill(0);
  columnScratch.fill(0);
  return {
    distance: distanceScratch,
    rows: rowScratch,
    columns: columnScratch,
    positions: positionScratch,
    starts: startScratch,
  };
}

/** Fractional distance is fixed-point; simulation never depends on floating sqrt. */
function radialFalloff(level: number, radius: number): Uint8Array {
  const key = `${level}:${radius}`;
  const cached = falloffs.get(key);
  if (cached) return cached;
  const values = new Uint8Array(radius * radius + 1);
  const fixedRadius = radius * 256;
  for (let squared = 0; squared < radius * radius; squared++) {
    let lo = 0,
      hi = fixedRadius;
    const target = squared * 65536;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      if (mid * mid <= target) lo = mid + 1;
      else hi = mid - 1;
    }
    values[squared] = Math.ceil((level * (fixedRadius - hi)) / fixedRadius);
  }
  falloffs.set(key, values);
  return values;
}

/** Exact squared Euclidean distance transform: circular, terrain-independent vision.
 * Horizontal nearest seeds followed by the lower envelope of vertical parabolas.
 * Linear in map size, independent of the number of overlapping sources.
 */
export function addVisionField(
  out: Uint8Array,
  width: number,
  height: number,
  seeds: Iterable<number>,
  level: number,
  radius: number,
): void {
  const seedList = Array.from(seeds);
  if (!seedList.length) return;
  if (radius === 0) {
    for (const tile of seedList)
      if (tile >= 0 && tile < out.length)
        out[tile] = Math.max(out[tile], level);
    return;
  }
  const limit = radius * radius;
  const { distance, rows, columns, positions, starts } = visionScratch(
    width,
    height,
    limit,
  );
  for (const tile of seedList) {
    if (tile < 0 || tile >= out.length) continue;
    distance[tile] = 0;
    rows[Math.floor(tile / width)] = 1;
  }
  for (let y = 0; y < height; y++) {
    if (!rows[y]) continue;
    const row = y * width;
    let nearest = -radius;
    for (let x = 0; x < width; x++) {
      if (distance[row + x] === 0) nearest = x;
      else distance[row + x] = Math.min(limit, (x - nearest) * (x - nearest));
    }
    nearest = width + radius;
    for (let x = width - 1; x >= 0; x--) {
      if (distance[row + x] === 0) nearest = x;
      else
        distance[row + x] = Math.min(
          distance[row + x],
          (nearest - x) * (nearest - x),
        );
      if (distance[row + x] < limit) columns[x] = 1;
    }
  }
  const falloff = radialFalloff(level, radius);
  for (let x = 0; x < width; x++) {
    if (!columns[x]) continue;
    let last = -1;
    for (let q = 0; q < height; q++) {
      const value = distance[q * width + x];
      if (value >= limit) continue;
      let start = 0;
      while (last >= 0) {
        const previous = positions[last];
        // First integer row where q's parabola is strictly better.
        start =
          Math.floor(
            (value +
              q * q -
              distance[previous * width + x] -
              previous * previous) /
              (2 * (q - previous)),
          ) + 1;
        if (start > starts[last]) break;
        last--;
      }
      if (last < 0) start = 0;
      if (start >= height) continue;
      positions[++last] = q;
      starts[last] = start;
    }
    let selected = 0;
    for (let y = 0; y < height; y++) {
      while (selected < last && starts[selected + 1] <= y) selected++;
      const dy = y - positions[selected];
      const squared = dy * dy + distance[positions[selected] * width + x];
      if (squared < limit) {
        const tile = y * width + x;
        out[tile] = Math.max(out[tile], falloff[squared]);
      }
    }
  }
}

/** Only each direct friend's own sources are combined: sharing is not transitive. */
export function computeFog(game: Game, observer: Player): FogState {
  const brightness = new Uint8Array(game.width() * game.height());
  const ambient = game.config().fogOfWar()
    ? fogAmbientBrightness(game.elapsedGameSeconds())
    : 0;
  const globalVision =
    ambient > 0 && fogHasGlobalVision(game.elapsedGameSeconds());
  // Below the information threshold ambient light is presentation-only. Keeping
  // zero here preserves every existing input, HUD and unit-visibility gate.
  if (globalVision) brightness.fill(ambient);
  const friends = game
    .players()
    .filter(
      (p) =>
        p === observer || observer.isOnSameTeam(p) || observer.isAlliedWith(p),
    );
  const groups = new Map<number, number[]>();
  const unitSeeds: number[] = [];
  const expeditionSeeds: number[] = [];
  for (const p of friends) {
    const radius = territoryVisionRadius(p.numTilesOwned());
    let seeds = groups.get(radius);
    if (!seeds) groups.set(radius, (seeds = []));
    for (const tile of p.tiles()) {
      brightness[tile] = Math.max(brightness[tile], 10);
    }
    for (const tile of p.borderTiles()) seeds.push(tile);
    for (const unit of p.units()) {
      if (!unit.isActive()) continue;
      if (unit.type() === UnitType.ExpeditionShip)
        expeditionSeeds.push(unit.tile());
      if (
        (Structures.has(unit.type()) && !unit.isUnderConstruction()) ||
        unit.type() === UnitType.Warship
      ) {
        unitSeeds.push(unit.tile());
      }
    }
  }
  // A surveying vessel shares local sight with countries whose land it sees.
  // Use the actual stop, not the requested (possibly unreachable) destination.
  const hosts = new Set(friends.map((p) => p.smallID()));
  const visitingOwners = new Set<number>();
  for (const p of game.players()) {
    if (hosts.has(p.smallID())) continue;
    for (const ship of p.units(UnitType.ExpeditionShip)) {
      if (!ship.isActive() || ship.expeditionState()?.phase !== "surveying")
        continue;
      const sx = game.x(ship.tile()),
        sy = game.y(ship.tile());
      let shared = false;
      for (
        let y = Math.max(0, sy - FOG_UNIT_RADIUS + 1);
        y < Math.min(game.height(), sy + FOG_UNIT_RADIUS) && !shared;
        y++
      ) {
        for (
          let x = Math.max(0, sx - FOG_UNIT_RADIUS + 1);
          x < Math.min(game.width(), sx + FOG_UNIT_RADIUS);
          x++
        ) {
          if ((x - sx) ** 2 + (y - sy) ** 2 >= FOG_UNIT_RADIUS ** 2) continue;
          const tile = game.ref(x, y);
          if (!game.isLand(tile)) continue;
          const owner = game.owner(tile);
          if (owner.isPlayer() && hosts.has(owner.smallID())) {
            shared = true;
            break;
          }
        }
      }
      if (shared) {
        expeditionSeeds.push(ship.tile());
        visitingOwners.add(p.smallID());
      }
    }
  }
  for (const [radius, seeds] of groups) {
    addVisionField(brightness, game.width(), game.height(), seeds, 10, radius);
  }
  addVisionField(
    brightness,
    game.width(),
    game.height(),
    expeditionSeeds,
    10,
    FOG_UNIT_RADIUS,
  );
  addVisionField(
    brightness,
    game.width(),
    game.height(),
    unitSeeds,
    16,
    FOG_UNIT_RADIUS,
  );
  addVisionField(
    brightness,
    game.width(),
    game.height(),
    [...game.nuclearFogSources()]
      .filter(([, expires]) => expires > game.ticks())
      .map(([tile]) => tile),
    16,
    FOG_NUCLEAR_RADIUS,
  );
  // Friendly moving units remain locatable even outside land/warship vision.
  for (const p of friends)
    for (const u of p.units()) {
      if (
        u.isActive() &&
        (u.type() === UnitType.TransportShip || u.type() === UnitType.TradeShip)
      )
        brightness[u.tile()] = 16;
    }
  const countries = new Set<number>([...hosts, ...visitingOwners]);
  if (globalVision) {
    for (const p of game.players()) countries.add(p.smallID());
    return { brightness, countries };
  }
  for (let tile = 0; tile < brightness.length; tile++) {
    if (brightness[tile] === 0) continue;
    const owner = game.owner(tile);
    if (owner.isPlayer()) countries.add(owner.smallID());
  }
  return { brightness, countries };
}

const cache = new WeakMap<
  Game,
  { tick: number; observers: Map<string, FogState> }
>();
export function fogFor(
  game: Game,
  observer: Player,
  refresh = false,
): FogState | null {
  if (
    !game.config().fogOfWar() ||
    game.inSpawnPhase() ||
    !observer.hasSpawned() ||
    !observer.isAlive()
  )
    return null;
  let entry = cache.get(game);
  if (!entry || entry.tick !== game.ticks()) {
    entry = { tick: game.ticks(), observers: new Map() };
    cache.set(game, entry);
  }
  let fog = entry.observers.get(observer.id());
  if (!fog || refresh) {
    fog = computeFog(game, observer);
    entry.observers.set(observer.id(), fog);
  }
  return fog;
}

/** Applied only to human wire intents; AI executions keep their current policy. */
export function fogAllowsIntent(
  game: Game,
  player: Player,
  intent: StampedIntent,
): boolean {
  if (player.type() !== PlayerType.Human) return true;
  const fog = fogFor(game, player);
  if (!fog) return true;
  const visible = (tile: number) =>
    tile >= 0 && tile < fog.brightness.length && fog.brightness[tile] > 0;
  if (intent.type === "expedition") return true; // Core execution validates port and mode; destinations may be hidden.
  if (intent.type === "build_unit")
    return Nukes.has(intent.unit) || visible(intent.tile);
  if (intent.type === "boat") return visible(intent.dst);
  // Coordinates used solely to move our own fleet may be unknown.
  if (intent.type === "move_warship") return true;
  if (intent.type === "attack") {
    if (intent.targetID !== null && !game.hasPlayer(intent.targetID))
      return false;
    const target =
      intent.targetID === null
        ? game.terraNullius()
        : game.player(intent.targetID);
    // A land attack is legal only when there is a visible shared front.
    for (const tile of player.borderTiles()) {
      for (const n of game.neighbors(tile)) {
        if (visible(n) && game.owner(n) === target) return true;
      }
    }
    return false;
  }
  const targetID =
    "recipient" in intent
      ? intent.recipient
      : "target" in intent
        ? intent.target
        : "requestor" in intent
          ? intent.requestor
          : null;
  if (typeof targetID === "string" && targetID !== "AllPlayers") {
    if (!game.hasPlayer(targetID)) return false;
    const target = game.player(targetID);
    return (
      target &&
      (target === player ||
        player.isFriendly(target) ||
        fog.countries.has(target.smallID()))
    );
  }
  return true;
}
