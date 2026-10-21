import { afterEach, describe, expect, it, vi } from "vitest";
import { UnitDisplay } from "../../src/client/hud/layers/UnitDisplay";
import { StartExpeditionEvent } from "../../src/client/InputHandler";
import { UIState } from "../../src/client/UIState";
import { EventBus } from "../../src/core/EventBus";
import { UnitType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  makeUnitUpdate,
  stubConfig,
} from "../util/viewStubs";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string) => key,
  renderNumber: (n: number | bigint) => String(n),
}));
afterEach(() => document.body.replaceChildren());

async function scene(mirv = true, fog = true) {
  const game = makeGameView({
    myClientID: "client-a",
    config: stubConfig({
      fogOfWar: () => fog,
      isReplay: () => false,
      isUnitDisabled: (type) => !mirv && type === UnitType.MIRV,
    }),
  });
  const gu = makeEmptyGu(1);
  gu.updates[GameUpdateType.Player] = [makePlayerUpdate({ gold: 1_000_000n })];
  gu.updates[GameUpdateType.SpawnPhaseEnd] = [
    { type: GameUpdateType.SpawnPhaseEnd, startTick: 1 },
  ];
  gu.updates[GameUpdateType.Unit] = [
    makeUnitUpdate({ id: 1, pos: 5, unitType: UnitType.Port }),
    makeUnitUpdate({ id: 2, pos: 6, unitType: UnitType.ExpeditionShip }),
    makeUnitUpdate({ id: 3, pos: 7, unitType: UnitType.ExpeditionShip }),
  ];
  game.update(gu);
  game.worker.playerBuildables = vi
    .fn()
    .mockResolvedValue([{ type: UnitType.ExpeditionShip, cost: 150_000n }]);
  const display = new UnitDisplay();
  display.game = game;
  display.eventBus = new EventBus();
  display.uiState = {
    attackRatio: 20,
    ghostStructure: null,
    rocketDirectionUp: true,
    upgradeMultiplier: 1,
  } satisfies UIState;
  document.body.append(display);
  display.init();
  display.tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await display.updateComplete;
  return display;
}

describe("expedition hotbar", () => {
  it.each([true, false])(
    "uses the standard unit button at the far right (MIRV=%s)",
    async (mirv) => {
      const display = await scene(mirv);
      const items = [
        ...display.querySelectorAll<HTMLElement>("[data-unit-type]"),
      ];
      const ship = items[items.length - 1]!;
      expect(ship.dataset.unitType).toBe(UnitType.ExpeditionShip);
      expect(items[items.length - 2]!.dataset.unitType).toBe(
        mirv ? UnitType.MIRV : UnitType.HydrogenBomb,
      );
      const warship = items.find(
        (item) => item.dataset.unitType === UnitType.Warship,
      )!;
      expect(ship.firstElementChild!.className).toBe(
        warship.firstElementChild!.className,
      );
      expect(ship.querySelector("img")!.className).toBe(
        warship.querySelector("img")!.className,
      );
      expect(ship.textContent!.replace(/\s+/g, " ").trim()).toBe("N 2");
      const start = vi.fn();
      display.eventBus.on(StartExpeditionEvent, start);
      (ship.firstElementChild as HTMLElement).click();
      expect(start).toHaveBeenCalledTimes(1);
      ship.dispatchEvent(new MouseEvent("mouseenter"));
      await display.updateComplete;
      expect(ship.textContent).toContain("unit_type.expedition_ship [N]");
      expect(ship.textContent).toContain("build_menu.desc.expedition_ship");
      expect(ship.textContent).toContain("150000");
      expect(ship.textContent).not.toContain("/3");
    },
  );
  it("does not add the expedition button outside fog mode", async () => {
    const display = await scene(true, false);
    expect(
      display.querySelector('[data-unit-type="Expedition Ship"]'),
    ).toBeNull();
  });
});
