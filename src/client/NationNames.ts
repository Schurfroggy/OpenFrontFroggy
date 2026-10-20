import nationNamesZh from "../../resources/lang/nations/zh-CN.json";

/**
 * Optional Chinese names for map places (countries, provinces, states, tribes).
 *
 * These strings live in the map manifests, not in the UI language files, and
 * they are part of the simulated roster — translating them in the engine would
 * change replays and desync hashes. So the mapping is display-only: the raw
 * name stays in `PlayerInfo`, and PlayerView swaps in a translation when this
 * option is on.
 *
 * Kept out of resources/lang/*.json on purpose: 4,000+ proper nouns would more
 * than triple every language file, and a handful of them contain a dot, which
 * the language loader's flattening would split into a broken nested key.
 *
 * Only Chinese is supported today, and the option is only offered while the UI
 * language is Chinese — see the toggle in LangSelector.
 */

const STORAGE_KEY = "nationNamesZh";
const CHANGE_EVENT = "nationNamesChanged";

/** `<name>|<flag>` wins over the plain `<name>` entry. See "Georgia". */
const names = nationNamesZh as Record<string, string>;

let enabled = readEnabled();
// Pushed by <lang-selector> when it loads or changes language. displayName()
// runs once per player per frame, so it must not query the DOM here.
let uiLang = "";

/** Fired whenever the option is switched, so the toggle can repaint. */
export const NATION_NAMES_EVENT = CHANGE_EVENT;

export function nationNamesEnabled(): boolean {
  return enabled && uiLang.toLowerCase().startsWith("zh");
}

/** Called by <lang-selector>; see uiLang above. */
export function setNationNamesLanguage(lang: string): void {
  uiLang = lang;
}

// Set by <nation-label-overlay> while it is running. Without it the GL name
// pass must keep drawing every name: blanking is only safe when something else
// is actually painting the translated label (a replay shell has no overlay).
let mapLabelOverlayActive = false;

export function setMapLabelOverlayActive(active: boolean): void {
  mapLabelOverlayActive = active;
}

export function isMapLabelOverlayActive(): boolean {
  return mapLabelOverlayActive;
}

export function setNationNamesEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable (private mode): the option still holds for this
    // session, which is better than refusing to toggle.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * The display name for a place, or the original when this is a human player,
 * the option is off, or the name has no translation yet.
 */
export function localizeNationName(
  name: string,
  flag?: string | null,
): string {
  return translatedPlaceName(name, flag) ?? name;
}

/**
 * The Chinese name for a place, or null when this name has no translation (or
 * the option is off). Null is the signal the map uses to keep drawing it with
 * its own glyph atlas.
 */
export function translatedPlaceName(
  name: string,
  flag?: string | null,
): string | null {
  if (!nationNamesEnabled()) return null;
  if (flag) {
    // Same string, two places: the country "Georgia" in Europe and the US
    // state on the North America map. The manifest flag tells them apart.
    const override = names[`${name}|${flagCode(flag)}`];
    if (override !== undefined) return override;
  }
  return names[name] ?? null;
}


function flagCode(flag: string): string {
  const base = flag.split("/").pop() ?? flag;
  return base.replace(/\.svg$/i, "");
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
