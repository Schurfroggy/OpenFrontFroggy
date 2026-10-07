import { mkdirSync } from "fs";
import { DatabaseSync } from "node:sqlite";
import path from "path";
import type {
  SelfHostedAchievement,
  SelfHostedAchievementInput,
} from "../core/SelfHostedAchievements";

export function selfHostedAchievementDatabasePath(): string {
  return (
    process.env.SELF_HOSTED_DB_PATH ??
    path.join(process.cwd(), "data", "self-hosted.sqlite")
  );
}

export class SelfHostedAchievementStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = selfHostedAchievementDatabasePath()) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS self_hosted_players (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS self_hosted_map_achievements (
        player_id TEXT NOT NULL,
        map_name TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        source TEXT NOT NULL,
        game_id TEXT,
        earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (player_id, map_name, difficulty),
        FOREIGN KEY (player_id) REFERENCES self_hosted_players(id)
          ON DELETE CASCADE
      );
    `);
  }

  record(input: SelfHostedAchievementInput): void {
    this.database
      .prepare(
        `INSERT INTO self_hosted_players (id, display_name)
         VALUES (?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           updated_at = CURRENT_TIMESTAMP`,
      )
      .run(input.playerId, input.playerName);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO self_hosted_map_achievements
           (player_id, map_name, difficulty, source, game_id)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.playerId,
        input.mapName,
        input.difficulty,
        input.source,
        input.gameId ?? null,
      );
  }

  list(playerId: string): SelfHostedAchievement[] {
    return this.database
      .prepare(
        `SELECT map_name AS mapName, difficulty, source, earned_at AS earnedAt
         FROM self_hosted_map_achievements
         WHERE player_id = ?
         ORDER BY earned_at ASC`,
      )
      .all(playerId) as SelfHostedAchievement[];
  }

  close(): void {
    this.database.close();
  }
}
