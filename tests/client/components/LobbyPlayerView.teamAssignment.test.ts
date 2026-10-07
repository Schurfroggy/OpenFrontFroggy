import { beforeEach, describe, expect, it, vi } from "vitest";
import "../../../src/client/components/LobbyPlayerView";
import type { LobbyTeamView } from "../../../src/client/components/LobbyPlayerView";
import { GameMode } from "../../../src/core/game/Game";
import type { ClientInfo } from "../../../src/core/Schemas";

function client(clientID: string): ClientInfo {
  return { clientID, username: clientID, clanTag: null };
}

function teamView(overrides: Partial<LobbyTeamView> = {}): LobbyTeamView {
  const view = document.createElement("lobby-player-view") as LobbyTeamView;
  Object.assign(view, {
    gameMode: GameMode.Team,
    teamCount: 2,
    currentClientID: "guest",
    lobbyCreatorClientID: "host",
    clients: [client("host"), client("guest")],
    ...overrides,
  });
  return view;
}

describe("lobby team assignment controls", () => {
  beforeEach(() => document.body.replaceChildren());

  it("keeps the dragged player id even when dataTransfer is unavailable", () => {
    const assign = vi.fn();
    const view = teamView({
      allowPlayerTeamSelection: true,
      onAssignPlayerTeam: assign,
    }) as any;
    const guest = view.clients[1];

    view.startPlayerDrag({ preventDefault: vi.fn() }, guest);
    view.dropPlayerOnTeam({ preventDefault: vi.fn() }, 1);

    expect(assign).toHaveBeenCalledWith("guest", 1);
    expect(view.draggingClientID).toBeNull();
  });

  it("lets a guest move only themselves when selection is enabled", () => {
    const assign = vi.fn();
    const view = teamView({
      allowPlayerTeamSelection: true,
      onAssignPlayerTeam: assign,
    }) as any;

    view.assignPlayer("guest", 1);
    expect(view.canControlPlayer(view.clients[1])).toBe(true);
    expect(view.canControlPlayer(view.clients[0])).toBe(false);
  });

  it("lets the host control every player independently of the guest toggle", () => {
    const view = teamView({
      currentClientID: "host",
      canManageAllTeams: true,
      allowPlayerTeamSelection: false,
      onAssignPlayerTeam: vi.fn(),
    }) as any;

    expect(view.canControlPlayer(view.clients[0])).toBe(true);
    expect(view.canControlPlayer(view.clients[1])).toBe(true);
  });
});
