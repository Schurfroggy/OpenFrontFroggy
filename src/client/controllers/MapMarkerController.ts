import { assetUrl } from "../../core/AssetUrls";
import { EventBus } from "../../core/EventBus";
import { Cell, GameMode } from "../../core/game/Game";
import type { MapMarker, MarkerCommand } from "../../core/MapMarkers";
import { MarkerSnapshotEvent, MarkerToggleEvent } from "../MapMarkerEvents";
import { GoToPositionEvent, TransformHandler } from "../TransformHandler";
import type { Transport } from "../Transport";
import { showToast, translateText as t } from "../Utils";
import type { GameView } from "../view";
/** Marker names resolve locally through fog gates; the server stores no labels. */
export function markerLocation(game: GameView, marker: MapMarker): string {
  const tile = game.ref(marker.x, marker.y);
  if (!game.isTileVisible(tile)) return t("map_marker.unknown");
  if (game.isWater(tile)) return t("map_marker.ocean");
  const owner = game.owner(tile);
  return owner.isPlayer() ? owner.displayName() : t("map_marker.wilderness");
}
export class MapMarkerController {
  private markers: MapMarker[] = [];
  private hidden = new Set<string>();
  private overlay = document.createElement("div");
  private list = document.createElement("div");
  private flags = new Map<string, HTMLDivElement>();
  private frame = 0;
  private lastTick = -1;
  private dirty = true;
  private stopped = false;
  private listSignature = "";
  private additions = new Set<string>();
  constructor(
    private game: GameView,
    private bus: EventBus,
    private transform: TransformHandler,
    private transport: Transport,
    private host: HTMLElement,
  ) {}
  init() {
    if (this.game.config().isReplay()) return;
    this.overlay.style.cssText =
      "position:fixed;inset:0;pointer-events:none;z-index:38;overflow:hidden";
    this.overlay.setAttribute("data-map-markers", "");
    this.list.className =
      "pointer-events-auto mb-1 grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-white max-h-28 overflow-y-auto";
    this.list.setAttribute("data-marker-list", "");
    this.list.title = t("map_marker.help");
    this.host.append(this.overlay);
    document.querySelector("attacks-display")?.before(this.list);
    this.markers = this.transport.mapMarkers;
    this.bus.on(MarkerToggleEvent, this.toggle);
    this.bus.on(MarkerSnapshotEvent, this.snapshot);
    this.frame = requestAnimationFrame(this.draw);
  }
  private send(command: MarkerCommand) {
    const owner = this.game.myClientID();
    if (owner) this.transport.sendMapMarker(command, owner);
  }
  private snapshot = (event: MarkerSnapshotEvent) => {
    if (event.addedId && !this.markers.some((m) => m.id === event.addedId)) {
      this.additions.add(event.addedId);
    }
    this.markers = event.markers;
    this.dirty = true;
  };
  private toggle = (event: MarkerToggleEvent) => {
    const me = this.game.myPlayer();
    if (!me?.isAlive() || this.game.inSpawnPhase()) return;
    const owner = this.game.myClientID();
    let nearest: MapMarker | undefined;
    let distance = 18 * 18;
    for (const m of this.markers) {
      if (m.owner !== owner || this.hidden.has(m.id)) continue;
      const p = this.transform.worldToScreenCoordinates(
        new Cell(m.x + 0.5, m.y + 0.5),
      );
      const d = (p.x - event.x) ** 2 + (p.y - event.y) ** 2;
      // Include the large flag above/right of the pole's map anchor.
      const onFlag =
        event.x >= p.x - 8 &&
        event.x <= p.x + 58 &&
        event.y >= p.y - 76 &&
        event.y <= p.y;
      if (d < distance || (onFlag && !nearest)) {
        distance = d;
        nearest = m;
      }
    }
    if (nearest) {
      this.send({ type: "map_marker", action: "remove", id: nearest.id });
      return;
    }
    const cell = this.transform.screenToWorldCoordinates(event.x, event.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    this.send({ type: "map_marker", action: "add", x: cell.x, y: cell.y });
  };
  private draw = () => {
    if (this.stopped) return;
    const me = this.game.myPlayer();
    if (
      me?.hasSpawned() &&
      (this.dirty || this.lastTick !== this.game.ticks())
    ) {
      this.dirty = false;
      this.lastTick = this.game.ticks();
      this.rebuild();
    }
    for (const m of this.markers) {
      const flag = this.flags.get(m.id);
      if (!flag) continue;
      const p = this.transform.worldToScreenCoordinates(
        new Cell(m.x + 0.5, m.y + 0.5),
      );
      const value = `translate(${p.x}px,${p.y}px)`;
      if (flag.style.transform !== value) flag.style.transform = value;
    }
    this.frame = requestAnimationFrame(this.draw);
  };
  private rebuild() {
    const rows = this.markers
      .filter((m) => !this.hidden.has(m.id))
      .map((m) => ({
        marker: m,
        author:
          this.game.playerByClientID(m.owner)?.displayName() ??
          t("map_marker.teammate"),
        label: markerLocation(this.game, m),
        flagRef: this.game.playerByClientID(m.owner)?.cosmetics?.flag,
      }));
    const signature = JSON.stringify(rows);
    if (signature === this.listSignature) return;
    this.listSignature = signature;
    const ids = new Set(
      this.markers.filter((m) => !this.hidden.has(m.id)).map((m) => m.id),
    );
    for (const [id, flag] of this.flags)
      if (!ids.has(id)) {
        flag.remove();
        this.flags.delete(id);
      }
    for (const id of this.hidden)
      if (!this.markers.some((m) => m.id === id)) this.hidden.delete(id);
    this.list.replaceChildren();
    for (const { marker: m, author, label, flagRef } of rows) {
      const mine = m.owner === this.game.myClientID();
      let flag = this.flags.get(m.id);
      if (
        flag &&
        flag.dataset.appearance !== JSON.stringify([author, flagRef])
      ) {
        flag.remove();
        this.flags.delete(m.id);
        flag = undefined;
      }
      if (!flag) {
        flag = this.createFlag(m, author, flagRef);
        this.overlay.append(flag);
        this.flags.set(m.id, flag);
      }
      if (this.additions.has(m.id)) {
        this.pulse(flag, mine);
        if (
          this.game.config().gameConfig().gameMode === GameMode.Team &&
          !mine
        ) {
          showToast(
            t("map_marker.announced", { player: author, target: label }),
            "green",
            3000,
          );
        }
      }
      const row = document.createElement("div");
      row.className =
        "flex items-center gap-2 rounded bg-gray-800/90 px-2 py-1";
      const locate = document.createElement("button");
      locate.className = "min-w-0 flex-1 truncate text-left";
      locate.textContent = `${author} · ${label}`;
      locate.title = `${t("map_marker.locate")} (${m.x}, ${m.y})`;
      locate.onclick = () =>
        this.bus.emit(new GoToPositionEvent(m.x + 0.5, m.y + 0.5));
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.title = t(mine ? "map_marker.remove" : "map_marker.hide");
      remove.setAttribute("aria-label", remove.title);
      remove.onclick = () => {
        if (mine) this.send({ type: "map_marker", action: "remove", id: m.id });
        else {
          this.hidden.add(m.id);
          this.dirty = true;
        }
      };
      row.append(locate, remove);
      this.list.append(row);
    }
    this.additions.clear();
  }
  private createFlag(marker: MapMarker, author: string, flagRef?: string) {
    const flag = document.createElement("div");
    const mine = marker.owner === this.game.myClientID();
    const accent = mine ? "#fde68a" : "#67e8f9";
    flag.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;filter:drop-shadow(0 2px 3px #000)`;
    flag.setAttribute("data-marker-flag", marker.id);
    flag.dataset.appearance = JSON.stringify([author, flagRef]);
    const pole = document.createElement("div");
    pole.style.cssText = `position:absolute;left:-2px;bottom:0;width:4px;height:70px;background:linear-gradient(90deg,#64748b,#fff,#94a3b8);border-radius:2px;box-shadow:0 0 5px ${accent}`;
    const finial = document.createElement("div");
    finial.style.cssText = `position:absolute;left:-5px;bottom:68px;width:10px;height:10px;border-radius:50%;background:${accent};border:1px solid #fff`;
    const cloth = document.createElement("div");
    cloth.style.cssText = `position:absolute;left:2px;bottom:32px;width:52px;height:34px;border:2px solid ${accent};border-radius:1px 4px 4px 1px;overflow:hidden;background:#334155;box-shadow:0 0 8px ${accent}66;display:flex;align-items:center;justify-content:center;color:white;font:bold 18px sans-serif;text-shadow:0 1px 3px #000`;
    cloth.textContent = author.trim().slice(0, 2).toUpperCase();
    const color = this.game
      .playerByClientID(marker.owner)
      ?.territoryColor?.()
      .toHex();
    if (color) cloth.style.background = color;
    if (flagRef) {
      const image = document.createElement("img");
      image.src = assetUrl(flagRef);
      image.alt = "";
      image.draggable = false;
      image.style.cssText =
        "position:absolute;inset:0;width:100%;height:100%;object-fit:fill";
      image.onerror = () => image.remove();
      cloth.append(image);
    }
    const base = document.createElement("div");
    base.style.cssText = `position:absolute;left:-5px;top:-3px;width:10px;height:6px;border-radius:50%;background:${accent};box-shadow:0 0 8px ${accent}`;
    flag.append(pole, finial, cloth, base);
    return flag;
  }
  private pulse(flag: HTMLDivElement, mine: boolean) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ring = document.createElement("div");
    ring.setAttribute("data-marker-pulse", "");
    ring.style.cssText = `position:absolute;left:-6px;top:-6px;width:12px;height:12px;border:2px solid ${mine ? "#fde68a" : "#67e8f9"};border-radius:50%;box-sizing:border-box`;
    flag.append(ring);
    const animation = ring.animate?.(
      [
        { transform: "scale(1)", opacity: 0.9 },
        { transform: "scale(6)", opacity: 0 },
      ],
      { duration: 700, easing: "ease-out" },
    );
    if (animation) animation.onfinish = () => ring.remove();
    else ring.remove();
  }
  dispose() {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.bus.off(MarkerToggleEvent, this.toggle);
    this.bus.off(MarkerSnapshotEvent, this.snapshot);
    this.overlay.remove();
    this.list.remove();
    if (!this.game.config().isReplay())
      this.send({ type: "map_marker", action: "clear" });
  }
}
