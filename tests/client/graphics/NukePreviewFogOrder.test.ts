import { describe, expect, it, vi } from "vitest";
import { GPURenderer } from "../../../src/client/render/gl/Renderer";
import { GhostPreviewData } from "../../../src/client/render/types";
import { UnitType } from "../../../src/core/game/Game";

function scene(fog: boolean, ghost: UnitType | null) {
  const order: string[] = [];
  const pass = (name: string) => ({
    draw: vi.fn(() => order.push(name)),
    update: vi.fn(),
    updateGhostPreview: vi.fn(),
    setVisible: vi.fn(),
    setGhostCostLabel: vi.fn(),
    tick: vi.fn(),
  });
  const renderer = Object.create(GPURenderer.prototype) as GPURenderer;
  Object.assign(renderer, {
    fogEnabled: false,
    nukeRangePreview: false,
    camera: { getMatrix: () => new Float32Array(9), zoom: 1 },
    canvas: { width: 100, height: 100 },
    settings: {
      lighting: { enabled: false },
      passEnabled: { unit: true, structure: true },
    },
    altView: true,
    gl: {
      bindFramebuffer: vi.fn(),
      viewport: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      blendFunc: vi.fn(),
    },
    drawBaseLayer: vi.fn(() => order.push("terrain")),
    updateSelectionBox: vi.fn(),
    fogPass: pass("fog"),
    rangeCirclePass: pass("range"),
    nukeTrajectoryPass: pass("trajectory"),
    samRadiusPass: pass("SAM coverage"),
    nukeTelegraphPass: pass("in-flight target"),
    spawnOverlayPass: pass("spawn"),
    railroadPass: pass("railroad"),
    warArrowPass: pass("war"),
    crosshairPass: pass("crosshair"),
    structurePass: pass("structures"),
    structureLevelPass: pass("levels"),
    smallPlayerGlowPass: pass("glow"),
    selectionBoxPass: pass("selection"),
    moveIndicatorPass: pass("move"),
    worldTextPass: pass("text"),
    coordinateGridPass: pass("grid"),
    unitPass: {
      drawGround: () => order.push("units"),
      drawMissiles: () => order.push("missiles"),
    },
  });
  renderer.updateFog(fog ? new Uint8Array(1) : null);
  renderer.updateGhostPreview(
    ghost ? ({ ghostType: ghost, showCost: false } as GhostPreviewData) : null,
  );
  const draw = () => {
    order.length = 0;
    (renderer as unknown as { renderFrame(): void }).renderFrame();
    return [...order];
  };
  return { renderer, draw };
}

describe("nuke targeting over fog", () => {
  it.each([UnitType.AtomBomb, UnitType.HydrogenBomb])(
    "draws %s range and trajectory above fog, while world information stays below",
    (type) => {
      const { draw } = scene(true, type);
      const order = draw();
      expect(order.indexOf("range")).toBeGreaterThan(order.indexOf("fog"));
      expect(order.indexOf("trajectory")).toBeGreaterThan(order.indexOf("fog"));
      expect(order.filter((name) => name === "range")).toHaveLength(1);
      expect(order.filter((name) => name === "trajectory")).toHaveLength(1);
      for (const name of [
        "units",
        "structures",
        "missiles",
        "SAM coverage",
        "in-flight target",
      ]) {
        expect(order.indexOf(name)).toBeLessThan(order.indexOf("fog"));
      }
    },
  );
  it("keeps ordinary structure ranges below fog after switching from a nuke", () => {
    const { renderer, draw } = scene(true, UnitType.AtomBomb);
    renderer.updateGhostPreview({
      ghostType: UnitType.SAMLauncher,
      showCost: false,
    } as GhostPreviewData);
    const order = draw();
    expect(order.indexOf("range")).toBeLessThan(order.indexOf("fog"));
    renderer.updateGhostPreview(null);
    expect(draw().indexOf("range")).toBeLessThan(draw().indexOf("fog"));
  });
  it("preserves the original draw order when fog is disabled", () => {
    const { renderer, draw } = scene(true, UnitType.HydrogenBomb);
    renderer.updateFog(null);
    const order = draw();
    expect(order.indexOf("range")).toBeLessThan(order.indexOf("structures"));
    expect(order.indexOf("trajectory")).toBeLessThan(
      order.indexOf("structures"),
    );
  });
});
