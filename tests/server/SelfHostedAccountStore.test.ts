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
      role: "admin",
    });
    expect(accounts.accountForSession(registered.sessionToken)).toEqual(
      registered.account,
    );
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

  it("renames without changing the stable account id or role", () => {
    const accounts = store();
    const registered = accounts.register("Alice", "password-one");
    const renamed = accounts.rename(registered.account.id, "Alice II");

    expect(renamed).toMatchObject({
      id: registered.account.id,
      username: "Alice II",
      role: "admin",
    });
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
    const request = accounts.requestPasswordReset("alice")!;

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
    const request = accounts.requestPasswordReset("Froggy")!;

    expect(
      accounts.passwordResetStatus(request.requestId, "wrong-recovery-token"),
    ).toBeNull();
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
});
