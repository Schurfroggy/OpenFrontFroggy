import { describe, expect, it } from "vitest";
import { Config } from "../src/core/configuration/Config";
import { Executor } from "../src/core/execution/ExecutionManager";
import { NoOpExecution } from "../src/core/execution/NoOpExecution";
import { NukeExecution } from "../src/core/execution/NukeExecution";
import { FogBrightnessUpdates } from "../src/core/game/FogBrightnessUpdates";
import {
  addVisionField,
  computeFog,
  fogAllowsIntent,
  fogFor,
  territoryVisionRadius,
} from "../src/core/game/FogOfWar";
import {
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { GameImpl, GameSnapshot } from "../src/core/game/GameImpl";
import { GameUpdateViewData } from "../src/core/game/GameUpdates";
import { GameRunner } from "../src/core/GameRunner";
import { GameConfigSchema, StampedIntent } from "../src/core/Schemas";
import { applyGameConfigPatch } from "../src/server/ConfigPatch";
import { setup } from "./util/Setup";
import { roundTrip } from "./util/Snapshot";

async function scenario() {
  const game = await setup("big_plains", {
    fogOfWar: { enabled: true },
    infiniteGold: true,
    instantBuild: true,
  });
  const add = (id: string, type = PlayerType.Human) =>
    game.addPlayer(new PlayerInfo(id, type, id, id));
  const a = add("aaaaaaaa"),
    b = add("bbbbbbbb"),
    c = add("cccccccc");
  for (const [p, x] of [
    [a, 10],
    [b, 90],
    [c, 170],
  ] as const) {
    p.conquer(game.ref(x, 100));
    p.setSpawnTile(game.ref(x, 100));
    p.setTroops(100000);
  }
  return { game, a, b, c };
}
const intent = (a: Player, value: object) =>
  ({ clientID: a.clientID()!, ...value }) as StampedIntent;

// These tests run real maps/simulation; no renderer or player mocks.
describe("fog fields and contacts", () => {
  it("resets reusable scratch across fields, dimensions and distance widths", () => {
    for (const [width, height, radius] of [
      [31, 7, 6],
      [31, 7, 3],
      [7, 31, 9],
      [520, 3, 256], // squared radius exceeds Uint16; must fall back.
      [520, 3, 48],
      [31, 7, 6],
    ]) {
      const cx = Math.floor(width / 2),
        cy = Math.floor(height / 2);
      const field = new Uint8Array(width * height);
      addVisionField(field, width, height, [cy * width + cx], 16, radius);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const squared = (x - cx) ** 2 + (y - cy) ** 2;
          expect(field[y * width + x] > 0).toBe(squared < radius * radius);
        }
      expect(field[cy * width + cx]).toBe(16);
      const saved = field.slice();
      addVisionField(new Uint8Array(width * height), width, height, [0], 10, 2);
      expect(field).toEqual(saved); // scratch never aliases returned masks.
    }
  });

  it("deduplicates immutable output without retaining a transferred buffer", async () => {
    const { game, a } = await scenario();
    const updates = new FogBrightnessUpdates();
    const first = updates.update(computeFog(game, a).brightness, a.id())!;
    const received = structuredClone(first, { transfer: [first.buffer] });
    expect(first.byteLength).toBe(0);
    expect(
      updates.update(computeFog(game, a).brightness, a.id()),
    ).toBeUndefined();
    const ship = a.buildUnit(UnitType.Warship, game.ref(60, 100), {
      patrolTile: game.ref(60, 100),
    });
    const moved = updates.update(computeFog(game, a).brightness, a.id())!;
    expect(moved[ship.tile()]).toBe(16);
    expect(received[ship.tile()]).toBe(0);
    expect(updates.update(computeFog(game, a).brightness, "other")).toEqual(
      moved,
    );
    expect(updates.update(null, "other")).toBeNull();
    expect(updates.update(null, "other")).toBeUndefined();
    expect(updates.update(computeFog(game, a).brightness, "other")).toEqual(
      moved,
    );
    expect(updates.update(new Uint8Array(3), "other")).toEqual(
      new Uint8Array(3),
    );
  });

  it("sends country changes even when a runner omits unchanged brightness", async () => {
    const { game, a, b } = await scenario();
    const sent: GameUpdateViewData[] = [];
    const runner = new GameRunner(
      game,
      new Executor(game, "fog-test", a.clientID()!),
      (gu) => sent.push(gu as GameUpdateViewData),
    );
    const tick = () => {
      runner.addTurn({ turnNumber: game.ticks(), intents: [] });
      expect(runner.executeNextTick()).toBe(true);
      return sent[sent.length - 1];
    };
    const first = tick();
    expect(first.fogBrightness).toBeInstanceOf(Uint8Array);
    expect(first.fogCountries).not.toContain(b.smallID());
    b.conquer(game.ref(11, 100)); // Same lighting, new country in that light.
    const second = tick();
    expect(second).not.toHaveProperty("fogBrightness");
    expect(second.fogCountries).toContain(b.smallID());
    a.buildUnit(UnitType.Warship, game.ref(60, 100), {
      patrolTile: game.ref(60, 100),
    });
    expect(tick().fogBrightness?.[game.ref(60, 100)]).toBe(16);
  });

  it("uses integer levels, max overlap and a hard zero boundary", () => {
    const field = new Uint8Array(21 * 21);
    addVisionField(field, 21, 21, [10 * 21 + 10], 10, 5);
    expect(field[10 * 21 + 10]).toBe(10);
    expect(field[10 * 21 + 14]).toBe(2);
    expect(field[10 * 21 + 15]).toBe(0);
    addVisionField(field, 21, 21, [10 * 21 + 10], 16, 3);
    expect(field[10 * 21 + 10]).toBe(16);
    expect(field[10 * 21 + 14]).toBe(2);
    expect(territoryVisionRadius(1)).toBe(16);
    expect(territoryVisionRadius(10000)).toBe(24);
    expect(territoryVisionRadius(100000000)).toBe(40);
  });

  it("tracks a moving warship, reveals national stats access but not the whole map", async () => {
    const { game, a, b } = await scenario();
    const target = game.ref(90, 100);
    expect(computeFog(game, a).countries.has(b.smallID())).toBe(false);
    const ship = a.buildUnit(UnitType.Warship, game.ref(60, 100), {
      patrolTile: game.ref(60, 100),
    });
    const seen = computeFog(game, a);
    expect(seen.brightness[ship.tile()]).toBe(16);
    expect(seen.countries.has(b.smallID())).toBe(true);
    expect(seen.brightness[game.ref(170, 100)]).toBe(0);
    ship.move(game.ref(20, 100));
    expect(computeFog(game, a).brightness[target]).toBe(0);
    expect(computeFog(game, a).countries.has(b.smallID())).toBe(false);
  });

  it("extends vision beyond the same border when territory reaches the next area band", async () => {
    const { game, a } = await scenario();
    a.conquer(game.ref(99, 100));
    const outside = game.ref(119, 100);
    expect(computeFog(game, a).brightness[outside]).toBe(0);
    // Grow behind the existing border, so expansion alone cannot move it closer.
    for (let y = 50; y < 150; y++) {
      for (let x = 0; x < 100; x++) a.conquer(game.ref(x, y));
    }
    expect(a.numTilesOwned()).toBe(10_000);
    expect(computeFog(game, a).brightness[outside]).toBeGreaterThan(0);
    expect(computeFog(game, a).brightness[game.ref(124, 100)]).toBe(0);
  });

  it("shares only direct allies and withdraws sharing on break", async () => {
    const { game, a, b, c } = await scenario();
    (game as GameImpl).createAllianceRequest(a, b)!.accept();
    (game as GameImpl).createAllianceRequest(b, c)!.accept();
    expect(computeFog(game, a).brightness[b.spawnTile()!]).toBe(10);
    expect(computeFog(game, a).brightness[c.spawnTile()!]).toBe(0);
    a.breakAlliance(a.alliances()[0]);
    expect(computeFog(game, a).brightness[b.spawnTile()!]).toBe(0);
  });

  it("does not create reconnaissance from flying nuclear weapons", async () => {
    const { game, a, b } = await scenario();
    a.buildUnit(UnitType.AtomBomb, game.ref(90, 100), { trajectory: [] });
    expect(computeFog(game, a).countries.has(b.smallID())).toBe(false);
  });
});

