import type { WarFront } from "../../core/game/WarFront";
import { WarFrontTracker } from "./WarFrontTracker";
/** Supplies terrain-fitted war arrow targets. Animation belongs to the renderer.
 * Nuclear attacker highlighting remains active outside the war view. */

import { EventBus } from "../../core/EventBus";
import { MessageType } from "../../core/game/Game";
import {
  GameUpdateType,
  UnitIncomingUpdate,
} from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { MapViewModeEvent } from "../InputHandler";
import { extractWars, War } from "../render/frame/derive/WarFronts";
import { arrowFits } from "../render/gl/passes/WarArrowGeometry";
import type { WarArrow } from "../render/gl/passes/WarArrowPass";
import defaults from "../render/gl/render-settings.json";
import type { RenderSettings } from "../render/gl/RenderSettings";
import type { PlayerState } from "../render/types/Renderer";
import type { GameView } from "../view";

/** Nuke-attacker highlight duration (ticks; 10 ticks/sec → 30 s). */
const NUKE_HIGHLIGHT_TICKS = 30 * 10;
/** Hard cap of concurrent front-position RPCs per refresh. */
const MAX_RPC_PER_REFRESH = 10;
/** In-flight RPC timeout before we drop the request. */
const RPC_TIMEOUT_MS = 5_000;

export class WarFrontsController implements Controller {
  private viewModeActive = false;
  private wars: War[] = [];
  /** Targets for the render-loop animator. */
  private arrows: WarArrow[] = [];
  /** Target geometry keyed by attacker/attack/cluster for pairing. */
  private targetArrows = new Map<string, WarArrow>();
  private tracker = new WarFrontTracker();
  private generation = 0;
  private queryCursor = 0;
  private frontReceived = new Map<number, number>();
  /** attacker smallID → attackID → front-line anchor points. */
  private fronts = new Map<number, Map<string, WarFront[]>>();
  private frontsAgeTicks = Number.POSITIVE_INFINITY;

