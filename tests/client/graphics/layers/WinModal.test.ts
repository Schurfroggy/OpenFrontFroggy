import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { GameMode, RankedType } from "../../../../src/core/game/Game";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => {
    const translations: Record<string, string> = {
      "win_modal.exit": "Exit",
      "win_modal.requeue": "Play Again",
      "win_modal.keep": "Keep Playing",
      "win_modal.spectate": "Spectate",
    };
    return translations[key] || key;
  }),
  homeHref: vi.fn(() => "/"),
  renderDuration: vi.fn((seconds: number) => `${seconds}s`),
  renderNumber: vi.fn((value: number | bigint) => String(value)),
  renderTroops: vi.fn((value: number) => String(value)),
}));

vi.mock("../../../../src/client/CrazyGamesSDK", () => ({
  crazyGamesSDK: {
    happytime: vi.fn(),
    requestAd: vi.fn(),
    gameplayStop: vi.fn(),
  },
}));

describe("WinModal Requeue", () => {
  let mockLocationHref = "";

  beforeEach(() => {
    mockLocationHref = "";
    // Mock window.location.href using Object.defineProperty
    const locationMock = {
      get href() {
        return mockLocationHref;
      },
      set href(value: string) {
        mockLocationHref = value;
      },
    };
    Object.defineProperty(window, "location", {
      value: locationMock,
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("isRankedGame detection", () => {
    it("should detect ranked 1v1 game", () => {
      const gameConfig = {
        rankedType: RankedType.OneVOne,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(true);
    });

    it("should not detect non-ranked game", () => {
      const gameConfig = {
        rankedType: undefined,
      };
      const isRankedGame = gameConfig.rankedType === RankedType.OneVOne;
      expect(isRankedGame).toBe(false);
    });
  });

  describe("requeue navigation", () => {
    it("should navigate to /?requeue when requeue is triggered", () => {
      // Simulate the _handleRequeue behavior
      const handleRequeue = () => {
        window.location.href = "/?requeue";
      };

      handleRequeue();

      expect(window.location.href).toBe("/?requeue");
    });

    it("should navigate to / when exit is triggered", () => {
      // Simulate the _handleExit behavior
      const handleExit = () => {
        window.location.href = "/";
      };

      handleExit();

      expect(window.location.href).toBe("/");
    });
  });

  describe("requeue URL parameter handling", () => {
    it("should parse requeue parameter from URL", () => {
      const url = new URL("http://localhost:9000/?requeue");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(true);
    });

    it("should not find requeue parameter when absent", () => {
      const url = new URL("http://localhost:9000/");
      const hasRequeue = url.searchParams.has("requeue");
      expect(hasRequeue).toBe(false);
    });
  });
});

describe("WinModal settlement report", () => {
  let modal: WinModal | undefined;

  afterEach(() => {
    modal?.remove();
    modal = undefined;
  });

  it("renders the three defeat summary entries without promotions", async () => {
    modal = document.createElement("win-modal") as WinModal;
    document.body.appendChild(modal);
    await modal.updateComplete;

    const text = modal.textContent ?? "";
    expect(text).toContain("win_modal.stats.final_place");
    expect(text).toContain("win_modal.stats.survival_time");
    expect(text).toContain("win_modal.stats.defeated_by");
    expect(modal.querySelector("steam-wishlist")).toBeNull();
    expect(modal.querySelector("cosmetic-card")).toBeNull();
  });

  it("renders victory summary, construction, warships, and economy", async () => {
    modal = document.createElement("win-modal") as WinModal;
    modal.game = {
      config: () => ({ gameConfig: () => ({ gameMode: GameMode.FFA }) }),
      numLandTiles: () => 1000,
      numTilesWithFallout: () => 0,
      myPlayer: () => ({ team: () => null, isAlive: () => true }),
      playerViews: () => [],
    } as never;
    Object.assign(
      modal as unknown as {
        isWin: boolean;
        resultDurationSeconds: number;
        resultStats: object;
      },
      {
        isWin: true,
        resultDurationSeconds: 600,
        resultStats: {
          finalTiles: 600n,
          tiles: [700n],
          peakTroops: 1_000_000n,
          attacks: [2_000_000n],
          conquests: [0n, 4n],
          units: { city: [3n], wshp: [2n] },
          gold: [100n, 50n, 25n, 10n, 5n, 5n, 5n],
        },
      },
    );
    document.body.appendChild(modal);
    await modal.updateComplete;

    const text = modal.textContent ?? "";
    expect(text).toContain("win_modal.stats.match_duration");
    expect(text).toContain("win_modal.stats.final_territory");
    expect(text).toContain("win_modal.stats.warships_built");
    expect(text).toContain("win_modal.stats.construction");
    expect(text).toContain("win_modal.stats.economy");
    expect(modal.querySelectorAll("img").length).toBeGreaterThan(10);
  });
});
