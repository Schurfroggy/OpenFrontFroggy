import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { BoatRetreatExecution } from "../src/core/execution/BoatRetreatExecution";
import { DeleteUnitExecution } from "../src/core/execution/DeleteUnitExecution";
import {
  EXPEDITION_WAIT_TICKS,
  ExpeditionShipExecution,
} from "../src/core/execution/ExpeditionShipExecution";
import { MoveWarshipExecution } from "../src/core/execution/MoveWarshipExecution";
import { WarshipExecution } from "../src/core/execution/WarshipExecution";
import { computeFog } from "../src/core/game/FogOfWar";
import { PlayerInfo, PlayerType, UnitType } from "../src/core/game/Game";
import { GameImpl, createGame } from "../src/core/game/GameImpl";
import { GameMapImpl } from "../src/core/game/GameMap";
import { UserSettings } from "../src/core/game/UserSettings";
import { ExpeditionIntentSchema } from "../src/core/Schemas";
import { decodeClientMessage, encodeClientMessage } from "../src/core/ZbinWire";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

async function scene(fog = true, large = false) {
  const game = (await setup(large ? "big_plains" : "half_land_half_ocean", {
    fogOfWar: { enabled: fog },
    instantBuild: true,
  })) as GameImpl;
  if (large)
    for (let y = 0; y < game.height(); y++)
      for (let x = 120; x < game.width(); x++) game.setWater(game.ref(x, y));
  if (large)
    for (let y = 0; y < game.miniMap().height(); y++)
      for (let x = 60; x < game.miniMap().width(); x++)
        game.miniMap().setWater(game.miniMap().ref(x, y));
  const owner = game.addPlayer(
    new PlayerInfo("Explorer", PlayerType.Human, "aaaaaaaa", "aaaaaaaa"),
  );
  const x = large ? 119 : 7,
    y = large ? 100 : 8;
  owner.conquer(game.ref(x, y));
  owner.setSpawnTile(game.ref(x, y));
  owner.setTroops(10000);
  owner.addGold(2_000_000n);
  const port = owner.buildUnit(UnitType.Port, game.ref(x, y), {});
  const dispatch = (target = game.ref(large ? 180 : 14, y)) => {
    game.addExecution(new ExpeditionShipExecution(owner, target));
    game.executeNextTick();
    const ships = owner.units(UnitType.ExpeditionShip);
    return ships[ships.length - 1]!;
  };
  return { game, owner, port, dispatch };
}
const ticks = (game: GameImpl, n: number) => {
  for (let i = 0; i < n; i++) game.executeNextTick();
};

