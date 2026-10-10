import { z } from "zod";
import { Execution, Game, Player, PlayerType } from "../game/Game";
import { execSnapshotType } from "../snapshot/ExecutionSnapshot";
import type {
  ExecRecord,
  SnapshotReader,
  SnapshotWriter,
} from "../snapshot/SnapshotContext";
import { zPlayerRef } from "../snapshot/SnapshotType";

/**
 * Administrator-only test hook. Authorization happens on the game server;
 * keeping the outcome as an execution makes it deterministic for every peer.
 */
export class AdminSetOutcomeExecution implements Execution {
  constructor(
    private player: Player,
    private outcome: "victory" | "defeat",
  ) {}

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(game: Game, ticks: number): void {
    if (!this.player.hasSpawned()) return;

    if (this.outcome === "victory") {
      game.setWinner(this.player.team() ?? this.player, game.stats().stats());
      return;
    }

    if (!this.player.isAlive()) return;

    const stillStanding = game
      .players()
      .filter(
        (player) => player !== this.player && player.type() !== PlayerType.Bot,
      ).length;
    game.stats().recordDeathPosition(this.player, stillStanding + 1);
    game.stats().playerKilled(this.player, ticks);

    // Relinquishing the tiles uses the normal player-death path on the next
    // tick, so the defeat modal and all peers observe the same state.
    for (const tile of Array.from(this.player.tiles())) {
      this.player.relinquish(tile);
    }
  }

  tick(_ticks: number): void {}

  snapshot(w: SnapshotWriter): ExecRecord {
    return AdminSetOutcomeExecutionSnapshot.write({
      player: w.player(this.player),
      outcome: this.outcome,
    });
  }

  restoreSnapshot(s: AdminSetOutcomeState, r: SnapshotReader): void {
    this.player = r.player(s.player);
    this.outcome = s.outcome;
  }
}

const AdminSetOutcomeStateSchema = z.object({
  player: zPlayerRef(),
  outcome: z.enum(["victory", "defeat"]),
});
type AdminSetOutcomeState = z.infer<typeof AdminSetOutcomeStateSchema>;

export const AdminSetOutcomeExecutionSnapshot = execSnapshotType({
  name: "AdminSetOutcome",
  version: 1,
  schema: AdminSetOutcomeStateSchema,
  cls: () => AdminSetOutcomeExecution,
});
