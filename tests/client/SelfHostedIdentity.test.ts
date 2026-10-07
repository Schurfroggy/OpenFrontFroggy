import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getPersistentID,
  getPlayToken,
  selfHostedAccountId,
} from "../../src/client/Auth";
import { PersistentIdSchema } from "../../src/core/Schemas";

describe("self-hosted name accounts", () => {
  beforeEach(() => {
    (window as any).BOOTSTRAP_CONFIG = { selfHosted: true };
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    delete (window as any).BOOTSTRAP_CONFIG;
  });

  it("maps the same normalized name to the same valid UUID", () => {
    const id = selfHostedAccountId("  Alice  ");
    expect(PersistentIdSchema.safeParse(id).success).toBe(true);
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(selfHostedAccountId("alice")).toBe(id);
    expect(selfHostedAccountId("ＡＬＩＣＥ")).toBe(id);
  });

  it("treats a new name as a new account", () => {
    expect(selfHostedAccountId("Alice")).not.toBe(selfHostedAccountId("Bob"));
  });

  it("uses the stored player name instead of the browser UUID", async () => {
    localStorage.setItem("username", "Alice");
    localStorage.setItem(
      "player_persistent_id",
      "11111111-1111-4111-8111-111111111111",
    );

    const expected = selfHostedAccountId("Alice");
    expect(await getPlayToken()).toBe(expected);
    expect(getPersistentID()).toBe(expected);
    expect(expected).not.toBe(localStorage.getItem("player_persistent_id"));
  });

  it("binds an in-flight join to the name supplied by that lobby", async () => {
    localStorage.setItem("username", "Changed Later");
    expect(await getPlayToken("Lobby Name")).toBe(
      selfHostedAccountId("Lobby Name"),
    );
  });
});
