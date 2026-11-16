import { z } from "zod";

export const MIN_NICKNAME_LENGTH = 1;
export const MAX_NICKNAME_LENGTH = 10;
export const NICKNAME_CONTROL_CHAR_RE = /[\p{Cc}\u2028\u2029]/u;

/** Shared by profile updates and the client; display names are plain text. */
export const NicknameSchema = z
  .string()
  .trim()
  .min(MIN_NICKNAME_LENGTH)
  .max(MAX_NICKNAME_LENGTH * 2)
  .refine(
    (name) => !NICKNAME_CONTROL_CHAR_RE.test(name),
    "nickname_control_characters",
  )
  .refine(
    (name) => Array.from(name).length <= MAX_NICKNAME_LENGTH,
    "nickname_too_long",
  );
