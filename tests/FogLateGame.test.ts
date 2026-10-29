import { describe, expect, it } from "vitest";
import { computeFog, fogAllowsIntent } from "../src/core/game/FogOfWar";
import {
  canSeeTile,
  canSeeUnit,
  knownPlayers,
  knowsPlayer,
} from "../src/core/game/FogOfWarIntel";
import { Game, PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import {
  fogAmbientBrightness,
  fogHasGlobalVision,
} from "../src/core/game/GamePhases";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

function advanceTo(game: Game, seconds: number) {
  while (game.elapsedGameSeconds() < seconds) game.executeNextTick();
}

async function scene(fog = true) {
  const game = await setup("big_plains", {
    fogOfWar: { enabled: fog },
    instantBuild: true,
  });
  const human = game.addPlayer(
    new PlayerInfo("human", PlayerType.Human, "human", "human"),
  );
  const ai = game.addPlayer(
    new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
  );
  human.conquer(game.ref(10, 100));
  human.setSpawnTile(game.ref(10, 100));
  ai.conquer(game.ref(170, 100));
  ai.setSpawnTile(game.ref(170, 100));
  const ship = ai.buildUnit(UnitType.Warship, game.ref(160, 100), {
    patrolTile: game.ref(160, 100),
  });
  return { game, human, ai, ship };
}

describe("late-game fog light", () => {
  it.each([
    [899.9, 0],
    [900, 2],
    [1199.9, 2],
    [1200, 4],
    [1499.9, 4],
    [1500, 6],
    [1800, 8],
    [3000, 16],
    [6000, 16],
  ])(
    "uses level %s seconds -> %s, independent of audio playback",
    (seconds, light) => {
      expect(fogAmbientBrightness(seconds)).toBe(light);
      expect(fogHasGlobalVision(seconds)).toBe(light > 5);
    },
  );

  it("unlocks human inputs and AI intelligence together, preserving local sight before then", async () => {
    const { game, human, ai, ship } = await scene();
    const destination = ai.spawnTile()!;
    for (const seconds of [899.9, 900, 1200, 1499.9, 1500, 3000]) {
      advanceTo(game, seconds);
      const unlocked = seconds >= 1500;
      const fog = computeFog(game, human);
      expect(fog.brightness[destination] > 0).toBe(unlocked);
      expect(fog.brightness[game.ref(24, 100)]).toBeGreaterThan(0);
      expect(fog.countries.has(ai.smallID())).toBe(unlocked);
      expect(canSeeTile(game, human, destination)).toBe(unlocked);
      expect(canSeeUnit(game, human, ship)).toBe(unlocked);
      expect(knowsPlayer(game, ai, human)).toBe(unlocked);
      expect(canSeeTile(game, ai, human.spawnTile()!)).toBe(unlocked);
      expect(knownPlayers(game, ai).includes(human)).toBe(unlocked);
      expect(
        fogAllowsIntent(game, human, {
          clientID: "human",
          type: "boat",
          troops: 1000,
          dst: destination,
        }),
      ).toBe(unlocked);
      expect(
        fogAllowsIntent(game, human, {
          clientID: "human",
          type: "build_unit",
          unit: UnitType.City,
          tile: destination,
        }),
      ).toBe(unlocked);
      expect(
        fogAllowsIntent(game, human, {
          clientID: "human",
          type: "build_unit",
          unit: UnitType.AtomBomb,
          tile: destination,
        }),
      ).toBe(true);
      expect(
        fogAllowsIntent(game, human, {
          clientID: "human",
          type: "expedition",
          target: destination,
        }),
      ).toBe(true);
      if (unlocked)
        expect(Math.min(...fog.brightness)).toBe(fogAmbientBrightness(seconds));
    }
  });

  it("counts from the end of spawn selection and survives snapshot restore", async () => {
    const { game, human } = await scene();
    advanceTo(game, 1200);
    const { restored } = await roundTrip(game, "big_plains");
    expect(restored.elapsedGameSeconds()).toBe(1200);
    expect(
      computeFog(restored, restored.player(human.id())).brightness,
    ).toEqual(computeFog(game, human).brightness);
    advanceTo(restored, 1500);
    expect(
      knowsPlayer(
        restored,
        restored.player("nation"),
        restored.player("human"),
      ),
    ).toBe(true);
    const selecting = await setup(
      "plains",
      { fogOfWar: { enabled: true } },
      [],
      undefined,
      undefined,
      false,
    );
    for (let i = 0; i < 9000; i++) selecting.executeNextTick();
    expect(selecting.elapsedGameSeconds()).toBe(0);
    selecting.endSpawnPhase();
    expect(fogAmbientBrightness(selecting.elapsedGameSeconds())).toBe(0);
  });

  it("does not introduce a fog floor in ordinary games", async () => {
    const { game, human } = await scene(false);
    advanceTo(game, 3000);
    expect(computeFog(game, human).brightness[game.ref(170, 100)]).toBe(0);
    expect(canSeeTile(game, human, game.ref(170, 100))).toBe(true);
  });
});
