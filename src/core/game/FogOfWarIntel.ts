import {
  FOG_NUCLEAR_RADIUS,
  FOG_UNIT_RADIUS,
  territoryVisionRadius,
} from "./FogOfWar";
import { Game, Player, Structures, Unit, UnitType } from "./Game";
import { TileRef } from "./GameMap";

// A sparse spatial index shared by every observer in a simulation tick. AI and
// automatic targeting need boolean sight, not a map-sized brightness texture.
const CELL = 32;
class Grid<T> {
  private cells = new Map<number, T[]>();
  private columns: number;
  constructor(private game: Game) {
    this.columns = Math.ceil(game.width() / CELL);
  }
  add(tile: TileRef, value: T): void {
    const key =
      Math.floor(this.game.y(tile) / CELL) * this.columns +
      Math.floor(this.game.x(tile) / CELL);
    let cell = this.cells.get(key);
    if (!cell) this.cells.set(key, (cell = []));
    cell.push(value);
  }
  *near(tile: TileRef, radius: number): Iterable<T> {
    const x = this.game.x(tile),
      y = this.game.y(tile);
    for (
      let cy = Math.floor(Math.max(0, y - radius) / CELL);
      cy <= Math.floor(Math.min(this.game.height() - 1, y + radius) / CELL);
      cy++
    ) {
      for (
        let cx = Math.floor(Math.max(0, x - radius) / CELL);
        cx <= Math.floor(Math.min(this.game.width() - 1, x + radius) / CELL);
        cx++
      ) {
        yield* this.cells.get(cy * this.columns + cx) ?? [];
      }
    }
  }
}
interface Border {
  tile: TileRef;
  owner: Player;
}
interface Circle {
  tile: TileRef;
  radius: number;
}
interface TickIndex {
  tick: number;
  borders: Grid<Border>;
  ownBorders: Map<number, Grid<TileRef>>;
  observers: Map<number, FogIntel>;
  sources: Unit[];
}
const cache = new WeakMap<Game, TickIndex>();
function indexFor(game: Game): TickIndex {
  let index = cache.get(game);
  if (index?.tick === game.ticks()) return index;
  index = {
    tick: game.ticks(),
    borders: new Grid(game),
    ownBorders: new Map(),
    observers: new Map(),
    sources: [],
  };
  for (const p of game.players()) {
    const own = new Grid<TileRef>(game);
    index.ownBorders.set(p.smallID(), own);
    for (const tile of p.borderTiles()) {
      index.borders.add(tile, { tile, owner: p });
      own.add(tile, tile);
    }
    for (const unit of p.units())
      if (
        unit.isActive() &&
        ((Structures.has(unit.type()) && !unit.isUnderConstruction()) ||
          unit.type() === UnitType.Warship ||
          unit.type() === UnitType.ExpeditionShip ||
          unit.type() === UnitType.TransportShip ||
          unit.type() === UnitType.TradeShip)
      )
        index.sources.push(unit);
  }
  cache.set(game, index);
  return index;
}

