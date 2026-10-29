import { z } from "zod";
export const FeedbackCategories = [
  "performance",
  "connection",
  "ai",
  "balance",
  "bug",
  "other",
] as const;
export const FeedbackStatuses = [
  "pending",
  "investigating",
  "resolved",
  "archived",
] as const;
const metric = z.number().finite().min(0).max(1e9);
export const FeedbackDiagnosticsSchema = z.object({
  browser: z.string().max(300),
  viewport: z.string().max(40),
  reconnects: z.number().int().min(0).max(100000),
  windows: z
    .array(
      z.object({
        at: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        values: z.record(
          z
            .string()
            .regex(
              /^(frame_time|tick_execution|tick_interval|ws_rtt)_(p50|p90|p99|count)$/,
            ),
          metric,
        ),
      }),
    )
    .max(11),
});
export const FeedbackInputSchema = z
  .object({
    submissionId: z.uuid(),
    gameId: z.string().regex(/^[\w-]{1,64}$/),
    rating: z.enum(["good", "okay", "bad"]).nullable(),
    categories: z.array(z.enum(FeedbackCategories)).max(6),
    stage: z.enum(["early", "middle", "late", "throughout", "unknown"]),
    comment: z.string().trim().max(500),
    context: z.object({
      map: z.string().max(100),
      size: z.string().max(40),
      mode: z.string().max(60),
      difficulty: z.string().max(40),
      bots: z.number().int().min(0).max(100000),
      nations: z.string().max(40),
      fog: z.boolean(),
      won: z.boolean(),
      duration: metric,
      version: z.string().max(100),
    }),
    diagnostics: FeedbackDiagnosticsSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.rating !== null || v.categories.length > 0 || v.comment.length > 0,
  );
export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
export const FeedbackReviewSchema = z.object({
  status: z.enum(FeedbackStatuses),
  note: z.string().trim().max(2000),
});