describe("public nuclear light", () => {
  it("is global, retracts repaired sources permanently, and expires", async () => {
    const { game, a, b, c } = await scenario();
    const x = game.ref(88, 100),
      y = game.ref(89, 100);
    game.setFallout(x, true);
    game.setFallout(y, true);
    game.revealNuclearFog([x, y]);
    expect(computeFog(game, a).countries.has(b.smallID())).toBe(true);
    expect(computeFog(game, c).countries.has(b.smallID())).toBe(true);
    a.conquer(x);
    expect(game.nuclearFogSources().has(x)).toBe(false);
    expect(game.nuclearFogSources().has(y)).toBe(true);
    a.relinquish(x);
    expect(game.nuclearFogSources().has(x)).toBe(false);
    for (let i = 0; i < 301; i++) game.executeNextTick();
    expect(computeFog(game, c).countries.has(b.smallID())).toBe(false);
  });

  it("preserves overlapping/renewed sources and snapshot continuation", async () => {
    const { game } = await scenario();
    const tile = game.ref(80, 100);
    game.setFallout(tile, true);
    game.revealNuclearFog([tile]);
    for (let i = 0; i < 10; i++) game.executeNextTick();
    game.revealNuclearFog([tile]);
    const { restored } = await roundTrip(game, "big_plains");
    expect([...restored.nuclearFogSources()]).toEqual([
      ...game.nuclearFogSources(),
    ]);
    for (let i = 0; i < 11; i++) {
      game.executeNextTick();
      restored.executeNextTick();
    }
    expect([...restored.nuclearFogSources()]).toEqual([
      ...game.nuclearFogSources(),
    ]);
    expect(restored.nuclearFogSources().has(tile)).toBe(true);
    for (let i = 0; i < 301; i++) restored.executeNextTick();
    expect(restored.nuclearFogSources().has(tile)).toBe(false);
  });

  it("registers real detonations but not intercepted weapons", async () => {
    const { game, a } = await scenario();
    a.buildUnit(UnitType.MissileSilo, a.spawnTile()!, {});
    const blast = new NukeExecution(UnitType.AtomBomb, a, game.ref(85, 100));
    game.addExecution(blast);
    for (let i = 0; i < 100 && game.nuclearFogSources().size === 0; i++)
      game.executeNextTick();
    expect(game.nuclearFogSources().size).toBeGreaterThan(0);
    const other = await scenario();
    other.a.buildUnit(UnitType.MissileSilo, other.a.spawnTile()!, {});
    const intercepted = new NukeExecution(
      UnitType.AtomBomb,
      other.a,
      other.game.ref(180, 100),
    );
    other.game.addExecution(intercepted);
    other.game.executeNextTick();
    other.game.executeNextTick();
    const missile = other.game.units(UnitType.AtomBomb)[0];
    expect(missile).toBeDefined();
    missile.delete();
    for (let i = 0; i < 20; i++) other.game.executeNextTick();
    expect(other.game.nuclearFogSources().size).toBe(0);
  });
});

