import { describe, expect, it, vi } from "vitest";
import { AdminSetOutcomeExecution } from "../../../src/core/execution/AdminSetOutcomeExecution";
import { Game, Player, PlayerType } from "../../../src/core/game/Game";

function playerMock(overrides: Partial<Player> = {}): Player {
  return {
    hasSpawned: () => true,
    isAlive: () => true,
    team: () => null,
    type: () => PlayerType.Human,
    tiles: () => [11, 12],
    relinquish: vi.fn(),
    ...overrides,
  } as unknown as Player;
}

function gameMock(players: Player[]) {
  const stats = {
    stats: vi.fn(() => ({ mocked: true })),
    recordDeathPosition: vi.fn(),
    playerKilled: vi.fn(),
  };
  const game = {
    setWinner: vi.fn(),
    stats: () => stats,
    players: () => players,
  } as unknown as Game;
  return { game, stats };
}

describe("AdminSetOutcomeExecution", () => {
  it("awards an FFA victory to the administrator", () => {
    const player = playerMock();
    const { game, stats } = gameMock([player]);

    new AdminSetOutcomeExecution(player, "victory").init(game, 120);

    expect(game.setWinner).toHaveBeenCalledWith(player, stats.stats());
  });

  it("awards a team victory to the administrator's team", () => {
    const team = { id: () => "team-a" };
    const player = playerMock({ team: () => team as never });
    const { game, stats } = gameMock([player]);

    new AdminSetOutcomeExecution(player, "victory").init(game, 120);

    expect(game.setWinner).toHaveBeenCalledWith(team, stats.stats());
  });

  it("records and eliminates the administrator for a test defeat", () => {
    const player = playerMock();
    const otherHuman = playerMock();
    const bot = playerMock({ type: () => PlayerType.Bot });
    const { game, stats } = gameMock([player, otherHuman, bot]);

    new AdminSetOutcomeExecution(player, "defeat").init(game, 345);

    expect(stats.recordDeathPosition).toHaveBeenCalledWith(player, 2);
    expect(stats.playerKilled).toHaveBeenCalledWith(player, 345);
    expect(player.relinquish).toHaveBeenCalledTimes(2);
    expect(player.relinquish).toHaveBeenNthCalledWith(1, 11);
    expect(player.relinquish).toHaveBeenNthCalledWith(2, 12);
  });
});
