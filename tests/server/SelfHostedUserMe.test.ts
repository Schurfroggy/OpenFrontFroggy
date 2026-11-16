import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { UserMeResponseSchema } from "../../src/core/ApiSchemas";
import { ClientJoinMessageSchema } from "../../src/core/Schemas";
import { NicknameSchema } from "../../src/core/validations/Nickname";
import { getUserMe, selfHostedUserMe } from "../../src/server/jwt";
import { SelfHostedAccountStore } from "../../src/server/SelfHostedAccountStore";

// getUserMe caches one account store for the module (keyed by
// SELF_HOSTED_DB_PATH), so the path has to be in place before the first call.
let dir: string;
let databasePath: string;
let accounts: SelfHostedAccountStore;

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "openfront-selfhosted-userme-"));
  databasePath = path.join(dir, "self-hosted.sqlite");
  process.env.SELF_HOSTED = "true";
  process.env.SELF_HOSTED_DB_PATH = databasePath;
  accounts = new SelfHostedAccountStore(databasePath);
});

afterAll(() => {
  accounts.close();
  delete process.env.SELF_HOSTED;
  delete process.env.SELF_HOSTED_DB_PATH;
  rmSync(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("selfHostedUserMe", () => {
  it("builds a profile the shared schema accepts", () => {
    const { account } = accounts.register("Froggy", "correct horse battery");

    const me = selfHostedUserMe(account);

    expect(UserMeResponseSchema.safeParse(me).success).toBe(true);
    expect(me.player.publicId).toBe(account.id);
    expect(me.player.username).toBe("Froggy");
    expect(me.player.friends).toEqual([]);
  });

  it("keeps saved punctuation nicknames valid in the profile and join message", () => {
    const { account } = accounts.register("PunctUser", "correct horse battery");
    for (const input of ["Bob!", "阿丹!", "A&B", "🎯".repeat(10)]) {
      const renamed = accounts.setNickname(
        account.id,
        NicknameSchema.parse(input),
      );
      const me = selfHostedUserMe(renamed);
      expect(UserMeResponseSchema.safeParse(me).success).toBe(true);
      expect(
        ClientJoinMessageSchema.safeParse({
          type: "join",
          token: account.id,
          gameID: "game0001",
          username: me.player.username,
          clanTag: null,
          turnstileToken: null,
        }).success,
      ).toBe(true);
    }
  });

  it("displays the nickname, not the login username", () => {
    const { account } = accounts.register("Dana", "correct horse battery");
    const renamed = accounts.setNickname(account.id, "阿丹");

    const me = selfHostedUserMe(renamed);

    expect(me.player.username).toBe("阿丹");
    // Both halves must match or the client treats the name as taken by
    // someone else (accountNameHeld).
    expect(me.player.usernameBase).toBe("阿丹");
    expect(UserMeResponseSchema.safeParse(me).success).toBe(true);
  });
});

describe("getUserMe on a self-hosted server", () => {
  it("answers from the local account store instead of the cloud API", async () => {
    const { account } = accounts.register("Alice", "correct horse battery");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await getUserMe(account.id);

    // The regression: the join handler used to fetch https://api.<DOMAIN>/users/@me
    // here, fail (no such API), and close the join as unauthorized.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.type).toBe("success");
    if (result.type === "success") {
      expect(result.response.player.username).toBe("Alice");
      expect(result.response.player.publicId).toBe(account.id);
    }
  });

  it("rejects a token that is not a registered account", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await getUserMe("11111111-1111-4111-8111-111111111111");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toMatchObject({ type: "error", status: 401 });
  });
});
