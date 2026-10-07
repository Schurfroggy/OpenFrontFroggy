import type { Difficulty, GameMapType } from "../core/game/Game";
import {
  SelfHostedAchievementInputSchema,
  SelfHostedAchievementsResponseSchema,
  type SelfHostedAchievement,
} from "../core/SelfHostedAchievements";
import { ClientEnv } from "./ClientEnv";

export async function loadSelfHostedAchievements(): Promise<
  SelfHostedAchievement[]
> {
  if (ClientEnv.selfHosted?.() !== true) return [];
  try {
    const response = await fetch("/api/self-hosted/achievements", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];
    const parsed = SelfHostedAchievementsResponseSchema.safeParse(
      await response.json(),
    );
    return parsed.success ? parsed.data.achievements : [];
  } catch (error) {
    console.warn("Failed to load self-hosted achievements", error);
    return [];
  }
}

export function groupAchievementsByMap(
  achievements: SelfHostedAchievement[],
): Map<GameMapType, Set<Difficulty>> {
  const wins = new Map<GameMapType, Set<Difficulty>>();
  for (const achievement of achievements) {
    const difficulties = wins.get(achievement.mapName) ?? new Set();
    difficulties.add(achievement.difficulty);
    wins.set(achievement.mapName, difficulties);
  }
  return wins;
}

export async function recordSelfHostedAchievement(input: {
  playerName: string;
  mapName: GameMapType;
  difficulty: Difficulty;
  source: "singleplayer" | "multiplayer";
  gameId: string;
}): Promise<boolean> {
  if (ClientEnv.selfHosted?.() !== true) return false;
  try {
    const body = SelfHostedAchievementInputSchema.omit({
      playerId: true,
      playerName: true,
    }).parse(input);
    const response = await fetch("/api/self-hosted/achievements", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return response.ok;
  } catch (error) {
    console.warn("Failed to record self-hosted achievement", error);
    return false;
  }
}
