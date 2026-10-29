import { describe, expect, it } from "vitest";
import { ShellExecution } from "../src/core/execution/ShellExecution";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

describe("fog-only balance", () => {
  it.each([true, false])(
    "caps port costs without changing other structures (fog=%s)",
    async (fog) => {
      const game = await setup("plains", {
        fogOfWar: { enabled: fog },
        instantBuild: true,
      });
      const player = game.addPlayer(
        new PlayerInfo("builder", PlayerType.Human, "builder", "builder"),
      );
      player.conquer(game.ref(10, 10));
      player.addGold(100_000_000n);
      const port = game.unitInfo(UnitType.Port);
      expect(
        [0, 1, 2, 3, 8].map((extra) => port.cost(game, player, extra)),
      ).toEqual([
        125_000n,
        250_000n,
        500_000n,
        fog ? 500_000n : 1_000_000n,
        fog ? 500_000n : 1_000_000n,
      ]);
      // Ports and factories continue to share their existing price progression.
      for (let x = 0; x < 4; x++)
        player.buildUnit(UnitType.Factory, game.ref(x, 10), {});
      expect(port.cost(game, player)).toBe(fog ? 500_000n : 1_000_000n);
      expect(game.unitInfo(UnitType.Factory).cost(game, player)).toBe(
        1_000_000n,
      );
      expect(game.unitInfo(UnitType.City).cost(game, player, 8)).toBe(
        1_000_000n,
      );
    },
  );

  it("gives fog expedition ships warship health and lets them survive a shell", async () => {
    const game = await setup("half_land_half_ocean", {
      fogOfWar: { enabled: true },
    });
    const owner = game.addPlayer(
      new PlayerInfo("explorer", PlayerType.Human, "explorer", "explorer"),
    );
    const enemy = game.addPlayer(
      new PlayerInfo("enemy", PlayerType.Human, "enemy", "enemy"),
    );
    owner.conquer(game.ref(1, 1));
    enemy.conquer(game.ref(2, 2));
    const position = game.ref(11, 9);
    const ship = owner.buildUnit(UnitType.ExpeditionShip, position, {
      expeditionState: {
        phase: "sailing",
        originPort: 1,
        destination: position,
        waitUntil: 0,
      },
    });
    const warship = enemy.buildUnit(UnitType.Warship, position, {
      patrolTile: position,
    });
    expect(ship.health()).toBe(warship.health());
    expect(ship.maxHealth()).toBe(1000);
    game.addExecution(new ShellExecution(position, enemy, warship, ship));
    for (let i = 0; i < 3; i++) game.executeNextTick();
    expect(ship.health()).toBeLessThan(1000);
    expect(ship.isActive()).toBe(true);
  });

  it("retains the ordinary mode unit statistics", async () => {
    const game = await setup("plains");
    expect(game.unitInfo(UnitType.ExpeditionShip).maxHealth).toBe(250);
    expect(game.unitInfo(UnitType.Warship).maxHealth).toBe(1000);
  });
});
