import { afterEach, describe, expect, it, vi } from "vitest";
import { ExpeditionController } from "../../../src/client/controllers/ExpeditionController";
import {
  CloseViewEvent,
  MouseOverEvent,
  MouseUpEvent,
  StartExpeditionEvent,
} from "../../../src/client/InputHandler";
import { MapRenderer } from "../../../src/client/render/gl";
import { TransformHandler } from "../../../src/client/TransformHandler";
import { SendExpeditionIntentEvent } from "../../../src/client/Transport";
import { UIState } from "../../../src/client/UIState";
import { EventBus } from "../../../src/core/EventBus";
import { Cell, UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";
import { getDefaultKeybinds } from "../../../src/core/game/UserSettings";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  makeUnitUpdate,
  stubConfig,
} from "../../util/viewStubs";

vi.mock("../../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (n: bigint) => String(n),
}));
afterEach(() => {
  document.body.replaceChildren();
});
async function scene(ports = 1, fog = true) {
  const game = makeGameView({
    myClientID: "client-a",
    config: stubConfig({
      fogOfWar: () => fog,
      isReplay: () => false,
      isUnitDisabled: () => false,
    }),
  });
  const gu = makeEmptyGu(1);
  gu.updates[GameUpdateType.Player] = [makePlayerUpdate({ gold: 1_000_000n })];
  gu.updates[GameUpdateType.SpawnPhaseEnd] = [
    { type: GameUpdateType.SpawnPhaseEnd, startTick: 1 },
  ];
  gu.updates[GameUpdateType.Unit] = Array.from({ length: ports }, (_, i) =>
    makeUnitUpdate({ id: i + 1, pos: i + 5, unitType: UnitType.Port }),
  );
  game.update(gu);
  game.worker.playerBuildables = vi
    .fn()
    .mockResolvedValue([{ type: UnitType.ExpeditionShip, cost: 150_000n }]);
  const bus = new EventBus();
  const sent = vi.fn();
  bus.on(SendExpeditionIntentEvent, sent);
  const ui: UIState = {
    attackRatio: 20,
    ghostStructure: null,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  };
  const host = document.createElement("div");
  document.body.append(host);
  const transform = {
    scale: 1,
    screenToWorldCoordinates: (x: number, y: number) => new Cell(x, y),
    worldToScreenCoordinates: (c: Cell) => ({ x: c.x, y: c.y }),
  } as TransformHandler;
  const view = { showMoveIndicator: vi.fn() } as unknown as MapRenderer;
  const controller = new ExpeditionController(
    game,
    bus,
    ui,
    transform,
    view,
    host,
  );
  controller.init();
  controller.tick();
  await Promise.resolve();
  await Promise.resolve();
  return { game, bus, ui, host, sent, controller };
}
describe("expedition dispatch UI", () => {
  it("removes its listeners and selection cursor when the game ends", async () => {
    const { bus, controller, host, ui } = await scene();
    bus.emit(new StartExpeditionEvent());
    controller.dispose();
    bus.emit(new StartExpeditionEvent());
    expect(host.children).toHaveLength(0);
    expect(ui.expeditionSelecting).toBe(false);
    expect(host.style.cursor).toBe("");
  });
  it("uses N and dispatches directly to hidden coordinates with multiple ports", async () => {
    expect(getDefaultKeybinds(false).dispatchExpedition).toBe("KeyN");
    expect(getDefaultKeybinds(false).buildMIRV).toBe("Digit0");
    const { bus, ui, host, sent } = await scene(2);
    bus.emit(new StartExpeditionEvent());
    expect(ui.expeditionSelecting).toBe(true);
    const click = new MouseUpEvent(9, 9);
    bus.emit(click);
    expect(sent).toHaveBeenCalledExactlyOnceWith(
      new SendExpeditionIntentEvent(99),
    );
    expect(click.handled).toBe(true);
    expect(ui.expeditionSelecting).toBe(false);
    expect(host.querySelector("section")).toBeNull();
    expect(host.querySelectorAll("svg")[1]!.style.display).toBe("none");
    bus.emit(new MouseUpEvent(8, 8));
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it("previews a straight dashed route above fog with a large target marker", async () => {
    const { game, bus, host, controller } = await scene(2);
    vi.spyOn(game, "isWater").mockReturnValue(true);
    bus.emit(new StartExpeditionEvent());
    bus.emit(new MouseOverEvent(9, 9));
    const overlay = host.querySelectorAll("svg")[1]!;
    expect(overlay.style.display).toBe("block");
    expect(overlay.style.pointerEvents).toBe("none");
    expect(
      overlay.querySelector("path")!.getAttribute("stroke-dasharray"),
    ).toBe("9 7");
    expect(overlay.querySelector("path")!.getAttribute("d")).toBe(
      "M6.5 0.5L9.5 9.5",
    );
    expect(overlay.querySelector("g")!.getAttribute("transform")).toBe(
      "translate(9.5 9.5)",
    );
    bus.emit(new CloseViewEvent());
    expect(overlay.style.display).toBe("none");
    controller.dispose();
    expect(host.children).toHaveLength(0);
  });
  it("keeps destination flags after dispatch, follows the camera and clears each on arrival or sinking", async () => {
    const { game, bus, host, controller } = await scene();
    const sailing = {
      phase: "sailing" as const,
      originPort: 1,
      destination: 99,
      waitUntil: 0,
    };
    const update = (
      phase: "sailing" | "surveying" | "stranded",
      active = true,
    ) => {
      const gu = makeEmptyGu(game.ticks() + 1);
      gu.updates[GameUpdateType.Unit] = [
        makeUnitUpdate({
          id: 10,
          pos: 20,
          unitType: UnitType.ExpeditionShip,
          expeditionState: { ...sailing, phase },
        }),
        makeUnitUpdate({
          id: 11,
          pos: 30,
          unitType: UnitType.ExpeditionShip,
          expeditionState: { ...sailing, destination: 88 },
          isActive: active,
        }),
      ];
      game.update(gu);
      controller.tick();
    };
    update("sailing");
    const flags = host.querySelector("[data-expedition-destinations]")!;
    expect(flags.children).toHaveLength(2);
    expect(
      flags
        .querySelector('[data-expedition-ship="10"]')!
        .getAttribute("transform"),
    ).toBe("translate(9.5 9.5)");
    bus.emit(new StartExpeditionEvent());
    bus.emit(new CloseViewEvent());
    expect(flags.children).toHaveLength(2);
    // The same world destination is reprojected every tick during camera motion.
    const transform = (controller as unknown as { transform: TransformHandler })
      .transform;
    vi.spyOn(transform, "worldToScreenCoordinates").mockImplementation((c) => ({
      x: c.x * 2,
      y: c.y * 2,
    }));
    controller.tick();
    expect(
      flags
        .querySelector('[data-expedition-ship="10"]')!
        .getAttribute("transform"),
    ).toBe("translate(19 19)");
    update("stranded");
    expect(flags.children).toHaveLength(2);
    update("surveying");
    expect(flags.querySelector('[data-expedition-ship="10"]')).toBeNull();
    expect(flags.children).toHaveLength(1);
    update("surveying", false);
    expect(flags.children).toHaveLength(0);
    controller.dispose();
    expect(host.children).toHaveLength(0);
  });
  it("cancels before dispatch with Esc/right click or a second N press", async () => {
    const { bus, ui, sent } = await scene(2);
    bus.emit(new StartExpeditionEvent());
    bus.emit(new CloseViewEvent());
    expect(ui.expeditionSelecting).toBe(false);
    bus.emit(new MouseUpEvent(9, 9));
    expect(sent).not.toHaveBeenCalled();
    bus.emit(new StartExpeditionEvent());
    bus.emit(new StartExpeditionEvent());
    expect(ui.expeditionSelecting).toBe(false);
  });
  it("requires an own port and leaves ordinary games untouched", async () => {
    const missing = await scene(0);
    missing.bus.emit(new StartExpeditionEvent());
    expect(missing.ui.expeditionSelecting).toBeUndefined();
    const normal = await scene(1, false);
    normal.bus.emit(new StartExpeditionEvent());
    expect(normal.ui.expeditionSelecting).toBeUndefined();
    expect(normal.host.children).toHaveLength(0);
  });
  it("does not dispatch or consume ordinary clicks after switching units", async () => {
    const { bus, ui, sent, controller, host } = await scene();
    bus.emit(new StartExpeditionEvent());
    ui.expeditionSelecting = false;
    ui.ghostStructure = UnitType.Warship;
    controller.tick();
    const click = new MouseUpEvent(9, 9);
    bus.emit(click);
    expect(click.handled).toBe(false);
    expect(host.style.cursor).toBe("");
    expect(sent).not.toHaveBeenCalled();
  });
});
