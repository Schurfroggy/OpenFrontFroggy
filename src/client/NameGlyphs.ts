import { RENDERABLE_NAME_CHAR_RE } from "../core/Schemas";

/** Only glyphs in the name atlas allowlist go through WebGL. Other plain-text
 * names (including Latin punctuation) use the DOM overlay. */
export function isAtlasRenderable(name: string): boolean {
  return Array.from(name).every((character) =>
    RENDERABLE_NAME_CHAR_RE.test(character),
  );
}
