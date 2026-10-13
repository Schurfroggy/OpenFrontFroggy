import { describe, expect, it } from "vitest";
import type { PlayerState } from "../../../../../src/client/render/types/Renderer";
import {
  extractWars,
  warInvolvesFriendly,
  warTroops,
} from "../../../../../src/client/render/frame/derive/WarFronts";

function makePlayer(
  smallID: number,
  outgoing: {
    targetID: number;
    id: string;
    troops: number;
    retreating?: boolean;
  }[],
): PlayerState {
  return {
    smallID,
    isAlive: true,
    outgoingAttacks: outgoing.map((o) => ({
      attackerID: smallID,
      targetID: o.targetID,
      troops: o.troops,
      id: o.id,
      retreating: o.retreating ?? false,
    })),
  } as unknown as PlayerState;
}

describe("extractWars", () => {
  it("groups attacks between the same pair into one war with both directions", () => {
    const players = new Map([
      [1, makePlayer(1, [{ targetID: 2, id: "a1", troops: 100 }])],
      [2, makePlayer(2, [{ targetID: 1, id: "b1", troops: 50 }])],
    ]);

    const wars = extractWars(players);
    expect(wars).toHaveLength(1);
    const war = wars[0]!;
    expect(war.a).toBe(1);
    expect(war.b).toBe(2);
    expect(war.ab).toMatchObject({
      attackerID: 1,
      targetID: 2,
      troops: 100,
      retreating: false,
    });
    expect(war.ba).toMatchObject({
      attackerID: 2,
      targetID: 1,
      troops: 50,
      retreating: false,
    });
    expect(warTroops(war)).toBe(150);
  });

  it("merges multiple attacks in the same direction", () => {
    const players = new Map([
      [
        3,
        makePlayer(3, [
          { targetID: 4, id: "x1", troops: 10 },
          { targetID: 4, id: "x2", troops: 20 },
        ]),
      ],
      [4, makePlayer(4, [])],
    ]);

    const wars = extractWars(players);
    expect(wars).toHaveLength(1);
    expect(wars[0]!.ab!.attackIDs).toEqual(["x1", "x2"]);
    expect(wars[0]!.ab!.troops).toBe(30);
    expect(wars[0]!.ba).toBeNull();
  });

  it("marks a direction retreating only when all its attacks retreat", () => {
    const players = new Map([
      [
        5,
        makePlayer(5, [
          { targetID: 6, id: "r1", troops: 10, retreating: true },
          { targetID: 6, id: "r2", troops: 20, retreating: true },
        ]),
      ],
      [
        6,
        makePlayer(6, [
          { targetID: 5, id: "p1", troops: 5, retreating: true },
          { targetID: 5, id: "p2", troops: 5 },
        ]),
      ],
    ]);

    const wars = extractWars(players);
    const war = wars[0]!;
    expect(war.ab!.retreating).toBe(true); // all retreating
    expect(war.ba!.retreating).toBe(false); // one still pushing
  });

  it("keeps terra-nullius land grabs as one-sided wars", () => {
    const players = new Map([
      [7, makePlayer(7, [{ targetID: 0, id: "t1", troops: 1 }])],
    ]);

    const wars = extractWars(players);
    expect(wars).toHaveLength(1);
    expect(wars[0]!.a).toBe(0);
    expect(wars[0]!.b).toBe(7);
    // a=0 (terra nullius) is the defender, so the direction is ba.
    expect(wars[0]!.ba?.attackerID).toBe(7);
    expect(wars[0]!.ab).toBeNull();
  });

  it("sorts wars by committed troops, largest first", () => {
    const players = new Map([
      [1, makePlayer(1, [{ targetID: 2, id: "small", troops: 5 }])],
      [3, makePlayer(3, [{ targetID: 4, id: "big", troops: 500 }])],
    ]);

    const wars = extractWars(players);
    expect(wars.map((w) => warTroops(w))).toEqual([500, 5]);
  });

  it("applies the include filter (only-my-wars)", () => {
    const players = new Map([
      [1, makePlayer(1, [{ targetID: 2, id: "mine", troops: 5 }])],
      [3, makePlayer(3, [{ targetID: 4, id: "other", troops: 500 }])],
    ]);

    const wars = extractWars(
      players,
      (war) => war.a === 1 || war.b === 1,
    );
    expect(wars).toHaveLength(1);
    expect(wars[0]!.ab?.attackerID).toBe(1);
  });

  it("ignores self-attacks", () => {
    const players = new Map([
      [1, makePlayer(1, [{ targetID: 1, id: "self", troops: 5 }])],
    ]);
    expect(extractWars(players)).toHaveLength(0);
  });
});

describe("warInvolvesFriendly", () => {
  const war = {
    a: 2,
    b: 3,
    ab: null,
    ba: null,
  };

  it("matches when the local player is a belligerent", () => {
    expect(warInvolvesFriendly(war, 2, new Set())).toBe(true);
    expect(warInvolvesFriendly(war, 3, new Set())).toBe(true);
  });

  it("matches when an ally is a belligerent", () => {
    expect(warInvolvesFriendly(war, 1, new Set([3]))).toBe(true);
  });

  it("does not match unrelated wars", () => {
    expect(warInvolvesFriendly(war, 1, new Set([9, 10]))).toBe(false);
  });

  it("does not match terra nullius as an ally", () => {
    const terraWar = { a: 0, b: 3, ab: null, ba: null };
    expect(warInvolvesFriendly(terraWar, 1, new Set([0]))).toBe(false);
  });
});
