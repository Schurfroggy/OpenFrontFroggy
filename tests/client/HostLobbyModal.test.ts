import { render } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const presenceMocks = vi.hoisted(() => ({
  isAvailable: vi.fn(() => false),
  openInviteDialog: vi.fn(async () => true),
}));

// The desktop bridge is absent in a browser and in jsdom. Mocking the module
// lets each test state which shell it is running in, which is the only thing
// the invite button is gated on.
vi.mock("../../src/client/DesktopPresence", () => ({
  desktopPresence: {
    isAvailable: presenceMocks.isAvailable,
    openInviteDialog: presenceMocks.openInviteDialog,
    set: vi.fn(),
    consumePendingInvite: vi.fn(async () => null),
    subscribeInvites: vi.fn(() => () => undefined),
  },
}));

import { ClientEnv } from "../../src/client/ClientEnv";
import { HostLobbyModal } from "../../src/client/HostLobbyModal";
import "../../src/client/components/baseComponents/Button";
import {
  GameMapType,
  GameMode,
  GameType,
  UnitType,
} from "../../src/core/game/Game";

describe("HostLobbyModal featured preset", () => {
  it("opens with the featured map and mode as its preset", () => {
    const modal = new HostLobbyModal();
    const open = vi.spyOn(modal, "open").mockImplementation(() => {});

    modal.openWithPreset(GameMapType.Europe, GameMode.Team);

    expect(open).toHaveBeenCalledWith({
      presetMap: GameMapType.Europe,
      presetMode: GameMode.Team,
      lockPreset: true,
    });
  });

  it("rejects map and mode changes while the preset is locked", () => {
    const modal = new HostLobbyModal() as any;
    modal.presetLocked = true;
    modal.selectedMap = GameMapType.Europe;
    modal.gameMode = GameMode.Team;
    modal.putGameConfig = vi.fn();

    modal.handleConfigMapSelected(
      new CustomEvent("map-selected", {
        detail: { map: GameMapType.Asia },
      }),
    );
    modal.handleConfigGameModeSelected(
      new CustomEvent("game-mode-selected", {
        detail: { mode: GameMode.FFA },
      }),
    );

    expect(modal.selectedMap).toBe(GameMapType.Europe);
    expect(modal.gameMode).toBe(GameMode.Team);
    expect(modal.putGameConfig).not.toHaveBeenCalled();
  });

  it("publishes achievement eligibility with the lobby config", async () => {
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
      const modal = new HostLobbyModal() as any;
      modal.constructUrl = vi.fn(async () => "http://localhost/");
      modal.updateLobbyHistory = vi.fn();
      const configs: any[] = [];
      modal.addEventListener("update-game-config", (event: Event) =>
        configs.push((event as CustomEvent).detail.config),
      );

      await modal.putGameConfig();
      modal.advancedSettingsEnabled = true;
      await modal.putGameConfig();

      expect(configs[0].selfHostedAchievementsEnabled).toBe(true);
      expect(configs[0].disabledUnits).toEqual([UnitType.MIRV]);
      expect(configs[1].selfHostedAchievementsEnabled).toBe(false);
    } finally {
      window.BOOTSTRAP_CONFIG = undefined;
      ClientEnv.reset();
    }
  });

  it("builds the featured map and team mode into the creation snapshot", () => {
    const modal = new HostLobbyModal() as any;
    modal.selectedMap = GameMapType.GreatLakes;
    modal.gameMode = GameMode.Team;
    modal.teamCount = 2;
    modal.defaultNationCount = 20;
    modal.nations = 20;

    const config = modal.currentGameConfig();

    expect(config).toMatchObject({
      gameMap: GameMapType.GreatLakes,
      gameMode: GameMode.Team,
      gameType: GameType.Private,
      playerTeams: 2,
      nations: "default",
    });
  });

  it("reconciles edits made while the host connection was opening", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = "game0001";
    modal.reconcileConfigAfterJoin = true;
    modal.selectedMap = GameMapType.GreatLakes;
    modal.gameMode = GameMode.Team;
    const updates: GameMode[] = [];
    modal.addEventListener("update-game-config", (event: Event) => {
      updates.push((event as CustomEvent).detail.config.gameMode);
    });
    const event = {
      myClientID: "host0001",
      lobby: {
        gameID: "game0001",
        lobbyCreatorClientID: "host0001",
        clients: [],
      },
    };

    modal.handleLobbyInfo(event);
    modal.handleLobbyInfo(event);

    expect(updates).toEqual([GameMode.Team]);
    expect(modal.reconcileConfigAfterJoin).toBe(false);
  });

  it("keeps a requested team-selection value until the server acknowledges it", () => {
    const modal = new HostLobbyModal() as any;
    modal.lobbyId = "game0001";
    modal.allowPlayerTeamSelection = true;
    modal.pendingAllowPlayerTeamSelection = true;
    const lobbyEvent = (allowed: boolean) => ({
      myClientID: "host0001",
      lobby: {
        gameID: "game0001",
        lobbyCreatorClientID: "host0001",
        clients: [],
        gameConfig: { allowPlayerTeamSelection: allowed },
      },
    });

    modal.handleLobbyInfo(lobbyEvent(false));
    expect(modal.allowPlayerTeamSelection).toBe(true);
    expect(modal.pendingAllowPlayerTeamSelection).toBe(true);

    modal.handleLobbyInfo(lobbyEvent(true));
    expect(modal.allowPlayerTeamSelection).toBe(true);
    expect(modal.pendingAllowPlayerTeamSelection).toBeNull();
  });

  it("publishes config before waiting for asynchronous URL construction", () => {
    const modal = new HostLobbyModal() as any;
    modal.constructUrl = vi.fn(() => new Promise(() => {}));
    const updates: unknown[] = [];
    modal.addEventListener("update-game-config", (event: Event) => {
      updates.push((event as CustomEvent).detail.config);
    });

    void modal.putGameConfig();

    expect(updates).toHaveLength(1);
  });
});

