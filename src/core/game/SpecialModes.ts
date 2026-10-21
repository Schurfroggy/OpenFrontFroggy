import type { GameConfig } from "../Schemas";

export const NUCLEAR_FOG_REVEAL_TICKS = 30 * 10;

/** Fog takes precedence, including configs received outside the host UI. */
export function normalizeSpecialModes(config: GameConfig): GameConfig {
  if (!config.fogOfWar?.enabled) return config;
  return {
    ...config,
    waterNukes: false,
    doomsdayClock: { ...config.doomsdayClock, enabled: false },
    overtime: { ...config.overtime, enabled: false },
    publicGameModifiers: config.publicGameModifiers
      ? {
          ...config.publicGameModifiers,
          isWaterNukes: false,
          isDoomsdayClock: false,
        }
      : undefined,
  };
}