export class FogIntel {
  private friends: Map<number, number>;
  private circles: Circle[] = [];
  private points = new Set<TileRef>();
  private visitingOwners = new Set<number>();
  private countries: Set<number> | null = null;
  private tileVisibility = new Map<TileRef, boolean>();
  constructor(
    private game: Game,
    private observer: Player,
    private index: TickIndex,
  ) {
    this.friends = new Map(
      game
        .players()
        .filter(
          (p) =>
            p === observer ||
            observer.isOnSameTeam(p) ||
            observer.isAlliedWith(p),
        )
        .map((p) => [p.smallID(), territoryVisionRadius(p.numTilesOwned())]),
    );
    for (const unit of index.sources) {
      if (this.friends.has(unit.owner().smallID())) {
        if (
          unit.type() === UnitType.TransportShip ||
          unit.type() === UnitType.TradeShip
        )
          this.points.add(unit.tile());
        else this.circles.push({ tile: unit.tile(), radius: FOG_UNIT_RADIUS });
      } else if (
        unit.type() === UnitType.ExpeditionShip &&
        unit.expeditionState()?.phase === "surveying"
      ) {
        const contacts = this.contacts(unit.tile(), FOG_UNIT_RADIUS);
        if ([...contacts].some((id) => this.friends.has(id))) {
          this.circles.push({ tile: unit.tile(), radius: FOG_UNIT_RADIUS });
          this.visitingOwners.add(unit.owner().smallID());
        }
      }
    }
    for (const [tile, expires] of game.nuclearFogSources())
      if (expires > game.ticks())
        this.circles.push({ tile, radius: FOG_NUCLEAR_RADIUS });
  }
  private contacts(
    tile: TileRef,
    radius: number,
    found = new Set<number>(),
  ): Set<number> {
    const owner = this.game.owner(tile);
    if (owner.isPlayer()) found.add(owner.smallID());
    for (const b of this.index.borders.near(tile, radius)) {
      if (
        !found.has(b.owner.smallID()) &&
        this.game.euclideanDistSquared(tile, b.tile) < radius * radius
      )
        found.add(b.owner.smallID());
    }
    return found;
  }
  visible(tile: TileRef): boolean {
    const cached = this.tileVisibility.get(tile);
    if (cached !== undefined) return cached;
    const value = this.visibilityAt(tile);
    this.tileVisibility.set(tile, value);
    return value;
  }
  private visibilityAt(tile: TileRef): boolean {
    if (!this.game.isValidRef(tile)) return false;
    if (this.friends.has(this.game.ownerID(tile)) || this.points.has(tile))
      return true;
    if (
      this.circles.some(
        (c) =>
          this.game.euclideanDistSquared(tile, c.tile) < c.radius * c.radius,
      )
    )
      return true;
    for (const [id, radius] of this.friends) {
      const border = this.index.ownBorders.get(id);
      if (!border) continue;
      for (const source of border.near(tile, radius)) {
        if (this.game.euclideanDistSquared(tile, source) < radius * radius)
          return true;
      }
    }
    return false;
  }
  unitVisible(unit: Unit): boolean {
    return unit.owner() === this.observer || this.visible(unit.tile());
  }
  knows(player: Player): boolean {
    if (!this.countries) {
      this.countries = new Set([
        ...this.friends.keys(),
        ...this.visitingOwners,
      ]);
      for (const c of this.circles)
        for (const id of this.contacts(c.tile, c.radius))
          this.countries.add(id);
      for (const p of this.game.players()) {
        const radius = this.friends.get(p.smallID());
        if (radius === undefined) continue;
        for (const tile of p.borderTiles())
          this.contacts(tile, radius, this.countries);
      }
    }
    return this.countries.has(player.smallID());
  }
}
export function fogIntel(game: Game, observer: Player): FogIntel {
  const index = indexFor(game);
  let intel = index.observers.get(observer.smallID());
  if (!intel) {
    intel = new FogIntel(game, observer, index);
    index.observers.set(observer.smallID(), intel);
  }
  return intel;
}
export function canSeeTile(
  game: Game,
  observer: Player,
  tile: TileRef,
): boolean {
  return !game.config().fogOfWar() || fogIntel(game, observer).visible(tile);
}
export function canSeeUnit(game: Game, observer: Player, unit: Unit): boolean {
  return (
    !game.config().fogOfWar() || fogIntel(game, observer).unitVisible(unit)
  );
}
export function knowsPlayer(
  game: Game,
  observer: Player,
  target: Player,
): boolean {
  return !game.config().fogOfWar() || fogIntel(game, observer).knows(target);
}
export function knownPlayers(game: Game, observer: Player): Player[] {
  return game.config().fogOfWar()
    ? game.players().filter((p) => fogIntel(game, observer).knows(p))
    : game.players();
}
