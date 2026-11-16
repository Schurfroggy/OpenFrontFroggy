import { beforeEach, describe, expect, it, vi } from "vitest";
import { WarFrontsController } from "../../../src/client/controllers/WarFrontsController";
import { MapViewModeEvent } from "../../../src/client/InputHandler";
import type { WarArrow } from "../../../src/client/render/gl/passes/WarArrowPass";
import defaults from "../../../src/client/render/gl/render-settings.json";
import { EventBus } from "../../../src/core/EventBus";
import { MessageType } from "../../../src/core/game/Game";
import {
  GameUpdateType,
  type UnitIncomingUpdate,
} from "../../../src/core/game/GameUpdates";
import type { WarFront } from "../../../src/core/game/WarFront";

function frontAt(pos: { x: number; y: number }): WarFront {
  return {
    ...pos,
    directionX: 1,
    directionY: 0,
    size: 50,
    directionSource: "border",
  };
}

function makeState(
  smallID: number,
  outgoing: {
    targetID: number;
    id: string;
    troops: number;
    retreating?: boolean;
  }[],
) {
  return {
    smallID,
    isAlive: true,
    allies: [] as number[],
    // Territory size drives the arrow's scale multiplier (1200 tiles = 1×).
    tilesOwned: 1200,
    outgoingAttacks: outgoing.map((o) => ({
      attackerID: smallID,
      targetID: o.targetID,
      troops: o.troops,
      id: o.id,
      retreating: o.retreating ?? false,
    })),
  };
}

function makeGame(opts: {
  mySmallID?: number;
  playerStates: Map<number, ReturnType<typeof makeState>>;
  clustered?: Map<string, { x: number; y: number }[]>;
  fronts?: Map<string, WarFront[]>;
  updates?: UnitIncomingUpdate[];
  ticks?: number;
  unitOwners?: Map<number, number>;
}) {
  const mySmallID = opts.mySmallID ?? 1;
  const players = Array.from(opts.playerStates.entries()).map(
    ([sid, state]) => ({
      smallID: () => sid,
      team: () => null,
      state,
      isPlayer: () => true,
      territoryColor: () => ({ toRgb: () => ({ r: 255, g: 0, b: 0 }) }),
      attackClusteredPositions: async () =>
        Array.from((opts.clustered ?? new Map()).entries()).map(
          ([id, positions]) => ({
            id,
            positions,
            fronts: opts.fronts?.get(id) ?? positions.map(frontAt),
          }),
        ),
    }),
  );
  return {
    myPlayer: () =>
      mySmallID === 0
        ? null
        : {
            smallID: () => mySmallID,
            team: () => null,
            state: opts.playerStates.get(mySmallID) ?? makeState(mySmallID, []),
          },
    players: () => players,
    playerBySmallID: (sid: number) => {
      const p = players.find((x) => x.smallID() === sid);
      if (!p) throw new Error(`player ${sid} not found`);
      return p;
    },
    x: (ref: number) => ref,
    y: () => 0,
    // Tile-ownership grid for direction sampling: default map splits at
    // x = 0 — player 1 (attacker) owns x < 0, player 2 (defender) owns
    // x > 0, mirroring the classic "A left, B right, fighting at the
    // middle" scenario.
    isValidCoord: () => true,
    ref: (x: number, y: number) => ({ x, y }),
    isLand: () => true,
    isImpassable: () => false,
    ownerID: (ref: { x: number }): number => (ref.x > 0 ? 2 : 1),
    ticks: () => opts.ticks ?? 0,
    updatesSinceLastTick: () =>
      opts.updates && opts.updates.length > 0
        ? { [GameUpdateType.UnitIncoming]: opts.updates }
        : null,
    unit: (id: number) => {
      const owner = opts.unitOwners?.get(id) ?? 0;
      return {
        isActive: () => true,
        owner: () => ({
          isPlayer: () => owner !== 0,
          smallID: () => owner,
        }),
      };
    },
  };
}

