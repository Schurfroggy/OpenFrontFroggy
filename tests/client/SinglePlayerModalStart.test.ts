import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { ClientEnv } from "../../src/client/ClientEnv";
import { GameMapType, GameMode, UnitType } from "../../src/core/game/Game";

vi.mock("../../src/client/Cosmetics", () => ({
  getPlayerCosmetics: vi.fn(async () => ({})),
}));

vi.mock("../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    isOnCrazyGames: vi.fn(() => false),
    requestMidgameAd: vi.fn(async () => {}),
  },
}));

vi.mock("../../src/client/TerrainMapFileLoader", () => ({
  terrainMapFileLoader: { getMapData: vi.fn() },
}));

// Side-effect import so the custom element registers (a type-only import
// would be elided and createElement would return an inert element).
import "../../src/client/SinglePlayerModal";

function createModal(): any {
  return document.createElement("single-player-modal") as any;
}

describe("SinglePlayerModal start", () => {
  it("hides the official achievement sign-in action when self-hosted", () => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      selfHosted: true,
      turnstileSiteKey: "test",
      jwtAudience: "localhost",
      gitCommit: "test",
      numWorkers: 1,
    };
    ClientEnv.reset();
    try {
      const modal = createModal();
      const host = document.createElement("div");
      render(modal.renderHeaderSlot(), host);

      // Only the header's Back button remains; the achievement action is gone.
      expect(host.querySelectorAll("button")).toHaveLength(1);
    } finally {
      window.BOOTSTRAP_CONFIG = undefined;
      ClientEnv.reset();
    }
  });

  it("opens with the featured map and mode as its preset", () => {
    const modal = createModal();
    const open = vi.spyOn(modal, "open").mockImplementation(() => {});

    modal.openWithPreset(GameMapType.Asia, GameMode.Team);

    expect(open).toHaveBeenCalledWith({
      presetMap: GameMapType.Asia,
      presetMode: GameMode.Team,
      lockPreset: true,
    });
  });

  it("rejects map and mode changes while a featured preset is locked", () => {
    const modal = createModal();
    modal.presetLocked = true;
    modal.selectedMap = GameMapType.Asia;
    modal.gameMode = GameMode.Team;

    modal.handleConfigMapSelected(
      new CustomEvent("map-selected", {
        detail: { map: GameMapType.Europe },
      }),
    );
    modal.handleConfigGameModeSelected(
      new CustomEvent("game-mode-selected", {
        detail: { mode: GameMode.FFA },
      }),
    );

    expect(modal.selectedMap).toBe(GameMapType.Asia);
    expect(modal.gameMode).toBe(GameMode.Team);
  });

  it("carries the selected team count and validated disabled units into the join-lobby config", async () => {
    const modal = createModal();
    const events: any[] = [];
    modal.addEventListener("join-lobby", (e: Event) =>
      events.push((e as CustomEvent).detail),
    );

    // Selection arrives via the game-config-settings child event.
    modal.handleConfigTeamCountSelected(
      new CustomEvent("team-count-selected", { detail: { count: 4 } }),
    );
    // One real unit and one junk entry: the start path must keep only
    // values that are actual UnitTypes.
    modal.disabledUnits = [UnitType.Warship, "Bogus"];

    await modal.startGame();

    expect(events).toHaveLength(1);
    expect(events[0].source).toBe("singleplayer");
    const config = events[0].gameStartInfo.config;
    expect(config.playerTeams).toBe(4);
    expect(config.disabledUnits).toEqual([UnitType.Warship]);
  });

  it("marks standard self-hosted games eligible and advanced games ineligible", async () => {
    window.BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      selfHosted: true,
      turnstileSiteKey: "test",
      jwtAudience: "localhost",
      gitCommit: "test",
      numWorkers: 1,
    };
    ClientEnv.reset();
    try {
      const standard = createModal();
      const standardEvents: any[] = [];
      standard.addEventListener("join-lobby", (event: Event) =>
        standardEvents.push((event as CustomEvent).detail),
      );
      await standard.startGame();

      const advanced = createModal();
      advanced.advancedSettingsEnabled = true;
      const advancedEvents: any[] = [];
      advanced.addEventListener("join-lobby", (event: Event) =>
        advancedEvents.push((event as CustomEvent).detail),
      );
      await advanced.startGame();

      expect(
        standardEvents[0].gameStartInfo.config.selfHostedAchievementsEnabled,
      ).toBe(true);
      expect(standardEvents[0].gameStartInfo.config.disabledUnits).toEqual([
        UnitType.MIRV,
      ]);
      expect(
        advancedEvents[0].gameStartInfo.config.selfHostedAchievementsEnabled,
      ).toBe(false);
    } finally {
      window.BOOTSTRAP_CONFIG = undefined;
      ClientEnv.reset();
    }
  });
});
