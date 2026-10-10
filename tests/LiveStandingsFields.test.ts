import { Game, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

// OFM live standings: killedBy + deathPosition are stored on the player's stats
// (mg.stats()) and surfaced on the live PlayerUpdate every tick, so the admin
// bot can score placement + kills off the live snapshot instead of waiting for
// the post-game record.
describe("OFM live standings fields", () => {
  let game: Game;

  beforeEach(async () => {
    game = await setup("ocean_and_land");
  });

  function addHuman(id: string, clientID: string | null) {
    game.addPlayer(new PlayerInfo(id, PlayerType.Human, clientID, id));
    return game.player(id);
  }

  test("conquest stamps killedBy + deathPosition into stats", () => {
    const conqueror = addHuman("conqueror", "conqueror_client");
    const victim = addHuman("victim", "victim_client");

    game.conquerPlayer(conqueror, victim);

    const stats = game.stats().getPlayerStats(victim);
    expect(stats?.killedBy).toBe("conqueror_client");
    expect(stats?.killedByName).toBe("conqueror");
    expect(stats?.killedByType).toBe(PlayerType.Human);
    expect(typeof stats?.deathPosition).toBe("number");
  });

  test("stamped fields ride the live PlayerUpdate", () => {
    const conqueror = addHuman("conqueror", "conqueror_client");
    const victim = addHuman("victim", "victim_client");

    game.conquerPlayer(conqueror, victim);

    const update = victim.toUpdate();
    expect(update?.killedBy).toBe("conqueror_client");
    expect(typeof update?.deathPosition).toBe("number");
  });

  test("an AI nation killer retains its display identity without a client ID", () => {
    // Nations have no client ID, but the defeat report still needs their name
    // and type rather than collapsing every non-client killer into "unknown".
    game.addPlayer(new PlayerInfo("France", PlayerType.Nation, null, "france"));
    const killer = game.player("france");
    const victim = addHuman("victim2", "victim2_client");

    game.conquerPlayer(killer, victim);

    const update = victim.toUpdate();
    expect(update?.killedBy).toBeNull();
    expect(update?.killedByName).toBe("France");
    expect(update?.killedByType).toBe(PlayerType.Nation);
    expect(typeof update?.deathPosition).toBe("number");
  });

  test("an alive player has null killedBy + deathPosition on its update", () => {
    const alive = addHuman("alive", "alive_client");
    const update = alive.toUpdate();
    expect(update?.killedBy).toBeNull();
    expect(update?.deathPosition).toBeNull();
  });
});