function makeView() {
  const arrows: WarArrow[][] = [];
  const highlightOwners: number[] = [];
  return {
    arrows,
    highlightOwners,
    updateWarArrows: (a: WarArrow[]) => arrows.push([...a]),
    setHighlightOwner: (id: number) => highlightOwners.push(id),
  };
}

describe("WarFrontsController", () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  function setup(
    game: ReturnType<typeof makeGame>,
    view = makeView(),
  ): { ctrl: WarFrontsController; view: ReturnType<typeof makeView> } {
    const ctrl = new WarFrontsController(
      game as never,
      eventBus,
      view as never,
    );
    ctrl.init();
    return { ctrl, view };
  }

  it("renders no arrows while the war view is off, even with active wars", () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
      ]),
    });
    const { ctrl, view } = setup(game);

    ctrl.tick();

    expect(view.arrows).toHaveLength(0);
  });

  it("constrains arrows near the front line, pointing into the defender's land", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      // Front anchor at (0,0); ownerID() splits at x=0: defender (2) owns
      // x>0 — the advance direction must be +X.
      clustered: new Map([["atk1", [{ x: 0, y: 0 }]]]),
    });
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));

    ctrl.tick();
    // Wait for the async clustered-positions RPC to settle and rebuild.
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.some((batch) => batch.length > 0)).toBe(true);
    });

    const last = view.arrows.filter((b) => b.length > 0).slice(-1)[0]!;
    expect(last).toHaveLength(1);
    const arrow = last[0]!;
    // Tail sits ~12 tiles behind the front (attacker's side, x<0)…
    expect(arrow.p0x).toBeCloseTo(-12, 0);
    expect(arrow.p0y).toBeCloseTo(0, 0);
    // …tip ~16 tiles past the front into the defender's land (x>0).
    expect(arrow.p3x).toBeCloseTo(16, 0);
    expect(arrow.p3y).toBeCloseTo(0, 0);
    expect(arrow.r).toBeCloseTo(1);
    expect(arrow.g).toBe(0);
    expect(arrow.retreating).toBe(false);
    // The new lance is aligned with the measured direction, without hash bends.
    expect(arrow.p1y).toBeCloseTo(0);
    expect(arrow.p2y).toBeCloseTo(0);
  });

  it("clears arrows when the view switches away from war", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["atk1", [{ x: 0, y: 0 }]]]),
    });
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.slice(-1)[0]!.length).toBe(1);
    });

    eventBus.emit(new MapViewModeEvent("default"));
    ctrl.tick();

    expect(view.arrows.slice(-1)[0]).toHaveLength(0);
  });

  it("shortens the arrow tip when the defender's land strip is thin", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["atk1", [{ x: 0, y: 0 }]]]),
    });
    // Defender (2) only owns a thin strip 0 < x <= 8; beyond it is sea.
    (game as { isLand: (ref: { x: number }) => boolean }).isLand = (ref) =>
      ref.x <= 8;
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));

    ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.some((batch) => batch.length > 0)).toBe(true);
    });

    const arrow = view.arrows.filter((b) => b.length > 0).slice(-1)[0]![0]!;
    // Tip clamps to the last defender tile (x=8) instead of reaching 16.
    expect(arrow.p3x).toBeLessThanOrEqual(8);
    expect(arrow.p3x).toBeGreaterThanOrEqual(6);
  });

  it("flags retreating attacks so the pass can blink them", async () => {
    const game = makeGame({
      playerStates: new Map([
        [
          1,
          makeState(1, [
            { targetID: 2, id: "atk1", troops: 10, retreating: true },
          ]),
        ],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["atk1", [{ x: 0, y: 0 }]]]),
    });
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));

    ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.slice(-1)[0]!.length).toBe(1);
    });

    expect(view.arrows.slice(-1)[0]![0]!.retreating).toBe(true);
  });

  it("publishes new targets for the render-loop animator", async () => {
    // Clustered front at x=0 initially.
    let clustered = new Map([["atk1", [{ x: 0, y: 0 }]]]);
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered,
    });
    // Re-wire the RPC to the live `clustered` so we can move the front.
    (
      game as {
        playerBySmallID: (sid: number) => {
          attackClusteredPositions: () => Promise<
            { id: string; positions: { x: number; y: number }[] }[]
          >;
        };
      }
    ).playerBySmallID = (sid: number) => {
      const p = game.players().find((x) => x.smallID() === sid)!;
      return {
        ...p,
        attackClusteredPositions: async () =>
          Array.from(clustered.entries()).map(([id, positions]) => ({
            id,
            positions,
            fronts: positions.map(frontAt),
          })),
      };
    };
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));

    ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.some((batch) => batch.length > 0)).toBe(true);
    });

    const first = view.arrows.filter((b) => b.length > 0).slice(-1)[0]![0]!;
    expect(first.p3x).toBeCloseTo(16, 0); // tip at +16 from front x=0

    // The front jumps 10 tiles right (+X). The target tip is now 26, but
    // the displayed arrow must ease toward it over ticks, not snap.
    clustered = new Map([["atk1", [{ x: 10, y: 0 }]]]);
    // Let the refresh window elapse (20 ticks) so the RPC pulls the new
    // front, then take a couple of glide steps.
    for (let i = 0; i < 22; i++) ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      const a = view.arrows.slice(-1)[0]![0]!;
      expect(a).toBeDefined();
      expect(a.p3x).toBeGreaterThan(16);
    });

    const eased = view.arrows.slice(-1)[0]![0]!;
    // Eased: strictly between the old tip (16) and the new target (26).
    expect(eased.p3x).toBeGreaterThan(16);
    expect(eased.p3x).toBeCloseTo(26);
  });

  it("does not invent a direction when the worker reports no contact", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["atk1", [{ x: 10, y: 0 }]]]),
      fronts: new Map([["atk1", []]]),
    });
    const spy = vi.spyOn(game.players()[0], "attackClusteredPositions");
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(spy).toHaveResolved());
    expect(view.arrows.every((batch) => batch.length === 0)).toBe(true);
  });

  it("scales arrow size with the smaller nation's territory", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "atk1", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["atk1", [{ x: 0, y: 0 }]]]),
    });
    // Both nations 4800 tiles → scale = √(4800/1200) = 2 → tip at 32.
    for (const p of game.players()) {
      p.state.tilesOwned = 4800;
    }
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));

    ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.some((batch) => batch.length > 0)).toBe(true);
    });

    const arrow = view.arrows.filter((b) => b.length > 0).slice(-1)[0]![0]!;
    expect(arrow.scale).toBeCloseTo(2);
    expect(arrow.p3x).toBeCloseTo(32, 0);
  });

  it("shows arrows for all wars, not just the local player's", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "mine", troops: 10 }])],
        [3, makeState(3, [{ targetID: 4, id: "theirs", troops: 99 }])],
        [2, makeState(2, [])],
        [4, makeState(4, [])],
      ]),
      clustered: new Map([
        ["mine", [{ x: 0, y: 0 }]],
        ["theirs", [{ x: 20, y: 0 }]],
      ]),
    });
    // Four-kingdom land column: 1 (x≤0) | 2 (0<x≤10) | 3 (10<x≤20) |
    // 4 (x>20) — each pair's defender owns land next to their front.
    (game as { ownerID: (ref: { x: number }) => number }).ownerID = (ref) =>
      ref.x > 20 ? 4 : ref.x > 10 ? 3 : ref.x > 0 ? 2 : 1;
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));

    ctrl.tick();
    await vi.waitFor(() => {
      ctrl.tick();
      expect(view.arrows.slice(-1)[0]!.length).toBe(2);
    });

    const arrows = view.arrows.slice(-1)[0]!;
    expect(arrows).toHaveLength(2);
  });

  it.each([1, 2, 4])(
    "keeps scaled tips inside a three-tile coastal strip (scale %s)",
    async (scale) => {
      const states = new Map([
        [1, makeState(1, [{ targetID: 2, id: "a", troops: 10 }])],
        [2, makeState(2, [])],
      ]);
      for (const state of states.values())
        state.tilesOwned = 1200 * scale * scale;
      const game = makeGame({
        playerStates: states,
        clustered: new Map([["a", [{ x: 0, y: 0 }]]]),
      });
      game.isLand = (ref?: { x: number }) => (ref?.x ?? 0) <= 3;
      const { ctrl, view } = setup(game);
      eventBus.emit(new MapViewModeEvent("war"));
      ctrl.tick();
      await vi.waitFor(() => expect(view.arrows.slice(-1)[0]?.length).toBe(1));
      expect(view.arrows.slice(-1)[0]![0].p3x).toBeLessThan(3.5);
    },
  );

  it("constrains the tail to the outer edge of the first tile", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "a", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["a", [{ x: 0, y: 0 }]]]),
    });
    game.isValidCoord = (x?: number) => (x ?? 0) >= 0;
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(view.arrows.slice(-1)[0]?.length).toBe(1));
    // Rendering adds 0.5 to tile-center coordinates.
    expect(view.arrows.slice(-1)[0]![0].p0x).toBeGreaterThanOrEqual(-0.5);
  });

  it("applies the configurable direction offset before fitting", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "a", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["a", [{ x: 0, y: 0 }]]]),
    });
    const view = {
      ...makeView(),
      getSettings: () => ({
        ...defaults,
        warArrows: { ...defaults.warArrows, directionOffsetDegrees: 30 },
      }),
    };
    const { ctrl } = setup(game, view);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(view.arrows.slice(-1)[0]?.length).toBe(1));
    const a = view.arrows.slice(-1)[0][0];
    expect(Math.atan2(a.p3y - a.p0y, a.p3x - a.p0x)).toBeCloseTo(Math.PI / 6);
  });

  it("uses the worker's diagonal direction even when surrounding land suggests +X", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "a", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["a", [{ x: 0, y: 0 }]]]),
      fronts: new Map([
        [
          "a",
          [
            {
              ...frontAt({ x: 0, y: 0 }),
              directionX: Math.SQRT1_2,
              directionY: -Math.SQRT1_2,
              directionSource: "conquest",
            },
          ],
        ],
      ]),
    });
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(view.arrows.slice(-1)[0]?.length).toBe(1));
    const arrow = view.arrows.slice(-1)[0]![0];
    expect(arrow.p3x).toBeGreaterThan(arrow.p0x);
    expect(arrow.p3y).toBeLessThan(arrow.p0y);
  });

  it("keeps multiple fronts stable across attack reinvestment and reversed result ordering", async () => {
    const state = makeState(1, [{ targetID: 2, id: "old", troops: 10 }]);
    const clustered = new Map([
      [
        "old",
        [
          { x: 0, y: 0 },
          { x: 0, y: 60 },
        ],
      ],
    ]);
    const game = makeGame({
      playerStates: new Map([
        [1, state],
        [2, makeState(2, [])],
      ]),
      clustered,
    });
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(view.arrows.slice(-1)[0]?.length).toBe(2));
    const ids = new Map(view.arrows.slice(-1)[0]!.map((a) => [a.p0y, a.id]));
    state.outgoingAttacks[0].id = "new";
    clustered.clear();
    clustered.set("new", [
      { x: 0, y: 60 },
      { x: 0, y: 0 },
    ]);
    for (let i = 0; i < 4; i++) ctrl.tick();
    await vi.waitFor(() => {
      expect(view.arrows.slice(-1)[0]?.length).toBe(2);
      for (const arrow of view.arrows.slice(-1)[0]!)
        expect(arrow.id).toBe(ids.get(arrow.p0y));
    });
  });

  it("fits the whole arrow between third-party territories", async () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "a", troops: 10 }])],
        [2, makeState(2, [])],
      ]),
      clustered: new Map([["a", [{ x: 0, y: 0 }]]]),
    });
    game.ownerID = (ref: { x: number; y?: number }) =>
      Math.abs(ref.y ?? 0) > 1 ? 3 : ref.x > 0 ? 2 : 1;
    const { ctrl, view } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(view.arrows.slice(-1)[0]?.length).toBe(1));
    const arrow = view.arrows.slice(-1)[0]![0];
    expect(arrow.scale * defaults.warArrows.headWidthTiles).toBeLessThan(1.5);
    expect(arrow.isPointValid?.(5, 2)).toBe(false);
  });

  it("does not request war evidence in fog-of-war games", () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [{ targetID: 2, id: "a", troops: 10 }])],
      ]),
    });
    const spy = vi.spyOn(game.players()[0], "attackClusteredPositions");
    const view = makeView();
    const ctrl = new WarFrontsController(
      game as never,
      eventBus,
      view as never,
      true,
    );
    ctrl.init();
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    expect(spy).not.toHaveBeenCalled();
    expect(view.arrows.every((a) => a.length === 0)).toBe(true);
  });

  it("round-robins past ten attacking players", async () => {
    const states = new Map(
      Array.from({ length: 12 }, (_, i) => [
        i + 1,
        makeState(i + 1, [{ targetID: 99, id: `a${i}`, troops: 10 }]),
      ]),
    );
    const game = makeGame({ playerStates: states });
    const calls = game
      .players()
      .map((p) => vi.spyOn(p, "attackClusteredPositions"));
    const { ctrl } = setup(game);
    eventBus.emit(new MapViewModeEvent("war"));
    ctrl.tick();
    await vi.waitFor(() => expect(calls[0]).toHaveBeenCalled());
    for (let i = 0; i < 5; i++) ctrl.tick();
    await vi.waitFor(() => expect(calls[11]).toHaveBeenCalled());
  });

  it("highlights the nuke attacker for 300 ticks when a nuke targets me", () => {
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [])],
        [2, makeState(2, [])],
      ]),
      updates: [
        {
          type: GameUpdateType.UnitIncoming,
          unitID: 42,
          message: "nuke",
          messageType: MessageType.NUKE_INBOUND,
          playerID: 1,
        } as UnitIncomingUpdate,
      ],
      unitOwners: new Map([[42, 2]]),
      ticks: 100,
    });
    const { ctrl, view } = setup(game);

    ctrl.tick();

    expect(view.highlightOwners).toEqual([2]);
  });

  it("clears the nuke highlight after 300 ticks", () => {
    let ticks = 100;
    let deliverUpdate = true;
    const game = makeGame({
      playerStates: new Map([
        [1, makeState(1, [])],
        [2, makeState(2, [])],
      ]),
      updates: [
        {
          type: GameUpdateType.UnitIncoming,
          unitID: 42,
          message: "nuke",
          messageType: MessageType.NUKE_INBOUND,
          playerID: 1,
        } as UnitIncomingUpdate,
      ],
      unitOwners: new Map([[42, 2]]),
      ticks,
    });
    // ticks / update delivery read via closures — emulate time passing and
    // the update arriving exactly once (as in a real per-tick diff).
    (game as { ticks: () => number }).ticks = () => ticks;
    const orig = game.updatesSinceLastTick.bind(game);
    (game as { updatesSinceLastTick: () => unknown }).updatesSinceLastTick =
      () => (deliverUpdate ? orig() : null);
    const { ctrl, view } = setup(game);

    ctrl.tick();
    expect(view.highlightOwners).toEqual([2]);
    deliverUpdate = false;

    ticks = 100 + 300; // 30 s at 10 ticks/sec
    ctrl.tick();
    expect(view.highlightOwners).toEqual([2, 0]);
  });

  it("ignores nukes aimed at other players", () => {
    const game = makeGame({
      mySmallID: 1,
      playerStates: new Map([[1, makeState(1, [])]]),
      updates: [
        {
          type: GameUpdateType.UnitIncoming,
          unitID: 42,
          message: "nuke",
          messageType: MessageType.NUKE_INBOUND,
          playerID: 7, // not me
        } as UnitIncomingUpdate,
      ],
      unitOwners: new Map([[42, 2]]),
    });
    const { ctrl, view } = setup(game);

    ctrl.tick();

    expect(view.highlightOwners).toHaveLength(0);
  });
});
