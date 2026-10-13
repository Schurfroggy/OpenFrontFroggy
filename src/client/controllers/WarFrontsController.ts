/**
 * WarFrontsController — drives the war view.
 *
 * When the war view is active (MapViewModeEvent "war"):
 *  - aggregates live wars from every player's mirrored attack data
 *    (see WarFronts.ts),
 *  - polls attacking players' clustered front positions through the worker
 *    RPC (throttled; positions move at tile pace) and builds one
 *    history-book curved arrow per attack cluster: from the attacker's
 *    backline, bowing through the front-line anchor, tipping into the
 *    defender's interior,
 *  - filters to wars involving the local player/allies when the "mine only"
 *    toggle is on.
 *
 * Independently of the view mode (always on while in a game): when a nuke
 * targets the local player, the attacker's territory is highlighted for 30
 * seconds so the player can find them.
 */

import { EventBus } from "../../core/EventBus";
import { MessageType } from "../../core/game/Game";
import {
  GameUpdateType,
  UnitIncomingUpdate,
} from "../../core/game/GameUpdates";
import { Controller } from "../Controller";
import { MapViewModeEvent } from "../InputHandler";
import { extractWars, War } from "../render/frame/derive/WarFronts";
import type { WarArrow } from "../render/gl/passes/WarArrowPass";
import type { PlayerState } from "../render/types/Renderer";
import type { GameView } from "../view";

/** Front-position refresh cadence (ticks). Positions move at tile pace. */
const FRONT_REFRESH_TICKS = 20;
/**
 * Arrow update cadence: targets/glide/push run every Nth tick only
 * (10 Hz sim → 2.5 Hz updates at N=4). Slower updates read calmer and
 * leave the glide plenty of time to settle between steps.
 */
const ARROW_UPDATE_EVERY_TICKS = 4;
/**
 * How long a vanished pair's arrow lingers (in arrow-update steps) while
 * fading out. Covers the AI's re-investment gap: an attack is deleted the
 * moment its troops run out and the next wave arrives a few seconds later,
 * so a lingering, fading arrow reads as one continuous offensive.
 */
const ARROW_LINGER_UPDATES = 15; // 15 × 0.4s ≈ 6s
/** Nuke-attacker highlight duration (ticks; 10 ticks/sec → 30 s). */
const NUKE_HIGHLIGHT_TICKS = 30 * 10;
/** Hard cap of concurrent front-position RPCs per refresh. */
const MAX_RPC_PER_REFRESH = 10;
/** In-flight RPC timeout before we drop the request. */
const RPC_TIMEOUT_MS = 5_000;

