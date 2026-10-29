import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { FeedbackInputSchema } from "../../src/core/UserFeedback";
import { UserFeedbackStore } from "../../src/server/UserFeedbackStore";
const input = () =>
  FeedbackInputSchema.parse({
    submissionId: randomUUID(),
    gameId: "test-game",
    rating: "bad",
    categories: ["performance"],
    stage: "early",
    comment: "卡顿<script>",
    context: {
      map: "China",
      size: "Normal",
      mode: "FFA",
      difficulty: "Medium",
      bots: 400,
      nations: "default",
      fog: false,
      won: false,
      duration: 60,
      version: "v1",
    },
  });
const dbs: DatabaseSync[] = [];
afterEach(() => {
  for (const db of dbs) db.close();
  dbs.length = 0;
});
function store() {
  const db = new DatabaseSync(":memory:");
  dbs.push(db);
  return new UserFeedbackStore(db);
}
describe("feedback persistence", () => {
  it("binds identity to the authenticated account and deduplicates retries and a second submission for the same game", () => {
    const s = store(),
      v = input();
    expect(s.submit({ id: "a", username: "Alice" }, v)).toBe(v.submissionId);
    expect(s.submit({ id: "a", username: "Alice" }, input())).toBe(
      v.submissionId,
    );
    expect(s.list().total).toBe(1);
    expect(s.list().items[0].username).toBe("Alice");
    s.submit({ id: "b", username: "Bob" }, input());
    expect(s.list().total).toBe(2);
  });
  it("paginates, searches and stores the reviewing admin", () => {
    const s = store();
    for (let i = 0; i < 23; i++)
      s.submit({ id: String(i), username: "Player" }, input());
    expect(s.list().items.length).toBe(20);
    expect(s.list(1).items.length).toBe(3);
    const id = String(s.list().items[0].id);
    expect(s.review(id, "admin", "resolved", "fixed")).toBe(true);
    expect(s.list(0, "resolved", "China").total).toBe(1);
    expect(s.list(0, "pending").total).toBe(22);
    expect(s.list(0, "resolved").items[0].reviewed_by).toBe("admin");
    expect(s.review(randomUUID(), "admin", "resolved", "")).toBe(false);
  });
  it("survives closing and reopening the database", () => {
    const dir = mkdtempSync(join(tmpdir(), "feedback-"));
    try {
      const path = join(dir, "test.sqlite");
      const db = new DatabaseSync(path);
      const s = new UserFeedbackStore(db);
      s.submit({ id: "a", username: "A" }, input());
      db.close();
      const again = new DatabaseSync(path);
      expect(new UserFeedbackStore(again).list().total).toBe(1);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects empty feedback, oversized comments and unapproved diagnostic fields", () => {
    expect(
      FeedbackInputSchema.safeParse({
        ...input(),
        rating: null,
        categories: [],
        comment: " ",
      }).success,
    ).toBe(false);
    expect(
      FeedbackInputSchema.safeParse({ ...input(), comment: "a".repeat(501) })
        .success,
    ).toBe(false);
    expect(
      FeedbackInputSchema.safeParse({
        ...input(),
        diagnostics: {
          browser: "x",
          viewport: "1x1",
          reconnects: 0,
          windows: [{ at: 0, values: { token: 123 } }],
        },
      }).success,
    ).toBe(false);
  });
});
