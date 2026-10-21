import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../../src/client/hud/layers/NationLabelOverlay";
import type { NationLabelOverlay } from "../../src/client/hud/layers/NationLabelOverlay";
import {
  NATION_NAMES_EVENT,
  setNationNamesEnabled,
  setNationNamesLanguage,
} from "../../src/client/NationNames";

// Minimal stand-ins: the overlay only reads id/isAlive/static.displayName/
// nationFlag/nameData from a player, and scale + projection from the camera.
function player(overrides: Record<string, unknown> = {}) {
  return {
    id: () => "p1",
    isAlive: () => true,
    static: { displayName: "United States" },
    nationFlag: "us",
    nameData: { x: 10, y: 20, size: 6 },
    ...overrides,
  };
}

function makeOverlay(players: unknown[]): NationLabelOverlay {
  const overlay = document.createElement(
    "nation-label-overlay",
  ) as NationLabelOverlay;
  document.body.appendChild(overlay);
  overlay.game = {
    isTileVisible: () => true,
    ref: () => 0,
    players: () => players,
  } as never;
  overlay.transform = {
    scale: 10,
    worldToScreenCoordinates: () => ({ x: 100, y: 200 }),
  } as never;
  return overlay;
}

function repaint(): void {
  window.dispatchEvent(new CustomEvent(NATION_NAMES_EVENT));
}

beforeEach(() => {
  localStorage.clear();
  setNationNamesLanguage("zh-CN");
});

afterEach(() => {
  document.querySelector("nation-label-overlay")?.remove();
  setNationNamesEnabled(false);
  localStorage.clear();
});

describe("nation-label-overlay", () => {
  it("draws the Chinese name where the renderer would have drawn English", () => {
    setNationNamesEnabled(true);
    const overlay = makeOverlay([player()]);
    repaint();

    const label = overlay.querySelector("div");
    expect(label?.textContent).toBe("美国");
    // nameData.size is in world units; the camera scale turns it into pixels.
    expect((label as HTMLElement).style.fontSize).toBe("60px");
    expect((label as HTMLElement).style.display).toBe("");
  });

  it("leaves untranslated places to the renderer", () => {
    setNationNamesEnabled(true);
    const overlay = makeOverlay([
      player({ id: () => "p2", static: { displayName: "Murmansk" } }),
    ]);
    repaint();

    expect(overlay.querySelector("div")).toBeNull();
  });

  it("tells the two Georgias apart by their flag", () => {
    setNationNamesEnabled(true);
    const overlay = makeOverlay([
      player({
        id: () => "us-ga",
        static: { displayName: "Georgia" },
        nationFlag: "Georgia_US",
      }),
    ]);
    repaint();
    expect(overlay.querySelector("div")?.textContent).toBe("佐治亚");
  });

  it("draws nothing while the option is off", () => {
    const overlay = makeOverlay([player()]);
    repaint();
    expect(overlay.querySelector("div")).toBeNull();
  });

  it("hides a label for a dead player", () => {
    setNationNamesEnabled(true);
    const overlay = makeOverlay([player({ isAlive: () => false })]);
    repaint();
    expect(overlay.querySelector("div")).toBeNull();
  });
});
