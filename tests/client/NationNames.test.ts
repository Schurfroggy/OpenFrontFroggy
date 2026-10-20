import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  localizeNationName,
  nationNamesEnabled,
  setNationNamesEnabled,
  setNationNamesLanguage,
} from "../../src/client/NationNames";

// <lang-selector> pushes its language here; the tests do the same.
function useLanguage(lang: string): void {
  setNationNamesLanguage(lang);
}

beforeEach(() => {
  localStorage.clear();
  useLanguage("zh-CN");
  setNationNamesEnabled(false);
});

afterEach(() => {
  localStorage.clear();
});

describe("localizeNationName", () => {
  it("passes the original name through while the option is off", () => {
    expect(localizeNationName("United States")).toBe("United States");
  });

  it("translates known place names once enabled", () => {
    setNationNamesEnabled(true);
    expect(localizeNationName("United States")).toBe("美国");
    expect(localizeNationName("Île-de-France")).toBe("Île-de-France");
    expect(localizeNationName("Nord-Pas-de-Calais")).toBe(
      "Nord-Pas-de-Calais",
    );
    expect(nationNamesEnabled()).toBe(true);
  });

  it("falls back to the original for names the table does not cover", () => {
    setNationNamesEnabled(true);
    // Not one of the four supported maps.
    expect(localizeNationName("Murmansk")).toBe("Murmansk");
    expect(localizeNationName("Nord-Pas-de-Calais")).toBe(
      "Nord-Pas-de-Calais",
    );
  });

  it("uses the flag to tell two places with one name apart", () => {
    setNationNamesEnabled(true);
    // Europe's country vs the US state on the North America map.
    expect(localizeNationName("Georgia", "/flags/ge.svg")).toBe("格鲁吉亚");
    expect(localizeNationName("Georgia", "/flags/Georgia_US.svg")).toBe(
      "佐治亚",
    );
    expect(localizeNationName("Georgia")).toBe("格鲁吉亚");
  });

  it("does nothing while the UI language is not Chinese", () => {
    setNationNamesEnabled(true);
    useLanguage("de");
    expect(localizeNationName("United States")).toBe("United States");
    expect(nationNamesEnabled()).toBe(false);
  });

  it("remembers the choice across reloads", () => {
    setNationNamesEnabled(true);
    expect(localStorage.getItem("nationNamesZh")).toBe("1");
    setNationNamesEnabled(false);
    expect(localStorage.getItem("nationNamesZh")).toBe("0");
  });
});
