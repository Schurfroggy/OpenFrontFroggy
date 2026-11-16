import type { WarFront } from "../../core/game/WarFront";

export interface TrackedWarFront extends WarFront {
  id: string;
  retreating: boolean;
}
interface Track {
  pair: string;
  front: TrackedWarFront;
  seen: number;
}

/** Spatial identity survives RPC ordering and attack reinvestment, not just IDs. */
export class WarFrontTracker {
  private tracks = new Map<string, Track>();
  private nextID = 0;

  clear(): void {
    this.tracks.clear();
    this.nextID = 0;
  }

  prune(now: number, retentionMs: number): void {
    for (const [id, track] of this.tracks) {
      if (now - track.seen > retentionMs) this.tracks.delete(id);
    }
  }

  update(
    pair: string,
    candidates: (WarFront & { retreating: boolean })[],
    now: number,
    maxDistance: number,
    connected: (a: WarFront, b: WarFront) => boolean,
  ): TrackedWarFront[] {
    const alignment = (a: WarFront, b: WarFront) =>
      a.directionX * b.directionX + a.directionY * b.directionY;
    const distance = (a: WarFront, b: WarFront) =>
      Math.hypot(a.x - b.x, a.y - b.y);
    // Multiple live attacks may cover the same border. Keep one arrow there,
    // but never average representatives across water or different directions.
    const fronts: typeof candidates = [];
    for (const candidate of [...candidates].sort(
      (a, b) => b.size - a.size || a.x - b.x || a.y - b.y,
    )) {
      const duplicate = fronts.find(
        (f) =>
          distance(f, candidate) <= 4 &&
          alignment(f, candidate) > 0.8 &&
          connected(f, candidate),
      );
      if (duplicate) duplicate.retreating &&= candidate.retreating;
      else fronts.push({ ...candidate });
    }
    fronts.splice(6);
    const matches: { index: number; track: Track; distance: number }[] = [];
    for (const track of this.tracks.values()) {
      if (track.pair !== pair) continue;
      fronts.forEach((front, index) => {
        const d = distance(front, track.front);
        if (
          d <= maxDistance &&
          alignment(front, track.front) > 0 &&
          connected(front, track.front)
        ) {
          matches.push({ index, track, distance: d });
        }
      });
    }
    matches.sort(
      (a, b) =>
        a.distance - b.distance ||
        a.track.front.id.localeCompare(b.track.front.id) ||
        a.index - b.index,
    );
    const assigned = new Map<number, string>();
    const used = new Set<string>();
    for (const match of matches) {
      if (assigned.has(match.index) || used.has(match.track.front.id)) continue;
      assigned.set(match.index, match.track.front.id);
      used.add(match.track.front.id);
    }
    return fronts.map((front, index) => {
      const id = assigned.get(index) ?? `${pair}:front${this.nextID++}`;
      const tracked = { ...front, id };
      this.tracks.set(id, { pair, front: tracked, seen: now });
      return tracked;
    });
  }
}
