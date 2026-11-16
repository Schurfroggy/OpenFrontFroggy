import { describe, expect, it } from "vitest";
import { WarFrontTracker } from "../../../src/client/controllers/WarFrontTracker";
const front = (x: number, y = 0, size = 50) => ({
  x,
  y,
  size,
  directionX: 1,
  directionY: 0,
  directionSource: "border" as const,
  retreating: false,
});
const connected = () => true;
describe("WarFrontTracker", () => {
  it("preserves separate identities when cluster sizes and ordering change", () => {
    const tracker = new WarFrontTracker();
    const first = tracker.update(
      "1>2",
      [front(0, 0, 80), front(0, 50, 40)],
      0,
      40,
      connected,
    );
    const next = tracker.update(
      "1>2",
      [front(2, 50, 90), front(2, 0, 30)],
      400,
      40,
      connected,
    );
    expect(next.find((f) => f.y === 0)?.id).toBe(first[0].id);
    expect(next.find((f) => f.y === 50)?.id).toBe(first[1].id);
  });
  it("retains an identity across the reinvestment gap and expires old fronts", () => {
    const tracker = new WarFrontTracker();
    const first = tracker.update("1>2", [front(0)], 0, 40, connected)[0];
    tracker.update("1>2", [], 400, 40, connected);
    expect(tracker.update("1>2", [front(2)], 800, 40, connected)[0].id).toBe(
      first.id,
    );
    tracker.prune(4000, 2000);
    expect(
      tracker.update("1>2", [front(2)], 4000, 40, connected)[0].id,
    ).not.toBe(first.id);
  });
  it("merges overlapping attacks but preserves opposite directions and water-separated fronts", () => {
    const tracker = new WarFrontTracker();
    const same = tracker.update(
      "1>2",
      [{ ...front(0), retreating: true }, front(1)],
      0,
      40,
      connected,
    );
    expect(same).toHaveLength(1);
    expect(same[0].retreating).toBe(false);
    const split = new WarFrontTracker().update(
      "1>2",
      [front(0), front(2)],
      0,
      40,
      () => false,
    );
    expect(split).toHaveLength(2);
    const opposite = new WarFrontTracker().update(
      "1>2",
      [front(0), { ...front(1), directionX: -1 }],
      0,
      40,
      connected,
    );
    expect(opposite).toHaveLength(2);
  });
  it("does not fly a reused identity over water or reverse it 180 degrees", () => {
    for (const reverse of [false, true]) {
      const tracker = new WarFrontTracker();
      const first = tracker.update("1>2", [front(0)], 0, 40, connected)[0];
      const next = tracker.update(
        "1>2",
        [{ ...front(1), directionX: reverse ? -1 : 1 }],
        400,
        40,
        () => reverse,
      )[0];
      expect(next.id).not.toBe(first.id);
    }
  });
  it("assigns a track only once when a front splits", () => {
    const tracker = new WarFrontTracker();
    const first = tracker.update("1>2", [front(0)], 0, 40, connected)[0];
    const next = tracker.update(
      "1>2",
      [front(-5), front(5)],
      400,
      40,
      connected,
    );
    expect(new Set(next.map((f) => f.id)).size).toBe(2);
    expect(next.filter((f) => f.id === first.id)).toHaveLength(1);
  });
});
