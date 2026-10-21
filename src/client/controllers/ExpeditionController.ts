import { EventBus, EventConstructor, GameEvent } from "../../core/EventBus";
import { Cell, UnitType } from "../../core/game/Game";
import { Controller } from "../Controller";
import {
  CloseViewEvent,
  MouseOverEvent,
  MouseUpEvent,
  StartExpeditionEvent,
} from "../InputHandler";
import { MapRenderer } from "../render/gl";
import { TransformHandler } from "../TransformHandler";
import { SendExpeditionIntentEvent } from "../Transport";
import { UIState } from "../UIState";
import { GameView } from "../view";

/** One target click dispatches a voyage; the simulation chooses the departure port. */
export class ExpeditionController implements Controller {
  private cleanups: (() => void)[] = [];
  private selecting = false;
  private overlay = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  private line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  private target = document.createElementNS("http://www.w3.org/2000/svg", "g");
  private pointer: Cell | null = null;
  private flags = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private destinationFlags = new Map<number, SVGGElement>();

  constructor(
    private game: GameView,
    private bus: EventBus,
    private ui: UIState,
    private transform: TransformHandler,
    private view: MapRenderer,
    private host: HTMLElement,
  ) {}

  init(): void {
    if (!this.game.config().fogOfWar() || this.game.config().isReplay()) return;
    this.overlay.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:39;display:none;overflow:visible";
    this.overlay.setAttribute("aria-hidden", "true");
    this.line.setAttribute("fill", "none");
    this.line.setAttribute("stroke", "#a5f3fc");
    this.line.setAttribute("stroke-width", "2");
    this.line.setAttribute("stroke-dasharray", "9 7");
    this.line.style.filter = "drop-shadow(0 1px 2px #000)";
    this.target.innerHTML =
      '<circle r="15" fill="#082f4966" stroke="#fef08a" stroke-width="2.5"/><circle r="4" fill="#fef08a"/><path d="M-23 0H-10M10 0H23M0-23V-10M0 10V23" stroke="#fef08a" stroke-width="2.5"/>';
    this.overlay.append(this.line, this.target);
    this.flags.style.cssText =
      "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:38;overflow:visible";
    this.flags.setAttribute("aria-hidden", "true");
    this.flags.setAttribute("data-expedition-destinations", "");
    this.host.append(this.flags, this.overlay);
    this.listen(MouseOverEvent, (event) => {
      if (!this.selecting) return;
      this.pointer = new Cell(event.x, event.y);
      this.paint();
    });
    this.listen(StartExpeditionEvent, () => this.start());
    this.listen(CloseViewEvent, () => this.cancel());
    this.listen(MouseUpEvent, (event) => this.click(event));
  }

  private listen<T extends GameEvent>(
    type: EventConstructor<T>,
    handler: (event: T) => void,
  ): void {
    this.bus.on(type, handler);
    this.cleanups.push(() => this.bus.off(type, handler));
  }

  dispose(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.cancel();
    this.overlay.remove();
    this.flags.remove();
    this.destinationFlags.clear();
  }

  private start(): void {
    if (this.selecting && this.ui.expeditionSelecting) {
      this.cancel();
      return;
    }
    const me = this.game.myPlayer();
    if (
      !me?.isAlive() ||
      this.game.inSpawnPhase() ||
      this.game.config().isUnitDisabled(UnitType.ExpeditionShip) ||
      !me
        .units(UnitType.Port)
        .some(
          (p) =>
            p.isActive() && !p.isUnderConstruction() && !p.markedForDeletion(),
        )
    )
      return;
    this.ui.ghostStructure = null;
    this.selecting = true;
    this.ui.expeditionSelecting = true;
    this.host.style.cursor = "crosshair";
    this.pointer = null;
    this.paint();
  }

  private cancel(): void {
    if (!this.selecting) return;
    this.selecting = false;
    this.ui.expeditionSelecting = false;
    this.host.style.cursor = "";
    this.pointer = null;
    this.overlay.style.display = "none";
  }

