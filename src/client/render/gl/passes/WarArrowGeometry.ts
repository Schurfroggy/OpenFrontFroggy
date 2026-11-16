import type { RenderSettings } from "../RenderSettings";
import type { WarArrow } from "./WarArrowPass";

type Settings = RenderSettings["warArrows"];
/** Shared dimensions for the renderer and conservative terrain envelope. */
export function arrowShape(a: WarArrow, cfg: Settings) {
  const length = Math.hypot(a.p3x - a.p0x, a.p3y - a.p0y);
  const size = Math.min(a.scale, length / 10);
  const headLength = Math.min(cfg.headLenTiles * a.scale, length * 0.55);
  const shoulder = length - headLength;
  const notch =
    shoulder + headLength * Math.max(0.1, Math.min(0.8, cfg.headSweepRatio));
  return {
    length,
    shoulder,
    notch,
    tailWidth: cfg.widthStartTiles * size,
    neckWidth: cfg.widthTipTiles * size,
    headWidth: cfg.headWidthTiles * size,
  };
}

/** Conservative envelope, including the swept-back shoulder tips.
 * The shader cuts the two concave notches out of this envelope. */
export function arrowSections(a: WarArrow, cfg: Settings) {
  const shape = arrowShape(a, cfg);
  const { length, shoulder, notch, tailWidth, neckWidth, headWidth } = shape;
  if (length < 0.01) return [];
  const dx = a.p3x - a.p0x,
    dy = a.p3y - a.p0y;
  const nx = -dy / length,
    ny = dx / length;
  const count = Math.max(8, Math.ceil(length * 2));
  const join =
    notch - ((notch - shoulder) * neckWidth) / Math.max(headWidth, 0.001);
  const distances = new Set([0, shoulder, join, notch, length]);
  for (let i = 1; i < count; i++) distances.add((length * i) / count);
  return [...distances]
    .sort((a, b) => a - b)
    .map((s) => {
      const shaft =
        s <= join
          ? tailWidth + ((neckWidth - tailWidth) * s) / Math.max(0.001, join)
          : 0;
      const head =
        s >= shoulder
          ? (headWidth * (length - s)) / Math.max(0.001, length - shoulder)
          : 0;
      return {
        x: a.p0x + (dx * s) / length,
        y: a.p0y + (dy * s) / length,
        nx,
        ny,
        width: Math.max(shaft, head),
        s,
        length,
      };
    });
}

export function arrowFits(a: WarArrow, cfg: Settings): boolean {
  if (!a.isPointValid) return true;
  for (const p of arrowSections(a, cfg)) {
    const steps = Math.max(1, Math.ceil(p.width * 4));
    for (let i = 0; i <= steps; i++) {
      const offset = p.width * ((2 * i) / steps - 1);
      if (!a.isPointValid(p.x + p.nx * offset, p.y + p.ny * offset))
        return false;
    }
  }
  return true;
}

interface Track {
  current: WarArrow;
  target: WarArrow;
  born: number;
  missing?: number;
  last: number;
}
/** Wall-clock animation, independent of simulation ticks and RPC count. */
export class WarArrowAnimator {
  private tracks = new Map<string, Track>();
  constructor(private cfg: Settings) {}
  clear() {
    this.tracks.clear();
  }
  update(arrows: WarArrow[], now: number) {
    const live = new Set<string>();
    for (const a of arrows) {
      const id = a.id ?? `${a.r}:${a.g}:${a.b}`;
      live.add(id);
      const old = this.tracks.get(id);
      if (
        !old ||
        Math.hypot(old.current.p3x - a.p3x, old.current.p3y - a.p3y) >
          this.cfg.jumpDistanceTiles
      ) {
        // A new theatre must not fly across unrelated land.
        if (old)
          this.tracks.set(`${id}:departing:${now}`, {
            ...old,
            missing: now - this.cfg.lingerMs,
          });
        this.tracks.set(id, {
          current: { ...a },
          target: a,
          born: now,
          last: now,
        });
      } else {
        old.target = a;
        old.missing = undefined;
      }
    }
    for (const [id, t] of this.tracks) if (!live.has(id)) t.missing ??= now;
  }
  frame(now: number): WarArrow[] {
    const out: WarArrow[] = [];
    for (const [id, t] of this.tracks) {
      const age =
        t.missing === undefined
          ? 0
          : Math.max(0, now - t.missing - this.cfg.lingerMs);
      const fade = 1 - Math.min(1, age / Math.max(1, this.cfg.fadeOutMs));
      if (fade <= 0) {
        this.tracks.delete(id);
        continue;
      }
      const k =
        1 -
        Math.exp(
          -Math.max(0, now - t.last) / Math.max(1, this.cfg.smoothingMs),
        );
      t.last = now;
      const next = { ...t.target };
      for (const key of [
        "p0x",
        "p0y",
        "p1x",
        "p1y",
        "p2x",
        "p2y",
        "p3x",
        "p3y",
        "scale",
      ] as const)
        next[key] = t.current[key] + (t.target[key] - t.current[key]) * k;
      if (!arrowFits(next, this.cfg)) {
        // Interpolation across a coast is unsafe even when both endpoints fit.
        if (!arrowFits(t.target, this.cfg)) continue;
        t.current = { ...t.target };
        t.born = now;
      } else t.current = next;
      out.push({
        ...t.current,
        fade,
        reveal: Math.min(1, (now - t.born) / Math.max(1, this.cfg.revealMs)),
      });
    }
    return out;
  }
}
