import { describe, expect, it } from "vitest";
import { MapMarkerBook, MarkerCommandSchema } from "../src/core/MapMarkers";
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeClientMessage,
  encodeServerMessage,
} from "../src/core/ZbinWire";

describe("map markers", () => {
  it("keeps only the last three markers per owner, independently", () => {
    const book = new MapMarkerBook();
    book.add("b", 9, 9);
    for (let x = 1; x <= 4; x++) book.add("a", x, 0);
    expect(book.visible("a", new Map()).map((m) => m.x)).toEqual([2, 3, 4]);
    expect(book.visible("b", new Map()).map((m) => m.x)).toEqual([9]);
  });
  it("shares only assigned teams; another owner cannot remove a marker", () => {
    const book = new MapMarkerBook();
    const teams = new Map([
      ["a", "red"],
      ["b", "red"],
      ["c", "blue"],
    ]);
    book.add("a", 1, 2);
    book.add("c", 3, 4);
    const id = book.visible("a", teams)[0].id;
    book.remove("b", id);
    expect(book.visible("b", teams).map((m) => m.owner)).toEqual(["a"]);
    expect(book.visible("outsider", teams)).toEqual([]);
    book.clear("a");
    expect(book.visible("b", teams)).toEqual([]);
    expect(book.visible("c", teams)).toHaveLength(1);
  });
  it("round trips commands and snapshots over the actual wire schemas", () => {
    const command = { type: "map_marker", action: "add", x: 2, y: 4 } as const;
    expect(
      decodeClientMessage(encodeClientMessage(command, undefined), undefined),
    ).toEqual(command);
    const snapshot = {
      type: "map_markers",
      markers: [{ id: "m1", owner: "player", x: 2, y: 4 }],
    } as const;
    const message = {
      ...snapshot,
      markers: [...snapshot.markers],
      addedId: "m1",
    };
    expect(
      decodeServerMessage(encodeServerMessage(message, undefined), undefined),
    ).toEqual(message);
    expect(MarkerCommandSchema.safeParse({ ...command, x: -1 }).success).toBe(
      false,
    );
    expect(MarkerCommandSchema.safeParse({ ...command, x: 1.5 }).success).toBe(
      false,
    );
  });
});
