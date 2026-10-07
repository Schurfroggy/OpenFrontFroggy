import { z } from "zod";
import { Difficulty, GameMapType } from "./game/Game";

export const SelfHostedAchievementSourceSchema = z.enum([
  "singleplayer",
  "multiplayer",
]);

export const SelfHostedAchievementSchema = z.object({
  mapName: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  source: SelfHostedAchievementSourceSchema,
  earnedAt: z.string(),
});

export const SelfHostedAchievementInputSchema = z.object({
  playerId: z.uuid(),
  playerName: z.string().trim().min(1).max(64),
  mapName: z.enum(GameMapType),
  difficulty: z.enum(Difficulty),
  source: SelfHostedAchievementSourceSchema,
  gameId: z.string().trim().min(1).max(64).optional(),
});

export const SelfHostedAchievementRecordSchema =
  SelfHostedAchievementInputSchema.omit({ playerId: true, playerName: true });

export const SelfHostedAchievementsResponseSchema = z.object({
  achievements: z.array(SelfHostedAchievementSchema),
});

export type SelfHostedAchievement = z.infer<typeof SelfHostedAchievementSchema>;
export type SelfHostedAchievementInput = z.infer<
  typeof SelfHostedAchievementInputSchema
>;
