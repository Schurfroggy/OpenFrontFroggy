import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../../src/client/hud/layers/MapViewSelector";
import type { MapViewSelector } from "../../../../src/client/hud/layers/MapViewSelector";
import { MapViewModeEvent } from "../../../../src/client/InputHandler";
import { EventBus } from "../../../../src/core/EventBus";

vi.mock("../../../../src/client/Utils", () => ({
  translateText: vi.fn((key: string) => key),
}));

describe("MapViewSelector", () => {
  let selector: MapViewSelector;
  let eventBus: EventBus;
  let modeEvents: MapViewModeEvent[];

  beforeEach(() => {
    selector = document.createElement("map-view-selector") as MapViewSelector;
    eventBus = new EventBus();
    modeEvents = [];
    eventBus.on(MapViewModeEvent, (e) => modeEvents.push(e));
    selector.eventBus = eventBus;
    document.body.appendChild(selector);
  });

  afterEach(() => {
    selector.remove();
    vi.clearAllMocks();
  });

  const viewButtons = () =>
    Array.from(selector.querySelectorAll<HTMLButtonElement>(".view-button"));

  it("renders the default, SAM and war view options after init", async () => {
    selector.init();
    await selector.updateComplete;

    const buttons = viewButtons();
    expect(buttons).toHaveLength(3);
    // Hover tooltips moved from the title attribute to dedicated spans.
    const tooltips = Array.from(
      selector.querySelectorAll<HTMLElement>(".view-tooltip"),
    );
    expect(tooltips).toHaveLength(3);
    expect(tooltips[0]!.textContent).toBe("map_view.default");
    expect(tooltips[1]!.textContent).toBe("map_view.sam");
    expect(tooltips[2]!.textContent).toBe("map_view.war");
    // Default view is selected first; its marker is the letter D.
    expect(buttons[0]!.getAttribute("aria-checked")).toBe("true");
    expect(buttons[0]!.querySelector(".view-letter")?.textContent).toBe("D");
    // The SAM button reuses the in-game SAM launcher icon.
    expect(buttons[1]!.querySelector("img")).not.toBeNull();
    // The war button reuses the sword icon.
    expect(buttons[2]!.querySelector("img")).not.toBeNull();
  });

  it("emits MapViewModeEvent(sam) when the SAM button is clicked", async () => {
    selector.init();
    await selector.updateComplete;

    viewButtons()[1]!.click();
    await selector.updateComplete;

    expect(modeEvents).toHaveLength(1);
    expect(modeEvents[0]!.mode).toBe("sam");
    // Selection follows the emitted mode.
    const buttons = viewButtons();
    expect(buttons[1]!.getAttribute("aria-checked")).toBe("true");
    expect(buttons[0]!.getAttribute("aria-checked")).toBe("false");
  });

  it("does not re-emit when the active view is clicked again", async () => {
    selector.init();
    await selector.updateComplete;

    viewButtons()[0]!.click();

    expect(modeEvents).toHaveLength(0);
  });

  it("returns to the default view and emits the mode switch back", async () => {
    selector.init();
    await selector.updateComplete;

    viewButtons()[1]!.click();
    await selector.updateComplete;
    viewButtons()[0]!.click();
    await selector.updateComplete;

    expect(modeEvents.map((e) => e.mode)).toEqual(["sam", "default"]);
    expect(viewButtons()[0]!.getAttribute("aria-checked")).toBe("true");
  });

  it("stays hidden until init() runs", async () => {
    await selector.updateComplete;
    expect(viewButtons()).toHaveLength(0);
    expect(selector.querySelector("aside.hidden")).not.toBeNull();
  });

  it("mirrors external MapViewModeEvent updates", async () => {
    selector.init();
    await selector.updateComplete;

    eventBus.emit(new MapViewModeEvent("sam"));
    await selector.updateComplete;

    expect(viewButtons()[1]!.getAttribute("aria-checked")).toBe("true");
    // The mirror must not echo a second event back onto the bus.
    expect(modeEvents).toHaveLength(1);
  });


});
