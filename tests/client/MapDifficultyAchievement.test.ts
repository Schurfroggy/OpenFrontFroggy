import { render } from "lit";
import { describe, expect, it } from "vitest";
import "../../src/client/components/map/MapDisplay";
import { Difficulty } from "../../src/core/game/Game";

describe("self-hosted map difficulty achievement", () => {
  it("shows only the highest completed difficulty icon", () => {
    const display = document.createElement("map-display") as any;
    display.wins = new Set([Difficulty.Easy, Difficulty.Hard]);

    const host = document.createElement("div");
    render(display.renderDifficultyAchievement(), host);

    const difficulty = host.querySelector("difficulty-display") as any;
    expect(difficulty).not.toBeNull();
    expect(difficulty.difficultyKey).toBe(Difficulty.Hard);
  });

  it("shows nothing before a map has been completed", () => {
    const display = document.createElement("map-display") as any;
    display.wins = new Set();

    const host = document.createElement("div");
    render(display.renderDifficultyAchievement(), host);

    expect(host.querySelector("difficulty-display")).toBeNull();
  });
});
