import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import countries from "../../resources/countries.json";
import { PlayerFlagPicker } from "../../src/client/components/PlayerFlagPicker";
import { UserSettings } from "../../src/core/game/UserSettings";

// jsdom does not implement the native dialog's top-layer lifecycle.
beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    },
    close: {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    },
  });
  localStorage.removeItem("flag-favorites");
  new UserSettings().clearFlag(true);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function mount() {
  const picker = new PlayerFlagPicker();
  document.body.append(picker);
  await picker.updateComplete;
  return picker;
}

async function search(picker: PlayerFlagPicker, text: string) {
  const input = picker.querySelector("input")!;
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await picker.updateComplete;
}

describe("player flag selection", () => {
  it("searches, saves the selected flag and restores it on remount", async () => {
    const picker = await mount();
    picker.querySelector<HTMLButtonElement>(".player-flag-trigger")!.click();
    expect(picker.querySelector("dialog")!.open).toBe(true);
    await search(picker, "China");
    picker.querySelector<HTMLButtonElement>('button[title="China"]')!.click();
    await picker.updateComplete;
    expect(new UserSettings().getFlag()).toBe("country:cn");
    expect(picker.querySelector("dialog")!.open).toBe(false);
    picker.remove();
    const restored = await mount();
    expect(
      restored.querySelector(".player-flag-trigger img")?.getAttribute("alt"),
    ).toBe("China");
    restored.querySelector<HTMLButtonElement>(".player-flag-option")!.click();
    await restored.updateComplete;
    expect(new UserSettings().getFlag()).toBeNull();
    expect(restored.querySelector(".player-flag-trigger img")).toBeNull();
  });

  it("searches existing Chinese names without changing the stored flag code", async () => {
    const picker = await mount();
    await search(picker, "中国");
    expect(picker.querySelector('button[title="China"]')).not.toBeNull();
  });

  it("updates stars immediately but defers reordering until the next open", async () => {
    const picker = await mount();
    const firstFlag = () =>
      picker
        .querySelector(".player-flag-tile .player-flag-option")!
        .getAttribute("title");
    const open = async () => {
      picker.querySelector<HTMLButtonElement>(".player-flag-trigger")!.click();
      await picker.updateComplete;
    };
    const close = () => picker.querySelector("dialog")!.close();
    await open();
    await search(picker, "China");
    picker.querySelector<HTMLButtonElement>(".player-flag-favorite")!.click();
    await picker.updateComplete;
    expect(new UserSettings().getFlag()).toBeNull();
    expect(picker.querySelector("dialog")!.open).toBe(true);
    expect(
      picker
        .querySelector(".player-flag-favorite")!
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(JSON.parse(localStorage.getItem("flag-favorites")!)).toEqual(["cn"]);
    await search(picker, "");
    expect(firstFlag()).toBe("Abbasid Caliphate");
    close();
    await open();
    expect(firstFlag()).toBe("China");
    picker.querySelector<HTMLButtonElement>(".player-flag-favorite")!.click();
    await picker.updateComplete;
    expect(
      picker
        .querySelector(".player-flag-favorite")!
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(firstFlag()).toBe("China");
    await search(picker, "China");
    await search(picker, "");
    expect(firstFlag()).toBe("China");
    close();
    await open();
    expect(firstFlag()).toBe("Abbasid Caliphate");
    expect(JSON.parse(localStorage.getItem("flag-favorites")!)).toEqual([]);
  });

  it("ignores malformed or unknown saved favorites", async () => {
    localStorage.setItem("flag-favorites", "not json");
    const picker = await mount();
    expect(
      picker.querySelector(".player-flag-favorite[aria-pressed=true]"),
    ).toBeNull();
    picker.remove();
    localStorage.setItem(
      "flag-favorites",
      JSON.stringify(["not-a-flag", "cn", 10, "cn"]),
    );
    const restored = await mount();
    expect(
      restored.querySelectorAll(".player-flag-favorite[aria-pressed=true]"),
    ).toHaveLength(1);
    expect(
      restored
        .querySelector(".player-flag-tile .player-flag-option")!
        .getAttribute("title"),
    ).toBe("China");
  });

  it("limits the initial grid and excludes restricted entries", async () => {
    const picker = await mount();
    expect(picker.querySelectorAll(".player-flag-option")).toHaveLength(61);
    picker.querySelector<HTMLButtonElement>(".player-flag-more")!.click();
    await picker.updateComplete;
    expect(picker.querySelectorAll(".player-flag-option")).toHaveLength(121);
    const restricted = countries.find((c) => c.restricted);
    if (restricted) {
      await search(picker, restricted.name);
      expect(
        picker.querySelector(`button[title="${restricted.name}"]`),
      ).toBeNull();
    }
  });
});