describe("one-way expedition ships", () => {
  it("round trips the dispatch wire message and rejects malformed coordinates", () => {
    const message = {
      type: "intent" as const,
      intent: { type: "expedition" as const, target: 400 },
    };
    expect(
      decodeClientMessage(encodeClientMessage(message, undefined), undefined),
    ).toEqual(message);
    expect(
      ExpeditionIntentSchema.safeParse({ ...message.intent, target: -1 })
        .success,
    ).toBe(false);
    expect(
      ExpeditionIntentSchema.safeParse({ ...message.intent, target: 1.5 })
        .success,
    ).toBe(false);
  });
  it("repairs a coarse route around a small island without crossing land", async () => {
    const base = await scene();
    const ocean = (size: number) => {
      const bytes = new Uint8Array(size * size).fill(128);
      for (let y = 0; y < size; y++)
        for (let x = size / 2; x < size; x++) bytes[y * size + x] = 0;
      if (size === 32) bytes[16 * 32 + 22] = 128; // Too small to appear in the coarse navigation map.
      return new GameMapImpl(
        size,
        size,
        bytes,
        (size * size) / 2 + (size === 32 ? 1 : 0),
      );
    };
    const config = new Config(
      { ...base.game.config().gameConfig(), disableNavMesh: false },
      new UserSettings(),
      false,
    );
    const game = createGame([], [], ocean(32), ocean(16), config) as GameImpl;
    game.endSpawnPhase();
    const owner = game.addPlayer(
      new PlayerInfo("Explorer", PlayerType.Human, "cccccccc", "cccccccc"),
    );
    owner.conquer(game.ref(15, 16));
    owner.setSpawnTile(game.ref(15, 16));
    owner.addGold(1_000_000n);
    owner.buildUnit(UnitType.Port, game.ref(15, 16), {});
    game.addExecution(new ExpeditionShipExecution(owner, game.ref(28, 16)));
    ticks(game, 1);
    const ship = owner.units(UnitType.ExpeditionShip)[0];
    for (
      let i = 0;
      i < 80 && ship.expeditionState()!.phase !== "surveying";
      i++
    ) {
      ticks(game, 1);
      expect(game.isWater(ship.tile())).toBe(true);
    }
    expect(ship.tile()).toBe(game.ref(28, 16));
    expect(ship.expeditionState()!.phase).toBe("surveying");
  });
  it("approaches a disconnected lake from the reachable ocean", async () => {
    const base = await scene();
    const terrain = (size: number) => {
      const bytes = new Uint8Array(size * size).fill(128);
      for (let y = 0; y < size; y++)
        for (let x = size / 2; x < size; x++) bytes[y * size + x] = 0;
      for (let y = size / 16; y < (size * 3) / 16; y++)
        for (let x = size / 16; x < (size * 3) / 16; x++)
          bytes[y * size + x] = 0;
      return new GameMapImpl(
        size,
        size,
        bytes,
        (size * size) / 2 - (size * size) / 64,
      );
    };
    const config = new Config(
      { ...base.game.config().gameConfig(), disableNavMesh: false },
      new UserSettings(),
      false,
    );
    const game = createGame(
      [],
      [],
      terrain(32),
      terrain(16),
      config,
    ) as GameImpl;
    game.endSpawnPhase();
    const owner = game.addPlayer(
      new PlayerInfo("Explorer", PlayerType.Human, "cccccccc", "cccccccc"),
    );
    owner.conquer(game.ref(15, 16));
    owner.setSpawnTile(game.ref(15, 16));
    owner.addGold(1_000_000n);
    owner.buildUnit(UnitType.Port, game.ref(15, 16), {});
    game.addExecution(new ExpeditionShipExecution(owner, game.ref(3, 3)));
    ticks(game, 80);
    const ship = owner.units(UnitType.ExpeditionShip)[0];
    expect(game.getWaterComponent(game.ref(3, 3))).not.toBe(
      game.getWaterComponent(ship.tile()),
    );
    expect(game.isWater(ship.tile())).toBe(true);
    expect(game.x(ship.tile())).toBeGreaterThanOrEqual(16);
    expect(ship.expeditionState()!.phase).toBe("surveying");
  });
  it("charges the base price, stays on water and waits 600 ticks at the actual destination", async () => {
    const { game, owner, dispatch } = await scene();
    const gold = owner.gold();
    const target = game.ref(14, 8);
    const ship = dispatch(target);
    expect(owner.gold()).toBe(gold - 150_000n);
    for (
      let i = 0;
      i < 50 && ship.expeditionState()!.phase === "sailing";
      i++
    ) {
      ticks(game, 1);
      expect(game.isWater(ship.tile())).toBe(true);
    }
    expect(ship.tile()).toBe(target);
    expect(ship.expeditionState()!.phase).toBe("surveying");
    const state = ship.expeditionState()!;
    expect(state.waitUntil - game.ticks()).toBeGreaterThanOrEqual(
      EXPEDITION_WAIT_TICKS - 1,
    );
    while (game.ticks() < state.waitUntil) ticks(game, 1);
    expect(ship.expeditionState()!.phase).toBe("surveying");
    ticks(game, 1);
    expect(ship.expeditionState()!.phase).toBe("exploring"); // Small seas use shorter exploration legs.
    expect(ship.expeditionState()!.waitUntil).toBe(state.waitUntil);
  });
  it("approaches a land objective using reachable water without landing", async () => {
    const { game, dispatch } = await scene();
    const ship = dispatch(game.ref(0, 3));
    ticks(game, 60);
    expect(game.isWater(ship.tile())).toBe(true);
    expect(game.x(ship.tile())).toBe(8);
    expect(ship.expeditionState()!.phase).toBe("surveying");
    expect(ship.expeditionState()!.destination).toBe(game.ref(0, 3));
  });
  it("rejects normal-mode dispatch, missing own ports, invalid targets and insufficient funds", async () => {
    const normal = await scene(false);
    normal.dispatch();
    expect(normal.owner.units(UnitType.ExpeditionShip)).toHaveLength(0);
    const { game, owner } = await scene();
    const gold = owner.gold();
    const other = game.addPlayer(
      new PlayerInfo("Other", PlayerType.Human, "bbbbbbbb", "bbbbbbbb"),
    );
    other.conquer(game.ref(1, 1));
    other.addGold(1_000_000n);
    for (const exec of [
      new ExpeditionShipExecution(other, game.ref(14, 8)),
      new ExpeditionShipExecution(owner, -1),
    ]) {
      game.addExecution(exec);
      ticks(game, 1);
    }
    expect(owner.gold()).toBe(gold);
    expect(owner.units(UnitType.ExpeditionShip)).toHaveLength(0);
    owner.removeGold(owner.gold());
    game.addExecution(new ExpeditionShipExecution(owner, game.ref(14, 8)));
    ticks(game, 1);
    expect(owner.units(UnitType.ExpeditionShip)).toHaveLength(0);
  });
  it("automatically chooses the nearest usable own port to the target", async () => {
    const { game, owner, port, dispatch } = await scene();
    owner.conquer(game.ref(7, 14));
    const near = owner.buildUnit(UnitType.Port, game.ref(7, 14), {});
    expect(dispatch(game.ref(14, 15)).expeditionState()!.originPort).toBe(
      near.id(),
    );
    near.markForDeletion();
    expect(dispatch(game.ref(14, 15)).expeditionState()!.originPort).toBe(
      port.id(),
    );
  });
  it("skips inland ports without a water departure tile", async () => {
    const { game, owner, port, dispatch } = await scene();
    owner.conquer(game.ref(1, 1));
    owner.buildUnit(UnitType.Port, game.ref(1, 1), {});
    expect(dispatch(game.ref(0, 0)).expeditionState()!.originPort).toBe(
      port.id(),
    );
  });
  it("has no cap and charges the first five ships 150K, then 300K even in one tick", async () => {
    const { game, owner } = await scene();
    const gold = owner.gold();
    for (let i = 0; i < 7; i++)
      game.addExecution(new ExpeditionShipExecution(owner, game.ref(14, 8)));
    ticks(game, 1);
    expect(owner.units(UnitType.ExpeditionShip)).toHaveLength(7);
    expect(owner.gold()).toBe(gold - 5n * 150_000n - 2n * 300_000n);
    expect(game.unitInfo(UnitType.ExpeditionShip).cost(game, owner)).toBe(
      300_000n,
    );
    for (const ship of owner.units(UnitType.ExpeditionShip)) ship.delete(false);
    expect(owner.units(UnitType.ExpeditionShip)).toHaveLength(0);
    expect(game.unitInfo(UnitType.ExpeditionShip).cost(game, owner)).toBe(
      300_000n,
    );
    const { restored } = await roundTrip(game, "half_land_half_ocean");
    const restoredOwner = restored.player(owner.id());
    expect(
      restored.unitInfo(UnitType.ExpeditionShip).cost(restored, restoredOwner),
    ).toBe(300_000n);
    const before = restoredOwner.gold();
    restored.addExecution(
      new ExpeditionShipExecution(restoredOwner, restored.ref(14, 8)),
    );
    ticks(restored as GameImpl, 1);
    expect(restoredOwner.gold()).toBe(before - 300_000n);
  });
  it("shares a surveying ship's local sight and owner information with the host country", async () => {
    const { game, owner, dispatch } = await scene(true, true);
    const host = game.addPlayer(
      new PlayerInfo("Host", PlayerType.Human, "bbbbbbbb", "bbbbbbbb"),
    );
    // A distant island within the ship's sight but beyond the host's normal range.
    const coast = game.ref(119, 130);
    host.conquer(coast);
    host.setSpawnTile(coast);
    const ship = dispatch(game.ref(140, 100));
    expect(computeFog(game, host).brightness[game.ref(160, 100)]).toBe(0);
    ticks(game, 80);
    expect(ship.expeditionState()!.phase).toBe("surveying");
    let fog = computeFog(game, host);
    expect(fog.brightness[ship.tile()]).toBe(10);
    expect(fog.brightness[game.ref(160, 100)]).toBeGreaterThan(0);
    expect(fog.countries.has(owner.smallID())).toBe(true);
    // A host's direct ally receives the same shared local view.
    const ally = game.addPlayer(
      new PlayerInfo("Ally", PlayerType.Human, "cccccccc", "cccccccc"),
    );
    ally.conquer(game.ref(1, 1));
    game.createAllianceRequest(host, ally)!.accept();
    expect(computeFog(game, ally).countries.has(owner.smallID())).toBe(true);
    ship.updateExpeditionState({
      ...ship.expeditionState()!,
      phase: "exploring",
    });
    fog = computeFog(game, host);
    expect(fog.brightness[ship.tile()]).toBe(0);
    expect(fog.countries.has(owner.smallID())).toBe(false);
    // No host contact means no shared sight, even during surveying.
    ship.updateExpeditionState({
      ...ship.expeditionState()!,
      phase: "surveying",
    });
    host.relinquish(coast);
    expect(computeFog(game, host).brightness[ship.tile()]).toBe(0);
  });
  it("cannot be moved, recalled or manually deleted through existing intents", async () => {
    const { game, owner, dispatch } = await scene();
    const ship = dispatch();
    ticks(game, 40);
    const tile = ship.tile(),
      state = { ...ship.expeditionState()! };
    game.addExecution(
      new MoveWarshipExecution(owner, [ship.id()], game.ref(9, 2)),
      new BoatRetreatExecution(owner, ship.id()),
      new DeleteUnitExecution(owner, ship.id()),
    );
    ticks(game, 1);
    expect(ship.isActive()).toBe(true);
    expect(ship.tile()).toBe(tile);
    expect(ship.expeditionState()).toEqual(state);
  });
  it("provides level-10 circular vision and moves onward after surveying on a large sea", async () => {
    const { game, owner, dispatch } = await scene(true, true);
    const ship = dispatch();
    ticks(game, 80);
    expect(ship.expeditionState()!.phase).toBe("surveying");
    const fog = computeFog(game, owner).brightness;
    expect(fog[ship.tile()]).toBe(10);
    expect(fog[game.ref(180, 140)]).toBeGreaterThan(0);
    expect(fog[game.ref(180, 149)]).toBe(0);
    const tile = ship.tile();
    ticks(game, 700);
    expect(ship.expeditionState()!.phase).toBe("exploring");
    expect(ship.tile()).not.toBe(tile);
    expect(game.isWater(ship.tile())).toBe(true);
  });
  it("preserves route, wait deadline and random exploration through snapshots", async () => {
    const { game, owner, dispatch } = await scene(true, true);
    const ship = dispatch();
    ticks(game, 20);
    const { restored, bytes, again } = await roundTrip(game, "big_plains");
    expect(again).toEqual(bytes);
    for (let i = 0; i < 850; i++) {
      game.executeNextTick();
      restored.executeNextTick();
      const copy = restored
        .player(owner.id())
        .units(UnitType.ExpeditionShip)[0];
      expect(copy.tile()).toBe(ship.tile());
      expect(copy.expeditionState()).toEqual(ship.expeditionState());
    }
  });
  it("can be sunk by an enemy warship", async () => {
    const { game, owner, dispatch } = await scene();
    const ship = dispatch();
    const enemy = game.addPlayer(
      new PlayerInfo("Enemy", PlayerType.Human, "bbbbbbbb", "bbbbbbbb"),
    );
    enemy.conquer(game.ref(1, 1));
    enemy.setTroops(10000);
    const warship = enemy.buildUnit(UnitType.Warship, game.ref(11, 9), {
      patrolTile: game.ref(11, 9),
    });
    game.addExecution(new WarshipExecution(warship));
    ticks(game, 150);
    expect(ship.isActive()).toBe(false);
    expect(owner.units(UnitType.ExpeditionShip)).toHaveLength(0);
  });
});
