import { describe, expect, it } from "vitest";
import {
  arrowFits,
  arrowSections,
  arrowShape,
  WarArrowAnimator,
} from "../../../src/client/render/gl/passes/WarArrowGeometry";
import type { WarArrow } from "../../../src/client/render/gl/passes/WarArrowPass";
import defaults from "../../../src/client/render/gl/render-settings.json";
const cfg = defaults.warArrows;
const arrow = (x = 0): WarArrow => ({
  id: "1>2",
  p0x: x,
  p0y: 0,
  p1x: x + 10,
  p1y: 0,
  p2x: x + 20,
  p2y: 0,
  p3x: x + 30,
  p3y: 0,
  r: 1,
  g: 0,
  b: 0,
  scale: 1,
  fade: 1,
  retreating: false,
});
describe("continuous war lance", () => {
  it("has a wide flat tail tapering toward the narrow neck", () => {
    const sections = arrowSections(arrow(), cfg);
    expect(sections[0].width).toBe(cfg.widthStartTiles);
    const shaft = sections.filter(
      (s) => s.s < arrowShape(arrow(), cfg).shoulder,
    );
    for (let i = 1; i < shaft.length; i++)
      expect(shaft[i].width).toBeLessThan(shaft[i - 1].width);
    expect(sections.slice(-1)[0]!.width).toBe(0);
    expect(Math.max(...sections.map((s) => s.width))).toBeCloseTo(
      cfg.headWidthTiles,
    );
    expect(
      sections.every((s) => Number.isFinite(s.width) && s.width >= 0),
    ).toBe(true);
    const tiny = arrowSections({ ...arrow(), p3x: 2 }, cfg);
    expect(Math.max(...tiny.map((s) => s.width))).toBeLessThan(1);
  });
  it.each([0.2, 1, 4])(
    "keeps both swept shoulder angles below 45 degrees at scale %s",
    (scale) => {
      const shape = arrowShape({ ...arrow(), scale }, cfg);
      const outer = Math.atan2(shape.headWidth, shape.length - shape.shoulder);
      const inner = Math.atan2(shape.headWidth, shape.notch - shape.shoulder);
      const angle = ((inner - outer) * 180) / Math.PI;
      expect(angle).toBeGreaterThan(0);
      expect(angle).toBeLessThan(45);
      expect(shape.notch).toBeGreaterThan(shape.shoulder);
      expect(shape.notch).toBeLessThan(shape.length);
    },
  );
  it("checks the shoulders, not only the centerline", () => {
    const a = {
      ...arrow(),
      isPointValid: (_x: number, y: number) => Math.abs(y) < 2,
    };
    expect(arrowFits(a, cfg)).toBe(false);
    expect(arrowFits({ ...a, scale: 0.2 }, cfg)).toBe(true);
  });
  it("reveals tail to tip using time", () => {
    const anim = new WarArrowAnimator(cfg);
    anim.update([arrow()], 100);
    expect(anim.frame(100)[0].reveal).toBe(0);
    expect(anim.frame(100 + cfg.revealMs / 2)[0].reveal).toBeCloseTo(0.5);
    expect(anim.frame(100 + cfg.revealMs)[0].reveal).toBe(1);
  });
  it("moves between ticks and is frame-rate independent", () => {
    const run = (step: number) => {
      const anim = new WarArrowAnimator(cfg);
      anim.update([arrow()], 0);
      anim.update([arrow(10)], 100);
      for (let t = step; t <= 240; t += step) anim.frame(t);
      return anim.frame(240)[0].p0x;
    };
    expect(run(10)).toBeCloseTo(run(40), 8);
    expect(run(10)).toBeGreaterThan(0);
    expect(run(10)).toBeLessThan(10);
  });
  it("RPC updates do not accelerate the disappearance timer", () => {
    const anim = new WarArrowAnimator(cfg);
    anim.update([arrow()], 0);
    anim.update([], 100);
    for (let i = 0; i < 100; i++) anim.update([], 110);
    expect(anim.frame(200)[0].fade).toBe(1);
    expect(
      anim.frame(100 + cfg.lingerMs + cfg.fadeOutMs / 2)[0].fade,
    ).toBeCloseTo(0.5);
    expect(anim.frame(100 + cfg.lingerMs + cfg.fadeOutMs)).toEqual([]);
  });
  it("does not interpolate through a water gap", () => {
    const valid = (x: number) => x <= 30 || x >= 60;
    const anim = new WarArrowAnimator({ ...cfg, jumpDistanceTiles: 100 });
    anim.update([{ ...arrow(), isPointValid: valid }], 0);
    anim.update([{ ...arrow(60), isPointValid: valid }], 100);
    const a = anim.frame(200)[0];
    expect(arrowFits(a, cfg)).toBe(true);
    expect(a.reveal).toBe(0);
  });
  it("clears state when the view closes", () => {
    const anim = new WarArrowAnimator(cfg);
    anim.update([arrow()], 0);
    anim.clear();
    expect(anim.frame(500)).toEqual([]);
  });
});
