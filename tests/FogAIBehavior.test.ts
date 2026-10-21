import { describe, expect, it, vi } from "vitest";
import { NationAllianceBehavior } from "../src/core/execution/nation/NationAllianceBehavior";
import { NationEmojiBehavior } from "../src/core/execution/nation/NationEmojiBehavior";
import {
  initialFogAIState,
  maybeDispatchExpedition,
} from "../src/core/execution/nation/NationExpeditionBehavior";
import { NationMIRVBehavior } from "../src/core/execution/nation/NationMIRVBehavior";
import { NationNukeBehavior } from "../src/core/execution/nation/NationNukeBehavior";
import { findRunawayLeader } from "../src/core/execution/nation/NationUtils";
import { NationWarshipBehavior } from "../src/core/execution/nation/NationWarshipBehavior";
import { NationExecution } from "../src/core/execution/NationExecution";
import { AiAttackBehavior } from "../src/core/execution/utils/AiAttackBehavior";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import { canSeeTile, knowsPlayer } from "../src/core/game/FogOfWarIntel";
import {
  Cell,
  Difficulty,
  Game,
  Nation,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameImpl } from "../src/core/game/GameImpl";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { snapshotGame } from "../src/core/snapshot/GameSnapshot";
import { intelScene } from "./util/FogAI";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

function behaviors(game: Game, player: Player) {
  const random = new PseudoRandom(42);
  const emoji = new NationEmojiBehavior(random, game, player);
  const alliance = new NationAllianceBehavior(random, game, player, emoji);
  const attack = new AiAttackBehavior(
    random,
    game,
    player,
    0.5,
    0.3,
    0.1,
    alliance,
    emoji,
  );
  const nuke = new NationNukeBehavior(random, game, player, attack, emoji);
  const mirv = new NationMIRVBehavior(random, game, player, emoji);
  const navy = new NationWarshipBehavior(random, game, player, emoji);
  return { random, emoji, alliance, attack, nuke, mirv, navy };
}

