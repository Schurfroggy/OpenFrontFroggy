import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import {
  groupAchievementsByMap,
  loadSelfHostedAchievements,
  recordSelfHostedAchievement,
} from "../../src/client/SelfHostedAchievements";
import { Difficulty, GameMapType } from "../../src/core/game/Game";

describe("self-hosted achievement client", () => {
  beforeEach(() => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      selfHosted: true,
      numWorkers: 1,
      turnstileSiteKey: "test",
      jwtAudience: "localhost",
      instanceId: "test",
      gitCommit: "test",
    };
    localStorage.setItem("username", "Alice");
    ClientEnv.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    window.BOOTSTRAP_CONFIG = undefined;
    ClientEnv.reset();
  });

  it("records a win under the deterministic username account", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      recordSelfHostedAchievement({
        playerName: "Alice",
        mapName: GameMapType.SouthAmerica,
        difficulty: Difficulty.Hard,
        source: "singleplayer",
        gameId: "a123456789",
      }),
    ).resolves.toBe(true);

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toMatchObject({
      mapName: GameMapType.SouthAmerica,
      difficulty: Difficulty.Hard,
      source: "singleplayer",
    });
  });

  it("loads and groups difficulty wins by map", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          achievements: [
            {
              mapName: GameMapType.SouthAmerica,
              difficulty: Difficulty.Easy,
              source: "singleplayer",
              earnedAt: "2026-10-06 12:00:00",
            },
            {
              mapName: GameMapType.SouthAmerica,
              difficulty: Difficulty.Hard,
              source: "multiplayer",
              earnedAt: "2026-10-06 13:00:00",
            },
          ],
        }),
      ),
    );

    const grouped = groupAchievementsByMap(await loadSelfHostedAchievements());

    expect(grouped.get(GameMapType.SouthAmerica)).toEqual(
      new Set([Difficulty.Easy, Difficulty.Hard]),
    );
  });
});
