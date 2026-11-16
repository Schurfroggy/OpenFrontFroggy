import type { GameImpl } from "./GameImpl";
import type { TileRef } from "./GameMap";

/** Worker-owned, terrain-validated evidence for one disconnected land front. */
export interface WarFront {
  x: number;
  y: number;
  directionX: number;
  directionY: number;
  size: number;
  directionSource: "conquest" | "border";
}

export interface ConquestSample {
  x: number;
  y: number;
  dx: number;
  dy: number;
  tick: number;
}

/** Visual derivation only: never changes combat state or consumes game RNG. */
export function deriveWarFronts(
  game: GameImpl,
  border: ReadonlySet<TileRef>,
  attacker: number,
  defender: number,
  recent: readonly ConquestSample[],
): WarFront[] {
  const map = game.map();
  const neighbors: TileRef[] = [];
  const contacts = new Map<TileRef, { dx: number; dy: number }[]>();
  for (const tile of border) {
    if (
      !map.isLand(tile) ||
      map.isImpassable(tile) ||
      map.ownerID(tile) !== defender
    )
      continue;
    const edges: { dx: number; dy: number }[] = [];
    const count = map.neighbors4(tile, neighbors);
    for (let i = 0; i < count; i++) {
      const from = neighbors[i];
      if (
        map.ownerID(from) === attacker &&
        map.isLand(from) &&
        !map.isImpassable(from)
      ) {
        edges.push({
          dx: map.x(tile) - map.x(from),
          dy: map.y(tile) - map.y(from),
        });
      }
    }
    if (edges.length) contacts.set(tile, edges);
  }

  const visited = new Set<TileRef>();
  const result: WarFront[] = [];
  for (const start of contacts.keys()) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    let sx = 0,
      sy = 0;
    for (let i = 0; i < queue.length; i++) {
      const tile = queue[i];
      sx += map.x(tile);
      sy += map.y(tile);
      game.forEachNeighborWithDiag(tile, (next) => {
        if (contacts.has(next) && !visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      });
    }
    const cx = sx / queue.length,
      cy = sy / queue.length;
    // Use a real contact tile, never a centroid in water or inside a country.
    let anchor = queue[0],
      best = Infinity;
    for (const tile of queue) {
      const distance = (map.x(tile) - cx) ** 2 + (map.y(tile) - cy) ** 2;
      if (distance < best || (distance === best && tile < anchor)) {
        anchor = tile;
        best = distance;
      }
    }
    const x = map.x(anchor),
      y = map.y(anchor);
    let nx = 0,
      ny = 0;
    for (const tile of queue) {
      const distance = (map.x(tile) - x) ** 2 + (map.y(tile) - y) ** 2;
      if (distance > 36) continue;
      const weight = 1 / (1 + distance);
      for (const edge of contacts.get(tile)!) {
        nx += edge.dx * weight;
        ny += edge.dy * weight;
      }
    }
    // Symmetric encirclements have no single normal: choose an actual contact
    // edge deterministically rather than pointing at a distant capital.
    const ambiguousNormal = Math.sqrt(nx * nx + ny * ny) < 0.1;
    if (ambiguousNormal) ({ dx: nx, dy: ny } = contacts.get(anchor)![0]);
    const normalLength = Math.sqrt(nx * nx + ny * ny);
    nx /= normalLength;
    ny /= normalLength;
    let dx = 0,
      dy = 0,
      weight = 0;
    for (const sample of recent) {
      const age = game.ticks() - sample.tick;
      const distance = (sample.x - x) ** 2 + (sample.y - y) ** 2;
      if (age < 0 || age > 30 || distance > 144) continue;
      const w = (1 - age / 31) / (1 + distance / 16);
      dx += sample.dx * w;
      dy += sample.dy * w;
      weight += w;
    }
    const length = Math.sqrt(dx * dx + dy * dy);
    // Ignore cancellation/noise and history that now points behind this front.
    const useHistory =
      weight > 0 &&
      length / weight > 0.25 &&
      (ambiguousNormal
        ? contacts
            .get(anchor)!
            .some((edge) => (dx * edge.dx + dy * edge.dy) / length > 0.5)
        : (dx * nx + dy * ny) / length > 0.5);
    result.push({
      x,
      y,
      directionX: useHistory ? dx / length : nx,
      directionY: useHistory ? dy / length : ny,
      size: queue.length,
      directionSource: useHistory ? "conquest" : "border",
    });
  }
  return result
    .sort((a, b) => b.size - a.size || a.x - b.x || a.y - b.y)
    .slice(0, 6);
}
