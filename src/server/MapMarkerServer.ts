import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeAssetPath, type AssetManifest } from "../core/AssetUrls";
import {
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  HumansVsNations,
  PlayerInfo,
  PlayerType,
} from "../core/game/Game";
import { getCompactMapNationCount } from "../core/game/NationCreation";
import {
  assignTeamsLobbyPreview,
  resolveTeamsList,
} from "../core/game/TeamAssignment";
import { MapMarkerBook, type MarkerCommand } from "../core/MapMarkers";
import type { GameStartInfo } from "../core/Schemas";
export function markerTeams(start: GameStartInfo, nationCount: number) {
  const result = new Map<string, string>();
  if (start.config.gameMode !== GameMode.Team) return result;
  const type = start.config.playerTeams;
  if (type === HumansVsNations) {
    for (const p of start.players) result.set(p.clientID, "humans");
    return result;
  }
  if (type === undefined) return result;
  const players = start.players.map(
    (p) =>
      new PlayerInfo(
        p.username,
        PlayerType.Human,
        p.clientID,
        p.clientID,
        p.isLobbyCreator ?? false,
        p.clanTag ?? null,
        p.friends ?? [],
        p.teamIndex ?? null,
      ),
  );
  const teams = resolveTeamsList(type, players.length + nationCount);
  for (const [p, team] of assignTeamsLobbyPreview(
    players,
    teams,
    type,
    nationCount,
  ))
    if (team !== "kicked") result.set(p.clientID!, team);
  return result;
}
// Cache the small map metadata per worker. Production keeps hashed assets only.
const bounds = new Map<
  string,
  { width: number; height: number; nations: number }
>();
function mapBounds(start: GameStartInfo) {
  const cacheKey = `${start.config.gameMap}:${start.config.gameMapSize}`;
  const cached = bounds.get(cacheKey);
  if (cached) return cached;
  const key = Object.keys(GameMapType).find(
    (k) => GameMapType[k as keyof typeof GameMapType] === start.config.gameMap,
  );
  if (!key) throw new Error("Unknown marker map");
  const root = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const relative = `maps/${key.toLowerCase()}/manifest.json`;
  const indexFile = path.join(root, "static/asset-manifest.json");
  const assets: AssetManifest = existsSync(indexFile)
    ? JSON.parse(readFileSync(indexFile, "utf8"))
    : {};
  const file = assets[relative]
    ? path.join(root, "static", normalizeAssetPath(assets[relative]))
    : path.join(root, "resources", relative);
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  const size =
    start.config.gameMapSize === GameMapSize.Compact
      ? manifest.map4x
      : manifest.map;
  if (!(size.width > 0 && size.height > 0))
    throw new Error("Invalid marker map bounds");
  bounds.set(cacheKey, {
    width: size.width,
    height: size.height,
    nations: manifest.nations.length,
  });
  return bounds.get(cacheKey)!;
}
export class MapMarkerServer {
  readonly book = new MapMarkerBook();
  readonly teams: Map<string, string>;
  private last = new Map<string, number>();
  private width: number;
  private height: number;
  constructor(start: GameStartInfo) {
    const size = mapBounds(start);
    this.width = size.width;
    this.height = size.height;
    const configured = start.config.nations;
    // Match NationCreation, including public compact maps' reduced AI count.
    const nationCount =
      typeof configured === "number"
        ? configured
        : configured === "disabled"
          ? 0
          : start.config.gameType === GameType.Public
            ? getCompactMapNationCount(
                size.nations,
                start.config.gameMapSize === GameMapSize.Compact,
              )
            : size.nations;
    this.teams = markerTeams(start, nationCount);
  }
  apply(owner: string, command: MarkerCommand, now: number) {
    if (command.action === "add") {
      if (
        command.x === undefined ||
        command.y === undefined ||
        command.x >= this.width ||
        command.y >= this.height ||
        !Number.isInteger(command.x) ||
        !Number.isInteger(command.y) ||
        command.x < 0 ||
        command.y < 0
      )
        return false;
      if (now - (this.last.get(owner) ?? -Infinity) < 250) return false;
      this.last.set(owner, now);
      return this.book.add(owner, command.x, command.y);
    } else if (command.action === "remove") {
      if (!command.id) return false;
      this.book.remove(owner, command.id);
    } else {
      this.book.clear(owner);
      this.last.delete(owner);
    }
    return true;
  }
}
