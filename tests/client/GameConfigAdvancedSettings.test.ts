import { html } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/components/GameConfigSettings";
import type {
  GameConfigSettings,
  GameConfigSettingsData,
} from "../../src/client/components/GameConfigSettings";
import { Difficulty, GameMapType, GameMode } from "../../src/core/game/Game";

function settings(enabled: boolean): GameConfigSettingsData {
  return {
    advancedSettings: { enabled },
    map: {
      selected: GameMapType.World,
      useRandom: false,
    },
    difficulty: {
      selected: Difficulty.Easy,
      disabled: false,
    },
    gameMode: {
      selected: GameMode.FFA,
    },
    teamCount: { selected: 2 },
    options: {
      titleKey: "game_settings.options",
      bots: {
        value: 400,
        labelKey: "game_settings.bots",
        disabledKey: "common.disabled",
      },
      nations: {
        value: 20,
        labelKey: "game_settings.nations",
        disabledKey: "common.disabled",
      },
      toggles: [],
      inputCards: [html`<div data-test-advanced-option></div>`],
    },
    unitTypes: {
      titleKey: "game_settings.disable_units",
      disabledUnits: [],
    },
  };
}

describe("GameConfigSettings advanced settings", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    document.querySelectorAll("game-config-settings").forEach((node) =>
      node.remove(),
    );
    vi.unstubAllGlobals();
  });

  it("hides balance-changing controls until advanced settings are enabled", async () => {
    const component = document.createElement(
      "game-config-settings",
    ) as GameConfigSettings;
    component.settings = settings(false);
    document.body.append(component);
    await component.updateComplete;

    expect(
      component.querySelector("[data-test-advanced-settings]"),
    ).not.toBeNull();
    expect(component.querySelector("[data-test-advanced-option]")).toBeNull();
    expect(component.querySelector("fluent-slider")).toBeNull();

    component.settings = settings(true);
    await component.updateComplete;

    expect(
      component.querySelector("[data-test-advanced-option]"),
    ).not.toBeNull();
    expect(component.querySelector("fluent-slider")).not.toBeNull();
    component.remove();
  });

  it("announces enabling advanced settings to the owning modal", async () => {
    const component = document.createElement(
      "game-config-settings",
    ) as GameConfigSettings;
    component.settings = settings(false);
    const listener = vi.fn();
    component.addEventListener("advanced-settings-changed", listener);
    document.body.append(component);
    await component.updateComplete;

    component
      .querySelector<HTMLButtonElement>("[data-test-advanced-settings]")
      ?.click();

    expect(listener).toHaveBeenCalledOnce();
    expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
      enabled: true,
    });
    component.remove();
  });
});
