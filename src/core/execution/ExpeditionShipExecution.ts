import { z } from "zod";
import {
  Execution,
  ExpeditionState,
  Game,
  MessageType,
  Player,
  Unit,
  UnitType,
} from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WaterPathFinder } from "../pathfinding/PathFinder";
import { PseudoRandom } from "../PseudoRandom";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import {
  zInt,
  zPlayerRef,
  zRandom,
  zRef,
  zTile,
  zTiles,
} from "../snapshot/SnapshotType";

import { EXPEDITION_WAIT_TICKS } from "../game/ExpeditionRules";
export { EXPEDITION_WAIT_TICKS } from "../game/ExpeditionRules";

/** An irrevocable voyage. The path is private navigation data, never a client preview. */
export class ExpeditionShipExecution implements Execution {
  private game!: Game;
  private ship: Unit | null = null;
  private path: TileRef[] = [];
  private cursor = 0;
  private recent: number[] = [];
  private random!: PseudoRandom;
  private nextAttempt = 0;
  private discovered: number[] = [];
  private departure: TileRef = 0;
  private shoreNotified = false;

  private portId = -1;

  constructor(
    private owner: Player,
    private target: TileRef,
  ) {}

  init(game: Game): void {
    this.game = game;
    if (
      !game.config().fogOfWar() ||
      game.inSpawnPhase() ||
      !this.owner.isAlive() ||
      !game.isValidRef(this.target) ||
      game.config().isUnitDisabled(UnitType.ExpeditionShip)
    )
      return;
    // Match warship dispatch: use the completed own port nearest the target.
    // Unlike warships, land and disconnected-water destinations are valid.
    const port = this.owner
      .units(UnitType.Port)
      .filter(
        (p) =>
          p.isActive() &&
          !p.isUnderConstruction() &&
          !p.isMarkedForDeletion() &&
          game.neighbors(p.tile()).some((t) => game.isWater(t)),
      )
      .sort(
        (a, b) =>
          game.manhattanDist(a.tile(), this.target) -
            game.manhattanDist(b.tile(), this.target) || a.id() - b.id(),
      )[0];
    if (!port) return;
    const cost = game.unitInfo(UnitType.ExpeditionShip).cost(game, this.owner);
    if (this.owner.gold() < cost) return;
    const spawn = game.neighbors(port.tile()).find((t) => game.isWater(t));
    if (spawn === undefined) return;
    this.portId = port.id();
    this.departure = spawn;
    this.ship = this.owner.buildUnit(UnitType.ExpeditionShip, spawn, {
      expeditionState: {
        phase: "sailing",
        originPort: port.id(),
        destination: this.target,
        waitUntil: 0,
      },
    });
    this.random = new PseudoRandom(this.ship.id());
    this.planVoyage();
  }

