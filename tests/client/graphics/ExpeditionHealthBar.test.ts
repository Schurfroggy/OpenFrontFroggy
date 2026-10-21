import { expect, it, vi } from "vitest";
import { BarPass } from "../../../src/client/render/gl/passes/BarPass";
import { UnitState } from "../../../src/client/render/types";
import { unitStateFromUpdate } from "../../../src/client/view/EntityState";
import { UnitType } from "../../../src/core/game/Game";
import { makeUnitUpdate } from "../../util/viewStubs";
it("uses the expedition's health ceiling without changing warship bars", () => {
  const pass = Object.create(BarPass.prototype) as BarPass;
  Object.assign(pass, {
    warshipMaxHealth: 1000,
    expeditionMaxHealth: 250,
    veterancyHealthBonus: 10,
  });
  const push = vi
    .spyOn(
      pass as unknown as {
        pushHealth: (unit: UnitState, progress: number) => void;
      },
      "pushHealth",
    )
    .mockImplementation(() => {});
  const ship = unitStateFromUpdate(
    makeUnitUpdate({ unitType: UnitType.ExpeditionShip, health: 250 }),
  );
  pass.updateBars(new Map([[ship.id, ship]]), new Map(), 0);
  expect(push).not.toHaveBeenCalled();
  ship.health = 125;
  pass.updateBars(new Map([[ship.id, ship]]), new Map(), 1);
  expect(push).toHaveBeenLastCalledWith(ship, 0.5);
  const warship = unitStateFromUpdate(
    makeUnitUpdate({ unitType: UnitType.Warship, health: 500 }),
  );
  pass.updateBars(new Map([[warship.id, warship]]), new Map(), 2);
  expect(push).toHaveBeenLastCalledWith(warship, 0.5);
});
