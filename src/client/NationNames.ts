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
  if (!nationNamesEnabled()) return name;
  if (flag) {
    // Same string, two places: the country "Georgia" in Europe and the US
    // state on the North America map. The manifest flag tells them apart.
    const override = names[`${name}|${flagCode(flag)}`];
    if (override !== undefined) return override;
  }
  return names[name] ?? name;
}

/**
 * The on-map label. The name pass draws text from a pre-baked MSDF glyph atlas
 * whose tables are indexed by char code up to CHAR_RANGE (384 in
 * render/gl/passes/name-pass/Types.ts), covering Latin-1 + Latin Extended-A and
 * nothing else. A Chinese name would index past the tables and draw garbage
 * ("-Ipa", "-<"), so the map keeps the original string and the Chinese one is
 * left to the DOM surfaces (hover panel, info overlay, leaderboard).
 */
export function localizeNationNameForMap(
  name: string,
  flag?: string | null,
): string {
  const localized = localizeNationName(name, flag);
  for (let i = 0; i < localized.length; i++) {
    if (localized.charCodeAt(i) >= MAP_LABEL_CHAR_RANGE) return name;
  }
  return localized;
}

/** Mirrors CHAR_RANGE in render/gl/passes/name-pass/Types.ts. */
const MAP_LABEL_CHAR_RANGE = 384;

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