describe("intent policy and configuration", () => {
  it("blocks hidden human targets while allowing blind nukes and fleet exploration", async () => {
    const { game, a, b } = await scenario();
    const tile = game.ref(90, 100);
    expect(
      fogAllowsIntent(
        game,
        a,
        intent(a, { type: "boat", dst: tile, troops: 100 }),
      ),
    ).toBe(false);
    expect(
      fogAllowsIntent(
        game,
        a,
        intent(a, { type: "build_unit", unit: UnitType.City, tile }),
      ),
    ).toBe(false);
    expect(
      fogAllowsIntent(
        game,
        a,
        intent(a, { type: "build_unit", unit: UnitType.AtomBomb, tile }),
      ),
    ).toBe(true);
    expect(
      fogAllowsIntent(
        game,
        a,
        intent(a, { type: "move_warship", unitIds: [1], tile }),
      ),
    ).toBe(true);
    const hidden = intent(a, { type: "allianceRequest", recipient: b.id() });
    expect(
      new Executor(game, "testgame", a.clientID()!).createExec(hidden),
    ).toBeInstanceOf(NoOpExecution);
    const ai = game.addPlayer(
      new PlayerInfo("nation", PlayerType.Nation, null, "nation"),
    );
    expect(fogAllowsIntent(game, ai, hidden)).toBe(true);
    expect(fogFor(game, a)).not.toBeNull();
  });

  it("normalizes incompatible modes in both runtime and lobby patches", async () => {
    const { game } = await scenario();
    const input = {
      ...game.config().gameConfig(),
      waterNukes: true,
      doomsdayClock: { enabled: true },
      overtime: { enabled: true },
    };
    const parsed = GameConfigSchema.parse(input);
    const config = new Config(parsed, null, false);
    expect(config.waterNukes()).toBe(false);
    expect(config.doomsdayClockConfig().enabled).toBe(false);
    expect(config.gameConfig().overtime?.enabled).toBe(false);
    const target = { ...input, fogOfWar: { enabled: false } };
    applyGameConfigPatch(target, { fogOfWar: { enabled: true } });
    expect(target.waterNukes).toBe(false);
    expect(target.doomsdayClock?.enabled).toBe(false);
  });

  it("migrates old game snapshots to an empty public light set", () => {
    expect(GameSnapshot.migrations[1]({ ticks: 12 })).toEqual({
      ticks: 12,
      nuclearFogSources: [],
    });
  });
});

