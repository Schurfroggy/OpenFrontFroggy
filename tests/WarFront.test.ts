import { beforeEach, describe, expect, it, vi } from "vitest";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { AttackImpl } from "../src/core/game/AttackImpl";
import { PlayerInfo, PlayerType, type Player } from "../src/core/game/Game";
import type { GameImpl } from "../src/core/game/GameImpl";
import { deriveWarFronts } from "../src/core/game/WarFront";
import { GameRunner } from "../src/core/GameRunner";
import { snapshotGame } from "../src/core/snapshot/GameSnapshot";
import { setup } from "./util/Setup";
import { diffSnapshots, roundTrip } from "./util/Snapshot";

describe("authoritative war fronts", () => {
  let game: GameImpl, attacker: Player, defender: Player;
  beforeEach(async () => {
    game = (await setup("plains")) as GameImpl;
    attacker = game.addPlayer(new PlayerInfo("a", PlayerType.Human, null, "a"));
    defender = game.addPlayer(new PlayerInfo("b", PlayerType.Human, null, "b"));
    for (let x = 5; x < 55; x++)
      for (let y = 5; y < 55; y++) {
        (x < 30 ? attacker : defender).conquer(game.ref(x, y));
      }
  });
  function derive(border: Set<number>) {
    return deriveWarFronts(
      game,
      border,
      attacker.smallID(),
      defender.smallID(),
      [],
    );
  }
  function strip(y0: number, y1: number) {
    return Array.from({ length: y1 - y0 }, (_, i) => game.ref(30, y0 + i));
  }
  it("keeps small disconnected fronts and uses actual contact tiles", () => {
    const border = new Set([...strip(10, 15), ...strip(40, 43)]);
    const fronts = derive(border);
    expect(fronts.map((f) => f.size)).toEqual([5, 3]);
    for (const f of fronts) {
      expect(border.has(game.ref(f.x, f.y))).toBe(true);
      expect(f.directionX).toBeCloseTo(1);
      expect(f.directionY).toBeCloseTo(0);
    }
  });
  it("rejects stale, blocked and non-contact border entries", () => {
    const blocked = game.ref(30, 20);
    const original = game.map().isImpassable.bind(game.map());
    vi.spyOn(game.map(), "isImpassable").mockImplementation(
      (tile) => tile === blocked || original(tile),
    );
    expect(
      derive(new Set([game.ref(29, 10), game.ref(40, 10), blocked])),
    ).toEqual([]);
  });
  it("uses actual diagonal contact instead of a global country direction", () => {
    for (let x = 5; x < 55; x++)
      for (let y = 5; y < 55; y++) {
        (x + y < 60 ? attacker : defender).conquer(game.ref(x, y));
      }
    const fronts = derive(
      new Set(Array.from({ length: 21 }, (_, i) => game.ref(20 + i, 40 - i))),
    );
    expect(fronts).toHaveLength(1);
    expect(fronts[0].directionX).toBeCloseTo(Math.SQRT1_2);
    expect(fronts[0].directionY).toBeCloseTo(Math.SQRT1_2);
  });
  it("prefers local recent conquest evidence and expires stale history", () => {
    const border = new Set(strip(15, 26));
    const sample = {
      x: 29,
      y: 20,
      dx: Math.SQRT1_2,
      dy: Math.SQRT1_2,
      tick: game.ticks(),
    };
    const read = (tick: number) =>
      deriveWarFronts(game, border, attacker.smallID(), defender.smallID(), [
        { ...sample, tick },
      ])[0];
    expect(read(game.ticks()).directionSource).toBe("conquest");
    expect(read(game.ticks()).directionY).toBeCloseTo(Math.SQRT1_2);
    expect(read(game.ticks() - 31).directionSource).toBe("border");
    const reverse = deriveWarFronts(
      game,
      border,
      attacker.smallID(),
      defender.smallID(),
      [{ ...sample, dx: -1, dy: 0 }],
    )[0];
    expect(reverse.directionSource).toBe("border");
  });
  it("keeps recent advance evidence in a symmetric encirclement", () => {
    const tile = game.ref(30, 20);
    for (const [x, y] of [
      [29, 20],
      [31, 20],
      [30, 19],
      [30, 21],
    ])
      attacker.conquer(game.ref(x, y));
    const front = deriveWarFronts(
      game,
      new Set([tile]),
      attacker.smallID(),
      defender.smallID(),
      [{ x: 29, y: 20, dx: 1, dy: 0, tick: game.ticks() }],
    )[0];
    expect(front.directionSource).toBe("conquest");
    expect(front.directionX).toBe(1);
  });

  it("records conquests only after a visual query and never fabricates a source front", () => {
    const border = new Set(strip(15, 26));
    const attack = new AttackImpl(
      "test",
      defender,
      attacker,
      10,
      game.ref(8, 8),
      border,
      game,
    );
    attack.recordConquest(game.ref(30, 20));
    expect(attack.warFronts()[0].directionSource).toBe("border");
    attack.recordConquest(game.ref(30, 20));
    expect(attack.warFronts()[0].directionSource).toBe("conquest");
    border.clear();
    expect(attack.warFronts()).toEqual([]);
  });
  it("handles unowned expansion using the same contact evidence", () => {
    const border = new Set(strip(15, 20));
    for (const tile of border) defender.relinquish(tile);
    const fronts = deriveWarFronts(game, border, attacker.smallID(), 0, []);
    expect(fronts).toHaveLength(1);
    expect(fronts[0].directionX).toBeCloseTo(1);
  });
  it("keeps the legacy label RPC unchanged and sends rich fronts only on request", () => {
    const attack = attacker.createAttack(defender, 100, null, new Set());
    for (const tile of strip(15, 26)) attack.addBorderTile(tile);
    const runner = new GameRunner(game, {} as never, () => {});
    const ordinary = runner.attackClusteredPositions(attacker.smallID());
    expect(ordinary[0].fronts).toBeUndefined();
    expect(ordinary[0].positions).toHaveLength(1);
    const rich = runner.attackClusteredPositions(
      attacker.smallID(),
      undefined,
      true,
    );
    expect(rich[0].fronts?.[0].directionX).toBeCloseTo(1);
    expect(rich[0].id).toBe(ordinary[0].id);
  });

  it("does not change simulation snapshots or combat when visual history is enabled", async () => {
    attacker.setSpawnTile(game.ref(10, 20));
    defender.setSpawnTile(game.ref(40, 20));
    attacker.setTroops(100000);
    defender.setTroops(100000);
    game.addExecution(new AttackExecution(50000, attacker, defender.id()));
    game.executeNextTick();
    const { restored } = await roundTrip(game, "plains");
    expect(attacker.outgoingAttacks().length).toBeGreaterThan(0);
    const before = snapshotGame(game);
    attacker.outgoingAttacks().forEach((attack) => attack.warFronts());
    expect(diffSnapshots(before, snapshotGame(game))).toEqual([]);
    let sawHistory = false;
    for (let i = 0; i < 20; i++) {
      game.executeNextTick();
      restored.executeNextTick();
      for (const attack of attacker.outgoingAttacks()) {
        sawHistory ||= attack
          .warFronts()
          .some((f) => f.directionSource === "conquest");
      }
      expect(diffSnapshots(snapshotGame(game), snapshotGame(restored))).toEqual(
        [],
      );
    }
    expect(sawHistory).toBe(true);
    const { restored: warmRestored } = await roundTrip(game, "plains");
    for (const attack of warmRestored.player("a").outgoingAttacks()) {
      expect(() => attack.warFronts()).not.toThrow();
      expect(
        attack.warFronts().every((f) => f.directionSource === "border"),
      ).toBe(true);
    }
  });
});
