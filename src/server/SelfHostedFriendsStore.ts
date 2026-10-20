import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { normalizeUsername } from "./SelfHostedAccountStore";

/**
 * Friends and game invites for the self-hosted edition.
 *
 * Identity never leaves this module: every row keys on
 * `self_hosted_accounts.id`, but every value that goes out to a client is a
 * USERNAME. That is deliberate — the account id is also the play token
 * (`/api/self-hosted/account/play-token`), so handing it to anyone would hand
 * them the ability to join games as that player.
 *
 * The store shares the account store's connection (see
 * `SelfHostedAccountStore.db`): the friends tables carry foreign keys into
 * `self_hosted_accounts`, and a second connection would only add ordering
 * puzzles for zero benefit — the master process is the sole writer.
 */

export interface FriendSummary {
  username: string;
  /** ISO-8601, resolved at read time so a rename shows up immediately. */
  since: string;
}

export interface FriendRequestSummary {
  id: string;
  username: string;
  createdAt: string;
}

export interface GameInvite {
  id: string;
  gameID: string;
  fromUsername: string;
  createdAt: string;
  /** Unix seconds; the client shows "expires in N minutes". */
  expiresAt: number;
}

export interface FriendsInbox {
  friendRequests: FriendRequestSummary[];
  invites: GameInvite[];
}

export type FriendRelation =
  | "self"
  | "friend"
  | "pending_out"
  | "pending_in"
  | "none";

export type FriendRequestOutcome =
  | { outcome: "created"; id: string }
  | { outcome: "accepted"; id: string }
  | { outcome: "already_sent"; id: string }
  | { outcome: "already_friends" }
  | { outcome: "self" }
  | { outcome: "account_not_found" }
  | { outcome: "rate_limited" }
  | { outcome: "friend_limit" };

export type InviteSkipReason = "account_not_found" | "self" | "not_friend";

export interface InviteResult {
  invited: number;
  skipped: { username: string; reason: InviteSkipReason }[];
}

// A lobby lives for at most a couple of hours; 30 minutes covers "the friend
// stepped away" without leaving dead invites in the inbox all evening.
const INVITE_TTL_SECONDS = 30 * 60;
const MAX_FRIENDS = 200;
const MAX_INVITES_PER_CALL = 50;
const FRIEND_REQUESTS_PER_HOUR = 20;
const INVITES_PER_TEN_MINUTES = 30;

const ISO_UTC = "%Y-%m-%dT%H:%M:%SZ";

export class SelfHostedFriendsStore {
  constructor(private readonly database: DatabaseSync) {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS self_hosted_friends (
        account_id TEXT NOT NULL REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        friend_id TEXT NOT NULL REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, friend_id),
        CHECK (account_id <> friend_id)
      );

