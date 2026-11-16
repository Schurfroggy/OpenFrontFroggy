import { afterEach, describe, expect, it, vi } from "vitest";
import { territoryVisionRadius } from "../src/core/game/FogOfWar";
import { fogIntel } from "../src/core/game/FogOfWarIntel";
import { Game, Player, UnitType } from "../src/core/game/Game";
import { GameImpl } from "../src/core/game/GameImpl";
import { intelScene } from "./util/FogAI";

function ally(game: Game, a: Player, b: Player) {
  (game as GameImpl).createAllianceRequest(a, b)!.accept();
}

function borderSnapshot(game: Game) {
  return game
    .players()
    .flatMap((p) =>
      [...p.borderTiles()].map((tile) => ({ tile, id: p.smallID() })),
    );
}

// Independent exhaustive oracle for land-only scenes: frozen candidate borders,
// current source borders, and direct friends. No shared cache or spatial grid.
function landContacts(
  game: Game,
  observer: Player,
  candidates: ReturnType<typeof borderSnapshot>,
): number[] {
  const friends = game
    .players()
    .filter(
      (p) =>
        p === observer || observer.isOnSameTeam(p) || observer.isAlliedWith(p),
    );
  const found = new Set(friends.map((p) => p.smallID()));
  for (const p of friends) {
    const radius = territoryVisionRadius(p.numTilesOwned());
    for (const tile of p.borderTiles()) {
      const owner = game.owner(tile);
      if (owner.isPlayer()) found.add(owner.smallID());
      for (const candidate of candidates) {
        const dx = game.x(tile) - game.x(candidate.tile);
        const dy = game.y(tile) - game.y(candidate.tile);
        if (dx * dx + dy * dy < radius * radius) found.add(candidate.id);
      }
    }
  }
  return game
    .players()
    .filter((p) => found.has(p.smallID()))
    .map((p) => p.smallID())
    .sort((a, b) => a - b);
}

function contacts(game: Game, observer: Player): number[] {
  const intel = fogIntel(game, observer);
  return game
    .players()
    .filter((p) => intel.knows(p))
    .map((p) => p.smallID())
    .sort((a, b) => a - b);
}

describe("shared territorial fog contacts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("scans an unchanged ally's border once for multiple observers in the same tick", async () => {
    const { game, a, b, c } = await intelScene();
    ally(game, a, b);
    ally(game, b, c);
    const candidates = borderSnapshot(game);
    // Warm the common spatial index, but no observer's country list yet.
    fogIntel(game, a);
    const border = vi.spyOn(b, "borderTiles");
    const expectedA = landContacts(game, a, candidates);
    const expectedC = landContacts(game, c, candidates);
    border.mockClear();
    expect(contacts(game, a)).toEqual(expectedA);
    expect(border).toHaveBeenCalledTimes(1);
    expect(contacts(game, c)).toEqual(expectedC);
    expect(border).toHaveBeenCalledTimes(1);
  });

  it("does not transitively share an ally's other alliances", async () => {
    const { game, a, b, c, add } = await intelScene();
    const d = add("d", 185);
    ally(game, a, b);
    ally(game, b, c);
    const candidates = borderSnapshot(game);
    // Warm B first: it sees both its direct allies and D through C.
    expect(contacts(game, b)).toEqual(landContacts(game, b, candidates));
    expect(fogIntel(game, b).knows(d)).toBe(true);
    expect(contacts(game, a)).toEqual(landContacts(game, a, candidates));
    expect(fogIntel(game, a).knows(c)).toBe(false);
    expect(fogIntel(game, a).knows(d)).toBe(false);
    expect(fogIntel(game, c).knows(a)).toBe(false);
  });

  it("does not put another observer's moving sources in the shared land cache", async () => {
    const { game, a, b, c, add } = await intelScene();
    const d = add("d", 10, 190);
    ally(game, a, b);
    ally(game, b, c);
    a.buildUnit(UnitType.Warship, d.spawnTile()!, {
      patrolTile: d.spawnTile()!,
    });
    expect(fogIntel(game, a).knows(d)).toBe(true);
    expect(fogIntel(game, b).knows(d)).toBe(true);
    expect(fogIntel(game, c).knows(d)).toBe(false);
  });

  it("invalidates same-tick land exchanges even when tile and border counts stay equal", async () => {
    const { game, a, b, c, add } = await intelScene();
    const d = add("d", 130);
    ally(game, a, b);
    ally(game, b, c);
    const candidates = borderSnapshot(game);
    expect(fogIntel(game, a).knows(d)).toBe(false);
    const beforeVersion = b.tileChangeVersion();
    const beforeSize = b.borderTiles().size;
    b.relinquish(b.spawnTile()!);
    b.conquer(game.ref(118, 100));
    expect(b.numTilesOwned()).toBe(1);
    expect(b.borderTiles().size).toBe(beforeSize);
    expect(b.tileChangeVersion()).toBeGreaterThan(beforeVersion);
    expect(contacts(game, c)).toEqual(landContacts(game, c, candidates));
    expect(fogIntel(game, c).knows(d)).toBe(true);
  });

  it("keys by the radius captured by each observer, not just the latest land version", async () => {
    const { game, a, b, c, add } = await intelScene();
    const d = add("d", 120);
    for (let x = 50; x < 100; x++)
      for (let y = 0; y < 200; y++)
        if (x !== 50 || y !== 0) b.conquer(game.ref(x, y));
    expect(b.numTilesOwned()).toBe(9999);
    ally(game, a, b);
    ally(game, b, c);
    // A captures radius 16 before the growth; defer building its country list.
    const beforeGrowth = fogIntel(game, a);
    b.conquer(game.ref(50, 0));
    expect(b.numTilesOwned()).toBe(10_000);
    // C now caches the same country's current borders at radius 24.
    expect(fogIntel(game, c).knows(d)).toBe(true);
    expect(beforeGrowth.knows(d)).toBe(false);
  });

  it("rebuilds on the next tick when a foreign border changes but the source does not", async () => {
    const { game, a, b, c, add } = await intelScene();
    const d = add("d", 102);
    const e = add("e", 190, 10);
    ally(game, a, b);
    ally(game, b, c);
    const candidates = borderSnapshot(game);
    const sourceVersion = b.tileChangeVersion();
    expect(fogIntel(game, a).knows(d)).toBe(true);
    e.conquer(d.spawnTile()!);
    expect(b.tileChangeVersion()).toBe(sourceVersion);
    // The existing sparse algorithm freezes candidate borders for this tick.
    expect(contacts(game, c)).toEqual(landContacts(game, c, candidates));
    expect(fogIntel(game, c).knows(d)).toBe(true);
    game.executeNextTick();
    expect(contacts(game, c)).toEqual(
      landContacts(game, c, borderSnapshot(game)),
    );
    expect(fogIntel(game, c).knows(d)).toBe(false);
    expect(fogIntel(game, c).knows(e)).toBe(true);
  });

  it("retains the strict circular radius at territory sight edges", async () => {
    const { game, a, b, c, add } = await intelScene();
    const outside = add("outside", 106);
    const inside = add("inside", 105);
    ally(game, a, b);
    ally(game, b, c);
    expect(fogIntel(game, a).knows(inside)).toBe(true);
    expect(fogIntel(game, a).knows(outside)).toBe(false);
    expect(fogIntel(game, c).knows(inside)).toBe(true);
    expect(fogIntel(game, c).knows(outside)).toBe(false);
  });
});
