import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SelfHostedAccountStore } from "../../src/server/SelfHostedAccountStore";

const stores: SelfHostedAccountStore[] = [];

function store(): SelfHostedAccountStore {
  const value = new SelfHostedAccountStore(":memory:");
  stores.push(value);
  return value;
}

afterEach(() => {
  stores.splice(0).forEach((value) => value.close());
  delete process.env.SELF_HOSTED_ADMIN_USERS;
});

describe("SelfHostedAccountStore", () => {
  it("registers the first account as admin and authenticates its session", () => {
    const accounts = store();
    const registered = accounts.register("Froggy", "correct horse battery");

    expect(registered.account).toMatchObject({
      username: "Froggy",
      // New accounts start with the username as their display name.
      nickname: "Froggy",
      role: "admin",
    });
    expect(accounts.accountForSession(registered.sessionToken)).toEqual(
      registered.account,
    );
    expect(accounts.accountById(registered.account.id)).toEqual(
      registered.account,
    );
    expect(
      accounts.accountById("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
    expect(accounts.accountForSession("wrong-token")).toBeNull();
  });

  it("keeps usernames unique after normalization", () => {
    const accounts = store();
    accounts.register("Froggy DFS", "password-one");

    expect(() => accounts.register(" froggy   dfs ", "password-two")).toThrow(
      "username_taken",
    );
  });

  it("honors configured administrator usernames after the first account", () => {
    process.env.SELF_HOSTED_ADMIN_USERS = "Froggy";
    const accounts = store();
    accounts.register("Alice", "password-one");

    expect(accounts.register("froggy", "password-two").account.role).toBe(
      "admin",
    );
  });

  it("rejects a wrong password and accepts the correct password", () => {
    const accounts = store();
    accounts.register("Alice", "password-one");

    expect(accounts.login("Alice", "password-two")).toBeNull();
    expect(accounts.login("alice", "password-one")?.account.username).toBe(
      "Alice",
    );
  });

  it("changes the nickname but never the login username", () => {
    const accounts = store();
    const registered = accounts.register("Alice", "password-one");
    const renamed = accounts.setNickname(registered.account.id, "爱丽丝");
    const bob = accounts.register("Bob", "password-two");

    expect(renamed).toMatchObject({
      id: registered.account.id,
      username: "Alice",
      nickname: "爱丽丝",
      role: "admin",
    });
    // The login handle still works and resolves to the new display name.
    expect(accounts.login("Alice", "password-one")?.account.nickname).toBe(
      "爱丽丝",
    );
    // Nicknames are not unique.
    expect(accounts.setNickname(bob.account.id, "爱丽丝").nickname).toBe(
      "爱丽丝",
    );
  });

  it("backfills the nickname for accounts created before the column existed", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "nickname-migration-"));
    const file = path.join(directory, "accounts.sqlite");
    try {
      const legacy = new DatabaseSync(file);
      legacy.exec(`
        CREATE TABLE self_hosted_accounts (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          normalized_username TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `);
      legacy
        .prepare(
          `INSERT INTO self_hosted_accounts
            (id, username, normalized_username, password_hash, role)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          "00000000-0000-4000-8000-000000000001",
          "老玩家",
          "老玩家",
          "scrypt$x$y",
          "player",
        );
      legacy.close();

      const accounts = new SelfHostedAccountStore(file);
      expect(
        accounts.accountById("00000000-0000-4000-8000-000000000001"),
      ).toMatchObject({ username: "老玩家", nickname: "老玩家" });
      accounts.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("deletes a session on logout", () => {
    const accounts = store();
    const registered = accounts.register("Alice", "password-one");

    accounts.deleteSession(registered.sessionToken);

    expect(accounts.accountForSession(registered.sessionToken)).toBeNull();
  });

  it("persists an asynchronous password reset approval flow", () => {
    const accounts = store();
    const admin = accounts.register("Froggy", "password-one");
    const player = accounts.register("Alice", "password-two");
    const request = accounts.requestPasswordReset("alice");
    expect(request.outcome).toBe("created");
    if (request.outcome !== "created") throw new Error("request not created");

    expect(
      accounts.passwordResetStatus(request.requestId, request.recoveryToken)
        ?.status,
    ).toBe("pending");
    expect(
      accounts.reviewPasswordReset(
        request.requestId,
        admin.account.id,
        "approved",
      ),
    ).toBe(true);
    expect(
      accounts.passwordResetStatus(request.requestId, request.recoveryToken)
        ?.status,
    ).toBe("approved");

    const completed = accounts.completePasswordReset(
      request.requestId,
      request.recoveryToken,
      "password-three",
    );
    expect(completed?.account.id).toBe(player.account.id);
    expect(accounts.login("Alice", "password-two")).toBeNull();
    expect(accounts.login("Alice", "password-three")?.account.id).toBe(
      player.account.id,
    );
    expect(accounts.accountForSession(player.sessionToken)).toBeNull();
    expect(
      accounts.passwordResetStatus(request.requestId, request.recoveryToken)
        ?.status,
    ).toBe("completed");
  });

  it("rejects reset credentials from another browser", () => {
    const accounts = store();
    accounts.register("Froggy", "password-one");
    accounts.register("Alice", "password-two");
    const request = accounts.requestPasswordReset("Alice");
    expect(request.outcome).toBe("created");
    if (request.outcome !== "created") throw new Error("request not created");

    expect(
      accounts.passwordResetStatus(request.requestId, "wrong-recovery-token"),
    ).toBeNull();
  });

  it("requires local owner recovery for administrator accounts", () => {
    const accounts = store();
    accounts.register("Froggy", "password-one");

    expect(accounts.requestPasswordReset("Froggy")).toEqual({
      outcome: "admin_requires_owner",
    });
    expect(accounts.adminOverview().resets).toEqual([]);
  });

  it("supports a local owner recovery and revokes old sessions", () => {
    const accounts = store();
    const registered = accounts.register("Froggy", "password-one");

    expect(
      accounts.resetPasswordByUsername("froggy", "temporary-password")?.role,
    ).toBe("admin");
    expect(accounts.accountForSession(registered.sessionToken)).toBeNull();
    expect(accounts.login("Froggy", "temporary-password")?.account.role).toBe(
      "admin",
    );
  });

  it("cancels outstanding reset approval when a password is changed", () => {
    const accounts = store();
    accounts.register("Froggy", "password-one");
    const player = accounts.register("Alice", "password-two");
    const request = accounts.requestPasswordReset("Alice");
    if (request.outcome !== "created") throw new Error("request not created");

    expect(
      accounts.changePassword(
        player.account.id,
        "password-two",
        "password-three",
      ),
    ).toBe(true);
    expect(
      accounts.passwordResetStatus(request.requestId, request.recoveryToken)
        ?.status,
    ).toBe("cancelled");
  });
});
