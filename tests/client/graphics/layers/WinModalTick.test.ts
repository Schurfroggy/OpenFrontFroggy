import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../../src/client/hud/layers/WinModal";
import type { WinModal } from "../../../../src/client/hud/layers/WinModal";
import { SendWinnerEvent } from "../../../../src/client/Transport";
import type { GameView } from "../../../../src/client/view";
import { EventBus } from "../../../../src/core/EventBus";
import {
  Difficulty,
  GameMapType,
  GameType,
  PlayerType,
} from "../../../../src/core/game/Game";
import { GameUpdateType } from "../../../../src/core/game/GameUpdates";

const achievementMocks = vi.hoisted(() => ({
  record: vi.fn(async () => true),
}));

vi.mock("../../../../src/client/SelfHostedAchievements", () => ({
  recordSelfHostedAchievement: achievementMocks.record,
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
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

import { crazyGamesSDK } from "../../../../src/client/CrazyGamesSDK";

type Winner = ["team", string] | ["player", string] | undefined;

function makeGame(opts: {
  winner: Winner;
  myTeam?: string;
  myClientID?: string;
  winnerPlayer?: {
    isPlayer: () => boolean;
    clientID: () => string | null;
    displayName: () => string;
    team: () => string | null;
    type: () => PlayerType;
  };
  gameType?: GameType;
  achievementEligible?: boolean;
}): GameView {
  const winUpdate = { winner: opts.winner, allPlayersStats: {} };
  return {
    myPlayer: () => ({
      isAlive: () => true,
      hasSpawned: () => true,
      team: () => opts.myTeam ?? null,
      clientID: () => opts.myClientID ?? null,
      displayName: () => "Alice",
      deathPosition: () => null,
      killedByName: () => null,
      killedByTeam: () => null,
      killedByType: () => null,
    }),
    inSpawnPhase: () => false,
    elapsedGameSeconds: () => 120,
    updatesSinceLastTick: () => ({ [GameUpdateType.Win]: [winUpdate] }),
    playerByClientID: () => opts.winnerPlayer,
    config: () => ({
      gameConfig: () => ({
        rankedType: undefined,
        gameType: opts.gameType,
        selfHostedAchievementsEnabled: opts.achievementEligible ?? true,
        gameMap: GameMapType.SouthAmerica,
        difficulty: Difficulty.Hard,
      }),
    }),
    gameID: () => "a123456789",
  } as unknown as GameView;
}

describe("WinModal tick win handling", () => {
  let modal: WinModal | undefined;

  function setup(game: GameView) {
    const eventBus = new EventBus();
    const winnerEvents: SendWinnerEvent[] = [];
    eventBus.on(SendWinnerEvent, (e) => winnerEvents.push(e));
    modal = document.createElement("win-modal") as WinModal;
    modal.game = game;
    modal.eventBus = eventBus;
    return winnerEvents;
  }

  afterEach(() => {
    modal?.remove();
    modal = undefined;
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("emits the winner and celebrates when my team wins", async () => {
    const events = setup(
      makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Blue"]);
    expect(crazyGamesSDK.happytime).toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("records a private team win as a multiplayer map achievement", () => {
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        gameType: GameType.Private,
      }),
    );

    modal!.tick();

    expect(achievementMocks.record).toHaveBeenCalledWith({
      playerName: "Alice",
      mapName: GameMapType.SouthAmerica,
      difficulty: Difficulty.Hard,
      source: "multiplayer",
      gameId: "a123456789",
    });
  });

  it("does not record a win after advanced settings were enabled", () => {
    setup(
      makeGame({
        winner: ["team", "Blue"],
        myTeam: "Blue",
        gameType: GameType.Private,
        achievementEligible: false,
      }),
    );

    modal!.tick();

    expect(achievementMocks.record).not.toHaveBeenCalled();
  });

  it("emits the winner without celebrating when another team wins", async () => {
    const events = setup(makeGame({ winner: ["team", "Red"], myTeam: "Blue" }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["team", "Red"]);
    expect(crazyGamesSDK.happytime).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits a player winner resolved through playerByClientID", async () => {
    const events = setup(
      makeGame({
        winner: ["player", "winner-client"],
        myClientID: "my-client",
        winnerPlayer: {
          isPlayer: () => true,
          clientID: () => "winner-client",
          displayName: () => "Bob",
          team: () => null,
          type: () => PlayerType.Human,
        },
      }),
    );
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toEqual(["player", "winner-client"]);
    expect(crazyGamesSDK.happytime).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("celebrates when the winning client is me", async () => {
    setup(
      makeGame({
        winner: ["player", "my-client"],
        myClientID: "my-client",
        winnerPlayer: {
          isPlayer: () => true,
          clientID: () => "my-client",
          displayName: () => "Me",
          team: () => null,
          type: () => PlayerType.Human,
        },
      }),
    );
    modal!.tick();

    expect(crazyGamesSDK.happytime).toHaveBeenCalled();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("emits a winnerless result when the match is cancelled", async () => {
    const events = setup(makeGame({ winner: undefined }));
    modal!.tick();

    expect(events).toHaveLength(1);
    expect(events[0].winner).toBeUndefined();
    await vi.waitFor(() => expect(modal!.isVisible).toBe(true));
  });

  it("shows the buttons as soon as show() runs", async () => {
    setup(makeGame({ winner: ["team", "Blue"], myTeam: "Blue" }));
    document.body.appendChild(modal!);

    void modal!.show();
    await modal!.updateComplete;

    expect(modal!.isVisible).toBe(true);
    const exit = modal!.querySelector(
      "o-button[translationKey='win_modal.exit']",
    );
    expect(exit).not.toBeNull();
    expect(exit!.parentElement!.classList.contains("hidden")).toBe(false);
  });

  it("ignores a player win whose winner is not a known player", () => {
    const events = setup(
      makeGame({ winner: ["player", "gone"], winnerPlayer: undefined }),
    );
    modal!.tick();

    expect(events).toHaveLength(0);
    expect(modal!.isVisible).toBe(false);
  });
});
