import { afterEach, describe, expect, it, vi } from "vitest";
import { computeFog } from "../src/core/game/FogOfWar";
import {
  canSeeTile,
  canSeeUnit,
  FOG_AI_CONTACT_REFRESH_TICKS,
  FogIntel,
  knownPlayers,
  knowsPlayer,
  snapshotFogAIContacts,
} from "../src/core/game/FogOfWarIntel";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { GameSnapshot } from "../src/core/game/GameImpl";
import {
  snapshotGame,
  snapshotGameData,
} from "../src/core/snapshot/GameSnapshot";
import { readVersioned } from "../src/core/snapshot/SnapshotType";
import { intelScene } from "./util/FogAI";
import { roundTrip } from "./util/Snapshot";

describe("staggered fog AI strategic contacts", () => {
  afterEach(() => vi.restoreAllMocks());
  it("refreshes five active AI on five distinct ticks before their strategic queries", async () => {
    const { game, a, b, c, add } = await intelScene();
    const observers = [a, b, c, add("d", 10, 30), add("e", 90, 30)];
    const target = game.addPlayer(
      new PlayerInfo("human", PlayerType.Human, "human", "human"),
    );
    target.conquer(game.ref(190, 190));
    target.setSpawnTile(game.ref(190, 190));
    for (const observer of observers)
      expect(knowsPlayer(game, observer, target)).toBe(false);
    game.executeNextTick();
    for (const observer of observers)
      observer.buildUnit(UnitType.Warship, target.spawnTile()!, {
        patrolTile: target.spawnTile()!,
      });

    const scan = vi.spyOn(FogIntel.prototype, "knows");
    const discovered: number[] = [];
    for (let i = 0; i < 15; i++) {
      const tick = game.ticks();
      for (const observer of observers) knowsPlayer(game, observer, target);
      scan.mockClear();
      game.executeNextTick();
      // One observer rebuilds its list per tick, rather than five rebuilding
      // together every fifth tick. Refresh work precedes this tick's queries.
      expect(scan).toHaveBeenCalledTimes(game.players().length);
      const updated = snapshotFogAIContacts(game).filter(
        (entry) =>
          entry.nextRefreshTick === tick + FOG_AI_CONTACT_REFRESH_TICKS,
      );
      expect(updated).toHaveLength(1);
      expect(updated[0].observer % 5).toBe(tick % 5);
      if (i < 5) discovered.push(updated[0].observer);
      if (i === 4) {
        for (const observer of observers) {
          expect(knowsPlayer(game, observer, target)).toBe(true);
          expect(knownPlayers(game, observer)).toContain(target);
        }
        // Repeated strategic queries do not build current-tick FogIntel.
        expect(scan).toHaveBeenCalledTimes(game.players().length);
      }
    }
    expect(new Set(discovered).size).toBe(5);
  });

  it("retains lost country contacts until the next slot, but updates tile and unit sight immediately", async () => {
    const { game, a, c } = await intelScene();
    const ship = a.buildUnit(UnitType.Warship, c.spawnTile()!, {
      patrolTile: c.spawnTile()!,
    });
    const enemy = c.buildUnit(UnitType.Warship, c.spawnTile()!, {
      patrolTile: c.spawnTile()!,
    });
    expect(knowsPlayer(game, a, c)).toBe(true);
    const firstSlot = snapshotFogAIContacts(game)[0].nextRefreshTick;
    while (game.ticks() <= firstSlot) {
      knowsPlayer(game, a, c);
      game.executeNextTick();
    }
    const deadline = snapshotFogAIContacts(game)[0].nextRefreshTick;
    ship.move(a.spawnTile()!);
    expect(canSeeTile(game, a, c.spawnTile()!)).toBe(false);
    expect(canSeeUnit(game, a, enemy)).toBe(false);
    expect(computeFog(game, a).countries.has(c.smallID())).toBe(false);
    while (game.ticks() <= deadline) {
      expect(knowsPlayer(game, a, c)).toBe(true);
      expect(knownPlayers(game, a)).toContain(c);
      game.executeNextTick();
    }
    expect(knowsPlayer(game, a, c)).toBe(false);
    expect(knownPlayers(game, a)).not.toContain(c);
  });

  it("keeps human country information on the current tick", async () => {
    const { game, c } = await intelScene();
    const human = game.addPlayer(
      new PlayerInfo("human", PlayerType.Human, "human", "human"),
    );
    human.conquer(game.ref(10, 20));
    human.setSpawnTile(game.ref(10, 20));
    const ship = human.buildUnit(UnitType.Warship, c.spawnTile()!, {
      patrolTile: c.spawnTile()!,
    });
    expect(knowsPlayer(game, human, c)).toBe(true);
    ship.move(human.spawnTile()!);
    game.executeNextTick();
    expect(knowsPlayer(game, human, c)).toBe(false);
    expect(knownPlayers(game, human)).not.toContain(c);
    expect(snapshotFogAIContacts(game)).toEqual([]);
  });

  it("also staggers tribe intelligence and leaves ordinary games untouched", async () => {
    for (const fog of [true, false]) {
      const { game, c } = await intelScene(fog);
      const bot = game.addPlayer(
        new PlayerInfo("bot", PlayerType.Bot, null, "bot"),
      );
      bot.conquer(game.ref(10, 20));
      bot.setSpawnTile(game.ref(10, 20));
      expect(knowsPlayer(game, bot, c)).toBe(!fog);
      expect(knownPlayers(game, bot).includes(c)).toBe(!fog);
      expect(snapshotFogAIContacts(game)).toHaveLength(fog ? 1 : 0);
    }
  });

  it("preserves stale observations and refresh deadlines across snapshot restore", async () => {
    const { game, a, c } = await intelScene();
    const ship = a.buildUnit(UnitType.Warship, c.spawnTile()!, {
      patrolTile: c.spawnTile()!,
    });
    expect(knowsPlayer(game, a, c)).toBe(true);
    const firstSlot = snapshotFogAIContacts(game)[0].nextRefreshTick;
    while (game.ticks() <= firstSlot) {
      knowsPlayer(game, a, c);
      game.executeNextTick();
    }
    ship.move(a.spawnTile()!);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    expect(snapshotFogAIContacts(restored)).toEqual(
      snapshotFogAIContacts(game),
    );
    expect(canSeeTile(restored, restored.player(a.id()), c.spawnTile()!)).toBe(
      false,
    );
    expect(
      knowsPlayer(restored, restored.player(a.id()), restored.player(c.id())),
    ).toBe(true);
    for (let i = 0; i < 12; i++) {
      game.executeNextTick();
      restored.executeNextTick();
      expect(
        knowsPlayer(restored, restored.player(a.id()), restored.player(c.id())),
      ).toBe(knowsPlayer(game, a, c));
      expect(snapshotGame(restored)).toEqual(snapshotGame(game));
    }
    expect(knowsPlayer(game, a, c)).toBe(false);
  });

  it("migrates older game snapshots with no remembered AI contacts", async () => {
    const { game } = await intelScene();
    const current = readVersioned(GameSnapshot, snapshotGameData(game).game);
    const { fogAIContacts: _contacts, ...old } = current;
    expect(_contacts).toEqual([]);
    expect(readVersioned(GameSnapshot, { v: 2, d: old })).toEqual(current);
  });

  it("does not repeatedly scan for an idle AI, and refreshes on reuse after a long gap", async () => {
    const { game, a, c } = await intelScene();
    expect(knowsPlayer(game, a, c)).toBe(false);
    a.buildUnit(UnitType.Warship, c.spawnTile()!, {
      patrolTile: c.spawnTile()!,
    });
    const scan = vi.spyOn(FogIntel.prototype, "knows");
    for (let i = 0; i < 20; i++) game.executeNextTick();
    expect(scan).not.toHaveBeenCalled();
    expect(knowsPlayer(game, a, c)).toBe(true);
    expect(scan).toHaveBeenCalledTimes(game.players().length);
  });
});
