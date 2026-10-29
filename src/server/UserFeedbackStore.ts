import type { DatabaseSync } from "node:sqlite";
import type { FeedbackInput } from "../core/UserFeedback";
export class UserFeedbackStore {
  constructor(private db: DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS user_feedback (
      id TEXT PRIMARY KEY, account_id TEXT NOT NULL, username TEXT NOT NULL,
      game_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT, reviewed_at TEXT, UNIQUE(account_id, game_id));
      CREATE INDEX IF NOT EXISTS feedback_created ON user_feedback(created_at);`);
  }
  submit(
    account: { id: string; username: string },
    input: FeedbackInput,
  ): string {
    const previous = this.db
      .prepare(
        "SELECT id FROM user_feedback WHERE account_id=? AND (id=? OR game_id=?)",
      )
      .get(account.id, input.submissionId, input.gameId);
    if (previous) return String(previous.id);
    this.db
      .prepare(
        "INSERT INTO user_feedback(id,account_id,username,game_id,payload) VALUES(?,?,?,?,?)",
      )
      .run(
        input.submissionId,
        account.id,
        account.username,
        input.gameId,
        JSON.stringify(input),
      );
    return input.submissionId;
  }
  list(page = 0, status = "", q = "") {
    const where =
      " WHERE (?='' OR status=?) AND (?='' OR payload LIKE ? OR username LIKE ?)";
    const args = [status, status, q, `%${q}%`, `%${q}%`];
    const rows = this.db
      .prepare(
        "SELECT * FROM user_feedback" +
          where +
          " ORDER BY created_at DESC,rowid DESC LIMIT 20 OFFSET ?",
      )
      .all(...args, page * 20);
    return {
      items: rows.map((r) => ({
        id: String(r.id),
        username: String(r.username),
        created_at: String(r.created_at),
        status: String(r.status),
        note: String(r.note),
        reviewed_by: r.reviewed_by,
        reviewed_at: r.reviewed_at,
        payload: JSON.parse(String(r.payload)),
      })),
      total: Number(
        this.db
          .prepare("SELECT count(*) AS n FROM user_feedback" + where)
          .get(...args)!.n,
      ),
    };
  }
  review(id: string, admin: string, status: string, note: string) {
    return (
      this.db
        .prepare(
          "UPDATE user_feedback SET status=?,note=?,reviewed_by=?,reviewed_at=CURRENT_TIMESTAMP WHERE id=?",
        )
        .run(status, note, admin, id).changes > 0
    );
  }
}