describe("circular vision geometry", () => {
  it("has a true circular boundary even between diagonal and cardinal directions", () => {
    const width = 113,
      center = 56;
    const field = new Uint8Array(width * width);
    addVisionField(field, width, width, [center * width + center], 16, 48);
    // These two locations were misclassified by the old 3/4 octagonal metric.
    expect(field[(center + 35) * width + center + 35]).toBe(0);
    expect(field[(center + 15) * width + center + 45]).toBeGreaterThan(0);
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++) {
        const squared = (x - center) ** 2 + (y - center) ** 2;
        expect(field[y * width + x] > 0).toBe(squared < 48 * 48);
      }
  });

  it("matches nearest-source distance for overlaps and clipped map edges", () => {
    const width = 23,
      height = 17,
      radius = 9;
    const seeds = [0, 22, 16 * width, 9 * width + 11, 8 * width + 12];
    const field = new Uint8Array(width * height);
    addVisionField(field, width, height, seeds, 16, radius);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const squared = Math.min(
          ...seeds.map(
            (seed) =>
              (x - (seed % width)) ** 2 + (y - Math.floor(seed / width)) ** 2,
          ),
        );
        expect(field[y * width + x] > 0).toBe(squared < radius * radius);
        if (squared < radius * radius) {
          const expected = Math.ceil(
            (16 * (radius - Math.sqrt(squared))) / radius,
          );
          expect(Math.abs(field[y * width + x] - expected)).toBeLessThanOrEqual(
            1,
          );
        }
      }
  });

  it("keeps nuclear light for exactly 300 simulation ticks", async () => {
    const { game } = await scenario();
    const tile = game.ref(80, 100);
    game.setFallout(tile, true);
    game.revealNuclearFog([tile]);
    const created = game.ticks();
    expect(game.nuclearFogSources().get(tile)).toBe(created + 300);
    for (let i = 0; i < 299; i++) game.executeNextTick();
    expect(computeFog(game, game.player("cccccccc")).brightness[tile]).toBe(16);
    game.executeNextTick();
    expect(computeFog(game, game.player("cccccccc")).brightness[tile]).toBe(0);
  });
});