  private inFlight = new Set<number>();
  private highlightUntilTick = -1;
  private highlightedOwner = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private view: MapRendererFacade,
    private fogOfWar = false,
  ) {}

  init(): void {
    this.eventBus.on(MapViewModeEvent, (e) => {
      this.viewModeActive = e.mode === "war";
      this.generation++;
      this.fronts.clear();
      this.tracker.clear();
      this.frontReceived.clear();
      this.frontsAgeTicks = Infinity;
      this.arrows = [];
      this.targetArrows.clear();
      this.pushArrows();
    });
  }

  tick(): void {
    if (this.fogOfWar) return;
    this.tickNukeHighlight();
    if (!this.viewModeActive) {
      if (this.arrows.length > 0) {
        this.arrows = [];
        this.targetArrows.clear();
        this.pushArrows();
      }
      return;
    }

    if (this.frontsAgeTicks >= Math.max(1, this.cfg.refreshTicks) - 1) {
      this.refreshWars();
      this.refreshFronts();
    } else {
      this.frontsAgeTicks++;
    }
    this.rebuildTargetArrows();
    this.arrows = [...this.targetArrows.values()];
    this.pushArrows();
  }

  private get cfg(): RenderSettings["warArrows"] {
    return this.view.getSettings?.().warArrows ?? defaults.warArrows;
  }

  // ------------------------------------------------------------------ wars

  private refreshWars(): void {
    const states = new Map<number, PlayerState>();
    for (const p of this.game.players()) {
      states.set(p.smallID(), p.state);
    }
    this.wars = extractWars(states);
  }

  private refreshFronts(): void {
    this.frontsAgeTicks = 0;
    // The attacker's own RPC returns both their outgoing and incoming
    // attacks' clustered positions, so querying each attacker once covers
    // every war direction they participate in.
    const attackers = new Set<number>();
    for (const war of this.wars) {
      if (war.ab !== null) attackers.add(war.ab.attackerID);
      if (war.ba !== null) attackers.add(war.ba.attackerID);
    }

    const ids = [...attackers].sort((a, b) => a - b);
    let issued = 0;
    for (let n = 0; n < ids.length && issued < MAX_RPC_PER_REFRESH; n++) {
      const sid = ids[this.queryCursor++ % ids.length];
      if (this.inFlight.has(sid)) continue;
      issued++;
      void this.queryFronts(sid);
    }
    // Prune stale attacker entries (war ended / view off).
    for (const sid of this.fronts.keys()) {
      if (!attackers.has(sid)) {
        this.fronts.delete(sid);
        this.frontReceived.delete(sid);
      }
    }
  }

  private async queryFronts(sid: number): Promise<void> {
    const generation = this.generation;
    this.inFlight.add(sid);
    try {
      const player = this.game.playerBySmallID(sid);
      if (!player.isPlayer()) return;
      const result = await this.withTimeout(
        player.attackClusteredPositions(undefined, true),
        RPC_TIMEOUT_MS,
      );
      if (generation !== this.generation || !this.viewModeActive) return;
      this.frontReceived.set(sid, performance.now());
      const byAttackID = new Map<string, WarFront[]>();
      for (const { id, fronts } of result) {
        byAttackID.set(id, fronts ?? []);
      }
      this.fronts.set(sid, byAttackID);
      // The RPC resolves between ticks; refresh immediately (bypassing
      // the throttle) so arrows glide without waiting a full window.
      if (this.viewModeActive) {
        this.rebuildTargetArrows();
        this.arrows = [...this.targetArrows.values()];
        this.pushArrows();
      }
    } catch {
      // Worker busy or player gone; keep the previous fronts if any.
    } finally {
      this.inFlight.delete(sid);
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    return Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  // ---------------------------------------------------------------- arrows

  private rebuildTargetArrows(): void {
    const targets = new Map<string, WarArrow>();
    const now = performance.now();
    this.tracker.prune(
      now,
      this.cfg.lingerMs + this.cfg.fadeOutMs + this.cfg.refreshTicks * 100,
    );
    for (const war of this.wars) {
      for (const dir of [war.ab, war.ba]) {
        if (dir === null || dir.attackIDs.length === 0) continue;
        const [r, g, b] = this.playerColor(dir.attackerID);
        const fronts = this.fronts.get(dir.attackerID);
        if (
          fronts === undefined ||
          performance.now() - (this.frontReceived.get(dir.attackerID) ?? 0) >
            RPC_TIMEOUT_MS
        )
          continue;
        // Territory-scaled size: bigger nations draw bigger arrows. Uses
        // the smaller side so an arrow never dwarfs a small island nation
        // on the other end of the front.
        const scale = this.warScale(dir.attackerID, dir.targetID);
        const pair = `${dir.attackerID}>${dir.targetID}`;
        const attacker = this.game.playerBySmallID(dir.attackerID);
        if (!attacker.isPlayer()) continue;
        const attacks = attacker.state.outgoingAttacks;
        const candidates = dir.attackIDs.flatMap((id) => {
          const retreating =
            attacks.find((attack) => attack.id === id)?.retreating ??
            dir.retreating;
          return (fronts.get(id) ?? []).map((front) => ({
            ...front,
            retreating,
          }));
        });
        const tracked = this.tracker.update(
          pair,
          candidates,
          now,
          this.cfg.jumpDistanceTiles,
          (a, b) => this.frontsConnected(a, b, dir.attackerID, dir.targetID),
        );
        for (const pos of tracked) {
          const key = pos.id;
          const sampled = { x: pos.directionX, y: pos.directionY };
          if (
            !Number.isFinite(sampled.x) ||
            !Number.isFinite(sampled.y) ||
            Math.hypot(sampled.x, sampled.y) < 0.001
          )
            continue;
          const angle = (this.cfg.directionOffsetDegrees * Math.PI) / 180;
          const d = {
            x: sampled.x * Math.cos(angle) - sampled.y * Math.sin(angle),
            y: sampled.x * Math.sin(angle) + sampled.y * Math.cos(angle),
          };
          const tip = this.measureExtent(
            pos,
            d,
            dir.targetID,
            this.cfg.tipLengthTiles * scale,
          );
          const back = { x: -d.x, y: -d.y };
          const tail = this.measureExtent(
            pos,
            back,
            dir.attackerID,
            this.cfg.tailLengthTiles * scale,
          );
          if (tip + tail < 2) continue;
          const arrow = this.buildArrow(
            pos.x - d.x * tail,
            pos.y - d.y * tail,
            pos.x + d.x * tip,
            pos.y + d.y * tip,
            r,
            g,
            b,
            pos.retreating,
            scale,
            key,
          );
          arrow.isPointValid = (x, y) =>
            this.validWarLand(x, y, dir.attackerID, dir.targetID);
          // Fit the whole silhouette, including its shoulders, into local land.
          for (
            let attempt = 0;
            attempt < 10 && !arrowFits(arrow, this.cfg);
            attempt++
          )
            arrow.scale *= 0.7;
          if (!arrowFits(arrow, this.cfg)) continue;
          targets.set(key, arrow);
        }
      }
    }
    this.targetArrows = targets;
  }

  /**
   * Size multiplier from the two nations' territory areas (√ of the tile
   * ratio, clamped): a 1200-tile war draws the base size, 4800-tile
   * nations draw twice the size, and tiny nations never drop below 0.9×.
   * Terra nullius (0) uses the attacker's size alone.
   */
  private warScale(attackerID: number, defenderID: number): number {
    const a = this.tilesOwned(attackerID);
    const b = defenderID === 0 ? Infinity : this.tilesOwned(defenderID);
    const smaller = Math.min(a, b);
    const raw = Math.sqrt(smaller / 1200);
    return Math.min(4, Math.max(0.9, raw));
  }

  private tilesOwned(sid: number): number {
    if (sid === 0) return 1;
    try {
      const p = this.game.playerBySmallID(sid);
      if (p.isPlayer()) return Math.max(1, p.state.tilesOwned);
    } catch {
      // Unknown player; treat as minimal.
    }
    return 1;
  }

  private validWarLand(
    x: number,
    y: number,
    attacker: number,
    defender: number,
  ): boolean {
    if (!this.validLand(x, y)) return false;
    const owner = this.game.ownerID(
      this.game.ref(Math.round(x), Math.round(y)),
    );
    return owner === attacker || owner === defender;
  }

  private frontsConnected(
    a: WarFront,
    b: WarFront,
    attacker: number,
    defender: number,
  ): boolean {
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (
        !this.validWarLand(
          a.x + (b.x - a.x) * t,
          a.y + (b.y - a.y) * t,
          attacker,
          defender,
        )
      )
        return false;
    }
    return true;
  }

  private validLand(x: number, y: number): boolean {
    const ix = Math.round(x),
      iy = Math.round(y);
    if (!this.game.isValidCoord(ix, iy)) return false;
    const tile = this.game.ref(ix, iy);
    return this.game.isLand(tile) && !this.game.isImpassable(tile);
  }

  private measureExtent(
    pos: { x: number; y: number },
    dir: { x: number; y: number },
    owner: number,
    max: number,
  ): number {
    let extent = 0;
    for (let t = 0.5; t <= max; t += 0.5) {
      const x = pos.x + dir.x * t,
        y = pos.y + dir.y * t;
      if (!this.validLand(x, y)) break;
      // The representative tile belongs to the defender; allow only this
      // initial tile when walking backwards into the attacker's territory.
      const ix = Math.round(x),
        iy = Math.round(y);
      if (
        this.game.ownerID(this.game.ref(ix, iy)) !== owner &&
        (ix !== Math.round(pos.x) || iy !== Math.round(pos.y))
      )
        break;
      extent = t;
    }
    return extent;
  }

  private buildArrow(
    sx: number,
    sy: number,
    tx: number,
    ty: number,
    r: number,
    g: number,
    b: number,
    retreating: boolean,
    scale: number,
    key: string,
  ): WarArrow {
    return {
      id: key,
      p0x: sx,
      p0y: sy,
      p1x: sx + (tx - sx) / 3,
      p1y: sy + (ty - sy) / 3,
      p2x: sx + ((tx - sx) * 2) / 3,
      p2y: sy + ((ty - sy) * 2) / 3,
      p3x: tx,
      p3y: ty,
      r,
      g,
      b,
      retreating,
      scale,
      fade: 1,
    };
  }

  private pushArrows(): void {
    this.view.updateWarArrows(this.arrows);
  }

  /** Attacker's palette color as [r, g, b] floats. */
  private playerColor(sid: number): [number, number, number] {
    try {
      const p = this.game.playerBySmallID(sid);
      if (p.isPlayer()) {
        const rgb = p.territoryColor().toRgb();
        return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
      }
    } catch {
      // Unknown player; fall through to white.
    }
    return [1, 1, 1];
  }

  // ------------------------------------------------------- nuke highlight

  private tickNukeHighlight(): void {
    const updates = this.game.updatesSinceLastTick();
    if (updates !== null) {
      for (const u of updates[GameUpdateType.UnitIncoming] ?? []) {
        this.handleIncoming(u as UnitIncomingUpdate);
      }
    }

    if (
      this.highlightedOwner !== 0 &&
      this.game.ticks() >= this.highlightUntilTick
    ) {
      this.clearNukeHighlight();
    }
  }

  private handleIncoming(u: UnitIncomingUpdate): void {
    const my = this.game.myPlayer();
    if (my === null || my.smallID() !== u.playerID) return;
    if (
      u.messageType !== MessageType.NUKE_INBOUND &&
      u.messageType !== MessageType.HYDROGEN_BOMB_INBOUND &&
      u.messageType !== MessageType.MIRV_INBOUND
    ) {
      return;
    }
    // Identify the attacker through the nuke unit itself.
    const unit = this.game.unit(u.unitID);
    if (unit === undefined || !unit.isActive()) return;
    const owner = unit.owner();
    if (!owner.isPlayer() || owner.smallID() === my.smallID()) return;
    const ownerID = owner.smallID();
    // Idempotent: refreshing an ongoing highlight of the same attacker just
    // extends the timer without re-pushing the renderer state.
    const alreadyHighlighted = ownerID === this.highlightedOwner;
    this.highlightedOwner = ownerID;
    this.highlightUntilTick = this.game.ticks() + NUKE_HIGHLIGHT_TICKS;
    if (!alreadyHighlighted) {
      this.view.setHighlightOwner(ownerID);
    }
  }

  private clearNukeHighlight(): void {
    this.highlightedOwner = 0;
    this.highlightUntilTick = -1;
    this.view.setHighlightOwner(0);
  }
}

/** The MapRenderer surface this controller needs (for testing ease). */
export interface MapRendererFacade {
  getSettings?(): RenderSettings;
  setHighlightOwner(ownerID: number): void;
  updateWarArrows(arrows: WarArrow[]): void;
}
