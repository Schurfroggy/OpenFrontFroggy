import { z } from "zod";
import { zb } from "../../zbin";
export const MapMarkerSchema = z.object({
  id: z.string().max(64),
  owner: z.string().max(64),
  x: zb.uint({ max: 65535 }),
  y: zb.uint({ max: 65535 }),
});
export type MapMarker = z.infer<typeof MapMarkerSchema>;
export const MarkerCommandSchema = z.object({
  type: z.literal("map_marker"),
  action: z.enum(["add", "remove", "clear"]),
  x: zb.uint({ max: 65535 }).optional(),
  y: zb.uint({ max: 65535 }).optional(),
  id: z.string().max(64).optional(),
});
export type MarkerCommand = z.infer<typeof MarkerCommandSchema>;
export const MarkerSnapshotSchema = z.object({
  type: z.literal("map_markers"),
  markers: z.array(MapMarkerSchema).max(3000),
  // Only live additions carry this; restored snapshots remain quiet.
  addedId: z.string().max(64).optional(),
});
/** Ephemeral state, independent of simulation and replay hashes. */
export class MapMarkerBook {
  private markers = new Map<string, MapMarker[]>();
  private next = 1;
  add(owner: string, x: number, y: number) {
    const list = this.markers.get(owner) ?? [];
    const marker = { id: `m${this.next++}`, owner, x, y };
    list.push(marker);
    if (list.length > 3) list.shift();
    this.markers.set(owner, list);
    return marker;
  }
  remove(owner: string, id: string) {
    const list = this.markers.get(owner) ?? [];
    this.markers.set(
      owner,
      list.filter((m) => m.id !== id),
    );
  }
  clear(owner: string) {
    this.markers.delete(owner);
  }
  visible(viewer: string, teams: ReadonlyMap<string, string>) {
    const team = teams.get(viewer);
    return [...this.markers.values()]
      .flat()
      .filter(
        (m) =>
          m.owner === viewer ||
          (team !== undefined && teams.get(m.owner) === team),
      );
  }
}
