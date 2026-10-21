import { describe, expect, it } from "vitest";
import { computeFog } from "../src/core/game/FogOfWar";
import {
  canSeeTile,
  canSeeUnit,
  fogIntel,
  knownPlayers,
  knowsPlayer,
} from "../src/core/game/FogOfWarIntel";
import { Game, Player, UnitType } from "../src/core/game/Game";
import { GameImpl } from "../src/core/game/GameImpl";

import { intelScene } from "./util/FogAI";

function compare(game: Game, observer: Player) {
  const fog = computeFog(game, observer);
  const intel = fogIntel(game, observer);
  for (let tile = 0; tile < fog.brightness.length; tile++)
    expect(intel.visible(tile), `tile ${tile}`).toBe(fog.brightness[tile] > 0);
  expect(
    knownPlayers(game, observer)
      .map((p) => p.smallID())
      .sort(),
  ).toEqual([...fog.countries].sort());
}

describe("sparse fog intelligence", () => {
  it("matches the rendered fog for territorial sight, structures and moving vessels", async () => {
    const { game, a } = await intelScene();
    a.buildUnit(UnitType.City, game.ref(10, 100), {});
    a.buildUnit(UnitType.Warship, game.ref(90, 110), {
      patrolTile: game.ref(90, 110),
    });
    a.buildUnit(UnitType.ExpeditionShip, game.ref(140, 100), {
      expeditionState: {
        phase: "sailing",
        originPort: 1,
        destination: game.ref(180, 100),
        waitUntil: 0,
      },
    });
    compare(game, a);
  });
  it("matches the wider territorial sight of a large country", async () => {
    const { game, a } = await intelScene();
    for (let x = 0; x < 50; x++)
      for (let y = 0; y < 200; y++) a.conquer(game.ref(x, y));
    expect(a.numTilesOwned()).toBe(10_000);
    compare(game, a);
    expect(canSeeTile(game, a, game.ref(72, 100))).toBe(true);
    expect(canSeeTile(game, a, game.ref(73, 100))).toBe(false);
  });
  it("shares only direct alliances and follows moving sight on the next tick", async () => {
    const { game, a, b, c } = await intelScene();
    (game as GameImpl).createAllianceRequest(a, b)!.accept();
    (game as GameImpl).createAllianceRequest(b, c)!.accept();
    compare(game, a);
    expect(knowsPlayer(game, a, c)).toBe(false);
    const ship = a.buildUnit(UnitType.Warship, game.ref(170, 100), {
      patrolTile: game.ref(170, 100),
    });
    game.executeNextTick();
    expect(knowsPlayer(game, a, c)).toBe(true);
    ship.move(game.ref(10, 100));
    game.executeNextTick();
    expect(knowsPlayer(game, a, c)).toBe(false);
  });
  it("matches nuclear contact and surveying reciprocity, then withdraws them", async () => {
    const { game, a, b, c } = await intelScene();
    const ship = a.buildUnit(UnitType.ExpeditionShip, game.ref(90, 130), {
      expeditionState: {
        phase: "surveying",
        originPort: 1,
        destination: game.ref(90, 130),
        waitUntil: 600,
      },
    });
    const flash = game.ref(171, 100);
    game.setFallout(flash, true);
    game.revealNuclearFog([flash]);
    compare(game, b);
    expect(knowsPlayer(game, b, a)).toBe(true);
    expect(knowsPlayer(game, b, c)).toBe(true);
    ship.updateExpeditionState({
      ...ship.expeditionState()!,
      phase: "exploring",
    });
    for (let i = 0; i < 301; i++) game.executeNextTick();
    expect(knowsPlayer(game, b, a)).toBe(false);
    expect(knowsPlayer(game, b, c)).toBe(false);
  });
  it("does not apply any visibility restriction in ordinary games", async () => {
    const { game, a, c } = await intelScene(false);
    const ship = c.buildUnit(UnitType.Warship, game.ref(170, 100), {
      patrolTile: game.ref(170, 100),
    });
    expect(canSeeTile(game, a, game.ref(199, 199))).toBe(true);
    expect(canSeeUnit(game, a, ship)).toBe(true);
    expect(knowsPlayer(game, a, c)).toBe(true);
    expect(knownPlayers(game, a)).toEqual(game.players());
  });
});
