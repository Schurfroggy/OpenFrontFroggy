import type { MapMarker } from "../core/MapMarkers";
export class MarkerToggleEvent {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
}
export class MarkerSnapshotEvent {
  constructor(
    readonly markers: MapMarker[],
    readonly addedId?: string,
  ) {}
}
