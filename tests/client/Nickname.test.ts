import { describe, expect, it } from "vitest";
import { isAtlasRenderable } from "../../src/client/NameGlyphs";
import {
  ClientJoinMessageSchema,
  UsernameSchema,
} from "../../src/core/Schemas";
import { NicknameSchema } from "../../src/core/validations/Nickname";
import {
  MAX_NICKNAME_LENGTH,
  nicknameLength,
  validateNickname,
} from "../../src/core/validations/username";

describe("self-hosted nicknames", () => {
  it("counts code points, so Chinese and emoji each cost one", () => {
    expect(nicknameLength("阿丹")).toBe(2);
    expect(nicknameLength("🎯")).toBe(1);
    expect(nicknameLength("  Bob  ")).toBe(3);
  });

  it("accepts any script up to ten characters", () => {
    for (const name of [
      "阿丹",
      "李",
      "Bob",
      "🎯",
      "Alice 李",
      "日本語テスト",
    ]) {
      expect(validateNickname(name).isValid, name).toBe(true);
    }
    expect(validateNickname("一二三四五六七八九十").isValid).toBe(true);
    expect(validateNickname("一二三四五六七八九十一").isValid).toBe(false);
    expect(validateNickname("x".repeat(MAX_NICKNAME_LENGTH + 1)).isValid).toBe(
      false,
    );
  });

  it("rejects empty names and control characters", () => {
    expect(validateNickname("").isValid).toBe(false);
    expect(validateNickname("   ").isValid).toBe(false);
    expect(validateNickname("a\nb").isValid).toBe(false);
    expect(validateNickname("a\u0000b").isValid).toBe(false);
  });
});

describe("atlas renderability", () => {
  it("separates Latin-1 from scripts that need the DOM overlay", () => {
    expect(isAtlasRenderable("Alice")).toBe(true);
    expect(isAtlasRenderable("José")).toBe(true);
    expect(isAtlasRenderable("阿丹")).toBe(false);
    expect(isAtlasRenderable("🎯")).toBe(false);
  });
});

describe("nickname save/join contract", () => {
  it.each([
    "Bob!",
    "阿丹!",
    "A&B",
    "a<b>c",
    "a/b/c",
    "🎯".repeat(10),
    "一二三四五六七八九十",
  ])("allows a saved nickname through the join protocol: %s", (name) => {
    expect(validateNickname(name).isValid).toBe(true);
    const saved = NicknameSchema.parse(name);
    expect(
      ClientJoinMessageSchema.safeParse({
        type: "join",
        token: "11111111-1111-4111-8111-111111111111",
        gameID: "game0001",
        username: saved,
        clanTag: null,
        turnstileToken: null,
      }).success,
    ).toBe(true);
  });
  it("keeps client, profile and wire validation aligned for Latin-1 characters", () => {
    for (let code = 0; code <= 255; code++) {
      const name = `A${String.fromCodePoint(code)}B`;
      const accepted = validateNickname(name).isValid;
      expect(NicknameSchema.safeParse(name).success, name).toBe(accepted);
      expect(UsernameSchema.safeParse(name).success, name).toBe(accepted);
    }
    for (const name of ["a\u2028b", "a\u2029b", " ", "a\nb"]) {
      expect(NicknameSchema.safeParse(name).success).toBe(false);
      expect(UsernameSchema.safeParse(name).success).toBe(false);
    }
  });
  it("routes unsupported punctuation to the text overlay", () => {
    for (const name of ["Bob!", "A&B", "a<b>c", "a×b"])
      expect(isAtlasRenderable(name)).toBe(false);
    expect(isAtlasRenderable("José-A_1.2")).toBe(true);
  });
});