export class WarFrontsController implements Controller {
  private viewModeActive = false;
  private wars: War[] = [];
  /** Displayed arrow geometry (glided toward targets each tick). */
  private arrows: WarArrow[] = [];
  /** Target geometry keyed by attacker/attack/cluster for pairing. */
  private targetArrows = new Map<string, WarArrow>();
  private arrowKeys: string[] = [];
  /** Last-displayed geometry per key (input of the next glide step). */
  private displayed = new Map<string, WarArrow>();
  /** Arrow-update steps since a pair's attacks vanished (fade-out timer). */
  private linger = new Map<string, number>();
  /** attacker smallID → attackID → front-line anchor points. */
  private fronts = new Map<number, Map<string, { x: number; y: number }[]>>();
  private frontsAgeTicks = Number.POSITIVE_INFINITY;
  private tickCount = 0;
  private inFlight = new Set<number>();
  private highlightUntilTick = -1;
  private highlightedOwner = 0;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private view: MapRendererFacade,
  ) {}

  init(): void {
    this.eventBus.on(MapViewModeEvent, (e) => {
      this.viewModeActive = e.mode === "war";
    });
  }

  tick(): void {
    this.tickNukeHighlight();
    if (!this.viewModeActive) {
      if (this.arrows.length > 0) {
        this.arrows = [];
        this.targetArrows.clear();
        this.arrowKeys = [];
        this.pushArrows();
      }
      return;
    }

    if (this.frontsAgeTicks >= FRONT_REFRESH_TICKS) {
      this.refreshWars();
      this.refreshFronts();
    } else {
      this.frontsAgeTicks++;
    }
    // Throttled arrow updates: rebuild targets, ease, and push only every
    // Nth tick — the arrows change at reading pace, not sim pace.
    this.tickCount++;
    if (this.tickCount % ARROW_UPDATE_EVERY_TICKS !== 0) return;
    this.rebuildTargetArrows();
    this.glideArrows();
    this.pushArrows();
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

    let issued = 0;
    for (const sid of attackers) {
      if (issued >= MAX_RPC_PER_REFRESH) break;
      if (this.inFlight.has(sid)) continue;
      issued++;
      void this.queryFronts(sid);
    }
    // Prune stale attacker entries (war ended / view off).
    for (const sid of this.fronts.keys()) {
      if (!attackers.has(sid)) this.fronts.delete(sid);
    }
  }

  private async queryFronts(sid: number): Promise<void> {
    this.inFlight.add(sid);
    try {
      const player = this.game.playerBySmallID(sid);
      if (!player.isPlayer()) return;
      const result = await this.withTimeout(
        player.attackClusteredPositions(),
        RPC_TIMEOUT_MS,
      );
      const byAttackID = new Map<string, { x: number; y: number }[]>();
      for (const { id, positions } of result) {
        byAttackID.set(id, positions);
      }
      this.fronts.set(sid, byAttackID);
      // The RPC resolves between ticks; refresh immediately (bypassing
      // the throttle) so arrows glide without waiting a full window.
      if (this.viewModeActive) {
        this.rebuildTargetArrows();
        this.glideArrows();
        this.pushArrows();
      }
    } catch {
      // Worker busy or player gone; keep the previous fronts if any.
    } finally {
      this.inFlight.delete(sid);
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), ms),
      ),
    ]);
  }

  // ---------------------------------------------------------------- arrows

  /** Arrow tail distance behind the front anchor (tiles). */
  private static readonly TAIL_TILES = 12;
  /** Arrow tip distance past the front anchor, into the defender (tiles). */
  private static readonly TIP_TILES = 16;
  /** Minimum visible tip distance even when the defender's land is thin. */
  private static readonly TIP_MIN_TILES = 6;
  /** Direction-sampling ring radii (tiles) around the front anchor. */
  private static readonly DIR_RADII = [3, 5, 7];

  private rebuildTargetArrows(): void {
    const targets = new Map<string, WarArrow>();
    const keys: string[] = [];
    for (const war of this.wars) {
      for (const dir of [war.ab, war.ba]) {
        if (dir === null || dir.attackIDs.length === 0) continue;
        const [r, g, b] = this.playerColor(dir.attackerID);
        const fronts = this.fronts.get(dir.attackerID);
        if (fronts === undefined) continue;
        // Territory-scaled size: bigger nations draw bigger arrows. Uses
        // the smaller side so an arrow never dwarfs a small island nation
        // on the other end of the front.
        const scale = this.warScale(dir.attackerID, dir.targetID);
        // One arrow per ATTACK PAIR (attacker→defender), not per attack
        // ID: the AI deletes an attack when its troops run out and posts a
        // fresh one moments later (new ID), so keying by attack ID made
        // arrows flicker at every re-investment wave. Keying by the pair
        // lets the arrow persist and glide across waves. The anchor is the
        // first (largest) cluster of the most recently resolved attack.
        const key = `${dir.attackerID}>${dir.targetID}`;
        let anchor: { x: number; y: number } | null = null;
        for (const atkID of dir.attackIDs) {
          const positions = fronts.get(atkID);
          if (positions !== undefined && positions.length > 0) {
            anchor = positions[0]!;
          }
        }
        if (anchor === null) continue;
        {
          const pos = anchor;
          // The advance direction is measured locally around the front
          // anchor: wherever the defender's land lies relative to the
          // anchor. The arrow stays near the front line — tail a few
          // tiles into the attacker's side, tip a few tiles into the
          // defender's side (shortened when their land runs out, so the
          // tip never points into the sea).
          const d = this.sampleAdvanceDirection(
            pos,
            dir.attackerID,
            dir.targetID,
          );
          if (d === null) continue;
          const tipTiles =
            this.measureTipExtent(pos, d, dir.targetID) * scale;
          const tail = WarFrontsController.TAIL_TILES * scale;
          const sx = pos.x - d.x * tail;
          const sy = pos.y - d.y * tail;
          const tx = pos.x + d.x * tipTiles;
          const ty = pos.y + d.y * tipTiles;
          targets.set(
            key,
            this.buildCurvedArrow(
              sx,
              sy,
              tx,
              ty,
              r,
              g,
              b,
              dir.retreating,
              scale,
              key,
            ),
          );
          keys.push(key);
        }
      }
    }
    this.targetArrows = targets;
    this.arrowKeys = keys;
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

  /**
   * Ease the displayed arrows toward their targets. Same-key arrows glide
   * (all 8 Bezier values lerped); brand-new arrows appear at their target
   * immediately. When a pair's attacks vanish entirely (the AI ran out of
   * troops and hasn't re-invested yet), the arrow LINGERS: it holds its
   * last geometry and fades out over time, so re-investment waves read as
   * one continuous offensive instead of flickering gaps.
   */
  private glideArrows(): void {
    // Larger step than a per-tick glide would use: updates run at 1/4
    // tick rate (2.5 Hz), so each step covers what four 0.08 steps would.
    const k = 0.3;
    const out: WarArrow[] = [];
    const liveKeys = new Set(this.arrowKeys);

    // Live pairs: glide toward targets, full opacity.
    for (const key of this.arrowKeys) {
      const target = this.targetArrows.get(key)!;
      const prev = this.displayed.get(key);
      if (prev === undefined) {
        const fresh: WarArrow = { ...target, fade: 1 };
        out.push(fresh);
        this.displayed.set(key, fresh);
        this.linger.set(key, 0);
        continue;
      }
      const eased: WarArrow = {
        p0x: prev.p0x + (target.p0x - prev.p0x) * k,
        p0y: prev.p0y + (target.p0y - prev.p0y) * k,
        p1x: prev.p1x + (target.p1x - prev.p1x) * k,
        p1y: prev.p1y + (target.p1y - prev.p1y) * k,
        p2x: prev.p2x + (target.p2x - prev.p2x) * k,
        p2y: prev.p2y + (target.p2y - prev.p2y) * k,
        p3x: prev.p3x + (target.p3x - prev.p3x) * k,
        p3y: prev.p3y + (target.p3y - prev.p3y) * k,
        // Color/blink follow the target immediately; size glides.
        r: target.r,
        g: target.g,
        b: target.b,
        retreating: target.retreating,
        scale: prev.scale + (target.scale - prev.scale) * k,
        fade: 1,
      };
      out.push(eased);
      this.displayed.set(key, eased);
      this.linger.set(key, 0);
    }

    // Vanished pairs: hold geometry, fade out over LINGER_TICKS updates.
    for (const [key, prev] of this.displayed) {
      if (liveKeys.has(key)) continue;
      const age = (this.linger.get(key) ?? 0) + 1;
      this.linger.set(key, age);
      if (age > ARROW_LINGER_UPDATES) {
        this.displayed.delete(key);
        this.linger.delete(key);
        continue;
      }
      const fade = 1 - age / (ARROW_LINGER_UPDATES + 1);
      out.push({ ...prev, fade });
    }
    this.arrows = out;
  }

  /**
   * Sample tile ownership on rings around a front anchor and return the
   * unit direction of the attack's advance: from the attacker's land mass
   * toward the advance-target land mass (the defender's land, or unowned
   * land for land grabs).
   *
   * Uses the DIFFERENCE of the two sides' weighted centroids rather than a
   * sum of direction vectors — a sum cancels to zero when the anchor sits
   * deep inside one side's territory (e.g. a attack bulge far from the
   * attacker's home land), which would drop the arrow.
   *
   * Null when no target land exists near the anchor (can't orient).
   */
  private sampleAdvanceDirection(
    pos: { x: number; y: number },
    attackerID: number,
    defenderID: number,
  ): { x: number; y: number } | null {
    let defX = 0;
    let defY = 0;
    let defW = 0; // advance-target land (defender, or unowned for grabs)
    let atkX = 0;
    let atkY = 0;
    let atkW = 0; // attacker land
    const N = 16;
    for (let i = 0; i < N; i++) {
      const ang = (i / N) * Math.PI * 2;
      const ca = Math.cos(ang);
      const sa = Math.sin(ang);
      for (const r of WarFrontsController.DIR_RADII) {
        const x = Math.round(pos.x + ca * r);
        const y = Math.round(pos.y + sa * r);
        if (!this.game.isValidCoord(x, y)) continue;
        const ref = this.game.ref(x, y);
        if (!this.game.isLand(ref)) continue;
        const owner = this.game.ownerID(ref);
        // Weight: nearer rings count more (the local front shape matters
        // more than distant territory).
        const w = 1 / r;
        const isTarget =
          defenderID === 0 ? owner === 0 : owner === defenderID;
        if (isTarget) {
          defX += x * w;
          defY += y * w;
          defW += w;
        } else if (owner === attackerID) {
          atkX += x * w;
          atkY += y * w;
          atkW += w;
        }
      }
    }
    if (defW === 0) return null;
    const cx = defX / defW;
    const cy = defY / defW;
    let dx: number;
    let dy: number;
    if (atkW > 0) {
      // Front normal: attacker mass → target mass.
      dx = cx - atkX / atkW;
      dy = cy - atkY / atkW;
    } else {
      // No attacker land near the anchor: aim from the anchor into the
      // target mass.
      dx = cx - pos.x;
      dy = cy - pos.y;
    }
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      // Deep inside the target's land (a surrounded bulge) the local
      // sample is symmetric. Fall back to the macro direction between
      // the two nations' structure centroids.
      return this.macroAdvanceDirection(attackerID, defenderID);
    }
    return { x: dx / len, y: dy / len };
  }

  /**
   * Macro-scale advance direction: attacker centroid → defender centroid,
   * from each side's structure (city/port) positions. A coarse but stable
   * fallback for anchors deep inside enemy land.
   */
  private macroAdvanceDirection(
    attackerID: number,
    defenderID: number,
  ): { x: number; y: number } | null {
    const from = this.structureCentroid(attackerID);
    const to = this.structureCentroid(defenderID);
    if (from === null || to === null) return null;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return null;
    return { x: dx / len, y: dy / len };
  }

  /** Mean position of a player's structures (cities/ports), or null. */
  private structureCentroid(sid: number): { x: number; y: number } | null {
    if (sid === 0) return null;
    let units: readonly { tile: () => number }[];
    try {
      units = this.game.unitsOwnedBy(sid);
    } catch {
      return null;
    }
    if (units.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const u of units) {
      sx += this.game.x(u.tile());
      sy += this.game.y(u.tile());
    }
    return { x: sx / units.length, y: sy / units.length };
  }

  /**
   * How far the arrow tip may extend past the front anchor along the
   * advance direction: walks tile by tile and stops where the defender's
   * land ends (or the map does), clamped to [TIP_MIN_TILES, TIP_TILES] so
   * tips never reach into the sea but arrows stay visible.
   */
  private measureTipExtent(
    pos: { x: number; y: number },
    dir: { x: number; y: number },
    defenderID: number,
  ): number {
    for (let t = WarFrontsController.TIP_MIN_TILES + 1;
      t <= WarFrontsController.TIP_TILES;
      t++
    ) {
      const x = Math.round(pos.x + dir.x * t);
      const y = Math.round(pos.y + dir.y * t);
      if (!this.game.isValidCoord(x, y)) return t - 1;
      const ref = this.game.ref(x, y);
      if (!this.game.isLand(ref)) return t - 1;
      const owner = this.game.ownerID(ref);
      const isAdvanceTarget =
        defenderID === 0 ? owner === 0 : owner === defenderID;
      if (!isAdvanceTarget) return t - 1;
    }
    return WarFrontsController.TIP_TILES;
  }

  /**
   * Cubic Bezier from (start → tip). The bow amount is small and derived
   * deterministically from the arrow's key: every arrow gets its own
   * slight, stable bend (no jitter across refreshes) so the map reads
   * "gently curved arrows" without the old large uniform bow that made
   * the advance direction ambiguous.
   */
  private buildCurvedArrow(
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
    // Deterministic per-arrow hash (FNV-1a) → stable bend params.
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    const unit1 = ((h >>> 8) % 1000) / 1000; // [0,1)
    const unit2 = ((h >>> 20) % 1000) / 1000; // [0,1)

    // Small bow: 0.04–0.10 of the chord length, random side per arrow.
    const bow = 0.04 + unit1 * 0.06;
    const side = unit2 < 0.5 ? -1 : 1;

    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    // Perpendicular of the travel direction.
    const nx = -uy;
    const ny = ux;
    const off = len * bow * side;

    return {
      p0x: sx,
      p0y: sy,
      p1x: sx + dx * (1 / 3) + nx * off,
      p1y: sy + dy * (1 / 3) + ny * off,
      p2x: sx + dx * (2 / 3) + nx * off,
      p2y: sy + dy * (2 / 3) + ny * off,
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
  setHighlightOwner(ownerID: number): void;
  updateWarArrows(arrows: WarArrow[]): void;
}