// The host holds the lobby code and decides who joins, so they are the player
// most likely to want this — and they were the one surface the button missed
// when it first shipped, because it lived inline in JoinLobbyModal. The
// gating and wiring are pinned here; whether Steam's dialog actually renders
// needs a packaged build, per OPE-200's acceptance criterion.
describe("HostLobbyModal Steam invite button", () => {
  const INVITE = "[data-test-invite-friends]";
  const COPY = "copy-button";

  function renderHeader(modal: HostLobbyModal): HTMLElement {
    const container = document.createElement("div");
    render(
      (
        modal as unknown as { renderHeaderSlot(): unknown }
      ).renderHeaderSlot() as never,
      container,
    );
    return container;
  }

  function hostModal(): HostLobbyModal {
    const modal = new HostLobbyModal();
    (modal as unknown as { lobbyId: string }).lobbyId = "ABCD1234";
    return modal;
  }

  beforeEach(() => {
    presenceMocks.isAvailable.mockReset().mockReturnValue(false);
    presenceMocks.openInviteDialog.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is absent in a browser, leaving the copy button alone", () => {
    presenceMocks.isAvailable.mockReturnValue(false);
    const header = renderHeader(hostModal());

    expect(header.querySelector(INVITE)).toBeNull();
    expect(header.querySelector(COPY)).not.toBeNull();
  });

  // createLobby() assigns lobbyId asynchronously and this modal renders before
  // it lands. A button live in that window has no shadow lobby behind it, so
  // the invite would silently no-op.
  it("is absent until the lobby id lands, even on the desktop shell", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const modal = new HostLobbyModal();

    expect(renderHeader(modal).querySelector(INVITE)).toBeNull();
  });

  it("appears beside the copy button on the desktop shell", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const header = renderHeader(hostModal());

    expect(header.querySelector(INVITE)).not.toBeNull();
    expect(header.querySelector(COPY)).not.toBeNull();
  });

  it("opens the Steam invite dialog when clicked", () => {
    presenceMocks.isAvailable.mockReturnValue(true);
    const button =
      renderHeader(hostModal()).querySelector<HTMLButtonElement>(INVITE);

    button?.click();

    expect(presenceMocks.openInviteDialog).toHaveBeenCalledOnce();
  });
});

describe("HostLobbyModal start button", () => {
  it("starts from a click on the internal native button", async () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    (window as unknown as { BOOTSTRAP_CONFIG: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "dev",
      selfHosted: true,
      turnstileSiteKey: "test",
      jwtAudience: "localhost",
      gitCommit: "test",
      numWorkers: 1,
    };
    const modal = new HostLobbyModal();
    (
      modal as unknown as {
        clients: Array<Record<string, unknown>>;
        lobbyId: string;
        renderBody(): unknown;
      }
    ).clients = [{}, {}];
    (modal as unknown as { lobbyId: string }).lobbyId = "a123456789";
    const start = vi.fn();
    modal.addEventListener("toggle_game_start_timer", start);

    const container = document.createElement("div");
    document.body.append(container);
    render(
      (
        modal as unknown as {
          renderBody(): unknown;
        }
      ).renderBody() as never,
      container,
    );
    const component = Array.from(container.querySelectorAll("o-button")).find(
      (candidate) =>
        typeof (candidate as unknown as { clickHandler?: unknown })
          .clickHandler === "function",
    );
    await (component as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;

    expect(component).toBeDefined();
    const nativeButton = component?.querySelector("button");
    expect(nativeButton?.disabled).toBe(false);
    nativeButton?.click();

    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    container.remove();
    vi.unstubAllGlobals();
  });
});