      CREATE TABLE IF NOT EXISTS self_hosted_friend_requests (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN
          ('pending', 'accepted', 'declined', 'cancelled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(from_id, to_id)
      );
      CREATE INDEX IF NOT EXISTS self_hosted_friend_requests_inbox
        ON self_hosted_friend_requests(to_id, status);

      CREATE TABLE IF NOT EXISTS self_hosted_game_invites (
        id TEXT PRIMARY KEY,
        from_id TEXT NOT NULL REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        to_id TEXT NOT NULL REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        game_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
          ('pending', 'accepted', 'dismissed', 'expired')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at INTEGER NOT NULL,
        UNIQUE(game_id, to_id)
      );
      CREATE INDEX IF NOT EXISTS self_hosted_game_invites_inbox
        ON self_hosted_game_invites(to_id, status, expires_at);
    `);
  }

  // ---- Friends -----------------------------------------------------------

  listFriends(accountId: string): FriendSummary[] {
    return this.database
      .prepare(
        `SELECT a.username AS username,
           strftime('${ISO_UTC}', f.created_at) AS since
         FROM self_hosted_friends f
         INNER JOIN self_hosted_accounts a ON a.id = f.friend_id
         WHERE f.account_id = ?
         ORDER BY a.username COLLATE NOCASE ASC`,
      )
      .all(accountId) as unknown as FriendSummary[];
  }

  /** Null when no such account exists; the caller turns that into a 404. */
  lookup(
    accountId: string,
    username: string,
  ): { username: string; relation: FriendRelation } | null {
    const target = this.accountByUsername(username);
    if (target === null) return null;
    if (target.id === accountId) {
      return { username: target.username, relation: "self" };
    }
    if (this.areFriends(accountId, target.id)) {
      return { username: target.username, relation: "friend" };
    }
    if (this.pendingRequest(accountId, target.id) !== null) {
      return { username: target.username, relation: "pending_out" };
    }
    if (this.pendingRequest(target.id, accountId) !== null) {
      return { username: target.username, relation: "pending_in" };
    }
    return { username: target.username, relation: "none" };
  }

  listRequests(accountId: string): {
    incoming: FriendRequestSummary[];
    outgoing: FriendRequestSummary[];
  } {
    return {
      incoming: this.requests(accountId, "incoming"),
      outgoing: this.requests(accountId, "outgoing"),
    };
  }

  requestFriend(fromId: string, username: string): FriendRequestOutcome {
    const target = this.accountByUsername(username);
    if (target === null) return { outcome: "account_not_found" };
    if (target.id === fromId) return { outcome: "self" };
    if (this.areFriends(fromId, target.id)) {
      return { outcome: "already_friends" };
    }

    const sent = this.pendingRequest(fromId, target.id);
    if (sent !== null) return { outcome: "already_sent", id: sent };

    // Mutual intent — both sides already asked for this. Accept the pending
    // reverse request instead of leaving two rows for a human to reconcile.
    const received = this.pendingRequest(target.id, fromId);
    if (received !== null) {
      this.acceptRequest(received, fromId);
      return { outcome: "accepted", id: received };
    }

    if (this.friendCount(fromId) >= MAX_FRIENDS) {
      return { outcome: "friend_limit" };
    }
    if (this.recentCount("self_hosted_friend_requests", fromId, "1 hour")
      >= FRIEND_REQUESTS_PER_HOUR) {
      return { outcome: "rate_limited" };
    }

    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO self_hosted_friend_requests (id, from_id, to_id, status)
         VALUES (?, ?, ?, 'pending')`,
      )
      .run(id, fromId, target.id);
    return { outcome: "created", id };
  }

  /** True when the request existed, was pending, and belonged to `toId`. */
  acceptRequest(requestId: string, toId: string): boolean {
    const row = this.database
      .prepare(
        `SELECT id, from_id AS fromId FROM self_hosted_friend_requests
         WHERE id = ? AND to_id = ? AND status = 'pending'`,
      )
      .get(requestId, toId) as { id: string; fromId: string } | undefined;
    if (row === undefined) return false;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const link = this.database.prepare(
        `INSERT OR IGNORE INTO self_hosted_friends (account_id, friend_id)
         VALUES (?, ?)`,
      );
      link.run(row.fromId, toId);
      link.run(toId, row.fromId);
      this.database
        .prepare(
          `UPDATE self_hosted_friend_requests
           SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
        )
        .run(requestId);
      // Any crossing request the other side had also sent is now redundant.
      this.database
        .prepare(
          `UPDATE self_hosted_friend_requests
           SET status = 'accepted', updated_at = CURRENT_TIMESTAMP
           WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
        )
        .run(toId, row.fromId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return true;
  }

  declineRequest(requestId: string, toId: string): boolean {
    const result = this.database
      .prepare(
        `UPDATE self_hosted_friend_requests
         SET status = 'declined', updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND to_id = ? AND status = 'pending'`,
      )
      .run(requestId, toId);
    return Number(result.changes) === 1;
  }

  removeFriend(accountId: string, username: string): boolean {
    const target = this.accountByUsername(username);
    if (target === null) return false;
    const result = this.database
      .prepare(
        `DELETE FROM self_hosted_friends
         WHERE (account_id = ? AND friend_id = ?)
            OR (account_id = ? AND friend_id = ?)`,
      )
      .run(accountId, target.id, target.id, accountId);
    return Number(result.changes) > 0;
  }

  // ---- Invites -----------------------------------------------------------

  inbox(accountId: string): FriendsInbox {
    this.expireInvites();
    return {
      friendRequests: this.requests(accountId, "incoming"),
      invites: this.database
        .prepare(
          `SELECT i.id, i.game_id AS gameID, a.username AS fromUsername,
             strftime('${ISO_UTC}', i.created_at) AS createdAt,
             i.expires_at AS expiresAt
           FROM self_hosted_game_invites i
           INNER JOIN self_hosted_accounts a ON a.id = i.from_id
           WHERE i.to_id = ? AND i.status = 'pending' AND i.expires_at > ?
           ORDER BY i.created_at DESC`,
        )
        .all(accountId, nowSeconds()) as unknown as GameInvite[],
    };
  }

  /**
   * Invite friends to a lobby. Not-friends and unknown names are skipped and
   * reported rather than failing the batch: the panel only offers friends, so
   * a skip means the relationship changed under the caller's feet.
   */
  invite(
    fromId: string,
    gameID: string,
    usernames: readonly string[],
  ): InviteResult {
    this.expireInvites();
    const skipped: InviteResult["skipped"] = [];
    const targets: string[] = [];
    const seen = new Set<string>();

    for (const raw of usernames.slice(0, MAX_INVITES_PER_CALL)) {
      const target = this.accountByUsername(raw);
      if (target === null) {
        skipped.push({ username: raw, reason: "account_not_found" });
        continue;
      }
      if (target.id === fromId) {
        skipped.push({ username: target.username, reason: "self" });
        continue;
      }
      if (seen.has(target.id)) continue;
      if (!this.areFriends(fromId, target.id)) {
        skipped.push({ username: target.username, reason: "not_friend" });
        continue;
      }
      seen.add(target.id);
      targets.push(target.id);
    }

    if (targets.length === 0) return { invited: 0, skipped };
    if (
      this.recentCount("self_hosted_game_invites", fromId, "10 minutes") +
        targets.length >
      INVITES_PER_TEN_MINUTES
    ) {
      // Silence-rate-limit per target instead of dropping the whole batch:
      // the UI reports "已邀请 N 位", and a partial batch is still useful.
      const allowed = Math.max(
        0,
        INVITES_PER_TEN_MINUTES -
          this.recentCount("self_hosted_game_invites", fromId, "10 minutes"),
      );
      targets.length = allowed;
    }

    const expiresAt = nowSeconds() + INVITE_TTL_SECONDS;
    const upsert = this.database.prepare(
      `INSERT INTO self_hosted_game_invites
         (id, from_id, to_id, game_id, status, expires_at)
       VALUES (?, ?, ?, ?, 'pending', ?)
       ON CONFLICT(game_id, to_id) DO UPDATE SET
         from_id = excluded.from_id,
         status = 'pending',
         created_at = CURRENT_TIMESTAMP,
         expires_at = excluded.expires_at`,
    );
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const toId of targets) {
        upsert.run(randomUUID(), fromId, toId, gameID, expiresAt);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { invited: targets.length, skipped };
  }

  /** The friends this account already invited to one lobby, for the panel's
   * "已邀请" state after a reload. */
  invitedForGame(fromId: string, gameID: string): string[] {
    this.expireInvites();
    const rows = this.database
      .prepare(
        `SELECT a.username AS username
         FROM self_hosted_game_invites i
         INNER JOIN self_hosted_accounts a ON a.id = i.to_id
         WHERE i.from_id = ? AND i.game_id = ? AND i.status = 'pending'
           AND i.expires_at > ?
         ORDER BY a.username COLLATE NOCASE ASC`,
      )
      .all(fromId, gameID, nowSeconds()) as unknown as { username: string }[];
    return rows.map((row) => row.username);
  }

  setInviteStatus(
    inviteId: string,
    toId: string,
    status: "accepted" | "dismissed",
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE self_hosted_game_invites SET status = ?
         WHERE id = ? AND to_id = ? AND status = 'pending'`,
      )
      .run(status, inviteId, toId);
    return Number(result.changes) === 1;
  }

  expireInvites(): void {
    this.database
      .prepare(
        `UPDATE self_hosted_game_invites SET status = 'expired'
         WHERE status = 'pending' AND expires_at <= ?`,
      )
      .run(nowSeconds());
  }

  // ---- Internals ---------------------------------------------------------

  private accountByUsername(
    username: string,
  ): { id: string; username: string } | null {
    const row = this.database
      .prepare(
        `SELECT id, username FROM self_hosted_accounts
         WHERE normalized_username = ?`,
      )
      .get(normalizeUsername(username)) as
      | { id: string; username: string }
      | undefined;
    return row ?? null;
  }

  private areFriends(a: string, b: string): boolean {
    return (
      this.database
        .prepare(
          `SELECT 1 FROM self_hosted_friends
           WHERE account_id = ? AND friend_id = ?`,
        )
        .get(a, b) !== undefined
    );
  }

  private friendCount(accountId: string): number {
    const row = this.database
      .prepare(
        "SELECT COUNT(*) AS count FROM self_hosted_friends WHERE account_id = ?",
      )
      .get(accountId) as { count: number };
    return Number(row.count);
  }

  private pendingRequest(fromId: string, toId: string): string | null {
    const row = this.database
      .prepare(
        `SELECT id FROM self_hosted_friend_requests
         WHERE from_id = ? AND to_id = ? AND status = 'pending'`,
      )
      .get(fromId, toId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private requests(
    accountId: string,
    direction: "incoming" | "outgoing",
  ): FriendRequestSummary[] {
    const mine = direction === "incoming" ? "to_id" : "from_id";
    const other = direction === "incoming" ? "from_id" : "to_id";
    return this.database
      .prepare(
        `SELECT r.id, a.username AS username,
           strftime('${ISO_UTC}', r.created_at) AS createdAt
         FROM self_hosted_friend_requests r
         INNER JOIN self_hosted_accounts a ON a.id = r.${other}
         WHERE r.${mine} = ? AND r.status = 'pending'
         ORDER BY r.created_at DESC`,
      )
      .all(accountId) as unknown as FriendRequestSummary[];
  }

  private recentCount(
    table: "self_hosted_friend_requests" | "self_hosted_game_invites",
    accountId: string,
    window: "1 hour" | "10 minutes",
  ): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM ${table}
         WHERE from_id = ? AND created_at >= datetime('now', ?)`,
      )
      .get(accountId, `-${window}`) as { count: number };
    return Number(row.count);
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
