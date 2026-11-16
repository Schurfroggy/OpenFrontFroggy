import { z } from "zod";
import type {
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import {
  snapshotType,
  zInt,
  zNum,
  zPlayerRef,
  zTile,
  zTiles,
} from "../snapshot/SnapshotType";
import { Attack, Player, TerraNullius } from "./Game";
import { GameImpl } from "./GameImpl";
import { TileRef } from "./GameMap";
import { PlayerImpl } from "./PlayerImpl";
import {
  deriveWarFronts,
  type ConquestSample,
  type WarFront,
} from "./WarFront";

export class AttackImpl implements Attack {
  // On-demand visual cache: omitted from snapshots and never read by combat.
  private visualHistory?: ConquestSample[];
  private visualHistoryCursor = 0;
  private visualHistoryUntil = -1;
  private _isActive = true;
  private _borderSize = 0;
  public _retreating = false;
  public _retreated = false;

  constructor(
    private _id: string,
    private _target: Player | TerraNullius,
    private _attacker: Player,
    private _troops: number,
    private _sourceTile: TileRef | null,
    private _border: Set<number>,
    private _mg: GameImpl,
  ) {}

  sourceTile(): TileRef | null {
    return this._sourceTile;
  }

  target(): Player | TerraNullius {
    return this._target;
  }
  attacker(): Player {
    return this._attacker;
  }
  troops(): number {
    return this._troops;
  }
  setTroops(troops: number) {
    this._troops = Math.max(0, troops);
  }

  isActive() {
    return this._isActive;
  }

  id() {
    return this._id;
  }

  delete() {
    if (this._target.isPlayer()) {
      (this._target as PlayerImpl)._incomingAttacks = (
        this._target as PlayerImpl
      )._incomingAttacks.filter((a) => a !== this);
    }

    (this._attacker as PlayerImpl)._outgoingAttacks = (
      this._attacker as PlayerImpl
    )._outgoingAttacks.filter((a) => a !== this);

    this._isActive = false;
  }

  orderRetreat() {
    this._retreating = true;
  }

  executeRetreat() {
    this._retreated = true;
  }

  retreating(): boolean {
    return this._retreating;
  }

  retreated(): boolean {
    return this._retreated;
  }

  borderSize(): number {
    return this._borderSize;
  }

  clearBorder(): void {
    this._borderSize = 0;
    this._border.clear();
  }

  addBorderTile(tile: TileRef): void {
    if (!this._border.has(tile)) {
      this._borderSize += 1;
      this._border.add(tile);
    }
  }

  removeBorderTile(tile: TileRef): void {
    if (this._border.has(tile)) {
      this._borderSize -= 1;
      this._border.delete(tile);
    }
  }

  recordConquest(tile: TileRef): void {
    if (!this.visualHistory || this._mg.ticks() > this.visualHistoryUntil)
      return;
    const map = this._mg.map();
    let dx = 0,
      dy = 0;
    const neighbors: TileRef[] = [];
    const count = map.neighbors4(tile, neighbors);
    for (let i = 0; i < count; i++) {
      const from = neighbors[i];
      if (map.ownerID(from) !== this._attacker.smallID()) continue;
      dx += map.x(tile) - map.x(from);
      dy += map.y(tile) - map.y(from);
    }
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 0.001) return;
    this.visualHistory[this.visualHistoryCursor] = {
      x: this._mg.map().x(tile),
      y: this._mg.map().y(tile),
      dx: dx / length,
      dy: dy / length,
      tick: this._mg.ticks(),
    };
    this.visualHistoryCursor = (this.visualHistoryCursor + 1) % 256;
  }

  warFronts(): WarFront[] {
    this.visualHistory ??= [];
    this.visualHistoryUntil = this._mg.ticks() + 100;
    return deriveWarFronts(
      this._mg,
      this._border,
      this._attacker.smallID(),
      this._target.smallID(),
      this.visualHistory,
    );
  }

  // Returns the top 2 clustered positions of the attack's border.
  // If the second cluster is too small, only returns the largest one.
  clusteredPositions(): TileRef[] {
    if (this._borderSize === 0) {
      const tile = this.sourceTile();
      return tile !== null ? [tile] : [];
    }
    return this.clusterBorderTiles(30, 2);
  }

  // Partitions the attack's border tiles into disconnected segments using BFS,
  // then returns one representative tile per segment.
  //
  // Border tiles naturally fragment when fighting across non-contiguous
  // territory (e.g. islands, chokepoints).
  //
  // Results are sorted largest-first, small clusters below minSize are
  // dropped (the largest is always kept as a fallback), and the list is capped
  // at maxClusters to avoid label clutter on heavily fragmented borders.
  private clusterBorderTiles(minSize: number, maxClusters: number): TileRef[] {
    const map = this._mg.map();
    const visited = new Set<TileRef>();
    const clusters: { tile: TileRef; size: number }[] = [];

    for (const startTile of this._border) {
      if (visited.has(startTile)) continue;

      const queue: TileRef[] = [startTile];
      visited.add(startTile);
      let qi = 0;
      let sumX = 0;
      let sumY = 0;
      let count = 0;

      while (qi < queue.length) {
        const t = queue[qi++];
        sumX += map.x(t);
        sumY += map.y(t);
        count++;

        this._mg.forEachNeighborWithDiag(t, (neighbor) => {
          if (this._border.has(neighbor) && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        });
      }

      // The centroid (sumX/count, sumY/count) may not be a real border tile,
      // so we pick whichever tile in the cluster is closest to it. This ensures
      // the representative always sits on an actual front-line tile.
      const cx = sumX / count;
      const cy = sumY / count;
      let best = queue[0];
      let bestDist = Infinity;
      for (const t of queue) {
        const dx = map.x(t) - cx;
        const dy = map.y(t) - cy;
        const dist = dx * dx + dy * dy;
        if (dist < bestDist) {
          bestDist = dist;
          best = t;
        }
      }
      clusters.push({ tile: best, size: count });
    }

    clusters.sort((a, b) => b.size - a.size);

    switch (clusters.length) {
      case 0:
        return [];
      case 1:
        // If there's only one cluster, return it even if it's smaller than minSize.
        return [clusters[0].tile];
      default: {
        const significant = clusters.filter((c) => c.size >= minSize);
        if (significant.length === 0) {
          // Always keep at least the largest cluster even if it falls below minSize.
          return [clusters[0].tile];
        }
        return significant.slice(0, maxClusters).map((c) => c.tile);
      }
    }
  }

  snapshot(w: SnapshotWriter): AttackState {
    return {
      id: this._id,
      target: w.owner(this._target),
      attacker: w.player(this._attacker),
      troops: this._troops,
      sourceTile: this._sourceTile,
      border: w.tiles(this._border),
      borderSize: this._borderSize,
      isActive: this._isActive,
      retreating: this._retreating,
      retreated: this._retreated,
    };
  }

  /** Fills a prototype-only shell; see RestorableExecution.restoreSnapshot. */
  restoreSnapshot(s: AttackState, r: SnapshotReader): void {
    this.visualHistory = undefined;
    this.visualHistoryCursor = 0;
    this.visualHistoryUntil = -1;
    this._mg = r.game;
    this._id = s.id;
    this._target = r.owner(s.target);
    this._attacker = r.player(s.attacker);
    this._troops = s.troops;
    this._sourceTile = s.sourceTile;
    this._border = new Set(s.border);
    this._borderSize = s.borderSize;
    this._isActive = s.isActive;
    this._retreating = s.retreating;
    this._retreated = s.retreated;
  }
}

export const AttackSnapshot = snapshotType({
  name: "Attack",
  version: 1,
  schema: z.object({
    id: z.string(),
    target: zPlayerRef(),
    attacker: zPlayerRef(),
    troops: zNum(),
    sourceTile: zTile().nullable(),
    border: zTiles(),
    borderSize: zInt(),
    isActive: z.boolean(),
    retreating: z.boolean(),
    retreated: z.boolean(),
  }),
});
export type AttackState = z.infer<typeof AttackSnapshot.schema>;
