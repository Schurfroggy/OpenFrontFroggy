import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { selfHostedAchievementDatabasePath } from "./SelfHostedAchievementStore";

export type SelfHostedAccountRole = "player" | "admin";

export interface SelfHostedAccount {
  id: string;
  username: string;
  role: SelfHostedAccountRole;
  createdAt: string;
}

export type PasswordResetStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "completed"
  | "expired"
  | "cancelled";

export interface SelfHostedPasswordReset {
  id: string;
  accountId: string;
  username: string;
  status: PasswordResetStatus;
  requestedAt: string;
  expiresAt: number;
  approvedAt: string | null;
}

export interface SelfHostedAdminAccount extends SelfHostedAccount {
  activeSessions: number;
}

export type PasswordResetRequestResult =
  | {
      outcome: "created";
      requestId: string;
      recoveryToken: string;
    }
  | { outcome: "account_not_found" }
  | { outcome: "admin_requires_owner" };

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const RESET_REQUEST_MAX_AGE_SECONDS = 60 * 60 * 24;
const APPROVED_RESET_MAX_AGE_SECONDS = 60 * 60;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1 } as const;

function normalizeUsername(username: string): string {
  return username.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

function passwordMatches(password: string, encoded: string): boolean {
  const [kind, saltText, hashText] = encoded.split("$");
  if (kind !== "scrypt" || !saltText || !hashText) return false;
  const expected = Buffer.from(hashText, "base64url");
  const actual = scryptSync(
    password,
    Buffer.from(saltText, "base64url"),
    expected.length,
    SCRYPT_OPTIONS,
  );
  return timingSafeEqual(actual, expected);
}

function sessionHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class SelfHostedAccountStore {
  private readonly database: DatabaseSync;

  constructor(databasePath = selfHostedAchievementDatabasePath()) {
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS self_hosted_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player', 'admin')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS self_hosted_sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS self_hosted_sessions_account
        ON self_hosted_sessions(account_id);

      CREATE TABLE IF NOT EXISTS self_hosted_password_resets (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        username_snapshot TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK(status IN
          ('pending', 'approved', 'rejected', 'completed', 'expired', 'cancelled')),
        requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at INTEGER NOT NULL,
        approved_at TEXT,
        completed_at TEXT,
        reviewed_by TEXT,
        FOREIGN KEY (account_id) REFERENCES self_hosted_accounts(id)
          ON DELETE CASCADE,
        FOREIGN KEY (reviewed_by) REFERENCES self_hosted_accounts(id)
          ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS self_hosted_password_resets_account
        ON self_hosted_password_resets(account_id, status);
    `);
  }

  register(
    username: string,
    password: string,
  ): {
    account: SelfHostedAccount;
    sessionToken: string;
  } {
    const normalized = normalizeUsername(username);
    const existing = this.database
      .prepare(
        "SELECT 1 FROM self_hosted_accounts WHERE normalized_username = ?",
      )
      .get(normalized);
    if (existing) throw new Error("username_taken");

    const count = this.database
      .prepare("SELECT COUNT(*) AS count FROM self_hosted_accounts")
      .get() as { count: number };
    const configuredAdmins = new Set(
      (process.env.SELF_HOSTED_ADMIN_USERS ?? "")
        .split(",")
        .map(normalizeUsername)
        .filter(Boolean),
    );
    const role: SelfHostedAccountRole =
      count.count === 0 || configuredAdmins.has(normalized)
        ? "admin"
        : "player";
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO self_hosted_accounts
          (id, username, normalized_username, password_hash, role)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, username.trim(), normalized, passwordHash(password), role);
    this.claimLegacyAchievements(id, username.trim(), normalized);
    const account = this.byId(id)!;
    return { account, sessionToken: this.createSession(id) };
  }

  login(
    username: string,
    password: string,
  ): {
    account: SelfHostedAccount;
    sessionToken: string;
  } | null {
    const row = this.database
      .prepare(
        `SELECT id, password_hash AS passwordHash
         FROM self_hosted_accounts WHERE normalized_username = ?`,
      )
      .get(normalizeUsername(username)) as
      | { id: string; passwordHash: string }
      | undefined;
    if (!row || !passwordMatches(password, row.passwordHash)) return null;
    return {
      account: this.byId(row.id)!,
      sessionToken: this.createSession(row.id),
    };
  }

  accountForSession(token: string | undefined): SelfHostedAccount | null {
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    this.database
      .prepare("DELETE FROM self_hosted_sessions WHERE expires_at <= ?")
      .run(now);
    const row = this.database
      .prepare(
        `SELECT account_id AS accountId FROM self_hosted_sessions
         WHERE token_hash = ? AND expires_at > ?`,
      )
      .get(sessionHash(token), now) as { accountId: string } | undefined;
    return row ? this.byId(row.accountId) : null;
  }

  /** Resolve the opaque play-token UUID to its current account privileges. */
  accountById(id: string): SelfHostedAccount | null {
    return this.byId(id);
  }

  rename(accountId: string, username: string): SelfHostedAccount {
    const normalized = normalizeUsername(username);
    try {
      this.database
        .prepare(
          `UPDATE self_hosted_accounts SET username = ?, normalized_username = ?,
             updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(username.trim(), normalized, accountId);
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        throw Object.assign(new Error("username_taken"), { cause: error });
      }
      throw error;
    }
    return this.byId(accountId)!;
  }

  changePassword(
    accountId: string,
    currentPassword: string,
    newPassword: string,
  ): boolean {
    const row = this.database
      .prepare(
        "SELECT password_hash AS passwordHash FROM self_hosted_accounts WHERE id = ?",
      )
      .get(accountId) as { passwordHash: string } | undefined;
    if (!row || !passwordMatches(currentPassword, row.passwordHash)) {
      return false;
    }
    this.setPassword(accountId, newPassword, true, true);
    return true;
  }

  requestPasswordReset(username: string): PasswordResetRequestResult {
    const account = this.byNormalizedUsername(normalizeUsername(username));
    if (!account) return { outcome: "account_not_found" };
    if (account.role === "admin") {
      return { outcome: "admin_requires_owner" };
    }
    const requestId = randomUUID();
    const recoveryToken = randomBytes(32).toString("base64url");
    const expiresAt =
      Math.floor(Date.now() / 1000) + RESET_REQUEST_MAX_AGE_SECONDS;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `UPDATE self_hosted_password_resets
           SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ? AND status IN ('pending', 'approved')`,
        )
        .run(account.id);
      this.database
        .prepare(
          `INSERT INTO self_hosted_password_resets
            (id, account_id, username_snapshot, token_hash, status, expires_at)
           VALUES (?, ?, ?, ?, 'pending', ?)`,
        )
        .run(
          requestId,
          account.id,
          account.username,
          sessionHash(recoveryToken),
          expiresAt,
        );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { outcome: "created", requestId, recoveryToken };
  }

  passwordResetStatus(
    requestId: string,
    recoveryToken: string,
  ): SelfHostedPasswordReset | null {
    this.expirePasswordResets();
    return this.passwordResetByToken(requestId, recoveryToken);
  }

  reviewPasswordReset(
    requestId: string,
    adminId: string,
    decision: "approved" | "rejected",
  ): boolean {
    this.expirePasswordResets();
    const expiresAt =
      decision === "approved"
        ? Math.floor(Date.now() / 1000) + APPROVED_RESET_MAX_AGE_SECONDS
        : Math.floor(Date.now() / 1000);
    const result = this.database
      .prepare(
        `UPDATE self_hosted_password_resets
         SET status = ?, reviewed_by = ?, approved_at = CASE
           WHEN ? = 'approved' THEN CURRENT_TIMESTAMP ELSE NULL END,
           expires_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND status = 'pending'
           AND (
             ? = 'rejected'
             OR account_id IN (
               SELECT id FROM self_hosted_accounts WHERE role = 'player'
             )
           )`,
      )
      .run(decision, adminId, decision, expiresAt, requestId, decision);
    return result.changes === 1;
  }

  completePasswordReset(
    requestId: string,
    recoveryToken: string,
    newPassword: string,
  ): { account: SelfHostedAccount; sessionToken: string } | null {
    this.expirePasswordResets();
    const reset = this.passwordResetByToken(requestId, recoveryToken);
    if (!reset || reset.status !== "approved") return null;
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.setPassword(reset.accountId, newPassword, true);
      const result = this.database
        .prepare(
          `UPDATE self_hosted_password_resets
           SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND status = 'approved'`,
        )
        .run(requestId);
      if (result.changes !== 1) throw new Error("reset_not_available");
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return {
      account: this.byId(reset.accountId)!,
      sessionToken: this.createSession(reset.accountId),
    };
  }

  adminOverview(): {
    accounts: SelfHostedAdminAccount[];
    resets: SelfHostedPasswordReset[];
  } {
    this.expirePasswordResets();
    const accounts = this.database
      .prepare(
        `SELECT a.id, a.username, a.role, a.created_at AS createdAt,
           COUNT(s.token_hash) AS activeSessions
         FROM self_hosted_accounts a
         LEFT JOIN self_hosted_sessions s
           ON s.account_id = a.id AND s.expires_at > ?
         GROUP BY a.id
         ORDER BY a.created_at ASC`,
      )
      .all(
        Math.floor(Date.now() / 1000),
      ) as unknown as SelfHostedAdminAccount[];
    const resets = this.database
      .prepare(
        `SELECT r.id, r.account_id AS accountId,
           r.username_snapshot AS username, r.status,
           r.requested_at AS requestedAt, r.expires_at AS expiresAt,
           r.approved_at AS approvedAt
         FROM self_hosted_password_resets r
         INNER JOIN self_hosted_accounts a ON a.id = r.account_id
         WHERE r.status IN ('pending', 'approved') AND a.role = 'player'
         ORDER BY r.requested_at ASC`,
      )
      .all() as unknown as SelfHostedPasswordReset[];
    return { accounts, resets };
  }

  resetPasswordByUsername(
    username: string,
    newPassword: string,
  ): SelfHostedAccount | null {
    const account = this.byNormalizedUsername(normalizeUsername(username));
    if (!account) return null;
    this.setPassword(account.id, newPassword, true, true);
    return account;
  }

  deleteSession(token: string | undefined): void {
    if (!token) return;
    this.database
      .prepare("DELETE FROM self_hosted_sessions WHERE token_hash = ?")
      .run(sessionHash(token));
  }

  close(): void {
    this.database.close();
  }

  private createSession(accountId: string): string {
    const token = randomBytes(32).toString("base64url");
    this.database
      .prepare(
        `INSERT INTO self_hosted_sessions (token_hash, account_id, expires_at)
         VALUES (?, ?, ?)`,
      )
      .run(
        sessionHash(token),
        accountId,
        Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
      );
    return token;
  }

  private setPassword(
    accountId: string,
    password: string,
    revokeSessions: boolean,
    cancelPasswordResets = false,
  ): void {
    this.database
      .prepare(
        `UPDATE self_hosted_accounts
         SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(passwordHash(password), accountId);
    if (revokeSessions) {
      this.database
        .prepare("DELETE FROM self_hosted_sessions WHERE account_id = ?")
        .run(accountId);
    }
    if (cancelPasswordResets) {
      this.database
        .prepare(
          `UPDATE self_hosted_password_resets
           SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
           WHERE account_id = ? AND status IN ('pending', 'approved')`,
        )
        .run(accountId);
    }
  }

  private expirePasswordResets(): void {
    this.database
      .prepare(
        `UPDATE self_hosted_password_resets
         SET status = 'expired', updated_at = CURRENT_TIMESTAMP
         WHERE status IN ('pending', 'approved') AND expires_at <= ?`,
      )
      .run(Math.floor(Date.now() / 1000));
  }

  private passwordResetByToken(
    requestId: string,
    recoveryToken: string,
  ): SelfHostedPasswordReset | null {
    return (
      (this.database
        .prepare(
          `SELECT r.id, r.account_id AS accountId,
             r.username_snapshot AS username, r.status,
             r.requested_at AS requestedAt, r.expires_at AS expiresAt,
             r.approved_at AS approvedAt
           FROM self_hosted_password_resets r
           INNER JOIN self_hosted_accounts a ON a.id = r.account_id
           WHERE r.id = ? AND r.token_hash = ? AND a.role = 'player'`,
        )
        .get(requestId, sessionHash(recoveryToken)) as
        | SelfHostedPasswordReset
        | undefined) ?? null
    );
  }

  private claimLegacyAchievements(
    accountId: string,
    username: string,
    normalizedUsername: string,
  ): void {
    const achievementTable = this.database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'self_hosted_map_achievements'",
      )
      .get();
    if (!achievementTable) return;
    const legacyPlayers = this.database
      .prepare(
        "SELECT id, display_name AS displayName FROM self_hosted_players",
      )
      .all() as { id: string; displayName: string }[];
    const legacyIds = legacyPlayers
      .filter(
        (player) =>
          player.id !== accountId &&
          normalizeUsername(player.displayName) === normalizedUsername,
      )
      .map((player) => player.id);
    if (legacyIds.length === 0) return;

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO self_hosted_players (id, display_name)
           VALUES (?, ?)`,
        )
        .run(accountId, username);
      for (const legacyId of legacyIds) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO self_hosted_map_achievements
              (player_id, map_name, difficulty, source, game_id, earned_at)
             SELECT ?, map_name, difficulty, source, game_id, earned_at
             FROM self_hosted_map_achievements WHERE player_id = ?`,
          )
          .run(accountId, legacyId);
        this.database
          .prepare(
            "DELETE FROM self_hosted_map_achievements WHERE player_id = ?",
          )
          .run(legacyId);
        this.database
          .prepare("DELETE FROM self_hosted_players WHERE id = ?")
          .run(legacyId);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private byId(id: string): SelfHostedAccount | null {
    const row = this.database
      .prepare(
        `SELECT id, username, role, created_at AS createdAt
         FROM self_hosted_accounts WHERE id = ?`,
      )
      .get(id) as SelfHostedAccount | undefined;
    return row ?? null;
  }

  private byNormalizedUsername(
    normalizedUsername: string,
  ): SelfHostedAccount | null {
    const row = this.database
      .prepare(
        `SELECT id, username, role, created_at AS createdAt
         FROM self_hosted_accounts WHERE normalized_username = ?`,
      )
      .get(normalizedUsername) as SelfHostedAccount | undefined;
    return row ?? null;
  }
}

export const selfHostedSessionMaxAgeSeconds = SESSION_MAX_AGE_SECONDS;