  private state(): ExpeditionState {
    return this.ship!.expeditionState()!;
  }
  private phase(
    phase: ExpeditionState["phase"],
    waitUntil = this.state().waitUntil,
  ): void {
    // Retain the survey deadline after departure to identify completed voyages.
    this.ship!.updateExpeditionState({ ...this.state(), phase, waitUntil });
  }
  private notify(key: string): void {
    this.game.displayMessage(
      `expedition.${key}`,
      MessageType.EXPLORATION,
      this.owner.id(),
      undefined,
      undefined,
      this.ship!.id(),
    );
  }
  private reachable(tile: TileRef, component: number): boolean {
    return (
      this.game.isWater(tile) && this.game.hasWaterComponent(tile, component)
    );
  }
  private planVoyage(): void {
    const ship = this.ship!;
    const component = this.game.getWaterComponent(ship.tile());
    if (component === null) {
      this.strand();
      return;
    }
    let goal = this.target;
    if (!this.reachable(goal, component)) {
      let best = Number.MAX_SAFE_INTEGER;
      goal = ship.tile();
      for (
        let tile = 0;
        tile < this.game.width() * this.game.height();
        tile++
      ) {
        if (!this.reachable(tile, component)) continue;
        const score =
          this.game.euclideanDistSquared(tile, this.target) * 16 +
          this.game.euclideanDistSquared(tile, ship.tile());
        if (score < best) {
          best = score;
          goal = tile;
        }
      }
    }
    const path = new WaterPathFinder(this.game).findPath(ship.tile(), goal);
    if (!path) {
      this.strand();
      return;
    }
    // Bound detours; a distant unreachable objective must not cause endless circumnavigation.
    const maxSteps = Math.max(
      256,
      this.game.manhattanDist(ship.tile(), this.target) * 4,
    );
    this.path = path.slice(0, maxSteps + 1);
    this.cursor = this.path[0] === ship.tile() ? 1 : 0;
  }
  private strand(): void {
    this.path = [];
    this.cursor = 0;
    const notify = this.state().phase !== "stranded";
    this.phase("stranded");
    this.nextAttempt = this.game.ticks() + 100;
    if (notify) this.notify("stranded_notice");
  }
  private remember(): void {
    const tile = this.ship!.tile();
    const key =
      Math.floor(this.game.y(tile) / 24) * Math.ceil(this.game.width() / 24) +
      Math.floor(this.game.x(tile) / 24);
    if (this.recent[this.recent.length - 1] === key) return;
    this.recent.push(key);
    if (this.recent.length > 128) this.recent.shift();
  }
  private explore(): void {
    const ship = this.ship!;
    const component = this.game.getWaterComponent(ship.tile());
    if (component === null) {
      this.strand();
      return;
    }
    const candidates: { tile: TileRef; score: number }[] = [];
    // Local travel memory, never hidden country/unit positions or the global fog map.
    const range = Math.min(
      192,
      Math.max(this.game.width(), this.game.height()),
    );
    const minimumLeg = Math.min(
      48,
      Math.max(
        2,
        Math.floor(Math.min(this.game.width(), this.game.height()) / 4),
      ),
    );
    for (let attempt = 0; attempt < 64; attempt++) {
      const x = this.game.x(ship.tile()) + this.random.nextInt(-range, range);
      const y = this.game.y(ship.tile()) + this.random.nextInt(-range, range);
      if (!this.game.isValidCoord(x, y)) continue;
      const tile = this.game.ref(x, y);
      const distance = this.game.manhattanDist(tile, ship.tile());
      if (distance < minimumLeg || !this.reachable(tile, component)) continue;
      const cx = Math.floor(x / 24),
        cy = Math.floor(y / 24),
        columns = Math.ceil(this.game.width() / 24);
      let visits = 0;
      for (const key of this.recent) {
        if (
          Math.abs((key % columns) - cx) <= 2 &&
          Math.abs(Math.floor(key / columns) - cy) <= 2
        )
          visits++;
      }
      candidates.push({
        tile,
        score: visits * 1000 - distance + this.random.nextInt(0, 32),
      });
    }
    candidates.sort((a, b) => a.score - b.score || a.tile - b.tile);
    for (const candidate of candidates.slice(0, 8)) {
      const path = new WaterPathFinder(this.game).findPath(
        ship.tile(),
        candidate.tile,
      );
      if (!path || path.length > 1024) continue;
      this.path = path;
      this.cursor = path[0] === ship.tile() ? 1 : 0;
      this.phase("exploring");
      return;
    }
    // A small enclosed sea may have no long waypoint: stay safely, retry infrequently.
    this.strand();
  }
  private repairRoute(): boolean {
    const start = this.ship!.tile();
    const goals = new Map<number, number>();
    for (
      let i = this.cursor - 1;
      i < Math.min(this.path.length, this.cursor + 16);
      i++
    ) {
      const tile = this.path[i];
      if (tile !== start && this.game.isWater(tile)) goals.set(tile, i);
    }
    const parents = new Map<number, number>([[start, start]]);
    const queue = [start];
    for (let head = 0; head < queue.length && head < 2048; head++) {
      const at = queue[head];
      const index = goals.get(at);
      if (index !== undefined) {
        const patch = [at];
        while (patch[patch.length - 1] !== start)
          patch.push(parents.get(patch[patch.length - 1])!);
        patch.reverse();
        this.path = [...patch.slice(1), ...this.path.slice(index + 1)];
        this.cursor = 0;
        return true;
      }
      if (this.game.manhattanDist(start, at) >= 48) continue;
      for (const next of this.game.neighbors(at)) {
        if (parents.has(next) || !this.game.isWater(next)) continue;
        parents.set(next, at);
        queue.push(next);
      }
    }
    return false;
  }
  private checkDiscovery(): void {
    if (
      this.game.euclideanDistSquared(this.departure, this.ship!.tile()) <
      64 * 64
    )
      return;
    const at = this.ship!.tile();
    for (let dy = -47; dy <= 47; dy++)
      for (let dx = -47; dx <= 47; dx++) {
        if (dx * dx + dy * dy >= 48 * 48) continue;
        const x = this.game.x(at) + dx,
          y = this.game.y(at) + dy;
        if (!this.game.isValidCoord(x, y)) continue;
        const tile = this.game.ref(x, y);
        if (!this.shoreNotified && this.game.isLand(tile)) {
          this.shoreNotified = true;
          this.notify("coast_discovered");
        }
        const country = this.game.owner(tile);
        if (
          country.isPlayer() &&
          country !== this.owner &&
          !this.owner.isFriendly(country) &&
          !this.discovered.includes(country.smallID())
        ) {
          this.discovered.push(country.smallID());
          this.notify("discovered");
          return;
        }
      }
  }
  tick(ticks: number): void {
    if (!this.isActive()) return;
    this.remember();
    if (ticks % 10 === 0) this.checkDiscovery();
    if (this.state().phase === "surveying") {
      if (ticks < this.state().waitUntil) return;
      this.explore();
    } else if (this.state().phase === "stranded") {
      if (ticks < this.nextAttempt) return;
      this.explore();
    }
    for (let step = 0; step < (ticks % 4 === 0 ? 2 : 1); step++) {
      if (this.cursor >= this.path.length) {
        if (this.state().phase === "sailing") {
          this.phase("surveying", ticks + EXPEDITION_WAIT_TICKS);
          this.notify(
            this.ship!.tile() === this.target ? "arrived" : "approached",
          );
        } else if (this.state().phase === "exploring") this.explore();
        return;
      }
      const next = this.path[this.cursor++];
      if (
        !this.game.isWater(next) ||
        this.game.manhattanDist(this.ship!.tile(), next) > 2
      ) {
        if (!this.repairRoute()) this.strand();
        return;
      }
      this.ship!.move(next);
    }
  }
  isActive(): boolean {
    return this.ship !== null && this.ship.isActive();
  }
  activeDuringSpawnPhase(): boolean {
    return false;
  }
  snapshot(w: SnapshotWriter): ExecRecord {
    return ExpeditionShipExecutionSnapshot.write({
      owner: w.player(this.owner),
      portId: this.portId,
      target: this.target,
      ship: w.unitOrNull(this.ship ?? undefined),
      path: Uint32Array.from(this.path),
      cursor: this.cursor,
      recent: this.recent,
      random: this.random?.getState() ?? null,
      nextAttempt: this.nextAttempt,
      discovered: this.discovered,
      departure: this.departure,
      shoreNotified: this.shoreNotified,
    });
  }
  restoreSnapshot(s: z.infer<typeof schema>, r: SnapshotReader): void {
    this.game = r.game;
    this.owner = r.player(s.owner);
    this.portId = s.portId;
    this.target = s.target;
    this.ship = s.ship === null ? null : r.unit(s.ship);
    this.path = [...s.path];
    this.cursor = s.cursor;
    this.recent = [...s.recent];
    this.random =
      s.random === null
        ? new PseudoRandom(1)
        : PseudoRandom.fromState(s.random);
    this.nextAttempt = s.nextAttempt;
    this.discovered = [...s.discovered];
    this.departure = s.departure;
    this.shoreNotified = s.shoreNotified;
  }
}
const schema = z.object({
  owner: zPlayerRef(),
  portId: zInt(),
  target: zTile(),
  ship: zRef().nullable(),
  path: zTiles(),
  cursor: zInt(),
  recent: z.array(zInt()),
  random: zRandom().nullable(),
  nextAttempt: zInt(),
  discovered: z.array(zInt()),
  departure: zTile(),
  shoreNotified: z.boolean(),
});
export const ExpeditionShipExecutionSnapshot = execSnapshotType({
  name: "ExpeditionShip",
  version: 1,
  schema,
  cls: () => ExpeditionShipExecution,
});
