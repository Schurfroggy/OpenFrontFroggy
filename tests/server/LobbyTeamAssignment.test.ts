import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Duos, GameMode } from "../../src/core/game/Game";
import { GameServer } from "../../src/server/GameServer";
import { IntentActor } from "../../src/server/IntentAuthorization";
import {
  cid,
  makeClient,
  makeGame,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

describe("private lobby team assignment", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  const hostID = cid("teamhost");
  const guestID = cid("teamgst");
  const thirdID = cid("teamthrd");
  const hostActor: IntentActor = {
    clientID: hostID,
    isLobbyCreator: true,
    isAdmin: false,
    isAdminBot: false,
  };
  const guestActor: IntentActor = {
    clientID: guestID,
    isLobbyCreator: false,
    isAdmin: false,
    isAdminBot: false,
  };

  function setup(): {
    game: GameServer;
    host: ReturnType<typeof makeClient>;
  } {
    const game = makeGame({
      creatorPersistentID: "team-host-pid",
      config: {
        gameMode: GameMode.Team,
        playerTeams: Duos,
        nations: 1,
      },
    });
    const host = makeClient({
      clientID: hostID,
      persistentID: "team-host-pid",
      username: "HostPlayer",
    });
    game.joinClient(host);
    game.joinClient(makeClient({ clientID: guestID, username: "GuestPlayer" }));
    game.joinClient(makeClient({ clientID: thirdID, username: "ThirdPlayer" }));
    return { game, host };
  }

  const assignments = (game: GameServer) =>
    Object.fromEntries(
      (game.gameInfo(hostID).clients ?? []).map((client) => [
        client.clientID,
        client.teamIndex,
      ]),
    );

  it("packs humans together within fixed squad capacity", () => {
    const { game } = setup();
    expect(
      game.handleIntent(
        { type: "apply_team_preset", preset: "humans_together" },
        hostActor,
      ).status,
    ).toBe(200);
    expect(assignments(game)).toMatchObject({
      [hostID]: 0,
      [guestID]: 0,
      [thirdID]: 1,
    });
  });

  it("balances humans and prevents fixed squads from overflowing", () => {
    const { game } = setup();
    expect(
      game.handleIntent(
        { type: "apply_team_preset", preset: "balanced" },
        hostActor,
      ).status,
    ).toBe(200);
    expect(assignments(game)).toMatchObject({
      [hostID]: 0,
      [guestID]: 1,
      [thirdID]: 0,
    });
    expect(
      game.handleIntent(
        { type: "set_player_team", targetClientID: guestID, teamIndex: 0 },
        hostActor,
      ).status,
    ).toBe(409);
  });

  it("lets an enabled guest move only themselves", () => {
    const { game } = setup();
    expect(
      game.handleIntent(
        { type: "set_player_team", targetClientID: guestID, teamIndex: 1 },
        guestActor,
      ).status,
    ).toBe(403);

    game.handleIntent(
      {
        type: "update_game_config",
        config: { allowPlayerTeamSelection: true },
      },
      hostActor,
    );
    expect(
      game.handleIntent(
        { type: "set_player_team", targetClientID: guestID, teamIndex: 1 },
        guestActor,
      ).status,
    ).toBe(200);
    expect(
      game.handleIntent(
        { type: "set_player_team", targetClientID: thirdID, teamIndex: 1 },
        guestActor,
      ).status,
    ).toBe(403);
  });

  it("uses the lobby preview assignment when the game starts", () => {
    const { game, host } = setup();
    game.handleIntent(
      { type: "apply_team_preset", preset: "humans_together" },
      hostActor,
    );
    startGame(game);
    const start = mockWsOf(host)
      .sent()
      .find((message) => message.type === "start");
    expect(start?.type).toBe("start");
    if (start?.type !== "start") return;
    expect(
      Object.fromEntries(
        start.gameStartInfo.players.map((player) => [
          player.clientID,
          player.teamIndex,
        ]),
      ),
    ).toMatchObject({ [hostID]: 0, [guestID]: 0, [thirdID]: 1 });
  });
});
