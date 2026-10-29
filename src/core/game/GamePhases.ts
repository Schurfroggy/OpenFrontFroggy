/** Elapsed simulation time since spawn selection ended, shared with music. */
export const LATE_GAME_START_SECONDS = 15 * 60;
const FOG_LIGHT_INTERVAL_SECONDS = 5 * 60;

export function fogAmbientBrightness(elapsedSeconds: number): number {
  if (elapsedSeconds < LATE_GAME_START_SECONDS) return 0;
  return Math.min(
    16,
    2 *
      (1 +
        Math.floor(
          (elapsedSeconds - LATE_GAME_START_SECONDS) /
            FOG_LIGHT_INTERVAL_SECONDS,
        )),
  );
}

/** Background light alone reveals information only above level 5. */
export function fogHasGlobalVision(elapsedSeconds: number): boolean {
  return fogAmbientBrightness(elapsedSeconds) > 5;
}
