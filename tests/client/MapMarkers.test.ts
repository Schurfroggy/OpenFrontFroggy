import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MapMarkerController,
  markerLocation,
} from "../../src/client/controllers/MapMarkerController";
import {
  MarkerSnapshotEvent,
  MarkerToggleEvent,
} from "../../src/client/MapMarkerEvents";
import {
  GoToPositionEvent,
  type TransformHandler,
} from "../../src/client/TransformHandler";
import type { Transport } from "../../src/client/Transport";
import { showToast } from "../../src/client/Utils";
import type { GameView } from "../../src/client/view";
import { assetUrl } from "../../src/core/AssetUrls";
import { EventBus } from "../../src/core/EventBus";
import { Cell, GameMode } from "../../src/core/game/Game";
import type { MapMarker } from "../../src/core/MapMarkers";

vi.mock("../../src/client/Utils", () => ({
  translateText: (key: string, params?: Record<string, string>) =>
    params ? `${key}: ${params.player} / ${params.target}` : key,
  showToast: vi.fn(),
}));
const marker: MapMarker = { id: "m1", owner: "me", x: 20, y: 30 };

describe("map marker presentation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.mocked(showToast).mockClear();
    document.body.replaceChildren();
  });
  function fixture() {
    let country = "Country A";
    let visible = true;
    let tick = 1;
    let replay = false;
    let team = true;
    const owner = vi.fn(() => ({
      isPlayer: () => !!country,
      displayName: () => country,
    }));
    const game = {
      ref: (x: number, y: number) => y * 100 + x,
      isTileVisible: () => visible,
      isWater: () => false,
      owner,
      config: () => ({
        isReplay: () => replay,
        gameConfig: () => ({ gameMode: team ? GameMode.Team : GameMode.FFA }),
      }),
      myClientID: () => "me",
      myPlayer: () => ({ isAlive: () => true, hasSpawned: () => true }),
      inSpawnPhase: () => false,
      ticks: () => tick,
      playerByClientID: (id: string) => ({
        displayName: () => id,
        cosmetics: { flag: "/flags/US.svg" },
      }),
      isValidCoord: (x: number, y: number) =>
        x >= 0 && y >= 0 && x < 100 && y < 100,
    } as unknown as GameView;
    let nextFrame: FrameRequestCallback = () => {};
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    document.body.innerHTML = "<attacks-display></attacks-display>";
    const bus = new EventBus();
    const sendMapMarker = vi.fn();
    const transport = {
      mapMarkers: [marker],
      sendMapMarker,
    } as unknown as Transport;
    const transform = {
      worldToScreenCoordinates: (cell: Cell) => cell,
      screenToWorldCoordinates: (x: number, y: number) =>
        new Cell(Math.floor(x), Math.floor(y)),
    } as unknown as TransformHandler;
    const controller = new MapMarkerController(
      game,
      bus,
      transform,
      transport,
      document.body,
    );
    return {
      controller,
      game,
      bus,
      sendMapMarker,
      owner,
      transform,
      solo: () => {
        team = false;
      },
      frame: () => {
        tick++;
        nextFrame(0);
      },
      country: (name: string) => {
        country = name;
      },
      visible: (value: boolean) => {
        visible = value;
      },
      replay: () => {
        replay = true;
      },
    };
  }
  it("resolves ownership changes, neutral land and water without leaking fogged ownership", () => {
    const f = fixture();
    expect(markerLocation(f.game, marker)).toBe("Country A");
    f.country("Country B");
    expect(markerLocation(f.game, marker)).toBe("Country B");
    f.country("");
    expect(markerLocation(f.game, marker)).toBe("map_marker.wilderness");
    f.game.isWater = () => true;
    expect(markerLocation(f.game, marker)).toBe("map_marker.ocean");
    f.visible(false);
    f.owner.mockClear();
    expect(markerLocation(f.game, marker)).toBe("map_marker.unknown");
    expect(f.owner).not.toHaveBeenCalled();
  });
  it("renders above the attack list, preserves unchanged DOM, centers and deletes own marker", () => {
    const f = fixture();
    f.controller.init();
    f.frame();
    const list = document.querySelector("[data-marker-list]")!;
    expect(list.nextElementSibling?.tagName).toBe("ATTACKS-DISPLAY");
    expect(list.textContent).toContain("Country A");
    const locate = list.querySelector("button")!;
    const go = vi.fn();
    f.bus.on(GoToPositionEvent, go);
    locate.click();
    expect(go).toHaveBeenCalledWith(new GoToPositionEvent(20.5, 30.5));
    f.frame();
    expect(list.querySelector("button")).toBe(locate);
    f.country("Country B");
    f.frame();
    expect(list.textContent).toContain("Country B");
    (list.querySelectorAll("button")[1] as HTMLButtonElement).click();
    expect(f.sendMapMarker).toHaveBeenCalledWith(
      { type: "map_marker", action: "remove", id: "m1" },
      "me",
    );
    f.controller.dispose();
    expect(document.querySelector("[data-marker-list]")).toBeNull();
  });
  it("middle click toggles own flags and can place into fog; peers can only be hidden locally", () => {
    const f = fixture();
    f.controller.init();
    f.frame();
    f.bus.emit(new MarkerToggleEvent(20.5, 30.5));
    expect(f.sendMapMarker).toHaveBeenLastCalledWith(
      { type: "map_marker", action: "remove", id: "m1" },
      "me",
    );
    f.visible(false);
    f.bus.emit(new MarkerToggleEvent(80, 90));
    expect(f.sendMapMarker).toHaveBeenLastCalledWith(
      { type: "map_marker", action: "add", x: 80, y: 90 },
      "me",
    );
    f.bus.emit(
      new MarkerSnapshotEvent([{ ...marker, id: "m2", owner: "teammate" }]),
    );
    f.frame();
    f.sendMapMarker.mockClear();
    (
      document.querySelectorAll(
        "[data-marker-list] button",
      )[1] as HTMLButtonElement
    ).click();
    f.frame();
    expect(f.sendMapMarker).not.toHaveBeenCalled();
    expect(
      document.querySelector("[data-marker-list]")?.childElementCount,
    ).toBe(0);
    expect(
      document.querySelector("[data-map-markers]")?.childElementCount,
    ).toBe(0);
    f.controller.dispose();
  });
  it("does not install marker controls during a replay", () => {
    const f = fixture();
    f.replay();
    f.controller.init();
    f.bus.emit(new MarkerToggleEvent(80, 90));
    expect(f.sendMapMarker).not.toHaveBeenCalled();
    expect(document.querySelector("[data-map-markers]")).toBeNull();
    f.controller.dispose();
  });
  it("uses the player's flag with a fixed large size and allows deleting by clicking its cloth", () => {
    const f = fixture();
    f.controller.init();
    f.frame();
    const flag = document.querySelector<HTMLDivElement>("[data-marker-flag]")!;
    const image = flag.querySelector("img")!;
    expect(image.getAttribute("src")).toBe(assetUrl("/flags/US.svg"));
    expect(image.parentElement?.style.width).toBe("52px");
    f.transform.scale = 10;
    f.frame();
    expect(image.parentElement?.style.width).toBe("52px");
    expect(flag.style.transform).not.toContain("scale");
    f.bus.emit(new MarkerToggleEvent(45, 0));
    expect(f.sendMapMarker).toHaveBeenLastCalledWith(
      { type: "map_marker", action: "remove", id: "m1" },
      "me",
    );
    f.controller.dispose();
  });
  it("pulses live placements and announces teammates for 3 seconds, with fog-safe labels", () => {
    const animate = vi.fn(() => ({ onfinish: null }));
    const original = Element.prototype.animate;
    Element.prototype.animate = animate as unknown as typeof original;
    try {
      const f = fixture();
      f.controller.init();
      f.frame();
      expect(animate).not.toHaveBeenCalled();
      const peer = { ...marker, id: "m2", owner: "teammate" };
      f.visible(false);
      f.bus.emit(new MarkerSnapshotEvent([marker, peer], "m2"));
      f.frame();
      expect(animate).toHaveBeenCalledTimes(1);
      expect(showToast).toHaveBeenCalledWith(
        "map_marker.announced: teammate / map_marker.unknown",
        "green",
        3000,
      );
      f.bus.emit(new MarkerSnapshotEvent([marker, peer]));
      f.frame();
      expect(showToast).toHaveBeenCalledTimes(1);
      const own = { ...marker, id: "m3" };
      f.bus.emit(new MarkerSnapshotEvent([marker, peer, own], "m3"));
      f.frame();
      expect(animate).toHaveBeenCalledTimes(2);
      expect(showToast).toHaveBeenCalledTimes(1);
      f.solo();
      f.bus.emit(new MarkerSnapshotEvent([{ ...peer, id: "m4" }], "m4"));
      f.frame();
      expect(showToast).toHaveBeenCalledTimes(1);
      f.controller.dispose();
    } finally {
      if (original) Element.prototype.animate = original;
      else Reflect.deleteProperty(Element.prototype, "animate");
    }
  });
});
