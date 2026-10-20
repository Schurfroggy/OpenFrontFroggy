import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../src/client/LangSelector";
import type { LangSelector } from "../../src/client/LangSelector";
import { setNationNamesEnabled } from "../../src/client/NationNames";

// The toggle only exists while the UI is Chinese, and it sits next to the flag
// button (never instead of it).
describe("lang-selector place-name toggle", () => {
  let selector: LangSelector;

  beforeEach(async () => {
    localStorage.clear();
    setNationNamesEnabled(false);
    // initializeLanguage() would otherwise resolve later and overwrite
    // currentLang with the jsdom default; a hanging fetch keeps it put.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    selector = document.createElement("lang-selector") as LangSelector;
    document.body.appendChild(selector);
    await selector.updateComplete;
  });

  afterEach(() => {
    selector.remove();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function setLang(lang: string): Promise<void> {
    selector.currentLang = lang;
    await selector.updateComplete;
  }

  it("shows beside the flag only while the UI is Chinese", async () => {
    await setLang("zh-CN");
    const toggle = selector.querySelector("#nation-names-toggle");
    expect(toggle).not.toBeNull();
    expect(selector.querySelector("#lang-selector")).not.toBeNull();
    // Immediately to the left of the flag, in the same flex row.
    expect(toggle?.parentElement).toBe(
      selector.querySelector("#lang-selector")?.parentElement,
    );
    expect(toggle?.nextElementSibling?.id).toBe("lang-selector");

    await setLang("en");
    expect(selector.querySelector("#nation-names-toggle")).toBeNull();

    await setLang("zh-TW");
    expect(selector.querySelector("#nation-names-toggle")).not.toBeNull();
  });

  it("toggles the option and shows the pressed state", async () => {
    await setLang("zh-CN");
    const toggle = selector.querySelector(
      "#nation-names-toggle",
    ) as HTMLButtonElement;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    toggle.click();
    await selector.updateComplete;

    expect(localStorage.getItem("nationNamesZh")).toBe("1");
    expect(
      selector
        .querySelector("#nation-names-toggle")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
