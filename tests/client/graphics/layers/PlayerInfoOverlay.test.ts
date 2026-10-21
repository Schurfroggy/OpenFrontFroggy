/**
 * Hovering an owned tile must show the owner's info card, and the name color
 * must reflect the local player's relation to them (friendly = green).
 */

vi.mock("lit", () => ({
  html: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
  LitElement: class extends EventTarget {
    requestUpdate() {}
  },
  nothing: "",
}));

vi.mock("lit/decorators.js", () => ({
  customElement: () => (clazz: unknown) => clazz,
  state: () => () => {},
  property: () => () => {},
  query: () => () => {},
}));

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
  renderDuration: vi.fn(() => ""),
  renderNumber: vi.fn(() => "0"),
  renderTroops: vi.fn(() => "0"),
  getTranslatedPlayerTeamLabel: vi.fn(() => ""),
  getSvgAspectRatio: vi.fn(() => 1),
}));

vi.mock("../../../../src/client/hud/PlayerIcons", () => ({
  EMOJI_ICON_KIND: "emoji",
  IMAGE_ICON_KIND: "image",
  getFirstPlacePlayer: vi.fn(() => null),
  getPlayerIcons: vi.fn(() => []),
}));

import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerInfoOverlay } from "../../../../src/client/hud/layers/PlayerInfoOverlay";
import { PlayerType, UnitType } from "../../../../src/core/game/Game";

// Flattens the mocked-html template tree into one string for assertions.
function flatten(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (typeof node === "object" && "strings" in (node as object)) {
    const { strings, values } = node as {
      strings: readonly string[];
      values: unknown[];
    };
    return strings.map((s, i) => s + flatten(values[i])).join("");
  }
  if (typeof node === "object") return "";
  return String(node);
}

describe("PlayerInfoOverlay", () => {
  let overlay: PlayerInfoOverlay;

  const hovered = {
    isPlayer: () => true,
    profile: () => Promise.resolve(null),
    getTraitorRemainingTicks: () => 0,
    outgoingAttacks: () => [],
    troops: () => 100,
    gold: () => 0n,
    type: () => PlayerType.Human,
    team: () => null,
    displayName: () => "Bob",
    cosmetics: {},
    id: () => "bob",
    smallID: () => 2,
  };

  const makeGame = (myPlayer: unknown) => ({
    isTileVisible: () => true,
    canViewPlayer: () => true,
    isUnitVisible: () => true,
    isValidCoord: () => true,
    ref: () => 42,
    owner: () => hovered,
    myPlayer: () => myPlayer,
    config: () => ({
      isUnitDisabled: () => true,
      maxTroops: () => 1000,
    }),
    teamClanTag: () => undefined,
  });

  beforeEach(() => {
    overlay = new PlayerInfoOverlay();
    overlay.eventBus = { on: vi.fn() } as never;
    overlay.transform = {
      screenToWorldCoordinates: () => ({ x: 5, y: 5 }),
    } as never;
    overlay.init();
  });

  it("shows the hovered player's card with a green name for a friend", () => {
    overlay.game = makeGame({
      isFriendly: () => true,
      isAlliedWith: () => false,
      smallID: () => 1,
    }) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("opacity-100 visible");
    expect(out).toContain("Bob");
    expect(out).toContain("text-green-500");
  });

  it("shows an expedition ship's owner and translated name, then hides it when sight is lost", () => {
    const ship = {
      type: () => UnitType.ExpeditionShip,
      owner: () => hovered,
      tile: () => 42,
      hasHealth: () => true,
      health: () => 250,
    };
    const units = vi.fn((...types: UnitType[]) =>
      types.includes(UnitType.ExpeditionShip) ? [ship] : [],
    );
    let visible = true;
    overlay.game = {
      ...makeGame(null),
      owner: () => ({ isPlayer: () => false }),
      isLand: () => false,
      x: () => 5,
      y: () => 5,
      units,
      isUnitVisible: () => visible,
    } as never;
    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());
    expect(out).toContain("opacity-100 visible");
    expect(out).toContain("Bob");
    expect(out).toContain("unit_type.expedition_ship");
    expect(out).toContain("250");
    visible = false;
    overlay.tick();
    expect(flatten(overlay.render())).toContain("opacity-0 invisible");
    overlay.maybeShow(10, 10);
    expect(flatten(overlay.render())).not.toContain(
      "unit_type.expedition_ship",
    );
  });

  it("shows a white name when there is no local player", () => {
    overlay.game = makeGame(null) as never;

    overlay.maybeShow(10, 10);
    const out = flatten(overlay.render());

    expect(out).toContain("Bob");
    expect(out).toContain("text-white");
    expect(out).not.toContain("text-green-500");
  });
});
