import { describe, expect, it } from "vitest";
import { Difficulty, GameMapType } from "../../src/core/game/Game";
import { SelfHostedAchievementStore } from "../../src/server/SelfHostedAchievementStore";

describe("SelfHostedAchievementStore", () => {
  it("stores one achievement per player, map, and difficulty", () => {
    const store = new SelfHostedAchievementStore(":memory:");
    try {
      const achievement = {
        playerId: "9f73bf9b-2b43-5ba8-b63e-88716b1465ef",
        playerName: "Alice",
        mapName: GameMapType.SouthAmerica,
        difficulty: Difficulty.Easy,
        source: "singleplayer" as const,
        gameId: "a123456789",
      };

      store.record(achievement);
      store.record({ ...achievement, source: "multiplayer" });

      expect(store.list(achievement.playerId)).toMatchObject([
        {
          mapName: GameMapType.SouthAmerica,
          difficulty: Difficulty.Easy,
          source: "singleplayer",
        },
      ]);
    } finally {
      store.close();
    }
  });

  it("keeps different players and difficulty wins separate", () => {
    const store = new SelfHostedAchievementStore(":memory:");
    try {
      const alice = "9f73bf9b-2b43-5ba8-b63e-88716b1465ef";
      const bob = "d868679f-2043-5507-b47f-3e34907d6c87";
      store.record({
        playerId: alice,
        playerName: "Alice",
        mapName: GameMapType.SouthAmerica,
        difficulty: Difficulty.Easy,
        source: "singleplayer",
      });
      store.record({
        playerId: alice,
        playerName: "Alice",
        mapName: GameMapType.SouthAmerica,
        difficulty: Difficulty.Hard,
        source: "multiplayer",
      });
      store.record({
        playerId: bob,
        playerName: "Bob",
        mapName: GameMapType.SouthAmerica,
        difficulty: Difficulty.Impossible,
        source: "singleplayer",
      });

      expect(store.list(alice).map(({ difficulty }) => difficulty)).toEqual([
        Difficulty.Easy,
        Difficulty.Hard,
      ]);
      expect(store.list(bob).map(({ difficulty }) => difficulty)).toEqual([
        Difficulty.Impossible,
      ]);
    } finally {
      store.close();
    }
  });
});
