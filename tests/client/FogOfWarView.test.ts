import { describe, expect, it } from "vitest";
import { UnitType } from "../../src/core/game/Game";
import { GameUpdateType } from "../../src/core/game/GameUpdates";
import {
  makeEmptyGu,
  makeGameView,
  makePlayerUpdate,
  makeUnitUpdate,
  stubConfig,
} from "../util/viewStubs";

describe("fog in the live GameView", () => {
  it("dims spawn selection to level 5 without restricting tiles, then uses real vision", () => {
    const view = makeGameView({
      myClientID: "client-a",
      config: stubConfig({ fogOfWar: () => true, isReplay: () => false }),
    });
    const preview = view.frameData().fogBrightness;
    expect(preview).toEqual(new Uint8Array(100).fill(5));
    expect(view.isTileVisible(99)).toBe(true);
    const selecting = makeEmptyGu(1, { fogBrightness: null });
    selecting.updates[GameUpdateType.Player] = [
      makePlayerUpdate({ hasSpawned: false, isAlive: false }),
    ];
    view.update(selecting);
    expect(view.frameData().fogBrightness).toBe(preview);
    expect(view.isTileVisible(99)).toBe(true);

    const brightness = new Uint8Array(100);
    brightness[5] = 10;
    const spawned = makeEmptyGu(2, { fogBrightness: brightness });
    spawned.updates[GameUpdateType.SpawnPhaseEnd] = [
      { type: GameUpdateType.SpawnPhaseEnd, startTick: 2 },
    ];
    spawned.updates[GameUpdateType.Player] = [makePlayerUpdate()];
    view.update(spawned);
    expect(view.frameData().fogBrightness).toBe(brightness);
    expect(view.isTileVisible(99)).toBe(false);
    view.update(makeEmptyGu(3, { fogBrightness: null }));
    expect(view.frameData().fogBrightness).toBeNull();
  });

  it("keeps ordinary games, replays and observer views undimmed at spawn", () => {
    expect(makeGameView().frameData().fogBrightness).toBeNull();
    for (const [myClientID, replay] of [
      ["client-a", true],
      [undefined, false],
    ] as const) {
      const view = makeGameView({
        myClientID,
        config: stubConfig({ fogOfWar: () => true, isReplay: () => replay }),
      });
      expect(view.frameData().fogBrightness).toBeNull();
    }
  });

  it("keeps complete national data but filters spatial frames and revokes contact", () => {
    const view = makeGameView({ myClientID: "client-a" });
    const brightness = new Uint8Array(100);
    brightness[5] = 10;
    const gu = makeEmptyGu(1, {
      fogBrightness: brightness,
      packedTileUpdates: new Uint32Array([5, 1, 55, 2]),
    });
    gu.updates[GameUpdateType.Player] = [
      makePlayerUpdate({ tilesOwned: 1 }),
      makePlayerUpdate({
        id: "player-b",
        clientID: "client-b",
        smallID: 2,
        gold: 999n,
        troops: 456,
        tilesOwned: 1,
      }),
    ];
    gu.updates[GameUpdateType.Unit] = [
      makeUnitUpdate({
        id: 2,
        ownerID: 2,
        unitType: UnitType.SAMLauncher,
        pos: 55,
      }),
    ];
    view.update(gu);
    const enemy = view.player("player-b");
    expect(view.canViewPlayer(enemy)).toBe(false);
    expect(view.frameData().units.has(2)).toBe(false);
    const contact = brightness.slice();
    contact[55] = 2;
    view.update(makeEmptyGu(2, { fogBrightness: contact }));
    expect(view.canViewPlayer(enemy)).toBe(true);
    expect(enemy.gold()).toBe(999n);
    expect(enemy.troops()).toBe(456);
    expect(view.frameData().units.has(2)).toBe(true);
    expect(view.frameData().structuresDirty).toBe(true);
    view.update(makeEmptyGu(3, { fogBrightness: brightness }));
    expect(view.canViewPlayer(enemy)).toBe(false);
    expect(view.frameData().units.has(2)).toBe(false);
    view.update(makeEmptyGu(4, { fogBrightness: null }));
    expect(view.frameData().units.has(2)).toBe(true);
    expect(view.frameData().structuresDirty).toBe(true);
  });

  it("retains normal omniscient rendering when no fog field is supplied", () => {
    const view = makeGameView();
    const gu = makeEmptyGu(1);
    gu.updates[GameUpdateType.Player] = [makePlayerUpdate()];
    gu.updates[GameUpdateType.Unit] = [makeUnitUpdate({ pos: 55 })];
    view.update(gu);
    expect(view.isTileVisible(99)).toBe(true);
    expect(view.canViewPlayer(view.player("player-a"))).toBe(true);
    expect(view.frameData().units.has(1)).toBe(true);
  });
});

it("does not expose global country information while a live fog field is missing or late", () => {
  const view = makeGameView({
    myClientID: "client-a",
    config: stubConfig({ fogOfWar: () => true, isReplay: () => false }),
  });
  const gu = makeEmptyGu(1, {
    packedTileUpdates: new Uint32Array([5, 1, 55, 2]),
  });
  gu.updates[GameUpdateType.Player] = [
    makePlayerUpdate({ tilesOwned: 1 }),
    makePlayerUpdate({
      id: "player-b",
      clientID: "client-b",
      smallID: 2,
      tilesOwned: 1,
    }),
  ];
  view.update(gu);
  const other = view.player("player-b");
  expect(view.canViewPlayer(view.player("player-a"))).toBe(true);
  expect(view.canViewPlayer(other)).toBe(false);
  const fog = new Uint8Array(100);
  fog[5] = 10;
  view.update(makeEmptyGu(2, { fogBrightness: fog }));
  view.update(makeEmptyGu(3));
  expect(view.canViewPlayer(other)).toBe(false);
  expect(view.isTileVisible(55)).toBe(false);
});