  private click(event: MouseUpEvent): void {
    if (
      !this.selecting ||
      !this.ui.expeditionSelecting ||
      this.ui.ghostStructure !== null
    )
      return;
    event.handled = true;
    const cell = this.transform.screenToWorldCoordinates(event.x, event.y);
    if (!this.game.isValidCoord(cell.x, cell.y)) return;
    const me = this.game.myPlayer();
    if (!me?.isAlive()) {
      this.cancel();
      return;
    }
    this.bus.emit(new SendExpeditionIntentEvent(this.game.ref(cell.x, cell.y)));
    this.view.showMoveIndicator(cell.x, cell.y, me.smallID());
    this.cancel();
  }

  private paint(): void {
    const cell =
      this.pointer &&
      this.transform.screenToWorldCoordinates(this.pointer.x, this.pointer.y);
    if (
      !this.ui.expeditionSelecting ||
      !cell ||
      !this.game.isValidCoord(cell.x, cell.y)
    ) {
      this.overlay.style.display = "none";
      return;
    }
    const tile = this.game.ref(cell.x, cell.y);
    const port = this.game
      .myPlayer()
      ?.units(UnitType.Port)
      .filter(
        (p) =>
          p.isActive() &&
          !p.isUnderConstruction() &&
          !p.markedForDeletion() &&
          this.game.neighbors(p.tile()).some((t) => this.game.isWater(t)),
      )
      .sort(
        (a, b) =>
          this.game.manhattanDist(a.tile(), tile) -
            this.game.manhattanDist(b.tile(), tile) || a.id() - b.id(),
      )[0];
    if (!port) {
      this.overlay.style.display = "none";
      return;
    }
    const start = this.transform.worldToScreenCoordinates(
      new Cell(this.game.x(port.tile()) + 0.5, this.game.y(port.tile()) + 0.5),
    );
    const end = this.transform.worldToScreenCoordinates(
      new Cell(cell.x + 0.5, cell.y + 0.5),
    );
    this.line.setAttribute("d", `M${start.x} ${start.y}L${end.x} ${end.y}`);
    this.target.setAttribute("transform", `translate(${end.x} ${end.y})`);
    this.overlay.style.display = "block";
  }

  private paintDestinations(): void {
    if (!this.flags.isConnected) return;
    const active = new Set<number>();
    const me = this.game.myPlayer();
    if (me?.isAlive())
      for (const ship of me.units(UnitType.ExpeditionShip)) {
        const state = ship.expeditionState();
        // Surveying begins at the real endpoint, including unreachable objectives.
        if (
          !ship.isActive() ||
          !(
            state?.phase === "sailing" ||
            (state?.phase === "stranded" && state.waitUntil === 0)
          ) ||
          !this.game.isValidRef(state.destination)
        )
          continue;
        active.add(ship.id());
        let flag = this.destinationFlags.get(ship.id());
        if (!flag) {
          flag = document.createElementNS("http://www.w3.org/2000/svg", "g");
          flag.setAttribute("data-expedition-ship", String(ship.id()));
          flag.style.filter = "drop-shadow(0 1px 3px #000)";
          flag.innerHTML =
            '<circle r="4" fill="#082f49" stroke="#fef08a" stroke-width="1.5"/><path d="M0 0V-30" fill="none" stroke="#fef08a" stroke-width="2.5"/><path d="M1-29H22L15-21L22-13H1Z" fill="#facc15" stroke="#713f12" stroke-width="1.5"/>';
          this.destinationFlags.set(ship.id(), flag);
          this.flags.append(flag);
        }
        const point = this.transform.worldToScreenCoordinates(
          new Cell(
            this.game.x(state.destination) + 0.5,
            this.game.y(state.destination) + 0.5,
          ),
        );
        flag.setAttribute("transform", `translate(${point.x} ${point.y})`);
      }
    for (const [id, flag] of this.destinationFlags)
      if (!active.has(id)) {
        flag.remove();
        this.destinationFlags.delete(id);
      }
  }

  tick(): void {
    this.paintDestinations();
    if (
      this.selecting &&
      (!this.ui.expeditionSelecting ||
        this.ui.ghostStructure !== null ||
        !this.game.myPlayer()?.isAlive())
    )
      this.cancel();
    if (this.selecting) this.paint();
  }
}
