import { afterEach, describe, expect, it } from "vitest";
import { SelfHostedAccountStore } from "../../src/server/SelfHostedAccountStore";
import { SelfHostedFriendsStore } from "../../src/server/SelfHostedFriendsStore";

const stores: SelfHostedAccountStore[] = [];

function makeStore() {
  const accounts = new SelfHostedAccountStore(":memory:");
  stores.push(accounts);
  const friends = new SelfHostedFriendsStore(accounts.db);
  return { accounts, friends };
}

function register(accounts: SelfHostedAccountStore, username: string) {
  return accounts.register(username, "correct horse battery").account;
}

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  delete process.env.SELF_HOSTED_ADMIN_USERS;
});

describe("SelfHostedFriendsStore", () => {
  it("turns an accepted request into a friendship both ways", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");

    const request = friends.requestFriend(alice.id, "bob");
    expect(request.outcome).toBe("created");
    expect(friends.listRequests(bob.id).incoming).toHaveLength(1);

    const id = request.outcome === "created" ? request.id : "";
    expect(friends.acceptRequest(id, bob.id)).toBe(true);

    expect(friends.listFriends(alice.id).map((f) => f.username)).toEqual([
      "Bob",
    ]);
    expect(friends.listFriends(bob.id).map((f) => f.username)).toEqual([
      "Alice",
    ]);
    expect(friends.lookup(alice.id, "Bob")?.relation).toBe("friend");
    expect(friends.listRequests(bob.id).incoming).toHaveLength(0);
  });

  it("keeps a declined request from creating a friendship", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");

    const request = friends.requestFriend(alice.id, "Bob");
    const id = request.outcome === "created" ? request.id : "";

    expect(friends.declineRequest(id, bob.id)).toBe(true);
    expect(friends.listFriends(alice.id)).toHaveLength(0);
    expect(friends.lookup(alice.id, "Bob")?.relation).toBe("none");
  });

  it("treats a repeated request as idempotent", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    register(accounts, "Bob");

    const first = friends.requestFriend(alice.id, "Bob");
    const second = friends.requestFriend(alice.id, "bob");

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("already_sent");
    if (first.outcome === "created" && second.outcome === "already_sent") {
      expect(second.id).toBe(first.id);
    }
  });

  it("accepts immediately when both sides already asked", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");

    friends.requestFriend(alice.id, "Bob");
    const crossed = friends.requestFriend(bob.id, "Alice");

    expect(crossed.outcome).toBe("accepted");
    expect(friends.listFriends(alice.id)).toHaveLength(1);
    expect(friends.listFriends(bob.id)).toHaveLength(1);
  });

  it("refuses to befriend yourself and reports unknown names", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");

    expect(friends.requestFriend(alice.id, "alice")).toEqual({
      outcome: "self",
    });
    expect(friends.requestFriend(alice.id, "Nobody")).toEqual({
      outcome: "account_not_found",
    });
    expect(friends.lookup(alice.id, "Nobody")).toBeNull();
  });

  it("removes a friendship in both directions", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");
    const request = friends.requestFriend(alice.id, "Bob");
    if (request.outcome === "created") {
      friends.acceptRequest(request.id, bob.id);
    }

    expect(friends.removeFriend(alice.id, "Bob")).toBe(true);
    expect(friends.listFriends(alice.id)).toHaveLength(0);
    expect(friends.listFriends(bob.id)).toHaveLength(0);
    expect(friends.removeFriend(alice.id, "Bob")).toBe(false);
  });

  it("delivers an invite only to a friend and only once per lobby", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");
    const carol = register(accounts, "Carol");
    const request = friends.requestFriend(alice.id, "Bob");
    if (request.outcome === "created") {
      friends.acceptRequest(request.id, bob.id);
    }

    const first = friends.invite(alice.id, "gameABCDE", ["Bob", "Carol"]);
    expect(first.invited).toBe(1);
    expect(first.skipped).toEqual([
      { username: "Carol", reason: "not_friend" },
    ]);
    expect(friends.inbox(bob.id).invites).toHaveLength(1);
    expect(friends.inbox(carol.id).invites).toHaveLength(0);

    // Re-inviting the same friend to the same lobby refreshes, never duplicates.
    const second = friends.invite(alice.id, "gameABCDE", ["Bob"]);
    expect(second.invited).toBe(1);
    expect(friends.inbox(bob.id).invites).toHaveLength(1);
    expect(friends.invitedForGame(alice.id, "gameABCDE")).toEqual(["Bob"]);
  });

  it("expires invites instead of leaving them in the inbox", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");
    const request = friends.requestFriend(alice.id, "Bob");
    if (request.outcome === "created") {
      friends.acceptRequest(request.id, bob.id);
    }
    friends.invite(alice.id, "gameABCDE", ["Bob"]);

    accounts.db
      .prepare("UPDATE self_hosted_game_invites SET expires_at = ?")
      .run(Math.floor(Date.now() / 1000) - 1);

    expect(friends.inbox(bob.id).invites).toHaveLength(0);
    expect(friends.invitedForGame(alice.id, "gameABCDE")).toEqual([]);
  });

  it("lets only the recipient dismiss their own invite", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");
    const carol = register(accounts, "Carol");
    const request = friends.requestFriend(alice.id, "Bob");
    if (request.outcome === "created") {
      friends.acceptRequest(request.id, bob.id);
    }
    friends.invite(alice.id, "gameABCDE", ["Bob"]);

    const invite = friends.inbox(bob.id).invites[0];
    expect(friends.setInviteStatus(invite.id, carol.id, "dismissed")).toBe(
      false,
    );
    expect(friends.setInviteStatus(invite.id, bob.id, "dismissed")).toBe(true);
    expect(friends.inbox(bob.id).invites).toHaveLength(0);
  });

  it("follows a rename because rows key on the account, not the name", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");
    const request = friends.requestFriend(alice.id, "Bob");
    if (request.outcome === "created") {
      friends.acceptRequest(request.id, bob.id);
    }

    accounts.rename(bob.id, "Bobby");

    expect(friends.listFriends(alice.id).map((f) => f.username)).toEqual([
      "Bobby",
    ]);
    expect(friends.lookup(alice.id, "Bobby")?.relation).toBe("friend");
    expect(friends.lookup(alice.id, "Bob")).toBeNull();
  });

  it("never puts an account id on the wire", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    const bob = register(accounts, "Bob");
    const request = friends.requestFriend(alice.id, "Bob");
    if (request.outcome === "created") {
      friends.acceptRequest(request.id, bob.id);
    }
    friends.invite(alice.id, "gameABCDE", ["Bob"]);

    const wire = JSON.stringify([
      friends.listFriends(alice.id),
      friends.listRequests(alice.id),
      friends.inbox(bob.id),
      friends.invitedForGame(alice.id, "gameABCDE"),
    ]);
    expect(wire).not.toContain(alice.id);
    expect(wire).not.toContain(bob.id);
  });

  it("rate limits a flood of friend requests", () => {
    const { accounts, friends } = makeStore();
    const alice = register(accounts, "Alice");
    for (let i = 0; i < 21; i++) {
      register(accounts, `Friend${i}`);
      friends.requestFriend(alice.id, `Friend${i}`);
    }

    expect(friends.requestFriend(alice.id, "Friend20")).toMatchObject({
      outcome: "rate_limited",
    });
  });
});
