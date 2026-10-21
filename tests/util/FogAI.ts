import { Difficulty, PlayerInfo, PlayerType } from "../../src/core/game/Game";
import { setup } from "./Setup";
export async function intelScene(fog = true, difficulty = Difficulty.Medium) {
  const game = await setup("big_plains", {
    difficulty,
    fogOfWar: { enabled: fog },
    instantBuild: true,
  });
  const add = (id: string, x: number, y = 100) => {
    const p = game.addPlayer(new PlayerInfo(id, PlayerType.Nation, null, id));
    p.conquer(game.ref(x, y));
    p.setSpawnTile(game.ref(x, y));
    p.setTroops(100_000);
    p.addGold(30_000_000n);
    return p;
  };
  const a = add("aaaaaaaa", 10),
    b = add("bbbbbbbb", 90),
    c = add("cccccccc", 170);
  return { game, a, b, c, add };
}