describe("fog-only AI decisions", () => {
  it("does not target or rank an unknown country, even when its hidden strength changes", async () => {
    const { game, a, c } = await intelScene();
    const { attack, nuke } = behaviors(game, a);
    expect(attack.shouldAttack(c)).toBe(false);
    expect(attack.sendAttack(c, true)).toBe(false);
    expect(nuke.findBestNukeTarget()).toBeNull();
    for (let x = 150; x < 195; x++)
      for (let y = 60; y < 140; y++) c.conquer(game.ref(x, y));
    c.setTroops(1_000_000);
    game.executeNextTick();
    expect(findRunawayLeader(game, a)).toBeNull();
    expect(nuke.findBestNukeTarget()).toBeNull();
    a.buildUnit(UnitType.Warship, game.ref(150, 100), {
      patrolTile: game.ref(150, 100),
    });
    game.executeNextTick();
    expect(knowsPlayer(game, a, c)).toBe(true);
    expect(nuke.findBestNukeTarget()).toBe(c);
  });
  it("knowing a country does not expose its hidden coast or buildings to targeting", async () => {
    const { game, a, b } = await intelScene();
    for (let x = 89; x <= 91; x++)
      for (let y = 99; y <= 101; y++) b.conquer(game.ref(x, y));
    b.buildUnit(UnitType.City, b.spawnTile()!, {});
    b.conquer(game.ref(90, 180));
    const hidden = b.buildUnit(UnitType.City, game.ref(90, 180), {});
    a.buildUnit(UnitType.MissileSilo, a.spawnTile()!, {});
    a.buildUnit(UnitType.Warship, game.ref(80, 100), {
      patrolTile: game.ref(80, 100),
    });
    const { attack, nuke } = behaviors(game, a);
    expect(knowsPlayer(game, a, b)).toBe(true);
    expect(canSeeTile(game, a, hidden.tile())).toBe(false);
    expect((attack as any).shoreTiles(b)).not.toContain(hidden.tile());
    const score = vi.spyOn(nuke as any, "nukeTileScore");
    nuke.maybeSendNuke();
    expect(score).toHaveBeenCalled();
    for (const [tile, , targets] of score.mock.calls as [
      number,
      unknown,
      { tile(): number }[],
    ][]) {
      expect(canSeeTile(game, a, tile)).toBe(true);
      expect(targets).not.toContain(hidden);
    }
  });
  it.each([true, false])(
    "SAM assessments ignore hidden launchers only in fog (fog=%s)",
    async (fog) => {
      const { game, a, b } = await intelScene(fog);
      const sam = b.buildUnit(UnitType.SAMLauncher, b.spawnTile()!, {});
      const { nuke } = behaviors(game, a);
      const covering = (nuke as any).findEnemySamsCoveringTile(sam.tile());
      expect(covering.includes(sam)).toBe(!fog);
    },
  );
  it("does not choose MIRV targets from hidden incoming missiles", async () => {
    const { game, a, c } = await intelScene();
    a.buildUnit(UnitType.MissileSilo, a.spawnTile()!, {});
    c.buildUnit(UnitType.MIRV, c.spawnTile()!, { targetTile: a.spawnTile()! });
    const { mirv } = behaviors(game, a);
    const sent = vi.spyOn(game, "addExecution");
    expect(mirv.considerMIRV()).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });
  it("aims MIRVs at observed territory rather than the hidden national center", async () => {
    const { game, a, c } = await intelScene(true, Difficulty.Impossible);
    for (let x = 120; x < 200; x++)
      for (let y = 0; y < 200; y++) c.conquer(game.ref(x, y));
    a.addGold(100_000_000n);
    a.buildUnit(UnitType.MissileSilo, a.spawnTile()!, {});
    a.buildUnit(UnitType.Warship, game.ref(125, 100), {
      patrolTile: game.ref(125, 100),
    });
    const { mirv } = behaviors(game, a),
      sent = vi.spyOn(game, "addExecution");
    expect(mirv.considerMIRV()).toBe(true);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(canSeeTile(game, a, (sent.mock.calls[0][0] as any).dst)).toBe(true);
    expect((sent.mock.calls[0][0] as any).dst).not.toBe(game.ref(160, 100));
  });
  it.each([true, false])(
    "uses only observed warships for route risk in fog (fog=%s)",
    async (fog) => {
      const { game, a, b } = await intelScene(fog);
      const hidden = b.buildUnit(UnitType.Warship, b.spawnTile()!, {
        patrolTile: b.spawnTile()!,
      });
      const { attack } = behaviors(game, a);
      expect((attack as any).hostileWarships().includes(hidden)).toBe(!fog);
    },
  );
  it("uses received requests without reading an unknown sender's army", async () => {
    const { game, a, c } = await intelScene();
    const { alliance } = behaviors(game, a);
    const troops = vi.spyOn(c, "troops").mockImplementation(() => {
      throw new Error("hidden army");
    });
    expect((alliance as any).getAllianceDecision(c, false)).toBe(false);
    expect(() => (alliance as any).getAllianceDecision(c, true)).not.toThrow();
    expect(troops).not.toHaveBeenCalled();
  });
  it("does not use hidden transport destinations as naval early warning", async () => {
    const { game, a, b } = await intelScene();
    const ship = b.buildUnit(UnitType.TransportShip, b.spawnTile()!, {
      troops: 100,
      targetTile: a.spawnTile()!,
    });
    const destination = vi.spyOn(ship, "targetTile").mockImplementation(() => {
      throw new Error("hidden destination");
    });
    const { navy } = behaviors(game, a);
    const retaliation = vi
      .spyOn(navy as any, "maybeRetaliateWithWarship")
      .mockImplementation(() => {});
    navy.trackShipsAndRetaliate();
    expect(retaliation).not.toHaveBeenCalled();
    a.buildUnit(UnitType.Warship, game.ref(80, 100), {
      patrolTile: game.ref(80, 100),
    });
    game.executeNextTick();
    navy.trackShipsAndRetaliate();
    expect(retaliation).toHaveBeenCalledWith(ship.tile(), b, "transport");
    expect(destination).not.toHaveBeenCalled();
  });
  it.each([PlayerType.Human, PlayerType.Nation])(
    "limits %s warship acquisition to current shared vision",
    async (type) => {
      const { game, b, c } = await intelScene();
      const owner = game.addPlayer(
        new PlayerInfo("sentry", type, null, "dddddddd"),
      );
      owner.conquer(game.ref(10, 30));
      owner.setSpawnTile(game.ref(10, 30));
      owner.addGold(30_000_000n);
      const ours = owner.buildUnit(UnitType.Warship, game.ref(20, 30), {
        patrolTile: game.ref(20, 30),
      });
      const enemy = b.buildUnit(UnitType.Warship, game.ref(90, 30), {
        patrolTile: game.ref(90, 30),
      });
      const execution = new WarshipExecution(ours);
      execution.init(game, game.ticks());
      expect((execution as any).findTargetUnit()).toBeUndefined();
      (game as GameImpl).createAllianceRequest(owner, c)!.accept();
      c.buildUnit(UnitType.Warship, game.ref(85, 30), {
        patrolTile: game.ref(85, 30),
      });
      game.executeNextTick();
      expect((execution as any).findTargetUnit()).toBe(enemy);
    },
  );
  it("reserves ten extra percentage points of troop capacity for overseas attacks only in fog", async () => {
    for (const fog of [true, false]) {
      const { game, a } = await intelScene(fog);
      const { attack } = behaviors(game, a);
      const cap = (attack as any).fogBoatCap();
      expect(cap).toBe(
        fog
          ? Math.max(0, a.troops() - game.config().maxTroops(a) * 0.4)
          : Infinity,
      );
    }
  });
  it("dispatches a budgeted exploratory voyage to an unknown direction and respects its cooldown", async () => {
    const { game, a } = await intelScene();
    game.setWater(game.ref(11, 100));
    a.buildUnit(UnitType.Port, a.spawnTile()!, {});
    const state = initialFogAIState(),
      random = new PseudoRandom(11);
    const sent = vi.spyOn(game, "addExecution");
    expect(maybeDispatchExpedition(game, a, random, state)).toBe(true);
    expect(state.directions).toHaveLength(1);
    expect(state.nextExpeditionTick).toBe(game.ticks() + 600);
    const target = (sent.mock.calls[0][0] as any).target;
    expect(canSeeTile(game, a, target)).toBe(false);
    expect(maybeDispatchExpedition(game, a, random, state)).toBe(false);
    expect(sent).toHaveBeenCalledTimes(1);
  });
  it("preserves defense funds and avoids repeatedly choosing the same exploration directions", async () => {
    const { game, a } = await intelScene();
    game.setWater(game.ref(11, 100));
    a.buildUnit(UnitType.Port, a.spawnTile()!, {});
    a.removeGold(a.gold());
    a.addGold(399_999n);
    const state = initialFogAIState(),
      random = new PseudoRandom(7),
      sent = vi.spyOn(game, "addExecution");
    expect(maybeDispatchExpedition(game, a, random, state)).toBe(false);
    expect(sent).not.toHaveBeenCalled();
    a.addGold(2_000_000n);
    state.nextExpeditionTick = 0;
    state.directions = [1, 2, 3, 4];
    expect(maybeDispatchExpedition(game, a, random, state)).toBe(true);
    expect([1, 2, 3, 4]).not.toContain(
      state.directions[state.directions.length - 1],
    );
  });
  it("leaves ordinary-mode exploration and its random stream untouched", async () => {
    const { game, a } = await intelScene(false);
    const state = initialFogAIState(),
      random = new PseudoRandom(11),
      before = random.getState();
    expect(maybeDispatchExpedition(game, a, random, state)).toBe(false);
    expect(state).toEqual(initialFogAIState());
    expect(random.getState()).toEqual(before);
  });
  it("does not count hidden third-party armies when looking for a weakened target", async () => {
    const { game, a, b, c } = await intelScene();
    const { attack } = behaviors(game, a);
    const hiddenTroops = vi.fn(() => {
      throw new Error("unseen battle");
    });
    vi.spyOn(b, "incomingAttacks").mockReturnValue([
      { attacker: () => c, sourceTile: () => null, troops: hiddenTroops },
    ] as any);
    expect((attack as any).troopsAttacking(b)).toBe(0);
    expect(hiddenTroops).not.toHaveBeenCalled();
  });
  it("a running fog nation dispatches voyages and resumes the same economy and navigation after loading", async () => {
    const game = await setup("big_plains", {
      fogOfWar: { enabled: true },
      instantBuild: true,
      disabledUnits: [UnitType.AtomBomb, UnitType.HydrogenBomb, UnitType.MIRV],
    });
    for (let y = 90; y < 110; y++)
      for (let x = 11; x < 200; x++) game.setWater(game.ref(x, y));
    const mini = game.miniMap();
    for (let y = 45; y < 55; y++)
      for (let x = 5; x < 100; x++) mini.setWater(mini.ref(x, y));
    const info = new PlayerInfo(
      "Explorer AI",
      PlayerType.Nation,
      null,
      "explorer-ai",
    );
    const player = game.addPlayer(info);
    player.conquer(game.ref(10, 100));
    player.setSpawnTile(game.ref(10, 100));
    player.setTroops(100_000);
    player.addGold(30_000_000n);
    player.buildUnit(UnitType.Port, player.spawnTile()!, {});
    const execution = new NationExecution(
      "fog-sea",
      new Nation(new Cell(10, 100), info),
    );
    game.addExecution(execution);
    for (let i = 0; i < 200; i++) game.executeNextTick();
    expect(player.unitsConstructed(UnitType.ExpeditionShip)).toBeGreaterThan(0);
    expect((execution as any).fogAI.directions.length).toBeGreaterThan(0);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    for (let i = 0; i < 100; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  });
  it.each([true, false])(
    "paces nuclear decisions only in fog (fog=%s)",
    async (fog) => {
      const { game, a } = await intelScene(fog);
      const execution = new NationExecution(
        "fog-pacing",
        new Nation(
          new Cell(10, 100),
          new PlayerInfo(a.id(), PlayerType.Nation, null, a.id()),
        ),
      );
      game.addExecution(execution);
      for (let i = 0; i < 4; i++) game.executeNextTick();
      const actor = execution as any;
      vi.spyOn(actor.mirvBehavior, "considerMIRV").mockReturnValue(false);
      vi.spyOn(actor.structureBehavior, "handleStructures").mockImplementation(
        () => {},
      );
      vi.spyOn(actor.attackBehavior, "maybeAttack").mockImplementation(
        () => {},
      );
      const decisions: number[] = [];
      vi.spyOn(actor.nukeBehavior, "maybeSendNuke").mockImplementation(() => {
        decisions.push(game.ticks());
      });
      for (let i = 0; i < 600; i++) game.executeNextTick();
      expect(decisions.length).toBeGreaterThan(1);
      for (let i = 1; i < decisions.length; i++) {
        if (fog)
          expect(decisions[i] - decisions[i - 1]).toBeGreaterThanOrEqual(150);
        else expect(decisions[i] - decisions[i - 1]).toBeLessThan(150);
      }
    },
  );
  it("persists fog decision deadlines and exploration history through deterministic continuation", async () => {
    const { game, a } = await intelScene();
    const nation = new Nation(
      new Cell(10, 100),
      new PlayerInfo(a.id(), PlayerType.Nation, null, a.id()),
    );
    const execution = new NationExecution("fog-ai-snapshot", nation);
    game.addExecution(execution);
    for (let i = 0; i < 4; i++) game.executeNextTick();
    (execution as any).fogAI = {
      nextNuclearTick: game.ticks() + 150,
      nextExpeditionTick: game.ticks() + 600,
      directions: [1, 3],
    };
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    for (let i = 0; i < 200; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect(snapshotGame(restored)).toEqual(snapshotGame(game));
  });
});
