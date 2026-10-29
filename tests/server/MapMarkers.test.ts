import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameMapSize, GameMapType, GameMode } from "../../src/core/game/Game";
import { type ServerMessage } from "../../src/core/Schemas";
import { createGameWireContext } from "../../src/core/ZbinWire";
import {
  makeClient,
  makeGame,
  makeMockWs,
  mockLogger,
  mockWsOf,
  startGame,
} from "../util/GameServerHarness";

describe("server map marker channel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function setup(team = true) {
    const log = mockLogger();
    const game = makeGame({
      log,
      config: {
        gameMode: team ? GameMode.Team : GameMode.FFA,
        playerTeams: 2,
        nations: "disabled",
        gameMap: GameMapType.China,
        gameMapSize: GameMapSize.Compact,
      },
    });
    const a = makeClient({ clanTag: "AAA" });
    const b = makeClient({ clanTag: "AAA" });
    const enemy = makeClient({ clanTag: "BBB" });
    const spectator = makeClient({ spectator: true });
    const clients = [a, b, enemy, spectator];
    for (const c of clients) game.joinClient(c);
    startGame(game);
    const start = mockWsOf(a)
      .sent()
      .find((m) => m.type === "start");
    if (start?.type !== "start") throw new Error("Missing start");
    const ctx = createGameWireContext(start.gameStartInfo.players);
    for (const c of clients) mockWsOf(c).send.mockClear();
    const snapshots = (c: typeof a) =>
      mockWsOf(c)
        .sent(ctx)
        .filter(
          (m): m is Extract<ServerMessage, { type: "map_markers" }> =>
            m.type === "map_markers",
        );
    return { game, a, b, enemy, spectator, ctx, snapshots, log };
  }
  const add = { type: "map_marker", action: "add", x: 10, y: 10 } as const;

  it("filters teammates on the server, enforces ownership and restores on rejoin", async () => {
    const { game, a, b, enemy, spectator, snapshots, ctx, log } = setup();
    await mockWsOf(a).emit(add);
    expect(log.error).not.toHaveBeenCalled();
    const markers = snapshots(a).slice(-1)[0]!.markers;
    expect(snapshots(b).slice(-1)[0]?.addedId).toBe(markers[0].id);
    expect(markers).toHaveLength(1);
    expect(snapshots(b).slice(-1)[0]?.markers).toEqual(markers);
    expect(snapshots(enemy)).toEqual([]);
    expect(snapshots(spectator)).toEqual([]);
    await mockWsOf(b).emit({
      type: "map_marker",
      action: "remove",
      id: markers[0].id,
    });
    expect(snapshots(a).slice(-1)[0]?.markers).toEqual(markers);
    await mockWsOf(a).trigger("close");
    const ws = makeMockWs();
    expect(game.rejoinClient(ws as any, a.persistentID)).toBe(true);
    expect(ws.sent(ctx).find((m) => m.type === "map_markers")).toEqual({
      type: "map_markers",
      markers,
    });
    await ws.emit({ type: "map_marker", action: "clear" });
    expect(snapshots(b).slice(-1)[0]?.markers).toEqual([]);
  });
  it("does not share FFA markers even with matching clan tags", async () => {
    const { a, b, snapshots } = setup(false);
    await mockWsOf(a).emit(add);
    expect(snapshots(a).slice(-1)[0]?.markers).toHaveLength(1);
    expect(snapshots(b)).toEqual([]);
  });
  it("rejects spectators, out-of-map coordinates and spam, and silently replaces the oldest", async () => {
    const { a, spectator, snapshots } = setup();
    await mockWsOf(spectator).emit(add);
    await mockWsOf(a).emit({ ...add, x: 65535 });
    expect(snapshots(a)).toEqual([]);
    await mockWsOf(a).emit(add);
    await mockWsOf(a).emit({ ...add, x: 11 });
    expect(snapshots(a)).toHaveLength(1);
    for (let x = 11; x <= 13; x++) {
      vi.setSystemTime(Date.now() + 250);
      await mockWsOf(a).emit({ ...add, x });
    }
    expect(
      snapshots(a)
        .slice(-1)[0]
        ?.markers.map((m) => m.x),
    ).toEqual([11, 12, 13]);
  });
});
